import type { Plugin, ResolvedConfig } from 'vite';
import { loadPackageJson, withPackageJson } from './packageJson.js';
import { renderUserscriptMeta } from './render.js';
import type { UserscriptMetadataOptions } from './types.js';

const pluginName = 'vite-plugin-userscript-metadata';

/** A banner as Rolldown and Rollup accept it. */
type BannerFunction = (chunk: { isEntry: boolean }) => string | Promise<string>;

/** The part of one output's options this plugin touches. */
interface OutputOptionsLike {
  banner?: string | BannerFunction;
}

interface OptionsGroupLike {
  output?: OutputOptionsLike | OutputOptionsLike[];
}

/** The parts of a resolved config this plugin touches. */
interface BuildOptionsLike {
  rolldownOptions?: OptionsGroupLike;
  rollupOptions?: OptionsGroupLike;
}

/**
 * Writes the metadata block in front of every entry chunk, from the `meta` the options describe.
 *
 * The block is added as the bundle's banner, which Rolldown emits before the chunk's own intro — so the
 * header stays the first thing in the file, and the source map keeps its line numbers. Only entry
 * chunks get it: a shared chunk is not something a userscript manager is given.
 */
export const userscriptMetadata = (options: UserscriptMetadataOptions): Plugin => {
  if (options === null || typeof options !== 'object') {
    throw new TypeError(`${pluginName}: an options object is required`);
  }

  const { meta, allowUnknown = true, metaOrder, languageOrder, injectPackageJson } = options;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new TypeError(`${pluginName}: "meta" must be an object`);
  }

  return {
    name: pluginName,
    async configResolved(config: ResolvedConfig) {
      const pkg = await loadPackageJson(injectPackageJson, config.root);
      const banner = renderUserscriptMeta(withPackageJson(meta, pkg), { allowUnknown, metaOrder, languageOrder });

      for (const output of outputOptions(config)) {
        output.banner = composeBanner(output.banner, banner);
      }
    },
  };
};

/**
 * The output option objects to put the banner on. Vite 8 reads `build.rolldownOptions`, while Vite 7
 * and earlier only know `build.rollupOptions`, and an output may be one object or a list of them.
 */
const outputOptions = (config: ResolvedConfig): OutputOptionsLike[] => {
  const build = config.build as unknown as BuildOptionsLike;
  const group = build.rolldownOptions ?? build.rollupOptions ?? (build.rolldownOptions = {});
  const output = group.output ?? (group.output = {});

  return Array.isArray(output) ? output : [output];
};

/** Keeps the banner the configuration already asked for, and appends the header to it on entry chunks. */
const composeBanner =
  (previous: OutputOptionsLike['banner'], banner: string): BannerFunction =>
  async (chunk) => {
    const text = typeof previous === 'function' ? await previous(chunk) : (previous ?? '');
    return chunk.isEntry ? `${text}${banner}` : text;
  };

export default userscriptMetadata;

export { defaultLanguageOrder, defaultMetaOrder, knownMetaKeys } from './order.js';
export type { RenderOptions } from './render.js';
export type { MetaScalar, MetaValue, PackageJsonLike, UserscriptMeta, UserscriptMetadataOptions } from './types.js';
