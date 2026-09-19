# 阶段化模型路由与配额降级(Model Routing / Failover)设计

状态: 已实施(2026-09-10,P1..P6 全部落地——switches 解析、runner 路由求值、错误归类、
降级环、单测与文档;`bun typecheck` 干净、`bun test` 全绿)。2026-09-13 补 P7:重试阶梯
耗尽后的人工回落接入降级环(D.3 第二触发面),`bun test` 652→657 pass;补 P8:回试粒度
`OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`(D.6)、`/failback` 命令与运行期模型序覆写(D.7)、
使用模型播报(D.8),`bun test` 675 pass。P5 自动化验证已通过;三包真实
冒烟待有 provider 凭证的环境(`OPENCODE_AUTO_E2E=1`)。实验开关层
(`OPENCODE_AUTO_MODEL` / `OPENCODE_AUTO_MODEL_FALLBACK` / `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`),
缺省未设 = 现有行为零变化,CLI 壳零改动,不落盘、不进 `ProjectConfig`。
**2026-09-16 修订:候选耗尽的终点从阻塞退出改为 plans/0015-session-error-retry-plan.md
「2026-09-16 修正三」的等待-探测环(半小时一次、全新临时会话探测、恢复后 fork 被
中断的会话续跑)——本文 D.4 的「回落阻塞路径(退出码 2)」与不变量 F 中「无候选表时
quota 直接阻塞」两条自此被取代;切换/fork/窗口钳制/note 机制不变。**


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

## B. 事实基线(实现前必读,行号以 auto-core 分支 HEAD `2f2b20a09`〔会话恢复优先层,2026-09-10 实施〕为准)

### B.1 driver 侧:全流水线只有一个 prompt 点

`src/runner.ts:2018` 的 `client.session.prompt({ sessionID, agent: opts.agent, parts })`
是唯一的提示词下发处(`attempt()` 内);verify-judge / review / final / 知识提取等旁路一次性
会话经 `requireArtifact`(runner.ts:1606 定义、:1686 转发 runSession)同样走
`runSession` → `attempt`。因此**在这一处
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
  `会话错误: …`(runner.ts:2070)→ `runSession` 的瞬时错误重试循环(runner.ts:1891)从原会话
  fork 副本重试(runner.ts:1909-1922),`RETRIES = 3`(runner.ts:1927)耗尽后阻塞。
- **不可重试面**: `isRetryable === false`(如 `insufficient_quota`,
  `packages/opencode/src/provider/error.ts:117-121`)→ 直接阻塞(runner.ts:1896-1899)→
  `loop.ts` `block()` 回退 pending、**退出码 2** 待人工。
- **等待面**: opencode 自己对可重试错误做**无次数上限、不可配置**的退避
  (`packages/opencode/src/session/retry.ts:175-198`,尊重 `retry-after`,
  `RETRY_MAX_DELAY = 2^31-1`)。配额按小时/天重置时 server 会一直退避而不报错,driver 只能
  等 `--idle-time` 看门狗判死。

分类信息目前**被丢弃**:`watch` 的 `session.error` 分支只取 `data.message`,`isRetryable` 也只
用于 `=== false` 判定(runner.ts:2365-2379),`statusCode` / `responseBody` / `responseHeaders`
不进 `Watch` 结果。

### B.4 两条现成的、当前未被利用的降级信号

1. **retry part**: `RetryPart = { type: "retry", attempt, error: ApiError }`
   (`packages/sdk/js/src/v2/gen/types.gen.ts:605-615`)——带完整结构化 `ApiError`。它随
   `message.part.updated` 到达,`watch` 已经在处理该事件,`describePart` 甚至已有打印分支
   (runner.ts:2471),但**只打印不上报**。这是最省事的分类面。
2. **`session.status` 的 retry 变体**: `{ type: "retry", attempt, message, action?, next }`
   (`types.gen.ts:673-690`),`next` 为下次尝试的等待时长。`watch` 只匹配
   `status.type === "idle"`(runner.ts:2380-2385),retry 变体被忽略。这条能把"还要再等 40 分钟"
   变成主动决策,而不必等 idle 看门狗。

### B.5 路由键的取数来源

