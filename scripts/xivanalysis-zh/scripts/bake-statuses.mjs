#!/usr/bin/env node
/**
 * 把 xivanalysis 的 STATUSES（英文名 + icon 号）与国服 xivapi 的简中名烘焙成静态数据。
 *
 * 生成的 `src/data/generated/statuses.json` 会被 `src/data/statuses.ts` 直接 import，
 * Vite 在构建时内联；`statuses.meta.json` 只给本脚本与校验命令读，不进产物。
 *
 * 用法：
 *   node scripts/bake-statuses.mjs                     # 烘焙（需要网络）
 *   node scripts/bake-statuses.mjs --sha <sha>         # 固定上游 commit
 *   node scripts/bake-statuses.mjs --check-upstream    # 只比 meta 里的 commit 与上游分支
 *   node scripts/bake-statuses.mjs --verify            # 离线校验 data 与 meta 是否一致
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import ts from 'typescript';

const PKG_DIR = resolve(import.meta.dirname, '..');
const DATA_DIR = join(PKG_DIR, 'src', 'data', 'generated');
const DATA_FILE = join(DATA_DIR, 'statuses.json');
const META_FILE = join(DATA_DIR, 'statuses.meta.json');
const CACHE_DIR = join(PKG_DIR, '.cache', 'statuses');

const REPO_DEFAULT = 'xivanalysis/xivanalysis';
const REF_DEFAULT = 'dawntrail';
const STATUS_DIR = 'src/data/STATUSES';
const ICON_FILE = 'src/data/icon.ts';
const STATUS_INDEX = `${STATUS_DIR}/index.ts`;
const LAYERS_INDEX = `${STATUS_DIR}/layers/index.ts`;
const CN_HOST = 'https://xivapi-v2.xivcdn.com/api';
const CN_CHUNK = 100;
const MIN_ENTRIES = 300;

const args = parseArgs(process.argv.slice(2));
const log = (message) => console.log(`[bake-statuses] ${message}`);
const warn = (message) => console.warn(`[bake-statuses] ${message}`);

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}: ${url}`);
    this.status = status;
  }
}

main().catch((error) => {
  console.error(`[bake-statuses] 失败: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});

async function main() {
  if (args.help) {
    printHelp();
    return;
  }
  if (args.verify) {
    await verify();
    return;
  }
  if (args.checkUpstream) {
    await checkUpstream();
    return;
  }

  const commit = args.sha || (await resolveCommit(args.repo, args.ref));
  log(`上游 ${args.repo}@${args.ref} -> ${commit}`);

  const sources = await readSources(args.repo, commit);
  const parsed = parseStatuses(sources);
  const ids = [...new Set(parsed.variants.map((v) => v.id).filter((id) => id > 0))].sort((a, b) => a - b);
  log(`解析到 ${parsed.rootCount} 个 root 条目、${parsed.variants.length} 个变体，去重后 ${ids.length} 个 id；开始查国服`);

  const cn = await fetchCnNames(ids);
  log(`国服返回 ${cn.byId.size}/${ids.length} 行${cn.version ? `（${cn.version}）` : ''}`);

  const result = buildResult({ repo: args.repo, ref: args.ref, commit, sources, parsed, cn, allowMissing: args.allowMissing });
  await writeOutputs(result.dataText, result.metaText);
  log(`写入 ${entriesSummary(result.meta)}`);
  if (result.meta.warnings.missingZh.length) warn(`缺中文（前 ${result.meta.warnings.missingZh.length} 条）: ${result.meta.warnings.missingZh.join(', ')}`);
  if (result.meta.warnings.ambiguousNames.length)
    warn(`同名多义（前 ${result.meta.warnings.ambiguousNames.length} 条）: ${result.meta.warnings.ambiguousNames.join(', ')}`);
  if (result.meta.counts.iconMismatch) warn(`上游 icon 号与国服不一致 ${result.meta.counts.iconMismatch} 条（匹配仍用上游 icon；名称优先）`);
}

function parseArgs(argv) {
  const out = {
    ref: REF_DEFAULT,
    repo: REPO_DEFAULT,
    sha: '',
    baseUrl: '',
    checkUpstream: false,
    verify: false,
    allowMissing: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} 需要一个参数`);
      return argv[++i];
    };
    switch (arg) {
      case '--ref':
        out.ref = next();
        break;
      case '--repo':
        out.repo = next();
        break;
      case '--sha':
        out.sha = next();
        break;
      case '--base-url':
        out.baseUrl = next().replace(/\/+$/, '');
        break;
      case '--check-upstream':
        out.checkUpstream = true;
        break;
      case '--verify':
        out.verify = true;
        break;
      case '--allow-missing':
        out.allowMissing = true;
        break;
      case '--help':
      case '-h':
        out.help = true;
        break;
      default:
        throw new Error(`未知参数: ${arg}（--help 查看用法）`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`用法: node scripts/bake-statuses.mjs [选项]

  --ref <ref>          上游分支/标签（默认 ${REF_DEFAULT}）
  --repo <owner/repo> 上游仓库（默认 ${REPO_DEFAULT}）
  --sha <sha>          直接指定 commit，跳过解析分支
  --base-url <url>     源文件 URL 前缀（默认先 raw.githubusercontent.com，再 jsDelivr）
  --check-upstream     只比较 meta 里的 commit 与上游分支，不写文件
  --verify             离线校验 statuses.json 与 meta 的 hash、条目数、字段
  --allow-missing      国服缺中文时不失败（默认失败，避免提交不完整数据）
`);
}

async function verify() {
  const problems = [];
  let dataBytes;
  let meta;
  try {
    dataBytes = await readFile(DATA_FILE);
    meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  } catch (error) {
    throw new Error(`读不到 ${DATA_FILE} 或 ${META_FILE}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const entries = JSON.parse(dataBytes.toString('utf8'));
  if (!Array.isArray(entries)) problems.push('statuses.json 顶层不是数组');
  if (meta.dataSha256 !== sha256(dataBytes)) problems.push(`dataSha256 不匹配: meta=${meta.dataSha256} actual=${sha256(dataBytes)}`);
  if (meta.entriesCount !== entries.length) problems.push(`entriesCount 不匹配: meta=${meta.entriesCount} actual=${entries.length}`);
  if (!Array.isArray(entries) || entries.length < MIN_ENTRIES) problems.push(`条目数过少: ${entries.length}`);

  if (Array.isArray(entries)) {
    for (const [index, entry] of entries.entries()) {
      if (!entry || typeof entry !== 'object') {
        problems.push(`entries[${index}] 不是对象`);
        continue;
      }
      if (!Number.isInteger(entry.id) || entry.id <= 0) problems.push(`entries[${index}].id 非法`);
      if (typeof entry.en !== 'string' || !entry.en) problems.push(`entries[${index}].en 为空`);
      if (typeof entry.zh !== 'string' || !entry.zh) problems.push(`entries[${index}].zh 为空`);
      if (entry.iconId != null && (!Number.isInteger(entry.iconId) || entry.iconId <= 0)) problems.push(`entries[${index}].iconId 非法`);
    }
  }

  if (problems.length) {
    for (const problem of problems) console.error(`[bake-statuses] ${problem}`);
    process.exitCode = 1;
    return;
  }
  log(`ok: ${entries.length} 条，sha256=${meta.dataSha256}`);
}

async function checkUpstream() {
  const meta = JSON.parse(await readFile(META_FILE, 'utf8'));
  const recorded = meta?.upstream?.commit;
  if (!recorded) throw new Error(`${META_FILE} 缺少 upstream.commit`);
  const commit = args.sha || (await resolveCommit(args.repo, args.ref));
  if (commit === recorded) {
    log(`ok: 上游仍是 ${recorded}`);
    return;
  }
  console.error(`[bake-statuses] 上游已变化: ${recorded} -> ${commit}（运行 rushx bake:statuses 更新）`);
  process.exitCode = 1;
}

async function resolveCommit(repo, ref) {
  const headers = { 'user-agent': 'xivanalysis-zh-bake' };
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  try {
    const response = await fetchWithRetry(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref)}`, { headers, tries: 3 });
    const body = await response.json();
    if (typeof body?.sha === 'string' && body.sha) return body.sha;
  } catch (error) {
    warn(`解析分支失败（${error instanceof Error ? error.message : String(error)}），改用 git ls-remote`);
  }

  try {
    const output = execFileSync('git', ['ls-remote', `https://github.com/${repo}.git`, `refs/heads/${ref}`], { encoding: 'utf8' });
    const sha = output.trim().split(/\s+/)[0];
    if (sha) return sha;
  } catch (error) {
    warn(`git ls-remote 失败: ${error instanceof Error ? error.message : String(error)}`);
  }
  throw new Error(`无法解析 ${repo}@${ref}；可用 --sha 直接指定 commit`);
}

async function readSources(repo, commit) {
  const files = new Map();
  const queue = [STATUS_INDEX, ICON_FILE];
  const seen = new Set();

  while (queue.length) {
    const path = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    const text = await fetchSourceFile(repo, commit, path);
    if (text == null) continue; // 目录导入的候选（如 ./root.ts）404，跳过
    files.set(path, text);
    for (const candidate of relativeImports(path, text)) {
      if (!candidate.startsWith(`${STATUS_DIR}/`) || seen.has(candidate)) continue;
      queue.push(candidate);
    }
  }

  if (!files.has(STATUS_INDEX)) throw new Error(`没抓到 ${STATUS_INDEX}`);
  return files;
}

function relativeImports(path, text) {
  const source = parseSource(text);
  const out = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    const base = posix.normalize(posix.join(posix.dirname(path), specifier));
    const candidates = specifier.endsWith('.ts') ? [base] : [`${base}.ts`, `${base}/index.ts`];
    for (const candidate of candidates) out.push(candidate);
  }
  return out;
}

async function fetchSourceFile(repo, commit, path) {
  const cacheFile = join(CACHE_DIR, commit, path);
  try {
    return await readFile(cacheFile, 'utf8');
  } catch {
    // 缓存未命中，继续抓取。
  }

  const urls = args.baseUrl
    ? [`${args.baseUrl}/${path}`]
    : [`https://raw.githubusercontent.com/${repo}/${commit}/${path}`, `https://cdn.jsdelivr.net/gh/${repo}@${commit}/${path}`];

  let notFound = true;
  let lastError;
  for (const url of urls) {
    try {
      const response = await fetchWithRetry(url, { tries: 4 });
      const text = await response.text();
      await mkdir(dirname(cacheFile), { recursive: true });
      await writeFile(cacheFile, text, 'utf8');
      return text;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status === 404) continue;
      notFound = false;
    }
  }
  if (notFound && lastError instanceof HttpError && lastError.status === 404) return undefined;
  throw lastError ?? new Error(`抓取失败: ${path}`);
}

async function fetchWithRetry(url, { headers = {}, tries = 4 } = {}) {
  let delay = 500;
  let lastError;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const response = await fetch(url, { headers });
      if (response.ok) return response;
      const error = new HttpError(response.status, url);
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError && error.status !== 429 && error.status < 500) throw error;
    }
    if (attempt < tries - 1) {
      await sleep(delay);
      delay *= 2;
    }
  }
  throw lastError ?? new Error(`请求失败: ${url}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseSource(text) {
  return ts.createSourceFile('source.ts', text, ts.ScriptTarget.Latest, true);
}

function parseStatuses(sources) {
  const warnings = [];
  const rootGroups = new Map();

  for (const [path, text] of sources) {
    if (!isRootFile(path)) continue;
    const group = posix.basename(path, '.ts');
    const parsed = parseRootFile(path, text);
    if (parsed) rootGroups.set(group, parsed);
  }
  if (!rootGroups.size) throw new Error('没有解析到任何 root 状态文件');

  resolveRootAliases(rootGroups, warnings);

  const rootOrder = parseRootOrder(sources.get(`${STATUS_DIR}/root/index.ts`) ?? '', rootGroups);
  const flatRoot = new Map();
  for (const group of rootOrder) {
    for (const [key, entry] of rootGroups.get(group)?.entries ?? []) flatRoot.set(key, entry);
  }

  const layerPaths = parseLayerOrder(sources.get(LAYERS_INDEX) ?? '');
  const variants = [...flatRoot.entries()].map(([key, entry]) => ({ key, ...entry, patch: 'root' }));
  const current = new Map(flatRoot);

  for (const path of layerPaths) {
    const text = sources.get(path);
    if (text == null) {
      warnings.push(`${path}: 没抓到层文件`);
      continue;
    }
    const layer = parseLayerFile(path, text, rootGroups, warnings);
    if (!layer) continue;
    for (const [key, partial] of layer.data) {
      const previous = current.get(key);
      const next = previous ? { ...previous, ...partial } : partial.id && partial.name && partial.iconId ? partial : undefined;
      if (!next) {
        warnings.push(`${layer.patch} ${key}: 缺少基准条目且字段不全`);
        continue;
      }
      current.set(key, next);
      if (previous && previous.id === next.id && previous.name === next.name && previous.iconId === next.iconId) continue;
      variants.push({ key, ...next, patch: layer.patch });
    }
  }

  return { rootCount: flatRoot.size, variants: dedupeVariants(variants), warnings };
}

function isRootFile(path) {
  return path.startsWith(`${STATUS_DIR}/root/`) && path.endsWith('.ts') && !path.endsWith('/index.ts');
}

function parseRootFile(path, text) {
  const source = parseSource(text);
  const object = findExportedObject(source);
  if (!object) {
    warn(`${path}: 找不到导出的 status 对象，跳过`);
    return null;
  }

  const entries = new Map();
  const aliases = new Map();
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property)) continue;
    const key = propertyName(property.name);
    if (!key) continue;
    if (ts.isObjectLiteralExpression(property.initializer)) {
      const entry = readStatusLiteral(property.initializer);
      if (entry) entries.set(key, entry);
      else warn(`${path}: ${key} 缺少 id/name/icon，跳过`);
    } else {
      aliases.set(key, property.initializer.getText());
    }
  }
  return { entries, aliases };
}

function readStatusLiteral(object) {
  const idNode = getProperty(object, 'id');
  const nameNode = getProperty(object, 'name');
  const iconNode = getProperty(object, 'icon');
  if (!idNode || !nameNode || !iconNode) return null;

  const id = readNumber(idNode);
  const name = readString(nameNode);
  const iconId = readIcon(iconNode);
  if (id == null || name == null || iconId == null || id < 0) return null;
  return { id, name, iconId };
}

function resolveRootAliases(groups, warnings) {
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    for (const info of groups.values()) {
      for (const [key, expression] of info.aliases) {
        const entry = resolveAlias(expression, groups);
        if (entry?.name != null && entry.iconId != null) {
          info.entries.set(key, { id: entry.id, name: entry.name, iconId: entry.iconId });
          info.aliases.delete(key);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }
  for (const [group, info] of groups) {
    for (const [key, expression] of info.aliases) warnings.push(`${group}.${key}: 无法解析别名 ${expression}`);
  }
}

function resolveAlias(expression, groups) {
  const parts = expression.split('.').map((part) => part.trim());
  if (parts.length < 2) return undefined;
  const [group, key, ...rest] = parts;
  const entry = groups.get(group)?.entries.get(key);
  if (!entry) return undefined;
  if (rest.length === 0) return entry;
  if (rest.length === 1 && rest[0] === 'id') return { id: entry.id };
  return undefined;
}

function parseRootOrder(text, groups) {
  const source = parseSource(text);
  const object = findExportedObject(source, 'root');
  const order = [];
  if (object) {
    for (const property of object.properties) {
      if (ts.isSpreadAssignment(property)) order.push(property.expression.getText());
    }
  }
  for (const group of groups.keys()) if (!order.includes(group)) order.push(group);
  return order.filter((group) => groups.has(group));
}

function parseLayerOrder(text) {
  const source = parseSource(text);
  const array = findExportedArray(source, 'layers');
  if (!array) return [];
  const imports = importMap(source);
  const order = [];
  for (const element of array.elements) {
    if (!ts.isIdentifier(element)) continue;
    const path = imports.get(element.text);
    if (path) order.push(path);
  }
  return order;
}

function importMap(source) {
  const map = new Map();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      const exported = element.propertyName?.text ?? element.name.text;
      const local = element.name.text;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;
      map.set(local, resolveImportPath(LAYERS_INDEX, specifier, exported));
    }
  }
  return map;
}

function resolveImportPath(fromPath, specifier, exportedName) {
  const base = posix.normalize(posix.join(posix.dirname(fromPath), specifier));
  if (specifier.endsWith('.ts')) return base;
  return exportedName ? `${base}.ts` : `${base}/index.ts`;
}

function parseLayerFile(path, text, groups, warnings) {
  const source = parseSource(text);
  const object = findExportedObject(source);
  if (!object) {
    warnings.push(`${path}: 找不到导出的层对象`);
    return null;
  }
  const patchNode = getProperty(object, 'patch');
  const dataNode = getProperty(object, 'data');
  if (!patchNode || !dataNode || !ts.isObjectLiteralExpression(dataNode)) {
    warnings.push(`${path}: 缺少 patch/data`);
    return null;
  }
  const patch = readString(patchNode) ?? path;
  const data = new Map();
  for (const property of dataNode.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isObjectLiteralExpression(property.initializer)) continue;
    const key = propertyName(property.name);
    if (!key) continue;
    const partial = readLayerPartial(property.initializer, groups);
    if (Object.keys(partial).length) data.set(key, partial);
  }
  return { patch, data };
}

function readLayerPartial(object, groups) {
  const partial = {};
  const idNode = getProperty(object, 'id');
  const nameNode = getProperty(object, 'name');
  const iconNode = getProperty(object, 'icon');

  if (idNode) {
    const direct = readNumber(idNode);
    if (direct != null) partial.id = direct;
    else {
      const alias = resolveAlias(idNode.getText(), groups);
      if (alias?.id != null) partial.id = alias.id;
    }
  }
  if (nameNode) {
    const direct = readString(nameNode);
    if (direct != null) partial.name = direct;
    else {
      const alias = resolveAlias(nameNode.getText(), groups);
      if (alias?.name != null) partial.name = alias.name;
    }
  }
  if (iconNode) {
    const direct = readIcon(iconNode);
    if (direct != null) partial.iconId = direct;
    else {
      const alias = resolveAlias(iconNode.getText(), groups);
      if (alias?.iconId != null) partial.iconId = alias.iconId;
    }
  }
  return partial;
}

function dedupeVariants(variants) {
  const seen = new Set();
  const out = [];
  for (const variant of variants) {
    const key = `${variant.key}\u0000${variant.id}\u0000${variant.name}\u0000${variant.iconId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(variant);
  }
  return out;
}

function findExportedObject(source, name) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (name && declaration.name.text !== name) continue;
      const object = objectOf(declaration.initializer);
      if (object) return object;
    }
  }
  return undefined;
}

function findExportedArray(source, name) {
  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name) continue;
      if (declaration.initializer && ts.isArrayLiteralExpression(declaration.initializer)) return declaration.initializer;
    }
  }
  return undefined;
}

function objectOf(initializer) {
  if (!initializer) return undefined;
  if (ts.isObjectLiteralExpression(initializer)) return initializer;
  if (ts.isCallExpression(initializer) && initializer.expression.getText() === 'ensureStatuses' && initializer.arguments[0]) {
    return ts.isObjectLiteralExpression(initializer.arguments[0]) ? initializer.arguments[0] : undefined;
  }
  return undefined;
}

function isExported(statement) {
  return statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function getProperty(object, name) {
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(property.name) === name) return property.initializer;
  }
  return undefined;
}

function propertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return undefined;
}

function readNumber(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isParenthesizedExpression(node)) return readNumber(node.expression);
  return undefined;
}

function readString(node) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

function readIcon(node) {
  if (ts.isCallExpression(node) && node.expression.getText() === 'iconUrl') {
    return node.arguments[0] ? readNumber(node.arguments[0]) : undefined;
  }
  if (ts.isStringLiteral(node)) {
    const match = node.text.match(/\/(\d{6})(?:_hr1)?\.(?:tex|png)/);
    return match ? Number(match[1]) : undefined;
  }
  return undefined;
}

async function fetchCnNames(ids) {
  const byId = new Map();
  let version = '';
  for (let offset = 0; offset < ids.length; offset += CN_CHUNK) {
    const chunk = ids.slice(offset, offset + CN_CHUNK);
    const url = `${CN_HOST}/sheet/Status?rows=${chunk.join(',')}&fields=Name,Icon&language=chs&limit=${chunk.length}`;
    const response = await fetchWithRetry(url, { headers: { accept: 'application/json' }, tries: 5 });
    const body = await response.json();
    if (!version && typeof body?.version === 'string') version = body.version;
    for (const row of body?.rows ?? []) {
      const name = row?.fields?.Name;
      if (typeof name === 'string' && name) {
        byId.set(row.row_id, { zh: name, iconId: row.fields?.Icon?.id });
      }
    }
    if (offset + CN_CHUNK < ids.length) await sleep(150);
  }
  return { byId, version };
}

function buildResult({ repo, ref, commit, sources, parsed, cn, allowMissing }) {
  const unique = new Map();
  const missing = [];
  const sameText = [];
  let iconMismatch = 0;
  const iconMismatchSamples = [];

  for (const variant of parsed.variants) {
    if (!variant.id || variant.id <= 0) continue;
    const cnRow = cn.byId.get(variant.id);
    if (!cnRow?.zh) {
      missing.push(`${variant.name}(${variant.id})`);
      continue;
    }
    if (cnRow.zh === variant.name) {
      sameText.push(`${variant.name}(${variant.id})`);
      continue;
    }
    if (variant.iconId != null && cnRow.iconId != null && variant.iconId !== cnRow.iconId) {
      iconMismatch += 1;
      if (iconMismatchSamples.length < 20) iconMismatchSamples.push(`${variant.name}(${variant.id}) upstream=${variant.iconId} cn=${cnRow.iconId}`);
    }
    const entry = { id: variant.id, en: variant.name, zh: cnRow.zh };
    if (variant.iconId != null) entry.iconId = variant.iconId;
    const key = `${entry.id}\u0000${entry.en}\u0000${entry.zh}\u0000${entry.iconId ?? ''}`;
    if (!unique.has(key)) unique.set(key, entry);
  }

  if (missing.length && !allowMissing) {
    throw new Error(`国服缺中文 ${missing.length} 条（前 20 条: ${missing.slice(0, 20).join(', ')}）；确认可接受后加 --allow-missing`);
  }

  const entries = [...unique.values()].sort((a, b) => a.en.localeCompare(b.en) || a.id - b.id || (a.iconId ?? 0) - (b.iconId ?? 0));
  if (entries.length < MIN_ENTRIES) {
    throw new Error(`只生成 ${entries.length} 条，低于下限 ${MIN_ENTRIES}；上游结构可能变了，已中止写入`);
  }

  const grouped = new Map();
  for (const entry of entries) {
    const list = grouped.get(entry.en) ?? [];
    list.push(entry);
    grouped.set(entry.en, list);
  }
  const ambiguous = [];
  for (const [name, list] of grouped) {
    const variants = new Set(list.map((entry) => `${entry.zh}\u0000${entry.iconId ?? ''}\u0000${entry.id}`));
    if (variants.size > 1) ambiguous.push(`${name}(${list.map((entry) => `${entry.zh}:${entry.id}`).join(' / ')})`);
  }

  const dataText = `[\n${entries.map((entry) => `  ${JSON.stringify(entry)}`).join(',\n')}\n]\n`;
  const dataSha256 = sha256(dataText);
  const meta = {
    schemaVersion: 1,
    upstream: { repo, ref, commit },
    bakedAt: new Date().toISOString(),
    cnVersion: cn.version,
    dataSha256,
    entriesCount: entries.length,
    sourceDigest: sourceDigest(sources),
    counts: {
      root: parsed.rootCount,
      variants: parsed.variants.length,
      emitted: entries.length,
      missingZh: missing.length,
      sameText: sameText.length,
      ambiguousNames: ambiguous.length,
      iconMismatch,
    },
    warnings: {
      missingZh: missing.slice(0, 20),
      sameText: sameText.slice(0, 20),
      ambiguousNames: ambiguous.slice(0, 20),
      iconMismatch: iconMismatchSamples,
    },
  };
  if (parsed.warnings.length) meta.warnings.parse = parsed.warnings.slice(0, 20);

  return { dataText, metaText: `${JSON.stringify(meta, null, 2)}\n`, meta };
}

function sourceDigest(sources) {
  const lines = [...sources.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, text]) => `${path} ${sha256(text)}`);
  return sha256(lines.join('\n'));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function entriesSummary(meta) {
  return `${meta.entriesCount} 条（root ${meta.counts.root}，变体 ${meta.counts.variants}，缺中文 ${meta.counts.missingZh}，同名多义 ${meta.counts.ambiguousNames}）`;
}

async function writeOutputs(dataText, metaText) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeAtomic(DATA_FILE, dataText);
  await writeAtomic(META_FILE, metaText);
}

async function writeAtomic(path, text) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text, 'utf8');
  try {
    await rename(temporary, path);
  } catch {
    await rm(path, { force: true });
    await rename(temporary, path);
  }
}
