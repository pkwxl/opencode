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
| 可重试的瞬时错误 + `chain.id` 已有真实累计上下文 | 不再开空白新会话重发原提示词;改为 `forkSession(chain.id)` 得到独立副本,在副本上重试同一条提示词 |
| fork 副本重试成功 | "晋升":`chain.id` = 副本 id,链路照常往下走;原会话不必显式删除,自然沉没 |
| fork 副本重试仍失败 | 丢弃该副本,**从同一个从未被动过的原 `chain.id` 会话重新 fork** 再试一次,直至 `RETRIES` 用尽 |
| `chain.id` 本就为空(本轮是这个会话的第一条消息,还没成功过) | 维持现状:直接开空白新会话重试——没有值得保护的内容,fork 无意义 |
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
