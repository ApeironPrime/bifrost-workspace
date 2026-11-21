import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import {
  LOCALE_META,
  getInitialLanguage,
  saveLanguage,
  translate,
  translations,
} from '../src/i18n/index.ts'
import { createLandingT, translateLanding } from '../src/i18n/landing.ts'
import { formatMessage, resolveMessage } from '../src/i18n/engine.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const CLIENT_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(CLIENT_ROOT, 'src')
const I18N_ROOT = path.join(SRC_ROOT, 'i18n')

const LANGUAGES = ['vi', 'en', 'ja']

const UI_ATTR_NAMES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
  'label',
  'emptyText',
  'triggerTitle',
  'cancelLabel',
  'confirmLabel',
  'heading',
  'description',
  'noResultsText',
  'searchPlaceholder',
  'clearLabel',
  'ariaLabel',
  'closeLabel',
  'completeLabel',
  'incompleteLabel',
  'composerHint',
  'deleteCardLabel',
  'dragDropHint',
  'editCardLabel',
  'emptyPrompt',
  'emptyReady',
  'inputPlaceholder',
  'messagesHeading',
  'noRecipientsLabel',
  'noSharedNotesLabel',
  'noteEmptyLabel',
  'sendButtonLabel',
  'sendToLabel',
  'sharedTitle',
  'titleLabel',
])

const BANNED_LEGACY_IDENTIFIERS = new Set([
  'uiText',
  'copyText',
  'roomCopy',
  'englishUi',
  'vietnameseUi',
  'vietnameseUiCopy',
  'fallbackCopy',
])

const USER_FACING_LETTER_RE = /[a-zA-ZÀ-ỹ\u3040-\u30ff\u4e00-\u9faf]/

/**
 * Documented technical, brand, and editorial art fixture literals intentionally
 * preserved outside UI translation keys.
 */
const ALLOWED_JSX_LITERALS = new Map([
  ['Bifrost', 'Product brand mark label'],
  ['WebRTC · P2P', 'Transport protocol badge'],
  ['MA', 'Showcase avatar monogram (Landing atelier/hero art)'],
  ['KH', 'Showcase avatar monogram (Landing atelier/hero art)'],
  ['Minh Anh', 'Showcase persona proper name (Landing atelier/outcome)'],
  ['Khoa', 'Showcase persona proper name (Landing atelier/outcome)'],
  ['×', 'Editorial collaborator separator glyph'],
  ['room-layout.pdf', 'Showcase sample filename (Landing artwork)'],
  ['design-feedback.png', 'Showcase sample filename (Landing artwork)'],
  ['PDF', 'File format badge'],
  ['PNG', 'File format badge'],
  ['B / 001', 'Editorial coordinate stamp (Landing atelier)'],
])

/**
 * Exact developer-only toolbar literals intentionally left in English strictly inside
 * `dev/roomReview.tsx` (never allowlisted anywhere under `src/`).
 */
const ALLOWED_DEV_FIXTURE_LITERALS = new Map([
  ['Isolated QA fixture — synthetic transport, not a real P2P test', 'Dev QA banner header'],
  ['Switch component', 'Dev QA component toggle button'],
  ['Restore transport', 'Dev QA synthetic failure toggle (active state)'],
  ['Fail transport', 'Dev QA synthetic failure toggle (idle state)'],
  ['Allow editing', 'Dev QA synthetic read-only toggle (active state)'],
  ['View only', 'Dev QA synthetic read-only toggle (idle state)'],
  ['Begin inbound file', 'Dev QA inbound transfer start button'],
  ['Complete inbound file', 'Dev QA inbound transfer finish button'],
])

const INTENTIONAL_IDENTICAL_KEYS = new Map([
  ['common.languageEntryTemplate', { locales: ['vi', 'en', 'ja'], reason: 'Placeholder format template with localized {label} and {current}' }],
  ['auth.emailLabel', { locales: ['vi', 'en'], reason: 'Standard "Email" label shared in Vietnamese and English (localized as "メール" in Japanese)' }],
  ['auth.emailPlaceholder', { locales: ['vi', 'en', 'ja'], reason: 'RFC-style example email placeholder' }],
  ['auth.capsLockBadge', { locales: ['vi', 'en', 'ja'], reason: 'Hardware keyboard Caps Lock indicator badge' }],
  ['avatar.fileRequirements', { locales: ['vi', 'en', 'ja'], reason: 'MIME formats and size limit badge ("JPG, PNG, WebP · 5 MB")' }],
])

