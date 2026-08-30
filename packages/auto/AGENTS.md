# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `check` / `status` 四个子命令与参数解析(含 `-p`/`-i`/`-m` 短选项;`--review`/`--early-review` 经 parseReviewLimit 校验——缺省 0 不启用、裸选项 3、显式值须为 1..10 整数;`--early` 为布尔修饰,review 未启用时单独出现为用法错误,`--early-review` 是 `--review n --early` 的快捷糖、与 `--review` 同现为用法错误;`--final-review` 经 parseFinalReviewLimit 校验(镜像 parseReviewLimit 风格)——缺省 0 不启用、裸选项 2、显式值须为 1..5 整数(审计轮上限),与 `--review`/`--early-review` 可同现;`-m/--mode` 镜像 -p 的吞值规则,init 与 run 均接受、缺省 migrate,未注册名为用法错误退出码 1(报文列出当前支持的模式);`--permission` 经 parsePermission 校验,缺省/裸选项 ask-deny,非法取值均退出码 1;`--verify-idle`(缺省/裸选项 10 分钟,1..120)与 `--verify-max`(缺省/裸选项不设上限,1..1440)为 verify 脚本看门狗参数;`--agent` 缺省取 `auto` 契约 agent);`check` 调 src/check.ts 检查 AGENTS.md/PLAN.md 违背验证原则的描述,命中退出码 1;`init` 对 `.opencode/agent/auto.md` 与模板不一致时总是替换,并维护 .gitignore(忽略 tmp/ 与 .auto/logs/),`-p/--prompt` 在初始化后经 manage 启动 server 调用一次 AI 填充 PLAN.md 供人工审核;`--interactive` 与 `--verbose` 互斥检查在此。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;启动时 `resetInProgress` 把上次运行中断遗留的 in_progress 重置为 pending,并经 peekProgress 把进度记录处于 verify(--review 启用时)/review 阶段但已被标 done 的任务置回 in_progress(否则 next() 跳过、审核永不补跑);任务开始横幅;`ensurePointer` 在启动会话前确保 AGENTS.md 指针块与验证原则块存在(两个独立标记块,各自幂等补写);`ensureGitignore` 确保 tmp/ 与 .auto/logs/ 被 .gitignore 忽略(非 git 目录不动);run 前完整性检查(.opencode/agent/<agent>.md 缺失直接报错退出并提示 init 恢复,与模板不一致仅警告);`--dryrun` 权限预检;`--commit once` 的整体提交;verbose 变更文件监视(基于 git status,含子目录中的嵌套 git 仓库);子任务进度上报(`--commit subtask` 下,每 10 分钟);`--review`/`--early`/`--permission`/`--verify-idle`/`--verify-max`/mode/server 句柄透传至 runTask;`--final-review` 终审推进挂点(advanceFinal: runTask 完成且任务带 final 标记后路由追加下一任务;next() 为空且终审未完成时打横幅"进入终审闭环"并续跑循环;熔断/报告异常 block 对应终审任务退出码 2);`--interactive` 旁路控制器的创建/回收与 waitBetween 接入。
- `src/interactive.ts` — `--interactive` 旁路:常驻 readline 把回车输入经 promptAsync(fire-and-forget)注入当前活动会话(attach 由 runner 在每个会话建立/复用时调用;无活动会话丢弃并提示);ask/任务间暂停的人工等待经同一输入行接收(空行原样上交给调用方解释);stdin 关闭后回落非交互行为;io 可注入供测试。
- `src/runner.ts` — 单任务流水线:`--subtask auto` 分解会话(恢复时先直读 docs/<id>.subtasks.md,有效则直接注入不开会话)→ 逐子任务会话(会话结束后 driver 直接勾选,验收不在子任务级进行);`--subtask off` 单会话完成整个任务,验收/审核差距不做修复重跑,任务回退 pending;`--subtask ondemand` 单会话执行、上下文达到 --context-limit 时 steer 交接提示、新会话从 docs/<id>.handoff.md 续跑;收尾会话 → verifyTask 三段式验收(脚本准备 → driver 执行 → 独立判定会话;判定会话禁止执行验证脚本/命令,可替换指定脚本后结论`重验`,driver 重新执行回传输出,至多 REVERIFY_ROUNDS=3 轮;判定会话另被授权更新后续未完成任务的 verify 字段——会话期间 allowWrite(PLAN.md)、结束后校验,越权编辑整体还原;差距反馈回执行会话修复,最多 FIX_ROUNDS=3 轮,off 模式直接回退 pending)→ `--review` 下 reviewTask 质量审核与 planReviewFix 修复规划(外层轮循环,执行阶段仅首轮进入;`--early` 下审核经 verifyTask 挂点在脚本执行窗口并行启动、结论随 done 带回,外层不再独立调用 reviewTask);旁路会话产物缺失"带反馈重试一次再隐性阻塞"的骨架统一在 requireArtifact;会话链复用(占比 <50%、用量 < --context-limit 且距上一会话结束 ≤5 分钟三者同时满足,REUSE_IDLE_MS;旁路一次性会话的链不带 phase、不写进度记录)、事件监听、提问自动答复(AUTO_ANSWER 含决策记录与 AUTO-DECISION 标注要求)、权限请求按 --permission 四档处理(dryrun 下自动拒绝但不中断)、隐性阻塞检测;新建会话前经 server 句柄 syncAgents(AGENTS.md 有更新则重启 server),网络类会话错误(Internal network failure / Network error 等)先 restart 换新 server 实例再换新会话重试;进度记录(.auto/progress.json,经 persistStage 在阶段边界推进、attempt 在执行链会话开始/结束时刷新 active)支撑中断精确恢复:runTask 开头 recallProgress——active 且 30 分钟窗内且会话存活则复用原会话,否则新会话,均附按 phase 的下一步指引;阶段级重入(verify 有持久化 run 跳过重跑直接判定、off/ondemand 过执行阶段不重跑 executeWhole、review/planfix 有有效 fix.md 直接注入);CURRENT.md 在任务开始时即写入,每次勾选后刷新,任务完成在收尾中删除;非完成结局(阻塞/回退 pending)写"中断备注"(原因/阶段/恢复方式)后保留,网络类 blocked(会话错误重试耗尽)保持 active 记录走 30 分钟窗复用;`commitAll` 与 `runOnce` 独立会话;verbose 明细走 vlog,askHuman 在 interactive 下改由旁路输入行接收;Opts 的 mode 透传至各执行类 render,audit/validate 终审任务依 final 字段强制 review=0(本身即审核,--early 随之自然失效)、remediate/finalize 不变,requireArtifact 导出供 src/final.ts 的生成会话复用。
- `src/resume.ts` — 进度恢复记录:saveProgress/recallProgress/peekProgress/forgetProgress 维护目标目录 .auto/progress.json({task, session, at, active, phase}),RESUME_WINDOW_MS=30 分钟;phase 覆盖 decompose/whole/subtasks/wrapup/verify{stage,round,rechecks,replaced,run?,audit?}/review{round,stage};recall 不做窗口判定(窗口与存活判定在 runner),旧版 .auto/session.json 兼容读取(视为半途会话、无阶段);peek 供 loop 把验收/审核阶段中断但已标 done 的任务置回 in_progress。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename);driver 侧状态函数(setSubtasks/tick/appendSubtasks/markDone/setStatus/resetInProgress)与任务级 verify 命令提取(verifyCommand,供 resolveVerifyScript 判定脚本来源);终审支持——Task 解析 final 字段(FIELD 行通用解析,edit 重写时随全部字段保留)、parseFinalMark(`<stage>@<round>` 校验)与 appendTask(文件尾追加完整任务块,原子写、复用 allowWrite/reprotect,重复 ID 报错)。
- `src/prompt.ts` — 会话提示词模板(分解 / 单子任务 / 整任务 / 交接 steer / 收尾 / verify 脚本生成 / verify 判定 / 修复 / 质量审核 / 审核修复规划 / 权限预检 / 整体提交 / 初始化规划 / 终审任务生成);QUESTION_RULE 与 runner 的 AUTO_ANSWER 同步要求自动决策记录决策过程并标注 `AUTO-DECISION:`;renderVerifyScriptGen/renderVerifyJudge 禁止执行验证脚本或验证性命令(执行权在 driver,结果经 out/err 回传),judge 可替换指定脚本并结论`重验`,另含 verify 经验沉淀授权段(仅后续未完成任务的 verify 字段,附现值清单);renderReview 两形态维度 3 均为静态审核(early 另告知脚本并行执行、只读为主);renderInit 注入验证执行权原则与模式导语,执行类模板注入 mode.exec 注记;renderFinalTask 为终审四阶段(audit/remediate/validate/finalize,FinalStage/stageText)的旁路生成会话模板——输入上游产物指针与残余差距原文、产出提案 docs/final/plan-<stage>-r<N>.md、audit@r≥2 聚焦残余差距不全量重审、注入 mode.final[stage] 侧重、verify 行约束(优先复用原任务验证命令、不得发明未运行过的检查);判定文件路径 VERDICT_FILE(`.auto/verify.md`)与 REVIEW_FILE(`.auto/review.md`);VerifyRun 运行信息类型(含看门狗 timeoutReason);--commit 四档(CommitMode);commitRule 含"tmp/ 与 .auto/logs/ 不纳入提交"。
- `src/mode.ts` — `-m/--mode` 模式层注册表:ModeSpec 三段文案(init 导语 / exec 执行注记 / final 终审各阶段侧重),V1 仅注册 migrate(optimize/implement/test 为既定扩展名),resolveMode 未注册返回 undefined;新增模式 = 加一个类型完整的条目,driver 零改动。
- `src/final.ts` — `--final-review` 终审闭环状态机(设计文档 B/C 节,纯路由函数、无新增持久化状态):finalProposalFile/finalReportFile 产物路径(docs/final/ 下提案与各阶段报告);parseStrategy/parseConclusion 解析报告末行协议(策略: 重构|修补|无;结论: 通过|差距 <描述>),parseProposal 解析提案文件;routeFinal 由(带 final 标记的任务及其状态,docs/final/ 产物)推导路由并含幂等重建 C.1..C.5(未完成终审任务不生成新任务、下一阶段任务已存在不重复生成、提案已产出未追加直接解析追加、done 但报告缺失/协议非法按阻塞提示人工核查、final 字段非法 block);appendFinalTask(T-F<k> 按追加顺序编号、final: <stage>@<round> 字段、audit/validate 固定结构检查 verify、remediate 取提案 verify 行、finalize 缺省结构检查提案可覆盖);generateFinalTask 经 runner 的 requireArtifact 骨架开旁路生成会话产出提案。
- `src/check.ts` — `check` 命令逻辑:启发式扫描目标目录 AGENTS.md 与 PLAN.md 中要求会话亲自运行验证脚本/命令的语句(否定句、driver 归属句、PLAN 字段行与 opencode-auto 标记块不算),返回 findings(file/task/line/text)与 notes;命中退出码 1。
- `src/verify.ts` — verify 脚本机制层(纯逻辑,不依赖 SDK 与 runner):verifyTmpDir(目标目录下 `tmp/` 子目录,工作目录内可直接读,避免 /tmp 权限问题;loop 的 ensureGitignore 保证不进仓库)、resolveVerifyScript(依 verifyCommand 判定 existing/wrapped/generate 三支)、runVerifyScript(cwd=目标目录执行,stdout/stderr 整写 tmp/verify.out 与 verify.err;进度看门狗——轮询两个输出文件的大小,任一增长即重置计时,持续 --verify-idle(缺省 10 分钟)无增长才 kill、退出码记 124 且 timeoutReason=idle,--verify-max(缺省不设)为绝对上限兜底且 timeoutReason=max)。
- `src/protect.ts` — 状态文件只读保护:`run` 期间 PLAN.md/CURRENT.md/opencode.json
  置 0o444(AGENTS.md 不在其列,任务可更新它),driver 写入经 allowWrite/reprotect 临时放行,runAll 的 finally 恢复 0o644。
