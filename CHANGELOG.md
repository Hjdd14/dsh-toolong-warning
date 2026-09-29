# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] — 2026-09-29

### Added

- **Desktop (Electron) adaptation for the floating window.** The DSH Desktop app is another
  surface over the same installation, and it owns the window chrome: a macOS top strip and
  its traffic lights, a Windows command bar with the caption buttons, or a content viewport
  moved below that bar. The window now treats the reserved band as unusable space in every
  one of those shapes:
  - its default top and the smallest top it can be dragged to are derived from the frame's
    own `--dsh-frame-overlay-top`, **minus whatever the shell already reserved** by moving
    its content viewport down — so a shell that layers chrome over content and a shell that
    moves the content below it each get the right answer, and neither is compensated twice;
  - the space it is clamped against is measured by an inert probe spanning its containing
    block, instead of assumed to be the window object. A shell whose content viewport starts
    below its command bar both shrinks that space and offsets the coordinate space the
    window's inline `left`/`top` are written in; before this, dragging there displaced the
    window by the height of the chrome on **every** drag, and the clamp reasoned about a
    viewport the window could not actually reach;
  - it stays out of the shell's `-webkit-app-region` computation, so a plugin layer can no
    longer silently cancel the window's own drag strips.
- **Desktop install instructions** in both READMEs, including why `dsh plugin --profile
  desktop add …` is refused (an application-owned profile is written by the app's in-process
  plugin manager) and the profile-file route that works instead.

### Notes

- **The Web page is untouched, and that is asserted rather than claimed.** No window chrome
  exists there, so the frame publishes no inset, the probe measures the viewport itself, the
  chrome floor is 0 and a drag lands exactly where it always did. The new unit tests cover
  all four compositions (browser, chrome over content, content moved below chrome, and both)
  and fail if any of them drifts or enters the chrome.
- **Browser-half only: no host change.** The desktop composition serves the same `/api`
  routes through the shell's request forwarding, the loopback fence is the ecosystem's shared
  copy unchanged, and the desktop page reports itself as loopback — so `moduleGeneration`
  stays `10`, no new `dsh web` process is required, and the bundle hot-reloads. `dsh.client.platform`
  stays `web`; that value *is* the desktop consumer's contract, not a web-only one.
- **No new dependency and no build step.** The `--dsh-frame-overlay-top` read is four lines
  rather than an import of `@deepseek-ai/dsh-client-ui-primitives`, because the bundle must
  stay self-contained (DSH serves it from an exact combo URL out of an in-memory response
  map) and `dsh.client.external` stays empty.
- **Storage stays per origin.** The desktop app and a page at `http://127.0.0.1:3080` keep
  separate language choices, window positions and browser-local threshold overrides. That was
  already true; it is now documented rather than discovered.
- `npm test` is **507 assertions, 0 failures**: 98 in `test-detect.mjs`, 133 in
  `test-i18n.mjs` (+29: the frame inset, the measured space, the chrome-aware default top,
  the drag-origin conversion, the clamp floor, and the end-to-end four-mode drag),
  49 in `test-coldread.mjs`, 98 in `test-routes.mjs` and 129 in `check-client.mjs`
  (+32: the desktop structural contract, including "a platform attribute is never turned
  into a compensation", plus ten assertions that run the floating window's real render
  path and check the Web default top). The four-mode drag assertion was reverse-checked:
  the pre-0.3.0 arithmetic lands a `+50/+40` drag at the wrong place whenever the shell
  moves its content viewport (measured: `y 124` for a pointer target of `y 88`).
- **What was and was not verified.** The suites above ran on this machine, and the running
  `web` host was probed (`/api/dsh-toolong-warning/health` → `moduleGeneration: 10`,
  `ok: true`, history source available). Nothing was verified **in a browser**: the `web`
  profile still has `0.1.1` installed from the registry, so that GUI serves neither this
  version nor 0.2.0 until the package is reinstalled. The Desktop app is not installed on
  this machine at all, so the desktop half is covered by those offline assertions and is not
  claimed as verified on a real shell — see `verification.md` for the exact checklist.

