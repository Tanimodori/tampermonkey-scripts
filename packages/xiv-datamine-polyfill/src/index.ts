/**
 * The package's public surface: an import of `xiv-datamine-polyfill/<Sheet>.csv` becomes the datamining table.
 *
 * Two things live here because they are the same job from either side of a build. `dataminePolyfill` is the
 * vite plugin — what a `vite.config.ts` installs so that the import resolves. `loadTable` is the step it
 * performs, exposed on its own for a build script that has no vite in it, or for reading a generated module
 * back to see what a build actually produced.
 *
 * Neither reaches a browser bundle. The modules they produce hold data and nothing else, so whether an import
 * survives into the artifact is the consumer's bundler to decide: the plugin marks the generated module
 * side-effect-free, and this package declares `sideEffects: false`.
 *
 * The wildcard declaration that gives `<Sheet>.csv` its type is a separate entry — `xiv-datamine-polyfill/client`,
 * a hand-written `declare module` at the package root, not something generated from these sources.
 */
export { dataminePolyfill } from './plugin.ts';
export type { DataminePolyfillOptions, SheetRules } from './plugin.ts';

export { loadTable } from './load.ts';
export type { LoadOptions, LoadedSheet } from './load.ts';