- `src/server.ts` — opencode server 管理:manage() 缺省 spawn `opencode serve` 并托管生命周期(需 PATH 上有 opencode CLI),显式 url(--server / OPENCODE_AUTO_SERVER)时连接外部实例、不托管;client 为指向当前实例的 Proxy(restart 后既有引用自动生效);syncAgents 依 AGENTS.md 指纹(mtime+size)变更重启;restart 供网络故障换新实例,外部实例返回 false。
- `src/log.ts` — 输出双通道:verbose(文件记录级别)与 foreground(终端明细/时间戳)分离,
  `setVerbose` 同开同关、`setInteractive` 只开文件记录;`log` 始终上终端、`vlog` 为 verbose 明细
  (interactive 下只进文件);`setInput` 注册交互 readline 后 log 打印先清输入行再重绘;run 时把全部
  输出同步写入目标目录 `.auto/logs/run-<时间戳>.log`(writeSync 逐条直写)。
- `templates/` — `init` 复制的模板(`PLAN.md`、`opencode.json`、`.opencode/agent/auto.md`)。
- `docs/verify-review-design.md` — 第三阶段(verify 三段式与 --review 审核循环)与第四阶段(--early 并行审核,以 F 节为唯一设计基准)的设计基准:已确认决策、接口约定与流水线伪代码;G 节为判定会话执行限制与重验协议、H 节为中断恢复/看门狗/判定会话 verify 字段授权的后续修订基准。
- `docs/mode-final-review-design.md` — `-m/--mode` 模式层(src/mode.ts 注册表,提示词级场景引导)与 `--final-review` 终审闭环(终审阶段为入 PLAN.md 的真任务 T-F\<k\>,Audit→Refactor/Patch→Validate→Finalize 状态机,末行结论协议路由 + 审计轮上限熔断)的设计基准:已确认决策、状态机与恢复规则、文件级改动清单。
- `docs/fixme-knowledge-design.md` — `--track-fixme` 设计偏差追踪(AUTO-FIXME 注释锚点、driver 确定性扫描产出 tmp/fixme-scan.md、终审 audit 报告末行 `FIXME: CRITICAL=… WARN=… INFO=…` 协议 + CRITICAL 门禁不路由 remediate、finalize 生成前复扫回退 audit@r+1)与 `--extract-knowledge` 迁移知识沉淀(终审闭环完成后经 requireArtifact 旁路会话产出 docs/migration-kb/,提取失败不污染退出码;两选项均须搭配 --final-review)的设计基准:已确认决策、本期/未来范围切分、验收标准映射与文件级改动清单。**实现待后续会话按该文档分期(P1..P4)完成,实现前 CLI 不接受这两个选项。**
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
  (阻塞问题写入 PLAN.md;pending 回退不写字段;含 --final-review 终审闭环熔断),
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
- 提问自动答复(question.asked):非权限提问由 AUTO_ANSWER 自动答复(要求 AI 记录
  决策过程,涉及架构/代码变更的决策须以 `AUTO-DECISION: <决策与理由>` 行标注);
  --wait-answer 下先等人工 stdin 答复,超时回落自动答复;缺省 --wait-answer 时
  权限类提问(question 工具)直接阻塞;同一问题重复出现仍阻塞停机。
