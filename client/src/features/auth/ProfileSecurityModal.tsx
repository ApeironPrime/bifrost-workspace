import type { FormEvent } from 'react'
import { X } from 'lucide-react'
import type { Language } from '../../i18n'
import { isDevMockSession } from '../../lib/appApi'
import { requestBrowserNotificationPermission } from '../../lib/callNotification'
import { getAvatarTone } from '../../lib/controlPrimitives'
import { AvatarPicker } from '../../shared/components/AvatarPicker'
import { MotionPresence } from '../../shared/components/MotionPresence'
import type { DiscardFormKind, TranslatorFn, User } from '../../types/workspace'

type Props = {
  user: User
  token: string
  lang: Language
  showProfileModal: boolean
  discardForm: DiscardFormKind
  profileAvatar: string | null
  profileName: string
  profileMessage: string
  profileSaving: boolean
  profileImageBusy: boolean
  currentPasswordInput: string
  newPasswordInput: string
  confirmNewPasswordInput: string
  passwordSaving: boolean
  passwordError: string
  emailVerifyCode: string
  emailVerifyDevCode: string
  emailVerifyBusy: boolean
  twoFactorSetupSecret: string
  twoFactorSetupCode: string
  twoFactorRecoveryCodes: string[]
  twoFactorBusy: boolean
  twoFactorError: string
  notificationPermission: NotificationPermission | 'unsupported'
  t: TranslatorFn
  closeProfileForm: () => void
  updateProfile: (event: FormEvent<HTMLFormElement>) => void
  setProfileAvatar: (avatar: string | null) => void
  setProfileImageBusy: (busy: boolean) => void
  setProfileName: (name: string) => void
  setProfileMessage: (msg: string) => void
  submitChangePassword: (event: FormEvent<HTMLFormElement>) => void
  setCurrentPasswordInput: (value: string) => void
  setNewPasswordInput: (value: string) => void
  setConfirmNewPasswordInput: (value: string) => void
  handleSendEmailVerification: () => Promise<void>
  handleVerifyEmailCode: (event: FormEvent<HTMLFormElement>) => void
  setEmailVerifyCode: (value: string) => void
  handleSetupTwoFactor: () => Promise<void>
  handleEnableTwoFactor: (event: FormEvent<HTMLFormElement>) => void
  handleDisableTwoFactor: (event: FormEvent<HTMLFormElement>) => void
  setTwoFactorSetupCode: (value: string) => void
  setNotificationPermission: (perm: NotificationPermission | 'unsupported') => void
}

