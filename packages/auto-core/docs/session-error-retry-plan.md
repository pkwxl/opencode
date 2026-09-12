# 会话错误重试改造计划(交接文档)

> 状态:**已实施**(2026-09-09,`packages/auto-core/src/runner.ts`)。待实施改动
> 1–5 全部落地,`test/runner.test.ts` 补齐第 1–4 点用例(6 个新用例,`bun
> typecheck && bun test` 全绿,431→437 pass)。第 5 点(`runTask` 跨进程恢复的
> "报错桩"兜底)代码已实现并随现有测试跑绿,但计划中要求的 `test/resume.test.ts`
> 端到端场景**未补**——需要完整 mock `executeWhole`/wrapup/verify 整条流水线才能
> 驱动到 `runTask` 顶部的恢复判定,成本与"双保险"分支的价值不成比例,留作后续
> 按需补充(如需要,从 `runTask` 约 345 行起的 `alive`/`usage`/`errorStub` 三个
> 变量入手)。
>
> **2026-09-09 追加:第 5 点的实现有缺陷——判据只看会话末条消息,已在生产现场
> (同目录 T-063 第二次事故)误杀一个真实累计 109.2k 上下文的会话,把第 1–4 点
> 在进程内保住的进度在跨进程边界上全部扔掉。判据已修正并补 6 个用例,详见文末
> 「事后修正」一节;第 1–4 点本身经现场验证按设计生效,不受影响。**
>
> **2026-09-12 追加:第 3 点的分叉源判据改为「保住最值钱的会话」——重试不再以
> `chain.id` 是否为空作分水岭,而是从**已积累上下文最多的活会话**分叉,首选刚失败的
> 会话本体;链上无会话可分叉时回落 fork 基点重新播种。原判据对子任务结构性不可达
> fork 分支(子任务只有一个提示词回合,失败那一刻 `chain.id` 必然为空),在一次
> provider 超时事故里连烧 3 小时 18 分零产出。详见文末「2026-09-12 修正:保住最值钱
> 的会话」一节与服务超时归因分析(provider-timeout-analysis-20260912.md §8)。**
>
> **2026-09-10 追加:第 4 点("remember 不再抢先落盘")经
> [session-resume-precedence-design.md](session-resume-precedence-design.md) 细化为
> "下发即写 + 可重试失败还原为下发前快照"——第 4 点把落盘从"sessionID 刚确定"挪到
> "回合结束后",修掉了中间失败态顶替真实会话,却顺带取走了"回合进行中被 kill 时对在跑
> 会话的认领"(现场:decompose 会话累计 29.4k 被 Ctrl+C 杀死,记录却停在上一阶段边界
> active=false,下次运行不复用)。细化后:下发成功即写 active 认领在跑的会话,可重试
> 错误把 progress.json 还原为下发前快照(被弃 fork 副本不顶替真实恢复点)——第 4 点要防的
> 病理仍被防住,认领能力恢复。第 5 点判据不变。**
>
> 本计划修订 `precise-resume-plan.md` 中"维持现状"一条:「runSession 运行中瞬时
> 错误重试仍换新会话」——该现状已被证实是一个实际发生过的 bug 根因,不再维持。

## 问题现场(T-062 事故复盘)

案发目录:`/workspace/kernel-dm-stripe`(auto-migrate 用户任务)。

1. `run-2026-09-09_11-30-18.log`:`13:59:22` 子任务 12 从共享基点 fork 出会话
   `ses_f7988a9c5ffeAaoA8H2z4dUZW4`,老实读完 S01–S11 全部 11 个文件(`13:59:22`–
   `14:00:18`),`14:00:50` 开始正式撰写主产物,工作到 `14:08:06` 撞上
   「You've reached your 5-hour usage limit」(Kimi API 403,payload 里明确带
   `"isRetryable":false`)。
