# 大文件拆分方案(runner.ts / loop.ts 按职责切模块)

**状态**: 实施中(auto-core 分支)。**S1–S2 已完成(2026-09-16)**,下一步 **S3 `src/unit-commit.ts`**。每步一个提交,新会话从本文件 §H 勾选表继续。
**基线提交**: `f50cd615b`(§D.1/§E 表中的行号以该提交为准;**每步落地后行号已漂移,定位一律按符号名 grep,不要照抄行号**)。
**当前进度**: `src/runner.ts` 4064 → 3766 行;新增 `src/opts.ts` 112 行、`src/chain.ts` 211 行。`bun test` 771 pass / 0 fail(与基线同),`packages/auto` 零改动通过 typecheck。

## A 事实基线(2026-09-16 实测)

### A.1 规模

```
src/runner.ts   4064 行   ← 主要问题
src/loop.ts     1236 行   ← 次要问题
src/stats.ts     665 行
src/refcheck.ts  659 行   ← 尚在可接受区间,本方案不动
src/prompt.ts    579 行
其余 src/*.ts   ≤ 500 行

test/runner.test.ts  2780 行
test/prompt.test.ts  1444 行
```

痛点:改动 runner.ts 任一处都要把 4064 行读进上下文,单次小改动的上下文成本接近整包源码的三分之一。

### A.2 最大函数

| 文件 | 函数 | 行数 | 起始行 |
|---|---|---|---|
| loop.ts | `runAll` | 946 | 77 |
| runner.ts | `watch` | 490 | 3426 |
| runner.ts | `runTask` | 447 | 672 |
| runner.ts | `attempt` | 265 | 3124 |
| runner.ts | `runSession` | 230 | 2856 |
| runner.ts | `runSubtask` | 184 | 1702 |
| runner.ts | `runExecSession` | 177 | 2508 |
| runner.ts | `requireArtifact` | 167 | 2237 |

`runAll` 是唯一的"巨型单函数",内含 5 个闭包(`advanceFinal` / `runTaskLoop` / `planPhase` / `handoverPhase` / `runPhaseLoop`),拆它需要把闭包捕获显式化为 ctx 对象。runner.ts 相反——它是**很多中等函数的堆叠**,按调用层次切开即可,成本低得多,故先做 runner.ts。

### A.3 有利条件(已核实)

- **无模块级可变状态**:`grep '^let |^var ' src/runner.ts src/loop.ts` 无命中,两文件都是纯函数模块,搬运即可,不存在"跨文件共享单例"的隐患。
- **包导出天然兼容**:`package.json` 的 `exports` 为 `"./*": "./src/*.ts"`,新增 src 文件无需登记,新模块自动可经 `@opencode-ai/auto-core/<名>` 消费(AGENTS.md 构建约定已写明)。
- **调用图是 DAG**:见 §D.2,按层切分不产生循环,唯一的环(`watch` → 测试执行 ↔ `runExecSession` → `runSession`)经 §D.2 的"测试执行与交接状态机分家"消解。
- **测试已按 describe 分组**:`test/runner.test.ts` 的 32 个 describe、`test/prompt.test.ts` 的 28 个 describe 与目标模块基本一一对应,拆测试是机械操作。

### A.4 约束(已核实)

- **外部消费面极窄**:包外只有 `packages/auto/src/index.ts` 从 `@opencode-ai/auto-core/runner` 取 `PermissionMode` / `SubtaskMode` 两个类型;包内 `final.ts` / `implement.ts` / `numbering.ts` / `knowledge.ts` / `config.ts` / `loop.ts` 取 `requireArtifact` / `afterSession` / `restoreTestHandoffs` / `runOnce` / `runTask` / `Opts` / `UnitStop`。
- **文档引用**:`docs/` 下有 33 处带行号锚的 `src/runner.ts:NNN`、21 处 `src/loop.ts:NNN`,另有 `docs/structure.md` 第 15 行(loop.ts)与第 17 行(runner.ts,单条 15750 字符)两条总纲条目,以及 `AGENTS.md` 导航段的多处 `src/runner.ts` 指路。**无 CI 校验**(`script/fix-refs.ts` 是手动入口,针对目标目录不针对本仓库),故引用更新是可读性债务、不是构建门禁——但按仓库约定必须补,见 §G。
- **分支纪律**(见根 AGENTS.md):核心改动只落 `auto-core` 分支;壳分支经 `git merge auto-core` 刷新快照。本方案全程不碰 `packages/auto`。

