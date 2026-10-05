/* zcode-workflow
description: 按需求修改一个或多个包，逐个包（含受影响的上下游包）跑通 format/lint/typecheck/test/build
  门禁，失败则把报错喂回给修改者重试。
whenToUse: 在 rush monorepo 中按需求改动某个或某几个包，并需要连带处理其受影响的下游包、逐包验证门禁是否通过时。
args:
  maxRounds:
    type: number
    description: 每个包改-验证循环的最大轮次。默认 4。
    default: 4
  packages:
    type: json
    description: 要修改的包名数组，例如 ["tencent-doc-sdk"]。
    required: true
  preferOfflineTests:
    type: boolean
    description: 是否只跑离线测试（test:unit / test:offline / test:run），避免 live 测试依赖环境变量与网络。默认 true。
    default: true
  requirement:
    type: string
    description: 本次修改的需求描述。
    required: true
*/
interface PkgMeta {
  /** 包名，例如 tencent-doc-sdk。 */
  name: string;
  /** 工作区相对目录，例如 packages/tencent-doc-sdk。 */
  dir: string;
  /** package.json 里声明的运行时依赖名。 */
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

// 门禁的构成与轮次上限是控制流常量，不进任何提示词文本：
// 将来调整它们不会让已完成的子代理结果失效。
const GATE_SCRIPTS = ["format:check", "lint", "typecheck", "test", "build"];
const OUTPUT_LIMIT = 120000;

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
      scripts?: Record<string, string>;
    };
    if (typeof raw.name !== "string") continue;
    out.push({
      name: raw.name,
      dir: p.replace(/\/package\.json$/, ""),
      deps: Object.keys(raw.dependencies ?? {}),
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

/** 该包实际要跑的门禁脚本（跳过不存在者）。 */
function resolveGateScripts(pkg: PkgMeta, preferOfflineTests: boolean): string[] {
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

const all = await loadPackages();
const known = new Set(all.map((p) => p.name));
const seedsRaw: unknown = args.packages;
const requirement = String(args.requirement ?? "").trim();
const preferOfflineTests =
  args.preferOfflineTests === undefined ? true : String(args.preferOfflineTests) !== "false";
const maxRoundsRaw = Number(args.maxRounds);
const maxRounds = Number.isFinite(maxRoundsRaw) && maxRoundsRaw > 0 ? Math.floor(maxRoundsRaw) : 4;

if (!Array.isArray(seedsRaw) || seedsRaw.length === 0) {
  return {
    conclusion: `未提供要修改的包列表；现有包：${[...known].join("、")}。`,
    findings: [],
    verified: [],
    notCovered: ["全部——缺少 args.packages"],
  } satisfies WorkflowReport;
}
const seeds = seedsRaw.map((x) => String(x)).filter((n) => known.has(n));
const unknownSeeds = seedsRaw.map((x) => String(x)).filter((n) => !known.has(n));
if (seeds.length === 0) {
  return {
    conclusion: `包列表中没有任何已知包；现有包：${[...known].join("、")}。`,
    findings: [],
    verified: [],
    notCovered: ["全部——包名均不认识"],
  } satisfies WorkflowReport;
}
if (requirement === "") {
  return {
    conclusion: "未提供需求描述（args.requirement）。",
    findings: [],
    verified: [],
    notCovered: ["全部——缺少 args.requirement"],
  } satisfies WorkflowReport;
}

const affectedSet = transitiveDependents(all, seeds);
const affected = sortByDeps(all, affectedSet);
const prereqs = sortByDeps(
  all,
  transitiveDependencies(all, affectedSet).filter((n) => !affectedSet.includes(n)),
);
const seedSet = new Set(seeds);

log(
  `需求包 ${seeds.join("、")}；连带需验证 ${
    affected.length - seeds.length
  } 个下游包；为保证可编译，先构建 ${prereqs.length} 个依赖包。`,
);

const findings: Finding[] = [];
const verified: string[] = [];
const notCovered: string[] = [];

const buildablePrereqs = prereqs.filter((name) => {
  const pkg = all.find((p) => p.name === name);
  return pkg !== undefined && pkg.scripts.includes("build");
});
if (buildablePrereqs.length > 0) {
  phase("先构建受影响包的依赖");
  for (const name of buildablePrereqs) {
    const pkg = all.find((p) => p.name === name);
    if (pkg === undefined) continue;
    const outcome = await runRushx(pkg.dir, "build", []);
    report(
      { pkg: name, role: "依赖构建", round: 0, ok: outcome.ok, failed: outcome.failed ?? "" },
      "gates",
    );
    if (!outcome.ok) {
      findings.push({
        where: pkg.dir,
        what: "依赖包构建失败，下游门禁无法可靠进行",
        evidence: outcome.output.slice(0, 2000),
        status: "unconfirmed",
        severity: "high",
      });
    }
  }
}

phase("逐个包修改并跑通各自的门禁");
for (const name of affected) {
  const pkg = all.find((p) => p.name === name);
  if (pkg === undefined) continue;
  const isSeed = seedSet.has(name);
  const upstreamAffected = pkg.deps.filter((d) => affectedSet.includes(d));

  const worker = agent(
    `包修改者-${name}`,
    `你是这个 rush monorepo 的工程师，只修改 ${pkg.dir} 目录下的代码。` +
      `本工作流会在你改完后统一运行并判定门禁（${GATE_SCRIPTS.join(" / ")}），` +
      `你不要自行运行这些门禁命令来判定是否通过，把回合用在读代码和改代码上；` +
      `如需自动格式化，可在该包目录下运行 node ../../common/scripts/install-run-rushx.js format。` +
      (isSeed
        ? `如果某个门禁在你的能力范围内无法通过，如实说明并升级，不要绕过检查或伪造结果。`
        : `如果本包其实不需要改动，明确说明「无需改动」，不要为改而改。`),
  );

  let feedback = "none";
  let passed = false;
  const gateScripts = resolveGateScripts(pkg, preferOfflineTests);
  for (let round = 1; round <= maxRounds; round += 1) {
    const lines: string[] = [];
    if (isSeed) {
      lines.push(`需求：${requirement}`);
      lines.push("");
      lines.push(`请在本包 ${pkg.dir} 内实现该需求中属于本包的部分，只改动本包的文件。`);
      if (upstreamAffected.length > 0) {
        lines.push(`注意：本包依赖的以下包也已改动，需保持一致：${upstreamAffected.join("、")}。`);
      }
    } else {
      lines.push(`本包 ${pkg.dir} 依赖了刚按需求「${requirement}」改动的上游包：${upstreamAffected.join("、")}。`);
      lines.push("请检查本包是否需要随之调整（编译、类型、行为一致性）；需要就改，不需要就明确说明无需改动。");
    }
    if (feedback !== "none") {
      lines.push("");
      lines.push(`上一轮门禁失败，输出如下，请据此修复：`);
      lines.push(feedback);
    }

    const summary = await worker.ask(lines.join("\n"));
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
      findings.push({
        where: pkg.dir,
        what: summary,
        evidence: `在 ${pkg.dir} 依次跑 ${gateScripts.join(" / ")} 全部通过`,
        status: "verified",
        severity: isSeed ? "medium" : "low",
      });
      verified.push(`${pkg.dir}: ${gateScripts.join(" / ")} 通过`);
      passed = true;
      break;
    }
    feedback = outcome.output;
  }
  if (!passed) {
    findings.push({
      where: pkg.dir,
      what: `${maxRounds} 轮内未跑通门禁（停在 ${feedback === "none" ? "未知" : "失败脚本"}）`,
      evidence: feedback.slice(0, 2000),
      status: "unconfirmed",
      severity: "high",
    });
  }
}

const failedFindings = findings.filter((f) => f.status === "unconfirmed");
if (preferOfflineTests) {
  notCovered.push("含 live 标签的测试未运行（默认只跑 test:unit）；如需覆盖请以 preferOfflineTests=false 重跑");
}
if (prereqs.length > 0) {
  notCovered.push(`依赖包 ${prereqs.join("、")} 只做了构建，未跑完整门禁（本次未改动它们）`);
}
notCovered.push("未做行为正确性的人工判断：门禁通过不等于需求实现完全无误");
if (unknownSeeds.length > 0) {
  notCovered.push(`以下包名未被识别，予以忽略：${unknownSeeds.join("、")}`);
}

const conclusion =
  failedFindings.length === 0
    ? `需求包 ${seeds.join("、")} 及其 ${affected.length - seeds.length} 个下游包的门禁（${
        preferOfflineTests ? "离线门禁" : "完整门禁"
      }）全部通过。`
    : `存在未通过项：${failedFindings.map((f) => f.where).join("、")}，门禁未全部通过。`;

await artifact.markdown(
  "report",
  [
    `# 包改动与门禁验证：${seeds.join("、")}`,
    "",
    `**需求**：${requirement}`,
    "",
    `**结论**：${conclusion}`,
    "",
    "## 改动与验证",
    ...findings.map((f) => `- \`${f.where}\`（${f.status} / ${f.severity}）：${f.what}`),
    "",
    "## 逐包门禁",
    ...verified.map((v) => `- ${v}`),
    "",
    "## 未覆盖",
    ...notCovered.map((n) => `- ${n}`),
  ].join("\n"),
  {
    title: "包改动与门禁验证报告",
    description: `需求「${requirement}」的改动范围、逐包门禁结果与依赖顺序。`,
    primary: true,
  },
);

return {
  conclusion,
  findings,
  verified,
  notCovered,
} satisfies WorkflowReport;
