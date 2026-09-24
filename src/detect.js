/**
 * Pure detection logic for the long-conversation warning.
 *
 * Everything in this module is a side-effect-free function over plain data:
 * session events, the token-meter projection states, and the resolved config.
 * Keeping the rules here (and out of the plugin body) is what lets
 * `scripts/test-detect.cjs` exercise every branch without booting DSH.
 *
 * Vocabulary used throughout:
 * - **successful compaction** — a `compaction/start` whose paired
 *   `compaction/end` carries no `error`. A failed compaction counted as a
 *   compaction would be exactly the false positive this plugin must avoid.
 * - **billed tokens** — the token-meter's cumulative provider usage
 *   (`uncachedInput + cacheRead + cacheWrite + output`), the same figure
 *   `dsh-usage` reports.
 * - **occupancy** — `projectedTokens / contextWindow`, i.e. what the NEXT
 *   request's prompt is expected to cost against the route's capacity.
 *
 * @module @hjdd14/dsh-toolong-warning/src/detect
 */

/** Default fold state: a session that has never compacted. */
export const INITIAL_COMPACTION_STATE = Object.freeze({
  /** Successful compactions observed in this session. */
  count: 0,
  /** Seq of the newest successful compaction summary event, -1 when none. */
  lastCompactionSeq: -1,
  /** Seq of the newest `compaction/start` seen, -1 when none. */
  lastStartSeq: -1,
  /**
   * Usage-sampled tokens consumed as of the end of the newest completed
   * compaction (`-1` = never compacted).
   *
   * This is the boundary the "extra spend" figure is measured from, and it is
   * sampled per event rather than read from the meter's live total: a compaction
   * immediately issues its own summarization request, so the meter's total keeps
   * growing and subtracting a snapshot of it from itself is identically zero.
   * Counting the usage samples the log actually carries keeps the figure tied to
   * what this conversation demonstrably spent after it was last compacted.
   */
  sampledTokensAtLastCompaction: -1,
})

/** Fold state keys, so the fold can accept extension without surprises. */
const STATE_KEYS = Object.keys(INITIAL_COMPACTION_STATE)

/**
 * Coerce untrusted fold state into a well-formed state.
 * @param state - candidate state (possibly a restored/plain object).
 * @returns a frozen state with every field numeric and non-negative.
 */
export function normalizeCompactionState(state) {
  const source = state !== null && typeof state === 'object' ? state : {}
  const num = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
  const out = {}
  for (const key of STATE_KEYS) out[key] = num(source[key], INITIAL_COMPACTION_STATE[key])
  out.count = Math.max(0, Math.trunc(out.count))
  return Object.freeze(out)
}

/**
 * Read the fields this plugin needs out of one session event.
 *
 * `seq`, `type` and `data.error` are read defensively because a session event
 * crosses plugin boundaries and an unrecognized extension event must degrade
 * to "not ours" rather than throw.
 * @param event - one `session/event` payload.
 * @returns normalized event facts, or undefined when the event is unusable.
 */
export function compactionEventOf(event) {
  if (event === null || typeof event !== 'object') return undefined
  const type = typeof event.type === 'string' ? event.type : undefined
  if (type === undefined) return undefined
  const seq = typeof event.seq === 'number' && Number.isFinite(event.seq) ? event.seq : -1
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const hasError = data.error !== undefined && data.error !== null
  return { type, seq, hasError }
}

/**
 * Whether one event changes the compaction fold at all.
 * @param event - one `session/event` payload.
 * @returns true for the three compaction lifecycle events.
 */
export function isCompactionEvent(event) {
  const parsed = compactionEventOf(event)
  if (parsed === undefined) return false
  return parsed.type === 'compaction/start'
    || parsed.type === 'compaction/end'
    || parsed.type === 'compaction/summary'
}

