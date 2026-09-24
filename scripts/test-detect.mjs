/**
 * Offline tests for the detection rules.
 *
 * Run with: node scripts/test-detect.mjs
 *
 * These exercise the pure logic (fold + metrics + decision) plus the tracker's
 * seed path against a fake Session, so every branch that decides whether a user
 * is warned is covered without booting DSH. This is the false-positive guard:
 * each "must NOT warn" case below is a scenario the plugin would otherwise get
 * wrong.
 */

import { ensureProfileEnv } from './profile-env.mjs'

// Must run before the plugin modules are imported: they resolve
// `@deepseek-ai/schemastery` from the profile, which a plain shell does not name.
const profileDir = ensureProfileEnv()

const {
  INITIAL_COMPACTION_STATE,
  buildMetrics,
  decideWarning,
  foldCompaction,
  isCompactionEvent,
  normalizeCompactionState,
  readOccupancy,
  sumBilledTokens,
} = await import('../src/detect.js')
const { createTracker } = await import('../src/state.js')
const { resolveConfig, thresholdsOf } = await import('../src/schema.js')
const { DEFAULT_THRESHOLDS } = await import('../src/schema.js')
const { usesSchemastery } = await import('../src/config.js')

console.log(`profile for schema resolution: ${profileDir ?? '(none found)'}; real schemastery: ${String(usesSchemastery)}`)

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

/** Build one synthetic session event. */
function ev(seq, type, data = {}) {
  return { seq, type, data }
}

/** A config with explicit thresholds (defaults unless overridden). */
function cfg(overrides = {}) {
  return resolveConfig({ ...DEFAULT_THRESHOLDS, ...overrides }).config
}

