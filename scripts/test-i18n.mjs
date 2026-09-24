/**
 * Tests for localization.
 *
 * Run with: node scripts/test-i18n.mjs
 *
 * The plugin ships its own dictionaries (a hand-written client bundle cannot
 * require the harness' locale package), so these tests are the guard that a
 * language switch is complete and total: identical key sets in both languages,
 * placeholders that resolve, and an initial language that degrades sensibly when
 * nothing tells it what to use.
 *
 * The browser bundle must also be self-contained — DSH serves it from a combo URL
 * through an in-memory response map, so it cannot fetch a sibling module — which
 * means the dictionaries exist twice. The last section here is what keeps those
 * two copies honest.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  LANGUAGES,
  LANGUAGE_LABELS,
  MESSAGES,
  createLanguageStore,
  messageKeys,
  normalizeLanguage,
  resolveInitialLanguage,
  t,
} from '../src/i18n.js'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let passed = 0
let failed = 0

function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
    console.log(`  ok   ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL ${label}\n         expected ${JSON.stringify(expected)}\n         actual   ${JSON.stringify(actual)}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** A localStorage stand-in that can also be made to throw. */
function memoryStorage(initial) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
    size: () => map.size,
  }
}

// ---------------------------------------------------------------------------
section('dictionaries: both languages are complete')
// ---------------------------------------------------------------------------
{
  check('two languages are shipped', LANGUAGES, ['zh', 'en'])
  check('each language has a label', LANGUAGES.every((id) => typeof LANGUAGE_LABELS[id] === 'string'), true)

  const zh = messageKeys('zh')
  const en = messageKeys('en')
  check('the languages carry the same number of strings', zh.length, en.length)
  check('nothing is missing from en', zh.filter((key) => !en.includes(key)), [])
  check('nothing is missing from zh', en.filter((key) => !zh.includes(key)), [])
  check('the dictionary is not trivially small', zh.length > 50, true)

  // Every entry must be a non-empty string in both languages.
  const blanks = []
  for (const lang of LANGUAGES) {
    for (const [key, value] of Object.entries(MESSAGES[lang])) {
      if (typeof value !== 'string' || value.trim() === '') blanks.push(`${lang}.${key}`)
    }
  }
  check('no empty strings', blanks, [])

  // A translated string must actually differ from the other language's, except
  // for genuine constants (numbers, URLs) and the one label that is deliberately
  // bilingual so it is findable from either language.
  const INTENTIONALLY_SHARED = new Set(['settings.language'])
  const identical = []
  for (const key of zh) {
    if (INTENTIONALLY_SHARED.has(key)) continue
    if (MESSAGES.zh[key] === MESSAGES.en[key] && !/^[\d\s%.,:/-]*$/.test(MESSAGES.zh[key])) {
      identical.push(key)
    }
  }
  check('no untranslated duplicates between languages', identical, [])
  check('the shared label really is shared', MESSAGES.zh['settings.language'], MESSAGES.en['settings.language'])
}

// ---------------------------------------------------------------------------
section('t(): substitution and fallback')
// ---------------------------------------------------------------------------
{
  check('plain lookup', t('zh', 'overlay.title'), '长对话提醒')
  check('plain lookup, other language', t('en', 'overlay.title'), 'Long-conversation reminder')
  check('placeholder substitution', t('en', 'warn.summary', { count: 3, threshold: 2, occupancy: 'x' }).includes('3'), true)
  check('all placeholders resolve', t('en', 'warn.summary', { count: 3, threshold: 2, occupancy: 'x' }).includes('{'), false)
  check('an unknown placeholder is left visible', t('en', 'warn.fromHistory', { nope: 1 }), '; based on history')
  check('a missing key degrades to the key', t('en', 'no.such.key'), 'no.such.key')
  check('an unknown language falls back to en', t('de', 'overlay.title'), MESSAGES.en['overlay.title'])
  check('a missing key in one language falls back to en', t('zh', 'no.such.key'), 'no.such.key')

  // Every key in both languages must render without throwing and without leaving
  // a placeholder behind when the expected parameters are supplied.
  const problematic = []
  for (const lang of LANGUAGES) {
    for (const key of messageKeys(lang)) {
      const rendered = t(lang, key, { count: 1, threshold: 2, occupancy: '1%', spend: '1k', default: 1, min: 0, max: 9, error: 'e', gate: 'g', countHint: '' })
      if (typeof rendered !== 'string' || rendered.includes('{')) problematic.push(`${lang}.${key}`)
    }
  }
  check('every string renders with representative parameters', problematic, [])
}

