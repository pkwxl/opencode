# 会话恢复优先于流程恢复(设计 + 实施记录)

> 状态:**已实施**(2026-09-10,`packages/auto-core`,分支 `auto-core`)。
> `bun typecheck && bun test` 全绿(451→459 pass,+8 用例)。
> 本文件是设计真相;`precise-resume-plan.md` / `session-error-retry-plan.md`
> 为前序工作,本文修订其中两处现状(见文末「与前序文档的关系」)。

## 需求原文(用户)

> 会话中断后再次运行时,子任务会话仍未被真正复用;尽管我们已经修复了会话的
> 有效断点,但这次遇到配额限制时,直接跳过了恢复,这说明恢复机制至少在本次
> PLAN 阶段是不成功的。我们的流程恢复机制应与会话恢复机制相配合:若存在会话
> 恢复点,应优先于流程恢复点生效;因为流程无法感知会话内的详细状态,仅凭外部
> 文件是否存在,就会直接跳过尚未完全结束的处理环节。我们不能将 AI 生成的文件
> 作为流程控制的依据,必须以 driver 切实保存的状态进行控制。

两条原则:

1. **会话恢复点优先于流程恢复点**:存在未收口的会话恢复点时,流程必须重入该
   会话所属步骤续跑,而不是让"文件推导路由"前进。
2. **流程控制不得以 AI 生成的文件为依据**:PLAN.md 任务、交接文档等是 AI 写的
   (或会话中断后 driver 才补的),它们的存在不能证明"会话已收口";只有 driver
   切实保存(并在收口时清除)的状态才能作为流程推进依据。

## 问题现场(`/workspace/kernel-dm-stripe`,auto-migrate 用户任务)

### 现场一:阶段规划会话被静默跳过(原则 1/2 直接命中)

1. `run-2026-09-09_22-26-31.log`:第 5 轮 m(迁移实现)阶段规划会话
   `ses_f773ba946ffeWbMA0w0SEPRyta`(标题 `PLAN plan m 迁移实现`)于 `00:39`–
   `00:47` 工作,`00:47:47` 写出 PLAN.md(T-065..T-068 四个任务)后立刻撞上
   Kimi 周配额(`isRetryable:false`)。driver 按
   `session-error-retry-plan.md` 第 1–3 点正确处置:`⛔ PLAN 遇到不可重试的会话
   错误,直接阻塞`,不 fork、不换白板会话,`chain.id` 留在该会话上。该会话累计
   **196.8k tokens**(DB `session` 表实测),是真正干了活的会话。
2. 但规划会话是**旁路一次性会话**(`requireArtifact` 骨架,伪任务 `PLAN`),
   `attempt()` 的 `remember()` 当时以 `task.id.startsWith("T-") && chain.phase`
   为门控,而旁路链**不携带 phase**——于是该会话从未写入 `.auto/progress.json`,
   driver 侧没有任何"规划步骤进行中"的恢复点。
3. `run-2026-09-10_00-51-49.log`:下一次运行,`routePhase` 纯从(台账, PLAN.md)
   推导——PLAN.md 已有四个未 done 任务 → 路由 `execute` → 直接 `▶ T-065 开始执行`。
   规划会话被静默丢弃:它 196.8k 的上下文、以及 driver 侧本应在规划收口时做的
   记账(`advanceNextTask` 推进编号、`PLAN plan m` 统一提交)全部丢失。`.auto/next-task`
   仍停在 `65`(T-065..068 已占用 65–68),正是规划未收口的痕迹。

### 现场二:回合进行中被 kill,在跑的子任务会话无人认领

1. 同一次运行 `00:56:10`,T-065 的分解会话从 digest 基点分叉出
   `ses_f772f5aa6ffed3GThypRRhTEAb`(标题 `T-065 decompose …`),读了 batch1 设计
   文档、累计 **29.4k tokens**;`00:56:19`/`00:56:20` 用户连续 Ctrl+C 强退(130)。
2. `.auto/progress.json` 当时是 `{task:T-065, session: ses_f7733502effe…(理解会话),
   active:false, phase:{kind:"decompose"}}`——`at` 比 decompose 会话的创建时刻还早
   8ms。即:记录停在**上一阶段边界**(理解会话结束、`persistStage(decompose)` 写
   `active:false`),真正在跑的分解会话既没被记为 `session`、也没被记为 `active`。
3. 根因是 `session-error-retry-plan.md` 第 4 点把 `remember()` 从"sessionID 刚确定
   (下发前)"挪到了"回合结束后":该改动修掉了"可重试中间失败态顶替真实会话"
   (T-062),却顺手取走了"回合进行中被 kill 时对在跑会话的认领"。下一次运行
   `active:false` → 不复用 → 分解从零重做。这就是用户说的"子任务会话仍未被真正
   复用"。

