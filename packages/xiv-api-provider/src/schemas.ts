/**
 * The zod schemas, as an opt-in entry point.
 *
 * Nothing in the main entry reaches this file, so the shipped bundle contains no zod and no schema objects.
 * A caller that wants to validate responses itself installs zod and imports from the subpath:
 *
 * ```ts
 * import { xivapi } from 'xiv-api-provider/schemas';
 * const parsed = xivapi.rowResponseSchema.parse(await response.json());
 * ```
 *
 * Whether to do that in a userscript is a size decision as much as a correctness one: zod is by far the
 * largest thing this package could pull in, and the runtime guards in each provider's `guards.ts` already
 * reject a body that is not the expected envelope.
 */
export * as xivapi from '@/providers/xivapi/types/schema.ts';
export * as garlands from '@/providers/garlands/types/schema.ts';
