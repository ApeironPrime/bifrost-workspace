import { useEffect } from 'react'
import type { ToastType } from '../../../shared/components/Toast'
import { apiUrl, fetchAppApi, isDevMockSession } from '../../../lib/appApi'
import type { TranslatorFn, User, Workspace } from '../../../types/workspace'

export type PendingInviteInfo = {
  token: string
  workspaceName: string
  inviterName: string
}

export function useBootDeepLinks(params: {
  userId: string | undefined
  token: string
  addToast: (message: string, type?: ToastType) => void
  refreshAccessToken: () => Promise<string | null>
  setPendingInvite: (invite: PendingInviteInfo | null) => void
  setUser: (user: User) => void
  setWorkspaceRetry: (updater: (value: number) => number) => void
  setSelectedWorkspaceId: (id: string) => void
  t: TranslatorFn
}) {
  const {
    userId,
    token,
    addToast,
    refreshAccessToken,
    setPendingInvite,
    setUser,
    setWorkspaceRetry,
    setSelectedWorkspaceId,
    t,
  } = params

  useEffect(() => {
    const rawHash = window.location.hash.replace(/^#/, '')
    const rawSearch = window.location.search.replace(/^\?/, '')
    const searchParams = new URLSearchParams(rawHash.includes('=') ? rawHash : rawSearch)

    const inviteToken = searchParams.get('invite')?.trim()
    const verifyEmailToken = searchParams.get('verify_email')?.trim()
    const oauthSuccess = searchParams.get('oauth_success')
    const oauthError = searchParams.get('oauth_error')

    if (inviteToken) {
      sessionStorage.setItem('bifrost_pending_invite', inviteToken)
      void fetchAppApi(apiUrl(`/invites/${encodeURIComponent(inviteToken)}`))
        .then(async (res) => {
          if (!res.ok) return
          const body = (await res.json()) as {
            invite?: { workspaceName: string; inviterName: string }
          }
          if (body.invite) {
            setPendingInvite({
              token: inviteToken,
              workspaceName: body.invite.workspaceName,
              inviterName: body.invite.inviterName,
            })
          }
        })
        .catch(() => {})
    }

    if (verifyEmailToken) {
      void fetchAppApi(apiUrl('/auth/verify-email'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyEmailToken }),
      })
        .then(async (res) => {
          if (!res.ok) return
          const body = (await res.json()) as { user?: User }
          if (body.user) setUser(body.user)
          addToast(t('profile.emailVerifiedToast'), 'success')
        })
        .catch(() => {})
    }

    if (oauthSuccess === '1') {
      localStorage.setItem('bifrost_has_session', '1')
      void refreshAccessToken()
    } else if (oauthError) {
      queueMicrotask(() => addToast(t('auth.authFailed'), 'error'))
    }

    if (inviteToken || verifyEmailToken || oauthSuccess || oauthError) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#workspace`)
    }
  }, [addToast, refreshAccessToken, setPendingInvite, setUser, t])

  useEffect(() => {
    if (!userId || !token || isDevMockSession(token)) return
    const inviteToken = sessionStorage.getItem('bifrost_pending_invite')
    if (!inviteToken) return
    let cancelled = false
    void fetchAppApi(apiUrl(`/invites/${encodeURIComponent(inviteToken)}/accept`), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    })
      .then(async (res) => {
        sessionStorage.removeItem('bifrost_pending_invite')
        if (cancelled) return
        setPendingInvite(null)
        const body = (await res.json().catch(() => ({}))) as {
          workspace?: Workspace
          message?: string
        }
        if (!res.ok || !body.workspace) {
          addToast(body.message || t('workspace.inviteAcceptFailed'), 'error')
          return
        }
        setWorkspaceRetry((v) => v + 1)
        setSelectedWorkspaceId(body.workspace.id)
        addToast(t('workspace.inviteAcceptedToast', { name: body.workspace.name }), 'success')
      })
      .catch(() => {
        sessionStorage.removeItem('bifrost_pending_invite')
      })
    return () => {
      cancelled = true
    }
  }, [userId, token, addToast, setPendingInvite, setWorkspaceRetry, setSelectedWorkspaceId, t])
}