2. `runSession()` 的重试循环(`src/runner.ts:1758` 起)对任何 `会话错误:` 前缀的
   阻塞结果一律执行 `chain.id = undefined` 后重试——**不区分错误是否值得重试,
   也不管当前会话是否已经积累了真实进度**。于是:
   - 第 1 次重试开了空白新会话 `ses_f7980ae04ffeWjCxLiXJCnh6aF`,同样秒撞限额;
   - 第 2 次(重试耗尽,`RETRIES=3`)又开了空白新会话 `ses_f7980aca7ffeA6ygTUvKIh2zNq`,
     还是秒撞限额,最终阻塞:「会话错误:...(已换新会话自动重试 2 次仍失败)」。
   - 真正干了活的 `ses_f7988a9c...` 从此无人再引用——不是被显式丢弃,是被
     "一撞错就换白板重来"的重试策略架空了。
3. `attempt()`(`src/runner.ts:1832`–`1845` 附近)在拿到 `sessionID` 之后、
   `client.session.prompt()` 发出之前就调用 `remember()` 把该 id 写入
   `progress.json` 标为 `active:true`——不管这一轮最终是否成功。三次尝试里最后一次
   (空白会话 `ses_f7980aca7ffe`)因此成为最终落盘的"可恢复会话"。
4. 下一次运行(`run-2026-09-09_14-09-55.log`)的跨进程恢复判定(`runTask`,约
   `src/runner.ts:345`)只用 `sessionAlive()`(仅确认会话存在,`1916`–`1919` 行)
   判断"可复用",不检查这一轮是否真有实质产出。于是它自信地"复用"了
   `ses_f7980aca7ffe`——日志打出"上下文不丢,已用 0/262.1k tokens,0%",但实际
   `sqlite`(`~/.local/share/opencode/opencode.db`)里查到该会话历史只有两条:
   原始 23KB 提示词 + 一条 tokens 全 0 的纯报错桩。子任务 12 被迫从零重新发现全部
   状态(重读 CURRENT.md、git status、逐个重读 S01–S11),且上下文里还白白背了一份
   已经作废的 23KB 提示词 + 一条报错桩 + 第二次近乎重复的 23KB 提示词——比完全不
   复用还差(该重做的活一点没少,还多付了冗余上下文的 token)。
5. 更上游的浪费:`watch()` 收到 SSE `session.error` 事件时(`src/runner.ts:2188`
   附近)只取了 `props.error.data.message` 拼进错误字符串,`isRetryable` 这种结构化
   字段读了就扔,完全没参与"要不要重试"的判断——哪怕 API 已经明确说了"重试没用"。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 不可重试错误(`isRetryable === false`) | 不再走"换新会话重试"整个循环:直接返回 `blocked`,`chain.id` 保持不动(真正有内容的会话不被牺牲) |
| 可重试的瞬时错误 | 不再开空白新会话重发原提示词;改为 fork 一份独立副本重试同一条提示词。**分叉源由 2026-09-12 修正为「已积累上下文最多的活会话」**(原为 `chain.id`) |
| fork 副本重试成功 | "晋升":`chain.id` = 副本 id,链路照常往下走;原会话不必显式删除,自然沉没 |
| fork 副本重试仍失败 | 丢弃该副本,重新按价值择源再试一次,直至 `RETRIES` 用尽。**2026-09-12 修正前为「从同一个从未被动过的原 `chain.id` 会话重新 fork」**;修正后副本自身若已积累更多上下文即成为新的首选源(原会话仍在候选内) |
| `chain.id` 本就为空(本轮是这个会话的第一条消息,还没成功过) | ~~维持现状:直接开空白新会话重试~~ **2026-09-12 修正:失败会话本体若已积累用量即分叉它;确为纯报错桩(used=0)才回落 fork 基点重新播种,基点也没有才开空白新会话。** 「没有值得保护的内容」的判据由「链上有没有会话」改为「失败会话里有没有内容」 |
| `progress.json` 落盘时机(`remember()`) | 只有在"晋升"发生(即某个会话确认真正跑完一轮,不是被判定为可重试会话错误的半截)时才把该 session id 写入 `active`;不再在 `sessionID` 刚确定、结果未知时就抢先落盘 |
| 用户最初提出的方案 | 采纳(fork 重试、失败即弃、原会话不受影响),但补一层前置判断——像本次事故这种 `isRetryable:false` 的错误,fork 出来重试毫无意义(账号级限流,换哪个会话都一样失败),应直接跳过整个重试环节,而不是先 fork 试一次再放弃 |

