# 会话恢复保真设计:可恢复 session id 标准、极简续跑与 stash 回滚

> 状态: 2026-09-14 立项,设计定稿;**2026-09-15 实施完成(S1/S2/S3 全部落地,
> 开关 OPENCODE_AUTO_STRICT_RESUME 缺省 off 灰度中,见 §4 勾选表)**
> (plans/0021-commit-boundary-design.md 决策 D6)。
> 2026-09-15 依据双目标目录现场日志审计(kernel-spi-nor / kernel-dm,
> 2026-09-10..15 约 23MB run 日志)实证修订:复用判据补 model 一致性(3.1 ④)、
> R3 交接边界写核(3.3 新触发)、fork 基点独立性显性化(3.4)、相邻机制修正建议
> (3.5 登记给属主)。实证明细与日志出处见仓库根 docs/session-interruption-field-audit-20260915.md。
> 用户需求原文(2026-09-14):AI 会话启动时若执行进度正常,记录其
> session id 供中断恢复;恢复时必须严格确保 session id 对应当前过程中断时的会话,
> 且**最多附加一句 `continue` prompt**,避免过多 prompt 干扰;记录可恢复 session id
> 的标准极高——恢复后的工作须与未中断状态高度一致(含 AI 经 tool 完成的本地修改);
> 若无法保证,应经 `git stash` 将状态恢复至过程启动时的初始状态,开新会话继续。
> 回滚锚点 = plans/0021-commit-boundary-design.md 落地的单元 clean 基线(单元启动时工作区
> 恒干净、HEAD 即基线)。

## 1. 目标

1. **保真标准**:只有当"恢复后行为 ≈ 未中断的延续"可被严格论证时,才允许复用
   session id;任何不确定性 → 不复用,回滚到单元基线重跑。
2. **极简续跑**:恢复提示词收敛为一句 continue(现 resumeNote 含按阶段的多行指引)。
3. **确定性回退**:不可保真时,把工作区恢复到单元启动态(git stash 保全现场 +
   reset 到基线),新会话从干净基线重做本单元——以浪费的部分工作换取确定性
   (用户明确选择)。

## 2. 现状审计:六条恢复路径的连贯性

| # | 路径 | 现状 | 连贯性缺口 |
|---|---|---|---|
| R1 | 执行链会话复用(active 记录 + 会话存活 → attempt 的 resumed) | 复用原会话 + resumeNote(多行阶段指引) | 提示词超量(需求: 一句 continue);复用判据已较严(存活 + 归属门禁 unitReruns + 非报错桩) |
| R2 | requireArtifact step 续跑(phase-plan/phase-handover,openStep) | 复用原会话、保留产物现场(resumedSession) | 保留半途产物 = 恢复后状态与"从未中断"一致(可接受);提示词同 R1 偏重 |
| R3 | 交接续跑(handoff.md `状态: 继续`,新会话凭文档) | 上下文由文档承载,新会话读文档续跑 | 连贯性靠文档质量,非会话保真——属"渐进降级",保真标准下应明确为**不保证**,文档缺失/低质即应回滚重跑(现状是带反馈重试一次再隐性阻塞) |
| R4 | 降级环 / 重试环 fork(failback、最值钱会话分叉) | session.fork 搬消息续跑,上下文随迁 | fork 保真度最高(消息级复制);但换模型后行为漂移未量化——按"模型变更即用户可见变更"论,不属本设计的回滚范围 |
| R5 | 会话死亡(active 记录在、会话不在) | 新会话 + resumeNote(总结态),**保留半途工作区脏区继续** | **主要缺口**:半途的 tool 修改留在工作区,新会话面对"不是自己做的"现场——保真不成立;本设计改为回滚重跑 |
| R6 | 优雅退出(阻塞/pending,总结态记录) | 人工介入后重跑,新会话凭 CURRENT.md 中断备注 | 人工可能已改环境,不复用旧会话(现状正确);半途改动已被 interrupted 提交清扫,基线干净 |

