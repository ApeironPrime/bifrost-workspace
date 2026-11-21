import { lazy, Suspense, useEffect, useState } from 'react'
import { WorkspaceLoadingScreen } from '../components/WorkspaceLoadingScreen'
import { beginWorkspaceTransition, resetWorkspaceTransition, resolvePreferredTheme } from '../lib/delayedLoading'
import {
  getInitialLanguage,
  saveLanguage,
  translateLanding,
  type Language,
} from '../i18n/landing'
import { AppCtx } from './components/context'
import Landing from './screens/Landing'
import './base.css'
import './sculpture-edition.css'
import './journey-edition.css'
import './motion.css'
import './theme-surfaces.css'

// Keep the workspace, networking libraries and application styles off the landing-page path.
const App = lazy(() => import('../App'))

export default function Homepage() {
  const [workspace, setWorkspace] = useState(() => {
    const active = window.location.hash.startsWith('#workspace')
    if (active) beginWorkspaceTransition()
    return active
  })
  const [lang, setLang] = useState<Language>(() => getInitialLanguage())
  const [isDark, setIsDark] = useState(() => localStorage.getItem('bifrost_theme') === 'dark')
  useEffect(() => {
    const onHash = () => {
      const inWorkspace = window.location.hash.startsWith('#workspace')
      if (inWorkspace) {
        beginWorkspaceTransition()
      } else {
        resetWorkspaceTransition()
        setLang(getInitialLanguage())
        setIsDark(localStorage.getItem('bifrost_theme') === 'dark')
      }
      setWorkspace(inWorkspace)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const enter = () => {
    beginWorkspaceTransition()
    window.location.hash = 'workspace'
    window.scrollTo(0, 0)
  }
  const workspaceTheme = resolvePreferredTheme()
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = translateLanding(lang, 'landing.documentTitle')
  }, [lang])
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', workspace ? workspaceTheme : (isDark ? 'dark' : 'light'))
  }, [isDark, workspace, workspaceTheme])
  if (workspace) {
    return (
      <Suspense fallback={<WorkspaceLoadingScreen phase="initializing" lang={lang} theme={workspaceTheme} />}>
        <App />
      </Suspense>
    )
  }
  return <div className="bifrost-home" data-theme={isDark ? 'dark' : 'light'}>
    <AppCtx.Provider value={{ lang, setLang: (value) => { setLang(value); saveLanguage(value) }, isDark, setIsDark: (value) => { setIsDark(value); localStorage.setItem('bifrost_theme', value ? 'dark' : 'light') } }}>
      <Landing onDemo={enter} />
    </AppCtx.Provider>
  </div>
}
