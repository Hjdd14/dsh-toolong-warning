# dsh-toolong-warning

**English** | [中文](README.zh.md)

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-374%20assertions-brightgreen.svg)](#tests)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.1.7--rc.1-6f42c1.svg)](#requirements)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933.svg)](https://nodejs.org)

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugin that warns when a
conversation has become **too long to be worth continuing** — and stays quiet otherwise.

It counts how many times each conversation has been **compacted**, shows that count in a floating
window at all times, and adds a warning only when compaction has happened **repeatedly** *and* the
conversation has since burned **a lot of extra tokens**.

> **The point of this plugin is what it does *not* say.** A reminder that cries wolf gets ignored,
> so every rule below is written to prefer silence whenever the data to justify a warning is missing.

<p align="center">
  <img src="docs/overlay.png" alt="The floating reminder window" width="480">
</p>

## Table of contents

- [What you see](#what-you-see)
- [When does it warn?](#when-does-it-warn)
- [Install](#install)
- [Settings](#settings)
- [How it works](#how-it-works)
- [Diagnostics](#diagnostics)
- [Requirements](#requirements)
- [Tests](#tests)
- [Privacy](#privacy)
- [Verification status](#verification-status)
- [License](#license)

## What you see

A self-owned floating window in the top-right corner. It uses the `shell.overlay` seat and falls back
to its own fixed container, so it never competes with another plugin for a slot:

```
┌──────────────────────────────┐
│ Long-conversation reminder – │
│ This conversation compacted  │
│ 3 time(s)                    │
└──────────────────────────────┘
┌──────────────────────────────┐
│ ⚠ This conversation is       │
│   getting long — consider    │
│   starting a new one         │
│ context occupancy has        │
│ reached 62%; about 310k      │
│ tokens were spent since the  │
│ last compaction              │
│ Compacted 3 time(s) so far   │
│ (threshold 3); current       │
│ context occupancy 62%        │
│ [Got it]  [Adjust thresholds]│
└──────────────────────────────┘
```

- The counter is **always** shown; the warning card appears only when the rule is met.
- **Got it** hides the current reminder only — the counter keeps updating.
- **Adjust thresholds** jumps to this plugin's section on the Settings page.
- Nothing is shown when the plugin is disabled or no conversation is open.
- The whole UI is **bilingual** (中文 / English), switchable from the plugin's own settings section —
  see [Settings](#settings).

## When does it warn?

All three conditions must hold. If any input is missing, the plugin stays silent.

| # | Condition | Default |
|---|---|---|
| 1 | **Completed compactions** — only a `compaction/start` paired with a `compaction/end` that carries no `error`. Failed compactions, in-progress compactions, and pure pruning (`compaction/prune`) never count. | ≥ 3 |
| 2 | **Extra spend since the last compaction** — billed tokens (`uncachedInput` + `cacheRead` + `cacheWrite` + `output`), accumulated from the usage samples the session log carries. | ≥ 200,000 |
| 3 | **Either** context occupancy (the next request's expected prompt ÷ the model's context window) **or** double the spend threshold — the second is the fallback for routes that declare no context window, which is why it is twice as hard to reach. | ≥ 50% **or** ≥ 400,000 |

### Cases where it deliberately stays silent

| Situation | Result |
|---|---|
| A very long, very expensive conversation that has **never** been compacted | silent — only the counter shows (`0`) |
| Two compactions only (default threshold is 3) | silent |
| Three compactions, but the window is roomy and nothing extra was spent | silent |
| Three compactions, 250k extra spend, low occupancy — past the threshold but not past the doubled one | silent |
| No usage data at all (even at 95% occupancy) | silent |
| The route declares no context window and the extra spend is low | silent |

Every one of those rows is asserted in `scripts/test-detect.mjs`, together with the rows that *must*
warn — the false-negative and false-positive directions are both pinned. A documented example: a
session with 2,100+ events, ~87M tokens spent and ~60% occupancy reported no warning at all, because
it had never been compacted (`gate: "compactions"`).

## Install

### Requirements

- dsh `>= 0.1.7-rc.1` (`@deepseek-ai/dsh`)
- Node `>= 22.19` (the test suites use modern built-ins)
- The `web` profile (this plugin has a browser half; it is a no-op on other surfaces)

### 1. From npm

```powershell
dsh plugin --profile web add @hjdd14/dsh-toolong-warning
```

### 2. From the Git repository

```powershell
dsh plugin --profile web add "git+https://github.com/Hjdd14/dsh-toolong-warning.git"
```

This plugin ships **hand-written JavaScript with no build step**, so pnpm has no
`prepare`/`postinstall` script to approve and the install does not stop for a build prompt. If a dsh
version reports a pending build script, add the key it prints under `allowBuilds` in
`<DSH_HOME>/profiles/web/pnpm-workspace.yaml` and re-run.

### 3. From a clone (development)

```powershell
git clone https://github.com/Hjdd14/dsh-toolong-warning.git
dsh plugin --profile web add "link:<absolute path to the clone>"
```

Editing `client.js` reloads the plugin in the browser within ~500 ms. Editing host-side files
(`index.js`, `src/*.js`) requires a new `dsh web` process — see [Diagnostics](#diagnostics).

### 4. By editing the profile by hand (when the CLI is unavailable)

In `<DSH_HOME>/profiles/web/package.json`:

```json
{
  "dsh": {
    "profile": {
      "bundles": ["...", "@hjdd14/dsh-toolong-warning"]
    }
  },
  "dependencies": {
    "@hjdd14/dsh-toolong-warning": "^0.1.0"
  }
}
```

Then run `pnpm install` inside `<DSH_HOME>/profiles/web` and restart `dsh web`.

### Install a prebuilt tarball

```powershell
npm pack                       # produces hjdd14-dsh-toolong-warning-0.1.0.tgz
dsh plugin --profile web add "file:<path to the tgz>"
```

### Uninstall

```powershell
dsh plugin --profile web remove @hjdd14/dsh-toolong-warning
```

Or disable it from the dsh web sidebar's **Plugins** page.

## Settings

The plugin's section on the Settings page holds the language switch and every threshold. Values are
written into the profile's cordis patch and take effect immediately.

| Field | Default | Range | Meaning |
|---|---|---|---|
| `enabled` | `true` | toggle | When off, no state route is registered and no window appears |
| `compactCountMin` | `3` | 1–20 | Completed compactions required before a warning is possible |
| `occupancyPercentMin` | `50` | 10–95 | Context occupancy above which the conversation counts as expensive |
| `tokensSinceCompactionMin` | `200000` | 10000–5000000 | Billed tokens spent after the last compaction before it counts as heavy waste; at **twice** this value the warning fires even without an occupancy figure |
| `statsIntervalMs` | `15000` | 5000–120000 | How often the window refreshes (polling pauses while the page is hidden) |
| `dismissible` | `true` | toggle | Whether **Got it** may hide the current reminder |
| `historyReadTtlMs` | `30000` | 5000–600000 | How long a history read for a session the host has not loaded is reused |
| `historyReadTimeoutMs` | `5000` | 1000–30000 | Time limit for one history read; on timeout the window reports that the session cannot be read yet |

The lower part of the section shows the **current session's measured values** (compactions, billed
tokens, spend since the last compaction, occupancy) and *why* the reminder is or is not firing —
which is what calibrating the thresholds needs.

### Language

A `中文 / English` selector in the same section. The choice is stored in the browser, applies to the
floating window and the settings section immediately (no reload), and is also pushed to the harness'
shared locale service when that service is writable — so on most deployments the rest of the UI
follows too. The global language control DSH itself ships lives in **Settings → General**.

### Two scopes of edit — and why

DSH fixes settings writes to read-only on a **non-loopback** page
(`persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'`), and that applies to *every*
plugin's configuration form, not just this one. Rather than showing dead controls, this plugin
degrades honestly:

| Page opened at | The three decision thresholds | `enabled` / `dismissible` |
|---|---|---|
| `http://127.0.0.1:3080` or `http://localhost:3080` (loopback) | written to the **profile configuration** — applies to every session | editable, written to the profile |
| anything else (IP, hostname, tunnel) | still editable, stored in **this browser**, applied to this page only | read-only (they decide whether the host registers the route) |

Browser-local values ride each state request as query parameters, are re-validated and **clamped by
the host on every request**, and are never persisted. Out-of-range or non-integer values are ignored
and reported back. The decision always happens on the host, so a page cannot force a warning.

## How it works

```
browser (client.js)                        host (index.js + src/*)
────────────────────                       ─────────────────────────
floating window                            ctx.on('session/event')  ── incremental fold (live)
  ├─ session catalog → main-view session     └─ first ask seeds that session's whole log
  ├─ poll /api/.../state every 15 s      ctx.sessionProjections
  └─ counter line + warning card            └─ tokenUsage / contextPressure
settings section                           ctx.sessionQuery.readSession(id)  ── history (cold)
  ├─ language switch                          └─ sessions the host has not loaded
  └─ ctx.configForms('toolong-warning')   two loopback-only, read-only routes
      8 volatile fields                       /api/dsh-toolong-warning/state   (per session)
                                              /api/dsh-toolong-warning/health  (probes)
```

### Three data sources, degrading in order

| # | Condition | Response | Notes |
|---|---|---|---|
| 1 | The session is **live** in this process | `source: "live"` | Full live metrics, including occupancy from the meter |
| 2 | Not loaded, but its log is readable | `source: "history"` | Count and spend folded from the log — this is why switching conversations shows a number without a page reload |
| 3 | Neither | `known: false` + `reason` | `session-not-loaded` or `history-unavailable`; **never warns** |

- The browser cannot see a session's event log (the client side only has the session catalog), so
  every measurement happens host-side and is served over a same-origin route.
- Both sources share the same folding and decision functions, so they must agree; `?selftest=1` makes
  the running process prove that on real sessions.
- The history source uses the supported read-only service and never reads private storage paths
  (`$DSH_HOME/storages/**`, session log files). It never inserts a session into the live tracker, is
  cached with a TTL, and is bounded by a timeout.
- The browser half is plain JavaScript registered through `dsh.client` + `exports["./client"]`; React
  comes from the shell's module table. It is deliberately self-contained: DSH serves client bundles
  from an exact combo URL out of an in-memory response map, so a sibling module can never be fetched
  and the dictionaries are inlined.
- The host half imports no `@deepseek-ai/*` runtime package except `@deepseek-ai/schemastery`, which
  the Settings form requires to be a real schema; it is loaded from an explicit candidate path and
  degrades to a structurally equivalent descriptor when unavailable.

## Diagnostics

Both routes are **loopback-only** (socket address *and* `Host` header *and* same-origin markers) and
always send `cache-control: no-store`.

```powershell
# Is it loaded, which generation is running, what are the effective thresholds?
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/health"

# Drive the real routes in the running process and compare against expected values.
# Runs two self-checks: a synthetic session through the whole decision chain, and a
# live-vs-history count comparison on real sessions.
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/health?selftest=1"

# One session's decision and raw numbers. debug=1 adds event-type statistics and the
# compaction lifecycle — never message content.
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/state?sessionId=<session id>&debug=1"
```

`state` fields: `known`, `source` (`live` / `history`), `count`, `lastCompactionSeq`,
`tokensSinceCompaction`, `billedTokens`, `occupancyRatio` / `projectedTokens` / `contextWindow`,
`shouldWarn`, `reasons`, `gate`, `thresholds`, `thresholdsSource`, `configVersion`, `sampledEvents`,
`droppedEvents`, `coldReads`.

**`moduleGeneration` is load-bearing.** Host-side changes only load in a new `dsh web` process — dsh
hot-reloads client bundles only. The generation counter exists so the running process can report
which code it is serving, rather than that being a matter of inference.

## Requirements

| | |
|---|---|
| dsh | `>= 0.1.7-rc.1` |
| Surface | the `web` profile (the browser half is a no-op elsewhere) |
| Optional | `@deepseek-ai/dsh-session-query` — enables the history source. Without it, sessions the host has not loaded simply stay unmeasured |
| Host dependency | `@deepseek-ai/schemastery` `~3.18.4` for the Settings form. The bare `schemastery` reachable from a profile is 3.18.0 and has **no** `.volatile()`, which silently makes the form unavailable |

## Tests

374 offline assertions, no harness and no network required:

```powershell
npm test
```

| Suite | Assertions | Covers |
|---|---|---|
| `scripts/test-detect.mjs` | 98 | The rule itself: every silent case and every warning case, the fold, config resolution |
| `scripts/test-i18n.mjs` | 58 | Dictionary parity between the two languages **and** between the module and the inlined bundle copy, placeholder substitution, fallback, initial-language resolution, the language store |
| `scripts/test-coldread.mjs` | 49 | The history fold, cache/revalidate/TTL, a fresh read bypassing the cache, timeout and failure degradation, agreement with the live fold |
| `scripts/test-routes.mjs` | 98 | Route assembly, the loopback fence, the self-test, threshold overrides, the history branch, and that a redelivered compaction event is never counted twice |
| `scripts/check-client.mjs` | 71 | Bundle structure, schema shape, plugin mounting, and really importing and running `client.js` |

```powershell
npm run check:hygiene   # repository privacy gate: no personal paths, session ids, or credentials
npm run check:release   # npm test + check:hygiene
```

## Privacy

- No personal paths, usernames, session ids, or credentials. Enforced, not promised:
  `npm run check:hygiene` scans every file and fails on a match.
- The plugin never reads private storage paths. History reads go through the supported `sessionQuery`
  service.
- The diagnostics routes are loopback-only and return no message content — the opt-in `debug` facet
  reports event *types* and the compaction lifecycle, not text.
- There are no build scripts, no telemetry, and no network calls beyond the same-origin routes above.

## Verification status

`verification.md` records what was verified, how, and what was not. In short:

- The decision rule is covered in both directions — every case that must stay silent and every case
  that must warn — plus a live self-test that drives the real routes inside the running process.
- Counts from the live fold and from the history fold are compared against each other on real
  sessions by that same self-test.
- The window's rendering is asserted structurally; its **appearance** has been confirmed visually by a
  screenshot rather than an automated visual check.
- The **settings form is read-only on a non-loopback page** by DSH's design. The browser-local
  threshold override exists to make that limitation livable; it is not a substitute for writing to the
  profile.

## License

[MIT](LICENSE) © 2026 Hjdd14
