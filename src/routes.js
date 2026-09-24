/**
 * The plugin's two HTTP routes.
 *
 * Everything the floating window shows is computed on the host: the browser
 * cannot read a session's event log, and the token/occupancy projections live
 * host-side. Both routes are read-only, loopback-fenced, and `no-store`.
 *
 * @module @hjdd14/dsh-toolong-warning/src/routes
 */

import { buildMetrics, decideWarning } from './detect.js'
import { writeJson } from './http.js'
import { isLoopbackRequest } from './loopback.js'
import { applyThresholdOverrides, thresholdsOf } from './schema.js'
import { createTracker } from './state.js'

export const API_PREFIX = '/api/dsh-toolong-warning'

/** Wire dialect marker, so a stale client can be told apart from a stale host. */
export const DIALECT = 'dsh-toolong-warning/1'

/**
 * Incremented whenever this module's contract changes. It rides the health
 * route so a running host can be told apart from a freshly loaded one — which is
 * how the host-side reload (and therefore "is the running process serving the
 * code I just wrote?") is verified, since host ESM does not hot-reload.
 */
export const MODULE_GENERATION = 10

/**
 * Read one session's compaction state and the metrics the decision reads.
 * @param deps - tracker, session lookup, projection registry, occupancy reader.
 * @param session - the live Session.
 * @returns metric bundle plus fold diagnostics.
 */
function collect(deps, session) {
  const folded = deps.tracker.stateFor(session)
  let pressure
  try {
    pressure = deps.projections?.stateOf(session, 'contextPressure')
  } catch (error) {
    deps.log?.warn?.(`[toolong-warning] projection read failed: ${String(error)}`)
  }
  // Both spend figures come from the fold's own usage sampling. The meter's live
  // total is deliberately not used: it includes the compaction's summarization
  // request, so subtracting a snapshot of it from itself is identically zero —
  // the bug this design exists to avoid.
  //
  // `sampledTokens` is the cumulative log-sampled total; `buildMetrics` subtracts
  // the fold's post-compaction boundary from it. Passing the difference instead
  // would double-subtract the baseline and produce zero.
  const metrics = {
    ...buildMetrics(folded.state, folded.sampledTokens, pressure),
    dataKnown: folded.spendSinceLastCompaction !== undefined,
  }
  return { metrics, folded }
}

/**
 * A content-free summary of what the fold saw in one session's log.
 *
 * Added so the counter can be checked against the durable record instead of
 * trusted: it reports event-type counts and the compaction lifecycle, but never
 * message content. It also reports both read paths — the snapshot array the fold
 * uses and a positional walk — because on a real session the positional walk
 * returns `undefined` for positions the snapshot contains, which is exactly the
 * kind of silent under-count this plugin must not have. Requested with
 * `?debug=1`.
 * @param session - the live Session.
 * @param state - the folded compaction state.
 * @returns counts plus the compaction lifecycle it observed.
 */
function debugSummary(session, state) {
  const summary = { seq: typeof session.seq === 'number' ? session.seq : 0, eventTypes: {}, compactions: [] }
  const end = summary.seq
  for (let seq = 0; seq < end; seq += 1) {
    let event
    try {
      event = session.eventAt(seq)
    } catch {
      summary.gapAt = seq
      break
    }
    if (event === undefined || event === null) {
      summary.positionalUnreadable = (summary.positionalUnreadable ?? 0) + 1
      continue
    }
    const type = typeof event.type === 'string' ? event.type : 'unknown'
    summary.eventTypes[type] = (summary.eventTypes[type] ?? 0) + 1
    if (type === 'compaction/start' || type === 'compaction/end' || type === 'compaction/summary') {
      summary.compactions.push({
        seq,
        type,
        compactionId: event.data?.compactionId,
        sourceCommandId: event.data?.sourceCommandId,
        failed: event.data?.error !== undefined && event.data?.error !== null,
      })
    }
  }
  // The read path the fold actually uses, for comparison with the walk above.
  try {
    const snapshot = session.snapshotEvents()
    summary.snapshotLength = snapshot.length
    summary.snapshotCompactions = snapshot.filter((event) => typeof event?.type === 'string' && event.type.startsWith('compaction/')).length
  } catch (error) {
    summary.snapshotError = String(error)
  }
  summary.folded = state
  return summary
}

