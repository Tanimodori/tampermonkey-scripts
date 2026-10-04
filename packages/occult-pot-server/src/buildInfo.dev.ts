/**
 * The `~build/*` modules for the bare `tsx` dev run: no bundler is involved there, so the specifiers
 * `src/controllers/health.ts` imports land here instead (tsconfig.app.json). The version tracks
 * package.json; there is no build, hence no commit.
 */
import pkg from '../package.json' with { type: 'json' };

export const version: string = pkg.version;
export const abbreviatedSha = 'dev';
