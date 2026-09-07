# stable-refs P1 实施设计:路径统一(行为等价改名 + 存量迁移)

> 状态:**实施设计定稿(2026-09-06),未实施**。上游设计: [stable-refs-design.md](./stable-refs-design.md)
> (§2 决策、§3 规范本体、§4.1/4.2/4.5 机制、§5 P1 清单);与上游冲突时以上游为准,实现侧
> 偏差以本文件 §3 既定决策为准并回写上游。
> 本文件 = P1 的可执行规格 + 会话切分 + **基点摘要**;按 §0 协议供多个独立实施会话执行。

## 0. 会话开工协议(每个实施会话必读)

- **开工三步**:① 读本文件 §1(基点摘要,即本计划的"分叉基点"——所有实施会话共享的
  现状认知,等价于 fork 流水线里注入各会话的 context.md 摘要)+ 本会话对应小节;②
  `git log --oneline -5` 确认前序会话已合入;③ 在 `packages/auto-core` 目录跑
  `bun typecheck && bun test` 确认基线全绿。
- **收口三步**:① `bun typecheck && bun test` 全绿;② 勾选 §8 进度表,偏差以实现为准
  回写本文件对应小节;③ conventional commit(`feat(refs): …`),**commit 前征得用户确认**
  (仓库约定)。
- 每个小节自包含(文件、函数、精确改动),不需要读本文件之外的探索记录;行号提示均为
  "约 L…"(会随前序会话漂移,以函数名/引文定位为准)。
- 全部改动在 `opencode/` worktree(auto-core 分支);核心改动只落此分支,通用壳
  `packages/auto` 随核心演进的文案同步允许在本分支做(见 P1-D8)。
- 集成冒烟(三包全量)在 `auto/` worktree 做,对齐根 AGENTS.md;P1 各会话只保证本包
  typecheck + test 绿。

## 1. 基点摘要(所有会话共享的现状认知)

### 1.1 问题与目标

三类失稳(详见上游 §0):文档路径随阶段/轮次搬移断链、文档对代码引用漂移、平铺/目录
两套路径认知并存。P1 只做**路径统一**——任务文档从平铺后缀文件(`docs/<id>.<role>.md`)
迁到任务目录(`docs/T-NNN/<role>.md`、`docs/T-NNN/S<kk>/…`),终审产物从 `docs/final/`
迁到任务锚定目录(`docs/T-F<k>/…`),driver/模板/读回落三方认知经 `src/docpaths.ts`
单一构造点统一;外加 run 启动时的存量自动迁移(`doc-migrate` 统一提交)。归档缩减
(docs 永不移动、handovers/ 永久化)与编号缺省翻转、引用检查三层分别是 P2/P3/P4,
**P1 不碰**。

### 1.2 现状代码地图(改造点索引)

| 文件 | 关键点(P1 相关) |
|---|---|
| `src/prompt.ts` | 路径构造三函数:`testHandoffFile`(约 L60,`docs/<id>[-S<n>].testhandoff.md`)、`subtaskOutputFile`(约 L171,`docs/<id>/S<NN>.md`)、`handoffFile`(约 L385,`docs/<id>.handoff.md`);`renderFinalTask` 内联提案路径 `docs/final/plan-…`(约 L252,为避免 prompt↔final 循环而内联,改由 docpaths 提供即可保持无环) |
| `src/runner.ts` | 任务文档路径消费点 14 处(§4.4 逐点列出);`testHandoffExists`/`cleanTestHandoffs` 的 `startsWith(task.id-S)` 前缀扫描(约 L1607-1626);`pipeline` 的 fixFile 构造(约 L449)、`planReviewFix`(约 L1414) |
| `src/final.ts` | `finalProposalFile`(约 L16)/`finalReportFile`(约 L22),全部 `docs/final/` 前缀;`appendFinalTask` 的 id 计数(约 L202);routeFinal 各 after* 路由读报告 |
| `src/numbering.ts` | `taskNumberFloor`(约 L41-69):扫 PLAN.md、`docs/phases/**/PLAN.md`、平铺 glob `docs/**/T-*.md` |
| `src/loop.ts` | `runAll` 挂点:usePromptLibrary 之后、try 块内"阶段化流程预检"之前(§4.7);`ensurePointer` 的标记块机制(P4 才加 refs 块,P1 不动) |
| `src/git.ts` | `message()` 注释的伪任务 stage 标签清单(约 L12-13,加 `doc-migrate`) |
| `src/knowledge.ts` / `src/resume.ts` / `src/phases.ts` | **P1 零改动**(P1-D5/P1-D9,见 §4.9) |
| `templates/prompts/*.md` | 16 处路径文案(§4.8 逐文件表);`_partials.md` 现有 head/question-rule/state-rule/decompose-rule 四节 |
| `src/template.ts` | `PROTOCOL_MARKERS`(约 L94-113):P1 全部不变(P1-D7);`registerTemplate`/覆盖机制不动 |
| 测试 | `test/prompt.test.ts`(1093 行,路径断言密集)、`test/runner.test.ts`(handoffSteer 文案约 L26、ensureForkBase 夹具写 `docs/T-001.context.md` 约 L180/194)、`test/numbering.test.ts`(floor 用例)、`test/final.test.ts`、`test/template.test.ts`(partials) |
| 壳包 `packages/auto` | `src/index.ts` 约 L791 `--handover-test` 帮助文案含旧命名;`README.md` 多处平铺路径表述(约 L242-479、L628、L697-706);`test/e2e.test.ts` **不**断言任务文档平铺路径(已核对,无需改) |

