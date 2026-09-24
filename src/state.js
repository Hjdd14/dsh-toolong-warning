/**
 * Per-session compaction fold, maintained on the host.
 *
 * The browser cannot read a session's event log (the client only sees the
 * session catalog), so the counting has to happen here and be served over the
 * plugin's own loopback route. The fold is driven two ways:
 *
 * - **live** — `ctx.on('session/event', …)` advances it as events commit;
 * - **seed** — the first time a session is asked about, its existing log is
 *   replayed once (`session.seq` / `session.eventAt`) so a conversation that
 *   was already long before this plugin loaded is counted correctly, instead of
 *   starting from zero and staying silent.
 *
 * Replay reads deprecated synchronous accessors on purpose: the documented
 * replacements (`snapshotEvents`) materialize a frozen copy of a whole log,
 * while this fold only needs each event once, in order, and then keeps a
 * 4-number state.
 *
 * @module @hjdd14/dsh-toolong-warning/src/state
 */

import {
  INITIAL_COMPACTION_STATE,
  foldCompaction,
  isCompactionEvent,
  normalizeCompactionState,
  sumBilledTokens,
} from './detect.js'

/** Bucket names carried by a provider usage sample. */
const USAGE_BUCKETS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens']

/**
 * Total billed tokens in one provider usage sample.
 * @param usage - a provider usage object.
 * @returns the sample's billed tokens, or 0 when unusable.
 */
export function sampleTokens(usage) {
  if (usage === null || typeof usage !== 'object') return 0
  let sum = 0
  for (const key of USAGE_BUCKETS) {
    const value = usage[key]
    if (typeof value === 'number' && Number.isFinite(value)) sum += Math.max(0, value)
  }
  return sum
}

/**
 * Find the last `usage` chunk inside an assistant stream.
 *
 * The stream is a provider-owned structure, so this walks it defensively
 * instead of importing `@deepseek-ai/dsh-llm` (which would add a runtime
 * dependency to a plugin that must load from the dsh installation's own
 * resolution context).
 * @param root - the `event.data.stream` value.
 * @returns the usage object, or undefined when the stream carries none.
 */
export function findStreamUsage(root) {
  if (root === null || typeof root !== 'object') return undefined
  let found
  const visit = (node, depth) => {
    if (node === null || typeof node !== 'object' || depth > 6) return
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (node.type === 'usage' && node.usage !== null && typeof node.usage === 'object') found = node.usage
    for (const key of Object.keys(node)) visit(node[key], depth + 1)
  }
  visit(root, 0)
  return found
}

/**
 * The usage one durable assistant settlement reports for its attempt.
 *
 * Mirrors the token-meter's own rule: a top-level `data.usage`, otherwise the
 * last embedded usage chunk; `assistant/message` and `assistant/attempt` only.
 * @param event - one session event.
 * @returns the usage object, or undefined.
 */
export function usageOf(event) {
  if (event === null || typeof event !== 'object') return undefined
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  if (data.usage !== undefined && data.usage !== null && typeof data.usage === 'object') return data.usage
  return findStreamUsage(data.stream)
}

/**
 * Read a session's committed events.
 *
 * Uses `snapshotEvents()`, whose returned array is the contiguous log: a live
 * session's positional walk (`eventAt(i)` for `i < session.seq`) returns
 * `undefined` for some positions even though the committed log has no holes —
 * observed on a real session during verification, where a positional walk lost
 * ~1.3% of events per pass while the projection registry folded the full log
 * without complaint. Reading the snapshot and slicing it gives the same events
 * without that hazard.
 *
 * The returned array is validated for length rather than trusted blindly, so a
 * shorter-than-declared log is reported instead of silently under-counted.
 * @param session - a live Session.
 * @param fromSeq - first position to read, inclusive.
 * @returns `{ events, expected }` — events from `fromSeq` on, and how many the
 *   session's own sequence contract says that range should contain.
 */
function readLog(session, fromSeq) {
  const declared = typeof session.seq === 'number' ? session.seq : 0
  const from = Math.max(0, fromSeq)
  if (declared <= from) return { events: [], expected: 0 }
  if (typeof session.snapshotEvents !== 'function') return { events: [], expected: declared - from }
  let all
  try {
    all = session.snapshotEvents()
  } catch {
    return { events: [], expected: declared - from }
  }
  const events = from === 0 ? all : all.slice(from)
  return { events, expected: declared - from }
}

/** One session's folded bookkeeping plus its seed watermark. */
function createEntry() {
  return {
    state: INITIAL_COMPACTION_STATE,
    // Highest seq folded so far; -1 means nothing yet, so the first seed starts
    // at 0. A live fold sets it to the event it folded, which is what keeps the
    // next seed from folding that same event a second time.
    seededThrough: -1,
    droppedEvents: 0,
    // Running provider-usage total across the events already folded. Carried on
    // the entry so a later incremental fold can resume the total instead of
    // restarting at zero — a compaction marker must snapshot the spend that
    // really preceded it, whichever call folded it.
    cumulativeUsage: 0,
    /** How many events contributed a usage sample; 0 means spend is unknown. */
    sampledEvents: 0,
  }
}

/**
 * Start tracking: subscribe to the append feed and to session disposal.
 * @param ctx - the host plugin context.
 * @returns the runtime handle the routes read.
 */