- --permission 四档(permission.asked 的处理策略,缺省 ask-deny):auto-allow 立即
  自动授权(always 放行,不等待);ask-allow/ask-deny/ask-fail 先等人工
  (--wait-answer 分钟,未设则不等待即视为超时;allow/yes/y 等视为授权以 always
  放行,明确的其余回答拒绝该权限但不中断),超时分别回落:自动授权 / 自动拒绝但
  会话继续(AI 无授权绕开) / 拒绝并退出运行(阻塞停机);dryrun 下仍自动拒绝但
  不中断。--wait-between 在每个任务完成后暂停等待人工(回车立即继续,超时自动
  继续),首个任务前不等待。
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
  driver 自身写入经 `src/protect.ts` 的 allowWrite/reprotect 临时放行。唯一例外是
  verify 判定会话:其被授权更新后续未完成任务的 verify 字段(verify 经验沉淀),
  会话期间 allowWrite(PLAN.md)、结束后校验,越权编辑(checkPlanEdit 比对任务集合/
  状态/attempts/正文)整体还原。完成判定不靠
  agent 自报——任务级验收由 driver 执行 verify 脚本、旁路独立判定会话读输出判定,
  driver 只解析其判定文件;子任务会话结束后 driver 按可信勾选(验收统一在任务级进行)。
