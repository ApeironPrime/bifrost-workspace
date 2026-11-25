import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { apiUrl, fetchAppApi, isDevMockSession } from '../../../lib/appApi';
import { getNotificationPermissionState } from '../../../lib/callNotification';
import type { I18nKey } from '../../../i18n';
import type { ToastType } from '../../../shared/components/Toast';
import type { DiscardFormKind, User } from '../../../types/workspace';

export interface UseAuthAndProfileOptions {
  t: (key: I18nKey, params?: Record<string, string | number>) => string;
  addToast: (message: string, type?: ToastType, duration?: number) => void;
  setDiscardForm: (kind: DiscardFormKind | null) => void;
  setIsSidebarOpen: (open: boolean) => void;
  hideRailTip: () => void;
  onCleanupBeforeLogout: () => void;
  onLoggedOut: () => void;
}

export function useAuthAndProfile({
  t,
  addToast,
  setDiscardForm,
  setIsSidebarOpen,
  hideRailTip,
  onCleanupBeforeLogout,
  onLoggedOut,
}: UseAuthAndProfileOptions) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string>('');
  const tokenRef = useRef('');
  const userIdRef = useRef('');

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const userId = user?.id ?? '';
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authName, setAuthName] = useState('');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [twoFactorChallengeToken, setTwoFactorChallengeToken] = useState('');
  const [twoFactorLoginCode, setTwoFactorLoginCode] = useState('');

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profileName, setProfileName] = useState('');
  const [profileAvatar, setProfileAvatar] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileImageBusy, setProfileImageBusy] = useState(false);
  const [currentPasswordInput, setCurrentPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [emailVerifyCode, setEmailVerifyCode] = useState('');
  const [emailVerifyDevCode, setEmailVerifyDevCode] = useState('');
  const [emailVerifyBusy, setEmailVerifyBusy] = useState(false);
  const [twoFactorSetupSecret, setTwoFactorSetupSecret] = useState('');
  const [twoFactorSetupCode, setTwoFactorSetupCode] = useState('');
  const [twoFactorRecoveryCodes, setTwoFactorRecoveryCodes] = useState<string[]>([]);
  const [twoFactorBusy, setTwoFactorBusy] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState('');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    getNotificationPermissionState(),
  );

  const authHeaders = useCallback((): Record<string, string> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }, [token]);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    const legacyRefresh = localStorage.getItem('bifrost_refresh_token');
    try {
      const response = await fetchAppApi(apiUrl('/auth/refresh'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyRefresh ? { refreshToken: legacyRefresh } : {}),
      });
      if (!response.ok) return null;
      const body = await response.json();
      if (!body.token) return null;
      setToken(body.token);
      localStorage.setItem('bifrost_has_session', '1');
      localStorage.removeItem('bifrost_token');
      localStorage.removeItem('bifrost_refresh_token');
      return body.token as string;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    const legacyToken = localStorage.getItem('bifrost_token');
    const legacyRefresh = localStorage.getItem('bifrost_refresh_token');
    const hasSessionHint = localStorage.getItem('bifrost_has_session') === '1';

    if (legacyToken && isDevMockSession(legacyToken)) {
      queueMicrotask(() => {
        if (!active) return;
        setToken(legacyToken);
        setAuthReady(true);
      });
      return () => {
        active = false;
      };
    }

    if (!legacyToken && !legacyRefresh && !hasSessionHint) {
      queueMicrotask(() => {
        if (!active) return;
        setAuthReady(true);
      });
      return () => {
        active = false;
      };
    }

    const bootstrapSession = async () => {
      if (legacyToken) {
        try {
          const meResponse = await fetchAppApi(apiUrl('/auth/me'), {
            credentials: 'include',
            headers: { Authorization: `Bearer ${legacyToken}` },
          });
          if (meResponse.ok) {
            const meBody = await meResponse.json();
            if (!active) return;
            if (meBody.user) setUser(meBody.user);
            setToken(legacyToken);
            localStorage.setItem('bifrost_has_session', '1');
            localStorage.removeItem('bifrost_token');
            setAuthReady(true);
            return;
          }
        } catch {
          /* Fall through to cookie/refresh rotation */
        }
      }

      const rotatedToken = await refreshAccessToken();
      if (!active) return;
      if (!rotatedToken) {
        localStorage.removeItem('bifrost_token');
        localStorage.removeItem('bifrost_refresh_token');
        localStorage.removeItem('bifrost_has_session');
        setToken('');
        setUser(null);
      }
      setAuthReady(true);
    };

    void bootstrapSession();
    return () => {
      active = false;
    };
  }, [refreshAccessToken]);

  useEffect(() => {
    if (!token) {
      queueMicrotask(() => {
        setAuthReady(true);
      });
      return;
    }

    let cancelled = false;

    const loadCurrentUser = async () => {
      try {
        const res = await fetchAppApi(apiUrl('/auth/me'), {
          credentials: 'include',
          headers: authHeaders(),
        });
        const body = await res.json();
        if (cancelled) return;
        if (res.ok && body.user) {
          setUser(body.user);
          return;
        }
        if (res.status === 401 && !isDevMockSession(token)) {
          const rotated = await refreshAccessToken();
          if (rotated || cancelled) return;
        }
        localStorage.removeItem('bifrost_token');
        localStorage.removeItem('bifrost_refresh_token');
        localStorage.removeItem('bifrost_has_session');
        setToken('');
        setUser(null);
      } catch {
        // Keep session state on transient network failure
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    };

    void loadCurrentUser();

    return () => {
      cancelled = true;
    };
  }, [token, authHeaders, refreshAccessToken]);

  const userName = user?.name;
  const userEmail = user?.email;
  const memoCurrentUser = useMemo(
    () =>
      userId && userName !== undefined && userEmail !== undefined
        ? { id: userId, name: userName, email: userEmail }
        : null,
    [userId, userName, userEmail],
  );

  const memberCurrentUser = useMemo(
    () =>
      user
        ? {
            id: user.id,
            name: user.name,
            avatarDataUrl: user.profile?.avatarDataUrl ?? null,
          }
        : undefined,
    [user],
  );

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (authSubmitting) return;
    setAuthError('');
    setAuthSubmitting(true);

    try {
      const endpoint = twoFactorChallengeToken
        ? '/auth/login/2fa'
        : authMode === 'login'
          ? '/auth/login'
          : '/auth/register';
      const payload = twoFactorChallengeToken
        ? { challengeToken: twoFactorChallengeToken, code: twoFactorLoginCode }
        : authMode === 'login'
          ? { email: authEmail, password: authPassword }
          : { name: authName, email: authEmail, password: authPassword };

      const response = await fetchAppApi(apiUrl(endpoint), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const body = await response.json();
      if (!response.ok) {
        setAuthError(body.message || t('auth.authFailed'));
        return;
      }

      if (body.requiresTwoFactor && body.challengeToken) {
        setTwoFactorChallengeToken(body.challengeToken);
        setTwoFactorLoginCode('');
        setAuthError('');
        return;
      }

      setTwoFactorChallengeToken('');
      setTwoFactorLoginCode('');
      localStorage.setItem('bifrost_has_session', '1');
      localStorage.removeItem('bifrost_token');
      localStorage.removeItem('bifrost_refresh_token');
      setToken(body.token);
      setUser(body.user);
      setAuthReady(true);
      setAuthPassword('');
    } catch {
      setAuthError(t('auth.authFailed'));
    } finally {
      setAuthSubmitting(false);
    }
  };

  const updateProfile = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (profileSaving || profileImageBusy) return;
    setProfileMessage('');
    if (!profileName.trim()) {
      setProfileMessage(t('profile.updateFailedToast'));
      return;
    }

    setProfileSaving(true);
    try {
      const response = await fetchAppApi(apiUrl('/auth/profile'), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name: profileName.trim(),
          avatarDataUrl: profileAvatar ?? null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.updateFailedToast'));
      setUser(body.user);
      setShowProfileModal(false);
      addToast(t('profile.updatedToast'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('profile.updateFailedToast');
      setProfileMessage(msg);
      addToast(msg, 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const completeOnboarding = useCallback(
    async ({ name, avatarDataUrl }: { name: string; avatarDataUrl?: string | null }) => {
      const response = await fetchAppApi(apiUrl('/auth/profile'), {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({
          name,
          avatarDataUrl: avatarDataUrl ?? null,
          completed: true,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.updateFailedToast'));
      setUser(body.user);
      addToast(t('profile.updatedToast'), 'success');
    },
    [authHeaders, addToast, t],
  );

  const handleSendEmailVerification = useCallback(async () => {
    if (emailVerifyBusy || isDevMockSession(token)) return;
    setEmailVerifyBusy(true);
    try {
      const response = await fetchAppApi(apiUrl('/auth/verify-email/send'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.verificationFailed'));
      if (typeof body.devVerificationCode === 'string') {
        setEmailVerifyDevCode(body.devVerificationCode);
      }
      addToast(t('profile.verificationSentToast'), 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('profile.verificationFailed'), 'error');
    } finally {
      setEmailVerifyBusy(false);
    }
  }, [emailVerifyBusy, token, authHeaders, addToast, t]);

  const handleVerifyEmailCode = useCallback(async () => {
    if (emailVerifyBusy || !emailVerifyCode.trim() || isDevMockSession(token)) return;
    setEmailVerifyBusy(true);
    try {
      const response = await fetchAppApi(apiUrl('/auth/verify-email/confirm'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ code: emailVerifyCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.verificationFailed'));
      if (body.user) setUser(body.user);
      setEmailVerifyCode('');
      setEmailVerifyDevCode('');
      addToast(t('profile.emailVerifiedToast'), 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : t('profile.verificationFailed'), 'error');
    } finally {
      setEmailVerifyBusy(false);
    }
  }, [emailVerifyBusy, emailVerifyCode, token, authHeaders, addToast, t]);

  const handleSetupTwoFactor = useCallback(async () => {
    if (twoFactorBusy || isDevMockSession(token)) return;
    setTwoFactorBusy(true);
    setTwoFactorError('');
    try {
      const response = await fetchAppApi(apiUrl('/auth/2fa/setup'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.twoFactorActionFailed'));
      setTwoFactorSetupSecret(body.secret || '');
      setTwoFactorSetupCode('');
      setTwoFactorRecoveryCodes([]);
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t('profile.twoFactorActionFailed'));
    } finally {
      setTwoFactorBusy(false);
    }
  }, [twoFactorBusy, token, authHeaders, t]);

  const handleEnableTwoFactor = useCallback(async () => {
    if (twoFactorBusy || !twoFactorSetupCode.trim() || isDevMockSession(token)) return;
    setTwoFactorBusy(true);
    setTwoFactorError('');
    try {
      const response = await fetchAppApi(apiUrl('/auth/2fa/enable'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ code: twoFactorSetupCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.twoFactorActionFailed'));
      if (body.user) setUser(body.user);
      setTwoFactorRecoveryCodes(Array.isArray(body.recoveryCodes) ? body.recoveryCodes : []);
      setTwoFactorSetupSecret('');
      setTwoFactorSetupCode('');
      addToast(t('profile.twoFactorEnabledToast'), 'success');
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t('profile.twoFactorActionFailed'));
    } finally {
      setTwoFactorBusy(false);
    }
  }, [twoFactorBusy, twoFactorSetupCode, token, authHeaders, addToast, t]);

  const handleDisableTwoFactor = useCallback(async () => {
    if (twoFactorBusy || !twoFactorSetupCode.trim() || isDevMockSession(token)) return;
    setTwoFactorBusy(true);
    setTwoFactorError('');
    try {
      const response = await fetchAppApi(apiUrl('/auth/2fa/disable'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({ code: twoFactorSetupCode.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.twoFactorActionFailed'));
      if (body.user) setUser(body.user);
      setTwoFactorRecoveryCodes([]);
      setTwoFactorSetupCode('');
      addToast(t('profile.twoFactorDisabledToast'), 'success');
    } catch (error) {
      setTwoFactorError(error instanceof Error ? error.message : t('profile.twoFactorActionFailed'));
    } finally {
      setTwoFactorBusy(false);
    }
  }, [twoFactorBusy, twoFactorSetupCode, token, authHeaders, addToast, t]);

  const submitChangePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (passwordSaving || isDevMockSession(token)) return;
    setPasswordError('');
    if (newPasswordInput !== confirmNewPasswordInput) {
      setPasswordError(t('profile.passwordMismatch'));
      return;
    }
    setPasswordSaving(true);
    try {
      const response = await fetchAppApi(apiUrl('/auth/change-password'), {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: JSON.stringify({
          currentPassword: currentPasswordInput,
          newPassword: newPasswordInput,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || t('profile.passwordUpdateFailed'));
      if (body.token) {
        setToken(body.token);
      }
      localStorage.setItem('bifrost_has_session', '1');
      localStorage.removeItem('bifrost_token');
      localStorage.removeItem('bifrost_refresh_token');
      setCurrentPasswordInput('');
      setNewPasswordInput('');
      setConfirmNewPasswordInput('');
      addToast(t('profile.passwordUpdatedToast'), 'success');
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('profile.passwordUpdateFailed');
      setPasswordError(msg);
      addToast(msg, 'error');
    } finally {
      setPasswordSaving(false);
    }
  };

  const logout = useCallback(() => {
    const legacyRefresh = localStorage.getItem('bifrost_refresh_token');
    if (!isDevMockSession(tokenRef.current)) {
      void fetchAppApi(apiUrl('/auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(legacyRefresh ? { refreshToken: legacyRefresh } : {}),
      }).catch(() => {
        /* Best-effort server revocation; local state still clears. */
      });
    }
    onCleanupBeforeLogout();
    localStorage.removeItem('bifrost_token');
    localStorage.removeItem('bifrost_refresh_token');
    localStorage.removeItem('bifrost_has_session');
    if (userId) {
      for (const key of Object.keys(sessionStorage)) {
        if (key.startsWith('bifrost-room-draft:' + encodeURIComponent(userId) + ':')) {
          sessionStorage.removeItem(key);
        }
      }
    }
    setToken('');
    setUser(null);
    setAuthReady(true);
    setShowProfileModal(false);
    setProfileName('');
    setProfileAvatar(null);
    setProfileMessage('');
    setDiscardForm(null);
    setAuthEmail('');
    setAuthName('');
    setAuthPassword('');
    setAuthError('');
    setAuthMode('login');
    onLoggedOut();
  }, [onCleanupBeforeLogout, onLoggedOut, setDiscardForm, userId]);

  const openProfileModal = useCallback(() => {
    if (!user) return;
    setProfileName(user.name);
    setProfileAvatar(user.profile?.avatarDataUrl ?? null);
    setProfileImageBusy(false);
    setProfileMessage('');
    hideRailTip();
    setIsSidebarOpen(false);
    setShowProfileModal(true);
  }, [user, hideRailTip, setIsSidebarOpen]);

  const closeProfileForm = useCallback(() => {
    if (profileSaving || profileImageBusy) return;
    const avatarDirty = profileAvatar !== (user?.profile?.avatarDataUrl ?? null);
    if (profileName !== user?.name || avatarDirty) setDiscardForm('profile');
    else setShowProfileModal(false);
  }, [profileAvatar, profileImageBusy, profileName, profileSaving, setDiscardForm, user?.name, user?.profile?.avatarDataUrl]);

  return {
    authReady,
    user,
    setUser,
    token,
    tokenRef,
    userId,
    userIdRef,
    memoCurrentUser,
    memberCurrentUser,
    authHeaders,
    refreshAccessToken,
    authMode,
    setAuthMode,
    authName,
    setAuthName,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authError,
    setAuthError,
    authSubmitting,
    twoFactorChallengeToken,
    setTwoFactorChallengeToken,
    twoFactorLoginCode,
    setTwoFactorLoginCode,
    submitAuth,
    showProfileModal,
    setShowProfileModal,
    profileName,
    setProfileName,
    profileAvatar,
    setProfileAvatar,
    profileMessage,
    setProfileMessage,
    profileSaving,
    profileImageBusy,
    setProfileImageBusy,
    currentPasswordInput,
    setCurrentPasswordInput,
    newPasswordInput,
    setNewPasswordInput,
    confirmNewPasswordInput,
    setConfirmNewPasswordInput,
    passwordSaving,
    passwordError,
    emailVerifyCode,
    setEmailVerifyCode,
    emailVerifyDevCode,
    emailVerifyBusy,
    twoFactorSetupSecret,
    twoFactorSetupCode,
    setTwoFactorSetupCode,
    twoFactorRecoveryCodes,
    twoFactorBusy,
    twoFactorError,
    notificationPermission,
    setNotificationPermission,
    updateProfile,
    completeOnboarding,
    handleSendEmailVerification,
    handleVerifyEmailCode,
    handleSetupTwoFactor,
    handleEnableTwoFactor,
    handleDisableTwoFactor,
    submitChangePassword,
    logout,
    openProfileModal,
    closeProfileForm,
  };
}
