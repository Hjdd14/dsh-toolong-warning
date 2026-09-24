/**
 * The plugin's `Config` schema.
 *
 * This must be a real `@deepseek-ai/schemastery` object schema, not a hand-rolled
 * validator: `@deepseek-ai/dsh-settings` publishes a config form only for entries
 * whose schema it can walk (`volatileForm`), and it calls `schema.toJSON()`,
 * `schema.dict` and `schema.meta.volatile` on it. A plain object carrying only a
 * `~standard` validator has none of those, so the entry never appears in
 * `settings.describe` and its form stays permanently unavailable — observed on a
 * live host before this file was rewritten.
 *
 * Note the module name and how it is loaded. DSH ships `@deepseek-ai/schemastery`
 * (3.18.4, which has `.volatile()`), while the bare `schemastery` reachable from a
 * profile is 3.18.0 and has no `.volatile()` at all. And because a locally
 * installed plugin is a symlink to a directory *outside* the profile, Node
 * resolves its imports from the real path — where the profile's node_modules are
 * not on the search path. So the schema module is loaded by explicit candidate
 * path (profile, then install root), and if neither resolves, this module builds
 * a structurally equivalent descriptor by hand. That fallback keeps the plugin
 * bootable everywhere; the settings form is the only thing that depends on the
 * real library.
 *
 * @module @hjdd14/dsh-toolong-warning/src/config
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * Field descriptors: the Settings-page copy, plus the bounds shared by the
 * schema below and the client's own input handling.
 */
export const FIELDS = Object.freeze([
  Object.freeze({
    name: 'enabled',
    type: 'boolean',
    default: true,
    title: 'Enable the long-conversation reminder',
    description: 'When off, no state route is registered and no floating window appears.',
  }),
  Object.freeze({
    name: 'compactCountMin',
    type: 'integer',
    default: 3,
    min: 1,
    max: 20,
    title: 'Minimum completed compactions before warning',
    description: 'Only completed compactions count (failed or in-progress ones do not). Default 3.',
  }),
  Object.freeze({
    name: 'occupancyPercentMin',
    type: 'integer',
    default: 50,
    min: 10,
    max: 95,
    title: 'Context occupancy threshold (percent)',
    description: "Occupancy = the next request's expected prompt size divided by the model context window. Default 50.",
  }),
  Object.freeze({
    name: 'tokensSinceCompactionMin',
    type: 'integer',
    default: 200000,
    min: 10000,
    max: 5000000,
    title: 'Extra spend since the last compaction (tokens)',
    description: 'Billed tokens spent after the last completed compaction before it counts as heavy waste. At twice this value the reminder fires even without an occupancy figure. Default 200000.',
  }),
  Object.freeze({
    name: 'statsIntervalMs',
    type: 'integer',
    default: 15000,
    min: 5000,
    max: 120000,
    title: 'Floating-window refresh interval (ms)',
    description: 'How often the browser asks for the compaction count and pressure figures; paused while the page is hidden. Default 15000.',
  }),
  Object.freeze({
    name: 'dismissible',
    type: 'boolean',
    default: true,
    title: 'Allow dismissing this reminder',
    description: "When on, the window's dismiss button hides the current reminder; the counter keeps updating.",
  }),
  Object.freeze({
    name: 'historyReadTtlMs',
    type: 'integer',
    default: 30000,
    min: 5000,
    max: 600000,
    title: 'History-read cache duration (ms)',
    description: 'Sessions the host has not loaded are counted by reading their log; this is how long that result is reused. Smaller is fresher and reads the disk more. Default 30000.',
  }),
  Object.freeze({
    name: 'historyReadTimeoutMs',
    type: 'integer',
    default: 5000,
    min: 1000,
    max: 30000,
    title: 'History-read timeout (ms)',
    description: 'Time limit for one history read; on timeout it is treated as unreadable and the window falls back to the "not loaded yet" notice. Default 5000.',
  }),
])

/** Defaults, derived from the descriptors above. */
export const DEFAULTS = Object.freeze(Object.fromEntries(FIELDS.map((field) => [field.name, field.default])))

/**
 * Candidate directories whose `node_modules` may hold `@deepseek-ai/schemastery`.
 * The profile comes first because that is where a profile-installed plugin runs.
 * @returns absolute directories to try, in order.
 */
function candidateRoots() {
  const roots = []
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim() !== '') roots.push(profileDir)
  const home = process.env.DSH_HOME
  const dshHome = typeof home === 'string' && home.trim() !== '' ? home : join(homedir(), '.dsh')
  const profileName = process.env.DSH_PROFILE
  if (typeof profileName === 'string' && profileName.trim() !== '') {
    roots.push(join(dshHome, 'profiles', profileName))
  }
  roots.push(process.cwd())
  return roots
}

/**
 * Load the schemastery module from the first candidate that resolves it.
 * @returns the module's default export, or undefined when unavailable.
 */