结论:R1/R2/R4 保真度达标(仅需提示词瘦身);R5 需要回滚;R3 降级为"尽力而为"
(文档有效即续,无效即回滚,不再反复索要文档)。

### 2.1 现场实证注记(2026-09-15 审计,出处见根 docs/session-interruption-field-audit-20260915.md)

- **R1 实证可行**:跨 run 复用 4 例(T-013@148.3k / T-014@223.8k / T-019@201.8k /
  T-054@22.3k 上下文),全部成功续作。恢复会话的自我定位动作高度固化(读 CURRENT.md →
  git status/log → PLAN.md 首个未勾选项 → 产物存在性),印证 3.2 可行——会话本就靠盘面
  自定位,恢复提示词只需"继续"信号。
- **R1 恢复序的隐性优点**:恢复时 driver 先刷新 digest 分叉基点,原会话只收尾当前子任务,
  下游子任务一律从新基点分叉——复用失败的爆炸半径被限制在单个子任务(3.4 显性保持)。
- **会话存活必须探测**:现场一例 ECONNRESET(服务端重启)令全链会话蒸发,active 记录在、
  会话不在;存活判定不能凭记录假设(R5 路径的真实入口)。
- **R5 实证**:dm T-010(08-22)新会话对前会话未提交半成品做"法证式"重建(git status/diff +
  编译测试推断),实测侥幸成功但完全依赖模型推理质量——验证本设计"回滚优于脏区续跑"取向。
- **R3 实证失效**:T-019/S07 会话声称已写 testhandoff.md,实测文件从未存在(git 全历史零记录),
  直到 S09 验收子任务才兜底发现;另有一次交接会话违反"勿在本会话修复"指令自行 chmod。
  结论:**"完成判定不靠 agent 自报"必须同样适用于交接文档**——写核提前到交接边界(3.3)。
- **上下文超限暴露**:交接仅在"测试失败 × 达上限"双条件触发,现场会话普遍冲到上限 2–4 倍
  (64k/80k 上限 vs 实测 72.7k–264.3k);上下文越大,会话死亡(R1→R5)的损失面越大(3.5 ①)。
- **配额类错误换新会话重试结构性无效**:账户级限制,现场 2 次重试 1 秒内同错返回(3.5 ②)。
- **服务商切换跨 run 天然安全**(盘面台账架构,现场 4 次换模工作连续),但 model 一致性
  必须进复用判据(3.1 ④);两个目标目录 opencode.json 均残留 4 个重复 model 键
  (JSON last-wins),配置漂移是真实发生过的现场事实。

## 3. 设计

### 3.1 可恢复 session id 的记录标准(收紧)

同时满足才记录为"可恢复":

1. 提示词下发成功且回合正常进行(现状: 下发即写 active 记录,已满足);
2. 记录携带单元归属(phase + index,单元归属门禁已有);
3. **单元基线在册**:记录里补 `baseline`(逐仓库 HEAD SHA,commit-boundary 已有
   unitBaseline)——恢复时核对当前各仓库 HEAD:HEAD == baseline 或
   baseline..HEAD 全部带 Auto-Stage trailer(即期间只有 driver 提交),否则外部
   提交已混入,会话上下文对现状的认知失真 → 不复用,回滚。
4. **model 一致性**(2026-09-15 补):记录补 `model`(生效 provider/model 串)——
   恢复时与当前配置解析出的模型不一致 → 不复用。会话在异模型上续跑 = 行为漂移,
   属用户可见变更(与 R4 同一法理);顺带拦截目标目录 opencode.json 重复 model 键
   last-wins 一类的配置漂移(现场两个目标目录均残留 4 个重复键,生效模型未必是本意)。

Progress 结构加可选 `baseline` 与 `model` 字段(旧记录无此二字段 → 视为不可恢复,
走回滚路径;灰度期可用环境变量 `OPENCODE_AUTO_STRICT_RESUME` 控制新旧行为,缺省沿用
现状,实验定型后转正——与 fork 开关同一模式)。

