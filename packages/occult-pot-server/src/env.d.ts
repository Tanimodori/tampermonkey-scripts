/** What this package reads off vite's `import.meta`. */
interface ImportMetaEnv {
  /**
   * The mode naming the environment files: `.env.<mode>` and `.env.<mode>.local`.
   *
   * The build statically replaces it with the mode it was built in (`production`), and vitest
   * defines it as `test`.
   */
  readonly MODE: string;
}

interface ImportMeta {
  /**
   * Vite and vitest define this; a plain `tsx` run or bare node has no `import.meta.env` at all,
   * which is why it is optional and `src/config.ts` falls back to `NODE_ENV` before `development`.
   */
  readonly env?: ImportMetaEnv;
}
