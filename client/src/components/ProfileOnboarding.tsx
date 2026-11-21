import { useState, type FormEvent } from 'react'
import { ArrowRight, Check, LogOut } from 'lucide-react'
import { BifrostMark } from '../homepage/components/UI'
import { createT, type Language } from '../i18n'
import './ProfileOnboarding.css'
import { AvatarPicker } from './AvatarPicker'
import { UserAvatar } from './UserAvatar'

type ProfileInput = { name: string; avatarDataUrl: string | null }
type Props = {
  name: string
  email: string
  lang: Language
  onLogout: () => void
  onSave: (profile: ProfileInput) => Promise<void>
}

export function ProfileOnboarding(props: Props) {
  const { lang } = props
  const t = createT(lang)
  const [name, setName] = useState(props.name)
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [imageBusy, setImageBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || imageBusy) return
    const trimmedName = name.trim()
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      setError(t('onboarding.displayNameLengthError'))
      return
    }
    setError('')
    setSaving(true)
    try {
      await props.onSave({ name: trimmedName, avatarDataUrl })
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('onboarding.saveErrorFallback')
      )
    } finally {
      setSaving(false)
    }
  }

  const previewName = name.trim() || t('onboarding.previewFallbackName')

  return (
    <main className="profile-setup">
      <header className="profile-setup-header">
        <a href="#top" aria-label={t('onboarding.backHomeAria')}>
          <BifrostMark size={30} />
          <span>Bifrost</span>
        </a>
        <button type="button" onClick={props.onLogout} disabled={saving}>
          <LogOut size={15} aria-hidden="true" />
          {t('onboarding.logout')}
        </button>
      </header>
      <div className="profile-setup-layout">
        <aside className="profile-setup-intro">
          <p className="profile-kicker">{t('onboarding.kicker')}</p>
          <h1>{t('onboarding.title')}</h1>
          <p>{t('onboarding.intro')}</p>
          <ol className="profile-setup-steps">
            <li>
              <span aria-hidden="true">
                <Check size={13} aria-hidden="true" />
              </span>
              {t('onboarding.stepAccount')}
            </li>
            <li aria-current="step">
              <span aria-hidden="true">02</span>
              {t('onboarding.stepProfile')}
            </li>
            <li>
              <span aria-hidden="true">03</span>
              {t('onboarding.stepWorkspace')}
            </li>
          </ol>
          <div className="profile-preview">
            <UserAvatar
              name={previewName}
              src={avatarDataUrl}
              size={53}
              seed={props.email || previewName}
            />
            <strong>{previewName}</strong>
            <span>{t('onboarding.previewCaption')}</span>
          </div>
        </aside>
        <section className="profile-setup-paper" aria-label={t('onboarding.sectionAria')}>
          <p className="profile-kicker">{t('onboarding.sectionKicker')}</p>
          <h2>{t('onboarding.sectionTitle')}</h2>
          <form onSubmit={submit} aria-busy={saving || undefined}>
            <fieldset disabled={saving}>
              <AvatarPicker
                value={avatarDataUrl}
                name={name}
                lang={lang}
                disabled={saving}
                onChange={setAvatarDataUrl}
                onBusy={setImageBusy}
              />
              <label htmlFor="setup-name">
                <span>
                  {t('onboarding.displayNameLabel')} <span className="form-required-mark" aria-hidden="true">*</span>
                </span>
                <input
                  id="setup-name"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  value={name}
                  onChange={event => {
                    setName(event.target.value)
                    if (error) setError('')
                  }}
                  placeholder={t('onboarding.displayNamePlaceholder')}
                  aria-describedby="setup-name-hint"
                  aria-invalid={Boolean(error) || undefined}
                />
                <small id="setup-name-hint">
                  {t('onboarding.displayNameHint')}
                </small>
              </label>
            </fieldset>
            {error && (
              <p className="profile-save-error" role="alert">
                {error}
              </p>
            )}
            <button
              type="submit"
              className="profile-save"
              disabled={saving || imageBusy}
              aria-busy={saving || undefined}
            >
              <span>
                {saving
                  ? t('onboarding.saving')
                  : t('onboarding.saveAndContinue')}
              </span>
              {saving ? <span className="btn-spinner" aria-hidden="true" /> : <ArrowRight size={18} aria-hidden="true" />}
            </button>
            <p className="profile-setup-footnote">
              {t('onboarding.footnote')}
            </p>
          </form>
        </section>
      </div>
    </main>
  )
}
