# 提交边界设计:git 提交作为任务/子任务/隐藏任务的完成条件

> 状态: 2026-09-14 立项实施。事实基线 = 前置知识提取的"落盘且已提交"协议
> (6c3b3893b,docs/knowledge.ts §③④)推广为全流水线通用完成判定。本文是该改动的
> 设计基准与决策记录;新会话从「步骤勾选表」继续。

## 1. 目标与原则(用户已确认)

1. **完成 ⟺ 落盘且已提交**:任务/子任务/隐藏任务(伪任务/旁路会话)只要修改了
   Git 纳管内容,必须形成 git 提交才算完成。统一提交失败 → **阻塞停机(退出码 2)
   待人工**,不再"仅警告不阻塞"。
2. **单元启动 clean 基线**:每个执行单元启动前确认工作区 clean——单元依赖的信息
   全部由上一次提交固定,或在本次过程中产生。脏区不可归因 driver → 阻塞交人工。
3. **SHA 基线与仓库对齐**:单元启动记录全部仓库(根 + 嵌套)HEAD SHA;收口时
   ① 工作区必须 clean;② `基线..HEAD` 区间内每个提交必须带 `Auto-Stage:` trailer
   (即 driver 提交)——出现无 trailer 的提交 = 外部干扰,阻塞;③ root 提交的
   `Auto-Nested` 行覆盖**全部**嵌套仓库(本轮有提交记新 SHA,无提交记基线 SHA),
   使任一 root 提交都能对齐跨仓库状态。
4. **无纳管修改不产空提交**(commitTree 对无改动仓库跳过,现状保持)。
5. **git 提交是任务间逻辑隔离的事实边界**(审计与回滚粒度 = 会话/单元)。
6. 开关语义:`--commit false` / dryrun / 非 git 环境下门禁整体不生效(与前置知识
   ③④同口径);`Auto-Stage` trailer 同时是"driver 提交"的机器判据。

## 2. 术语

- **单元(unit)**:任务(runTask 全流水线)/ 子任务(runSubtask,含 review 注入的
  fix 检查项)/ 独立隐藏任务(standalone hidden:phase-plan、phase-handover、
  knowledge、prior-knowledge、numbering 恢复、final-plan 生成——`requireArtifact`
  经 `spec.unitStart` 声明)。任务内部的验收机具会话(judge/review/planfix/脚本
  生成)不是独立单元:其提交义务由"每会话提交门禁"覆盖,启动 clean 门禁不适用
  (任务单元已在其外层启动)。

## 3. 机制

### 3.1 git.ts 基础层(P1)

| API | 语义 |
|---|---|
| `commitTree(...) → CommitResult` | 返回 `{ok, failures[{rel,error}]}`(原签名只加返回值,向后兼容壳调用);`Auto-Nested` 扩为全量嵌套仓库 |
| `unitBaseline(dir)` | 逐仓库 HEAD 短 SHA(空仓库记空串) |
| `unitViolations(dir, baseline)` | 收口校验:工作区不净 / `基线..HEAD` 存在无 `Auto-Stage:` 的提交 → 违规清单 |
| `beginUnit(dir, opts, task)` | 单元启动门禁:clean → 记基线;脏区全属 driver 独占状态文件(`PLAN.md`/`CURRENT.md`,上次提交失败的落账)→ `carryover` 补提交自愈;否则返回 dirty。白名单经 `driverStateFiles(dir)` 现场解析(见 §6 符号链接条) |
| `commitPending(dir, task, info, files)` | 隐藏任务 ③:产物已在未提交清单 → 补提交即完成;否则 "clean" |

### 3.2 会话后提交门禁(P2)

- `afterSession(..., baseline?)` 返回 `SessionCommit`(`ok` / `failed{question}`);
  runner 全部 10 处调用点失败 → 返回 blocked(问题进 PLAN.md,loop 的 interrupted
  提交天然构成一次重试,仍失败才留脏现场给人工)。
