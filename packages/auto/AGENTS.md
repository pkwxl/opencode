# AGENTS.md

面向编码代理的包内说明,保持精简;核心机制文档在 `../auto-core` 包:文件级结构见 [../auto-core/docs/structure.md](../auto-core/docs/structure.md),行为契约见 [../auto-core/docs/behavior.md](../auto-core/docs/behavior.md),设计基准见 `../auto-core/docs/` 下各设计文档,核心/外壳契约(边界/依赖方向/合入流程)见 [../auto-core/docs/shell-contract.md](../auto-core/docs/shell-contract.md);用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是通用 CLI 外壳(bin `opencode-auto`):init/continue/run/check/status 五个子命令与参数解析集中在 `src/index.ts`,全部机制实现在核心库 `@opencode-ai/auto-core`(workspace 依赖,子路径导入,经 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行)。注释与用户可见文案使用中文。

## 命令(在本包目录运行)

- `bun run dev -- <args>` — 直接以源码运行 CLI。
- `bun run build [--target <平台>]` — 生成独立可执行文件 `dist/opencode-auto`。
- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`(CLI 解析/e2e)。

## 拆包边界

- 本包只含 CLI 外壳(`src/index.ts`)、构建脚本与 e2e 测试;核心 src、模板与设计文档在 `../auto-core`。
- **核心不知外壳**:不得在本包复制核心逻辑;需求涉及核心扩展点时先改 `../auto-core`(外壳差异经 `setShellProfile` 画像或 `registerTemplate` 注入)。

## 构建约定(开发本程序)

- **模板必须保持 `with { type: "file" }` 导入**(经 `@opencode-ai/auto-core/templates/*` 子路径),这是编译时嵌入二进制的唯一方式;新增 init 复制模板 → `src/index.ts` 的 `templates` 映射,提示词/模式模板 → 改在 `../auto-core` 包。
- `src/templates.d.ts` 为 `*.md` / `*.json` 导入提供路径字符串类型;`tsconfig.json` 里 `resolveJsonModule: false` 勿移除。

## 核心不变量(改动前必读)

见 `../auto-core/AGENTS.md`(退出码、宪法级配置固化、driver 独占状态写入、统一提交、完成判定契约;其中 PLAN.md 解析规则改动需同步本包 e2e 与 README 格式说明)。

## 本文档维护

保持精简:新机制只在此加一行导航,细节写入 `../auto-core/docs/` 下对应文档。
