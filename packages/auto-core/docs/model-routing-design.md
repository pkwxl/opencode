# 阶段化模型路由与配额降级(Model Routing / Failover)设计

状态: 设计定稿待实施(2026-09-10),实施由新会话按本文 H 节 P1..P6 推进。实验开关层
(`OPENCODE_AUTO_MODEL` / `OPENCODE_AUTO_MODEL_FALLBACK`),两者缺省未设 = 现有行为零变化,
CLI 壳零改动,不落盘、不进 `ProjectConfig`。

## A. 动机

单次运行内的两类需求,现有机制都不覆盖:

1. **能力错配**: 阶段对模型能力的要求差别很大——`a`/`d`(分析、设计)要长上下文与强推理,
   `m`(迁移实现)要代码改写与工具调用准确性,`t`/`v`(测试、验收)与 `k`(知识提炼)里
   大量是判定与写作,用便宜模型足够;同一任务链上的分解(understand/decompose)与判定
   (judge/review)会话更是纯吞吐。目前全流程只有一个缺省 agent(`auto`)与一个全局模型,
   无法按阶段/角色分派。
2. **配额中断**: 账号级限流或余额耗尽时,driver 今天的行为是直接阻塞待人工(见 B.3),
   而这类故障恰好是"换一个新 provider 就能继续"的形态;人工不在场时,整轮迁移停摆。

两者在实现上是**同一个注入点**: 逐次提示词携带目标模型 + 一份(阶段, 角色)→ 模型的路由表。

## B. 事实基线(实现前必读,行号以 auto-core 分支为准)

### B.1 driver 侧:全流水线只有一个 prompt 点

`src/runner.ts:1937` 的 `client.session.prompt({ sessionID, agent: opts.agent, parts })`
是唯一的提示词下发处(`attempt()` 内);verify-judge / review / final / 知识提取等旁路一次性
会话经 `requireArtifact`(runner.ts:1611)同样走 `runSession` → `attempt`。因此**在这一处
加 model 即覆盖全部会话**,无需逐调用点改造。

SDK 表面已支持:`session.prompt` 的参数含 `model?: { providerID: string; modelID: string }`
(`@opencode-ai/sdk/v2`,见 `packages/sdk/js/src/v2/gen/sdk.gen.ts` 的 prompt 参数表)。

### B.2 server 侧:逐次带 model 一定能压住既有模型

opencode 的模型解析优先级(`packages/opencode/src/session/prompt.ts:469`、`:646`):

```
input.model(本次 prompt)> agent.model(.opencode/agent/*.md frontmatter 或 opencode.json agent.<name>.model)
  > currentModel(sessionID)(会话表 model → 末条带 model 的 user 消息 → provider.defaultModel(),prompt.ts:613-633)
```

且显式带 `input.model` 会回写会话表 model(prompt.ts:675-685),链上后续提示词自然沿用。
结论:**不必改 opencode.json,也不必按阶段拆 agent 契约文件**——那两条路都要重启 server
(项目配置按实例缓存,`config.ts:600` InstanceState),而逐次 prompt 带 model 对复用会话与
分叉会话同样生效。

### B.3 现状:配额错误的三条路径

- **可重试面**: `session.error` 事件里 `data.isRetryable !== false` → `attempt()` 包装为
  `会话错误: …`(runner.ts:1981)→ `runSession` 的瞬时错误重试循环(runner.ts:1812)从原会话
  fork 副本重试(runner.ts:1830-1843),`RETRIES = 3`(runner.ts:1848)耗尽后阻塞。
- **不可重试面**: `isRetryable === false`(如 `insufficient_quota`,
  `packages/opencode/src/provider/error.ts:117-121`)→ 直接阻塞(runner.ts:1817-1820)→
  `loop.ts` `block()` 回退 pending、**退出码 2** 待人工。
