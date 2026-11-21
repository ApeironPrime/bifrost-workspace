import { createT, type Language } from '../i18n'
import { useDialogFocus } from '../lib/useDialogFocus'
import { X } from 'lucide-react'

/** FE-only flows. No email dispatch, credential collection, OAuth redirect or success claim without a service. */
export function AuthActionDialog({
  action,
  lang,
  onClose,
}: {
  action: 'Google' | 'Facebook' | 'reset'
  lang: Language
  onClose: () => void
}) {
  useDialogFocus(true, onClose, '.auth-preview-dialog')
  const t = createT(lang)
  const reset = action === 'reset'
  const titleId = 'auth-action-dialog-title'
  const descId = 'auth-action-dialog-desc'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <section
        className="modal-card auth-preview-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={event => event.stopPropagation()}
      >
        <div className="modal-header">
          <p className="auth-preview-tag">{t('authPreview.tag')}</p>
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
        <h2 id={titleId}>
          {reset
            ? t('authPreview.resetTitle')
            : t('authPreview.providerTitle', { provider: action })}
        </h2>
        <p id={descId}>
          {reset
            ? t('authPreview.resetDesc')
            : t('authPreview.providerDesc', { provider: action })}
        </p>
        <p className="auth-preview-status">
          {reset ? t('authPreview.resetNote') : t('authPreview.providerNote')}
        </p>
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            {t('authPreview.backToSignIn')}
          </button>
        </div>
      </section>
    </div>
  )
}
