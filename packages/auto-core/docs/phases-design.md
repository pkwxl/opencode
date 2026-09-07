# 阶段化流程(--phases)与迁移参数固化 — 设计说明

> 本文档是 `--phases` 阶段化流程(a 分析 → d 设计 → m 迁移实现 → t 测试 → v 验收 →
> k 知识提炼)与迁移参数(`--source-dir`/`--source-path`/`--dest-dir`)固化、init 去 AI 化
> (`-p` 落 brief.md)、续轮迁移(`continue` 子命令,M 节)的唯一设计基准:实现任务以本文为准。
> **实现按 J 节分期(P1..P4)完成;M 节(continue 续轮)已实现。**

## 背景与动机

1. **长流程的上下文污染**:迁移类项目天然分阶段(先摸清源系统,再设计,再实现,
   再测试验收)。单一 PLAN.md 从头到尾驱动,后期阶段的会话被迫拖着前期全部
   产物,AGENTS.md 与 docs/ 只增不减,上下文质量随流程推进持续劣化。需要
   driver 强制的阶段边界:每阶段完成后归档、重置、蒸馏,下一阶段在精简场景
   下继续。
2. **init -p 的结构性缺陷**:init 时一次性生成 PLAN.md 无法感知各阶段产物
   (分析结论、设计文档尚不存在),规划质量注定低下。阶段化流程要求"每阶段
   开始前才规划该阶段任务",规划会话必须从 init 挪到 run 的阶段边界。
3. **迁移参数的结构化**:源系统位置与源模块路径目前只能写在提示词自然语言里,
   不可校验、不可复用。它们是项目属性(改它需改契约表述),应与其他宪法级
   选项一样在 init 固化。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| phases 取值 | `admtvk` 的**子序列且必须含 m**(如 `m`、`amt`、`dmvk` 合法;`tma`、`adk`、重复字母、空串非法)。顺序是语义的一部分,自由排列只产生无意义组合;一行校验消除一整类误用 |
