# --track-fixme 设计偏差追踪 与 --extract-knowledge 迁移知识沉淀 — 设计说明

> 本文档是 `--track-fixme` 与 `--extract-knowledge` 两个 CLI 能力的唯一设计基准,基于
> 《CLI 扩展需求规范:设计偏差追踪与迁移知识沉淀》(下称"规格书")修订而来。实现任务
> 以本文为准;与规格书冲突之处以本文为准(冲突点在 §2 映射表与 §3 决策表中逐条给出
> 理由)。**本文只做设计,实现按 §H 分期留待后续会话完成**;实现合入前 CLI 不接受这
> 两个选项。

## 背景与动机

1. **偏差显式化**:migrate 模式要求新实现与旧实现行为对等,但真实迁移中总会出现
   "无法完全遵循既定设计/原始接口"的被迫取舍。当前它们只能散落在 `AUTO-DECISION`
   行或报告散文里,不可扫描、不可计数、终审不聚焦。`--track-fixme` 把偏差变成
   代码中的结构化锚点(`AUTO-FIXME`),并由 driver 在终审 audit 阶段确定性扫描、
   由审计会话逐条验证定级,CRITICAL 偏差阻断流水线等人工复核。
2. **知识沉淀**:一次迁移产生的 API 映射、坑点、可复用规则目前只活在会话上下文与
   过程报告里,下一次迁移无法复用。`--extract-knowledge` 在终审闭环通过后,由旁路
   一次性会话把**最终验证过**的迁移经验蒸馏为结构化 Markdown 知识文档;提取失败
   不污染迁移结果本身。

## 1. 与现状的关系(不变量)

- 两个选项均为**可选能力**,缺省完全不影响现有流水线。
- **零新增持久化状态**:FIXME 是代码注释中的事实记录,不是状态机;审计路由复用
  `routeFinal` 的"(带 final 标记的任务及其状态,docs/final/ 产物)"纯函数求值;
  知识提取不写 `.auto/progress.json`(旁路一次性会话,requireArtifact 骨架)。
- **扫描执行权在 driver**(与 verify 三段式同源):driver 本地确定性扫描产出
  `tmp/fixme-scan.md`,审计会话只读判定/调级——不轻信自报,也不让会话跑扫描命令。
- **全局单会话不变量保持**:FIXME 扫描是纯本地进程(不开会话),审计/门禁都挂在
  既有串行流程上,无并行窗口,不需要 worktree。

## 2. 规格书 → 本仓库术语映射

| 规格书概念 | 本仓库对应 |
| --- | --- |
| Planning | `init -p`(renderInit)产出的 PLAN.md |
| Implementation | runTask 执行链(auto 分解→子任务会话 / off、ondemand 整任务会话) |
| Review | `--review` 逐任务质量审核(reviewTask,REVIEW_FILE) |
| Audit | `--final-review` 终审闭环的 audit 任务(`T-F<k>`,`final: audit@<r>`) |
| Final Review | `--final-review` 闭环整体(audit→remediate→validate→finalize) |
| Migration Completed | PLAN 全部任务 done(含终审任务) |
| Pipeline BLOCKED | `block()` 写入 PLAN.md + 退出码 2 |
| FixmeParser/FixmeScanner | `src/fixme.ts` 纯逻辑模块(镜像 verify.ts/check.ts 形态) |
| FixmeAudit | audit 任务的会话侧职责(renderFinalTask audit 分支)+ `routeFinal` 的 parseFixmeSummary 门禁 |
| `.artifacts/audit/fixme.json` | `tmp/fixme-scan.md`(driver 工作目录,gitignored);持久锚点是审计报告 `docs/final/audit-r<N>.md` |
| KnowledgeExtractor(三件套) | 单个旁路一次性会话 renderKnowledge(requireArtifact 骨架,镜像 generateFinalTask);不拆 Collector/Synthesizer/Writer 对象层 |
| `docs/migration-kb/<task_id>.md` | `docs/migration-kb/migration-<时间戳>.md`(本包的迁移单位是整份 PLAN,非单任务;见 §3) |

