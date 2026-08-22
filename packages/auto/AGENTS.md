# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `status` 三个子命令与参数解析;`init` 幂等维护 AGENTS.md 的 CURRENT.md 指针块。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;verbose 变更文件监视(基于 git status,含子目录中的嵌套 git 仓库);子任务进度上报。
- `src/runner.ts` — 单任务流水线:分解会话 → 逐子任务会话(driver 亲自执行各项 verify 命令)→ 收尾会话(driver 判定任务级验收,失败追加修复子任务,最多 3 轮);会话链复用、事件监听、提问自动答复、权限等待授权/阻塞、隐性阻塞检测;CURRENT.md 写入。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename);driver 侧状态函数(setSubtasks/tick/appendSubtask/markDone)与 verify 命令提取(subtaskVerify/verifyCommand)。
- `src/prompt.ts` — 会话提示词模板(分解 / 单子任务 / 收尾三类)。
- `src/protect.ts` — 状态文件只读保护:`run` 期间 PLAN.md/CURRENT.md/opencode.json/AGENTS.md
  置 0o444,driver 写入经 allowWrite/reprotect 临时放行,runAll 的 finally 恢复 0o644。
- `src/server.ts` — opencode server 获取:优先复用已有 server,否则 spawn 并管理其生命周期(server 长驻,不随会话重启)。
- `src/log.ts` — verbose 模式下为输出加时间戳;run 时把全部输出同步写入目标目录
  `.auto/logs/run-<时间戳>.log`(writeSync 逐条直写)。
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
- 非权限提问自动答复(--wait-answer 下先等人工 stdin 答复,超时回落自动答复);
  权限提问与 permission.asked 在 --wait-answer 下同样等待人工指令,回答
  allow/yes/y 等视为授权(permission 以 always 放行),超时或其余回答则阻塞停机;
  同一问题重复出现仍阻塞停机。
- **driver 独占状态写入**:PLAN.md 的状态标记、检查项勾选、verified 字段与 CURRENT.md
  全部由 driver 写,agent 会话被禁止编辑这两个文件;`run` 期间这些文件(含 opencode.json、
  AGENTS.md)被 chmod 为只读作为防误写护栏(非安全边界,同用户进程可经 bash chmod 绕过),
  driver 自身写入经 `src/protect.ts` 的 allowWrite/reprotect 临时放行。完成判定不靠
  agent 自报——子任务 verify 命令与任务级验收命令都由 driver 在会话外亲自执行。
- verify 分级:任务 `verify: command: <cmd>` 前缀由 driver 直接执行;自然语言描述由
  收尾会话翻译为 report.md 的 `verified-command` 行后仍由 driver 执行;均无命令时按
  report.md 末行 `结论: 通过|差距` 判定,差距追加修复子任务(最多 3 轮)。
- 任务流水线:正文无检查项时先跑分解会话(产出 docs/T-NNN.subtasks.md,driver 注入
  检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN.report.md。任务内所有会话
  共用一条链:上一会话结束时上下文占比低于 50% 则复用,否则新建;占比由 watch 始终
  跟踪(与 --verbose 无关),拿不到模型上限记 100 即总是新建;瞬时会话错误重试仍强制
  换新会话。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩);AGENTS.md 只含固定指针块,
  driver 永不改写;server 长驻即可,指令文件每个 provider turn 现场重读。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。
