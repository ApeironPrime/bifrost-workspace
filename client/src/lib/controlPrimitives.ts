import {
  LOCALE_META,
  SUPPORTED_LANGUAGES,
  type Language,
} from '../i18n/locale.ts'
import { translateLanding } from '../i18n/landing.ts'
import { resolveMessage, type DotPaths, type TranslationParams } from '../i18n/engine.ts'
import { controlsDomain } from '../i18n/domains/controls.ts'
import type { SelectItem } from './selectOptions.ts'

type ControlsKey = DotPaths<typeof controlsDomain.vi>

function tControls(lang: Language, key: ControlsKey, params?: TranslationParams): string {
  return resolveMessage(controlsDomain, lang, key, params)
}

export type LanguageOption = {
  value: Language
  code: 'VI' | 'EN' | 'JA'
  label: string
  lang: Language
}

export const LANGUAGE_OPTIONS: readonly LanguageOption[] = SUPPORTED_LANGUAGES.map((code) => ({
  value: LOCALE_META[code].value,
  code: LOCALE_META[code].code,
  label: LOCALE_META[code].label,
  lang: LOCALE_META[code].lang,
}))

export function getLanguageLabel(lang: Language): string {
  return translateLanding(lang, 'common.languageLabel')
}

export type LabelColorValue =
  | '#53664b'
  | '#8a684e'
  | '#53617b'
  | '#8b5876'
  | '#477c7a'
  | '#916149'

type LabelColorDef = {
  value: LabelColorValue
  key:
    | 'controls.colors.moss'
    | 'controls.colors.umber'
    | 'controls.colors.indigo'
    | 'controls.colors.plum'
    | 'controls.colors.jade'
    | 'controls.colors.terracotta'
}

export const LABEL_COLOR_PALETTE: readonly LabelColorDef[] = [
  { value: '#53664b', key: 'controls.colors.moss' },
  { value: '#8a684e', key: 'controls.colors.umber' },
  { value: '#53617b', key: 'controls.colors.indigo' },
  { value: '#8b5876', key: 'controls.colors.plum' },
  { value: '#477c7a', key: 'controls.colors.jade' },
  { value: '#916149', key: 'controls.colors.terracotta' },
] as const

export function getLabelColorName(color: string, lang: Language): string {
  const normalized = color.trim().toLowerCase()
  const found = LABEL_COLOR_PALETTE.find((item) => item.value === normalized)
  return tControls(lang, found ? found.key : 'controls.colors.custom')
}

type PriorityPreset = {
  value: number
  labelKey:
    | 'controls.priorities.high.label'
    | 'controls.priorities.aboveNormal.label'
    | 'controls.priorities.standard.label'
    | 'controls.priorities.secondary.label'
  descKey:
    | 'controls.priorities.high.description'
    | 'controls.priorities.aboveNormal.description'
    | 'controls.priorities.standard.description'
    | 'controls.priorities.secondary.description'
}

export const LABEL_PRIORITY_PRESETS: readonly PriorityPreset[] = [
  { value: 10, labelKey: 'controls.priorities.high.label', descKey: 'controls.priorities.high.description' },
  { value: 50, labelKey: 'controls.priorities.aboveNormal.label', descKey: 'controls.priorities.aboveNormal.description' },
  { value: 100, labelKey: 'controls.priorities.standard.label', descKey: 'controls.priorities.standard.description' },
  { value: 200, labelKey: 'controls.priorities.secondary.label', descKey: 'controls.priorities.secondary.description' },
] as const

export function getPriorityTierLabel(priority: number, lang: Language): string {
  const exact = LABEL_PRIORITY_PRESETS.find((item) => item.value === priority)
  if (exact) return tControls(lang, exact.labelKey)
  if (priority < 30) return tControls(lang, 'controls.priorities.high.label')
  if (priority < 80) return tControls(lang, 'controls.priorities.aboveNormal.label')
  if (priority <= 140) return tControls(lang, 'controls.priorities.standard.label')
  return tControls(lang, 'controls.priorities.secondary.label')
}

export function getLabelPriorityItems(currentPriority: number, lang: Language): SelectItem[] {
  const items: SelectItem[] = LABEL_PRIORITY_PRESETS.map((preset) => ({
    value: String(preset.value),
    label: tControls(lang, preset.labelKey),
    description: tControls(lang, preset.descKey),
  }))

  if (!LABEL_PRIORITY_PRESETS.some((preset) => preset.value === currentPriority)) {
    const tier = getPriorityTierLabel(currentPriority, lang)
    items.unshift({
      value: String(currentPriority),
      label: tControls(lang, 'controls.priorities.savedLabel', { tier }),
      description: tControls(lang, 'controls.priorities.savedDescription'),
    })
  }

  return items
}