- verify 三段式:verify 的处理权在 driver,验收只在任务级做一次——收尾会话后:
  ① 脚本准备(resolveVerifyScript 依 verifyCommand 三分支:`command:` 为单个存在
  且可执行的文件路径 → existing 直接使用;普通命令行 → wrapped,driver 包装
  tmp/verify.sh——首行 shebang 其后原命令原文,不加 set -e 等额外语义,
  每次幂等覆盖;自然语言或缺失 → generate,先开一次性旁路脚本生成会话产出脚本,
  产物约定名 tmp/verify.sh,跨修复轮复用,V1 不自动重生成);② driver 执行
  (runVerifyScript:cwd=目标目录,有执行位直接 spawn 否则经 bash;stdout/stderr
  整写 tmp/verify.out 与 verify.err,执行前 truncate;进度看门狗——输出文件持续
  无增长达 --verify-idle(缺省 10 分钟)才 kill、code 记 124 且 timeoutReason=idle,
  --verify-max(缺省不设)为绝对上限兜底;执行完毕的运行记录持久化到进度记录,
  此后中断恢复时跳过重跑;退出码非 0 不直接判失败);③ 旁路独立判定会话(renderVerifyJudge,
  一次性 chain 不进任务链)直读 out/err 与代码判定——**判定会话禁止执行验证脚本
  或验证性命令**(运行测试/构建/lint/服务等;只读检查不受限),认定脚本本身有问题
  或覆盖不足时编写新脚本替换 tmp/verify.sh 并以末行 `结论: 重验 <原因>`
  结束,driver 固定改为执行该指定路径(不再按 verify 字段重新解析,wrapped 重包装
  会覆盖替换产物)并把输出整写回传同一对 out/err,由新判定会话继续判定,至多
  REVERIFY_ROUNDS=3 轮(耗尽或声称重验但未写出脚本按隐性阻塞);判定会话另被授权
  verify 经验沉淀——发现预设命令的通病时可更新 PLAN.md 中后续未完成任务的
  verify 字段(仅限该字段,会话期间 allowWrite(PLAN.md)、结束后 checkPlanEdit 校验,
  越权整体还原),当前脚本无问题时不做修改。正常结论写
  `.auto/verify.md`,driver 解析末行 `结论: 通过|差距` 与可选 `verified-command:`
  行;通过 → markDone(verified 优先取判定的 verified-command,其次原命令,最后
  实际脚本路径);差距 → renderFix 反馈回执行会话链修复,重新收尾与验收
  (FIX_ROUNDS=3,off 模式直接回退 pending)。旁路产物缺失"带反馈重试一次仍失败
  按隐性阻塞"统一走 requireArtifact。driver 执行脚本不经 opencode 权限体系
  (等同人工本地跑测试,非安全边界,文档须明示);verify 产物统一在目标目录
  tmp/(工作目录内会话可直读,避免 /tmp 权限问题),run/init 经 ensureGitignore
  保证 tmp/ 与 .auto/logs/ 不进仓库。该执行权原则经 init 下沉:AGENTS.md 验证
  原则块、PLAN.md 模板与 renderInit 提示词;`check` 子命令可扫描两文件中违背
  该原则的描述。
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
  (fix 检查项走子任务会话循环)。early 两形态:`--review n --early` 或快捷糖
  `--early-review [n]`(index.ts 校验:--early 单独出现、--early-review 与
  --review 同现均为用法错误退出码 1)——审核会话经 verifyTask 审核挂点在 verify
  脚本执行窗口并行启动(executeVerifyScript 在 runVerifyScript 前调起、判定会话
  前 join,审核 blocked 立即上抛;generate 分支的脚本生成会话结束后才启动;每次
  脚本执行含修复轮重跑都重开一次新审核,early 措辞见 renderReview),结论随
  `{type:"done", audit}` 带回由外层消费(通过 → completed;差距 → 既有 review
  差距流程,off/超轮语义不变),非 early 走原串行路径;全局保持任意时刻至多一个
  LLM 会话(脚本执行为纯本地进程,窗口内唯一会话即审核会话),因此无需 worktree。
