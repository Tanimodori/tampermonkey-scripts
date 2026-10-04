import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * live 运行读取的环境，形状与本库自己的配置一致。
 *
 * `OPS_ENV_PATH` 点名一个文件，旁边一个被 ignore 的 `<file>.local` 放这台机器的值：模板提交进仓库，开发者把凭据放下，
 * 且它从不进仓库。后面的来源赢，因此 local 文件压过模板，两个都压过 shell。
 *
 * 除非文件（或 shell）确实点名了一个文档，这里不读任何真实文档：默认是示例 id，`liveDocument.ts` 拒绝用它发起调用。
 */

const NAMED = 'OPS_ENV_PATH';

function read(file: string): Record<string, string> {
  return existsSync(file) ? (parseEnv(readFileSync(file, 'utf8')) as Record<string, string>) : {};
}

/** `OPS_ENV_PATH` 指向的文件必须存在；它的 `.local` 兄弟不必。 */
function sources(): string[] {
  const named = process.env[NAMED];
  if (named === undefined || named === '') return [];
  if (!existsSync(named)) throw new Error(`Could not read the env file ${named} named by ${NAMED}`);
  return [named, `${named}.local`];
}

function collect(): Record<string, string | undefined> {
  const merged: Record<string, string | undefined> = { ...process.env };
  for (const file of sources()) Object.assign(merged, read(file));
  return merged;
}

export const liveEnv: Record<string, string | undefined> = collect();