export type RoomRoleOptionValue = 'HOST' | 'MODERATOR' | 'MEMBER' | 'VIEWER' | 'REMOVE'

const ROLE_LABEL_KEYS: Record<RoomRoleOptionValue, ControlsKey> = {
  HOST: 'controls.roomRoles.HOST.label',
  MODERATOR: 'controls.roomRoles.MODERATOR.label',
  MEMBER: 'controls.roomRoles.MEMBER.label',
  VIEWER: 'controls.roomRoles.VIEWER.label',
  REMOVE: 'controls.roomRoles.REMOVE.label',
}

export function getRoomRoleLabel(role: RoomRoleOptionValue, lang: Language): string {
  return tControls(lang, ROLE_LABEL_KEYS[role])
}

export function getRoomRoleItems({
  lang,
  canSetManagers,
  isAssigned,
}: {
  lang: Language
  canSetManagers: boolean
  isAssigned: boolean
}): SelectItem[] {
  const managerLockedReason = tControls(lang, 'controls.roomRoles.managerLockedReason')

  const items: SelectItem[] = [
    {
      value: 'HOST',
      label: getRoomRoleLabel('HOST', lang),
      disabled: !canSetManagers,
      description: canSetManagers
        ? tControls(lang, 'controls.roomRoles.HOST.description')
        : managerLockedReason,
    },
    {
      value: 'MODERATOR',
      label: getRoomRoleLabel('MODERATOR', lang),
      disabled: !canSetManagers,
      description: canSetManagers
        ? tControls(lang, 'controls.roomRoles.MODERATOR.description')
        : managerLockedReason,
    },
    {
      value: 'MEMBER',
      label: getRoomRoleLabel('MEMBER', lang),
      description: tControls(lang, 'controls.roomRoles.MEMBER.description'),
    },
    {
      value: 'VIEWER',
      label: getRoomRoleLabel('VIEWER', lang),
      description: tControls(lang, 'controls.roomRoles.VIEWER.description'),
    },
  ]

  if (isAssigned) {
    items.push({
      value: 'REMOVE',
      label: getRoomRoleLabel('REMOVE', lang),
      tone: 'danger',
      description: tControls(lang, 'controls.roomRoles.REMOVE.description'),
    })
  }

  return items
}

const AVATAR_TONES = [
  '#3f5a47',
  '#435870',
  '#7a5c43',
  '#664c6d',
  '#3c6664',
  '#7c5240',
] as const

export function getAvatarTone(seed: string): string {
  const clean = seed.trim() || 'bifrost'
  let hash = 0
  for (let index = 0; index < clean.length; index++) {
    hash = (hash << 5) - hash + clean.charCodeAt(index)
    hash |= 0
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length]
}

export type PresenceDisplay = {
  tone: 'room' | 'online' | 'offline' | 'unknown'
  scope: 'room' | 'workspace' | 'unverified'
  label: string
  detail?: string
}

export function getPresenceDisplay({
  mock,
  inCurrentRoom,
  activeRoomName,
  status,
  currentRoomName,
  lang,
}: {
  mock: boolean
  inCurrentRoom?: boolean
  activeRoomName?: string | null
  status?: 'online' | 'offline'
  currentRoomName?: string | null
  lang: Language
}): PresenceDisplay {
  if (inCurrentRoom) {
    return {
      tone: 'room',
      scope: 'room',
      label: tControls(lang, 'controls.presence.inRoomLabel'),
      detail: activeRoomName
        ? tControls(lang, 'controls.presence.inRoomDetail', { roomName: activeRoomName })
        : undefined,
    }
  }
  if (!mock) {
    return {
      tone: 'unknown',
      scope: 'unverified',
      label: tControls(lang, 'controls.presence.unverifiedLabel'),
      detail: activeRoomName
        ? tControls(lang, 'controls.presence.unverifiedInRoomDetail')
        : tControls(lang, 'controls.presence.unverifiedWorkspaceDetail'),
    }
  }
  if (status === 'online') {
    return {
      tone: 'online',
      scope: 'workspace',
      label: tControls(lang, 'controls.presence.onlineLabel'),
      detail: currentRoomName
        ? tControls(lang, 'controls.presence.onlineInRoomDetail', { roomName: currentRoomName })
        : tControls(lang, 'controls.presence.notInRoomDetail'),
    }
  }
  return {
    tone: 'offline',
    scope: 'workspace',
    label: tControls(lang, 'controls.presence.offlineLabel'),
  }
}