- **等待面**: opencode 自己对可重试错误做**无次数上限、不可配置**的退避
  (`packages/opencode/src/session/retry.ts:175-198`,尊重 `retry-after`,
  `RETRY_MAX_DELAY = 2^31-1`)。配额按小时/天重置时 server 会一直退避而不报错,driver 只能
  等 `--idle-time` 看门狗判死。

分类信息目前**被丢弃**:`watch` 的 `session.error` 分支只取 `data.message`,`isRetryable` 也只
用于 `=== false` 判定(runner.ts:2276-2289),`statusCode` / `responseBody` / `responseHeaders`
不进 `Watch` 结果。

### B.4 两条现成的、当前未被利用的降级信号

1. **retry part**: `RetryPart = { type: "retry", attempt, error: ApiError }`
   (`packages/sdk/js/src/v2/gen/types.gen.ts:605-615`)——带完整结构化 `ApiError`。它随
   `message.part.updated` 到达,`watch` 已经在处理该事件,`describePart` 甚至已有打印分支
   (runner.ts:2382),但**只打印不上报**。这是最省事的分类面。
2. **`session.status` 的 retry 变体**: `{ type: "retry", attempt, message, action?, next }`
   (`types.gen.ts:673-690`),`next` 为下次尝试的等待时长。`watch` 只匹配
   `status.type === "idle"`(runner.ts:2292-2295),retry 变体被忽略。这条能把"还要再等 40 分钟"
   变成主动决策,而不必等 idle 看门狗。

### B.5 路由键的取数来源

- 阶段字母: `opts.phase`(`"a"|"d"|"m"|"t"|"v"|"k"`,runner.ts:192,loop 透传,缺省 undefined)。
- 执行链角色: `chain.phase` 是 `src/resume.ts:48` 的判别联合
  (`understand` / `decompose` / `whole` / `subtasks` / `wrapup` / `verify:{generate,exec,judge,fix}`
  / `review:{audit,planfix,fixrun}`),在 runner.ts:345/397 赋值,`attempt()` 可直接取。
- 旁路会话: `chain.phase` 缺省(runner.ts:1611 构造的链不带 phase),现只有中文 `spec.kind`
  标签(runner.ts:1464 审核、:1507 脚本生成、:1538 质量审核、:1563 修复规划;loop.ts:511 阶段规划、
  :584 交接蒸馏;final.ts:247 终审任务规划;knowledge.ts:67/180 知识提取;implement.ts:44;
  numbering.ts:113 编号恢复)。→ 需给 `requireArtifact` 的 spec 加英文 `role` 字段。
- 候选模型的上下文窗口: `contextLimits(client)` 已给出 `providerID/modelID → limit.context`
  映射(runner.ts:2389),用量百分比也已按消息真实 model 计算(runner.ts:1057、:2161)。

## C. 设计:路由表与生效点

### C.1 键与优先次序

解析函数 `resolveModel(policy, letter, role)`,优先级由细到粗:

```
role(会话角色)> letter(阶段字母)> "*"(兜底)> undefined(不带 model,现状)
```

角色 slug 词表(与 B.5 一一对应,实验期固定,不做自由命名):
`understand` `decompose` `whole` `subtask` `wrapup` `verify-generate` `verify-exec`
`verify-judge` `verify-fix` `review-audit` `review-planfix` `review-fixrun`
`phase-plan` `phase-handover` `final-plan` `knowledge` `prior-knowledge` `implement-scan`
`number-recovery`;旁路会话未显式给 role 时取 `bypass`。

### C.2 环境变量格式(与 `src/switches.ts` 既有约定一致)

- `OPENCODE_AUTO_MODEL`: 两种形态。
  - 裸值 `prov/model` → 全量覆盖(等价 `*=prov/model`),供"本次运行整体换个模型"。
  - 条目表 `键=prov/model` 逗号分隔,如
    `*=kimi/k2,m=anthropic/c-4,t=kimi/k2-lite,verify-judge=kimi/k2-lite,decompose=anthropic/c-4`。
    键 ∈ {`*`} ∪ {`admtvk`} ∪ C.1 角色词表;分隔符用 `=` 而非 `:`(model id 可能含冒号);
    值必须含 `/`;空串视同未设。
