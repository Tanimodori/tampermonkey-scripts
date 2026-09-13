/**
 * What this package reads off vite's `import.meta`.
 *
 * The build replaces `import.meta.env.MODE` with the mode it was built in, and vitest defines it as
 * `test`; a plain `tsx` run or bare node has no `import.meta.env` at all, which is why it is typed
 * optional and `src/config.ts` falls back to `NODE_ENV` before `development`.
 */
interface ImportMetaEnv {
  /** The mode naming the environment files: `.env.<mode>` and `.env.<mode>.local`. */
  readonly MODE: string;
}

interface ImportMeta {
  readonly env?: ImportMetaEnv;
}
