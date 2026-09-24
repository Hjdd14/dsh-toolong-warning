# Pull request

## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem it solves, or the bug it fixes. -->

## Verification

<!-- Paste the actual output. "Should work" is not verification. -->

```
$ npm test
...
$ npm run check:hygiene
hygiene: clean — no personal paths, session ids, or credentials found
```

## Checklist

- [ ] `npm test` passes (all five suites)
- [ ] `npm run check:hygiene` passes — no personal paths, session ids, or credentials
- [ ] If the **decision rule** changed: a suite asserts both that it now warns where it should **and** that it still stays silent where it must
- [ ] If a **new user-visible string** was added: it exists in both `zh` and `en` (`scripts/test-i18n.mjs` enforces parity)
- [ ] If **host-side** code changed: I bumped `MODULE_GENERATION` in `src/routes.js` and noted that a new `dsh web` process is required
- [ ] If a **claim** was made about behaviour: it says how it was verified, and what was *not* verified
