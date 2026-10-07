/* zcode-workflow
description: 按需求修改一个或多个包，逐个包（含受影响的上下游包）跑通 format/lint/typecheck/test/build
  门禁，失败则把报错喂回给修改者重试。包名在本仓库还不存在时，先建骨架、登记 rush.json 并 rush update 接入，再进入同一套循环。
  新包的落位由 args.newPackageFolders 按包名给出的工作区相对路径决定，tags 与骨架参照的同类项目从那个目录推出；没给路径就直接拒绝，不默认 packages/。
whenToUse: 在 rush monorepo 中按需求改动某个或某几个包（含尚未存在、需要新建的包），并需要连带处理其受影响的下游包、逐包验证门禁是否通过时。
args:
  maxRounds:
    type: number
    description: 每个包改-验证循环的最大轮次。默认 4。
    default: 4
  packages:
    type: json
    description: 要修改的包名数组，例如 ["tencent-doc-sdk"]。含本仓库还没有的新包时，会先为它建骨架并登记。
    required: true
  newPackageFolders:
    type: json
    description: '按包名给出该新建包的工作区相对目录，例如 {"my-test-pkg": "tests/my-test-pkg"}。请求里有本仓库还不存在的包名时必填（只给需要新建的那几个即可）：新包没有既存目录可推断归属，而目录给错不会被任何门禁发现——骨架与目录无关，五条门禁照样全绿，错位只会在很久以后被人看见——所以这里不设默认值，缺了就直接拒绝并说明。'
  preferOfflineTests:
    type: boolean
    description: 是否只跑离线测试（test:unit / test:offline / test:run），避免 live 测试依赖环境变量与网络。默认 true。
    default: true
  requirement:
    type: string
    description: 本次修改的需求描述。
    required: true
  scopes:
    type: json
    description: 每个包允许改到什么程度，例如把 tencent-doc-sdk 设为 internal。取值 none（不许改动本包任何文件，含单元测试，只跑门禁确认现状）/ internal（可改内部实现、内部函数与依赖边，对外导出的名字与签名不许变）/ external（对外接口签名也可改）。未列出的包按默认——本次新建的包为 external，请求里点名的包为 internal，只因依赖被牵连进来的包为 none。
  contents:
    type: json
    description: 按包名给出该包提问里【具体需求】一节的正文，用来把需求裁到只有本包相关的那一段。未给出的包，请求里点名的那种用 args.requirement 全文，被牵连的下游包用上游各包的改动清单；纯验证的包那一节是守卫规则，不看这个参数。
*/
interface PkgMeta {
  /** 包名，例如 tencent-doc-sdk。 */
  name: string;
  /** 工作区相对目录，例如 packages/tencent-doc-sdk。 */
  dir: string;
  /** package.json 里声明的依赖名（dependencies / devDependencies / peerDependencies 三者合并）。 */
  deps: string[];
  /** 该包 package.json 里可运行的脚本名。 */
  scripts: string[];
  /** 脚本名到其命令文本的映射，用于判断测试脚本是否需要追加 --run。 */
  scriptCmds: Record<string, string>;
}

interface GateOutcome {
  /** 该包本轮门禁是否全部通过。 */
  ok: boolean;
  /** 第一个失败的脚本名；全部通过时为 null。 */
  failed: string | null;
  /** 失败脚本的原始输出，用于喂给下一轮修改。 */
  output: string;
}

interface Finding {
  /** 工作区相对路径。 */
  where: string;
  /** 一句话：发生了什么。 */
  what: string;
  /** 依据：跑了哪些命令、结果如何。 */
  evidence: string;
  /** verified 表示确定性门禁确认过；unconfirmed 表示未确认。 */
  status: "verified" | "unconfirmed";
  /** 严重度。 */
  severity: "low" | "medium" | "high";
}

interface WorkflowReport {
  /** 两三句话回答需求完成情况与门禁结果。 */
  conclusion: string;
  findings: Finding[];
  /** 本次实际检查过什么、怎么检查的。 */
  verified: string[];
  /** 本次没有覆盖或无法检查的部分及原因。 */
  notCovered: string[];
}

/** 一个包允许改到什么程度：调用方按包给出（args.scopes），缺省由脚本按角色推断。 */
type Scope = "none" | "internal" | "external";

// 门禁的构成与轮次上限是控制流常量，不进任何提示词文本：
// 将来调整它们不会让已完成的子代理结果失效。
const GATE_SCRIPTS = ["format:check", "lint", "typecheck", "test", "build"];
const OUTPUT_LIMIT = 120000;
// 新包的目录归属不在这里：由调用方按包名给出（args.newPackageFolders），脚本只把它拆出根目录，
// 用来定 tags 与挑选骨架参照的同类项目。
//
// rush.json 的 allowedProjectTags 是 userscript / library / service / test，其中三个与目录一一对应；
// service 推不出来（本仓库只对 packages/occult-pot-server 用），所以这张表只用于给出建议值，权威是
// 同一目录下既存条目在 rush.json 里写的 tags。
const TAGS_BY_ROOT: Record<string, string> = { packages: "library", tests: "test", scripts: "userscript" };

// 累积器在辅助函数之前声明：构建上游的那一段也要往这三个里写。
const findings: Finding[] = [];
const verified: string[] = [];
const notCovered: string[] = [];

/**
 * rush 已登记的包名到工作区相对目录。
 *
 * 权威来源是 `rush list --json`：登记在 rush.json 里的项目才在这里，一个目录里有 package.json
 * 但没登记，rush 既不 link 也不给 rushx 用，按"还不存在"处理才是对的。
 */
