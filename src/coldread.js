/**
 * Compaction metrics for sessions the host has not loaded.
 *
 * The counter must not depend on whether a conversation is currently running:
 * switching to a session whose agent is idle used to leave the floating window
 * at "…" until the page was reloaded, because `ctx.sessions.get(id)` only knows
 * sessions live in this process.
 *
 * DSH has a read-only path for exactly this: `ctx.sessionQuery.readSession(id)`
 * returns the complete, replay-validated event log *"without making the session
 * live"*. The compaction count is a pure function of that log, so it can be
 * answered for any session. The same single pass also yields the spend and
 * occupancy figures the decision needs, using the very same helpers the live
 * path uses — so both paths measure the same way and can be compared.
 *
 * Deliberately NOT done here:
 * - the cold session is never inserted into the live tracker (that would inflate
 *   the tracked count and break `session/disposed` semantics);
 * - no private storage paths are read (`$DSH_HOME/storages/**`, `sessions/**`);
 *   those are internal implementation details. Everything comes from the log.
 *
 * @module @hjdd14/dsh-toolong-warning/src/coldread
 */

import { INITIAL_COMPACTION_STATE, foldCompaction, isCompactionEvent, readOccupancy } from './detect.js'
import { sampleTokens, usageOf } from './state.js'

/** How long one cold read's result is reused before the log is read again. */
const DEFAULT_TTL_MS = 30_000
/** Upper bound on one cold read, so a stalled backend cannot pin a request. */
const DEFAULT_TIMEOUT_MS = 5_000
/** How many sessions' cold results are retained. */
const DEFAULT_CAPACITY = 64

/**
 * Read the newest route capacity recorded in a log.
 * @param events - the session's events, in order.
 * @returns the last `request/context` capacity, or undefined.
 */
function lastContextWindow(events) {
  let window
  for (const event of events) {
    if (event?.type !== 'request/context') continue
    const value = event.data?.contextWindow
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) window = value
  }
  return window
}

/**
 * Read the newest provider-reported prompt size recorded in a log.
 * @param events - the session's events, in order.
 * @returns prompt-side tokens of the last usage sample, or undefined.
 */
function lastPressureTokens(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const usage = usageOf(events[index])
    if (usage === undefined) continue
    const { inputTokens, cacheReadTokens, cacheWriteTokens } = usage
    const parts = [inputTokens, cacheReadTokens, cacheWriteTokens]
      .filter((value) => typeof value === 'number' && Number.isFinite(value))
    if (parts.length > 0) return parts.reduce((sum, value) => sum + value, 0)
  }
  return undefined
}

/**
 * Fold one cold session log into the metrics the decision reads.
 *
 * One pass: usage sampling and compaction folding interleave exactly as they do
 * live, so the spend boundary a compaction snapshots is the spend that really
 * preceded it.
 * @param events - the complete raw log.
 * @returns the cold metrics.
 */
