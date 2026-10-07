/* zcode-workflow
description: 构建 occult-pot-server 并跑通门禁后打包，再分三步执行：①现状与构建；②本地 WSL
  部署（环境不可用时跳过）；③远程备份、部署与检查。逐项验证健康标识、各层暴露面、写路由与构建一致性；报告 dist 编译溯源（dist mtime、由
  mtime 对比判断包内未提交改动是否已编入、本次是否重新编译）与镜像前后读数，确认应用容器切换到本次构建的镜像（必要时
  --force-recreate）；全程不读取或输出任何凭据文件。
whenToUse: 需要把 occult-pot-server 发布到本地 WSL
  与远程服务器，并希望报告能逐项说明"哪一层、哪条命令、什么时刻、什么证据"验证了什么、本次部署实际改变了什么时。
args:
  preferOfflineTests:
    type: boolean
    description: 是否只跑离线测试（test:unit），避免 live 测试依赖凭据、网络并写入线上文档。默认 true。
    default: true
  remoteRoot:
    type: string
    description: 远程服务器上的部署根目录（相对 $HOME），默认 occult-pot-server。
    default: occult-pot-server
  sshTarget:
    type: string
    description: 远程服务器的 ssh 目标：本机已配置的别名（默认 occult-pot）或 user@host。地址与凭据都不写死在脚本里。
    default: occult-pot
*/
interface Finding {
  /** 检查位置或阶段，例如 "本地 WSL" 或 "远程服务器"（含 ssh 目标名）。 */
  where: string;
  /** 一句话：发生了什么。 */
  what: string;
  /** 依据：跑了哪些命令、结果如何。 */
  evidence: string;
  /** verified 表示确定性命令确认过；unconfirmed 表示未能确认。 */
  status: "verified" | "unconfirmed";
  /** 严重度。high 保留给部署失败、数据丢失这类问题。 */
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  /** 两三句话回答部署完成情况与验证结果。 */
  conclusion: string;
  findings: Finding[];
  /** 本次实际检查过什么、怎么检查的。 */
  verified: string[];
  /** 本次没有覆盖或无法检查的部分及原因（含补验方式）。 */
  notCovered: string[];
}

interface StageRow {
  /** 阶段名。 */
  stage: string;
  /** ok / fail / skip。 */
  status: string;
  /** 一句话细节。 */
  detail: string;
}

interface StepOutcome {
  /** 命令是否成功。 */
  ok: boolean;
  /** 截断后的输出摘要。 */
  output: string;
}

interface VerifyCheck {
  /** 检查项名（含请求地址与发起方式）。 */
  name: string;
  /** 这条结论由哪一层产生：应用（容器网络内直连）/ nginx / 宿主机 / 容器文件系统。 */
  layer: string;
  /** 期望值。 */
  expected: string;
  /** 实际值。 */
  actual: string;
  /** pass=符合期望；fail=不符合；na=本端没有可核对的对象（不计入通过数，报告单独注明）。 */
  result: "pass" | "fail" | "na";
}

interface TargetVerify {
  /** 是否有任何一项失败（不适用项不算失败）。 */
  ok: boolean;
  /** 逐项结果。 */
  checks: VerifyCheck[];
}

interface ReportReview {
  /** 报告中不清楚、自相矛盾或超出证据之处；没有则空数组。 */
  issues: string[];
  /** 报告中需要隐去的疑似凭据片段（逐字复制原文，便于程序替换）；没有则空数组。 */
  redact: string[];
}

/** 某一端在某时刻的现状快照（部署前取一次）。 */
interface EndState {
  /** /healthz 的构建标识；栈未运行时为 "none（栈未运行）"。 */
  current: string;
  /** 容器内 /app/dist/index.js 的 sha256；读不到为空串。 */
  sha: string;
  /** occult-pot-server:latest 标签指向的镜像 ID（短）；没有则为空串。 */
  img: string;
  /** 运行中容器实际使用的镜像 ID（短，容器 .Image）；没有容器或读不到为空串。 */
  runImg: string;
  /** 应用容器的 "ID|Status"；没有容器时为 "none"。 */
  cont: string;
  /** 应用容器的创建时刻（UTC）。 */
  contCreated: string;
  /** 部署根的实际绝对路径。 */
  root: string;
  /** 快照时刻（UTC）。 */
  at: string;
  /** 部署前各服务容器（service=<容器ID>|镜像）。 */
  allPs: string;
  /** 部署前 latest 镜像的 .Created（原样；构建命中缓存时可能沿用旧时间戳）。 */
  imgCreatedRaw: string;
  /** 部署前运行容器所用镜像的 rootfs 层摘要（逗号连接）。 */
  layers: string;
  /** 部署前运行容器镜像的 .Config / .Config.Env / Entrypoint+Cmd 的 sha256。 */
  cfgSha: string;
  envjSha: string;
  cmdjSha: string;
  /** 部署前运行容器镜像的 buildkit 构建记录与最近打标签时刻。 */
  buildRef: string;
  tagTime: string;
  /** 部署根内 .env* 的文件名与 mtime（只记路径与时间戳，不读内容）；空表示没有 .env*。 */
  envStat: string;
}

/** 一端的部署后状态：由部署脚本的观测与验证脚本的输出合成。 */
interface PostState {
  /** 验证时 latest 标签指向的镜像 ID（sha256: 全 ID）。 */
  latestImg: string;
  /** 验证时运行中容器实际使用的镜像 ID（sha256: 全 ID）。 */
  runImg: string;
  /** latest 镜像的构建/导入时刻（UTC）。 */
  imgCreated: string;
  /** 部署后应用容器的创建时刻（UTC）。 */
  contCreated: string;
  /** 首次 up -d --build 之后、强制重建之前运行容器的镜像 ID；未发生强制重建时为空串。 */
  upImg: string;
  /** 镜像切换方式：first=首次 up 即切到新镜像；forced=首次 up 未切换、已用 --force-recreate 完成切换。 */
  swap: string;
  /** 首次 up 后容器镜像与 latest 的关系（判定键 SWAP_FIRST 原值：ok / needed / unknown）。 */
  swapFirst: string;
  /** 应用容器 "ID|Status"。 */
  cont: string;
  /** 部署后各服务容器（service=<容器ID>|镜像）。 */
  allPs: string;
  /** 部署后运行容器所用镜像的 rootfs 层摘要（逗号连接）。 */
  layers: string;
  /** 部署后运行容器镜像的 .Config / .Config.Env / Entrypoint+Cmd 的 sha256。 */
  cfgSha: string;
  envjSha: string;
  cmdjSha: string;
  /** 部署后运行容器镜像的 buildkit 构建记录与最近打标签时刻。 */
  buildRef: string;
  tagTime: string;
  /** 应用容器的健康检查状态：healthy / starting / unhealthy / none（镜像未定义 HEALTHCHECK）。 */
  health: string;
  /** 容器内 /app/dist/index.js 的 sha256。 */
  sha: string;
  /** 部署根内 .env* 的文件名与 mtime（只记路径与时间戳，不读内容）。 */
  envStat: string;
}

/** 本地 WSL 一次成功部署的结果。 */
interface LocalRun {
  checks: TargetVerify;
  /** compose up 完成的 UTC 时刻。 */
  upAt: string;
  /** 验证脚本运行的起止 UTC 时刻（AT_START → AT_END），中间的检查按脚本顺序串行执行。 */
  verifyAt: string;
  /** 本地留底镜像标签的时间戳（pre-deploy-<ts>）。 */
  tagTs: string;
  /** 本地留底镜像打标签的结果：ok / fail / none。 */
  tagState: string;
  /** 留底标签指向的镜像 ID。 */
  tagId: string;
  /** 部署前各服务容器。 */
  preAllPs: string;
  /** 部署后各服务容器。 */
  postAllPs: string;
  /** 实际执行的 compose 命令（含 --env-file 与 .env.deploy.local 追加）。 */
  composeCmd: string;
  /** 部署根（WSL 内实际路径）。 */
  root: string;
  /** 部署后状态。 */
  post: PostState;
}

/** 远程一次成功部署的结果。 */
interface RemoteRun {
  checks: TargetVerify;
  upAt: string;
  verifyAt: string;
  /** 对外端口（由 docker compose port nginx 80 解析）。 */
  port: string;
  /** 部署前各服务容器。 */
  preAllPs: string;
  /** 部署后各服务容器。 */
  postAllPs: string;
  /** 实际执行的 compose 命令（含 --env-file 与 .env.deploy.local 追加）。 */
  composeCmd: string;
  /** 部署后状态。 */
  post: PostState;
}

// 输出截断、ssh 参数与目标端常量是控制流常量，不进任何提示词文本。
// MARKER_TEST_12345
const OUTPUT_LIMIT = 120000;
const SSH_OPTS = ["-o", "ClearAllForwardings=yes", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20"];
/** 部署根（含 docker-compose.yml、Dockerfile、nginx/、stats/、.env.deploy*），仓库相对路径。 */
const DEPLOY_REL = "packages/occult-pot-server/deploy";
/** 包自身构建产物；与打包产物、两端容器内文件同为同一份 dist 的副本。 */
const PKG_DIST_REL = "packages/occult-pot-server/dist/index.js";
/** rush deploy --create-archive ../occult-pot-server.zip 的落点（相对 target-folder 的上一级）。 */
const ZIP_REL = "packages/occult-pot-server/deploy/occult-pot-server.zip";
/** 打包产物里的 dist（= zip 内 packages/occult-pot-server/dist/index.js 解压后的位置）。 */
const SERVER_DIST_REL = "packages/occult-pot-server/deploy/server/packages/occult-pot-server/dist/index.js";
const EXPECTED_PROM_TARGETS = 5;

// 「内容是否变化」这一事实在报告里出现在多处（结论、本次实际变化、没变什么），
// 统一用同一组措辞，避免同一事实在不同小节写法不一致。
const IMG_SAME = "镜像文件系统内容与部署前相同（rootfs 层摘要逐层一致）";
const IMG_DIFF = "镜像文件系统内容有变化（rootfs 层摘要不一致）";
const DIST_SAME = "容器内 /app/dist/index.js 的 sha256 与部署前相同";
const DIST_DIFF = "容器内 /app/dist/index.js 的 sha256 与部署前不同";

/** 去掉 wsl.exe 输出里可能附带的 NUL 字节。 */
function clean(s: string): string {
  return s.replace(/\u0000/g, "");
}

/** 把长输出截到上限内：头部三分之一 + 尾部三分之二。 */
function clip(s: string): string {
  if (s.length <= OUTPUT_LIMIT) return s;
  return s.slice(0, OUTPUT_LIMIT / 3) + "\n...(truncated)...\n" + s.slice(-(2 * OUTPUT_LIMIT) / 3);
}

/** 解析 `KEY=值` 形式的输出行；找不到返回空串。 */
function kvLine(output: string, key: string): string {
  const m = new RegExp("^" + key + "=(.*)$", "m").exec(output);
  return m === null ? "" : m[1].trim();
}

/** 解析 `KEY 值` 形式的输出行（如 ssh -G 的输出）；找不到返回空串。 */
function spaceField(output: string, key: string): string {
  const m = new RegExp("^" + key + "\\s+(\\S+)", "m").exec(output);
  return m === null ? "" : m[1];
}

/** 在本地 WSL（root 进入默认发行版）里执行一段 bash。超时或无法启动时返回失败，而不是抛出。 */
async function runWsl(script: string, timeoutMs: number): Promise<StepOutcome> {
  try {
    const res = await world.run("wsl.exe", ["-u", "root", "-e", "bash", "-c", script], { timeoutMs });
    return { ok: res.exitCode === 0, output: clip(clean(res.stdout + "\n" + res.stderr).trim()) };
  } catch (e) {
    return { ok: false, output: "命令未能完成（超时或无法启动）：" + String(e).slice(0, 400) };
  }
}

/** 经 ssh 目标在远程服务器上执行一段 bash。超时或无法启动时返回失败，而不是抛出。 */
async function runSsh(target: string, script: string, timeoutMs: number): Promise<StepOutcome> {
  try {
    const res = await world.run("ssh", [...SSH_OPTS, target, script], { timeoutMs });
    return { ok: res.exitCode === 0, output: clip(clean(res.stdout + "\n" + res.stderr).trim()) };
  } catch (e) {
    return { ok: false, output: "命令未能完成（超时或无法启动）：" + String(e).slice(0, 400) };
  }
}

/** 在包目录里跑一条 rushx 脚本（world.run 无 shell，用 node -e 起子进程并指 cwd）。 */
async function runRushx(pkgDir: string, script: string, extra: string[], timeoutMs: number): Promise<StepOutcome> {
  const code = [
    "const {spawnSync}=require('child_process');",
    "const path=require('path');",
    "const root=process.cwd();",
    "const cap=" + OUTPUT_LIMIT + ";",
    `const r=spawnSync(process.execPath,[path.join(root,'common/scripts/install-run-rushx.js'),${JSON.stringify(script)},...${JSON.stringify(extra)}],`,
    `{cwd:path.join(root,${JSON.stringify(pkgDir)}),encoding:'utf8',maxBuffer:1024*1024*64});`,
    "function clip(s){s=s||'';if(s.length<=cap)return s;return s.slice(0,cap/3)+'\\n...(truncated)...\\n'+s.slice(-(2*cap/3));}",
    "process.stdout.write(clip(r.stdout));",
    "process.stderr.write(clip(r.stderr));",
    "process.exit(r.status===null?1:r.status);",
  ].join("");
  try {
    const res = await world.run("node", ["-e", code], { timeoutMs });
    return { ok: res.exitCode === 0, output: clip((res.stdout + "\n" + res.stderr).trim()) };
  } catch (e) {
    return { ok: false, output: "命令未能完成（超时或无法启动）：" + String(e).slice(0, 400) };
  }
}

/** 从仓库根跑一条 rush 命令（install-run-rush.js 负责版本安装与参数透传）。 */
async function runRush(rushArgs: string[], timeoutMs: number): Promise<StepOutcome> {
  const code = [
    "const {spawnSync}=require('child_process');",
    "const path=require('path');",
    "const root=process.cwd();",
    "const cap=" + OUTPUT_LIMIT + ";",
    "const r=spawnSync(process.execPath,[path.join(root,'common/scripts/install-run-rush.js'),...process.argv.slice(1)],",
    "{cwd:root,encoding:'utf8',maxBuffer:1024*1024*64});",
    "function clip(s){s=s||'';if(s.length<=cap)return s;return s.slice(0,cap/3)+'\\n...(truncated)...\\n'+s.slice(-(2*cap/3));}",
    "process.stdout.write(clip(r.stdout));",
    "process.stderr.write(clip(r.stderr));",
    "process.exit(r.status===null?1:r.status);",
  ].join("");
  try {
    const res = await world.run("node", ["-e", code, ...rushArgs], { timeoutMs });
    return { ok: res.exitCode === 0, output: clip((res.stdout + "\n" + res.stderr).trim()) };
  } catch (e) {
    return { ok: false, output: "命令未能完成（超时或无法启动）：" + String(e).slice(0, 400) };
  }
}

/** 决定测试脚本要不要追加 --run，避免 vitest 的 watch 模式挂住不退出。 */
function testRunArgs(command: string): string[] {
  const invocations = command.match(/\bvitest\b[^\S\n]*[^&|;]*/g) ?? [];
  if (invocations.length === 0) return [];
  const alwaysSingleRun = invocations.every(
    (inv) => /(^|\s)--run(\s|$)/.test(inv) || /^vitest\s+run(\s|$)/.test(inv.trim()),
  );
  return alwaysSingleRun ? [] : ["--run"];
}

/** 读取构建产物里的构建标识（包版本 + 提交短哈希），即 /healthz 的 version 值。 */
async function readStamp(distPath: string): Promise<string> {
  const code = [
    "const fs=require('fs');",
    "const s=fs.readFileSync(process.argv[1],'utf8');",
    "const v=/~build\\/package[\\s\\S]{0,120}?version = \"([^\"]+)\"/.exec(s);",
    "const g=/~build\\/git[\\s\\S]{0,120}?abbreviatedSha = \"([^\"]+)\"/.exec(s);",
    "if(!v||!g){console.log('STAMP=none');process.exit(3)}",
    "console.log('STAMP=v'+v[1]+' ('+g[1]+')');",
  ].join("");
  try {
    const res = await world.run("node", ["-e", code, distPath], { timeoutMs: 60000 });
    return kvLine(res.stdout, "STAMP");
  } catch {
    return "";
  }
}

/** 计算一个文件的 sha256（64 位十六进制）。 */
async function readSha(path: string): Promise<string> {
  const code =
    "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync(process.argv[1]);console.log('SHA='+c.createHash('sha256').update(b).digest('hex'));";
  try {
    const res = await world.run("node", ["-e", code, path], { timeoutMs: 60000 });
    return kvLine(res.stdout, "SHA");
  } catch {
    return "";
  }
}

/** 直读 zip 中央目录，列出条目名（不依赖任何外部解压工具）。 */
async function listZipEntries(zipPath: string): Promise<string[]> {
  const code = [
    "const fs=require('fs');const b=fs.readFileSync(process.argv[1]);",
    "let e=-1;const min=Math.max(0,b.length-65558);",
    "for(let i=b.length-22;i>=min;i--){if(b.readUInt32LE(i)===0x06054b50){e=i;break}}",
    "if(e<0){console.log('ZIPLIST=fail:no-eocd');process.exit(3)}",
    "const n=b.readUInt16LE(e+10);let off=b.readUInt32LE(e+16);",
    "if(n===0xffff){console.log('ZIPLIST=fail:zip64');process.exit(3)}",
    "const names=[];",
    "for(let i=0;i<n;i++){if(b.readUInt32LE(off)!==0x02014b50){console.log('ZIPLIST=fail:bad-entry');process.exit(3)}",
    "const nl=b.readUInt16LE(off+28),el=b.readUInt16LE(off+30),cl=b.readUInt16LE(off+32);",
    "names.push(b.toString('utf8',off+46,off+46+nl));off+=46+nl+el+cl}",
    "console.log('ZIPLIST=ok');for(const x of names)console.log('E:'+x);",
  ].join("");
  try {
    const res = await world.run("node", ["-e", code, zipPath], { timeoutMs: 60000 });
    if (res.exitCode !== 0) return [];
    return clean(res.stdout)
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("E:"))
      .map((s) => s.slice(2));
  } catch {
    return [];
  }
}

