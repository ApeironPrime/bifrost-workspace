import { createTranslator, type DotPaths } from './engine.ts'
import { landingDomain } from './domains/landing.ts'

export {
  LOCALE_META,
  STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  getInitialLanguage,
  saveLanguage,
  type Language,
  type LocaleMeta,
} from './locale.ts'

export type LandingKey = DotPaths<typeof landingDomain.vi>

export const { translate: translateLanding, createT: createLandingT } =
  createTranslator<typeof landingDomain.vi, LandingKey>(landingDomain)
