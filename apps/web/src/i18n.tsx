import { createContext, useContext, useEffect, type ReactNode } from "react"
import { DEFAULT_LOCALE, isLocale, langTag, type Catalog, type Locale, type Messages, type Translation } from "@switchback/i18n"

/**
 * 网页端的界面语言：**跟着宿主那边的设置**（「我是谁」报的 `language`），不另设一份。
 *
 * 配对之前还问不到宿主说哪种话，就用上一次连上时记下的那种；都没有就是默认的中文。
 * 记在 localStorage 里只是给配对页用的便利，读不到、写不进都不要紧。
 */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE)
const REMEMBER = "switchback.web.language"

function remembered(): Locale {
  try {
    const saved = window.localStorage.getItem(REMEMBER)
    return isLocale(saved) ? saved : DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/** 宿主报了语言就用它，并记下来；`<html lang>` 跟着走。 */
export function useHostLocale(reported: string | undefined): Locale {
  const locale = isLocale(reported) ? reported : remembered()
  useEffect(() => {
    if (!isLocale(reported)) return
    try {
      window.localStorage.setItem(REMEMBER, reported)
    } catch {
      // 存不进就下次再按默认，界面照常
    }
  }, [reported])
  useEffect(() => {
    document.documentElement.lang = langTag(locale)
  }, [locale])
  return locale
}

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }): React.JSX.Element {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>
}

/** React 外面（回调里、发不出去的那一下）要说话时，照 `<html lang>` 现读。 */
export function documentLocale(): Locale {
  return document.documentElement.lang === langTag("en") ? "en" : DEFAULT_LOCALE
}

export function useLocale(): Locale {
  return useContext(LocaleContext)
}

/** 某一份文案在当前语言下的那一版。 */
export function useMessages<M extends Messages>(catalog: Catalog<M>): Translation<M> {
  return catalog[useContext(LocaleContext)]
}
