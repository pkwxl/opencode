# 会话边界加固:跨任务状态混淆防护、零落盘完成判定与在途失联探针

> 状态: 2026-09-16 立项,设计定稿待实施(S1–S8 见 §5 勾选表)。
> 起因:kernel-dm T-068 S01 会话静默事故(2026-09-16 15:07 run,旧版
> migrate@c9af64969 构建)三层叠加:①子任务会话在 22 分钟只读调研中读入前序任务
> T-067 的收尾叙事,误判"所有任务均已完成",零产物结束回合;②runSubtask 在
> steer=off 时"自然结束即勾选",该误判本可直接推进流水线;③传输层半开连接同杀
> SSE 与同步 prompt 两通道,driver 悬挂 44 分钟无任何超时覆盖,直至人工 Ctrl+C×2。
> 现场证据:目标目录 `.auto/logs/run-2026-09-16_15-07-45.log`、
> `docs/T-067/audit/s10-session-integrity.md`(T-067 侧 §J 锚点错位已由 2124cbab9
> 等修复并合入现行版,与本计划不重叠)。

## 1. 事实基线(三层因果与证据)

### 1.1 语义层:三级导航把子任务会话推向 T-067 完成叙事

- 子任务描述直接导航:`subtasks.md:34`"模板 = 同目录 `r5-m-p5-verity-record.md`"
  ——P6 以 P5 批记录为格式模板是目标目录工作流的正当需求。
- digest 回源指针:`context.md:85/139/175/198` 共 4 处指回 T-067 报告/交棒义务/先例。
- 共享仓库 git log:近期提交全是 T-067 收尾("done / S10 收口 / 测试交接 #1 定版"),
  不可消除。
- 编号撞名放大:T-067 子任务 S01–S10 与 T-068 S01 同名,"前任务 S01–S10 全勾"
  存在被读成"S01 已完成"的字面捷径。