- 阶段字母: `opts.phase`(`"a"|"d"|"m"|"t"|"v"|"k"`,runner.ts:192,loop 透传,缺省 undefined)。
- 执行链角色: `chain.phase` 是 `src/resume.ts:66` 的判别联合
  (`understand` / `decompose` / `whole` / `subtasks` / `wrapup` / `verify:{generate,exec,judge,fix}`
  / `review:{audit,planfix,fixrun}` / `step:{phase-plan,phase-handover}`——step 变体为
  会话恢复优先层新增,`StepKind = "phase-plan" | "phase-handover"` 在 resume.ts:49),
  在 runner.ts:345/397 赋值,`attempt()` 可直接取。
- 旁路会话: `requireArtifact` 构造的链(runner.ts:1673-1679)现仅对带 `spec.step` 的步骤携带
  `chain.phase`(`step` 变体,英文 slug 即 `StepKind`,loop.ts:481 阶段规划、:572 交接蒸馏的
  role 可直接取);其余链 `chain.phase` 缺省,现只有中文 `spec.kind`
  标签(runner.ts:1477 审核、:1520 脚本生成、:1551 质量审核、:1576 修复规划;
  final.ts:246 终审任务规划;knowledge.ts:61/180 知识提取;implement.ts:44;
  numbering.ts:113 编号恢复)。→ 需给 `requireArtifact` 的 spec 加英文 `role` 字段(`step` 已具备)。
- 候选模型的上下文窗口: `contextLimits(client)` 已给出 `providerID/modelID → limit.context`
  映射(runner.ts:2478),用量百分比也已按消息真实 model 计算(runner.ts:1072、:2250)。

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

`attempt()`(`src/attempt.ts:179`)取 `opts.phase` 与 `chain.phase`/`chain.role` 解析出目标模型,
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

1. `watch` 的 `session.error` 分支(`src/watch.ts:401`):除现有 `message`/`retryable` 外,把
   `data` 的结构化字段带出(`Watch` 加 `errorInfo?`,`retryable?: boolean` 是同类先例)。
2. `watch` 的 `message.part.updated` 分支: `part.type === "retry"` 时记录
   `{ attempt, statusCode, isRetryable, responseBody }`(取自 `RetryPart.error`,该 part 本身
   不带等待时长)并喂给分类器;命中 `quota|auth|rate` 阈值即
   提前结算本回合——**必须先 `client.session.abort({ sessionID })` 再 break**,与断流清理
   (`src/watch.ts:235-238`)同一手法:server 端旧回合此刻仍在跑,不中止就会与随后 fork 出的
   新会话并发改文件。返回 `blocked` 且带 `failover: true`。
3. `session.status` retry 变体: 同一判据的第二信号(server 不产出 retry part 时仍可用),
   额外提供 `next`(下次尝试的等待时长,`rate` 判据用它做"还要等太久就别等了"的阈值),
   容错缺失(旧版 server)。

### D.3 降级动作

`runSession` 的重试循环里,在 `result.retryable === false` 直接阻塞**之前**插入一支:
分类为可降级且候选表还有未试项 → 取下一候选(经 D.4 钳制)→ `chain.model = 候选` →
复用现有 fork 副本路径继续。

降级动作收在一个闭包 `switchModel(why)` 里,**两个触发面共用**:

| 触发面 | 归类 | 时机 |
| --- | --- | --- |
| 配额降级(本设计) | `quota` / `auth` / `rate` | 立即,排在阶梯之前(人工裁决已于 2026-09-16 退役) |
| 重试阶梯耗尽后的回落(2026-09-13 接入) | `transient` / `unknown` | 阶梯跑完(2026-09-16 起不再等人工,直接回落) |

第二个触发面补的是另一条出路: 阶梯对瞬时故障已无计可施(见
`plans/0015-session-error-retry-plan.md`「2026-09-12 修正二」——上游退化以小时计,加码次数只是线性
烧钱),而换一个 provider 是阶梯之外唯一还没试过的手段。人工明确答 `exit` 时不降级:那是
「停下来」的指令,不是「再想办法」。分支顺序不变——quota/auth/rate 三类照旧在阶梯之前
立即换模型,本条只给 transient/unknown 加出路。

