import { AuthActionDialog } from './AuthActionDialog'
import { MotionPresence } from './MotionPresence'
import { useTabTransition } from '../lib/useTabTransition'
import { createT, type Language } from '../i18n'
import { LanguageSelect } from './LanguageSelect'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { ArrowUpRight, Check, Eye, EyeOff, Moon, Sun } from 'lucide-react'
import { BifrostMark } from '../homepage/components/UI'
import './AuthScreen.css'

type Props = {
  mode: 'login' | 'register'; lang: Language; theme: 'light' | 'dark'
  name: string; email: string; password: string; error: string; submitting: boolean
  onName: (value: string) => void; onEmail: (value: string) => void; onPassword: (value: string) => void
  onMode: () => void; onLanguage: (lang: Props['lang']) => void; onTheme: () => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}

export function AuthScreen(props: Props) {
  const { mode, lang, theme, name, email, password, error, submitting } = props
  const t = createT(lang)
  const register = mode === 'register'
  const [visible, setVisible] = useState(false)
  const [confirmVisible, setConfirmVisible] = useState(false)
  const [confirmTouched, setConfirmTouched] = useState(false)
  const [capsLock, setCapsLock] = useState(false)
  const [action, setAction] = useState<'Google' | 'Facebook' | 'reset' | null>(null)
  const [confirmation, setConfirmation] = useState('')
  const confirmInput = useRef<HTMLInputElement>(null)
  const entry = useRef<HTMLElement>(null)
  const formTransition = useTabTransition('.auth-entry')
  const modeMotion = useRef({ busy: false, height: 0, animations: [] as Animation[] })
  const [modeChanging, setModeChanging] = useState(false)

  useEffect(() => () => { modeMotion.current.animations.forEach(animation => animation.cancel()) }, [])
  useLayoutEffect(() => {
    const motion = modeMotion.current
    const paper = entry.current
    if (!motion.busy || !paper) return
    const resize = paper.animate([
      { height: `${motion.height}px` },
      { height: `${paper.getBoundingClientRect().height}px` },
    ], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' })
    motion.animations.push(resize)
    void resize.finished.then(() => {
      if (!paper.isConnected) return
      motion.animations.forEach(animation => animation.cancel())
      motion.animations = []
      motion.busy = false
      setModeChanging(false)
    }).catch(() => { /* Unmount cancels the transition. */ })
  }, [mode])

  useEffect(() => { document.documentElement.lang = lang }, [lang])

  const mismatchMessage = t('auth.passwordMismatch')
  const hasMismatch = register && confirmation.length > 0 && confirmation !== password
  const showMismatch = hasMismatch && (confirmTouched || !password.startsWith(confirmation))
  const showMatched = register && confirmation.length >= 8 && confirmation === password

  useEffect(() => {
    confirmInput.current?.setCustomValidity(hasMismatch ? mismatchMessage : '')
  }, [hasMismatch, mismatchMessage])

  const syncCapsLock = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    setCapsLock(event.getModifierState('CapsLock'))
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (register && confirmation !== password) {
      event.preventDefault()
      setConfirmTouched(true)
      confirmInput.current?.focus()
      return
    }
    props.onSubmit(event)
  }

  const switchMode = () => {
    if (submitting || modeMotion.current.busy) return
    const motion = modeMotion.current
    if (!document.startViewTransition && entry.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      motion.busy = true
      motion.height = entry.current.getBoundingClientRect().height
      setModeChanging(true)
    }
    formTransition.run(() => {
      setVisible(false)
      setConfirmVisible(false)
      setConfirmTouched(false)
      setCapsLock(false)
      setConfirmation('')
      props.onMode()
    })
  }

  const previewLabel = t('auth.previewBadge')
  const previewProviders = [
    {
      id: 'Google' as const,
      ariaLabel: t('auth.continueWithPreviewAria', { provider: 'Google' }),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.61 4.61 0 0 1-2 3.03v2.52h3.24c1.9-1.75 2.98-4.33 2.98-7.38Z"/>
          <path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.39l-3.24-2.52c-.9.6-2.04.97-3.38.97-2.6 0-4.8-1.76-5.59-4.12H3.07v2.59A10 10 0 0 0 12 22Z"/>
          <path fill="#FBBC05" d="M6.41 13.94A6 6 0 0 1 6.1 12c0-.67.11-1.32.31-1.94V7.47H3.07A10 10 0 0 0 2 12c0 1.61.38 3.14 1.07 4.53l3.34-2.59Z"/>
          <path fill="#EA4335" d="M12 5.94c1.47 0 2.79.5 3.82 1.5l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.93 5.47l3.34 2.59C7.2 7.7 9.4 5.94 12 5.94Z"/>
        </svg>
      ),
    },
    {
      id: 'Facebook' as const,
      ariaLabel: t('auth.continueWithPreviewAria', { provider: 'Facebook' }),
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="11" fill="#1877F2"/>
          <path fill="#fff" d="M13.5 23v-8.5h2.9l.44-3.4H13.5V8.93c0-.98.27-1.65 1.68-1.65H17V4.24A24 24 0 0 0 14.35 4c-2.62 0-4.42 1.6-4.42 4.54v2.56H7v3.4h2.93V23z"/>
        </svg>
      ),
    },
  ]

  const passwordDescribedBy = [
    register ? 'auth-password-hint' : '',
    capsLock ? 'auth-capslock-note' : '',
  ].filter(Boolean).join(' ') || undefined

  const confirmDescribedBy = [
    showMismatch ? 'auth-confirm-error' : '',
    showMatched ? 'auth-confirm-match' : '',
    capsLock ? 'auth-capslock-note' : '',
  ].filter(Boolean).join(' ') || undefined

  return <main className="bifrost-auth" data-theme={theme} data-mode={mode} data-switching={modeChanging}>
    <div className="auth-atmosphere" aria-hidden="true"><img src="/design/paper-bridge-1672.webp" srcSet="/design/paper-bridge-960.webp 960w, /design/paper-bridge-1672.webp 1672w" sizes="100vw" width="1672" height="941" alt="" /></div>
    <header className="auth-masthead">
      <a className="auth-brand" href="#top" aria-label={t('auth.homeAria')}><BifrostMark size={30}/><span>Bifrost</span></a>
      <span className="auth-masthead-caption">{t('auth.mastheadCaption')}</span>
      <nav aria-label={t('auth.preferencesNavAria')}>
        <a href="#top">{t('auth.homeLink')} <span aria-hidden="true">↗</span></a>
        <LanguageSelect value={lang} onChange={props.onLanguage}/>
        <button
          type="button"
          onClick={props.onTheme}
          title={theme === 'dark' ? t('common.themeUseLight') : t('common.themeUseDark')}
          aria-label={theme === 'dark' ? t('common.themeUseLight') : t('common.themeUseDark')}
        >
          {theme === 'dark' ? <Sun size={16} aria-hidden="true"/> : <Moon size={16} aria-hidden="true"/>}
        </button>
      </nav>
    </header>
    <aside className="auth-artwork" aria-label={t('auth.artworkAria')}>
      <div className="auth-art-copy"><span lang="ja">離れていても、つながる。</span><h2>{t('auth.artworkHeadlineLine1')}<br />{t('auth.artworkHeadlineLine2')}</h2><p>{t('auth.artworkSubtitle')}</p></div>
      <div className="auth-art-foot"><span>WebRTC · P2P</span><span>{t('auth.artworkFooterTagline')}</span></div>
    </aside>
    <section ref={entry} className="auth-entry" aria-labelledby="auth-title">
      <div className="auth-entry-emblem" aria-hidden="true"><svg viewBox="0 0 50 26" fill="none"><path d="M3 23C13 23 12 3 25 3s12 20 22 20"/><path d="M7 23C16 23 15 8 25 8s9 15 18 15"/></svg></div>
      <div className="auth-form-area" inert={modeChanging}>
        <div className="auth-form-title" key={mode}><span>{register ? t('auth.registerStep') : t('auth.signInStep')}</span><h1 id="auth-title">{register ? t('auth.registerTitle') : t('auth.signInTitle')}</h1><p>{register ? t('auth.registerSubtitle') : t('auth.signInSubtitle')}</p></div>
        <form onSubmit={handleFormSubmit} aria-busy={submitting}>
          <fieldset disabled={submitting}>
            {register && (
              <div className="auth-field">
                <label className="auth-field-label" htmlFor="auth-name">
                  <span>{t('auth.fullNameLabel')}</span>
                  <span className="auth-required-mark" aria-hidden="true">*</span>
                </label>
                <input
                  id="auth-name"
                  name="name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={e => props.onName(e.target.value)}
                  placeholder={t('auth.fullNamePlaceholder')}
                />
              </div>
            )}
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="auth-email">
                <span>{t('auth.emailLabel')}</span>
                <span className="auth-required-mark" aria-hidden="true">*</span>
              </label>
              <input
                id="auth-email"
                name="email"
                autoComplete="email"
                inputMode="email"
                spellCheck={false}
                required
                maxLength={254}
                type="email"
                value={email}
                onChange={e => props.onEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
              />
            </div>
            <div className="auth-field">
              <label className="auth-field-label" htmlFor="auth-password">
                <span>{t('auth.passwordLabel')}</span>
                <span className="auth-required-mark" aria-hidden="true">*</span>
              </label>
              <div className="auth-password-wrap">
                <input
                  id="auth-password"
                  name="password"
                  autoComplete={register ? 'new-password' : 'current-password'}
                  placeholder={t('auth.passwordPlaceholder')}
                  required
                  minLength={8}
                  type={visible ? 'text' : 'password'}
                  value={password}
                  onChange={e => props.onPassword(e.target.value)}
                  onKeyDown={syncCapsLock}
                  onKeyUp={syncCapsLock}
                  onBlur={() => setCapsLock(false)}
                  aria-describedby={passwordDescribedBy}
                />
                <button
                  type="button"
                  onClick={() => setVisible(value => !value)}
                  aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
                  title={visible ? t('auth.hidePassword') : t('auth.showPassword')}
                  aria-pressed={visible}
                >
                  {visible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
                </button>
              </div>
              {(register || capsLock) && (
                <div className="auth-field-meta">
                  {register && <small id="auth-password-hint">{t('auth.passwordHint')}</small>}
                  {capsLock && (
                    <p id="auth-capslock-note" className="auth-capslock-note" role="status">
                      <kbd>{t('auth.capsLockBadge')}</kbd>
                      <span>{t('auth.capsLockOn')}</span>
                    </p>
                  )}
                </div>
              )}
            </div>
            {register && (
              <div className="auth-field">
                <label className="auth-field-label" htmlFor="auth-confirm">
                  <span>{t('auth.confirmPasswordLabel')}</span>
                  <span className="auth-required-mark" aria-hidden="true">*</span>
                </label>
                <div className="auth-password-wrap">
                  <input
                    ref={confirmInput}
                    id="auth-confirm"
                    name="password-confirmation"
                    autoComplete="new-password"
                    type={confirmVisible ? 'text' : 'password'}
                    placeholder={t('auth.confirmPasswordPlaceholder')}
                    required
                    value={confirmation}
                    onChange={e => setConfirmation(e.target.value)}
                    onKeyDown={syncCapsLock}
                    onKeyUp={syncCapsLock}
                    onBlur={() => {
                      setCapsLock(false)
                      if (confirmation.length > 0) setConfirmTouched(true)
                    }}
                    aria-invalid={showMismatch || undefined}
                    aria-describedby={confirmDescribedBy}
                  />
                  <button
                    type="button"
                    onClick={() => setConfirmVisible(value => !value)}
                    aria-label={confirmVisible ? t('auth.hideConfirmPassword') : t('auth.showConfirmPassword')}
                    title={confirmVisible ? t('auth.hideConfirmPassword') : t('auth.showConfirmPassword')}
                    aria-pressed={confirmVisible}
                  >
                    {confirmVisible ? <EyeOff size={18} aria-hidden="true"/> : <Eye size={18} aria-hidden="true"/>}
                  </button>
                </div>
                {showMismatch && (
                  <p id="auth-confirm-error" className="auth-field-feedback is-error" role="alert">
                    {mismatchMessage}
                  </p>
                )}
                {showMatched && (
                  <p id="auth-confirm-match" className="auth-field-feedback is-match" role="status">
                    <Check size={13} aria-hidden="true"/>
                    <span>{t('auth.passwordMatch')}</span>
                  </p>
                )}
              </div>
            )}
            {!register && (
              <button
                className="auth-recovery-link"
                type="button"
                aria-label={t('auth.forgotPasswordPreviewAria')}
                onClick={() => setAction('reset')}
              >
                <span className="auth-recovery-text">
                  {t('auth.forgotPassword')}
                </span>
                <span className="auth-preview-badge">{previewLabel}</span>
              </button>
            )}
            {error && <p className="auth-form-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={submitting} aria-busy={submitting || undefined}>
              <span>{submitting ? t('auth.submitting') : register ? t('auth.registerButton') : t('auth.signInButton')}</span>
              {submitting ? <span className="auth-submit-spinner" aria-hidden="true"/> : <ArrowUpRight size={21} aria-hidden="true"/>}
            </button>
          </fieldset>
        </form>
        {!register && (
          <div className="auth-providers">
            <div className="auth-email-divider">
              <span>{t('auth.orPreviewOptions')}</span>
            </div>
            <div
              className="auth-provider-row"
              role="group"
              aria-label={t('auth.previewOptionsGroupAria')}
            >
              {previewProviders.map(provider => (
                <button
                  key={provider.id}
                  type="button"
                  disabled={submitting || modeChanging}
                  aria-label={provider.ariaLabel}
                  onClick={() => setAction(provider.id)}
                >
                  <span className="auth-provider-main">
                    {provider.icon}
                    <span>{provider.id}</span>
                  </span>
                  <span className="auth-preview-badge">{previewLabel}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="auth-switch-copy">{register ? t('auth.haveAccount') : t('auth.noAccount')} <button type="button" disabled={submitting || modeChanging} onClick={switchMode}>{register ? t('auth.switchToSignIn') : t('auth.switchToRegister')}</button></p>
      </div>
    </section>
    <MotionPresence present={!!action}>{action && <AuthActionDialog action={action} lang={lang} onClose={() => setAction(null)}/>}</MotionPresence>
  </main>
}
