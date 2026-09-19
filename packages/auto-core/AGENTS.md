# AGENTS.md

面向编码代理的包内说明,保持精简:模块→职责→关键文件的逐文件索引见 [docs/structure.md](./docs/structure.md),程序对目标目录的行为契约见 [docs/behavior.md](./docs/behavior.md),核心/外壳契约见 [docs/shell-contract.md](./docs/shell-contract.md);CLI 外壳见 `../auto` 包。

## 概述

`@opencode-ai/auto-core` 是 auto 工具族的核心库(无 bin):任务流水线、阶段循环、验收/审核、提示词模板、配置、自动编号、中断恢复、统一提交等机制集中于此,经子路径导出(`@opencode-ai/auto-core/<模块>`)供外壳包消费。注释与用户可见文案使用中文。

注意区分两类认知:`PLAN.md`/`CURRENT.md`/`.opencode/auto/config.json`/`docs/agents/` 等是程序运行时施加于**目标目录**的规范对象,并非本仓库自身的文件约定。

## 文档体制(两层制)

- **代码与注释是设计的第一载体**:结构、不变量、决策理由随代码走。
- `plans/NNNN-<slug>.md` — 编号化设计/计划文档历史(按 git 首提交日期排序):阶段辅助型,只在特定阶段辅助开发,**过期即退役,不随后续改动对齐维护**,原文保留不回译。
- `docs/` — 只留不易变的整体架构、设计原则与代码定位索引(当前为 shell-contract / behavior / structure 三件),对其更新须有充分理由。
- 本文件只记高频不变量 + 指针;机制详述归 plans/ 编号件。

## 命令(在本包目录运行)

- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`。

## 构建约定(开发本程序)

- **模板必须保持 `with { type: "file" }` 导入**,这是壳包编译时嵌入二进制的唯一方式;新增内置模板时同步登记:提示词模板 → `src/template.ts` 的 embedded 注册表(外壳附加模板改经 `registerTemplate`),模式模板 → `src/mode.ts`,init 复制模板由壳层登记。
- `src/templates.d.ts` 为 `*.md` / `*.json` 导入提供路径字符串类型;`tsconfig.json` 里 `resolveJsonModule: false` 勿移除。
- 外壳经 `package.json` 的 `exports`(`"./*": "./src/*.ts"`、`"./templates/*"`)直接引用本包 TS 源与模板文件,新增 src 文件无需登记 exports;**核心不知外壳**(不得反向 import 任何壳包),外壳差异一律经 `src/shell.ts` 画像或参数注入。

## 核心/外壳契约

本包为核心,壳包(`packages/auto` 通用 CLI/bin `opencode-auto`,及各壳分支的简易壳 `packages/<name>`,包名与 bin 由各壳自行命名、核心不记录)经子路径单向依赖本包;**壳分支不得改本包**,差异经 `setShellProfile`/`registerTemplate`/参数透传注入。分支模型(核心改动只落 auto-core 分支、壳分支定期 merge auto-core 刷新快照、auto 为集成分支)与新壳接入清单见 [docs/shell-contract.md](./docs/shell-contract.md)。

## 导航(按改动定位;NNNN = plans/NNNN-\*.md 编号件)

- 项目配置 → `src/config.ts`(0004)
- 任务流水线 → `src/runner.ts` + `src/execute.ts`;会话驱动 → `src/chain.ts` → `src/session.ts` → `src/attempt.ts` → `src/watch.ts`;旁路会话骨架 → `src/artifact.ts`;阶段循环 → `src/loop.ts` + `src/loop-task.ts` + `src/loop-phase.ts` + `src/phases.ts`(0006);运行前预检 → `src/loop-preflight.ts`
- fork 分解与实验开关 → `src/execute.ts` + `src/session.ts` ensureForkBase + `src/session-api.ts` + `src/switches.ts`(0003)
- 步进模式(OPENCODE_AUTO_STEP)→ `src/step.ts`(0012);`/exit` 优雅退出 → `src/exit.ts`(0014)
- 休眠时段(OPENCODE_AUTO_HIBERNATE)→ `src/hibernate.ts` + `src/switches.ts`(0027)
- 验收/审核 → `src/review.ts` + `src/verify.ts`(0009);终审闭环 → `src/final.ts`(0005)
- 提示词文案 → 只动 `templates/prompts/*.md`(`src/prompt.ts` 只做数据组装),改后跑 `bun test test/prompt-exec.test.ts test/prompt-verify.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts`
- 测试交接前置化(--handover-test)→ `src/testrun.ts` + `src/watch.ts` handleIdleTest + `src/exec-session.ts` + `src/git.ts` trackedSourceChanges(0023)
- 统一提交与单元提交边界 → `src/git.ts` + `src/unit-commit.ts` + `src/artifact.ts` spec.unitStart(0021);中断恢复与单元归属门禁 → `src/resume.ts` + `src/resume-gate.ts`(0018;恢复保真 OPENCODE_AUTO_STRICT_RESUME 见 0022)
- 自动编号(--auto-number)→ `src/numbering.ts`(0001)
- 死循环检测(OPENCODE_AUTO_STUCK)→ `src/stuck.ts`(0016)
- 阶段化模型路由与配额降级(OPENCODE_AUTO_MODEL/_FALLBACK//failback)→ `src/switches.ts` parseModelPolicy + `src/chain.ts` + `src/session.ts` 降级环 + `src/failback.ts`(0017)
- 会话故障等待-探测环(OPENCODE_AUTO_RECOVERY_WAIT)→ `src/session.ts` awaitRecovery(0015)
- 失联探针、输出截断续跑、形检重提示 fork → `src/watch.ts` + `src/session-api.ts` probeSession/forkEndedSession(0026)
- 跨中断累计统计 → `src/stats.ts` + `src/conclusion.ts` + `src/loop-progress.ts`(0019)
- 提问策略与代答审计(OPENCODE_AUTO_ASK、AUTO-RESOLVE/AUTO-DECISION)→ `src/resolve.ts` + `templates/prompts/_partials.md` question-rule(0020)
- 外壳画像 → `src/shell.ts`
- 稳定引用、轮次专用目录(docs/R-NN)与引用检查 → `src/docpaths.ts` + `src/refcheck.ts`(0010;refcheck 范围收敛见 0013)
- 模块拆分与依赖方向(下层不得反向 import runner;testrun 不得反向 import 会话驱动层)→ 0024 §D.2
- 完整文件清单与机制细节 → docs/structure.md、docs/behavior.md

## 核心不变量(改动前必读)

开发本程序(代码层面约定):

- 目标目录 `PLAN.md` 的解析规则(src/plan.ts):字段行(`  - key: value`)必须紧跟任务标题且连续;改解析规则同步 `test/plan.test.ts` 与壳包 README 格式说明。
- 运行时依赖外部 `opencode` CLI(spawn `opencode serve`)或 `--server` 复用已有实例;二进制自身不含 opencode。

设计本程序功能(行为契约,施加于目标目录,实现不得破坏):

- 退出码:`0` 完成 / `1` 用法或环境错误 / `2` 阻塞或回退 pending 待人工 / `130` 连续两次 Ctrl+C 强退。
- 宪法级项目属性(-m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir)仅 init 固化到目标目录 `.opencode/auto/config.json`,run 出现即退出码 1;配置坏文件严格失败,未知键忽略。**提交不可关闭**:`--commit false`(及旧别名 none)与配置 `commit: false` 已于 2026-09-15 退役(plans/0021 D7),出现即用法错误/严格失败——提交是完成条件,门禁只在 dryrun 与非 git 环境不生效。
- **driver 独占状态写入**:目标目录 PLAN.md/CURRENT.md 与 verified 字段全由 driver 写,AI 会话禁止编辑;`run` 期间这些状态文件只读(src/protect.ts 放行 driver 写入)。
- **统一提交**:AI 会话不得执行提交类命令;会话结束后由 driver 经 src/git.ts 递归提交目标目录全部改动(先嵌套子仓库后本仓库)。**提交是完成条件**(plans/0021):统一提交失败 → 阻塞停机待人工;执行单元(任务/子任务/独立隐藏任务)启动要求工作区 clean(PLAN.md/CURRENT.md 遗留自愈,其余脏区 dirty 交人工,run 启动同口径),收口经 SHA 基线校验提交区间内只有 driver 提交(Auto-Stage trailer);恢复续跑豁免 clean 检查。
- 完成判定不靠 agent 自报:verify 启用时 driver 执行脚本、独立判定会话下结论;子任务由 driver 勾选;隐藏任务产物落盘且已提交才算完成(③ 补提交/④ dirty,git.ts commitPending/beginUnit)。
- **独立判定会话不 fork**:verify-judge/review/review-fix/final 系会话全新创建,不继承执行上下文(独立判断是完成判定的基石,见 plans/0003 §9)。
- **实验开关只读环境、不落盘**:`OPENCODE_AUTO_*` 环境变量层(src/switches.ts 核心内解析、CLI 壳零改动)不写任何状态文件,实验语义 = 本次运行;宪法键转正前不进 ProjectConfig。

## 本文档维护

保持精简:新机制只在此加一行导航(带 plans/ 编号指针)或不变量;机制详述写入 plans/ 新编号件,docs/ 三保留件仅在有充分理由时更新。
