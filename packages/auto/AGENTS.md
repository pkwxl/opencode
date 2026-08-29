# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `status` 三个子命令与参数解析(含 `-p`/`-i` 短选项;`--review` 经 parseReviewLimit 校验——缺省 0 不启用、裸选项 3、显式值须为 1..10 整数);`init` 对 `.opencode/agent/auto.md` 与模板不一致时总是替换,`-p/--prompt` 在初始化后直接调用一次 AI 填充 PLAN.md 供人工审核;`--interactive` 与 `--verbose` 互斥检查在此。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;启动时 `resetInProgress` 把上次运行中断遗留的 in_progress 重置为 pending(中断恢复);任务开始横幅;`ensurePointer` 在启动会话前确保 AGENTS.md 指针块存在;run 前完整性检查(.opencode/agent/<agent>.md 缺失直接报错退出并提示 init 恢复,与模板不一致仅警告);`--dryrun` 权限预检;`--commit once` 的整体提交;verbose 变更文件监视(基于 git status,含子目录中的嵌套 git 仓库);子任务进度上报(`--commit subtask` 下);`--review` 透传至 runTask;`--interactive` 旁路控制器的创建/回收与 waitBetween 接入。
- `src/interactive.ts` — `--interactive` 旁路:常驻 readline 把回车输入经 promptAsync(fire-and-forget)注入当前活动会话(attach 由 runner 在每个会话建立/复用时调用;无活动会话丢弃并提示);ask/任务间暂停的人工等待经同一输入行接收(空行原样上交给调用方解释);stdin 关闭后回落非交互行为;io 可注入供测试。
- `src/runner.ts` — 单任务流水线:`--subtask auto` 分解会话 → 逐子任务会话(会话结束后 driver 直接勾选,验收不在子任务级进行);`--subtask off` 单会话完成整个任务,验收/审核差距不做修复重跑,任务回退 pending;`--subtask ondemand` 单会话执行、上下文达到 --context-limit 时 steer 交接提示、新会话从 docs/<id>.handoff.md 续跑;收尾会话 → verifyTask 三段式验收(脚本准备 → driver 执行 → 独立判定会话;差距反馈回执行会话修复,最多 3 轮,off 模式直接回退 pending)→ `--review` 下 reviewTask 质量审核与 planReviewFix 修复规划(外层轮循环,执行阶段仅首轮进入);旁路会话产物缺失"带反馈重试一次再隐性阻塞"的骨架统一在 requireArtifact;会话链复用、事件监听、提问自动答复、权限请求等待授权(明确非授权回答拒绝后继续,超时阻塞;dryrun 下自动拒绝但不中断)、隐性阻塞检测;CURRENT.md 在任务开始时即写入(中断遗留缺失/过期时重建),每次勾选后刷新;`commitAll` 与 `runOnce` 独立会话;verbose 明细走 vlog,askHuman 在 interactive 下改由旁路输入行接收。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename);driver 侧状态函数(setSubtasks/tick/appendSubtasks/markDone/setStatus/resetInProgress)与任务级 verify 命令提取(verifyCommand,供 resolveVerifyScript 判定脚本来源)。
- `src/prompt.ts` — 会话提示词模板(分解 / 单子任务 / 整任务 / 交接 steer / 收尾 / verify 脚本生成 / verify 判定 / 修复 / 质量审核 / 审核修复规划 / 权限预检 / 整体提交 / 初始化规划);判定文件路径 VERDICT_FILE(`.auto/verify.md`)与 REVIEW_FILE(`.auto/review.md`);VerifyRun 运行信息类型;--commit 四档(CommitMode)。
- `src/verify.ts` — verify 脚本机制层(纯逻辑,不依赖 SDK 与 runner):verifyTmpDir(`/tmp/<目标目录基名>`)、resolveVerifyScript(依 verifyCommand 判定 existing/wrapped/generate 三分支)、runVerifyScript(cwd=目标目录执行,stdout/stderr 整写 verify.out/verify.err,VERIFY_TIMEOUT_MS 缺省 10 分钟,超时 kill 退出码记 124)。
- `src/protect.ts` — 状态文件只读保护:`run` 期间 PLAN.md/CURRENT.md/opencode.json
  置 0o444(AGENTS.md 不在其列,任务可更新它),driver 写入经 allowWrite/reprotect 临时放行,runAll 的 finally 恢复 0o644。
