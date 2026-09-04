# 行为约定详述(路由自 AGENTS.md)

> 本文件描述的是**本程序对目标目录施加的运行时行为契约**(PLAN.md/CURRENT.md/统一提交/verify 等均为目标目录侧的对象与机制),属于设计本程序功能所需的认知;AGENTS.md 只保留高频核心不变量。设计基准见 docs/ 下各设计文档。

- 退出码:`0` 全部完成(阶段化流程下 = 台账覆盖 `phases` 全部阶段),`1` 用法/环境错误
  (含 run 前 agent 契约文件缺失的完整性检查、项目配置 .opencode/auto/config.json 非法、
  阶段台账 docs/phases.md 非法或记录了 `phases` 之外的字母),`2` 阻塞或未完成为 pending、等待人工介入
  (阻塞问题写入 PLAN.md;pending 回退不写字段;含阶段规划会话受阻与 --final-review 终审闭环熔断),
  `130` 被连续两次 Ctrl+C 强制终止(单次 Ctrl+C 仅提示,3 秒窗口内第二次才退出,
  退出前尽力恢复文件可写并关闭 server)。
- 项目配置固化(src/config.ts,设计文档 docs/init-config-agents-design.md 与
  docs/phases-design.md A.2):宪法级选项
  -m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--phases/--source-dir/--source-path/--dest-dir 仅
  init 接受(仅显式给出的键被改写、其余保留既有值——init 兼具创建与修订两种身份,
  重复 init 无参数不重置配置;source 两键成对、任一给出即整体覆盖,init 时校验
  <工作目录>/join 后存在(经 stat 跟随软链接——source-dir 可为指向工作目录外的软链,
  断链按不存在拒绝);三迁移键均须为不含 .. 的相对路径,dest-dir 独立固化/修订、
  不校验存在性——迁移目标在 <工作目录>/<dest-dir>,driver 流程文件与迁移产出经它隔离;
  台账非空时改 --phases 须满足前缀护栏——已完成阶段构成新值前缀,否则退出码 1 并指引
  人工修订台账),run 出现即用法错误退出码 1(报文给修订指引)。
  人工修订通道为直接编辑配置文件;坏 JSON/键值越界/mode 未注册时 run 与 init 均退出
  码 1(严格失败优于静默回落),未知键忽略;旧 .auto/config.json 的 mode 仅在新文件
  缺失时回落读取(run 打提示);run 期间配置文件置只读(brief.md 不在其列,非状态文件);
  status 与 run 启动横幅打印
  formatProjectConfig 一行摘要(含阶段)。判别标准: 改它需同时改 AGENTS.md/PLAN/契约表述或
  描述模型/项目属性 → init;只描述本次运行怎么跑、人怎么盯 → run。
- init 去 AI 化(phases-design.md):init 不启动任何 AI 会话,`-p/--prompt` 整写覆盖
  .opencode/auto/brief.md(项目意图,版本化、人工可编辑,阶段规划会话消费;无 -p 保留
  既有);结束语按 phases 分两态("m" 维持"编辑 PLAN.md"现状,其余提示开始首个未完成
  阶段规划);phases 含 v 而 verify 未启用时 init 打 note 一次(v 与 verify 正交);
  phases ≠ "m" 时 PLAN.md 以空模板(templates/PLAN.scaffold.md)产出,交给规划会话。
