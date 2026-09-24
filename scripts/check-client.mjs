/**
 * Structural self-check for the plugin bundle.
 *
 * Run with: node scripts/check-client.mjs
 *
 * `node --check` cannot validate `client.js`: it is an ESM file whose extension
 * is `.js` under a `"type": "module"` package, and Node's syntax checker
 * classifies `.js` as CommonJS in that mode only when the package type says so —
 * here it would reject the `window.__ModuleLoader__` classic-script shape that
 * the browser actually wants. So this script asserts the bundle's *structure*
 * (the contract `dsh-client-modules` enforces) by reading the file as text.
 *
 * Checks:
 * 1. `package.json` manifest fields the client loader requires.
 * 2. `cordis.patch.yml` shape.
 * 3. `client.js` module-loader envelope, id, factory exports and import hygiene.
 * 4. The host half loads and its `Config` validator behaves (defaults, clamping).
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ensureProfileEnv } from './profile-env.mjs'

// Must run before the plugin modules are imported: they resolve
// `@deepseek-ai/schemastery` from the profile, which a plain shell does not name.
const profileDir = ensureProfileEnv()

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

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

/**
 * Unwrap a `.volatile()` field's resolved value.
 *
 * schemastery validates a volatile field to a getter wrapper, not a plain value,
 * so a direct comparison would see an object and fail. The fallback descriptor
 * returns plain values; this accepts both.
 */
function plain(value) {
  if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
    try {
      return value.get()
    } catch {
      return undefined
    }
  }
  return value
}

const manifest = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

section('package.json: the client loader contract')
check('name matches the client module id', manifest.name, '@hjdd14/dsh-toolong-warning')
check('exports "." resolves the host half', manifest.exports['.'], './index.js')
check('exports "./client" resolves the browser half', manifest.exports['./client'], './client.js')
check('dsh.bundle.patch is declared', manifest.dsh.bundle.patch, './cordis.patch.yml')
check('dsh.client.platform is web (any other value is rejected by the scan)', manifest.dsh.client.platform, 'web')
check('dsh.client declares no bogus package dependencies', manifest.dsh.client.inject ?? [], [])
// Publishable on purpose: this package is meant to be installed from a registry,
// so `private` must be absent. It is the one flag that silently blocks publishing.
check('the package is publishable (not private)', manifest.private, undefined)
check('and declares a version', typeof manifest.version, 'string')
check('and a license', manifest.license, 'MIT')
check('and a repository, so npm can link back', typeof manifest.repository?.url, 'string')

section('cordis.patch.yml')
{
  const patch = await readFile(join(ROOT, 'cordis.patch.yml'), 'utf8')
  check('the patch inserts rows', /^- insert:/m.test(patch), true)
  check('the inserted row id matches the settings namespace', /id:\s*toolong-warning\b/.test(patch), true)
  check('the inserted row names this package', patch.includes("name: '@hjdd14/dsh-toolong-warning'"), true)
  check('the row config carries the three decision thresholds', ['compactCountMin', 'occupancyPercentMin', 'tokensSinceCompactionMin'].every((key) => patch.includes(key)), true)
}