/** Metrics with the fields the decision reads. */
function metrics(overrides = {}) {
  return {
    count: 3,
    lastCompactionSeq: 100,
    billedTokens: 1_000_000,
    tokensSinceCompaction: 300_000,
    projectedTokens: 200_000,
    contextWindow: 1_000_000,
    occupancyRatio: 0.2,
    dataKnown: true,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
section('fold: only successfully completed compactions count')
// ---------------------------------------------------------------------------
{
  let state = INITIAL_COMPACTION_STATE
  check('empty fold starts at zero', state.count, 0)
  check('a start alone does not count', foldCompaction(state, ev(1, 'compaction/start')).count, 0)
  state = foldCompaction(state, ev(1, 'compaction/start'))
  state = foldCompaction(state, ev(2, 'compaction/summary'), 5000)
  check('summary records the spend baseline', state.sampledTokensAtLastCompaction, 5000)
  check('summary alone does not count yet', state.count, 0)
  state = foldCompaction(state, ev(3, 'compaction/end'), 6000)
  check('a paired success counts once', state.count, 1)
  check('a completed compaction re-anchors the spend boundary', state.sampledTokensAtLastCompaction, 6000)

  let withFailure = INITIAL_COMPACTION_STATE
  withFailure = foldCompaction(withFailure, ev(1, 'compaction/start'))
  withFailure = foldCompaction(withFailure, ev(2, 'compaction/end', { error: { message: 'boom' } }), 10)
  check('a failed compaction never counts', withFailure.count, 0)
  check('a failed compaction is remembered', withFailure.lastCompactionFailed, true)
  check('a failed compaction never re-anchors the boundary', withFailure.sampledTokensAtLastCompaction, -1)

  let twice = INITIAL_COMPACTION_STATE
  for (const [seq, type] of [[1, 'compaction/start'], [2, 'compaction/end'], [3, 'compaction/start'], [4, 'compaction/end']]) {
    twice = foldCompaction(twice, ev(seq, type), 1000 * seq)
  }
  check('two completed compactions count twice', twice.count, 2)

  check('unrelated events are ignored', foldCompaction(INITIAL_COMPACTION_STATE, ev(9, 'user/message')) === INITIAL_COMPACTION_STATE, true)
  check('compaction/prune is not a compaction', isCompactionEvent(ev(1, 'compaction/prune')), false)
  check('compaction/start is a compaction event', isCompactionEvent(ev(1, 'compaction/start')), true)
}

// ---------------------------------------------------------------------------
section('fold: malformed input cannot inflate the count')
// ---------------------------------------------------------------------------
{
  check('null event returns the same state', foldCompaction(INITIAL_COMPACTION_STATE, null) === INITIAL_COMPACTION_STATE, true)
  check('missing type returns the same state', foldCompaction(INITIAL_COMPACTION_STATE, { seq: 1 }) === INITIAL_COMPACTION_STATE, true)
  check('null data does not throw', foldCompaction(INITIAL_COMPACTION_STATE, { seq: 1, type: 'compaction/end', data: null }).count, 1)
  check('negative count is clamped', normalizeCompactionState({ count: -4 }).count, 0)
  check('NaN count falls back', normalizeCompactionState({ count: Number.NaN }).count, 0)
}

// ---------------------------------------------------------------------------
section('fold: deterministic replay')
// ---------------------------------------------------------------------------
{
  const log = [ev(1, 'compaction/start'), ev(2, 'compaction/summary'), ev(3, 'compaction/end'), ev(4, 'user/message'), ev(5, 'compaction/start'), ev(6, 'compaction/summary'), ev(7, 'compaction/end')]
  const replay = () => log.reduce((state, event, index) => foldCompaction(state, event, index * 1000), INITIAL_COMPACTION_STATE)
  check('same log replays to the same count', replay().count, 2)
  check('replay is stable across runs', JSON.stringify(replay()), JSON.stringify(replay()))
}

// ---------------------------------------------------------------------------
section('metrics: token buckets and occupancy')
// ---------------------------------------------------------------------------
{
  check('sums all four buckets', sumBilledTokens({ totals: { uncachedInputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 25, outputTokens: 5 } }), 180)
  check('accepts a flat bucket object', sumBilledTokens({ uncachedInputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 3, outputTokens: 4 }), 10)
  check('no buckets at all is unknown', sumBilledTokens({ totals: {} }), undefined)
  check('undefined usage is unknown', sumBilledTokens(undefined), undefined)

  const pressure = { pressureTokens: 400_000, surfaceTokens: 100_000, sampledSurfaceTokens: 90_000, contextWindow: 1_000_000 }
  const occupancy = readOccupancy(pressure)
  check('projected = pressure + surface movement', occupancy.projectedTokens, 410_000)
  check('occupancy ratio is projected over capacity', Math.round(occupancy.occupancyRatio * 1000) / 1000, 0.41)

  check('no capacity means no ratio', readOccupancy({ pressureTokens: 10, surfaceTokens: 10 }).occupancyRatio, undefined)
  check('zero capacity means no ratio', readOccupancy({ pressureTokens: 10, surfaceTokens: 10, contextWindow: 0 }).occupancyRatio, undefined)
  check('no usage sample means no projection', readOccupancy({ surfaceTokens: 123 }).projectedTokens, 123)

  const built = buildMetrics({ count: 4, lastCompactionSeq: 7, sampledTokensAtLastCompaction: 1_000_000 }, 1_500_000, pressure)
  check('extra spend is measured after the last compaction', built.tokensSinceCompaction, 500_000)
  check('spend is not clamped at the boundary', buildMetrics({ count: 1, sampledTokensAtLastCompaction: 9_999_999 }, 10, undefined).tokensSinceCompaction, 0)
  check('missing usage samples mark the data unknown', buildMetrics({ count: 1, sampledTokensAtLastCompaction: 0 }, undefined, pressure).dataKnown, false)
  check('occupancy still reads without usage samples', buildMetrics({ count: 1, sampledTokensAtLastCompaction: 0 }, undefined, pressure).occupancyRatio, 0.41)
  check(
    'a never-compacted session measures its whole spend',
    buildMetrics({ count: 0, sampledTokensAtLastCompaction: -1 }, 250_000, undefined).tokensSinceCompaction,
    250_000,
  )
}

// ---------------------------------------------------------------------------
section('decision: the cases that MUST stay silent')
// ---------------------------------------------------------------------------
{
  const c = cfg()

  check(
    'long but never compacted -> silent',
    decideWarning(metrics({ count: 0, occupancyRatio: 0.95, tokensSinceCompaction: 900_000 }), c).warn,
    false,
  )
  check(
    'two compactions only -> silent (below the 3 default)',
    decideWarning(metrics({ count: 2, occupancyRatio: 0.95, tokensSinceCompaction: 900_000 }), c).warn,
    false,
  )
  check(
    'three compactions but cheap and roomy -> silent',
    decideWarning(metrics({ count: 3, occupancyRatio: 0.2, tokensSinceCompaction: 1_000 }), c).warn,
    false,
  )
  check(
    'three compactions, low occupancy, below the doubled bypass -> silent',
    decideWarning(metrics({ count: 3, occupancyRatio: 0.2, tokensSinceCompaction: 250_000 }), c).warn,
    false,
  )
  check(
    'no usage data at all -> silent even at 95% occupancy',
    decideWarning(metrics({ count: 9, dataKnown: false, billedTokens: undefined, tokensSinceCompaction: undefined, occupancyRatio: 0.95 }), c).warn,
    false,
  )
  check(
    'occupancy unknown and spend below threshold -> silent',
    decideWarning(metrics({ count: 5, occupancyRatio: undefined, tokensSinceCompaction: 1_000 }), c).warn,
    false,
  )
  check(
    'exactly one below the compaction minimum -> silent',
    decideWarning(metrics({ count: 2, occupancyRatio: 0.9, tokensSinceCompaction: 900_000 }), cfg({ compactCountMin: 3 })).warn,
    false,
  )
}

// ---------------------------------------------------------------------------
section('decision: the cases that MUST warn')
// ---------------------------------------------------------------------------
{
  const c = cfg()

  const highOccupancy = decideWarning(metrics({ count: 3, occupancyRatio: 0.52, tokensSinceCompaction: 200_000 }), c)
  check('high occupancy with real extra spend warns', highOccupancy.warn, true)
  check('and names both grounds', highOccupancy.reasons.includes('high-occupancy') && highOccupancy.reasons.includes('extra-spend'), true)

  const bypass = decideWarning(metrics({ count: 3, occupancyRatio: 0.2, tokensSinceCompaction: 400_000 }), c)
  check('heavy spend past the bypass warns without occupancy', bypass.warn, true)
  check('and names the bypass', bypass.reasons.includes('heavy-extra-spend'), true)

  const both = decideWarning(metrics({ count: 3, occupancyRatio: 0.9, tokensSinceCompaction: 900_000 }), c)
  check('both grounds warns', both.warn, true)
  check('warn gate is reported', both.gate, 'warn')
  check('the warn path carries no failure gate', both.reasons.includes('no-pressure'), false)

  check(
    'occupancy unknown but double the spend threshold warns',
    decideWarning(metrics({ count: 4, occupancyRatio: undefined, tokensSinceCompaction: 400_000 }), c).warn,
    true,
  )
  check(
    'a raised compaction minimum is honoured',
    decideWarning(metrics({ count: 3, occupancyRatio: 0.52, tokensSinceCompaction: 200_000 }), cfg({ compactCountMin: 5 })).warn,
    false,
  )
  check(
    'a relaxed set of thresholds warns earlier',
    decideWarning(metrics({ count: 1, occupancyRatio: 0.12, tokensSinceCompaction: 15_000 }), cfg({ compactCountMin: 1, occupancyPercentMin: 10, tokensSinceCompactionMin: 10_000 })).warn,
    true,
  )
  check(
    'boundary: occupancy exactly at the threshold warns',
    decideWarning(metrics({ count: 3, occupancyRatio: 0.5, tokensSinceCompaction: 200_000 }), c).warn,
    true,
  )
  check(
    'boundary: spend exactly at the threshold with enough occupancy warns',
    decideWarning(metrics({ count: 3, occupancyRatio: 0.8, tokensSinceCompaction: 200_000 }), c).warn,
    true,
  )
}

// ---------------------------------------------------------------------------
section('config: defaults, rejection and bad types')
// ---------------------------------------------------------------------------
{
  const resolved = resolveConfig(undefined)
  check('undefined config resolves to defaults', resolved.config.compactCountMin, 3)
  check('default occupancy threshold', resolved.config.occupancyPercentMin, 50)
  check('default extra-spend threshold', resolved.config.tokensSinceCompactionMin, 200000)
  check('no warnings for defaults', resolved.warnings.length, 0)
  check('an absent config reports its source', resolved.source, 'defaults')

  const full = resolveConfig({ enabled: true, compactCountMin: 4, occupancyPercentMin: 60, tokensSinceCompactionMin: 300000, statsIntervalMs: 20000, dismissible: false })
  check('a complete config is accepted', full.config.compactCountMin, 4)
  check('and reports no warnings', full.warnings.length, 0)
  check('and reports its source', full.source, 'row')

  const outOfRange = resolveConfig({ compactCountMin: 999, occupancyPercentMin: 200, tokensSinceCompactionMin: 1 })
  check('too-large count falls back to the default', outOfRange.config.compactCountMin, 3)
  check('too-large percent falls back to the default', outOfRange.config.occupancyPercentMin, 50)
  check('too-small spend falls back to the default', outOfRange.config.tokensSinceCompactionMin, 200000)
  // The schema reports one issue per failing field and stops at the first, so the
  // count may be lower than the number of bad fields; what matters is that a
  // rejection is surfaced rather than silently kept.
  check('a rejection is reported', outOfRange.warnings.length >= 1, true)
  check('a rejection names its field', outOfRange.warnings.some((line) => line.startsWith('compactCountMin')), true)
  check('the rejected source is reported', outOfRange.source, 'row-with-warnings')

  const badType = resolveConfig({ compactCountMin: 'three', enabled: 'yes' })
  check('a string number falls back to the default', badType.config.compactCountMin, 3)
  check('a string boolean falls back to the default', badType.config.enabled, true)
  check('bad types are reported', badType.warnings.length >= 1, true)

  const fractional = resolveConfig({ compactCountMin: 4.7 })
  check('a fractional count is rejected rather than truncated', fractional.config.compactCountMin, 3)
  check('and is reported', fractional.warnings.length >= 1, true)

  const partial = resolveConfig({ compactCountMin: 5 })
  check('an unspecified field keeps its default', partial.config.statsIntervalMs, 15000)
  check('a specified field survives', partial.config.compactCountMin, 5)

  check('thresholds projection carries only the decision fields', Object.keys(thresholdsOf(DEFAULT_THRESHOLDS)).length, 3)
}

// ---------------------------------------------------------------------------
section('tracker: seeding an already-long session')
// ---------------------------------------------------------------------------
{
  /** A fake Session good enough for the fold: id, seq and both read paths. */
  function fakeSession(id, events) {
    return {
      id,
      // `seq` is the log LENGTH (the next free slot), matching the real Session.
      seq: events.length,
      snapshotEvents: (from = 0, to = events.length) => events.slice(from, to),
      eventAt: (seq) => events[seq],
    }
  }

  const usageEvent = (seq, tokens) => ({
    seq,
    type: 'assistant/message',
    data: { usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } },
  })

  const log = [
    usageEvent(0, 300_000),
    ev(1, 'compaction/start'),
    ev(2, 'compaction/summary'),
    ev(3, 'compaction/end'),
    usageEvent(4, 300_000),
    ev(5, 'compaction/start'),
    ev(6, 'compaction/summary'),
    ev(7, 'compaction/end'),
    usageEvent(8, 300_000),
  ]

  const listeners = new Map()
  const ctx = {
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    sessionProjections: {
      // The live projection total after the whole log: 900k billed.
      stateOf: () => ({ totals: { uncachedInputTokens: 900_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } }),
    },
  }

  const tracker = createTracker(ctx)
  const session = fakeSession('sess-1', log)
  const seeded = tracker.stateFor(session)
  check('a pre-existing conversation is seeded, not silently zero', seeded.state.count, 2)
  check('seeding records the highest folded seq', seeded.seededThrough, log.length - 1)
  check('the spend boundary comes from the log samples', seeded.state.sampledTokensAtLastCompaction, 600_000)
  check('total sampled tokens come from the log, not the live total', seeded.sampledTokens, 900_000)
  check('the samples are counted', seeded.sampledEvents, 3)
  check('extra spend is measured after the last compaction', seeded.spendSinceLastCompaction, 300_000)
  check('the meter total stays available for diagnosis', tracker.billedTokensFor(session), 900_000)

  // A live append after seeding must keep counting, and must re-anchor the spend
  // boundary at the compaction it just completed. The harness maintains the real
  // Session invariant: the event enters the log, then `seq` reports the length.
  const append = listeners.get('session/event')[0]
  const liveAppend = (event) => {
    log.push(event)
    session.seq = log.length
    append(session, event)
  }
  liveAppend(ev(9, 'compaction/start'))
  liveAppend(ev(10, 'compaction/summary'))
  liveAppend(ev(11, 'compaction/end'))
  const after = tracker.stateFor(session)
  check('a live compaction after seeding counts once', after.state.count, 3)
  check('a live re-fold never re-adds earlier compactions', after.state.count, 3)
  check('completing a compaction re-anchors the boundary', after.state.sampledTokensAtLastCompaction, 900_000)
  check('so the waste figure restarts from zero', after.spendSinceLastCompaction, 0)
  check('the live watermark advanced with the log', after.seededThrough, log.length - 1)

  // Spend after that boundary is what the next read reports.
  liveAppend({ seq: 12, type: 'assistant/message', data: { usage: { inputTokens: 400_000, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
  const later = tracker.stateFor(session)
  check('spend after the boundary is measured again', later.spendSinceLastCompaction, 400_000)
  check('and the count is unchanged by a usage-only event', later.state.count, 3)

  // A failed compaction arriving live must not count and must not re-anchor.
  liveAppend(ev(13, 'compaction/start'))
  liveAppend(ev(14, 'compaction/end', { error: { message: 'summary failed' } }))
  const failedLive = tracker.stateFor(session)
  check('a live compaction failure does not count', failedLive.state.count, 3)
  check('a live compaction failure does not re-anchor the boundary', failedLive.state.sampledTokensAtLastCompaction, 900_000)

  check('one session tracked', tracker.size(), 1)
  const dispose = listeners.get('session/disposed')[0]
  dispose(session)
  check('disposal drops the entry', tracker.size(), 0)

  // A session whose snapshot read fails, and one whose declared length outruns
  // its snapshot, must both stay survivable and under-count rather than throw.
  const brokenCtx = { ...ctx, on() {} }
  const brokenTracker = createTracker(brokenCtx)
  const throwing = { id: 'sess-2', seq: 5, snapshotEvents: () => { throw new Error('unreadable') }, eventAt: () => undefined }
  check('an unreadable log does not throw', brokenTracker.stateFor(throwing).state.count, 0)
  check('and reports the shortfall', brokenTracker.stateFor(throwing).droppedEvents, 5)
  check('re-reading a permanent gap does not inflate the shortfall', brokenTracker.stateFor(throwing).droppedEvents, 5)

  const shortCtx = { ...ctx, on() {} }
  const shortTracker = createTracker(shortCtx)
  const short = { id: 'sess-3', seq: 9, snapshotEvents: () => log.slice(0, 4), eventAt: () => undefined }
  const shortFolded = shortTracker.stateFor(short)
  check('a short snapshot under-counts instead of over-counting', shortFolded.state.count, 1)
  check('and the shortfall is surfaced', shortFolded.droppedEvents, 5)
}

// ---------------------------------------------------------------------------
console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
