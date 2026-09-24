# dsh-toolong-warning

[English](README.md) | **中文**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-374%20assertions-brightgreen.svg)](#测试)
[![dsh](https://img.shields.io/badge/dsh-%3E%3D0.1.7--rc.1-6f42c1.svg)](#环境要求)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-339933.svg)](https://nodejs.org)

一个 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）插件：当一段对话已经长到
**不值得继续**时提醒你新开对话，其余时间保持沉默。

它统计每段对话被**压缩**过几次，把这个数字常驻显示在右上角悬浮窗里；只有**反复压缩过**、并且此后
**确实又烧掉大量 token** 时，才会追加一行警告。

> **这个插件的重点在于它「不说」什么。** 会喊狼来了的提醒没人会看，所以下面每条规则都写成：
> 一旦缺少支撑警告的依据，就宁可沉默。

<p align="center">
  <img src="docs/overlay.png" alt="悬浮提醒窗" width="480">
</p>

## 目录

- [你会看到什么](#你会看到什么)
- [什么时候才会提醒](#什么时候才会提醒)
- [安装](#安装)
- [设置](#设置)
- [工作原理](#工作原理)
- [诊断接口](#诊断接口)
- [环境要求](#环境要求)
- [测试](#测试)
- [隐私](#隐私)
- [验证状态](#验证状态)
- [许可](#许可)

## 你会看到什么

右上角一个自持悬浮窗。它走 `shell.overlay` 插槽，拿不到该插槽时退化为自己的 fixed 容器，
所以从不与别的插件抢位置：

```
┌──────────────────────────────┐
│ 长对话提醒                –  │
│ 本会话已压缩 3 次            │
└──────────────────────────────┘
┌──────────────────────────────┐
│ ⚠ 本次对话过长，建议新开一个   │
│   对话                       │
│ 上下文占用已达 62%，距上次压缩 │
│ 又消耗了约 310k token。       │
│ 已成功压缩 3 次（阈值 3 次）； │
│ 当前上下文占用 62%            │
│ [知道了]  [调整阈值]          │
└──────────────────────────────┘
```

- 计数行**始终**显示；警示卡片只在规则满足时出现。
- **知道了**只隐藏当前这一次提醒，计数继续更新。
- **调整阈值**直接跳到设置页里本插件的分区。
- 插件被关闭、或没有打开会话时不显示任何东西。
- 整个界面**中英双语**，语言开关就在插件自己的设置分区里 —— 见[设置](#设置)。

## 什么时候才会提醒

三条件**全部**成立才提醒。任何一项依据缺失就沉默。

| # | 条件 | 默认值 |
|---|---|---|
| 1 | **成功完成的压缩次数** —— 只有 `compaction/start` 配上**不带 `error`** 的 `compaction/end` 才算。压缩失败、正在进行中的压缩、纯裁剪（`compaction/prune`）都不计数。 | ≥ 3 次 |
| 2 | **距上次压缩的额外消耗** —— 计费 token（`uncachedInput` + `cacheRead` + `cacheWrite` + `output`），由会话日志里携带的用量样本累计。 | ≥ 200,000 |
| 3 | **或者**上下文占用（下一次请求预计消耗 ÷ 模型上下文窗口）达标，**或者**额外消耗达到阈值的**两倍** —— 后者是给未声明上下文窗口的路由留的后路，所以门槛翻倍。 | ≥ 50% **或** ≥ 400,000 |

### 它会刻意保持沉默的情况

| 情况 | 结果 |
|---|---|
| 又长又贵，但**从未**压缩过 | 沉默 —— 只显示计数（`0`） |
| 只压缩过 2 次（默认阈值是 3） | 沉默 |
| 压缩过 3 次，但上下文宽裕、也没额外烧钱 | 沉默 |
| 压缩过 3 次、额外消耗 25 万、占用不高 —— 过了阈值但不到两倍 | 沉默 |
| 完全拿不到用量数据（哪怕占用 95%） | 沉默 |
| 该路由没声明上下文窗口，且额外消耗很低 | 沉默 |

上面每一行都在 `scripts/test-detect.mjs` 里有断言；**该提醒**的行同样有断言 —— 漏报与误报两个方向都被钉住了。

当前这段对话就是规则生效的现场例子：2100+ 事件、累计约 8700 万 token、占用已到约 60%，
插件仍然什么都没说 —— 因为它**从未被压缩过**（`gate: "compactions"`）。

## 安装

### 环境要求

- dsh `>= 0.1.7-rc.1`（`@deepseek-ai/dsh`）
- 安装者侧 Node `>= 22.19`（测试用到现代内置模块）
- `web` profile（本插件带浏览器半，其它界面下是空操作）

### 1. 从 npm 安装

```powershell
dsh plugin --profile web add @hjdd14/dsh-toolong-warning
```

### 2. 从 Git 仓库安装

```powershell
dsh plugin --profile web add "git+https://github.com/Hjdd14/dsh-toolong-warning.git"
```

不需要先发布任何东西。本插件是**手写 JavaScript、没有构建步骤**，所以 pnpm 没有
`prepare`/`postinstall` 需要审批，安装不会卡在构建确认上。若某个 dsh 版本仍然报告有待批准的构建脚本，
把它打印出的确切键名加进 `<DSH_HOME>/profiles/web/pnpm-workspace.yaml` 的 `allowBuilds` 后重跑即可。

### 3. 克隆后按本地路径安装（开发用）

```powershell
git clone https://github.com/Hjdd14/dsh-toolong-warning.git
dsh plugin --profile web add "link:<克隆目录的绝对路径>"
```

改 `client.js` 会在约 500 ms 内在浏览器里重载插件。改宿主侧文件（`index.js`、`src/*.js`）需要
**新起一个 `dsh web` 进程** —— 见[诊断接口](#诊断接口)。

### 4. 手改 profile（CLI 不可用时兜底）

在 `<DSH_HOME>/profiles/web/package.json` 里：

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

然后在 `<DSH_HOME>/profiles/web` 里执行 `pnpm install`，再重启 `dsh web`。

### 安装打包好的 tgz

```powershell
npm pack                       # 生成 hjdd14-dsh-toolong-warning-0.1.0.tgz
dsh plugin --profile web add "file:<tgz 的绝对路径>"
```

### 卸载

```powershell
dsh plugin --profile web remove @hjdd14/dsh-toolong-warning
```

或在 dsh web 侧边栏的**插件**页里停用。

## 设置

设置页里本插件的分区包含语言开关与全部阈值。数值写入 profile 的 cordis patch，改完立即生效。

| 字段 | 默认 | 范围 | 含义 |
|---|---|---|---|
| `enabled` | `true` | 开关 | 关闭后不注册状态接口，也不显示悬浮窗 |
| `compactCountMin` | `3` | 1–20 | 至少要成功压缩几次才可能提醒 |
| `occupancyPercentMin` | `50` | 10–95 | 上下文占用达到该百分比即视为"已经很贵" |
| `tokensSinceCompactionMin` | `200000` | 10000–5000000 | 距上次成功压缩后又消耗多少计费 token 才算"大量多余消耗"；达到该值**两倍**时，即使拿不到占用也会提醒 |
| `statsIntervalMs` | `15000` | 5000–120000 | 悬浮窗刷新间隔（页面不可见时暂停轮询） |
| `dismissible` | `true` | 开关 | 是否允许用「知道了」隐藏本次提醒 |
| `historyReadTtlMs` | `30000` | 5000–600000 | 宿主没加载的会话，其历史读取结果的复用时长 |
| `historyReadTimeoutMs` | `5000` | 1000–30000 | 单次历史读取的时限；超时就显示"暂时读不到该会话" |

分区下半部分显示**当前会话的实测值**（压缩次数、累计计费 token、距上次压缩的额外消耗、上下文占用）
以及*为什么*现在没提醒 —— 这正是校准阈值需要的信息。

### 语言

同一分区里有 `中文 / English` 选择器。选择存在浏览器里，**立即**作用于悬浮窗与设置分区（无需刷新）；
当 harness 的共享语言服务可写时，也会一并推送过去 —— 所以在多数部署上整个界面会跟着切换。
DSH 自带的全局语言开关在**设置 → 通用**里。

### 两种生效范围，以及原因

DSH 把**非回环**页面的配置写入固定为只读
（`persistence = ctx.remote.$host.isLoopback ? 'host' : 'memory'`），这对**所有**插件的配置表单都成立，
不是本插件的限制。与其显示一堆死控件，本插件选择诚实地降级：

| 打开页面的地址 | 三个判定阈值 | `enabled` / `dismissible` |
|---|---|---|
| `http://127.0.0.1:3080` 或 `http://localhost:3080`（回环） | 写入 **profile 配置** —— 对所有会话生效 | 可改，写入 profile |
| 其它地址（IP、主机名、隧道） | 仍可修改，存在**本浏览器**，只对本页生效 | 只读（它们决定宿主是否注册路由） |

浏览器本地的值随每次状态请求以查询参数带给宿主，**宿主每次都重新校验并夹取边界**，且从不落盘。
越界或非整数的值会被忽略并回报原因。判定始终发生在宿主侧，页面无法强制制造提醒。

## 工作原理

```
浏览器（client.js）                        Host（index.js + src/*）
────────────────────                       ─────────────────────────
悬浮窗                                     ctx.on('session/event')  ── 增量折叠（live）
  ├─ 会话目录 → 主视图会话 id                └─ 首次询问时回放该会话整段日志
  ├─ 每 15s 轮询 /api/.../state          ctx.sessionProjections
  └─ 计数行 + 警示卡片                      └─ tokenUsage / contextPressure
设置分区                                   ctx.sessionQuery.readSession(id) ── 历史（冷读）
  ├─ 语言开关                                └─ 宿主没加载的会话
  └─ ctx.configForms('toolong-warning')  两条只读、仅回环的路由
      8 个 volatile 字段                     /api/dsh-toolong-warning/state  （按会话）
                                             /api/dsh-toolong-warning/health （探针）
```

### 三级数据源，逐级降级

| # | 条件 | 响应 | 说明 |
|---|---|---|---|
| 1 | 会话在**本进程内 live** | `source: "live"` | 最全：占用与用量来自 meter 投影 |
| 2 | 未加载，但日志能读到 | `source: "history"` | 计数与消耗由日志折出 —— 这就是"切换对话不用刷新就出数字"的原因 |
| 3 | 两者都拿不到 | `known: false` + `reason` | `session-not-loaded` 或 `history-unavailable`；**绝不提醒** |

- 浏览器看不到会话事件日志（客户端只有会话目录），所以所有测量都在宿主侧完成、通过同源路由下发。
- 两条路径**共用同一套折叠与判定函数**，因此同一会话上的计数必须相等；`?selftest=1` 让运行中的
  进程在真实会话上自证这一点。
- 历史源走官方支持的只读服务，**不读**任何私有存储路径（`$DSH_HOME/storages/**`、会话日志文件）；
  也不把会话塞进 live tracker，并带 TTL 缓存与超时上限。
- 浏览器半是纯 JavaScript，通过 `dsh.client` + `exports["./client"]` 注册，React 从 shell 模块表取；
  除 React 与本包自己的 `src/i18n.js` 外不 import 任何东西 —— 无构建步骤、无打包依赖。
- 宿主半除 `@deepseek-ai/schemastery` 外**不 import 任何 `@deepseek-ai/*` 运行时包**：设置表单要求它是
  真 schema，该模块按显式候选路径加载，拿不到时退化为结构等价的描述符。

## 诊断接口

两条路由都**只接受回环**请求（socket 地址 *且* `Host` 头 *且* 同源标记），响应一律 `no-store`。

```powershell
# 插件是否激活、当前加载的版本、当前生效阈值
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/health"

# 在运行中的进程里跑自检：合成会话走完整判定链路 + 真实会话上对比 live 与 history 的计数
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/health?selftest=1"

# 某个会话的判定与原始数值。debug=1 附带事件类型统计与压缩生命周期 —— 不含任何消息内容
curl.exe -s "http://127.0.0.1:3080/api/dsh-toolong-warning/state?sessionId=<会话id>&debug=1"
```

`state` 字段：`known`、`source`（`live` / `history`）、`count`、`lastCompactionSeq`、
`tokensSinceCompaction`、`billedTokens`、`occupancyRatio` / `projectedTokens` / `contextWindow`、
`shouldWarn`、`reasons`、`gate`、`thresholds`、`thresholdsSource`、`configVersion`、
`sampledEvents`、`droppedEvents`、`coldReads`。

**`moduleGeneration` 是承重的。** 宿主侧改动只有**新起一个 `dsh web` 进程**才会加载 ——
dsh 只对客户端 bundle 热重载。这个版本号存在的意义，就是让运行中的进程自报它手上是哪份代码，
而不是靠推断。

## 环境要求

| | |
|---|---|
| dsh | `>= 0.1.7-rc.1` |
| 界面 | `web` profile（其它界面下浏览器半是空操作） |
| 可选 | `@deepseek-ai/dsh-session-query` —— 启用历史源。缺失时宿主没加载的会话就是测不了（等同旧行为） |
| 宿主依赖 | `@deepseek-ai/schemastery` `~3.18.4`，设置表单需要。注意 profile 里可解析的裸包 `schemastery` 是 3.18.0，**没有** `.volatile()`，会让表单静默不可用 |

## 测试

374 条离线断言，不需要 harness、不需要网络：

```powershell
npm test
```

| 套件 | 断言数 | 覆盖内容 |
|---|---|---|
| `scripts/test-detect.mjs` | 98 | 判定规则本身：每个沉默场景与每个提醒场景、折叠语义、配置解析 |
| `scripts/test-i18n.mjs` | 58 | 双语字典一致性，**以及模块与内联产物副本**的一致性、占位替换、回退、初值解析、语言存储 |
| `scripts/test-coldread.mjs` | 49 | 历史折叠、缓存/重校验/TTL、fresh 读绕过缓存、超时与失败降级、与 live 折叠的一致性 |
| `scripts/test-routes.mjs` | 98 | 路由组装、回环围栏、自检、阈值覆盖、历史分支，以及"重复投递的压缩事件绝不被计两次" |
| `scripts/check-client.mjs` | 71 | 产物结构、schema 形状、挂载、以及真正 import 并运行 `client.js` |

```powershell
npm run check:hygiene   # 仓库隐私闸门：不含个人路径、会话 id、凭据
npm run check:release   # npm test + check:hygiene
```

`verification.md` 记录了验了什么、怎么验的，以及同样重要的 —— **哪些没验**。

## 隐私

这个仓库是按"可以安全公开"设计的：

- 不含个人路径、用户名、会话 id 或凭据。这是**被强制检查**的，不是承诺：
  `npm run check:hygiene` 会扫描每个文件，命中即失败。
- 插件从不读取私有存储路径；历史读取走官方支持的 `sessionQuery` 服务。
- 诊断路由仅限回环，且不返回任何消息内容 —— 需显式请求的 `debug` 只报告事件**类型**与压缩生命周期。
- 没有构建脚本、没有遥测，除上述同源路由外没有任何网络调用。

## 验证状态

`verification.md` 记录了验了什么、怎么验的、以及哪些没验。要点：

- 判定规则**双向覆盖** —— 每个必须保持沉默的场景与每个必须提醒的场景都有断言，另有运行中自检
  在真实进程里驱动真实路由。
- live 折叠与 history 折叠的计数由同一个自检在真实会话上互相比对。
- 悬浮窗的渲染有结构化断言；它的**外观**由截图目视确认，而非自动化视觉检查。
- 设置**表单在非回环页面上是只读的**，这是 DSH 的设计。浏览器本地阈值覆盖是为了让这个限制可用，
  它不能替代写入 profile。

## 许可

[MIT](LICENSE) © 2026 Hjdd14
