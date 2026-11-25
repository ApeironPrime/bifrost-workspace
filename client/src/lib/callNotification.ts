export function getNotificationPermissionState(): NotificationPermission | 'unsupported' {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }
  return Notification.permission
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }
  try {
    return await Notification.requestPermission()
  } catch {
    return Notification.permission
  }
}

export function playIncomingCallChime(): void {
  if (typeof window === 'undefined') return
  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return

  try {
    const ctx = new AudioCtx()
    const now = ctx.currentTime
    const notes = [659.25, 987.77] // E5 -> B5 warm two-note chime

    notes.forEach((freq, idx) => {
      const start = now + idx * 0.16
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'triangle'
      osc.frequency.setValueAtTime(freq, start)

      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(0.09, start + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.38)

      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(start)
      osc.stop(start + 0.4)
    })

    window.setTimeout(() => {
      void ctx.close().catch(() => {})
    }, 900)
  } catch {
    // Autoplay policy or audio device unavailable; ignore silently.
  }
}

export function showBrowserCallNotification(params: {
  title: string
  body: string
  onClick?: () => void
}): void {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return
  if (Notification.permission !== 'granted') return
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return

  try {
    const notification = new Notification(params.title, {
      body: params.body,
      tag: 'bifrost-incoming-room',
    })
    notification.onclick = () => {
      window.focus()
      params.onClick?.()
      notification.close()
    }
  } catch {
    // Notification blocked by browser sandbox.
  }
}