- `OPENCODE_AUTO_MODEL_FALLBACK`: 逗号分隔的**有序**候选表 `prov/a,prov/b`,缺省空 = 不降级。

非法值一律 `throw` 中文报错(含变量名、示例、越界键列表),由 CLI 侧转退出码 1——与既有
开关"坏值严格失败"哲学一致。启动日志经 `nonDefaultSwitches` 列出生效项(缺省静默)。

### C.3 生效点

`attempt()`(runner.ts:1850)取 `opts.phase` 与 `chain.phase`/`chain.role` 解析出目标模型,
连同 `chain.model`(该链已降级到的候选,见 D.4)一起传给 `client.session.prompt` 的
`model` 字段:

```
本次模型 = chain.model ?? resolveModel(policy, opts.phase, roleOf(chain))
```

`chain.model` 存在链上而非全局,保证降级只影响出问题的这条会话链。

## D. 配额降级

### D.1 分类器(新增纯函数,便于单测)

`classifySessionError(structuredErrorInfo) → "quota" | "auth" | "rate" | "overflow" | "transient" | "unknown"`
输入取自 B.4 的 retry part `ApiError`(`statusCode`、`responseBody`、`isRetryable`)与
`session.error` 的 `data`;判据表(与 opencode `retry.ts:31-38` 的 RETRYABLE 正则刻意保持不同
——这里问的是"换模型有没有用",不是"重试有没有用"):

| 类别 | 判据 | 动作 |
|---|---|---|
| `quota` | `isRetryable === false`;消息/响应体含 `insufficient_quota`/`quota`/`balance`/`credit`/`usage limit`/`402` | **换下一候选** |
| `auth` | 401/403、`ProviderAuthError` | 换下一候选(该 provider 不可用) |
| `rate` | 429/`rate limit`/`resource exhausted` 且(retry `attempt >= 3` 或 `next > 60s`,后者仅 D.2 第 3 条事件提供) | 换下一候选 |
| `overflow` | `ContextOverflowError` | **不换**(交接/handover 机制管;换更大窗口模型列为 H 节后续项) |
| `transient` / `unknown` | 其余 | 走现有重试路径,不换模型 |

保守缺省: 归类不确定时**不换**——误换的代价(整轮跑在弱模型上)高于多试一次的代价。

### D.2 三个触发面接线

1. `watch` 的 `session.error` 分支(runner.ts:2276):除现有 `message`/`retryable` 外,把
   `data` 的结构化字段带出(`Watch` 加 `errorInfo?`,`retryable?: boolean` 是同类先例)。
2. `watch` 的 `message.part.updated` 分支: `part.type === "retry"` 时记录
   `{ attempt, statusCode, isRetryable, responseBody }`(取自 `RetryPart.error`,该 part 本身
   不带等待时长)并喂给分类器;命中 `quota|auth|rate` 阈值即
   提前结算本回合——**必须先 `client.session.abort({ sessionID })` 再 break**,与断流清理
   (runner.ts:2313-2320)同一手法:server 端旧回合此刻仍在跑,不中止就会与随后 fork 出的
   新会话并发改文件。返回 `blocked` 且带 `failover: true`。
3. `session.status` retry 变体: 同一判据的第二信号(server 不产出 retry part 时仍可用),
   额外提供 `next`(下次尝试的等待时长,`rate` 判据用它做"还要等太久就别等了"的阈值),
   容错缺失(旧版 server)。

### D.3 降级动作

`runSession`(runner.ts:1800)的重试循环里,在 `result.retryable === false` 直接阻塞
(runner.ts:1817-1820)**之前**插入一支: 分类为可降级且候选表还有未试项 →
取下一候选(经 D.4 钳制)→ `chain.model = 候选` → 复用现有 fork 副本路径继续
(runner.ts:1830-1843)。

