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
- 任务流水线/会话链 → `src/runner.ts`;阶段循环 → `src/loop.ts` + `src/phases.ts`(设计: docs/phases-design.md)
- fork 分解(理解→分解→执行三段式、分叉基点、OPENCODE_AUTO_* 实验开关)→ `src/runner.ts` + `src/switches.ts`(设计: docs/fork-decompose-design.md)
- 步进模式(OPENCODE_AUTO_STEP 环境变量:phase/task/subtask 包含式边界硬暂停)→ `src/step.ts`(设计: docs/step-mode-design.md)
- 验收/审核 → `src/verify.ts` + `docs/verify-review-design.md`;终审闭环 → `src/final.ts` + `docs/mode-final-review-design.md`
- 提示词文案 → 只动 `templates/prompts/*.md`(`src/prompt.ts` 只做数据组装),改后跑 `bun test test/prompt.test.ts`
- 统一提交 → `src/git.ts`;中断恢复 → `src/resume.ts`;模式 → `templates/modes/` + `src/mode.ts`
- 自动编号(--auto-number)→ `src/numbering.ts`(记录 .auto/next-task、缺失时 AI 恢复会话)+ `templates/prompts/number-recovery.md`
- 外壳画像(报文程序名/契约恢复指引/日志审计语义参数化)→ `src/shell.ts`
- 稳定引用与文件存放规范(docs/T-NNN/ 目录化、docs 永不移动、handovers/ 永久化、引用一致性三层检查)→ docs/stable-refs-design.md(设计定稿 2026-09-06,P1..P4 已全部实施;路径构造/读回落在 src/docpaths.ts,引用提取/校验/改写/门禁在 src/refcheck.ts)
- refcheck 范围收敛与恢复(OPENCODE_AUTO_REF_CHECK 开关默认关、git 历史恢复缺失引用、行号锚 @sha 版本标记、摒弃移动文件适配)→ docs/refcheck-scope-design.md(2026-09-08 定稿;**P1 已实施**:开关 + 三层挂点管控 + migrateLegacyDocs/fix-docs 退役,P2/P3 未实施)
- 核心/外壳边界、合入流程、新壳接入 → docs/shell-contract.md
- 完整文件清单与机制细节 → docs/structure.md、docs/behavior.md

## 核心不变量(改动前必读)

开发本程序(代码层面约定):

- 目标目录 `PLAN.md` 的解析规则(src/plan.ts):字段行(`  - key: value`)必须紧跟任务标题且连续;改解析规则同步 `test/plan.test.ts` 与壳包 README 格式说明。
- 运行时依赖外部 `opencode` CLI(spawn `opencode serve`)或 `--server` 复用已有实例;二进制自身不含 opencode。

设计本程序功能(行为契约,施加于目标目录,实现不得破坏):

- 退出码:`0` 完成 / `1` 用法或环境错误 / `2` 阻塞或回退 pending 待人工 / `130` 连续两次 Ctrl+C 强退。
- 宪法级项目属性(-m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir)仅 init 固化到目标目录 `.opencode/auto/config.json`,run 出现即退出码 1;配置坏文件严格失败,未知键忽略。
- **driver 独占状态写入**:目标目录 PLAN.md/CURRENT.md 与 verified 字段全由 driver 写,AI 会话禁止编辑;`run` 期间这些状态文件只读(src/protect.ts 放行 driver 写入)。
- **统一提交**:AI 会话不得执行提交类命令;会话结束后由 driver 经 src/git.ts 递归提交目标目录全部改动(先嵌套子仓库后本仓库)。
- 完成判定不靠 agent 自报:verify 启用时 driver 执行脚本、独立判定会话下结论;子任务由 driver 勾选。
- **独立判定会话不 fork**:verify-judge/review/review-fix/final 系会话全新创建,不继承执行上下文(独立判断是完成判定的基石,见 fork-decompose-design.md §9)。
- **实验开关只读环境、不落盘**:`OPENCODE_AUTO_*` 环境变量层(src/switches.ts 核心内解析、CLI 壳零改动)不写任何状态文件,实验语义 = 本次运行;宪法键转正前不进 ProjectConfig。

## 本文档维护

保持精简:新机制只在此加一行导航或不变量,细节写入 `docs/` 下对应文档。