## 待实施改动(均在 `packages/auto-core/src/runner.ts`,行号为写本文档时的位置,实施时以当前代码为准)

1. **`watch()` 的 `session.error` 处理(约 2186–2194 行)**:从 `props.error.data`
   里一并取出 `isRetryable`(字段不存在或非 `false` 一律按可重试处理,保守缺省),
   通过 `Watch` 返回值(新增字段,如 `retryable?: boolean`)透传给调用方;多个
   `session.error` 事件叠加时取"只要出现过一次 `false` 就不可重试"(悲观口径)。
2. **`attempt()` 的返回值**:`result.error` 分支(约 1877 行 `if (result.error) return
   { type: "blocked", question: ... }`)一并带出 `retryable`,不再是纯字符串
   `blocked`(需要扩展 `SessionResult` 的 blocked 变体,或另起一个字段区分)。
3. **`runSession()` 的重试循环(约 1758–1774 行)**:
   - 先看 `retryable === false`:直接 `return` 阻塞结果,不再执行任何 `chain.id
     = undefined` / 重试逻辑。
   - 否则,若 `chain.id !== undefined`(重试前这个位置已经确认过是"有真实会话"
     而非空槽位):调用 `forkSession(client, chain.id, ...)` 得到副本 id;副本
     id 存在则用它作为下一次 `attempt()` 的 `chain.pending`(复用现成的 fork
     预创建通道,`attempt()` 里 `forked = reuse ? undefined : chain.pending` 已有
     消费逻辑,天然衔接),**不修改 `chain.id` 本身**;fork 失败(`forkSession`
     返回 `undefined`)才退化为现状(空白新会话)。
   - 副本这轮成功(`attempt()` 内部 `chain.id = sessionID` 正常推进)即完成晋升,
     无需额外代码——因为 fork 副本一旦被 `attempt()` 使用并成功,`chain.id` 自然
     变成它。
   - 副本这轮又失败:**不要**把 `chain.id` 改成这个失败的副本 id(当前
     `attempt()` 在返回错误前已经把 `chain.id = sessionID` 设成了失败会话——这一
     行需要收紧:只在非 `会话错误:` 阻塞或成功路径时才允许 `chain.id` 落到失败
     会话上,retryable 错误路径需要把 `chain.id` 显式还原成本轮重试前的原会话
     id,才能保证"下一次重新 fork"fork 的还是原会话而不是刚失败的副本)。
4. **`attempt()` 里 `remember()` 的调用时机(约 1832–1845 行)**:把首次
   `await remember()` 从"确定 `sessionID` 之后"挪到"确认这一轮不是可重试会话错误
   之后"(即成功、或不可重试的阻塞、或非会话错误类阻塞);会话错误且判定为
   `retryable` 的中间失败态不再写 `progress.json`。中途进程被杀等异常退出场景
   因此保留的是"最后一次真正跑完的会话",而不是刚创建还没验证过的会话——这同时
   修掉了"remember 抢跑"和"重试链清空真实进度"两个问题。
5. **`runTask()` 的跨进程恢复判定(约 345 行)**:作为兜底,`sessionAlive()` 判定
   旁边补一个"末轮非纯报错桩"的检查(`sessionUsage()` 已经算出 `usage.used`,
   之前只用来打日志)——若 `usage.used` 为 0 且最后一条 assistant 消息本身就是
   错误(而不是"确实是空会话第一轮"的正常场景,需要结合是否有过更早的真实
   assistant 消息判断),归入"原会话不可复用,开新会话继续"分支。有了第 3/4 点
   的修复后,理论上 `progress.json` 里不会再出现这种会话;此处作为双保险,防止
   历史遗留的 `progress.json`(改造上线前生成的)在改造后仍被错误复用。

## 验证计划