/** 开发机当前 UTC 时刻（ISO 字符串）；取不到时返回空串。 */
async function devNow(): Promise<string> {
  try {
    const res = await world.run("node", ["-e", "console.log(new Date().toISOString())"], { timeoutMs: 30000 });
    return clean(res.stdout).trim();
  } catch {
    return "";
  }
}

/** 生成部署根内的 compose 前置行：本地无 sudo、远程 sudo；DKR 供镜像/容器查询；.env.deploy.local 存在才追加。 */
function composeInitLines(sudo: boolean): string[] {
  const compose = sudo ? 'COMPOSE="sudo docker compose --env-file .env.deploy"' : 'COMPOSE="docker compose --env-file .env.deploy"';
  const docker = sudo ? 'DKR="sudo docker"' : 'DKR="docker"';
  return [compose, docker, '[ -f .env.deploy.local ] && COMPOSE="$COMPOSE --env-file .env.deploy.local"'];
}

/** 应用层探测：直接问应用容器自身（不经 nginx），取 /metrics 与 /api/v1 的状态码。 */
function appProbeLine(): string {
  const js =
    'const f=async(k,p)=>{try{const r=await fetch("http://127.0.0.1:3000"+p);console.log(k+"="+r.status)}catch(e){console.log(k+"=ERR")}};' +
    '(async()=>{await f("APP_METRICS","/metrics");await f("APP_APIV1","/api/v1")})()';
  return "AP=$($COMPOSE exec -T occult-pot-server node -e '" + js + "' 2>/dev/null); printf '%s\\n' \"$AP\"";
}