/**
 * Build the state-route body for either source.
 *
 * Both the live fold and the history fold produce the same metric vocabulary, so
 * they share this builder — that is what keeps the two paths comparable instead
 * of drifting into two different answers for the same question.
 * @param metrics - metric bundle (live or history).
 * @param folded - fold diagnostics.
 * @param sessionId - the session being reported.
 * @param thresholds - effective decision thresholds.
 * @param effective - override resolution result.
 * @param config - effective config (for the decision).
 * @param deps - route dependencies.
 * @param source - 'live' or 'history'.
 * @returns the JSON body.
 */
function buildStateBody(metrics, folded, sessionId, thresholds, effective, config, deps, source) {
  const decision = decideWarning(metrics, config)
  return {
    ok: true,
    dialect: DIALECT,
    sessionId,
    known: true,
    source,
    count: metrics.count,
    lastCompactionSeq: metrics.lastCompactionSeq,
    tokensSinceCompaction: metrics.tokensSinceCompaction,
    billedTokens: metrics.billedTokens,
    sampledEvents: folded.sampledEvents,
    projectedTokens: metrics.projectedTokens,
    contextWindow: metrics.contextWindow,
    occupancyRatio: metrics.occupancyRatio,
    shouldWarn: decision.warn,
    reasons: decision.reasons,
    gate: decision.gate,
    thresholds,
    thresholdsSource: effective.overridden ? 'browser-override' : 'profile',
    ...(effective.rejected.length === 0 ? {} : { rejectedOverrides: effective.rejected }),
    configVersion: deps.configVersion(),
    ...(folded.seededThrough === undefined ? {} : { seededThrough: folded.seededThrough }),
    ...(folded.droppedEvents === undefined ? {} : { droppedEvents: folded.droppedEvents }),
    sessionsTracked: deps.tracker.size(),
    ...(deps.coldReader === undefined ? {} : { coldReads: deps.coldReader.stats().reads }),
  }
}

/**
 * Build the state route factory.
 * @param deps - resolved config getter, tracker, session lookup, projections.
 * @returns a `WebRoute`.
 */
export function makeStateRoute(deps) {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(res, 405, { ok: false, error: 'method not allowed', dialect: DIALECT })
        return
      }
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only', dialect: DIALECT })
        return
      }

      const url = new URL(req.url ?? '/', 'http://localhost')
      const sessionId = url.searchParams.get('sessionId') ?? ''
      // Browser-supplied threshold overrides (see applyThresholdOverrides): the
      // Settings form is read-only on a non-loopback page by DSH's own design, so
      // the browser may carry its own bounded values here. Clamped per request;
      // nothing is persisted.
      const base = deps.getConfig()
      const effective = applyThresholdOverrides(base, (name) => url.searchParams.get(name))
      const config = effective.config
      const thresholds = thresholdsOf(config)

      if (sessionId === '') {
        writeJson(res, 200, {
          ok: true,
          dialect: DIALECT,
          known: false,
          reason: 'missing-session-id',
          thresholds,
          thresholdsSource: effective.overridden ? 'browser-override' : 'profile',
        })
        return
      }
      if (config.enabled !== true) {
        writeJson(res, 200, {
          ok: true,
          dialect: DIALECT,
          sessionId,
          known: false,
          reason: 'disabled',
          thresholds,
          thresholdsSource: effective.overridden ? 'browser-override' : 'profile',
        })
        return
      }

      let session
      try {
        session = deps.sessions.get(sessionId)
      } catch (error) {
        deps.log?.warn?.(`[toolong-warning] session lookup failed for ${sessionId}: ${String(error)}`)
        session = undefined
      }

      // Source 1: a session live in this process — full live metrics.
      if (session !== undefined && session !== null) {
        let collected
        try {
          collected = collect(deps, session)
        } catch (error) {
          deps.log?.warn?.(`[toolong-warning] state collection failed for ${sessionId}: ${String(error)}`)
          writeJson(res, 500, { ok: false, error: 'state collection failed', dialect: DIALECT })
          return
        }

        const { metrics, folded } = collected
        writeJson(res, 200, {
          ...buildStateBody(metrics, folded, sessionId, thresholds, effective, config, deps, 'live'),
          ...(url.searchParams.get('debug') === '1'
            ? { debug: debugSummary(session, folded.state) }
            : {}),
        })
        return
      }

      // Source 2: the host has not loaded this session, but its durable log is
      // still authoritative for the compaction count. Switching conversations
      // used to leave the counter blank until the page was reloaded, because
      // only source 1 existed.
      if (deps.coldReader !== undefined) {
        const history = await deps.coldReader.read(sessionId)
        if (history !== undefined) {
          writeJson(res, 200, buildStateBody(history, { sampledEvents: history.sampledEvents, seededThrough: undefined, droppedEvents: undefined }, sessionId, thresholds, effective, config, deps, 'history'))
          return
        }
      }

      // Source 3: nothing to measure. Say which of the two reasons applies
      // rather than inventing a zero that would read as "this conversation is fine".
      writeJson(res, 200, {
        ok: true,
        dialect: DIALECT,
        sessionId,
        known: false,
        reason: deps.coldReader === undefined ? 'session-not-loaded' : 'history-unavailable',
        thresholds,
        thresholdsSource: effective.overridden ? 'browser-override' : 'profile',
        sessionsTracked: deps.tracker.size(),
      })
    },
  }
}