### 3.2 极简续跑(一句 continue)

- R1/R2 的 resumeNote 收敛为单句,如:`[driver] 会话曾中断,请继续当前工作直至本单元完成。`
- 阶段指引信息本就冗余:会话上下文里已有任务提示词与进度,恢复时真正需要的只有
  "继续"信号与"到什么程度算完"(原提示词已含)。逐步骤的下一步指引保留在
  **交接文档/状态文件**里,不进恢复提示词。
- 文案改动集中在 runner.ts resumeNote + 各模板不动;prompt.test.ts 同步。
- **2026-09-17 补**:一句 continue 追加半句提交语义澄清(「中断前落盘的修改若已
  不在工作区,即已由 driver 统一提交进 Git——以 git log 核实,不要重做」)。起因是
  恢复会话以 git 核对盘面时,「工作区干净 / git log 出现陌生提交」会被误读为修改
  丢失而重做:中断前的修改可能仍在工作区待提交(单元中途被打断),也可能已由
  driver 统一提交(定版/交接/单元收口)或经人工处置提交(中断后重跑的 clean 门禁
  要求人工处置脏区)。非一句 continue 的恢复路径(resumeNote 多行指引)与测试交接
  的 fork 恢复插话(exec-session)同步带上同一句(共用 `COMMIT_CLARIFY` 常量,
  resume-gate.ts)。

### 3.3 回滚协议(不可保真时)

触发条件(满足其一):

- active 记录的会话不可复用(死亡/报错桩/--new-session)且单元基线在册;
- 基线核对失败(外部提交混入);
- model 不一致(3.1 ④);
- 交接续跑文档缺失/无效(R3 收紧)——**含交接边界写核**(2026-09-15 补):交接会话
  结束后 driver 立即核验交接文档在盘且以 `状态: 继续` 收尾,缺失即触发回滚,不在
  下一会话读取时才发现。实证:S07 会话声称已写 testhandoff.md,文件从未存在
  (git 全历史零记录),验收期才兜底——"完成判定不靠 agent 自报"同样适用于交接
  文档,发现时机必须从验收期提前到交接边界。

动作(逐仓库,深度优先,镜像 commitTree 的遍历):

1. `git stash push -u -m "auto-rollback <task> <unit> <timestamp>"`(保全现场,
   未提交改动可人工找回;`.auto/`、`tmp/` 已被 gitignore,天然不参与);
2. 若 baseline..HEAD 间存在本单元的 driver 提交(子任务中间交接提交等):
   `git reset --soft <baseline>` 后再 stash——把本单元已落账的部分工作一并收回
   stash,分支回到基线(已推送/被人引用的提交不适用——目标目录为 driver 专政
   仓库,默认不推送,若检测到 upstream 则跳过 reset 只 stash 并告警);
3. 进度记录转总结态(active=false,baseline 清除),CURRENT.md 写回滚备注;
4. 新会话从干净基线重做本单元(冷启动提示词,不附 resumeNote)。

不做的事:不 stash 嵌套仓库之外的任何东西;不动人工提交(检测到外部提交时
**不回滚**,直接 dirty 阻塞交人工——回滚只回收 driver 自己的单元内改动)。

### 3.4 与既有机制的关系

- **单元提交边界(commit-boundary)**:本设计消费其基线与 trailer 校验;回滚后
  单元以 clean 重新启动,门禁自然通过。
- **单元归属门禁(unitReruns)**:不变——回滚只影响"会话与现场",不影响"哪个
  单元将重跑"的路由。
- **统一提交**:回滚产生的 stash 不属提交轨迹;新会话重做的单元照常逐会话提交。
- **统计**:被回滚单元的已记账会话时长保留(真实消耗),重做部分增量入账。
- **降级环(failback)**:fork 续跑(R4)不触发回滚——fork 是消息级复制,保真度
  高于文档交接;仅当 fork 也失败才落回滚。
