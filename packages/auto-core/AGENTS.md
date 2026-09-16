# AGENTS.md

面向编码代理的包内说明,保持精简:文件级结构细节见 [docs/structure.md](./docs/structure.md),程序对目标目录的行为契约见 [docs/behavior.md](./docs/behavior.md),设计基准见 `docs/` 下各设计文档;CLI 外壳见 `../auto` 包。

## 概述

`@opencode-ai/auto-core` 是 auto 工具族的核心库(无 bin):任务流水线、阶段循环、验收/审核、提示词模板、配置、自动编号、中断恢复、统一提交等机制集中于此,经子路径导出(`@opencode-ai/auto-core/<模块>`)供外壳包消费。注释与用户可见文案使用中文。

注意区分两类认知:`PLAN.md`/`CURRENT.md`/`.opencode/auto/config.json`/`docs/agents/` 等是程序运行时施加于**目标目录**的规范对象,并非本仓库自身的文件约定;本仓库自身的文档直接放在 `docs/` 下。

## 命令(在本包目录运行)

- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`。

## 构建约定(开发本程序)

- **模板必须保持 `with { type: "file" }` 导入**,这是壳包编译时嵌入二进制的唯一方式;新增内置模板时同步登记:提示词模板 → `src/template.ts` 的 embedded 注册表(外壳附加模板改经 `registerTemplate`),模式模板 → `src/mode.ts`,init 复制模板由壳层登记。
- `src/templates.d.ts` 为 `*.md` / `*.json` 导入提供路径字符串类型;`tsconfig.json` 里 `resolveJsonModule: false` 勿移除。
- 外壳经 `package.json` 的 `exports`(`"./*": "./src/*.ts"`、`"./templates/*"`)直接引用本包 TS 源与模板文件,新增 src 文件无需登记 exports;**核心不知外壳**(不得反向 import 任何壳包),外壳差异一律经 `src/shell.ts` 画像或参数注入。

## 核心/外壳契约

本包为核心,壳包(`packages/auto` 通用 CLI/bin `opencode-auto`,及各壳分支的简易壳 `packages/<name>`,包名与 bin 由各壳自行命名、核心不记录)经子路径单向依赖本包;**壳分支不得改本包**,差异经 `setShellProfile`/`registerTemplate`/参数透传注入。分支模型(核心改动只落 auto-core 分支、壳分支定期 merge auto-core 刷新快照、auto 为集成分支)与新壳接入清单见 [docs/shell-contract.md](./docs/shell-contract.md)。

## 导航(按改动定位)

- 项目配置 → `src/config.ts`(设计: docs/init-config-agents-design.md)
- 任务流水线 → `src/runner.ts`(runTask/runOnce)+ `src/execute.ts`(整任务/理解/分解/子任务执行);会话链与会话驱动 → `src/chain.ts` + `src/session.ts`(runSession)→ `src/attempt.ts`(单次下发)→ `src/watch.ts`(事件流),产物型旁路会话 → `src/artifact.ts`(requireArtifact);阶段循环 → `src/loop.ts`(runAll 外壳)+ `src/loop-task.ts`(主任务循环/终审推进)+ `src/loop-phase.ts`(阶段循环)+ `src/phases.ts`(设计: docs/phases-design.md),运行前预检(契约完整性/启动 clean 门禁/中断状态复位/housekeeping 提交)→ `src/loop-preflight.ts`
- fork 分解(理解→分解→执行三段式、分叉基点、OPENCODE_AUTO_* 实验开关)→ `src/execute.ts` + `src/session.ts` 的 ensureForkBase + `src/session-api.ts` 的 forkSession/seedForkSession + `src/switches.ts`(设计: docs/fork-decompose-design.md)
- 步进模式(OPENCODE_AUTO_STEP 环境变量:phase/task/subtask 包含式边界硬暂停)→ `src/step.ts`(设计: docs/step-mode-design.md)
- 验收/审核 → `src/review.ts`(verifyTask/reviewTask)+ `src/verify.ts` + `docs/verify-review-design.md`;终审闭环 → `src/final.ts` + `docs/mode-final-review-design.md`
- 提示词文案 → 只动 `templates/prompts/*.md`(`src/prompt.ts` 只做数据组装),改后跑 `bun test test/prompt-exec.test.ts test/prompt-verify.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts`
- 测试交接前置化(--handover-test:交接判据解耦为「上下文达 contextLimit」单条件,判定时点固定在 AI 发起测试那一刻;定版提交 + 收尾交接 + 提交 #2 后运行测试(并发时序在 OPENCODE_AUTO_HANDOVER_CONCURRENT 之后,重测守卫已退役),交接文档归档 testhandoff-<n>.md,一次交接两次提交)→ `src/testrun.ts` 的 testHandoverDue/executeTest + `src/watch.ts` 的 handleIdleTest + `src/exec-session.ts` 的 runExecSession + `src/git.ts` 的 trackedSourceChanges + `templates/prompts/test-wrapup.md`(设计: docs/test-handover-early-design.md,2026-09-15 已实施)
- 统一提交 → `src/git.ts`;单元提交边界(完成判定 = 落盘且已提交、启动 clean 门禁 + SHA 基线、Auto-Nested 全量嵌套仓库、隐藏任务 ③④)→ 同 `src/git.ts` 的 beginUnit/unitBaseline/unitViolations/commitPending + `src/unit-commit.ts` 的 afterSession + `src/artifact.ts` 的 requireArtifact(spec.unitStart),设计 docs/commit-boundary-design.md;中断恢复 → `src/resume.ts`(恢复点在提示词下发时即写、可重试错误还原;**单元归属门禁**——active 会话属于具体执行单元(阶段/子任务#N/修复检查项#N),仅当该单元将重跑才复用,否则记录转总结态开新会话,`src/resume-gate.ts` 的 unitReruns;子任务/修复项 active 记录带归属序号 index、单元收口即转总结态;阶段级旁路步骤 phase-plan/phase-handover 经 requireArtifact 的 spec.step 携带 step 恢复点,openStep/closeStep 收口;**会话恢复优先于文件推导路由**——设计 docs/session-resume-precedence-design.md,2026-09-10 已实施;**恢复保真**(OPENCODE_AUTO_STRICT_RESUME,缺省 off 灰度,2026-09-15 已实施)——active 记录带单元基线 baseline + 生效模型 model、恢复前经 git.ts 的 baselineIntact 核对(外部提交 → dirty)、不可保真经 git.ts 的 rollbackUnit + `src/unit-commit.ts` 的 rollbackUnitState 回滚到基线冷启动重做、复用会话的恢复说明收敛为一句 continue、交接边界写核,设计 docs/session-recovery-fidelity-design.md);模式 → `templates/modes/` + `src/mode.ts`
- 自动编号(--auto-number)→ `src/numbering.ts`(记录 .auto/next-task、缺失时 AI 恢复会话)+ `templates/prompts/number-recovery.md`
- 死循环检测(会话内重复同一动作且结果不变 → driver steer 提示,OPENCODE_AUTO_STUCK 缺省 on)→ `src/stuck.ts` + `templates/prompts/stuck-hint.md`(设计: docs/stuck-loop-design.md)
- 阶段化模型路由与配额降级(OPENCODE_AUTO_MODEL / _FALLBACK:按阶段字母 + 会话角色逐次带 model,配额受限时 fork 保上下文换候选;OPENCODE_AUTO_MODEL_FAILBACK_SCOPE 控回试粒度 phase|task|subtask|session 缺省 task,/failback 在安全边界重置降级状态、带参整体重定义模型序,实际使用模型 ◈ 行上终端)→ 设计 docs/model-routing-design.md(2026-09-10 定稿,**P1..P8 已实施**;解析在 src/switches.ts 的 parseModelPolicy,注入点为 `src/attempt.ts` 的 attempt 中 client.session.prompt——target=chain.model??sticky??override??resolveModel(角色>字母>*),`src/chain.ts` 的 roleOf/phaseToRole 推角色、splitModel 拆分、classifySessionError 归类 quota/auth/rate/overflow/transient/unknown、`src/session.ts` 的 runSession 降级环取候选+窗口钳制经 fork 续跑;回试粒度与 /failback 模块态在 src/failback.ts,边界挂点同 step/exit)
- 会话故障等待-探测环(**会话故障不退出**——2026-09-16 起:不可重试配额类错误、瞬时错误阶梯耗尽、配额降级候选用尽,一律以 OPENCODE_AUTO_RECOVERY_WAIT 缺省 30 分钟为间隔无限等待,每轮用全新临时干净会话下发极小探测提示词,恢复后 fork 被中断的会话续跑、阶梯重开;创建/下发失败与 SDK 异常同入此机制,唯一出口是连按两次 Ctrl+C;人工裁决 askRetry/retryDecision 与 OPENCODE_AUTO_RETRY_ASK 退役)→ `src/session.ts` 的 awaitRecovery(设计: docs/session-error-retry-plan.md「2026-09-16 修正三」)
- 跨中断累计统计(任务/会话/阶段/轮次用时与 Token 分项,.auto/stats.json 增量落盘,无开关常态统计)→ `src/stats.ts`(设计: docs/stats-timing-design.md,**P1..P7 已实施**;loop.ts 生命周期接线、`src/conclusion.ts` 结论行与续接横幅、`src/loop-progress.ts` 进度心跳、attempt.ts 会话边界与 ◉ 两行报文、step.ts/askHuman/waitBetweenTasks 等待扣除)
- 提问策略与代答审计(OPENCODE_AUTO_ASK 缺省 off;两类标记按「分歧点的决定权本应属于谁」区分——属于用户的代答标 AUTO-RESOLVE 并进 `.auto/resolves.json` 台账、任务/阶段/轮次结论行前 `⚑` 置顶,属于 AI 的工程裁量标 AUTO-DECISION 只折成计数)→ `src/resolve.ts` + `src/switches.ts` + `templates/prompts/_partials.md` 的 question-rule(设计: docs/auto-resolve-design.md,**T-001..T-008 已实施**;接线在 watch.ts H1、chain.ts H2(SessionResult 带回)、attempt.ts H3、unit-commit.ts H4/H7、loop.ts H5/H6(高亮块构造在 `src/conclusion.ts`)、prompt.ts 的 renderPrompt 注入 ask 与 renderWrapup 的 resolves)
- 外壳画像(报文程序名/契约恢复指引/日志审计语义参数化)→ `src/shell.ts`
- 稳定引用与文件存放规范(docs/T-NNN/ 目录化、docs 永不移动、轮次专用目录 docs/R-NN/(轮首 establishRound 建立、根 PLAN.md 为其符号链接)、引用一致性三层检查)→ docs/stable-refs-design.md(设计定稿 2026-09-06,P1..P4 已全部实施;轮次专用目录方案 2026-09-08,见 plans/ROUND_WORKDIR_PLAN.md 与 phases-design.md M 节;路径构造/读回落在 src/docpaths.ts,引用提取/校验/改写/门禁在 src/refcheck.ts)
- refcheck 范围收敛与恢复(OPENCODE_AUTO_REF_CHECK 开关默认关、git 历史恢复缺失引用、行号锚 @sha 版本标记、摒弃移动文件适配)→ docs/refcheck-scope-design.md(2026-09-08 定稿,P1..P3 已全部实施;开关在 src/switches.ts,缺失恢复 renameHistory/recoverMissingRefs 与范围再确认 reconfirmAnchors 在 src/refcheck.ts)
- 核心/外壳边界、合入流程、新壳接入 → docs/shell-contract.md
- **大文件拆分(已完成 2026-09-16)** → docs/module-split-plan.md(2026-09-16 立项:目标单文件 ≤ 600 行,纯搬运不改行为。**runner.ts 与 loop.ts 拆分均已完成**(S1–S12:runner.ts 4064 → 578 行,拆出 opts/chain/unit-commit/current/resume-gate/session-api/testrun/watch/attempt/session/artifact/exec-session/review/execute 14 个模块;S13–S16:loop.ts 1239 → 131 行 runAll 外壳,拆出 `src/conclusion.ts`/`src/loop-progress.ts`/`src/loop-preflight.ts`(含 `RunAllOpts` 与 `renderAgentContract`,loop.ts 再导出兜住壳包)/`src/loop-task.ts`(`advanceFinal`/`runTaskLoop` 闭包转顶层函数 + `LoopCtx`,`ran` 作可变字段进 ctx)/`src/loop-phase.ts`(阶段循环四闭包同上)5 个模块;S17 复核 §B 判据 1–3 通过:非豁免文件最大 579 行、771 pass 不变),测试拆分亦完成(S18:test/runner.test.ts → 9 份 + fixtures/runner.ts;S19:test/prompt.test.ts → prompt-exec/prompt-verify/prompt-phase/prompt-template 4 份 + fixtures/prompt.ts,两原文件均拆空删除),S20 文档行号锚清理完毕(§G.3:现行设计文档改指新模块新行号、自钉基线段与历史叙述保留、归档计划文档钉 @f50cd615b)。**`runner.ts` 不再是万能入口**:只留 runTask/runOnce,兼容再导出仅保留壳包消费面(PermissionMode/SubtaskMode 类型与 requireArtifact),包内模块与单测一律从符号所在模块精确导入。**动这些文件前先读该文 §D.2 的依赖方向图**——下层模块不得反向 import runner,`testrun.ts` 不得反向 import 会话驱动层)
- 完整文件清单与机制细节 → docs/structure.md、docs/behavior.md

## 核心不变量(改动前必读)

开发本程序(代码层面约定):

- 目标目录 `PLAN.md` 的解析规则(src/plan.ts):字段行(`  - key: value`)必须紧跟任务标题且连续;改解析规则同步 `test/plan.test.ts` 与壳包 README 格式说明。
- 运行时依赖外部 `opencode` CLI(spawn `opencode serve`)或 `--server` 复用已有实例;二进制自身不含 opencode。

设计本程序功能(行为契约,施加于目标目录,实现不得破坏):

- 退出码:`0` 完成 / `1` 用法或环境错误 / `2` 阻塞或回退 pending 待人工 / `130` 连续两次 Ctrl+C 强退。
- 宪法级项目属性(-m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir)仅 init 固化到目标目录 `.opencode/auto/config.json`,run 出现即退出码 1;配置坏文件严格失败,未知键忽略。**提交不可关闭**:`--commit false`(及旧别名 none)与配置 `commit: false` 已于 2026-09-15 退役(commit-boundary-design.md D7),出现即用法错误/严格失败——提交是完成条件,门禁只在 dryrun 与非 git 环境不生效。
- **driver 独占状态写入**:目标目录 PLAN.md/CURRENT.md 与 verified 字段全由 driver 写,AI 会话禁止编辑;`run` 期间这些状态文件只读(src/protect.ts 放行 driver 写入)。
- **统一提交**:AI 会话不得执行提交类命令;会话结束后由 driver 经 src/git.ts 递归提交目标目录全部改动(先嵌套子仓库后本仓库)。**提交是完成条件**(docs/commit-boundary-design.md):统一提交失败 → 阻塞停机待人工;执行单元(任务/子任务/独立隐藏任务)启动要求工作区 clean(PLAN.md/CURRENT.md 遗留自愈,其余脏区 dirty 交人工,run 启动同口径),收口经 SHA 基线校验提交区间内只有 driver 提交(Auto-Stage trailer);恢复续跑豁免 clean 检查。
- 完成判定不靠 agent 自报:verify 启用时 driver 执行脚本、独立判定会话下结论;子任务由 driver 勾选;隐藏任务产物落盘且已提交才算完成(③ 补提交/④ dirty,git.ts commitPending/beginUnit)。
- **独立判定会话不 fork**:verify-judge/review/review-fix/final 系会话全新创建,不继承执行上下文(独立判断是完成判定的基石,见 fork-decompose-design.md §9)。
- **实验开关只读环境、不落盘**:`OPENCODE_AUTO_*` 环境变量层(src/switches.ts 核心内解析、CLI 壳零改动)不写任何状态文件,实验语义 = 本次运行;宪法键转正前不进 ProjectConfig。

## 本文档维护

保持精简:新机制只在此加一行导航或不变量,细节写入 `docs/` 下对应文档。