async function rushProjects(): Promise<Map<string, string>> {
  const res = await world.run("node", ["common/scripts/install-run-rush.js", "list", "--json"], { timeoutMs: 600_000 });
  const start = res.stdout.indexOf("{");
  if (res.exitCode !== 0 || start < 0) return new Map();
  const parsed = JSON.parse(res.stdout.slice(start)) as { projects?: { name?: unknown; path?: unknown }[] };
  const out = new Map<string, string>();
  for (const p of parsed.projects ?? []) {
    if (typeof p.name === "string" && typeof p.path === "string") out.set(p.name, p.path.replace(/\\/g, "/"));
  }
  return out;
}

/** 读取仓库内所有 rush 项目的元信息（packages / scripts / tests 三处）。 */
async function loadPackages(): Promise<PkgMeta[]> {
  const paths: string[] = [];
  for (const pattern of ["packages/*/package.json", "scripts/*/package.json", "tests/*/package.json"]) {
    try {
      const found = await files.glob(pattern);
      for (const p of found) paths.push(p);
    } catch {
      // 该目录不存在：忽略
    }
  }
  const out: PkgMeta[] = [];
  for (const p of paths) {
    const raw = JSON.parse(await files.read(p)) as {
      name?: unknown;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };
    if (typeof raw.name !== "string") continue;
    out.push({
      name: raw.name,
      dir: p.replace(/\/package\.json$/, ""),
      // devDependencies 也算依赖边：本仓库的 tests/ 与部分库把 workspace 依赖写在这里，
      // 只跟 dependencies 会漏掉整条下游链（tests/xiv-datamine-polyfill-e2e-test 就是这样依赖两个 provider 的）。
      deps: [
        ...Object.keys(raw.dependencies ?? {}),
        ...Object.keys(raw.devDependencies ?? {}),
        ...Object.keys(raw.peerDependencies ?? {}),
      ],
      scripts: Object.keys(raw.scripts ?? {}),
      scriptCmds: raw.scripts ?? {},
    });
  }
  return out;
}

/** seeds 及其全部（间接）下游依赖者。 */
function transitiveDependents(all: PkgMeta[], seeds: string[]): string[] {
  const seen = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const p of all) {
      if (p.deps.includes(cur) && !seen.has(p.name)) {
        seen.add(p.name);
        queue.push(p.name);
      }
    }
  }
  return [...seen];
}

/** names 的全部（间接）依赖，仅限本仓库内的包。 */
function transitiveDependencies(all: PkgMeta[], names: string[]): string[] {
  const byName = new Map(all.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const queue = [...names];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    const pkg = byName.get(cur);
    if (pkg === undefined) continue;
    for (const d of pkg.deps) {
      if (byName.has(d) && !seen.has(d)) {
        seen.add(d);
        queue.push(d);
      }
    }
  }
  return [...seen];
}

/** 依赖优先排序（上游在前），保证下游门禁运行时上游产物已就绪。 */
function sortByDeps(all: PkgMeta[], names: string[]): string[] {
  const byName = new Map(all.map((p) => [p.name, p]));
  const inSet = new Set(names);
  const order: string[] = [];
  const visited = new Set<string>();
  const visit = (n: string): void => {
    if (visited.has(n)) return;
    visited.add(n);
    const pkg = byName.get(n);
    if (pkg !== undefined) {
      for (const d of pkg.deps) if (inSet.has(d)) visit(d);
    }
    if (inSet.has(n)) order.push(n);
  };
  for (const n of names) visit(n);
  return order;
}

/**
 * 决定一条测试脚本要不要追加 `--run`，避免 vitest 的 watch 模式挂住不退出。
 * 仓库里各包的 test 脚本形态不一：裸 `vitest`、`vitest --run`、`vitest run ...`、
 * 以及 `npm run a && npm run b` 复合脚本。规则：命令里出现的每个 vitest 调用都
 * 必须已是单次模式（带 --run、或 vitest 后跟 run 子命令）；只要有一个是 watch 模式，
 * 就追加 `--run` 让它单次执行。vitest 不接受重复的 --run（`vitest --run --run` 会报错），
 * 所以不能无条件追加，脚本已全部单次时返回空数组。
 */
function testRunArgs(pkg: PkgMeta, scriptName: string): string[] {
  const cmd = pkg.scriptCmds[scriptName] ?? "";
  const invocations = cmd.match(/\bvitest\b[^\S\n]*[^&|;]*/g) ?? [];
  if (invocations.length === 0) return [];
  const alwaysSingleRun = invocations.every(
    (inv) => /(^|\s)--run(\s|$)/.test(inv) || /^vitest\s+run(\s|$)/.test(inv.trim()),
  );
  return alwaysSingleRun ? [] : ["--run"];
}

/** 该包实际要跑的门禁脚本（跳过不存在者）。 */function resolveGateScripts(pkg: PkgMeta, preferOfflineTests: boolean): string[] {
  const chosen: string[] = [];
  if (pkg.scripts.includes("format:check")) chosen.push("format:check");
  if (pkg.scripts.includes("lint")) chosen.push("lint");
  if (pkg.scripts.includes("typecheck")) chosen.push("typecheck");
  // 测试脚本优先离线子集，避免 live 测试依赖环境变量与网络。
  if (preferOfflineTests) {
    for (const candidate of ["test:unit", "test:offline", "test:run"]) {
      if (pkg.scripts.includes(candidate)) {
        chosen.push(candidate);
        break;
      }
    }
    if (!chosen.some((s) => s.startsWith("test")) && pkg.scripts.includes("test")) {
      chosen.push("test");
    }
  } else if (pkg.scripts.includes("test")) {
    chosen.push("test");
  }
  if (pkg.scripts.includes("build")) chosen.push("build");
  return chosen;
}