## 3. 已确认决策

| 决策点 | 结论 |
| --- | --- |
| CLI 形态 | `--track-fixme` 布尔选项(BOOLEAN_FLAGS);`--extract-knowledge[=<path>]` 可选值,专用解析分支(镜像 `-p` 吞值规则,但下一 token 以 `-` 开头时不吞,避免误吞后续选项;`=` 形式天然支持) |
| 依赖关系 | **两者均须搭配 `--final-review`**,否则用法错误退出码 1(镜像 `--early` 需 `--review` 的既有先例)。理由:FIXME 审计的宿主是终审 audit 任务,知识提取的通过门禁是终审闭环完成;脱离宿主的独立形态列为未来扩展(§4) |
| FIXME 载体 | 代码注释锚点,统一四行格式(§A);不建独立状态文件/数据库/生命周期 |
| 扫描范围 | 目标目录全量:各 git root(含嵌套仓库,复用 loop.ts 的根发现逻辑)`git ls-files --cached --others --exclude-standard`,非 git 目录回落文件系统遍历(跳过 `.git`/`node_modules`/`tmp`/`.auto`、二进制与超大文件)。**不采用"运行起点 git 基线 diff"**——`--commit subtask/task` 会在审计前清空工作区状态,基线需新增持久化文件,违背零新增状态原则;全量扫描的代价(可能带上历史遗留 FIXME)可接受:它们本就是未收口的偏差,首轮审计发现后由人工处理 |
| 报告协议扩展 | track-fixme 开启时,audit 报告末三行固定为 `结论: <概述>`、`策略: 重构\|修补\|无`、`FIXME: CRITICAL=<n> WARN=<n> INFO=<n>`(n 为审计调整后的最终计数);driver 新增 `parseFixmeSummary` 镜像 parseStrategy 风格解析 |
| CRITICAL 门禁(audit 后) | 报告计数 CRITICAL≥1 → `block()` 该 audit 任务、退出码 2,**不路由 remediate**——偏差是"已知且被迫"的,自动修复语义不成立,规格书要求人工复核;人工降级(改注释 Severity 后重跑)或修复偏差后继续 |
| 二次门禁(finalize 前) | afterAudit(策略: 无)与 afterValidate(通过)两条 finalize 路由共用 `finalGate`:复扫一次,CRITICAL≥1 → 回退 `audit@<r+1>`(聚焦新 CRITICAL 清单,受 `--final-review` 审计轮上限约束,耗尽熔断)——覆盖末次 audit 之后 remediate/修复轮新引入的偏差;回退后的 audit 会话对自报定级重新验证,若仍 CRITICAL 则走上一行的门禁 |
| malformed FIXME | 解析失败的标记(缺 Severity 行/格式坏)不阻断、不计入三档计数,单列 MALFORMED;审计按 WARN 级发现提示修正注释格式(规格书 §16) |
| audit 任务 verify | track-fixme 开启时,appendFinalTask 的固定结构检查追加 `grep -qE '^FIXME[:：] ?CRITICAL=[0-9]+ WARN=[0-9]+ INFO=[0-9]+$'`——协议缺行走既有 FIX_ROUNDS 修复循环自愈,不新增重试逻辑 |
| 知识触发门禁 | 终审闭环完成(routeFinal complete)才提取;熔断/block/退出码 2 的路径根本不经过提取挂点 → 规格书 TC-08(SKIPPED)天然成立,无"FAIL 后跳过"分支可写错 |
| 知识失败语义 | 会话两次未产出(requireArtifact 耗尽)→ 打印 ⚠ 警告(`knowledge_extraction_error` 记入运行日志),**退出码保持 0**;迁移成功不被文档生成失败反向污染(规格书 §16) |
| 知识文档提交 | **不自动提交**:提取挂点放在 `--commit once` 整体提交之后,所有 commit 档位下知识文档都保持为工作区文件,由人工甄别后入库(与"知识必须经过验证"的原则一致) |
| 默认路径 | `docs/migration-kb/migration-<时间戳>.md`,时间戳与 `.auto/logs/run-<时间戳>.log` 同款(`log.ts setLogFile` 格式);`--extract-knowledge=<path>` 显式覆盖(相对目标目录) |
| 数据模型前向兼容 | 解析器忽略未知键(如 `Status:`)与未知 TYPE,为规格书建议的 Deviation Record(§F)演进留位;V1 不实现其语义 |