/** Extract static user-facing string or template segments from a JSX expression without flagging variables or calls. */
function extractUserFacingExprStrings(expr) {
  const results = []

  function inspect(node) {
    if (!node) return
    if (ts.isParenthesizedExpression(node)) {
      inspect(node.expression)
      return
    }
    if (ts.isStringLiteralLike(node)) {
      results.push({ text: node.text, node })
      return
    }
    if (ts.isTemplateExpression(node)) {
      if (node.head.text) {
        results.push({ text: node.head.text, node: node.head })
      }
      for (const span of node.templateSpans) {
        inspect(span.expression)
        if (span.literal.text) {
          results.push({ text: span.literal.text, node: span.literal })
        }
      }
      return
    }
    if (ts.isConditionalExpression(node)) {
      inspect(node.whenTrue)
      inspect(node.whenFalse)
      return
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind
      if (op === ts.SyntaxKind.AmpersandAmpersandToken) {
        inspect(node.right)
        return
      }
      if (
        op === ts.SyntaxKind.PlusToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
      ) {
        inspect(node.left)
        inspect(node.right)
      }
      return
    }
    if (ts.isCallExpression(node)) {
      const calleeName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : ts.isPropertyAccessExpression(node.expression)
          ? node.expression.name.text
          : ''
      if (TRANSLATOR_CALLEES.has(calleeName)) {
        return
      }
    }
  }

  inspect(expr)
  return results
}

function isAllowedUiLiteral(cleaned, rel) {
  if (ALLOWED_JSX_LITERALS.has(cleaned)) return true
  if (rel === 'dev/roomReview.tsx' && ALLOWED_DEV_FIXTURE_LITERALS.has(cleaned)) return true
  return false
}

function isLangRef(expr) {
  return (
    (ts.isIdentifier(expr) && expr.text === 'lang') ||
    (ts.isPropertyAccessExpression(expr) && expr.name.text === 'lang')
  )
}

/**
 * Intentional bilingual motifs wrapped in an element with an explicit `lang="..."`
 * attribute (artistic sub-headings, not unlocalized UI controls).
 */
function hasExplicitLangAttr(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxElement(current)) {
      const attrs = current.openingElement.attributes.properties
      for (const attr of attrs) {
        if (ts.isJsxAttribute(attr) && attr.name.text === 'lang') {
          return true
        }
      }
    }
    current = current.parent
  }
  return false
}

const TRANSLATOR_CALLEES = new Map([
  ['t', 0],
  ['tControls', 1],
  ['tErr', 1],
  ['tr', 0],
  ['translate', 1],
  ['translateLanding', 1],
])

function flattenTranslations(tree, prefix = '') {
  const out = {}
  for (const [k, v] of Object.entries(tree)) {
    const full = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flattenTranslations(v, full))
    } else {
      out[full] = v
    }
  }
  return out
}

function extractPlaceholders(template) {
  return [...String(template).matchAll(/\{([a-zA-Z0-9_]+)\}/g)]
    .map((m) => m[1])
    .sort()
}

export function discoverSourceFiles(dir, { excludeDirs = ['node_modules', 'dist'] } = {}) {
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (excludeDirs.includes(entry.name)) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...discoverSourceFiles(fullPath, { excludeDirs }))
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      results.push(fullPath)
    }
  }
  return results.sort()
}

function lineNumberOf(sf, node) {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1
}

function readParamKeysFromArg(arg) {
  if (!arg) return { keys: new Set(), dynamic: false }
  if (ts.isObjectLiteralExpression(arg)) {
    const keys = new Set()
    for (const prop of arg.properties) {
      if (ts.isPropertyAssignment(prop) && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name))) {
        keys.add(prop.name.text)
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        keys.add(prop.name.text)
      } else {
        return { keys, dynamic: true }
      }
    }
    return { keys, dynamic: false }
  }
  return { keys: new Set(), dynamic: true }
}