## [0.2.0] — 2026-09-29

### Added

- **The floating window is draggable.** Press anywhere on the card (except its own
  controls) and move it, so it no longer has to sit over the page's top-right
  content. The position is remembered per browser — the same scope as the language
  choice and the threshold override, and deliberately not a profile setting,
  because it describes one person's screen rather than the conversation.
- The window is kept **reachable**: a position is clamped so at least a grab-sized
  part stays on screen (allowing negative coordinates when the window is wider than
  the viewport, so its right-hand content is still reachable), and a moved window is
  pulled back after a resize, a rotation, or the warning card making it taller.
- The Settings section grows a **Reset window position** row as soon as the window
  has been moved, and only then.
- **`screenshots.json`** beside `package.json`, declaring the window screenshot
  (`docs/overlay.png`) for plugin-market storefronts. Screenshots are declared in
  the plugin's own repository, so changing them later needs no pull request on
  anyone else's repo.

### Notes

- Browser-half only: no host change, so no new `dsh web` process is required and
  `moduleGeneration` is unchanged. The bundle hot-reloads.
- The position helpers live in `src/i18n.js` and are duplicated into `client.js`
  for the usual reason (the bundle cannot import a sibling module). Both the copy's
  source text and its constants are compared by `scripts/test-i18n.mjs`, so a fix
  applied to one copy cannot silently miss the other.
- `npm test` is **446 assertions, 0 failures**: 98 in `test-detect.mjs`, 104 in
  `test-i18n.mjs`, 49 in `test-coldread.mjs`, 98 in `test-routes.mjs` and 97 in
  `check-client.mjs`. Three assertions in the schema section were merged into the
  contract checks below and one locale-dependent assertion was replaced by six that
  are not, so those counts moved by hand rather than by accident.

### Fixed

- **The fallback config descriptor now carries `meta.volatile`, the key the
  Settings form actually reads.** It previously set a `vol: true` shorthand, so on
  a host where `@deepseek-ai/schemastery` was not resolvable — the case the
  fallback exists for — `volatileForm` found no editable field and the plugin's
  Settings section came up empty. `schemastery` itself sets `meta.volatile`, and
  `@deepseek-ai/dsh-settings` reads exactly that name.
- **A rejected config no longer carries a `value`.** Under Standard Schema a failed
  validation reports `issues` alone; the fallback returned a partly repaired
  `value` beside them, which callers could mistake for a usable config.
- **The test suite no longer asserts anything about the machine it runs on.** Three
  assertions did, and every one of them failed in CI while passing on a developer
  box — which is how a red `main` went unnoticed through three runs:
  - *the real schemastery library resolved* — false wherever no profile is
    installed, and CI's workflow installs nothing on purpose. It also failed first,
    hiding the two fallback defects above.
  - *profile used for schema resolution* — same shape: it asserted that
    `~/.dsh/profiles/web` exists.
  - *the section label resolves through the dictionary* — the bundle picks its
    initial language from `navigator.languages`, and the suite never stubbed
    `navigator`, so on a Chinese developer machine the label was `长对话提醒` and on
    an `en-US` runner it was `Long-conversation reminder`. Node's `navigator` is a
    getter-only global, so it is now replaced with `Object.defineProperty` and
    restored afterwards. The language chain itself — explicit choice, then the
    harness locale, then the first supported browser language, then Chinese — is
    asserted directly on `src/i18n.js`, where no globals are involved. That the label
    is *driven* by the store rather than frozen is asserted by registering the
    section twice under two browser languages and requiring two different labels;
    replacing the label with a literal in `client.js` makes exactly that assertion
    fail, which is how it was checked.
  - The schema source and the profile in effect are now **printed** rather than
    asserted, so a run still says which object it checked.

## [0.1.1] — 2026-09-27

Version-only bump: `package.json` moved from `0.1.0` to `0.1.1` so the npm tarball
and the GitHub release (tag `v0.1.1`) carried a number that matched the code they ship.
No behavioural change — the commit's only diff is the version field, so the code is
identical to `0.1.0`.

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
- 440 offline assertions across five suites (`npm test`), plus a repository
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