- **fork 分解**(2026-09-15 显性化):R1 恢复时先刷新 digest 分叉基点、原会话仅收尾
  当前子任务,下游子任务一律从新基点分叉——被复用会话的失败爆炸半径 = 单个子任务。
  该结构为现场实证的隐性优点,实施时必须保持(回滚协议不改变 fork 节奏)。

### 3.5 相邻机制的实证修正建议(2026-09-15 登记,不属本设计实施范围)

以下两条由现场审计得出(出处见根 docs/session-interruption-field-audit-20260915.md),
登记给属主设计,避免散失:

1. **交接触发解耦**(**已实施 2026-09-15**,见 plans/0023-test-handover-early-design.md):现状
   交接仅在"测试失败 × 上下文达上限"双条件触发,现场会话普遍冲到上限 2–4 倍
   (64k/80k 上限 vs 实测 72.7k–264.3k)——测试连绿时会话无限增长,会话死亡时损失面
   随之放大,与恢复保真直接耦合。建议:上下文达上限单条件(在子任务安全边界)即交接。
   属主: runner.ts 交接判定(fork-decompose / commit-boundary 体系)。
   **落地取的安全边界是"AI 发起测试的那一刻"**(tmp/test.sh 出现时): 发起测试通常
   意味着相关工作已做完、正要验证,是唯一天然干净的分割点;判据随之解耦为
   `used ≥ contextLimit` 单条件。配套 D3「一次交接两次提交」使交接点工作区变干净,
   同时消解 §6 登记的"交接续跑脏区豁免"在这条路径上的局限。
2. **配额类错误免烧新会话重试**:配额是账户级限制,换新会话重试结构性无效(现场 2 次
   重试 1 秒内同错返回)。classifySessionError 已归 quota 类,重试环应跳过新会话重试,
   直接进降级环(未配置候选则阻塞)。属主: plans/0015-session-error-retry-plan.md /
   plans/0017-model-routing-design.md。

## 4. 分期实施(2026-09-15 全部完成)

落点速览(2026-09-15 会话 1 已改文件): `src/switches.ts`、`src/resume.ts`、
`src/git.ts`、`src/runner.ts`、`test/switches.test.ts`;typecheck 干净、全量
`bun test` 706 绿(注入化改造最后一笔之前的一次全量,其后仅 typecheck 复验)。

- [x] **S1-a 开关**(S3 前置): `OPENCODE_AUTO_STRICT_RESUME`(off|on,缺省 off)
  全套登记(switches.ts 的 SWITCH_ENV/Switches/DEFAULTS/parse/nonDefault/format);
  test/switches.test.ts 已同步(十六变量、非法值、非默认项)。
- [x] **S1-b 字段**: resume.ts Progress 加 `baseline?: UnitBaseline`(type-import 自
  git.ts,无环)+ `model?: string`,parseProgress 往返(baseline 数组逐项校验)。
- [x] **S1-c 核对**: git.ts 抽出共享 `foreignCommits(root, sha)`(unitViolations 同步
  改用);新增 `baselineIntact(dir, baseline)`——只查 HEAD==基线或区间全 Auto-Stage,
  **不查未提交改动**(半途脏区正是恢复对象)。
- [x] **S1-d 记录**: runner.ts attempt 的 remember() 在 strictResumeActive 时写
  `baseline: chain.baseline ?? unitBaseline(dir)` 与 `model: promptModel`(target
  求值后回填的外层 let);链上基线置点: runTask 入口、persistStage(阶段边界刷新,
  回滚半径收窄)、runSubtask(子任务门禁后)、requireArtifact(unitStart 链)。
- [x] **S1-e resumeNote 瘦身**: `reused && strictResume` → 单句
  `[driver] 会话曾中断,请继续当前工作直至本单元完成。`;非复用路径(优雅退出
  总结态)保持既有按阶段指引;resumeNote 已 export。
