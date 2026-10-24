import type { XivEntry } from '../../src/types/workflow';

export const entry = (en: string, zh: string, extra: Partial<XivEntry> = {}): XivEntry => ({
  kind: 'action',
  id: 1,
  en,
  zh,
  ...extra,
});

export const makeGrowth = () => {
  let callback: (() => void) | undefined;
  return {
    subscribeGrowth: (next: () => void): (() => void) => {
      callback = next;
      return () => {
        callback = undefined;
      };
    },
    trigger: (): void => callback?.(),
  };
};
