import React, { FC, useMemo, useContext } from "react";
import { translation as en } from "../translations/en";

const TranslationContext = React.createContext(en as any);

interface IProps {
  language?: string,
}

const languages = {
  en,
};

export const TranslationContextProvider: FC<IProps> = ({ language, children }) => {
  const translation = useMemo(() => {
    if (!language) {
      return en;
    }

    return (languages as any)[language] || en;
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

    return keys.slice(1).reduce((acc, value) => acc?.[value], translation[keys[0]]) || key;
  };
};