- `packages/auto-core/test/runner.test.ts`:补一组用例——
  1. `isRetryable:false` 的会话错误 → 断言不发生任何 `session.fork`/新
     `session.create` 调用,直接返回 blocked,且 `chain.id` 不变。
  2. 可重试错误 + `chain.id` 已有历史 → 断言调用了 `session.fork(chain.id)`,
     重试成功后 `chain.id` 变为 fork 出的 id;重试仍失败后 `chain.id` 保持为
     **原始**会话 id(不是失败的 fork id),且第二次重试确实是对同一个原始
     `chain.id` 再次 `fork`(不是对失败 fork 的 fork)。
  3. `chain.id` 本为空(该会话首条消息即失败)→ 保持现状,断言走的是空白新
     会话路径,不触发 fork。
  4. `remember()`/`progress.json` 落盘时机:构造一次"会话错误但 retryable"的
     单轮失败,断言 `progress.json` 在该轮结束后仍是重试前的值,不被失败的
     中间态覆盖。
- `packages/auto-core/test/resume.test.ts`:补一条端到端场景——模拟"跨进程恢复
  遇到一个只有报错桩、无真实产出的历史会话",断言恢复逻辑判定为不可复用(第 5
  点的兜底分支被触发)。
- 全量:`bun typecheck && bun test`(包目录内运行,仓库根目录不能跑测试)。
- 文档同步:本文件完成后,补一条决策行到 `docs/precise-resume-plan.md`(或直接
  在其"维持现状"处打删除线注明"已被 session-error-retry-plan.md 取代"),避免
  未来读者以为现状仍是"重试即换白板会话"。

## 已知不改动的范围

- `NETWORK_FAILURE` 正则触发的 `server.restart()` 逻辑不变(该重启针对的是
  server 进程级故障,和本文的会话级 fork-重试是两个维度,可以共存)。
- fork 的 provider 前缀缓存友好特性(`fork-decompose-design.md` §4.2/4.3)不受
  影响——本改造只是把"重试时开的新会话"从"空白"换成"fork 自 chain.id",复用
  的正是同一套 `forkSession()`/`seedForkSession()` 基础设施。

## 事后修正(2026-09-09):第 5 点判据误杀长会话(T-063 复盘)

第 5 点按本文件原文实现后,在**同一目录**的下一次事故中反向起效,把第 1–4 点
好不容易保住的会话又扔了。本节记录现场与修正,后续读者以本节为准。

### 现场

案发仍是 `/workspace/kernel-dm-stripe`,任务 T-063(批次 III 设计)。

1. `run-2026-09-09_15-58-55.log:2053`(17:55:26):子任务 8 会话
   `ses_f78b6649cffe1X1U02wb383fhp` 工作 6m23s、累计 **109.2k/262.1k(42%)**
   真实上下文后撞上 Kimi 5 小时限额(`isRetryable:false`)。第 1–3 点按设计生效:
   `⛔ 遇到不可重试的会话错误(重试无意义),直接阻塞`,不 fork、不换新会话,
   `chain.id` 留在该会话上(`runner.ts` attempt 的 `else` 分支 `remember()` 落盘;
   `runTask` 对"会话错误"阻塞跳过 `persistStage`,故 `active:true` 记录得以保留)。
   DB 里该会话标题被改为 `T-063 blocked …`,即改名时 `chain.id` 就是它——第 1–4
   点在进程内的行为直接由此坐实。
2. `run-2026-09-09_22-26-31.log:14`(22:26:34):下一次运行读出该记录,判据
   `usage.used === 0 && usage.errorStub` 成立,打出
   `(原会话只挨了一记报错、无真实产出,开新会话继续)`——109.2k 上下文被丢弃。
3. 代价:S08 从 12.3k 的 digest 前缀重新分叉,逐个重读 `docs/T-063/S01–S07/index.md`,
   会话重新长到 **116.0k** 才收口(22:40:19)。与本文开头 T-062 的"被迫从零重新
   发现全部状态、比完全不复用还差"是同一形态,只是触发源从"重试换白板"换成了
   这个兜底分支。

### 根因

