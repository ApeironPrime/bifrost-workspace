export type Language = 'vi' | 'ja' | 'en'

export const SUPPORTED_LANGUAGES = ['vi', 'en', 'ja'] as const

export const STORAGE_KEY = 'bifrost_locale'

export interface LocaleMeta {
  value: Language
  code: 'VI' | 'EN' | 'JA'
  label: string
  lang: Language
  intl: string
}

export const LOCALE_META: Record<Language, LocaleMeta> = {
  vi: { value: 'vi', code: 'VI', label: 'Tiếng Việt', lang: 'vi', intl: 'vi-VN' },
  en: { value: 'en', code: 'EN', label: 'English', lang: 'en', intl: 'en-US' },
  ja: { value: 'ja', code: 'JA', label: '日本語', lang: 'ja', intl: 'ja-JP' },
}

export function getInitialLanguage(): Language {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'vi' || saved === 'ja' || saved === 'en') {
      return saved
    }
  } catch {
    // Ignore storage access errors in restricted contexts
  }
  return 'vi'
}

export function saveLanguage(lang: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, lang)
  } catch {
    // Ignore storage access errors in restricted contexts
  }
}
