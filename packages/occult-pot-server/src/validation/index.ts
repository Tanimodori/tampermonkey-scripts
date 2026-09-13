/**
 * Every check, validation and parse in the service, split by what is being validated:
 *
 * - `pot.ts`     — the pot's rules, as a request body (zod) and as a sheet row.
 * - `potState.ts` — the vocabulary upstream talks in: a `PotState` and the `PotModify` that changes it.
 * - `sheet.ts`   — how a `Pot` maps onto a smartsheet row.
 * - `config.ts`  — the environment.
 * - `utils.ts`   — the shared parsing and error-shaping helpers.
 *
 * Callers import from here so there is one obvious place to look; each module is mirrored whole,
 * so a new export needs no second edit. The `Pot` type itself is inferred from `potSchema`, so the
 * model and its rules cannot drift apart.
 */
export * from './pot.ts';
export * from './potState.ts';
export * from './sheet.ts';
export * from './config.ts';
export * from './utils.ts';