- `src/server.ts` — opencode server 获取:优先复用已有 server,否则 spawn 并管理其生命周期(server 长驻,不随会话重启)。
- `src/log.ts` — 输出双通道:verbose(文件记录级别)与 foreground(终端明细/时间戳)分离,
  `setVerbose` 同开同关、`setInteractive` 只开文件记录;`log` 始终上终端、`vlog` 为 verbose 明细
  (interactive 下只进文件);`setInput` 注册交互 readline 后 log 打印先清输入行再重绘;run 时把全部
  输出同步写入目标目录 `.auto/logs/run-<时间戳>.log`(writeSync 逐条直写)。
- `templates/` — `init` 复制的模板(`PLAN.md`、`opencode.json`、`.opencode/agent/auto.md`)。
- `docs/verify-review-design.md` — 第三阶段(verify 三段式与 --review 审核循环)的唯一设计基准:已确认决策、接口约定与流水线伪代码。
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
  验收差距不做修复重跑,任务回退 pending 等人工改进)/ `ondemand`(单会话执行,
  watch 在已用量达到 --context-limit 时向进行中会话 steer 交接提示——每会话一次,
  v2 prompt 默认 steer;会话结束按 docs/<id>.handoff.md 末行 `状态: 继续|完成`
  决定续跑或进入收尾,文件缺失带反馈重试一次再按隐性阻塞)。
- --dryrun: 只跑一次权限预检会话(列出授权外目录/操作并逐只读探查),该会话内
  权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复;报告写入
  .auto/dryrun.md 并打印,不执行任何任务。
- 提问(含权限类)自动答复(--wait-answer 下先等人工 stdin 答复,超时回落自动答复;
  缺省 --wait-answer 时权限提问仍直接阻塞);permission.asked 在 --wait-answer 下
  同样等待人工指令,回答 allow/yes/y 等视为授权(以 always 放行),明确的其余回答
  拒绝该权限但不中断(AI 无授权绕开继续),超时则拒绝并阻塞停机;
  同一问题重复出现仍阻塞停机。--wait-between 在每个任务完成后暂停等待人工
  (回车立即继续,超时自动继续),首个任务前不等待。
- --interactive/-i 旁路交互(与 --verbose 互斥,index.ts 检查):不改变任何既有
  处理逻辑——常驻 readline 把回车输入作为额外用户消息经 `session.promptAsync`
  注入当前活动会话(v1 引擎 steer 语义,下一 provider turn 边界处理;**不要用
  v2 `delivery: "queue"`**,它与 v1 引擎不兼容会产生无历史的并发 drain);无活动
  会话时输入丢弃并提示;ask/--wait-between 的人工等待改经该输入行接收(提示语、
  超时、空行、回落语义与独立 readline 完全一致);终端不显示 verbose 明细,但日志
  文件保持 --verbose 级完整记录(interactive 隐含 verbose 记录级别)。
- **driver 独占状态写入**:PLAN.md 的状态标记、检查项勾选、verified 字段与 CURRENT.md
  全部由 driver 写,agent 会话被禁止编辑这两个文件;`run` 期间这些文件(含 opencode.json)
  被 chmod 为只读作为防误写护栏(非安全边界,同用户进程可经 bash chmod 绕过),
  driver 自身写入经 `src/protect.ts` 的 allowWrite/reprotect 临时放行。完成判定不靠
  agent 自报——任务级验收由 driver 执行 verify 脚本、旁路独立判定会话读输出判定,
  driver 只解析其判定文件;子任务会话结束后 driver 按可信勾选(验收统一在任务级进行)。