/**
 * Advance the fold by one event.
 *
 * A failed compaction is recorded as a failure (so the diagnostic can show it)
 * but never increments the count. A `summary` event snapshots the cumulative
 * usage-sampled tokens seen so far, which is what makes "tokens burned since the
 * last compaction" measurable later.
 * @param state - current fold state.
 * @param event - one `session/event` payload.
 * @param sampledTokens - cumulative usage-sampled tokens up to this event.
 * @returns the next state; the same reference when the event is not ours.
 */
export function foldCompaction(state, event, sampledTokens) {
  const parsed = compactionEventOf(event)
  if (parsed === undefined) return state
  const current = normalizeCompactionState(state)
  const tokens = typeof sampledTokens === 'number' && Number.isFinite(sampledTokens)
    ? Math.max(0, sampledTokens)
    : current.sampledTokensAtLastCompaction

  if (parsed.type === 'compaction/start') {
    return Object.freeze({ ...current, lastStartSeq: parsed.seq })
  }
  if (parsed.type === 'compaction/summary') {
    return Object.freeze({
      ...current,
      lastCompactionSeq: parsed.seq,
      // The summary is the content commit point, so the spend seen up to here is
      // the baseline the "extra spend" figure is measured from.
      sampledTokensAtLastCompaction: tokens,
      lastCompactionFailed: false,
    })
  }
  if (parsed.type === 'compaction/end') {
    if (parsed.hasError) return Object.freeze({ ...current, lastCompactionFailed: true })
    return Object.freeze({
      ...current,
      count: current.count + 1,
      // A completed compaction is also a spend boundary: its own summarization
      // request is billed, and that cost belongs to the compaction rather than
      // to the "waste after compaction" figure the reminder reports.
      sampledTokensAtLastCompaction: tokens,
      lastCompactionFailed: false,
    })
  }
  return state
}

/**
 * Sum the token-meter's cumulative usage buckets.
 * @param usage - `ctx.sessionProjections.stateOf(session, 'tokenUsage')`.
 * @returns billed tokens, or undefined when no usage was reported yet.
 */
export function sumBilledTokens(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const totals = usage.totals !== null && typeof usage.totals === 'object' ? usage.totals : usage
  const buckets = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']
  let sum = 0
  let seen = false
  for (const key of buckets) {
    const value = totals[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      seen = true
      sum += Math.max(0, value)
    }
  }
  return seen ? sum : undefined
}

/**
 * Derive the occupancy figures from the token-meter's context-pressure state.
 *
 * The registry exposes host *state*, which carries `pressureTokens`,
 * `surfaceTokens` and `sampledSurfaceTokens` but not the wire view's
 * `projectedTokens`. The projection's own definition is
 * `pressureTokens + (surfaceTokens - sampledSurfaceTokens)`, reproduced here.
 * @param pressure - `ctx.sessionProjections.stateOf(session, 'contextPressure')`.
 * @returns `{ projectedTokens, contextWindow, occupancyRatio }`, each optional.
 */
export function readOccupancy(pressure) {
  if (pressure === null || typeof pressure !== 'object') return {}
  const num = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : undefined)
  const pressureTokens = num(pressure.pressureTokens)
  const surfaceTokens = num(pressure.surfaceTokens)
  const sampled = num(pressure.sampledSurfaceTokens)
  const contextWindow = num(pressure.contextWindow)

  let projectedTokens = pressureTokens
  if (projectedTokens !== undefined && surfaceTokens !== undefined && sampled !== undefined) {
    projectedTokens = Math.max(0, projectedTokens + (surfaceTokens - sampled))
  }
  if (projectedTokens === undefined && surfaceTokens !== undefined) projectedTokens = surfaceTokens

  const occupancyRatio = projectedTokens !== undefined && contextWindow !== undefined && contextWindow > 0
    ? projectedTokens / contextWindow
    : undefined

  return { projectedTokens, contextWindow, occupancyRatio }
}

/**
 * Build the metric bundle the decision reads.
 * @param state - normalized fold state.
 * @param sampledTokens - cumulative usage-sampled tokens the fold has seen, or
 *   undefined when the fold has not sampled any.
 * @param pressure - contextPressure projection state (or undefined).
 * @returns metrics; `dataKnown` reports whether the spend figure is trustworthy.
 */