section('client.js: module-loader envelope')
{
  const client = await readFile(join(ROOT, 'client.js'), 'utf8')
  check('registers exactly one module', client.split('window.__ModuleLoader__.load(').length - 1, 1)
  check('the id is the package name', client.includes("id: '@hjdd14/dsh-toolong-warning'"), true)
  check('the factory takes require', /factory\(require\)/.test(client), true)
  check('returns the cordis plugin object', /return \{\s*\n\s*inject:/.test(client), true)
  check('declares the inject table', /inject: \['slots', 'sessions', 'configForms'\]/.test(client), true)
  check('defines apply(ctx)', /apply\(ctx\) \{/.test(client), true)
  check('uses the shell React instance', client.includes("require('react')"), true)
  check('has no ESM import statements', /^\s*import\s/m.test(client), false)
  check('has no ESM export statements', /^\s*export\s/m.test(client), false)
  const requires = [...client.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1])
  const allowed = new Set(['react', 'react-dom/client'])
  check('imports nothing beyond the shell module table', requires.filter((name) => !allowed.has(name)), [])
  check('reads the host state route', client.includes('/api/dsh-toolong-warning'), true)
  check('declares the overlay seat it uses', client.includes("ctx.slots.inject('shell.overlay'"), true)
  check('declares the settings seat it uses', client.includes("ctx.slots.inject('settings.section'"), true)
  check('tags its stylesheet for HMR eviction', client.includes('data-dsh-toolong-warning-css'), true)
  check('marks its DOM with a plugin-scoped attribute', client.includes("'data-dsh-plugin': 'toolong-warning'"), true)
  check('does not touch another plugin\'s DOM markers', /data-dsh-(pet|usage|task-board|git-graph|skill)/.test(client), false)
}

section('index.js: host half exports')
{
  const mod = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  check('exports the plugin name', mod.name, 'toolong-warning')
  check('exports apply', typeof mod.apply, 'function')
  check('exports the required services', mod.inject, ['webServer', 'sessions', 'sessionProjections'])
  check('exports a Config descriptor', typeof mod.Config?.['~standard']?.validate, 'function')

  // The Settings page publishes a form only for an entry whose schema it can
  // walk (`volatileForm`): toJSON(), dict, and meta.volatile per field. A schema
  // missing any of those leaves the form permanently unavailable, which is
  // exactly what happened before this schema was rewritten — so assert them.
  const config = mod.Config
  check('the schema can serialize itself for the form', typeof config.toJSON, 'function')
  check('the schema exposes its fields', Object.keys(config.dict ?? {}).sort(), [
    'compactCountMin', 'dismissible', 'enabled', 'historyReadTimeoutMs', 'historyReadTtlMs',
    'occupancyPercentMin', 'statsIntervalMs', 'tokensSinceCompactionMin',
  ])
  check('every field is volatile', Object.values(config.dict).every((field) => field.meta?.volatile === true), true)
  check('numeric fields carry their min bound', config.dict.compactCountMin.meta.min, 1)
  check('numeric fields carry their max bound', config.dict.compactCountMin.meta.max, 20)
  check('numeric fields carry their step', config.dict.compactCountMin.meta.step, 1)
  check('the serialized schema is JSON-safe', typeof JSON.stringify(config.toJSON()), 'string')
  check('the real schemastery library resolved', (await import('../src/config.js')).usesSchemastery, true)

  const validate = config['~standard'].validate
  const defaults = validate({})
  check('an empty config validates', plain(defaults.value.enabled), true)
  check('default compaction count', plain(defaults.value.compactCountMin), 3)
  check('no issues for an empty config', defaults.issues, undefined)

  const rejected = validate({ compactCountMin: 999, occupancyPercentMin: -5 })
  check('out-of-range values are rejected, not kept', rejected.issues.length >= 1, true)
  check('and the rejected field does not ride the value', plain(rejected.value?.compactCountMin) ?? 'absent', 'absent')

  const badType = validate({ statsIntervalMs: 'soon' })
  check('a wrong type is rejected', badType.issues.length >= 1, true)

  const resolved = mod.resolveConfig({ compactCountMin: 999, statsIntervalMs: 'soon' })
  check('the resolver falls back to the default for a rejected number', resolved.config.compactCountMin, 3)
  check('and for a rejected type', resolved.config.statsIntervalMs, 15000)
  check('and reports the rejection', resolved.warnings.length >= 1, true)
  check('profile used for schema resolution', typeof profileDir === 'string' && profileDir.length > 0, true)
}

section('index.js: the plugin body mounts')
{
  const mod = await import(pathToFileURL(join(ROOT, 'index.js')).href)
  const registered = []
  const disposers = []
  const listeners = new Map()
  /** A context stub: `effect` records the disposer instead of running it. */
  const makeCtx = (sink) => ({
    logger: { warn() {}, info() {} },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, [])
      listeners.get(event).push(handler)
    },
    effect(factory) {
      const dispose = factory()
      disposers.push(() => {
        dispose?.()
        sink.disposed += 1
      })
    },
    /**
     * Cordis' optional-service injection. The host half uses it for
     * `sessionQuery` (the history source), so the stub must provide it: run the
     * callback with a context exposing the service and record every startup and
     * teardown so a leak would show up here.
     */
    inject(names, callback) {
      sink.injected = [...(sink.injected ?? []), ...names]
      const releases = []
      const child = {
        sessionQuery: { readSession: async () => ({ events: [] }) },
      }
      const result = callback(child)
      if (typeof result === 'function') releases.push(result)
      disposers.push(() => {
        for (const release of releases) release()
        sink.injected = (sink.injected ?? []).filter((name) => !names.includes(name))
      })
    },
    webServer: {
      register(route) {
        registered.push(route)
        return () => { sink.routesReleased += 1 }
      },
    },
    sessions: { get: () => undefined },
    sessionProjections: { stateOf: () => undefined },
  })

  const sink = { disposed: 0, routesReleased: 0 }
  mod.apply(makeCtx(sink), undefined)
  check('mounts both routes', registered.map((route) => route.path).sort(), [
    '/api/dsh-toolong-warning/health',
    '/api/dsh-toolong-warning/state',
  ])
  check('registers them as exact paths', registered.every((route) => route.kind === 'exact'), true)
  check('subscribes to the append feed', listeners.has('session/event'), true)
  check('subscribes to session disposal', listeners.has('session/disposed'), true)
  check('injects the optional history source', sink.injected, ['sessionQuery'])
  check('registers one disposer per resource group', disposers.length, 2)

  // Teardown must release both routes and the optional injection — a leaked
  // route would survive a disable.
  for (const dispose of disposers.splice(0)) dispose()
  check('teardown runs once per group', sink.disposed, 1)
  check('teardown releases both routes', sink.routesReleased, 2)
  check('teardown releases the optional injection', sink.injected, [])

  // A disabled row must mount nothing at all.
  const disabledRegistered = []
  const disabledSink = { disposed: 0, routesReleased: 0 }
  const disabledCtx = {
    ...makeCtx(disabledSink),
    webServer: { register(route) { disabledRegistered.push(route); return () => {} } },
  }
  mod.apply(disabledCtx, { enabled: false })
  check('a disabled row registers no routes', disabledRegistered, [])
  check('a disabled row registers no disposer', disabledSink.disposed, 0)

  // A rubbish config must not stop the mount; it clamps and continues.
  const messySink = { disposed: 0, routesReleased: 0 }
  const messyRegistered = []
  const messyCtx = {
    ...makeCtx(messySink),
    webServer: { register(route) { messyRegistered.push(route); return () => {} } },
  }
  mod.apply(messyCtx, { compactCountMin: 'many', occupancyPercentMin: 1000, unknownKey: true })
  check('a malformed config still mounts', messyRegistered.length, 2)
  check('and the resolver substitutes the default', mod.resolveConfig({ compactCountMin: 'many' }).config.compactCountMin, 3)
}

