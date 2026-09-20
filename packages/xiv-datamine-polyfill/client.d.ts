/**
 * Types for the imports this package's plugin resolves.
 *
 * A consumer opts in once, from any declaration file in the project:
 *
 * ```ts
 * /// <reference types="xiv-datamine-polyfill/client" />
 * ```
 *
 * One pattern covers every sheet, which is the point: the plugin can be asked for any file in the datamining
 * tree, and a table the package had to know about in advance would be the whitelist back again.
 *
 * What an import gives back is data and nothing else — the sheet's own grid, header lines included, every cell
 * a string. The reading tools are not part of it: `useSheetTable` from `xiv-api-provider/datamine` turns the
 * grid into something addressable, which is what keeps a bundle's bytes free of this package's code.
 *
 * This file is a script, not a module: the declaration inside has to be ambient, and a top-level `import`
 * would turn it into a module augmentation that matches nothing.
 */

declare module 'xiv-datamine-polyfill/*.csv' {
  const sheet: import('xiv-api-provider/datamine').SheetRawData;
  export default sheet;
}