分叉源取与重试环同一套「保住最值钱的会话」判据(失败会话本体与链上原会话,按已积累用量
取大者,0 用量的纯报错桩不进候选)。两条触发面的链状态形态不同,这套判据同时覆盖: 不可
重试类 `attempt` 已把会话晋升到 `chain.id`、`chain.failed` 为空,选出的就是 `chain.id`
(行为等价接入前);可重试类跑完阶梯回落到这里时,`attempt` 已把 `chain.id` 还原成下发前的
原会话,真正攒着上下文的是 `chain.failed`,不看它就会把 100k+ 产出扔掉去开白板会话。

上下文随迁是这里的收益而非意外: `session.fork` 逐条克隆消息
(plans/0003-fork-decompose-design.md:341「fork 只搬消息,不复制 agent/model/permission」),而 prompt 级
`model` 优先级最高(B.2)——**换模型续跑不需要重做上下文**。日志形如
`⇄ T-001 配额受限,链上下文保留,切换模型 a/x → b/y(候选 2/3)`。

降级后首个提示词经 `chain.note`(一次性附加说明,`src/attempt.ts:172-173`)带一句"已切换模型,
注意沿用前文的产物格式与协议"——与 `stuck-hint` 为弱模型兜底是同一套哲学。

### D.4 候选钳制与耗尽

- 候选的 `limit.context`(B.5)已知且 `< opts.contextLimit` → 跳过该候选并 log 原因
  (防止降级后立刻撞上下文超限/交接预算,比原故障更糟)。上限未知(容错空映射)不过滤。
- 候选耗尽 → **2026-09-16 起落入等待-探测环**(plans/0015-session-error-retry-plan.md「修正三」:
  以 OPENCODE_AUTO_RECOVERY_WAIT 缺省 30 分钟为间隔无限等待、全新临时会话探测、恢复后
  fork 被中断的会话续跑;等待日志列已试候选清单)——原「回落阻塞路径(退出码 2、回退
  pending)」自此退役。
- 降级计数与重试阶梯分离: 每个候选各享一轮完整阶梯(切换时 `i = 1`),总上限 =
  (1 + 候选数)× 阶梯长度,避免两个计数器互相掩盖。

### D.5 不跨链粘滞(缺省 task 粒度)

`chain.model` 只在链内有效:执行链由 `runTask` 逐任务新建,任务边界即天然归零,下一任务
重新按路由表求值,主模型每个任务边界都被再试一次(实现早于本文措辞——链在任务级而不
是子任务级,同一任务的子任务间共享链、降级在任务内粘滞);旁路一次性会话
(`requireArtifact`)的链逐调用新建,降级从不跨调用粘滞。理由: 与"阶段状态是推导式的、
零新增易腐状态"(phases.ts 头注)一致,且避免一次抖动导致整轮永久降级。代价是配额型
故障会在每条新链上重撞一次首个提示词——这是已接受的取舍(见 G.4 与 U2)。2026-09-13
起回试粒度可由 `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` 调整(D.6),缺省 `task` 即本节语义。

### D.6 回试粒度(OPENCODE_AUTO_MODEL_FAILBACK_SCOPE,2026-09-13 实施)

降级到候选模型后、在哪个流水线边界重置回首选模型,四档**包含式**粒度(与 step.ts 同一
RANK 思路,所取值及更粗的边界都重置;实现见 `src/failback.ts`):

| 值 | 重置时机 | 实现机制 |
|---|---|---|
| `phase` | 仅阶段边界(降级跨任务粘滞) | 链逐任务销毁,候选人选经 failback 模块的 sticky holder(`setSticky`/`stickyModel`)带进本阶段后续任务;阶段边界(loop.ts `clearSticky()`)清零 |
| `task`(缺省) | 任务边界 | 零代码:链逐任务销毁天然归零(= D.5 现状) |
| `subtask` | 子任务/任务/阶段边界 | 子任务边界(runner.ts 子任务循环,紧随 `maybeExit`)清 `chain.model` |
| `session` | 每个新会话起点(任务/子任务/隐藏任务会话) | attempt 的**全新 create 分支**清 `chain.model`;会话复用与 fork 消费不清——降级 fork 出的迁移会话若清零会把 failover 立即 undo 成震荡。旁路/隐藏任务链本就逐调用新建,天然回试首选 |

已试候选去重(`tried`)是 `runSession` 局部态,随每次会话调用自然归零——边界重置后
整条候选环重新可用,无需额外清理。`reuseSession=on` 时 session 粒度以真实会话边界为准
(复用同一会话则降级粘滞,符合"新会话才重置"语义)。

