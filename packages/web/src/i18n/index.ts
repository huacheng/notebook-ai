import { createContext, useContext } from 'react';
import { messages, type Language } from './locales';

export type { Language } from './locales';
export { messages } from './locales';

export type TFunction = (key: string, ...args: string[]) => string;

/** Create a standalone t() function for a given language (usable outside React). */
export function createT(lang: Language): TFunction {
  return (key: string, ...args: string[]): string => {
    let msg = messages[lang]?.[key] ?? key;
    for (let i = 0; i < args.length; i++) {
      msg = msg.replace(`{${i}}`, args[i]);
    }
    return msg;
  };
}

const I18nContext = createContext<TFunction>((key) => key);

export const I18nProvider = I18nContext.Provider;

/** Hook: returns t(key, ...args) bound to the current language. */
export function useT(): TFunction {
  return useContext(I18nContext);
}