### 1.3 关键不变量(P1 不得破坏)

- 退出码语义、宪法级配置、driver 独占状态写入、统一提交、独立判定会话不 fork——全部
  不涉及;P1 是纯路径等价改名 + 迁移。
- **每会话收口必须全绿**:会话切分(§5)保证各会话结束时行为自洽(S2 内部一次完成
  全部任务文档改名,不允许"driver 写 A 路径、提示词要求 B 路径"的中间态跨会话存在)。
- 模板必须保持 `with { type: "file" }` 导入;新增 src 文件无需登记 exports;核心不得
  import 壳包。
- `prompt.ts` 的 `handoffFile`/`testHandoffFile`/`subtaskOutputFile` 导出名与签名不变
  (内部委托 docpaths),runner/模板调用面零改动。
- 中文注释与用户可见文案;`bun typecheck`(`tsgo --noEmit`)与 `bun test` 在本包目录运行。

### 1.4 验证命令

```bash
cd packages/auto-core && bun typecheck && bun test
# 改提示词模板后必跑:
bun test test/prompt.test.ts
# 路径残留核对(收口用,预期只余 docpaths/legacy 构造点、兼容清扫与注释):
rg -n "\.context\.md|\.subtasks\.md|\.report\.md|\.audit\.md|\.fix\.md|\.handoff\.md|testhandoff\.md|docs/final/" src templates
```

## 2. 路径映射总表(P1 单一事实源)

| 对象 | 旧(平铺) | 新(P1) | 构造点 |
|---|---|---|---|
| 理解摘要 | `docs/T-003.context.md` | `docs/T-003/context.md` | `taskDoc(id,"context")` |
| 分解检查项 | `docs/T-003.subtasks.md` | `docs/T-003/subtasks.md` | `taskDoc(id,"subtasks")` |
| 收尾报告 | `docs/T-003.report.md` | `docs/T-003/report.md` | `taskDoc(id,"report")` |
| 审核报告 | `docs/T-003.audit.md` | `docs/T-003/audit.md` | `taskDoc(id,"audit")` |
| 修复检查项 | `docs/T-003.fix.md` | `docs/T-003/fix.md` | `taskDoc(id,"fix")` |
| 上下文交接 | `docs/T-003.handoff.md` | `docs/T-003/handoff.md` | `taskDoc(id,"handoff")` |
| 测试交接(任务级) | `docs/T-003.testhandoff.md` | `docs/T-003/testhandoff.md` | `taskDoc(id,"testhandoff")` |
| 测试交接(子任务级) | `docs/T-003-S2.testhandoff.md` | `docs/T-003/S02/testhandoff.md` | `subtaskDoc(id,2,"testhandoff")` |
| 子任务产物 | `docs/T-003/S04.md` | `docs/T-003/S04/index.md` | `subtaskDoc(id,4,"index")` |
| 终审提案 | `docs/final/plan-audit-r1.md` | `docs/T-F1/plan-audit-r1.md` | `finalDoc(k,name)` |
| 终审各阶段报告 | `docs/final/audit-r1.md` 等 | `docs/T-F<k>/audit-r1.md` 等 | `finalDoc(k,name)` |
| --review 终审审计 | `docs/final-audit.md` | `docs/<当前任务>/audit.md`(P1-D2) | `taskDoc(taskId,"audit")` |
| handover / 知识 / 归档 | — | **P2**(`docs/handovers/`、`R<N>-` 前缀、归档缩减) | — |