/**
 * Run the live state route against a synthetic session and compare the result
 * with hand-computed expectations.
 *
 * A host plugin's ESM module does not hot-reload (only client bundles do), so a
 * running process can keep serving an older generation of this file. This makes
 * the shipped behaviour observable from outside: `?selftest=1` on the health
 * route drives the real `makeStateRoute` handler, through the real tracker and
 * the real decision, and reports any field that disagrees. Nothing here touches
 * a user session.
 * @param deps - the same deps the live routes use.
 * @returns `{ pass, checks, mismatches }`.
 */
function runSelfTest(deps) {
  const events = [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 900000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { seq: 2, type: 'compaction/start', data: { compactionId: 'self-1' } },
    { seq: 3, type: 'compaction/summary', data: { compactionId: 'self-1' } },
    { seq: 4, type: 'compaction/end', data: { compactionId: 'self-1' } },
    { seq: 5, type: 'compaction/start', data: { compactionId: 'self-2' } },
    { seq: 6, type: 'compaction/summary', data: { compactionId: 'self-2' } },
    { seq: 7, type: 'compaction/end', data: { compactionId: 'self-2' } },
    // 300k after the newest completed compaction: over a 200k threshold.
    { seq: 8, type: 'assistant/message', data: { usage: { inputTokens: 300000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ]
  const session = {
    id: 'toolong-warning-selftest',
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
    eventAt: (seq) => events[seq],
  }
  const config = {
    ...deps.getConfig(),
    enabled: true,
    compactCountMin: 2,
    occupancyPercentMin: 50,
    tokensSinceCompactionMin: 200000,
  }
  const selfDeps = {
    ...deps,
    getConfig: () => config,
    // A dedicated tracker: reusing the live one would let a synthetic session
    // show up in the real one's counts.
    tracker: createTracker({ logger: deps.log ?? { warn() {}, info() {} }, on() {} }),
    sessions: { get: (id) => (id === session.id ? session : undefined) },
    // The synthetic Session has no projection cell of its own, so the occupancy
    // reader is supplied directly — it is the one host-global input here.
    projections: {
      stateOf: (_session, key) => (key === 'contextPressure'
        ? { pressureTokens: 900000, surfaceTokens: 900000, sampledSurfaceTokens: 900000, contextWindow: 1000000 }
        : undefined),
    },
  }
  const captured = { status: undefined, body: undefined }
  return makeStateRoute(selfDeps).handler(
    {
      url: `/api/dsh-toolong-warning/state?sessionId=${session.id}`,
      method: 'GET',
      headers: { host: '127.0.0.1:3080' },
      socket: { remoteAddress: '127.0.0.1' },
    },
    {
      writeHead(status) {
        captured.status = status
      },
      end(payload) {
        captured.body = JSON.parse(payload)
      },
    },
  ).then(() => {
    const expected = {
      status: 200,
      count: 2,
      lastCompactionSeq: 6,
      tokensSinceCompaction: 300000,
      billedTokens: 1200000,
      shouldWarn: true,
    }
    const actual = {
      status: captured.status,
      count: captured.body?.count,
      lastCompactionSeq: captured.body?.lastCompactionSeq,
      tokensSinceCompaction: captured.body?.tokensSinceCompaction,
      billedTokens: captured.body?.billedTokens,
      shouldWarn: captured.body?.shouldWarn,
    }
    const mismatches = Object.keys(expected)
      .filter((key) => expected[key] !== actual[key])
      .map((key) => `${key}: expected ${String(expected[key])}, got ${String(actual[key])}`)
    return { pass: mismatches.length === 0, checks: actual, mismatches, source: captured.body?.source }
  }, (error) => ({ pass: false, checks: captured.body, mismatches: [`self-test threw: ${String(error)}`] }))
}

/**
 * Self-check the history (cold-read) path.
 *
 * Two things must hold, and a live process is the only place they can be proven:
 * 1. the history fold and the live fold report the **same count** for the same
 *    session — otherwise the window could show one number while the host decided
 *    on another;
 * 2. a second read inside the cache window does not touch the log again, so
 *    polling an idle conversation cannot hammer the disk.
 *
 * @param deps - live dependencies, including the cold reader and the tracker.
 * @returns a pass/fail record.
 */
async function runHistorySelfTest(deps) {
  if (deps.coldReader === undefined) {
    return { pass: true, skipped: 'session-query unavailable; the history source is absent in this composition' }
  }
  const live = deps.liveSessionsForSelfTest?.() ?? []
  if (live.length === 0) {
    return { pass: true, skipped: 'no live session to compare against yet' }
  }

  const comparisons = []
  for (const entry of live) {
    // Deliberately a FRESH read. The reader caches results for its revalidation
    // window by design, so comparing a live count against a possibly-cached one
    // compares two different moments and reports a phantom disagreement — which
    // is exactly what happened the first time this ran against a session that had
    // just compacted (live 2, cached history 1). A cache hit is not a bug, so the
    // comparison must not be able to mistake one for a mismatch.
    const result = await deps.coldReader.read(entry.id, { fresh: true })
    if (result === undefined) {
      comparisons.push({ id: entry.id, historyAvailable: false })
      continue
    }
    comparisons.push({
      id: entry.id,
      historyAvailable: true,
      liveCount: entry.count,
      historyCount: result.count,
      agree: entry.count === result.count,
    })
  }
  const disagreeing = comparisons.filter((row) => row.historyAvailable === true && row.agree !== true)
  // The cache is verified separately, on its own terms: a plain second read
  // inside the window must not touch the log again.
  const readBefore = deps.coldReader.stats().reads
  await deps.coldReader.read(live[0].id)
  const cacheServedSecondRead = deps.coldReader.stats().reads === readBefore

  const mismatches = [
    ...disagreeing.map((row) => `${row.id}: live count ${String(row.liveCount)} vs history count ${String(row.historyCount)}`),
    ...(cacheServedSecondRead ? [] : ['a second read inside the cache window hit the log again']),
  ]
  return {
    pass: mismatches.length === 0,
    checks: { comparisons, cacheServedSecondRead, comparedFresh: true, stats: deps.coldReader.stats() },
    mismatches,
  }
}

/**
 * Build the health route: a cheap probe that proves the row loaded, shows the
 * effective thresholds, and — with `?selftest=1` — runs {@link runSelfTest}.
 * @param deps - resolved config getter, tracker, descriptors.
 * @returns a `WebRoute`.
 */
export function makeHealthRoute(deps) {
  return {
    kind: 'exact',
    path: `${API_PREFIX}/health`,
    handler: async (req, res) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        writeJson(res, 405, { ok: false, error: 'method not allowed', dialect: DIALECT })
        return
      }
      if (!isLoopbackRequest(req)) {
        writeJson(res, 403, { ok: false, error: 'forbidden: loopback-only', dialect: DIALECT })
        return
      }
      const config = deps.getConfig()
      const url = new URL(req.url ?? '/', 'http://localhost')
      const selfTest = url.searchParams.get('selftest') === '1' ? await runSelfTest(deps) : undefined
      const historySelfTest = url.searchParams.get('selftest') === '1' ? await runHistorySelfTest(deps) : undefined
      writeJson(res, 200, {
        ok: true,
        dialect: DIALECT,
        moduleGeneration: MODULE_GENERATION,
        name: '@hjdd14/dsh-toolong-warning',
        enabled: config.enabled,
        thresholds: thresholdsOf(config),
        fields: deps.descriptors(),
        configVersion: deps.configVersion(),
        sessionsTracked: deps.tracker.size(),
        historyReadsAvailable: deps.coldReader !== undefined,
        ...(deps.coldReader === undefined ? {} : { coldReadStats: deps.coldReader.stats() }),
        ...(selfTest === undefined ? {} : { selfTest }),
        ...(historySelfTest === undefined ? {} : { historySelfTest }),
      })
    },
  }
}
