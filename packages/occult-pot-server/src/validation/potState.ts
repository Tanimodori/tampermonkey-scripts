import type { Pot } from './pot.ts';

/**
 * The pot state: the list and the moment it reflects.
 *
 * The vocabulary the upstream talks in — the client reads a `PotState` and writes a `PotModify` —
 * so it lives here rather than in either of them, and `validation/index.ts` re-exports it.
 */

/** The pot list as of `updateTime` (epoch ms); `0` means nothing has been read or written yet. */
export interface PotState {
  readonly data: readonly Pot[];
  readonly updateTime: number;
}

/**
 * One change to the pot list, resolved **per pot id** with `overwrite` > `remove` > `update`: an id
 * in `overwrite` takes that value, an id in `remove` is dropped, an id in `update` takes that value,
 * and anything else keeps what it had. Ids are the sheet's row key, `区服|地图|ID`.
 *
 * `update` is therefore an upsert, not an append: the view holds one row per id. `overwrite` is the
 * escape hatch for a value that must survive a concurrent `remove`.
 *
 * `updateTime` is stamped by whoever builds the change: when it was accepted (or, for a state read,
 * when it was read).
 */
export interface PotModify {
  readonly overwrite: readonly Pot[];
  readonly remove: readonly Pot[];
  readonly update: readonly Pot[];
  readonly updateTime: number;
}