## 4. 本期范围与未来扩展

### 4.1 本期实现

1. `src/fixme.ts`:AUTO-FIXME 解析器 + 目标目录扫描器 + 扫描报告落盘(纯逻辑,零依赖);
2. `--track-fixme`:执行类提示词注入标记规范 → audit 任务集成(生成前扫描注入、
   报告协议行、verify 结构检查扩展)→ CRITICAL 门禁与 finalize 前二次门禁;
3. `--extract-knowledge`:CLI 解析 + 终审完成后旁路提取会话 + 默认/显式路径 +
   失败不污染退出码;
4. 测试(§J)与 README / 包内 AGENTS.md 文档。

### 4.2 未来扩展(本期明确不做,含理由)

| 项 | 理由/前置 |
| --- | --- |
| `--fixme-fail-on=WARN` 自定义阻断策略 | 规格书 §17 已列为非目标;协议行已带各档计数,扩展只改门禁比较 |
| FIXME 生命周期状态机(Accepted/Fixed/Rejected 语义、独立库、Web UI、自动关闭/修复/合并) | 规格书 §17;V1 数据模型已留 `Status:` 等未知键的解析容忍(§F) |
| `--review` 逐任务审核会话的 FIXME 感知(维度注入) | 逐任务窗口发现偏差→应转化为补标记而非差距,语义需单独设计;V1 偏差收敛统一压在终审 |
| `--track-fixme` 脱离 `--final-review` 的独立形态(driver 扫描+打印+门禁,不经 LLM 验证) | 双路径成本;audit 会话的定级校验(误报剔除、升降级)是规格书核心价值,独立形态没有宿主 |
| `--extract-knowledge` 脱离 `--final-review`(以"全部任务 done + 逐任务 verify 通过"为门禁) | 规格书明确要求 Final Review PASS;放松门禁需先定义"无终审时的验证充分性" |
| 知识提取严格模式(失败改退出码)/ KB 自动提交 / 跨任务知识合并、推荐、Embedding、知识图谱 | 规格书 §17 全量列为非目标 |
| 增量扫描(运行起点 git 基线,覆盖嵌套仓库) | 需持久化基线状态文件,违背零新增状态;全量扫描在迁移项目尺度下代价可接受 |
| `fixme.json` 机器可读产物 | 规格书允许;内部 FixmeRecord 已结构化,tmp/fixme-scan.md 已含全部字段 |
| ModeSpec 增 knowledge 文案段 | V1 复用 `mode.exec` 作场景背景注入,注册表面不变 |
| AGENTS.md 增 FIXME 原则块 / check 子命令扫描违背描述 | 标记是会话侧职责(会话本来就写注释),提示词注入已覆盖每个执行会话;无需 init 下沉 |

## A. AUTO-FIXME 标记规范(提示词级契约)

### A.1 格式

```text
// AUTO-FIXME [<TYPE>]: <偏差简述>
// Spec: <参照文档、原始设计或原接口的具体位置>
// Rationale: <偏离原因>
// Severity: <CRITICAL | WARN | INFO>
```

- 锚点行 `AUTO-FIXME [<TYPE>]: <简述>`;TYPE 缺失或未知 → 记为 `UNKNOWN`
  (解析宽容,未来扩展不破坏旧代码——规格书 §3.2);
- 后续行以 `Spec:` / `Rationale:` / `Severity:` 键行附属于最近锚点;全角冒号容忍
  (与末行协议解析风格一致);**未知键(如 `Status:`)忽略**,前向兼容 Deviation
  Record 演进;
