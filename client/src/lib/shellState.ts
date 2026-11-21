import { resolveMessage } from '../i18n/engine.ts'
import { controlsDomain } from '../i18n/domains/controls.ts'
import type { Language } from '../i18n/locale.ts'

export type SessionStatus =
  | { kind: 'idle' }
  | { kind: 'localPreview' }
  | { kind: 'connectingSignaling' }
  | { kind: 'joiningRoom' }
  | { kind: 'joinedRoom'; roomName: string }
  | { kind: 'waitingPeer' }
  | { kind: 'connectedP2P' }
  | { kind: 'reconnected' }
  | { kind: 'error'; message?: string }

export type SessionStatusTone = 'neutral' | 'pending' | 'connected' | 'error'

export function getSessionStatusDisplay(
  status: SessionStatus,
  lang: Language,
): { label: string; tone: SessionStatusTone } {
  const tr = (key: string, vars?: Record<string, string | number>) =>
    resolveMessage(controlsDomain, lang, key, vars)

  switch (status.kind) {
    case 'idle':
      return { label: tr('controls.sessionStatus.idle'), tone: 'neutral' }
    case 'localPreview':
      return { label: tr('controls.sessionStatus.localPreview'), tone: 'neutral' }
    case 'connectingSignaling':
      return { label: tr('controls.sessionStatus.connectingSignaling'), tone: 'pending' }
    case 'joiningRoom':
      return { label: tr('controls.sessionStatus.joiningRoom'), tone: 'pending' }
    case 'joinedRoom':
      return {
        label: tr('controls.sessionStatus.joinedRoom', { name: status.roomName }),
        tone: 'pending',
      }
    case 'waitingPeer':
      return { label: tr('controls.sessionStatus.waitingPeer'), tone: 'pending' }
    case 'reconnected':
      return { label: tr('controls.sessionStatus.reconnected'), tone: 'pending' }
    case 'connectedP2P':
      return { label: tr('controls.sessionStatus.connectedP2P'), tone: 'connected' }
    case 'error':
      return {
        label: status.message?.trim() || tr('controls.sessionStatus.connectError'),
        tone: 'error',
      }
  }
}

function cleanTokens(raw: string): string[] {
  return raw
    .trim()
    .split(/\s+/)
    .map((part) => part.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, ''))
    .filter(Boolean)
}

function firstChars(word: string, count: number): string {
  return Array.from(word).slice(0, count).join('').toLocaleUpperCase()
}

function numericBadge(token: string): string | null {
  if (!/^\d{1,3}$/.test(token)) return null
  const normalized = String(Number(token))
  return normalized.slice(-2)
}

/** Unicode-safe 2-character monogram for workspaces (first two significant words, or 2 chars for CJK/single word). */
export function workspaceInitials(name: string, fallback = 'BF'): string {
  const tokens = cleanTokens(name)
  if (tokens.length === 0) return fallback
  if (tokens.length === 1) return firstChars(tokens[0], 2)
  const tailNum = numericBadge(tokens[tokens.length - 1])
  if (tailNum && tailNum.length === 1) return `${firstChars(tokens[0], 1)}${tailNum}`
  return `${firstChars(tokens[0], 1)}${firstChars(tokens[1], 1)}`
}

/** Unicode-safe monogram for rooms in compact rail; preserves room numbers (e.g. Phòng họp 01 -> P1, 02 -> P2). */
export function roomInitials(name: string, fallback = 'RM'): string {
  const tokens = cleanTokens(name)
  if (tokens.length === 0) return fallback
  if (tokens.length === 1) return firstChars(tokens[0], 2)
  const last = tokens[tokens.length - 1]
  const tailNum = numericBadge(last)
  if (tailNum) {
    return tailNum.length === 1 ? `${firstChars(tokens[0], 1)}${tailNum}` : tailNum
  }
  if (/^\d{4,}$/.test(last)) {
    return `${firstChars(tokens[0], 1)}${firstChars(tokens[1], 1)}`
  }
  return `${firstChars(tokens[0], 1)}${firstChars(last, 1)}`
}

/** Unicode-safe monogram for user avatars (uses given-name tail for multi-word Vietnamese names, 2 chars for CJK/single word). */
export function personInitials(name: string, fallback = 'U'): string {
  const tokens = cleanTokens(name)
  if (tokens.length === 0) return fallback
  if (tokens.length === 1) return firstChars(tokens[0], 2)
  const tail = tokens.slice(-2)
  return `${firstChars(tail[0], 1)}${firstChars(tail[1], 1)}`
}