## 根因

| # | 根因 | 违反的原则 |
| --- | --- | --- |
| A | 阶段级旁路会话(规划/交接)不写 driver 侧恢复点;流程仅凭 AI 写的文件(PLAN.md/交接文档)推导路由,把未收口的会话静默跳过 | 原则 1 + 2 |
| B | 执行链会话的 `active` 记录只在**回合结束后**写;回合进行中被 kill 时记录停在上一阶段边界(`active:false`、指向上一会话),在跑的会话无人认领 | 原则 1(会话恢复点不存在,谈不上优先) |

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 恢复点落盘时机(B) | 改为**提示词下发成功即写** `active` 记录(认领在跑的会话);回合结束后按结果刷新 |
| 可重试错误(B) | 回合以可重试会话错误结束时,把 `progress.json` **还原为下发前快照**(被弃的 fork 副本/失败会话不顶替真实恢复点)——保留 `session-error-retry-plan.md` 第 4 点的保护,从"不抢先落盘"改为"下发即写 + 失败还原" |
| `remember()` 门控(B) | 去掉 `task.id.startsWith("T-")`,只留 `chain.phase`——携带阶段的会话(执行链 + 阶段步骤旁路)都写;无阶段的一次性旁路(判定/审核/脚本生成/修复规划/dryrun/fork 基点)仍不写 |
| 阶段步骤恢复点(A) | `resume.ts` 的 `Phase` 加 `step` 变体(`phase-plan`/`phase-handover` + 归属阶段字母);`requireArtifact` 加 `spec.step`,进入时若发现同一步骤的 `active` 记录 → 续跑 |
| 续跑时是否复用会话(A) | 会话存活且非报错桩 → 复用原会话(保留产物现场,**不重置**);会话已死/`--new-session`/报错桩 → 开新会话并**照常重置**(等同全新步骤) |
| 收口时机(A) | 由**调用方**在自身后处理完成后经 `closeStep` 删除记录:规划 = 编号推进 + 完成日志之后;交接 = 蒸馏产物校验 + 提交之后(其后的归档/重置/台账为幂等 driver 记账,由既有"交接中断恢复"兜底)。`requireArtifact` 本身不删,避免"产物已校验但后处理未完成"时被 kill 丢失步骤认领 |
| 路由优先级(A) | `runPhaseLoop` 在消费文件推导路由**之前**先查 `openStep`:步骤归属阶段 == 当前路由阶段且未入台账 → 重入该步骤(复用会话);阶段已入台账 → 清除陈旧记录;字母不一致(人工回退/陈旧)→ 告警并让文件路由优先 |
| 文件推导路由的去留 | **保留**为缺省路由(人工手填 PLAN.md、k 阶段人工填任务、`phases="m"` 纯人工模式均依赖它)。本设计只增加"存在未收口会话恢复点时一律以 driver 状态为准"这一优先层,不要求每个步骤都有 driver 收口戳(否则存量项目与人工流程全部被阻塞) |
| 覆盖面 | 本期覆盖阶段规划 + 阶段交接两个步骤,以及全部执行链会话的下发即写。知识提取(已有产物幂等守卫、失败仅告警)、编号恢复、终审生成(各有文件推导路由)暂不纳入,留作按需 |

## 实施(均已落地,`bun typecheck && bun test` 全绿)

### P1 `src/resume.ts` — 步骤恢复点类型与读写
- 加 `PhaseLetter`(`a|d|m|t|v|k`,内联避免 resume→phases 反向依赖)与
  `StepKind`(`phase-plan|phase-handover`)。
- `Phase` 联合加 `{ kind: "step"; step: StepKind; letter: PhaseLetter }`。
- 加 `openStep(dir)`:当前记录为 `active` 的 step 变体时返回 `{step, letter, session}`,
  否则 `undefined`。
- 加 `closeStep(dir, step, letter)`:仅当当前记录正是该步骤时 `forgetProgress`
  (记录不匹配则不动,避免误清任务记录)。
- 文件头注释重写:记录在下发成功时即写、可重试错误还原、阶段步骤也写记录。

### P2 `src/runner.ts` — 下发即写 + 失败还原(B)
- `attempt()`:`remember()` 门控去掉 `task.id.startsWith("T-")`,只留 `chain.phase`。
- 下发前快照 `prior = peekProgress(dir)`;`client.session.prompt` 成功后立即
  `await remember()`(认领在跑的会话)。
- 可重试会话错误分支:还原 `chain.id/used/at` 之外,把 `progress.json` 还原为
  `prior`(无 `prior` 则 `forgetProgress`)——被弃副本不顶替真实恢复点。
- import 加 `peekProgress`。