// ---------------------------------------------------------------------------
section('normalizeLanguage / resolveInitialLanguage')
// ---------------------------------------------------------------------------
{
  check('zh passes through', normalizeLanguage('zh'), 'zh')
  check('a regional tag maps to its base', normalizeLanguage('zh-CN'), 'zh')
  check('an underscore tag maps too', normalizeLanguage('zh_TW'), 'zh')
  check('en passes through', normalizeLanguage('en'), 'en')
  check('a regional english tag maps to en', normalizeLanguage('en-US'), 'en')
  check('case is ignored', normalizeLanguage('EN-gb'), 'en')
  check('an unsupported language is rejected', normalizeLanguage('ja'), undefined)
  check('garbage is rejected', normalizeLanguage(42), undefined)

  check('a stored choice wins', resolveInitialLanguage('en', undefined, ['zh-CN']), 'en')
  check('the harness locale comes next', resolveInitialLanguage(undefined, { getSnapshot: () => ({ active: 'en' }) }, ['zh-CN']), 'en')
  check('the browser language comes next', resolveInitialLanguage(undefined, undefined, ['en-GB', 'zh']), 'en')
  check('chinese is the final default', resolveInitialLanguage(undefined, undefined, ['ja']), 'zh')
  check('a locale service that throws is survivable', resolveInitialLanguage(undefined, { getSnapshot() { throw new Error('nope') } }, undefined), 'zh')
  check('a single language string is accepted', resolveInitialLanguage(undefined, undefined, 'en-US'), 'en')
}

// ---------------------------------------------------------------------------
section('createLanguageStore: choice, persistence and listeners')
// ---------------------------------------------------------------------------
{
  const storage = memoryStorage()
  const store = createLanguageStore({ storage, languages: ['zh-CN'] })
  check('starts from the browser language', store.get(), 'zh')

  let notifications = 0
  const unsubscribe = store.subscribe(() => { notifications += 1 })

  check('switching succeeds', store.set('en'), true)
  check('the value changed', store.get(), 'en')
  check('subscribers were told', notifications, 1)
  check('the choice was persisted', storage.getItem('dsh-toolong-warning.language.v1'), 'en')

  // A fresh store must pick the stored choice up, not the browser language.
  const reopened = createLanguageStore({ storage, languages: ['zh-CN'] })
  check('a stored choice survives a remount', reopened.get(), 'en')

  check('an unsupported language is refused', store.set('ja'), false)
  check('and does not change the value', store.get(), 'en')
  check('and does not notify', notifications, 1)

  unsubscribe()
  store.set('zh')
  check('an unsubscribed listener stops hearing', notifications, 1)

  // Storage that refuses writes must not stop the switch.
  const hostileStorage = {
    getItem: () => null,
    setItem: () => { throw new Error('quota exceeded') },
  }
  const hostile = createLanguageStore({ storage: hostileStorage, languages: ['zh'] })
  check('a storage failure is reported', hostile.set('en'), false)
  check('but the language still switches', hostile.get(), 'en')

  // The shared locale service is followed when it is present and writable.
  const switched = []
  const ctx = {
    get: (name) => (name === 'locale'
      ? { getSnapshot: () => ({ active: 'zh' }), setLocale: (id) => switched.push(id) }
      : undefined),
  }
  const shared = createLanguageStore({ ctx, storage: memoryStorage(), languages: ['en'] })
  check('the harness locale seeds the initial language', shared.get(), 'zh')
  shared.set('en')
  check('and follows a switch', switched, ['en'])

  // A shared locale service that refuses must not break the switch either.
  const refusing = createLanguageStore({
    ctx: { get: () => ({ getSnapshot: () => ({ active: 'zh' }), setLocale: () => { throw new Error('read-only') } }) },
    storage: memoryStorage(),
    languages: ['zh'],
  })
  check('a refusing harness locale is survivable', refusing.set('en'), true)
  check('and the plugin still switches', refusing.get(), 'en')
}