| 阶段注册表 | 固定六字母内置注册表(src/phases.ts)+ `phaseText()` 中文名,**不开放自定义**(阶段有 driver 侧语义:产物约定、v 的验收豁免、终审挂接点,非纯提示词文案;不搞 `.opencode/auto/phases/` 覆盖目录) |
| CLI 形态(迁移参数) | `init <工作目录> --source-dir <dir> --source-path <相对路径> [--dest-dir <相对路径>]`。位置参数是 driver 工作目录(流程文件 PLAN.md/docs/ 所在);**布局约定**: 迁移源在 `<工作目录>/<source-dir>`(source-path 为其下模块相对路径)、迁移目标在 `<工作目录>/<dest-dir>`——driver 工作目录与迁移目标经 dest-dir 隔离。**拒绝 `<src-dir>/<src-path>` 拼接形式**(目录边界歧义无法自解释,"最长现存前缀"猜测是隐式魔法);source 两参数只给其一时报错(必须成对),`--dest-dir` 独立固化/修订;三者均须为不含 `..` 的相对路径(会话 cwd 即工作目录,相对路径直接可用,配置随仓库共享可移植) |
| 阶段状态载体 | **推导式,零新增易腐状态**:`docs/phases.md` 台账(版本化、随仓库提交、人工可编辑)记录已完成阶段与产物指针;当前阶段 = phases 串中第一个未在台账出现的字母。与 final-review 的 routeFinal 同一范式 |
| 跨阶段回退 | **V1 线性,不做自动回退路由**。人工回退 = 编辑台账(删末行)+ 删除对应归档目录后重跑 run——回退能力是推导式设计的副产品,无需专门代码;t/v 阶段内差距走既有 appendSubtasks/fix 轮,v 残余差距仿终审熔断 block(退出码 2) |
| v 与 config.verify | **正交**。v 是流程阶段(其任务本身即检验,强制跳过任务级三段式验收与逐任务审核,复用终审任务的 final 豁免路径);config.verify 是任务级验收机制(m 等阶段任务照常)。`--phases` 含 v 而 verify=false 时 init/run 打 note 提示,不强制 |
| --final-review 挂接 | **仅 m 阶段**:终审闭环为代码改动设计,a/d 产物是文档,t/v 自身即检验。run 时对 m 阶段启用,其余阶段忽略并打 note |
| init 去 AI 化 | init **不再启动任何 AI 会话**(删除 manage/runOnce 路径);`-p` 文本写入 `.opencode/auto/brief.md`(版本化、人工可编辑、amend 语义——重复 init -p 覆盖重写),由每个阶段的规划会话消费 |
| brief 注入范围 | brief.md 注入**每个**阶段的规划会话(不止下一个)——它是项目级意图,a 阶段定下的基调 k 阶段同样需要 |
| 跨阶段记忆通道 | **handover.md 是唯一通道,且由 driver 控制注入**:阶段规划会话输入 = brief.md + 各前序 handover.md + AGENTS.md + source/destDir 规范 + mode.init;**不注入前序阶段原始 docs/**。"精简场景"靠 driver 从输入侧掐断,不靠交接会话自觉 |
| 交接重构形态 | **归档 + 重置 + 蒸馏**:driver 机械执行(docs 归档 docs/phases/\<letter\>-\<name\>/、PLAN.md 归档后重置模板、台账追加、统一提交);AI 只做一件事——旁路会话蒸馏产出 handover.md。AI 不改写契约文件,符合 driver 独占状态写入与维护规则块 |
| PLAN.md 审计轨迹 | 交接时本阶段 PLAN.md 归档为 `docs/phases/<letter>-<name>/PLAN.md`(含 attempts/verified/阻塞问答)再重置;翻旧账不依赖 git 操作,与 docs/final/ 产物约定同构 |
| k 阶段与 --extract-knowledge | k 阶段**整体认领** docs/fixme-knowledge-design.md 的 `--extract-knowledge` 设计(产出 docs/migration-kb/、提取失败不污染退出码),该选项不再单独存在;`--track-fixme` 不并入,保持独立演进 |
| init 修订 phases 的护栏 | 台账非空时改 `--phases`,校验台账已有字母构成新串的前缀,否则报错并指引人工修订台账——防止 amend 把流程状态打成不可推导 |
| phases 缺省值 | `"m"`(无阶段声明 = 单次运行,行为与现状完全一致;向后兼容的关键) |
| status 增强 | 配置摘要后打印阶段进度行(derive 自台账,零成本):`阶段: a✓ d✓ m▶ t v k` |

## A. 概念与配置

### A.1 阶段注册表(src/phases.ts)

```ts
export type Phase = "a" | "d" | "m" | "t" | "v" | "k"
export const PHASE_ORDER = "admtvk"  // 唯一合法顺序;校验与推导共用
export function phaseText(phase: Phase): string
// a=分析 d=设计 m=迁移实现 t=测试 v=验收 k=知识提炼
```

- 校验 `parsePhases(raw)`:非空、字母 ∈ admtvk、不重复、含 m、为 `admtvk` 的
  子序列;非法返回 null(CLI 转退出码 1,报文给出合法形式说明)。
- 各阶段职责与产物约定(规划提示词按此注入,见 E 节)。**2026-09-07 修订
  (stable-refs P2,D2 产物目录折叠)**:下表"主要产物"列的阶段专属产物目录约定
  (docs/analysis/ 等)已删除——a/d/t/v 阶段产物与终审产物一律任务锚定
  `docs/T-NNN/`(终审 `docs/T-F<k>/`);k 知识文档为 `docs/migration-kb/`
  永久路径(`R<N>-` 前缀);m 产物为源码改动与 `docs/T-NNN/` 任务报告:

| 阶段 | 职责 | 主要产物(P2 后口径) |
| --- | --- | --- |
| a 分析 | 摸清源系统与源模块的外部行为、依赖与边界 | docs/T-NNN/(任务锚定,行为基线、依赖清单) |
| d 设计 | 目标系统侧的模块设计(接口、数据结构、适配点) | docs/T-NNN/(任务锚定) |
| m 迁移实现 | 代码迁移与改造(必经阶段) | 源码 + docs/T-NNN/ 任务报告(终审 docs/T-F<k>/) |
| t 测试 | 测试体系迁移/补齐,对基线行为的回归覆盖 | 测试代码 + docs/T-NNN/(任务锚定) |
| v 验收 | 整体验收(对照基线与需求) | docs/T-NNN/(任务锚定,验收结论) |
| k 知识提炼 | 迁移知识沉淀 | docs/migration-kb/R<N>-…(永久路径,认领 --extract-knowledge 设计) |

### A.2 配置键(src/config.ts)

```jsonc
{
  "phases": "admtvk",                          // 缺省 "m"
  "source": { "dir": "...", "path": "..." },   // 可选;缺省 undefined(非迁移场景)
  "destDir": "..."                             // 可选;缺省 undefined(迁移产出直接落在工作目录)
}
```

- `phases`:validateProjectConfig 复用 parsePhases 同源校验;非法 → throw
  (中文报错含键名与期望),run/init 均退出码 1。
- `source`:缺省 undefined;存在时 dir 须为相对工作目录的不含 `..` 相对路径、
  path 须为相对 dir 的非空相对路径(不含 `..`);**init 时**校验 `<工作目录>/dir`
  为现存目录且 `dir/path` 存在(环境错误,退出码 1)——存在性校验经 stat 跟随
  软链接,**dir 可为指向工作目录外的软链**(源系统大树不必复制进工作目录,以
  链接接入即可;断链按不存在拒绝);run 时不再校验存在性
  (源系统可能已下线,台账与 docs/ 已归档所需)。
- `destDir`:缺省 undefined(迁移产出直接落在工作目录);存在时须为相对工作目录的
  不含 `..` 相对路径,driver 工作目录的流程文件与迁移产出经它隔离。不校验存在性
  (目标目录常由迁移过程创建)。
- run 拒绝清单扩展:`phases`、`source-dir`、`source-path`、`dest-dir` 出现即用法
  错误退出码 1,报文给 `init --phases <值>` / `init --source-dir <dir>
  --source-path <path>` / `init --dest-dir <相对路径>` 指引。

### A.3 brief.md(`.opencode/auto/brief.md`)

- `-p` 的载体:版本化、随仓库共享、人工可编辑;init -p 整写覆盖(amend 语义)。
- 无 -p 且 brief.md 已存在 → 保留;无 -p 且不存在 → 不创建(规划会话按无 brief
  渲染,模板含 `{{^brief}}` 条件段提示"未提供项目意图,请人工补充或按 source
  规范推进")。
- run 期间**不置只读**(它不是状态文件;protect.ts 不动它)。

## B. CLI 面(src/index.ts)

### B.1 init

```
opencode-auto init <工作目录> [--phases <admtvk 子序列含 m>]
                              [--source-dir <dir> --source-path <相对路径>]
                              [--dest-dir <相对路径>]
                              [-p|--prompt <prompt-text>] [既有宪法选项...]
```

- `--phases`/`--source-dir`/`--source-path`/`--dest-dir` 进 VALUE_FLAGS;仅 init 接受,
  走 mergeProjectConfig 的"仅显式键覆盖"(source 两键成对,任一给出即整体覆盖;
  dest-dir 独立固化/修订)。
- 台账非空时改 `--phases` 的前缀护栏(见已确认决策);`source` 修订无护栏
  (纯提示词输入,改它不破坏状态推导)。
- `-p`:删除 manage/runOnce 调用,改为写 brief.md;init 成为纯环境配置,
  结束语按 phases 分两态:`phases ≠ "m"` → "brief 已记录,运行 run 开始
  a(分析)阶段规划";`phases = "m"` → "brief 已记录,运行 run 开始任务规划"。
- PLAN.md 模板策略:`phases ≠ "m"` 时保持空模板(规划会话填充),不再提示
  "编辑 PLAN.md 填入任务";`phases = "m"` 维持现状。
- v 含而 verify=false 的 note 在此打印一次。

### B.2 run

- 拒绝清单加 `phases`/`source-dir`/`source-path`/`dest-dir`(报文给修订指引,同既有固化选项)。
- run 启动横幅:配置摘要后加 `阶段: <进度行>`(与 status 共用 formatPhases)。
- `--final-review` 与 phases 组合:仅 m 阶段挂接终审闭环;其他阶段完成时不进入
  routeFinal,打 note"终审闭环仅作用于 m(迁移实现)阶段"。
- `--dryrun` 不触发任何阶段动作(维持现状:仅权限预检)。

### B.3 status

- 配置摘要后打印阶段进度行:`阶段: a✓ d✓ m▶ t v k`(✓=台账已记录,▶=当前,
  其余=未开始);台账缺失/非法仅提示不阻塞(与配置非法同等待遇)。

## C. 阶段状态推导(docs/phases.md 台账)

### C.1 台账格式(版本化、人工可编辑)

```markdown
# 阶段台账(opencode-auto 维护;人工修订见设计文档 C.3)

- [done] a 分析 → docs/phases/a-analysis/(交接: docs/handovers/R1-a-analysis.md)
- [done] d 设计 → docs/phases/d-design/(交接: docs/phases/d-design/handover.md)
```

- 每行一个已完成阶段,顺序与完成顺序一致;driver 追加写在交接完成后、统一提交前。
- 解析:容忍空行与注释;行协议 `- [done] <letter> <名称> → <归档目录>(交接: <handover>)`,
  driver 只读字母一列,其余为人工可读信息;交接指针为可选列——第二行为 P2 前旧行
  形态(交接在归档目录内),同样容忍(stable-refs P2 起新产出恒为 handovers/ 路径)。

### C.2 推导规则

```
currentPhase = phases 串中第一个未出现在台账字母集合中的字母
全部出现 → 流程完成(run 退出 0,打"全部阶段已完成")
台账含 phases 外字母/重复字母 → 环境错误退出 1(指引人工修订台账)
```

中断恢复零新增状态:run 启动重新求值;阶段内中断走既有 recallProgress/
peekProgress;阶段边界中断(归档完成但台账未写)由交接动作的幂等性兜底
(归档目录存在即跳过移动,台账查重后追加)。

### C.3 人工回退规程(写入 README 与台账头部注释)

回退到某阶段 = ① 从台账删除该阶段及其后的全部行;② 删除对应
`docs/phases/<letter>-*/` 归档目录(或把其中 PLAN.md 拷回根目录续跑);③ 重跑 run。
推导式状态使回退无需任何 driver 代码支持。

## D. run 生命周期与路由(src/phases.ts)

### D.1 单次 run 的阶段循环

```
run 启动
 ├─ 装载 config(phases/source/brief 指针)
 ├─ phases == "m" 且无 --final-review 之外的阶段语义 → 走现状路径(零改动)
 ├─ 推导 currentPhase(C.2);全部完成 → 退出 0
 └─ 循环:
     ├─ PLAN.md 无未完成任务且无本阶段任务 → 阶段规划会话(E 节,旁路
     │   requireArtifact 骨架,产物=填充后的 PLAN.md)
     ├─ 主循环 runAll 照常(子任务/verify/review/统一提交/进度恢复零改动)
     ├─ currentPhase == "m" 且 finalReview > 0 → 既有 routeFinal 终审闭环
     ├─ 全部 done → 阶段交接(F 节)→ 台账追加 → 统一提交(Auto-Stage:
     │   phase-transition)
     └─ 推导下一阶段;无 → 退出 0
