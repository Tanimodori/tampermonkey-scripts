import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ResolvedConfig } from 'vite';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { userscriptMetadata } from '../src/index.js';
import type { UserscriptMetadataOptions } from '../src/types.js';

/** One output's options, as far as the tests read them back. */
interface BannerOutput {
  output: { banner: (chunk: { isEntry: boolean }) => Promise<string> };
}

interface ResolvedBuild {
  rolldownOptions?: BannerOutput;
  rollupOptions?: BannerOutput;
}

const configResolved = (plugin: ReturnType<typeof userscriptMetadata>): ((config: ResolvedConfig) => Promise<void>) =>
  plugin.configResolved as (config: ResolvedConfig) => Promise<void>;

const createFixture = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'userscript-metadata-build-'));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', version: '1.2.3', author: 'Tester', license: 'MIT' }));
  await writeFile(join(dir, 'entry.ts'), 'console.log("hello");\n');
  return dir;
};

const buildFixture = async (dir: string, options: UserscriptMetadataOptions): Promise<string> => {
  await build({
    configFile: false,
    root: dir,
    logLevel: 'silent',
    build: {
      outDir: join(dir, 'dist'),
      emptyOutDir: true,
      minify: false,
      sourcemap: true,
      lib: { entry: join(dir, 'entry.ts'), formats: ['iife'], name: 'fixture', fileName: () => 'index.js' },
    },
    plugins: [userscriptMetadata(options)],
  });

  return readFile(join(dir, 'dist/index.js'), 'utf8');
};

describe('userscriptMetadata', () => {
  it('writes the metadata block in front of the built file', async () => {
    const dir = await createFixture();
    const code = await buildFixture(dir, {
      meta: { name: { default: 'fixture-script', zh: '测试脚本' }, match: ['https://example.com/*'] },
      injectPackageJson: true,
    });

    expect(code.startsWith('// ==UserScript==\n')).toBe(true);
    expect(code).toMatch(/\/\/ ==\/UserScript==\n\S/);
    expect(code.split('==UserScript==')).toHaveLength(2);
    expect(code).toMatch(/^\/\/ @name +fixture-script$/m);
    expect(code).toMatch(/^\/\/ @name:zh +测试脚本$/m);
    expect(code).toMatch(/^\/\/ @version +1\.2\.3$/m);
    expect(code).toMatch(/^\/\/ @author +Tester$/m);
    expect(code).toMatch(/^\/\/ @license +MIT$/m);
    expect(code).toContain('console.log("hello")');
    expect(code.endsWith('//# sourceMappingURL=index.js.map')).toBe(true);
    await expect(readFile(join(dir, 'dist/index.js.map'), 'utf8')).resolves.toContain('"sources"');
  });

  it('keeps the metadata the options spell out instead of the package values', async () => {
    const dir = await createFixture();
    const code = await buildFixture(dir, { meta: { name: 'hand-written', version: '0.0.0' }, injectPackageJson: true });

    expect(code).toMatch(/^\/\/ @name +hand-written$/m);
    expect(code).toMatch(/^\/\/ @version +0\.0\.0$/m);
  });

  it('leaves the file alone when injectPackageJson is switched off', async () => {
    const dir = await createFixture();
    const code = await buildFixture(dir, { meta: { name: 'standalone' } });

    expect(code).toMatch(/^\/\/ @name +standalone$/m);
    expect(code).not.toContain('@version');
  });

  it('puts the header after the banner the configuration already had', async () => {
    const config = { root: '.', build: { rolldownOptions: { output: { banner: '/* existing */\n' } } } } as unknown as ResolvedConfig;
    await configResolved(userscriptMetadata({ meta: { name: 'example' } }))(config);

    const output = (config.build as unknown as ResolvedBuild).rolldownOptions as BannerOutput;
    await expect(output.output.banner({ isEntry: true })).resolves.toBe('/* existing */\n// ==UserScript==\n// @name example\n// ==/UserScript==\n');
    await expect(output.output.banner({ isEntry: false })).resolves.toBe('/* existing */\n');
  });

  it('creates the output options when the configuration has none', async () => {
    const config = { root: '.', build: {} } as unknown as ResolvedConfig;
    await configResolved(userscriptMetadata({ meta: { name: 'example' } }))(config);

    const build = config.build as unknown as ResolvedBuild;
    expect(typeof build.rolldownOptions?.output.banner).toBe('function');
  });

  it('falls back to rollupOptions when there is no rolldownOptions', async () => {
    const config = { root: '.', build: { rollupOptions: { output: {} } } } as unknown as ResolvedConfig;
    await configResolved(userscriptMetadata({ meta: { name: 'example' } }))(config);

    const build = config.build as unknown as ResolvedBuild;
    expect(typeof build.rollupOptions?.output.banner).toBe('function');
  });

  it('rejects options that are not an object', () => {
    expect(() => userscriptMetadata(undefined as never)).toThrow(/an options object is required/);
  });

  it('rejects a meta that is not an object', () => {
    expect(() => userscriptMetadata({ meta: [] as never })).toThrow(/"meta" must be an object/);
  });
});