`sessionUsage()` 当时**只取末条 assistant 消息**算用量。opencode server 侧的行为是:
每轮 LLM 调用前先落一条 `tokens` 全 0 的 assistant 行(`packages/opencode/src/session/prompt.ts`
建行),provider 报错时 `processor.ts` 的 `halt()` 只往该行写 `error`、`step-finish`
从未发生,`tokens` 保持全 0(`packages/opencode/src/session/processor.ts`)。于是
"跑了很多活、最后一轮撞错"的会话,末行与旧事故里那个**空会话**的末行完全同形:
`{tokens: 0/0, error: APIError}`。单看末条无法区分二者,而本可区分它们的正是本文件
第 5 点自己写的要求——"需要结合是否有过更早的真实 assistant 消息判断"——实现时漏了
这一半。

更要紧的是:修正第 1–4 点之后,**"末行为报错桩的长会话"成了 `progress.json` 里
最常见的记录形态**(本工作区最高频的失败方式就是这个限额错误),所以该误判不是边角
情况,而是每次不可重试错误阻塞后的下一次运行必然触发。

### 修法

`sessionUsage()` 改为先求 `basis` = 从末条往前第一条**真正跑完过**的 assistant 消息
(`tokens.input + tokens.cache.read > 0`):

- `used`/`pct`/`limit` 一律由 `basis` 重建;`basis` 不排除带 `error` 的行——
  step-finish 之后才判定的错误(输出超限、内容过滤、压缩前超限等)自带真实
  tokens,正是末端用量的最佳估计。
- `errorStub` 仅当**整条会话都没有 `basis`**、且末行本身就是报错时才为真——
  即旧"重试即换白板会话"留下的纯报错桩空会话,第 5 点原本要检出的形态照旧检出。

一处改动同时收三个问题:恢复误杀长会话、被 kill 会话(末行是 0-token 无 error 的
残行)的用量继承成假 0、以及 session 模式 fork 基点 `sessionUsed()` 读 0 导致
"基点用量达 cap/2 不起分叉"门禁失效。

### 验证

- `test/runner.test.ts` 新增 `sessionUsage(恢复复用判据)` 6 例(末行报错桩但此前
  有真实产出 / 纯报错桩空会话 / kill 残行 / 带真实 tokens 的错误行 / 尚无 assistant
  消息 / messages 查询失败)。`bun typecheck && bun test` 全绿,445→451 pass——这两个
  数取自当时并存另一会话 2 条未提交 taskContext 用例(后落 `b0eceec96`)的工作树;
  单看本修复是 443→449(把那两个测试文件回退到本 commit 实测 `Ran 449 tests`)。
- 真实数据回放:取 `ses_f78b6649cffe…` 的全部 19 条消息喂给新旧两版判据——旧版
  `{used:0, errorStub:true}`(复现 22:26 那次丢弃),新版 `{used:109192, pct:42,
  errorStub:false}`(与运行内日志的 109.2k/42% 一致)。
- 口径全量对比:`/workspace/kernel-dm-stripe` 539 个会话中,旧判据标出 16 个报错桩、
  其中 **9 个是误判**(此前有真实产出);新判据标出 7 个,全部是真正只有报错桩的
  会话——误判清零,原检出能力不丢。
- 未做:本文件"验证计划"里为第 5 点设想的 `test/resume.test.ts` 端到端(需 mock
  `executeWhole`/wrapup/verify 整条流水线才能驱动到 `runTask` 顶部的恢复判定)。
  改判据落在 `sessionUsage` 上并已按其单点直接建测,`runTask` 侧只剩
  `used === 0 && errorStub` 一行合成条件,性价比仍不支持补那条 e2e,留作按需。

### 落地范围

只改 `packages/auto-core`(核心):`src/runner.ts`(`sessionUsage` + 恢复分支注释)、
`test/runner.test.ts`、`docs/behavior.md`、`docs/structure.md` 与本文件。按分支模型
核心改动只落 `auto-core` 分支,`migrate`/`auto` 两个 worktree 经 `git merge auto-core`
刷新快照获得(事故目录跑的是 `opencode-migrate`,合并前该处仍是旧判据)。

---

## 2026-09-12 修正:保住最值钱的会话

### 事故形态