/** 本包目录下当前有未提交改动的文件（含未跟踪）。用来把"现状"写进提问，也用来查 none 范围有没有被越界。 */
async function changedFilesIn(dir: string): Promise<string[]> {
  try {
    const st = await git.status();
    return [...st.staged, ...st.unstaged, ...st.untracked].filter((p) => p.startsWith(`${dir}/`));
  } catch {
    // 不在 git 仓库里（或 git 不可用）：没有状态可报，按"无改动"处理。
    return [];
  }
}

/** 本包相对 HEAD 的工作区差异文本。上面那份文件列表看不见"改动已脏文件"的内容变化，这份补上。 */
async function diffOf(dir: string): Promise<string> {
  try {
    return await git.diff("HEAD", dir);
  } catch {
    // 不在 git 仓库里、或该目录差异超过上限：没有指纹可用，按空串处理。
    return "";
  }
}

/** 报告正文里的单条截断：产物 markdown 有 256KB 上限，而 finding 的 what 是子代理的整段报告。 */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断，全文 ${text.length} 字）`;
}

/**
 * 本包被授权改到什么程度，一句话。
 *
 * 范围是调用方给的授权，不是建议：none 会被脚本按文件集与 diff 指纹比对查出越界。这一行只说"允许改哪里"，
 * 不说"为什么要改"——后者归【具体需求】那一节。两者此前写在同一句里（"internal（下游包）：你的上游修改了
 * 对外接口或行为…"），于是范围一栏被读成"上游改过"，连上游一个都没动的需求包也被写成了下游包。
 */
function scopeLine(scope: Scope): string {
  if (scope === "none") return "无（纯验证）。不许改动本包任何文件，含单元测试；只跑门禁确认现状。";
  if (scope === "internal") return "内部接口与测试。可改内部实现、内部函数、依赖边与单元测试；对外导出的名字与签名不许变。";
  return "内部与外部接口与测试。必要时连对外接口与签名也可以改。";
}

/**
 * 本仓库内、本次改动范围内的上游依赖，以及它们各自有没有真的动过。
 *
 * 独立成一行，因为它和授权范围是两件事：需求包的范围是 internal，上游却可能一个都没动；被牵连进来的下游包
 * 范围是 none，上游反而确实改过。按包算出来的这个事实比从范围反推的那句话可靠。
 */
async function upstreamLines(pkg: PkgMeta, all: PkgMeta[], affectedSet: string[]): Promise<string[]> {
  const upstream = pkg.deps.filter((d) => affectedSet.includes(d));
  if (upstream.length === 0) return ["你的上游依赖更改情况为：无——本次没有本仓库内的依赖包被改动。"];
  const lines = ["你的上游依赖更改情况为："];
  for (const dep of upstream) {
    const depPkg = all.find((p) => p.name === dep);
    if (depPkg === undefined) continue;
    const depChanged = await changedFilesIn(depPkg.dir);
    lines.push(
      depChanged.length === 0
        ? `- ${dep}：没有产生改动（本轮只是被验证过）。`
        : `- ${dep}：改动落在 ${depChanged.slice(0, 10).join("、")}${depChanged.length > 10 ? " 等" : ""}。`,
    );
  }
  return lines;
}

/**
 * 【具体需求】那一节：本包在本次改动里的角色决定写哪一种。
 *
 * 纯验证（none，无论调用方有没有把本包点名为需求包）没有需求内容，只有守卫规则；下游包写"配合上游修改"，
 * 需求包写"本包是核心"，内容取自 args.requirement 全文或该包的 contents。
 */
function demandLines(pkg: PkgMeta, scope: Scope, isSeed: boolean, upstream: string[], requirement: string, supplied: string | null): string[] {
  if (scope === "none") {
    return [
      "无。本包本次不改代码——上游的改动没有要求本包适配。",
      // 门禁本身在【你的任务】那一行已经说了，这里只说这一种范围特有的那条：不许自己动手。
      "若本包其实必须跟着改、或者现状就不通过，说明哪里、为什么，并升级；不要自己动手改。",
    ];
  }
  if (!isSeed) {
    const who = upstream.length > 0 ? `本包依赖的 ${upstream.join("、")}` : "本包的上游";
    return [
      `${who} 在本次改动范围内，把本包适配到它们带来的接口/行为变化上，然后跑通门禁。`,
      "具体改了什么以工作区为准：直接读上面【你的任务】里列出的那些文件，或看它们相对 HEAD 的差异。",
    ];
  }
  const lines = ["本包是本次修改的核心，完成以下目标中属于本包的那部分。", ""];
  if (supplied !== null) {
    lines.push(supplied);
  } else {
    lines.push(requirement);
    lines.push("");
    lines.push(`上面是需求全文，你只做其中属于 ${pkg.dir} 的那部分，只改动本包的文件。`);
  }
  return lines;
}

/**
 * 本包现在的样子，写进【其他】一节。
 *
 * 这一块是必需的，不是装饰：提问文本必须随工作区现状变化。否则同一份脚本再跑一轮时，子代理拿到的
 * 是与上一轮逐字相同的初始提示词，无从知道自己面对的可能是"已经改过的包"——上一轮就是这样，
 * 两次运行的 ask 输入哈希完全一致（5bc3ac2b / 5123cd39）。
 */
async function stateLine(pkg: PkgMeta): Promise<string> {
  const changed = await changedFilesIn(pkg.dir);
  if (changed.length === 0) {
    return "现状：本包在工作区里没有任何未提交改动，看起来还没被动过。";
  }
  return (
    `现状：本包已有 ${changed.length} 个文件的未提交改动（${changed.slice(0, 8).join("、")}${
      changed.length > 8 ? " 等" : ""
    }）——之前的运行可能已经改过本包，先读现状、别从零重写已经对的部分。`
  );
}

/**
 * 在指定包目录里跑一条 rushx 脚本。world.run 的 cwd 固定在仓库根且无 shell，
 * 所以用 node -e 起子进程，把 cwd 指到包目录再调 install-run-rushx.js；
 * 退出码原样透传。命令名 "node" 是字面量，脚本名与目录等运行时值进 args。
 */
async function runRushx(pkgDir: string, script: string, extra: string[]): Promise<GateOutcome> {
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
  const res = await world.run("node", ["-e", code], { timeoutMs: 1_800_000 });
  return {
    ok: res.exitCode === 0,
    failed: res.exitCode === 0 ? null : script,
    output: (res.stdout + "\n" + res.stderr).trim(),
  };
}

/** 按门禁顺序逐个跑，遇到第一个失败即停，返回该失败。 */
async function runPackageGate(pkg: PkgMeta, preferOfflineTests: boolean): Promise<GateOutcome> {
  for (const script of resolveGateScripts(pkg, preferOfflineTests)) {
    const extra = script.startsWith("test") ? testRunArgs(pkg, script) : [];
    const outcome = await runRushx(pkg.dir, script, extra);
    if (!outcome.ok) return outcome;
  }
  return { ok: true, failed: null, output: "" };
}

/**
 * 先把这批包的依赖逐个构建一遍，再让后面的阶段在"上游产物已就绪"的前提下动代码。
 *
 * 只构建、不跑完整门禁：这些包本次不改，构建是为了让下游的类型检查与打包能解析到它们的 dist。
 * 构建过的记进 `built`，新包登记后重算出的依赖里只补建没建过的那些。
 */
async function buildUpstreams(all: PkgMeta[], names: string[], built: Set<string>): Promise<void> {
  for (const name of names) {
    const pkg = all.find((p) => p.name === name);
    if (pkg === undefined || !pkg.scripts.includes("build") || built.has(name)) continue;
    built.add(name);
    const outcome = await runRushx(pkg.dir, "build", []);
    report({ pkg: name, role: "依赖构建", round: 0, ok: outcome.ok, failed: outcome.failed ?? "" }, "gates");
    if (outcome.ok) {
      verified.push(`${pkg.dir}: 依赖构建通过（本次未改动该包）`);
    } else {
      findings.push({
        where: pkg.dir,
        what: "依赖包构建失败，下游门禁无法可靠进行",
        evidence: outcome.output.slice(0, 2000),
        status: "verified",
        severity: "high",
      });
    }
  }
}

artifact.table("gates", {
  title: "各包门禁结果",
  columns: [
    { field: "pkg", label: "包" },
    { field: "role", label: "角色" },
    { field: "round", label: "轮次" },
    { field: "ok", label: "通过" },
    { field: "failed", label: "失败项" },
  ],
  key: "pkg",
});

const seedsRaw: unknown = args.packages;
const requirement = String(args.requirement ?? "").trim();
const preferOfflineTests =
  args.preferOfflineTests === undefined ? true : String(args.preferOfflineTests) !== "false";
const maxRoundsRaw = Number(args.maxRounds);
const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? Math.floor(maxRoundsRaw) : 4;

// 允许修改的范围：调用方按包名给（args.scopes），没给的按角色推断。
const scopesRaw = args.scopes;
function scopeOf(name: string, isSeed: boolean, isNew: boolean): Scope {
  if (typeof scopesRaw === "object" && scopesRaw !== null) {
    const given = (scopesRaw as Record<string, unknown>)[name];
    if (given === "none" || given === "internal" || given === "external") return given;
  }
  // 新建的包没有"既有对外面"要保护，按 external；请求点名的包按 internal（改内部可以，动对外
  // 签名要调用方明确授权）；只因依赖被牵连进来的包按 none（不许改，只做验证）。
  if (isNew) return "external";
  return isSeed ? "internal" : "none";
}

// 调用方可以按包给出内容一节的正文，把需求裁到只有本包相关的那一段。
const contentsRaw = args.contents;
function givenContent(name: string): string | null {
  if (typeof contentsRaw === "object" && contentsRaw !== null) {
    const given = (contentsRaw as Record<string, unknown>)[name];
    if (typeof given === "string" && given.trim() !== "") return given.trim();
  }
  return null;
}

phase("获取包并确定改动范围");
const registered = await rushProjects();
const all0 = await loadPackages();

if (!Array.isArray(seedsRaw) || seedsRaw.length === 0) {
  return {
    conclusion: `未提供要修改的包列表；现有包：${all0.map((p) => p.name).join("、")}。`,
    findings,
    verified,
    notCovered: ["全部——缺少 args.packages"],
  } satisfies WorkflowReport;
}
const requested = seedsRaw.map((x) => String(x));
if (requirement === "") {
  return {
    conclusion: "未提供需求描述（args.requirement）。",
    findings,
    verified,
    notCovered: ["全部——缺少 args.requirement"],
  } satisfies WorkflowReport;
}

// 要新建的：请求里出现、但 rush 还没登记的包。要更改的：请求里其余（已登记）的包，
// 以及它们的全部（间接）下游——依赖边同时看 dependencies / devDependencies / peerDependencies。
const newSeeds = requested.filter((n) => !registered.has(n));

// 新包的目录由调用方按包名给出（工作区相对路径，args.newPackageFolders），不设默认值。这类错位没有
// 门禁能发现：骨架与目录无关，五条门禁在一个放错位置的包里照样全绿，等有人看出来时它已经被当作本仓库
// 的既有结构了。所以这里宁可拒绝并说清怎么传，也不给一个「大概是 packages/」的兜底——兜底会把一次
// 显式的调用悄悄变成一次静默的错误。
const foldersRaw = args.newPackageFolders;
function newPackageFolder(name: string): string {
  if (typeof foldersRaw === "object" && foldersRaw !== null) {
    const given = (foldersRaw as Record<string, unknown>)[name];
    if (typeof given === "string" && given.trim() !== "") {
      return given.trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
    }
  }
  return "";
}
const foldersMissing = newSeeds.filter((n) => newPackageFolder(n) === "");
if (foldersMissing.length > 0) {
  const example = foldersMissing[0];
  return {
    conclusion:
      `新建包缺少目录：${foldersMissing.join("、")}。新包在本仓库没有既存目录可推断归属，请用 args.newPackageFolders ` +
      `按包名给出它的工作区相对目录后重跑，例如 {"${example}": "tests/${example}"}（测试项目）或 ` +
      `{"${example}": "packages/${example}"}（库包）。`,
    findings,
    verified,
    notCovered: ["全部——新建包没有给出目录，未落任何改动"],
  } satisfies WorkflowReport;
}
let all = all0;
let seeds = requested.filter((n) => registered.has(n));
let affectedSet = transitiveDependents(all, seeds);
let affected = sortByDeps(all, affectedSet);
let prereqs = sortByDeps(
  all,
  transitiveDependencies(all, affectedSet).filter((n) => !affectedSet.includes(n)),
);
const seedSet = new Set(seeds);
const builtUpstreams = new Set<string>();

log(
  `要新建 ${newSeeds.length} 个包${newSeeds.length > 0 ? `（${newSeeds.join("、")}）` : ""}；` +
    `要修改 ${seeds.join("、")}，连带需验证 ${affected.length - seeds.length} 个下游包；` +
    `为保证可编译，先构建 ${prereqs.length} 个依赖包。`,
);

// 先让上游产物就绪，再动任何代码：下游的类型检查与打包都要解析到这些包的 dist。
if (prereqs.length > 0) {
  phase("先构建受影响包的依赖");
  await buildUpstreams(all, prereqs, builtUpstreams);
}

if (newSeeds.length > 0) {
  phase("创建需要新建的包");
  for (const name of newSeeds) {
    const dir = newPackageFolder(name);
    const root = dir.includes("/") ? dir.slice(0, dir.indexOf("/")) : dir;
    // 同类项目 = 同一根目录下的既存项目。骨架、tags、登记位置都该照它们，而不是照 packages/ 下的库包：
    // 一个 tests/ 下的测试项目与库包的 package.json、tsconfig 与 tags 都不一样。
    const siblings = all.filter((p) => p.dir.startsWith(`${root}/`) && p.dir !== dir).map((p) => p.dir);
    const tagHint = TAGS_BY_ROOT[root];
    const builder = agent(
      `新包搭建者-${name}`,
      `你是这个 rush monorepo 的工程师，正在为本仓库新增一个项目。目录已经定好，就是 ${dir}（工作区相对路径），` +
        `不要挪到别的目录。本轮只搭骨架，不实现业务逻辑、不写测试内容：` +
        `对齐同一个根目录下既存项目的 package.json、tsconfig.json、tsconfig.app.json、tsconfig.node.json、` +
        `vite.config.ts 与 .oxlintrc.json` +
        (siblings.length > 0
          ? `（本仓库 ${root}/ 下已有：${siblings.slice(0, 3).join("、")}）`
          : `（本仓库 ${root}/ 下还没有别的项目，按需求判断这类项目该是什么形状）`) +
        `，脚本至少包含 ${GATE_SCRIPTS.join(" / ")}；并在仓库根 rush.json 的 projects 数组里登记该包，` +
        `projectFolder 用 ${dir}，tags 用 ` +
        (tagHint === undefined
          ? `该根目录下既存条目写的那些（读 rush.json 里同目录的既有条目定）`
          : `["${tagHint}"]（本仓库 ${root}/ 下的既存条目写的就是它；若它们并不一致、而本包明显属于另一类，照同类项目取并说明理由）`) +
        `。package.json 按需求声明依赖，本仓库内的包用 workspace:*。` +
        `如果某项无法确定，如实说明并升级，不要绕过。`,
    );
    const summary = await builder.ask(
      `新增包：${name}\n` +
        `目录：${dir}\n\n` +
        `需求背景：${requirement}\n\n` +
        `完成后报告：新建与修改了哪些文件、rush.json 的登记项、以及 package.json 的依赖与脚本。`,
    );
    report({ pkg: name, role: "新建包", round: 0, ok: true, failed: "" }, "gates");
    findings.push({
      where: dir,
      what: summary,
      evidence: `按 ${root}/ 下既存项目的骨架建立，并在 rush.json 的 projects 里登记为 ${dir}`,
      status: "unconfirmed",
      severity: "medium",
    });
  }

  // 登记进 rush.json 之后要 link 一次：新包的 node_modules/.bin 与 workspace 符号链接都由此建立，
  // 没有这一步 rushx 在该目录里跑不起来。link 完重新读一遍，把新包及其下游并入改动范围。
  const link = await world.run("node", ["common/scripts/install-run-rush.js", "update"], { timeoutMs: 1_800_000 });
  if (link.exitCode !== 0) {
    findings.push({
      where: "rush.json",
      what: "rush update 失败，新包未能接入工作区，后续门禁无法可靠进行",
      evidence: (link.stdout + "\n" + link.stderr).slice(0, 2000),
      status: "verified",
      severity: "high",
    });
  }

  const registeredAfter = await rushProjects();
  all = await loadPackages();
  seeds = requested.filter((n) => registeredAfter.has(n));
  affectedSet = transitiveDependents(all, seeds);
  affected = sortByDeps(all, affectedSet);
  prereqs = sortByDeps(
    all,
    transitiveDependencies(all, affectedSet).filter((n) => !affectedSet.includes(n)),
  );
  for (const n of seeds) seedSet.add(n);

  // 新包可能带来上面没见过的上游依赖（如 api-sdk-framework），在这里补建一遍再进入修改阶段。
  // 它属于本阶段：新包声明了什么依赖，是本阶段才知道的事。
  const unbuiltPrereqs = prereqs.filter((n) => !builtUpstreams.has(n));
  await buildUpstreams(all, unbuiltPrereqs, builtUpstreams);
}

// 请求了、但既不曾在 rush 里、也没能建成的包名。
const unknownSeeds = requested.filter((n) => !seeds.includes(n));
// 真的建成并登记成功的那些，用于结论与报告——newSeeds 里可能有的没建成。
const createdSeeds = seeds.filter((n) => newSeeds.includes(n));
if (seeds.length === 0) {
  return {
    conclusion: `包列表中没有任何已知包；现有包：${all.map((p) => p.name).join("、")}。`,
    findings,
    verified,
    notCovered: ["全部——包名均不认识"],
  } satisfies WorkflowReport;
}

phase("按依赖顺序修改各包并跑通门禁");
// 门禁绿过的包目录与门禁红过的包目录：末尾用它俩找一类假成功——本包门禁绿、而依赖它的下游门禁红。
const verifiedDirs = new Set<string>();
const gateFailedDirs = new Set<string>();
for (const name of affected) {
  const pkg = all.find((p) => p.name === name);
  if (pkg === undefined) continue;
  const isSeed = seedSet.has(name);
  const upstreamAffected = pkg.deps.filter((d) => affectedSet.includes(d));
  const scope = scopeOf(name, isSeed, newSeeds.includes(name));
  const changedBefore = await changedFilesIn(pkg.dir);
  const diffBefore = await diffOf(pkg.dir);

  const worker = agent(
    `包修改者-${name}`,
    `你是这个 rush monorepo 的工程师，只修改 ${pkg.dir} 目录下的代码。` +
      `门禁由你自己在这个包目录里跑：交回来之前必须亲自跑通，` +
      `跑不通就自己改到通——每一轮都该是你自己跑门禁、自己修，而不是等我告诉你哪一条挂了。` +
      `工作流会在你交回之后再跑一遍作为确认。` +
      `如需自动格式化，可在该包目录下运行 node ../../common/scripts/install-run-rushx.js format。` +
      `每一轮都必须给出产出说明（改了什么、依据是什么、你实际跑了哪些门禁命令、结果如何）；空回复会让本包被记为未完成。` +
      (isSeed
        ? `如果某个门禁在你的能力范围内无法通过，如实说明并升级，不要绕过检查或伪造结果。`
        : `如果本包其实不需要改动，明确说明「无需改动」，不要为改而改。`),
  );

  let feedback = "";
  let stalled = false;
  let lastEmpty = false;
  let passed = false;
  let gateScripts = resolveGateScripts(pkg, preferOfflineTests);
  for (let round = 1; round <= maxRounds; round += 1) {
    // 需求只随第一轮发出：同一个子代理跨轮保留上下文，每轮重发整段需求除了多花 token，
    // 还会让后面每一轮的提问看起来仍是"初始提示词"，与上一轮的答复对不上。后续轮次只递这一轮要修的东西。
    const lines: string[] = [];
    if (round === 1) {
      // 三节：你的任务 / 具体需求 / 其他。每一节只写这个子代理这一轮真正需要的东西：授权范围与上游事实各占
      // 一行、互不推导——此前它们挤在同一句里（"internal（下游包）：你的上游修改了对外接口或行为…"），范围
      // 一栏被读成"上游改过"，上游一个都没动的需求包也拿到了下游包的说明书。需求那一节按本包在本次改动里的
      // 角色选一种。
      //
      // 首行不再单列【本轮任务概要】：范围与包名就在下面两行里，角色由【具体需求】自己那一句点明，
      // 再列一遍只是把同一件事说两次。重试轮没有这三节，那一边的轮次与范围标记留在【门禁仍未通过】之前。
      lines.push("【你的任务】");
      lines.push(`你负责的包是：${name}（${pkg.dir}）${newSeeds.includes(name) ? "，本次新建" : ""}。`);
      lines.push(`你允许修改的范围是：${scopeLine(scope)}`);
      lines.push(...(await upstreamLines(pkg, all, affectedSet)));
      if (scope !== "none") lines.push("完成下面【具体需求】里属于本包的那部分内容。");
      lines.push(
        scope === "none"
          ? "同时保持门禁通过：跑通【其他】里列出的那几条，确认本包在现状下全部通过。"
          : "同时保持门禁通过：【其他】里列出的那几条，每轮都由你自己在本包目录下跑通再交回。",
      );
      lines.push("");
      lines.push("【具体需求】");
      lines.push(...demandLines(pkg, scope, isSeed, upstreamAffected, requirement, givenContent(name)));
      lines.push("");
      lines.push("【其他】");
      // 点名本轮判定用的那几条门禁，而不是笼统的"test"。包自己的 test 脚本可能包含 live 段
      // （会打真实外部服务），而本轮只按离线子集判定；不点名，子代理就会顺手把 live 也跑了。
      lines.push(
        `- 门禁：${gateScripts.join(" / ")}。都在本包目录下用 ` +
          `node ../../common/scripts/install-run-rushx.js <脚本名> 跑；含 live 标签的测试不在本次判定内，不要跑。`,
      );
      lines.push("- 门禁失败必须真修：不许关规则、改配置、删测试或放宽断言让它变绿。");
      lines.push(`- ${await stateLine(pkg)}`);
      lines.push("- 报告：说清改了什么、依据是什么、你实际跑了哪几条门禁命令、结果如何；空回复会让本包被记为未完成。");
    } else {
      lines.push(`${pkg.dir}｜第 ${round} 轮｜范围 ${scope}｜任务与第一轮相同`);
      lines.push("");
      lines.push("【门禁仍未通过】");
      lines.push(feedback);
    }

    // 包依赖是在 package.json 里改的，而 workspace 符号链接由 rush update 建立：
    // 改了依赖却不重连，rushx 会在旧链接上解析不到新的 workspace 包。所以前后各读一次 package.json，
    // 变了才重连并刷新本包元信息（脚本名也可能一起变了）。
    const beforePkgJson = await files.read(`${pkg.dir}/package.json`);
    const summary = await worker.ask(lines.join("\n"));
    const afterPkgJson = await files.read(`${pkg.dir}/package.json`);
    if (afterPkgJson !== beforePkgJson) {
      const relink = await world.run("node", ["common/scripts/install-run-rush.js", "update"], { timeoutMs: 1_800_000 });
      if (relink.exitCode !== 0) {
        feedback = (relink.stdout + "\n" + relink.stderr).slice(0, OUTPUT_LIMIT);
        continue;
      }
      const refreshed = (await loadPackages()).find((p) => p.name === name);
      if (refreshed !== undefined) {
        pkg.deps = refreshed.deps;
        pkg.scripts = refreshed.scripts;
        pkg.scriptCmds = refreshed.scriptCmds;
        gateScripts = resolveGateScripts(pkg, preferOfflineTests);
      }
    }

    // 子代理可以给出空结果（模型空回复：整个回合没有任何文本、也没有任何工具调用）。那既不是
    // "无需改动"的表示，也不能算完成——门禁对空骨架照样变绿，一旦放行整包就会被记成"已验证"，
    // 而需求一个字都没落地。空结果只能当失败重试，并把这件事记进结果表。
    if (summary.trim() === "") {
      lastEmpty = true;
      feedback = "你上一轮没有给出任何产出说明（回复为空），无法判断你是否做了改动。请在本包内完成改动，并在结束时说明：改了哪些文件、依据是什么、你实际运行过哪些检查、结果如何；若判断本包无需改动，也要明确说明理由。";
      report({ pkg: name, role: isSeed ? "需求包" : "下游包", round, ok: false, failed: "未提交产出说明" }, "gates");
      continue;
    }
    lastEmpty = false;

    const outcome = await runPackageGate(pkg, preferOfflineTests);
    report(
      {
        pkg: name,
        role: isSeed ? "需求包" : "下游包",
        round,
        ok: outcome.ok,
        failed: outcome.failed ?? "",
      },
      "gates",
    );
    if (outcome.ok) {
      verifiedDirs.add(pkg.dir);
      findings.push({
        where: pkg.dir,
        what: summary,
        evidence: `范围 ${scope}；在 ${pkg.dir} 依次跑 ${gateScripts.join(" / ")} 全部通过`,
        status: "verified",
        severity: isSeed ? "medium" : "low",
      });
      verified.push(`${pkg.dir}（范围 ${scope}）: ${gateScripts.join(" / ")} 通过`);
      passed = true;
      break;
    }
    // 门禁输出与上一轮逐字相同，就是这一轮没有任何进展（上一轮曾这样把同一段报错连问四轮）。
    // 再问下去只是重复计费，所以就此收手，把"未通过"如实记下，而不是把轮次耗满。
    if (round > 1 && outcome.output === feedback) {
      stalled = true;
      feedback = outcome.output;
      break;
    }
    feedback = outcome.output;
  }
  if (!passed) {
    findings.push({
      where: pkg.dir,
      what: lastEmpty
        ? `${maxRounds} 轮都没有提交产出说明（子代理每一轮都回复为空），没有任何证据表明需求已在本包落地`
        : stalled
          ? "门禁未通过，且失败输出与上一轮逐字相同——本轮已无进展，提前停止重试"
          : `${maxRounds} 轮内未跑通门禁`,
      evidence: lastEmpty ? "每一轮 ask 的返回值 trim 之后都是空字符串" : feedback.slice(0, 2000),
      status: "unconfirmed",
      severity: "high",
    });
    gateFailedDirs.add(pkg.dir);
  }

  // none 范围是"一个文件都不许动"。文件列表看得到新增，差异文本看得到已脏文件的内容变化，
  // 两者一起比对，越界就是可判定的（所以标 verified，而不是靠子代理自述）。
  if (scope === "none") {
    const changedAfter = await changedFilesIn(pkg.dir);
    const diffAfter = await diffOf(pkg.dir);
    const added = changedAfter.filter((p) => !changedBefore.includes(p));
    if (added.length > 0 || diffAfter !== diffBefore) {
      findings.push({
        where: pkg.dir,
        what:
          `范围是 none（不许改动本包），但本包之后发生了变化：` +
          (added.length > 0 ? `多出 ${added.length} 个未提交文件（${added.slice(0, 8).join("、")}）` : "") +
          (diffAfter !== diffBefore ? `${added.length > 0 ? "，" : ""}已有文件的内容也变了` : ""),
        evidence: `改动前 ${changedBefore.length} 个文件；改动后 ${changedAfter.length} 个文件（git status 按 ${pkg.dir}/ 过滤），差异文本${diffAfter === diffBefore ? "未变" : "已变"}`,
        status: "verified",
        severity: "high",
      });
    }
  }
}

// 新包的骨架自己能过全部五道门禁（入口写成 `export {}` 也过得了 tsc，`--passWithNoTests` 让空测试也绿），
// 所以"本包门禁通过"并不足以判定它提供了需求要的公开面；真正判定它的是消费者能不能编译。
// 出现"本包绿、依赖它的下游红"这种矛盾时就补一条 findings，别让报告替一个空壳背书。
for (const dir of verifiedDirs) {
  const owner = all.find((p) => p.dir === dir);
  if (owner === undefined) continue;
  const broken = all.filter(
    (q) => affectedSet.includes(q.name) && q.deps.includes(owner.name) && gateFailedDirs.has(q.dir),
  );
  if (broken.length === 0) continue;
  findings.push({
    where: dir,
    what: `本包门禁通过，但依赖它的 ${broken.map((q) => q.name).join("、")} 门禁未通过：本包要提供的公开面很可能并不完整，不能只凭本包门禁判为需求已完成`,
    evidence: `在 ${dir} 跑 ${GATE_SCRIPTS.join(" / ")} 全绿；而 ${broken.map((q) => q.dir).join("、")} 的门禁失败`,
    status: "unconfirmed",
    severity: "high",
  });
}

// 结论里的"未通过项"要同时包含两类：没确认的；以及确定性确认了的严重项（依赖包构建失败、
// none 范围被越界这类 verified/high）。只按 unconfirmed 过滤会把后者漏掉，把一次真的失败写成成功。
const failedFindings = findings.filter((f) => f.status === "unconfirmed" || f.severity === "high");
if (preferOfflineTests) {
  notCovered.push(
    "脚本的判定只用离线的门禁子集（test:unit / test:offline / test:run），含 live 标签的测试不在其中；" +
      "子代理的报告里若提到自己跑了更宽的 test，那些结果不属本次判定。如需覆盖请以 preferOfflineTests=false 重跑",
  );
}
if (prereqs.length > 0) {
  notCovered.push(`依赖包 ${prereqs.join("、")} 只做了构建，未跑完整门禁（本次未改动它们）`);
}
notCovered.push("未做行为正确性的人工判断：门禁通过不等于需求实现完全无误");
notCovered.push(
  "internal / external 只写进了给子代理的规则，脚本没有自动核验：只自动查了 none 范围有没有被越界",
);
if (unknownSeeds.length > 0) {
  notCovered.push(`以下包名未被识别、也未建成，予以忽略：${unknownSeeds.join("、")}`);
}

const conclusion =
  failedFindings.length === 0
    ? `${createdSeeds.length > 0 ? `新建 ${createdSeeds.join("、")}；` : ""}需求包 ${seeds.join("、")} 及其 ${
        affected.length - seeds.length
      } 个下游包的门禁（${preferOfflineTests ? "离线门禁" : "完整门禁"}）全部通过。`
    : `存在未通过项：${failedFindings.map((f) => f.where).join("、")}，门禁未全部通过。`;

// description 有 500 字上限，而 requirement 是调用方给的、长度不受脚本控制：这里只用脚本自己的有界
// 信息。曾经把需求原文整个拼进 description，2402 字超限，发布抛错，连带整份报告与 return 一起丢掉。
const reportBody = [
  `# 包改动与门禁验证：${seeds.join("、")}`,
  "",
  `**需求**：${requirement}`,
  "",
  createdSeeds.length > 0 ? `**新建**：${createdSeeds.join("、")}` : "",
  `**结论**：${conclusion}`,
  "",
  "## 改动与验证",
  ...findings.map((f) => `- \`${f.where}\`（${f.status} / ${f.severity}）：${clip(f.what, 900)}`),
  "",
  "## 逐包门禁",
  ...verified.map((v) => `- ${v}`),
  "",
  "## 未覆盖",
  ...notCovered.map((n) => `- ${n}`),
]
  .filter((line) => line !== "")
  .join("\n");
const reportDescription = `需求包 ${seeds.join("、")} 与 ${affected.length - seeds.length} 个下游包的逐包门禁结果与依赖顺序。`;

// 内容产物发布被拒是"补一次"的机会，不是错误：发布失败绝不能连带丢掉这次运行的结论与 return。
try {
  await artifact.markdown("report", reportBody, {
    title: "包改动与门禁验证报告",
    description: reportDescription,
    primary: true,
  });
} catch {
  await artifact.markdown("report", reportBody, { title: "包改动与门禁验证报告", primary: true });
}

return {
  conclusion,
  findings,
  verified,
  notCovered,
} satisfies WorkflowReport;