## B 目标与完成判据

**目标**:单文件 ≤ 600 行,且每个文件有一句话能说清的职责。

完成判据(逐条可验):

1. `wc -l src/*.ts` 中最大值 ≤ 600。
2. `bun typecheck` 干净、`bun test` 全绿(基线 771 passed),**且测试数不减少**——本方案是纯搬运,不允许顺手删测试。
3. 包外契约不变:`packages/auto` 零改动即可编译(`cd ../auto && bun typecheck`)。
4. `docs/structure.md`、`AGENTS.md` 导航段、带行号锚的设计文档引用已按 §G 更新。

**非目标**(明确不做,避免范围蔓延):

- 不改任何运行时行为、不调整函数签名语义、不"顺手重构"逻辑。每步都应能用 `git show --stat` 看出是搬运。
- 不拆 `refcheck.ts`(659)/`stats.ts`(665)/`prompt.ts`(579)——它们职责单一、就在阈值附近,拆了收益不抵引用成本。
- 不动 `runTask` / `watch` / `attempt` 的**函数内部**结构(它们分别 447/490/265 行,拆开需要真重构,风险与本方案的"纯搬运"定位不符)。拆完后它们各自独占一个文件,单文件读入成本已经可接受。

## C 不变量(每步都要守)

- **纯搬运**:移动代码时连同其上的中文注释整块搬走,不改写措辞。新文件顶部加一句职责说明 + 指回设计文档。
- **兼容再导出**:`src/runner.ts` 保留对包外仍在消费的符号的 `export ... from`,使 `packages/auto` 与 `test/runner.test.ts` 在拆分过程中无需同步改动。包内模块(`final.ts` 等)在其符号迁移的那一步同步改为从新模块精确导入。
- **一步一提交**:每个步骤独立提交,commit 前 `bun typecheck && bun test` 必须双绿。提交信息 `refactor(auto-core): 拆分 …`。
- **步骤可中断**:任一步骤结束时仓库都处于可编译可测试状态;没有"拆到一半"的中间态跨会话。

## D 切分方案:runner.ts → 12 个模块 + 留存

### D.1 目标文件表

行号为基线提交 `f50cd615b` 的 `src/runner.ts` 区间,仅供定位;实施时按符号名搜索。

| 新文件 | 承接符号 | 原区间 | 预估行 |
|---|---|---|---|
| `src/opts.ts` | `Outcome` `UnitStop` `SessionCommit` `SubtaskMode` `PermissionMode` `Opts` `FIX_ROUNDS` `DEFAULT_CONTEXT_LIMIT` | 69–88, 110, 127–128, 268–342, 541 | ~130 |
| `src/chain.ts` | `Watch` `SessionResult` `SessionChain` `FailedSession` `ForkBaseInfo` `ErrorClass` `ErrorInfo` 归类正则与 `REUSE_*` 常量 `phaseToRole` `roleOf` `resolveModel` `splitModel` `classifySessionError` | 343–530, 531–540, 1479–1484 | ~230 |
| `src/unit-commit.ts` | `autoAnswer` `afterSession` `commitBlocked` `collectSessionMarks` `wrapupResolves` `gatedAutoCorrectRefs` `gatedTaskRefGap` `strictResumeActive` `resumeModelNow` `rollbackUnitState` `rollbackRemark` | 89–109, 129–266 | ~185 |
| `src/resume-gate.ts` | `UnitRerunCtx` `unitReruns` `phaseText` `resumeNote` `nextStepText` `interruptionRemark` `firstLine` | 549–671, 1292–1416 | ~270 |
| `src/session-api.ts` | `forkSession` `seedForkSession` `ensureForkBase` `sessionUsage` `sessionUsed` `renameSession` `sessionAlive` `missingAgentHint` `zeroUsage` `contextLimits` `describePart` `formatTokens` `formatClientError` `isApproval` `askHuman` | 1485–1631, 3389–3425, 3974–4064 | ~300 |
| `src/testrun.ts` | `Steer` `handoffSteer` `handoverDue` `TestRun` `testHandoverDue` `TEST_HANDOVER_ADVISORY` `fillHandoffStatus` `latestTestScript` `restoreTestHandoffs` `archiveHandoff` `handoffChainExists` `removeHandoffChain` `latestTestSeq` `testHandoffExists` `cleanTestHandoffs` `removeIfUntracked` `executeTest` `resolveTestScript` `runTestScript` | 2423–2507, 2724–2849, 3916–3973 | ~300 |
| `src/watch.ts` | `watch` | 3426–3915 | ~505 |
| `src/session.ts` | `NETWORK_FAILURE` `runSession` `recordDriverResolves` `RetryDecision` `retryDecision` `askRetry` `attempt` | 2850–3388 | ~560 |
| `src/artifact.ts` | `requireArtifact` | 2237–2403 | ~185 |
| `src/exec-session.ts` | `runExecSession` `seedPinFork` `seedSessionFork` | 2508–2723 | ~235 |
| `src/review.ts` | `verifyTask` `Verdict` `REVERIFY_ROUNDS` `executeVerifyScript` `judge` `checkPlanEdit` `generateScript` `reviewTask` `planReviewFix` `parseVerdict` | 1886–2236, 2404–2422 | ~395 |
| `src/execute.ts` | `executeWhole` `ensureUnderstood` `ensureDecomposed` `runSubtask` | 1119–1238, 1417–1478, 1632–1885 | ~465 |
| `src/runner.ts`(留存) | `runTask` `runOnce` `pseudoTask` `requireTask` `writeCurrent` `removeCurrent` + 兼容再导出 | 672–1118, 1239–1291 | ~560 |

