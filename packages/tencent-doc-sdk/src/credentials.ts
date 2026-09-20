/**
 * The credential one document is opened with, and where a refreshed one is kept.
 *
 * `clientSecret` is deliberately not a field: it is the half of the credential that never leaves the
 * environment it was configured from, and a store that could persist it would be a store that writes
 * it somewhere.
 */

/** What a caller persists, and what it reads back on the next start. */
export interface CredentialRecord {
  readonly accessToken: string;
  readonly refreshToken?: string | undefined;
  readonly openId?: string | undefined;
  readonly clientId?: string | undefined;
  /** Epoch milliseconds at which `accessToken` stops working, when it is known. */
  readonly expiresAt?: number | undefined;
}

/**
 * Where the credential lives between restarts.
 *
 * `save` is given the fields that changed and nothing else: a refresh that only learned a new access
 * token must not drop the refresh token that is already stored. A store that cannot write parts is
 * free to read, merge and write the whole record itself.
 */
export interface CredentialStore {
  load(): Promise<CredentialRecord | undefined>;
  save(record: Partial<CredentialRecord>): Promise<void>;
}

/** The store a caller that persists nothing gets: whatever this process last saved, and no further. */
export function memoryCredentialStore(): CredentialStore {
  let stored: CredentialRecord | undefined;

  return {
    async load() {
      return stored;
    },
    async save(record: Partial<CredentialRecord>) {
      stored = { ...stored, ...compact(record) } as CredentialRecord;
    },
  };
}

/** The fields worth writing: `undefined` and `''` mean "not given", not "clear it". */
export function compact(record: Partial<CredentialRecord>): Partial<CredentialRecord> {
  const kept: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'number' && Number.isFinite(value)) kept[key] = value;
    else if (typeof value === 'string' && value.length > 0) kept[key] = value;
  }
  return kept;
}
