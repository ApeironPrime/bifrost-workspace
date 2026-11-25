import { useEffect, useRef, type RefObject } from 'react'
import { io, type Socket } from 'socket.io-client'
import type { ToastType } from '../../../shared/components/Toast'
import { isDevMockSession, SIGNALING_URL } from '../../../lib/appApi'
import { playIncomingCallChime, showBrowserCallNotification } from '../../../lib/callNotification'
import type { Room, TranslatorFn } from '../../../types/workspace'

export function useCallNotifications(params: {
  token: string
  userId: string | undefined
  activeRoomRef: RefObject<Room | null>
  setSelectedWorkspaceId: (id: string) => void
  addToast: (message: string, type?: ToastType) => void
  t: TranslatorFn
}) {
  const { token, userId, activeRoomRef, setSelectedWorkspaceId, addToast, t } = params
  const notifySocketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!token || !userId || isDevMockSession(token)) return
    const notifySocket = io(SIGNALING_URL || undefined, {
      auth: { token },
      withCredentials: true,
      transports: ['websocket', 'polling'],
    })
    notifySocketRef.current = notifySocket

    notifySocket.on(
      'workspace:room-active',
      (payload: {
        workspaceId: string
        workspaceName: string
        roomId: string
        roomName: string
        caller: { id: string; name: string }
      }) => {
        if (payload.caller.id === userId) return
        if (activeRoomRef.current?.id === payload.roomId) return
        const message = t('toasts.incomingRoomCall', {
          caller: payload.caller.name,
          room: payload.roomName,
          space: payload.workspaceName,
        })
        playIncomingCallChime()
        addToast(message, 'info')
        showBrowserCallNotification({
          title: payload.roomName,
          body: message,
          onClick: () => {
            setSelectedWorkspaceId(payload.workspaceId)
          },
        })
      },
    )

    return () => {
      if (notifySocketRef.current === notifySocket) {
        notifySocketRef.current = null
      }
      notifySocket.disconnect()
    }
  }, [token, userId, activeRoomRef, setSelectedWorkspaceId, addToast, t])
}