- 注释前缀宽容:剥离行首 `//`、`#`、`--`、`*`、`;`、`%`、`<!--` 后再匹配
  (覆盖 C 系/Shell/SQL/块注释续行);
- `Severity` 缺失或取值不在三档 → 记入 **malformed** 清单(保留可解析字段),
  不计入三档计数、不阻断;审计按 WARN 级发现提示修正;
- 非 "设计偏差" 不标(规格书 §4.2 全文注入提示词):普通 TODO、未到阶段的未实现、
  编译警告、风格差异、语义等价的自主选择、普通注释。

### A.2 Severity 与门禁语义(规格书 §3.3 的本仓库化)

| 扫描/报告结果 | audit 任务 | 流水线 |
| --- | --- | --- |
| 无记录(报告写全零行) | 照常按策略路由 | 继续 |
| 仅 INFO | 通过(报告含清单) | 继续 |
| 含 WARN | 通过(报告含清单) | 继续(策略为重构/修补时照常进 remediate 闭环,WARN 不阻断闭环) |
| 含 CRITICAL | block(audit 任务,退出码 2) | 阻断,人工复核 |
| malformed | 通过 | 继续(报告按 WARN 级发现提示修正) |

### A.3 与 AUTO-DECISION 的关系(提示词中显式说明)

- `AUTO-DECISION`(既有,migrate exec 文案与 QUESTION_RULE/AUTO_ANSWER):记录
  **决策过程**——为什么选 B 不选 A,即使不存在偏差也要记;
- `AUTO-FIXME`(本设计):**与既定设计/原实现存在已知偏差**的结构化锚点,可扫描、
  可计数、终审可验证;
- track-fixme 开启时,迁移取舍若构成偏差,两者都写:决策记录进文档/注释,偏差锚点
  按四行格式落在对应代码处。

## B. `src/fixme.ts` — 解析与扫描(纯逻辑)

镜像 verify.ts / check.ts 形态:不依赖 SDK 与 runner,可独立单测。

```ts
export type FixmeSeverity = "CRITICAL" | "WARN" | "INFO"
export type FixmeRecord = {
  type: string        // 未知 TYPE 保留原样;缺失记 "UNKNOWN"
  message: string     // 锚点行简述
  spec: string        // Spec: 行(可缺)
  rationale: string   // Rationale: 行(可缺)
  severity?: FixmeSeverity  // 缺失/非法 → 归入 malformed
  file: string        // 相对目标目录
  line: number        // 锚点行号(1 起)
}
export type MalformedFixme = { file: string; line: number; text: string; reason: string }

// 单文件文本 → 记录 + malformed(解析规则见 §A.1)
export function parseFixmes(text: string, file: string): { records: FixmeRecord[]; malformed: MalformedFixme[] }

// 目标目录扫描(范围规则见 §3“扫描范围”),读取失败的文件跳过并汇总为 note
export async function scanFixmes(dir: string): Promise<{ records: FixmeRecord[]; malformed: MalformedFixme[]; scanned: number; skipped: string[] }>

// 扫描结果整写 tmp/fixme-scan.md(覆盖写;审计会话与知识提取会话的直读输入)
export async function writeFixmeScan(dir: string, scan: Awaited<ReturnType<typeof scanFixmes>>): Promise<string>
```

- 扫描报告 `tmp/fixme-scan.md` 结构:头部计数行(Total/CRITICAL/WARN/INFO/
  MALFORMED)、逐条记录(`[SEVERITY] file:line` + Type/Spec/Rationale 原文)、
  malformed 清单、skipped 说明——字段覆盖规格书 §5.1 的七字段要求;
- 文件枚举:从 loop.ts 抽出嵌套 git root 发现逻辑为共享函数(`gitRoots`),
  `gitChangedFiles`(verbose 监视)与 `scanFixmes` 共用;每 root 用
  `git ls-files --cached --others --exclude-standard -- .` 列文件;目标目录不在
  任何 git 仓库时回落文件系统遍历(跳过 §3 所列目录、>1MB 文件)。

## C. `--track-fixme` 集成

