/**
 * Browser half of `@hjdd14/dsh-toolong-warning`.
 *
 * Registered as a lazy client module whose id equals the package name; the node
 * half of `@deepseek-ai/dsh-client-modules` discovers it from `package.json`
 * `dsh.client` and serves this file. React comes from the shell's module table,
 * so this is plain JavaScript (no JSX, no build step).
 *
 * **This file must be self-contained.** The bundle route serves only the exact
 * combo URL it composed (`/plugins/??<pkg>/client.js&rev=…`) out of an in-memory
 * response map — it is not a file server, so a sibling module such as
 * `src/i18n.js` can never be fetched, and a relative import would 404 at runtime
 * while still parsing fine. The dictionaries are therefore inlined here, and
 * `src/i18n.js` holds the same strings for the host-side tests plus the shared
 * helpers; `scripts/test-i18n.mjs` asserts the two copies are identical, so a
 * string cannot be translated in one place and forgotten in the other.
 *
 * What it renders:
 * - a floating reminder window (top-right) that always shows how many times the
 *   current conversation has been compacted, and adds a warning line only once
 *   the host's measured state justifies it;
 * - the plugin's section on the Settings page, where the thresholds that gate
 *   that warning are edited, and where the UI language is switched.
 *
 * All measurement happens host-side; this half only polls and renders, so a
 * browser-side mistake can never produce a wrong count or a premature warning.
 */