- 阶段循环(config.phases ≠ "m",P1..P4 已接线;设计文档 phases-design.md D/E/F 节):阶段
  状态是推导式的,routePhase 只读 docs/phases.md 台账与 PLAN.md(零新增持久化状态),
  run 据此循环——PLAN.md 为空模板 → 开阶段规划会话(旁路一次性,复用 requireArtifact
  骨架,产物 = 已填充的 PLAN.md;仅此会话经 allowWrite 被授权写 PLAN.md,受阻退出 2;
  会话输入注入 brief、source、destDir、mode.init 与各前序阶段归档 handover.md 的预拼接
  handovers——蒸馏产物是跨阶段记忆唯一通道,不注入前序原始 docs/,缺文件标注
  "(无交接文档)")、
  有未完成任务 → 走既有主循环(分解/执行/验收/审核/统一提交/进度恢复语义不变;
  v 阶段任务豁免任务级验收与 --review,见下条)、
  本阶段任务全 done → 交接(先开蒸馏会话产出归档目录 handover.md——四小节协议
  关键决策/约束与坑/下一阶段必读清单/产物索引,validHandover 逐字校验标题行,
  产物缺失带反馈重试一次仍失败隐性阻塞退出 2;再归档本阶段 docs/ 变更与 PLAN.md →
  PLAN.md 重置空模板 → 台账追加 → 统一提交 stage=phase-transition);台账覆盖
  phases 全部字母 → 退出 0。`--final-review` 只在 m 阶段挂接(其余阶段打一次
  提示);AGENTS.md 超 150 行在交接时仅 note 提示、不改写。
- k 阶段(P4,phases-design.md D.4;整体认领 fixme-knowledge-design.md 的
  --extract-knowledge,该 CLI 选项不存在):plan 路由(PLAN.md 空模板态)不开
  规划会话、不填 PLAN.md,直接进入知识提取旁路会话(src/knowledge.ts
  extractKnowledge,requireArtifact 骨架)——通读阶段台账与各阶段归档目录
  (handover.md 优先),产出 docs/migration-kb/migration-<时间戳>.md(章节骨架/
  质量约束内联在 templates/prompts/knowledge.md,mode.exec 作场景背景注入);
  目录内已存在非空 .md(交接前中断)则幂等跳过;提取失败(会话受阻或两次未产出)
  仅打 ⚠ 警告、不污染退出码,k 阶段照常交接——迁移成功不被文档生成失败反向污染;
  知识文档作为阶段产物随会话统一提交(stage=knowledge)并交接归档;docs/ 快照
  不在 k 刷新(沿用上一阶段陈旧快照,新增 migration-kb 即归档差异项);人工在
  k 阶段自行向 PLAN.md 填任务时走通用 execute/handover 路由,提取挂点不触发;
  交接完成后重试提取 = 人工回退规程(删台账 k 行与归档目录后重跑)。
- v 阶段验收豁免(phases-design.md D.3):runTask 依 loop 透传的 Opts.phase 在
  当前阶段为 v 时强制 review=0 且跳过任务级三段式验收(收尾后直接 markDone、不写
  verified)——与终审任务的 final 字段共用同一豁免代码路径,内部标记、不写 final
  字段、不污染 PLAN.md 协议;v 阶段任务全 done 即交接、不因验收差距熔断(D.3
  预留了 handover 路由前解析验收报告结论的挂点备选,V1 不做)。
- 续轮迁移(continue 子命令,phases-design.md M 节):上一轮阶段化迁移全部完成
  (台账覆盖既有 phases 全部字母)后开启新一轮继续迁移,目标是让迁移结果与源
  更加完整、一致。continue = init 的 amend 机制 + archiveRound 归档上一轮
  (docs/phases/ 下全部阶段归档目录、docs/migration-kb 残留、轮末根 PLAN.md 与
  台账移入 docs/phases/round-<N>/,台账最后移动故中断重跑幂等,并清 .auto/
  phase-snapshot.json),台账随归档消失 = 空台账、根 PLAN.md 由模板循环重建空
  模板,新一轮从头规划;上一轮结论(归档索引 + 最终阶段交接 handover.md 全文 +
  迁移知识文档全文)经 prevRoundDigest 注入新一轮首个阶段规划会话,后续阶段照常
  走本轮 handover 蒸馏链。迁移同一性选项(-m/--mode、--source-dir/--source-path、
  --dest-dir)跨轮固定、continue 时显式给出即退出码 1(换源/换目标/换模式不是
  同一迁移的继续);--phases/-p 与其余执行选项可按轮修订(--phases 不受前缀护栏
  约束)。轮次推导式(当前轮 = round-<N> 最大编号 + 1),run/status 阶段进度行带
  `第 N 轮` 标注(round > 1 时);`--continue` 不是选项,init/run 出现即报错指向
  continue 子命令;前置校验失败(非阶段化项目/台账为空/缺阶段/含外字母/新
  --phases 为 "m")均退出码 1 给指引。