// ---------------------------------------------------------------------------
section('language choice and the threshold override stay independent')
// ---------------------------------------------------------------------------
{
  const storage = memoryStorage()
  const store = createLanguageStore({ storage, languages: ['zh'] })
  store.set('en')
  // The threshold override uses its own key; writing one must not disturb the other.
  storage.setItem('dsh-toolong-warning.thresholds.v1', '{"compactCountMin":1}')
  const reopened = createLanguageStore({ storage, languages: ['zh'] })
  check('the language survives a threshold write', reopened.get(), 'en')
  check('and the threshold survives too', storage.getItem('dsh-toolong-warning.thresholds.v1'), '{"compactCountMin":1}')
}

// ---------------------------------------------------------------------------
section('the inlined bundle dictionary matches src/i18n.js exactly')
// ---------------------------------------------------------------------------
{
  // Why this exists: `client.js` has to carry its own copy, because the bundle is
  // served from a combo URL out of an in-memory response map and cannot fetch a
  // sibling file. A missing string would then show up as a raw key in the UI and
  // nothing else would catch it. This extracts the copy from the bundle and
  // compares it, string for string, with the tested module.
  const source = await readFile(join(ROOT, 'client.js'), 'utf8')

  // Extract the object literal passed to `Object.freeze({...})` for `MESSAGES`.
  const start = source.indexOf("const MESSAGES = Object.freeze({")
  check('the bundle declares its own MESSAGES', start !== -1, true)

  const bodyStart = source.indexOf('{', source.indexOf('Object.freeze', start))
  let depth = 0
  let end = -1
  let inString = false
  let quote = ''
  let escaped = false
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) inString = false
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      inString = true
      quote = char
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) { end = index; break }
    }
  }
  check('the literal is balanced', end > bodyStart, true)

  const literal = source.slice(bodyStart, end + 1)
  // `Object.freeze` wraps each language table; unwrapping is enough to evaluate
  // it as a plain object literal in a context with no globals.
  const evaluated = new Function(`return (${literal.replaceAll('Object.freeze(', '(')})`)()
  const bundled = {
    zh: evaluated.zh,
    en: evaluated.en,
  }

  check('the bundle ships both languages', Object.keys(bundled).sort(), ['en', 'zh'])
  check('the bundle zh dictionary equals the module copy', bundled.zh, MESSAGES.zh)
  check('the bundle en dictionary equals the module copy', bundled.en, MESSAGES.en)

  // Restate it as a diff so a failure says which string drifted, not just "not equal".
  const drifted = []
  for (const lang of LANGUAGES) {
    for (const key of messageKeys(lang)) {
      if (bundled[lang]?.[key] !== MESSAGES[lang][key]) {
        drifted.push(`${lang}.${key}: bundle ${JSON.stringify(bundled[lang]?.[key])} vs module ${JSON.stringify(MESSAGES[lang][key])}`)
      }
    }
    for (const key of Object.keys(bundled[lang] ?? {})) {
      if (!(key in MESSAGES[lang])) drifted.push(`${lang}.${key}: only in the bundle`)
    }
  }
  check('no string drifted between the two copies', drifted, [])

  // The bundle must no longer try to import a sibling module, which can never be
  // served: the plugin route answers only the exact combo URL it composed.
  check('the bundle makes no sibling import', /import\s*\(\s*['"][^'"]*src\//.test(source), false)
  check('the bundle declares no runtime import of the dictionary', source.includes("import('./src/i18n.js')"), false)
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
