/**
 * Integration tests for the host route assembly.
 *
 * Run with: node scripts/test-routes.mjs
 *
 * `test-detect.mjs` covers the rules; this file covers the parts that only show
 * up once a real HTTP request flows through the assembled plugin: the loopback
 * fence, the 405/403/400 paths, and — most importantly — that the seeded count
 * matches the durable log. The session-`seq` off-by-one found during live
 * verification is pinned here: `session.seq` is the NEXT sequence number, so a
 * log of N events reports `seq === N`.
 */

import { makeHealthRoute, makeStateRoute } from '../src/routes.js'
import { createColdReader } from '../src/coldread.js'
import { resolveConfig } from '../src/schema.js'
import { createTracker } from '../src/state.js'

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

// ---------------------------------------------------------------------------
section('session seq contract')
// ---------------------------------------------------------------------------
{
  /** A log of N events: `seq` is N (the next free slot), not N-1. */
  function sessionOf(id, events) {
    return {
      id,
      seq: events.length,
      // Mirrors the real Session: the snapshot array IS the contiguous log,
      // while the positional walk is the deprecated accessor.
      snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
      eventAt: (seq) => events[seq],
    }
  }

  const events = [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'compaction/start', data: { compactionId: 'c1' } },
    { seq: 2, type: 'compaction/summary', data: { compactionId: 'c1' } },
    { seq: 3, type: 'compaction/end', data: { compactionId: 'c1' } },
  ]
  const session = sessionOf('s1', events)
  check('seq is the log length', session.seq, 4)
  check('the last event is readable at seq - 1', session.eventAt(session.seq - 1).type, 'compaction/end')
  check('reading at seq is out of range', session.eventAt(session.seq), undefined)

  const ctx = {
    logger: { warn() {}, info() {} },
    on() {},
    sessionProjections: { stateOf: () => undefined },
  }
  const tracker = createTracker(ctx)
  const folded = tracker.stateFor(session)
  check('seeding reads the whole log', folded.state.count, 1)
  check('seeded watermark equals the highest folded seq', folded.seededThrough, 3)
  check('a contiguous log drops nothing', folded.droppedEvents, 0)

  // A fresh tracker over a 0-event session must not invent a seed.
  const empty = sessionOf('s2', [])
  const emptyFolded = createTracker(ctx).stateFor(empty)
  check('an empty log seeds nothing', emptyFolded.seededThrough, -1)
  check('an empty log counts zero', emptyFolded.state.count, 0)
}