### D.2 依赖方向(必须保持单向)

```
opts ─┬─ chain ─┬─ session-api ─┐
      │         │                ├─ watch ─┬─ session ─┬─ artifact ─┬─ review ─┐
      ├─ unit-commit ────────────┤          │           │            │          │
      ├─ resume-gate ────────────┘          │           ├─ exec-session ─────────┤
      └─ testrun ───────────────────────────┘           │                        │
                                                         └──────── execute ──────┴─ runner
```

**唯一的环及其消解**:`watch` 要调测试执行(`executeTest` / `resolveTestScript` / `runTestScript`),而交接状态机 `runExecSession` 要调 `runSession`。若把"测试执行 + 交接"塞进同一个模块,就得到 `watch → 测试模块 → session → watch` 的环。

消解办法就是 D.1 里把它们分成两个模块:

- `testrun.ts` = **测试执行与交接文档的文件操作**,不依赖任何会话驱动代码(只用 `verify.ts` / `prompt.ts` / `docpaths.ts` / `git.ts`),是叶子。
- `exec-session.ts` = **交接时序的状态机**(`runExecSession` 的中断恢复分支、定版分叉),位于 `session` 之上。

于是 `watch → testrun`(单向)、`exec-session → session + testrun`(单向),环消失。**后续任何改动都不得让 `testrun.ts` 反向 import `session.ts` / `watch.ts`。**

其它已核实的方向性事实:

- `watch` 调 `afterSession`(测试交接定版提交),故 `watch → unit-commit`;`unit-commit` 不反向依赖会话层。
- `verifyTask`(在 `review.ts`)内部调 `runExecSession` 与 `runSession`,故 `review → exec-session`;`exec-session` 不调 review。
- `requireArtifact` 调 `runSession`,但 `session.ts` 内无人调 `requireArtifact`,故 `artifact → session` 单向。`requireArtifact` 被包内 4 个模块(final/implement/numbering/knowledge)消费,单独成文件正是为了让它们不必拉进整个会话驱动图。

### D.3 兼容再导出清单

`src/runner.ts` 末尾保留(拆分期间不动任何调用方):

```ts
export type { Opts, Outcome, UnitStop, SessionCommit, PermissionMode, SubtaskMode } from "./opts"
export type { SessionChain, FailedSession, ForkBaseInfo, ErrorClass, ErrorInfo } from "./chain"
export { phaseToRole, roleOf, resolveModel, splitModel, classifySessionError } from "./chain"
export { afterSession, autoAnswer, gatedAutoCorrectRefs, gatedTaskRefGap, strictResumeActive, resumeModelNow } from "./unit-commit"
export type { UnitRerunCtx } from "./resume-gate"
export { unitReruns, phaseText, resumeNote } from "./resume-gate"
export { forkSession, seedForkSession, ensureForkBase, sessionUsage, askHuman } from "./session-api"
export { handoffSteer, handoverDue, testHandoverDue, resolveTestScript, restoreTestHandoffs, cleanTestHandoffs } from "./testrun"
export { runSession, retryDecision } from "./session"
export { requireArtifact } from "./artifact"
export { seedPinFork } from "./exec-session"
```

