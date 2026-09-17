import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadPackageJson, withPackageJson } from '../src/packageJson.js';
import type { PackageJsonLike } from '../src/types.js';

const fixture: PackageJsonLike = {
  name: 'fixture-package',
  version: '1.2.3',
  description: 'the package description',
  author: { name: 'Tester', email: 'tester@example.com', url: 'https://tester.example' },
  license: { type: 'MIT' },
  homepage: 'https://home.example',
  bugs: { url: 'https://bugs.example' },
};

const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'userscript-metadata-'));

describe('withPackageJson', () => {
  it('fills the keys the metadata leaves out', () => {
    expect(withPackageJson({ match: 'https://example.com/*' }, fixture)).toEqual({
      match: 'https://example.com/*',
      name: 'fixture-package',
      version: '1.2.3',
      description: 'the package description',
      author: 'Tester <tester@example.com> (https://tester.example)',
      license: 'MIT',
    });
  });

  it('leaves the informational links to the metadata', () => {
    const filled = withPackageJson({}, fixture);

    expect(filled).not.toHaveProperty('homepage');
    expect(filled).not.toHaveProperty('homepageURL');
    expect(filled).not.toHaveProperty('supportURL');
  });

  it('leaves the values the metadata spells out', () => {
    expect(withPackageJson({ name: 'script-name', version: '9.9.9' }, fixture)).toMatchObject({ name: 'script-name', version: '9.9.9' });
  });

  it('treats a language variant as the key being present', () => {
    expect(withPackageJson({ 'name:zh': '中文名' }, fixture)).not.toHaveProperty('name');
  });

  it('skips the fields the package file does not have', () => {
    expect(withPackageJson({}, {})).toEqual({});
  });

  it('returns the metadata untouched without a package file', () => {
    const meta = { name: 'example' };
    expect(withPackageJson(meta, undefined)).toBe(meta);
  });
});

describe('loadPackageJson', () => {
  it('skips the lookup when it is switched off', async () => {
    await expect(loadPackageJson(undefined, 'C:/nowhere')).resolves.toBeUndefined();
    await expect(loadPackageJson(false, 'C:/nowhere')).resolves.toBeUndefined();
  });

  it('uses an object as it is', async () => {
    const pkg = { version: '1' };
    await expect(loadPackageJson(pkg, 'C:/nowhere')).resolves.toBe(pkg);
  });

  it('searches upwards from the project root', async () => {
    const dir = await tempDir();
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'nearest', version: '4.5.6' }));
    const nested = join(dir, 'nested');
    await mkdir(nested);

    await expect(loadPackageJson(true, nested)).resolves.toMatchObject({ name: 'nearest', version: '4.5.6' });
  });

  it('reads the file a string names', async () => {
    const dir = await tempDir();
    const file = join(dir, 'package.json');
    await writeFile(file, JSON.stringify({ name: 'named', version: '7' }));

    await expect(loadPackageJson(file, 'C:/nowhere')).resolves.toMatchObject({ name: 'named', version: '7' });
  });

  it('fails loudly when there is no package file', async () => {
    const dir = join(await tempDir(), 'missing');

    await expect(loadPackageJson(true, dir)).rejects.toThrow(/could not read a package file/);
  });
});