function collectKeyCandidates(node) {
  const found = []
  let unresolved = false

  function inspectExpr(expr) {
    if (ts.isStringLiteralLike(expr)) {
      found.push(expr.text)
      return
    }
    if (ts.isConditionalExpression(expr)) {
      inspectExpr(expr.whenTrue)
      inspectExpr(expr.whenFalse)
      return
    }
    if (ts.isParenthesizedExpression(expr)) {
      inspectExpr(expr.expression)
      return
    }
    unresolved = true
  }

  inspectExpr(node)

  // Recognize typed key lookups where concrete string literal keys are statically verified
  // inside local config tables (e.g. COLUMNS, LABEL_COLOR_PALETTE, LABEL_PRIORITY_PRESETS, ROLE_LABEL_KEYS).
  if (unresolved) {
    const txt = node.getText()
    if (
      /^(col|column)\.(titleKey|descKey)$/.test(txt) ||
      txt === "found ? found.key : 'controls.colors.custom'" ||
      /^(?:exact|preset)\.(labelKey|descKey)$/.test(txt) ||
      /^ROLE_LABEL_KEYS\[/.test(txt)
    ) {
      unresolved = false
    } else if (txt === 'key') {
      // Thin translator wrapper declaration: `(key, params) => translate(lang, key, params)`
      unresolved = false
    }
  }

  return { keys: found, unresolved }
}

/**
 * Recursively analyzes TypeScript / JSX AST across source files for:
 * 1) banned legacy i18n APIs & unpermitted inline `lang ===` branching
 * 2) hardcoded JSX text outside documented technical/editorial allowlists
 * 3) hardcoded user-facing attribute string literals
 * 4) unknown translation keys & missing placeholder arguments
 */
export function auditSourceFiles(filePaths, flatTranslationsByLang, rootForRel = CLIENT_ROOT) {
  const flatVi = flatTranslationsByLang.vi
  const validKeys = new Set(Object.keys(flatVi))

  const usedKeys = new Set()
  const unknownKeyErrors = []
  const placeholderErrors = []
  const dynamicKeyErrors = []
  const hardcodedJsxErrors = []
  const hardcodedAttrErrors = []
  const legacyApiErrors = []
  const inlineLocaleBranchErrors = []
  const duplicateObjKeyErrors = []

  const knownKeyLiterals = new Set()

  for (const filePath of filePaths) {
    const rel = path.relative(rootForRel, filePath).replace(/\\/g, '/')
    const code = fs.readFileSync(filePath, 'utf8')
    const kind = filePath.endsWith('.tsx') || filePath.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, kind)

    const inI18nDir = filePath.startsWith(I18N_ROOT) || rel.startsWith('src/i18n/')
    const inLocaleConfigOnly =
      rel === 'src/i18n/locale.ts' ||
      rel === 'src/i18n/errors.ts' ||
      rel === 'src/i18n/domains/landing.ts' ||
      rel === 'src/i18n/domains/controls.ts'

    function visit(node) {
      // 1) Duplicate object property keys inside i18n domains
      if (inI18nDir && ts.isObjectLiteralExpression(node)) {
        const seenProps = new Set()
        for (const prop of node.properties) {
          if (ts.isPropertyAssignment(prop) || ts.isShorthandPropertyAssignment(prop)) {
            const propName =
              ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)
                ? prop.name.text
                : null
            if (propName) {
              if (seenProps.has(propName)) {
                duplicateObjKeyErrors.push(`${rel}:${lineNumberOf(sf, prop)} duplicate key "${propName}"`)
              }
              seenProps.add(propName)
            }
          }
        }
      }

      // Track known key literals declared inside config tables (e.g., MeetingBoard COLUMNS, controlPrimitives tables)
      if (!inI18nDir && ts.isStringLiteralLike(node) && validKeys.has(node.text)) {
        knownKeyLiterals.add(node.text)
      }

      // 2) Ban deprecated legacy identifiers / imports
      if (ts.isIdentifier(node) && BANNED_LEGACY_IDENTIFIERS.has(node.text)) {
        // Ignore non-call local identifiers unrelated to legacy functions (none exist under banned names)
        legacyApiErrors.push(`${rel}:${lineNumberOf(sf, node)} references deprecated i18n API "${node.text}"`)
      }

      // 3) Flag inline `lang === '...'` or `switch (lang)` outside locale/error normalization utilities
      if (!inLocaleConfigOnly && !inI18nDir && ts.isBinaryExpression(node)) {
        const isEq =
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
          node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken
        if (
          isEq &&
          ((isLangRef(node.left) && ts.isStringLiteralLike(node.right) && LANGUAGES.includes(node.right.text)) ||
            (isLangRef(node.right) && ts.isStringLiteralLike(node.left) && LANGUAGES.includes(node.left.text)))
        ) {
          inlineLocaleBranchErrors.push(`${rel}:${lineNumberOf(sf, node)} inline locale branch: ${node.getText(sf)}`)
        }
      }
      if (!inLocaleConfigOnly && !inI18nDir && ts.isSwitchStatement(node) && isLangRef(node.expression)) {
        inlineLocaleBranchErrors.push(`${rel}:${lineNumberOf(sf, node)} inline locale switch: ${node.expression.getText(sf)}`)
      }

      // 4) Hardcoded JSX text & JSX expression children audit (all files outside src/i18n)
      if (!inI18nDir && ts.isJsxText(node)) {
        const cleaned = node.text.replace(/\s+/g, ' ').trim()
        if (cleaned && USER_FACING_LETTER_RE.test(cleaned)) {
          if (!hasExplicitLangAttr(node) && !isAllowedUiLiteral(cleaned, rel)) {
            hardcodedJsxErrors.push(`${rel}:${lineNumberOf(sf, node)} unlocalized JSX text "${cleaned}"`)
          }
        }
      }
      if (
        !inI18nDir &&
        ts.isJsxExpression(node) &&
        node.expression &&
        (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))
      ) {
        if (!hasExplicitLangAttr(node)) {
          for (const item of extractUserFacingExprStrings(node.expression)) {
            const cleaned = item.text.replace(/\s+/g, ' ').trim()
            if (cleaned && USER_FACING_LETTER_RE.test(cleaned) && !isAllowedUiLiteral(cleaned, rel)) {
              hardcodedJsxErrors.push(
                `${rel}:${lineNumberOf(sf, item.node)} unlocalized JSX expression "${cleaned}"`,
              )
            }
          }
        }
      }

      // 5) Hardcoded UI / ARIA / component prop literals (both static string & JSX expression attributes)
      if (!inI18nDir && ts.isJsxAttribute(node) && UI_ATTR_NAMES.has(node.name.text)) {
        if (node.initializer && ts.isStringLiteral(node.initializer)) {
          const val = node.initializer.text.replace(/\s+/g, ' ').trim()
          if (val && USER_FACING_LETTER_RE.test(val) && !isAllowedUiLiteral(val, rel)) {
            hardcodedAttrErrors.push(
              `${rel}:${lineNumberOf(sf, node)} unlocalized ${node.name.text}="${val}"`,
            )
          }
        } else if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          for (const item of extractUserFacingExprStrings(node.initializer.expression)) {
            const val = item.text.replace(/\s+/g, ' ').trim()
            if (val && USER_FACING_LETTER_RE.test(val) && !isAllowedUiLiteral(val, rel)) {
              hardcodedAttrErrors.push(
                `${rel}:${lineNumberOf(sf, item.node)} unlocalized ${node.name.text} expression "${val}"`,
              )
            }
          }
        }
      }

      // 6) Translation call validation (t, translate, translateLanding, tControls, tErr)
      if (ts.isCallExpression(node)) {
        const calleeName = ts.isIdentifier(node.expression)
          ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression)
            ? node.expression.name.text
            : ''
        if (calleeName && TRANSLATOR_CALLEES.has(calleeName)) {
          // Ignore test helper definitions/declarations or `createTranslator` implementation in engine.ts
          const isInternalDef =
            rel === 'src/i18n/engine.ts' ||
            rel === 'src/i18n/landing.ts' ||
            rel === 'src/i18n/index.ts'
          const keyArgIndex = TRANSLATOR_CALLEES.get(calleeName)
          const keyArg = node.arguments[keyArgIndex]
          if (!isInternalDef && keyArg) {
            const { keys, unresolved } = collectKeyCandidates(keyArg)
            if (unresolved) {
              dynamicKeyErrors.push(
                `${rel}:${lineNumberOf(sf, keyArg)} unresolved dynamic key expression: ${keyArg.getText(sf)}`,
              )
            }
            const paramsArg = node.arguments[keyArgIndex + 1]
            const parsedParams = readParamKeysFromArg(paramsArg)
            for (const key of keys) {
              usedKeys.add(key)
              if (!validKeys.has(key)) {
                unknownKeyErrors.push(`${rel}:${lineNumberOf(sf, keyArg)} unknown key "${key}"`)
                continue
              }
              const expectedVars = extractPlaceholders(flatVi[key])
              if (expectedVars.length > 0 && !parsedParams.dynamic) {
                const missing = expectedVars.filter((v) => !parsedParams.keys.has(v))
                if (missing.length > 0) {
                  placeholderErrors.push(
                    `${rel}:${lineNumberOf(sf, node)} key "${key}" missing interpolation params: ${missing.join(', ')}`,
                  )
                }
              }
              if (paramsArg && !parsedParams.dynamic) {
                const extra = [...parsedParams.keys].filter((k) => !expectedVars.includes(k))
                if (extra.length > 0) {
                  placeholderErrors.push(
                    `${rel}:${lineNumberOf(sf, node)} key "${key}" passed unused interpolation params: ${extra.join(', ')}`,
                  )
                }
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit)
    }

    visit(sf)
  }

  for (const key of knownKeyLiterals) {
    usedKeys.add(key)
  }

  const unusedKeys = [...validKeys].filter((k) => !usedKeys.has(k)).sort()

  return {
    usedKeys,
    unusedKeys,
    unknownKeyErrors,
    placeholderErrors,
    dynamicKeyErrors,
    hardcodedJsxErrors,
    hardcodedAttrErrors,
    legacyApiErrors,
    inlineLocaleBranchErrors,
    duplicateObjKeyErrors,
  }
}