export function foldColdLog(events) {
  let state = INITIAL_COMPACTION_STATE
  let sampledTokens = 0
  let sampledEvents = 0

  for (const event of events) {
    if (isCompactionEvent(event)) {
      // Fold the marker against the spend that preceded it, then add this event's
      // own sample — matching the live fold's ordering exactly.
      state = foldCompaction(state, event, sampledTokens)
    }
    const usage = usageOf(event)
    if (usage !== undefined) {
      sampledTokens += sampleTokens(usage)
      sampledEvents += 1
    }
  }

  const baseline = Math.max(0, state.sampledTokensAtLastCompaction)
  const spendSinceLastCompaction = sampledEvents > 0 ? Math.max(0, sampledTokens - baseline) : undefined
  const contextWindow = lastContextWindow(events)
  const pressureTokens = lastPressureTokens(events)
  // Reuse the live path's occupancy reader so the cold and live figures are
  // derived by the same rule (prompt sample, plus surface movement when known).
  const occupancy = readOccupancy({
    ...(pressureTokens === undefined ? {} : { pressureTokens }),
    ...(pressureTokens === undefined ? {} : { surfaceTokens: pressureTokens, sampledSurfaceTokens: pressureTokens }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
  })

  return {
    count: state.count,
    lastCompactionSeq: state.lastCompactionSeq,
    // Deliberately the same field names `buildMetrics` produces, because the
    // decision reads these directly — a renamed field would silently become
    // `undefined` and disable the reminder on this path.
    billedTokens: sampledEvents > 0 ? sampledTokens : undefined,
    tokensSinceCompaction: spendSinceLastCompaction,
    dataKnown: spendSinceLastCompaction !== undefined,
    occupiedUnknown: occupancy.occupancyRatio === undefined,
    sampledTokens,
    sampledEvents,
    spendSinceLastCompaction,
    contextWindow,
    pressureTokens,
    projectedTokens: occupancy.projectedTokens,
    occupancyRatio: occupancy.occupancyRatio,
    events: events.length,
  }
}

/**
 * Race one promise against a timeout.
 * @param promise - the operation to bound.
 * @param timeoutMs - budget in milliseconds; 0 or less disables the bound.
 * @returns the operation's result, or a rejection when it exceeds the budget.
 */
function withTimeout(promise, timeoutMs) {
  if (!(timeoutMs > 0)) return promise
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`cold read exceeded ${String(timeoutMs)}ms`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/**
 * Create the history reader.
 *
 * @param options - the query service, a logger, the cache knobs, and a clock.
 * @returns `{ read, runSelfTest, size, clear, stats }`.
 */
export function createColdReader(options) {
  const sessionQuery = options?.sessionQuery
  const log = options?.log ?? console
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const capacity = options?.capacity ?? DEFAULT_CAPACITY
  // How long a cached value is served without re-reading the log at all. Kept
  // well below the TTL so a growing conversation is noticed within a few polls,
  // while idle sessions still cost one read per revalidation window.
  const revalidateMs = Math.max(1000, Math.min(ttlMs, options?.revalidateMs ?? Math.ceil(ttlMs / 4)))
  const now = options?.now ?? (() => Date.now())
  /** @type {Map<string, { events: number, result: object, expiresAt: number, at: number }>} */
  const cache = new Map()
  let reads = 0
  let hits = 0
  let failures = 0

  /** Drop the least recently used entry when the cache is full. */
  function evictIfNeeded() {
    if (cache.size <= capacity) return
    let oldestKey
    let oldestAt = Infinity
    for (const [key, entry] of cache) {
      if (entry.at < oldestAt) {
        oldestAt = entry.at
        oldestKey = key
      }
    }
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }

  /**
   * Read one session's compaction metrics from its log.
   * @param sessionId - any session id, live or not.
   * @param options - `fresh: true` bypasses the cache for one read (used by the
   *   self-test, where comparing a cached value against a live one would compare
   *   two different moments in time and report a false disagreement).
   * @returns the metrics, or undefined when the log cannot be read.
   */
  async function read(sessionId, options) {
    if (sessionQuery === undefined || typeof sessionQuery.readSession !== 'function') return undefined
    const cached = cache.get(sessionId)
    const stamp = now()
    const bypassCache = options?.fresh === true
    // A fresh entry that is still inside its revalidation window is reused
    // outright. Past that window the log is re-read even though the entry has not
    // expired, so growth on a session nobody is watching is still picked up —
    // without re-reading on every poll.
    if (!bypassCache && cached !== undefined && cached.revalidateAt > stamp) {
      hits += 1
      return { ...cached.result, cacheHit: true }
    }

    let snapshot
    try {
      reads += 1
      snapshot = await withTimeout(Promise.resolve(sessionQuery.readSession(sessionId)), timeoutMs)
    } catch (error) {
      failures += 1
      log.warn?.(`[toolong-warning] history read failed for ${sessionId}: ${String(error)}`)
      // Keep serving the last known value when a refresh fails, but never
      // resurrect it past its own TTL.
      if (cached !== undefined && cached.expiresAt > stamp) {
        return { ...cached.result, cacheHit: true, stale: true }
      }
      return undefined
    }
    const events = Array.isArray(snapshot?.events) ? snapshot.events : undefined
    if (events === undefined) {
      failures += 1
      log.warn?.(`[toolong-warning] history read returned no events for ${sessionId}`)
      return undefined
    }
    // Never serve one session's log under another session's id: a mismatched or
    // missing header would otherwise let a typo'd id inherit a real
    // conversation's numbers. The reader is also the place a session that does
    // not exist at all gets rejected — the backend throws for that case.
    const headerId = snapshot?.session?.id
    if (headerId !== undefined && headerId !== null && String(headerId) !== String(sessionId)) {
      failures += 1
      log.warn?.(`[toolong-warning] history read for ${sessionId} returned session ${String(headerId)}; ignoring`)
      return undefined
    }

    const result = foldColdLog(events)
    cache.set(sessionId, {
      seq: events.length,
      result,
      expiresAt: stamp + ttlMs,
      revalidateAt: stamp + revalidateMs,
      at: stamp,
    })
    evictIfNeeded()
    return { ...result, cacheHit: false }
  }

  /**
   * Run the reader against one session and report whether its count agrees with
   * an independently folded expectation — used by the `?selftest=1` probe.
   * @param sessionId - the session to read.
   * @param expectedCount - the count the live path reports, when it has one.
   * @returns a pass/fail record.
   */
  async function runSelfTest(sessionId, expectedCount) {
    const result = await read(sessionId)
    if (result === undefined) {
      return { pass: false, reason: 'history-unavailable', mismatches: ['history read returned nothing'] }
    }
    const mismatches = []
    if (typeof expectedCount === 'number' && expectedCount !== result.count) {
      mismatches.push(`count: live path says ${String(expectedCount)}, history path says ${String(result.count)}`)
    }
    return { pass: mismatches.length === 0, checks: result, mismatches }
  }

  return {
    read,
    runSelfTest,
    size: () => cache.size,
    clear: () => cache.clear(),
    stats: () => ({ reads, hits, failures, cacheSize: cache.size }),
  }
}