```

### D.2 routePhase 伪代码(纯路由函数,镜像 routeFinal 风格)

```ts
export type PhaseRoute =
  | { type: "complete" }                          // 全部阶段完成
  | { type: "plan"; phase: Phase }                // 开规划会话
  | { type: "execute"; phase: Phase }             // 主循环有任务可跑
  | { type: "handover"; phase: Phase }            // 任务全 done,进入交接
  | { type: "blocked"; reason: string }           // 台账非法等,退出码 1/2

export async function routePhase(dir, plan, config): Promise<PhaseRoute> {
  const ledger = await readLedger(dir)            // C.1;非法 → blocked
  const phase = PHASE_ORDER.filter(p => config.phases.includes(p))
    .find(p => !ledger.done.includes(p))
  if (!phase) return { type: "complete" }
  if (plan.tasks.some(t => t.status !== "done")) return { type: "execute", phase }
  if (plan.tasks.length) return { type: "handover", phase }  // 本阶段任务全 done
  return { type: "plan", phase }                  // PLAN.md 空(模板态/已重置)
}
```

幂等性:plan 路由在 PLAN.md 已有任务后不再触发;handover 路由在台账追加后
自然消失;全部路由由(台账, PLAN.md)两文件推导,无隐藏状态。**k 阶段例外
(P4/D.4)**:plan 路由不开规划会话,直接进入知识提取旁路会话后交接——
routePhase 本身不变,k 分支在 run 的阶段循环内。

### D.3 v 阶段任务的验收豁免

v 阶段任务本身即检验:runTask 依 `config.phases` 含 v 且 currentPhase == "v"
强制 review=0、跳过任务级三段式验收(收尾后直接 markDone)——与终审任务的
final 豁免共用同一代码路径(内部标记,不写 final 字段、不污染 PLAN.md 协议)。
残余差距:v 阶段任务全 done 即交接,不熔断;验收报告的差距结论由 k/人工消费
(V1 线性决策)。**修订备选**:若后续需要 v 差距熔断,仿 afterValidate 在
handover 路由前解析验收报告末行 `结论: 通过|差距`,本文预留该挂点。

### D.4 k 阶段:整体认领 --extract-knowledge(P4 已实现)

k(知识提炼)阶段整体认领 docs/fixme-knowledge-design.md 的 `--extract-knowledge`
设计(该文档文首"P4 并入阶段化流程"修订节给出两设计的逐条映射),`--track-fixme`
不并入、保持独立演进。k 阶段与通用阶段循环的关键差异:

- **不开规划会话、不向 PLAN.md 填任务**:plan 路由(PLAN.md 空模板态)直接进入
  知识提取旁路一次性会话(src/knowledge.ts,复用 requireArtifact 骨架,伪任务
  PLAN),产物 = `docs/migration-kb/R<N>-migration-<时间戳>.md`(P2 起永久路径,
  时间戳与 run 日志同款)。会话输入为阶段台账 docs/phases.md 与各阶段交接文档
  (docs/handovers/ 优先,原始产物按产物索引取用),章节骨架/质量约束/mode.exec
  注入见 templates/prompts/knowledge.md;
- **提取失败不污染退出码**:会话受阻或两次未产出 → ⚠ 警告(knowledge_extraction_error,
  细节进运行日志)后照常交接,退出码语义不变——迁移成功不被文档生成失败反向污染;
- **幂等与恢复**:本轮 `R<N>-` 前缀非空 .md 已存在(提取已产出、交接前中断)→
  跳过重提取(前几轮文档不算本轮已提取;第 1 轮无前缀存量按读回落视为本轮产物);
  交接中断走既有台账幂等补写;交接完成后重试提取 = 人工回退规程(删台账 k 行与
  docs/migration-kb/ 内本轮 `R<N>-` 前缀文档后重跑);
- **知识文档入库**:随会话统一提交(stage=knowledge),永久路径不随交接/轮次
  归档移动(P2;fixme 设计的"不自动提交"决策随独立选项一并废弃;P2 前曾作为
  阶段产物归档进 docs/phases/k-knowledge/);
- 人工在 k 阶段自行向 PLAN.md 填任务时走通用 execute/handover 路由,提取挂点
  不触发(人工接管语义);提取会话唯一可写文件是输出路径,其余约束(状态文件
  只读、不提交)与全部旁路会话一致。

## E. 阶段规划会话

- 形态:旁路一次性会话,复用 runner 的 requireArtifact 骨架(产物缺失带反馈
  重试一次,仍失败按隐性阻塞退出码 2);伪任务 PLAN 不进任务链、不写进度记录。
- 模板 `templates/prompts/phase-plan.md`(协议敏感,覆盖校验:PLAN.md 填充
  要求与任务格式协议必备);变量:

```ts
renderPhasePlan({
  phase, phaseName,             // 当前阶段字母与中文名
  brief,                        // brief.md 原文(可空)
  sourceDir, sourcePath,        // config.source(可空)
  destDir,                      // config.destDir(可空): 迁移目标目录注入,代码任务指向它
  handovers,                    // 各前序交接文档预拼接字符串(调用方组装;P2 起读 docs/handovers/,P2 前自归档目录读回落)
  modeName, modeInit,           // mode 正交注入(经 modeText 渲染)
  verify,                       // config.verify(verify 字段描述条件段)
  finalReview,                  // m 阶段且启用时提示任务排布预留终审空间
})
```

- 产物要求(写入模板协议):直接编辑填充 PLAN.md(driver 临时 allowWrite,
  结束后 checkPlanEdit 校验——任务格式合法、不改写标记块);每个任务自包含,
  产物约定遵循 A.1 表;首阶段(a)额外要求把对源系统的勘察计划排为首批任务。
- **注入纪律**(已确认决策):不注入前序原始 docs/;handovers 由 driver 读取
  拼接,缺 handover 的阶段在清单中标注"(无交接文档)"。

## F. 阶段交接(归档 + 重置 + 蒸馏)

> **2026-09-07 修订(stable-refs P2,docs 永不移动)**:交接蒸馏产物改为永久路径
> `docs/handovers/R<N>-<字母>-<slug>.md`(落定不移动);本节原"按 docs/ 快照把
> 本阶段新增/改动移入归档目录"的差异归档链路(snapshotDocs/archivePhaseDocs/
> `.auto/phase-snapshot.json`)已删除——阶段产物文档(docs/T-*/ 等)永久留在
> 原位;归档目录 `docs/phases/<letter>-<slug>/` 现只收阶段 PLAN.md 快照;轮次
> 差异经 `R<N>-` 前缀与台账推导表达。台账行协议增加交接指针(见 C.1)。

任务全 done 后,按序执行:

1. **蒸馏会话**(AI 唯一职责):旁路一次性,模板
   `templates/prompts/phase-handover.md`(协议敏感),通读本阶段 PLAN.md 与
   docs/ 产物,产出 `docs/handovers/R<N>-<字母>-<slug>.md`(driver 先建目录)。
   协议要求必备小节:关键决策、约束与坑、下一阶段必读清单、产物索引;
   requireArtifact 校验小节齐备。k 阶段无下一阶段,仍写 handover(供后续查阅)。
2. **driver 机械归档**:PLAN.md 拷贝为归档目录内 PLAN.md 后重置为模板(含
   verify 条件渲染);本阶段 docs/ 产物文档不动(永久路径);AGENTS.md 不改写,
   仅校验 ≤150 行,超限在交接提交信息与终端 note 中提示人工精简。
3. **台账追加** C.1 行;4. **统一提交**:标题 `阶段交接: <letter> <名称> →
   <下一字母> <名称>`,trailer `Auto-Stage: phase-transition`。

## G. 与既有机制的交互

| 机制 | 交互 |
| --- | --- |
| 任务级 verify | 各阶段任务照常(config.verify 门控);v 阶段任务豁免(D.3) |
| --review/--early-review | 各阶段任务照常;v 阶段豁免(D.3) |
| --final-review | 仅 m 阶段挂接(已确认决策) |
| subtask 三档 | 不感知阶段,全阶段一致 |
| 进度恢复 | 阶段内 = 既有 recallProgress/peekProgress;阶段边界 = 推导式幂等(C.2) |
| 统一提交 | 阶段内会话照旧;交接一次提交(F.4) |
| protect.ts | 不变(brief.md 不置只读;规划会话期间 PLAN.md 临时放行 + 校验) |
| --dryrun | 不触发阶段动作 |
| --interactive | 规划/蒸馏会话同样接收旁路输入(attach 由 runner 既有挂点覆盖) |
| mode | 与 phases 正交:init 导语进规划会话,exec 注记进执行会话,final 侧重进 m 阶段终审 |
| check | 不变(扫描 AGENTS.md/PLAN.md,与阶段无关) |
| k 与 fixme 设计 | k 认领 --extract-knowledge;--track-fixme 独立演进 |

## H. 退出码与异常

- 配置非法(phases/source):1(严格失败优于静默回落)。
- 台账非法(含 phases 外字母/重复/协议行无法解析):1,报文给人工修订指引。
- 规划会话/蒸馏会话隐性阻塞:2(既有 requireArtifact 语义)。
- 阶段内任务阻塞:2(既有语义,台账不受影响,重跑续当前阶段)。
- 全部阶段完成:0。

## J. 分期实现

- **P1(配置与 CLI 面)**:config 加 `phases`/`source` 键与校验;init 去 AI 化
  (-p 落 brief.md、删除 manage/runOnce 路径);run 拒绝清单扩展;`phases:"m"`
  兼容路径(run 行为不变);init 前缀护栏;测试:config/CLI 解析、brief 写入。
- **P2(阶段骨架)**:src/phases.ts(注册表/parsePhases/台账读写/routePhase);
  run 阶段循环接线;阶段规划会话(phase-plan.md);交接的机械部分(归档+重置+
  台账+提交);status 阶段行。蒸馏会话此期以模板占位(直接写最小 handover)。
- **P3(蒸馏与注入)**:phase-handover.md 蒸馏会话;handovers 注入规划会话;
  v 阶段豁免接线;--final-review 仅 m 挂接的 note。
- **P4(k 阶段,已实现)**:认领 docs/fixme-knowledge-design.md 的 --extract-knowledge
  (docs/migration-kb/ 产出、失败不污染退出码,行为规格见 D.4);该文档文首已并入
  修订标注。

## K. 文件级改动清单

| 文件 | 改动 |
| --- | --- |
| src/phases.ts | **新增**:Phase 注册表、parsePhases、phaseText、台账读写(readLedger/appendLedger)、routePhase、formatPhases(status/run 共用) |
| src/config.ts | ProjectConfig 加 `phases: string`、`source?: {dir, path}`、`destDir?: string`;CONFIG_DEFAULTS.phases="m";validate 各键;formatProjectConfig 追加 phases 摘要 |
| src/index.ts | VALUE_FLAGS 加四键;init 侧 parse 与 merge、前缀护栏、-p 落 brief.md(删 manage/runOnce)、v+verify=false note、结束语分两态;run 拒绝清单扩展、阶段进度行;status 阶段行;用法文本 |
| src/loop.ts | runAll 入口推导 currentPhase 与阶段循环(D.1);交接编排(F 节);终审闭环挂接按阶段门控 |
| src/runner.ts | v 阶段豁免内部标记(D.3,与 final 豁免共路径);规划/蒸馏会话的 PLAN.md 临时放行与 checkPlanEdit 复用 |
| src/prompt.ts | renderPhasePlan/renderPhaseHandover 组装;FinalStage 不受影响 |
| src/knowledge.ts | **新增**(P4/D.4): 知识提取编排——默认路径 knowledgeFile、幂等检查 existingKnowledge、extractKnowledge(requireArtifact + renderKnowledge 调用) |
| templates/prompts/knowledge.md | **新增**(P4/D.4): 知识提取会话模板;登记 src/template.ts embedded 注册表(collect 从宽,不进协议敏感清单) |
| templates/prompts/phase-plan.md、phase-handover.md | **新增**;登记 src/template.ts embedded 注册表与协议敏感校验清单 |
| src/protect.ts | 无改动(brief.md 不保护;确认清单) |
| src/loop.ts(P4 增量) | runPhaseLoop 的 plan 路由接 k 分支: 提取(失败仅 ⚠)→ handoverPhase("k") → 台账推导 complete |
| docs/fixme-knowledge-design.md | P4 修订标注已并入(文首"P4 并入阶段化流程"节):--extract-knowledge 并入 phases 设计 k 阶段 |
| README.md | 用法、--phases/source 选项、brief.md、人工回退规程(C.3) |
| test/ | config/CLI 解析、台账推导与 routePhase 幂等、模板协议防漂移(prompt.test.ts 扩展) |

## L. 不做的事(范围外)

- 跨阶段自动回退路由(t/v 差距自动退回 m 重新规划)——人工台账回退已覆盖。
- 自定义阶段与阶段覆盖目录——阶段有 driver 语义,非纯文案。
- 阶段内子阶段/嵌套 phases——YAGNI。
- init 当场生成 PLAN.md——被阶段规划会话取代,init 纯配置。
- v 阶段差距自动熔断——预留挂点(D.3 修订备选),V1 不实现。

## M. 续轮迁移(continue 子命令,已实现)

> **2026-09-07 修订(stable-refs P2)**:归档布局增根 AGENTS.md 每轮快照(拷贝),
> 不再搬移 `docs/migration-kb/`(知识文档改为永久路径 + `R<N>-` 前缀守卫,新一轮
> 重新提取);`.auto/phase-snapshot.json` 随快照链路删除,状态重置只剩台账消失 +
> PLAN.md 重建;结论注入 ②③ 改读永久路径——最终交接自 `docs/handovers/R<N>-….md`
> (P2 前轮次自归档目录读回落),知识自 `docs/migration-kb/` 的 `R<N>-` 前缀文件
> (无前缀存量与 P2 前归档内 migration-kb/ 宽松读回落收集)。

一轮阶段化迁移全部完成后,继续迁移(补齐遗漏、对齐源系统)以"新一轮"进行: 上一轮
整体归档、状态重置,上一轮结论注入新一轮首个规划会话——目标是**让迁移结果与源更加
完整、一致**,不重做已完成的工作。

| 决策点 | 结论 |
| --- | --- |
| CLI 形态 | 独立子命令 `continue [dir] [--phases <新值>] [-p <brief>] [其余可修订选项]`(不用 init 选项: 它是动作而非属性);`--continue` 不是选项,init/run 出现即报错指向子命令;`init --continue` 语义 = continue 子命令 |
| 与 init 的关系 | continue = init 的 amend 机制 + 归档上一轮: 复用同一分支(parse*/merge/模板循环/ensurePointer/ensureGitignore/-p),以 cont 门控差异;宪法选项仍单一入口语义(config.json 只经 init/continue 写) |
| 前置条件 | 既有 phases ≠ "m" 且台账覆盖既有 phases 全部字母(按**既有**配置判定,不看向新 --phases);非阶段化/台账为空/缺阶段/含外字母/新 --phases 为 "m" → 退出码 1 并给"先跑 run 完成本轮"或人工回退指引 |
| 归档布局 | `docs/phases/round-<N>/`(N = 被归档轮次): 全部阶段归档目录 + `phases.md`(台账)+ `PLAN.md`(轮末根快照,留痕轮后手工改动)+ `AGENTS.md`(根文件每轮拷贝快照,原文件保留);交接与知识文档为永久路径不参与归档(P2 起;P2 前版本曾把 `migration-kb/` 残留一并移入);docs/phases/ 本就是归档目录,嵌套轮次目录无需新增排除规则 |
| 状态重置 | 台账随归档消失 = 空台账、根 PLAN.md 由 init 模板循环以空模板重建(P2 起 docs/ 快照链路已删除,无快照需清除);run 侧零改动(routePhase 对空台账 + 空模板自然回到 plan 路由) |
| 轮次推导 | 当前轮 = docs/phases/ 下 `round-<N>` 最大编号 + 1,零新增持久化状态(人工删除归档即回到对应轮次);run/status 阶段进度行带 `第 N 轮` 标注(round > 1 时) |
| 参数锁定矩阵 | **跨轮固定**(迁移同一性,显式给出即退出码 1): -m/--mode、--source-dir、--source-path、--dest-dir——换源/换目标/换模式不是"同一迁移的继续",如需更换在新目录 init 新项目;**可按轮修订**: --phases(不受前缀护栏——台账已归档重置,任何合法值可改,如第 2 轮改跑 mtvk)、-p(brief 换新轮意图)、--agent/--context-limit/--subtask/--verify/--idle-time/--idle-max/--commit |
| 结论注入 | 新一轮台账为空时的**首个**阶段规划会话注入 `prevRoundDigest`(src/phases.ts): ① 各阶段归档目录索引;② 最终完成阶段交接文档全文(自 `docs/handovers/R<N>-<字母>-<slug>.md` 永久路径读取,P2 前轮次自归档目录读回落);③ 迁移知识文档全文(`docs/migration-kb/` 的 `R<N>-` 前缀文件;无前缀存量宽松归入上一轮,P2 前归档内 migration-kb/ 读回落收集;宽松解析,坏行不中断)。注入纪律与轮内一致——蒸馏产物是唯一通道,原始产物不注入、按索引可达(归档就在工作目录内);后续阶段照常走本轮 handover 蒸馏链,不重复注入。phase-plan.md 的 `{{#if prevRound}}` 条件块承载续轮目标文案(排查遗漏与差距、不重做) |
| 幂等与恢复 | 归档各步为 rename、**台账最后移动**(完成态标记)——归档中断重跑 continue 自然续完(已移走条目不在源位);重复 continue 在新一轮未完成时被前置条件拒绝(台账为空 → 尚缺全部字母) |
| 退出码 | 同 init: 0 成功(归档+配置修订完成),1 用法/环境错误;run 侧无感知(看到空台账 + 空模板即正常开规划会话) |
| 人工回退轮次 | 回退续轮 = 把 `round-<N>/` 内容移回(`phases.md` → `docs/phases.md`、阶段归档目录 → `docs/phases/`)后重跑 run,恢复上一轮完成态;删除 round 目录即回到该轮次编号 |

文件级改动: src/phases.ts(currentRound/archiveRound/prevRoundDigest + readLedger 行解析抽为 parseLedger/LEDGER_ENTRY)、src/index.ts(continue 子命令与 cont 门控校验、归档挂点、轮次标注、--continue 拒绝、用法文本)、src/loop.ts(planPhase 台账为空时注入 prevRoundDigest)、src/prompt.ts(renderPhasePlan 的 prevRound 变量)、templates/prompts/phase-plan.md(`{{#if prevRound}}` 条件块,不进协议敏感校验清单——新增块对既有覆盖向后兼容)、README.md 与 AGENTS.md(用法与行为约定)、test/(phases/e2e/prompt)。