export function buildMetrics(state, sampledTokens, pressure) {
  const normalized = normalizeCompactionState(state)
  const baseline = normalized.sampledTokensAtLastCompaction
  const tokensSinceCompaction = typeof sampledTokens === 'number' && Number.isFinite(sampledTokens)
    ? Math.max(0, sampledTokens - Math.max(0, baseline))
    : undefined
  const occupancy = readOccupancy(pressure)
  return {
    count: normalized.count,
    lastCompactionSeq: normalized.lastCompactionSeq,
    billedTokens: tokensSinceCompaction === undefined ? undefined : sampledTokens,
    // A session that never compacted has no boundary yet, so the whole session
    // spend counts as "since the last compaction" — which the compaction-count
    // gate then rejects on its own.
    tokensSinceCompaction,
    projectedTokens: occupancy.projectedTokens,
    contextWindow: occupancy.contextWindow,
    occupancyRatio: occupancy.occupancyRatio,
    // Without a single usage sample nothing about spend can be asserted, so the
    // decision must answer "do not warn" rather than guess.
    dataKnown: tokensSinceCompaction !== undefined,
  }
}

/** Occupancy is warned on only when it is both known and at/above the minimum. */
function occupancyTriggers(metrics, config) {
  if (metrics.occupancyRatio === undefined) return false
  return metrics.occupancyRatio * 100 >= config.occupancyPercentMin
}

/**
 * Heavy-spend bypass: a session that burns twice the configured extra-spend
 * budget since its last compaction is expensive regardless of what the
 * (optional) occupancy figure says. Doubling the threshold is deliberate:
 * it is the fallback used when occupancy cannot be computed, so it must be
 * harder to trip than the occupancy rule.
 */
function spendBypassTriggers(metrics, config) {
  if (metrics.tokensSinceCompaction === undefined) return false
  return metrics.tokensSinceCompaction >= config.tokensSinceCompactionMin * 2
}

/**
 * Decide whether to raise the reminder, and why.
 *
 * Three gate families must all hold:
 * 1. enough successfully completed compactions;
 * 2. real extra spend since the last one — the minimum is the "this is not a
 *    short conversation" floor, and it doubles as the bypass threshold for
 *    condition 3;
 * 3. high occupancy, or the doubled-spend bypass for when occupancy cannot be
 *    computed at all.
 *
 * Any missing input answers "do not warn": a reminder this plugin cannot
 * justify from measured data is exactly the false positive it exists to avoid.
 * @param metrics - output of {@link buildMetrics}.
 * @param config - resolved config from `src/schema.js`.
 * @returns decision with machine-readable reasons and the numbers behind them.
 */
export function decideWarning(metrics, config) {
  if (metrics.dataKnown !== true) {
    return { warn: false, reasons: ['no-usage-data'], metrics, gate: 'data' }
  }
  if (metrics.count < config.compactCountMin) {
    return { warn: false, reasons: ['few-compactions'], metrics, gate: 'compactions' }
  }

  const enoughSpend = metrics.tokensSinceCompaction !== undefined
    && metrics.tokensSinceCompaction >= config.tokensSinceCompactionMin
  if (!enoughSpend) {
    return { warn: false, reasons: ['low-extra-spend'], metrics, gate: 'spend' }
  }

  const occupancy = occupancyTriggers(metrics, config)
  const bypass = spendBypassTriggers(metrics, config)
  if (!occupancy && !bypass) {
    // The conversation has been compacted repeatedly but is neither filling the
    // window again nor burning the doubled budget: still not worth interrupting.
    return { warn: false, reasons: ['no-pressure'], metrics, gate: 'pressure' }
  }

  const reasons = ['many-compactions']
  if (occupancy) reasons.push('high-occupancy')
  if (bypass) reasons.push('heavy-extra-spend')
  reasons.push('extra-spend')

  return { warn: true, reasons, metrics, gate: 'warn' }
}
