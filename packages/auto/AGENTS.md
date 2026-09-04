# AGENTS.md

面向编码代理的包内说明,保持精简:文件级结构细节见 [docs/structure.md](./docs/structure.md),程序对目标目录的行为契约见 [docs/behavior.md](./docs/behavior.md),设计基准见 `docs/` 下各设计文档;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取**目标目录**的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

注意区分两类认知:`PLAN.md`/`CURRENT.md`/`.opencode/auto/config.json`/`docs/agents/` 等是本程序运行时施加于**目标目录**的规范对象(本仓库仅是曾作为目标被驱动过),并非本仓库自身的文件约定;本仓库自身的文档直接放在 `docs/` 下。

## 命令(在本包目录运行)

- `bun run dev -- <args>` — 直接以源码运行 CLI。
- `bun run build [--target <平台>]` — 生成独立可执行文件 `dist/opencode-auto`。
- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`。

## 构建约定(开发本程序)

- **模板必须保持 `with { type: "file" }` 导入**,这是编译时嵌入二进制的唯一方式;新增内置模板时同步登记:init 复制模板 → `src/index.ts` 的 `templates` 映射,提示词模板 → `src/template.ts` 的 embedded 注册表,模式模板 → `src/mode.ts`。
- `src/templates.d.ts` 为 `*.md` / `*.json` 导入提供路径字符串类型;`tsconfig.json` 里 `resolveJsonModule: false` 勿移除。

## 导航(按改动定位)

- CLI 参数/子命令 → `src/index.ts`;项目配置 → `src/config.ts`(设计: docs/init-config-agents-design.md)
- 任务流水线/会话链 → `src/runner.ts`;阶段循环 → `src/loop.ts` + `src/phases.ts`(设计: docs/phases-design.md)
- 验收/审核 → `src/verify.ts` + `docs/verify-review-design.md`;终审闭环 → `src/final.ts` + `docs/mode-final-review-design.md`
- 提示词文案 → 只动 `templates/prompts/*.md`(`src/prompt.ts` 只做数据组装),改后跑 `bun test test/prompt.test.ts`
- 统一提交 → `src/git.ts`;中断恢复 → `src/resume.ts`;模式 → `templates/modes/` + `src/mode.ts`
- 自动编号(--auto-number)→ `src/numbering.ts`(记录 .auto/next-task、缺失时 AI 恢复会话)+ `templates/prompts/number-recovery.md`
- 完整文件清单与机制细节 → docs/structure.md、docs/behavior.md

## 核心不变量(改动前必读)

开发本程序(代码层面约定):

- 目标目录 `PLAN.md` 的解析规则(src/plan.ts):字段行(`  - key: value`)必须紧跟任务标题且连续;改解析规则同步 `test/plan.test.ts` 与 README 格式说明。
- 运行时依赖外部 `opencode` CLI(spawn `opencode serve`)或 `--server` 复用已有实例;二进制自身不含 opencode。

设计本程序功能(行为契约,施加于目标目录,实现不得破坏):

- 退出码:`0` 完成 / `1` 用法或环境错误 / `2` 阻塞或回退 pending 待人工 / `130` 连续两次 Ctrl+C 强退。
- 宪法级项目属性(-m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--test-by-driver/--handover-test/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir)仅 init 固化到目标目录 `.opencode/auto/config.json`,run 出现即退出码 1;配置坏文件严格失败,未知键忽略。
- **driver 独占状态写入**:目标目录 PLAN.md/CURRENT.md 与 verified 字段全由 driver 写,AI 会话禁止编辑;`run` 期间这些状态文件只读(src/protect.ts 放行 driver 写入)。
- **统一提交**:AI 会话不得执行提交类命令;会话结束后由 driver 经 src/git.ts 递归提交目标目录全部改动(先嵌套子仓库后本仓库)。
- 完成判定不靠 agent 自报:verify 启用时 driver 执行脚本、独立判定会话下结论;子任务由 driver 勾选。

## 本文档维护

保持精简:新机制只在此加一行导航或不变量,细节写入 `docs/` 下对应文档。
