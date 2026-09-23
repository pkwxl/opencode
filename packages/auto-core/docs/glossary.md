# Glossary (中文 ↔ English)

The canonical English term for each concept we discuss in Chinese. Code, comments, docs, logs and CLI output are English; conversations with people and coding agents are often Chinese. This table maps one to the other. When you write or translate, use the English column. When you ask an agent something in Chinese, add the English term (or the identifier) so it finds the right code.

## How to use

- **One concept, one English term.** Prose uses the English column exactly. Identifiers may compress it (`wrapup`, `closeout`); prose does not (wrap-up, close-out).
- **Name the English term when a Chinese word is ambiguous.** 交接, 回退, 降级 and 台账 each cover several mechanisms here. See [Confusable terms](#confusable-terms).
- **Protocol literals and file names are not vocabulary.** Strings the driver parses and file names are written verbatim, never translated or paraphrased ([Protocol literals](#protocol-literals), `plans/0035`).
- **Chinese comments still in `src/`** are translated on touch; translate them with this table.
- **Missing term?** Take the term the owning module's header comment uses and add a row in the same change. One row per concept: a rejected synonym goes under [Confusable terms](#confusable-terms), not into a second row.

## Repository and packages

| 中文 | English | Code / notes |
|---|---|---|
| 核心 | core | `packages/auto-core` (`@opencode-ai/auto-core`, no bin) |
| 外壳、壳 | shell | A CLI package that depends on the core one way |
| 通用壳 | general shell | `packages/auto`, bin `opencode-auto` |
| 简易壳 | simple shell | `packages/auto-migrate` (frozen `migrate` branch) |
| 外壳画像 | shell profile | `setShellProfile` (`src/shell.ts`) |
| 差异注入 | difference injection | Only through extension points |
| 扩展点 | extension point | `setShellProfile` / `registerTemplate` / parameter passing |
| 单向依赖 | one-way dependency | Shells → core; "the core does not know shells" |
| 接入清单 | onboarding checklist | `shell-contract.md` E (shells), F (agent adapters) |
| 核心快照 | core snapshot | The core copy a shell branch carries |
| 逻辑拆包 / 物理拆包 | logical / physical package split | Done 2026-09-05 |
| 集成分支 | integration branch | Former role of `auto` |
| 冻结 | frozen | `migrate` and `auto` since 2026-09-22 |
| 合回 | merge back | Always into `auto-core` |
| 目标目录 | target directory | The project the driver runs on, not this repository |
| driver、驱动程序 | driver | The orchestration program as a whole; `runner` is one module of it |
| 编排面 | orchestration plane | The driver modules, above the domains |
| 域 | domain | intent / phases / document / agent / driver (D8, `structure.md`) |
| 依赖方向 | dependency direction | Enforced by `test/import-direction.test.ts` |

## Run structure

| 中文 | English | Code / notes |
|---|---|---|
| 轮、轮次 | round | `R-NN`, `docs/R-NN/` |
| 阶段 | phase | `P<nn>-<type>/`, qualified id `R-NN.P<nn>` |
| 阶段类型 | phase type | `src/phases/registry.ts`; custom types in `.opencode/auto/phases/<type>.md` |
| 预设字母 | preset letter | `admtvk` in `--phases` ([Phase types](#phase-types)) |
| 阶段索引 | phase index | `docs/R-NN/phases.md` (order and membership only) |
| 任务 | task | `T-NNN`, `docs/T-NNN/` |
| 任务索引 | task index | The phase's `tasks.md` (order and membership only) |
| 子任务 | subtask | `S<nn>` (positional), `docs/T-NNN/S<nn>/` |
| 子任务清单 | subtask checklist | `docs/T-NNN/subtasks.md` |
| 单元 | unit | Generic for phase / task / subtask (unit model, `src/document/unit.ts`) |
| 执行单元 | execution unit | A unit with a commit boundary: task, subtask, standalone hidden task |
| 隐藏任务 | hidden task | Driver-created work outside the task index (phase planning, handover distillation, …); *standalone* when it is its own execution unit |
| 伪任务 | pseudo task | The task record a bypass session runs under |
| 全限定编号 | qualified id | `T-068.S01`, `R-01.P02` |
| 字段块 | field block | `Phase:` / `Depends:` / `Touches:` lines in `todo.md` |
| 就绪 | ready | `nextReady`: first unit not done whose dependencies are done |
| 建轮 | round establishment | `establishRound` |
| 轮关闭 | round close | `src/round-close.ts` |
| 无阶段模式 | no-phase mode | The implicit `R-01/P01-implement` |
| 流水线 | pipeline (task pipeline) | `runTask`: decompose → subtasks or whole → wrap-up → close-out |
| 阶段循环 / 任务循环 / 子任务循环 | phase loop / task loop / subtask loop | `loop-phase.ts` / `loop-task.ts` / `execute.ts` |
| 阶段路由 | phase routing | Route values `complete` / `plan` / `execute` / `handover` / `blocked` |

Unit and outcome states:

| 中文 | English | Code / notes |
|---|---|---|
| 待处理、待办 | pending | `pending` |
| 进行中 | in progress | `in_progress` |
| 完成 | done / completed | Unit status `done` (`done.md`); outcome `completed` |
| 阻塞 | blocked | Outcome `blocked`, exit 2 |
| 未完成 | incomplete | Outcome `incomplete` |
| 脏(工作区) | dirty | Outcome `dirty`; the clean gate failed |
| 回退 pending | revert to pending | Unit status goes back to `pending` for a person; exit 2 |
| 二态不变量 | two-state invariant | Exactly one of `todo.md` / `done.md` exists |

## Phase types

| Letter | `type` | Name | 中文 |
|---|---|---|---|
| `a` | `analysis` | Analysis | 分析 |
| `d` | `design` | Design | 设计 |
| `m` | `implement` | Implementation | 实现(旧称:迁移实现) |
| `t` | `test` | Testing | 测试 |
| `v` | `acceptance` | Acceptance | 验收 |
| `k` | `knowledge` | Knowledge distillation | 知识提炼 |

## Sessions and prompts

| 中文 | English | Code / notes |
|---|---|---|
| 会话 | session | An AI session; never "conversation" or "chat" |
| 会话驱动 | session driving | `runner` → `execute` → `exec-session` → `session` → `attempt` → `watch` |
| 理解 | understand | Merged into the decompose session |
| 分解 | decompose (noun: decomposition) | `decompose*.md` |
| 整体执行 | whole-task session | `whole.md`: a task run without subtasks |
| 收尾 | wrap-up | The AI session that writes the task report; `wrapup.md`, `src/wrapup.ts` |
| 收口 | close-out | The driver's mechanical checks and commit after a unit; runner `closeout` step |
| 阶段规划 | phase planning | `phase-plan.md` |
| 阶段交接 | phase handover | `phase-handover.md` |
| 交接提炼 | handover distillation | The bypass session that writes the phase handover |
| 旁路会话 | bypass session | A session outside the task pipeline that must produce a file (`requireArtifact`) |
| 下发 | dispatch | `attempt.ts` (single dispatch) |
| 复用(会话) | reuse | Continue an existing session instead of creating one |
| 分叉 | fork | |
| 分叉基 | fork base | `ensureForkBase`, `forkBase` |
| 会话链 | session chain | `SessionChain` |
| 插话 | steer | A message into a live session (`--interactive`, handover hint, stuck hint) |
| 插话文本 | interjection | The injected text; prefix `[DRIVER]` |
| 自然结束 | natural finish | The session ended by itself, not by the driver |
| 带反馈重提示 | re-prompt with feedback | Via `forkEndedSession` |
| 冷启动 | cold start | A new session with the full prompt |
| 执行范围 | execution scope | The task or subtask a session works in |
| 上下文上限 | context limit | `contextLimit`; "cap" in `usage.ts` |
| 用量 | usage | Token usage |
| 截断 | truncation (truncated output) | `step-finish reason=length` |
| 失联探针 | liveness probe | `probeSession` |
| 半开连接 | half-open connection | |
| 看门狗 | watchdog | `idleTime` / `idleMax` |
| 死循环检测 | stuck-loop detection | `src/stuck.ts`, `OPENCODE_AUTO_STUCK` |
| 摘要 | digest | |
| 权威状态接地 | ground state | The `ground-state` partial |
| 提示词 | prompt | |
| 模板 | template | `templates/prompts/*.md` |
| 片段 | partial | `_partials.md`, `registerPartial` |
| 模式 | mode | `-m/--mode`, `templates/modes/` |
| 意图 | intent | What the user wants; opposite of mechanism |
| 机制 | mechanism | What the driver enforces |
| 意图包 | intent pack | `templates/intents/default.md`, `### <key>` subsections |
| agent 合约 | agent contract | `.opencode/agent/auto.md` (`CONTRACT_AGENT`) |
| 金样 | golden file | `test/golden/*.golden.md` |

## Documents and protocols

| 中文 | English | Code / notes |
|---|---|---|
| 产物、产出 | artifact | Declared with `Artifacts:` |
| 交付物 | deliverable | What the project ships; opposite of process document |
| 过程文档 | process document | `docs/T-*`, `docs/R-*`, `.auto/`; deliverables must not reference them (P1) |
| 文档角色 | document role | `roleOf` (`src/document/roles.ts`) |
| 产物规格 | artifact spec | `src/document/spec.ts` |
| 预期产物清单 | expected artifact list | Parsed from the `Artifacts:` declarations |
| 产物索引 | artifact index | Section of the phase handover |
| 状态文件 | state file | `todo.md` / `done.md`, `CURRENT.md`, index ticks |
| driver 独占状态 | driver-exclusive state | Written only by the driver; read-only for sessions |
| 运行期状态 | runtime state | `.auto/units.json` (status, attempts, fork base) |
| 当前任务镜像 | current-task mirror | `CURRENT.md` |
| 勾选 | tick | `- [x]` |
| 台账 | ledger | Live use: the proxy-answer ledger `.auto/resolves.json`. The phase ledger is retired (the phase index replaced it) |
| 交接文档 | handover document | `handoff.md`, `testhandoff-<n>.md` |
| 形检 | shape check | `src/doccheck.ts` |
| 非平凡 | non-trivial | Shape-check criterion |
| 终止符 | eof marker | `<!-- auto: eof -->` |
| 零落盘 | zero-write | The session wrote nothing |
| 协议串 | protocol string | A literal the driver parses (`plans/0035`) |
| 协议标记 | protocol marker (tier-1 / tier-2) | `PROTOCOL_MARKERS`, `PARTIAL_MARKERS` |
| 双读 | dual-read | The parser accepts old and new spellings |
| 锁步 | lockstep | Parser, template and tests change in one commit |
| 翻转 | flip | Switch a protocol string to its new spelling |
| 稳定引用 | stable reference | `src/docpaths.ts` |
| 引用检查 | reference check | `src/refcheck.ts` |
| 报告结果行 | report result line | `Result: PASS` / `Result: FAIL` |
| 结论 | verdict | |
| 自报 | self-report | Never a completion criterion |
| 轮简报 | round brief | `docs/R-NN/round.md` |
| 简报、项目简报 | project brief | `.opencode/auto/brief.md` (`src/brief.ts`); "the brief" when the round brief is not in play |
| 项目简报桩 | project brief stub | What `init` writes when `brief.md` is missing: section headings with comment hints only, so it injects nothing into planning; `reset` removes the brief only while it equals the stub (`renderProjectBrief`, `plans/0052` D9) |

## Git, completion and gates

| 中文 | English | Code / notes |
|---|---|---|
| 统一提交 | unified commit | `src/git.ts`; sessions never commit |
| 提交边界 | commit boundary | `plans/0021` |
| 完成判定 | completion condition | "Committing is the completion condition" |
| driver 提交 | driver commit | Carries the `Auto-Stage:` trailer |
| 门禁 | gate | |
| clean 门禁 | clean gate | Requires a clean worktree before a unit starts |
| 脏区 | dirty area | Uncommitted changes that block the clean gate |
| 基线 | baseline | Unit baseline, SHA baseline (`unitBaseline`) |
| 收口校验 | close-out check | `unitViolations` |
| 嵌套仓库 | nested repository | `Auto-Nested:` trailer |
| 遗留自愈 | carryover | `beginUnit` commits driver state-file leftovers |
| 补提交 | backfill commit | A commit that records work already on disk |
| 回滚 | rollback | Git-level undo of a unit |
| 人工门 | human gate | `plans/0049` |
| 阶段门 | phase gate | `plans/0036` |
| 验收门 | acceptance gate | `Gate: acceptance`, config `acceptanceGate` |

## Recovery and handover

| 中文 | English | Code / notes |
|---|---|---|
| 中断 | interruption | |
| 恢复、续跑 | resume | The act. The mechanism is *recovery* |
| 中断恢复 | interruption recovery | `src/resume.ts`, `src/resume-gate.ts` |
| 恢复保真 | recovery fidelity | `OPENCODE_AUTO_STRICT_RESUME` |
| 进度记录 | progress record | `.auto/progress.json` |
| 测试交接 | test handover | `--handover-test`, `src/exec-session.ts` |
| 会话交接 | session handover | Context limit reached: hint by steer, then a handover document |
| 定版 | freeze | Frozen commit (#1), frozen point, frozen tree |
| 续跑会话 | continuation session | The session that continues after a handover |
| 在途 | in-flight | In-flight record `.auto/handover.json` |
| 断点 | breakpoint | Where recovery resumes |
| 认领 | claim | A session is claimed for reuse |
| 锚点 | anchor | The message a fork starts from |
| 归档 | archive | `testhandoff-<n>.md` |

## Model routing and failures

| 中文 | English | Code / notes |
|---|---|---|
| 模型路由 | model routing | Phase → role → model, `OPENCODE_AUTO_MODEL` |
| 配额 | quota | |
| 降级(配额) | failover | Switch to the next candidate model when quota runs out |
| 降级环 | failover ring | `src/session.ts` |
| 回试 | failback | Return to the preferred model; `/failback`, `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` |
| 回落 | fallback | General "use the next option" (capability fallback, ladder exhaustion) |
| 候选 | candidate | |
| 重试阶梯 | retry ladder | |
| 等待-探测环 | wait-and-probe loop | `awaitRecovery`, `OPENCODE_AUTO_RECOVERY_WAIT` |
| 错误归类 | error classification | overflow / quota / auth / rate / transient |

## Agent domain

| 中文 | English | Code / notes |
|---|---|---|
| 编码 agent | coding agent | opencode or claude, driven by the driver |
| 适配器 | adapter | `src/agent/opencode/`, `src/agent/claude/` |
| 能力 | capability | `AgentCapabilities` |
| 能力降级 | capability degradation | `src/capability.ts` |
| 用量来源 | usage source | `src/usage.ts` |
| 用量档 | usage tier | `events` / `reported` / `estimated` / `none` |
| 权限预设 | permission preset | `PermissionPreset` |

## Configuration, CLI and run-time controls

| 中文 | English | Code / notes |
|---|---|---|
| 宪法性属性 | constitutional option | Fixed by `init` into `.opencode/auto/config.json`; exit 1 at run time |
| 实验开关 | experiment switch | `OPENCODE_AUTO_*`, environment only (`src/switches.ts`) |
| 用法错误 | usage error | Exit 1 |
| 严格失败 | strict failure | Bad config fails loading, no guessing |
| 退出码 | exit code | 0 / 1 / 2 / 130 |
| 人工介入 | human attention | |
| 预检 | preflight | `src/loop-preflight.ts` |
| 空跑 | dryrun | |
| 步进模式 | step mode | `OPENCODE_AUTO_STEP` |
| 安全边界、步进边界 | safe boundary | Phase / task / subtask boundary |
| 优雅退出 | graceful exit | `/exit` |
| 休眠 | hibernate | `OPENCODE_AUTO_HIBERNATE` |
| 休眠窗口 | hibernate window | Daily UTC window |
| 提问策略 | question policy | `OPENCODE_AUTO_ASK` |
| 代答 | proxy answer | `AUTO-RESOLVE`; report section "Proxy-answered questions" |
| 工程裁量 | engineering decision | `AUTO-DECISION` |
| 自动编号 | auto numbering | `--auto-number` |
| 统计 | stats | `.auto/stats.json` |
| 只读保护 | read-only guard | `src/protect.ts` |
| 运行锁 | run lock | Planned, `plans/0052` D12 |
| 生命周期命令 | lifecycle command | `plan` / `close` (planned, `plans/0052`) |
| 配置层 | config layer | What `init` writes and `reset` removes |
| 全量覆盖 | full overwrite | `init` without `--amend`; its baseline read drops retired keys and names them (`loadOverwriteBaseline`, `plans/0052` D4) |
| 已退役键 | retired key | A config key that fails loading strictly: `commit: false`, `verify: true`, a contract-name `agent`, `source`, `destDir` (`RETIRED_KEYS` in `src/config.ts`) |
| 墓碑键名 | tombstone key name | A retired key's name, reserved for good and never reused with a new meaning: `source`, `destDir` (`plans/0052` D3) |
| 先校验后写盘 | validate, then write | `init` finishes every check before its first write (`plans/0052` D7) |
| 增量修订 | amend | Change the named config keys, keep the rest: the `amend` command (`plans/0052` D25); `init --amend` does the same until P3c |
| 配置修复 | config fix | The `fix` command: repair the config layer by rule, never resetting a key (`src/config-fix.ts`, `plans/0052` D10–D11) |
| 可修复 / 需人工 | fixable / manual | The two classes of a config-fix finding: deterministic and meaning-preserving, applied by `fix` / reported only, left to a person (`FixFinding.class`) |
| 强制关闭 | force-close | `close`, `plan --force-close` (planned) |
| 并行编排 | parallel orchestration | Deferred; design in `plans/0036` |
| 声明面 | declaration surface | `--parallel`, `--max-sessions` (`plans/0046`) |
| 调度器 | scheduler | |
| 发号 | id allocation | |
| 真并发 | true concurrency | |

## Design-document vocabulary

| 中文 | English | Code / notes |
|---|---|---|
| 设计件、设计文档 | design document | `plans/NNNN-<slug>.md` |
| 阶段辅助文档 | stage-assist document | Retired once stale, never updated |
| 历史件 | historical record | Kept in its original language |
| 立项 | open (a plan) | |
| 事实基线 | fact baseline | `F1…` |
| 决策 | decision | `D1…` |
| 裁决 | ruling | `U1…`, made by the user |
| 开放问题 | open question | `Q1…` |
| 已发现缺陷 | defect found | `DF1…` |
| 异议 | dissent | |
| 勾选表 | step checklist | |
| 里程碑 | milestone | `M1…` |
| 退役 | retire (adj. retired) | |
| 软退役 | soft retirement | The entry point refuses it; the code path stays |
| 不变量 | invariant | |
| 挂点 | hook point | |
| 接线 | wire (noun: wiring) | |
| 桩 | stub | |
| 冒烟测试 | smoke test | |
| 灰度 | canary | A default-off switch on field trial |
| 现场 | field | Field incident, field audit |
| 事故 | incident | `test/incident-regression.test.ts` |

## Protocol literals

Write these verbatim, in backticks, and never translate or paraphrase them. Stored state and override templates must match them exactly.

- Handover status: `Status: continue` / `Status: done`
- Artifact declaration and subtask `todo.md` headings: `Artifacts:`, `## Scope`, `## Artifacts`
- Task report: `Result: PASS` / `Result: FAIL`
- Phase handover sections: `## Key decisions`, `## Constraints and pitfalls`, `## Required reading for the next phase`, `## Artifact index`
- Unit field block: `Phase: R-NN.P<nn>`, `Depends:`, `Touches:`; custom phase type `Gate: acceptance`
- Knowledge-doc terminator `DONE`; refcheck exemption markers `deleted` / `archived` / `historical`
- Language-neutral: `<!-- auto: eof -->`, `- [ ]` / `- [x]`, `AUTO-RESOLVE:`, `AUTO-DECISION:`, `AUTO-FIXME:`, `[DRIVER]`, `Auto-Stage:` / `Auto-Nested:` trailers
- File and directory names: `todo.md` / `done.md`, `tasks.md`, `phases.md`, `subtasks.md`, `context.md`, `report.md`, `round.md`, `CURRENT.md`, `handoff.md` / `testhandoff-<n>.md`, `.auto/*`, `docs/T-NNN/`, `docs/R-NN/`, `S<nn>`

## Confusable terms

| Pair | Rule |
|---|---|
| handover / handoff | Prose says **handover**. `handoff` survives only in file names and some identifiers (`handoff.md`, `testhandoff-<n>.md`, `handoff-steer.md`, `handoffStatus`). |
| 交接 | Say which one: **phase handover** (between phases), **test handover** (`--handover-test`), **session handover** (context limit). |
| 回退 / 回滚 / 回落 | **revert to pending** (unit status) / **rollback** (git) / **fallback** (next option). |
| 降级 | **failover** for models under quota; **capability degradation** for missing agent capabilities. |
| failover / failback / fallback | Away from the preferred model / back to it / any generic next option. |
| wrap-up / close-out | AI session writing the report / driver checks and commit after it. |
| artifact / deliverable / process document | Anything a unit produces / what the project ships / driver-facing records the deliverable must not reference. |
| unit / task | "Unit" is the generic term; "task" means `T-NNN` only. |
| 阶段 | Always **phase**. "Stage" is not a term (it appears only in `Auto-Stage` and "stage-assist document"). |
| driver / agent / session | Our program / the coding agent it drives (opencode, claude) / one AI conversation with that agent. |
| acceptance / verify, review | **acceptance** is the live term. The completion-side `verify` / `review` / `final-review` are retired (`plans/0044`); do not reintroduce them. |
| 台账 | Only the proxy-answer ledger is live; the phase ledger is retired. |
