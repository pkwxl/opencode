# 核心/外壳契约(拆包边界与合入流程)

> AGENTS.md 只保留导航;核心/外壳的边界、依赖方向、差异注入扩展点、分支合入流程与新壳接入清单集中在本文件。物理拆包(阶段二)起生效,后续新外壳分支按本文件接入。

## A. 边界

| 包 | 角色 | 内容 |
|---|---|---|
| `packages/auto-core`(`@opencode-ai/auto-core`,无 bin) | **核心** | 机制(runner/loop/resume/numbering/phases/plan/verify/final/git/protect/config/server/mode/prompt/template/knowledge/interactive/log/shell/check)+ 内置模板(`templates/`)+ 设计文档(`docs/`) |
| `packages/auto`(`@opencode-ai/auto`,bin `opencode-auto`) | 通用 CLI 壳 | init/continue/run/check/status 子命令版 `src/index.ts`、构建脚本、CLI 解析/e2e 测试 |
| `packages/auto-migrate`(`@opencode-ai/auto-migrate`,bin `opencode-migrate`) | 简易 CLI 壳 | 无子命令 `src/index.ts` + `src/tool.ts` 主编排(autoNumber 默认 true 固化)、构建脚本、测试 |

判断口径:会话流水线、状态文件协议、提示词渲染、验收/提交机制属于**核心**;CLI 形态(子命令与否、用法文本、参数解析与配置固化策略、构建产物命名)属于**壳**。

## B. 单向依赖

- 壳 import `@opencode-ai/auto-core/*`(核心 `package.json` 的 `exports`:`"./*": "./src/*.ts"`、`"./templates/*": "./templates/*"`);模板经 `@opencode-ai/auto-core/templates/<file>` 子路径 `with { type: "file" }` 导入(编译期嵌入二进制)。
- **核心不知外壳**:packages/auto-core 不得 import 任何壳包;缺省行为 = 通用壳现状,不设置画像时核心报文与历史行为逐字节一致。
- **壳间互不依赖**:auto 与 auto-migrate 互不 import,只共享核心。
- 壳包必须自带 `src/templates.d.ts` shim(`*.md`/`*.json` 导入的路径字符串类型,缺则跨包模板 import 全红);`tsconfig.json` 的 `resolveJsonModule: false` 勿移除。

## C. 差异注入(壳层扩展点)

外壳差异一律经以下扩展点注入,**壳分支不得改 packages/auto-core**;核心需求先到 auto-core 分支加扩展点:

1. `setShellProfile`(src/shell.ts):报文程序名(program/bin)、agent 契约缺失恢复指引(agentRecovery: `"init"`|"startup"`)、日志审计语义(auditLog);壳层入口启动时设置一次。例:migrate 壳 `{ program: "opencode-migrate", bin: "opencode-migrate", agentRecovery: "startup", auditLog: true }`。
2. `registerTemplate`(src/template.ts):登记附加提示词模板与协议标记(markers),优先于内置、目标目录覆盖最高;`_partials` 拒绝注册。
3. 参数透传:壳层 CLI 解析结果经 runAll Opts / runTool 入参传入(newSession、managed server 句柄、verify/testByDriver 等既有开关)。

## D. 分支与合入流程

| 分支 | 职责 |
|---|---|
| `auto-core` | 核心开发分支(packages/auto-core + packages/auto 通用壳;通用壳随核心分支演进) |
| `migrate` | 简易壳开发分支(auto-core 快照 + packages/auto + packages/auto-migrate) |
| `auto` | 集成分支(三包并存;发布/tag 以 auto 为准) |

- **核心改动只落 auto-core 分支**;migrate 壳改动落 migrate 分支。
- 壳分支定期 `git merge auto-core` 刷新核心快照——packages/auto 两侧恒等(均取 auto-core 侧),按构造无冲突。
- 兼容后 merge 进 `auto` 集成分支;发布与 tag 以 auto 分支为准。

## E. 新壳接入清单

新建 `packages/<name>`(bin 独立命名),以 packages/auto-migrate 为参照:

1. `package.json`:name `@opencode-ai/<name>`、bin `<独立名>`、`dependencies: { "@opencode-ai/auto-core": "workspace:*" }`(壳若无 sdk 直接 import 则不加)、typecheck/test/build scripts。
2. 入口 `setShellProfile({ program, bin, agentRecovery, auditLog })` 设置外壳画像。
3. 自带 `src/templates.d.ts` shim 与 `tsconfig.json`(复制壳包版)。
4. 自带 `script/build.ts`(产物 `dist/<bin>`);模板保持 `with { type: "file" }` 跨包导入。
5. 附加提示词模板经 `registerTemplate` 登记(协议敏感模板提供 markers)。
6. 根目录 `bun install` 刷新 lock;测试在包目录运行(仓库根目录不能跑测试)。
