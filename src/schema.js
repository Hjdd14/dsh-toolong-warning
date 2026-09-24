/**
 * Config resolution for the plugin body.
 *
 * `apply(ctx, config)` receives the Loader-resolved row config; this module runs
 * it through the schemastery schema, turns any validation issues into log
 * warnings, and hands back the flat object the decision logic reads.
 *
 * On failure the schema's per-field defaults are used instead of the bad value:
 * a malformed row config must not take the whole profile row down, and it must
 * not silently keep a value outside the declared bounds either.
 *
 * @module @hjdd14/dsh-toolong-warning/src/schema
 */

import { ConfigInfo, DEFAULTS, FIELDS } from './config.js'

/** Default thresholds, re-exported for the client's offline fallback copy. */
export const DEFAULT_THRESHOLDS = DEFAULTS

/**
 * Describe one validation issue for the log.
 * @param issue - a schemastery standard-schema issue.
 * @returns a one-line message naming the field.
 */
function describeIssue(issue) {
  const path = Array.isArray(issue?.path) && issue.path.length > 0 ? issue.path.join('.') : 'config'
  const message = typeof issue?.message === 'string' ? issue.message : 'invalid value'
  return `${path}: ${message}`
}

/**
 * Unwrap one resolved config value.
 *
 * A schema field marked `.volatile()` validates to a `Volatile` wrapper (a
 * getter that can re-evaluate a `!!js` expression), not to a plain value. The
 * fallback descriptor in `src/config.js` returns plain values, so both shapes
 * must be accepted here.
 * @param value - one field's resolved value.
 * @returns the plain value.
 */
function plainValue(value) {
  if (value === null || typeof value !== 'object') return value
  if (typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

/**
 * Resolve one row config into the effective thresholds.
 * @param raw - config as delivered to `apply`, possibly undefined.
 * @returns `{ config, warnings, source }`.
 */
export function resolveConfig(raw) {
  let result
  try {
    result = ConfigInfo['~standard'].validate(raw ?? {})
  } catch (error) {
    return {
      config: { ...DEFAULTS },
      warnings: [`config validation threw (${String(error)}); using defaults`],
      source: 'defaults',
    }
  }

  // The schema substitutes a field's default for anything it rejects, so the
  // returned value is always usable; only the reason needs reporting.
  const value = { ...DEFAULTS }
  for (const field of FIELDS) {
    const resolved = plainValue(result?.value?.[field.name])
    if (resolved !== undefined) value[field.name] = resolved
  }
  const issues = Array.isArray(result?.issues) ? result.issues : []
  const extra = Array.isArray(result?.warnings) ? result.warnings : []
  const warnings = [...issues.map(describeIssue), ...extra]
  if (warnings.length > 0) return { config: value, warnings, source: 'row-with-warnings' }
  return { config: value, warnings: [], source: raw === undefined ? 'defaults' : 'row' }
}

/** The subset of the resolved config the detection decision reads. */
export function thresholdsOf(config) {
  return {
    compactCountMin: config.compactCountMin,
    occupancyPercentMin: config.occupancyPercentMin,
    tokensSinceCompactionMin: config.tokensSinceCompactionMin,
  }
}

/** Bounds per decision field, taken from the schema descriptors. */
const THRESHOLD_BOUNDS = new Map(
  FIELDS
    .filter((field) => ['compactCountMin', 'occupancyPercentMin', 'tokensSinceCompactionMin'].includes(field.name))
    .map((field) => [field.name, { min: field.min, max: field.max, default: field.default }]),
)

/**
 * Apply browser-supplied threshold overrides on top of the resolved row config.
 *
 * Why this exists: DSH deliberately keeps the settings *form* read-only on a
 * non-loopback page (`persistence = ctx.remote.$host.isLoopback ? 'host' :
 * 'memory'`, `@deepseek-ai/dsh-client-ui-settings/lib/client.js:1509`), and that
 * applies to every plugin's config — so a user whose browser is not on
 * `localhost`/`127.x` cannot edit thresholds through the Settings page at all.
 * This lets the browser carry its own override on the state request instead. The
 * values are validated and clamped here, per request, and nothing is written to
 * disk: an out-of-range or nonsense value cannot influence the decision, and the
 * host stays the only thing that decides.
 *
 * @param config - the resolved row config.
 * @param lookup - reads one query parameter, returning null when absent.
 * @returns `{ config, overridden, overrides, rejected }`.
 */
export function applyThresholdOverrides(config, lookup) {
  const overrides = {}
  const rejected = []
  let overridden = false

  for (const [name, bounds] of THRESHOLD_BOUNDS) {
    const raw = lookup(name)
    if (raw === null || raw === undefined || raw === '') continue
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      rejected.push(`${name}: ${JSON.stringify(raw)} is not an integer`)
      continue
    }
    if (parsed < bounds.min || parsed > bounds.max) {
      rejected.push(`${name}: ${String(parsed)} outside ${String(bounds.min)}..${String(bounds.max)}; ignored`)
      continue
    }
    overrides[name] = parsed
    overridden = true
  }

  if (!overridden) return { config, overridden: false, overrides, rejected }
  return { config: { ...config, ...overrides }, overridden: true, overrides, rejected }
}
