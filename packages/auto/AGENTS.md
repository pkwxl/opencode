# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `status` 三个子命令与参数解析(含 `-p` 短选项);`init` 对 `.opencode/agent/auto.md` 与模板不一致时总是替换,`-p/--prompt` 在初始化后直接调用一次 AI 填充 PLAN.md 供人工审核。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;任务开始横幅;`ensurePointer` 在启动会话前确保 AGENTS.md 指针块存在;run 前完整性检查(.opencode/agent/<agent>.md 缺失直接报错退出并提示 init 恢复,与模板不一致仅警告);`--dryrun` 权限预检;`--commit once` 的整体提交;verbose 变更文件监视(基于 git status,含子目录中的嵌套 git 仓库);子任务进度上报(`--commit subtask` 下)。
- `src/runner.ts` — 单任务流水线:`--subtask auto` 分解会话 → 逐子任务会话(会话结束后 driver 直接勾选,验收不在子任务级进行);`--subtask off` 单会话完成整个任务,未完成回退 pending;`--subtask ondemand` 单会话执行、上下文达到 --context-limit 时 steer 交接提示、新会话从 docs/<id>.handoff.md 续跑;收尾会话 → 任务级旁路独立审核会话验收(off 以外失败追加修复子任务,最多 3 轮);会话链复用、事件监听、提问自动答复、权限等待授权/阻塞(dryrun 下自动拒绝但不中断)、隐性阻塞检测;CURRENT.md 写入;`commitAll` 与 `runOnce` 独立会话。driver 不亲自执行任何 verify 命令。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename);driver 侧状态函数(setSubtasks/tick/appendSubtask/markDone/setStatus)与任务级 verify 命令提取(verifyCommand,仅作提示词参考)。
- `src/prompt.ts` — 会话提示词模板(分解 / 单子任务 / 整任务 / 交接 steer / 收尾 / 审核 / 权限预检 / 整体提交 / 初始化规划);审核判定文件路径 VERDICT_FILE(`.auto/verify.md`);--commit 四档(CommitMode)。
- `src/protect.ts` — 状态文件只读保护:`run` 期间 PLAN.md/CURRENT.md/opencode.json
  置 0o444(AGENTS.md 不在其列,任务可更新它),driver 写入经 allowWrite/reprotect 临时放行,runAll 的 finally 恢复 0o644。
- `src/server.ts` — opencode server 获取:优先复用已有 server,否则 spawn 并管理其生命周期(server 长驻,不随会话重启)。
- `src/log.ts` — verbose 模式下为输出加时间戳;任务/子任务开始横幅(banner/subbanner);run 时把全部输出同步写入目标目录
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

- 退出码:`0` 全部完成,`1` 用法/环境错误(含 run 前 agent 契约文件缺失的完整性检查),`2` 阻塞或未完成为 pending、等待人工介入
  (阻塞问题写入 PLAN.md;pending 回退不写字段),
  `130` 被连续两次 Ctrl+C 强制终止(单次 Ctrl+C 仅提示,3 秒窗口内第二次才退出,
  退出前尽力恢复文件可写并关闭 server)。
- 下发任务失败(UnknownError)的常见根因是目标目录缺少 `.opencode/agent/<agent>.md`
  (服务端错误体不含根因):run 前完整性检查拦截该情况;运行中发生时 driver 在
  阻塞问题后追加恢复提示(检测依赖 Opts.dir,run/init/dryrun/commitAll 均须传入)。
- --commit 四档:`subtask`(缺省;每子任务提交,旧选项 --commit-subtask 为别名,
  `=false` 等价 `--commit task`)/ `task`(仅任务收尾提交)/ `once`(任务期间不提交,
  全部完成后开一次整体提交会话)/ `none`(从不提交)。
- --subtask 三档:`auto`(缺省;分解会话 → 逐子任务)/ `off`(单会话完成整个任务;
  验收差距不追加修复子任务,任务回退 pending 等人工改进)/ `ondemand`(单会话执行,
  watch 在已用量达到 --context-limit 时向进行中会话 steer 交接提示——每会话一次,
  v2 prompt 默认 steer;会话结束按 docs/<id>.handoff.md 末行 `状态: 继续|完成`
  决定续跑或进入收尾,文件缺失带反馈重试一次再按隐性阻塞)。
- --dryrun: 只跑一次权限预检会话(列出授权外目录/操作并逐只读探查),该会话内
  权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复;报告写入
  .auto/dryrun.md 并打印,不执行任何任务。
- 非权限提问自动答复(--wait-answer 下先等人工 stdin 答复,超时回落自动答复);
  权限提问与 permission.asked 在 --wait-answer 下同样等待人工指令,回答
  allow/yes/y 等视为授权(permission 以 always 放行),超时或其余回答则阻塞停机;
  同一问题重复出现仍阻塞停机。--wait-between 在每个任务完成后暂停等待人工
  (回车立即继续,超时自动继续),首个任务前不等待。
- **driver 独占状态写入**:PLAN.md 的状态标记、检查项勾选、verified 字段与 CURRENT.md
  全部由 driver 写,agent 会话被禁止编辑这两个文件;`run` 期间这些文件(含 opencode.json)
  被 chmod 为只读作为防误写护栏(非安全边界,同用户进程可经 bash chmod 绕过),
  driver 自身写入经 `src/protect.ts` 的 allowWrite/reprotect 临时放行。完成判定不靠
  agent 自报——任务级验收由旁路独立审核会话判定,driver 只解析其判定文件;
  子任务会话结束后 driver 按可信勾选(验收统一在任务级进行)。
- verify 审核:driver 不亲自执行任何固定命令;验收只在任务级做一次——收尾会话后
  开一个全新的旁路审核会话(不进会话链),审核者可读代码、运行/调整/补充检查命令
  (任务 `verify: command: <cmd>` 前缀仅作参考),禁止改实现代码;判定写入
  `.auto/verify.md`,driver 解析末行 `结论: 通过|差距` 与可选的 `verified-command:`
  行;判定文件缺失带反馈重试一次仍无则按隐性阻塞;差距追加修复子任务(最多 3 轮)。
- 任务流水线(auto 模式):正文无检查项时先跑分解会话(产出 docs/T-NNN.subtasks.md,
  driver 注入检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN.report.md。
  任务内所有会话共用一条链:上一会话结束时上下文占比低于 50% 且已用量低于
  --context-limit(默认 64k tokens)则复用,否则新建;占比与用量由 watch 始终跟踪
  (与 --verbose 无关),拿不到模型上限时占比记 100 即总是新建;瞬时会话错误重试
  仍强制换新会话。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩);AGENTS.md 只含固定指针块,
  不再置只读(任务可更新其余内容),driver 在 `run`/`init` 启动会话前确保指针块
  存在、缺失则追加,此外永不改写;server 长驻即可,指令文件每个 provider turn 现场重读。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。
