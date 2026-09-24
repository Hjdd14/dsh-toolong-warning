# 验证记录（verification.md）

本文件记录 `@hjdd14/dsh-toolong-warning` 交付时的**实际验证情况**：验了什么、怎么验的、以及**哪些还没验**。
每条结论都对应一条可复现的命令或其真实输出，没有"应该没问题"这类结论。

> **本文档是开发验证记录，已脱敏。** 命令与输出里的绝对路径写成 `<DSH_HOME>` / `<profile>`
> 这类占位符，会话 id 写成 `session-<redacted>`；所有数值、判定结果与结论保持原样。
> 仓库里不含任何个人信息或凭据，这一点由 `node scripts/check-hygiene.mjs` 强制检查。

| 项目 | 值 |
|---|---|
| DSH 版本 | `0.1.7-rc.1` |
| profile | `web`（`<DSH_HOME>/profiles/web`） |
| GUI | `http://127.0.0.1:3080` |
| 验证用真实会话 | `session-<redacted>`（本插件就在这个会话里开发） |
| 最终运行版本 | `moduleGeneration: 6`（见 §5，这是判断"运行中的进程是否已加载修复后代码"的探针） |

---

## 1. 离线验证：374 项全部通过（可复现）

```
node scripts/test-detect.mjs    ->  98 passed, 0 failed   判定规则、折叠语义、配置解析
node scripts/test-i18n.mjs      ->  67 passed, 0 failed   中英字典一致性（含内联副本）、语言存储
node scripts/test-coldread.mjs  ->  49 passed, 0 failed   历史（冷读）源、缓存、fresh 读
node scripts/test-routes.mjs    ->  98 passed, 0 failed   路由组装、围栏、自检、阈值覆盖、冷读分支、重复投递
node scripts/check-client.mjs   ->  71 passed, 0 failed   产物结构、schema 形状、挂载、bundle 真跑一遍
```

`npm test` 依次跑全部五套；`npm run check:hygiene` 是发布前的隐私闸门（见 §7）。

### 1.1 判定规则（`test-detect.mjs`）

重点是**必须保持沉默**的场景（不误报是本插件存在的意义）：

| 场景 | 期望 | 结果 |
|---|---|---|
| 对话很长很贵，但从未压缩 | 不提醒 | ok |
| 只压缩过 2 次（默认阈值 3） | 不提醒 | ok |
| 压缩 3 次但上下文宽裕、也没额外烧钱 | 不提醒 | ok |
| 压缩 3 次、额外消耗 25 万（过阈值但不到 2 倍）| 不提醒 | ok |
| 完全没有用量数据（占用 95% 也不行）| 不提醒 | ok |
| 拿不到占用且额外消耗很低 | 不提醒 | ok |
| 高占用 + 额外消耗达标 | **提醒** | ok |
| 额外消耗达到阈值 2 倍（拿不到占用也能判）| **提醒** | ok |
| 阈值边界（占用正好 50%、消耗正好 20 万）| **提醒** | ok |
| 在设置页改大/改小阈值 | 立刻改变判定 | ok |

压缩计数的正确性：**只有成对的 `compaction/start` + 无 `error` 的 `compaction/end` 才计数**；
`start` 单独出现不计、`end` 带 `error` 不计、`compaction/prune`（纯裁剪）不计、
同一段日志重放两次结果一致、`null`/缺字段/负数/NaN 都不会让计数变大。

### 1.2 路由组装与围栏（`test-routes.mjs`）

- 状态路由：200、字段齐全、`cache-control: no-store`、只读（POST → 405）。
- **loopback 围栏**：非回环 socket → 403；`Host` 非回环 → 403；`sec-fetch-site: cross-site` → 403；
  `Origin` 不属于本机 → 403；本机 `Origin` → 200。健康路由同样受围栏保护。
- 会话未加载 → `known:false` + `reason:'session-not-loaded'`，且**不提醒**（不把"查不到"当成"很健康"）。
- 缺 `sessionId` → `reason:'missing-session-id'`。
- `enabled:false` → 不注册路由、不碰会话、返回 `reason:'disabled'`。

### 1.3 客户端产物结构（`check-client.mjs`）

