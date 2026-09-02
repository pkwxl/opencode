# AGENTS.md

面向编码代理的包内说明;用户使用文档见 [README.md](./README.md)。

## 概述

`@opencode-ai/auto` 是一个私有 CLI(`opencode-auto`),读取目标目录的 `PLAN.md`,通过 `@opencode-ai/sdk` 的 v2 接口驱动 opencode 逐任务自动执行。注释与用户可见文案使用中文。

## 结构

- `src/index.ts` — CLI 入口:`init` / `run` / `check` / `status` 四个子命令与参数解析(含 `-p`/`-i`/`-m` 短选项)。宪法级项目属性经 init 固化到 .opencode/auto/config.json:run 分支开头统一拒绝已固化选项(mode/agent/context-limit/subtask/verify/idle-time/idle-max/commit/phases/source-dir/source-path/dest-dir 任一出现即退出码 1,报文给修订指引 `init --<flag> <值>` 或直接编辑配置;旧名 --verify-idle/--verify-max 单独拦截并提示已更名 --idle-time/--idle-max——看门狗现为 verify 与 test 脚本共用的通用参数),--commit-subtask 移除报文保留;run 经 loadProjectConfig 装载配置(坏文件退出 1)、legacyModeFallback 打旧位置提示、loadModes 按配置名解析 mode(未注册退出 1)、打印 formatProjectConfig 摘要后注入 runAll Opts(agent、contextLimit×1000、subtask/commit/verify 直传、idleTime/idleMax 换算、mode: ModeSpec);run 另解析 --test-by-driver/--handover-test(布尔,后者需前者,单独出现为用法错误退出码 1;testByDriver 启用时打一行协议横幅)。init 分支复用既有 parse*(parseCommit/parseSubtask/parseContextLimit/parseIdleTime/parseIdleMax)校验显式键(旧名 --verify-idle/--verify-max 出现即报更名错误),经 loadProjectConfig(含 legacy 回落)→ mergeProjectConfig(仅显式键覆盖,init 兼具创建与修订两种身份)→ saveProjectConfig,打印生效配置;-m 仅 init 接受,优先级 显式值 > 既有配置值 > 缺省。`--review`/`--early-review` 经 parseReviewLimit 校验——缺省 0 不启用、裸选项 3、显式值须为 1..10 整数;`--early` 为布尔修饰,review 未启用时单独出现为用法错误,`--early-review` 是 `--review n --early` 的快捷糖、与 `--review` 同现为用法错误;`--final-review` 经 parseFinalReviewLimit 校验(镜像 parseReviewLimit 风格)——缺省 0 不启用、裸选项 2、显式值须为 1..5 整数(审计轮上限),与 `--review`/`--early-review` 可同现;`--permission` 经 parsePermission 校验,缺省/裸选项 ask-deny,非法取值均退出码 1;`check` 调 src/check.ts 检查 AGENTS.md/PLAN.md 违背验证/提交原则的描述,命中退出码 1;`status` 在任务清单前打印配置摘要(配置非法仅提示、不阻塞);phases ≠ "m" 时 run(配置摘要后)与 status 另打印 `阶段: a✓ d✓ m▶ t v k` 进度行(formatPhases;台账非法时 run 仅打提示、硬失败在 loop 预检,status 亦仅提示),init 对 phases ≠ "m" 的项目以 templates/PLAN.scaffold.md 空模板产出 PLAN.md(交给阶段规划会话填充),既有 PLAN.md 处于占位态(isPristinePlan: 无任务,或全 pending + 零 attempts + 无任何字段行)时一并替换、已填真实任务保留;`init` 对 `.opencode/agent/auto.md` 与模板不一致时总是替换,并维护 .gitignore(忽略 tmp/ 与 .auto/),init 亦经 usePromptLibrary 装载目标目录提示词覆盖(校验失败退出码 1);`-p/--prompt` 把项目意图整写覆盖到 .opencode/auto/brief.md(init 去 AI 化,不启动任何会话;重复 init -p 覆盖重写,无 -p 保留既有),结束语按 phases 分两态("m" 维持"编辑 PLAN.md"现状,其余提示开始 `<首个未完成阶段>(<中文名>)阶段规划`);`--phases`/`--source-dir`/`--source-path`/`--dest-dir` 亦仅 init 接受(经 parsePhases 与成对/相对路径/存在性校验,source 两键成对、任一给出即整体覆盖;布局约定: 位置参数是 driver 工作目录,迁移源在 `<工作目录>/<source-dir>/<source-path>`、迁移目标在 `<工作目录>/<dest-dir>`,三键均须为不含 .. 的相对路径,dest-dir 独立固化/修订、不校验存在性;台账非空时改 --phases 须满足前缀护栏——已完成阶段构成新值前缀,否则退出码 1 并指引人工修订台账;phases 含 v 而 verify 未启用时打 note 一次);`--interactive` 与 `--verbose` 互斥检查在此。
- `src/config.ts` — 项目配置层(.opencode/auto/config.json:版本化、随仓库共享、人工可编辑,未知键忽略前向兼容):ProjectConfig 全键(mode/agent/contextLimit/subtask/verify/idleTime/idleMax/commit/phases/source/destDir;看门狗键由 verifyIdle/verifyMax 更名而来,旧键仅在新键缺失时回落读取)与 CONFIG_DEFAULTS(phases 缺省 "m" = 无阶段声明,source/destDir 缺省 undefined);loadProjectConfig 读取校验(文件缺失取缺省并做 legacy 回落——旧 .auto/config.json 的 mode 仅在新文件缺失时生效;坏 JSON/键值越界/mode 未注册/phases 非法/source 形状错误/destDir 非相对路径 throw 中文报错含键名与期望,CLI 转退出码 1,run 与 init 均经此入口);mergeProjectConfig 仅显式键覆盖(amend 语义);saveProjectConfig 普通整写;formatProjectConfig 一行摘要(run 启动横幅与 status 共用,末尾含阶段);legacyModeFallback 供 run 打"模式沿用旧位置"提示。
- `src/loop.ts` — 任务循环:取下一个未完成任务执行;启动时 `resetInProgress` 把上次运行中断遗留的 in_progress 重置为 pending,并经 peekProgress 把进度记录处于 verify(--review 启用时)/review 阶段但已被标 done 的任务置回 in_progress(否则 next() 跳过、审核永不补跑);runAll 开头经 usePromptLibrary 装载目标目录提示词覆盖(校验失败返回 1);任务开始横幅;`ensurePointer` 在启动会话前确保 AGENTS.md 指针块、验证/提交原则块与维护规则块存在(四个独立标记块,各自幂等补写;维护规则块=MAINT_RULE 常量:≤150 行/路由到 docs/agents//更新不追加/只沉淀持久知识,见设计文档 D 节);`ensureGitignore` 确保 tmp/ 与 .auto/ 被 .gitignore 忽略(非 git 目录不动);启动时经 pendingChanges 检测工作区遗留未提交改动并提示会被统一提交纳入;run 前完整性检查(.opencode/agent/<agent>.md 缺失直接报错退出并提示 init 恢复,与模板不一致仅警告);`--dryrun` 权限预检;任务边界统一提交(完成/阻塞/回退 pending 各一次,经 commitTree);verbose 变更文件监视(基于 git status,含子目录中的嵌套 git 仓库);子任务进度上报(每 10 分钟);`--review`/`--early`/verify/`--permission`/idleMs/maxMs/testByDriver/handoverTest/mode/server 句柄透传至 runTask(verify 未启用而 --early 启用时打降级提示);`--final-review` 终审推进挂点(advanceFinal: runTask 完成且任务带 final 标记后路由追加下一任务;next() 为空且终审未完成时打横幅"进入终审闭环"并续跑循环;熔断/报告异常 block 对应终审任务退出码 2);`--interactive` 旁路控制器的创建/回收与 waitBetween 接入;阶段化流程(runAll Opts 加 phases/source/destDir,来自配置,`phases === "m"` 走上述原路径零改动):manage 前 routePhase 预检(台账非法等环境错误提前退出 1、不拉 server),主循环抽为 `runTaskLoop(phase)` 闭包(phase 透传 runTask 支撑 v 阶段豁免;finalGate = phase === "m" 才挂 `--final-review` 终审推进,其余阶段忽略并打一次提示),`runPhaseLoop` 按 routePhase 循环推进——`plan` → planPhase(先 snapshotDocs,再组装 handovers——台账中早于当前阶段且已 done 的各阶段归档 handover.md 预拼接,缺文件标注"(无交接文档)",注入纪律只传蒸馏产物不传前序原始 docs/,以 requireArtifact 骨架开阶段规划会话、产物 = 已填充的 PLAN.md,会话期间 allowWrite(PLAN.md)/finally reprotect,提交 stage=phase-plan)/ `execute` → runTaskLoop / `handover` → handoverPhase(先开蒸馏会话 requireArtifact 产出归档目录 handover.md——四小节协议经 validHandover 校验、reset 清文件重试、受阻返回 2,提交 stage=phase-handover;再 archivePhaseDocs → PLAN.md 拷贝归档后重置空模板 → appendLedger → AGENTS.md >150 行仅 note 不改写 → 统一提交 stage=phase-transition)/ `complete` → 退出 0;plan 路由对 k(知识提炼)阶段走专属分支——不开规划会话、不填 PLAN.md,先 extractKnowledge 知识提取旁路会话(已产出非空文档则幂等跳过;失败仅打 ⚠ 警告不污染退出码、不刷新 docs 快照),随后照常 handoverPhase("k");规划/蒸馏会话受阻均返回 2;交接中断恢复: 归档目录内已有 PLAN.md 而台账缺该字母 → 补台账+提交后续跑(各步幂等)。
- `src/interactive.ts` — `--interactive` 旁路:常驻 readline 把回车输入经 promptAsync(fire-and-forget)注入当前活动会话(attach 由 runner 在每个会话建立/复用时调用;无活动会话丢弃并提示);ask/任务间暂停的人工等待经同一输入行接收(空行原样上交给调用方解释);stdin 关闭后回落非交互行为;io 可注入供测试。
- `src/runner.ts` — 单任务流水线:subtask=auto 分解会话(恢复时先直读 docs/<id>.subtasks.md,有效则直接注入不开会话)→ 逐子任务会话(会话结束后 driver 直接勾选,验收不在子任务级进行);--test-by-driver 测试执行协议(与 verify 正交)——执行类会话(子任务/整任务 executeWhole/验收修复轮)统一走 runExecSession 包装: testByDriver 未启用直通 runSession,启用时构造 TestRun 状态(dir/tmp/handoffFile/handover/limit/seq,seq 扫描 tmp/test.<n>.sh 接续、历史全量保留)并包装交接循环(watch 报 testHandover 后以 renderTestContinue 续跑提示开新会话,交接不设硬上限、连续超 10 次附 AUTO-FIXME 评估提醒);协议挂点在 watch 的 idle 事件: tmp/test.sh 存在即待执行请求 → executeTest 按序归档执行(输出 test.<n>.out/err,共用 idleTime/idleMax 看门狗)→ steer renderTestResult 回原会话,失败且 handoverTest 且 used ≥ contextLimit 时改为 steer renderTestHandover 要求写 docs/<id>.testhandoff.md(缺失带反馈重试一次仍缺失隐性阻塞);attempt 开始时清除遗留待执行脚本;pipeline 在非恢复续跑时清除陈旧 testhandoff.md(镜像 ondemand 语义);subtask=off 单会话完成整个任务,验收/审核差距不做修复重跑,任务回退 pending;subtask=ondemand 单会话执行、上下文达到配置 contextLimit 时 steer 交接提示、新会话从 docs/<id>.handoff.md 续跑;收尾会话 → verifyTask 三段式验收(config.verify 启用时;缺省略过验收、收尾后直接 markDone 不写 verified,--review 审核改为串行,--early 降级失效)(脚本准备 → driver 执行 → 独立判定会话;判定会话禁止执行验证脚本/命令,可替换指定脚本后结论`重验`,driver 重新执行回传输出,至多 REVERIFY_ROUNDS=3 轮;判定会话另被授权更新后续未完成任务的 verify 字段——会话期间 allowWrite(PLAN.md)、结束后校验,越权编辑整体还原;差距反馈回执行会话修复,最多 FIX_ROUNDS=3 轮,off 模式直接回退 pending)→ `--review` 下 reviewTask 质量审核与 planReviewFix 修复规划(外层轮循环,执行阶段仅首轮进入;`--early` 下审核经 verifyTask 挂点在脚本执行窗口并行启动、结论随 done 带回,外层不再独立调用 reviewTask);旁路会话产物缺失"带反馈重试一次再隐性阻塞"的骨架统一在 requireArtifact;会话链复用(占比 <50%、用量 < 配置 contextLimit 且距上一会话结束 ≤5 分钟三者同时满足,REUSE_IDLE_MS;旁路一次性会话的链不带 phase、不写进度记录)、事件监听、提问自动答复(AUTO_ANSWER 含决策记录与 AUTO-DECISION 标注要求)、权限请求按 --permission 四档处理(dryrun 下自动拒绝但不中断)、隐性阻塞检测;新建会话前经 server 句柄 syncAgents(AGENTS.md 有更新则重启 server),网络类会话错误(Internal network failure / Network error 等)先 restart 换新 server 实例再换新会话重试;进度记录(.auto/progress.json,经 persistStage 在阶段边界推进、attempt 在执行链会话开始/结束时刷新 active)支撑中断精确恢复:runTask 开头 recallProgress——active 且 30 分钟窗内且会话存活则复用原会话,否则新会话,均附按 phase 的下一步指引;阶段级重入(verify 有持久化 run 跳过重跑直接判定、off/ondemand 过执行阶段不重跑 executeWhole、review/planfix 有有效 fix.md 直接注入);CURRENT.md 在任务开始时即写入,每次勾选后刷新,任务完成在收尾中删除;非完成结局(阻塞/回退 pending)写"中断备注"(原因/阶段/恢复方式)后保留,网络类 blocked(会话错误重试耗尽)保持 active 记录走 30 分钟窗复用;`runOnce` 独立会话(dryrun,不做会话后提交);verbose 明细走 vlog,askHuman 在 interactive 下改由旁路输入行接收;Opts 的 mode 透传至各执行类 render,终审任务(带 final 字段)依 final、v(验收)阶段任务依 Opts.phase(loop 透传的当前阶段字母)共用同一豁免路径强制 review=0 且跳过任务级验收(本身即检验,--early 随之自然失效;报告异常由路由时 block 兜底,v 豁免为内部标记、不写 final 字段),requireArtifact 导出供 src/final.ts 的生成会话复用;会话后统一提交挂点:执行链各阶段(分解注入/子任务勾选/整任务/修复轮/收尾)在状态写入后、旁路一次性会话(经 requireArtifact 的 spec.commit)在会话结束后,均经 afterSession 调 commitTree。
- `src/resume.ts` — 进度恢复记录:saveProgress/recallProgress/peekProgress/forgetProgress 维护目标目录 .auto/progress.json({task, session, at, active, phase}),RESUME_WINDOW_MS=30 分钟;phase 覆盖 decompose/whole/subtasks/wrapup/verify{stage,round,rechecks,replaced,run?,audit?}/review{round,stage};recall 不做窗口判定(窗口与存活判定在 runner),旧版 .auto/session.json 兼容读取(视为半途会话、无阶段);peek 供 loop 把验收/审核阶段中断但已标 done 的任务置回 in_progress。
- `src/plan.ts` — `PLAN.md` 解析与原子编辑(写 tmp 再 rename);driver 侧状态函数(setSubtasks/tick/appendSubtasks/markDone/setStatus/resetInProgress)与任务级 verify 命令提取(verifyCommand,供 resolveVerifyScript 判定脚本来源);终审支持——Task 解析 final 字段(FIELD 行通用解析,edit 重写时随全部字段保留)、parseFinalMark(`<stage>@<round>` 校验)与 appendTask(文件尾追加完整任务块,原子写、复用 allowWrite/reprotect,重复 ID 报错)。
- `src/phases.ts` — `--phases` 阶段注册表(设计文档 docs/phases-design.md A/C 节,固定六字母不开放自定义):Phase/PHASE_ORDER("admtvk")/phaseText 中文名;parsePhases(非空、字母 ∈ admtvk、不重复、含 m、为 admtvk 子序列——严格递增下标一次遍历,非法返回 null);readLedger 解析 docs/phases.md 台账(推导式状态载体:行协议 `- [done] <letter> <名称> → <归档目录>`,容忍空行与 # 行,字母越界/重复/协议行无法解析 throw 给人工修订指引;文件缺失 = 空台账)+ appendLedger(查重后追加,重复调用幂等;文件缺失带头部注释创建);PHASE_SLUGS/phaseArchive(归档目录 `docs/phases/<letter>-<slug>/`,a-analysis/d-design/m-migrate/t-testing/v-acceptance/k-knowledge);routePhase(纯路由,由台账+PLAN.md 推导 complete/plan/execute/handover/blocked——blocked = 台账非法或记录了 phases 之外的字母,CLI 转退出码 1);formatPhases(阶段进度行 `a✓ d✓ m▶ t v k`,run 横幅与 status 共用);renderPlanScaffold(PLAN.scaffold.md 空模板,verify 条件渲染);snapshotDocs/archivePhaseDocs(阶段开始写 .auto/phase-snapshot.json,交接按"文件名+mtime"差异把 docs/ 变更移入归档目录;排除 docs/phases/、docs/phases.md、docs/agents/,快照缺失退化为移动 A.1 产物目录与 docs/T-*.md);HANDOVER_SECTIONS/validHandover(交接文档四小节协议——关键决策/约束与坑/下一阶段必读清单/产物索引,蒸馏会话产物的 collect 校验用,标题行逐字匹配)。
- `src/prompt.ts` — 提示词上下文组装层:文案全部在 `templates/prompts/*.md`(共享片段在 `_partials.md`,经 src/template.ts 渲染),这里把 plan/task/运行信息组装为模板变量;render* 签名稳定(runner/loop/final 调用点不感知模板机制);VERDICT_FILE(`.auto/verify.md`)与 REVIEW_FILE(`.auto/review.md`)判定文件路径、VerifyRun 运行信息类型(含看门狗 timeoutReason);stageText 终审阶段中文名(横幅/loop/final 共用);handoffFile/renderHandoffSteer 交接提示;testHandoffFile(`docs/<id>.testhandoff.md`,与 ondemand handoff 分离命名)与 renderTestResult/renderTestHandover/renderTestContinue 三段测试协议文案(模板 test-result/test-handover/test-continue,steer 反馈与交接后续跑说明;TestRunInfo = VerifyRun+seq);终审四阶段(FinalStage)的职责与报告产出要求内联在 final-task.md 的条件段,renderFinalTask 只传 stage 标志位;renderPhasePlan({phase, brief, handovers, source, destDir, mode, verify, finalReview}) 组装阶段规划会话上下文(按 phase 切六阶段职责条件块,brief/handovers(前序交接预拼接)/source.dir/source.path/destDir/mode.init 为输入变量,finalReview 的"终审预留"提醒仅 m 阶段生效——门控在函数内,调用点不必判断);renderPhaseHandover({phase, archive, next, verify}) 组装阶段交接蒸馏会话上下文(archive = phaseArchive(phase),next = 下一阶段"字母 中文名"或 undefined,k 阶段供人工归档措辞);renderKnowledge({file, mode}) 组装 k 阶段知识提取会话上下文(来源=阶段台账与各阶段归档目录,章节骨架/质量约束内联在 knowledge.md,mode.exec 作场景背景注入)。
- `src/template.ts` — 提示词模板装载与渲染:内置模板经 `with { type: "file" }` 嵌入(embedded 注册表集中登记),readFileSync 在编译产物中同样可读 `/$bunfs` 路径;`usePromptLibrary(dir)` 装载目标目录 `.opencode/auto/prompts/` 同名覆盖(`_partials.md` 按节名合并片段),协议敏感模板(judge/review/verify-script-gen/review-fix/decompose/handoff-steer/final-task/phase-plan/phase-handover)覆盖时做关键协议内容校验、缺失即抛错(CLI 转退出码 1);语法 `{{var}}`/`{{#if x}}`/`{{^x}}`/`{{> 片段}}`(块标签独占一行整行吞掉,片段独占一行保留行尾换行并把行首缩进应用到每一行,行内引用仅应用到第二行起);无循环语法——清单类数据由调用方预拼接为字符串。
- `src/mode.ts` — `-m/--mode` 模式层,模式以文件模板管理:内置 `templates/modes/<name>.md`(编译期嵌入),目标目录 `.opencode/auto/modes/<name>.md` 可新增或覆盖(新增模式零源码改动);`parseModeFile` 解析协议(首行 `# <name>` 须与文件名一致、五节齐备: init/exec/final: audit|validate|finalize,缺节/未知节/空节报错),`loadModes(dir?)` 合并内置与目标目录(文件名须匹配 `^[a-z][a-z0-9-]*$`);ModeSpec 三段文案注入阶段规划会话(init 导语经 renderPhasePlan 的 modeInit 变量,P2 已接线)、执行类模板与 renderFinalTask。模式持久化经 src/config.ts 的 mode 键(旧 readPersistedMode/writePersistedMode 已随 .auto/config.json 职责并入 config.ts 删除)。
- `src/knowledge.ts` — k(知识提炼)阶段的知识提取编排(phases-design.md P4/D.4,整体认领 fixme-knowledge-design.md 的 --extract-knowledge):knowledgeFile 默认输出路径 docs/migration-kb/migration-<时间戳>.md(时间戳与 run 日志同款)、existingKnowledge 幂等检查(目录内存在非空 .md 即视为已提取)、extractKnowledge(requireArtifact 骨架,伪任务 PLAN,collect 从宽 = 文件存在且非空,提交 stage=knowledge);失败返回 failed 由 loop 打 ⚠ 警告、不污染退出码。
- `src/final.ts` — `--final-review` 终审闭环状态机(设计文档 B/C 节,纯路由函数、无新增持久化状态):finalProposalFile/finalReportFile 产物路径(docs/final/ 下提案与各阶段报告);parseStrategy/parseConclusion 解析报告末行协议(策略: 重构|修补|无;结论: 通过|差距 <描述>),parseProposal 解析提案文件;routeFinal 由(带 final 标记的任务及其状态,docs/final/ 产物)推导路由并含幂等重建 C.1..C.5(未完成终审任务不生成新任务、下一阶段任务已存在不重复生成、提案已产出未追加直接解析追加、done 但报告缺失/协议非法按阻塞提示人工核查、final 字段非法 block);appendFinalTask(T-F<k> 按追加顺序编号、final: <stage>@<round> 字段、不写 verify 字段——终审任务强制跳过任务级验收,提案 verify 行兼容剥离、一律忽略);generateFinalTask 经 runner 的 requireArtifact 骨架开旁路生成会话产出提案。
- `src/git.ts` — driver 统一提交机制:收回 AI 会话的提交权,任何会话结束后由 driver 经 commitTree 递归提交全部改动(repoRoots 发现目标目录所在仓库与全部嵌套 .git 子仓库,深度优先先子后父);提交信息 = 中文标题行(任务编号 + 阶段/子任务描述,子任务条目省略任务标题,超 100 字截断)+ 机器可读 trailer(Auto-Task/Auto-Stage,目标仓库另记 Auto-Nested 嵌套仓库路径与 SHA);无改动的仓库跳过、非 git 环境整体跳过;单仓库失败仅警告不阻塞(下一次提交全量 add 清扫连带);仓库未配置 user.email 时以固定身份兜底;pendingChanges 供 loop 启动时检测遗留未提交改动并提示。
- `src/check.ts` — `check` 命令逻辑:启发式扫描目标目录 AGENTS.md 与 PLAN.md 中要求会话亲自运行验证脚本/命令、或要求会话执行 git 提交的语句(否定句、driver 归属句、PLAN 字段行与 opencode-auto 标记块不算),返回 findings(file/task/line/text)与 notes(缺验证/提交原则块提示、AGENTS.md 超 150 行的精简提示——note 不进 findings、不影响退出码);验证类扫描与缺验证原则块提示以 config.verify 启用为前提(未启用时配置非法也按未启用处理并给 note),提交类始终进行;命中退出码 1。
- `src/verify.ts` — verify 脚本机制层(纯逻辑,不依赖 SDK 与 runner):verifyTmpDir(目标目录下 `tmp/` 子目录,工作目录内可直接读,避免 /tmp 权限问题;loop 的 ensureGitignore 保证不进仓库)、resolveVerifyScript(依 verifyCommand 判定 existing/wrapped/generate 三支)、runVerifyScript(cwd=目标目录执行,stdout/stderr 整写输出文件——缺省 tmp/verify.out 与 verify.err,opts.out/err 可指定绝对路径供 --test-by-driver 的 test.<n>.out/err 按序归档共用;进度看门狗——轮询两个输出文件的大小,任一增长即重置计时,持续 idleTime(缺省 10 分钟)无增长才 kill、退出码记 124 且 timeoutReason=idle,idleMax(缺省不设)为绝对上限兜底且 timeoutReason=max)。
- `src/protect.ts` — 状态文件只读保护:`run` 期间 PLAN.md/CURRENT.md/opencode.json
  与 .opencode/auto/config.json 置 0o444(AGENTS.md 不在其列,任务可更新它;人工修订
  配置须在 run 外),driver 写入经 allowWrite/reprotect 临时放行,runAll 的 finally 恢复 0o644。
- `src/server.ts` — opencode server 管理:manage() 缺省 spawn `opencode serve` 并托管生命周期(需 PATH 上有 opencode CLI),显式 url(--server / OPENCODE_AUTO_SERVER)时连接外部实例、不托管;client 为指向当前实例的 Proxy(restart 后既有引用自动生效);syncAgents 依 AGENTS.md 指纹(mtime+size)变更重启;restart 供网络故障换新实例,外部实例返回 false。
- `src/log.ts` — 输出双通道:verbose(文件记录级别)与 foreground(终端明细/时间戳)分离,
  `setVerbose` 同开同关、`setInteractive` 只开文件记录;`log` 始终上终端、`vlog` 为 verbose 明细
  (interactive 下只进文件);`setInput` 注册交互 readline 后 log 打印先清输入行再重绘;run 时把全部
  输出同步写入目标目录 `.auto/logs/run-<时间戳>.log`(writeSync 逐条直写)。
- `templates/` — `init` 复制的模板(`PLAN.md`、`PLAN.scaffold.md`——阶段化流程(phases ≠ "m")下 init 产出的 PLAN.md 空模板,无任务标题行、verify 条件渲染,与交接重置态共用;`opencode.json`、`.opencode/agent/auto.md`——契约含"不得删除或改写任何 opencode-auto 标记块、更新其余内容遵守维护规则块"条款,防漂移断言在 test/prompt.test.ts);`templates/prompts/` 为 18 个会话提示词模板 + `_partials.md` 共享片段(编译期嵌入、运行期渲染,init 不复制,目标目录 `.opencode/auto/prompts/` 同名覆盖);`templates/modes/` 为内置模式文件(目标目录 `.opencode/auto/modes/` 同名覆盖/新增)。
- `docs/verify-review-design.md` — 第三阶段(verify 三段式与 --review 审核循环)与第四阶段(--early 并行审核,以 F 节为唯一设计基准)的设计基准:已确认决策、接口约定与流水线伪代码;G 节为判定会话执行限制与重验协议、H 节为中断恢复/看门狗/判定会话 verify 字段授权的后续修订基准。
- `docs/mode-final-review-design.md` — `-m/--mode` 模式层(src/mode.ts 注册表,提示词级场景引导)与 `--final-review` 终审闭环(终审阶段为入 PLAN.md 的真任务 T-F\<k\>,Audit→Refactor/Patch→Validate→Finalize 状态机,末行结论协议路由 + 审计轮上限熔断)的设计基准:已确认决策、状态机与恢复规则、文件级改动清单。
- `docs/fixme-knowledge-design.md` — `--track-fixme` 设计偏差追踪(AUTO-FIXME 注释锚点、driver 确定性扫描产出 tmp/fixme-scan.md、终审 audit 报告末行 `FIXME: CRITICAL=… WARN=… INFO=…` 协议 + CRITICAL 门禁不路由 remediate、finalize 生成前复扫回退 audit@r+1)与 `--extract-knowledge` 迁移知识沉淀的设计基准:已确认决策、本期/未来范围切分、验收标准映射与文件级改动清单。**--extract-knowledge 已按文首"P4 并入阶段化流程"修订被 --phases 的 k(知识提炼)阶段整体认领实现(该 CLI 选项不存在);--track-fixme 仍按 §H P1/P2 待实现,实现前 CLI 不接受该选项。**
- `docs/phases-design.md` — `--phases` 阶段化流程(a 分析→d 设计→m 迁移实现→t 测试→v 验收→k 知识提炼,取值为 admtvk 子序列且含 m、仅 init 固化)与迁移参数(--source-dir/--source-path/--dest-dir,源与目标均为相对工作目录的相对路径、经 dest-dir 隔离 driver 工作目录与迁移产出)、init 去 AI 化(-p 落 .opencode/auto/brief.md、每阶段规划会话消费)的设计基准:已确认决策、docs/phases.md 台账推导式状态(人工回退规程)、routePhase 伪代码、阶段交接(归档+重置+蒸馏)协议与 P1..P4 分期。**P1(配置与 CLI 面:phases/source 键、init 去 AI 化、run 拒绝清单、前缀护栏、brief.md)与 P2(阶段骨架:台账读写+routePhase、run 阶段循环、阶段规划会话 phase-plan.md、交接机械部分归档+重置+台账+统一提交、run/status 阶段进度行、--final-review 仅 m 阶段挂接)与 P3(蒸馏会话 phase-handover.md 产出 handover、handovers 注入下一阶段规划会话、v 阶段验收豁免接线)与 P4(k 阶段整体认领 --extract-knowledge,行为规格见 D.4)已全部实现。**
- `docs/init-config-agents-design.md` — init 项目配置固化(run 侧宪法级选项 -m/--agent/--context-limit/--subtask/--verify/--verify-idle/--verify-max/--commit 迁移至 init,持久化 .opencode/auto/config.json,merge/amend 语义、legacy .auto/config.json 回落、run 拒绝已固化选项)与 AGENTS.md 维护规则块(第四标记块 opencode-auto:maint:≤150 行/路由不复制到 docs/agents//更新不追加/只沉淀持久知识;agent 契约同步、check 行数 note)的设计基准:选项分类总表、配置 schema、兼容迁移矩阵、文件级改动清单。P1..P4 分期已全部实现(配置层 src/config.ts、CLI 选项面切换、AGENTS.md 维护规则块与文档)。**注: 看门狗选项后更名为 --idle-time/--idle-max(配置键 idleTime/idleMax,verify 与 test 脚本共用,旧键回落读取),见 --test-by-driver 条。**
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
- **模板必须保持 `with { type: "file" }` 导入**,这是编译时嵌入二进制的唯一方式;
  不要改回 `new URL("../templates/", import.meta.url)` 读目录,否则编译产物里路径
  会变成 `/$bunfs/...` 导致 `init` 失败。分两类登记:init 复制的模板在 `src/index.ts`
  顶部导入并登记到 `init` 的 `templates` 映射;提示词/模式模板分别在
  `src/template.ts` 的 embedded 注册表与 `src/mode.ts` 导入(新增内置文件时同步加
  一条 `type: "file"` 导入)。用户自定义/覆盖走目标目录,无需改源码。
- `src/templates.d.ts` 为 `*.md` / `*.json` 文件导入提供路径字符串类型;
  `tsconfig.json` 里 `resolveJsonModule: false` 是后者生效的前提,勿移除。

## 行为约定(改动前必读)

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
- 下发任务失败(UnknownError)的常见根因是目标目录缺少 `.opencode/agent/<agent>.md`
  (服务端错误体不含根因):run 前完整性检查拦截该情况;运行中发生时 driver 在
  阻塞问题后追加恢复提示(检测依赖 Opts.dir,run/init/dryrun 均须传入)。
- 统一提交(收回 AI 提交权):任何会话结束且 driver 完成状态写入后,由 driver 经
  src/git.ts 的 commitTree 递归提交全部改动(先嵌套 .git 子仓库、后目标目录所在
  仓库,路径发现不依赖 git status——嵌套仓库通常被父仓库忽略),git 历史即 AI
  变更的审计轨迹、回滚粒度 = 会话。提交信息 = `任务编号 [任务标题]: 阶段` 标题行
  (子任务条目为 `任务编号: 子任务 <n> <标题>`、省略任务标题)+ `Auto-Task`/
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
- subtask 三档(config.subtask,init --subtask 修订):`auto`(缺省;分解会话 → 逐子任务)/
  `off`(单会话完成整个任务;
  验收差距不做修复重跑,任务回退 pending 等人工改进)/ `ondemand`(单会话执行,
  watch 在已用量达到配置 contextLimit 时向进行中会话 steer 交接提示——每会话一次,
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
- --test-by-driver/--handover-test(与 verify 正交的测试执行协议): 前者把实现环节的测试执行权收归 driver——执行类会话(子任务/整任务/验收修复轮;分解/收尾/判定/审核等旁路会话与 --dryrun 不适用)不在会话内直接运行测试,把测试脚本写入 tmp/test.sh(存在即待执行请求,重写即再次请求),driver 在会话 idle 时按序归档为 tmp/test.<n>.sh(全量保留、编号跨运行接续)并移除原文件后在目标目录执行(共用 idleTime/idleMax 看门狗),stdout/stderr 整写 tmp/test.<n>.out/err,退出码/耗时/输出路径经 steer 注入同一会话由 AI 直读文件判断(退出码非 0 不由 driver 判定);重跑同一测试 = 复制归档脚本回 tmp/test.sh。每个执行会话入口清除遗留待执行脚本。后者(需前者)在测试失败(非零退出或看门狗超时)且会话 used ≥ contextLimit 时改要求 AI 写 docs/<id>.testhandoff.md 后结束会话(缺失带反馈重试一次仍缺失隐性阻塞),driver 开新会话以续跑提示(先读交接文档与最近输出)继续,不设硬上限、连续超 10 次提醒评估是否陷入无法解决的问题(可 AUTO-FIXME 标注遗留后继续);非恢复续跑时清除陈旧交接文档。提示词协议段经 subtask/whole/fix 模板的 testByDriver/handoverTest 条件块注入,steer 文案在 test-result/test-handover/test-continue 模板(无 driver 解析协议,覆盖校验不做标记要求)。
- verify 三段式(config.verify 启用时):verify 的处理权在 driver,验收只在任务级做一次——收尾会话后:
  ① 脚本准备(resolveVerifyScript 依 verifyCommand 三分支:`command:` 为单个存在
  且可执行的文件路径 → existing 直接使用;普通命令行 → wrapped,driver 包装
  tmp/verify.sh——首行 shebang 其后原命令原文,不加 set -e 等额外语义,
  每次幂等覆盖;自然语言或缺失 → generate,先开一次性旁路脚本生成会话产出脚本,
  产物约定名 tmp/verify.sh,跨修复轮复用,V1 不自动重生成);② driver 执行
  (runVerifyScript:cwd=目标目录,有执行位直接 spawn 否则经 bash;stdout/stderr
  整写 tmp/verify.out 与 verify.err,执行前 truncate;进度看门狗——输出文件持续
  无增长达 idleTime(缺省 10 分钟)才 kill、code 记 124 且 timeoutReason=idle,
  idleMax(缺省不设)为绝对上限兜底;执行完毕的运行记录持久化到进度记录,
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
  配置 contextLimit(默认 64k tokens)且距其结束不超过 5 分钟(REUSE_IDLE_MS)则
  复用,否则新建(verify 脚本执行与判定/审核等耗时较久后自动换新会话);占比
  与用量由 watch 始终跟踪(与 --verbose 无关),拿不到模型上限时占比记 100 即
  总是新建;瞬时会话错误重试仍强制换新会话。
- CURRENT.md 是当前任务镜像(每会话必读,抗上下文压缩):任务开始(首个会话前)
  写入、每次勾选后刷新、任务完成时删除;非完成结局(阻塞/回退 pending)写"中断
  备注"(退出原因/中断阶段/恢复方式)后保留,供人工查看与下次恢复(下次 runTask
  重建镜像时,备注要点经恢复提示词带给 AI);强制中断遗留文件同样下次重建。
  AGENTS.md 中 driver
  只维护四个固定标记块(指针 `opencode-auto:start`、验证 `opencode-auto:verify`、
  提交 `opencode-auto:commit`、维护规则 `opencode-auto:maint`,各自幂等补写、
  除此之外永不改写;验证块随 config.verify 补写/移除,见"verify 验收开关"条),
  不置只读(任务可更新其余内容,但经 agent 契约约束不得删除
  或改写任何标记块、更新其余内容须遵守维护规则块——保持精简 ≤150 行、路由到
  docs/agents/<主题>.md 存放跨任务工作流知识、更新不追加、只沉淀持久知识;check
  对行数超限输出 note);指令文件每个 provider turn 现场重读,且 AGENTS.md 指纹
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

<!-- opencode-auto:commit:start -->
提交原则: 会话结束后由 driver 递归统一提交全部改动(先嵌套子仓库后本仓库),
提交信息携带任务编号与阶段;任何会话不要执行 git commit/amend/rebase 等提交
类命令,也不要修改提交历史。需要留档的变更背景写入 docs/ 文档,由 driver 的
提交一并纳入。任务描述与项目规范不要出现与此相违背的指示(可用
opencode-auto check 检查)。
<!-- opencode-auto:commit:end -->