- verify 三段式:verify 的处理权在 driver,验收只在任务级做一次——收尾会话后:
  ① 脚本准备(resolveVerifyScript 依 verifyCommand 三分支:`command:` 为单个存在
  且可执行的文件路径 → existing 直接使用;普通命令行 → wrapped,driver 包装
  /tmp/<基名>/verify.sh——首行 shebang 其后原命令原文,不加 set -e 等额外语义,
  每次幂等覆盖;自然语言或缺失 → generate,先开一次性旁路脚本生成会话产出脚本,
  产物约定名 /tmp/<基名>/verify.sh,跨修复轮复用,V1 不自动重生成);② driver 执行
  (runVerifyScript:cwd=目标目录,有执行位直接 spawn 否则经 bash;stdout/stderr
  整写 /tmp/<基名>/verify.out 与 verify.err,执行前 truncate;超时 10 分钟 kill、
  code 记 124;退出码非 0 不直接判失败);③ 旁路独立判定会话(renderVerifyJudge,
  一次性 chain 不进任务链)直读 out/err 与代码判定,写 `.auto/verify.md`,driver
  解析末行 `结论: 通过|差距` 与可选 `verified-command:` 行;通过 → markDone
  (verified 优先取判定的 verified-command,其次原命令,最后实际脚本路径);差距 →
  renderFix 反馈回执行会话链修复,重新收尾与验收(FIX_ROUNDS=3,off 模式直接回退
  pending)。旁路产物缺失"带反馈重试一次仍失败按隐性阻塞"统一走 requireArtifact。
  driver 执行脚本不经 opencode 权限体系(等同人工本地跑测试,非安全边界,文档须
  明示);/tmp 产物不进仓库,同基名目标目录共享。
- --review:`--review [1-10]`(缺省 0 不启用、裸选项 3、显式值须 1..10 整数,
  index.ts parseReviewLimit 校验,loop 透传 runTask)。runTask 外层轮循环:执行
  阶段(ensureDecomposed/executeWhole)仅首轮进入;验收通过后 reviewTask 开旁路
  审核会话(renderReview:维度=忠实性/正确性/验证过程有效性;final 由"当前任务
  之后全部 done"判定,终审报告 docs/final-audit.md、其余 docs/T-NNN.audit.md,
  范围以本任务改动为限、终审不限),结论写 `.auto/review.md`(协议同 VERDICT_FILE,
  复用 parseVerdict)。通过 → completed;差距 → off 模式 setStatus pending 返回
  incomplete(与该模式 verify 失败语义一致);轮数超限 → blocked(question=差距
  全文);未超 → 任务先置回 in_progress(verifyTask 已标 done,否则中断重跑时
  next() 会跳过、fix 检查项永不执行)→ planReviewFix 旁路规划会话产出
  docs/T-NNN.fix.md → appendSubtasks 注入 PLAN.md → 刷新 CURRENT.md → 下一轮
  (fix 检查项走子任务会话循环)。
- 任务流水线(auto 模式):正文无检查项时先跑分解会话(产出 docs/T-NNN.subtasks.md,
  driver 注入检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN.report.md
  (只写产出摘要,不运行任务级 verify、不下验收结论)。
  任务内所有会话共用一条链:上一会话结束时上下文占比低于 50% 且已用量低于
  --context-limit(默认 64k tokens)则复用,否则新建;占比与用量由 watch 始终跟踪
  (与 --verbose 无关),拿不到模型上限时占比记 100 即总是新建;瞬时会话错误重试
  仍强制换新会话。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩);AGENTS.md 中 driver 只
  维护固定指针块,不再置只读(任务可更新其余内容),driver 在 `run`/`init`
  启动会话前确保指针块存在、缺失则追加,此外永不改写;server 长驻即可,指令文件
  每个 provider turn 现场重读。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。

<!-- opencode-auto:start -->
本目录由 opencode-auto 驱动。每个会话开始必须先读 `CURRENT.md`(若存在),其中是当前
任务的完整内容与进度,优先于一切会话记忆。不要编辑 `CURRENT.md` 与 `PLAN.md`,
它们由 driver 独占维护。
<!-- opencode-auto:end -->