- [x] **S2-a rollbackUnit(dir, baseline, info)**(git.ts): 逐仓库镜像 commitTree
  深度优先;外部提交 → 该仓库不动、计 failures(整体 ok=false → 调用方 dirty);
  `stash push -u -m "auto-rollback …" -- .`(pathspec 限定子树);有 upstream → 跳过
  reset 只 stash 告警;基线为空仓库/仓库不在基线 → 仅 stash;reset --soft 后二次
  stash 收回已落账提交;返回 RollbackResult{ok,failures,stashes,resets,skipped}。
- [x] **S2-b R5 接线**(runTask 恢复块): strict 分支——基线核对失败 → `dirty` 出口;
  会话死亡/报错桩/--new-session/model 不一致 → `rollbackUnitState`(runner 侧编排:
  rollbackUnit + 记录转总结态清基线/模型 + CURRENT.md 回滚备注)→ `recalled.active
  = false`(pipeline 走非恢复续跑语义)、不设 chain.note(冷启动);`rolledBack`
  备注随后并入任务镜像 writeCurrent。旧记录无基线(legacyRecord)→ alive 强制
  false → 走既有新会话路径(文案注明)。
- [x] **S2-c R3 收紧 + 交接边界写核**: executeWhole/runSubtask——handoverDue 后文档
  无效一次即 `rollbackRedo()`(回滚 + continuation/feedback/retried 与链状态复位
  + 冷启动重做,runSubtask 另从基点重新 seedForkSession),`rolled` 一次为限,再
  失败按既有隐性阻塞上抛;watch 的 handleIdleTest 在 strict 下文档缺失/为空直接
  `{type:"invalid"}`(不再 steer 补写重试)→ idle 处折成 blocked +
  `Watch.testHandoverInvalid` → attempt 折成 `SessionResult.rollback` 标记 → 单元
  所有者回滚重做;**作用域**: fixRound 无基线上下文,忽略该标记维持现状(阻塞),
  回滚重做只落在 executeWhole/runSubtask 两处(决策: 修复轮回滚锚点不属本设计的
  单元范畴)。恢复时交接文档在场但无状态行(handoffInvalid,需基线在册)→ 回滚
  而非凭文档续跑;`handoffStatus()` 统一状态行判据。
- [x] **S2-d requireArtifact step 续跑严格化**: sameStep 且基线在册 → baselineIntact
  失败 dirty;model 不一致/记录无 model/死亡 → rollbackUnitState 后按全新步骤重做;
  旧记录无基线 → 不复用、走既有"开新会话重做本步骤"。
- [x] **S1/S2 测试**:
  - test/resume.test.ts: baseline/model 往返、缺字段记录兼容;
  - test/git.test.ts: baselineIntact(HEAD==基线/driver 区间通过/外部提交检出/空基线)
    与 rollbackUnit(脏区+driver 提交 → stash×2+reset 回基线、stash list 含
    auto-rollback、工作区净;外部提交 → ok=false 且仓库原样;upstream → 只 stash;
    空基线 → 只 stash;嵌套仓库各自回滚);
  - test/runner.test.ts: resumeNote 两态(需注入,见下);requireArtifact strict
    路径(注入 switches: 记录带 baseline+model 匹配 → 复用;model 不一致/会话死 →
    回滚后重开——git init 临时仓 + saveProgress 构造记录,断言 HEAD 复位与
    stash 存在)。
- [x] **S3 收尾**:
  - 可注入化补完(已做): ① requireArtifact 内部 strictResumeActive 传 switches;
    ② watch 加 switches 形参(attempt 调用点透传),handleIdleTest 用之;③ resumeNote
    加第三参 `strictResume = autoSwitches().strictResume`,runTask/requireArtifact 三个
    调用点传**门禁值** `strict`(§4.1 ⑥,非裸开关);④ attempt 的 remember 里
    strictResumeActive 传 switches(runTask 入口的门禁调用一并透传)。
    executeWhole/runSubtask 的 strictResumeActive(opts) 不在单测面上,保持现状;
  - 文档同步: docs/behavior.md(严格恢复行为段: 记录标准/核对/回滚/未配路由时
    一律不复用的口径)、docs/structure.md(switches 第十六变量 + git.ts
    baselineIntact/rollbackUnit + runner.ts 增补)、包 AGENTS.md 导航行、根
    /workspace/aseo/AGENTS.md「进行中的方案」段(改为已实施 + 开关缺省 off 灰度)、
    本文件状态行转"已实施(灰度)";
  - 终验: 包目录 `bun typecheck` + `bun test` 全绿。