按 `@deepseek-ai/dsh-client-modules` 强制的契约逐条断言：`package.json` 的
`dsh.client.platform==='web'`、`exports['./client']`、`dsh.bundle.patch`；`client.js` 里
`window.__ModuleLoader__.load(` 恰好一次、`id` 等于包名、`factory(require)` 存在、返回 `{inject, apply}`、
**无任何 ESM `import`/`export`**、除 `react`/`react-dom/client` 外不 import 任何模块
（这些由 shell 的模块表提供，打包进去会失效）、不碰其它插件的 DOM 标记。

还动态 import `index.js` 并**真的调用 `apply()`**：断言挂载了且只挂载了两条 exact 路由、
订阅了 `session/event` 与 `session/disposed`、卸载时释放两条路由；并验证
`enabled:false` 不挂载、配置非法（`compactCountMin:'many'`）时夹取后照常挂载。

---

## 2. 安装验证：通过

1. 用官方 CLI 安装（不是手改配置）：
   ```
   node <DSH_INSTALL>/lib/bin.js \
     plugin --profile web add "link:<REPO>"
   ```
   输出 `+ @hjdd14/dsh-toolong-warning link:...`，退出码 0，耗时 665 ms。
2. profile 清单：`package.json` 的 `dependencies` 有该链接依赖，**且 `dsh.profile.bundles` 自动追加了
   `@hjdd14/dsh-toolong-warning`**（由 plugin manager 的 bundle 记录逻辑完成，不是我手写的）。
3. 包真的落地：`profiles/web/node_modules/@hjdd14/dsh-toolong-warning` → 符号链接到工作区，`client.js` 可读。
4. 安装后**未重启进程**即可用：`GET /api/dsh-toolong-warning/health` 直接返回 200 且 `ok:true`
   （说明 Host 行已激活并注册了路由）。
5. 安装只改了 profile 的 `package.json`；`cordis.patch.yml` 与安装前逐字节一致
   （开发中为触发重载临时加过的注释行已清理，并与备份比对确认相等）。

---

## 3. 真实会话上的数据验证：通过

对验证用会话请求 `state`，最终返回（节选）：

```json
{"known":true,"count":0,"lastCompactionSeq":-1,"tokensSinceCompaction":87281975,
 "billedTokens":87281975,"sampledEvents":321,"projectedTokens":416387,"contextWindow":1000000,
 "occupancyRatio":0.416387,"shouldWarn":false,"reasons":["few-compactions"],
 "gate":"compactions","seededThrough":2136,"droppedEvents":0}
```

判定它**正确**，依据三条独立证据：

1. **计数**：`count:0`、`lastCompactionSeq:-1`（一次压缩都没发生过）。
   与 DSH 的投影缓存文件
   `<DSH_HOME>\storages\session_projcache\sessions\session-<redacted>.json`
   一致（其中有 `title` 行的 `seq` 即该会话日志长度，且**没有任何 compaction 行**）。
2. **两条读取路径一致**：`debug=1` 返回 `seq:2137` 与 `snapshotLength:2137` 完全相等，
   `snapshotCompactions:0`、`positionalUnreadable:undefined`——即日志连续、确实没有压缩事件。
3. **占比**：`contextWindow:1000000`、`projectedTokens:416387` 与该会话在投影缓存里的
   `contextPressure` 行（`contextWindow:1000000`、`pressureTokens`/`surfaceTokens` 同量级）吻合，
   说明 `ctx.sessionProjections.stateOf()` 读到的是 token-meter 的真实数据。

**所以"不误报"在当前数据上成立**：一个 2100+ 事件、累计约 8700 万 token、上下文占用约 42% 的会话，
因为**从未压缩过**，插件保持沉默——这正是设计要求。注意此时 `tokensSinceCompaction` 等于全会话消耗
（还没有压缩边界可作基准），但判定被"压缩次数不足"这一关拦住，不会误报。

复验时这次会话的占用已涨到 **51%**（超过 50% 阈值），插件**仍然不提醒**，`gate` 报 `compactions` ——
即"占用这一关过了，但压缩次数不够"，正是"必须多次压缩过才说话"这条规则的现场体现。
这同时说明阈值确实是活的（不是写死常量），因为占用是从 DSH 的 `contextPressure` 实时读的。

---

