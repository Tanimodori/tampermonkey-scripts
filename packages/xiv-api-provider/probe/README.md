# Consumer probe

Typechecks a file that imports the **built** `dist/` the way a sibling package would — through `package.json#exports`, by subpath — with `skipLibCheck: false`. Resolving `xiv-api-provider/<subpath>` needs the package to reference itself by name, which is the same lookup a consumer performs, and an unlisted subpath or a `../src/…` bypass both fail to resolve.

This exists because the package emits `.ts` import specifiers in its source and relies on `rewriteRelativeImportExtensions` to turn them into `.js` in the emitted JavaScript. The emitted `.d.ts` files keep the `.ts` spelling, so whether a consumer can still resolve the types is a property of the toolchain rather than something this package controls — and if it ever breaks, the failure shows up in whichever userscript imports this one, not here.

    vite build && tsc -p tsconfig.build.json && tsx build/finalize-types.ts && tsc -p probe/tsconfig.json

The probe is excluded from the package `tsconfig.json` include list on purpose: it must not be part of the build it is checking.