async function loadSchemastery() {
  for (const root of candidateRoots()) {
    try {
      const require = createRequire(join(resolve(root), 'package.json'))
      const entry = require.resolve('@deepseek-ai/schemastery')
      const mod = await import(pathToFileURL(entry).href)
      const S = mod?.default ?? mod
      if (typeof S === 'function' && typeof S.object === 'function') {
        if (typeof S.number().volatile === 'function') return S
      }
    } catch {
      // Try the next candidate; a miss here is expected, not an error.
    }
  }
  return undefined
}

/** Metadata a form renderer reads; mirrors what schemastery attaches. */
function metaOf(field) {
  const meta = { vol: true }
  if (field.type === 'boolean') return { ...meta, ...(field.default === undefined ? {} : { default: field.default }) }
  const numeric = { ...meta }
  if (field.default !== undefined) numeric.default = field.default
  if (field.min !== undefined) numeric.min = field.min
  if (field.max !== undefined) numeric.max = field.max
  numeric.step = 1
  return numeric
}

/**
 * Build a descriptor with the same observable shape as a schemastery schema.
 *
 * This is the no-library fallback: it satisfies `volatileForm`'s walk
 * (`meta.volatile`, `dict`, `type`, `toJSON`) and validates through the standard
 * schema interface, so the plugin still boots and still resolves its config even
 * where the real library cannot be resolved.
 * @returns a schema-shaped descriptor.
 */
function buildDescriptor() {
  const dict = {}
  for (const field of FIELDS) {
    dict[field.name] = {
      type: field.type === 'boolean' ? 'boolean' : 'number',
      meta: metaOf(field),
      toString: () => field.type,
    }
  }
  const validate = (input) => {
    const source = input !== null && typeof input === 'object' ? input : {}
    const value = {}
    const issues = []
    for (const field of FIELDS) {
      const supplied = source[field.name]
      if (supplied === undefined) {
        value[field.name] = field.default
        continue
      }
      if (field.type === 'boolean') {
        if (typeof supplied === 'boolean') value[field.name] = supplied
        else {
          value[field.name] = field.default
          issues.push({ message: `expected boolean but got ${typeof supplied}`, path: [field.name] })
        }
        continue
      }
      if (typeof supplied !== 'number' || !Number.isFinite(supplied) || !Number.isInteger(supplied)) {
        value[field.name] = field.default
        issues.push({ message: `expected integer but got ${String(supplied)}`, path: [field.name] })
        continue
      }
      if (supplied < field.min || supplied > field.max) {
        value[field.name] = field.default
        issues.push({ message: `expected ${String(field.min)}..${String(field.max)} but got ${String(supplied)}`, path: [field.name] })
        continue
      }
      value[field.name] = supplied
    }
    return issues.length > 0 ? { value, issues } : { value }
  }
  return {
    type: 'object',
    meta: { default: { ...DEFAULTS } },
    dict,
    toJSON: () => ({ type: 'object', meta: { default: { ...DEFAULTS } }, dict }),
    '~standard': { version: 1, vendor: '@hjdd14/dsh-toolong-warning', validate },
  }
}

/**
 * Build the row schema with the real library when it resolves, and the
 * structurally equivalent fallback otherwise.
 * @param S - the schemastery module, or undefined.
 * @returns a schema usable as the plugin's `Config`.
 */
function buildSchema(S) {
  if (S === undefined) return buildDescriptor()
  // Descriptions come from FIELDS, so the schema document and the descriptors the
  // client reads can never disagree about a field's text.
  const described = Object.fromEntries(FIELDS.map((field) => [field.name, field.description]))
  return S.object({
    enabled: S.boolean().default(true).volatile().description(described.enabled),
    compactCountMin: S.number().default(3).min(1).max(20).step(1).volatile()
      .description(described.compactCountMin),
    occupancyPercentMin: S.number().default(50).min(10).max(95).step(1).volatile()
      .description(described.occupancyPercentMin),
    tokensSinceCompactionMin: S.number().default(200000).min(10000).max(5000000).step(1).volatile()
      .description(described.tokensSinceCompactionMin),
    statsIntervalMs: S.number().default(15000).min(5000).max(120000).step(1).volatile()
      .description(described.statsIntervalMs),
    dismissible: S.boolean().default(true).volatile()
      .description(described.dismissible),
    historyReadTtlMs: S.number().default(30000).min(5000).max(600000).step(1).volatile()
      .description(described.historyReadTtlMs),
    historyReadTimeoutMs: S.number().default(5000).min(1000).max(30000).step(1).volatile()
      .description(described.historyReadTimeoutMs),
  })
}

const schemastery = await loadSchemastery()

/** Whether the settings-grade schema library was found. */
export const usesSchemastery = schemastery !== undefined

/**
 * The row's config schema; every field is `.volatile()` and Settings-editable.
 */
export const ConfigInfo = buildSchema(schemastery)

/**
 * Machine-readable description of every field, echoed over the state route so
 * the Settings card renders bounds and copy without duplicating them.
 * @returns the field descriptors as plain JSON.
 */
export function configDescriptors() {
  return FIELDS.map((field) => ({ ...field }))
}

export default ConfigInfo

