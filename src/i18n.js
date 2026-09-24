/**
 * Localization for the plugin's browser half.
 *
 * The plugin owns its own dictionaries rather than depending on
 * `@deepseek-ai/dsh-client-locale`, because a hand-written client bundle can only
 * require the modules the shell puts in its table (`react`, `cordis`, `slots`,
 * primitives, dockkit, store) — the locale package is not one of them, so it can
 * only be reached through the `locale` service, which may or may not be there.
 *
 * So: this module always works on its own, and *additionally* syncs with the
 * shared locale service when that service exists. Switching here therefore
 * switches this plugin's UI immediately, and on a deployment whose locale service
 * accepts the write it switches the rest of the harness UI too.
 *
 * The choice is stored in `localStorage` for the same reason the threshold
 * override is: DSH fixes settings writes to read-only on a non-loopback page, so
 * a Host-backed preference could not be saved there.
 *
 * @module @hjdd14/dsh-toolong-warning/src/i18n
 */

/** Languages this plugin ships. `en` is the fallback for everything else. */
export const LANGUAGES = Object.freeze(['zh', 'en'])

/** Where the language choice is stored. */
export const LANGUAGE_KEY = 'dsh-toolong-warning.language.v1'

/** Human label for each language, shown in its own script. */
export const LANGUAGE_LABELS = Object.freeze({ zh: '中文', en: 'English' })

/**
 * Every user-visible string, in both languages.
 *
 * The two blocks MUST keep identical key sets — `scripts/test-i18n.mjs` and
 * `scripts/check-client.mjs` both assert that, so a half-translated string cannot
 * reach the repository.
 */
export const MESSAGES = Object.freeze({
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
 * Translate one key.
 *
 * Falls back from the requested language to English to the key itself, so a
 * missing string degrades to something visible and greppable instead of throwing
 * or rendering `undefined`.
 * @param lang - language id (`zh` or `en`).
 * @param key - message key.
 * @param params - values substituted into `{name}` placeholders.
 * @returns the message.
 */
export function t(lang, key, params) {
  const table = MESSAGES[lang] ?? MESSAGES.en
  const template = table[key] ?? MESSAGES.en[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ))
}

/** Every key, for parity checks. */
export function messageKeys(lang) {
  return Object.keys(MESSAGES[lang] ?? {})
}

/** Normalize anything to a supported language id. */
export function normalizeLanguage(value) {
  if (typeof value !== 'string') return undefined
  const lower = value.trim().toLowerCase()
  if (lower === '') return undefined
  if (lower === 'zh' || lower.startsWith('zh-') || lower.startsWith('zh_')) return 'zh'
  if (lower === 'en' || lower.startsWith('en-') || lower.startsWith('en_')) return 'en'
  return undefined
}

/**
 * Pick the starting language.
 *
 * Order: an explicit stored choice, then the harness' own active locale, then the
 * browser's ordered language list, then Chinese (the plugin's primary audience).
 * @param stored - a previously stored value, if any.
 * @param sharedLocale - the shared locale service, when the shell provides one.
 * @param navigatorLanguages - `navigator.languages`/`navigator.language`.
 * @returns a supported language id.
 */
export function resolveInitialLanguage(stored, sharedLocale, navigatorLanguages) {
  const explicit = normalizeLanguage(stored)
  if (explicit !== undefined) return explicit

  try {
    const active = sharedLocale?.getSnapshot?.()?.active
    const fromLocale = normalizeLanguage(active)
    if (fromLocale !== undefined) return fromLocale
  } catch {
    // A locale service that cannot answer must not stop the window rendering.
  }

  for (const candidate of Array.isArray(navigatorLanguages) ? navigatorLanguages : [navigatorLanguages]) {
    const match = normalizeLanguage(candidate)
    if (match !== undefined) return match
  }
  return 'zh'
}

/**
 * Create the language store shared by the floating window and the settings card.
 *
 * @param options - the client context (for the shared locale service), a storage
 *   object (defaults to `window.localStorage`), and the browser language list.
 * @returns `{ get, subscribe, set, available }`.
 */
export function createLanguageStore(options) {
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

  let value = resolveInitialLanguage(read(), sharedLocale(), languages)
  const listeners = new Set()

  /** Write `document.documentElement.lang` so the shell's own styling agrees. */
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
    /**
     * Switch language.
     * @param next - a supported language id.
     * @returns whether the choice could be stored (the switch still applies).
     */
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
