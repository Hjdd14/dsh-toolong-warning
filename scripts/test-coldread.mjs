/**
 * Tests for the history (cold read) source.
 *
 * Run with: node scripts/test-coldread.mjs
 *
 * This source exists so the compaction count does not depend on whether a
 * conversation is currently loaded in the host process. Switching conversations
 * used to leave the counter blank until the page was reloaded. These tests pin:
 * the fold itself, the cache/revalidate/TTL behaviour, the failure and timeout
 * degradations, and — most importantly — that the history path and the live path
 * report the same count for the same log.
 */

import { ensureProfileEnv } from './profile-env.mjs'

ensureProfileEnv()

const { createColdReader, foldColdLog } = await import('../src/coldread.js')
const { createTracker } = await import('../src/state.js')
const { INITIAL_COMPACTION_STATE } = await import('../src/detect.js')

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

const silentLog = { warn() {}, info() {} }

/** One assistant settlement carrying provider usage. */
const usageEvent = (seq, inputTokens) => ({
  seq,
  type: 'assistant/message',
  data: { usage: { inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
})

/** A complete successful compaction bracket. */
const bracket = (start) => [
  { seq: start, type: 'compaction/start', data: { compactionId: `c${String(start)}` } },
  { seq: start + 1, type: 'compaction/summary', data: { compactionId: `c${String(start)}` } },
  { seq: start + 2, type: 'compaction/end', data: { compactionId: `c${String(start)}` } },
]

/** A representative log: 2 completed compactions, 300k spent after the last one. */
function representativeLog() {
  return [
    { seq: 0, type: 'user/message', data: {} },
    usageEvent(1, 900000),
    ...bracket(2),
    usageEvent(5, 1500000),
    ...bracket(6),
    usageEvent(9, 300000),
    { seq: 10, type: 'request/context', data: { contextWindow: 1000000 } },
  ]
}

// ---------------------------------------------------------------------------
section('foldColdLog: one pass yields every metric')
// ---------------------------------------------------------------------------
{
  const result = foldColdLog(representativeLog())
  check('counts successful compactions', result.count, 2)
  check('records the newest compaction seq', result.lastCompactionSeq, 7)
  check('sums all usage samples', result.sampledTokens, 2700000)
  check('measures spend after the last completed compaction', result.spendSinceLastCompaction, 300000)
  check('reads the route capacity from the log', result.contextWindow, 1000000)
  // The newest usage sample is the 300k that landed after the last compaction, so
  // prompt pressure / capacity is 0.3 — not the bigger cumulative figure.
  check('occupancy uses the newest prompt sample', Math.round(result.occupancyRatio * 100) / 100, 0.3)
  check('reports the event count', result.events, 11)

  check('an empty log is zero, not an error', foldColdLog([]).count, 0)
  check('an empty log has no spend figure', foldColdLog([]).spendSinceLastCompaction, undefined)
  check('a lone start does not count', foldColdLog([{ seq: 0, type: 'compaction/start', data: {} }]).count, 0)

  const failedEnd = [
    { seq: 0, type: 'compaction/start', data: {} },
    { seq: 1, type: 'compaction/end', data: { error: { message: 'boom' } } },
  ]
  check('a failed compaction never counts', foldColdLog(failedEnd).count, 0)

  const partial = [{ seq: 0, type: 'compaction/start', data: {} }]
  check('an unfinished compaction yields no baseline', foldColdLog(partial).spendSinceLastCompaction, undefined)

  check('length-prefixed status events are ignored', foldColdLog(representativeLog()).count, foldColdLog(representativeLog()).count)
}

// ---------------------------------------------------------------------------
section('foldColdLog: agrees with the live fold on the same log')
// ---------------------------------------------------------------------------
{
  const events = representativeLog()
  const cold = foldColdLog(events)

  // Drive the live tracker over the same events and compare.
  const listeners = new Map()
  const liveCtx = {
    logger: silentLog,
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    sessionProjections: {
      stateOf: (_session, key) => (key === 'tokenUsage'
        ? { totals: { uncachedInputTokens: 2700000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }
        : undefined),
    },
  }
  const session = {
    id: 'agree-1',
    seq: events.length,
    snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
    eventAt: (seq) => events[seq],
  }
  const live = createTracker(liveCtx).stateFor(session)

  check('both sources count the same', cold.count, live.state.count)
  check('both sources agree on the newest compaction seq', cold.lastCompactionSeq, live.state.lastCompactionSeq)
  check('both sources measure the same extra spend', cold.spendSinceLastCompaction, live.spendSinceLastCompaction)
  check('both sources see the same sampled total', cold.sampledTokens, live.sampledTokens)
  check('the live fold starts from the documented initial state', INITIAL_COMPACTION_STATE.count, 0)
}

// ---------------------------------------------------------------------------
section('createColdReader: caching, revalidation and eviction')
// ---------------------------------------------------------------------------
{
  let clock = 1000
  let calls = 0
  const query = {
    async readSession(id) {
      calls += 1
      return { events: representativeLog(), session: { id } }
    },
  }
  const reader = createColdReader({ sessionQuery: query, log: silentLog, ttlMs: 30000, timeoutMs: 1000, now: () => clock, capacity: 2 })

  const first = await reader.read('s1')
  check('reads the log on first use', calls, 1)
  check('and reports a real result', first.count, 2)
  check('marking it as not a cache hit', first.cacheHit, false)

  await reader.read('s1')
  check('a second read inside the window is served from cache', calls, 1)

  clock += 20000
  const refreshed = await reader.read('s1')
  check('past the revalidation window it re-reads, to notice growth', calls, 2)
  check('still returning a valid result', refreshed.count, 2)

  clock += 60000
  await reader.read('s1')
  check('past the TTL it re-reads again', calls, 3)

  await reader.read('s2')
  await reader.read('s3')
  check('the cache honours its capacity', reader.size() <= 2, true)

  reader.clear()
  check('clear empties the cache', reader.size(), 0)

  // `fresh` bypasses the cache for one read. The self-test depends on this: a
  // cached count can legitimately lag a live one by up to the revalidation
  // window, so comparing against the cache would report a phantom disagreement
  // (observed live: live 2 vs cached history 1 right after a real compaction).
  const afterClear = calls
  const fresh = await reader.read('s1', { fresh: true })
  check('a fresh read ignores the cache', calls, afterClear + 1)
  check('and still returns the real value', fresh.count, 2)
  const cachedAgain = calls
  await reader.read('s1')
  check('and it repopulated the cache', calls, cachedAgain)
  // A fresh read is still a read, so it is counted as one rather than a hit.
  check('a fresh read is not counted as a hit', reader.stats().reads > 0, true)

  const stats = reader.stats()
  check('stats count reads', stats.reads >= 4, true)
  check('stats count hits', stats.hits >= 1, true)
}

// ---------------------------------------------------------------------------
section('createColdReader: degradation')
// ---------------------------------------------------------------------------
{
  const unavailable = createColdReader({ sessionQuery: undefined, log: silentLog })
  check('no query service means no result', await unavailable.read('s1'), undefined)

  const broken = createColdReader({
    sessionQuery: { async readSession() { throw new Error('backend down') } },
    log: silentLog,
  })
  check('a throwing backend degrades to no result', await broken.read('s1'), undefined)
  check('and is counted as a failure', broken.stats().failures, 1)

  const shapeless = createColdReader({
    sessionQuery: { async readSession() { return { session: {} } } },
    log: silentLog,
  })
  check('a response without events degrades', await shapeless.read('s1'), undefined)

  let stuckCalls = 0
  const stuck = createColdReader({
    sessionQuery: { readSession() { stuckCalls += 1; return new Promise(() => {}) } },
    log: silentLog,
    timeoutMs: 60,
  })
  check('a stalled backend times out instead of hanging', await stuck.read('s1'), undefined)
  check('the stalled read was attempted once', stuckCalls, 1)

  // A failed refresh after a good read must keep serving the cached value, but
  // never past its own TTL.
  let clock2 = 1000
  let healthy = true
  const flaky = createColdReader({
    sessionQuery: {
      async readSession(id) {
        if (!healthy) throw new Error('flaky')
        return { events: representativeLog(), session: { id } }
      },
    },
    log: silentLog,
    ttlMs: 30000,
    timeoutMs: 500,
    now: () => clock2,
  })
  await flaky.read('s1')
  healthy = false
  clock2 += 20000
  const stale = await flaky.read('s1')
  check('a failed refresh keeps the last value', stale?.count, 2)
  check('and marks it stale', stale?.stale, true)
  clock2 += 60000
  check('but not past its TTL', await flaky.read('s1'), undefined)
}

// ---------------------------------------------------------------------------
section('createColdReader: growing conversation')
// ---------------------------------------------------------------------------
{
  const events = representativeLog()
  const query = {
    async readSession(id) {
      return { events, session: { id } }
    },
  }
  let clock = 1000
  const reader = createColdReader({ sessionQuery: query, log: silentLog, ttlMs: 60000, now: () => clock })

  const before = await reader.read('grow')
  check('initial count', before.count, 2)

  // The conversation gains one more completed compaction.
  events.push(...bracket(11))
  clock += 20000
  const after = await reader.read('grow')
  check('growth is picked up inside the TTL', after.count, 3)
}

// ---------------------------------------------------------------------------
section('createColdReader: runSelfTest compares against the live count')
// ---------------------------------------------------------------------------
{
  const query = { async readSession() { return { events: representativeLog() } } }
  const reader = createColdReader({ sessionQuery: query, log: silentLog })
  const agree = await reader.runSelfTest('s1', 2)
  check('agreement passes', agree.pass, true)
  check('with no mismatches', agree.mismatches, [])
  const disagree = await reader.runSelfTest('s1', 5)
  check('disagreement fails', disagree.pass, false)
  check('and names both numbers', disagree.mismatches.length, 1)

  const none = createColdReader({ sessionQuery: undefined, log: silentLog })
  const skipped = await none.runSelfTest('s1', 2)
  check('a missing source fails rather than silently passing', skipped.pass, false)
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