- `-m/--mode` 模式层:提示词级场景引导,不影响 driver 调度状态机——ModeSpec 三段
  文案(init 导语 / exec 执行注记 / final 终审各阶段侧重,src/mode.ts 注册表)注入
  renderInit、执行类模板与 renderFinalTask。V1 仅注册 migrate(optimize/implement/
  test 为既定扩展名,未注册即不可用),init 与 run 均接受、未注册名为用法错误退出码
  1(报文列出当前支持的模式)。模式 V1 不持久化(仅一种模式无分歧;扩展第二模式前
  必须先补持久化),init 与 run 应使用相同模式,跨天恢复时 CLI 忘带 -m 回落 migrate。
- `--final-review [1-5]` 终审闭环(parseFinalReviewLimit 镜像 parseReviewLimit:缺省
  0 不启用、裸选项 2、显式值须 1..5 整数为审计轮上限含首轮 audit;与 --review/
  --early-review 可同现,二者无交互;--dryrun 不触发)。原任务全部 done 后进入
  audit → remediate → validate → finalize 状态机——终审阶段是入 PLAN.md 的真任务
  (T-F<k> 按追加顺序编号、`final: <stage>@<round>` 字段),复用 runTask 全流水线:
  生成会话(renderFinalTask,旁路一次性)产出提案 docs/final/plan-<stage>-r<N>.md →
  appendFinalTask 追加 → 主循环 next() 拾取执行 → 报告末行协议路由(策略:
  重构|修补|无;结论: 通过|差距 <描述>):策略无直达 finalize(跳过 remediate 与
  validate,原任务已有任务级 verify 兜底);remediate 后生成同轮 validate;validate
  通过生成 finalize、差距回退 audit@r+1(聚焦残余差距不全量重审),审计轮耗尽熔断
  block 最后终审任务(残余差距与报告指针写入 question,退出码 2)。audit/validate
  任务依 final 字段强制 review=0(本身即审核,--early 随之自然失效),remediate/
  finalize 照常;audit/validate 的 verify 固定为报告结构检查、remediate 取提案
  verify 行(缺省回落自然语言 → generate 分支)、finalize 缺省结构检查提案可覆盖;
  终审任务的 verify 仍由 driver 亲自执行、不经 opencode 权限体系(与既有语义一致)。
  中断恢复零新增状态(routeFinal 重新求值:未完成终审任务不生成新任务、下一阶段
  任务已存在不重复生成、提案已产出直接解析追加、done 但报告缺失/协议非法按阻塞
  提示人工核查;终审任务内部中断走既有 recallProgress/peekProgress);终审任务沿用
  waitBetween/commit 档位/退出码语义,--commit once 的整体提交保持在终审全部结束
  之后(终审改动一并提交)。