**收尾步骤(S12)才决定是否保留**:包外只需 `PermissionMode` / `SubtaskMode`,包内可全部改为精确导入。建议 S12 把包内调用方改精确、只留包外那两个类型的再导出,并在 `AGENTS.md` 里写明"`runner.ts` 不再是万能入口"。

## E 切分方案:loop.ts → 5 个模块 + 留存

`runAll` 的 5 个闭包捕获的局部量已核实为:`directory` `path` `opts` `serverHandle` `agentName` `phases` `repl`。`ran` 只在 `runTaskLoop` 体内使用(415/521 两处),提取后降为该函数的局部变量,**不进 ctx**。

引入显式上下文类型:

```ts
export type LoopCtx = {
  directory: string
  path: string          // join(directory, "PLAN.md")
  opts: RunAllOpts      // runAll 现在的内联 opts 类型,提取为具名类型放 loop.ts
  server: ServerHandle
  agentName: string
  phases: string
  repl?: Interactive
}
```

| 新文件 | 承接 | 原区间 | 预估行 |
|---|---|---|---|
| `src/conclusion.ts` | `resumeBanner` `taskResolveLines` `phaseResolveLines` `roundResolveLines` `taskEndLines` `phaseCloseLines` `roundCompleteLines` | 1109–1236 | ~150 |
| `src/loop-progress.ts` | `waitBetweenTasks` `watchFiles` `trackSubtasks` `subtaskProgressLine` | 1023–1108 | ~110 |
| `src/loop-preflight.ts` | `runAll` 的预检段(PLAN.md 存在性、模板装载、agent 契约校验、stats 装载、`protect`、交接文档复原、启动 clean 门禁、中断恢复、AGENTS.md/gitignore 收口、housekeeping 提交) | 146–264 | ~160 |
| `src/loop-task.ts` | `advanceFinal` `runTaskLoop`(改为取 `LoopCtx` 的顶层函数) | 329–382, 389–561 | ~270 |
| `src/loop-phase.ts` | `planPhase` `handoverPhase` `handoverWithStep` `runPhaseLoop` | 572–990 | ~460 |
| `src/loop.ts`(留存) | `RunAllOpts` 类型、`renderAgentContract`、`runAll` 外壳(server 起停、SIGINT、dryrun、装配 ctx、try/catch/finally) | 1–145, 265–328, 991–1022 | ~290 |

方向:`loop-phase → loop-task`(`planPhase` 调 `runTaskLoop`),`loop-task` 不反调阶段函数。`conclusion.ts` / `loop-progress.ts` 是叶子,已分别对应现存的 `test/loop-conclusion.test.ts` / `test/loop-progress.test.ts`。

`loop-preflight.ts` 的返回值需带出预检段产出的量(`watcher` `progress` `resumed` `agentName`),签名建议:

```ts
export async function preflight(directory: string, path: string, opts: RunAllOpts): Promise<{
  agentName: string
  watcher?: FSWatcher
  progress?: { close(): void }
} | { exit: number }>
```

预检段有若干"报错即退出码 1/2"的出口,提取后用 `{ exit: n }` 分支回传,由 `runAll` 决定 return——**不要在被提取的函数里直接 `process.exit`**,那会改变现有行为(现在走的是 return + finally 清理)。

## F 测试拆分

原则:测试文件与源模块同名,`test/<模块>.test.ts`。

### F.1 共享夹具先提取

`test/runner.test.ts` 顶部的共享件必须先落到 `test/fixtures/runner.ts`(放 `fixtures/` 子目录,`bun test` 只收 `*.test.ts`,不会把它当测试跑):

`task`(19)、`fakeClient`(62)、`sseClient`(291)、`retryClient`(392)、`idleStream`、`git`(736)、`freshRepo`(743)。

### F.2 describe → 目标测试文件

