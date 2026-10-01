// The panel's strings by key; only English exists, and any other language falls back to it.
import React, { FC, useMemo, useContext } from "react";
import { translation as en } from "../translations/en";

type Translation = typeof en;

type TranslationNode = string | { [key: string]: TranslationNode };

const TranslationContext = React.createContext<Translation>(en);

interface IProps {
  language?: string,
  children?: React.ReactNode,
}

// The translations by language; an unknown one falls back to English.
const languages: Partial<Record<string, Translation>> = {
  en,
};

// Gives its children the strings of `language`; English without one.
export const TranslationContextProvider: FC<IProps> = ({ language, children }) => {
  const translation = useMemo(() => {
    if (!language) {
      return en;
    }

    return languages[language] ?? en;
  }, [language]);
  return (
    <TranslationContext.Provider value={translation}>
      {children}
    </TranslationContext.Provider>
  );
};

// t(key): the string at a dotted key such as "stats.bitrate.label"; the key itself when there is no string there.
export const useTranslation = () => {
  const translation = useContext(TranslationContext);

  return (key: string): string => {
    const keys = key.split(".");

    let node: TranslationNode | undefined = translation;
    for (const segment of keys) {
      if (node && typeof node === "object" && segment in node) {
        node = node[segment];
      } else {
        return key;
      }
    }

    return typeof node === "string" ? node : key;
  };
};
