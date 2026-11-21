import { createLandingT } from '../../i18n/landing'
import { useEffect, useRef, useState } from 'react'
import { BifrostMark, TopControls } from '../components/UI'
import { useApp } from '../components/context'
import SculptureHero from '../components/SculptureHero'
import MeetingJourney from '../components/MeetingJourney'
import { IcoX } from '../components/Icons'
import { Menu } from 'lucide-react'
import { useLandingMotion } from '../components/useLandingMotion'

export default function LandingScreen({ onDemo }: { onDemo: () => void }) {
  const { lang, setLang, isDark, setIsDark } = useApp()
  const t = createLandingT(lang)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const page = useRef<HTMLDivElement>(null)
  useLandingMotion(page)

  const closeMenu = () => setMenuOpen(false)

  useEffect(() => {
    if (!menuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector(':popover-open')) {
        setMenuOpen(false)
        menuButton.current?.focus()
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [menuOpen])

  return (
    <div ref={page} id="top" className="landing homepage studio-edition">
      <a className="homepage-skip" href="#how-it-works">{t('landing.skipToContent')}</a>
      <header className="homepage-nav">
        <a className="landing-brand" href="#top" onClick={closeMenu} aria-label={t('landing.homeAria')}>
          <BifrostMark size={28} />
          <span>Bifrost</span>
        </a>
        <nav id="homepage-mobile-menu" className={menuOpen ? 'is-open' : ''} aria-label={t('landing.mainNavAria')}>
          <a href="#how-it-works" onClick={closeMenu}>{t('landing.navFeatures')}</a>
          <a href="#meeting-record" onClick={closeMenu}>{t('landing.navAfterMeeting')}</a>
        </nav>
        <div className="homepage-nav-actions">
          <TopControls lang={lang} setLang={setLang} isDark={isDark} setIsDark={setIsDark} />
          <button
            ref={menuButton}
            type="button"
            className="homepage-menu-button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-expanded={menuOpen}
            aria-controls="homepage-mobile-menu"
            aria-label={menuOpen ? t('landing.closeMenuAria') : t('landing.openMenuAria')}
          >
            {menuOpen ? <IcoX size={18} /> : <Menu size={18} aria-hidden="true" />}
          </button>
        </div>
      </header>

      <main>
        <SculptureHero lang={lang} onEnter={onDemo} />

        <MeetingJourney lang={lang} onEnter={onDemo} />

      </main>

      <footer className="homepage-footer">
        <div>
          <div className="landing-brand"><BifrostMark size={25} /><span>Bifrost</span></div>
          <p>{t('landing.footerTagline')}</p>
        </div>
        <nav aria-label={t('landing.footerNavAria')}>
          <a href="#how-it-works">{t('landing.navFeatures')}</a>
          <a href="#meeting-record">{t('landing.navAfterMeeting')}</a>
          <button type="button" onClick={onDemo}>{t('landing.openWorkspace')}</button>
        </nav>
        <small>© {new Date().getFullYear()} Bifrost</small>
      </footer>
    </div>
  )
}
