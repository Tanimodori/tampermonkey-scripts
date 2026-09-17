import { defaultLanguageOrder, defaultLanguageSlot, defaultMetaOrder, knownMetaKeys, normalizeLocale, normalizeMetaKey } from './order.js';
import type { MetaScalar, UserscriptMeta } from './types.js';

/** How the keys are ordered and filtered. */
export interface RenderOptions {
  /** Whether keys outside the built-in set are rendered. */
  allowUnknown?: boolean;
  /** Keys to place first, in this order. */
  metaOrder?: readonly string[];
  /** Languages to place right after the un-suffixed line, in this order. */
  languageOrder?: readonly string[];
}

/** One rendered line, without the `// ` prefix. */
interface MetaLine {
  /** The key as it is written: `@name` or `@name:zh-CN`. */
  key: string;
  /** The value; `undefined` renders the key on its own. */
  value?: string;
}

/** One key with all of its locale variants. */
interface MetaGroup {
  key: string;
  entries: MetaEntry[];
  /** Where the key first appeared, which keeps two keys of equal rank in input order. */
  index: number;
}

/** One value of one key. */
interface MetaEntry {
  /** The normalized language tag, or `undefined` for the un-suffixed line. */
  language?: string;
  value: MetaScalar;
  /** Where the value first appeared, which keeps the lines of one language in input order. */
  order: number;
}

/** Renders the `// ==UserScript==` block; the bundle code follows on the next line. */
export const renderUserscriptMeta = (meta: UserscriptMeta, options: RenderOptions = {}): string => {
  const groups = orderGroups(collectGroups(meta), options);
  const languageRank = createLanguageRank(options.languageOrder);
  const lines = groups.flatMap((group) => toLines(group, languageRank));
  const valueColumn = Math.max(0, ...lines.map((line) => line.key.length)) + 1;

  const block = [
    '// ==UserScript==',
    ...lines.map((line) => (line.value === undefined ? `// ${line.key}` : `// ${line.key.padEnd(valueColumn)}${line.value}`)),
    '// ==/UserScript==',
  ];

  return `${block.join('\n')}\n`;
};

/** Collects every key with its locale variants, in the order the metadata lists them. */
const collectGroups = (meta: UserscriptMeta): MetaGroup[] => {
  const groups = new Map<string, MetaGroup>();
  let order = 0;

  const add = (group: MetaGroup, language: string | undefined, value: unknown): void => {
    if (value === null || value === undefined || value === false) return;
    if (Array.isArray(value)) {
      for (const item of value) add(group, language, item);
      return;
    }
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return;
    group.entries.push({ language, value, order: order++ });
  };

  for (const [rawKey, rawValue] of Object.entries(meta)) {
    const [key, suffix] = splitKey(rawKey);
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, entries: [], index: groups.size };
      groups.set(key, group);
    }

    if (isLocaleTable(rawValue)) {
      for (const [language, value] of Object.entries(rawValue)) {
        add(group, language === defaultLanguageSlot ? undefined : normalizeLocale(language), value);
      }
      continue;
    }

    add(group, suffix === undefined ? undefined : normalizeLocale(suffix), rawValue);
  }

  return [...groups.values()];
};

/**
 * Applies `metaOrder` as a patch: the keys it names come first in its order, the keys it leaves out
 * keep the built-in order, and the keys the userscript managers do not know follow at the end.
 */
const orderGroups = (groups: MetaGroup[], options: RenderOptions): MetaGroup[] => {
  const requested = (options.metaOrder ?? []).map(normalizeMetaKey);
  const requestedIndex = new Map(requested.map((key, index) => [key, index]));
  const defaultIndex = new Map(defaultMetaOrder.map((key, index) => [key, index]));
  const extraIndex = new Map([...knownMetaKeys].filter((key) => !defaultIndex.has(key)).map((key, index) => [key, index] as const));
  const unknownBase = requested.length + defaultMetaOrder.length + extraIndex.size;

  const rank = (group: MetaGroup): number => {
    const wanted = requestedIndex.get(group.key);
    if (wanted !== undefined) return wanted;
    const fallback = defaultIndex.get(group.key);
    if (fallback !== undefined) return requested.length + fallback;
    const extra = extraIndex.get(group.key);
    return extra === undefined ? unknownBase + group.index : requested.length + defaultMetaOrder.length + extra;
  };

  return groups
    .filter((group) => (options.allowUnknown ?? true) || requestedIndex.has(group.key) || knownMetaKeys.has(group.key))
    .sort((left, right) => rank(left) - rank(right) || left.index - right.index);
};

/** Ranks a language tag: the un-suffixed line first, then the configured languages, then the rest. */
const createLanguageRank = (languageOrder?: readonly string[]): ((language?: string) => number) => {
  const preferred = [...(languageOrder ?? []), ...defaultLanguageOrder].map((language) => normalizeLocale(language));

  return (language) => {
    if (language === undefined) return -1;
    const index = preferred.indexOf(language);
    return index === -1 ? preferred.length : index;
  };
};

/** Renders the lines of one key, its locale variants in language order and its lists in input order. */
const toLines = (group: MetaGroup, languageRank: (language?: string) => number): MetaLine[] =>
  [...group.entries]
    .sort(
      (left, right) => languageRank(left.language) - languageRank(right.language) || compareLocales(left.language, right.language) || left.order - right.order,
    )
    .map((entry) => ({
      key: entry.language === undefined ? `@${group.key}` : `@${group.key}:${entry.language}`,
      value: entry.value === true || entry.value === '' ? undefined : String(entry.value),
    }));

const compareLocales = (left?: string, right?: string): number => {
  const a = left ?? '';
  const b = right ?? '';
  return a === b ? 0 : a < b ? -1 : 1;
};

/** Splits `name:zh-CN` into the key and its language tag. */
const splitKey = (rawKey: string): [key: string, suffix?: string] => {
  const key = normalizeMetaKey(rawKey);
  const separator = key.indexOf(':');
  return separator === -1 ? [key] : [key.slice(0, separator), key.slice(separator + 1)];
};

/** A locale table is every object that is not a list. */
const isLocaleTable = (value: unknown): value is Record<string, MetaScalar | readonly MetaScalar[]> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