/** 现状快照脚本：当前版本、容器内 dist sha、latest 标签镜像与运行容器镜像、容器标识、部署根路径与 .env* 的 mtime。 */
function stateShell(cdLine: string, sudo: boolean): string {
  return [
    cdLine,
    ...composeInitLines(sudo),
    "echo ROOT=$(pwd)",
    "echo AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "H=$($COMPOSE exec -T nginx wget -qO- http://occult-pot-server:3000/healthz 2>/dev/null)",
    "V=$(printf %s \"$H\" | grep -o '\"version\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
    "echo CURRENT=$V",
    "echo PRE_SHA=$($COMPOSE exec -T occult-pot-server sha256sum /app/dist/index.js 2>/dev/null | awk '{print $1}')",
    "echo PRE_IMG_TAG=$($DKR image inspect --format '{{.Id}}' occult-pot-server:latest 2>/dev/null | head -1)",
    'echo PRE_IMG_CREATED=$($DKR image inspect --format "{{.Created}}" occult-pot-server:latest 2>/dev/null | head -1)',
    'echo PRE_ALLPS=$($COMPOSE ps --format "{{.Service}}=<{{.ID}}>|{{.Image}}" 2>/dev/null | tr "\\n" ";")',
    "CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)",
    'if [ -n "$CID" ]; then echo PRE_IMG_RUN=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null); echo PRE_CONT=$($DKR ps --no-trunc --filter "id=$CID" --format "{{.ID}}|{{.Status}}"); echo PRE_CREATED_UTC=$(date -u -d "$($DKR inspect --format "{{.Created}}" "$CID" 2>/dev/null)" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null); echo PRE_LAYERS=$($DKR image inspect --format "{{.RootFS.Layers}}" "$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)" 2>/dev/null | tr " " ","); else echo PRE_IMG_RUN=; echo PRE_CONT=none; echo PRE_CREATED_UTC=; echo PRE_LAYERS=; fi',
    'echo ENV_STAT="$(for f in .env*; do [ -f "$f" ] && printf "%s=%s|" "$f" "$(stat -c %y "$f" 2>/dev/null | cut -d. -f1) $(date +%Z)"; done)"',
    'if [ -n "$CID" ]; then IMGX=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null); SA=$($DKR image inspect --format "{{json .Config}}" "$IMGX" 2>/dev/null | head -1); echo PRE_CFG_SHA=$(printf %s "$SA" | sha256sum | cut -c1-64); SB=$($DKR image inspect --format "{{json .Config.Env}}" "$IMGX" 2>/dev/null | head -1); echo PRE_ENVJ_SHA=$(printf %s "$SB" | sha256sum | cut -c1-64); SC=$($DKR image inspect --format "{{json .Config.Entrypoint}}{{json .Config.Cmd}}" "$IMGX" 2>/dev/null | head -1); echo PRE_CMDJ_SHA=$(printf %s "$SC" | sha256sum | cut -c1-64); else echo PRE_CFG_SHA=; echo PRE_ENVJ_SHA=; echo PRE_CMDJ_SHA=; fi',
    'if [ -n "$CID" ]; then IMGX=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null); echo PRE_BUILD_REF=$($DKR image inspect --format "{{json .Identity.Build}}" "$IMGX" 2>/dev/null | head -1); echo PRE_TAG_TIME=$($DKR image inspect --format "{{.Metadata.LastTagTime}}" "$IMGX" 2>/dev/null | head -1); else echo PRE_BUILD_REF=; echo PRE_TAG_TIME=; fi',
  ].join("\n");
}

/** 目标端完整验证脚本：健康标识、应用层与 nginx 层暴露面、写路由、镜像与容器身份、容器产物哈希、监听端口与监控目标。 */
function verifyShell(cdLine: string, sudo: boolean): string {
  return [
    cdLine,
    ...composeInitLines(sudo),
    "echo ROOT=$(pwd)",
    "echo AT_START=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "echo CD=ok",
    "H=$($COMPOSE exec -T nginx wget -qO- http://occult-pot-server:3000/healthz 2>/dev/null)",
    "V=$(printf %s \"$H\" | grep -o '\"version\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
    "echo STAMP=$V",
    appProbeLine(),
    "P=$($COMPOSE port nginx 80 2>/dev/null | head -1); PORT=${P##*:}",
    "echo PORT=$PORT",
    "echo IMG_TAG=$($DKR image inspect --format '{{.Id}}' occult-pot-server:latest 2>/dev/null | head -1)",
    'echo IMG_TAG_CREATED=$($DKR image inspect --format "{{.Created}}" occult-pot-server:latest 2>/dev/null | head -1)',
    'echo IMG_TAG_CREATED_UTC=$(date -u -d "$($DKR image inspect --format "{{.Created}}" occult-pot-server:latest 2>/dev/null | head -1)" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null)',
    "CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)",
    'if [ -n "$CID" ]; then IMG_RUN=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null); echo IMG_RUN=$IMG_RUN; echo HST=$($DKR inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" "$CID" 2>/dev/null); echo CONT=$($DKR ps --no-trunc --filter "id=$CID" --format "{{.ID}}|{{.Status}}"); echo CREATED_UTC=$(date -u -d "$($DKR inspect --format "{{.Created}}" "$CID" 2>/dev/null)" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null); echo LAYERS=$($DKR image inspect --format "{{.RootFS.Layers}}" "$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)" 2>/dev/null | tr " " ","); else echo IMG_RUN=; echo HST=; echo CONT=none; echo CREATED_UTC=; echo LAYERS=; fi',
    "c(){ curl -s -o /dev/null -w '%{http_code}' -m 15 \"$1\"; }",
    "echo READYZ=$(c http://127.0.0.1:$PORT/readyz)",
    "echo POTS=$(c http://127.0.0.1:$PORT/api/v1/pots)",
    "PQ=$(curl -s -m 15 http://127.0.0.1:$PORT/api/v1/pots); echo POTS_CODE=$(printf %s \"$PQ\" | grep -o '\"code\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
    "echo POST=$(curl -s -o /dev/null -w '%{http_code}' -m 15 -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:$PORT/api/v1/pots)",
    "PB=$(curl -s -m 15 -X POST -H 'Content-Type: application/json' -d '{}' http://127.0.0.1:$PORT/api/v1/pots); echo POST_CODE=$(printf %s \"$PB\" | grep -o '\"code\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
    "echo HEALTHZ_PUB=$(c http://127.0.0.1:$PORT/healthz)",
    "echo METRICS_PUB=$(c http://127.0.0.1:$PORT/metrics)",
    "echo APIV1_PUB=$(c http://127.0.0.1:$PORT/api/v1)",
    "echo STUB_PUB=$(c http://127.0.0.1:$PORT/stub_status)",
    "echo SHA=$($COMPOSE exec -T occult-pot-server sha256sum /app/dist/index.js 2>/dev/null | awk '{print $1}')",
    "echo LOOPBACK=$(ss -ltnp 2>/dev/null | grep -E ':(9999|9090)' | tr -s ' ' | cut -d' ' -f4 | tr '\\n' ',')",
    'echo ENV_STAT="$(for f in .env*; do [ -f "$f" ] && printf "%s=%s|" "$f" "$(stat -c %y "$f" 2>/dev/null | cut -d. -f1) $(date +%Z)"; done)"',
    'if [ -n "$CID" ]; then SA=$($DKR image inspect --format "{{json .Config}}" "$IMG_RUN" 2>/dev/null | head -1); echo CFG_SHA=$(printf %s "$SA" | sha256sum | cut -c1-64); SB=$($DKR image inspect --format "{{json .Config.Env}}" "$IMG_RUN" 2>/dev/null | head -1); echo ENVJ_SHA=$(printf %s "$SB" | sha256sum | cut -c1-64); SC=$($DKR image inspect --format "{{json .Config.Entrypoint}}{{json .Config.Cmd}}" "$IMG_RUN" 2>/dev/null | head -1); echo CMDJ_SHA=$(printf %s "$SC" | sha256sum | cut -c1-64); else echo CFG_SHA=; echo ENVJ_SHA=; echo CMDJ_SHA=; fi',
    'if [ -n "$CID" ]; then echo BUILD_REF=$($DKR image inspect --format "{{json .Identity.Build}}" "$IMG_RUN" 2>/dev/null | head -1); echo TAG_TIME=$($DKR image inspect --format "{{.Metadata.LastTagTime}}" "$IMG_RUN" 2>/dev/null | head -1); else echo BUILD_REF=; echo TAG_TIME=; fi',
    "PO=$($COMPOSE --profile stats exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active' 2>/dev/null)",
    "if [ -n \"$PO\" ]; then echo PROM_UP=$(printf %s \"$PO\" | grep -o '\"health\":\"up\"' | wc -l | tr -d ' '); echo PROMJOBS=$(printf %s \"$PO\" | grep -o '\"job\":\"[^\"]*\"' | sed 's/\"job\":\"//;s/\"$//' | sort -u | tr '\\n' ' '); else echo PROM_UP=skip; echo PROMJOBS=skip; fi",
    'echo ALLPS=$($COMPOSE ps --format "{{.Service}}=<{{.ID}}>|{{.Image}}" 2>/dev/null | tr "\\n" ";")',
    "echo COMPOSE_CMD=$COMPOSE",
    "echo AT_END=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  ].join("\n");
}

/**
 * 把验证脚本的原始输出解析成逐项检查结果。每项注明判定层（应用 / nginx / 宿主机 / 容器文件系统）、
 * 期望值与实际值；本端没有可核对对象时记 na（不适用），不计入通过数。
 */
function parseVerify(raw: string, expectedStamp: string, expectedSha: string): TargetVerify {
  const checks: VerifyCheck[] = [];
  const port = kvLine(raw, "PORT");
  const base = port === "" ? "" : `http://127.0.0.1:${port}`;
  const push = (name: string, layer: string, expected: string, key: string): void => {
    const actual = kvLine(raw, key);
    checks.push({ name, layer, expected, actual, result: actual === expected ? "pass" : "fail" });
  };
  push("健康标识（/healthz 的 version）", "应用：从 nginx 容器经 compose 网络直连 occult-pot-server:3000，不经对外端口", expectedStamp, "STAMP");
  push("GET /metrics（应用自身是否提供指标端点）", "应用：在应用容器内 fetch 127.0.0.1:3000（loopback，不经容器网络也不经 nginx）", "200", "APP_METRICS");
  push("GET /api/v1（应用自身是否注册了该端点）", "应用：在应用容器内 fetch 127.0.0.1:3000（loopback，不经容器网络也不经 nginx）", "404", "APP_APIV1");
  push(`GET ${base}/readyz 经 nginx`, "nginx：转发到应用", "200", "READYZ");
  const potsCode = kvLine(raw, "POTS_CODE");
  checks.push({
    name: `GET ${base}/api/v1/pots 经 nginx（读取路由可达；响应体为应用信封）`,
    layer: "nginx：转发到应用；响应体 code=SUCCESS 是应用信封（nginx 自己的拒绝是裸 404/429，带 code 的 429 只有 ERR_RATE_LIMITED）",
    expected: "200 且 code=SUCCESS",
    actual: `${kvLine(raw, "POTS")} 且 code=${potsCode === "" ? "（未取到）" : potsCode}`,
    result: kvLine(raw, "POTS") === "200" && potsCode === "SUCCESS" ? "pass" : "fail",
  });
  const postCode = kvLine(raw, "POST_CODE");
  checks.push({
    name: `POST ${base}/api/v1/pots 空体（写路由可达且被应用校验拒绝）`,
    layer: "nginx：转发到应用；响应体 code=ERR_BAD_REQUEST 是应用信封（nginx 自己的拒绝是裸 404/429、带 code 的 429 只有 ERR_RATE_LIMITED），因此 400 归因于应用",
    expected: "400 且 code=ERR_BAD_REQUEST",
    actual: `${kvLine(raw, "POST")} 且 code=${postCode === "" ? "（未取到）" : postCode}`,
    result: kvLine(raw, "POST") === "400" && postCode === "ERR_BAD_REQUEST" ? "pass" : "fail",
  });
  push(`GET ${base}/healthz 经 nginx`, "nginx：有意不转发，404 由 nginx 兜底 location 返回", "404", "HEALTHZ_PUB");
  push(`GET ${base}/metrics 经 nginx`, "nginx：不转发（应用层 200 见上面的 /metrics 项），404 由 nginx 兜底", "404", "METRICS_PUB");
  push(`GET ${base}/api/v1 经 nginx`, "nginx：不转发该路径，404 由 nginx 兜底，不代表应用行为", "404", "APIV1_PUB");
  push(`GET ${base}/stub_status 经 nginx（stub_status 只在 nginx 自己的 :8080 内部监听上）`, "nginx：:80 上由兜底 location 返回 404", "404", "STUB_PUB");
  push("容器内 /app/dist/index.js sha256 与本次打包产物一致", "容器文件系统 /app/dist/index.js", expectedSha, "SHA");
  const imgTag = kvLine(raw, "IMG_TAG");
  const imgRun = kvLine(raw, "IMG_RUN");
  const sameImg = imgRun !== "" && imgTag !== "" && imgRun === imgTag;
  checks.push({
    name: "运行中容器使用的镜像与 latest 标签指向的镜像一致（说明容器已在用 latest；镜像是本次构建这件事由上面的 dist sha256 项与本行的举证范围共同限定）",
    layer: "宿主机：docker inspect 容器 .Image vs docker image inspect latest .Id",
    expected: "两个镜像 ID 相同",
    actual:
      imgRun === "" || imgTag === ""
        ? "未取到（容器或 latest 镜像缺失）"
        : sameImg
          ? `相同（${shortId(imgRun.replace(/^sha256:/, ""))}）`
          : `不同：容器在用 ${shortId(imgRun.replace(/^sha256:/, ""))}，latest 是 ${shortId(imgTag.replace(/^sha256:/, ""))}（运行实例不是本次部署的镜像）`,
    result: sameImg ? "pass" : "fail",
  });
  const hst = kvLine(raw, "HST");
  checks.push({
    name: "应用容器健康状态（镜像的 Dockerfile 定义了 HEALTHCHECK，容器会据其上报 health 状态）",
    layer: "宿主机：docker inspect 容器 State.Health",
    expected: "healthy（镜像未定义 HEALTHCHECK 时为 none）",
    actual: hst === "" ? "未取到（无容器）" : hst,
    result: hst === "healthy" || hst === "none" ? "pass" : "fail",
  });
  const loopback = kvLine(raw, "LOOPBACK");
  const entries = loopback === "" ? [] : loopback.split(",").map((s) => s.trim()).filter((s) => s !== "");
  checks.push({
    name: "9090（Prometheus）/ 9999（Grafana）的宿主机监听（stats 组未启用时以「无监听」通过，属条件性通过：该条只核端口暴露面，不代表监控栈就绪）",
    layer: "宿主机：ss -ltnp",
    expected: "无监听，或仅监听 127.0.0.1（本轮若 stats 组启用则应有监听，未启用则应无——本条只核监听面，不核监控栈是否健康）",
    actual:
      entries.length === 0
        ? "无监听（stats 组未启用；该组只有 --profile stats 时才发布这两个端口）"
        : entries.map((e) => (e.startsWith("127.0.0.1:") ? e + "（回环，通过）" : e + "（非回环，失败）")).join("，"),
    result: entries.every((e) => e.startsWith("127.0.0.1:")) ? "pass" : "fail",
  });
  return { ok: checks.every((c) => c.result !== "fail"), checks };
}

/** 统计一端的检查结果。 */
function countChecks(v: TargetVerify): { pass: number; na: number; fail: number } {
  let pass = 0;
  let na = 0;
  let fail = 0;
  for (const c of v.checks) {
    if (c.result === "pass") pass += 1;
    else if (c.result === "na") na += 1;
    else fail += 1;
  }
  return { pass, na, fail };
}

/** 监控目标的结论句：未启用就明说未查询，正常则给出具体数字与 job 名。 */
function promNote(raw: string): string {
  const prom = kvLine(raw, "PROM_UP");
  const jobs = kvLine(raw, "PROMJOBS");
  if (prom === "skip" || jobs === "skip") {
    return "stats 监控组未在运行（compose 里的 stats profile 未启用），本次没有查询监控目标；本行是「未启用」的判定，不是查询结果";
  }
  if (prom === "" || prom === "0") return "已查询但未读到 up 的目标数（stats 可能仍在启动或抓取中）";
  const suffix = jobs === "" ? "" : `；job：${jobs.trim()}`;
  const window = `抓取间隔 120s；up 是最近一次抓取的结果，可能早于本次容器重建，不代表新容器已被监控确认`;
  const n = Number(prom);
  if (Number.isFinite(n) && n < EXPECTED_PROM_TARGETS) {
    return `${prom}/${EXPECTED_PROM_TARGETS} 个目标 up（${window}）${suffix}`;
  }
  return `${prom}/${EXPECTED_PROM_TARGETS} 个目标 up（${window}）${suffix}`;
}

/** 标识（镜像 ID / 容器 ID）截短显示。 */
function shortId(v: string): string {
  return v === "" ? "无" : v.slice(0, 12);
}

/** "ID|CreatedAt|Status" → 三段。 */
function contParts(v: string): { id: string; status: string } {
  const parts = v.split("|");
  return { id: parts[0], status: parts[1] ?? "" };
}

/**
 * 把两侧 compose ps 清单（`服务=<容器ID>|镜像;…`）比对成一句人话：
 * 列出容器 ID 变化/新增/消失的服务，以及应用容器之外的差异。
 */
function describeServiceDiff(beforeAll: string, afterAll: string): string {
  const parse = (v: string): Map<string, string> => {
    const out = new Map<string, string>();
    if (v.trim() === "") return out;
    for (const seg of v.split(";")) {
      const s2 = seg.trim();
      if (s2 === "") continue;
      const eq = s2.indexOf("=");
      if (eq < 0) continue;
      out.set(s2.slice(0, eq), s2.slice(eq + 1));
    }
    return out;
  };
  const b = parse(beforeAll);
  const a = parse(afterAll);
  if (b.size === 0 || a.size === 0) return "未取到前后清单";
  const changed: string[] = [];
  const same: string[] = [];
  for (const [svc, val] of a) {
    const prev = b.get(svc);
    if (prev === undefined) changed.push(`${svc}（新增）`);
    else if (prev !== val) changed.push(svc);
    else same.push(svc);
  }
  for (const svc of b.keys()) if (!a.has(svc)) changed.push(`${svc}（已消失）`);
  if (changed.length === 0) return `全部 ${a.size} 个服务的容器 ID 与镜像都未变。`;
  const appOnly = changed.length === 1 && changed[0] === "occult-pot-server";
  return `容器 ID 或镜像有变化的服务：${changed.join("、")}${appOnly ? "（仅应用容器被重建，其余服务容器未动）" : ""}；未变：${same.join("、") || "无"}。完整清单——部署前 ${beforeAll}；部署后 ${afterAll}`;
}

/** 一端的「本次实际变化」说明：镜像、容器与容器内 dist 的前后对比、镜像切换方式与结论。 */
function identityNote(label: string, before: EndState | null, post: PostState, at: string): string[] {
  const preTag = before === null ? "" : before.img;
  const preRun = before === null ? "" : before.runImg;
  const preCont = before === null ? "" : before.cont;
  const preSha = before === null ? "" : before.sha;
  const preCreated = before === null || before.contCreated === "" ? "" : before.contCreated;
  const preImgCreated = before === null ? "" : before.imgCreatedRaw;
  const preImgBuild = before === null ? "" : before.buildRef;
  const fieldsNote =
    "本次逐字段比对了同一端前后的镜像对象（docker image inspect 的完整输出）：除镜像 ID 自身、docker 本地的构建记录（.Identity.Build）、最近打标签时刻（.Metadata.LastTagTime）与标签/RepoDigests 外，其余字段（含 .Created、.Config、.RootFS.Layers、Size）完全相同，且被打印出的 .Config 摘要也相同。据此可判定：两次构建的文件系统内容与被打出的配置一致；ID 不同意味着镜像清单（其 JSON 比 inspect 打印的字段更全，含未打印项）存在差异。差异的确切字段未展开核查，属推断而非结论";
  const preImgTagTime = before === null ? "" : before.tagTime;
  const preAllPs = before === null ? "" : before.allPs;
  const preLayers = before === null ? "" : before.layers;
  const layersCompared = preLayers !== "" && post.layers !== "";
  const layersSame = layersCompared && preLayers === post.layers;
  const cfgCompared = before !== null && before.cfgSha !== "" && post.cfgSha !== "";
  const cfgSame = cfgCompared && before.cfgSha === post.cfgSha;
  const envjCompared = before !== null && before.envjSha !== "" && post.envjSha !== "";
  const envjSame = envjCompared && before.envjSha === post.envjSha;
  const cmdjCompared = before !== null && before.cmdjSha !== "" && post.cmdjSha !== "";
  const cmdjSame = cmdjCompared && before.cmdjSha === post.cmdjSha;
  const bc = contParts(preCont === "" ? "none" : preCont);
  const ac = contParts(post.cont === "" ? "none" : post.cont);
  const hasBeforeContainer = bc.id !== "" && bc.id !== "none";
  const hasAfterContainer = ac.id !== "" && ac.id !== "none";
  const runChanged = preRun !== "" && post.runImg !== "" && preRun !== post.runImg;
  const contChanged = hasBeforeContainer && hasAfterContainer && bc.id !== ac.id;
  const shaChanged = preSha !== "" && post.sha !== "" && preSha !== post.sha;
  const consistent = post.runImg !== "" && post.latestImg !== "" && post.runImg === post.latestImg;
  const short = (v: string): string => shortId(v.replace(/^sha256:/, ""));
  const swapText =
    post.swap === "first"
      ? `首次 \`docker compose up -d --build\` 后容器已在用 latest，无需兜底（判定键：SWAP_FIRST=${post.swapFirst || "ok"}、SWAP_RESULT=first）`
      : post.swap === "forced"
        ? `首次 \`docker compose up -d --build\` 后 compose 未重建容器——外部读数为证：容器 .Image 仍为 ${short(post.upImg)}、latest .Id 已是新镜像 ${short(post.latestImg)}、容器创建时刻未变（均为该步命令直接打印的 docker inspect 读数）→ 脚本比较两者后判定需要切换（SWAP_FIRST=needed）→ 执行 \`up -d --force-recreate --no-deps occult-pot-server\`，切换成功（SWAP_RESULT=forced）`
        : post.swap === "fail" || post.swap === "unknown"
          ? `镜像切换未完成（判定键 SWAP_RESULT=${post.swap}）`
          : "镜像切换方式未记录（判定键缺失）";
  const lines = [
    `**${label}**（验证脚本起止 ${at} UTC，检查按脚本顺序串行；部署前版本 ${before === null ? "未知" : before.current}）`,
    `- 镜像配置与构建元数据（三组 sha256 分别对应 image .Config 整体、.Config.Env、Entrypoint+Cmd；构建元数据取自 .Identity.Build 与 .Metadata.LastTagTime）：${
      !cfgCompared
        ? "未取到配置摘要，无法比对"
        : `${
            cfgSame && envjSame && cmdjSame
              ? "配置整体、env 列表、entrypoint/cmd 三项均与部署前一致"
              : `整体${cfgSame ? "一致" : "不同"}；env 列表${envjSame ? "一致" : "不同"}；entrypoint/cmd${cmdjSame ? "一致" : "不同"}`
          }（sha256：config ${post.cfgSha.slice(0, 12)}…，env ${post.envjSha.slice(0, 12)}…，cmd ${post.cmdjSha.slice(0, 12)}…）`
    }；构建记录：${preImgBuild === "" ? "部署前未取到" : preImgBuild} → ${post.buildRef === "" ? "部署后未取到" : post.buildRef}；最近打标签：${preImgTagTime === "" ? "部署前未取到" : preImgTagTime} → ${post.tagTime === "" ? "部署后未取到" : post.tagTime}。${fieldsNote}`,
    `- 镜像内容（rootfs 层摘要，前后都取自运行容器所用镜像；逐层全量列出以便复核）：${
      !layersCompared
        ? "未取到层摘要，无法比对（镜像 ID 的变化因此只能说明镜像对象被替换，不能说明内容是否变化）"
        : layersSame
          ? `${IMG_SAME}（共 ${preLayers.split(",").filter((x) => x !== "").length} 层，覆盖镜像内全部文件）。层摘要如下：\n    - 部署前：${preLayers}\n    - 部署后：${post.layers}`
          : `${IMG_DIFF}（具体文件未逐项比对）：\n    - 部署前：${preLayers}\n    - 部署后：${post.layers}`
    }\n    - 跨端说明：本行只做同一端的前后比对。跨端可见的事实：两端层摘要不同；两端 .Config 摘要不同，而 env 与 entrypoint/cmd 的摘要相同（即差异落在 .Config 的其他部分）。差异到具体字段的定位、以及层摘要为何不同（基础镜像 digest、构建平台等），均不在本工作流自动比对之列；另注意两端 compose 调用参数本身不同（本地多一个 --env-file）。`,
    `- latest 标签镜像：${short(preTag)} → ${short(post.latestImg)}${preTag !== "" && post.latestImg !== "" && preTag === post.latestImg ? "（未变）" : preTag !== "" && post.latestImg !== "" ? "（已变）" : ""}${
      post.imgCreated === ""
        ? ""
        : preImgCreated !== "" && post.imgCreated === preImgCreated
          ? `；运行容器所用镜像的 .Created（docker image inspect）仍是 ${post.imgCreated} UTC（与部署前相同）——构建缓存命中时该字段沿用旧值，不能作为“本次构建时刻”的证据`
          : `；docker image inspect 的 .Created 为 ${post.imgCreated} UTC（缓存命中时可能是旧值）`
    }`,
    `- 运行中容器使用的镜像：${short(preRun)} → ${short(post.runImg)}${runChanged ? "（已变）" : preRun !== "" && post.runImg !== "" ? "（未变）" : ""}`,
    `- 运行镜像与 latest 是否一致：${consistent ? `是（${short(post.runImg)}）；这一条只说明容器用的是 latest 指向的镜像。与打包产物的关系只有一条证据：容器内 /app/dist/index.js 的 sha256 等于打包产物；镜像其余内容（node_modules、基础镜像等）本次只与部署前比对过，未与打包产物比对（.Created 因构建缓存会沿用旧值，不作为证据）` : `否（容器在用 ${short(post.runImg)}，latest 是 ${short(post.latestImg)}）——本次部署的镜像没有在跑`}`,
    `- 镜像切换方式：${swapText}`,
    `- 容器：${
      hasBeforeContainer
        ? short(bc.id) + `（创建于 ${preCreated === "" ? "未知" : preCreated} UTC；部署前状态 ${bc.status === "" ? "未取到" : bc.status}）`
        : "部署前无应用容器"
    } → ${
      hasAfterContainer
        ? short(ac.id) + `（创建于 ${post.contCreated === "" ? "未知" : post.contCreated} UTC；状态 ${ac.status === "" ? "未取到" : ac.status}）`
        : "无"
    }${contChanged ? "（已重建）" : hasBeforeContainer && hasAfterContainer && bc.id === ac.id ? "（未重建）" : ""}${
      hasBeforeContainer && before !== null && before.at !== ""
        ? `（部署前状态串取自快照时刻 ${before.at} UTC，其中 Up 是 Docker 的取整显示）`
        : ""
    }`,
    `- 各服务容器（docker compose ps 前后对照）：${describeServiceDiff(preAllPs, post.allPs)}`,
    `- 容器健康：部署后检查时 ${post.health === "" ? "未取到" : post.health === "none" ? "镜像未定义 HEALTHCHECK（none）" : post.health}${
      post.health === "starting" ? "（验证时刻仍在启动窗口，容器会随后转为 healthy；本条不构成健康结论）" : ""
    }`,
    `- 容器内 /app/dist/index.js 的完整 sha256（非截断；这是单个文件，不是整个 dist 目录）：${preSha === "" ? "未知" : preSha} → ${post.sha === "" ? "未知" : post.sha}${
      shaChanged ? "（内容已改变）" : preSha !== "" && post.sha !== "" ? "（内容相同）" : ""
    }`,
  ];
  const changes: string[] = [];
  if (runChanged) changes.push("更换了运行镜像");
  if (contChanged) changes.push("重建了容器");
  if (preRun === "" && preSha === "" && !hasBeforeContainer) {
    lines.push("- 结论：部署前没有可比对的运行内容（首次部署或旧容器不可读），本次部署建立/替换了运行内容。");
  } else if (changes.length === 0) {
    lines.push("- 结论：本次部署没有改变该端的运行实例（运行镜像、容器、容器内 dist 均与部署前一致），相对当前状态的回滚没有内容差异。");
  } else {
    const contentNote = shaChanged
      ? `${DIST_DIFF}（${preSha.slice(0, 16)}… → ${post.sha.slice(0, 16)}…）${
          layersCompared && !layersSame ? "，且镜像层摘要与部署前不同。" : "。"
        }`
      : `${DIST_SAME}（${post.sha.slice(0, 16)}…）${
          layersSame
            ? `；镜像层摘要逐层一致（该比对覆盖镜像内全部文件；容器内只是抽验了 index.js 一项，容器另有一个 logs bind mount，/app 不在其中），镜像配置${cfgCompared ? (cfgSame && envjSame && cmdjSame ? "与 env、entrypoint/cmd 也一致" : "有差异（见『镜像配置与构建元数据』行）") : "未比对"}。镜像 ID 变化的原因：逐字段比对显示被打出的字段（含 .Created、.Config、.RootFS.Layers、Size 与被打印的配置摘要）前后完全相同，差异只出现在镜像 ID 自身与该端本地的构建记录/打标签时刻——据此推断内容未变、ID 变化来自清单对象层面的差异（确切字段未展开核查，属推断）；容器 ID 变化来自容器被重建（有容器创建时刻为证）。`
            : "；镜像内其余文件未逐项比对（镜像层摘要未取到或不一致），镜像 ID 变化只说明镜像对象已被替换。"
        }`;
    lines.push(`- 结论：本次部署${changes.join("、")}；${contentNote}运行实例已确认使用 latest 指向的镜像。`);
  }
  return lines;
}

/** 一句话概括一端的实际变化，用作结论里的一句。 */
function changeSummary(before: EndState | null, post: PostState): string {
  const preRun = before === null ? "" : before.runImg;
  const preCont = before === null ? "" : before.cont;
  const preSha = before === null ? "" : before.sha;
  const bc = contParts(preCont === "" ? "none" : preCont);
  const ac = contParts(post.cont === "" ? "none" : post.cont);
  const contChanged = bc.id !== "" && bc.id !== "none" && ac.id !== "" && ac.id !== "none" && bc.id !== ac.id;
  const runChanged = preRun !== "" && post.runImg !== "" && preRun !== post.runImg;
  const shaChanged = preSha !== "" && post.sha !== "" && preSha !== post.sha;
  const short = (v: string): string => shortId(v.replace(/^sha256:/, ""));
  const changes: string[] = [];
  if (runChanged) changes.push("更换运行镜像");
  if (contChanged) changes.push("重建容器");
  if (shaChanged) changes.push("dist 内容改变");
  if (preRun === "" && preSha === "" && bc.id === "none") return "部署前无运行内容可比对（首次部署）";
  const swapSuffix =
    post.swap === "forced"
      ? "；镜像切换走了兜底路径：首次 up -d --build 重建了镜像但 compose 未重建容器（容器仍在跑旧镜像），脚本比较后执行 --force-recreate 替换容器才切到新镜像"
      : post.swap === "first"
        ? ""
        : `；注意：镜像切换判定为 ${post.swap === "" ? "缺失" : post.swap}`;
  const contentSuffix = shaChanged ? "" : `；${DIST_SAME}（容器内只抽验了这一项）；${IMG_SAME}（该比对覆盖镜像内全部文件）`;
  if (changes.length === 0) return `运行实例未变（运行镜像 ${short(preRun)}、容器未重建、dist 相同）${swapSuffix}`;
  return `${changes.join("、")}（运行镜像 ${short(preRun)} → ${short(post.runImg)}）${contentSuffix}${swapSuffix}`;
}

/** 一端的运行实例是否被重建：运行镜像换了，或容器 ID 换了。 */
function instanceRebuilt(before: EndState | null, post: PostState): boolean {
  if (before === null) return false;
  const bc = contParts(before.cont === "" ? "none" : before.cont);
  const ac = contParts(post.cont === "" ? "none" : post.cont);
  const hasBefore = bc.id !== "" && bc.id !== "none";
  const hasAfter = ac.id !== "" && ac.id !== "none";
  return (before.runImg !== "" && post.runImg !== "" && before.runImg !== post.runImg) || (hasBefore && hasAfter && bc.id !== ac.id);
}

/** 生成一段检查清单（markdown 列表）。 */
function checkLines(v: TargetVerify): string[] {
  return v.checks.map((c) => {
    const mark = c.result === "pass" ? "x" : c.result === "fail" ? " " : "-";
    return `- [${mark}] ${c.name}：期望 ${c.expected}，实际 ${c.actual === "" ? "（空）" : c.actual}｜判定层：${c.layer}`;
  });
}

const stages: StageRow[] = [];
const findings: Finding[] = [];
const verified: string[] = [];
const notCovered: string[] = [];
const timeline: string[] = [];

artifact.table("stages", {
  title: "部署阶段",
  columns: [
    { field: "stage", label: "阶段" },
    { field: "status", label: "状态" },
    { field: "detail", label: "细节" },
  ],
  key: "stage",
});

/** 记录一个阶段的看板行。 */
function stage(stageName: string, status: string, detail: string): void {
  const row: StageRow = { stage: stageName, status, detail };
  stages.push(row);
  report(row, "stages");
}

/** 记录一条 finding（看板之外也即时上报，失败时仍随通知送达）。 */
function addFinding(f: Finding): void {
  findings.push(f);
  report(f);
}

// —— 运行参数：远程目标与部署根都不写死，凭据全部走本机 ssh 配置。 ——
const sshTarget = String(args.sshTarget ?? "occult-pot").trim();
const remoteRoot = String(args.remoteRoot ?? "occult-pot-server").trim();
if (!/^[A-Za-z0-9@._-]+$/.test(sshTarget)) {
  return {
    conclusion: `sshTarget 参数不合法：${JSON.stringify(sshTarget)}（只允许字母、数字与 @ . _ - 组成的 ssh 别名或 user@host）。`,
    findings: [],
    verified: [],
    notCovered: ["全部——参数不合法"],
  } satisfies WorkflowReport;
}
if (!/^[A-Za-z0-9._/-]+$/.test(remoteRoot) || remoteRoot.startsWith("/") || remoteRoot.includes("..")) {
  return {
    conclusion: `remoteRoot 参数不合法：${JSON.stringify(remoteRoot)}（应为 $HOME 下的相对目录，如 occult-pot-server）。`,
    findings: [],
    verified: [],
    notCovered: ["全部——参数不合法"],
  } satisfies WorkflowReport;
}
const preferOfflineTests =
  args.preferOfflineTests === undefined ? true : String(args.preferOfflineTests) !== "false";

// —— 三阶段之间传递的状态 ——
let packOk = false;
let abortReason = "";
let localReady = false;
let localSkipReason = "";
let localState: EndState | null = null;
let localRun: LocalRun | null = null;
let localFailed = false;
let localFailure = "";
let localWaitRaw = "";
let localVerifyRaw = "";
let remoteReady = false;
let remoteSkipReason = "";
let remoteState: EndState | null = null;
let remoteRun: RemoteRun | null = null;
let remoteFailed = false;
let remoteFailure = "";
let remoteWaitRaw = "";
let remoteVerifyRaw = "";
let backupOk = false;
let backupTs = "";
let backupTagState = "";
let backupTagId = "";
let backupTarEntries = "";
let backupDetail = "";
let publicChecks: VerifyCheck[] = [];
let publicNote = "远程未部署或未完成验证，公网检查无对象";
let remotePort = "";
let expectedStamp = "";
let expectedSha = "";
let postSha = "";
let zipNames: string[] = [];
let sshOk = false;
let wslDistros: string[] = [];
let wslVersion = "";
let platform = "";
let nodeVersion = "";
let aliasHost = "";
let aliasPort = "";
let aliasUser = "";

phase("现状与构建");
const startedAt = await devNow();

// 0) 开发机环境。
const envProbe = await world.run(
  "node",
  ["-e", "console.log('PLATFORM='+process.platform);console.log('NODE='+process.version)"],
  { timeoutMs: 60000 },
);
platform = kvLine(clean(envProbe.stdout), "PLATFORM");
nodeVersion = kvLine(clean(envProbe.stdout), "NODE");
const isWindows = platform === "win32";

// 1) 远程 ssh：解析坐标（只读）并探测连通性。
try {
  const aliasRes = await world.run("ssh", ["-G", sshTarget], { timeoutMs: 60000 });
  aliasHost = spaceField(aliasRes.stdout, "hostname");
  aliasPort = spaceField(aliasRes.stdout, "port");
  aliasUser = spaceField(aliasRes.stdout, "user");
} catch {
  // 解析失败不致命：连通性探测会如实报告。
}
const ping = await runSsh(sshTarget, "echo SSH_OK", 120000);
sshOk = ping.ok && ping.output.includes("SSH_OK");
if (!sshOk) {
  remoteSkipReason = "ssh 连不通";
  addFinding({
    where: `远程 ${sshTarget}`,
    what: "ssh 目标连不通，远程阶段将整体跳过（本地构建与本地部署不受影响）",
    evidence: `ssh ${sshTarget} echo SSH_OK 未成功：${ping.output.slice(0, 500)}`,
    status: "verified",
    severity: "high",
  });
}
log(
  `远程连接目标：ssh ${sshTarget} → ${aliasUser === "" ? "?" : aliasUser}@${aliasHost === "" ? "?" : aliasHost}:${
    aliasPort === "" ? "?" : aliasPort
  }（${sshOk ? "连通" : "连不通"}）。`,
);

// 2) 本地 WSL 可用性（仅 Windows；非 Windows 视为不适用而跳过）。
if (isWindows) {
  let listOk = false;
  for (let round = 1; round <= 4; round += 1) {
    try {
      const res = await world.run("wsl.exe", ["-l", "-q"], { timeoutMs: 120000 });
      if (res.exitCode === 0) {
        wslDistros = clean(res.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter((s) => s !== "");
      }
    } catch {
      wslDistros = [];
    }
    if (wslDistros.length > 0) {
      listOk = true;
      break;
    }
    // 冷启动：直接调一次 bash 会按需拉起发行版，下一轮再列。
    await runWsl("sleep 2; true", 180000);
  }
  if (!listOk) {
    localSkipReason = "WSL 或发行版不可用";
  } else {
    let probed = false;
    for (let round = 1; round <= 4; round += 1) {
      const dockerProbe = await runWsl(
        round === 1 ? "docker info --format '{{.ServerVersion}}'" : "sleep 5; docker info --format '{{.ServerVersion}}'",
        180000,
      );
      if (dockerProbe.ok && dockerProbe.output.trim() !== "") {
        wslVersion = dockerProbe.output.trim().split("\n").pop() ?? "";
        probed = true;
        break;
      }
    }
    if (!probed) localSkipReason = "WSL 里 docker 不可用";
    else localReady = true;
  }
} else {
  localSkipReason = "本机不是 Windows，本地 WSL 部署不适用";
}

// 3) 本地部署根完整性（缺 compose 或 .env.deploy 就不部署本地）。
if (localReady) {
  const rootProbe = await runWsl(
    'D="$(pwd)/' +
      DEPLOY_REL +
      '"; if [ -f "$D/docker-compose.yml" ] && [ -f "$D/.env.deploy" ]; then echo LROOT=ok; else echo LROOT=missing; fi',
    120000,
  );
  if (!(rootProbe.ok && rootProbe.output.includes("LROOT=ok"))) {
    localReady = false;
    localSkipReason = "本地部署根不完整（缺 docker-compose.yml 或 .env.deploy）";
    addFinding({
      where: DEPLOY_REL,
      what: "本地 WSL 部署根不完整，本地阶段跳过",
      evidence: "检查 $(pwd)/packages/occult-pot-server/deploy 下的 docker-compose.yml 与 .env.deploy",
      status: "verified",
      severity: "medium",
    });
  }
}
if (localReady) log(`本地 WSL 就绪（发行版 ${wslDistros.join("、")}，docker ${wslVersion}）。`);
else log(`${localSkipReason}，本地阶段将跳过。`);

// 4) 两端现状快照（部署前）。
const localCd = 'cd "$(pwd)/' + DEPLOY_REL + '" || { echo ROOT=none; echo AT=$(date -u +%Y-%m-%dT%H:%M:%SZ); exit 0; }';
const localCdExec = 'cd "$(pwd)/' + DEPLOY_REL + '" || { echo FAIL=cd; exit 9; }';
const remoteCd = 'cd "$HOME/' + remoteRoot + '" || { echo ROOT=none; echo AT=$(date -u +%Y-%m-%dT%H:%M:%SZ); exit 0; }';
const remoteCdExec = 'cd "$HOME/' + remoteRoot + '" || { echo FAIL=cd; exit 9; }';

if (localReady) {
  const r = await runWsl(stateShell(localCd, false), 180000);
  localState = {
    current: kvLine(r.output, "CURRENT") || "none（栈未运行）",
    sha: kvLine(r.output, "PRE_SHA"),
    img: kvLine(r.output, "PRE_IMG_TAG"),
    runImg: kvLine(r.output, "PRE_IMG_RUN"),
    cont: kvLine(r.output, "PRE_CONT") || "none",
    contCreated: kvLine(r.output, "PRE_CREATED_UTC"),
    root: kvLine(r.output, "ROOT"),
    at: kvLine(r.output, "AT"),
    allPs: kvLine(r.output, "PRE_ALLPS"),
    imgCreatedRaw: kvLine(r.output, "PRE_IMG_CREATED"),
    layers: kvLine(r.output, "PRE_LAYERS"),
    cfgSha: kvLine(r.output, "PRE_CFG_SHA"),
    envjSha: kvLine(r.output, "PRE_ENVJ_SHA"),
    cmdjSha: kvLine(r.output, "PRE_CMDJ_SHA"),
    buildRef: kvLine(r.output, "PRE_BUILD_REF"),
    tagTime: kvLine(r.output, "PRE_TAG_TIME"),
    envStat: kvLine(r.output, "ENV_STAT"),
  };
}
if (sshOk) {
  const r = await runSsh(sshTarget, stateShell(remoteCd, true), 180000);
  remoteState = {
    current: kvLine(r.output, "CURRENT") || "none（栈未运行）",
    sha: kvLine(r.output, "PRE_SHA"),
    img: kvLine(r.output, "PRE_IMG_TAG"),
    runImg: kvLine(r.output, "PRE_IMG_RUN"),
    cont: kvLine(r.output, "PRE_CONT") || "none",
    contCreated: kvLine(r.output, "PRE_CREATED_UTC"),
    root: kvLine(r.output, "ROOT"),
    at: kvLine(r.output, "AT"),
    allPs: kvLine(r.output, "PRE_ALLPS"),
    imgCreatedRaw: kvLine(r.output, "PRE_IMG_CREATED"),
    layers: kvLine(r.output, "PRE_LAYERS"),
    cfgSha: kvLine(r.output, "PRE_CFG_SHA"),
    envjSha: kvLine(r.output, "PRE_ENVJ_SHA"),
    cmdjSha: kvLine(r.output, "PRE_CMDJ_SHA"),
    buildRef: kvLine(r.output, "PRE_BUILD_REF"),
    tagTime: kvLine(r.output, "PRE_TAG_TIME"),
    envStat: kvLine(r.output, "ENV_STAT"),
  };
}

// 5) 远程只读预检：sudo、部署根、unzip、对外端口、现有镜像。
if (sshOk) {
  const remotePre = await runSsh(
    sshTarget,
    [
      'cd "$HOME/' + remoteRoot + '" || { echo PRE_ROOT=no; exit 0; }',
      "echo PRE_ROOT=ok",
      "sudo -n true 2>/dev/null && echo PRE_SUDO=ok || echo PRE_SUDO=no",
      "command -v unzip >/dev/null && echo PRE_UNZIP=ok || echo PRE_UNZIP=no",
      ...composeInitLines(true),
      "P=$($COMPOSE port nginx 80 2>/dev/null | head -1); echo PRE_PORT=$P",
      "S=$(sudo docker images -q occult-pot-server:latest 2>/dev/null | head -1); [ -n \"$S\" ] && echo PRE_IMAGE=yes || echo PRE_IMAGE=no",
    ].join("\n"),
    180000,
  );
  const preRoot = kvLine(remotePre.output, "PRE_ROOT");
  const preSudo = kvLine(remotePre.output, "PRE_SUDO");
  const preUnzip = kvLine(remotePre.output, "PRE_UNZIP");
  if (preRoot === "ok" && preSudo === "ok" && preUnzip === "ok") {
    remoteReady = true;
  } else {
    remoteSkipReason = `远程预检未通过（部署根 ${preRoot === "ok" ? "ok" : "缺失"}，免密 sudo ${
      preSudo === "ok" ? "ok" : "不可用"
    }，unzip ${preUnzip === "ok" ? "ok" : "不可用"}）`;
    addFinding({
      where: `远程 ${sshTarget}`,
      what: "远程预检未通过，远程阶段跳过",
      evidence: remotePre.output.slice(0, 500),
      status: "verified",
      severity: "high",
    });
  }
} else if (remoteSkipReason === "") {
  remoteSkipReason = "ssh 不可达";
}

stage(
  "本地环境（WSL）",
  localReady ? "ok" : "skip",
  localReady
    ? `发行版 ${wslDistros.join("、")}，docker ${wslVersion}；当前版本 ${localState === null ? "未知" : localState.current}`
    : localSkipReason,
);
stage(
  "远程连通与预检",
  remoteReady ? "ok" : "fail",
  remoteReady
    ? `ssh ${sshTarget} 连通；当前版本 ${remoteState === null ? "未知" : remoteState.current}；免密 sudo 与 unzip 可用`
    : remoteSkipReason,
);

// 6) 门禁：format / lint / typecheck / test（+ 构建）。
const gateScripts = preferOfflineTests
  ? ["format:check", "lint", "typecheck", "test:unit"]
  : ["format:check", "lint", "typecheck", "test"];
const testCmds: Record<string, string> = {
  "test:unit": "vitest --run --passWithNoTests",
  test: "npm run test:unit && npm run test:redis && npm run test:live",
};
const fixer = agent(
  "门禁修复者",
  "你是 occult-pot-server 的维护者，负责把仓库门禁修到通过。" +
    "只允许修改 packages/occult-pot-server（必要时 tencent-doc-sdk 或其它被它依赖的包）里的源码与配置；" +
    "不要运行门禁命令——工作流会在你改完后统一重跑并判定；" +
    "不要读取、打印或修改任何 .env* 文件；如果诊断输出里出现疑似凭据（令牌、密码、密钥），不要复述它们；" +
    "如果某个门禁在你的能力范围内无法通过，如实说明并升级，不要绕过检查或伪造结果。",
);

let gateFailure = "";
let gateRoundUsed = 0;
const gateEvidence: string[] = [];
for (let round = 1; round <= 3; round += 1) {
  gateRoundUsed = round;
  const roundEvidence: string[] = [];
  let failedScript = "";
  for (const script of gateScripts) {
    const extra = testRunArgs(testCmds[script] ?? "");
    const outcome = await runRushx("packages/occult-pot-server", script, extra, 900000);
    if (!outcome.ok) {
      failedScript = script;
      gateFailure = `脚本 ${script} 失败：\n${outcome.output.slice(0, 4000)}`;
      break;
    }
    roundEvidence.push(`在 packages/occult-pot-server 内运行 node ../../common/scripts/install-run-rushx.js ${script} → 退出码 0`);
  }
  if (failedScript === "") {
    const build = await runRush(["build", "--to", "occult-pot-server"], 900000);
    if (build.ok) {
      roundEvidence.push("在仓库根运行 node common/scripts/install-run-rush.js build --to occult-pot-server → 退出码 0");
      gateEvidence.push(...roundEvidence);
      packOk = true;
      break;
    }
    gateFailure = `rush build --to occult-pot-server 失败（退出码非 0）：\n${build.output.slice(0, 4000)}`;
  }
  if (round < 3) {
    log(`门禁未过（第 ${round} 轮），交给修复者处理。`);
    await fixer.ask(`门禁未通过：\n${gateFailure}\n\n请定位并修复。修完说明改了什么。`);
  }
}
if (!packOk) {
  abortReason = `${gateRoundUsed} 轮内门禁未全部通过`;
  addFinding({
    where: "packages/occult-pot-server",
    what: "门禁未全部通过，未打包、未触碰任何服务器",
    evidence: gateFailure.slice(0, 2000),
    status: "verified",
    severity: "high",
  });
}

// 7) 打包并核对产物（同一份 dist 的四处副本：包内 dist、打包产物、两端容器内文件）。
if (packOk) {
  postSha = await readSha(PKG_DIST_REL);
  const deployOut = await runRush(
    [
      "deploy",
      "--scenario",
      "occult-pot-server",
      "--target-folder",
      "packages/occult-pot-server/deploy/server",
      "--overwrite",
      "--create-archive",
      "../occult-pot-server.zip",
    ],
    300000,
  );
  if (!deployOut.ok) {
    packOk = false;
    abortReason = "rush deploy 失败";
    addFinding({
      where: "打包",
      what: "rush deploy 失败，未生成部署产物",
      evidence: deployOut.output.slice(0, 2000),
      status: "verified",
      severity: "high",
    });
  } else {
    zipNames = await listZipEntries(ZIP_REL);
    const riskyNames = zipNames.filter((n) => /\.env|secret|token|password|credential|\.local/i.test(n));
    expectedStamp = await readStamp(SERVER_DIST_REL);
    expectedSha = await readSha(SERVER_DIST_REL);
    if (zipNames.length === 0) {
      packOk = false;
      abortReason = "部署产物 zip 不可读";
      addFinding({
        where: ZIP_REL,
        what: "压缩包不可读，无法确认产物内容",
        evidence: "zip 中央目录未读出任何条目",
        status: "verified",
        severity: "high",
      });
    } else if (riskyNames.length > 0) {
      packOk = false;
      abortReason = "产物内出现疑似凭据文件名";
      addFinding({
        where: ZIP_REL,
        what: "按文件名模式筛检出疑似凭据文件，停止部署",
        evidence: `可疑条目：${JSON.stringify(riskyNames).slice(0, 500)}`,
        status: "verified",
        severity: "high",
      });
    } else if (expectedStamp === "" || expectedSha === "") {
      packOk = false;
      abortReason = "打包产物无法解析构建标识";
      addFinding({
        where: SERVER_DIST_REL,
        what: "无法从打包产物读出构建标识或哈希，无法判定部署是否生效",
        evidence: `STAMP=${expectedStamp} SHA=${expectedSha.slice(0, 12)}`,
        status: "verified",
        severity: "high",
      });
    } else if (postSha !== "" && postSha !== expectedSha) {
      packOk = false;
      abortReason = "打包产物与包构建产物不一致";
      addFinding({
        where: SERVER_DIST_REL,
        what: "打包产物里的 dist 与包自身构建产物的 sha256 不一致",
        evidence: `包内 ${postSha.slice(0, 16)}… ≠ 打包产物 ${expectedSha.slice(0, 16)}…`,
        status: "verified",
        severity: "high",
      });
    } else {
      gateEvidence.push(
        "在仓库根运行 node common/scripts/install-run-rush.js deploy --scenario occult-pot-server --target-folder packages/occult-pot-server/deploy/server --overwrite --create-archive ../occult-pot-server.zip → 退出码 0",
      );
    }
    if (packOk) {
      timeline.push(
        `构建与打包完成（开发机 ${await devNow()}）：dist sha256 ${expectedSha.slice(0, 16)}…；zip ${ZIP_REL}（${zipNames.length} 个条目）`,
      );
    }
  }
}
verified.push(...gateEvidence);
if (packOk) {
  log(`打包完成：构建标识 ${expectedStamp}，dist sha256 ${expectedSha.slice(0, 12)}…。`);
  stage("构建与打包", "ok", `${gateScripts.join(" / ")} 与 rush build 通过；${zipNames.length} 个条目，标识 ${expectedStamp}`);
} else {
  stage("构建与打包", "fail", abortReason === "" ? "未通过" : abortReason);
}

// 8) 提交信息（用于解释标识与提交的关系，只读）。
// 这里的几个读数回答一个关键问题：这条 dist 是否与当前源码一致（rush build 命中缓存时标识会滞后于 HEAD）。
let distMtime = "";
let pkgCommitsSinceStamp = -1;

/** 记录两次 git 读取的时刻，供报告说明 HEAD 变化发生在何时。 */
let headAtPack = "";
let headAtReport = "";
let headFull = "";
let headDate = "";
let stampFull = "";
let stampSubject = "";
let stampDate = "";
let dirtyList: string[] = [];
try {
  const headRes = await world.run("git", ["rev-parse", "HEAD"], { timeoutMs: 60000 });
  headFull = clean(headRes.stdout).trim();
  headAtPack = await devNow();
  const headDateRes = await world.run("git", ["show", "-s", "--format=%ci", "HEAD"], { timeoutMs: 60000 });
  headDate = clean(headDateRes.stdout).trim();
} catch {
  headFull = "";
  headDate = "";
}
const stampSha = /\(([0-9a-f]{7,40})\)/.exec(expectedStamp);
if (stampSha !== null) {
  try {
    const res = await world.run("git", ["show", "-s", "--format=%H%n%ci%n%s", stampSha[1] + "^{commit}"], { timeoutMs: 60000 });
    const lines = clean(res.stdout).trim().split("\n");
    if (res.exitCode === 0 && lines.length >= 3) {
      stampFull = lines[0];
      stampDate = lines[1];
      stampSubject = lines[2];
    }
  } catch {
    stampFull = "";
  }
}
let trackedEnvFiles: string[] = [];
try {
  const lsRes = await world.run("git", ["ls-files", "--", DEPLOY_REL], { timeoutMs: 60000 });
  trackedEnvFiles = clean(lsRes.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "" && /(^|\/)\.env/.test(l) && !l.endsWith(".gitignore"))
    .map((l) => l.split("/").pop() ?? l);
} catch {
  trackedEnvFiles = [];
}
try {
  const mt = await world.run("node", ["-e", "const fs=require('fs');console.log('MT='+fs.statSync(process.argv[1]).mtime.toISOString())", PKG_DIST_REL], { timeoutMs: 60000 });
  distMtime = kvLine(clean(mt.stdout), "MT");
} catch {
  distMtime = "";
}
const stampForLog = /^v[^(]+\(([0-9a-f]{7,40})\)$/.exec(expectedStamp);
if (stampForLog !== null) {
  try {
    const lg = await world.run("git", ["log", "--oneline", stampForLog[1] + "..HEAD", "--", "packages/occult-pot-server"], { timeoutMs: 60000 });
    pkgCommitsSinceStamp = clean(lg.stdout).split("\n").filter((l) => l.trim() !== "").length;
  } catch {
    pkgCommitsSinceStamp = -1;
  }
}
try {
  const st = await world.run("git", ["status", "--porcelain"], { timeoutMs: 60000 });
  dirtyList = clean(st.stdout)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
} catch {
  dirtyList = [];
}

phase("本地 WSL 部署");
if (!packOk) {
  stage("本地 WSL 部署", "skip", `未执行（${abortReason}）`);
  notCovered.push(`本地 WSL 部署未执行：${abortReason}`);
} else if (!localReady) {
  stage("本地 WSL 部署", "skip", localSkipReason);
  notCovered.push(`本地 WSL 部署跳过：${localSkipReason}（构建与远程阶段不受影响）`);
} else {
  const localTroubleshooter = agent(
    "本地部署排障员",
    "你是 occult-pot-server 的本地 WSL 部署排障者，目标是让本地容器栈部署成功并通过验证。" +
      "可以在仓库内修改与部署相关的源码或配置（例如 deploy/ 下的 compose、Dockerfile、nginx 配置），" +
      "也可以运行只读诊断命令；不要读取、打印或修改任何 .env* 文件，不要删除部署目录里的文件；" +
      "如果诊断输出里出现疑似凭据（令牌、密码、密钥），不要复述它们；" +
      "如判断是环境问题而无法修复，如实说明并升级，不要伪造结果。",
  );
  const localDeployShell = [
    localCdExec,
    ...composeInitLines(false),
    "LTS=$(date -u +%Y%m%dT%H%M%SZ)",
    // 留底要留运行实例正在用的镜像：latest 可能已经领先于运行容器（上一次部署没重建容器时就会这样）。
    'LS=$($DKR image inspect --format "{{.Id}}" occult-pot-server:latest 2>/dev/null | head -1)',
    'CID0=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
    'RUN0=""',
    '[ -n "$CID0" ] && RUN0=$($DKR inspect --format "{{.Image}}" "$CID0" 2>/dev/null)',
    'BAK=""',
    '[ -n "$RUN0" ] && BAK=$($DKR image inspect --format "{{.Id}}" "$RUN0" 2>/dev/null | head -1)',
    'TAG_SRC=running',
    'if [ -z "$BAK" ]; then BAK=$LS; TAG_SRC=latest; fi',
    'if [ -z "$BAK" ]; then TAG_SRC=none; fi',
    'if [ -n "$BAK" ]; then $DKR tag "$BAK" "occult-pot-server:pre-deploy-$LTS" && echo TAG=ok || echo TAG=fail; else echo TAG=none; fi',
    'echo TAG_ID=$($DKR image inspect --format "{{.Id}}" "occult-pot-server:pre-deploy-$LTS" 2>/dev/null | head -1)',
    "echo TAG_SRC=$TAG_SRC",
    "echo TS=$LTS",
    "$DKR images occult-pot-server --format '{{.Tag}}' | grep '^pre-deploy-' | tail -n +6 | while read t; do $DKR rmi \"occult-pot-server:$t\" >/dev/null 2>&1; done",
    "rm -rf server && mkdir -p server",
    "python3 -m zipfile -e occult-pot-server.zip server/ || { echo FAIL=unzip; exit 9; }",
    "echo UNZIP=ok",
    "$COMPOSE up -d --build || { echo FAIL=up; exit 9; }",
    // 关键一步：确认运行中的容器确实切到了本次构建的镜像；没切就强制重建该服务（只动应用容器，不碰其它服务）。
    // 判定键分两个：SWAP_FIRST 记首次 up 的结果，SWAP_RESULT 记最终结果（避免同名键先后出现时被读成第一个值）。
    // 同时打印首次 up 之后的原始读数（容器 .Image 与 latest .Id、容器创建时间），作为该中间状态的外部证据。
    'LI=$($DKR image inspect --format "{{.Id}}" occult-pot-server:latest 2>/dev/null | head -1)',
    'CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
    'RI=""',
    '[ -n "$CID" ] && RI=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)',
    'echo FIRST_UP_LATEST=$LI',
    'echo FIRST_UP_CONTAINER_IMAGE=$RI',
    'echo FIRST_UP_CONTAINER_CREATED=$($DKR inspect --format "{{.Created}}" "$CID" 2>/dev/null)',
    'if [ -z "$LI" ] || [ -z "$RI" ]; then echo SWAP_FIRST=unknown; echo SWAP_RESULT=unknown; echo FAIL=swap-unknown; exit 9; fi',
    'if [ "$RI" = "$LI" ]; then echo SWAP_FIRST=ok; echo SWAP_RESULT=first; else',
    '  echo SWAP_FIRST=needed',
    '  echo SWAP_PRE=$RI',
    "  $COMPOSE up -d --force-recreate --no-deps occult-pot-server || { echo SWAP_RESULT=fail; echo FAIL=recreate; exit 9; }",
    '  CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
    '  RI=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)',
    '  if [ "$RI" = "$LI" ]; then echo SWAP_RESULT=forced; else echo SWAP_RESULT=fail; echo FAIL=swap; exit 9; fi',
    'fi',
    "echo UP_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "echo UP=ok",
  ].join("\n");
  const localWaitShell = [
    localCdExec,
    ...composeInitLines(false),
    "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
    "P=$($COMPOSE port nginx 80 2>/dev/null | head -1); PORT=${P##*:}",
    "H=$($COMPOSE exec -T nginx wget -qO- http://occult-pot-server:3000/healthz 2>/dev/null)",
    "V=$(printf %s \"$H\" | grep -o '\"version\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
    "curl -s -o /dev/null -m 20 \"http://127.0.0.1:$PORT/api/v1/pots\"",
    "R=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \"http://127.0.0.1:$PORT/readyz\")",
    'HST=$($DKR inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" "$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)" 2>/dev/null)',
    `echo "TRY=$i STAMP=$V READYZ=$R HEALTH=$HST"`,
    `if [ "$V" = ${JSON.stringify(expectedStamp)} ] && [ "$R" = "200" ] && { [ "$HST" = "healthy" ] || [ "$HST" = "none" ]; }; then echo WAIT=ok; break; fi`,
    "sleep 5",
    "done",
  ].join("\n");

  for (let round = 1; round <= 3; round += 1) {
    const deployStep = await runWsl(localDeployShell, 900000);
    if (deployStep.ok && deployStep.output.includes("UP=ok")) {
      const waitStep = await runWsl(localWaitShell, 600000);
      localWaitRaw = waitStep.output;
      if (waitStep.output.includes("WAIT=ok")) {
        const verifyStep = await runWsl(verifyShell(localCdExec, false), 300000);
        localVerifyRaw = verifyStep.output;
        const parsed = parseVerify(verifyStep.output, expectedStamp, expectedSha);
        if (parsed.ok) {
          localRun = {
            checks: parsed,
            upAt: kvLine(deployStep.output, "UP_AT"),
            verifyAt: `${kvLine(verifyStep.output, "AT_START")} → ${kvLine(verifyStep.output, "AT_END")}`,
            tagTs: kvLine(deployStep.output, "TS"),
            tagState: kvLine(deployStep.output, "TAG"),
            tagId: kvLine(deployStep.output, "TAG_ID"),
            preAllPs: localState === null ? "" : localState.allPs,
            postAllPs: kvLine(verifyStep.output, "ALLPS"),
            composeCmd: kvLine(verifyStep.output, "COMPOSE_CMD"),
            root: kvLine(verifyStep.output, "ROOT"),
            post: {
              latestImg: kvLine(verifyStep.output, "IMG_TAG"),
              runImg: kvLine(verifyStep.output, "IMG_RUN"),
              imgCreated: kvLine(verifyStep.output, "IMG_TAG_CREATED_UTC") || kvLine(verifyStep.output, "IMG_TAG_CREATED"),
              contCreated: kvLine(verifyStep.output, "CREATED_UTC"),
              upImg: kvLine(deployStep.output, "SWAP_PRE"),
              swap: kvLine(deployStep.output, "SWAP_RESULT"),
              swapFirst: kvLine(deployStep.output, "SWAP_FIRST"),
              cont: kvLine(verifyStep.output, "CONT"),
              allPs: kvLine(verifyStep.output, "ALLPS"),
              layers: kvLine(verifyStep.output, "LAYERS"),
              cfgSha: kvLine(verifyStep.output, "CFG_SHA"),
              envjSha: kvLine(verifyStep.output, "ENVJ_SHA"),
              cmdjSha: kvLine(verifyStep.output, "CMDJ_SHA"),
              buildRef: kvLine(verifyStep.output, "BUILD_REF"),
              tagTime: kvLine(verifyStep.output, "TAG_TIME"),
              health: kvLine(verifyStep.output, "HST"),
              sha: kvLine(verifyStep.output, "SHA"),
              envStat: kvLine(verifyStep.output, "ENV_STAT"),
            },
          };
          break;
        }
        localFailure = `部署已启动但验证未通过：\n${verifyStep.output.slice(0, 3000)}`;
      } else {
        localFailure = `容器未就绪（等待健康超时）：\n${waitStep.output.slice(0, 3000)}`;
      }
    } else {
      localFailure = `部署命令失败：\n${deployStep.output.slice(0, 3000)}`;
    }
    if (round < 3) {
      log(`本地部署第 ${round} 轮未过，交给排障员处理。`);
      const diagnosis = await localTroubleshooter.ask(
        `本地 WSL 部署失败：\n${localFailure}\n\n请诊断；若能在仓库内修复，直接修改并说明改了什么；不能则说明原因。`,
      );
      if (diagnosis.trim() !== "") {
        localFailure = localFailure + "\n排障说明：" + diagnosis.slice(0, 1500);
      }
    }
  }

  if (localRun === null) {
    localFailed = true;
    const failedChecks =
      localFailure.trim() === "" ? ["（没有可读的失败信息）"] : [localFailure.slice(0, 1500)];
    addFinding({
      where: "本地 WSL",
      what: "本地部署未通过验证，按先本地后远程的顺序不再部署远程",
      evidence: failedChecks.join("；").slice(0, 2000),
      status: "verified",
      severity: "high",
    });
    stage("本地 WSL 部署", "fail", "验证未通过，远程阶段不再执行");
    notCovered.push("远程备份与部署未执行（先本地后远程：本地验证未通过）");
  } else {
    const c = countChecks(localRun.checks);
    verified.push(
      `本地 WSL：${c.pass} 项通过${c.na > 0 ? `、${c.na} 项不适用` : ""}（运行容器已确认使用 latest=${shortId(localRun.post.runImg.replace(/^sha256:/, ""))}；应用层 /metrics=200、/api/v1=404；nginx 层 404 由兜底；容器内 dist sha256 与打包产物一致）`,
    );
    if (localRun.post.swap === "forced") {
      addFinding({
        where: "本地 WSL",
        what: "首次 docker compose up -d --build 未把容器切到新镜像，改用 --force-recreate 重建应用容器后才完成切换",
        evidence:
          `首次 up 后容器仍在使用 ${shortId(localRun.post.upImg.replace(/^sha256:/, ""))}，latest 已是 ${shortId(localRun.post.latestImg.replace(/^sha256:/, ""))}；执行 up -d --force-recreate --no-deps occult-pot-server 后一致（SWAP=forced）`,
        status: "verified",
        severity: "low",
      });
    }
    stage(
      "本地 WSL 部署",
      "ok",
      `验证通过：通过 ${c.pass} 项${c.na > 0 ? `，不适用 ${c.na} 项` : ""}；镜像切换 ${localRun.post.swap === "forced" ? "首次 up 未切换，--force-recreate 完成" : "首次 up 即完成"}`,
    );
    timeline.push(
      `本地 WSL：compose up 完成 ${localRun.upAt}；验证脚本 ${localRun.verifyAt}（部署根 ${localRun.root}；镜像切换 SWAP_RESULT=${localRun.post.swap === "" ? "缺失" : localRun.post.swap}）`,
    );
    log(`本地 WSL 部署完成：${c.pass} 项通过${c.na > 0 ? `，${c.na} 项不适用` : ""}。`);
  }
}

phase("远程备份、部署与检查");
if (!packOk) {
  stage("远程备份", "skip", `未执行（${abortReason}）`);
  stage("远程部署与验证", "skip", `未执行（${abortReason}）`);
  stage("公网检查", "skip", `未执行（${abortReason}）`);
  notCovered.push("远程备份与部署未执行（构建未通过）");
} else if (localFailed) {
  stage("远程备份", "skip", "本地验证未通过，按先本地后远程的顺序未执行");
  stage("远程部署与验证", "skip", "本地验证未通过，按先本地后远程的顺序未执行");
  stage("公网检查", "skip", "远程未部署，公网检查无对象");
} else if (!remoteReady) {
  const reason = remoteSkipReason === "" ? "远程不可用" : remoteSkipReason;
  stage("远程备份", "skip", reason);
  stage("远程部署与验证", "skip", reason);
  stage("公网检查", "skip", reason);
  notCovered.push(`远程备份、部署与公网检查未执行：${reason}`);
} else {
  const backupShell = [
    'cd "$HOME/' + remoteRoot + '" || { echo FAIL=cd; exit 9; }',
    ...composeInitLines(true),
    "TS=$(date -u +%Y%m%dT%H%M%SZ)",
    "mkdir -p backups",
    'FILES=""',
    'for f in docker-compose.yml Dockerfile nginx stats fail2ban logrotate; do [ -e "$f" ] && FILES="$FILES $f"; done',
    'tar -czf "backups/config-$TS.tar.gz" $FILES 2>/dev/null',
    'test -s "backups/config-$TS.tar.gz" && echo TAR=ok || echo TAR=fail',
    "echo TS=$TS",
    // 留底要留运行实例正在用的镜像：latest 可能已经领先于运行容器（上一次部署没重建容器时就会这样）。
    'LS=$($DKR image inspect --format "{{.Id}}" occult-pot-server:latest 2>/dev/null | head -1)',
    'CID0=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
    'RUN0=""',
    '[ -n "$CID0" ] && RUN0=$($DKR inspect --format "{{.Image}}" "$CID0" 2>/dev/null)',
    'BAK=""',
    '[ -n "$RUN0" ] && BAK=$($DKR image inspect --format "{{.Id}}" "$RUN0" 2>/dev/null | head -1)',
    'if [ -z "$BAK" ]; then BAK=$LS; fi',
    'if [ -n "$BAK" ]; then $DKR tag "$BAK" "occult-pot-server:pre-deploy-$TS" && echo TAG=ok || echo TAG=fail; else echo TAG=none; fi',
    'echo TAG_ID=$($DKR image inspect --format "{{.Id}}" "occult-pot-server:pre-deploy-$TS" 2>/dev/null | head -1)',
    'echo TAR_ENTRIES="$(tar -tzf "backups/config-$TS.tar.gz" 2>/dev/null | head -40 | tr "\n" ";")"',
    "ls -1t backups/config-*.tar.gz 2>/dev/null | tail -n +6 | xargs -r rm -f",
    "$DKR images occult-pot-server --format '{{.Tag}}' | grep '^pre-deploy-' | tail -n +6 | while read t; do $DKR rmi \"occult-pot-server:$t\" >/dev/null 2>&1; done",
  ].join("\n");

  for (let round = 1; round <= 2; round += 1) {
    const backupStep = await runSsh(sshTarget, backupShell, 300000);
    const tarState = kvLine(backupStep.output, "TAR");
    const tagState = kvLine(backupStep.output, "TAG");
    backupTs = kvLine(backupStep.output, "TS");
    if (tarState === "ok" && (tagState === "ok" || tagState === "none")) {
      backupOk = true;
      backupTagState = tagState;
      backupTagId = kvLine(backupStep.output, "TAG_ID");
      backupTarEntries = kvLine(backupStep.output, "TAR_ENTRIES");
      break;
    }
    backupDetail = backupStep.output.slice(0, 800);
  }
  if (!backupOk) {
    remoteFailed = true;
    addFinding({
      where: `远程 ${sshTarget}`,
      what: "备份未成功，按先备份后覆盖的原则未部署远程",
      evidence: backupDetail.slice(0, 1500),
      status: "verified",
      severity: "high",
    });
    stage("远程备份", "fail", "备份失败，未部署远程");
    stage("远程部署与验证", "skip", "备份未成功，服务器保持原状");
    stage("公网检查", "skip", "远程未部署，公网检查无对象");
    notCovered.push("远程部署未执行（备份未成功）");
  } else {
    stage("远程备份", "ok", `config-${backupTs}.tar.gz；镜像留底 ${backupTagState}`);
    log(`远程已备份：配置快照 config-${backupTs}.tar.gz，镜像留底状态 ${backupTagState}。`);

    const remoteDeployShell = [
      remoteCdExec,
      "test -s occult-pot-server.zip || { echo FAIL=upload; exit 9; }",
      "rm -rf server && mkdir -p server",
      "unzip -oq occult-pot-server.zip -d server || { echo FAIL=unzip; exit 9; }",
      "echo UNZIP=ok",
      ...composeInitLines(true),
      "$COMPOSE up -d --build || { echo FAIL=up; exit 9; }",
      // 关键一步：确认运行中的容器确实切到了本次构建的镜像；没切就强制重建该服务（只动应用容器，不碰其它服务）。
      // 判定键分两个：SWAP_FIRST 记首次 up 的结果，SWAP_RESULT 记最终结果（避免同名键先后出现时被读成第一个值）。
      'LI=$($DKR image inspect --format "{{.Id}}" occult-pot-server:latest 2>/dev/null | head -1)',
      'CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
      'RI=""',
      '[ -n "$CID" ] && RI=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)',
      'echo FIRST_UP_LATEST=$LI',
      'echo FIRST_UP_CONTAINER_IMAGE=$RI',
      'echo FIRST_UP_CONTAINER_CREATED=$($DKR inspect --format "{{.Created}}" "$CID" 2>/dev/null)',
      'if [ -z "$LI" ] || [ -z "$RI" ]; then echo SWAP_FIRST=unknown; echo SWAP_RESULT=unknown; echo FAIL=swap-unknown; exit 9; fi',
      'if [ "$RI" = "$LI" ]; then echo SWAP_FIRST=ok; echo SWAP_RESULT=first; else',
      '  echo SWAP_FIRST=needed',
      '  echo SWAP_PRE=$RI',
      "  $COMPOSE up -d --force-recreate --no-deps occult-pot-server || { echo SWAP_RESULT=fail; echo FAIL=recreate; exit 9; }",
      '  CID=$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)',
      '  RI=$($DKR inspect --format "{{.Image}}" "$CID" 2>/dev/null)',
      '  if [ "$RI" = "$LI" ]; then echo SWAP_RESULT=forced; else echo SWAP_RESULT=fail; echo FAIL=swap; exit 9; fi',
      'fi',
      "echo UP_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)",
      "echo UP=ok",
    ].join("\n");
    const remoteWaitShell = [
      remoteCdExec,
      ...composeInitLines(true),
      "for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do",
      "P=$($COMPOSE port nginx 80 2>/dev/null | head -1); PORT=${P##*:}",
      "H=$($COMPOSE exec -T nginx wget -qO- http://occult-pot-server:3000/healthz 2>/dev/null)",
      "V=$(printf %s \"$H\" | grep -o '\"version\":\"[^\"]*\"' | head -1 | cut -d'\"' -f4)",
      "curl -s -o /dev/null -m 20 \"http://127.0.0.1:$PORT/api/v1/pots\"",
      "R=$(curl -s -o /dev/null -w '%{http_code}' -m 10 \"http://127.0.0.1:$PORT/readyz\")",
      'HST=$($DKR inspect --format "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" "$($COMPOSE ps -q occult-pot-server 2>/dev/null | head -1)" 2>/dev/null)',
      `echo "TRY=$i STAMP=$V READYZ=$R HEALTH=$HST"`,
      `if [ "$V" = ${JSON.stringify(expectedStamp)} ] && [ "$R" = "200" ] && { [ "$HST" = "healthy" ] || [ "$HST" = "none" ]; }; then echo WAIT=ok; break; fi`,
      "sleep 5",
      "done",
    ].join("\n");
    const remoteTroubleshooter = agent(
      "远程部署排障员",
      "你是 occult-pot-server 的远程部署排障者，目标是让远程服务器上的容器栈部署成功并通过验证。" +
        "可以在服务器上运行只读诊断命令并重试部署命令（compose up -d --build 等）；" +
        "不要读取、打印或转存任何 .env* 文件的内容，不要删除 backups/ 下的文件，不要动仓库里的 .env* 文件；" +
        "如果诊断输出里出现疑似凭据（令牌、密码、密钥），不要复述它们；" +
        "如判断无法修复，如实说明并升级，不要伪造结果。",
    );

    for (let round = 1; round <= 3; round += 1) {
      let scpOk = false;
      try {
        const scpStep = await world.run("scp", [...SSH_OPTS, ZIP_REL, `${sshTarget}:${remoteRoot}/occult-pot-server.zip`], {
          timeoutMs: 300000,
        });
        scpOk = scpStep.exitCode === 0;
        if (!scpOk) remoteFailure = `上传失败：${clip(clean(scpStep.stdout + "\n" + scpStep.stderr)).slice(0, 1000)}`;
      } catch (e) {
        remoteFailure = "上传未能完成：" + String(e).slice(0, 300);
      }
      if (scpOk) {
        const deployStep = await runSsh(sshTarget, remoteDeployShell, 900000);
        if (deployStep.ok && deployStep.output.includes("UP=ok")) {
          const waitStep = await runSsh(sshTarget, remoteWaitShell, 600000);
          remoteWaitRaw = waitStep.output;
          if (waitStep.output.includes("WAIT=ok")) {
            const verifyStep = await runSsh(sshTarget, verifyShell(remoteCdExec, true), 300000);
            remoteVerifyRaw = verifyStep.output;
            const parsed = parseVerify(verifyStep.output, expectedStamp, expectedSha);
            remotePort = kvLine(verifyStep.output, "PORT");
            if (parsed.ok) {
              remoteRun = {
                checks: parsed,
                upAt: kvLine(deployStep.output, "UP_AT"),
                verifyAt: `${kvLine(verifyStep.output, "AT_START")} → ${kvLine(verifyStep.output, "AT_END")}`,
                port: remotePort,
                preAllPs: remoteState === null ? "" : remoteState.allPs,
                postAllPs: kvLine(verifyStep.output, "ALLPS"),
                composeCmd: kvLine(verifyStep.output, "COMPOSE_CMD"),
                post: {
                  latestImg: kvLine(verifyStep.output, "IMG_TAG"),
                  runImg: kvLine(verifyStep.output, "IMG_RUN"),
                  imgCreated: kvLine(verifyStep.output, "IMG_TAG_CREATED_UTC") || kvLine(verifyStep.output, "IMG_TAG_CREATED"),
                  contCreated: kvLine(verifyStep.output, "CREATED_UTC"),
                  upImg: kvLine(deployStep.output, "SWAP_PRE"),
                  swap: kvLine(deployStep.output, "SWAP_RESULT"),
                  swapFirst: kvLine(deployStep.output, "SWAP_FIRST"),
                  cont: kvLine(verifyStep.output, "CONT"),
                  allPs: kvLine(verifyStep.output, "ALLPS"),
                  layers: kvLine(verifyStep.output, "LAYERS"),
                  cfgSha: kvLine(verifyStep.output, "CFG_SHA"),
                  envjSha: kvLine(verifyStep.output, "ENVJ_SHA"),
                  cmdjSha: kvLine(verifyStep.output, "CMDJ_SHA"),
                  buildRef: kvLine(verifyStep.output, "BUILD_REF"),
                  tagTime: kvLine(verifyStep.output, "TAG_TIME"),
                  health: kvLine(verifyStep.output, "HST"),
                  sha: kvLine(verifyStep.output, "SHA"),
                  envStat: kvLine(verifyStep.output, "ENV_STAT"),
                },
              };
              break;
            }
            remoteFailure = `部署已启动但验证未通过：\n${verifyStep.output.slice(0, 3000)}`;
          } else {
            remoteFailure = `容器未就绪（等待健康超时）：\n${waitStep.output.slice(0, 3000)}`;
          }
        } else {
          remoteFailure = `部署命令失败：\n${deployStep.output.slice(0, 3000)}`;
        }
      }
      if (round < 3) {
        log(`远程部署第 ${round} 轮未过，交给排障员处理。`);
        const diagnosis = await remoteTroubleshooter.ask(
          `远程部署失败：\n${remoteFailure}\n\n请诊断；能修复就直接处理并说明；不能则说明原因。`,
        );
        if (diagnosis.trim() !== "") {
          remoteFailure = remoteFailure + "\n排障说明：" + diagnosis.slice(0, 1500);
        }
      }
    }

    if (remoteRun === null) {
      remoteFailed = true;
      addFinding({
        where: `远程 ${sshTarget}`,
        what: "远程部署未通过验证",
        evidence: remoteFailure.slice(0, 2000),
        status: "verified",
        severity: "high",
      });
      stage("远程部署与验证", "fail", "验证未通过");
      stage("公网检查", "skip", "远程验证未通过，公网检查无对象");
      notCovered.push("远程验证未全部完成（见 findings）");
    } else {
      const c = countChecks(remoteRun.checks);
      verified.push(
        `远程服务器：${c.pass} 项通过（运行容器已确认使用 latest=${shortId(remoteRun.post.runImg.replace(/^sha256:/, ""))}；应用层 /metrics=200、/api/v1=404；nginx 层 404 由兜底；容器内 dist sha256 与打包产物一致）`,
      );
      if (remoteRun.post.swap === "forced") {
        addFinding({
          where: `远程 ${sshTarget}`,
          what: "首次 docker compose up -d --build 未把容器切到新镜像，改用 --force-recreate 重建应用容器后才完成切换",
          evidence:
            `首次 up 后容器仍在使用 ${shortId(remoteRun.post.upImg.replace(/^sha256:/, ""))}，latest 已是 ${shortId(remoteRun.post.latestImg.replace(/^sha256:/, ""))}；执行 up -d --force-recreate --no-deps occult-pot-server 后一致（SWAP=forced）`,
          status: "verified",
          severity: "low",
        });
      }
      stage(
        "远程部署与验证",
        "ok",
        `验证通过：通过 ${c.pass} 项；镜像切换 ${remoteRun.post.swap === "forced" ? "首次 up 未切换，--force-recreate 完成" : "首次 up 即完成"}`,
      );
      timeline.push(
        `远程：compose up 完成 ${remoteRun.upAt}；验证脚本 ${remoteRun.verifyAt}（对外端口 ${remoteRun.port}；镜像切换 SWAP_RESULT=${remoteRun.post.swap === "" ? "缺失" : remoteRun.post.swap}）`,
      );
      log(`远程部署完成：${c.pass} 项通过。`);

      // 公网检查：从开发机直连远程对外端口；每条请求各记一次发起时刻。
      publicChecks = [];
      if (aliasHost !== "" && remoteRun.port !== "") {
        const PUBLIC_CODE = [
          "(async()=>{",
          "const [a,b]=process.argv.slice(1);",
          "const one=async(k,u)=>{const at=new Date().toISOString();let code='000';",
          "try{const r=await fetch(u,{signal:AbortSignal.timeout(15000),redirect:'manual'});code=String(r.status)}catch(e){code='000'}",
          "console.log(k+'='+code);console.log(k+'_AT='+at)};",
          "await one('READY',a);await one('HEALTHZ',b);",
          "})()",
        ].join("");
        let readyCode = "000";
        let healthCode = "000";
        let readyAt = "";
        let healthAt = "";
        try {
          const pub = await world.run(
            "node",
            [
              "-e",
              PUBLIC_CODE,
              `http://${aliasHost}:${remoteRun.port}/readyz`,
              `http://${aliasHost}:${remoteRun.port}/healthz`,
            ],
            { timeoutMs: 90000 },
          );
          const out = clean(pub.stdout);
          readyCode = kvLine(out, "READY") || "000";
          healthCode = kvLine(out, "HEALTHZ") || "000";
          readyAt = kvLine(out, "READY_AT");
          healthAt = kvLine(out, "HEALTHZ_AT");
        } catch {
          // 保持 000，下面按不通过记录。
        }
        publicChecks.push({
          name: `GET http://${aliasHost}:${remoteRun.port}/readyz（开发机 node fetch 公网直连；请求到达 nginx 并转发到应用；发起时刻 ${readyAt} UTC）`,
          layer: "nginx：转发到应用",
          expected: "200",
          actual: readyCode,
          result: readyCode === "200" ? "pass" : "fail",
        });
        publicChecks.push({
          name: `GET http://${aliasHost}:${remoteRun.port}/healthz（开发机 node fetch 公网直连；到达 nginx 后被兜底 404，nginx 有意不转发；发起时刻 ${healthAt} UTC）`,
          layer: "nginx：不转发；404 由兜底 location 返回",
          expected: "404",
          actual: healthCode,
          result: healthCode === "404" ? "pass" : "fail",
        });
        publicNote = `/readyz=${readyCode}（${readyAt} UTC），/healthz=${healthCode}（${healthAt} UTC）`;
        timeline.push(`公网检查：/readyz ${readyAt} UTC；/healthz ${healthAt} UTC（开发机 node fetch）`);
        if (publicChecks.every((c) => c.result === "pass")) {
          verified.push(
            `公网可达：http://${aliasHost}:${remoteRun.port}/readyz 返回 200（/healthz 404，由 nginx 兜底）`,
          );
          stage("公网检查", "ok", publicNote);
        } else {
          addFinding({
            where: "公网可达性",
            what: "从开发机访问远程对外端口的检查与预期不符（可能受本机网络环境或云安全组影响）",
            evidence: publicChecks.map((c) => `${c.name} → ${c.actual}（期望 ${c.expected}）`).join("；").slice(0, 1500),
            status: "unconfirmed",
            severity: "low",
          });
          stage("公网检查", "fail", publicNote);
        }
      } else {
        publicNote = "未检查（未能解析出远程地址或对外端口）";
        stage("公网检查", "skip", publicNote);
        notCovered.push("公网检查未执行（未能解析出远程地址或对外端口）");
      }
    }
  }
}

// —— 监控口径：两端各自成句，命令与 job 清单写进报告。 ——
const localPromText = localRun === null ? "" : promNote(localWaitRaw + "\n" + localVerifyRaw);
const remotePromText = remoteRun === null ? "" : promNote(remoteWaitRaw + "\n" + remoteVerifyRaw);
if (localRun !== null && localPromText.includes("未在运行")) {
  notCovered.push(
    "本地 WSL 未运行 stats 监控组：验证脚本用 `docker compose --profile stats exec -T prometheus wget -qO- http://localhost:9090/api/v1/targets?state=active` 查询监控目标，该组未启用时这条命令拿不到输出，脚本据此打印 PROM_UP=skip，并跳过本端监控核对；所以本端既没有查监控目标，9090/9999 也不会有监听（stats 组未启用时这两个端口本就不发布），该监听项按「未启用分支」通过，属条件性通过、已在结论注明",
  );
}
if (remoteRun !== null && (remotePromText.includes("未读到") || remotePromText.includes("可能下个周期恢复"))) {
  addFinding({
    where: `远程 ${sshTarget}`,
    what: "监控目标数未完全恢复（抓取间隔 120s，重建后可能下个周期恢复）",
    evidence: `远端 prometheus targets：${remotePromText}`,
    status: "unconfirmed",
    severity: "low",
  });
}

// —— 未覆盖项 ——
const postRunPort = remoteRun === null || remoteRun.port === "" ? "（用服务器上 `docker compose port nginx 80` 的输出替换）" : remoteRun.port;
notCovered.push(
  ...(preferOfflineTests
    ? [
        "test:redis / test:live 未运行（本工作流参数 preferOfflineTests 默认 true，只跑 test:unit）。补验方式：以 preferOfflineTests=false 重跑本工作流（该参数在启动工作流时填写；workflow 定义在 .zcode/workflows/deploy-pot-server.dwf.ts，其 args 段声明了 preferOfflineTests / remoteRoot / sshTarget 三个参数）；test:live 需要 .env.test-*.local 凭据与网络，会向真实的腾讯文档（线上测试文档）读写记录。",
      ]
    : []),
  `写接口只验证了「可达且校验拒绝」：POST 空体经 nginx 转发到应用，由应用校验拒绝返回 400；未做真实写入。补验方式（会向线上文档写入一条真实记录，执行前确认示例 potId 不与真实数据冲突；在服务器上执行）：curl -sS -X POST -H 'Content-Type: application/json' -d '{"world":"猫","map":"北岛","potId":"54-1-400E8F3A","northRefreshAt":"1789201200000","lastVisitAt":"1789201200000"}' http://127.0.0.1:${postRunPort}/api/v1/pots`,
  "Redis 数据卷（redis-data）未备份：本次 redis 容器未被重建、也未执行 down/volume 操作，因此本次部署不影响它。该风险只在将来重建/删除 redis 容器或恢复卷时出现：redis-data 是上游数据的缓存、可由上游重新拉取——这一判断未经本次核实，若不成立则届时会有数据丢失风险，请按部署预期确认",
  "未做真实客户端（浏览器脚本）的端到端演练",
  ...(localRun === null
    ? localSkipReason === ""
      ? []
      : [`本地 WSL 部署跳过：${localSkipReason}`]
    : ["本地回滚未演练（本地留底镜像与回滚命令见『备份与回滚』）"]),
  ...(remoteRun === null
    ? (remoteSkipReason === "" ? [] : [`远程阶段未执行：${remoteSkipReason}`])
    : ["远程回滚未演练（留底镜像与回滚命令见『备份与回滚』）"]),
  `公网侧本次只验了 /readyz 与 /healthz 两条（未验 API 路径）；对外端口 ${postRunPort} 由开发机直连验证（服务已按现状对外提供服务）；该端口对公网的开放范围与来源限制（云安全组/防火墙）不在本工作流检查范围内——如需收窄来源，请在下次变更时调整安全组/防火墙。`,
  `披露范围：本报告含公网地址与端口、SSH 坐标（由 ssh -G 解析）、服务器路径与备份文件名、.env* 的文件名（不含内容）、仓库内 workflow 定义文件路径，以及补验示例里的 potId（其性质见该条说明）；这些都不是凭据或密钥，但若报告要向更广范围发布，请按此清单确认披露范围。`,
);
for (const f of findings.filter((x) => x.status === "unconfirmed")) {
  notCovered.push(`未确认项：${f.where} — ${f.what}`);
}

// —— 计数：通过 / 不适用 / 失败分开，不适用项不计入通过数。 ——
const localC = localRun === null ? { pass: 0, na: 0, fail: 0 } : countChecks(localRun.checks);
const remoteC = remoteRun === null ? { pass: 0, na: 0, fail: 0 } : countChecks(remoteRun.checks);
const publicV: TargetVerify = { ok: publicChecks.every((c) => c.result !== "fail"), checks: publicChecks };
const publicC = countChecks(publicV);
const passTotal = localC.pass + remoteC.pass + publicC.pass;
const naTotal = localC.na + remoteC.na + publicC.na;
const failTotal = localC.fail + remoteC.fail + publicC.fail;
const totalChecks = passTotal + naTotal + failTotal;
const naText = naTotal === 0 ? "" : `、不适用 ${naTotal} 项（无法读取的检查项，见各端清单里标 [-] 的行）`;
const conditionalPassCount =
  (localRun !== null && localRun.checks.checks.some((c) => c.name.startsWith("9090") && c.result === "pass" && c.actual.includes("无监听")) ? 1 : 0) +
  (remoteRun !== null && remoteRun.checks.checks.some((c) => c.name.startsWith("9090") && c.result === "pass" && c.actual.includes("无监听")) ? 1 : 0);
const conditionalNote =
  conditionalPassCount === 0
    ? ""
    : `；其中「9090/9999 监听」有 ${conditionalPassCount} 端（本次为本地端）在 stats 组未启用时以「无监听」通过，属条件性通过——该条只覆盖端口暴露面，不代表监控栈已就绪（该组启用后需重新核对）`;
const localCount = localC.pass + localC.na + localC.fail;
const remoteCount = remoteC.pass + remoteC.na + remoteC.fail;
const publicCount = publicC.pass + publicC.na + publicC.fail;

const deployedTo =
  localRun !== null && remoteRun !== null
    ? "本地 WSL 与远程服务器"
    : remoteRun !== null
      ? `远程服务器（本地 WSL 未参与：${localSkipReason === "" ? "见未覆盖" : localSkipReason}）`
      : localRun !== null
        ? "本地 WSL（远程未部署）"
        : "未部署任何一端";

const layersSameAll =
  (localRun === null || localState === null || localState.layers === "" || localRun.post.layers === "" || localState.layers === localRun.post.layers) &&
  (remoteRun === null || remoteState === null || remoteState.layers === "" || remoteRun.post.layers === "" || remoteState.layers === remoteRun.post.layers);
const contentLead =
  localRun !== null && remoteRun !== null
    ? layersSameAll
      ? `本次部署替换了两端运行镜像与容器；${IMG_SAME}，${DIST_SAME}——没有应用内容变化。`
      : `本次部署替换了两端运行镜像与容器；${IMG_DIFF}或${DIST_DIFF}，应用内容有变化（详见『本次实际变化』）。`
    : "";
const purposeNote =
  "本次部署的目的（例如验证流水线、切换镜像、发布新版本）由调用方决定，报告只记录实际发生了什么；内容零变化时，本次替换的是镜像与容器对象，未带来应用内容更新。";
const uncoveredDigest =
  "未覆盖：test:redis / test:live、真实写入与真实客户端端到端、两端回滚演练、公网端口开放范围、Redis 数据卷未备份" +
  (localRun !== null && localPromText.includes("未在运行") ? "、本地 stats 组未启用故未查询本端监控目标" : "") +
  "（详见报告『未覆盖』一节）";
let conclusion = "";
if (!packOk) {
  conclusion = `${abortReason}，未打包、未部署任何一端（本地与远程都保持原状；详情见 findings 与门禁一节）。`;
} else if (localFailed) {
  conclusion =
    `本地 WSL 部署未通过验证，按先本地后远程的顺序中止：远程未部署，服务器保持原状。构建标识 ${expectedStamp}，本地失败详情见 findings。` +
    `${uncoveredDigest}。`;
} else if (remoteRun === null) {
  conclusion =
    `构建标识 ${expectedStamp} ${localRun === null ? "未部署到本地 WSL" : "已部署到本地 WSL 并通过验证"}；` +
    `远程未部署（${remoteFailed ? "远程部署/备份失败，见 findings" : remoteSkipReason === "" ? "见未覆盖" : remoteSkipReason}），服务器保持原状。` +
    `${uncoveredDigest}。`;
} else {
  const localChange =
    localRun === null ? "本地未部署" : `本地：${changeSummary(localState, localRun.post)}`;
  const remoteChange = `远程：${changeSummary(remoteState, remoteRun.post)}`;
  // 标识是否与部署前相同必须逐端比对，不能写死：两端此前跑的是同一提交时才相同。
  const stampSameAll =
    (localRun === null || (localState !== null && localState.current === expectedStamp)) &&
    (remoteRun === null || (remoteState !== null && remoteState.current === expectedStamp));
  const unchangedParts = [
    ...(layersSameAll ? [`${IMG_SAME}；${DIST_SAME}`] : []),
    ...(stampSameAll ? [`构建标识 ${expectedStamp} 与部署前相同（两端此前跑的就是同一提交）`] : []),
  ];
  conclusion =
    contentLead + "\n" +
    `- 变了什么（均指应用容器；其余服务容器未动）：\n    - ${localChange}\n    - ${remoteChange}\n` +
    `${stampSameAll ? "" : `    - 构建标识：${stampChangeNote()}\n`}` +
    `- 没变什么：${
      unchangedParts.length === 0 ? "两端都换了运行实例与内容，没有可比对的未变项；详见『本次实际变化』。" : `${unchangedParts.join("；")}。`
    }\n` +
    `- 说明：${purposeNote}\n` +
    `- 验证：${totalChecks} 项（本地 ${localCount} + 远程 ${remoteCount} + 公网 ${publicCount}）：通过 ${passTotal} 项${naText}、失败 ${failTotal} 项${conditionalNote}。` +
    `部署对象：构建标识 ${expectedStamp}，已部署到${deployedTo}。` +
    `部署前两端都已留底镜像${localRun === null ? "" : `（本地 occult-pot-server:pre-deploy-${localRun.tagTs}）`}，远程另有配置快照 config-${backupTs}.tar.gz${backupTagState === "ok" ? ` 与镜像留底 occult-pot-server:pre-deploy-${backupTs}` : ""}。` +
    `${uncoveredDigest}。`;
}

const reportAt = await devNow();

// —— 报告正文：每条结论都带判定层、命令与时刻；本地与远程各自成节。 ——
/** 两端部署前后标识的比较句（各端标量，与快照无关）。 */
function stampChangeNote(): string {
  const parts: string[] = [];
  if (localState !== null) {
    parts.push(
      localRun === null
        ? `本地部署前 ${localState.current}`
        : localState.current === expectedStamp
          ? `本地前后相同（${expectedStamp}）`
          : `本地 ${localState.current} → ${expectedStamp}`,
    );
  }
  if (remoteState !== null) {
    parts.push(
      remoteRun === null
        ? `远程部署前 ${remoteState.current}`
        : remoteState.current === expectedStamp
          ? `远程前后相同（${expectedStamp}）`
          : `远程 ${remoteState.current} → ${expectedStamp}`,
    );
  }
  const allSame =
    (localRun === null || (localState !== null && localState.current === expectedStamp)) &&
    (remoteRun === null || (remoteState !== null && remoteState.current === expectedStamp));
  return `${parts.length === 0 ? "两端都未运行，无可比对标识" : parts.join("；")}${
    allSame ? "（本次两端此前跑的就是同一提交，所以标识相同属正常）" : ""
  }`;
}

const gitEnvFilesText =
  trackedEnvFiles.length === 0
    ? "本次用 `git ls-files packages/occult-pot-server/deploy` 未列出任何 .env*（该命令未成功时此处也会为空，请以仓库实际为准）"
    : `本次用 \`git ls-files packages/occult-pot-server/deploy\` 列出的受版本控制 .env* 文件：${trackedEnvFiles.join("、")}（本次未读取其内容，无法判断其中是否含敏感值；如担心入库风险请自行确认）`;

const stampDetail =
  stampFull === "" && stampSubject === ""
    ? ""
    : `；对应提交 ${stampFull === "" ? stampSha === null ? "（未查到）" : stampSha[1] : stampFull}（${stampDate}${
        stampSubject === "" ? "" : "，" + stampSubject
      }）`;
const inPkg = dirtyList.filter((l) => l.includes("packages/occult-pot-server/"));
let inPkgMtimeNote = "";
if (inPkg.length > 0 && distMtime !== "") {
  const rows: string[] = [];
  for (const entry of inPkg) {
    const rel = entry.replace(/^\S+\s+/, "").trim();
    try {
      const r2 = await world.run("node", ["-e", "const fs=require('fs');console.log('MT='+fs.statSync(process.argv[1]).mtime.toISOString())", rel], { timeoutMs: 60000 });
      const mt = kvLine(clean(r2.stdout), "MT");
      rows.push(`${rel}（mtime ${mt === "" ? "未取到" : mt}）${mt === "" ? "" : mt < distMtime ? "早于 dist mtime，已编入" : "晚于 dist mtime，未编入本次 dist"}`);
    } catch {
      rows.push(`${rel}（mtime 未取到）`);
    }
  }
  inPkgMtimeNote = rows.join("；");
}
const buildRebuilt = distMtime !== "" && startedAt !== "" && distMtime > startedAt;
const provenanceNote = [
  `dist 文件（${PKG_DIST_REL}）的 mtime（= 该文件最后一次被写入的时刻）：${distMtime === "" ? "未取到" : distMtime}`,
  `本次运行是否重新编译了它：${distMtime === "" || startedAt === "" ? "无法判断（缺读数）" : buildRebuilt ? "是（mtime 晚于本次运行开始时刻）" : `否（mtime 早于本次运行开始时刻 ${startedAt}，说明门禁里的 rush build 命中了缓存、未重写该文件）——因此标识仍是 ${expectedStamp}，dist 内容仍是上次编译的那份`}`,
  stampFull === "" ? "" : `标识提交 ${stampFull.slice(0, 12)}… 之后触及本包的提交数：${pkgCommitsSinceStamp < 0 ? "未取到" : String(pkgCommitsSinceStamp)}`,
  dirtyList.length === 0 ? "" : `工作树的未提交改动：${dirtyList.length} 项（清单见下）；包内改动与 dist mtime 的比较：${inPkg.length === 0 ? "无包内改动" : inPkgMtimeNote === "" ? "未取到 mtime，无法判断是否编入" : inPkgMtimeNote}`,
].filter((x) => x !== "").join("；");
const outPkg = dirtyList.filter((l) => !l.includes("packages/occult-pot-server/"));
const gitNoteRaw =
  dirtyList.length === 0
    ? "；打包时工作树干净（git status --porcelain 无输出），标识与实际内容一一对应"
    : `；打包时工作树有 ${dirtyList.length} 项未提交改动（未提交改动一律不在构建标识内——标识取最后一次提交），逐项列出：${
        inPkg.length > 0 ? `包内（按 mtime 推断已编入本次 dist，见下）：${inPkg.join("；")}` : "包内：无"
      }${outPkg.length > 0 ? `；包外（不会进入本 dist，与本次构建无关）：${outPkg.join("；")}` : ""}${
        inPkg.length > 0
          ? "；据此推断本次 dist 含该提交 + 上述包内未提交改动（本次未核对产物内是否确实含该改动，属按标识与工作区状态的推断）：用同一标识重建不会得到相同结果（构建期会注入编译时刻等信息，故即便同一标识与同一工作区，不同时间重建也未必逐字节一致）；要复现该 dist 的内容，应保留这份产物本身或先行提交这些改动后再构建"
          : ""
      }`;
const gitNote = gitNoteRaw;
const headNote =
  headFull === "" || stampFull === ""
    ? ""
    : headFull === stampFull
      ? `；打包后读取仓库 HEAD（${headAtPack === "" ? "时刻未取到" : headAtPack} UTC）：仍是 ${headFull.slice(0, 12)}…，与打包提交相同（提交作者时间 ${stampDate}）`
      : `；打包后读取仓库 HEAD（${headAtPack === "" ? "时刻未取到" : headAtPack} UTC）：已是 ${headFull.slice(0, 12)}…（提交作者时间 ${headDate}），与打包时注入标识的提交 ${stampFull.slice(0, 12)}…（提交作者时间 ${stampDate}）不同；报告生成时（${reportAt === "" ? "时刻未取到" : reportAt} UTC）再读一次仍是它。注意两个动作：dist 是此前编译好的（其编译时刻见下），本次运行的 “打包” 只是把它复刻进 zip 并上传，并不重新编译；因此 dist 携带的标识仍是 ${stampFull.slice(0, 12)}…，与本次运行时的 HEAD 无关。工作流对 git 只执行 rev-parse / show / status / ls-files / log 五条只读命令、从不提交；外部在该窗口内是否还有其他提交不在其观测范围内。`;

/**
 * 一端的 .env* 前后对照：只比较文件名与 mtime（`stat` 输出，形如 2026-10-05 22:32:31 +0800），
 * 不读取内容；用于佐证「本次流程未改动 .env*」这一前提。
 */
function envNote(label: string, before: EndState | null, post: PostState, tail?: string): string {
  const b = before === null ? "（未取到部署前快照）" : before.envStat === "" ? "（无 .env* 文件）" : before.envStat.trim();
  const a = post.envStat === "" ? "（无 .env* 文件）" : post.envStat.trim();
  const same = before !== null && before.envStat.trim() === a;
  return `${label}：${b} → ${a}${
    before === null ? "" : same ? "（文件名与 mtime 前后一致，本次流程未改动这些文件）" : "（有变化，见前后差异）"
  }（${tail === undefined ? "mtime 取 stat -c %y，时区随该端系统设置并已附在值后" : tail}）`;
}

const probeNote = [
  "- 探针与判定层（报告里每条 404/200 都注明由哪一层返回）：",
  "  - 构建标识：`docker compose exec -T nginx wget -qO- http://occult-pot-server:3000/healthz`——在 nginx 容器里向 compose 网络上的应用容器发请求（走容器网络，不经对外端口）；",
  "  - 应用层自查：`docker compose exec -T occult-pot-server node -e \"fetch('http://127.0.0.1:3000/metrics')\"`（/api/v1 同法）——在应用容器内另起一个 node 进程访问容器内 loopback（不是应用自身进程内的自检），既不走容器网络也不经 nginx；回答的是「应用自己有没有这个端点」；",
  "  - 对外检查：宿主机 `curl http://127.0.0.1:<对外端口>/…`——请求先到 nginx，是否转发由 nginx 配置决定；",
  "  - 公网检查：开发机 `node fetch http://<公网地址>:<对外端口>/…`——同样先到 nginx；",
  "  - 404 说明：/healthz、/metrics、/api/v1、/stub_status 的「应 404」都是 nginx 行为（转发清单只有 /readyz 与 /api/v1/pots，其余由兜底 location 返回），不代表应用层；应用层是否有这些端点由上面的「应用层自查」单独回答。",
  "  - 应用容器的挂载：docker-compose.yml 里 occult-pot-server 只有一个 bind mount（./logs → /var/log/occult-pot-server），/app 与 dist 都在镜像层内、不受挂载覆盖，因此 rootfs 层比对覆盖了应用实际运行的文件。",
  "  - 9090/9999 是什么：deploy/docker-compose.yml 的 stats 组里，只有 Prometheus（127.0.0.1:9090）与 Grafana（127.0.0.1:9999）发布宿主端口，其余三个监控组件（redis-exporter、nginx-exporter、node-exporter）不发布任何宿主端口——所以这两条就是 stats 组的全部宿主监听面。",
  "  - 镜像构建在哪里发生：每端各自执行 `docker compose up -d --build`，由 deploy/Dockerfile 以 deploy/server/ 为上下文现场构建 `occult-pot-server:latest`；因此两端镜像 ID 不同属正常，跨端能对齐的判据是容器内 dist 的 sha256（两端都应等于本次打包产物的哈希）。",
  "  - 产物如何到达远程：本地生成 zip（`packages/occult-pot-server/deploy/occult-pot-server.zip`）后由 `scp` 上传到服务器的部署根（即 `~/` + remoteRoot 参数 + `/occult-pot-server.zip`，本次 remoteRoot = " + remoteRoot + "），再 `unzip -oq` 解到该部署根下的 `server/`，最后由该端 compose 构建。两端命令的差异只在权限与 `--env-file`：本地以 root 执行，且本次已确认追加了 `.env.deploy.local`（该文件存在）；远程以 sudo 执行（两端实际命令见『备份与回滚』的对应小节）。",
  "  - 证据来源与命令（『实际』栏都是这些命令输出的关键字段摘录，不是整段原文；命令名+字段一并列出以便复核）：",
  "    - 容器内 dist sha256：`docker compose exec -T occult-pot-server sha256sum /app/dist/index.js`（部署前、部署后各一次，取第 1 列）",
  "    - 包内 dist 与打包产物解包后的 dist sha256：对 `packages/occult-pot-server/dist/index.js` 与 `deploy/server/packages/occult-pot-server/dist/index.js` 分别用 node 的 `crypto.createHash('sha256')` 计算（后者是 zip 解包结果；压缩包 zip 文件本身本次未读取校验）",
  "    - 镜像 rootfs 层摘要：`docker image inspect --format '{{.RootFS.Layers}}' <容器所用镜像>`（部署前后各一次，逐层比对）",
  "    - 镜像配置摘要：`docker image inspect --format '{{json .Config}}'`、`{{json .Config.Env}}`、`{{json .Config.Entrypoint}}{{json .Config.Cmd}}`，各自 `sha256sum`",
  "    - 留底与运行镜像 ID：`docker image inspect --format '{{.Id}}'`（对标签与容器 `.Image` 各一次），逐个字符比对",
  "    - 各服务容器：`docker compose ps --format '{{.Service}}=<{{.ID}}>|{{.Image}}'` 前后各一次",
  "    - 镜像切换判定键：部署脚本内的比较结果（SWAP_FIRST / SWAP_RESULT），由脚本打印，非外部命令",
  "    - 配置快照清单：`tar -tzf backups/config-<时间戳>.tar.gz`",
  "    - 工作树/HEAD/提交/包内提交计数：`git status --porcelain`、`git rev-parse HEAD`、`git show -s`、`git ls-files`、`git log --oneline <ref>..HEAD -- packages/occult-pot-server`",
  "    - 部署前读数（当前版本、容器状态、dist sha256、运行镜像与 latest、各服务容器）：与部署后同一批命令，在部署前各执行一次（`docker compose exec -T nginx wget -qO- http://occult-pot-server:3000/healthz`、`docker compose ps`、`docker inspect`、`docker image inspect`、容器内 `sha256sum`）",
  "    - dist 编译时刻与“标识之后的包内提交数”：node 读该 dist 文件的 mtime（`fs.statSync`），以及 `git log --oneline <标识提交>..HEAD -- packages/occult-pot-server` 的行数",
].join("\n");

const localSection =
  localRun === null
    ? [
        `## 本地 WSL 部署`,
        "",
        localFailed
          ? "本地部署未通过验证（失败详情见 findings 与阶段看板）。"
          : `未部署（${localSkipReason === "" ? "见未覆盖" : localSkipReason}）。`,
        "",
      ]
    : [
        "## 本地 WSL 部署",
        "",
        `- 环境：WSL 发行版 ${wslDistros.join("、")}（宿主为 Windows ${platform}；docker ${wslVersion} 运行在 WSL 侧，由 \`wsl.exe -u root -e bash -c\` 进入）`,
        `- 部署根：\`${localRun.root}\`（即仓库内 ${DEPLOY_REL} 经 /mnt/c 挂载；compose 文件为 deploy/docker-compose.yml，软件包 zip 为 deploy/occult-pot-server.zip）`,
        `- .env* 前后对照（脚本不读取其内容，只比对文件名与 mtime）：${envNote("本地 WSL", localState, localRun.post, "受版本控制的 .env* 以『备份与回滚』里 git ls-files 的实际结果为准；.env.*.local 被 .gitignore 排除、不在 git 里")}`,
        `- 时刻：compose up 完成 ${localRun.upAt} UTC；验证脚本运行 ${localRun.verifyAt} UTC（起止时刻只在脚本首尾各打印一次，用于界定这次验证的整体窗口，不代表逐项耗时；脚本内的探针、inspect、ss 与 sha256 都是串行执行的）`,
        "- 检查项（每条含判定层）：",
        ...checkLines(localRun.checks),
        localPromText.includes("未在运行")
          ? `- 监控（未查询：stats 组未启用）：本端跳过了监控目标查询。stats 组是否在跑由该端此前是否以 \`--profile stats\` 启动过决定，本工作流不启停它，因此两端可能不同。`
          : `- 监控（查询于验证脚本运行的 ${localRun.verifyAt} UTC 之间）：\`docker compose --profile stats exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active'\` → ${localPromText}`,
        "",
      ];

const remoteSection =
  remoteRun === null
    ? [`## 远程备份、部署与检查`, "", `未执行（${remoteFailed ? "见 findings" : remoteSkipReason === "" ? "见未覆盖" : remoteSkipReason}）。`, ""]
    : [
        "## 远程备份、部署与检查",
        "",
        `- 备份（先备份后覆盖）：\`~/${remoteRoot}/backups/config-${backupTs}.tar.gz\`；tar 清单与存在性：${backupTarEntries === "" ? "未取到清单" : backupTarEntries}；范围 docker-compose.yml / Dockerfile / nginx / stats / fail2ban / logrotate（不含任何 .env*；部署前后 .env* 的对照见下）；镜像留底 ${backupTagState === "ok" ? `\`occult-pot-server:pre-deploy-${backupTs}\`` : "无（部署前没有旧镜像）"}${backupTagId === "" ? "" : `，指向 \`${backupTagId}\``}`,
        `- .env* 前后对照（脚本不读取其内容，只比对文件名与 mtime）：${envNote(`远程 ${sshTarget}`, remoteState, remoteRun.post, "远程部署根不在仓库树内，其 .env* 是否受版本控制本次未核查；这里的 git ls-files 结果只说明本地仓库")}`,
        `- 时刻：compose up 完成 ${remoteRun.upAt} UTC；验证脚本运行 ${remoteRun.verifyAt} UTC（起止时刻只在脚本首尾各打印一次，用于界定这次验证的整体窗口，不代表逐项耗时；远端还包含一次 SSH 往返与按顺序执行的各条探针）`,
        "- 检查项（每条含判定层）：",
        ...checkLines(remoteRun.checks),
        remotePromText.includes("未在运行")
          ? `- 监控（未查询：stats 组未启用）：本端跳过了监控目标查询。stats 组是否在跑由该端此前是否以 \`--profile stats\` 启动过决定，本工作流不启停它，因此两端可能不同。`
          : `- 监控（查询于验证脚本运行的 ${remoteRun.verifyAt} UTC 之间）：\`docker compose --profile stats exec -T prometheus wget -qO- 'http://localhost:9090/api/v1/targets?state=active'\` → ${remotePromText}`,
        "",
      ];

const publicSection =
  publicChecks.length === 0
    ? ["## 公网检查", "", `未执行（${publicNote}）。`, ""]
    : ["## 公网检查", "", "- 检查项（发起位置：开发机 node fetch，逐条各记发起时刻）：", ...checkLines(publicV), ""];

const rollbackCaveat = (before: EndState | null): string[] => {
  if (before === null || before.img === "" || before.runImg === "" || before.img === before.runImg) return [];
  const short = (v: string): string => shortId(v.replace(/^sha256:/, ""));
  return [
    `  （注意：留底的是部署前 latest 标签指向的镜像 ${short(before.img)}，而部署前运行中的容器实际使用的是 ${short(before.runImg)}，两者不同（见『本次实际变化』）——回滚只能回到留底镜像，无法还原当时正在运行的那个镜像。）`,
  ];
};

const remoteSeqCmd = remoteRun === null ? "sudo docker compose --env-file .env.deploy" : remoteRun.composeCmd;
const remoteSeqLine =
  remoteRun === null
    ? "（远程未完成部署，命令序列见 findings）"
    : `\`cd ~/${remoteRoot}\` → \`${remoteRun.composeCmd} up -d --build\`（${remoteRun.composeCmd.includes(".env.deploy.local") ? "其中已追加 --env-file .env.deploy.local（该文件存在）" : "未追加 .env.deploy.local（该文件不存在）"}）→ 校验运行镜像：${remoteRun.post.swap === "forced" ? "不一致，执行 " + remoteRun.composeCmd + " up -d --force-recreate --no-deps occult-pot-server（回滚同参）" : "一致，未执行兜底重建"}`;

const rollbackSection = [
  "## 备份与回滚",
  "",
  "### 本地 WSL",
  "",
  ...(localRun === null
    ? ["本次未在本地 WSL 部署，没有需要回滚的对象。", ""]
    : localRun.tagState === "ok"
      ? [
          `- 镜像留底：\`occult-pot-server:pre-deploy-${localRun.tagTs}\`（部署前旧镜像的标签；标签名即 UTC 时刻 ${localRun.tagTs}）${
            localRun.tagId === ""
              ? ""
              : `，指向 \`${localRun.tagId}\`；与部署前运行镜像 \`${localState === null ? "" : localState.runImg}\` 的核对结果：${
                  localState !== null && localState.runImg !== "" && localRun.tagId === localState.runImg ? "一致" : "不一致或未取到（回滚对象可能不是部署前正在跑的那个镜像）"
                }`
          }`,
          `- 本次实际执行的部署序列（在 WSL 里由 root 执行，故不加 sudo）：\`cd ${localRun.root}\` → \`${localRun.composeCmd} up -d --build\`（${localRun.composeCmd.includes(".env.deploy.local") ? "其中已追加 --env-file .env.deploy.local（该文件存在）" : "未追加 .env.deploy.local（该文件不存在）"}）→ 校验运行镜像：${localRun.post.swap === "forced" ? "不一致，执行 " + localRun.composeCmd + " up -d --force-recreate --no-deps occult-pot-server（回滚同参）" : "一致，未执行兜底重建"}`,
          "- 回滚命令（在 WSL 里执行，命令自带进入部署根）：",
          `  \`cd ${localRun.root} && docker tag occult-pot-server:pre-deploy-${localRun.tagTs} occult-pot-server:latest && ${localRun.composeCmd} up -d --force-recreate --no-deps occult-pot-server\`（与本次部署同参：含 ${localRun.composeCmd.includes(".env.deploy.local") ? "--env-file .env.deploy 与 --env-file .env.deploy.local" : "--env-file .env.deploy"}）`,
          `  （本地不加 sudo；不 --build，直接切回留底镜像。\`--force-recreate --no-deps\` 是必须的：只重打 latest 而容器配置未变时，compose 可能不重建容器，回滚就会静默失效。配置未另做快照：docker-compose.yml / nginx / stats 等在 git 里；${gitEnvFilesText}；\`.env.*.local\` 被 .gitignore 排除、不在 git 里，需要各自单独保留备份。）`,
          `- 本地配置回滚：部署用的 docker-compose.yml / nginx / stats / Dockerfile 都在仓库 git 里（\`packages/occult-pot-server/deploy/\`），用 \`git checkout <提交> -- packages/occult-pot-server/deploy\` 检出即可；部署时代码提交为 ${stampFull === "" ? "（未取到）" : stampFull}（dist 即由它编译），而工作树当时另有未提交改动（配置目录未见改动，故按该提交检出即可）；.env.deploy 与 .env.production 同样受 git 跟踪，.env.*.local 不在 git 里、需单独备份。`,
          ...rollbackCaveat(localState),
          "",
        ]
      : ["- 本地留底失败或部署前没有旧镜像（TAG=" + localRun.tagState + "），本地没有可用回滚对象。", ""]),
  "### 远程",
  "",
  ...(backupOk
    ? [
        `- 配置快照：远程 \`~/${remoteRoot}/backups/config-${backupTs}.tar.gz\``,
        `- 镜像留底：${backupTagState === "ok" ? `\`occult-pot-server:pre-deploy-${backupTs}\`（标签名即 UTC 时刻 ${backupTs}）` : "无（部署前没有旧镜像）"}${backupTagId === "" ? "" : `，指向 \`${backupTagId}\`；与部署前运行镜像 \`${remoteState === null ? "" : remoteState.runImg}\` 的核对结果：${remoteState !== null && remoteState.runImg !== "" && backupTagId === remoteState.runImg ? "一致" : "不一致或未取到"}`}`,
        `- 本次实际执行的部署序列（远程以 sudo 执行）：${remoteSeqLine}`,
        "- 回滚命令（SSH 到服务器执行，命令自带进入部署根）：",
        `  \`cd ~/${remoteRoot} && sudo docker tag occult-pot-server:pre-deploy-${backupTs} occult-pot-server:latest && ${remoteSeqCmd} up -d --force-recreate --no-deps occult-pot-server\`（与本次部署同参：含 ${remoteSeqCmd.includes(".env.deploy.local") ? "--env-file .env.deploy 与 --env-file .env.deploy.local" : "--env-file .env.deploy"}）`,
        "  （不 --build，直接切回留底镜像；`--force-recreate --no-deps` 理由同本地。如需连配置一起回滚：先 " +
          `\`cd ~/${remoteRoot} && tar -xzf backups/config-${backupTs}.tar.gz\` 覆盖配置，再执行上面的命令。配置快照不含 .env*；.env* 的 mtime 前后一致只能说明两次观测之间这些文件未被写入（不排除内容未变的改写或被回拨时间戳），故「无需回滚 .env*」这一结论按此局限理解。）`,
        ...rollbackCaveat(remoteState),
        ...(remoteRun === null ? ["  （远程部署未通过验证；如需恢复部署前状态，执行上面的回滚命令。）"] : []),
        "",
      ]
    : ["本次未在远程部署（或备份未成功），没有需要回滚的对象。", ""]),
];

const timelineSection = [
  "## 时间线（UTC；各条时刻由执行该步的命令自己打印）",
  "",
  ...timeline.map((t, i) => `- ${i + 1}. ${t}`),
  `- 报告生成：${reportAt === "" ? "（未取到）" : reportAt}`,
  "",
];

const changeSection: string[] = ["## 本次实际变化", ""];
if (localRun !== null) {
  changeSection.push(...identityNote("本地 WSL", localState, localRun.post, localRun.verifyAt), "");
} else {
  changeSection.push(`- 本地 WSL：未部署（${localSkipReason === "" ? "见未覆盖" : localSkipReason}）。`, "");
}
if (remoteRun !== null) {
  changeSection.push(...identityNote(`远程 ${sshTarget}`, remoteState, remoteRun.post, remoteRun.verifyAt), "");
} else {
  changeSection.push(`- 远程：未部署（${remoteFailed ? "见 findings" : remoteSkipReason === "" ? "见未覆盖" : remoteSkipReason}）。`, "");
}

/** 本次两端的运行实例与内容各自变没变，供报告正文引用（与结论同源，不写死）。 */
function instanceVerdict(): string {
  const sides = [
    ...(localRun === null ? [] : [`本地${instanceRebuilt(localState, localRun.post) ? "被重建" : "未被重建"}`]),
    ...(remoteRun === null ? [] : [`远程${instanceRebuilt(remoteState, remoteRun.post) ? "被重建" : "未被重建"}`]),
  ];
  return sides.length === 0 ? "两端都未部署，实例与内容都无可比对" : `${sides.join("、")}；${layersSameAll ? "内容未变" : "内容有变化"}`;
}

const reportText = [
  "# occult-pot-server 部署报告",
  "",
  `**结论**：${conclusion}`,
  "",
  "## 连接与版本",
  "",
  `- 运行环境：Windows 开发机（${platform}，node ${nodeVersion}；rush 经 common/scripts 引导，版本以仓库 rush.json 为准）`,
  `- 远程连接：ssh 目标 \`${sshTarget}\` → ${aliasUser}@${aliasHost}:${aliasPort}（坐标由 \`ssh -G\` 解析）。脚本本身不解析任何凭据文件，未读取、未打印任何密钥；ssh 客户端会照常使用本机 ssh 配置里的 IdentityFile。`,
  localRun === null
    ? `- 本地：未部署（${localSkipReason === "" ? "见未覆盖" : localSkipReason}）`
    : `- 本地部署根：\`${localRun.root}\`；发行版 ${wslDistros.join("、")}，docker ${wslVersion}（运行在 WSL 侧）`,
  `- 构建标识含义：形如 \`v<包版本> (<10 位提交短哈希>)\`——包版本 + 构建该 dist 时 \`unplugin-info\` 注入的提交短哈希（取那一刻的仓库 HEAD）；\`/healthz\` 的 \`version\` 即此值。dist 的编译溯源（注意：本节“编译”指出 dist 文件，与打包 zip 是两个动作）：${provenanceNote}${stampDetail}${gitNote}${headNote}`,
  `- 部署前版本：本地 ${localState === null ? "—（未检查）" : localState.current}；远程 ${remoteState === null ? "—（未检查）" : remoteState.current}`,
  `- 部署后版本：${expectedStamp === "" ? "（构建未完成，无产物）" : expectedStamp}（= 本次打包产物的标识；该 dist 的内容按标识与工作区状态推断为上面那个提交 + 列出的包内未提交改动，本次未核对产物内是否确实含该改动）`,
  `- 标识变化：${stampChangeNote()}。标识只随「包版本 + 打包时提交」变化，它相同或不同都不足以单独说明这次部署做了什么——两个问题各有自己的判据：是否重建了运行实例，看『本次实际变化』里镜像 ID 与容器 ID 的前后对比；内容与配置是否真的变了，看容器内 dist sha256、镜像层摘要与镜像配置摘要的前后对比。本次：${instanceVerdict()}。`,
  `- 同一份 dist 文件（\`index.js\`）的四处副本 sha256（四处的 sha256 这里一次列全，便于对照）：包内 \`${postSha === "" ? "（未取到）" : postSha}\`；打包产物解包后（deploy/server/packages/occult-pot-server/dist/index.js）\`${expectedSha === "" ? "（未取到）" : expectedSha}\`；本地容器内 \`${localRun === null ? "（未部署）" : localRun.post.sha === "" ? "（未取到）" : localRun.post.sha}\`；远程容器内 \`${remoteRun === null ? "（未部署）" : remoteRun.post.sha === "" ? "（未取到）" : remoteRun.post.sha}\`。zip 落点 \`${ZIP_REL}\`（相对仓库根；rush deploy 的 --create-archive 相对 target-folder 解析，因此 ../ 指向 deploy 目录），共 ${zipNames.length} 个条目：${zipNames.join("、")}；按文件名模式筛检凭据类文件（*.env/secret/token/password/credential/local）无命中（仅按文件名，未做文件内容扫描，也不读取 .env* 内容）。`,
  "",
  probeNote,
  "",
  "## 本次实际变化",
  "",
  ...changeSection.slice(2),
  "## 门禁（命令与结果）",
  "",
  ...gateEvidence.map((g) => `- ${g}`),
  "",
  ...localSection,
  ...remoteSection,
  ...publicSection,
  ...rollbackSection,
  ...timelineSection,
  "## 未覆盖",
  "",
  ...notCovered.map((n) => `- ${n}`),
].join("\n");

const reviewer = agent(
  "部署报告复核员",
  "你是这份部署报告的独立复核员，只审阅文本本身：不运行任何命令，不修改任何文件，只根据报告内容判断。" +
    "请指出：读者会看不懂或会误解的地方、报告里自相矛盾或没有依据的说法、结论与证据对不上的地方；" +
    "并逐字列出报告中任何疑似凭据、密钥或令牌的片段（真实凭据绝不应出现在报告里），没有则为空数组。" +
    "用中文回答。",
);
const review = await reviewer.ask<ReportReview>(
  `请复核下面这份将发布给用户的部署报告：\n\n${reportText}`,
);
let finalReport = reportText;
for (const frag of review.redact) {
  if (frag.trim() !== "" && frag.length >= 8) {
    finalReport = finalReport.split(frag).join("[已隐去]");
  }
}
if (review.issues.length > 0) {
  finalReport += "\n\n## 复核备注\n\n" + review.issues.map((i) => `- ${i}`).join("\n");
}

await artifact.markdown("report", finalReport, {
  title: "occult-pot-server 部署报告",
  description: `构建标识 ${expectedStamp} 在${deployedTo}的部署与验证结果。`,
  primary: true,
});

const failedFinal = findings.filter((f) => f.severity === "high" || f.status === "unconfirmed");
if (failedFinal.length > 0) {
  conclusion += ` 另有 ${failedFinal.length} 项需要关注：${failedFinal.map((f) => `${f.where}（${f.what}）`).join("；")}。`;
}

return {
  conclusion,
  findings,
  verified,
  notCovered,
} satisfies WorkflowReport;