## 4. 开发过程中实测发现并修掉的 10 个真实缺陷

这些都不是猜测的边界情况，都是在真机数据或你的截图上暴露出来的：

| # | 缺陷 | 怎么发现的 | 修复 |
|---|---|---|---|
| 1 | `session.seq` 是**下一个**序号（= 日志长度），不是最后一个事件的序号；按 `seq <= session.seq` 遍历会越界并把水位记错 | 读 `dsh-session` 的 `get seq()` 实现与 JSDoc（`seq = log.length` 连续性契约）| 改为 `seq < session.seq`，并加了契约测试 |
| 2 | 运行中的会话里，按位置遍历 `eventAt(i)`（`i < session.seq`）会**读不到**部分事件；只有 `snapshotEvents()` 是连续日志 | 真实会话上 `droppedEvents` 从 2 一路涨到 51；改进诊断后 `snapshotLength` 与 `seq` 相等而位置遍历仍有空洞 | 改用 `snapshotEvents()`；丢失量作为诊断上报。修复后真实会话 `droppedEvents: 0` |
| 3 | 增量折叠与首次播种**区间重叠一个事件**，同一次压缩被计两次（测试里 `count` 变 5 而不是 3）| 集成测试的 live-append 场景 | `seededThrough` 语义定为"已折叠的最高序号"，`seed` 从 `seededThrough + 1` 开始 |
| 4 | 用 token-meter 的**实时累计总量**减去"上次压缩时的快照"，两者都随压缩自身的摘要请求增长，差恒为 0 → **永远不提醒** | 集成测试的 spend 断言 | 改为由插件按日志里的用量样本自行累计，并以"最近一次**完成**的压缩结束时"为基准 |
| 5 | 路由把"已扣除基准的差值"当成"累计总量"再传给 `buildMetrics`，于是又把基准减了一遍，结果恒为 0 | 运行中的 `?selftest=1` 返回 `mismatches: ["shouldWarn: expected true, got false"]` | 改成传累计总量；自检随即 `pass:true` |
| 6 | **`Config` 不是真的 schemastery schema**，导致 `dsh-settings` 永远不发布这个命名空间的表单 | 你的设置页截图显示「当前连接不支持修改插件配置（配置只读）」。定位到 `dsh-settings` 的 `volatileForm` 会调用 `schema.toJSON()`／`schema.dict`／`schema.meta.volatile`，而我手写的"标准 schema 对象"三样都没有 → `describe` 里永远没有这一行 | 改成真正的 schemastery schema。注意两个坑：① DSH 树里能用的是 `@deepseek-ai/schemastery` **3.18.4**，而 profile 里可解析的裸包 `schemastery` 是 **3.18.0，根本没有 `.volatile()`**；② 本地安装的插件是指向工作区的符号链接，Node 从**真实路径**解析 import，profile 的 node_modules 不在搜索路径上 → 改为按候选路径显式加载（profile → DSH home），两者都拿不到时用手写但结构等价的描述符兜底 |
| 6b | `.volatile()` 字段校验出来的是 **Volatile 包装对象**（带 `.get()`），不是普通值；直接当数字用会得到 `{}` | 加测试后 `resolveConfig()` 返回的阈值变成 `{}` | `resolveConfig` 逐字段解包（`.get()`），兼容兜底描述符的普通值 |
| 7 | 冷读源用了自己一套字段名（`spendSinceLastCompaction`），而判定读的是 `tokensSinceCompaction`／`dataKnown` → 冷路径上"额外消耗"恒为 `undefined`，该路径**永不提醒** | 路由测试断言 `tokensSinceCompaction` 得 `undefined` | 让冷读直接产出与 `buildMetrics` 同名的字段，并在注释里写明"改名会静默失效" |
| 8 | 冷读**不校验身份**：后端若回错会话（测试桩无脑返回日志时就发生了），会把**别的对话的计数**挂到你当前会话上 | 路由测试里"不存在的会话 id"竟返回了 `known:true` 与计数 | 比对 `snapshot.session.id` 与请求 id，不一致就拒绝并记一条 warn |
| 9 | **一次完成的压缩被 live 折叠计了两次**：append 处理器用 `untilSeq = session.seq` 去播种"该事件之前"的日志，但 `session.seq` 是日志**长度**，而 `seed` 的上界是**排他**的——当到达的事件正是最后一条已提交事件时，播种区间已经包含它，处理器随后又折叠了一次。一次压缩变两次，而且**每次重复投递都会再加一** | 你在这个真实会话里第一次 `/compact` 之后，悬浮窗计数变成 **2**，而用 `state?debug=1` 数日志里**只有一组** `compaction/start`＋`summary`＋`end`（`seq 4686/4688/4690`） | 处理器改用**事件自身的 seq** 作为播种上界，并在 `seq <= seededThrough` 时跳过折叠（该事件已被覆盖）。见 §4.1 |
| 10 | 计数自检拿 **live 值**与**可能命中缓存的 history 值**比较，报出 `live count 2 vs history count 1`，看起来像计数 bug，其实是缓存命中的设计行为 | 重启后 `?selftest=1` 的 `historySelfTest.pass:false` | 自检改用 **fresh 读**（绕过缓存）比较；缓存则单独按它自己的契约验证（窗口内第二次读不得再读盘）。见 §4.1 |

