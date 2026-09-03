# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md),机制细节见「设计文档」节。

## 概述

`@opencode-ai/auto` 是私有 CLI(`opencode-auto`)——**专用二次迁移工具**:无子命令,`opencode-auto [dir]` 直接执行主程序,自动推进一轮完整 admtvk(分析→设计→迁移实现→测试→验收→知识提炼),中断后依推导式状态从断点续跑,全部完成后重跑报告完成并退出 0。通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode。注释与用户可见文案使用中文。

三条贯穿全局的设计取向,改动前先对齐:

- **执行权在 driver,不在会话**:验收(验证脚本)、测试执行(编译/测试/构建/lint)、提交、状态写入全部由 driver 在会话外完成;AI 会话只做实现与写文档。
- **状态是推导出来的**:阶段进度由 `docs/phases.md` 台账 + `PLAN.md` 推导,轮次由 `docs/phases/round-<N>/` 推导,不新增持久化状态机;各环节幂等,任何一步中断后重跑都能接上。
- **配置是唯一事实源**:关键参数首跑固化进 `.opencode/auto/config.json`,人工修订也走该文件(运行期间只读)。

## 结构

### 源码(src/)

| 文件 | 职责 |
| --- | --- |
| `index.ts` | CLI 入口:选项解析与校验、参数分类(固化 / 每次生效)、用法与拦截报文;只装配不含流程 |
| `tool.ts` | 主编排 `runTool`:模板维护 → 完成标记短路 → 归档上一轮 → 前置知识提取 → 参数推断 → 阶段化主循环;server 生命周期在此 |
| `loop.ts` | 阶段循环与任务循环:AGENTS.md 标记块与 .gitignore 维护、阶段路由、规划与交接等旁路会话 |
| `runner.ts` | 单任务流水线:分解 → 执行 → 收尾 → 验收 → 审核;会话链复用、权限与提问应答、进度记忆、隐性阻塞 |
| `phases.ts` | admtvk 阶段注册表、台账读写、`routePhase` 纯路由、归档与交接文档协议、轮次推导 |
| `plan.ts` | `PLAN.md` 解析与原子编辑(driver 侧状态函数与任务追加) |
| `verify.ts` | 验证脚本的准备与执行、输出落盘、进度看门狗(纯逻辑,不依赖 SDK) |
| `git.ts` | 统一提交:嵌套仓库发现、标题短标签与 trailer、单仓库失败仅警告 |
| `config.ts` | 项目配置层:schema、读写与合并、缺省与 legacy 回落、启动摘要 |
| `mode.ts` | `-m/--mode` 模式层:模式文件协议、内置与目标目录合并的注册表 |
| `prompt.ts` | 提示词上下文组装:把任务与运行参数装配成模板变量,不放文案 |
| `template.ts` | 提示词模板装载与渲染:内嵌 + 目标目录同名覆盖、协议敏感模板校验 |
| `resume.ts` | `.auto/progress.json` 进度记录,支撑中断复用原会话与阶段级重入 |
| `final.ts` | `--final-review` 终审闭环:报告末行协议解析、路由与终审任务追加 |
| `knowledge.ts` | k 阶段知识提炼(`docs/migration-kb`)与前置知识提取(`docs/prior-kb`) |
| `interactive.ts` | `--interactive` 旁路:readline 输入注入当前活动会话 |
| `server.ts` | opencode server 托管、client Proxy、AGENTS.md 指纹变更重启、网络故障换新实例 |
| `protect.ts` | 状态文件只读护栏与 driver 自身写入的临时放行 |
| `log.ts` | 终端与日志双通道输出,运行日志落 `.auto/logs/` |

### 模板(templates/)

- 主程序每次运行幂等维护进目标目录的:`PLAN.scaffold.md`、`opencode.json`、`.opencode/agent/auto.md`。
- `templates/prompts/`:各会话提示词(共享片段 `_partials.md`),编译期嵌入、运行期渲染,不复制进目标目录。
- `templates/modes/`:内置模式文件。
- 用户自定义走目标目录同名覆盖(`.opencode/auto/prompts/`、`.opencode/auto/modes/`),新增模式与提示词覆盖都不改源码。

### 设计文档(docs/)

机制的权威基准在这里,不要把细节抄回本文件:

