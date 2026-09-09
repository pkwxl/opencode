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
  -m/--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit/--auto-number/--no-auto-number/--phases/--source-dir/--source-path/--dest-dir 仅
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
- --auto-number/--no-auto-number(config.autoNumber,缺省 true,--no-auto-number 为退出
  开关;宪法级选项,init/continue 修订,run 拒绝;两开关同现且均未带 =false 为用法错误;
  设计文档 docs/auto-number-design.md):启用后任务编号(T-NNN)在目标目录**永不重复**——下一可用
  编号持久化在 .auto/next-task(内容仅为一个正整数,driver 维护;.auto/ 已被 gitignore,
  新克隆天然缺失)。唯一消费点是阶段规划会话:planPhase 先 ensureNumbering 确保记录
  就位,把记录值作为编号起点注入规划提示词(替代"自 T-001 起"文案),collect 校验全部
  任务编号 ≥ 起点(复用已占用编号视为无效产出,带反馈重试一次仍失败隐性阻塞退出 2),
  成功后记录推进到本次最大编号 + 1(只增不减);phases = "m" 无规划会话,开关不产生
  效果(init 时该组合打一次 ℹ 提示)。记录缺失时先恢复再继续:确定性下限(现存
  PLAN.md/阶段与轮次归档 PLAN/docs 产物文件名中的最大编号 + 1)为 1(全新项目)直接
  写 1 不开会话;大于 1 开旁路一次性 AI 恢复会话(模板 number-recovery.md)通读归档
  与 git 提交历史推导下一编号并写入记录(git 历史可发现产物已删除的编号),driver 以
  下限校验其产出(小于下限无效,重试一次仍失败隐性阻塞退出 2),恢复产物随会话统一
  提交(stage=numbering)。T-F<k> 终审编号是独立推导命名空间,不参与自动编号记录。
- 阶段循环(config.phases ≠ "m",P1..P4 已接线;设计文档 phases-design.md D/E/F 节):阶段
  状态是推导式的,routePhase 只读阶段台账(新布局轮内 docs/R-NN/phases.md,旧布局根
  docs/phases.md)与 PLAN.md(零新增持久化状态),
  run 据此循环——PLAN.md 为空模板 → 开阶段规划会话(旁路一次性,复用 requireArtifact
  骨架,产物 = 已填充的 PLAN.md;仅此会话经 allowWrite 被授权写 PLAN.md,受阻退出 2;
  会话输入注入 brief、source、destDir、mode.init 与各前序阶段交接文档的预拼接
  handovers——交接文档在 docs/handovers/R<N>-<字母>-<slug>.md 永久路径(stable-refs
  P2),P2 前完成的阶段自归档目录内读回落;蒸馏产物是跨阶段记忆唯一通道,不注入前序
  原始 docs/,缺文件标注"(无交接文档)")、
  有未完成任务 → 走既有主循环(分解/执行/验收/审核/统一提交/进度恢复语义不变;
  v 阶段任务豁免任务级验收与 --review,见下条)、
  本阶段任务全 done → 交接(先开蒸馏会话产出 docs/handovers/ 永久路径交接文档
  ——四小节协议关键决策/约束与坑/下一阶段必读清单/产物索引,validHandover 逐字
  校验标题行,产物缺失带反馈重试一次仍失败隐性阻塞退出 2;再把 PLAN.md 拷贝进
  归档目录(新布局轮内 docs/R-NN/<字母>-<slug>/,旧布局 docs/phases/<字母>-<slug>/;
  仅收过期状态文件)→ PLAN.md 重置空模板 →
  台账追加(行协议含交接指针 handovers/ 路径,旧行形态容忍)→ 统一提交
  stage=phase-transition;本阶段 docs/ 产物文档为永久路径,交接不搬移);
  台账覆盖 phases 全部字母 → 退出 0。`--final-review` 只在 m 阶段挂接(其余阶段
  打一次提示);AGENTS.md 超 150 行在交接时仅 note 提示、不改写。
