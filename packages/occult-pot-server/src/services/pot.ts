import { AppError } from '@/errors.ts';
import { now } from '@/services/time.ts';
import { potStore } from '@/stores/pot.ts';
import type { Pot } from '@/validation/index.ts';

/**
 * The pot API the routes call: the pots the store serves, one pot by id, and accepting a new one.
 *
 * Free functions over the module singletons: the store is the one every consumer shares, and the
 * stamp a change carries comes from the clock service rather than from a caller.
 */

/** Every pot the store serves. What has been accepted is already part of the state it reads. */
export async function listPots(): Promise<readonly Pot[]> {
  const state = await potStore.get();
  return state.data;
}

export async function getPot(potId: string): Promise<Pot> {
  const needle = potId.trim();
  const found = (await listPots()).find((pot) => pot.potId === needle);
  if (found === undefined) throw new AppError('NOT_FOUND', `No occult pot with ID ${needle}`);
  return found;
}

/**
 * Accepts a pot for writing. The request schema already checked it, so there is nothing left to
 * validate here; `update` is the only list this service ever fills in, and the change is stamped
 * with the current instant.
 *
 * @returns a confirmation message; what happens next is the store's queue.
 */
export async function createPot(input: Pot): Promise<string> {
  await potStore.enqueue({ overwrite: [], remove: [], update: [input], updateTime: now() });
  return `occult pot ${input.potId} queued for writing to the sheet`;
}