// ---------------------------------------------------------------------------
section('route assembly against the fake session')
// ---------------------------------------------------------------------------
{
  const events = [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 1000000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { seq: 2, type: 'compaction/start', data: { compactionId: 'c1' } },
    { seq: 3, type: 'compaction/summary', data: { compactionId: 'c1' } },
    { seq: 4, type: 'compaction/end', data: { compactionId: 'c1' } },
    { seq: 5, type: 'assistant/message', data: { usage: { inputTokens: 1500000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { seq: 6, type: 'compaction/start', data: { compactionId: 'c2' } },
    { seq: 7, type: 'compaction/summary', data: { compactionId: 'c2' } },
    { seq: 8, type: 'compaction/end', data: { compactionId: 'c2' } },
    // Spend that lands after the newest completed compaction — the figure the
    // reminder is about.
    { seq: 9, type: 'assistant/message', data: { usage: { inputTokens: 200000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
  ]
  const session = {
    id: 'live-1',
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
    eventAt: (seq) => events[seq],
  }
  const listeners = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    // The live meter reports a slightly larger total than the log samples
    // (2.7M); the decision must use the log figure, not this one.
    sessionProjections: {
      stateOf(_session, key) {
        if (key === 'tokenUsage') {
          return { totals: { uncachedInputTokens: 2800000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
        }
        if (key === 'contextPressure') {
          return { pressureTokens: 900000, surfaceTokens: 900000, sampledSurfaceTokens: 900000, contextWindow: 1000000 }
        }
        return undefined
      },
    },
  }

  const tracker = createTracker(ctx)
  const config = resolveConfig({ compactCountMin: 2, occupancyPercentMin: 50, tokensSinceCompactionMin: 200000 }).config
  const deps = {
    getConfig: () => config,
    configVersion: () => 3,
    tracker,
    descriptors: () => [{ name: 'compactCountMin' }],
    sessions: { get: (id) => (id === 'live-1' ? session : undefined) },
    projections: ctx.sessionProjections,
    log: ctx.logger,
  }

  /** Invoke one route handler and capture the response. */
  async function call(route, { url = '/', method = 'GET', headers = {}, remote = '127.0.0.1' } = {}) {
    const captured = { status: undefined, body: undefined, headers: undefined }
    const req = {
      url,
      method,
      headers: { host: '127.0.0.1:3080', ...headers },
      socket: { remoteAddress: remote },
    }
    const res = {
      writeHead(status, responseHeaders) {
        captured.status = status
        captured.headers = responseHeaders
      },
      end(payload) {
        captured.body = JSON.parse(payload)
      },
    }
    await route.handler(req, res)
    return captured
  }

  const stateRoute = makeStateRoute(deps)
  const healthRoute = makeHealthRoute(deps)

  const ok = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1' })
  check('the state route answers 200', ok.status, 200)
  check('the count matches the log', ok.body.count, 2)
  check('extra spend is measured after the newest compaction', ok.body.tokensSinceCompaction, 200000)
  check('total sampled spend is the whole log', ok.body.billedTokens, 2700000)
  check('the live meter total is deliberately not used', ok.body.billedTokens === 2800000, false)
  check('occupancy is the projected prompt over capacity', Math.round(ok.body.occupancyRatio * 100) / 100, 0.9)
  check('two compactions at 90% occupancy warns', ok.body.shouldWarn, true)
  check('the warning names its grounds', ok.body.reasons.includes('many-compactions') && ok.body.reasons.includes('high-occupancy'), true)
  check('thresholds are echoed for the client', ok.body.thresholds.compactCountMin, 2)
  check('the config revision is exposed', ok.body.configVersion, 3)
  check('responses are never cached', ok.headers['cache-control'], 'no-store')

  const unknown = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=nope' })
  check('an unloaded session answers 200 but unknown', unknown.status, 200)
  check('and does not warn', unknown.body.shouldWarn, undefined)
  check('and says why', unknown.body.reason, 'session-not-loaded')

  const missing = await call(stateRoute, { url: '/api/dsh-toolong-warning/state' })
  check('a missing session id is reported, not guessed', missing.body.reason, 'missing-session-id')

  const lan = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', remote: '192.168.1.9' })
  check('a non-loopback socket is refused', lan.status, 403)

  const crossSite = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', headers: { 'sec-fetch-site': 'cross-site' } })
  check('a cross-site browser request is refused', crossSite.status, 403)

  const rebound = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', headers: { host: 'evil.example.com' } })
  check('a non-loopback Host is refused', rebound.status, 403)

  const wrongOrigin = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', headers: { origin: 'http://evil.example.com' } })
  check('a foreign Origin is refused', wrongOrigin.status, 403)

  const sameOrigin = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', headers: { origin: 'http://127.0.0.1:3080' } })
  check('the page own origin is accepted', sameOrigin.status, 200)

  const posted = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1', method: 'POST' })
  check('the route is read-only', posted.status, 405)

  const debugged = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1&debug=1' })
  check('debug is opt-in', debugged.body.debug === undefined, false)
  check('debug reports the log length', debugged.body.debug.seq, 10)
  check('debug reports every compaction lifecycle event', debugged.body.debug.compactions.length, 6)
  check('both read paths agree on the log length', debugged.body.debug.snapshotLength, 10)
  check('debug exposes no message content', JSON.stringify(debugged.body.debug).includes('"content"'), false)

  const plain = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1' })
  check('debug is absent without the flag', plain.body.debug, undefined)
  check('a request without overrides reports the profile source', plain.body.thresholdsSource, 'profile')

  // Browser-carried threshold overrides: DSH keeps the settings form read-only on
  // a non-loopback page, so the browser must be able to carry its own bounded
  // values. They are validated here and never persisted.
  const overridden = await call(stateRoute, {
    url: '/api/dsh-toolong-warning/state?sessionId=live-1&compactCountMin=5&occupancyPercentMin=80',
  })
  check('a valid override is applied', overridden.body.thresholds.compactCountMin, 5)
  check('and the other override too', overridden.body.thresholds.occupancyPercentMin, 80)
  check('an untouched threshold keeps the profile value', overridden.body.thresholds.tokensSinceCompactionMin, 200000)
  check('the override source is reported', overridden.body.thresholdsSource, 'browser-override')
  check('the decision follows the override', overridden.body.shouldWarn, false)

  const abusive = await call(stateRoute, {
    url: '/api/dsh-toolong-warning/state?sessionId=live-1&compactCountMin=0&occupancyPercentMin=999&tokensSinceCompactionMin=abc',
  })
  check('a too-small override is ignored', abusive.body.thresholds.compactCountMin, 2)
  check('a too-large override is ignored', abusive.body.thresholds.occupancyPercentMin, 50)
  check('a non-numeric override is ignored', abusive.body.thresholds.tokensSinceCompactionMin, 200000)
  check('and each rejection is reported', abusive.body.rejectedOverrides.length, 3)
  check('an ignored override does not switch the source', abusive.body.thresholdsSource, 'profile')
  check('so the decision is unchanged', abusive.body.shouldWarn, true)

  const stricter = await call(stateRoute, {
    url: '/api/dsh-toolong-warning/state?sessionId=live-1&tokensSinceCompactionMin=5000000&occupancyPercentMin=95',
  })
  check('a stricter occupancy override is applied', stricter.body.thresholds.occupancyPercentMin, 95)
  check('a stricter spend override is applied', stricter.body.thresholds.tokensSinceCompactionMin, 5000000)
  check('and together they silence an otherwise-firing reminder', stricter.body.shouldWarn, false)
  check('and the source is the browser override', stricter.body.thresholdsSource, 'browser-override')

  const health = await call(healthRoute, {})
  check('health answers 200', health.status, 200)
  check('health is ok', health.body.ok, true)
  check('health reports the tracked session count', health.body.sessionsTracked, 1)
  check('health reports a module generation', typeof health.body.moduleGeneration, 'number')
  check('health is quiet without the self-test flag', health.body.selfTest, undefined)

  const selfTest = await call(healthRoute, { url: '/api/dsh-toolong-warning/health?selftest=1' })
  check('the live route self-test passes', selfTest.body.selfTest.pass, true)
  check('the self-test finds no mismatches', selfTest.body.selfTest.mismatches, [])
  check('the self-test exercises the decision end to end', selfTest.body.selfTest.checks.shouldWarn, true)
  check('the self-test counts two compactions', selfTest.body.selfTest.checks.count, 2)

  const healthLan = await call(healthRoute, { remote: '10.0.0.4' })
  check('health is fenced too', healthLan.status, 403)
  // A live append after the first read must keep counting exactly once. The
  // real Session pushes the event and then reports `seq = log.length`, so the
  // harness maintains the same invariant.
  const append = listeners.get('session/event')[0]
  const liveAppend = (event) => {
    events.push(event)
    session.seq = events.length
    append(session, event)
  }
  liveAppend({ seq: 10, type: 'compaction/start', data: { compactionId: 'c3' } })
  liveAppend({ seq: 11, type: 'compaction/summary', data: { compactionId: 'c3' } })
  liveAppend({ seq: 12, type: 'compaction/end', data: { compactionId: 'c3' } })
  const after = await call(stateRoute, { url: '/api/dsh-toolong-warning/state?sessionId=live-1' })
  check('a live compaction after the first read counts once', after.body.count, 3)
  check('the live fold never re-counts seeded compactions', after.body.count, 3)
  check('completing a compaction re-anchors the spend boundary', after.body.tokensSinceCompaction, 0)
  check('the seeded watermark advanced with the log', after.body.seededThrough, 12)
}

// ---------------------------------------------------------------------------
section('history source: a session the host has not loaded')
// ---------------------------------------------------------------------------
{
  /** A log with two completed compactions and 300k spent after the last one. */
  const historyEvents = [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'assistant/message', data: { usage: { inputTokens: 900000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { seq: 2, type: 'compaction/start', data: { compactionId: 'h1' } },
    { seq: 3, type: 'compaction/summary', data: { compactionId: 'h1' } },
    { seq: 4, type: 'compaction/end', data: { compactionId: 'h1' } },
    { seq: 5, type: 'compaction/start', data: { compactionId: 'h2' } },
    { seq: 6, type: 'compaction/summary', data: { compactionId: 'h2' } },
    { seq: 7, type: 'compaction/end', data: { compactionId: 'h2' } },
    { seq: 8, type: 'assistant/message', data: { usage: { inputTokens: 300000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } },
    { seq: 9, type: 'request/context', data: { contextWindow: 1000000 } },
  ]

  let readCalls = 0
  const reader = createColdReader({
    sessionQuery: {
      async readSession(id) {
        readCalls += 1
        // The real backend throws for an id it cannot find; mirror that so the
        // "session does not exist" path is exercised rather than masked.
        if (id === 'not-loaded') return { events: historyEvents, session: { id } }
        throw new Error(`SESSION_QUERY_SESSION_NOT_FOUND: ${String(id)}`)
      },
    },
    log: { warn() {}, info() {} },
    ttlMs: 30000,
    timeoutMs: 500,
  })

  const liveSession = {
    id: 'live-only',
    seq: 4,
    snapshotEvents: (from = 0, to = 4) => historyEvents.slice(from, to),
    eventAt: (seq) => historyEvents[seq],
  }
  const listeners = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    sessionProjections: { stateOf: () => undefined },
  }
  const tracker = createTracker(ctx)
  const config = resolveConfig({ compactCountMin: 2, occupancyPercentMin: 10, tokensSinceCompactionMin: 200000 }).config
  const deps = {
    getConfig: () => config,
    configVersion: () => 1,
    tracker,
    descriptors: () => [],
    sessions: { get: (id) => (id === 'live-only' ? liveSession : undefined) },
    projections: ctx.sessionProjections,
    log: ctx.logger,
    coldReader: reader,
  }
  const route = makeStateRoute(deps)

  /** Invoke the route and capture the JSON body. */
  async function get(url) {
    const captured = {}
    await route.handler(
      { url, method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } },
      { writeHead(status) { captured.status = status }, end(payload) { captured.body = JSON.parse(payload) } },
    )
    return captured
  }

  const historical = await get('/api/dsh-toolong-warning/state?sessionId=not-loaded')
  check('an unloaded session is answered from history', historical.body.known, true)
  check('and says so', historical.body.source, 'history')
  check('with the real compaction count', historical.body.count, 2)
  check('and the spend measured after the last compaction', historical.body.tokensSinceCompaction, 300000)
  check('and the route capacity read from the log', historical.body.contextWindow, 1000000)
  check('the history source can raise the reminder', historical.body.shouldWarn, true)
  check('naming its grounds', historical.body.reasons.includes('many-compactions'), true)
  check('the log was read once', readCalls, 1)

  await get('/api/dsh-toolong-warning/state?sessionId=not-loaded')
  check('a second poll is served from the cache', readCalls, 1)
  check('and the read counter is exposed for debugging', historical.body.coldReads, 1)

  const livePriority = await get('/api/dsh-toolong-warning/state?sessionId=live-only')
  check('a live session still uses the live source', livePriority.body.source, 'live')
  check('and does not touch the history backend', readCalls, 1)

  const unavailable = await get('/api/dsh-toolong-warning/state?sessionId=nope')
  check('an unreadable session reports why', unavailable.body.reason, 'history-unavailable')
  check('and does not warn', unavailable.body.shouldWarn, undefined)
  check('and does not claim to know it', unavailable.body.known, false)

  const noReader = makeStateRoute({ ...deps, coldReader: undefined })
  const legacy = {}
  await noReader.handler(
    { url: '/api/dsh-toolong-warning/state?sessionId=nope', method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(status) { legacy.status = status }, end(payload) { legacy.body = JSON.parse(payload) } },
  )
  check('without the service the old reason is reported', legacy.body.reason, 'session-not-loaded')

  // A broken backend must degrade, not fail the request.
  const brokenReader = createColdReader({
    sessionQuery: { async readSession() { throw new Error('backend down') } },
    log: { warn() {}, info() {} },
  })
  const brokenRoute = makeStateRoute({ ...deps, coldReader: brokenReader })
  const brokenCaptured = {}
  await brokenRoute.handler(
    { url: '/api/dsh-toolong-warning/state?sessionId=not-loaded', method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(status) { brokenCaptured.status = status }, end(payload) { brokenCaptured.body = JSON.parse(payload) } },
  )
  check('a broken backend still answers 200', brokenCaptured.status, 200)
  check('and degrades to unknown', brokenCaptured.body.known, false)
  check('with the history reason', brokenCaptured.body.reason, 'history-unavailable')
  check('and never warns on a guess', brokenCaptured.body.shouldWarn, undefined)
}

// ---------------------------------------------------------------------------
section('config gate')
// ---------------------------------------------------------------------------
{
  const disabled = resolveConfig({ enabled: false }).config
  const route = makeStateRoute({
    getConfig: () => disabled,
    configVersion: () => 0,
    tracker: { size: () => 0, stateFor: () => { throw new Error('must not run when disabled') }, billedTokensFor: () => undefined },
    descriptors: () => [],
    sessions: { get: () => undefined },
    projections: undefined,
    log: { warn() {} },
  })
  const captured = { body: undefined, status: undefined }
  await route.handler(
    { url: '/api/dsh-toolong-warning/state?sessionId=live-1', method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(status) { captured.status = status }, end(payload) { captured.body = JSON.parse(payload) } },
  )
  check('a disabled plugin reports disabled', captured.body.reason, 'disabled')
  check('a disabled plugin never touches the session', captured.body.shouldWarn, undefined)
}

// ---------------------------------------------------------------------------
section('history self-test compares a FRESH read, not a cached one')
// ---------------------------------------------------------------------------
{
  // Regression pin. On a real session that had just compacted, this check
  // reported `live count 2 vs history count 1` and looked like a counting bug:
  // the live tracker had already folded both completions while the history reader
  // was still serving a value cached from before the second one. A cache hit is
  // designed behaviour, so the comparison has to bypass the cache or it reports a
  // disagreement that is purely an artifact of timing.
  // Two completed compactions, so the live tracker legitimately reports 2 while
  // the fake cache still holds the pre-compaction 1.
  const logOfTwelve = () => [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'compaction/start', data: { compactionId: 'c1' } },
    { seq: 2, type: 'compaction/summary', data: { compactionId: 'c1' } },
    { seq: 3, type: 'compaction/end', data: { compactionId: 'c1' } },
    { seq: 4, type: 'user/message', data: {} },
    { seq: 5, type: 'compaction/start', data: { compactionId: 'c2' } },
    { seq: 6, type: 'compaction/summary', data: { compactionId: 'c2' } },
    { seq: 7, type: 'compaction/end', data: { compactionId: 'c2' } },
  ]
  const session = {
    id: 'live-compacted',
    seq: logOfTwelve().length,
    snapshotEvents: (from = 0, to = logOfTwelve().length) => logOfTwelve().slice(from, to),
  }
  const listeners = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    sessionProjections: { stateOf: () => undefined },
  }
  const tracker = createTracker(ctx)
  check('the harness live count is two', tracker.stateFor(session).state.count, 2)

  /** A reader whose cached answer lags its fresh answer, like a real cache does. */
  const reader = {
    freshReads: 0,
    plainReads: 0,
    async read(id, options) {
      if (options?.fresh === true) {
        this.freshReads += 1
        return { count: 2 }
      }
      // The stale value a cache would still be holding.
      this.plainReads += 1
      return { count: 1 }
    },
    stats: () => ({ reads: 1 }),
    size: () => 1,
    clear: () => {},
  }

  const deps = {
    getConfig: () => resolveConfig({}).config,
    configVersion: () => 1,
    tracker,
    descriptors: () => [],
    sessions: { get: () => undefined },
    projections: undefined,
    log: ctx.logger,
    coldReader: reader,
    liveSessionsForSelfTest: () => [{ id: 'live-compacted', count: tracker.stateFor(session).state.count }],
  }
  const route = makeHealthRoute(deps)
  const captured = {}
  await route.handler(
    { url: '/api/dsh-toolong-warning/health?selftest=1', method: 'GET', headers: { host: '127.0.0.1:3080' }, socket: { remoteAddress: '127.0.0.1' } },
    { writeHead(status) { captured.status = status }, end(payload) { captured.body = JSON.parse(payload) } },
  )

  check('the self-test asks the reader for a fresh read', reader.freshReads >= 1, true)
  check('so the stale cached count does not cause a false failure', captured.body.historySelfTest.pass, true)
  check('and it says the comparison was fresh', captured.body.historySelfTest.checks.comparedFresh, true)
  check('the live count it compared against is the tracker value', captured.body.historySelfTest.checks.comparisons[0].liveCount, 2)
  check('the history count it compared against is the fresh value', captured.body.historySelfTest.checks.comparisons[0].historyCount, 2)
}

// ---------------------------------------------------------------------------
section('a redelivered compaction event is never counted twice')
// ---------------------------------------------------------------------------
{
  // The live feed can hand the same event to the handler more than once — a
  // reconnect replay, or a session that is disposed and re-created and then
  // re-seeded. The seed watermark is the guard: an event at or below the highest
  // folded seq has already been folded, and folding it again would increment the
  // count with no new compaction having happened. That is the one way this plugin
  // could report a number it cannot justify, so it is pinned here.
  const events = [
    { seq: 0, type: 'user/message', data: {} },
    { seq: 1, type: 'compaction/start', data: { compactionId: 'c1' } },
    { seq: 2, type: 'compaction/summary', data: { compactionId: 'c1' } },
    { seq: 3, type: 'compaction/end', data: { compactionId: 'c1' } },
  ]
  const session = {
    id: 'redelivered',
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
  }
  const listeners = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    sessionProjections: { stateOf: () => undefined },
  }
  const tracker = createTracker(ctx)
  const append = listeners.get('session/event')[0]

  append(session, events[3])
  check('the first delivery counts the completed compaction', tracker.stateFor(session).state.count, 1)

  append(session, events[3])
  check('a redelivered event does not count again', tracker.stateFor(session).state.count, 1)

  append(session, events[3])
  check('nor does a third delivery', tracker.stateFor(session).state.count, 1)

  // A whole-log replay is the shape a re-seed takes; it must stay at one too.
  for (const event of events) append(session, event)
  check('nor a full replay of the log', tracker.stateFor(session).state.count, 1)

  // The same guarantee across a brand-new tracker on the same log: folding the
  // log from scratch must agree with the incremental path.
  const fresh = createTracker(ctx)
  check('a fresh fold of the same log also says one', fresh.stateFor(session).state.count, 1)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
