import { en, Key } from './en';
import { fr } from './fr';
import { ar } from './ar';

export type Lang = 'ar' | 'fr' | 'en';
export const LANGS: Lang[] = ['ar', 'fr', 'en'];
const dict: Record<Lang, Record<Key, string>> = { en, fr, ar };
export const isRtl = (l: Lang) => l === 'ar';
export const isLang = (v: unknown): v is Lang => v === 'ar' || v === 'fr' || v === 'en';

// The device language when it is one of ours, otherwise English.
export function deviceLang(): Lang {
  try {
    const code = require('expo-localization').getLocales?.()[0]?.languageCode;
    return isLang(code) ? code : 'en';
  } catch { return 'en'; }
}

export function translate(lang: Lang, key: Key, vars: Record<string, string | number> = {}) {
  return dict[lang][key].replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}
export type { Key };