test('nested vi/en/ja translation catalogs have full key parity, matching placeholders, and no duplicate keys', () => {
  const flatByLang = Object.fromEntries(
    LANGUAGES.map((lang) => [lang, flattenTranslations(translations[lang])]),
  )

  const viKeys = Object.keys(flatByLang.vi).sort()
  const enKeys = Object.keys(flatByLang.en).sort()
  const jaKeys = Object.keys(flatByLang.ja).sort()

  assert.deepEqual(enKeys, viKeys, 'English and Vietnamese translation keys must match exactly')
  assert.deepEqual(jaKeys, viKeys, 'Japanese and Vietnamese translation keys must match exactly')
  assert.ok(viKeys.length > 350, `Expected consolidated dictionary (>350 keys), got ${viKeys.length}`)

  const keySet = new Set(viKeys)
  for (const [key, meta] of INTENTIONAL_IDENTICAL_KEYS) {
    assert.ok(keySet.has(key), `Stale INTENTIONAL_IDENTICAL_KEYS entry (key does not exist): ${key}`)
    const valuesAcrossDeclared = meta.locales.map((lang) => flatByLang[lang][key])
    assert.equal(
      new Set(valuesAcrossDeclared).size,
      1,
      `Stale INTENTIONAL_IDENTICAL_KEYS entry "${key}": expected identical values across [${meta.locales.join(', ')}], got ${JSON.stringify(Object.fromEntries(meta.locales.map((l) => [l, flatByLang[l][key]])))}`,
    )
  }

  for (const key of viKeys) {
    for (const lang of LANGUAGES) {
      const value = flatByLang[lang][key]
      assert.equal(typeof value, 'string', `Expected string value for ${lang}.${key}`)
      assert.ok(value.trim().length > 0, `Empty translation string for ${lang}.${key}`)
    }

    const viPh = extractPlaceholders(flatByLang.vi[key])
    const enPh = extractPlaceholders(flatByLang.en[key])
    const jaPh = extractPlaceholders(flatByLang.ja[key])
    assert.deepEqual(enPh, viPh, `Placeholder mismatch in en.${key}`)
    assert.deepEqual(jaPh, viPh, `Placeholder mismatch in ja.${key}`)

    const allow = INTENTIONAL_IDENTICAL_KEYS.get(key)
    for (const [a, b] of [['vi', 'en'], ['vi', 'ja'], ['en', 'ja']]) {
      if (flatByLang[a][key] === flatByLang[b][key]) {
        assert.ok(
          allow && allow.locales.includes(a) && allow.locales.includes(b),
          `Suspected untranslated string (${a} === ${b}) for "${key}": ${flatByLang[a][key]}`,
        )
      }
    }
  }
})

