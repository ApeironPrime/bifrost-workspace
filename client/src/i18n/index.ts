import {
  createTranslator,
  type DotPaths,
  type TranslationParams,
} from './engine.ts'
import { translations, type TranslationKeys } from './translations.ts'

export {
  LOCALE_META,
  STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  getInitialLanguage,
  saveLanguage,
  type Language,
  type LocaleMeta,
} from './locale.ts'

export {
  formatInviteError,
  formatRoomError,
  formatWorkspaceError,
} from './errors.ts'

export { translations, type TranslationKeys }
export type { TranslationParams }

export type I18nKey = DotPaths<TranslationKeys>
export type TranslateFn = (key: I18nKey, params?: TranslationParams) => string

export const { translate, createT } = createTranslator<TranslationKeys, I18nKey>(translations)