- 子任务序号两位零填充(`S2 → S02`),三位自然进位(与现 `subtaskOutputFile` 的
  `padStart(2,"0")` 口径一致)。
- **读回落(D4)**:读点优先新路径,新缺失而旧存在 → 旧;都不在 → 新(读空与现状
  行为一致)。**写目标恒为新路径**(提示词要求 AI 写新路径、driver 清扫新旧两处)。
- 终审锚定 `k` 的推导见 P1-D1;`docs/T-F1/final-audit.md` 只是旧 `docs/final-audit.md`
  的迁移落点(文件名不变,纯历史归档,不再新产)。

## 3. 既定决策(实现歧义的裁决;S4 回写上游 §8)

| # | 决策 |
|---|---|
| P1-D1 | **终审产物按产出任务锚定**:`k = plan 内带 final 字段任务数 + 1`(`finalIndex`)。同轮四阶段与跨轮任务各锚定自己的目录:audit-r1@T-F1、refactor/patch-r1@T-F2、validate-r1@T-F3、finalize@T-F4、次轮 audit-r2@T-F5……routeFinal 在追加前求值,`(plan, stage, round) → k` 确定性成立(中断恢复重求值同值)。上游 §3.1 把五种文件名列在 `T-F1/` 注释下属文档示意,以本条为准。 |
| P1-D2 | **--review 的终审审计并入任务审计路径**:`docs/final-audit.md` → `docs/{{taskId}}/audit.md`(final 与非 final 同一路径,review.md 产出行条件段删除);旧文件迁移为 `docs/T-F1/final-audit.md`(文件名不变)。 |
| P1-D3 | **迁移冲突策略**:目标新路径已存在 → 保留新文件、跳过搬移、`⚠` log 列出;绝不覆盖。 |
| P1-D4 | **引用改写以"活文档中观察到的旧路径记号"推导配对**(静态映射规则,§4.7),不依赖本次搬移清单——崩溃恢复(搬移后、改写前中断)与多次运行天然幂等。 |
| P1-D5 | **knowledge.ts / resume.ts 在 P1 零改动**:knowledgeFile 的 `R<N>-` 前缀与 handovers/ 属 P2(上游 §4.3);resume.ts 不构造任务文档路径(上游 §4.1 消费方清单的偏差)。 |
| P1-D6 | **dryrun 跳过启动迁移**(预检不改动工作区);`--commit false` 仍迁移、仅不提交。 |
| P1-D7 | **PROTOCOL_MARKERS 全部不变**:understand 的 `context.md` 为子串匹配,前缀化后仍命中;各会话跑 prompt/template 测试核对即可。 |
| P1-D8 | **通用壳文案一并同步**(上游 P1 清单未列,一致性必需):`packages/auto/src/index.ts` 的 `--handover-test` 帮助文案、`packages/auto/README.md` 的平铺路径表述,在 S4 更新。 |
| P1-D9 | **phase-plan.md 在 P1 只注入 doc-layout 共享段**;A.1 产物目录(docs/analysis/ 等)表述删改留 P2。 |

## 4. 文件级规格

### 4.1 `src/docpaths.ts`(新增,S1)

任务文档路径的唯一构造点(代码侧"三方认知一致"由本模块强制);文件头注释引用上游
R1..R7 条款与读回落语义(镜像 `config.ts` 的 `legacyModeFallback` 先例)。P1 不含
`handoverDoc`/`knowledgeDoc`(P2)。