- 任务流水线(auto 模式):正文无检查项时先跑分解会话(产出 docs/T-NNN.subtasks.md,
  driver 注入检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN.report.md
  (只写产出摘要,不运行任务级 verify、不下验收结论)。
  任务内所有会话共用一条链:上一会话结束时上下文占比低于 50%、已用量低于
  --context-limit(默认 64k tokens)且距其结束不超过 5 分钟(REUSE_IDLE_MS)则
  复用,否则新建(verify 脚本执行与判定/审核等耗时较久后自动换新会话);占比
  与用量由 watch 始终跟踪(与 --verbose 无关),拿不到模型上限时占比记 100 即
  总是新建;瞬时会话错误重试仍强制换新会话。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩):任务开始(首个会话前)
  写入、每次勾选后刷新、任务完成时删除;非完成结局(阻塞/回退 pending)写"中断
  备注"(退出原因/中断阶段/恢复方式)后保留,供人工查看与下次恢复(下次 runTask
  重建镜像时,备注要点经恢复提示词带给 AI);强制中断遗留文件同样下次重建。
  AGENTS.md 中 driver
  只维护固定指针块与验证原则块两个标记块(`opencode-auto:start` 与
  `opencode-auto:verify:start`,各自幂等补写、除此之外永不改写),不置只读
  (任务可更新其余内容);指令文件每个 provider turn 现场重读,且 AGENTS.md 指纹
  (mtime+size)变更时 server.syncAgents 在下一个新会话前重启 server 兜底。
