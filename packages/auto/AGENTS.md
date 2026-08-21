# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `status` 三个子命令与参数解析。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;verbose 文件变更监视;子任务进度上报。
- `src/runner.ts` — 单任务执行:会话创建、事件监听、提问自动答复、权限阻塞、隐性阻塞检测。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename)。
- `src/prompt.ts` — 会话提示词模板(整任务 / 单子任务 / 收尾三类)。
- `src/server.ts` — opencode server 获取:优先复用已有 server,否则 spawn 并管理其生命周期。
- `src/log.ts` — verbose 模式下为输出加时间戳。
- `templates/` — `init` 复制的模板(`PLAN.md`、`opencode.json`、`.opencode/agent/auto.md`)。
- `script/build.ts` — 独立可执行文件构建脚本。
- `test/` — `bun test` 测试。

## 命令(在本包目录运行)

- `bun run dev -- <args>` — 直接以源码运行 CLI。
- `bun run build [--target <平台>]` — 生成独立可执行文件(见下节)。
- `bun typecheck` — `tsgo --noEmit`。
- `bun test` — 运行 `test/`。

## 构建约定

- 构建走 `script/build.ts`(`Bun.build` + `compile`),产物为 `dist/opencode-auto`;
  带 `--target` 交叉编译时产物加平台后缀(如 `dist/opencode-auto-windows-x64`)。
- **模板必须保持 `with { type: "file" }` 导入**(`src/index.ts` 顶部),这是编译时嵌入
  二进制的唯一方式;不要改回 `new URL("../templates/", import.meta.url)` 读目录,
  否则编译产物里路径会变成 `/$bunfs/...` 导致 `init` 失败。新增模板文件时同步添加
  一条 `type: "file"` 导入并登记到 `init` 的 `templates` 映射。
- `src/templates.d.ts` 为 `*.md` / `*.json` 文件导入提供路径字符串类型;
  `tsconfig.json` 里 `resolveJsonModule: false` 是后者生效的前提,勿移除。

## 行为约定(改动前必读)

- 退出码:`0` 全部完成,`1` 用法/环境错误,`2` 阻塞等待人工介入(问题写入 PLAN.md)。
- 非权限提问自动答复;权限提问或同一问题重复出现则阻塞停机。
- 完成判定只信磁盘:重读 `PLAN.md` 要求 `[done]` 标记(或子任务勾选),verify 由 agent
  自行解释执行,driver 永不重跑。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。
