import React, { FC, useMemo, useContext } from "react";
import { translation as en } from "../translations/en";

type Translation = typeof en;

type TranslationNode = string | { [key: string]: TranslationNode };

const TranslationContext = React.createContext<Translation>(en);

interface IProps {
  language?: string,
  children?: React.ReactNode,
}

const languages: Record<string, Translation> = {
  en,
};

export const TranslationContextProvider: FC<IProps> = ({ language, children }) => {
  const translation = useMemo(() => {
    if (!language) {
      return en;
    }

    return languages[language] || en;
  }, [language]);
  return (
    <TranslationContext.Provider value={translation}>
      {children}
    </TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const translation = useContext(TranslationContext);

  return (key: string): string => {
    const keys = key.split(".");

    let node: TranslationNode | undefined = translation as TranslationNode;
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