- 下发任务失败(UnknownError)的常见根因是目标目录缺少 `.opencode/agent/<agent>.md`
  (服务端错误体不含根因):run 前完整性检查拦截该情况;运行中发生时 driver 在
  阻塞问题后追加恢复提示(检测依赖 Opts.dir,run/init/dryrun 均须传入)。
- 统一提交(收回 AI 提交权):任何会话结束且 driver 完成状态写入后,由 driver 经
  src/git.ts 的 commitTree 递归提交全部改动(先嵌套 .git 子仓库、后目标目录所在
  仓库,路径发现不依赖 git status——嵌套仓库通常被父仓库忽略),git 历史即 AI
  变更的审计轨迹、回滚粒度 = 会话。提交信息 = `任务编号 <label> <任务标题/子任务>` 短标签
  标题行(label ∈ decompose/S<n>/exec/wrapup/fix<n>/judge/script/review/final/planfix/
  blocked/pending/done,伪任务用 PLAN <label>;子任务条目为 `任务编号 S<n> <标题>`、
  省略任务标题)+ `Auto-Task`/
  `Auto-Stage` trailer(目标仓库另记 `Auto-Nested` 嵌套仓库路径与 SHA)。挂点:
  分解注入/子任务勾选/整任务/修复轮/收尾在状态写入后,判定/审核/脚本生成/
  修复规划/终审规划等旁路会话在会话结束后,任务完成/阻塞/回退 pending 由 loop
  边界提交(中断现场也提交,支持回滚到断点);dryrun 不提交。单仓库
  提交失败仅警告不阻塞(下一次提交全量 add 清扫连带);仓库未配置 user.email 时
  以固定身份兜底;`--commit false`(init 修订,写入配置 commit 键;none 为 false 别名)
  可整体关闭(旧四档 subtask/task/once
  与别名 --commit-subtask 已移除,出现即用法错误)。工作区遗留的未提交改动会被
  下一次统一提交纳入(run 启动时经 pendingChanges 提示)。该执行权原则经 init
  下沉:AGENTS.md 提交原则块、agent 契约与 state-rule 片段;`check` 子命令同步
  扫描违背该原则的描述。
- subtask 三档(config.subtask,init --subtask 修订):`auto`(缺省;分解会话 → 逐子任务,
  子任务会话同样带 handoff-steer 交接——已用量达配置 contextLimit 的 2 倍时 steer 交接
  提示,会话写出 docs/<id>.handoff.md(末行 `状态: 继续|完成`,以该子任务是否完成计),
  新会话凭交接续跑,子任务完成后 driver 删除该文件)/
  `off`(单会话完成整个任务;
  验收差距不做修复重跑,任务回退 pending 等人工改进)/ `ondemand`(单会话执行,
  watch 在已用量达到配置 contextLimit 的 2 倍时向进行中会话 steer 交接提示——每会话一次,
  v2 prompt 默认 steer;会话结束按 docs/<id>.handoff.md 末行 `状态: 继续|完成`
  决定续跑或进入收尾,文件缺失带反馈重试一次再按隐性阻塞)。中途切换:已注入检查项
  的任务照旧从勾选状态续跑(进度按任务记录),新任务按新档执行;README 注明不建议。
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
  全部由 driver 写,agent 会话被禁止编辑这两个文件;`run` 期间这些文件(含 opencode.json
  与 .opencode/auto/config.json)
  被 chmod 为只读作为防误写护栏(非安全边界,同用户进程可经 bash chmod 绕过),
  driver 自身写入经 `src/protect.ts` 的 allowWrite/reprotect 临时放行。唯一例外是
  verify 判定会话:其被授权更新后续未完成任务的 verify 字段(verify 经验沉淀),
  会话期间 allowWrite(PLAN.md)、结束后校验,越权编辑(checkPlanEdit 比对任务集合/
  状态/attempts/正文)整体还原。完成判定不靠
  agent 自报——任务级验收由 driver 执行 verify 脚本、旁路独立判定会话读输出判定,
  driver 只解析其判定文件;子任务会话结束后 driver 按可信勾选(验收统一在任务级进行)。
