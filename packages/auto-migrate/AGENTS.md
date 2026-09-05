# AGENTS.md

面向编码代理的包内说明,保持精简;核心机制文档在 `../auto-core` 包:文件级结构见 [../auto-core/docs/structure.md](../auto-core/docs/structure.md),行为契约见 [../auto-core/docs/behavior.md](../auto-core/docs/behavior.md);本壳的设计基准见 [docs/specialized-tool-design.md](./docs/specialized-tool-design.md)。

## 概述

`@opencode-ai/auto-migrate` 是简易 CLI 外壳(bin `auto-migrate`):无子命令,`src/index.ts` 做参数解析与配置固化/冲突校验后委托 `src/tool.ts` 主编排(前置知识提取 → 现场清理 → 参数推断 → 完整 admtvk 二次迁移,自动推进至结束,中断续跑);前一轮彻底完成后 `--next-path <相对路径>` 一条命令归档旧知识并开启新一轮(设计见 docs/specialized-tool-design.md §9)。全部机制实现在核心库 `@opencode-ai/auto-core`(workspace 依赖,子路径导入)。注释与用户可见文案使用中文。

## 命令(在本包目录运行)

- `bun run dev -- <args>` — 直接以源码运行 CLI。
- `bun run build [--target <平台>]` — 生成独立可执行文件 `dist/auto-migrate`。
- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`(tool 纯函数 + CLI 解析/e2e)。

## 拆包边界

- 本包只含简易壳(`src/index.ts`、`src/tool.ts`)、构建脚本与测试;核心 src、模板与设计文档在 `../auto-core`。
- **核心不知外壳**:不得在本包复制核心逻辑;需求涉及核心扩展点时先改 `../auto-core`(外壳差异经 `setShellProfile` 画像或 `registerTemplate` 注入)。
- 外壳差异经入口处 `setShellProfile({ program, bin, agentRecovery: "startup", auditLog: true })` 注入:报文程序名 `auto-migrate`、agent 契约恢复指引为"重新运行即可"、run 日志始终完整记录(审计语义)。
- `autoNumber` 默认开启(不暴露 CLI 参数;首跑固化 true,旧配置缺键补写,人工显式 false 保留)。

## 构建约定(开发本程序)

- **模板必须保持 `with { type: "file" }` 导入**(经 `@opencode-ai/auto-core/templates/*` 子路径),这是编译时嵌入二进制的唯一方式;infer-source/prior-knowledge 等模板已内置核心,壳层无需 `registerTemplate`。
- `src/templates.d.ts` 为 `*.md` / `*.json` 导入提供路径字符串类型;`tsconfig.json` 里 `resolveJsonModule: false` 勿移除。

## 核心不变量(改动前必读)

见 `../auto-core/AGENTS.md`(退出码、宪法级配置固化、driver 独占状态写入、统一提交、完成判定契约)。

## 本文档维护

保持精简:新机制只在此加一行导航,细节写入 `docs/` 下对应文档。