第 4、5、6 条尤其重要：4/5 不修的话，插件在所有真实长对话里都会永远沉默（不误报，但也完全没用）；
6 不修的话，设置页永远是「配置只读」，你无法在界面上调整阈值——正是你截图里看到的现象。
第 5 条是**运行中的自检**抓出来的——这也正是加 `?selftest=1` 的意义：Host 半不热重载，
只有让运行中的进程自己跑一遍，才能证明它手上那份代码是对的。

### 4.1 第 9 条：一次真实压缩暴露出来的重复计数

这是**第一次在真实对话里观察到压缩**（此前计数一直是 0），也正是它把缺陷 9 暴露了出来。
证据链（全部可在运行中的进程上复现）：

```
# 压缩后，悬浮窗/接口报告 2
state?sessionId=<会话>&debug=1  ->  count: 2

# 但日志里只有一组完整的压缩生命周期
debug.eventTypes: {"compaction/prune":22,"compaction/start":1,"compaction/summary":1,"compaction/end":1}
debug.compactions: start@4686, summary@4688, end@4690
```

插桩复现（临时在 `foldCompaction` 加一行日志，跑完即撤销）：

```
HANDLER seq=3 seededThrough(before)=-1 sessionSeq=4
  after seed: seededThrough=3 count=1     <- 播种已经把 end 折叠了一次
FOLD type=compaction/end seq=3            <- 处理器又折叠了一次
FOLD type=compaction/end seq=3
count after append = 2
```

也就是说：**`end` 事件在第一次 append 时就被折叠了两遍**。修复后同一场景：

```
first delivery counts the completed compaction   -> 1
a redelivered event does not count again         -> 1
nor does a third delivery                        -> 1
nor a full replay of the log                     -> 1
```

这四条已作为回归测试写入 `scripts/test-routes.mjs`。第 10 条同时修掉，两者合起来让
`?selftest=1` 的两个自检在真实会话上重新一致（`liveCount 1 = historyCount 1`）。

**为什么值得单独记一笔**：它说明"离线测试全绿"不等于"逻辑对"——这个重叠只在
`session.seq == event.seq`（即事件恰好是最后一条已提交事件）时发生，而我的测试桩当时
总是先播种、再投递一个 seq 更小的事件，恰好绕开了它。真实压缩的时序把这条路径走了个正着。


---

## 5. Host 版本与自检：通过（重启后）

DSH **只对客户端 bundle 热重载**，Host 半是进程内 ESM，改文件不会重载
（试过改 profile 的 `cordis.patch.yml` 内容触发重载，实测无效）。重启后确认：

```
GET /api/dsh-toolong-warning/health?selftest=1
-> {"ok":true,"moduleGeneration":8,"enabled":true,"sessionsTracked":1,
    "selfTest":{"pass":true,
      "checks":{"status":200,"count":2,"lastCompactionSeq":6,
                "tokensSinceCompaction":300000,"billedTokens":1200000,"shouldWarn":true},
      "mismatches":[]},
    "historySelfTest":{"pass":true,
      "checks":{"comparedFresh":true,"cacheServedSecondRead":true,
        "comparisons":[{"id":"session-<redacted>","historyAvailable":true,
                        "liveCount":1,"historyCount":1,"agree":true}]},
      "mismatches":[]}}
```