### D.7 /failback 命令与运行期模型序覆写(2026-09-13 实施)

与 `/exit`(plans/0014-exit-resume-design.md)同构的人工接管通道,仅 `--interactive` 常驻输入行
可用,等待回答(pending)状态下不识别:

- **置位**(interactive.ts): `/failback` 精确匹配或 `/failback prov/a prov/b ...` 前缀匹配;
  参数逐项校验须为 `provider/model` 形态(含 `/`),坏值 log 用法且不置位。不发往会话,
  与是否已连上会话无关。
- **消费**(三处安全边界,挂点同 step/exit: runner.ts 子任务边界、loop.ts 任务/阶段边界,
  紧随 `maybeExit`): `consumeFailback(chain?)` 清链上降级候选与 sticky holder;**不抛异常、
  不占退出码通道**(区别于 `/exit` 的 ExitRequested → 退出码 3)。与 `/exit` 同时 pending 时
  exit 优先(进程已结束)。
- **带参语义 = 整体重定义模型序**: 首个模型为首选(通配,覆盖路由表全部字母/角色键),
  其余按序成为降级候选环。覆写经 failback 模块的 `override` 层承载(`failbackOverride()`),
  attempt 的 target 求值链变为 `chain.model ?? sticky ?? override.wildcard ?? resolveModel(...)`,
  switchModel 的候选环与触发门禁同理取 `override.fallback ?? switches.model.fallback`——
  **不原地改 switches memo**(恒定约定不破)。覆写持续生效至进程结束或下一次带参 /failback。

### D.8 实际使用模型上终端(2026-09-13 实施;2026-09-18 修订补服务端缺省回落与新会话恒播报)

attempt 求值出 target 后播报 `◈ <任务> 使用模型 <prov/model>(<来源>)`,来源 ∈
`路由` / `降级候选` / `降级候选·阶段内粘滞` / `/failback 指定`;经 `chain.modelShown`
去重——同链同模型的续跑 prompt 不重复播报,新建会话或模型变化(降级切换、/failback 消费、
粒度重置)时再次播报。**2026-09-18 修订**: target 未定义(路由与覆写均未设)时回落
播报服务端生效模型(来源 `服务端缺省`),解析与服务端 prompt 的模型回退链同序——
agent 配置级 model(/agent)> 全局 config.model(/config)> 首个已连接 provider 的缺省
模型(/provider 的 default 表;服务端的最近使用记录 model.json 不经 API 暴露,略过),
实现为 session-api 的 `serverDefaultModel`(进程内按 agent 缓存,全取不到静默)。仅
展示用途: prompt 是否带 model 键的决定不变,不变量 F 不破。**2026-09-18 修订二**:
新建会话恒播报落到实处——此前实现只按 `chain.modelShown` 对模型串去重,新会话
(新建/分叉)沿用旧模型时不播报(本节「新建会话……再次播报」的既定语义未落地);
现播报条件为「新会话(!reuse)或模型较上次有变化」,同会话同模型的续跑 prompt
(复用/恢复接管)仍不重复。

## E. 决策记录(已确认)

- **D1 落点 = 实验开关层**,不新增宪法键、不动 `opencode.json` 与 agent 契约文件;转正形状见 U1。
- **D2 粒度 = 阶段字母 + 会话角色双键**(role 覆盖 letter),而非只做字母。
- **D3 逐次 prompt 带 model**,不重启 server、不分化 agent 契约。
- **D4 降级 = 复用既有 fork 重试路径**,上下文随迁,不新造续跑机制。
- **D5 降级状态不落盘**(缺省),`progress.json` 不记 model;跨进程恢复后重新按路由表求值。
- **D6 分类器保守缺省**: 不确定即不换;`overflow` 明确不换。
- **D7 回试粒度缺省 `task`**(= 现状零变化);粒度语义与 step 包含式 RANK 对齐;phase 档的
  跨任务粘滞经 failback 模块 sticky holder 承载,不落盘(同 D5)。
- **D8 /failback 与 /exit 同构但不停止**: 安全边界消费、不抛异常、不占退出码;带参 = 整体
  重定义首选+候选序,经运行期 override 层实现,switches memo 恒定约定不破。