test('canonical Vietnamese copy avoids untranslated UI loanwords', () => {
  const flatVi = flattenTranslations(translations.vi)
  const disallowedLoanwords = [
    /\bworkspace\b/i,
    /\bsignalling\b/i,
    /\bmeeting board\b/i,
    /\bavatar\b/i,
  ]
  const allowedContexts = [/Dev TXT/i, /\bEmail\b/i, /\bWebRTC\b/i, /\bP2P\b/i]

  for (const [key, value] of Object.entries(flatVi)) {
    // Exclude intentionally preserved technical/protocol phrases if present in explanatory notice text.
    const masked = allowedContexts.reduce((acc, re) => acc.replace(re, ''), value)
    for (const pattern of disallowedLoanwords) {
      assert.equal(
        pattern.test(masked),
        false,
        `Vietnamese key "${key}" contains disallowed loanword (${pattern}): "${value}"`,
      )
    }
  }
})

test('recursive src/ AST audit enforces zero unlocalized JSX/attrs, zero legacy helpers, zero missing keys, and zero unused keys', () => {
  const srcFiles = discoverSourceFiles(SRC_ROOT)
  assert.ok(srcFiles.length >= 40, `Expected recursive discovery under src/, found ${srcFiles.length}`)

  const flatByLang = Object.fromEntries(
    LANGUAGES.map((lang) => [lang, flattenTranslations(translations[lang])]),
  )
  const report = auditSourceFiles(srcFiles, flatByLang)

  assert.deepEqual(report.duplicateObjKeyErrors, [], `Duplicate i18n keys:\n${report.duplicateObjKeyErrors.join('\n')}`)
  assert.deepEqual(report.legacyApiErrors, [], `Deprecated i18n API usages:\n${report.legacyApiErrors.join('\n')}`)
  assert.deepEqual(report.inlineLocaleBranchErrors, [], `Inline locale conditionals:\n${report.inlineLocaleBranchErrors.join('\n')}`)
  assert.deepEqual(report.hardcodedJsxErrors, [], `Hardcoded JSX text:\n${report.hardcodedJsxErrors.join('\n')}`)
  assert.deepEqual(report.hardcodedAttrErrors, [], `Hardcoded attribute literals:\n${report.hardcodedAttrErrors.join('\n')}`)
  assert.deepEqual(report.dynamicKeyErrors, [], `Unresolved dynamic translation keys:\n${report.dynamicKeyErrors.join('\n')}`)
  assert.deepEqual(report.unknownKeyErrors, [], `Unknown translation keys:\n${report.unknownKeyErrors.join('\n')}`)
  assert.deepEqual(report.placeholderErrors, [], `Interpolation mismatches:\n${report.placeholderErrors.join('\n')}`)
  assert.deepEqual(report.unusedKeys, [], `Unused translation keys:\n${report.unusedKeys.join('\n')}`)
})