- verify 验收开关(config.verify,缺省 false;仅启用时 driver 才进入任务级三段式验收)
  ——未启用时任务在收尾后由 driver 直接 markDone(不写 verified,未经验证不落账),
  --review 的质量审核改为此时串行执行(--early 的并行窗口不存在,loop 启动时打降级
  提示),idleTime/idleMax 看门狗不参与;终审任务(带 final 字段)无论该键
  与否一律强制跳过任务级验收(报告缺失/协议非法在路由时按协议异常 block)。
  该开关同时门控验收描述在产物中的存在:未启用时 init 产出的 PLAN.md/agent 契约
  (renderText 条件渲染)、ensurePointer 不补写 AGENTS.md 验证原则块(已存在的移除)、
  各会话提示词(state-rule 片段等经 baseCtx 的 verify 变量)不含
  verify 相关描述——验收机制不存在,提示词不得提及。
- --test-by-driver/--handover-test(config.testByDriver/handoverTest,缺省 false;宪法级选项,init --test-by-driver/--handover-test 修订,run 拒绝;与 verify 正交的测试执行协议): 前者把实现环节"编译/测试/构建/lint 等可能耗时长或产生大量输出的命令"的执行权收归 driver——执行类会话(子任务/整任务/验收修复轮;分解/收尾/判定/审核等旁路会话与 --dryrun 不适用)不在会话内直接运行这类命令,改为把命令写成脚本放 test/ 目录(命名清晰、可执行、可复用,随仓库版本化),把脚本路径(相对工作目录)写入 tmp/test.sh 标记(存在即待执行请求,重写即再次请求),driver 在会话 idle 时检测标记:内容为现存文件路径 → 直接运行该脚本(test/ 内脚本已随统一提交版本化,不另归档);否则按内联脚本回落整写为 tmp/test.<n>.sh 后运行(保留执行快照供审计);两种形态均把 stdout/stderr 合并整写 tmp/test.<n>.out(单文件,编号跨运行接续,共用 idleTime/idleMax 看门狗),移除标记后退出码/耗时/脚本与输出路径经 steer 注入同一会话由 AI 直读文件判断(退出码非 0 不由 driver 判定;steer 一律经 promptAsync 投递——v2 同步 /message 端点会阻塞到回合结束,在 watch 事件循环内同步等待会卡死事件循环;投递失败记 log 并按隐性阻塞 blocked 处理,回合结束的孪生 idle 事件经 watch 去重,处理过一次后直到新会话事件出现前不再结算);重跑同一测试 = 把同一脚本路径再次写入 tmp/test.sh(脚本可先修改再重跑)。每个执行会话入口清除遗留待执行标记。后者(需前者,配置层与 init 均交叉校验)在测试失败(非零退出或看门狗超时)且会话 used ≥ contextLimit 时改要求 AI 写 docs/<id>.testhandoff.md 后结束会话(缺失带反馈重试一次仍缺失隐性阻塞),driver 开新会话以续跑提示(先读交接文档与最近输出)继续,不设硬上限、连续超 10 次提醒评估是否陷入无法解决的问题(可 AUTO-FIXME 标注遗留后继续);非恢复续跑时清除陈旧交接文档。提示词协议段经 subtask/whole/fix 模板的 testByDriver/handoverTest 条件块注入,steer 文案在 test-result/test-handover/test-continue 模板(无 driver 解析协议,覆盖校验不做标记要求)。该执行权约定经 init 下沉:AGENTS.md 测试执行原则块(随 config.testByDriver 补写/移除,镜像验证原则块)与 agent 契约的 testByDriver 条件段;`check` 子命令在 testByDriver 启用时扫描 AGENTS.md/PLAN.md 中要求会话亲自运行编译/测试/构建/lint 的描述(TEST_PATTERNS,与验证类同构)。
- verify 三段式(config.verify 启用时):verify 的处理权在 driver,验收只在任务级做一次——收尾会话后:
  ① 脚本准备(resolveVerifyScript 依 verifyCommand 三分支:`command:` 为单个存在
  且可执行的文件路径 → existing 直接使用;普通命令行 → wrapped,driver 包装
  tmp/verify.sh——首行 shebang 其后原命令原文,不加 set -e 等额外语义,
  每次幂等覆盖;自然语言或缺失 → generate,先开一次性旁路脚本生成会话产出脚本,
  产物约定名 tmp/verify.sh,跨修复轮复用,V1 不自动重生成);② driver 执行
  (runVerifyScript:cwd=目标目录,有执行位直接 spawn 否则经 bash;stdout/stderr
  合并整写 tmp/verify.out 单文件,执行前 truncate;进度看门狗——输出文件持续
  无增长达 idleTime(缺省 10 分钟)才 kill、code 记 124 且 timeoutReason=idle,
  idleMax(缺省不设)为绝对上限兜底;执行完毕的运行记录持久化到进度记录,
  此后中断恢复时跳过重跑;退出码非 0 不直接判失败);③ 旁路独立判定会话(renderVerifyJudge,
  一次性 chain 不进任务链)直读输出与代码判定——**判定会话禁止执行验证脚本
  或验证性命令**(运行测试/构建/lint/服务等;只读检查不受限),认定脚本本身有问题
  或覆盖不足时编写新脚本替换 tmp/verify.sh 并以末行 `结论: 重验 <原因>`
  结束,driver 固定改为执行该指定路径(不再按 verify 字段重新解析,wrapped 重包装
  会覆盖替换产物)并把输出整写回传同一输出文件,由新判定会话继续判定,至多
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
  保证 tmp/ 与 .auto/ 不进仓库。该执行权原则经 init 下沉:AGENTS.md 验证
  原则块与 PLAN.md 模板;`check` 子命令可扫描两文件中违背
  该原则的描述——下沉与扫描均以 config.verify 启用为前提(见上方"verify 验收
  开关"条)。
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
- 提示词模板:全部会话提示词以文件模板管理(`templates/prompts/` 18 个会话模板 +
  `_partials.md` 共享片段,src/template.ts 渲染,语法 `{{var}}`/`{{#if x}}`/`{{^x}}`/
  `{{> 片段}}`、块标签独占一行整行吞掉);目标目录 `.opencode/auto/prompts/` 同名
  覆盖,协议敏感模板(verify-judge/review/verify-script-gen/review-fix/decompose/
  handoff-steer/final-task/phase-plan/phase-handover)覆盖时校验关键协议内容
  (`结论: 通过|差距|重验`、`.auto/verify.md`、交接四小节标题等),
  缺失即退出码 1。改提示词文案只动模板文件,不动 src/prompt.ts
  (那里只做数据组装);改后必须跑 test/prompt.test.ts 防协议行漂移。
- `-m/--mode` 模式层:提示词级场景引导,不影响 driver 调度状态机——ModeSpec 三段
  文案(init 导语 / exec 执行注记 / final 终审各阶段侧重,文件模板管理:内置
  templates/modes/ + 目标目录 .opencode/auto/modes/,见 src/mode.ts)注入
  阶段规划会话(已接线)、执行类模板与 renderFinalTask。内置仅 migrate;新增模式 = 目标目录加
  一个协议完整的 .md 文件,零源码改动。-m 仅 init 接受(优先级 显式值 > 既有配置值 >
  缺省),持久化在 .opencode/auto/config.json 的 mode 键;run 读配置经 loadModes 查找,
  未注册名为环境错误退出码 1(报文列出当前支持的模式)。
- `--final-review [1-5]` 终审闭环(parseFinalReviewLimit 镜像 parseReviewLimit:缺省
  0 不启用、裸选项 2、显式值须 1..5 整数为审计轮上限含首轮 audit;与 --review/
  --early-review 可同现,二者无交互;--dryrun 不触发)。原任务全部 done 后进入
  audit → remediate → validate → finalize 状态机——终审阶段是入 PLAN.md 的真任务
  (T-F<k> 按追加顺序编号、`final: <stage>@<round>` 字段、不写 verify 字段),
  复用 runTask 全流水线:生成会话(renderFinalTask,旁路一次性)产出提案
  docs/final/plan-<stage>-r<N>.md → appendFinalTask 追加 → 主循环 next() 拾取执行 →
  报告末行协议路由(策略: 重构|修补|无;结论: 通过|差距 <描述>):策略无直达
  finalize(跳过 remediate 与 validate,原任务已有任务级 verify 兜底);remediate
  后生成同轮 validate;validate 通过生成 finalize、差距回退 audit@r+1(聚焦残余
  差距不全量重审),审计轮耗尽熔断 block 最后终审任务(残余差距与报告指针写入
  question,退出码 2)。**终审任务本身即检验、不对检验再做检验**:全部四阶段任务
  依 final 字段强制 review=0 且跳过任务级三段式验收(--early 随之自然失效),
  收尾后 driver 直接 markDone;报告缺失/协议非法不在任务级拦截,由路由解析报告时
  按协议异常 block 提示人工核查。
  中断恢复零新增状态(routeFinal 重新求值:未完成终审任务不生成新任务、下一阶段
  任务已存在不重复生成、提案已产出直接解析追加、done 但报告缺失/协议非法按阻塞
  提示人工核查;终审任务内部中断走既有 recallProgress/peekProgress);终审任务沿用
  waitBetween/统一提交/退出码语义,终审各阶段改动随其生成/执行会话的统一提交落账。
- 任务流水线(auto 模式):正文无检查项时先跑分解会话(产出 docs/T-NNN.subtasks.md,
  driver 注入检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN.report.md
  (只写产出摘要,不运行任务级 verify、不下验收结论)。
   任务内所有会话共用一条链:上一会话结束时上下文占比低于 50%、已用量低于
   配置 contextLimit 的一半(默认 32k tokens)且距其结束不超过 5 分钟(REUSE_IDLE_MS)则
   复用,否则新建(verify 脚本执行与判定/审核等耗时较久后自动换新会话);占比
   与用量由 watch 始终跟踪(与 --verbose 无关),拿不到模型上限时占比记 100 即
   总是新建;瞬时会话错误重试仍强制换新会话。会话标题与提交标题共用同一短标签
   方案且全部显式命名(不依赖服务端自动起题):新建会话以本阶段提交标题命名,
   复用会话跨阶段在结束时改名(renameSession),任务终态再改名为
   `T-NNN done|blocked|pending <标题>`——标题前缀即该会话的最新进度。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩):任务开始(首个会话前)
  写入、每次勾选后刷新、任务完成时删除;非完成结局(阻塞/回退 pending)写"中断
  备注"(退出原因/中断阶段/恢复方式)后保留,供人工查看与下次恢复(下次 runTask
  重建镜像时,备注要点经恢复提示词带给 AI);强制中断遗留文件同样下次重建。
  AGENTS.md 中 driver
  只维护五个固定标记块(指针 `opencode-auto:start`、验证 `opencode-auto:verify`、
  测试执行 `opencode-auto:test`、提交 `opencode-auto:commit`、维护规则
  `opencode-auto:maint`,各自幂等补写、除此之外永不改写;验证块随 config.verify、
  测试块随 config.testByDriver 补写/移除,见"verify 验收开关"与
  "--test-by-driver"条),
  不置只读(任务可更新其余内容,但经 agent 契约约束不得删除
  或改写任何标记块、更新其余内容须遵守维护规则块——保持精简 ≤150 行、路由到
  docs/agents/<主题>.md 存放跨任务工作流知识、更新不追加、只沉淀持久知识;check
  对行数超限输出 note);指令文件每个 provider turn 现场重读,且 AGENTS.md 指纹
  (mtime+size)变更时 server.syncAgents 在下一个新会话前重启 server 兜底。