### C.1 CLI(`src/index.ts`)

- 进 BOOLEAN_FLAGS(支持 `--track-fixme false` 关闭);
- 校验:`--track-fixme` 且 `--final-review` 未启用(值 ≤0)→ 报错退出码 1,
  文案说明需要终审 audit 作为审计宿主;用法文本同步。

### C.2 提示词注入(`src/prompt.ts`)

- prompt.ts 局部 `Opts` 增 `trackFixme?: boolean`(runner Opts 同步透传);
- 新增 `FIXME_RULE` 常量(§A 全部内容:格式、TYPE/Severity 表、必须标/不应标清单、
  与 AUTO-DECISION 的分工、修复差距消除偏差时应删除对应标记)注入三个执行类模板:
  `renderSubtask` / `renderWhole`(含 ondemand 续跑)/ `renderFix`;
- **不注入** renderDecompose(分解不写代码)、renderWrapup(收尾只写 docs 与提交)、
  审核类模板(V1 逐任务审核不感知,见 §4.2);
- remediate / finalize 终审任务经 runTask 流水线自然走上述模板,同样获得标记规范
  ——remediate 会话新引入的被迫偏差必须落标记,这正是 finalize 前二次门禁的输入。

### C.3 audit 任务集成(`src/final.ts` + `src/loop.ts`)

```
routeFinal(dir, plan, { limit, trackFixme })
  ├─ stage=audit 生成路由且 trackFixme:
  │    scanFixmes → writeFixmeScan(tmp/fixme-scan.md)
  │    prior += 「FIXME 审计输入: 扫描报告 tmp/fixme-scan.md,计数 …,malformed …」
  │    (扫描是纯本地进程,失败/为空不阻断——报告写全零行即可)
  ├─ renderFinalTask(audit 分支,trackFixme):
  │    职责段追加: 逐条核对扫描记录——验证定级恰当性(可升/降级并给理由)、
  │    剔除误报(不计入计数)、malformed 按 WARN 级发现提示修正;
  │    报告含「FIXME Audit Report」段(逐条 [SEVERITY] file:line / Type / Spec /
  │    Reason / Final Status: Accepted|Adjusted|FalsePositive);
  │    stageReport(audit) 协议改为末三行: 结论 / 策略 / FIXME: CRITICAL=… WARN=… INFO=…
  ├─ appendFinalTask(…, fixme): audit 的固定 verify 追加 FIXME 行 grep(§3)
  ├─ afterAudit(trackFixme): parseFixmeSummary(报告末行协议)
  │    缺失/非法 → brokenReport(结构检查应已拦截,自愈优先)
  │    CRITICAL≥1 → FinalRoute block: question 含计数、报告与扫描文件指针、
  │      人工处理方式(修复偏差;或降级注释后重跑)——不路由 remediate
  │    CRITICAL=0 → 照常按策略路由
  └─ finalGate(afterAudit 策略:无 与 afterValidate 通过 共用):
       trackFixme 时复扫;CRITICAL≥1 → round+1 超限 ? 熔断 block
         : stageRoute(audit, round+1, prior=新 CRITICAL 清单+复扫计数)
       否则 stageRoute(finalize, round, prior)
```

- 扫描时序:audit@r 的扫描在**生成会话前**(生成只读,生成到执行之间代码不变);
  audit 任务自身修复轮只改报告结构,不触碰代码(既有 renderFix 约束);
- `--review`/`--early` 与本机制无交互(audit 任务本就强制 review=0)。

### C.4 失败语义汇总

| 情形 | 行为 |
| --- | --- |
| 扫描器遇不可读/二进制文件 | 跳过,记入 skipped;绝不因扫描失败阻断流水线 |
| malformed FIXME | 见 §A.2,不阻断 |
| 报告缺 FIXME 行 | verify 结构检查判差距 → 既有 FIX_ROUNDS 自愈;人工删改报告 → brokenReport 阻塞人工核查(既有 C.4 机制) |
| CRITICAL(报告计数) | block,退出码 2 |
| CRITICAL(复扫,自报定级) | 回退 audit@r+1 重新验证(见 §3 二次门禁) |