- `requireArtifact` 增 `spec.unitStart`:入口 `beginUnit` 门禁(恢复复用
  resumedSession 豁免 clean 检查——脏区是本单元自身 WIP,仍记基线);`spec.commit`
  失败 → blocked(不开反馈重试:git 故障重开会话无意义)。
- `Outcome` 增 `dirty` 变体(`{type:"dirty"; files}`):clean 门禁失败的专用出口,
  **不写 PLAN.md、不做 interrupted 清扫提交**——git 状态的决定权在人工。既有
  `Outcome & {type:"blocked"}` 联合统一更名 `UnitStop`。

### 3.3 loop 挂点(P3)

- run 启动:housekeeping 之前 clean 门禁(人工遗留脏区 → 阻塞退出 2,替代旧
  "会被吸纳"警告);ensurePointer/ensureGitignore 的补写之后一笔 `housekeeping`
  收口提交。
- 任务单元:runTaskLoop 取任务后 `beginUnit`(active 进度记录 = 恢复续跑,豁免
  clean、保留基线);done 终态提交失败 → 退出 2;提交后 `unitViolations` 收口。
- 子任务单元:runSubtask 入口 `beginUnit`(本子任务恢复续跑豁免 clean)。
- `appendFinalTask` 后 `final-plan` 提交;`injectFix` 注入后 `review-fix` 提交。
- 阶段交接 `phase-transition` 提交失败 → 退出 2(既有"交接中断恢复"兜底不变)。

### 3.4 隐藏任务 ③④ 推广(P4)

幂等入口统一协议(prior-knowledge 既有语义推广,helper `commitPending`):

- **③ 产物已落盘且在未提交清单 → driver 补提交后即完成**:knowledge
  (migration-kb.md)、phase-handover(交接文档齐备时顺带跳过重复蒸馏)、
  phase-plan(经 beginUnit 的 carryover 自愈覆盖)、final 提案(经 append 提交覆盖)。
- **④ 产物缺失而工作区脏 → dirty 阻塞交人工**:extractKnowledge 增 dirty 返回
  (k 阶段原"失败仅警告"对 dirty 例外);numbering 的产物 `.auto/next-task` 被
  gitignore,天然无 ③④。

## 4. 已确认决策

| # | 决策 |
|---|---|
| D1 | 提交失败一律阻塞停机待人工(不自动重试;blocked 路径的 interrupted 提交构成自然的一次重试) |
| D2 | 门禁挂全部会话后提交点,不只完成判定边界 |
| D3 | ③ 补提交推广至全部独立隐藏任务;④ dirty 阻塞同步推广 |
| D4 | Auto-Nested 记全量嵌套仓库 + 外部提交检测(`Auto-Stage` trailer 判据) |
| D5 | run 启动遇人工遗留脏区:阻塞(不再吸纳进 driver 提交);driver 独占状态文件(PLAN.md/CURRENT.md)遗留 → carryover 自愈补提交 |
| D6 | 会话恢复保真(可恢复 session id 高标准 / 最多一句 continue / 不可保真时 stash 回滚重跑)为**独立后续专项**,本次仅交设计文档 plans/0022-session-recovery-fidelity-design.md(以本机制的单元 clean 基线为回滚锚点) |
| D7 | **`--commit false` 退役(2026-09-15,用户决策)**: 提交关闭档与本机制及其下游诸设计冲突——完成判定、单元 clean 门禁、SHA 基线、恢复保真的回滚锚点全部以"提交恒开"为前提,关闭档下它们整体空转,且每个新机制都要额外挂一条"门禁关闭即空转"的分支。本次做**入口层软退役**: CLI 的 `--commit false`(及旧别名 `none`)出现即用法错误退出 1(`--commit true` 仍接受,等同缺省),`.opencode/auto/config.json` 读到 `commit: false` 按坏文件严格失败(不静默改写语义);代码侧既有的 `opts.commit !== false` 门禁暂留、此后恒不可达,连同以 `{ commit: false }` 直呼核心函数的单测一并留给后续清理任务。门禁此后只在 dryrun 与非 git 环境不生效。 |