window.__ModuleLoader__.load({
  id: '@hjdd14/dsh-toolong-warning',
  factory(require) {
    const React = require('react')
    const ReactDOMClient = require('react-dom/client')
    const h = React.createElement

    // -----------------------------------------------------------------------
    // Localization. See the note at the top: this is inlined on purpose.
    // -----------------------------------------------------------------------

    /** Languages this plugin ships; `en` is the fallback for everything else. */
    const LANGUAGES = Object.freeze(['zh', 'en'])
    /** Where the language choice is stored. */
    const LANGUAGE_KEY = 'dsh-toolong-warning.language.v1'
    /** Human label for each language, shown in its own script. */
    const LANGUAGE_LABELS = Object.freeze({ zh: '中文', en: 'English' })

    /**
     * Every user-visible string, in both languages. Identical to the copy in
     * `src/i18n.js` — `scripts/test-i18n.mjs` compares them and fails on any
     * difference, which is what keeps a hand-written bundle honest.
     */
    const MESSAGES = Object.freeze({
      zh: Object.freeze({
        'overlay.title': '长对话提醒',
        'overlay.collapsedWarningTitle': '⚠ 长对话提醒',
        'overlay.countBefore': '本会话已压缩 ',
        'overlay.countAfter': ' 次',
        'overlay.collapsedCountBefore': '已压缩 ',
        'overlay.collapsedCountAfter': ' 次',
        'overlay.statusSyncing': '（宿主状态同步失败，正在重试）',
        'overlay.reading': '（正在读取该会话…）',
        'overlay.localThresholds': '浏览器本地阈值已生效：压缩 ≥ {count} 次、占用 ≥ {occupancy}%、额外消耗 ≥ {spend}（仅本浏览器）',
        'overlay.historyNote': '依据：历史记录（该会话未在宿主中运行，计数来自其日志）',
        'overlay.collapse': '收起',
        'overlay.collapseAria': '收起长对话提醒',
        'overlay.expand': '展开',

        'warn.title': '⚠ 本次对话过长，建议新开一个对话',
        'warn.reasonOccupancy': '上下文占用已达 {occupancy}',
        'warn.reasonHeavySpend': '距上次压缩又消耗了约 {spend} token（超过设定阈值的两倍）',
        'warn.reasonSpend': '距上次压缩又消耗了约 {spend} token',
        'warn.reasonFallback': '本次对话已多次压缩，继续下去的 token 成本会越来越高。',
        'warn.summary': '已成功压缩 {count} 次（阈值 {threshold} 次）；{occupancy}',
        'warn.occupancyKnown': '当前上下文占用 {occupancy}',
        'warn.occupancyUnknown': '当前上下文占用未知',
        'warn.fromHistory': '；依据为历史记录',
        'warn.dismiss': '知道了',
        'warn.adjust': '调整阈值',
        'warn.adjustTitle': '在设置页调整触发阈值',

        'gate.data': '缺少用量数据',
        'gate.compactions': '压缩次数不足',
        'gate.spend': '额外消耗不足',
        'gate.pressure': '未达到占用或额外消耗门槛',
        'gate.none': '未触发',

        'settings.title': '长对话提醒',
        'settings.intro': '只有在真的不划算时才提醒：必须先成功压缩够多次，并且此后确实又消耗了大量 token；任何一项数据缺失都不会提醒，以免误报。',
        'settings.language': '语言 / Language',
        'settings.languageHint': '切换后本插件的悬浮窗与设置页立即跟随；选择保存在本浏览器。',
        'settings.writeModeProfile': '数值修改后写入本 profile 的配置并立即生效（对所有会话生效）。',
        'settings.writeModeLocal': '当前页面不是通过回环地址打开的，DSH 因此把配置写入固定为只读（对任何插件的表单都一样）。下面三个阈值仍可修改，但只保存在本浏览器并对本页生效{countHint}；要让所有会话生效，请改用 http://127.0.0.1:3080 或 http://localhost:3080 打开页面。',
        'settings.localCountHint': '（已设置 {count} 项）',
        'settings.readingHostConfig': '正在读取宿主配置…',
        'settings.hostConfigUnavailable': '宿主配置当前不可读，下面显示的是代码内默认值。',
        'settings.enabledLabel': '启用长对话提醒',
        'settings.enabledDescription': '关闭后不再注册状态接口，也不再显示悬浮提醒窗。',
        'settings.enabledCurrentlyOff': '当前已关闭：宿主不会注册状态接口，悬浮窗也不会出现。',
        'settings.profileOnly': '这个开关属于 profile 配置，只能在回环地址的页面上修改。',
        'settings.dismissibleLabel': '允许手动关闭本次提醒',
        'settings.dismissibleDescription': '开启后悬浮窗上的「知道了」可以隐藏当前这次提醒；计数行始终显示。',
        'settings.saveFailed': '保存失败：{error}',
        'settings.rejectedByHost': '宿主拒绝了这次写入（可能被更高优先级的配置层覆盖）',
        'settings.localStorageFailed': '无法写入浏览器本地存储，本次修改没有生效',
        'settings.defaults': '默认 {default}，取值范围 {min}–{max}',

        'settings.field.compactCountMin': '触发提醒所需的最少压缩次数',
        'settings.field.compactCountMin.desc': '只有成功完成的压缩才计数：压缩失败、正在进行中的压缩都不计。',
        'settings.field.occupancyPercentMin': '上下文占用提醒阈值（%）',
        'settings.field.occupancyPercentMin.desc': '上下文占用 = 下一次请求预计消耗 / 模型上下文窗口。',
        'settings.field.tokensSinceCompactionMin': '距上次压缩的额外消耗阈值（token）',
        'settings.field.tokensSinceCompactionMin.desc': '上一次成功压缩之后再累计消耗多少计费 token 才算“大量多余消耗”。达到该值的两倍时，即使拿不到上下文占用也会提醒。',
        'settings.field.statsIntervalMs': '悬浮窗刷新间隔（毫秒）',
        'settings.field.statsIntervalMs.desc': '页面不可见时暂停轮询。',
        'settings.field.historyReadTtlMs': '历史读取缓存时长（毫秒）',
        'settings.field.historyReadTtlMs.desc': '宿主没加载的会话靠读历史日志取计数；这是该结果的缓存时长。越小越实时、磁盘读越多。',
        'settings.field.historyReadTimeoutMs': '历史读取超时（毫秒）',
        'settings.field.historyReadTimeoutMs.desc': '单次读历史日志的时限，超时按“读不到”处理并退回“尚未加载”提示。',

        'stats.title': '当前会话实测',
        'stats.empty': '尚无可测量的会话数据（在主页签打开一个会话后，这里会显示实测值）。',
        'stats.compactions': '已成功压缩',
        'stats.compactionsValue': '{count} 次',
        'stats.billed': '计费 token 累计',
        'stats.sinceCompaction': '距上次压缩又消耗',
        'stats.unknown': '未知',
        'stats.occupancy': '上下文占用',
        'stats.occupancyUnknown': '未知（该模型未声明上下文窗口）',
        'stats.shouldWarn': '是否提醒',
        'stats.yes': '是',
        'stats.no': '否（{gate}）',
      }),
      en: Object.freeze({
        'overlay.title': 'Long-conversation reminder',
        'overlay.collapsedWarningTitle': '⚠ Long-conversation reminder',
        'overlay.countBefore': 'This conversation compacted ',
        'overlay.countAfter': ' time(s)',
        'overlay.collapsedCountBefore': 'Compacted ',
        'overlay.collapsedCountAfter': ' time(s)',
        'overlay.statusSyncing': ' (host sync failed; retrying)',
        'overlay.reading': ' (reading this conversation…)',
        'overlay.localThresholds': 'Browser-local thresholds active: compactions ≥ {count}, occupancy ≥ {occupancy}%, extra spend ≥ {spend} (this browser only)',
        'overlay.historyNote': 'Source: history (this session is not running in the host; the count comes from its log)',
        'overlay.collapse': 'Collapse',
        'overlay.collapseAria': 'Collapse the long-conversation reminder',
        'overlay.expand': 'Expand',

        'warn.title': '⚠ This conversation is getting long — consider starting a new one',
        'warn.reasonOccupancy': 'context occupancy has reached {occupancy}',
        'warn.reasonHeavySpend': 'about {spend} tokens were spent since the last compaction (more than double the configured threshold)',
        'warn.reasonSpend': 'about {spend} tokens were spent since the last compaction',
        'warn.reasonFallback': 'This conversation has been compacted several times; continuing will keep getting more expensive.',
        'warn.summary': 'Compacted {count} time(s) so far (threshold {threshold}); {occupancy}',
        'warn.occupancyKnown': 'current context occupancy {occupancy}',
        'warn.occupancyUnknown': 'current context occupancy unknown',
        'warn.fromHistory': '; based on history',
        'warn.dismiss': 'Got it',
        'warn.adjust': 'Adjust thresholds',
        'warn.adjustTitle': 'Adjust the trigger thresholds on the Settings page',

        'gate.data': 'no usage data',
        'gate.compactions': 'not enough compactions',
        'gate.spend': 'not enough extra spend',
        'gate.pressure': 'below the occupancy and spend thresholds',
        'gate.none': 'not triggered',

        'settings.title': 'Long-conversation reminder',
        'settings.intro': 'It only speaks up when the conversation is genuinely not worth continuing: enough completed compactions, and a real amount of tokens spent since the last one. If any input is missing it stays silent rather than guessing.',
        'settings.language': '语言 / Language',
        'settings.languageHint': 'Switches this plugin\'s floating window and settings immediately; the choice is stored in this browser.',
        'settings.writeModeProfile': 'Edited values are written to this profile\'s configuration and take effect at once (for every session).',
        'settings.writeModeLocal': 'This page was not opened over a loopback address, so DSH fixes configuration writes to read-only (true for every plugin\'s form). The three thresholds below are still editable, but are stored in this browser and apply to this page only{countHint}; to apply them everywhere, open the page at http://127.0.0.1:3080 or http://localhost:3080.',
        'settings.localCountHint': ' ({count} set)',
        'settings.readingHostConfig': 'Reading the host configuration…',
        'settings.hostConfigUnavailable': 'The host configuration is not readable right now; the values below are the built-in defaults.',
        'settings.enabledLabel': 'Enable the long-conversation reminder',
        'settings.enabledDescription': 'When off, no state route is registered and no floating window appears.',
        'settings.enabledCurrentlyOff': 'Currently off: the host registers no state route and the window does not appear.',
        'settings.profileOnly': 'This switch is profile configuration and can only be changed from a loopback page.',
        'settings.dismissibleLabel': 'Allow dismissing this reminder',
        'settings.dismissibleDescription': 'When on, “Got it” on the floating window hides the current reminder; the counter keeps updating.',
        'settings.saveFailed': 'Save failed: {error}',
        'settings.rejectedByHost': 'The host rejected this write (a higher-priority configuration layer may override it)',
        'settings.localStorageFailed': 'Could not write to browser storage; the change did not take effect',
        'settings.defaults': 'Default {default}, range {min}–{max}',

        'settings.field.compactCountMin': 'Minimum completed compactions before warning',
        'settings.field.compactCountMin.desc': 'Only completed compactions count: failed compactions and ones still in progress do not.',
        'settings.field.occupancyPercentMin': 'Context occupancy threshold (%)',
        'settings.field.occupancyPercentMin.desc': 'Occupancy = the next request\'s expected prompt size / the model\'s context window.',
        'settings.field.tokensSinceCompactionMin': 'Extra spend since the last compaction (tokens)',
        'settings.field.tokensSinceCompactionMin.desc': 'How many billed tokens must be spent after the last completed compaction to count as heavy waste. At twice this value the reminder fires even without an occupancy figure.',
        'settings.field.statsIntervalMs': 'Floating-window refresh interval (ms)',
        'settings.field.statsIntervalMs.desc': 'Polling pauses while the page is hidden.',
        'settings.field.historyReadTtlMs': 'History-read cache duration (ms)',
        'settings.field.historyReadTtlMs.desc': 'Sessions the host has not loaded are counted by reading their log; this is how long that result is reused. Smaller is fresher and reads the disk more.',
        'settings.field.historyReadTimeoutMs': 'History-read timeout (ms)',
        'settings.field.historyReadTimeoutMs.desc': 'Time limit for one history read; on timeout it is treated as unreadable and the window falls back to “not loaded yet”.',

        'stats.title': 'Current session, measured',
        'stats.empty': 'No measurable session data yet (open a conversation in the main tab and the real values appear here).',
        'stats.compactions': 'Completed compactions',
        'stats.compactionsValue': '{count}',
        'stats.billed': 'Billed tokens, cumulative',
        'stats.sinceCompaction': 'Spent since the last compaction',
        'stats.unknown': 'unknown',
        'stats.occupancy': 'Context occupancy',
        'stats.occupancyUnknown': 'unknown (this model declares no context window)',
        'stats.shouldWarn': 'Would warn',
        'stats.yes': 'yes',
        'stats.no': 'no ({gate})',
      }),
    })

    /**
     * Translate one key, falling back from the requested language to English to
     * the key itself, so a missing string degrades to something visible rather
     * than to `undefined`.
     */
    function t(lang, key, params) {
      const table = MESSAGES[lang] ?? MESSAGES.en
      const template = table[key] ?? MESSAGES.en[key] ?? key
      if (params === undefined) return template
      return template.replace(/\{(\w+)\}/g, (match, name) => (
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
      ))
    }

    /** Normalize anything to a supported language id. */
    function normalizeLanguage(value) {
      if (typeof value !== 'string') return undefined
      const lower = value.trim().toLowerCase()
      if (lower === '') return undefined
      if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh'
      if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en'
      return undefined
    }

    /**
     * Create the language store shared by the floating window and the settings
     * card: one value, two subscribers, plus the harness' shared locale service
     * followed on a best-effort basis.
     */
    function createLanguageStore(options) {
      const ctx = options?.ctx
      const storage = options?.storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
      const languages = options?.languages
        ?? (typeof navigator === 'undefined' ? undefined : (navigator.languages ?? navigator.language))

      const read = () => {
        try {
          return storage?.getItem(LANGUAGE_KEY) ?? undefined
        } catch {
          return undefined
        }
      }
      const sharedLocale = () => {
        try {
          return ctx?.get?.('locale')
        } catch {
          return undefined
        }
      }

      let value = (() => {
        const explicit = normalizeLanguage(read())
        if (explicit !== undefined) return explicit
        try {
          const fromLocale = normalizeLanguage(sharedLocale()?.getSnapshot?.()?.active)
          if (fromLocale !== undefined) return fromLocale
        } catch {
          // A locale service that cannot answer must not stop the window rendering.
        }
        for (const candidate of Array.isArray(languages) ? languages : [languages]) {
          const match = normalizeLanguage(candidate)
          if (match !== undefined) return match
        }
        return 'zh'
      })()
      const listeners = new Set()

      const mirror = () => {
        try {
          if (typeof document !== 'undefined' && document.documentElement !== undefined) {
            document.documentElement.lang = value
          }
        } catch {
          // A missing DOM is not an error here.
        }
      }
      mirror()

      return {
        get: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(next) {
          const normalized = normalizeLanguage(next)
          if (normalized === undefined) return false
          let stored = true
          try {
            storage?.setItem(LANGUAGE_KEY, normalized)
          } catch {
            stored = false
          }
          value = normalized
          mirror()
          // Best effort: when the harness' shared locale service is present and
          // writable, switch the whole UI with us. A refusal is not our failure.
          try {
            const locale = sharedLocale()
            if (locale !== undefined && typeof locale.setLocale === 'function') locale.setLocale(normalized)
          } catch (error) {
            console.warn('[toolong-warning] shared locale could not follow the plugin language:', error)
          }
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch {
              // One failing listener must not stop the others.
            }
          }
          return stored
        },
        available: () => LANGUAGES,
      }
    }

    /** Host route prefix; the page's own origin serves it. */
    const API = '/api/dsh-toolong-warning'
    /** Settings namespace = this plugin's profile entry id. */
    const SETTINGS_NS = 'toolong-warning'
    /** Where the browser-local threshold override lives. */
    const OVERRIDE_KEY = 'dsh-toolong-warning.thresholds.v1'

    /**
     * The decision fields a browser may carry as its own override, with the same
     * bounds the host schema enforces (kept in sync with `src/config.js`).
     */
    const OVERRIDE_FIELDS = {
      compactCountMin: { min: 1, max: 20 },
      occupancyPercentMin: { min: 10, max: 95 },
      tokensSinceCompactionMin: { min: 10000, max: 5000000 },
    }

    /** Read the browser-local threshold override, dropping anything malformed. */
    function readOverride() {
      try {
        const raw = window.localStorage.getItem(OVERRIDE_KEY)
        if (raw === null || raw === '') return {}
        const parsed = JSON.parse(raw)
        if (parsed === null || typeof parsed !== 'object') return {}
        const out = {}
        for (const [name, bounds] of Object.entries(OVERRIDE_FIELDS)) {
          const value = parsed[name]
          if (typeof value === 'number' && Number.isInteger(value) && value >= bounds.min && value <= bounds.max) {
            out[name] = value
          }
        }
        return out
      } catch {
        return {}
      }
    }

    /** Persist the browser-local threshold override; false when it cannot store. */
    function writeOverride(next) {
      try {
        if (Object.keys(next).length === 0) window.localStorage.removeItem(OVERRIDE_KEY)
        else window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(next))
        return true
      } catch {
        return false
      }
    }

    /**
     * One shared override value, so the settings card and the overlay re-render
     * together when a threshold changes.
     */
    function createOverrideStore() {
      let value = readOverride()
      const listeners = new Set()
      return {
        get: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        set(field, next) {
          const candidate = { ...value }
          if (next === undefined) delete candidate[field]
          else candidate[field] = next
          if (!writeOverride(candidate)) return false
          value = candidate
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch {
              // One failing listener must not stop the others.
            }
          }
          return true
        },
      }
    }

    /** Local copy of the defaults, used before the host's config is readable. */
    const FALLBACK_THRESHOLDS = {
      enabled: true,
      compactCountMin: 3,
      occupancyPercentMin: 50,
      tokensSinceCompactionMin: 200000,
      statsIntervalMs: 15000,
      dismissible: true,
    }
    /**
     * Field descriptors for the Settings card: identity, bounds and defaults
     * only. Titles and descriptions are translated through `src/i18n.js`, so the
     * two languages cannot drift apart or be silently left untranslated.
     */
    const FIELDS = [
      { name: 'compactCountMin', type: 'integer', default: 3, min: 1, max: 20 },
      { name: 'occupancyPercentMin', type: 'integer', default: 50, min: 10, max: 95 },
      { name: 'tokensSinceCompactionMin', type: 'integer', default: 200000, min: 10000, max: 5000000 },
      { name: 'statsIntervalMs', type: 'integer', default: 15000, min: 5000, max: 120000 },
      { name: 'historyReadTtlMs', type: 'integer', default: 30000, min: 5000, max: 600000 },
      { name: 'historyReadTimeoutMs', type: 'integer', default: 5000, min: 1000, max: 30000 },
    ]

    const STYLE_TEXT = `
.dsh-tlw-overlay{position:fixed;top:12px;right:14px;z-index:60;display:flex;flex-direction:column;gap:8px;max-width:min(360px,calc(100vw - 28px));font-size:12px;line-height:1.5;pointer-events:none}
.dsh-tlw-overlay>*{pointer-events:auto}
.dsh-tlw-card{box-sizing:border-box;background:var(--dsw-alias-bg-layer-3,#1b1f2a);color:var(--dsw-alias-label-primary,#e8ecf5);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));border-radius:10px;padding:8px 10px;box-shadow:0 6px 20px rgba(0,0,0,.28);backdrop-filter:blur(6px)}
.dsh-tlw-head{display:flex;align-items:center;gap:6px}
.dsh-tlw-title{font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-tlw-close{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,#8b93a7);cursor:pointer;font:inherit;padding:0 4px;border-radius:4px}
.dsh-tlw-close:hover{color:var(--dsw-alias-label-primary,#e8ecf5)}
.dsh-tlw-count{margin-top:4px;color:var(--dsw-alias-label-secondary,#aab2c5)}
.dsh-tlw-count b{color:var(--dsw-alias-label-primary,#e8ecf5);font-variant-numeric:tabular-nums}
.dsh-tlw-warn-title{font-weight:600;color:var(--dsw-alias-state-warn-primary,#d08a00)}
.dsh-tlw-warn-card{border-color:var(--dsw-alias-state-warn-primary,#d08a00)}
.dsh-tlw-body{margin-top:2px}
.dsh-tlw-note{margin-top:4px;color:var(--dsw-alias-label-tertiary,#8b93a7)}
.dsh-tlw-actions{margin-top:6px;display:flex;gap:6px}
.dsh-tlw-btn{appearance:none;font:inherit;cursor:pointer;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.14));background:transparent;color:inherit;padding:2px 8px}
.dsh-tlw-btn:hover{border-color:var(--dsw-alias-label-dimmed,#7c8599)}
.dsh-tlw-section{display:flex;flex-direction:column;gap:10px}
.dsh-tlw-card-title{font-weight:600;font-size:14px}
.dsh-tlw-grid{display:grid;grid-template-columns:1fr;gap:10px}
.dsh-tlw-field{display:flex;flex-direction:column;gap:3px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.12));border-radius:8px;padding:8px 10px;background:var(--dsw-alias-bg-layer-3,transparent)}
.dsh-tlw-field-head{display:flex;align-items:center;gap:8px}
.dsh-tlw-field-head label{font-weight:600}
.dsh-tlw-field input[type=number]{width:130px;box-sizing:border-box;font:inherit;padding:2px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit}
.dsh-tlw-field input[type=checkbox]{width:16px;height:16px}
.dsh-tlw-select{font:inherit;padding:2px 6px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.16));background:var(--dsw-alias-bg-layer-2,transparent);color:inherit;min-width:120px}
.dsh-tlw-desc{color:var(--dsw-alias-label-secondary,#aab2c5)}
.dsh-tlw-muted{color:var(--dsw-alias-label-tertiary,#8b93a7)}
.dsh-tlw-error{color:var(--dsw-alias-state-error-primary,#e5484d)}
.dsh-tlw-diagnostics{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:0;font-variant-numeric:tabular-nums}
.dsh-tlw-diagnostics dt{color:var(--dsw-alias-label-secondary,#aab2c5)}
.dsh-tlw-diagnostics dd{margin:0}
`

    /** Compact token count: 12345 -> 12.3k, 1234567 -> 1.23M. */
    function formatTokens(value) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return '0'
      if (value < 1000) return String(Math.round(value))
      if (value < 1000000) return trim(value / 1000) + 'k'
      return trim(value / 1000000) + 'M'
    }

    function trim(value) {
      const rounded = value >= 100 ? String(Math.round(value)) : value.toFixed(value >= 10 ? 1 : 2)
      return rounded.replace(/\.?0+$/, '')
    }

    function formatPercent(ratio, lang) {
      if (typeof ratio !== 'number' || !Number.isFinite(ratio)) return t(lang, 'stats.unknown')
      const percent = ratio * 100
      return (percent >= 10 ? String(Math.round(percent)) : percent.toFixed(1)) + '%'
    }

    /** The warning sentence, assembled from the host's machine-readable reasons. */
    function reasonText(state, lang) {
      const reasons = Array.isArray(state.reasons) ? state.reasons : []
      const parts = []
      if (reasons.indexOf('high-occupancy') !== -1) {
        parts.push(t(lang, 'warn.reasonOccupancy', { occupancy: formatPercent(state.occupancyRatio, lang) }))
      }
      if (reasons.indexOf('heavy-extra-spend') !== -1) {
        parts.push(t(lang, 'warn.reasonHeavySpend', { spend: formatTokens(state.tokensSinceCompaction) }))
      } else if (reasons.indexOf('extra-spend') !== -1) {
        parts.push(t(lang, 'warn.reasonSpend', { spend: formatTokens(state.tokensSinceCompaction) }))
      }
      if (parts.length === 0) return t(lang, 'warn.reasonFallback')
      // Chinese joins clauses with a full-width comma and ends with a period;
      // English uses a comma and a period.
      return lang === 'zh' ? parts.join('，') + '。' : parts.join(', ') + '.'
    }

    /** Human-readable explanation of the gate that kept the reminder silent. */
    function gateText(gate, lang) {
      switch (gate) {
        case 'data': return t(lang, 'gate.data')
        case 'compactions': return t(lang, 'gate.compactions')
        case 'spend': return t(lang, 'gate.spend')
        case 'pressure': return t(lang, 'gate.pressure')
        default: return t(lang, 'gate.none')
      }
    }

    /** Inject the stylesheet once, tagged so client HMR can evict it. */
    function ensureStyles() {
      if (typeof document === 'undefined') return
      if (document.querySelector('style[data-dsh-toolong-warning-css]') !== null) return
      const style = document.createElement('style')
      style.setAttribute('data-plugin', '@hjdd14/dsh-toolong-warning')
      style.setAttribute('data-dsh-toolong-warning-css', '')
      style.textContent = STYLE_TEXT
      document.head.appendChild(style)
    }

    /**
     * Read the session catalog's main-view session id.
     * The catalog row's `retainedBy.mainView` count is the only selection marker
     * the client publishes (the same derivation the task-board plugin uses).
     */
    function mainViewSessionId(byId) {
      if (byId === null || byId === undefined) return undefined
      for (const row of Object.values(byId)) {
        if (row !== null && row !== undefined && (row.retainedBy?.mainView ?? 0) > 0) return row.id
      }
      return undefined
    }

    /** Subscribe to the main-view session selection; no session when absent. */
    function useMainSessionId(ctx) {
      const sessions = ctx.get('sessions')
      const list = sessions?.list
      const subscribe = React.useCallback(
        (listener) => (typeof list?.subscribe === 'function' ? list.subscribe(listener) : () => {}),
        [list],
      )
      const getSnapshot = React.useCallback(() => mainViewSessionId(list?.getSnapshot?.()?.byId), [list])
      return React.useSyncExternalStore(subscribe, getSnapshot)
    }

    /**
     * Poll the host for one session's compaction state.
     *
     * `override` rides the query string: DSH keeps the settings *form* read-only on
     * a non-loopback page, so a browser that is not on localhost carries its own
     * bounded thresholds here. The host clamps them again on every request.
     * @returns `{ state, status }` with status 'loading' | 'ready' | 'error'.
     */
    function useWarningState(sessionId, intervalMs, enabled, override) {
      const [state, setState] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const overrideKey = JSON.stringify(override ?? {})
      React.useEffect(() => {
        // Switching conversations must not keep showing the previous one's numbers
        // or its warning while the new session's state is in flight.
        setState(null)
        setStatus('loading')
        if (!enabled || sessionId === undefined) return undefined
        let alive = true
        let timer
        const active = JSON.parse(overrideKey)
        const query = Object.entries(active)
          .map(([name, value]) => `&${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
          .join('')
        const load = () => {
          fetch(`${API}/state?sessionId=${encodeURIComponent(sessionId)}${query}`, { signal: AbortSignal.timeout(10000) })
            .then((response) => {
              if (!response.ok) throw new Error('HTTP ' + String(response.status))
              return response.json()
            })
            .then((payload) => {
              if (!alive) return
              setState(payload)
              setStatus('ready')
            })
            .catch(() => {
              if (!alive) return
              setStatus((previous) => (previous === 'ready' ? 'ready' : 'error'))
            })
        }
        const start = () => {
          if (timer !== undefined) return
          load()
          timer = window.setInterval(load, intervalMs)
        }
        const stop = () => {
          if (timer === undefined) return
          window.clearInterval(timer)
          timer = undefined
        }
        const onVisibility = () => {
          if (document.visibilityState === 'visible') start()
          else stop()
        }
        start()
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          alive = false
          stop()
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [sessionId, intervalMs, enabled, overrideKey])
      return { state, status }
    }

    /**
     * The always-visible floating window. Shows the compaction count whenever a
     * conversation is open in the main view, and adds the warning card only
     * while the host's measured state meets the thresholds.
     */
    function LongConversationOverlay(props) {
      const { ctx, thresholds, form, formRevision, overrideStore, languageStore } = props
      const sessionId = useMainSessionId(ctx)
      const override = React.useSyncExternalStore(overrideStore.subscribe, overrideStore.get)
      const lang = React.useSyncExternalStore(languageStore.subscribe, languageStore.get)
      /** Translate in the language currently selected. */
      const tr = (key, params) => t(lang, key, params)
      const intervalMs = typeof thresholds.statsIntervalMs === 'number' ? thresholds.statsIntervalMs : 15000
      const { state, status } = useWarningState(sessionId, intervalMs, thresholds.enabled !== false, override)
      const [dismissedFor, setDismissedFor] = React.useState(null)
      const [collapsed, setCollapsed] = React.useState(false)

      if (thresholds.enabled === false) return null
      if (sessionId === undefined) return null

      const count = typeof state?.count === 'number' ? state.count : null
      const shouldWarn = state?.shouldWarn === true && dismissedFor !== sessionId
      const hostThresholds = state?.thresholds ?? thresholds
      // `history` means the host answered from the durable log because the session
      // is not live in this process; `unknown` means neither source could answer.
      const fromHistory = state?.source === 'history'
      const unavailable = state?.known === false
      /** The count, as a styled node, with the count still pending before it lands. */
      const countNode = h('b', null, count === null ? '…' : String(count))

      const countLine = h(
        'div',
        { className: 'dsh-tlw-count', 'data-dsh-part': 'count' },
        tr('overlay.countBefore'),
        countNode,
        tr('overlay.countAfter'),
        status === 'error' ? h('span', { className: 'dsh-tlw-muted' }, '　' + tr('overlay.statusSyncing')) : null,
        status === 'ready' && unavailable
          ? h('span', { className: 'dsh-tlw-muted' }, '　' + tr('overlay.reading'))
          : null,
      )

      // A count taken from the durable log rather than a live session. Labelled so
      // the user can tell the two apart, and so a number is never silently
      // presented as fresher than it is.
      const historyLine = fromHistory
        ? h('div', { className: 'dsh-tlw-note', 'data-dsh-part': 'history' }, tr('overlay.historyNote'))
        : null

      // Make the browser-local override observable: it changes how the host judges
      // this session, so the window says so rather than leaving the user to guess
      // whether the number they typed was picked up.
      const overrideLine = state?.thresholdsSource === 'browser-override'
        ? h(
            'div',
            { className: 'dsh-tlw-note', 'data-dsh-part': 'override' },
            tr('overlay.localThresholds', {
              count: state.thresholds.compactCountMin,
              occupancy: state.thresholds.occupancyPercentMin,
              spend: formatTokens(state.thresholds.tokensSinceCompactionMin),
            }),
          )
        : null

      if (collapsed) {
        return h(
          'div',
          { className: 'dsh-tlw-overlay', 'data-dsh-plugin': 'toolong-warning' },
          h(
            'div',
            { className: 'dsh-tlw-card', 'data-dsh-part': 'collapsed' },
            h(
              'div',
              { className: 'dsh-tlw-head' },
              h('span', { className: 'dsh-tlw-title' }, shouldWarn ? tr('overlay.collapsedWarningTitle') : tr('overlay.title')),
              h('button', {
                type: 'button',
                className: 'dsh-tlw-btn',
                title: tr('overlay.expand'),
                onClick: () => { setCollapsed(false) },
              }, tr('overlay.expand')),
            ),
            h(
              'div',
              { className: 'dsh-tlw-count' },
              tr('overlay.collapsedCountBefore'),
              h('b', null, count === null ? '…' : String(count)),
              tr('overlay.collapsedCountAfter'),
            ),
          ),
        )
      }

      const warnCard = shouldWarn
        ? h(
            'div',
            { className: 'dsh-tlw-card dsh-tlw-warn-card', 'data-dsh-part': 'warning', role: 'status' },
            h('div', { className: 'dsh-tlw-warn-title' }, tr('warn.title')),
            h('div', { className: 'dsh-tlw-body' }, reasonText(state, lang)),
            h(
              'div',
              { className: 'dsh-tlw-note' },
              tr('warn.summary', {
                count: state.count,
                threshold: hostThresholds.compactCountMin,
                occupancy: state.occupancyRatio === undefined
                  ? tr('warn.occupancyUnknown')
                  : tr('warn.occupancyKnown', { occupancy: formatPercent(state.occupancyRatio, lang) }),
              }),
              fromHistory ? tr('warn.fromHistory') : '',
            ),
            h(
              'div',
              { className: 'dsh-tlw-actions' },
              thresholds.dismissible === false
                ? null
                : h('button', {
                    type: 'button',
                    className: 'dsh-tlw-btn',
                    onClick: () => { setDismissedFor(sessionId) },
                  }, tr('warn.dismiss')),
              form !== undefined
                ? h('button', {
                    type: 'button',
                    className: 'dsh-tlw-btn',
                    title: tr('warn.adjustTitle'),
                    onClick: () => openSettingsSection(lang),
                  }, tr('warn.adjust'))
                : null,
            ),
          )
        : null

      return h(
        'div',
        { className: 'dsh-tlw-overlay', 'data-dsh-plugin': 'toolong-warning', 'data-dsh-config-revision': String(formRevision ?? '') },
        h(
          'div',
          { className: 'dsh-tlw-card', 'data-dsh-part': 'counter' },
          h(
            'div',
            { className: 'dsh-tlw-head' },
            h('span', { className: 'dsh-tlw-title' }, tr('overlay.title')),
            h('button', {
              type: 'button',
              className: 'dsh-tlw-close',
              title: tr('overlay.collapse'),
              'aria-label': tr('overlay.collapseAria'),
              onClick: () => { setCollapsed(true) },
            }, '–'),
          ),
          countLine,
          overrideLine,
          historyLine,
        ),
        warnCard,
      )
    }

    /**
     * Open the Settings panel on this plugin's section by replaying the user's
     * own path: activate the sidebar Settings trigger, then pick the nav row
     * carrying the section label. Every step degrades silently.
     * @param lang - the language the nav row is currently rendered in.
     */
    function openSettingsSection(lang) {
      const label = t(lang, 'settings.title')
      const pick = (panel) => {
        for (const row of panel.querySelectorAll('nav button')) {
          if (row.textContent !== null && row.textContent.indexOf(label) !== -1) {
            row.click()
            return
          }
        }
      }
      const open = document.querySelector('[role="dialog"]')
      if (open !== null) {
        pick(open)
        return
      }
      const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]')
      const trigger = column?.querySelector('[class*="settingsArea"] button')
      trigger?.click()
      let tries = 0
      const attempt = () => {
        const panel = document.querySelector('[role="dialog"]')
        if (panel !== null) {
          pick(panel)
          return
        }
        tries += 1
        if (tries <= 20) window.setTimeout(attempt, 50)
      }
      window.setTimeout(attempt, 0)
    }

    /** One bounded number field backed by the shared settings form. */
    function NumberField(props) {
      const { field, value, disabled, onWrite, lang } = props
      const [draft, setDraft] = React.useState(String(value))
      React.useEffect(() => { setDraft(String(value)) }, [value])
      const commit = () => {
        const parsed = Number(draft)
        if (!Number.isFinite(parsed)) {
          setDraft(String(value))
          return
        }
        const clamped = Math.min(field.max, Math.max(field.min, Math.trunc(parsed)))
        setDraft(String(clamped))
        if (clamped !== value) onWrite(field.name, clamped)
      }
      return h(
        'div',
        { className: 'dsh-tlw-field' },
        h(
          'div',
          { className: 'dsh-tlw-field-head' },
          h('label', { htmlFor: 'dsh-tlw-' + field.name }, t(lang, 'settings.field.' + field.name)),
          h('input', {
            id: 'dsh-tlw-' + field.name,
            type: 'number',
            min: field.min,
            max: field.max,
            value: draft,
            disabled,
            onChange: (event) => { setDraft(event.target.value) },
            onBlur: commit,
            onKeyDown: (event) => { if (event.key === 'Enter') commit() },
          }),
        ),
        h('div', { className: 'dsh-tlw-desc' }, t(lang, 'settings.field.' + field.name + '.desc')),
        h('div', { className: 'dsh-tlw-muted' }, t(lang, 'settings.defaults', {
          default: field.default,
          min: field.min,
          max: field.max,
        })),
      )
    }

    /**
     * The language switch: one control, two choices.
     *
     * The choice is stored in this browser and applied to both halves of the
     * plugin immediately. When the harness' shared locale service is present and
     * writable, `createLanguageStore` also switches the rest of the UI with it.
     */
    function LanguageRow(props) {
      const { languageStore, lang } = props
      return h(
        'div',
        { className: 'dsh-tlw-field', 'data-dsh-part': 'language' },
        h(
          'div',
          { className: 'dsh-tlw-field-head' },
          h('label', { htmlFor: 'dsh-tlw-language' }, t(lang, 'settings.language')),
          h(
            'select',
            {
              id: 'dsh-tlw-language',
              className: 'dsh-tlw-select',
              value: lang,
              onChange: (event) => { languageStore.set(event.target.value) },
            },
            LANGUAGES.map((id) => h('option', { key: id, value: id }, LANGUAGE_LABELS[id])),
          ),
        ),
        h('div', { className: 'dsh-tlw-desc' }, t(lang, 'settings.languageHint')),
      )
    }

    /** The Settings-page section: thresholds, explanation and live diagnostics. */
    function SettingsSection(props) {
      const { ctx, form, thresholds, overrideStore, languageStore } = props
      const [snapshot, setSnapshot] = React.useState(form.getSnapshot())
      const [failure, setFailure] = React.useState(undefined)
      React.useEffect(() => form.subscribe(() => { setSnapshot(form.getSnapshot()) }), [form])
      const override = React.useSyncExternalStore(overrideStore.subscribe, overrideStore.get)
      const lang = React.useSyncExternalStore(languageStore.subscribe, languageStore.get)
      const tr = (key, params) => t(lang, key, params)
      const sessionId = useMainSessionId(ctx)
      const { state } = useWarningState(sessionId, 15000, true, override)

      /**
       * Where a threshold write lands.
       *
       * A loopback page gets the shared Host form, so the value persists in the
       * profile and applies to every session. A non-loopback page cannot: DSH
       * fixes `persistence` to `memory` there and the form rejects every write —
       * for every plugin. Rather than showing dead controls, those pages get a
       * browser-local override that the plugin applies per request (bounded here
       * and clamped again by the host).
       */
      const hostWritable = snapshot.status === 'ready' && snapshot.writable === true
      const profileValues = { ...FALLBACK_THRESHOLDS, ...thresholds, ...(snapshot.value ?? {}) }
      const value = hostWritable ? profileValues : { ...profileValues, ...override }

      const write = (field, next) => {
        setFailure(undefined)
        if (!hostWritable && Object.prototype.hasOwnProperty.call(OVERRIDE_FIELDS, field)) {
          if (!overrideStore.set(field, next)) setFailure(tr('settings.localStorageFailed'))
          return
        }
        let answer
        try {
          answer = form.set(field, next)
        } catch (error) {
          setFailure(error instanceof Error ? error.message : String(error))
          return
        }
        Promise.resolve(answer).then(
          (accepted) => { if (!accepted) setFailure(tr('settings.rejectedByHost')) },
          (error) => { setFailure(error instanceof Error ? error.message : String(error)) },
        )
      }

      const localCount = Object.keys(override).length

      return h(
        'div',
        { className: 'dsh-tlw-section', 'data-dsh-plugin': 'toolong-warning' },
        h('div', { className: 'dsh-tlw-card-title' }, tr('settings.title')),
        h('div', { className: 'dsh-tlw-desc' }, tr('settings.intro')),
        h(LanguageRow, { languageStore, lang }),
        h(
          'div',
          { className: hostWritable ? 'dsh-tlw-muted' : 'dsh-tlw-desc', 'data-dsh-part': 'write-mode' },
          hostWritable
            ? tr('settings.writeModeProfile')
            : tr('settings.writeModeLocal', {
                countHint: localCount > 0 ? tr('settings.localCountHint', { count: localCount }) : '',
              }),
        ),
        snapshot.status !== 'ready'
          ? h('div', { className: 'dsh-tlw-muted' }, snapshot.status === 'loading'
              ? tr('settings.readingHostConfig')
              : tr('settings.hostConfigUnavailable'))
          : null,
        h(
          'div',
          { className: 'dsh-tlw-field' },
          h(
            'div',
            { className: 'dsh-tlw-field-head' },
            h(
              'label',
              { htmlFor: 'dsh-tlw-enabled' },
              h('input', {
                id: 'dsh-tlw-enabled',
                type: 'checkbox',
                checked: value.enabled !== false,
                disabled: !hostWritable,
                onChange: (event) => { write('enabled', event.target.checked) },
              }),
              ' ' + tr('settings.enabledLabel'),
            ),
          ),
          h('div', { className: 'dsh-tlw-desc' }, !hostWritable
            ? tr('settings.profileOnly')
            : value.enabled === false
              ? tr('settings.enabledCurrentlyOff')
              : tr('settings.enabledDescription')),
        ),
        h(
          'div',
          { className: 'dsh-tlw-grid' },
          FIELDS
            .filter((field) => field.type === 'integer')
            .map((field) => h(NumberField, {
              key: field.name,
              field,
              lang,
              value: typeof value[field.name] === 'number' ? value[field.name] : field.default,
              disabled: !hostWritable && !Object.prototype.hasOwnProperty.call(OVERRIDE_FIELDS, field.name),
              onWrite: write,
            })),
        ),
        h(
          'div',
          { className: 'dsh-tlw-field' },
          h(
            'div',
            { className: 'dsh-tlw-field-head' },
            h(
              'label',
              { htmlFor: 'dsh-tlw-dismissible' },
              h('input', {
                id: 'dsh-tlw-dismissible',
                type: 'checkbox',
                checked: value.dismissible !== false,
                disabled: !hostWritable,
                onChange: (event) => { write('dismissible', event.target.checked) },
              }),
              ' ' + tr('settings.dismissibleLabel'),
            ),
          ),
          h('div', { className: 'dsh-tlw-desc' }, !hostWritable
            ? tr('settings.profileOnly')
            : tr('settings.dismissibleDescription')),
        ),
        failure !== undefined
          ? h('div', { className: 'dsh-tlw-error', role: 'status' }, tr('settings.saveFailed', { error: failure }))
          : null,
        h('div', { className: 'dsh-tlw-card-title' }, tr('stats.title')),
        state === null || state.known === false
          ? h('div', { className: 'dsh-tlw-muted' }, tr('stats.empty'))
          : h(
              'dl',
              { className: 'dsh-tlw-diagnostics' },
              h('dt', null, tr('stats.compactions')), h('dd', null, tr('stats.compactionsValue', { count: state.count })),
              h('dt', null, tr('stats.billed')), h('dd', null, formatTokens(state.billedTokens)),
              h('dt', null, tr('stats.sinceCompaction')), h('dd', null, state.tokensSinceCompaction === undefined
                ? tr('stats.unknown')
                : formatTokens(state.tokensSinceCompaction)),
              h('dt', null, tr('stats.occupancy')), h('dd', null, state.occupancyRatio === undefined
                ? tr('stats.occupancyUnknown')
                : formatPercent(state.occupancyRatio, lang)),
              h('dt', null, tr('stats.shouldWarn')), h('dd', null, state.shouldWarn === true
                ? tr('stats.yes')
                : tr('stats.no', { gate: gateText(state.gate, lang) })),
            ),
      )
    }

    /**
     * Resolve the settings form for this plugin's namespace.
     * @returns the form, or undefined when the settings surface is absent.
     */
    function resolveForm(ctx) {
      const forms = ctx.get('configForms')
      if (forms === undefined || typeof forms.get !== 'function') return undefined
      try {
        return forms.get(SETTINGS_NS)
      } catch (error) {
        console.warn('[toolong-warning] settings form unavailable:', error)
        return undefined
      }
    }

    /**
     * Fallback mount used only when the shell exposes no `shell.overlay` seat:
     * a self-owned container with its own React root and a plugin-scoped marker.
     */
    function mountFallback(props) {
      if (typeof document === 'undefined') return () => {}
      const existing = document.querySelector('[data-dsh-toolong-warning-root]')
      if (existing !== null) existing.remove()
      const container = document.createElement('div')
      container.setAttribute('data-dsh-toolong-warning-root', '')
      document.body.appendChild(container)
      const root = ReactDOMClient.createRoot(container)
      root.render(h(LongConversationOverlay, props))
      return () => {
        root.unmount()
        container.remove()
      }
    }

    return {
      inject: ['slots', 'sessions', 'configForms'],
      /**
       * Mount both surfaces.
       * @param ctx - client plugin context.
       */
      apply(ctx) {
        ensureStyles()
        const form = resolveForm(ctx)
        const snapshot = form?.getSnapshot?.()
        const thresholds = { ...FALLBACK_THRESHOLDS, ...(snapshot?.value ?? {}) }
        const formRevision = snapshot?.revision
        // One override store for both halves: the settings card writes it, the
        // floating window reads it on every poll.
        const overrideStore = createOverrideStore()
        // One language store for both halves: the settings card switches it, the
        // floating window re-renders from it in the same frame.
        const languageStore = createLanguageStore({ ctx })
        const overlayProps = { ctx, form, thresholds, formRevision, overrideStore, languageStore }

        let disposeOverlay
        try {
          disposeOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
            name: 'shell.overlay',
            id: 'toolong-warning',
            order: 60,
          }, () => h(LongConversationOverlay, overlayProps)))
        } catch (error) {
          console.warn('[toolong-warning] shell.overlay unavailable; mounting a fixed container instead:', error)
        }
        if (typeof disposeOverlay !== 'function') {
          disposeOverlay = mountFallback(overlayProps)
        }
        ctx.effect(() => () => {
          try {
            disposeOverlay()
          } catch {
            // Container already gone during teardown.
          }
        }, 'toolong-warning: floating window')

        if (form !== undefined) {
          try {
            ctx.slots.inject('settings.section', () => ctx.slots.register({
              name: 'settings.section',
              id: SETTINGS_NS,
              order: 200,
              // Resolved at render time, so the nav row follows the language switch.
              label: () => t(languageStore.get(), 'settings.title'),
              locale: SETTINGS_NS,
            }, () => h(SettingsSection, { ctx, form, thresholds, overrideStore, languageStore })))
          } catch (error) {
            console.warn('[toolong-warning] settings.section unavailable:', error)
          }
        }
      },
    }
  },
})