- 进度恢复(应用重启后精确恢复中断):run 期间 driver 把当前阶段与执行链会话
  持久化到目标目录 .auto/progress.json({task, session, at, active, phase};阶段
  边界经 persistStage 写 active=false 总结态,执行链会话开始/结束经 attempt 刷
  active=true 半途态;旁路一次性会话不写);runTask 开始时 recallProgress 读回——
  active 且 30 分钟窗口内(RESUME_WINDOW_MS,自最后一次活动起算)且会话在 server
  上仍存在 → 复用原会话继续(chain 直接 seed 该会话),否则新会话;两种情况首个
  提示词均附加"[driver] 中断后的继续"说明(读 CURRENT.md、git status/diff 核对
  进度,按 phase 给出下一步指引,不重做)。phase 支撑阶段级重入:verify 有持久化
  run 记录跳过脚本重跑直接判定、off/ondemand 过执行阶段不重跑 executeWhole、
  review/planfix 有有效 fix.md 直接注入、decompose 先直读 subtasks.md;loop 启动
  经 peekProgress 把 verify/review 阶段中断但已标 done 的任务置回 in_progress。
  任务完成 forgetProgress;优雅退出(非网络类 blocked/incomplete)保留记录但清
  复用资格;网络类 blocked 保持 active 走 30 分钟窗复用;伪任务(PLAN/AUTO)不记忆。
- opencode server 管理(src/server.ts manage):run/init -p 缺省 spawn `opencode serve`
  并托管生命周期;显式 url(--server / OPENCODE_AUTO_SERVER)时连接外部实例、不托管。
  client 为 Proxy,restart 换实例后既有引用自动生效。网络类会话错误(NETWORK_FAILURE
  匹配 Internal network failure / Network error 等)在换新会话重试前先 restart;
  外部实例 restart 返回 false 仅提示。`--agent` 缺省取 `auto`(init 生成的契约
  agent),显式指定时须为目标目录 .opencode/agent/ 下已存在的 agent。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。

<!-- opencode-auto:start -->
本目录由 opencode-auto 驱动。每个会话开始必须先读 `CURRENT.md`(若存在),其中是当前
任务的完整内容与进度,优先于一切会话记忆。不要编辑 `CURRENT.md` 与 `PLAN.md`,
它们由 driver 独占维护。
<!-- opencode-auto:end -->

<!-- opencode-auto:verify:start -->
验证原则: 任务级验证脚本与验证命令一律由 driver 在会话外执行,任何会话不要直接
运行它们来下验收结论;验收标准写在任务的 verify 字段。若会话认为验证脚本本身有
问题,可编写新的验证脚本替换指定脚本(tmp/verify.sh,目标目录下 driver 管理的
工作目录),由 driver 重新执行并把输出回传给独立判定会话。任务描述与项目规范
不要出现与此相违背的指示(可用 opencode-auto check 检查)。
<!-- opencode-auto:verify:end -->