- k 阶段(P4,phases-design.md D.4;整体认领 fixme-knowledge-design.md 的
  --extract-knowledge,该 CLI 选项不存在):plan 路由(PLAN.md 空模板态)不开
  规划会话、不填 PLAN.md,直接进入知识提取旁路会话(src/knowledge.ts
  extractKnowledge,requireArtifact 骨架)——通读阶段台账与各阶段交接文档
  (docs/handovers/ 优先),产出永久路径
  docs/migration-kb/R<N>-migration-<时间戳>.md(章节骨架/质量约束内联在
  templates/prompts/knowledge.md,mode.exec 作场景背景注入;不随交接/轮次归档
  移动);本轮 R<N>- 前缀非空 .md 已存在(交接前中断)则幂等跳过(前几轮文档
  不算本轮已提取,第 1 轮无前缀存量按读回落视为本轮产物);提取失败(会话受阻
  或两次未产出)仅打 ⚠ 警告、不污染退出码,k 阶段照常交接——迁移成功不被文档
  生成失败反向污染;知识文档随会话统一提交(stage=knowledge);人工在 k 阶段
  自行向 PLAN.md 填任务时走通用 execute/handover 路由,提取挂点不触发;交接完成
  后重试提取 = 人工回退规程(删台账 k 行与 docs/migration-kb/ 内本轮 R<N>- 前缀
  文档后重跑)。
- v 阶段验收豁免(phases-design.md D.3):runTask 依 loop 透传的 Opts.phase 在
  当前阶段为 v 时强制 review=0 且跳过任务级三段式验收(收尾后直接 markDone、不写
  verified)——与终审任务的 final 字段共用同一豁免代码路径,内部标记、不写 final
  字段、不污染 PLAN.md 协议;v 阶段任务全 done 即交接、不因验收差距熔断(D.3
  预留了 handover 路由前解析验收报告结论的挂点备选,V1 不做)。
- 续轮迁移(continue 子命令,phases-design.md M 节;2026-09-08 轮次专用目录
  方案):上一轮阶段化迁移全部完成(台账覆盖既有 phases 全部字母)后开启新一轮
  继续迁移,目标是让迁移结果与源更加完整、一致。continue = init 的 amend 机制 +
  establishRound 轮首建立新轮目录(docs/R-NN/,轮首即建、落盘即永久——PLAN.md/
  phases.md/AGENTS.md.bak/阶段归档/handovers/phase-docs/migration-kb.md/
  prior-kb.md 全部轮内自包含,根 PLAN.md 重建为指向轮内的相对符号链接,无现场
  清理、无轮末搬移——archiveRound 已删除);上一轮结论(归档索引 + 最终阶段
  交接文档全文 + 迁移知识文档全文: 新布局读轮内,旧布局 docs/migration-kb/ 的
  R<N>- 前缀文件与前缀存量、P2 前轮次归档内的 migration-kb/ 读回落收集)
  经 prevRoundDigest 注入新一轮首个阶段规划会话,后续阶段照常走本轮 handover
  蒸馏链。迁移同一性选项(-m/--mode、--source-dir/--source-path/
  --dest-dir)跨轮固定、continue 时显式给出即退出码 1(换源/换目标/换模式不是
  同一迁移的继续);--phases/-p 与其余执行选项可按轮修订(--phases 不受前缀护栏
  约束)。轮次推导式(存在 docs/R-NN/ → 当前轮 = R 系最大号;否则回落旧语义
  round-<N> 最大编号 + 1),run/status 阶段进度行带
  `第 N 轮` 标注(round > 1 时);`--continue` 不是选项,init/run 出现即报错指向
  continue 子命令;前置校验失败(非阶段化项目/台账为空/缺阶段/含外字母/新
  --phases 为 "m")均退出码 1 给指引。
- 下发任务失败(UnknownError)的常见根因是目标目录缺少 `.opencode/agent/<agent>.md`
  (服务端错误体不含根因):run 前完整性检查拦截该情况;运行中发生时 driver 在
  阻塞问题后追加恢复提示(检测依赖 Opts.dir,run/init/dryrun 均须传入)。
