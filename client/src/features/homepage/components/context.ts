import { createContext, useContext } from 'react'
type Lang = 'vi' | 'ja' | 'en'
export type HomeContext = { lang: Lang; setLang: (lang: Lang) => void; isDark: boolean; setIsDark: (dark: boolean) => void }
export const AppCtx = createContext<HomeContext>({} as HomeContext)
export const useApp = () => useContext(AppCtx)