落定(2026-09-15 会话 2): 注入化四处全部补完(requireArtifact 的 strictResumeActive
传 switches、watch 加 switches 形参经 attempt 透传、resumeNote 第三参由调用点传门禁值、
attempt 的 remember 传 switches;runTask 入口的门禁调用一并透传)。新增测试 20 例——
test/resume.test.ts 2(baseline/model 往返与坏值容错)、test/git.test.ts 8
(baselineIntact 三例 + rollbackUnit 五例,含 upstream 自引用构造与嵌套仓库)、
test/runner.test.ts 9(resumeNote 三态 + requireArtifact 严格路径六态,含开关 off 的
等价现状回归);反向核对已做——把注入的 strictResume 改 off,四条严格用例应声而倒。
auto-core `bun typecheck` 干净、`bun test` 726 全绿(前 706);auto 壳 typecheck 干净、
e2e 52 通过(新增 --commit false 退役一例)。

### 4.1 实施期决策记录(设计文本之外的落定口径)

1. **门禁联动**: 严格机制整体 gated 于 `strictResumeActive = 开关 on 且
   --commit true 且非 dryrun`;off(缺省)记录不带新字段、核对与回滚逐字节等价现状。
2. **无路由即不复用**(§5 字面口径): 未配 OPENCODE_AUTO_MODEL 时记录无 model 可写,
   严格恢复下视同不匹配 → 回滚;需会话复用须配置路由(behavior.md 要写明)。
3. **基线锚点分级**: 任务入口基线(runTask,与 loop beginUnit 同 HEAD)被子任务/
   阶段边界基线覆盖收窄;更近基线与更远基线在"区间全 driver 提交"下核对等价,
   回滚半径更小。
4. **外部提交 ≠ 回滚**: 一律 dirty 交人工(3.3「不做的事」),包括恢复核对与
   rollbackUnit 双侧。
5. **中途回滚重做的界**: executeWhole/runSubtask 各一次(`rolled`),再失败走既有
   隐性阻塞;现场已保全在 stash。
6. **resumeNote 的门禁口径**(2026-09-15 会话 2 落定): 第三参由调用点传**门禁值**
   `strictResumeActive(opts, switches)`,不是裸开关——门禁不在位时没有单元基线也没有
   回滚兜底,"一句 continue"赖以成立的前提(不可保真即回滚重跑)不存在,故维持既有
   多行阶段指引。与 §4.1 ① 同一法理。
7. **`--commit false` 退役**(2026-09-15 用户决策,plans/0021-commit-boundary-design.md D7):
   提交关闭档与本设计(及提交边界)冲突——门禁关闭时严格恢复整体空转,却要求每个
   新机制都挂一条空转分支。已做入口层软退役: CLI `--commit false`/`none` 与配置
   `commit: false` 出现即用法错误/严格失败;`strictResumeActive` 的 `opts.commit !== false`
   项随之恒真,门禁实际只剩"开关 on 且非 dryrun"。代码侧门禁分支暂留,清理另立任务。

## 5. 风险

- **工作浪费**:回滚丢弃半途工作(stash 可找回);对比现状"脏区续跑"的隐性风险,
  用户已拍板取确定性。
- **reset 的可见性**:soft reset 改分支历史;仅限无 upstream 的 driver 仓库,
  有 upstream 即降级为 stash-only + 告警。
- **旧记录兼容**:无 baseline/model 字段的存量 active 记录一律视为不可恢复(新会话/
  回滚二选一由 S1 开关控制),避免半吊子核对。model 一致性核对只判"记录在册且不匹配"
  → 不复用;记录缺失视同不匹配,与 baseline 同口径。