### C.5 中断恢复

- 扫描是幂等纯函数、无状态,任何时刻重跑重扫;
- audit 生成前中断 → 下次 routeFinal 重扫重注入(扫描文件覆盖写);
- audit 任务内部中断 → 既有 recallProgress/peekProgress 机制,零新增;
- CRITICAL block 后人工降级注释 → 重跑:blocked 任务直接续跑(既有语义)。

## D. `--extract-knowledge`

### D.1 CLI(`src/index.ts`)

- 专用解析分支:裸选项 = 启用 + 默认路径;`--extract-knowledge=<path>` 或紧跟
  非 `-` 开头 token = 显式路径(相对目标目录 resolve);
- 校验:未搭配 `--final-review` → 退出码 1(理由见 §3);`--dryrun` 下不触发
  (dryrun 提前返回,天然满足)。

### D.2 触发挂点(`src/loop.ts` runAll)

位置:`next()` 为空、advanceFinal 判定终审完成、`--commit once` 整体提交**之后**、
`return 0` 之前。该位置保证:

- 熔断/block/任何退出码 2 路径都不经过挂点 → SKIPPED 天然成立(TC-08);
- 知识文档不进入任何自动提交(§3);
- 全部完成后的重跑:next() 仍为空、终审仍 complete → 只重跑知识提取(幂等覆盖,
  显式路径时覆盖同名文件),这本身就是"提取失败后修复再试"的恢复路径。

### D.3 提取会话(`src/knowledge.ts` 新增 + `renderKnowledge`)

- 复用 runner 导出的 `requireArtifact` 骨架(伪任务 id `PLAN`,镜像 final.ts
  planningTask;产物缺失带反馈重试一次,仍失败按 §D.5 收场);
- `renderKnowledge(plan, path, opts)` 组成:
  - **来源清单(结构化产物指针,规格书 §11 的子集)**:PLAN.md、`docs/*.report.md`、
    `docs/*.audit.md`(`--review` 产物)、`docs/final/*`(终审各报告与提案)、
    `tmp/fixme-scan.md`(track-fixme 联动时的过程证据,持久锚点为审计报告)、
    git log 概览提示;
  - **章节骨架**(规格书 §13 八章节:Migration Summary / API & Type Mappings /
    Implementation Patterns / Gotchas & Edge Cases / Reusable Rules / Design
    Deviations(仅 track-fixme 时填,引用 audit 报告与 Final Status)/
    Validation Evidence / References);
  - **质量约束硬性要求**(规格书 §14):去重;不照抄会话对话/日志/中间推理;
    被终审否决的方案不得记为当前方案(仅可作为明确标注"已否决"的通用教训);
    每条重要知识附可验证锚点(文件/API/Spec/commit/test/报告);
  - 场景背景:注入 `mode.exec` 文案(不新增 ModeSpec 字段);
  - 约束:只读分析,唯一可写文件是输出路径;QUESTION_RULE / STATE_RULE 照用;
    产出文件是硬性要求(信息稀少也要写出骨架并说明);
- collect 校验从宽:文件存在且非空(章节完整性是提示词级要求,过度结构校验会制造
  无意义重试);reset 删除旧产物。

### D.4 输出

- 成功:打印知识文档路径;默认 `docs/migration-kb/migration-<时间戳>.md`;
- `<task_id>` 的适配偏差(§2 表)在 README 说明:本包迁移单位是整份 PLAN。

### D.5 失败语义

- 会话受阻(blocked,如隐性阻塞/权限停机)或两次未产出 →
  `⚠ 迁移已全部成功,但知识沉淀未完成(knowledge_extraction_error),退出码不受影响;
  可修复后重新运行(opencode-auto run … --extract-knowledge…)单独重试`;
- 退出码保持 0;错误细节进 `.auto/logs/run-*.log`;
- 严格模式(失败改退出码)列为未来扩展(§4.2)。

## E. 组合行为矩阵

