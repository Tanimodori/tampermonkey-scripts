/** Which client the data comes from. `chinese-server` is the community mirror known as Cafemaker. */
export type Edition = 'international' | 'chinese-server';

/**
 * Language tokens the game data format defines.
 *
 * `chs` is Simplified Chinese and exists only on the Chinese server; the global client has no column for
 * it and answers `invalid or unsupported language "chs"`. `zh` and `cn` are not tokens at all on either
 * side. Both editions do serve `en`/`ja`/`de`/`fr`, so the split between editions is not a language
 * split — it is a data-availability split.
 */
export type LanguageToken = 'en' | 'ja' | 'de' | 'fr' | 'chs';

export interface EditionDescriptor {
  readonly edition: Edition;
  /** Root of the API, without a trailing slash. Every endpoint hangs off this. */
  readonly apiBase: string;
  /** How the service names itself, for diagnostics. */
  readonly service: string;
  /** What the API returns when no `language` parameter is sent. */
  readonly defaultLanguage: LanguageToken;
  /**
   * Whether `GET /version` exists.
   *
   * This is the one difference a caller has to branch on *before* sending a request, because the Chinese
   * server answers that path with a 404 carrying **no body at all** — unlike every other error, which is
   * the JSON `{code, message}` shape. There is no reason to read out of the failure, so asking is wrong
   * rather than merely unanswered.
   */
  readonly hasVersionList: boolean;
  /**
   * Shape of the `version` field, which differs in kind rather than in value: an opaque 16-hex-digit id
   * internationally, a 16-digit game timestamp (`2026071600010000`) on the Chinese server.
   */
  readonly versionPattern: RegExp;
}

export const INTERNATIONAL: EditionDescriptor = {
  edition: 'international',
  service: 'boilmaster',
  apiBase: 'https://v2.xivapi.com/api',
  defaultLanguage: 'en',
  hasVersionList: true,
  versionPattern: /^[0-9a-f]{16}$/,
};

export const CHINESE_SERVER: EditionDescriptor = {
  edition: 'chinese-server',
  service: 'cafemaker-v2',
  // From xivanalysis/xivanalysis#2290, which is what upstream itself switched to. The other two addresses that
  // turn up as "the Cafemaker v2 API" answer nothing usable; what this one does and does not serve is in
  // `docs/providers/xivapi.md`.
  apiBase: 'https://xivapi-v2.xivcdn.com/api',
  // Omitting `language` already yields Chinese here, which is why the Chinese server answers an
  // international-shaped request correctly by accident.
  defaultLanguage: 'chs',
  hasVersionList: false,
  versionPattern: /^\d{16}$/,
};

export const EDITIONS: Record<Edition, EditionDescriptor> = {
  international: INTERNATIONAL,
  'chinese-server': CHINESE_SERVER,
};

export const ALL_EDITIONS: readonly Edition[] = ['international', 'chinese-server'];

/** The languages each edition was verified to serve. */
export const EDITION_LANGUAGES: Record<Edition, readonly LanguageToken[]> = {
  international: ['en', 'ja', 'de', 'fr'],
  'chinese-server': ['chs', 'en', 'ja', 'de', 'fr'],
};

/** Whether `language` is served by `descriptor`, so a caller can fail before sending a request. */
export const supportsLanguage = (edition: Edition, language: LanguageToken): boolean => EDITION_LANGUAGES[edition].includes(language);

/**
 * Why a language was refused, when it was.
 *
 * The two 400 bodies the services return are distinguishable and mean different things: a token outside
 * the format's enum fails deserialization, while `chs` on the international edition is a known variant
 * that edition does not carry. Collapsing them would hide a data-availability bug inside a typo.
 */
export const languageRejectionKind = (message: string): 'unknown-token' | 'unsupported-for-edition' | 'other' =>
  message.includes('Failed to deserialize') ? 'unknown-token' : message.includes('unsupported language') ? 'unsupported-for-edition' : 'other';