```ts
// 任务文档角色(R4:角色文件名固定)
export type TaskRole = "context" | "subtasks" | "report" | "audit" | "fix" | "handoff" | "testhandoff"

const pad2 = (k: number) => String(k).padStart(2, "0")

// —— 新布局构造器(返回相对目标目录路径)——
export function taskDir(id: string): string                                  // docs/T-003
export function taskDoc(id: string, role: TaskRole): string                  // docs/T-003/context.md
export function subtaskDir(id: string, k: number): string                    // docs/T-003/S04
export function subtaskDoc(id: string, k: number, role: "index" | "testhandoff"): string
export function finalDir(index: number): string                              // docs/T-F1
export function finalDoc(index: number, name: string): string                // docs/T-F1/audit-r1.md

// —— 旧平铺布局(读回落与迁移映射共用;迁移完成后自然消亡)——
export function legacyTaskDoc(id: string, role: TaskRole): string            // docs/T-003.context.md
export function legacySubtaskTestHandoff(id: string, k: number): string      // docs/T-003-S2.testhandoff.md
export function legacySubtaskArtifact(id: string, k: number): string         // docs/T-003/S04.md

// —— 读回落(D4):新路径存在→新;否则旧存在→旧;否则新(读空)——
export async function resolveTaskDoc(dir: string, id: string, role: TaskRole): Promise<string>
export async function resolveSubtaskDoc(dir: string, id: string, k: number, role: "index" | "testhandoff"): Promise<string>

// —— 存量迁移(S4,§4.7)——
export async function migrateLegacyDocs(dir: string): Promise<{ moved: string[]; rewritten: string[] }>
```

### 4.2 `src/refcheck.ts`(新增,S1;P1 只落基础两函数)

引用一致性层的 P1 子集;`validateRefs`/`renamePairs`/活文档枚举留 P4(文件头注明)。

```ts
export type Ref = { path: string; line?: number; at: number }   // at = 所在行号(1 起)

// 提取规则:
// 1. ``` 围栏内的行跳过(豁免);
// 2. 含 已删除|已归档|历史 的行跳过(标记行豁免);
// 3. 其余行提取反引号 span(`…`)与 md 链接([x](…))的 token;token 剥离可选
//    `:行号` 尾锚后,须无空白且"含 / 或含 ."(路径状)才算引用。
export function extractRefs(text: string): Ref[]