| 组合 | 行为 |
| --- | --- |
| 无两选项 | 现状不变 |
| `--track-fixme`(无 `--final-review`) | 用法错误,退出码 1 |
| `--extract-knowledge`(无 `--final-review`) | 用法错误,退出码 1 |
| `--track-fixme --final-review [n]` | 执行期标记 → audit 扫描/验证/协议行 → CRITICAL 门禁 → finalize 前复扫 → 完成 |
| `--extract-knowledge --final-review [n]` | 终审完成 → 提交处理 → 知识提取(失败不影响退出码) |
| 两选项 + `--final-review [n]` | 全链路;知识文档的 Design Deviations 引用审计报告与扫描证据(TC-10) |
| + `--review` / `--early` | 正交:逐任务审核照旧,V1 不感知 FIXME(§4.2) |
| + `--dryrun` | 两选项均不触发 |
| + `-m migrate` | exec 文案(AUTO-DECISION 要求)与 FIXME_RULE 并存,分工见 §A.3 |
| + `--commit once` | 整体提交保持在终审完成后、知识提取前(知识文档不入库) |
| + `--wait-between` / `--interactive` / `--subtask off` 等 | 无交互;off 模式下终审任务语义既有(verify 差距回退 pending) |

## F. 数据模型与演进路径(Deviation Record)

规格书附录建议把 FIXME 演进为带状态的 Design Deviation Record。V1 的留位:

1. `FixmeRecord` 字段与规格书 §20 完全对齐(type/message/spec/rationale/severity/
   file/line),`parseFixmes` 忽略未知键——未来注释格式追加 `Status: Accepted|
   Fixed|Rejected` 行时旧扫描器不破坏,新语义(状态流转、自动关闭)另行设计;
2. 审计报告的 Final Status 字段(Accepted/Adjusted/FalsePositive)已是最初一级的
   "审计后状态",留在报告正文而非 PLAN.md/数据库——状态不进 driver 持久化层;
3. 演进前置条件:独立状态存储 + `--fixme-fail-on` 策略 + 逐任务审核感知三者任何
   一个落地前,先扩展本文档而不是代码。

## G. 验收标准映射(规格书 §18/§19 → 本仓库语义)

| 用例 | 本仓库验收 |
| --- | --- |
| TC-01 无 FIXME | audit 报告写 `FIXME: CRITICAL=0 WARN=0 INFO=0`,策略照常路由,不阻断 |
| TC-02 仅 INFO | 同上,通过;报告含 INFO 清单 |
| TC-03 仅 WARN | 通过;策略为重构/修补时照常进闭环(WARN 不阻断闭环) |
| TC-04 含 CRITICAL | driver 解析报告计数 ≥1 → block 该 audit 任务(问题写入 PLAN.md,含报告与扫描文件指针),退出码 2 |
| TC-05 位置信息 | `tmp/fixme-scan.md` 与审计报告逐条含 file/line/type/severity/rationale/spec |
| TC-06 默认路径 | 终审完成后生成 `docs/migration-kb/migration-<时间戳>.md` |
| TC-07 显式路径 | `--extract-knowledge=<path>` 写入指定路径 |
| TC-08 终审未通过 | 熔断/block 路径在提取挂点之前返回 2,从不生成(无"FAIL 后跳过"分支) |
| TC-09 与最终实现一致 | 提示词硬性要求(最终状态优先)+ 门禁(仅终审通过后提取、来源限定最终产物)+ 不自动提交由人工甄别兜底——**driver 无法强制文档内容真实性,列为已知局限(§I)** |
| TC-10 FIXME 联动 | 知识文档 Design Deviations 章节硬性要求引用 `docs/final/audit-r<N>.md` 与 Final Status(tmp/fixme-scan.md 作过程证据指针) |

## H. 文件级改动清单与分期

