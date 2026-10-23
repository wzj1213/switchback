import { createContext, useContext, useEffect, type ReactNode } from "react"
import { DEFAULT_LOCALE, langTag, type Catalog, type Locale, type Messages, type Translation } from "@switchback/i18n"

/**
 * 当前界面语言。由 `App` 按设置提供，组件用 `useMessages(...)` 拿到这一种语言的那一版文案。
 *
 * 不是模块级状态：语言跟着设置走，放在 React 的上下文里，切换时整棵树重画。
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }): React.JSX.Element {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

/** 某一份文案在当前语言下的那一版。 */
export function useMessages<M extends Messages>(catalog: Catalog<M>): Translation<M> {
  return catalog[useContext(LocaleContext)]
}

/** `<html lang>` 跟着界面语言走：读屏的发音、断词、axe 的语言检查都看它。 */
export function useDocumentLang(locale: Locale): void {
  useEffect(() => {
    document.documentElement.lang = langTag(locale)
  }, [locale])
}