`zai-coding-plan/glm-5.3-flash` 上游出现"连接已建立但长时间不吐字"的停顿,撞上
opencode 1.18.x 对所有 provider 强制生效的 300s `headerTimeout`/`chunkTimeout`。
一次这样的失败在 ai-sdk 内层就是 6 次请求 × 300s + 退避 ≈ 31 分钟;driver 外层再
重开会话重试 3 次,单个子任务 3 小时 18 分零产出后阻塞(三个会话 out token 分别
2677 / 2161 / 2403,而正常同类子任务为 15k–25k)。完整证据链见服务超时归因分析
`provider-timeout-analysis-20260912.md`。

### 为什么既有 fork 重试没兜住

两道门都按原设计关着:

1. **判据是 `chain.id`,而子任务的 `chain.id` 必然为空。** 一个子任务会话只有
   **一个提示词回合**(整份子任务在这一回合里跑十几到二十几步),失败那一刻它还
   没成功过任何回合;`REUSE_SESSION=off` 时更是每个提示词都开新会话。于是
   `if (chain.id !== undefined)` 这一支对子任务**结构性不可达**——它只在多回合链
   或阶段级旁路会话上才可能生效(T-062/T-063 两起 Kimi 限额事故正是那种形态,
   这解释了为什么该机制在那儿有效、在这儿无效)。
2. **重试比首次尝试更冷。** fork 播种的 `chain.pending` 消费即清,`chain.forkBase`
   仍在、基点会话仍活着,但重试环从不查它。DB 可验证:T-013 的 ctxbase 基点建于
   05:49(前缀 12.8k tokens),S03 第 1 次尝试继承了它,第 2、3 次尝试则没有该继承
   消息、首条 assistant `in=9738, cache_read=0` —— 纯冷启动。即重试不仅没保住失败
   会话里 170–200k 的已核实研究,连原本免费的暖前缀也扔了。

### 新判据

重试时按**已积累的上下文用量**降序择源,取第一个 fork 成功的:

| 顺位 | 源 | 说明 |
| --- | --- | --- |
| ① | 刚失败的会话本体(`chain.failed`) | 超时/流中断与会话内容无关(provider 侧停顿),会话里的已核实产出是本轮最值钱的资产。`used = 0` 的纯报错桩不进候选——那里没有值得保护的内容,fork 只会把报错桩背进副本 |
| ② | 链上原会话(`chain.id`) | 多回合链才非空;复用轮里与 ① 同一个会话,去重后只试一次 |
| ③ | fork 基点(`chain.forkBase`) | 链上无会话可分叉时重新播种(经 `seedForkSession`,与 fork-decompose 设计 §4.3「每项重新从基点分叉」同语义),至少赚回暖前缀 |
| ④ | 空白新会话 | 以上都不可用时的现状回落 |

不变量三条:**① 一律 fork 副本而非直接复用**,原会话不受影响、失败即弃,
`progress.json` 的还原逻辑不动,恢复点仍是原会话;**② 副本承接源会话的 `used`**,
2×cap 交接阈值按"前缀 + 新增"计算;**③ 此处不设 `seedForkSession` 的"用量达 cap/2
即冷启动"护栏**——那道护栏防的是新子任务背上过大前缀,而重试是同一条提示词的续命,
前缀大恰恰因为活干得多。

已知代价:副本尾部带着那条 0-token 报错消息,重试提示词落在它后面。相对"从零重新
发现全部状态"(事实基线第 4 点记过的反例),这笔交换是划算的。

### 落地范围

只改 `packages/auto-core`(核心):`src/runner.ts`(`SessionChain.failed` 新槽位 +
`attempt()` 可重试分支记下失败会话、晋升即清 + `runSession()` 的择源梯队)、
`test/runner.test.ts`(重试用例的 fake 支持按会话注入真实用量,新增 7 个用例覆盖
子任务形态、价值排序两向、前缀用量承接、基点重新播种、报错桩不分叉与 `failed` 清空)、
`docs/behavior.md`、`docs/structure.md` 与本文件。

`bun typecheck` 干净,`bun test` 全绿(459→466 pass)。原有三个用例(零用量 fake)
不改自通——失败会话为报错桩时新梯队逐字节退化为旧行为,这正是判据向后兼容的证据。