| 目标 | 承接 describe |
|---|---|
| `test/chain.test.ts` | resolveModel / splitModel / phaseToRole·roleOf / classifySessionError |
| `test/unit-commit.test.ts` | afterSession 完成条件门禁 / gatedAutoCorrectRefs·gatedTaskRefGap |
| `test/resume-gate.test.ts` | unitReruns / resumeNote |
| `test/session-api.test.ts` | forkSession / seedForkSession / ensureForkBase / sessionUsage / askHuman 等待扣除 |
| `test/testrun.test.ts` | handoffSteer·handoverDue / testHandoverDue / resolveTestScript / cleanTestHandoffs·restoreTestHandoffs |
| `test/watch.test.ts` | SSE 订阅生命周期 / 错误信号接线 / ◉ 会话结束两行报文 / 代答采集接线 / 会话边界统计接线 |
| `test/session.test.ts` | 会话链复用开关 / 会话错误重试 / attempt 接线 / 配额降级 failover / failback 粒度 / 阶梯耗尽回落 |
| `test/artifact.test.ts` | requireArtifact 阶段步骤恢复 / 独立单元门禁 / 严格恢复 |
| `test/exec-session.test.ts` | seedPinFork |
| `test/runner.test.ts`(留存) | 其余(若已空则删除文件) |

### F.3 prompt.test.ts(1444 → 4 份)

按渲染族切:`test/prompt-exec.test.ts`(decompose/understand/contextBase/subtask/wrapup/fix/whole/test 协议)、`test/prompt-verify.test.ts`(verifyScriptGen/verifyJudge/review/reviewFix)、`test/prompt-phase.test.ts`(phasePlan/phaseHandover/finalTask/knowledge/priorKnowledge/numberRecovery/implementPlan)、`test/prompt-template.test.ts`(模式注入/init 产物模板/agent 契约模板/模板渲染完整性/question-rule)。

此项优先级最低(测试文件不进日常改动的上下文),排在最后。

## G 文档与引用更新

1. **`docs/structure.md`**:第 17 行那条 15750 字符的 `src/runner.ts` 总纲条目,按 §D.1 拆成 13 条(`src/opts.ts` … `src/runner.ts`),原文照搬到对应条目下,不重写描述;第 15 行 `src/loop.ts` 同理拆成 6 条。**每步实施时同步更新自己那一条**,不要攒到最后。
2. **`AGENTS.md` 导航段**:把指向 `src/runner.ts` 的条目改指新模块(例如"验收/审核 → `src/review.ts`"、"测试交接 → `src/testrun.ts` + `src/exec-session.ts`"、"模型路由注入点 → `src/session.ts` 的 attempt")。
3. **带行号锚的设计文档引用**(33 处 runner + 21 处 loop):按两档处理——
   - 仍描述**当前行为**的设计文档(model-routing / commit-boundary / test-handover-early / session-recovery-fidelity / stats-timing / auto-resolve / phases 等):重新指向新文件与新行号。
   - 已归档的**过程性计划文档**(`stable-refs-p1-plan.md` `precise-resume-plan.md` `session-error-retry-plan.md` `plan-archive.md`):按仓库既有约定给行号锚追加 `@f50cd615b` 版本标记,声明"该范围只对该历史修订有效",不再追新。
   - 定位命令:`grep -rn 'src/runner\.ts:[0-9]*\|src/loop\.ts:[0-9]*' docs/`
4. **根 `AGENTS.md` 的「进行中的方案」**:已登记本文件;全部完成后改记为已完成并注明日期。

## H 分步实施勾选表

每步 = 一次提交,顺序不可乱(依赖方向决定)。步骤内统一动作:搬运 → 在 `runner.ts` 加再导出 → `bun typecheck && bun test` → 更新 `docs/structure.md` 对应条目 → 提交。

**runner.ts(S1–S12)**

