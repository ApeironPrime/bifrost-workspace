import { useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { createT, type Language } from '../../i18n'
import { apiUrl, fetchAppApi } from '../../lib/appApi'
import { useDialogFocus } from '../../shared/hooks/useDialogFocus'

export function AuthActionDialog({
  initialEmail = '',
  lang,
  onClose,
}: {
  initialEmail?: string
  lang: Language
  onClose: () => void
}) {
  useDialogFocus(true, onClose, '.auth-preview-dialog')
  const t = createT(lang)
  const titleId = 'auth-action-dialog-title'
  const descId = 'auth-action-dialog-desc'

  const [step, setStep] = useState<'request' | 'confirm' | 'done'>('request')
  const [email, setEmail] = useState(initialEmail)
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [devCodeHint, setDevCodeHint] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const handleRequestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const response = await fetchAppApi(apiUrl('/auth/forgot-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        message?: string
        devResetCode?: string
      }
      if (!response.ok) {
        throw new Error(body.message || t('authReset.sendFailed'))
      }
      setDevCodeHint(body.devResetCode ?? '')
      setStep('confirm')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('authReset.sendFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const response = await fetchAppApi(apiUrl('/auth/reset-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          newPassword,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as { message?: string }
      if (!response.ok) {
        throw new Error(body.message || t('authReset.resetFailed'))
      }
      setStep('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('authReset.resetFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className="modal-card auth-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <p className="auth-preview-tag">{t('authReset.tag')}</p>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label={t('common.close')}
            title={t('common.close')}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <h2 id={titleId}>{t('authReset.title')}</h2>
        <p id={descId}>
          {step === 'request'
            ? t('authReset.emailDesc')
            : step === 'confirm'
              ? t('authReset.codeDesc')
              : t('authReset.successMessage')}
        </p>

        {step === 'request' && (
          <form onSubmit={handleRequestCode} className="form-stack">
            <div className="form-field">
              <label htmlFor="reset-email" className="form-field-label">
                <span>{t('authReset.emailLabel')}</span>
              </label>
              <input
                id="reset-email"
                type="email"
                required
                maxLength={254}
                className="input-text"
                placeholder={t('auth.emailPlaceholder')}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
                {t('authReset.backToSignIn')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('authReset.sendingCode') : t('authReset.sendCodeButton')}
              </button>
            </div>
          </form>
        )}

        {step === 'confirm' && (
          <form onSubmit={handleResetPassword} className="form-stack">
            {devCodeHint && (
              <p className="auth-preview-status">
                {t('authReset.devCodeHint', { code: devCodeHint })}
              </p>
            )}
            <div className="form-field">
              <label htmlFor="reset-code" className="form-field-label">
                <span>{t('authReset.codeLabel')}</span>
              </label>
              <input
                id="reset-code"
                type="text"
                inputMode="numeric"
                required
                minLength={6}
                maxLength={6}
                className="input-text"
                placeholder={t('authReset.codePlaceholder')}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={busy}
              />
            </div>
            <div className="form-field">
              <label htmlFor="reset-new-password" className="form-field-label">
                <span>{t('authReset.newPasswordLabel')}</span>
              </label>
              <input
                id="reset-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={100}
                className="input-text"
                placeholder={t('authReset.newPasswordPlaceholder')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={busy}
              />
            </div>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
                {t('authReset.backToSignIn')}
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? t('authReset.resetting') : t('authReset.resetButton')}
              </button>
            </div>
          </form>
        )}

        {step === 'done' && (
          <div className="confirm-actions">
            <button type="button" className="btn btn-primary" onClick={onClose}>
              {t('authReset.backToSignIn')}
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