上下文随迁是这里的收益而非意外: `session.fork` 逐条克隆消息
(fork-decompose-design.md:341「fork 只搬消息,不复制 agent/model/permission」),而 prompt 级
`model` 优先级最高(B.2)——**换模型续跑不需要重做上下文**。日志形如
`⇄ T-001 配额受限,链上下文保留,切换模型 a/x → b/y(候选 2/3)`。

降级后首个提示词经 `chain.note`(一次性附加说明,runner.ts:1934-1940)带一句"已切换模型,
注意沿用前文的产物格式与协议"——与 `stuck-hint` 为弱模型兜底是同一套哲学。

### D.4 候选钳制与耗尽

- 候选的 `limit.context`(B.5)已知且 `< opts.contextLimit` → 跳过该候选并 log 原因
  (防止降级后立刻撞上下文超限/交接预算,比原故障更糟)。上限未知(容错空映射)不过滤。
- 候选耗尽 → 回落现有阻塞路径(退出码 2、回退 pending),契约不变;阻塞文案追加"已试候选清单"。
- 降级计数与 `RETRIES = 3` 分离: 每个候选各享一轮既有重试,总上限 = 候选数 × RETRIES,
  避免两个计数器互相掩盖。

### D.5 不跨链粘滞

`chain.model` 只在链内有效,新链(下一子任务/下一阶段)重新按路由表求值,即主模型每个任务
边界都被再试一次。理由: 与"阶段状态是推导式的、零新增易腐状态"(phases.ts 头注)一致,且
避免一次抖动导致整轮永久降级。代价是配额型故障会在每条新链上重撞一次首个提示词——
这是已接受的取舍(见 G.4 与 U2)。

## E. 决策记录(已确认)

- **D1 落点 = 实验开关层**,不新增宪法键、不动 `opencode.json` 与 agent 契约文件;转正形状见 U1。
- **D2 粒度 = 阶段字母 + 会话角色双键**(role 覆盖 letter),而非只做字母。
- **D3 逐次 prompt 带 model**,不重启 server、不分化 agent 契约。
- **D4 降级 = 复用既有 fork 重试路径**,上下文随迁,不新造续跑机制。
- **D5 降级状态不落盘**(缺省),`progress.json` 不记 model;跨进程恢复后重新按路由表求值。
- **D6 分类器保守缺省**: 不确定即不换;`overflow` 明确不换。

## F. 不变量(实现不得破坏)

- 退出码语义不变:`0`/`1`(开关值非法)/`2`(候选耗尽仍失败)/`130`。
- 实验开关只读环境、不落盘;两变量未设时**行为逐字节等价现状**(不带 `model` 字段,
  而不是带 `undefined`)。
- 宪法级项目属性清单不变(本文不新增 `-m/--model` 到 init/run)。
- 「独立判定会话不 fork」不受影响:路由只改 `model` 参数,不改会话创建方式。
- driver 独占状态写入、统一提交、完成判定独立于 agent 自报——均与模型选择正交,不得借
  降级路径写 PLAN.md/CURRENT.md。
- 现有 `retryable === false` 的语义(换会话无用)在**无候选表**时必须保持原行为。

## G. 风险

1. **混模型上下文**: 强模型生成的历史由弱模型续写,检查项格式/协议遵从度可能漂移。
   缓解: note 注入(D.3)、词表允许只配必要项、缺省不混。
2. **配额文案不可移植**: 分类器依赖 provider 报文,新 provider 措辞不同会漏判。缓解: 漏判
   的后果 = 现状阻塞(可接受);正则表集中一处并随单测固定样本演进。
3. **事件表面漂移**: retry part / `session.status` retry 变体在 server 版本间可能变化。
   缓解: 两信号互为备份,且都容错缺失(与 `contextLimits` 的容错哲学一致)。