## 5. 步骤勾选表

- [x] P0 设计文档(本文件)
- [x] P1 git.ts 基础层 + test/git.test.ts(commitTree 失败上报/Auto-Nested 全量/基线与收口校验/beginUnit/commitPending)
- [x] P2 afterSession/调用点/requireArtifact 单元协议(spec.unitStart) + test/runner.test.ts
- [x] P3 loop 挂点(run 启动 clean 门禁 + housekeeping 收口、任务/子任务基线、done/interrupted/transition 门禁、appendFinalTask/injectFix 提交)
- [x] P4 隐藏任务 ③④ 推广(knowledge/phase-handover 直连,phase-plan 经 carryover,final 经追加提交)+ prior-knowledge 重构复用 commitPending + test/knowledge.test.ts
- [x] P5 文档同步(behavior/structure/AGENTS(包+根)/auto 壳 README/session-recovery-fidelity 设计)
- [x] P6 全量验证(typecheck + bun test 705 例全绿(新增 16);auto 壳 typecheck/test 53 例回归通过)

## 6. 风险与边界

- **恢复续跑的脏区豁免**:active 记录 + 会话复用/交接续跑时,工作区承载本单元
  自身进度,不做 clean 门禁(否则恢复路径全断);该场景下外部与自有改动不可区分,
  由收口时的 trailer 校验兜底(提交层面),工作区层面维持既有"吸纳"语义——已知
  局限,记录于此。**2026-09-15 补:测试交接(--handover-test)这条路径上该局限已消解**
  ——交接点做两次 driver 提交(定版 + 确认,见 plans/0023-test-handover-early-design.md D3),
  新会话面对的是干净工作区,不再有"外部与自有改动不可区分"的窗口;其余恢复路径不变。

- **单元内的多笔 driver 提交是合法的**:`unitViolations` 只校验基线..HEAD 区间内每个
  提交都带 `Auto-Stage` trailer,**不限提交个数**。测试交接在单元内各插两笔
  (`<单元> handoff-<n>-pin` 定版 / `<单元> handoff-<n>` 确认),收口校验照常通过;
  `rollbackUnit` 回滚到单元基线时一并丢弃它们,语义即"整个单元重做"。
- **judge 越权还原残差**:判定会话对 PLAN.md 越权编辑的还原发生在提交之后时,残差
  会使下一个单元启动门禁报脏——按异常现场交人工,符合"越权即异常"的既有立场。
- **空提交禁止**:门禁自愈/补提交均经 commitTree,无改动仓库自动跳过,不产生空提交。
- **driver 独占状态文件的白名单必须解析符号链接(2026-09-15 修)**:轮次专用目录方案下
  根 `PLAN.md` 是指向 `docs/R-NN/PLAN.md` 的符号链接,`plan.ts` 的原子写经 `realpath`
  落到链接目标,故 `changedFiles` 报出的脏区路径是 `docs/R-NN/PLAN.md` 而非 `PLAN.md`。
  原先的字面清单 `["PLAN.md", "CURRENT.md"]` 因此对不上,D5 承诺的 carryover 自愈在
  阶段化布局(auto-migrate 缺省 `phases: "admtvk"`)下**整体失效**:`loop.ts` 的中断恢复
  (`resetInProgress` + 进度记录精确恢复置位)一写 PLAN.md,首个任务单元启动即判 dirty
  退出 2,重跑连 run 启动门禁都过不去。修法两条:① `beginUnit` 改以 `driverStateFiles(dir)`
  现场解析,链接名与链接目标一并纳入白名单;② `loop.ts` 把中断恢复的两段写盘上移到启动
  clean 门禁之后、运行前基线收口提交(`housekeeping`)之前,由该次提交自然落账,免去
  每次运行白耗一笔 carryover。dryrun 下整段跳过(与上移前位于 dryrun 提前 return 之后等价)。