- [x] **S1** `src/opts.ts` — 纯类型与常量,零运行时依赖,先走通验证最省事。**已完成 2026-09-16**(提交见 git log `refactor(auto-core): 拆出 src/opts.ts`):`Outcome` `UnitStop` `SessionCommit` `SubtaskMode` `PermissionMode` `Opts` `FIX_ROUNDS` `DEFAULT_CONTEXT_LIMIT` 迁出;`config/final/implement/knowledge/numbering/loop` 六个包内调用方已改精确导入;`runner.ts` 末尾留兼容再导出。实测:runner.ts −100 行、opts.ts 112 行,771 pass 不变,`packages/auto` 零改动。
- [x] **S2** `src/chain.ts` — 会话链类型 + 模型路由求值 + 错误归类。**已完成 2026-09-16**:`Watch` `SessionResult` `SessionChain` `FailedSession` `ForkBaseInfo` `phaseToRole` `roleOf` `resolveModel` `splitModel` `ErrorClass` `ErrorInfo` `classifySessionError` + 归类正则/阈值 + `REUSE_BELOW` `REUSE_IDLE_MS` `REUSE_IDLE_MINUTES` 迁出;`Watch` / `SessionResult` / 三个 `REUSE_*` 原为模块私有,迁出后加 `export`。**包内无调用方需改**(其余 src 模块只从 runner 取 `requireArtifact` / `afterSession` / `restoreTestHandoffs` / `runOnce` / `runTask`,不碰会话链符号),`runner.ts` 末尾追加两行兼容再导出。实测:runner.ts −198 行、chain.ts 211 行,771 pass 不变,`packages/auto` 零改动。
- [ ] **S3** `src/unit-commit.ts` — 单元提交与回滚;同步改 `knowledge.ts`(`afterSession`)为精确导入。
- [ ] **S4** `src/resume-gate.ts` — 恢复点单元归属门禁 + 阶段/中断文案。
- [ ] **S5** `src/session-api.ts` — 会话 SDK 薄封装(分叉/用量/改名/存活)+ 输出格式化 + `askHuman`。
- [ ] **S6** `src/testrun.ts` — 测试执行与交接文档文件操作。**验收要点**:新文件不得 import `session`/`watch`/`exec-session`(§D.2 的环消解点)。
- [ ] **S7** `src/watch.ts` — 单函数独占文件。搬完确认 `watch` 只被 `session.ts` 的 `attempt` 调用。
- [ ] **S8** `src/session.ts` — `runSession` / `attempt` / 重试决策。
- [ ] **S9** `src/artifact.ts` — `requireArtifact`;同步改 `final.ts` / `implement.ts` / `numbering.ts` / `knowledge.ts` 为精确导入。
- [ ] **S10** `src/exec-session.ts` — 交接时序状态机。
- [ ] **S11** `src/review.ts` — 验收三段式 + 质量审核。
- [ ] **S12** `src/execute.ts` — 理解/分解/子任务/整任务执行;收尾:`runner.ts` 只剩 `runTask` + `runOnce` + PLAN/CURRENT 小工具,复核 §B 判据 1–3,按 §D.3 决定再导出的最终留存面,更新 `AGENTS.md` 导航段。

**loop.ts(S13–S17)**

- [ ] **S13** `src/conclusion.ts` + `src/loop-progress.ts` — 两个叶子模块,一步搬完;测试文件已存在,改 import 即可。
- [ ] **S14** 提取 `RunAllOpts` 具名类型 + `src/loop-preflight.ts`,注意 §E 的"不要 process.exit"。
- [ ] **S15** `src/loop-task.ts` — 闭包转顶层函数,引入 `LoopCtx`;`ran` 降为局部。
- [ ] **S16** `src/loop-phase.ts` — 同上;`loop.ts` 收敛为 `runAll` 外壳。
- [ ] **S17** 复核 §B 判据,更新 `docs/structure.md` loop 条目与 `AGENTS.md`。

**测试(S18–S19,可与上并行但建议在后)**

- [ ] **S18** `test/fixtures/runner.ts` 提取 + `test/runner.test.ts` 按 §F.2 拆分。
- [ ] **S19** `test/prompt.test.ts` 按 §F.3 拆分。

**收尾(S20)**

- [ ] **S20** 按 §G.3 清理文档行号锚;根 `AGENTS.md` 的「进行中的方案」改记完成;`cd ../auto && bun typecheck` 确认壳包零改动;壳分支按仓库约定 `git merge auto-core` 刷新快照。

## H.1 施工手册(S1 实测跑通,后续步骤照此执行)

每步的机械流程,新会话直接按此照做:

1. **定位**:按符号名 grep,不要用 §D.1 表里的基线行号(已漂移)。
   `grep -n '^export type X\|^function X\|^const X' src/runner.ts`