4. **每条新链重撞主模型**(D.5 取舍): 配额耗尽时每个任务边界多失败一轮。若实测代价过高,
   走 U2 的 tmp/ 记录方案,不改契约。

## H. 实施步骤(勾选表)

| 步 | 内容 | 文件 | 验证 |
|---|---|---|---|
| P1 | `SWITCH_ENV` 增 `model` / `modelFallback`;`parseSwitches` 解析 C.2 两种形态并归一化为 `ModelPolicy`;`nonDefaultSwitches` / `formatSwitches` 登记;非法值中文报错 | `src/switches.ts` | `bun test test/switches.test.ts`(补空/裸值/条目表/越界键/值缺 `/` 五类用例) |
| P2 | 路由纯函数 `resolveModel(policy, letter, role)` 与 `roleOf(chain)`;`SessionChain` 加 `role?` / `model?`;`requireArtifact` spec 加英文 `role` 并在 11 个调用点补齐(B.5 清单);`attempt()` 传 `model` | `src/runner.ts`(+ `src/resume.ts` 若角色 slug 需要) | `bun test test/runner.test.ts`(fake client 断言 prompt 收到的 `model`;未设开关时断言参数里**没有** `model` 键) |
| P3 | 分类器 `classifySessionError` + `Watch.errorInfo` / retry part 记录 / `session.status` retry 第二信号 | `src/runner.ts` | 单测:固定报文样本 → 类别;未知报文 → `unknown` |
| P4 | `runSession` 降级支(D.3)+ 候选窗口钳制与耗尽(D.4)+ 降级 note(D.3) | `src/runner.ts` | 单测:quota 不可重试 + 两候选 → 第二次 prompt 带候选模型且上下文来自 fork;候选耗尽 → 仍 `blocked` |
| P5 | 真实冒烟(`auto/` worktree 三包全量):设 `OPENCODE_AUTO_MODEL` 跑一轮 migrate 短流程,核对日志 `⇄`/百分比再基线;故意配错 provider 密钥触发 `auth` 降级 | `auto/` | 见 docs/behavior.md 冒烟约定;typecheck + 三包 test |
| P6 | 文档:AGENTS.md 导航行已随本文加;实施后把本文状态改为「已实施(P1..P5)」并补 `docs/structure.md` / `docs/behavior.md` 的开关与降级段落 | `docs/`、`AGENTS.md` | 人工复核 |
| 后续 | `overflow` → 换更大窗口模型的降级路(B.4/D.1 已留类别);转正宪法键(U1) | — | 另开设计 |

## I. 未决问题

- **U1 转正形状**: 实验定型后,`modelRouting`(阶段/角色→模型)与 `modelFallback`(有序候选)
  是否作为宪法键进 `.opencode/auto/config.json`(init-only、人工编辑为修订通道)?倾向是,
  因为"哪个阶段用哪个模型"属项目属性、应随仓库版本化共享;转正时需同步两壳 usage 文本与
  `test/config.test.ts`。
- **U2 降级是否落盘**: D.5 取舍的替代方案是在 `tmp/` 记一条本次运行的降级状态(非版本化、
  driver 写),跨链沿用至进程结束。等 P5 冒烟数据再定。
- **U3 静默等待期的接管**: D.2 第 2 条已定案"降级前先 abort 再结算"。未决的是另一类现场——
  server 端持续退避、既不产 `session.error` 也迟迟不产 retry 信号(会话只是 idle),driver
  只能等 `--idle-time` 看门狗;是否要为这一形态引入更短的专用等待窗口,或在 watchdog 超时时
  一并尝试降级(而非现在的直接阻塞)。
- **U4 角色词表稳定性**: 词表是否随 `stage` 枚举增长而维护成本上升;是否收敛到
  「执行链按字母、旁路按 role」两条互斥规则。