- fork 前缀本身干净(T-068 digest 基点 12.8k,context.md 明说批记录"尚不存在,
  S01 建")——混淆源于运行中读入,非基点污染;终态消息(据 opencode DB)为
  "所有任务均已完成",全程零落盘。

结论:**"完全禁止导航"与单源回源设计冲突且做不到**(git log 挡不住)。正确目标是
让"前序任务的完成叙事"无法被读成"本任务状态",并在误读发生时由 driver 判定层兜住。

### 1.2 判定层:自然结束 = 完成是 steer=off 路径的缺口

- `src/execute.ts:401`:`if (!handoverDue(steer, chain.used)) break`——steer=off 时
  恒 false,会话自然结束被无条件视为子任务完成,直接勾选。
- `src/git.ts` commitPending 对零改动返回 `"clean"` 不报错——零落盘同样成立勾选,
  误判本可推进到 S02(本次因 §1.3 悬挂未及兑现)。
- 这与 commit-boundary-design"完成判定 = 产物/状态落盘且统一提交成功"在子任务
  自然结束路径上存在校验缺口。

### 1.3 机械层:半开连接两通道同死,无任何超时覆盖

- Ctrl+C 时 progress.json 仍指向 decompose 会话(at=15:36:29)→ S01 的同步
  prompt POST 44 分钟未返回(`src/attempt.ts:202` prompt → 215 remember → 217
  `await watching`;remember 未执行即 POST 未返回)。
- SSE 侧全程无"事件流中断"日志(`src/watch.ts:497`,仅在流显式结束时触发)
  → 半开连接无 FIN/RST,客户端永远收不到结束信号。
- DB 证据(用户提供):回合已在服务端结束、终态消息已持久化 → 传输层半开,
  非服务端停滞;TURN_TIMEOUT(2h)只兜 POST,SSE watching 无上界。
- 表现:心跳照打(0/12)、/exit 无边界可挂、唯一出口 Ctrl+C×2。
- 修复方向由"prompt 返回后对账"修正为**在途周期探针**——半开场景 prompt 根本
  不返回,只有旁路新连接能探知真相。

## 2. 目标与非目标

目标:

1. 前序任务的完成叙事无法被读成当前任务状态(语义防护)。
2. 会话自然结束但零落盘时不得推进流水线(判定加固)。
3. 半开失联在 idleTime 量级内被检测并自动处置(机械兜底)。

非目标:

- 不禁止跨任务导航(单源回源 + 先例模板是目标目录工作流的正当需求)。
- 不做读权限硬隔离(与单源回源冲突、SDK 无每会话权限注入、挡不住 git log)。
- 不改动 T-067 侧 §J 已修复机制;不新增灰度开关(三项均低风险行为加固,
  对齐 test-handover-early-design §F 不做灰度的先例,缺省启用)。
- **不做子任务级语义判卷会话**(D4 取舍,2026-09-16):语义完整性无确定性判据,
  可信机制是独立判卷(verify-judge 先例),但会话数与成本不成比例;纯文档型产物
  无测试兜底的真缺口,由形检 + 任务级 verify/review 间接覆盖权衡承接。

## 3. 决策表(已确认 2026-09-16)

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 导航隔离组合 | **L1 权威状态接地 + L2 digest 写作纪律 + L3 全限定编号**;否决读权限硬隔离 |
| D2 | 零落盘自然结束处置 | **带反馈重提示一次**(反馈复述权威状态、直指误判),仍零产物 → blocked 交人工;dryrun/commit off 不启用;testHandover 收场豁免 |
| D3 | 失联探针 | **复用 idleTime(缺省 10min)为周期,连续 2 次探针失败 → 判半开 → abort 回合 + SSE 收口 → 走既有可重试会话错误阶梯**(自动接入降级环);探针成功即重置计数 |
| D4 | 子任务产物完整性校验 | **预期产物清单形检**(subtasks.md `产出:` 字段结构化;存在性 + 新建 .md 非平凡/末行非语义终止符 + 可选章节清单),复用 D2 重提示→blocked 环;**不做语义判卷会话**——语义层维持任务级 verify(代码有 driver 测试兜底)与 review 间接覆盖 |
| D5 | 自动会话产物形检 | **扩展至 understand/decompose/wrapup 三类 driver 已知路径文档**(context.md/subtasks.md/report.md):统一追加非平凡+末行终止符,wrapup 补齐存在性门禁(现零校验);同一非语义终止符 `<!-- auto: eof -->`,**不用 `状态:` 行**(避免与续跑契约撞语义、避免给 report 等跨任务叙事文件盖"完成"字样) |
| D6 | 全量文档终止符 | **git 推导全量扫描**:单元收口时,本单元 git 变更内所有 .md(新建或修改)须非平凡且末行 = `<!-- auto: eof -->`;豁免 driver 独占状态文件(PLAN.md/CURRENT.md/.auto/)与自带终态契约的交接文档族(handoff/testhandoff)。与 D4/D5 互补——存在性抓"该有的没有",全量扫描抓"写了的没写完"(含未声明的顺带文档)。eof 只证明"写完了"(机械可判定),质量归 verify/review |

## 4. 实施设计

### 4.1 L1 权威状态接地 + L3 全限定编号

- 落点:提示词文案进 `templates/prompts/`(partial 或 subtask 模板头部,保持
  `with { type: "file" }` 导入),数据组装进 `src/prompt.ts` renderSubtask。
- 每 个子任务会话注入 driver 从 PLAN 台账生成的状态块:
  - 当前任务 id/标题/状态(进行中);
  - 本子任务**全限定编号**(`T-068.S01`)与勾选快照(`S01☐ .. S12☐,已完成 0/12`);
  - 前序任务完成声明:队列中已完成任务列表 + "独立任务,其收尾/完成信息与本任务
    进度无关;其文档仅可作格式/先例参考"。
- 展示层(PLAN.md)保留 S01 短编号,全限定只进提示词。

### 4.2 L2 digest 写作纪律

- 落点:understand/decompose 提示词模板(`templates/prompts/`)。
- 规则:跨任务引用只指**阶段级单源**(裁决/契约/台账);引用前序**任务级收尾
  产物**(report/批记录/testhandoff)必须带"已完成另一任务的产物,仅作格式模板"
  定性;能摘录要点不整文回源。

### 4.3 零落盘自然结束处置与产物形检(D2/D4)

- 落点:`src/execute.ts` runSubtask 循环(401 行 break 之前)+ subtasks.md `产出:`
  字段结构化解析 + `templates/prompts/subtask.md`(文档末行终止符纪律)。
- 会话自然结束(未触发 handoverDue)时执行产物形检,任一不过 → feedback 重提示
  一次(复用 ondemand 交接已有的 feedback/retried 环路结构);仍不过 → blocked
  ("子任务会话自然结束但产物形检未过")。检查项:
  1. **零落盘**:commit 开启且工作区相对 unitBaseline 零变更;
  2. **预期产物存在性**:subtasks.md 每项的 `产出:` 声明为结构化路径清单
     (driver 不硬编码 index.md 等工作区约定,清单来自声明),逐路径校验存在;
  3. **新建 .md 非平凡 + 末行终止符**:本单元新建的声明文档须 ≥ 保守阈值
     (实施时定)且末行非空行 = `<!-- auto: eof -->`(非语义终止符——避免与
     handoff/testhandoff `状态:` 行撞语义,避免给跨任务完成叙事盖"完成"字样);
  4. **章节清单(可选)**:声明必填章节标题则逐项校验存在。
- feedback 文案复述权威状态(L1)并引用未过关项(缺失文件/截断嫌疑),直指误判。
- 豁免:dryrun/commit off;testHandover 收场会话(其完成判据在 testhandoff.md)。

### 4.4 在途失联探针(D3)

- 落点:`src/watch.ts`(watching 主循环侧挂探针定时器)+ `src/attempt.ts`(接线)。
- watching 在途期间每 idleTime 分钟发一个轻量短超时查询(独立 fetch 连接;端点
  实施时定,如会话元信息 GET),**连续 2 次**失败/超时 → 判半开。
- 处置:log 探针失败明细 → `client.session.abort`(容错)→ 释放 SSE reader →
  返回**可重试会话错误**(走既有 classifySessionError/transient 分类,自动接
  重试阶梯与降级环;新连接 fork 续跑,配合 4.1 接地重发权威状态)。
- 探针成功即重置计数;正常 idle/结束路径清理定时器(无泄漏)。覆盖全部 AI 会话
  (attempt 层接线,含 verify-judge 等旁路会话)。
- 检测原理:探针用新连接,半开旧连接不影响新请求——这正是旁路检测的依据;
  两连败排除服务端瞬时抖动(GC 停顿等)。TURN_TIMEOUT 2h 保留为 POST 最终兜底。

### 4.5 自动会话产物形检(D5)

- 三类自动会话的产物路径 driver 已知固定(context/subtasks 经 taskDoc 构造 +
  resolveTaskDoc 旧平铺名回落;report 为 wrapup 模板定死 `docs/<taskId>/report.md`),
  **无需声明清单**。
- 现状不对称:ensureUnderstood/ensureDecomposed 已有存在性(+非空)检查与
  重试环,缺非平凡+终止符;**wrapup 会话后无任何产物校验**(runner.ts 收尾段
  runSession 结束直接 afterSession 提交)——本节补齐。
- 加固:三类文档统一追加非平凡(保守阈值)+ 末行终止符检查;wrapup 先补
  存在性。不过 → 同型重提示一次 → blocked(understand/decompose 接入既有
  重试环,wrapup 新增)。
- **只查本次会话产出,不追溯存量**:understand/decompose 的"已存在即跳过/
  直接注入"路径语义不变,历史无终止符文档不受影响——否则存量任务全部卡死。
- 模板落点:终止符纪律进 `templates/prompts/_partials.md` 共享段
  (understand/decompose 各变体/subtask/wrapup 共用),避免逐模板复制。
- 杠杆说明:subtasks.md 是 D4 清单之源、context.md 是全部子任务会话的 digest
  基点、report.md 是跨任务收尾叙事载体(L2 压制对象)——截断/空壳在此直接
  放大事故面。

### 4.6 全量文档终止符(D6)

- 规则:单元收口时,经既有 unitBaseline/changedFiles 取本单元 git 变更内
  **所有 .md(新建或修改)**,逐文件校验非平凡 + 末行 = `<!-- auto: eof -->`
  (非空行、末行为准)。
- 豁免清单(代码内具名常量):`PLAN.md`/`CURRENT.md`(driver 独占状态写入,
  protect.ts 域)、`.auto/` 下状态文件、`handoff.md`/`testhandoff-<n>.md`
  (自带 `状态:` 终态契约,语义不混用)。
- 与 D4/D5 互补:存在性检查(声明清单/固定路径)抓"该有的没有"——未创建的
  文件对 git 扫描不可见;全量扫描抓"写了的没写完"——未声明的顺带文档
  (子任务多写的分析、whole 模式任务文档)同样覆盖。
- 修改既有文档:中途改写后若 eof 不在末行即不过(检测"追加在终止符之后"的
  截断形态);重提示反馈指引恢复末行终止符。
- 不过 → 重提示一次 → blocked,与 D2/D4 同环。

## 5. 实施步骤(勾选表)

- [x] S1 L1 接地块 + L3 全限定编号:templates/prompts 文案 + `src/prompt.ts` 组装 + `test/prompt-exec.test.ts` 断言(2026-09-17 已实施:文案为 `_partials.md` 新增 `ground-state` 片段,`subtask.md` 头部引用;renderSubtask 组装 taskTitle/taskStatusText/qualifiedId/subtaskSnapshot/doneIds 五变量——快照 `S01☑ S02☐ …,已完成 k/n`、全限定编号两位补零、前序 done 任务只内联 id 不复述 head 清单;夹具 groundPlan/groundTask 复现撞名形态,断言含「他任务 S 编号与本任务无关」「S01☑ 不得出现」)
- [x] S2 L2 digest 纪律:understand/decompose 模板 + 模板测试(2026-09-17 已实施:文案为 `_partials.md` 新增 `digest-rule` 片段——三条纪律(只指阶段级单源/收尾产物带「已完成另一任务的产物,仅作格式模板」定性/摘录优先不整文回源)+ 背景行写明误读后果;understand.md 与 decompose 基础+六阶段变体(a/d/k/m/t/v)共 8 份模板在产物说明与 doc-layout 之间引用;测试在 `test/prompt-template.test.ts`——消费方恰 8 份、subtask/whole 不引用、片段纪律断言与全量渲染无残留)
- [x] S3 零落盘 + 产物形检:`产出:` 字段结构化解析 + `src/execute.ts` 形检(存在性/非平凡/终止符/可选章节)+ `templates/prompts/subtask.md` 终止符纪律 + 单测(零落盘→重提示→仍零→blocked;清单缺失/截断→同环;形检全过→正常勾选;dryrun/testHandover 豁免)(2026-09-17 已实施:解析为 `src/plan.ts` 的 `declaredArtifacts`(路径样判据宽进: 含 `/` 或带扩展名才算声明,圆括号可选章节清单、反引号剥壳、括号内分隔符不切断路径);确定性判据集中在新增叶子模块 `src/doccheck.ts`(`EOF_MARK`/`MIN_DOC_CHARS=120`/`endsWithEof`/`docShapeProblems`/`shapeCheckOn`);`src/git.ts` 增 `unitQuiet`(HEAD 未离基线 + 无脏区 = 零落盘,交接路径的 driver 提交即非零)与 `untrackedFiles`(porcelain ?? 项 = 本单元新建,嵌套仓库一致;gitStatusFiles 重构为 statusEntries 保留 XY);runSubtask 自然结束先过形检,与交接文档反馈环各自的 retried 计数、各限一次,blocked 文案含全部未过关项,反馈复述 L1 权威状态(全限定编号 + 勾选快照 + 「不要据此判断本子任务已完成」);testHandover 收场豁免经 shapeCheckOn 显式保留(runExecSession 现不外透 testHandover 结果,守卫按设计留存);模板侧 `_partials.md` 新增 `eof-rule` 共享段、subtask.md 引用(S3b 扩展至 understand/decompose/wrapup);测试 `test/subtask-shape.test.ts`(完整 runSubtask 链路 + 真实 git 仓库 11 例)+ `test/plan.test.ts` 解析 4 例 + `test/prompt-template.test.ts` eof-rule 3 例)
- [x] S3b 自动会话形检(D5):understand/decompose 追加非平凡+终止符(接入既有重试环)、wrapup 新增存在性+形检门禁(runner.ts 收尾段)+ `_partials.md` 终止符纪律共享段 + 单测(含"已存在即跳过"路径不受影响断言)(2026-09-17 已实施:understand/decompose 在既有「存在性+两次重试」环内追加 docShapeProblems——内容在但形检不过与缺失分案文案,跳过/直注路径不受影响;wrapup 两调用点(runner 主收尾 + review 修复轮收尾)收口到新模块 `src/wrapup.ts` 的 `runWrapup`——report.md 缺失/为空/形检不过 → 带反馈重试一次 → 仍不过 blocked,门禁不过不提交;模板侧 eof-rule 共享段扩展至 understand/decompose 基础+六阶段变体/wrapup(消费方恰 10 份);测试 `test/auto-doc-shape.test.ts` 9 例(真实 git 仓库全链路:跳过路径零会话、截断/空壳→重提示→补正/仍不过→blocked、wrapup 门禁)+ `test/prompt-template.test.ts` eof-rule 消费清单更新)
- [ ] S3c 全量文档终止符(D6):单元收口处 changedFiles 全量 .md 形检 + 豁免清单 + 单测(修改后 eof 不在末行→拦截;豁免文件不受影响;全过→正常收口)
- [ ] S4 在途探针:`src/watch.ts` + `src/attempt.ts` + 单测(两连败→可重试错误;探针恢复→继续 watching;定时器清理)
- [ ] S5 提示词四件套:`bun test test/prompt-exec.test.ts test/prompt-verify.test.ts test/prompt-phase.test.ts test/prompt-template.test.ts`
- [ ] S6 包级验证:packages/auto-core `bun typecheck` + `bun test` 全绿;packages/auto typecheck 无感
- [ ] S7 migrate 分支 merge auto-core 刷新快照,重构建二进制
- [ ] S8 kernel-dm 现场处置(人工):提交 `docs/T-067/audit/` 过 clean 门禁 → 新版重跑 T-068(S01 零产物丢弃无害,digest 基点复用)→ 观察 L1 接地是否拦住 T-067 叙事误判

## 6. 风险与回滚

- 接地块约 200 tokens/子任务会话,可忽略;台账解析复用 `src/plan.ts`。
- S3 误伤"合法零落盘"子任务:目标目录工作流子任务均有产物(commit-boundary
  设计);若现场确有合法零落盘,blocked 交人工是设计内出口。
- 形检摩擦:终止符忘写/清单声明噪声会触发重提示,一次为限、blocked 出口明确;
  修改型(非新建)产物的存在性检查恒真,无害。
- wrapup 形检为新增门禁:既有工作流若 report 未写此前静默通过,升级后显式
  blocked——属暴露既有缺陷而非误伤;solo 模式模板变体同样适用。
- S4 误判半开:两连败(idleTime 间隔)才判;误判后果 = abort + fork 续跑,无损;
  与 OPENCODE_AUTO_HANDOVER_CONCURRENT=on 的交互(测试收口 catch)实施时验证。
- 回滚:S1–S4 相互独立,任一层可单独还原。

## 7. 与既有机制的关系

- commit-boundary-design:4.3 补全"完成判定 = 落盘且已提交"在子任务自然结束
  路径的校验缺口;形检全部为**确定性判据**(存在/大小/末行/章节),完成判据
  仍非 agent 自报。
- test-handover-early-design §J(已修,2124cbab9):不重叠;testHandover 收场
  会话在 4.3 显式豁免。
- model-routing-design / failback:4.4 失联错误走既有可重试分类,自动接入降级
  环,无新开关、无新退出码。
- config 的 idleTime:语义扩展为"脚本看门狗 + AI 会话探针"共用周期,配置键与
  缺省值(10min)不变。
