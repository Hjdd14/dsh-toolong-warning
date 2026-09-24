# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-09-24

First working release. The interesting part of this project is not the feature
list but the number of false assumptions that only real data disproved, so the
fixes are listed individually — each one had a concrete symptom.

### Added

- **Floating reminder window** (top-right, `shell.overlay` seat with a
  self-owned fixed container as fallback) that always shows how many times the
  current conversation has been compacted, and adds a warning card only when the
  host's measured state justifies it.
- **Per-session compaction counter** driven from the durable session log: only a
  completed `compaction/start` + `compaction/end` pair (no `error`) counts.
- **A deliberately narrow warning rule** — completed compactions ≥ 3, extra spend
  since the last compaction ≥ 200k billed tokens, and either context occupancy
  ≥ 50% or double the spend threshold. Any missing input means silence.
- **Settings section** with eight volatile fields, edited through the profile's
  configuration form; invalid values fall back to their defaults with a warning
  naming the field.
- **Bilingual UI** (Simplified Chinese / English) with an in-section switch; the
  choice is stored in the browser and is also mirrored onto the harness' shared
  locale service when that service is writable.
- **History (cold) read source**: sessions the host has not loaded are counted by
  reading their log through `ctx.sessionQuery.readSession(id)`, so switching
  conversations shows a count immediately instead of waiting for a page reload.
  Cached with a TTL, bounded by a timeout, and never inserted into the live
  tracker.
- **Browser-local threshold override** for pages DSH keeps read-only
  (non-loopback): the three decision thresholds can still be changed, are
  validated and clamped again host-side per request, and are never persisted.
- **Diagnostics**: a loopback-only `state` route with an opt-in `debug` facet, a
  `health` route, and `?selftest=1` which drives the real route assembly twice —
  once with a synthetic session, once comparing the live and history folds on a
  real session.
- 374 offline assertions across five suites (`npm test`), plus a repository
  privacy gate (`npm run check:hygiene`).

### Fixed

Real defects found on a live host, in the order they surfaced:

1. **`session.seq` is the next sequence number (the log length), not the last
   event's seq.** Walking `seq <= session.seq` read one position past the end and
   recorded the wrong seed watermark.
2. **A positional walk over a live session's log misses events.**
   `eventAt(i)` for `i < session.seq` returned `undefined` for positions the
   committed log actually contains (~50 positions per pass on a real session),
   silently under-counting. Reading `snapshotEvents()` and slicing it does not.
3. **The incremental fold and the first seed overlapped by one event**, so one
   compaction was counted twice (`count` reached 5 instead of 3).
4. **The spend figure used the token meter's live total minus a snapshot of that
   same total.** A compaction immediately issues its own summarization request,
   so the difference was identically zero and the reminder could never fire.
   Fixed by sampling the usage the log carries and anchoring at the end of the
   last *completed* compaction.
5. **The route passed an already-subtracted delta where a cumulative total was
   expected**, subtracting the baseline twice and pinning the spend figure to 0.
   Caught by the running process' own `?selftest=1`, not by review.
6. **`Config` was not a real schemastery schema**, so `dsh-settings` never
   published a form for the entry and the Settings page stayed permanently
   read-only. It must expose `toJSON()`, `dict`, and `meta.volatile` per field —
   and it must be the DSH build of `@deepseek-ai/schemastery` (3.18.4); the bare
   `schemastery` reachable from a profile is 3.18.0 and has no `.volatile()`.
   Note also that `.volatile()` fields validate to wrapper objects, so they need
   unwrapping before use.
7. **The history source used its own field names** (`spendSinceLastCompaction`),
   while the decision reads `tokensSinceCompaction` / `dataKnown`, so on that path
   the extra spend was always `undefined` and the reminder never fired there.
8. **The history source did not verify identity**: it could return a session's
   metrics under a different requested id, attaching another conversation's
   numbers to the current one. It now compares the returned header id and refuses
   a mismatch.
9. **A completed compaction was counted twice by the live fold.** The append
   handler seeded everything before the incoming event with `untilSeq =
   session.seq`, but `session.seq` is the log *length* while `seed`'s bound is
   *exclusive*, so when the arriving event was the last committed one the seed
   already contained it — and the handler then folded it again. One compaction
   became two, and every redelivery added another. Found on a real session
   immediately after its first `/compact`, where the counter read `2` against a log
   holding exactly one completed compaction. The handler now bounds the seed by the
   event's own seq and skips the fold when that seq is already covered.
10. **The count self-test compared a live value against a possibly-cached history
    value**, reporting `live count 2 vs history count 1` — a cache hit by design,
    dressed up as a counting bug. The comparison now forces a fresh read, and the
    cache is verified separately on its own terms.

### Notes

- Host-side changes require a new `dsh web` process; only client bundles hot
  reload. The `moduleGeneration` field on the health route exists so the running
  process can prove which code it is serving.
- No private storage paths are read: cold reads go through the supported
  `sessionQuery` service, never `$DSH_HOME/storages/**` or session log files.
- The browser bundle is deliberately self-contained. DSH serves it from an exact
  combo URL out of an in-memory response map — not a file server — so a sibling
  module such as `src/i18n.js` can never be fetched; a relative import parses fine
  and 404s at runtime. The bundle therefore inlines the dictionaries, and a test
  compares them string-for-string with the module copy.
- `compactCountMin` defaults to 3, so the counter is expected to read `1` or `2`
  for a while before the reminder can fire. That is the rule working, not a
  stalled counter.
- **Renamed for publishing.** The package was `@local/dsh-toolong-warning` (a local
  scope, marked `private`, installable only from Git or a path) and is now
  `@hjdd14/dsh-toolong-warning`, publishable as-is: no `private` flag,
  `publishConfig.access: "public"`, and `prepublishOnly` running the full release
  gate. The client module id and the `cordis.patch.yml` row name changed with it —
  all three must match or the browser half silently never loads, and
  `scripts/check-client.mjs` now asserts that they do. The **settings namespace is
  deliberately not tied to the package name** (`toolong-warning` is the profile
  entry id), so the rename did not reset anyone's settings.
- A registry-style install was verified end to end: packed, installed into an empty
  project, then loaded through its public entry points — 19/19 checks covering the
  plugin exports, a real `.dict` schema with all eight volatile fields, surviving
  bounds and defaults, the packed `dsh` manifest, and dependency resolution.