// 机械改写:对每个 pair 以全路径词边界正则替换并计数——
//   new RegExp(`(?<![-\\w./\\\\])${escapeRegexp(old)}(?![\\w./\\\\-])`, "g")
// (防 docs/T-1.md 误配 docs/T-11.md、防截断半路径)
export function rewriteRefs(text: string, pairs: Array<{ old: string; new: string }>): { text: string; count: number }
```

### 4.3 `src/prompt.ts`(S2 + S3)

- `handoffFile(task)` → `taskDoc(task.id, "handoff")`;`testHandoffFile(task, subtask?)` →
  `subtask === undefined ? taskDoc(id,"testhandoff") : subtaskDoc(id, subtask, "testhandoff")`;
  `subtaskOutputFile(task, index)` → `subtaskDoc(task.id, index, "index")`。三者导出名/
  签名/所在文件不变,内部 import docpaths(prompt→docpaths 无环)。
- `renderFinalTask`(S3):ctx 增 `finalTask`(值 `T-F${k}`,k = `plan.tasks.filter(t=>t.final).length+1`
  在函数内推导);`proposalFile` 改 `finalDoc(k, \`plan-${stage}-r${round}.md\`)`。
- 同步更新三函数与 `Opts.handoverTest` 相关注释里的旧命名表述。

### 4.4 `src/runner.ts` 消费点(S2,逐点)

| # | 位置 | 改动 |
|---|---|---|
| 1 | `runTask` handedOff 判定(约 L317) | 读改 `join(dir, await resolveTaskDoc(dir, task.id, "handoff"))` |
| 2 | `testHandoffExists`(约 L1607) | 重写:① 任务级 `taskDoc`/`legacyTaskDoc` 两处 exists;② 子任务级 scope 枚举 `new Bun.Glob(join("docs", task.id, "**", "testhandoff.md")).scan({cwd: dir})`(** 匹配零段,覆盖任务级同名文件);③ 兼容期旧平铺 `docs/<id>-S*.testhandoff.md` 前缀扫描保留(替换原 `startsWith` 实现为 glob/前缀并存,语义不变、范围收窄到本任务) |
| 3 | `pipeline` auto 分支陈旧清理(约 L402) | rm 新路径后追加 `rm(join(dirname, legacyTaskDoc(task.id,"handoff")), {force:true})` |
| 4 | `cleanTestHandoffs`(约 L1618) | rm 任务级新+旧;子任务级枚举 `docs/<id>/S*/testhandoff.md` + 兼容旧平铺 `docs/<id>-S*.testhandoff.md`(替换 startsWith 扫描) |
| 5 | `pipeline` ondemand 分支 handoff rm(约 L412) | 同 #3 |
| 6 | `pipeline` fixFile(约 L449) | 构造改 `taskDoc(task.id,"fix")` 语义的相对路径;读取经 `resolveTaskDoc` |
| 7 | `executeWhole`(约 L580) | `file` 写目标 = 新路径;三处读(prior/status 判定)经 resolve;报文引用 `handoffFile(task)` 值(自动新) |
| 8 | `ensureUnderstood`(约 L797) | `file = join(dirname, taskDoc(task.id,"context"))`;两处读经 resolve;阻塞报文引用新路径 |
| 9 | `ensureForkBase` digest 读(约 L924) | 经 `resolveTaskDoc(dir, task.id, "context")` |
| 10 | `ensureDecomposed`(约 L972) | `taskDoc(id,"subtasks")`;两处读经 resolve |
| 11 | `runSubtask`(约 L1042) | handoff 读两处经 resolve;完成后 rm 新+旧 handoff 与 `testHandoffFile(task,index)` 新+旧(`legacySubtaskTestHandoff`) |
| 12 | `runExecSession`(约 L1562) | `TestRun.handoffFile` = 新路径(会话写目标);continuation 播种读经 `resolveSubtaskDoc`(无 subtask 时 `resolveTaskDoc`) |
| 13 | `planReviewFix`(约 L1414) | `file = join(dirname, taskDoc(task.id,"fix"))`;reset/collect 同一路径(collect 读经 resolve) |
| 14 | 注释 | `Opts.handoverTest`、`TestRun`、交接循环注释里的 `docs/<id>[-S<n>].testhandoff.md` 表述 → 新命名 |

### 4.5 `src/final.ts`(S3)

- 新增 `export function finalIndex(plan: Plan): number`(`finals.length + 1`);
  `appendFinalTask` 的 id 计数复用它(两处口径绑定,防漂移)。
- `finalProposalFile(stage, round, index)` / `finalReportFile(stage, round, remediate?, index)`
  → 内部 `finalDoc(index, name)`。
- `routeFinal`/`stageRoute`/`afterAudit`/`afterRemediate`/`afterValidate`/`generateFinalTask`
  各调用点传 `finalIndex(plan)`;prior 文案引用 `finalReportFile` 返回值(自动新路径)。

### 4.6 `src/numbering.ts` taskNumberFloor(S2)

- 保留:当前 PLAN.md、`docs/phases/**/PLAN.md`、旧平铺 glob `docs/**/T-*.md`(兼容期,
  覆盖 `docs/T-005.subtasks.md` 与归档内 `docs/phases/m-migrate/T-020.handoff.md`)。
- 新增:glob `docs/**/T-*/*.md`(覆盖 `docs/T-003/context.md` 与归档内
  `docs/phases/m-migrate/T-003/report.md`),对相对路径取第一个匹配 `/^T-\d+$/` 的
  路径段 → `seen`;`T-F<k>` 段被 `taskNumber` 自然过滤。
- 注释(约 L37-40)同步双布局表述。

### 4.7 存量自动迁移与 run 挂点(S4)

`migrateLegacyDocs(dir)` 算法(幂等;docs/ 缺失 → 空结果):

```
① 平铺任务文档:docs/ 顶层文件名匹配
   /^T-(\d+)\.(context|subtasks|report|audit|fix|handoff|testhandoff)\.md$/ → taskDoc
   /^T-(\d+)-S(\d+)\.testhandoff\.md$/ → subtaskDoc(id, k, "testhandoff")
② 任务目录内旧子任务产物:docs/T-<id>/ 下 /^S(\d+)\.md$/ → subtaskDoc(id, k, "index")
③ 终审旧路径:docs/final-audit.md → finalDoc(1,"final-audit.md");
   docs/final/*.md → finalDoc(1, <原文件名>)(搬空后删空目录)
   每步:目标已存在 → ⚠ log 保留新文件跳过(P1-D3);否则 mkdir 父目录 + rename
④ 活文档引用改写(P1-D4):walk docs/**/*.md,排除 docs/phases/**
   对每个文件由文中旧路径记号按 §2 映射推导 pairs(七角色平铺 / -S<k>.testhandoff /
   S<kk>.md 旧产物名 / final-audit.md / final/<name>.md),rewriteRefs 替换,count>0 写回
返回 { moved, rewritten }(相对路径清单)
```

`src/loop.ts` `runAll` 挂点:try 块头部、"阶段化流程预检"注释段之前插入:

```ts
// 存量任务文档目录化迁移(stable-refs P1): 平铺旧布局 → docs/T-NNN/;幂等,
// dryrun 预检不改动工作区故跳过(P1-D6)。
if (!opts.dryrun) {
  const migrated = await migrateLegacyDocs(directory)
  if (migrated.moved.length || migrated.rewritten.length) {
    log(`↻ 存量任务文档目录化迁移: 搬移 ${migrated.moved.length} 项,活文档引用改写 ${migrated.rewritten.length} 个文件`)
    if (opts.commit !== false) {
      await commitTree(directory, { id: "PLAN", title: "任务文档目录化迁移" }, { stage: "doc-migrate", subject: "PLAN doc-migrate 任务文档目录化迁移" })
    }
  }
}
```

`src/git.ts`:`message()` 注释的伪任务 stage 标签清单加 `doc-migrate`。

### 4.8 模板与 `_partials.md`(逐文件;S2 列 / S3 列)

`_partials.md` 新增共享段(节名 `doc-layout`,**不含模板变量**——phase-plan 等无
taskId 的模板也要引用):

```
## doc-layout
文档存放规范: 每个任务(T-NNN)的全部文档写入该任务自己的目录 docs/T-NNN/ 内(理解摘要
context.md、分解检查项 subtasks.md、收尾报告 report.md、审核报告 audit.md、修复检查项
fix.md);子任务产物写入 docs/T-NNN/S<两位序号>/index.md,子任务级测试交接写同目录
testhandoff.md。这些路径一经创建即为永久路径——不移动、不改名;引用其他任务的文档时
一律使用其 docs/T-NNN/… 永久路径,不要在 docs/ 顶层另建平铺任务文件。
```

| 模板 | 字面改动 | doc-layout | 会话 |
|---|---|---|---|
| understand.md | `docs/{{taskId}}.context.md` → `docs/{{taskId}}/context.md` | ✓ | S2 |
| decompose.md + decompose-{a,d,m,t,v,k}.md(7 文件) | `docs/{{taskId}}.subtasks.md` → `docs/{{taskId}}/subtasks.md` | ✓ | S2 |
| subtask.md | warm/cold 两处 `docs/{{taskId}}.context.md` → 目录化 | ✓ | S2 |
| context-base.md | `docs/{{taskId}}.context.md 全文` → 目录化 | —(极简确认会话) | S2 |
| handoff-steer.md | 无字面路径(经 `{{handoffFile}}` 变量) | — | S2(核对) |
| test-result / test-handover / test-continue | 无字面路径(经变量) | — | S2(核对) |
| wrapup.md | `docs/{{taskId}}.report.md` → 目录化;`docs/{{taskId}}/S<NN>.md` → `docs/{{taskId}}/S<NN>/index.md` | ✓ | S2 |
| verify-judge.md | `docs/{{taskId}}.report.md` → 目录化 | — | S2 |
| review.md | `docs/{{taskId}}.report.md` → 目录化;产出行合并为 `docs/{{taskId}}/audit.md`(P1-D2,final 条件段删除) | ✓ | S2 |
| review-fix.md | audit.md ×2、fix.md ×2 → 目录化 | ✓ | S2 |
| phase-plan.md | 无字面任务路径;仅注入 `{{> doc-layout}}`(P1-D9) | ✓ | S2 |
| number-recovery.md | 证据清单改双布局:"docs/ 下的任务产物(T-NNN/<用途>.md 与 T-NNN/S<NN>/index.md,如 T-001/subtasks.md;旧平铺 T-NNN.<用途>.md 与归档目录内的同样有效)" | ✓ | S2 |
| final-task.md | 5 处 `docs/final/…` → `docs/{{finalTask}}/…`(audit-r/refactor-r/patch-r/validate-r/finalize) | ✓ | S3 |

`templates/PLAN.md`、`templates/.opencode/agent/auto.md`、`templates/modes/` 无任务文档
路径字面量(已核对),不动。

### 4.9 明确不改动清单(防会话误扩范围)

`src/knowledge.ts`、`src/resume.ts`、`src/phases.ts`(快照/归档链路 = P2)、`src/check.ts`
(P4 扩展)、`src/verify.ts`、`src/protect.ts`、`src/loop.ts` 的 `ensurePointer`(refs
标记块 = P4)、`docs/phases-design.md`(P2 修订)、壳包 e2e。S2 落地后 `rg` 核对(§1.4)
仅余 docpaths 的 legacy 构造、runner 的兼容清扫/读回落与注释。

## 5. 会话切分(每会话独立收口全绿)

### P1-S1 基础层:docpaths + refcheck(P1 子集)

- **前置**:无(首个会话)。
- **改动**:新增 `src/docpaths.ts`(§4.1,不含 migrateLegacyDocs)+ `src/refcheck.ts`
  (§4.2)+ `test/docpaths.test.ts` + `test/refcheck.test.ts`。零消费方,零行为变化。
- **测试**:构造器命名(含 pad2 与三位进位)、resolve 三态(新在/旧在/都不在)、
  finalDir/finalDoc;extractRefs(围栏豁免、标记行豁免、反引号/md 链接、`:行号`、
  非路径 token 忽略)、rewriteRefs(词边界命中/不误配前缀/计数)。
- **收口**:§0 收口三步;commit 建议 `feat(refs): docpaths/refcheck 基础层(P1-S1)`。

### P1-S2 任务文档目录化(核心行为等价改名)

- **前置**:S1 合入。
- **改动**:`src/prompt.ts`(三构造函数委托 + 注释)、`src/runner.ts`(§4.4 全部 14 点)、
  `src/numbering.ts`(floor 双扫描)、模板 S2 行全部(含 `_partials.md` doc-layout 段、
  phase-plan/number-recovery 注入与表述)。
- **测试更新**:`test/prompt.test.ts`(路径断言全量:subtasks/context/handoff/
  testhandoff(`-S2` → `/S02/`)/`S01.md` → `S01/index.md`/report/audit/fix/final-audit →
  任务 audit、not-contains 断言同步)、`test/runner.test.ts`(handoffSteer 文案、
  ensureForkBase 夹具新布局 + 新增 legacy 回落用例)、`test/numbering.test.ts`(floor
  新用例:目录化产物、归档内目录化产物、旧平铺兼容保留)、`test/template.test.ts`
  (doc-layout 节存在与引用渲染)。
- **收口**:§0 三步 + §1.4 残留 rg 核对;commit 建议
  `feat(refs): 任务文档目录化与读回落(P1-S2)`。

### P1-S3 终审产物任务锚定

- **前置**:S2 合入(与 S2 无文件冲突;review.md 已在 S2 改完)。
- **改动**:`src/final.ts`(§4.5)、`src/prompt.ts` renderFinalTask(finalTask ctx)、
  `templates/prompts/final-task.md`(§4.8 S3 行)。
- **测试更新**:`test/final.test.ts`(finalProposalFile/finalReportFile 新签名与路径、
  finalIndex、routeFinal 夹具报告写新路径)、`test/prompt.test.ts` 终审段
  (`docs/T-F1/plan-audit-r1.md` 等、finalTask 渲染、不残留 `docs/final/`)。
- **收口**:§0 三步 + `rg "docs/final/" src templates` 仅余迁移映射(S4 前允许
  docpaths 无此串);commit 建议 `feat(refs): 终审产物任务锚定(P1-S3)`。

### P1-S4 存量迁移 + 文档收口

- **前置**:S3 合入。
- **改动**:`src/docpaths.ts` 增 `migrateLegacyDocs`(§4.7)+ `src/loop.ts` 挂点 +
  `src/git.ts` 注释 + 文档回写(§7)+ `packages/auto/src/index.ts` 帮助文案 +
  `packages/auto/README.md` 路径表述(P1-D8)。
- **测试新增**(并入 `test/docpaths.test.ts` 或新 `test/migrate.test.ts`):平铺→目录化、
  `-S2` → `S02/testhandoff`、`S04.md` → `S04/index.md`、final 旧路径→T-F1、活文档引用
  改写(反引号/链接/词边界/围栏与标记行豁免)、幂等(二跑 no-op)、冲突保留新文件、
  崩溃恢复语义(仅残留旧引用记号也改写)。
- **收口**:§0 三步;勾选上游 §5 P1 清单、回写上游 §7 进度与 §8 偏差(P1-D1/D2/D5/D8);
  commit 建议 `feat(refs): 存量迁移与文档收口(P1-S4)`;端到端冒烟记入 §8 注记
  (auto/ worktree 集成会话执行)。

## 6. 测试计划汇总

新增:`test/docpaths.test.ts`(构造器/resolve/迁移)、`test/refcheck.test.ts`。
更新:`test/prompt.test.ts`、`test/runner.test.ts`、`test/numbering.test.ts`、
`test/final.test.ts`、`test/template.test.ts`。不更新:`test/phases.test.ts`、
`test/knowledge.test.ts`、`test/git.test.ts`(仅注释)、壳包 e2e。

## 7. 文档回写清单(S4)

- `docs/stable-refs-design.md`:§5 P1 各项勾选;§7 进度行(日期/提交/验证);§8 追加
  P1-D1/D2/D5/D8 偏差注记;§3.1 `T-F1/` 注释处补"各终审任务锚定自己的 docs/T-F<k>/"。
- `docs/behavior.md`:新增「任务文档路径契约(P1)」条(目录化布局、读回落、启动迁移
  doc-migrate、dryrun 跳过);统一提交 label 清单、--review、--test-by-driver、subtask
  三档、任务流水线、终审闭环各条的路径表述同步。
- `docs/structure.md`:`src/docpaths.ts`、`src/refcheck.ts` 新条目;prompt/runner/
  numbering/final/loop 条目路径表述同步;templates 条目核对。
- 包 `AGENTS.md`:稳定引用导航行补本文件指引。
- `packages/auto`:README + index.ts 帮助文案(P1-D8)。

## 8. 会话进度表

| 会话 | 范围 | 状态 | 日期 | 提交 | 验证 |
|---|---|---|---|---|---|
| P1-S1 | docpaths + refcheck 基础层 | 完成 | 2026-09-07 | 待提交 feat(refs): docpaths/refcheck 基础层(P1-S1) | typecheck + test 绿 |
| P1-S2 | 任务文档目录化(核心) | 完成 | 2026-09-07 | 待提交 feat(refs): 任务文档目录化与读回落(P1-S2) | typecheck + test 绿;§1.4 残留 rg 仅余 legacy/兼容/注释 |
| P1-S3 | 终审产物任务锚定 | 完成 | 2026-09-07 | 待提交 feat(refs): 终审产物任务锚定(P1-S3) | typecheck + test 绿;rg docs/final/ 仅余 phases.ts 注释(P2) |
| P1-S4 | 存量迁移 + 文档收口 | 完成 | 2026-09-07 | 待提交 feat(refs): 存量迁移与文档收口(P1-S4) | 本包 340 pass;壳包 typecheck + test 27 pass(P1-D8 文案已同步) |
| 集成冒烟 | auto/ worktree 三包全量 + 手工冒烟(新任务产物落 docs/T-NNN/、平铺存量被迁移、活文档引用被改写) | 未开始 | - | - | - |

实施注记(偏差以实现为准):

- rewriteRefs 同 extractRefs 一样只作用于候选行(围栏与标记行豁免)——S4 迁移
  测试的"围栏与标记行豁免"由此落在同一原语内,§4.2 的"机械改写"按此口径实现。
- numbering 的目录化扫描 glob 为 `docs/**/T-*/*.md`(任务目录直下文件取路径段);
  `docs/T-NNN/S<kk>/index.md` 更深层文件与旧布局同口径、本就不参与 floor(任务
  编号由同目录角色文件覆盖)。
- template.test.ts 曾因注册表面全局污染(dryrun 注册跨文件残留)在文件顺序变化后
  暴露,已在注册测试 finally 恢复内置文案(测试卫生修复,非行为改动)。

## 9. 风险与回退

- **中间态兼容**:S2 落地后、S4 之前,旧项目平铺文档全靠读回落工作——S2 必须保证全部
  读点走 resolve(§4.4 清单核对);写点全部新路径,行为自洽。S1..S4 对外作为一个 merge
  窗口发布时不出现该中间态。
- **e2e**:壳包 e2e 不断言任务文档路径(2026-09-06 核对);若运行发现断言,按新路径
  更新并在 §8 注记。
- **`.auto/phase-snapshot.json`**:迁移先于本阶段快照(同一 run 内 planPhase 后于挂点),
  中轮升级时归档按相对路径搬运,无需特殊处理。
- **`--no-auto-number` 项目**:目录化与编号唯一性无关(上游 §8),无分支。
- **回退**:每会话独立 commit,`git revert` 单会话提交即可;迁移为 rename + 文本改写,
  幂等、可手工逆操作。