section('client.js: the bundle actually runs')
{
  // The bundle is a classic script that registers a lazy factory, but it is also
  // an ES module: it loads its own dictionary through `import('./src/i18n.js')`.
  // So it is imported for real here (which is how the shell imports it) with the
  // page globals and the module loader stubbed. Importing also proves the
  // dictionary module resolves and loads — a broken path would fail this test.
  let registered
  const styles = []
  const storage = (() => {
    const map = new Map()
    return {
      getItem: (key) => (map.has(key) ? map.get(key) : null),
      setItem: (key, value) => { map.set(key, String(value)) },
      removeItem: (key) => { map.delete(key) },
    }
  })()
  const moduleLoader = { load: (mod) => { registered = mod } }
  const fakeDocument = {
    head: { appendChild: (node) => styles.push(node) },
    documentElement: { lang: '' },
    querySelector: () => null,
    createElement: () => ({ setAttribute: () => {}, remove: () => {} }),
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  }
  const fakeWindow = {
    localStorage: storage,
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    __ModuleLoader__: moduleLoader,
  }
  // `globalThis` is the real global object, so defining these on it satisfies the
  // bare `window` / `document` identifiers the bundle uses.
  const installGlobals = new Function('window', 'document', 'globalThis', 'return globalThis')
  const globalScope = installGlobals(undefined, undefined, globalThis)
  globalScope.window = fakeWindow
  globalScope.document = fakeDocument

  await import(pathToFileURL(join(ROOT, 'client.js')).href)

  check('the bundle registered a module', registered !== undefined, true)
  check('with the package name as its id', registered.id, '@hjdd14/dsh-toolong-warning')

  const fakeReact = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
  }
  fakeReact.default = fakeReact
  const fakeReactDom = { createRoot: () => ({ render: () => {}, unmount: () => {} }) }
  const sandboxRequire = (name) => {
    if (name === 'react') return fakeReact
    if (name === 'react-dom/client') return fakeReactDom
    throw new Error(`unexpected require(${JSON.stringify(name)})`)
  }

  const plugin = registered.factory(sandboxRequire)
  check('the factory returned a plugin object', typeof plugin?.apply, 'function')
  check('declaring its services', plugin.inject, ['slots', 'sessions', 'configForms'])

  const injected = []
  const effects = []
  let sectionLabel
  // A minimal settings surface, so the settings section actually mounts and its
  // registration can be inspected. Without it the plugin correctly skips that
  // half, and this test would prove nothing about it.
  const fakeForm = {
    getSnapshot: () => ({ status: 'ready', writable: true, value: {}, revision: 0 }),
    subscribe: () => () => {},
    set: async () => true,
  }
  await plugin.apply({
    get: (name) => (name === 'configForms' ? { get: () => fakeForm } : undefined),
    on: () => {},
    effect: (factory) => { effects.push(factory()) },
    slots: {
      inject(name, register) {
        injected.push(name)
        return register()
      },
      register(options) {
        if (options.name === 'settings.section') sectionLabel = options.label
        return () => {}
      },
    },
  })
  check('it requests the overlay seat', injected.includes('shell.overlay'), true)
  check('it requests the settings seat', injected.includes('settings.section'), true)
  check('it tags its stylesheet for HMR eviction', styles.length, 1)
  check('and registers a disposer', effects.length >= 1, true)
  // The nav label is resolved at render time, which is what makes the row follow
  // the language switch instead of freezing at mount.
  check('the section label resolves through the dictionary', sectionLabel(), '长对话提醒')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed === 0 ? 0 : 1
