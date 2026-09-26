import i18n from "i18next";
import type { ReactNode } from "react";
import { I18nextProvider, initReactI18next, useTranslation } from "react-i18next";
import en from "../../../locales/en.json";

// Keys are msgids, never English sentences: a missing translation must show as a key, not pass as prose.
i18n.use(initReactI18next).init({
  lng: "en",
  resources: { en: { translation: en } },
  interpolation: { escapeValue: false, prefix: "%{", suffix: "}" },
  react: { useSuspense: false },
});

export type TFunction = ReturnType<typeof useTranslation>["t"];

export function useTranslations() {
  const { t, i18n: instance } = useTranslation();
  return { t, locale: instance.language };
}

export function TranslationsProvider({ children }: { children: ReactNode }) {
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