两个自检都在**运行中的进程**里通过：`selfTest` 用合成会话走完整判定链路；`historySelfTest`
在真实会话上比较 live 与 history 的计数（`1 = 1`），并确认缓存窗口内的第二次读没有再读盘。

### 5.1 浏览器本地阈值：在运行中的宿主上实测通过

因为设置表单在非回环页面上是只读的（§6 第 2 条），本插件让浏览器把阈值随请求带过来，
宿主每次重新校验。对**运行中的宿主 + 真实会话**实测：

```
profile        | source: profile         | {"compactCountMin":3,"occupancyPercentMin":50,...} | rejected: []
valid override | source: browser-override| {"compactCountMin":1,"occupancyPercentMin":10,...} | rejected: []
abusive        | source: profile         | {"compactCountMin":3,"occupancyPercentMin":50,...}
                 rejected: ["compactCountMin: 0 outside 1..20; ignored",
                            "occupancyPercentMin: 999 outside 10..95; ignored"]
```

即：合法覆盖值被采纳并标出来源；越界值被忽略、回退 profile 值、并在响应里逐条说明原因。

### 5.2 历史（冷读）源：解决"切换对话后要刷新才出数据"

**根因**：`ctx.sessions.get(id)` 只认识本进程内 live 的会话。切到一个 agent 没在跑的对话时它返回
`undefined`，路由只能回 `known:false`，悬浮窗就卡在「…／宿主未加载」。刷新页面"能修好"只是因为
重新打开该会话让宿主把它加载进了内存——所以它看起来像客户端 bug，其实是宿主侧缺数据源。
客户端本来就跟着 `sessionId` 变化在轮询，不需要改成刷新。

**做法**：用 DSH 官方的只读通路 `ctx.sessionQuery.readSession(id)`（"读完整日志且不会让该会话变为实时"）
折叠出计数与消耗，作为 live 之外的第二个数据源。

对**运行中的宿主 + 真实会话**实测（本进程只加载了 1 个会话，其余都是冷读）：

```
current        | known:true source:live    | count 0 | occ 0.599 | gate compactions
session-7f3358 | known:true source:history | count 1 | tokensSince 27235 | occ 0.027
session-948f49 | known:true source:history | count 0 | tokensSince 90508559 | occ 0.417
session-588513 | known:true source:history | count 0 | tokensSince 9636876  | occ 0.371
session-053b9b | known:true source:history | count 0 | tokensSince 2918302  | occ 0.106
```

- 未加载的会话现在**给得出计数**（其中 `session-7f3358` 确实压缩过 1 次），不再是 `…`。
- `?selftest=1` 的 `historySelfTest` 让**运行中的进程**自己比对两条路径：

```
{"pass":true,"checks":{
  "comparisons":[
    {"id":"session-d98bd5eb-…","liveCount":0,"historyCount":0,"agree":true},
    {"id":"session-7f3358f7-…","liveCount":1,"historyCount":1,"agree":true}],
  "cacheServedSecondRead":true,
  "stats":{"reads":7,"hits":2,"failures":0,"cacheSize":5}},
 "mismatches":[]}
```

即：同一会话上 live 与 history 的计数**相等**（`1 = 1`，含真实压缩），且缓存窗口内的第二次读
没有再次读盘（`cacheServedSecondRead:true`），`failures:0`。

### 5.3 这一轮修的两处真实缺陷

| # | 缺陷 | 怎么发现的 | 修复 |
|---|---|---|---|
| 7 | 冷读结果用了自己的一套字段名（`spendSinceLastCompaction` 等），而判定读的是 `tokensSinceCompaction` / `dataKnown`，于是冷路径上"额外消耗"恒为 `undefined`、提醒永不触发 | 路由测试断言 `tokensSinceCompaction` 得 `undefined` | 让冷读直接产出与 `buildMetrics` 同名的字段，并在注释里写明"改名会静默失效" |
| 8 | 冷读不校验身份：后端若回错会话（或测试桩无脑返回日志），就会把**别的对话的计数**挂到你当前会话上 | 路由测试里"不存在的会话 id"竟返回了 `known:true` 与计数 | 比对 `snapshot.session.id` 与请求 id，不一致就拒绝并记一条 warn |