2. **抽取**:用一段 python 按行区间**逐字**切出到新文件,不要手敲重录——手敲必然改标点。
   ```python
   src = open("src/runner.ts").read().split("\n")
   seg = lambda a, b: "\n".join(src[a-1:b])   # 1-indexed inclusive
   ```
   新文件头部写 3–4 行职责说明 + `拆分自 src/runner.ts(docs/module-split-plan.md S<n>,纯搬运)`,再跟 import。
3. **删除**:同一段 python 按区间删 runner.ts,**区间末尾多带一行**把符号后的空行一并收掉,否则留下连续空行。
4. **接线**:runner.ts 顶部加 `import { … } from "./<新模块>"`(保留仍在用的符号),末尾兼容再导出块追加一行。
5. **`bun typecheck`** —— 先只跑它,快且能立刻暴露漏搬的符号。
6. **改包内调用方**:`grep -n 'from "./runner"' src/*.ts`,把本步迁走的符号改为从新模块精确导入(§C)。**壳包 `packages/auto` 一律不动**,靠再导出兜住。
7. **`bun test`** —— 数字必须等于上一步的基线(S1 后为 **771 pass / 0 fail**),少一个就是搬丢了测试。
8. **逐字校验**(§J 第一行风险的实做手段):
   ```bash
   git diff src/runner.ts | grep '^-' | grep -v '^---' | sed 's/^-//' | grep -v '^$' > /tmp/removed.txt
   tail -n +<新文件头部行数+1> src/<新模块>.ts | grep -v '^$' > /tmp/moved.txt
   diff /tmp/removed.txt /tmp/moved.txt
   ```
   差异只应是本步**有意**的改动(见下 §H.2);其余任何一行差异都是搬运事故。
9. **`docs/structure.md`**:插一条新 bullet(位置紧邻 `src/runner.ts` 那条)。
10. **提交**:`refactor(auto-core): 拆出 src/<模块>.ts`,正文写清迁了哪些符号、哪些调用方改了精确导入、实测行数与测试数。

### H.2 S1/S2 踩到的点(后续步骤会重复遇到)

- **模块私有常量要加 `export`**:`FIX_ROUNDS` / `DEFAULT_CONTEXT_LIMIT` 原是 `const`,迁出后必须导出。这是搬运中**唯一允许**的正文改动,逐字校验时把它规范化掉再比:
  `sed 's/^export const FIX_ROUNDS/const FIX_ROUNDS/'`。
- **注释块可能跨符号**:`SessionCommit` 头上那段长注释,前几段讲的是 `afterSession`、最后一段才讲 `SessionCommit`。处置口径:**按段落把每段跟着它描述的符号走,措辞一字不改**;原本用来分段的那行孤立 `//` 随之删掉(S1 里删的就是它,也是逐字校验唯一的一行差异)。
- **符号可能不连续**(S2 的 `ForkBaseInfo` 在文件另一处,离主区间 900 多行):按 §D.1 的"承接符号"逐个 grep 核位置,别假设一个区间切完就够。
- **迁出后 runner.ts 会留下悬空的 type import**:S2 搬走 `resolveModel`/`phaseToRole` 后,`./switches` 的 `ModelLetter` / `ModelPolicy` 在 runner.ts 已无人使用,但 `tsgo` 不报未使用导入(未开 `noUnusedLocals`),`bun test` 也不会发现。**每步末尾对本步搬走的符号所用的 import 逐个 `grep -cw` 一遍**,计数只剩 import 行自身的就删掉。
- **`docs/structure.md` 多数步骤是"加条目"而非"挪文字"**:`src/runner.ts` 那条 15750 字符的 bullet 讲的是流水线**行为**(行为留在 runner.ts),没有可整段excise 的"类型定义"文字。别为了凑 §G.1 的"拆成 13 条"硬搬——**只有讲的是被迁走的那段机制时才搬文字**,否则新写一条。

### H.3 下一步(S3 `src/unit-commit.ts`)的现成坐标

当前 HEAD 下的符号位置(仍需自行 grep 复核):