### P3 `src/runner.ts` — `requireArtifact` 步骤续跑(A)
- `spec` 加可选 `step?: { step: StepKind; letter: PhaseLetter }`。
- 进入时 `recallProgress(dir, task.id)`:同一步骤的 `active` 记录 + 会话存活 + 非
  报错桩 + 非 `--new-session` → `resumedSession`/`resumedUsage`,打"复用会话"日志;
  否则打"开新会话重做本步骤"日志。
- **全新步骤(无匹配 active 记录)进入时先写一个 `session` 未定的 active 恢复点**:
  使 attempt 的下发前快照(`prior`)恒非空——可重试会话错误还原时保留步骤认领而非
  删除记录,堵住"可重试错误耗尽 → 无记录 → 下次运行凭半成品 PLAN.md 跳过本步骤"。
- 循环内:`resume = i===0 && resumedSession`;`resume` 时**跳过 reset**(保留产物
  现场)、链携带 `id=resumedSession` + `note=resumeNote(stepPhase,true)` + 继承用量;
  否则照常 reset + 新链。链一律携带 `phase=stepPhase`(使 P2 的下发即写生效)。
- 反馈重试(i≥1)清 `resumedSession`(原会话已结束本轮却未产出,下一轮重置 + 新会话)。
- `phaseText`/`nextStepText`/`resumeNote` 补 `step` 分支(恢复日志与续跑提示词)。

### P4 `src/loop.ts` — 路由优先级 + 收口(A)
- import 加 `openStep`/`closeStep`。
- `planPhase`:`requireArtifact` spec 加 `step:{step:"phase-plan",letter:phase}`;
  成功路径(编号推进 + 完成日志后)`await closeStep(directory,"phase-plan",phase)`。
- `handoverPhase`:spec 加 `step:{step:"phase-handover",letter:phase}`;蒸馏成功
  (`distilled===true`)后、归档/重置/台账之前 `await closeStep(...)`。
- `runPhaseLoop`:在 `complete` 检查之后、`plan` 分支之前插入 `openStep` 优先层
  (见「已确认决策·路由优先级」)。

### P5 测试
- `test/resume.test.ts`:+4 用例(step 记录往返、openStep 三态、closeStep 匹配/
  不匹配、closeStep 不误删任务记录)。
- `test/runner.test.ts`:+4 用例(requireArtifact 续跑复用会话不重置、全新步骤重置
  + 新会话 + 下发即写恢复点、会话已死回退重置 + 新会话、可重试错误耗尽后步骤恢复点
  不被删除)。

### P6 文档同步
- 本文件;`docs/behavior.md` 进度恢复条目与阶段循环条目;`docs/structure.md`
  `resume.ts`/`runner.ts`/`loop.ts` 条目;`docs/phases-design.md` D/E 节;
  `precise-resume-plan.md` / `session-error-retry-plan.md` 交叉引用;包根 AGENTS.md 导航行。

## 验证

```bash
cd packages/auto-core && bun typecheck && bun test   # 458 pass / 0 fail
```

- 现场一回放:规划会话 `ses_f773ba946ffe` 若有 step 恢复点,下次运行 `openStep`
  命中 → `routePhase` 的 `execute` 被覆盖 → 重入 `planPhase` → `requireArtifact`
  复用该会话(196.8k 上下文不丢)续写/确认 PLAN.md → 编号推进 + 提交 + `closeStep`。
- 现场二回放:分解会话下发即写 `{session: ses_f772f5aa6ffe, active:true,
  phase:decompose}`;Ctrl+C 强退后下次运行 `runTask` 复用该会话(29.4k 上下文不丢)。
- 回归:`session-error-retry-plan.md` 的"可重试中间失败态不顶替真实记录"用例仍绿
  (改为下发即写 + 失败还原,终态不变);"不可重试阻塞正常落盘"仍绿。

## 与前序文档的关系

- 修订 `precise-resume-plan.md`「维持现状」之外的实现细节:恢复点落盘时机从
  "回合结束后"改为"下发成功即写 + 可重试失败还原"。
- 修订 `session-error-retry-plan.md` 第 4 点:其"不再抢先落盘"被细化为"下发即写、
  可重试错误还原为下发前快照"——既保住第 4 点要防的"中间失败态顶替真实会话",
  又恢复"回合进行中被 kill 时认领在跑会话"(第 4 点改动顺带取走的能力)。
- 第 5 点(`sessionUsage` 报错桩判据)不变;`requireArtifact` 续跑复用同款判据。

## 已知不覆盖(留作按需)

- 知识提取 / 编号恢复 / 终审生成会话:各有文件推导路由或幂等守卫,未纳入 step 恢复点。
- 跨轮次陈旧 step 记录:仅按"阶段已入台账则清除、字母不一致则告警"处置,不做轮号校验。