### 5.3 中英双语与"可发布"这一轮

**双语（离线可完全验证）**

- 两份字典（`src/i18n.js` 与 `client.js` 内联副本）逐字符串比对，**任何一处漏译都会让测试失败**。
  这条闸门是必须的，因为浏览器半**无法**加载兄弟模块（见下），字典只能存在两份。
- 反向验证过闸门不是永远绿灯：手工把内联副本里 `overlay.countBefore` 改成
  `'本会话已压缩(TAMPERED) '`，测试立刻失败并点名该 key；撤销后恢复 67/67 通过。
- 键集合一致性、占位符替换、未知语言回退、初值优先级（localStorage → 共享 locale →
  `navigator.language` → `zh`）、语言存储的持久化与失败降级都有断言。

**为什么内联而不是 import（这条推翻了我原本的设计）**

原本让 `client.js` 用 `import('./src/i18n.js')` 引用字典。实测**行不通**，而且失败方式是静默的：
DSH 把客户端产物**打包成一个 combo URL** served 出来，形如
`/plugins/??@local%2Fdsh-toolong-warning/client.js&rev=…`，其 pathname **恰好就是 `/plugins/`**。
于是 `./src/i18n.js` 会解析成 `/plugins/src/i18n.js`。更关键的是，`bundleResource()` 的实现
（`dsh-client-modules/lib/index.js:958-972`）只在**内存里的 response map** 中按精确 URL 查表：

```js
const response = this.responses.get(resourceUrl) ?? this.previousBatchResponses.get(resourceUrl)
  ?? this.chunkResponse(requestUrl);
if (response !== undefined) return { status: 200, ... };
return { status: 404 };
```

**这条路由不是文件服务器**，所以 `/plugins/<id>/src/i18n.js` 永远不可能被服务。我实测过：
`client.js` 与 `src/i18n.js` 取 200/404 都一样是 404（不带正确 rev 也 404），因为只有 combo URL 在表里。
结论：**浏览器半必须自包含**，字典内联，用测试保证两份副本不漂移。

**可发布就绪**

- 隐私闸门 `node scripts/check-hygiene.mjs`：扫描全树（除 `node_modules`/`.git`），命中个人路径、
  会话 id 形状、`sk-`/`ghp_`/`AKIA`/`Bearer`/私钥块/个人邮箱即失败退出 1。
- **反向验证过它真的会拦**：临时放入一个探针文件，写上一条 Windows 家目录路径（`<盘符>:\Users\<用户名>\…`）、
  一个 `sk-` 开头的假密钥、一个真实形状的会话 id，闸门报出 3 条 finding 并退出 1；删除探针后恢复 clean。
  （这也是为什么本文档里不写出那行探针的原文——写出它就等于把闸门要拦的东西放进仓库，
  闸门在第 307 行确实拦了我一次，我把示例改成了占位写法。）
- 仓库文档已脱敏（`verification.md` 里的绝对路径与会话 id 换成占位符），当前 `26` 个文件全部 clean。

### 5.4 尚未由我验证的部分

- **语言切换在浏览器里的实际观感**（切换后悬浮窗与设置页是否同帧变英文）：接口与离线渲染都覆盖了，
  但"你眼睛看到两处都变了"只能由你确认。
- **内联字典在浏览器里真的被用上**（而不是回退到 key）：这一点由 `check-client.mjs` 真正 import
  并运行 `client.js` 间接覆盖，但热重载后的页面表现需要你扫一眼确认文案是中文/英文而不是 key。
- **真正上传到 npm 的那一步**：本机未登录 npm（`npm whoami` → `ENEEDAUTH`），我无法替代你完成
  登录与上传，也不会替你把包发到公网。能证明的部分见 §5.5。

### 5.5 "别人能不能 npm install" 的实测

这是**独立于上面那段**的验证：把包按发布形态打包，装进一个干净项目，看它是否真的能被用起来。

**① 依赖与名称的客观状态（查 registry 得到，不是推测）**