| 符号 | 行 | 备注 |
|---|---|---|
| `AUTO_ANSWER` 相关注释段起 | 69 | `autoAnswer` 头上的英文注释,整段随符号走 |
| `autoAnswer` | 79 | 已导出 |
| `afterSession` | 107 | 已导出;`knowledge.ts` 从 `./runner` 取它,本步改精确导入 |
| `commitBlocked` | 139 | 模块私有,**留存侧 16 处调用**(各会话收口的 failed → blocked 折叠),迁出需加 `export` |
| `collectSessionMarks` | 147 | 模块私有,`afterSession` 独用,保持私有 |
| `wrapupResolves` | 167 | 模块私有,留存侧 2 处调用(收尾/修复后收尾),迁出需加 `export` |
| `gatedAutoCorrectRefs` / `gatedTaskRefGap` | 175 / 180 | 已导出 |
| `strictResumeActive` / `resumeModelNow` | 189 / 196 | 已导出 |
| `rollbackUnitState` | 205 | 模块私有,**留存侧 5 处调用**(runTask 恢复块 ×2 / executeWhole / runSubtask / requireArtifact 步骤),迁出需加 `export` |
| `rollbackRemark` | 232 | 模块私有,`rollbackUnitState` 独用,保持私有 |

区间从 69 到 239 基本连续(S2 已把原先夹在中间的会话链符号抽走),末尾紧邻的是 **S4** 的 `UnitRerunCtx` 注释段,注意别顺手带走。

`unit-commit.ts` 需要的 import(以 `tsgo` 报错为准补齐):`Opts`(./opts)、`Phase`(./resume)、`Switches` `autoSwitches`(./switches)、
`RollbackResult` `UnitBaseline` `commitTree` `rollbackUnit` 等(./git)、`ResolveItem` 与 resolve 系函数(./resolve)、`autoCorrectRefs` `formatRefGap` `taskRefFindings`(./refcheck)、
`log`/`vlog`(./log)、`shellProfile`(./shell)。**方向性核对**:`unit-commit` 位于会话驱动层之下,不得 import `session`/`watch`/`runner`。

上表的"留存侧调用数"已于 2026-09-16 实测;实施时用 `grep -n '<符号>' src/runner.ts` 复核一遍即可。

## I 决策记录

- **D1 先 runner 后 loop**:runner.ts 是"多个中等函数堆叠",按调用层切开是搬运;loop.ts 的 946 行 `runAll` 需要把闭包捕获显式化,属真重构。先把低风险的做完,拿到收益再动高风险的。
- **D2 保留兼容再导出**:让拆分期间 `test/runner.test.ts`(2780 行)与 `packages/auto` 零改动,每步的 diff 就只有"搬运"一种成分,`bun test` 的绿灯才有诊断价值。代价是 `runner.ts` 多一段再导出,S12 收敛。
- **D3 `testrun` 与 `exec-session` 分家**:不是按"都跟测试交接有关"归堆,而是按依赖方向切——这是整个方案里唯一一处不能凭直觉分组的地方,理由见 §D.2。
- **D4 不拆 `watch`/`runTask`/`attempt` 内部**:拆单个大函数要引入状态对象与中间抽象,风险与"纯搬运"的定位冲突。各自独占文件后(490/447/265 行)读入成本已可接受;若将来仍嫌大,另立任务。
- **D5 不动 refcheck/stats/prompt**:659/665/579 行、职责单一,拆分收益不抵引用与文档成本。
- **D6 历史计划文档的引用用 `@sha` 钉住而非追新**:那些文档描述的是当时的实现状态,把行号追到新文件会制造"文档说的是现在"的错觉;`@<sha>` 版本标记是仓库既有约定(见 `src/agents-block.ts` 的引用规范)。

## J 风险与回滚

| 风险 | 处置 |
|---|---|
| 搬运中漏带注释或改了措辞 | 每步 `git show` 自查;搬运步的 diff 应当只有"一处删、一处增"且内容逐字相同 |
| 意外引入 import 环 | S6/S7 明确列为验收要点;`tsgo` 不报环,靠人工核对 §D.2 的方向图 |
| 提取 loop 闭包时漏掉捕获量 | `LoopCtx` 字段已按 §E 核实;`tsgo --noEmit` 会报未定义标识符,漏掉即编译失败 |
| 某步做到一半上下文耗尽 | 步骤粒度已按"单个模块"切;真在途中断时 `git checkout -- .` 回到上一步的干净态重做该步,不要续接半成品 |

回滚:每步独立提交,`git revert <sha>` 即可退单步;整体回滚 `git revert` 区间或 `git reset --hard f50cd615b`(仅限尚未合入壳分支时)。
