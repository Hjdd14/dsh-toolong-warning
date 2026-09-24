/**
 * Host half of `@hjdd14/dsh-toolong-warning`.
 *
 * The plugin answers one question per session: *has this conversation been
 * compacted repeatedly and is it now burning a lot of extra tokens?* The
 * browser half renders the answer (and the always-on compaction count) as a
 * floating window, and offers the thresholds on the Settings page.
 *
 * This half owns:
 * - the per-session compaction fold (`src/state.js`), seeded from the durable
 *   log so a conversation that was already long when the plugin loaded is still
 *   counted correctly;
 * - the decision (`src/detect.js`, pure and offline-tested);
 * - two loopback-only read routes (`src/routes.js`) the browser polls.
 *
 * It imports no `@deepseek-ai/*` package: nothing beyond Node builtins and its
 * own sources, so it loads wherever the Loader can resolve this bundle.
 *
 * @module @hjdd14/dsh-toolong-warning
 */

import { ConfigInfo, configDescriptors, usesSchemastery } from './src/config.js'
import { createColdReader } from './src/coldread.js'
import { makeHealthRoute, makeStateRoute } from './src/routes.js'
import { resolveConfig } from './src/schema.js'
import { createTracker } from './src/state.js'

/** Stable cordis plugin name; also the profile entry id and the settings namespace. */
export const name = 'toolong-warning'

/** Services this plugin cannot work without. */
export const inject = ['webServer', 'sessions', 'sessionProjections']

/** The row's config descriptor; every field is `.volatile()` and Settings-editable. */
export const Config = ConfigInfo

/**
 * Mount the plugin.
 * @param ctx - host context carrying webServer, sessions and sessionProjections.
 * @param config - the Loader-resolved row config.
 */
export function apply(ctx, config) {
  const log = ctx.logger ?? console
  if (!usesSchemastery) {
    // Not fatal: the config still validates through the fallback descriptor, but
    // the Settings page cannot render a form for it.
    log.warn?.('[toolong-warning] @deepseek-ai/schemastery was not resolvable; using the fallback config descriptor (Settings page will not offer a form)')
  }
  const initial = resolveConfig(config)
  for (const warning of initial.warnings) log.warn?.(`[toolong-warning] config ${warning}`)

  let resolved = initial.config
  let warnings = initial.warnings
  let sourceConfig = config
  let version = 0

  /**
   * Resolve the effective config, re-resolving only when the Loader hands over
   * a different object (a Settings-page write reloads the row with fresh
   * `config`, so this is what makes an edited threshold take effect at once).
   * @returns the effective config.
   */
  function getConfig() {
    if (sourceConfig !== config) {
      sourceConfig = config
      const next = resolveConfig(config)
      resolved = next.config
      warnings = next.warnings
      version += 1
      for (const warning of warnings) log.warn?.(`[toolong-warning] config ${warning}`)
    }
    return resolved
  }

  if (getConfig().enabled !== true) {
    log.info?.('[toolong-warning] disabled by config; no routes registered')
    return
  }

  const tracker = createTracker(ctx)
  const deps = {
    getConfig,
    configVersion: () => version,
    tracker,
    descriptors: configDescriptors,
    sessions: ctx.sessions,
    projections: ctx.sessionProjections,
    log,
    // Set below when session-query is present; absent means the history source
    // simply does not exist in this composition.
    coldReader: undefined,
    // Used by `?selftest=1` to compare the two sources on real sessions.
    liveSessionsForSelfTest: () => {
      const out = []
      let entries
      try {
        entries = ctx.sessions.list()
      } catch {
        return out
      }
      for (const session of entries ?? []) {
        try {
          const folded = tracker.stateFor(session)
          out.push({ id: session.id, count: folded.state.count })
        } catch {
          // A session the fold cannot read is simply not part of the comparison.
        }
      }
      return out
    },
  }

  ctx.effect(() => {
    const disposers = [
      ctx.webServer.register(makeStateRoute(deps)),
      ctx.webServer.register(makeHealthRoute(deps)),
    ]
    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch (error) {
          // A route fiber already gone during shutdown is not an error.
          log.warn?.(`[toolong-warning] route dispose failed: ${String(error)}`)
        }
      }
      tracker.clear()
    }
  }, 'toolong-warning: routes and per-session fold')

  // The history source is optional: session-query is a separate capability, and
  // the plugin works without it (sessions the host has not loaded just stay
  // unmeasurable, which is the pre-existing behaviour).
  ctx.inject(['sessionQuery'], (queryCtx) => {
    const cfg = getConfig()
    const reader = createColdReader({
      sessionQuery: queryCtx.sessionQuery,
      log,
      ttlMs: cfg.historyReadTtlMs,
      timeoutMs: cfg.historyReadTimeoutMs,
    })
    deps.coldReader = reader
    log.info?.('[toolong-warning] history reads enabled; sessions the host has not loaded are counted from their log')
    return () => {
      // Releasing the reader on unload drops the cache; the next mount re-reads.
      reader.clear()
      deps.coldReader = undefined
    }
  })

  log.info?.(`[toolong-warning] mounted; thresholds ${JSON.stringify({
    compactCountMin: resolved.compactCountMin,
    occupancyPercentMin: resolved.occupancyPercentMin,
    tokensSinceCompactionMin: resolved.tokensSinceCompactionMin,
  })}; history reads ${deps.coldReader === undefined ? 'unavailable' : 'enabled'}`)
}

/** Re-exported so `scripts/check-client.mjs` can assert the resolver without a Loader. */
export { resolveConfig }
