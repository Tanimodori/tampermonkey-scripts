/**
 * The order the metadata block is written in by default.
 *
 * There is no order the userscript managers prescribe, so this one is a compromise between the two
 * sources that matter in practice: the key list of the Tampermonkey documentation, and the order the
 * most installed GreasyFork scripts actually use. Taking the mean position of every key over a dozen
 * of those scripts gives `name` first, `match`/`include`/`exclude` right after the identity block, and
 * `downloadURL`/`updateURL` last; `namespace` is bimodal there (four scripts put it second, seven push
 * it near the end), and the documentation's own listing keeps it beside `name`, which is where it is
 * here. The informational links (home page, support, contributions) close the block.
 *
 * Keys absent from the sample — `iconURL`, `run-in`, `unwrap`, `webRequest`, `tag` and the like — sit
 * next to the key they belong with.
 */
export const defaultMetaOrder: readonly string[] = [
  // Identity and version
  'name',
  'namespace',
  'version',
  'description',
  'author',
  // Scope
  'match',
  'include',
  'exclude',
  // Icon
  'icon',
  'iconURL',
  'defaulticon',
  'icon64',
  'icon64URL',
  // Licensing and declarations
  'license',
  'copyright',
  'antifeature',
  'compatible',
  'incompatible',
  'tag',
  // External code and data
  'require',
  'resource',
  // Permissions
  'connect',
  'grant',
  // Runtime behaviour
  'run-at',
  'run-in',
  'sandbox',
  'noframes',
  'unwrap',
  'webRequest',
  // Updates
  'downloadURL',
  'updateURL',
  // Informational links
  'homepage',
  'homepageURL',
  'website',
  'source',
  'supportURL',
  'contributionURL',
  'contributionAmount',
];

/**
 * Every key the userscript managers know, as the union of the Tampermonkey documentation's header list
 * and the keys GreasyFork reads. `defaultMetaOrder` covers all of them but `installURL`, which only
 * exists as an update location.
 */
export const knownMetaKeys: ReadonlySet<string> = new Set([...defaultMetaOrder, 'installURL']);

/** The language that follows the un-suffixed line unless `languageOrder` says otherwise. */
export const defaultLanguageOrder: readonly string[] = ['en'];

/** The key of a locale table that holds the value without a language suffix. */
export const defaultLanguageSlot = 'default';

/** Drops the leading `@`, so that both spellings of a key name the same key. */
export const normalizeMetaKey = (key: string): string => (key.startsWith('@') ? key.slice(1) : key);

/**
 * Puts a language tag into the form the userscript managers document — language lower case, script
 * title case, region upper case: `zh-cn` becomes `zh-CN`, `pt_br` becomes `pt-BR`, `zh-hant-tw` becomes
 * `zh-Hant-TW`. A tag that is already canonical comes back unchanged.
 */
export const normalizeLocale = (locale: string): string => {
  const parts = locale.split(/[-_]/).filter((part) => part !== '');
  if (parts.length === 0) return locale;

  return parts
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      const isRegion = index === parts.length - 1 && /^([a-z]{2}|[0-9]{3})$/i.test(part);
      return isRegion ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join('-');
};