```
@deepseek-ai/schemastery        -> 存在于公共 registry，latest 3.18.4（正是 Config 需要的那版）
dsh-toolong-warning             -> 404，未被占用
@hjdd14/dsh-toolong-warning     -> 404，未被占用；@hjdd14 这个 scope 尚不存在
```

npm 会在**首次发布**时自动创建 scope，所以这不是阻塞项。真正阻塞的只有一件事：本机未登录。

**② 打包形态正确**

```
npm publish --dry-run
-> name: @hjdd14/dsh-toolong-warning@0.1.0
   total files: 17, package size 70.8 kB, unpacked 200.4 kB
   含 index.js / client.js / src/* / cordis.patch.yml / docs/overlay.png
```

`npm pack` 的产物里 **`dsh`、`exports`、`main`、`type: module` 全部保留**——这一点必须实测，
因为 `dsh.bundle.patch` 与 `dsh.client` 决定了宿主与浏览器半能否被发现，丢了就装上也用不了。

**③ 干净项目里安装并真的加载（关键一步）**

在 `npm install <tarball>` 装进一个全新目录后，用**包的公开入口**（`exports` 故意不暴露 `src/`，
消费方也只有公开入口）驱动它：

```
--- host half ---
ok   exports a plugin name
ok   exports a Config
ok   exports an apply function
ok   declares its injected services
--- the load-bearing part: a real schemastery schema ---
ok   Config is a real schemastery schema        <- 有 toJSON()，dsh-settings 才会渲染表单
ok   and exposes a field dictionary              <- .dict 有 8 个字段
ok   with exactly the documented fields
ok   every field is marked volatile (so the settings form can edit it)
ok   bounds survive packaging                    <- compactCountMin.meta.max === 20
ok   and so do the defaults                      <- meta.default === 3
ok   the JSON-Schema document is produced
--- manifest the shell reads ---
ok   the published name / dsh.client platform=web / immediately=true
ok   the bundle patch path / the client export / it is no longer private
--- dependency resolution from a plain install ---
ok   @deepseek-ai/schemastery resolves
ok   and is the version the Config needs

19 passed, 0 failed
```

结论：**"能否真正发布到 npm 让其他用户直接安装"——打包与安装链路已经实测通得过**；
剩下的是账号动作（登录 + 上传），那一步只能由你完成。

**④ 顺带实测到的一个安装事实**

从 registry 形态安装会拉起 **523 个包**，因为本包把 `@deepseek-ai/dsh` 声明为 **peerDependency**
（插件本来就该如此，`dsh` 是宿主），而 npm 7+ 默认自动安装 peer。这不影响正确性——`dsh plugin add`
本来就是装进一个已经有 `dsh` 的 profile，peer 会被满足而不是重复下载整套。写出来是因为
"装一个插件为什么拉 523 个包"看起来像 bug，实际是 peer 语义。

### 5.6 包名从 `@local/` 改为 `@hjdd14/` 的回归

为了真正可发布，包名从 `@local/dsh-toolong-warning` 改成 `@hjdd14/dsh-toolong-warning`，
并按文档要求**同步改了客户端模块 id 与 cordis patch 行名**（三者必须一致，否则浏览器半静默不加载）。
改名后逐项复验：

- 374 条断言全过（`check-client.mjs` 现在会**断言这三处标识一致**，只改一部分会直接失败）。
- 隐私闸门 clean。
- 本机 profile 的 `dependencies`/`bundles` 同步改名并 `pnpm install`（`pnpm-lock.yaml` 一起更新），
  重启后 `moduleGeneration: 10`，两个自检 `pass:true`，`liveCount 1 = historyCount 1`，
  真实会话 `count: 1` 与日志中唯一一组压缩生命周期自洽。
- **设置命名空间 `toolong-warning` 与包名解绑**，所以改名没有重置任何设置。

---

## 6. 尚未验证 / 需要你确认的部分（诚实声明）

1. **悬浮窗的外观**：你已经截图确认过了——右上角出现了「长对话提醒 / 本会话已压缩 0 次」的悬浮窗，
   与 Host 上报的 `count: 0` 一致。这条**已验证**。
