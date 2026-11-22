import { overrideProvider } from '../../src/data/override';
import { iconIdOf } from '../../src/hooks/icon';
import type { ElementQuery } from './corpusReplay';
import { queryKeyOf } from './corpusSchema';
import allowlist from './untranslated.allowlist.json';

export const ALLOWLIST: Record<string, string> = allowlist;

export const allowlistReason = (key: string): string | undefined => ALLOWLIST[key];

export const identityNames = async (): Promise<Set<string>> => {
  const entries = await overrideProvider();
  return new Set(entries.filter((entry) => entry.zh === entry.en).map((entry) => entry.en.trim().toLowerCase()));
};

export const queryKeyForElement = (question: ElementQuery): string => {
  const iconId = question.kind === 'icon' && question.src ? iconIdOf(question.src) : Number.NaN;
  return queryKeyOf(question.kind, question.raw, Number.isNaN(iconId) ? undefined : iconId);
};

export const isUnchangedAnswer = (question: ElementQuery, answer: string | null): boolean => {
  if (answer === null) return true;
  return answer === question.raw;
};
