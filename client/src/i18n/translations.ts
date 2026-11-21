import { authDomain } from './domains/auth.ts'
import { controlsDomain } from './domains/controls.ts'
import { errorsDomain } from './domains/errors.ts'
import { landingDomain } from './domains/landing.ts'
import { roomDomain } from './domains/room.ts'
import { workspaceDomain } from './domains/workspace.ts'

export type { Language } from './locale.ts'

export const translations = {
  vi: {
    ...landingDomain.vi,
    ...controlsDomain.vi,
    ...errorsDomain.vi,
    ...authDomain.vi,
    ...workspaceDomain.vi,
    ...roomDomain.vi,
  },
  en: {
    ...landingDomain.en,
    ...controlsDomain.en,
    ...errorsDomain.en,
    ...authDomain.en,
    ...workspaceDomain.en,
    ...roomDomain.en,
  },
  ja: {
    ...landingDomain.ja,
    ...controlsDomain.ja,
    ...errorsDomain.ja,
    ...authDomain.ja,
    ...workspaceDomain.ja,
    ...roomDomain.ja,
  },
} as const

export type TranslationKeys = typeof translations.vi
