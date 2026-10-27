#!/usr/bin/env node
/**
 * 数据更新入口：默认只跑 status 烘焙；语料 capture 是约 50 分钟的手工步骤，显式加 --corpus 才跑。
 */
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const PKG_DIR = resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const known = new Set(['--corpus', '--help', '-h']);
for (const arg of argv) {
  if (!known.has(arg)) {
    console.error(`[update-data] 未知参数: ${arg}`);
    printHelp();
    process.exit(1);
  }
}
if (argv.includes('--help') || argv.includes('-h')) {
  printHelp();
  process.exit(0);
}

const run = (args) => {
  const result = spawnSync(process.execPath, args, { cwd: PKG_DIR, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

console.log('[update-data] 更新 status 烘焙...');
run([resolve(PKG_DIR, 'scripts/bake-statuses.mjs')]);
console.log('[update-data] status 烘焙完成。');

if (argv.includes('--corpus')) {
  console.log('[update-data] 开始语料 capture（约 50 分钟，串行访问真实战报）...');
  run([resolve(PKG_DIR, '../../common/scripts/install-run-rushx.js'), 'test:corpus:capture']);
  console.log('[update-data] 语料 capture 完成。');
} else {
  console.log('[update-data] 未运行语料 capture。需要时加 --corpus，或运行 rushx test:corpus:capture。');
}

function printHelp() {
  console.log(`用法: node scripts/update-data.mjs [选项]

  --corpus  同时运行 33 条战报的语料 capture（约 50 分钟）
  --help    显示本帮助
`);
}
