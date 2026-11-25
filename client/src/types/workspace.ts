import type { I18nKey } from '../i18n'

export type User = {
  id: string
  name: string
  email: string
  emailVerified?: boolean
  twoFactorEnabled?: boolean
  createdAt: string
  profile?: { avatarDataUrl?: string | null; completedAt: string } | null
}

export type Workspace = {
  id: string
  name: string
  slug: string
  role: 'OWNER' | 'MEMBER'
}

export type Room = {
  id: string
  name: string
  description: string | null
  workspaceId: string
  hostId: string | null
  access?: 'OWNER' | 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER' | null
  createdAt: string
  updatedAt: string
  host?: { id: string; name: string; email: string } | null
}

export type PresencePeer = {
  peerId: string
  userId: string
  name: string
  email: string
}

export type DiscardFormKind =
  | 'profile'
  | 'workspace'
  | 'editWorkspace'
  | 'room'
  | 'editRoom'
  | 'invite'
  | null

export type TranslatorFn = (key: I18nKey, params?: Record<string, string | number>) => string