- **D9 使用模型播报走既有 log 通道**: 每次 prompt 求值处播报、按链去重;未设模型时
  回落服务端生效模型(2026-09-18 修订,见 D.8),仍取不到才静默。

## F. 不变量(实现不得破坏)

- 退出码语义不变:`0`/`1`(开关值非法)/`2`(候选耗尽仍失败)/`130`。
- 实验开关只读环境、不落盘;两变量未设时**行为逐字节等价现状**(不带 `model` 字段,
  而不是带 `undefined`)。
- 宪法级项目属性清单不变(本文不新增 `-m/--model` 到 init/run)。
- 「独立判定会话不 fork」不受影响:路由只改 `model` 参数,不改会话创建方式。
- driver 独占状态写入、统一提交、完成判定独立于 agent 自报——均与模型选择正交,不得借
  降级路径写 PLAN.md/CURRENT.md。
- 现有 `retryable === false` 的语义(换会话无用)在**无候选表**时必须保持原行为。
  (2026-09-16 起本条后半被取代:无候选表时不再阻塞,直接进等待-探测环,见状态段修订。)
- 重试阶梯与人工裁决(`plans/0015-session-error-retry-plan.md`)在**无候选表**时必须保持原行为:
  回落即阻塞,文案不提降级、不新增 fork、prompt 不带 `model`。(2026-09-16 起人工裁决
  退役、回落改入等待-探测环,无候选表时仍不降级、prompt 不带 `model`——这两点不变。)

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
| P2 | 路由纯函数 `resolveModel(policy, letter, role)` 与 `roleOf(chain)`;`SessionChain` 加 `role?` / `model?`;`requireArtifact` spec 加英文 `role` 并在调用点补齐(B.5 清单,11 处中 loop.ts 阶段规划/交接蒸馏已可经 `spec.step` 的 `StepKind` 取英文 slug、`roleOf` 映射 `step` 变体即可,需补 `role` 的 9 处);`attempt()` 传 `model` | `src/runner.ts`(+ `src/resume.ts` 若角色 slug 需要) | `bun test test/runner.test.ts`(fake client 断言 prompt 收到的 `model`;未设开关时断言参数里**没有** `model` 键) |
| P3 | 分类器 `classifySessionError` + `Watch.errorInfo` / retry part 记录 / `session.status` retry 第二信号 | `src/runner.ts` | 单测:固定报文样本 → 类别;未知报文 → `unknown` |
| P4 | `runSession` 降级支(D.3)+ 候选窗口钳制与耗尽(D.4)+ 降级 note(D.3) | `src/runner.ts` | 单测:quota 不可重试 + 两候选 → 第二次 prompt 带候选模型且上下文来自 fork;候选耗尽 → 仍 `blocked` |
| P5 | 真实冒烟(`auto/` worktree 三包全量):设 `OPENCODE_AUTO_MODEL` 跑一轮 migrate 短流程,核对日志 `⇄`/百分比再基线;故意配错 provider 密钥触发 `auth` 降级 | `auto/` | 见 docs/behavior.md 冒烟约定;typecheck + 三包 test |
| P6 | 文档:AGENTS.md 导航行已随本文加;实施后把本文状态改为「已实施(P1..P5)」并补 `docs/structure.md` / `docs/behavior.md` 的开关与降级段落 | `docs/`、`AGENTS.md` | 人工复核 |
| P7 | 重试阶梯耗尽后的人工回落接入降级环(D.3 第二触发面):降级动作闭包化为 `switchModel()`、分叉源改用与重试环同一套「最值钱会话」判据 | `src/runner.ts`、`test/runner.test.ts` | 单测:transient 跑完阶梯 → 换候选重开一轮;人工答 `exit` 不降级;候选耗尽仍 `blocked` 且列清单;无候选表逐字节等价(不变量 F) |
| P8 | 回试粒度 `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`(D.6)+ `/failback` 命令与运行期模型序覆写(D.7)+ 使用模型播报(D.8) | `src/switches.ts`、`src/failback.ts`(新)、`src/runner.ts`、`src/loop.ts`、`src/interactive.ts` | 单测:switches 值域/坏值/日志登记;failback 模块态与 RANK;interactive `/failback` 解析;runner 的 task/session/phase 三档回试与覆写降级(675 全绿) |
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