2. **你的页面不是通过回环地址打开的，所以 DSH 的表单写入被固定为只读——这是 DSH 的设计，不是插件缺陷。**
   依据（`@deepseek-ai/dsh-client-ui-settings/lib/client.js:1509`）：

   ```js
   const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";
   ```

   而 `isLoopback` 仅在页面主机名是 `localhost`、`[::1]` 或 `127.x` 时为真
   （`dsh-client-connection/lib/client.js:1333-1337, 1404`）。非回环页面走 `memory` 模式：
   表单初始状态直接是 `unavailable`、`writable: false`，`enqueue()` 对任何写入返回 `false`。
   也就是说**在非回环页面上，任何 DSH 插件的配置表单都是只读的**（`dsh-usage` 也一样）。
   你的第二张截图（刷新后）仍然是只读，正是命中了这条分支——不是 schema 修复没生效
   （schema 修复确实生效了：文案已经从旧的「配置只读」单行提示换成了新的分档说明）。
   本机 Web 服务只监听 `127.0.0.1:3080`，所以 `http://127.0.0.1:3080` 与 `http://localhost:3080`
   都可以编辑并写入 profile。
3. **为了让"设置页可改"不被上面的限制废掉，已补一条浏览器本地阈值通路（`generation 5` 起）。**
   非回环页面上三个阈值字段**现在可以改**，值存本浏览器并对本页生效；宿主每次请求重新校验边界，
   越界值忽略并回报原因（§5.1 有运行中宿主的实测输出）。`enabled` / `dismissible` 仍只读，
   因为它们决定宿主是否注册路由，只能在宿主侧改。
   **需要你刷新页面确认：字段不再是灰的、改完悬浮窗多出「浏览器本地阈值已生效」那一行。**
4. **"压缩后计数 +1"现在已在真实对话里观察到，而且正是它暴露了缺陷 9。**
   你在本会话执行压缩后，悬浮窗/接口显示 `2`，而日志里只有一组压缩生命周期 —— 据此定位并修掉了
   重复计数（§4.1）。修复后运行中进程的报告是 `count: 1`，与 `debug=1` 数出来的日志内容一致；
   接口对未加载会话也会读出 `count:1`（§5.2），两条路径一致。**"恰好 +1"这一点仍建议你再压缩一次
   复看**：我这次看到的是"压缩后计数不对"，不是"干净地 +1"。
5. **切换对话后的表现需要你确认一次。**
   本轮之前你会看到「该会话尚未被宿主加载」且必须刷新；现在未加载的会话也会从日志拿到计数。
   请切换一次对话，确认悬浮窗在 ≤15 s 内出现数字、且无需刷新页面。我能证明的是接口对未加载会话
   已经返回正确计数（§5.2 实测），**不能**替你证明你眼睛看到的那一行——那条只能你确认。
6. **语言切换的观感需要你确认一次（本轮新增）。**
   请刷新页面，在设置页「长对话提醒」分区把语言切到 English，确认**悬浮窗与设置页同时**变英文，
   且刷新后仍保持英文（选择存在浏览器里）。我验证的是字典完整、两份副本一致、切换逻辑有测试，
   没验证的是你屏幕上那两处的实际显示。

### 建议的收尾验证（各一步）

```powershell
# 1) 运行中的版本与两个自检（应返回 moduleGeneration: 8，且 selfTest / historySelfTest 均 pass）
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/health?selftest=1"

# 2) 随便挑一个别的会话 id 直接查（应返回 known:true 且 source:"history"，count 为数字）
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/state?sessionId=<另一个会话id>"

# 3) 当前会话的计数与日志是否自洽（count 应等于 debug.compactions 里成对出现的次数）
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/state?sessionId=<本会话id>&debug=1"

# 4) 设置 → 长对话提醒：把语言切到 English（悬浮窗与设置页应同时变英文，刷新后仍保持）
# 5) 把「最少压缩次数」改成 1、「占用阈值」改成 10
#    改完后悬浮窗应多出「浏览器本地阈值已生效：…」一行 —— 这是改动被宿主接收的直接证据
# 6) 用 http://127.0.0.1:3080 或 http://localhost:3080 打开页面再改一次，
#    这次会写入 profile 配置（对所有会话生效），刷新后仍在
# 7) 在浏览器里切换一次对话，确认无需刷新就能看到新的计数
# 8) 再执行一次 /compact，确认计数恰好 +1（而不是 +2）
```