test('AST validator audits all applicable rules inside dev/roomReview.tsx UI fixture', () => {
  const reviewFile = path.join(CLIENT_ROOT, 'dev', 'roomReview.tsx')
  const flatByLang = Object.fromEntries(
    LANGUAGES.map((lang) => [lang, flattenTranslations(translations[lang])]),
  )
  const report = auditSourceFiles([reviewFile], flatByLang)
  assert.deepEqual(report.duplicateObjKeyErrors, [])
  assert.deepEqual(report.legacyApiErrors, [])
  assert.deepEqual(report.inlineLocaleBranchErrors, [])
  assert.deepEqual(report.hardcodedJsxErrors, [])
  assert.deepEqual(report.hardcodedAttrErrors, [])
  assert.deepEqual(report.dynamicKeyErrors, [])
  assert.deepEqual(report.unknownKeyErrors, [])
  assert.deepEqual(report.placeholderErrors, [])
})

test('recursive discovery catches hardcoded JSX expressions, attributes, inline branches, bad keys, and missing params', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-i18n-test-'))
  try {
    const nestedDir = path.join(tmpDir, 'nested', 'widget')
    fs.mkdirSync(nestedDir, { recursive: true })
    const badFile = path.join(nestedDir, 'DynamicPanel.tsx')
    fs.writeFileSync(
      badFile,
      `
      import { uiText } from '../i18n/uiText'
      import { ConfirmDialog } from './ConfirmDialog'
      export function DynamicPanel({
        lang,
        ready,
        isRoom,
        busy,
        name,
        count,
        resourceName,
        userName,
        t,
      }: {
        lang: 'vi' | 'en' | 'ja'
        ready: boolean
        isRoom: boolean
        busy: boolean
        name: string
        count: number
        resourceName: string
        userName: string
        t: any
      }) {
        return (
          <section aria-label={"Close dialog"}>
            <div>{ready ? 'Loading...' : 'Ready'}</div>
            <div>{\`Hello \${name}\`}</div>
            <div>{\`\${count} files selected\`}</div>
            <div>{\`Loading \${resourceName}...\`}</div>
            <input placeholder={isRoom ? 'Search rooms' : 'Search members'} />
            <div title={\`Created by \${userName}\`} />
            <ConfirmDialog
              description={"Permanent action"}
              confirmLabel={busy ? 'Saving...' : 'Save'}
              aria-description={"Helper info"}
            />
            <span>{lang === 'ja' ? '保存しました' : 'Saved'}</span>
            <p>{t('does.not.exist')}</p>
            <p>{t('meetingBoard.totalCards')}</p>
            <span>{uiText(lang, 'X', 'Y')}</span>
          </section>
        )
      }
      `,
      'utf8',
    )

    const discovered = discoverSourceFiles(tmpDir)
    assert.deepEqual(discovered, [badFile])

    const flatByLang = Object.fromEntries(
      LANGUAGES.map((lang) => [lang, flattenTranslations(translations[lang])]),
    )
    const report = auditSourceFiles(discovered, flatByLang, tmpDir)

    // 1. Hardcoded JSX conditional expression
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"Loading..."')))
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"Ready"')))
    // 2. Hardcoded JSX template expression static fragments
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"Hello"')))
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"files selected"')))
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"Loading"')))
    // 3. Hardcoded aria-label inside JSX expression
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('aria-label expression "Close dialog"')))
    // 4. Hardcoded placeholder inside conditional expression
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('placeholder expression "Search rooms"')))
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('placeholder expression "Search members"')))
    // 5. Hardcoded title inside template expression
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('title expression "Created by"')))
    // 6. Hardcoded component copy via user-facing props
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('description expression "Permanent action"')))
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('confirmLabel expression "Saving..."')))
    assert.ok(report.hardcodedAttrErrors.some((e) => e.includes('aria-description expression "Helper info"')))
    // 7. Inline locale-dependent hardcoded UI text
    assert.ok(report.inlineLocaleBranchErrors.some((e) => e.includes("lang === 'ja'")))
    assert.ok(report.hardcodedJsxErrors.some((e) => e.includes('"保存しました"') || e.includes('"Saved"')))
    // 8. Unknown translation keys
    assert.ok(report.unknownKeyErrors.some((e) => e.includes('does.not.exist')))
    // 9. Missing interpolation parameters
    assert.ok(report.placeholderErrors.some((e) => e.includes('meetingBoard.totalCards')))
    // 10. Legacy translation helper calls
    assert.ok(report.legacyApiErrors.some((e) => e.includes('uiText')))
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('recursive discovery does not falsely flag valid translations, technical tokens, or documented allowlists', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bifrost-i18n-clean-'))
  try {
    const cleanDir = path.join(tmpDir, 'nested', 'clean')
    fs.mkdirSync(cleanDir, { recursive: true })
    const cleanFile = path.join(cleanDir, 'CleanWidget.tsx')
    fs.writeFileSync(
      cleanFile,
      `
      import { translate, type Language } from '../src/i18n'
      import { translateLanding } from '../src/i18n/landing'
      export function CleanWidget({
        lang,
        active,
        tone,
        status,
        wsId,
        userName,
        roleCode,
        count,
        t,
      }: {
        lang: Language
        active: boolean
        tone: string
        status: string
        wsId: string
        userName: string
        roleCode: string
        count: number
        t: any
      }) {
        const technicalRole = 'MODERATOR' as const
        const savedLocale = localStorage.getItem('bifrost_locale')
        const endpoint = \`/api/workspaces/\${wsId}/rooms\`
        const protocolEvent = 'file:chunk'
        return (
          <section
            data-testid="room-panel"
            data-state={status === 'READY' ? 'ready' : 'idle'}
            data-role={technicalRole}
            data-locale={savedLocale}
            data-endpoint={endpoint}
            data-event={protocolEvent}
            className={active ? 'board-card is-active' : \`board-card \${tone}\`}
            title={\`\${userName} (\${roleCode})\`}
            aria-label={t('room.loading')}
          >
            <span>Bifrost</span>
            <span>WebRTC · P2P</span>
            <span>{userName}</span>
            <span>{\`\${count}\`}</span>
            <span>{t('room.loading')}</span>
            <span>{translate('en', 'meetingBoard.totalCards', { count: 2 })}</span>
            <span>{translateLanding(lang, 'common.languageLabel')}</span>
          </section>
        )
      }
      `,
      'utf8',
    )

    const discovered = discoverSourceFiles(tmpDir)
    assert.deepEqual(discovered, [cleanFile])

    const flatByLang = Object.fromEntries(
      LANGUAGES.map((lang) => [lang, flattenTranslations(translations[lang])]),
    )
    const report = auditSourceFiles(discovered, flatByLang, tmpDir)

    assert.deepEqual(report.duplicateObjKeyErrors, [])
    assert.deepEqual(report.legacyApiErrors, [])
    assert.deepEqual(report.inlineLocaleBranchErrors, [])
    assert.deepEqual(report.hardcodedJsxErrors, [])
    assert.deepEqual(report.hardcodedAttrErrors, [])
    assert.deepEqual(report.dynamicKeyErrors, [])
    assert.deepEqual(report.unknownKeyErrors, [])
    assert.deepEqual(report.placeholderErrors, [])
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
})

test('runtime translators substitute parameters, share landing/app slices, and handle fallback cleanly', () => {
  assert.equal(translations.vi.landing, translations.vi.landing)
  assert.equal(translate('en', 'meetingBoard.totalCards', { count: 4 }), '4 cards')
  assert.equal(translate('ja', 'meetingBoard.movedAnnouncement', {
    title: 'Spec',
    column: 'アジェンダ',
    position: 2,
    total: 5,
  }), '「Spec」をアジェンダの2/5番目に移動しました')

  const landingT = createLandingT('ja')
  assert.equal(landingT('loading.initializing'), translateLanding('ja', 'loading.initializing'))
  assert.equal(formatMessage('Hi {name}', { name: 'Bifrost' }), 'Hi Bifrost')
  assert.equal(resolveMessage(translations, 'en', 'nonexistent.missing.key'), '[missing:nonexistent.missing.key]')

  assert.equal(LOCALE_META.vi.code, 'VI')
  assert.equal(LOCALE_META.en.code, 'EN')
  assert.equal(LOCALE_META.ja.code, 'JA')

  // Safe outside browser storage
  assert.equal(getInitialLanguage(), 'vi')
  saveLanguage('ja')
})
