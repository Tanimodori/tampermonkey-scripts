/**
 * Reading the built artifact back, as the black box it is.
 *
 * The spec files import this rather than `../src/…`: the thing under test is the bundle, so nothing here may
 * reach the source it was built from at runtime. The type does, deliberately — see `loadArtifact`.
 */

export type Mode = 'offline' | 'online';

/** The same variable the build read: it picks the expectation set, and the assertions check the artifact agrees. */
export const mode = (): Mode => (process.env.XIV_LIVE === '1' ? 'online' : 'offline');

export const live = mode() === 'online';

export type Artifact = typeof import('../../src/index.js');

/**
 * A non-literal specifier, so that the type check never resolves `dist/`: the artifact has no declarations of
 * its own (vite emits JavaScript), and a literal `import('../dist/index.js')` would make `typecheck` depend on
 * a build that is scheduled after it. The cast pins the artifact's shape to `src/`'s declared one, and the call
 * below proves the artifact really has it — a missing `getData` fails at run time, which is what an end-to-end
 * check is for.
 */
export const loadArtifact = async (): Promise<Artifact> => {
  const file = new URL('../../dist/index.js', import.meta.url);
  try {
    return (await import(file.href)) as Artifact;
  } catch (cause) {
    throw new Error(`xiv-datamine-polyfill-e2e-test: cannot load ${file.pathname} — build it first (rushx test:offline or test:online)`, { cause });
  }
};
