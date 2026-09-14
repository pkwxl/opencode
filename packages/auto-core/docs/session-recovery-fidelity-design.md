# 会话恢复保真设计:可恢复 session id 标准、极简续跑与 stash 回滚

> 状态: 2026-09-14 立项,**设计定稿、实施另立分步计划**(commit-boundary-design.md
> 决策 D6)。用户需求原文(2026-09-14):AI 会话启动时若执行进度正常,记录其
> session id 供中断恢复;恢复时必须严格确保 session id 对应当前过程中断时的会话,
> 且**最多附加一句 `continue` prompt**,避免过多 prompt 干扰;记录可恢复 session id
> 的标准极高——恢复后的工作须与未中断状态高度一致(含 AI 经 tool 完成的本地修改);
> 若无法保证,应经 `git stash` 将状态恢复至过程启动时的初始状态,开新会话继续。
> 回滚锚点 = commit-boundary-design.md 落地的单元 clean 基线(单元启动时工作区
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

## 3. 设计

### 3.1 可恢复 session id 的记录标准(收紧)

同时满足才记录为"可恢复":

1. 提示词下发成功且回合正常进行(现状: 下发即写 active 记录,已满足);
2. 记录携带单元归属(phase + index,单元归属门禁已有);
3. **单元基线在册**:记录里补 `baseline`(逐仓库 HEAD SHA,commit-boundary 已有
   unitBaseline)——恢复时核对当前各仓库 HEAD:HEAD == baseline 或
   baseline..HEAD 全部带 Auto-Stage trailer(即期间只有 driver 提交),否则外部
   提交已混入,会话上下文对现状的认知失真 → 不复用,回滚。

Progress 结构加可选 `baseline` 字段(旧记录无此字段 → 视为不可恢复,走回滚路径;
灰度期可用环境变量 `OPENCODE_AUTO_STRICT_RESUME` 控制新旧行为,缺省沿用现状,
实验定型后转正——与 fork 开关同一模式)。

### 3.2 极简续跑(一句 continue)

- R1/R2 的 resumeNote 收敛为单句,如:`[driver] 会话曾中断,请继续当前工作直至本单元完成。`
- 阶段指引信息本就冗余:会话上下文里已有任务提示词与进度,恢复时真正需要的只有
  "继续"信号与"到什么程度算完"(原提示词已含)。逐步骤的下一步指引保留在
  **交接文档/状态文件**里,不进恢复提示词。
- 文案改动集中在 runner.ts resumeNote + 各模板不动;prompt.test.ts 同步。

### 3.3 回滚协议(不可保真时)

触发条件(满足其一):

- active 记录的会话不可复用(死亡/报错桩/--new-session)且单元基线在册;
- 基线核对失败(外部提交混入);
- 交接续跑文档缺失/无效(R3 收紧)。

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

## 4. 分期(实施另立计划)

- **S1** 基线入记录 + 核对:Progress.baseline、恢复时核对、失败走 dirty(不动
  回滚);resumeNote 瘦身。测试: resume.test.ts 扩展。
- **S2** 回滚协议:rollbackUnit(dir, baseline)(git.ts),R5 路径接线(会话死亡时
  先回滚再新会话);R3 收紧(交接文档无效一次即回滚,不再带反馈重试)。
- **S3** 开关与灰度:OPENCODE_AUTO_STRICT_RESUME(off|on,缺省 off = 现状),实验
  结论后转正;文档同步(behavior/structure/AGENTS/本文件勾选)。

## 5. 风险

- **工作浪费**:回滚丢弃半途工作(stash 可找回);对比现状"脏区续跑"的隐性风险,
  用户已拍板取确定性。
- **reset 的可见性**:soft reset 改分支历史;仅限无 upstream 的 driver 仓库,
  有 upstream 即降级为 stash-only + 告警。
- **旧记录兼容**:无 baseline 字段的存量 active 记录一律视为不可恢复(新会话/
  回滚二选一由 S1 开关控制),避免半吊子核对。
