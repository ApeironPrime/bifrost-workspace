import type { Language } from './locale.ts'

export interface TranslationTree {
  readonly [key: string]: string | TranslationTree
}

export type TranslationShape<T extends TranslationTree> = {
  readonly [K in keyof T]: T[K] extends string
    ? string
    : T[K] extends TranslationTree
      ? TranslationShape<T[K]>
      : never
}

type PrevDepth = [never, 0, 1, 2, 3, 4]

/** Recursively derives dot-separated leaf key paths up to 4 levels deep. */
export type DotPaths<T, D extends number = 4> = [D] extends [never]
  ? never
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : T[K] extends TranslationTree
          ? `${K}.${DotPaths<T[K], PrevDepth[D]>}`
          : never
    }[keyof T & string]

export type TranslationParams = Record<string, string | number>

export function formatMessage(template: string, params?: TranslationParams): string {
  if (!params) return template
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (token, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : token,
  )
}

function readNestedKey(tree: TranslationTree, key: string): string | undefined {
  let current: string | TranslationTree | undefined = tree
  for (const segment of key.split('.')) {
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, segment)) {
      return undefined
    }
    current = (current as Record<string, string | TranslationTree>)[segment]
  }
  return typeof current === 'string' ? current : undefined
}

export function resolveMessage(
  locales: Record<Language, TranslationTree>,
  lang: Language,
  key: string,
  params?: TranslationParams,
): string {
  // Explicit locale lookup with deterministic en -> vi fallback if a runtime dynamic key were ever missing.
  const template =
    readNestedKey(locales[lang], key) ??
    readNestedKey(locales.en, key) ??
    readNestedKey(locales.vi, key) ??
    `[missing:${key}]`
  return formatMessage(template, params)
}

export function createTranslator<TTree extends TranslationTree, TKey extends string = DotPaths<TTree>>(
  locales: Record<Language, TTree>,
): {
  translate: (lang: Language, key: TKey, params?: TranslationParams) => string
  createT: (lang: Language) => (key: TKey, params?: TranslationParams) => string
} {
  const translate = (lang: Language, key: TKey, params?: TranslationParams): string =>
    resolveMessage(locales, lang, key, params)
  const createT = (lang: Language) => (key: TKey, params?: TranslationParams): string =>
    translate(lang, key, params)
  return { translate, createT }
}