- `specialized-tool-design.md` — **CLI 面与总体流程的最新基准**(supersedes 其余文档中 init/continue/run/check/status 的 CLI 表述)。
- `phases-design.md` — 阶段化流程、台账推导式状态、交接协议、续轮迁移。
- `verify-review-design.md` — verify 三段式与 `--review`/`--early` 审核循环。
- `mode-final-review-design.md` — 模式层与终审闭环状态机。
- `init-config-agents-design.md` — 配置固化与 AGENTS.md 维护规则块。
- `fixme-knowledge-design.md` — 仅知识沉淀部分已实现(并入 k 阶段);`--track-fixme` 未实现,CLI 不接受该选项。

## 命令(在本包目录运行)

- `bun run dev -- <args>` — 以源码运行 CLI。
- `bun run build [--target <平台>]` — 生成独立可执行文件。
- `bun typecheck` / `bun test` — 类型检查与测试(测试不得从仓库根运行)。

## 构建约定

- 构建走 `script/build.ts`(`Bun.build` + `compile`),产物 `dist/opencode-auto`;交叉编译加平台后缀。
- **模板导入必须保持 `with { type: "file" }`**——这是嵌入二进制的唯一方式;改回 `new URL(...)` 读目录会让编译产物里的路径变成 `/$bunfs/...` 而导致模板维护失败。新增内置模板文件时同步在对应登记处加一条导入(`src/tool.ts` 顶部、`src/phases.ts`、`src/template.ts` 的 embedded 注册表、`src/mode.ts`)。
- `src/templates.d.ts` 为 `*.md`/`*.json` 文件导入提供类型;`tsconfig.json` 的 `resolveJsonModule: false` 是它生效的前提,勿移除。

## 行为约定(改动前必读)

- 退出码:`0` 全部完成(或完成标记 `.auto/tool.json` 短路);`1` 用法/环境错误(旧子命令名、拦截选项、非法取值、与固化值冲突、配置或台账非法、agent 契约缺失);`2` 阻塞或未完成待人工;`130` 连续两次 Ctrl+C。
- 参数分类判据:改它需同时改 AGENTS.md/PLAN/契约表述,或描述模型与项目属性 → 关键参数(首跑固化,二次冲突即退出 1);只描述本次怎么跑、人怎么盯 → 运行参数(每次生效,不固化)。
- **driver 独占状态写入**:`PLAN.md`/`CURRENT.md`/`opencode.json`/配置文件运行期置只读,driver 自身写入经 `allowWrite`;完成判定不靠 agent 自报。唯一例外是验证判定会话被授权更新后续未完成任务的 `verify` 字段,越权编辑整体还原。
- **统一提交**:会话结束且状态写入后由 `commitTree` 递归提交(先嵌套子仓库后本仓库),标题为 `<任务号> <label> <简述>` 加 `Auto-Task`/`Auto-Stage` trailer;任何会话不执行提交类命令;`--dryrun` 不提交;单仓库失败仅警告。
- **执行权下沉的三处体现**(验证原则块、测试执行原则块、提交原则块)都由 `ensurePointer` 按开关幂等补写/移除;对应开关未启用时提示词、模板与 AGENTS.md 都不得出现该机制的描述。细节见 `verify-review-design.md` 与 `--test-by-driver` 相关实现。
- 提示词文案只改 `templates/prompts/*.md`,`src/prompt.ts` 只做数据组装;协议敏感模板被目标目录覆盖时校验关键协议行,缺失即退出 1;改完必须跑 `test/prompt.test.ts` 防协议行漂移。
- `PLAN.md` 的字段行(`  - key: value`)必须紧跟任务标题且连续;改解析规则要同步 `test/plan.test.ts` 与 README 的格式说明。
- 模式层与终审都是提示词级的场景引导 + driver 侧纯路由,不改变既有调度状态机。
- 运行时依赖外部 `opencode` CLI(spawn `opencode serve`),或经 `--server`/`OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。
- 本文件是工作流入口而非知识库:受下方维护规则块约束(≤150 行、细节路由到 `docs/`、更新不追加、只沉淀持久知识)。

## AGENTS.md 维护规则(本文件是项目概览入口):
1. 保持精简: 全文不超过 150 行;不写入实现细节、长解释、命令输出或单任务知识。
2. 路由不复制: 模块/设计/文档特定的信息写入 docs/<主题>.md,本文件只保留
   一行路由条目(主题 → 路径)。
4. 只沉淀持久的项目知识。