- 任务文档路径契约(stable-refs P1,src/docpaths.ts 单一构造点):任务文档只出现在
  任务自己的目录 `docs/T-NNN/` 内(理解摘要 context.md、分解检查项 subtasks.md、
  收尾报告 report.md、审核报告 audit.md、修复检查项 fix.md、上下文交接 handoff.md、
  任务级测试交接 testhandoff.md),子任务产物 `docs/T-NNN/S<两位序号>/index.md`、
  子任务级测试交接同目录 testhandoff.md;终审产物按产出任务锚定各自的
  `docs/T-F<k>/`(提案 plan-<stage>-r<N>.md 与 audit-r/refactor-r/patch-r/
  validate-r/finalize 报告);这些路径一经创建即为永久路径。`--review` 的终审
  审计与任务审计同路径 docs/<taskId>/audit.md。**读回落**:旧平铺项目
  (docs/<id>.<role>.md 等)读点优先新路径、新缺失而旧存在回落旧路径,写目标恒为
  新路径;读回落永久保留、平铺旧布局原地保留(refcheck-scope-design D2 摒弃移动
  适配:2026-09-08 起 run 不再做存量目录化迁移,遗留引用失效走 git 历史恢复,
  见 refcheck-scope-design.md §4)。**永久性全貌(stable-refs P2)**:docs/ 下文档
  (docs/T-*/、docs/handovers/、docs/migration-kb/、docs/prior-kb/)一经创建
  永不移动、永不改名——轮次专用目录方案(2026-09-08)起,每轮一个
  docs/R-NN/(轮首建立):阶段交接产出台账行内轮内 handovers/<字母>-<slug>.md
  (handoverDoc,src/phases.ts),知识文档轮内固定名 migration-kb.md 与
  prior-kb.md(docpaths.ts knowledgeDoc/priorKnowledgeDoc,轮目录恒空使新一轮
  必重新蒸馏,旧机制轮次(台账有完成阶段而无本轮文档)旧平铺无前缀存量读回落);
  阶段 PLAN 快照等过期状态收在轮内 <字母>-<slug>/ 归档目录,状态文件不被任何
  文档引用;旧布局(docs/handovers/R<N>-*.md、docs/migration-kb|prior-kb/ 平铺、
  docs/phases/ 与 round-N/ 归档)原地保留为读回落,P2 前布局(交接在归档目录
  内、知识无前缀)各读点回落兼容。
 - 引用一致性三层(stable-refs P4,D6;设计文档 stable-refs-design.md §3.3;
   **2026-09-08 起经实验开关 `OPENCODE_AUTO_REF_CHECK=on/off` 管控,缺省 off**
   ——off 时三层挂点全部空转、目标目录零引用检查行为,范围收敛与恢复设计见
   refcheck-scope-design.md):引用唯一
  合法形态 = 目标目录根相对路径(反引号或 md 链接,可带 `:行号` 锚,锚可再带
  `@<sha>` 版本标记);校验语义 = 路径存在 + 行号 ≤ 文件总行数(带 `@<sha>` 标记的
  历史快照引用只查存在性、豁免行号上限);直接路径未命中时按段边界后缀在目标目录树内找唯一文件
  匹配——带上下文语境的相对引用(以引用者所在目录为基书写)唯一命中即视为有效并
  消解到匹配文件(尤利于非 docs 引用),无匹配或多重匹配(语境歧义)按缺失;代码围栏内
  与行内含 已删除/已归档/历史 标记的引用豁免;
  URL/绝对路径/`~`/`./`/`../` 形态与纯版本号 token(如 `v1.2`)不校验,md 链接的
  `#fragment` 剥后验,目录引用只查存在性。三层:① **auto-correct**——每次统一提交前
  (runner 的 afterSession 挂点,覆盖全部会话后提交)driver 先做 git rename 配对
  (`git add -A` 暂存后 `git diff --cached --find-renames HEAD`,暂存本就是下一次提交
   的前奏)机械改写活文档引用(**只配对 rename,删除/语义变化不自动改**;改写不动
   排版——仅就地替换命中路径 token,行结构/空白/对齐原样保留),再复扫
  findings 并做**缺失恢复**(refcheck-scope P2,失效确认在先、恢复在后:missing
  引用目标经 git 历史 rename 地图——目标仓库及嵌套子仓库的
  `git log --find-renames` 按新→旧首现优先、链式解析最终落点——追踪,落点当前
  存在即就地改写恢复(行号锚保留);落点已删除或历史中不曾存在不自动恢复(只恢复
  移动/改名类失效,删除与语义变化保留人工订正),改写后再复扫),再做**范围再确认**
  (refcheck-scope P3:带 `:N`/`:N-M` 行号锚且未带版本标记的引用,其目标文件在所属
  git 仓库有未提交内容差异时比对 HEAD 版本与当前版本的同范围行切片——一致不动;
  不一致(当前文件行数不足即不一致)保留原范围、就地追加 `@<sha>` 版本标记(sha =
  所属仓库当前 HEAD 短哈希),语义 = 该范围仅对标记的历史版本有效、豁免行号上限
  校验;已带标记的引用不再追加或更新,留待人工订正;嵌套子仓库逐个判定、各钉各
  仓库的 HEAD;改写后再复扫),然后维护失效清单
  `.auto/invalid-refs.md`(只登记未恢复的失效引用;键 = `文件 → 路径(problem)`,每轮
  全量重写——修复后自动移除、复发视为新出现):已收录键不再 ⚠,仅对新出现的失效
  引用输出警告日志(防无休止重复报告,人工核验订正以清单为入口);改写内容随本次
  统一提交落账,不另起提交;非 git 目录 auto-correct
  空转(校验仍可跑)。② **check 子命令**——原则检查之外全量扫描活文档
  (docs/**/*.md,排除 docs/phases/**;docs/phases.md 台账属活文档),失效引用命中
  退出码 1(check 为人工/CI 显式调用,报告不按清单去重);AGENTS.md 缺 opencode-auto
  块与非 git 目录(auto-correct 不可用)给 note。③
  **verify 门禁**——verifyTask 在每个判定会话前对任务产物文档(docs/T-NNN/**,
  终审任务 T-F<k> 同法)做确定性预扫,失效引用 = 差距直接进修复轮(不消耗判定会话;
  off 模式回退 pending,FIX_ROUNDS 耗尽阻塞退出 2);verify 未启用时门禁不存在,
  退化为第①层的 ⚠ 日志(宽松契约)。该规范经 init 下沉:AGENTS.md 的 opencode-auto
  标记块内引用规范段落(无条件出现——路径稳定性不依赖任何开关);
  wrapup(report 引用要求)/verify-script-gen(脚本内根相对路径)/fix(失效引用
  允许只更新引用行)模板同步注入提示文案。
- 统一提交(收回 AI 提交权):任何会话结束且 driver 完成状态写入后,由 driver 经
  src/git.ts 的 commitTree 递归提交全部改动(先嵌套 .git 子仓库、后目标目录所在
  仓库,路径发现不依赖 git status——嵌套仓库通常被父仓库忽略),git 历史即 AI
  变更的审计轨迹、回滚粒度 = 会话。提交信息 = `任务编号 <label> <任务标题/子任务>` 短标签
   标题行(label ∈ decompose/S<n>/exec/wrapup/fix<n>/judge/script/review/final/planfix/
   blocked/pending/done,伪任务用 PLAN <label>:plan/handover/transition/knowledge/
   numbering/final-plan/doc-migrate;子任务条目为 `任务编号 S<n> <标题>`、
  省略任务标题)+ `Auto-Task`/
  `Auto-Stage` trailer(目标仓库另记 `Auto-Nested` 嵌套仓库路径与 SHA)。挂点:
  分解注入/子任务勾选/整任务/修复轮/收尾在状态写入后(状态写入含 CURRENT.md
  镜像刷新: 分解注入与子任务勾选先刷新镜像再提交),判定/审核/脚本生成/
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
   提示,会话写出 docs/<id>/handoff.md(末行 `状态: 继续|完成`,以该子任务是否完成计),
  新会话凭交接续跑,子任务完成后 driver 删除该文件)/
  `off`(单会话完成整个任务;
  验收差距不做修复重跑,任务回退 pending 等人工改进)/ `ondemand`(单会话执行,
  watch 在已用量达到配置 contextLimit 的 2 倍时向进行中会话 steer 交接提示——每会话一次,
  v2 prompt 默认 steer;会话结束按 docs/<id>/handoff.md 末行 `状态: 继续|完成`
  决定续跑或进入收尾,文件缺失带反馈重试一次再按隐性阻塞)。中途切换:已注入检查项
  的任务照旧从勾选状态续跑(进度按任务记录),新任务按新档执行;README 注明不建议。
- --dryrun: 只跑一次权限预检会话(列出授权外目录/操作并逐只读探查),该会话内
  权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复;报告写入
  .auto/dryrun.md 并打印,不执行任何任务。
- 提问自动答复(question.asked):非权限提问由 AUTO_ANSWER 自动答复(要求 AI 记录
  决策过程,涉及架构/代码变更的决策须以 `AUTO-DECISION: <决策与理由>` 行标注);
  --wait-answer 下先等人工 stdin 答复,超时回落自动答复;缺省 --wait-answer 时
  权限类提问(question 工具)直接阻塞;同一问题重复出现仍阻塞停机。
- 死循环检测(OPENCODE_AUTO_STUCK,缺省 on;设计文档 docs/stuck-loop-design.md):
  弱模型常连续多次以同一方式重复同一动作且始终不成功,自己走不出来;driver 在
  watch 中观察工具调用终态,两条会话级判据——同一工具 + 同一报错(**不含参数**,
  参数微调仍撞同一个坑)累计 3 次,或同一工具 + 同一参数 + 完全相同的输出累计
  4 次(结果一模一样 = 没带来新信息);结果有变化一律视为有进展、不计数,不要求
  连续(交替重试同样识别)。命中即经 promptAsync 向该会话 steer 一条提示(下一个
  provider turn 边界生效),逐级升级: ① 摆出证据 + 核对前提 + 换一种手段 →
  ② 要求先写清"目标/已试过什么/下一步换什么"再动手 → ③ 停止重试,以
  `AUTO-FIXME: <原因与计划>` 标注遗留、交代进度后结束会话。每会话至多三次,命中后
  该签名计数清零(再犯满一轮才再提示),达上限后静默。**只提示不停机**——不中止
  会话、不改判定、不写状态文件(判据可能误判,停机代价远高于一条多余的提示;
  第三级把收尾的决定权交回 AI,由既有流水线接管),steer 投递失败只记日志。
  dryrun 预检会话恒不检测(反复被拒探查权限是其正常形态)。
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
- --test-by-driver/--handover-test(config.testByDriver/handoverTest,缺省 false;宪法级选项,init --test-by-driver/--handover-test 修订,run 拒绝;与 verify 正交的测试执行协议): 前者把实现环节"编译/测试/构建/lint 等可能耗时长或产生大量输出的命令"的执行权收归 driver——执行类会话(子任务/整任务/验收修复轮;分解/收尾/判定/审核等旁路会话与 --dryrun 不适用)不在会话内直接运行这类命令,改为把命令写成脚本放 test/ 目录(命名清晰、可执行、可复用,随仓库版本化),把脚本路径(相对工作目录)写入 tmp/test.sh 标记(存在即待执行请求,重写即再次请求),driver 在会话 idle 时检测标记:内容为现存文件路径 → 直接运行该脚本(test/ 内脚本已随统一提交版本化,不另归档);否则按内联脚本回落整写为 tmp/test.<n>.sh 后运行(保留执行快照供审计);两种形态均把 stdout/stderr 合并整写 tmp/test.<n>.out(单文件,编号跨运行接续,共用 idleTime/idleMax 看门狗),移除标记后退出码/耗时/脚本与输出路径经 steer 注入同一会话由 AI 直读文件判断(退出码非 0 不由 driver 判定;steer 一律经 promptAsync 投递——v2 同步 /message 端点会阻塞到回合结束,在 watch 事件循环内同步等待会卡死事件循环;投递失败记 log 并按隐性阻塞 blocked 处理,回合结束的孪生 idle 事件经 watch 去重,处理过一次后直到新会话事件出现前不再结算);重跑同一测试 = 把同一脚本路径再次写入 tmp/test.sh(脚本可先修改再重跑)。每个执行会话入口清除遗留待执行标记。后者(需前者,配置层与 init 均交叉校验)在测试失败(非零退出或看门狗超时)且会话 used ≥ contextLimit 时改要求 AI 写测试交接文档后结束会话——文档按执行范围命名(子任务为 docs/<id>/S<两位序号>/testhandoff.md,整任务会话与验收修复轮为 docs/<id>/testhandoff.md),交接只对本执行范围生效、下一子任务不会误读上一子任务的遗留交接(缺失带反馈重试一次仍缺失隐性阻塞),driver 开新会话以续跑提示(先读交接文档与最近输出)继续,不设硬上限、连续超 10 次提醒评估是否陷入无法解决的问题(可 AUTO-FIXME 标注遗留后继续);子任务完成时清除该子任务的测试交接文档(与 ondemand 交接同口径,下一子任务重新起算),非恢复续跑时清除任务级与子任务级的陈旧交接文档。提示词协议段经 subtask/whole/fix 模板的 testByDriver/handoverTest 条件块注入,steer 文案在 test-result/test-handover/test-continue 模板(无 driver 解析协议,覆盖校验不做标记要求)。该执行权约定经 init 下沉:AGENTS.md 测试执行原则块(随 config.testByDriver 补写/移除,镜像验证原则块)与 agent 契约的 testByDriver 条件段;`check` 子命令在 testByDriver 启用时扫描 AGENTS.md/PLAN.md 中要求会话亲自运行编译/测试/构建/lint 的描述(TEST_PATTERNS,与验证类同构)。
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
  此后中断恢复时跳过重跑;退出码非 0 不直接判失败);③ 旁路独立判定会话——进入前
  driver 先对任务产物文档 docs/T-NNN/** 做引用门禁确定性预扫,失效引用 = 差距直接
  进修复轮、不消耗判定会话(stable-refs P4 引用一致性三层),随后判定会话
  (renderVerifyJudge,
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
   之后全部 done"判定,审计报告统一写 docs/T-NNN/audit.md(final 与非 final
   同一路径,P1-D2),
  范围以本任务改动为限、终审不限),结论写 `.auto/review.md`(协议同 VERDICT_FILE,
  复用 parseVerdict)。通过 → completed;差距 → off 模式 setStatus pending 返回
  incomplete(与该模式 verify 失败语义一致);轮数超限 → blocked(question=差距
  全文);未超 → 任务先置回 in_progress(verifyTask 已标 done,否则中断重跑时
  next() 会跳过、fix 检查项永不执行)→ planReviewFix 旁路规划会话产出
  docs/T-NNN/fix.md → appendSubtasks 注入 PLAN.md → 刷新 CURRENT.md → 下一轮
  (fix 检查项走子任务会话循环)。early 两形态:`--review n --early` 或快捷糖
  `--early-review [n]`(index.ts 校验:--early 单独出现、--early-review 与
  --review 同现均为用法错误退出码 1)——审核会话经 verifyTask 审核挂点在 verify
  脚本执行窗口并行启动(executeVerifyScript 在 runVerifyScript 前调起、判定会话
  前 join,审核 blocked 立即上抛;generate 分支的脚本生成会话结束后才启动;每次
  脚本执行含修复轮重跑都重开一次新审核,early 措辞见 renderReview),结论随
  `{type:"done", audit}` 带回由外层消费(通过 → completed;差距 → 既有 review
  差距流程,off/超轮语义不变),非 early 走原串行路径;全局保持任意时刻至多一个
  LLM 会话(脚本执行为纯本地进程,窗口内唯一会话即审核会话),因此无需 worktree。
- 提示词模板:全部会话提示词以文件模板管理(`templates/prompts/` 19 个会话模板 +
  `_partials.md` 共享片段,src/template.ts 渲染,语法 `{{var}}`/`{{#if x}}`/`{{^x}}`/
  `{{> 片段}}`、块标签独占一行整行吞掉);目标目录 `.opencode/auto/prompts/` 同名
  覆盖,协议敏感模板(verify-judge/review/verify-script-gen/review-fix/decompose/
  handoff-steer/final-task/phase-plan/phase-handover/number-recovery)覆盖时校验关键协议内容
  (`结论: 通过|差距|重验`、`.auto/verify.md`、交接四小节标题、`.auto/next-task` 等),
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
  docs/T-F<k>/plan-<stage>-r<N>.md(锚定即将追加的 T-F<k> 目录)→ appendFinalTask 追加 → 主循环 next() 拾取执行 →
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
- 任务流水线(auto 模式):正文无检查项时先跑分解会话(产出 docs/T-NNN/subtasks.md,
  driver 注入检查项),再逐检查项会话执行,最后收尾会话写 docs/T-NNN/report.md
  (只写产出摘要,不运行任务级 verify、不下验收结论)。
   任务内所有会话共用一条链:链内复用受 OPENCODE_AUTO_REUSE_SESSION 管控,
   **缺省 off——每个提示词都开新会话**;开关为 on 时恢复阈值复用(上一会话结束时
   上下文占比低于 50%、已用量低于配置 contextLimit 的一半(默认 32k tokens)且距其
   结束不超过 5 分钟(REUSE_IDLE_MS)才复用,否则新建;verify 脚本执行与判定/审核
   等耗时较久后自动换新会话)。占比与用量由 watch 始终跟踪(与 --verbose 无关),
   拿不到模型上限时占比记 100 即总是新建;瞬时会话错误重试仍强制换新会话。
   每个会话结束都打印一行上下文用量与耗时(`✓ 会话结束: 上下文 n% (用量/上限),
   耗时 …`),复用会话与中断恢复接管的会话同样打印——此前该行仅在新建会话时输出,
   复用轮的数字要等下一轮 `♻ 复用会话` 行才出现,恢复接管的会话与任务末轮的复用
   会话因此从不显示用量。会话标题与提交标题共用同一短标签
   方案且全部显式命名(不依赖服务端自动起题):新建会话以本阶段提交标题命名,
   复用会话跨阶段在结束时改名(renameSession),任务终态再改名为
   `T-NNN done|blocked|pending <标题>`——标题前缀即该会话的最新进度。
- CURRENT.md 是当前任务镜像(抗上下文压缩的兜底,非每会话必读——提示词已内联当前
  任务、子任务会话另有 context.md 背景摘要,仅在上下文被压缩或对进度存疑时读):任务开始(首个会话前)
  写入、每次勾选后刷新(刷新在该次统一提交之前落盘,与 PLAN.md 的勾选同入一次
  提交,镜像不落后于已提交的 PLAN.md)、任务完成时删除;非完成结局(阻塞/回退 pending)写"中断
  备注"(退出原因/中断阶段/恢复方式)后保留,供人工查看与下次恢复(下次 runTask
  重建镜像时,备注要点经恢复提示词带给 AI);强制中断遗留文件同样下次重建。
  AGENTS.md 中 driver 只维护单一标记块 `opencode-auto:start`/`opencode-auto:end`
  (内容为英文,含指针、验证原则、测试执行原则、提交原则、摘要原则——非交互场景不
  产出会话末尾总结、维护规则、引用规范(stable-refs P4,规范全文精编:存放目录化/
  永久路径、引用根相对路径语法、检查三层)七段;验证/测试两段随 config.verify/
  config.testByDriver 出现或消失,见"verify 验收开关"与"--test-by-driver"条,其余
  段落无条件出现):run/init 启动时按当前配置渲染该块并与文件中现有的标准块比对,
  不一致则整块替换、缺失则追加,文件中残留的任何其他 `opencode-auto:<name>:start/end`
  标记块(旧版六块格式,或任何游离标记块)一律清理——这也是旧格式向新格式的迁移
  路径。AGENTS.md 不置只读(任务可更新其余内容,但经 agent 契约约束不得删除
  或改写 opencode-auto 标记块、更新其余内容须遵守块内的维护规则——保持精简 ≤150
  行、路由到 docs/agents/<主题>.md 存放跨任务工作流知识、更新不追加、只沉淀持久
  知识;check 对块缺失/内容过期/残留旧版块与行数超限均输出 note);指令文件每个
  provider turn 现场重读,且 AGENTS.md 指纹(mtime+size)变更时 server.syncAgents
  在下一个新会话前重启 server 兜底。
- 进度恢复(应用重启后精确恢复中断):run 期间 driver 把当前阶段与执行链会话
  持久化到目标目录 .auto/progress.json({task, session, at, active, phase};阶段
  边界经 persistStage 写 active=false 总结态,执行链会话开始/结束经 attempt 刷
  active=true 半途态;旁路一次性会话不写);runTask 开始时 recallProgress 读回——
  active 且会话在 server 上仍存在 → 复用原会话继续(chain 直接 seed 该会话,
  与 `opencode -r` 同构,不设时间窗;该接管不受 OPENCODE_AUTO_REUSE_SESSION 与
  复用阈值约束——恢复语义即"接着被中断的那个会话继续",首个提示词进原会话,恢复
  说明用后即清、此后回归常规规则。seed 的用量为经 session.messages 末条 assistant
  消息重建的真实值,恢复日志与链内后续决策据此,不再用 0/0 占位),否则新会话;**交接文件优先**——active
  恢复时交接文档已存在(ondemand 的 docs/<id>/handoff.md 或 handover-test 的
  任务级/任一子任务级 testhandoff.md 遗留均判定)则不复用旧会话,
  开新会话凭交接续跑(handoff `状态: 完成`
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