export function ProfileSecurityModal(props: Props) {
  const {
    user,
    token,
    lang,
    showProfileModal,
    discardForm,
    profileAvatar,
    profileName,
    profileMessage,
    profileSaving,
    profileImageBusy,
    currentPasswordInput,
    newPasswordInput,
    confirmNewPasswordInput,
    passwordSaving,
    passwordError,
    emailVerifyCode,
    emailVerifyDevCode,
    emailVerifyBusy,
    twoFactorSetupSecret,
    twoFactorSetupCode,
    twoFactorRecoveryCodes,
    twoFactorBusy,
    twoFactorError,
    notificationPermission,
    t,
    closeProfileForm,
    updateProfile,
    setProfileAvatar,
    setProfileImageBusy,
    setProfileName,
    setProfileMessage,
    submitChangePassword,
    setCurrentPasswordInput,
    setNewPasswordInput,
    setConfirmNewPasswordInput,
    handleSendEmailVerification,
    handleVerifyEmailCode,
    setEmailVerifyCode,
    handleSetupTwoFactor,
    handleEnableTwoFactor,
    handleDisableTwoFactor,
    setTwoFactorSetupCode,
    setNotificationPermission,
  } = props

  return (
    <MotionPresence present={showProfileModal && !discardForm}>
      <div className="modal-overlay" onClick={closeProfileForm}>
        <section
          className="modal-card profile-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-profile-title"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <h3 id="modal-profile-title">{t('profile.modalTitle')}</h3>
            <button
              type="button"
              className="btn-icon"
              onClick={closeProfileForm}
              disabled={profileSaving || profileImageBusy}
              aria-label={t('common.close')}
              title={t('common.close')}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <form onSubmit={updateProfile} className="form-stack" aria-busy={profileSaving || undefined}>
            <AvatarPicker
              key={`${user.id}:${showProfileModal}:${isDevMockSession(token)}`}
              value={profileAvatar}
              name={profileName}
              color={getAvatarTone(user.id)}
              lang={lang}
              disabled={profileSaving}
              onChange={setProfileAvatar}
              onBusy={setProfileImageBusy}
            />
            <div className="form-field">
              <label htmlFor="modal-profile-name" className="form-field-label">
                <span>{t('profile.displayName')}</span>
                <span className="form-required-mark" aria-hidden="true">
                  *
                </span>
              </label>
              <input
                id="modal-profile-name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={100}
                disabled={profileSaving}
                className="input-text"
                value={profileName}
                onChange={(event) => {
                  setProfileName(event.target.value)
                  if (profileMessage) setProfileMessage('')
                }}
                aria-invalid={Boolean(profileMessage) || undefined}
                aria-describedby={profileMessage ? 'modal-profile-error' : 'modal-profile-hint'}
              />
              <p id="modal-profile-hint" className="form-field-hint">
                {t('profile.displayNameHint')}
              </p>
            </div>
            {profileMessage && (
              <p id="modal-profile-error" className="form-error" role="alert">
                {profileMessage}
              </p>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={closeProfileForm}
                disabled={profileSaving || profileImageBusy}
              >
                {t('common.close')}
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={profileSaving || profileImageBusy}
                aria-busy={profileSaving || undefined}
              >
                {profileSaving && <span className="btn-spinner" aria-hidden="true" />}
                <span>{profileSaving ? t('common.saving') : t('profile.saveButton')}</span>
              </button>
            </div>
          </form>
          {!isDevMockSession(token) && (
            <form
              onSubmit={submitChangePassword}
              className="form-stack profile-security-form"
              aria-busy={passwordSaving || undefined}
            >
              <hr className="modal-section-divider" />
              <p className="eyebrow">{t('profile.securityHeading')}</p>
              <div className="form-field">
                <label htmlFor="modal-current-password" className="form-field-label">
                  <span>{t('profile.currentPasswordLabel')}</span>
                </label>
                <input
                  id="modal-current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  minLength={8}
                  maxLength={100}
                  disabled={passwordSaving}
                  className="input-text"
                  value={currentPasswordInput}
                  onChange={(event) => setCurrentPasswordInput(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="modal-new-password" className="form-field-label">
                  <span>{t('profile.newPasswordLabel')}</span>
                </label>
                <input
                  id="modal-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={100}
                  disabled={passwordSaving}
                  className="input-text"
                  value={newPasswordInput}
                  onChange={(event) => setNewPasswordInput(event.target.value)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="modal-confirm-new-password" className="form-field-label">
                  <span>{t('profile.confirmNewPasswordLabel')}</span>
                </label>
                <input
                  id="modal-confirm-new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={100}
                  disabled={passwordSaving}
                  className="input-text"
                  value={confirmNewPasswordInput}
                  onChange={(event) => setConfirmNewPasswordInput(event.target.value)}
                />
              </div>
              {passwordError && (
                <p className="form-error" role="alert">
                  {passwordError}
                </p>
              )}
              <div className="modal-actions">
                <button
                  type="submit"
                  className="btn btn-secondary"
                  disabled={passwordSaving}
                  aria-busy={passwordSaving || undefined}
                >
                  {passwordSaving && <span className="btn-spinner" aria-hidden="true" />}
                  <span>
                    {passwordSaving ? t('profile.changingPassword') : t('profile.changePasswordButton')}
                  </span>
                </button>
              </div>
            </form>
          )}
          {!isDevMockSession(token) && (
            <div className="form-stack profile-security-form">
              <hr className="modal-section-divider" />
              <p className="eyebrow">{t('profile.emailVerificationHeading')}</p>
              <p className="form-field-hint">
                {user.emailVerified ? t('profile.emailVerifiedBadge') : t('profile.emailUnverifiedBadge')}
              </p>
              {!user.emailVerified && (
                <>
                  <div className="modal-actions">
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={emailVerifyBusy}
                      onClick={() => void handleSendEmailVerification()}
                    >
                      {emailVerifyBusy
                        ? t('profile.sendingVerification')
                        : t('profile.sendVerificationButton')}
                    </button>
                  </div>
                  {emailVerifyDevCode && (
                    <p className="form-field-hint">
                      {t('profile.verificationDevCodeHint', { code: emailVerifyDevCode })}
                    </p>
                  )}
                  <form onSubmit={handleVerifyEmailCode} className="form-stack">
                    <div className="form-field">
                      <label htmlFor="modal-verify-email-code" className="form-field-label">
                        <span>{t('profile.verificationCodeLabel')}</span>
                      </label>
                      <input
                        id="modal-verify-email-code"
                        type="text"
                        inputMode="numeric"
                        required
                        minLength={6}
                        maxLength={6}
                        className="input-text"
                        placeholder={t('profile.verificationCodePlaceholder')}
                        value={emailVerifyCode}
                        onChange={(e) => setEmailVerifyCode(e.target.value)}
                        disabled={emailVerifyBusy}
                      />
                    </div>
                    <div className="modal-actions">
                      <button type="submit" className="btn btn-primary" disabled={emailVerifyBusy}>
                        {emailVerifyBusy ? t('profile.verifyingEmail') : t('profile.verifyEmailButton')}
                      </button>
                    </div>
                  </form>
                </>
              )}

              <hr className="modal-section-divider" />
              <p className="eyebrow">{t('profile.twoFactorHeading')}</p>
              <p className="form-field-hint">
                {user.twoFactorEnabled ? t('profile.twoFactorEnabledBadge') : t('profile.twoFactorDisabledBadge')}
              </p>
              {!user.twoFactorEnabled && !twoFactorSetupSecret && (
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={twoFactorBusy}
                    onClick={() => void handleSetupTwoFactor()}
                  >
                    {twoFactorBusy ? t('profile.settingUpTwoFactor') : t('profile.setupTwoFactorButton')}
                  </button>
                </div>
              )}
              {!user.twoFactorEnabled && twoFactorSetupSecret && (
                <form onSubmit={handleEnableTwoFactor} className="form-stack">
                  <div className="form-field">
                    <label htmlFor="modal-2fa-secret" className="form-field-label">
                      <span>{t('profile.twoFactorSecretLabel')}</span>
                    </label>
                    <input
                      id="modal-2fa-secret"
                      type="text"
                      readOnly
                      className="input-text"
                      value={twoFactorSetupSecret}
                    />
                  </div>
                  <div className="form-field">
                    <label htmlFor="modal-2fa-enable-code" className="form-field-label">
                      <span>{t('profile.twoFactorCodeInputLabel')}</span>
                    </label>
                    <input
                      id="modal-2fa-enable-code"
                      type="text"
                      inputMode="numeric"
                      required
                      minLength={6}
                      maxLength={6}
                      className="input-text"
                      placeholder={t('profile.twoFactorCodePlaceholder')}
                      value={twoFactorSetupCode}
                      onChange={(e) => setTwoFactorSetupCode(e.target.value)}
                      disabled={twoFactorBusy}
                    />
                  </div>
                  <div className="modal-actions">
                    <button type="submit" className="btn btn-primary" disabled={twoFactorBusy}>
                      {twoFactorBusy ? t('profile.enablingTwoFactor') : t('profile.enableTwoFactorButton')}
                    </button>
                  </div>
                </form>
              )}
              {user.twoFactorEnabled && (
                <form onSubmit={handleDisableTwoFactor} className="form-stack">
                  <div className="form-field">
                    <label htmlFor="modal-2fa-disable-code" className="form-field-label">
                      <span>{t('profile.twoFactorCodeInputLabel')}</span>
                    </label>
                    <input
                      id="modal-2fa-disable-code"
                      type="text"
                      required
                      minLength={6}
                      maxLength={32}
                      className="input-text"
                      placeholder={t('profile.twoFactorCodePlaceholder')}
                      value={twoFactorSetupCode}
                      onChange={(e) => setTwoFactorSetupCode(e.target.value)}
                      disabled={twoFactorBusy}
                    />
                  </div>
                  <div className="modal-actions">
                    <button type="submit" className="btn btn-secondary" disabled={twoFactorBusy}>
                      {twoFactorBusy ? t('profile.disablingTwoFactor') : t('profile.disableTwoFactorButton')}
                    </button>
                  </div>
                </form>
              )}
              {twoFactorRecoveryCodes.length > 0 && (
                <div className="form-field">
                  <p className="form-field-hint">{t('profile.twoFactorRecoveryHeading')}</p>
                  <code>{twoFactorRecoveryCodes.join(' · ')}</code>
                </div>
              )}
              {twoFactorError && (
                <p className="form-error" role="alert">
                  {twoFactorError}
                </p>
              )}

              <hr className="modal-section-divider" />
              <p className="eyebrow">{t('profile.notificationsHeading')}</p>
              <p className="form-field-hint">
                {notificationPermission === 'granted'
                  ? t('profile.notificationsEnabled')
                  : notificationPermission === 'denied'
                    ? t('profile.notificationsBlocked')
                    : t('profile.notificationsPrompt')}
              </p>
              {notificationPermission !== 'granted' && notificationPermission !== 'unsupported' && (
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      void requestBrowserNotificationPermission().then((perm) =>
                        setNotificationPermission(perm),
                      )
                    }
                  >
                    {t('profile.enableNotificationsButton')}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </MotionPresence>
  )
}
