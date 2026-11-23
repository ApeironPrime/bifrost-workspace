import { LanguageSelect } from '../../../shared/components/LanguageSelect'
import { translateLanding, type Language } from '../../../i18n/landing'
import { Sun, Moon } from 'lucide-react'
const avatarBg: Record<string, string> = {
  NMA: '#C8D8C2',
  THK: '#D8C8C2',
  LTM: '#C2C8D8',
  PDL: '#D0CEC4',
  HVB: '#CCCADC',
}

export function Avatar({
  id,
  size = 32,
  showRing = false,
}: {
  id: string
  size?: number
  showRing?: boolean
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: avatarBg[id] ?? '#D4CECC',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: Math.round(size * 0.34),
        fontWeight: 500,
        color: 'var(--avatar-ink)',
        flexShrink: 0,
        letterSpacing: '0.01em',
        userSelect: 'none',
        boxShadow: showRing ? '0 0 0 2px var(--accent)' : undefined,
        transition: 'box-shadow 0.15s',
      }}
    >
      {id}
    </div>
  )
}

export function BifrostMark({ size = 26 }: { size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        backgroundColor: 'var(--brand-ink)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <svg width={Math.round(size * 0.66)} height={Math.round(size * 0.66)} viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path
          d="M1.5 10 C4.2 10 4.2 3.8 7 3.8 C9.8 3.8 9.8 10 12.5 10"
          stroke="white"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
        <path d="M1.8 10.6 C4.4 10.6 4.4 4.6 7 4.6 C9.6 4.6 9.6 10.6 12.2 10.6" stroke="#D99A68" strokeWidth="0.7" strokeLinecap="round" />
        <path d="M2.2 11.1 C4.6 11.1 4.6 5.3 7 5.3 C9.4 5.3 9.4 11.1 11.8 11.1" stroke="#8FAE9A" strokeWidth="0.7" strokeLinecap="round" />
      </svg>
    </div>
  )
}

export function TopControls({
  lang,
  setLang,
  isDark,
  setIsDark,
}: {
  lang: Language
  setLang: (l: Language) => void
  isDark: boolean
  setIsDark: (d: boolean) => void
}) {
  const themeLabel = isDark
    ? translateLanding(lang, 'common.themeUseLight')
    : translateLanding(lang, 'common.themeUseDark')

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <LanguageSelect value={lang} onChange={setLang} compact />

      {/* Theme toggle */}
      <button
        type="button"
        onClick={() => setIsDark(!isDark)}
        className="homepage-theme-toggle"
        title={themeLabel}
        aria-label={themeLabel}
      >
        {isDark ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
        <span>{isDark ? translateLanding(lang, 'common.themeLight') : translateLanding(lang, 'common.themeDark')}</span>
      </button>
    </div>
  )
}