- 进度恢复(应用重启后精确恢复中断):run 期间 driver 把当前阶段与执行链会话
  持久化到目标目录 .auto/progress.json({task, session, at, active, phase};阶段
  边界经 persistStage 写 active=false 总结态,执行链会话开始/结束经 attempt 刷
  active=true 半途态;旁路一次性会话不写);runTask 开始时 recallProgress 读回——
  active 且会话在 server 上仍存在 → 复用原会话继续(chain 直接 seed 该会话,
  与 `opencode -r` 同构,不设时间窗),否则新会话;**交接文件优先**——active
  恢复时交接文档已存在(ondemand 的 docs/<id>.handoff.md 或 handover-test 的
  <id>.testhandoff.md)则不复用旧会话,开新会话凭交接续跑(handoff `状态: 完成`
  时直接跳过整任务会话);`--new-session` 显式放弃复用(仅跳过复用、阶段精确
  重入保留,并立即把记录转 active=false);两种情况首个提示词均附加"[driver]
  中断后的继续"说明(读 CURRENT.md、git status/diff 核对进度,按 phase 给出
  下一步指引,不重做)。phase 支撑阶段级重入:verify 有持久化 run 记录跳过
  脚本重跑直接判定、stage=fix 凭持久化的判定差距原文(gap)重新下发修复提示
  续跑修复轮、off/ondemand 过执行阶段不重跑 executeWhole、review/planfix 有
  有效 fix.md 直接注入、decompose 先直读 subtasks.md;loop 启动经 peekProgress
  把 verify/review 阶段中断但已标 done 的任务置回 in_progress。SSE 事件流未
  收到会话结束事件即耗尽(server 故障/网络断开)时 abort 孤儿回合、按会话错误
  处理,不误判会话正常结束。任务完成 forgetProgress;优雅退出(非网络类
  blocked/incomplete)保留记录但清复用资格;网络类 blocked 保持 active 供恢复
  复用;伪任务(PLAN/AUTO)不记忆。
- opencode server 管理(src/server.ts manage):run 缺省 spawn `opencode serve`
  并托管生命周期;显式 url(--server / OPENCODE_AUTO_SERVER)时连接外部实例、不托管。
  client 为 Proxy,restart 换实例后既有引用自动生效。网络类会话错误(NETWORK_FAILURE
  匹配 Internal network failure / Network error 等)在换新会话重试前先 restart;
  外部实例 restart 返回 false 仅提示。agent 取 config.agent(缺省 `auto`,init 生成
  的契约 agent,`init --agent` 修订),显式指定时须为目标目录
  .opencode/agent/ 下已存在的 agent,run 前完整性检查兜底。
- `PLAN.md` 字段行(`  - key: value`)必须紧跟任务标题且连续;第一个非字段行(含空行)
  结束字段块。修改解析规则时同步更新 `test/plan.test.ts` 与 README 的格式说明。
- 运行时依赖外部 `opencode` CLI(`createOpencodeServer` spawn `opencode serve`),
  或通过 `--server` / `OPENCODE_AUTO_SERVER` 复用已有 server;二进制自身不含 opencode。