| 文件 | 改动 | 分期 |
| --- | --- | --- |
| `src/fixme.ts`(新增) | FixmeRecord/parseFixmes/scanFixmes/writeFixmeScan;gitRoots 抽取协议 | P1 |
| `src/loop.ts` | 抽出 gitRoots 共享;runAll opts 增 trackFixme/knowledge;advanceFinal 透传;知识提取挂点 | P1/P2/P3 |
| `src/index.ts` | 两选项解析(track-fixme 布尔、extract-knowledge 专用分支含 `-` 守卫)、依赖校验、用法文本 | P2/P3 |
| `src/prompt.ts` | FIXME_RULE 常量;Opts.trackFixme;三执行模板注入;renderFinalTask audit 分支(trackFixme)与 stageReport 协议;renderKnowledge | P2/P3 |
| `src/runner.ts` | Opts.trackFixme 透传渲染 | P2 |
| `src/final.ts` | routeFinal 增 opts;audit 生成前扫描注入;parseFixmeSummary;afterAudit CRITICAL 门禁;finalGate 二次门禁;appendFinalTask 的 verify 扩展 | P2 |
| `src/knowledge.ts`(新增) | 提取编排(requireArtifact + renderKnowledge 调用) | P3 |
| `test/fixme.test.ts`(新增) | 解析器金样、扫描范围(gitignore 生效/嵌套仓库/非 git 回落)、报告格式 | P1 |
| `test/final.test.ts`(增) | parseFixmeSummary;CRITICAL 门禁不路由 remediate;finalGate 回退/熔断;verify 含 FIXME 行 | P2 |
| `test/prompt.test.ts`(增) | 注入有/无断言;renderFinalTask audit 职责段;renderKnowledge 骨架与来源指针 | P2/P3 |
| `test/e2e.test.ts`(增) | CLI 解析:依赖校验退出码 1、路径吞值与 `-` 守卫、`=path` 形式 | P2/P3 |
| `README.md` / 包内 `AGENTS.md` | 选项表、行为约定、结构节、与规格书的适配偏差说明 | P4 |

分期边界:P1(纯逻辑,零集成)→ P2(track-fixme 端到端)→ P3(extract-knowledge)
→ P4(文档)。各期独立可合入,合入即按本文档行为生效。

## I. 风险、边界与已知局限

- **知识内容真实性不可强制**:TC-09 依赖提示词约束与人工甄别(不自动提交),
  driver 只能保证门禁(终审通过后提取)与来源限定;
- **复扫门禁基于自报定级**:finalize 前复扫发现的 CRITICAL 未经 LLM 验证即回退
  audit——回退本身即"交审计验证",闭环自洽;极端场景(自报 CRITICAL 实为误报)
  代价是多一轮审计,可接受;
- **全量扫描的噪声**:历史遗留 AUTO-FIXME(此前运行残留)会进首轮审计;视为
  特性(未收口偏差本应被发现),人工清理后消失;
- **finalize 任务自身新引入偏差不再复扫**(收尾以文档同步为主),列为已知残余
  风险;需要时人工重跑 audit;
- **audit 任务修复轮理论上可改代码**(renderFix 只约束"修差距"):实际差距为
  报告结构问题,风险极低;
- **空 PLAN / 空扫描**:audit 照常(全零行),知识提取照常(骨架文档),不特判;
- **dogfood 顺序**:实现期间运行中的 driver 仍是旧版,新行为自下一次 run 生效。

## J. 测试与验证

- `bun typecheck` + `bun test`:fixme/final/prompt 测试不依赖 opencode server 与
  网络(解析为纯函数,报告/扫描用 fixture 文件;git 相关用例镜像 gitignore.test.ts
  的临时仓库手法);
- e2e(`OPENCODE_AUTO_E2E=1`,需凭据)为可选手工验证:`--final-review 1
  --track-fixme --extract-knowledge` 跑一次含 WARN 偏差的空转闭环,观察
  tmp/fixme-scan.md、审计报告末三行协议、T-F 任务路由与知识文档产出;
  CRITICAL 路径用 fixture 注释单独验证 block 行为;
- 全部完成后 `bun run build` 冒烟(templates/ 无新增,`type: "file"` 导入不受影响)。