export function createTracker(ctx) {
  /** @type {Map<string, ReturnType<typeof createEntry>>} */
  const entries = new Map()
  const log = ctx.logger !== undefined ? ctx.logger : console

  ctx.on('session/event', (session, event) => {
    let entry = entries.get(session.id)
    if (entry === undefined) {
      entry = createEntry()
      entries.set(session.id, entry)
    }
    if (!isCompactionEvent(event)) return
    const seq = typeof event.seq === 'number' ? event.seq : session.seq
    // Fold everything committed strictly before this append, then the event
    // itself.
    //
    // The bound is the event's own seq, because `seed`'s `untilSeq` is exclusive
    // and `session.seq` is the log LENGTH. When the arriving event is the last
    // committed one those two numbers are equal, so a seed bounded by the log
    // length swallowed the event as well and the handler folded it a second time:
    // one completed compaction counted as two, and every redelivery added another.
    seed(entry, session, seq)
    if (seq > entry.seededThrough) {
      // Same ordering as the seed loop: this event's own usage sample must not be
      // inside the baseline a compaction marker is about to snapshot.
      entry.state = foldCompaction(entry.state, event, entry.cumulativeUsage)
      entry.seededThrough = seq
    }
    const usage = usageOf(event)
    if (usage !== undefined) {
      entry.cumulativeUsage += sampleTokens(usage)
      entry.sampledEvents += 1
    }
  })

  ctx.on('session/disposed', (session) => {
    entries.delete(session.id)
  })

  /**
   * Fold every event committed before `untilSeq` that has not been folded yet.
   * @param entry - the session's bookkeeping.
   * @param session - the live Session.
   * @param untilSeq - exclusive upper bound; defaults to the whole log.
   */
  function seed(entry, session, untilSeq) {
    const logLength = typeof session.seq === 'number' ? session.seq : 0
    const end = untilSeq === undefined ? logLength : Math.min(untilSeq, logLength)
    const from = entry.seededThrough + 1
    if (end <= from) return
    const { events, expected } = readLog(session, from)
    let cumulativeUsage = entry.cumulativeUsage
    let sampledEvents = entry.sampledEvents
    for (const event of events) {
      // Fold the compaction marker against the spend that preceded it, then add
      // this event's own sample — the summary event itself must not inflate the
      // baseline it snapshots.
      if (isCompactionEvent(event)) {
        entry.state = foldCompaction(entry.state, event, cumulativeUsage)
      }
      const usage = usageOf(event)
      if (usage !== undefined) {
        cumulativeUsage += sampleTokens(usage)
        sampledEvents += 1
      }
    }
    entry.cumulativeUsage = cumulativeUsage
    entry.sampledEvents = sampledEvents
    // A contiguous log yields exactly `expected` events; anything short means a
    // position could not be read, which is worth surfacing rather than hiding.
    // The watermark only advances over events that were really folded, so a gap
    // leaves the missing position to be retried instead of silently skipped.
    // The shortfall is recorded, not accumulated: re-attempting a permanent gap
    // on every read must not inflate the number.
    entry.droppedEvents = Math.max(entry.droppedEvents, expected - events.length)
    entry.seededThrough = events.length === 0 ? entry.seededThrough : from + events.length - 1
  }

  /**
   * Cumulative billed tokens the token-meter projection reports right now.
   * @param ctx - host context.
   * @param session - the live Session.
   * @returns billed tokens, or undefined when the projection is unavailable.
   */
  function currentBilledTokens(ctx2, session) {
    try {
      const state = ctx2.sessionProjections?.stateOf(session, 'tokenUsage')
      if (state === undefined) return undefined
      // Same bucket sum the decision uses, so the baseline snapshotted at a
      // compaction and the figure compared against it can never disagree.
      return sumBilledTokens(state.totals ?? state)
    } catch (error) {
      log.warn?.(`[toolong-warning] tokenUsage projection read failed: ${String(error)}`)
      return undefined
    }
  }

  return {
    /**
     * State for one session, seeding it first when necessary.
     * @param session - the live Session.
     * @returns normalized state plus the fold's own sampled-token total and seed
     *   diagnostics.
     */
    stateFor(session) {
      let entry = entries.get(session.id)
      if (entry === undefined) {
        entry = createEntry()
        entries.set(session.id, entry)
      }
      seed(entry, session)
      const baseline = entry.state.sampledTokensAtLastCompaction
      return {
        state: normalizeCompactionState(entry.state),
        // Spend strictly after the newest completed compaction. `undefined` until
        // at least one usage sample exists, so "no data" is never mistaken for
        // "no spend"; with no compaction yet the whole session spend counts,
        // which the compaction-count gate then rejects.
        spendSinceLastCompaction: entry.sampledEvents > 0
          ? Math.max(0, entry.cumulativeUsage - Math.max(0, baseline))
          : undefined,
        sampledTokens: entry.cumulativeUsage,
        sampledEvents: entry.sampledEvents,
        seededThrough: entry.seededThrough,
        droppedEvents: entry.droppedEvents,
      }
    },
    /** Cumulative billed tokens for one session, from the token meter. */
    billedTokensFor(session) {
      return currentBilledTokens(ctx, session)
    },
    /** How many sessions are currently tracked (health route). */
    size() {
      return entries.size
    },
    /** Drop every entry; used on teardown. */
    clear() {
      entries.clear()
    },
  }
}
