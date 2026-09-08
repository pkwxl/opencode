# 稳定引用与文件存放规范:设计基准与实施计划(stable-refs)

> 状态:**设计定稿(2026-09-06)**。实施分 P1..P4 四期,建议每期一个独立会话;
> P1 已实施(2026-09-07,见 §7);P1 的可执行规格、既定决策(P1-D1..D9)与会话切分
> (P1-S1..S4)见 [stable-refs-p1-plan.md](./stable-refs-p1-plan.md)。
> 开工会话先读本文件全文,再按需读 docs/phases-design.md(F/M 节)、docs/auto-number-design.md、
> docs/fork-decompose-design.md(§产物命名)。每期完成后勾选 §5 清单并回写 §7 实施进度;
> 实现与设计冲突时以实现为准回写本文对应小节并注明日期(镜像 verify-review-design.md 文首注记先例)。

## 0. 问题背景

三类失稳,均已被现状代码证实:

1. **文档间引用随阶段/轮次失效**:阶段交接把本阶段 docs/ 变更整体搬入
   `docs/phases/<letter>-<slug>/`(src/phases.ts 的 snapshotDocs/archivePhaseDocs,mtime 差异
   判定),continue 续轮再搬入 `docs/phases/round-<N>/`(archiveRound)。文档路径随阶段/轮次
   变化,A 报告引用 B 报告的路径、handover 必读清单引用产物路径,搬移后全部断链。
2. **文档对代码的引用随代码演进漂移**:报告/审计/设计文档中的源码路径,代码重构(改名/
   移动/删除)后无人检查,逐渐失真。
3. **两套路径认知并存**:任务文档是平铺后缀文件(`docs/<id>.context.md` / `.subtasks.md` /
   `.report.md` / `.audit.md` / `.fix.md` / `.handoff.md` / `.testhandoff.md`,子任务级
   `<id>-S<n>.testhandoff.md`),子任务产物却是目录单文件 `docs/<id>/S<NN>.md`;且 testhandoff
   遗留检测靠 `name.startsWith(task.id-S)` 字符串前缀(src/runner.ts)、taskNumberFloor 靠平铺
   正则(src/numbering.ts)。driver 构造、约 16 个提示词模板、文档内引用三方认知不统一。

## 1. 目标与非目标

**目标**(核心恒等式):

> 引用稳定性 = T-NNN 全局唯一编号 × 永久路径(文档落地不再移动)× 只有过期状态才归档

1. driver、提示词模板、文档内引用三方对文档位置的认知统一为一条规则(任务文档 →
   `docs/T-NNN/`,子任务文档 → `docs/T-NNN/S<kk>/`)。
2. `docs/` 下文档一经创建永不移动;阶段/轮次差异经文件名前缀(`R<N>-`)与台账推导表达。
3. 文档对代码/文档的引用在 driver 统一提交前经确定性检查,可机械修复的自动修复。

**非目标**:

- 不做文档语义级校验(内容正确性仍归判定/审核会话);只做路径存在性、行号上限的确定性校验。
- 不引入新的持久化状态:轮次、编号、提取守卫继续推导式(台账/目录推导)。
- 不改核心/外壳边界:本特性无外壳差异,壳分支经 merge auto-core 自动继承。

## 2. 已确认决策(用户拍板,2026-09-06)

| # | 决策 |
|---|---|
| D1 | 子任务产物 = `docs/T-003/S04/index.md`;testhandoff.md 等临时文件同级目录 |
| D2 | 阶段产物目录折叠:a/d/t/v 产物与终审产物一律任务锚定(如 `docs/T-F1/audit-r1.md`);`PHASE_PRODUCTS` 与 phases-design A.1 产物目录约定删除 |
| D3 | handover 永久化:`docs/handovers/R<N>-<字母>-<slug>.md`,落地不移动;`docs/phases/` 与 `round-<N>/` 只放过期状态文件 |
| D4 | 存量兼容 = 读回落(新路径缺失回落旧平铺路径)+ run 启动自动迁移(housekeeping 统一提交) |
| D5 | `autoNumber` 缺省翻转为 `true`(根本规则);`--no-auto-number` 保留为退出开关 |
| D6 | 一致性检查三层:工具自动修复(auto-correct)+ `check` 子命令扫描 + verify 门禁 |
| D7 | 过期 AGENTS.md 快照**每轮**归档(随轮末 PLAN.md 入 `round-<N>/`;轮内 AGENTS.md 基本静态,阶段级快照冗余) |

## 3. 规范本体(施加于目标目录,init 经 AGENTS.md 标记块下沉)

### 3.1 身份与存放

目标目录文档布局(新规全貌):

```
docs/
  T-003/                    # 任务 003 全部文档(永久,R2)
    context.md              # 理解摘要(understand 会话)
    subtasks.md             # 分解检查项(decompose 会话)
    report.md               # 收尾索引报告(wrapup)
    audit.md / fix.md       # 独立审核报告 / 修复检查项
    handoff.md              # ondemand 上下文交接(临时,driver 删)
    testhandoff.md          # 任务级测试交接(临时,driver 删)
    S04/                    # 子任务 04(永久)
      index.md              # 子任务产出正文(driver 机械命名)
      testhandoff.md        # 子任务级测试交接(临时,driver 删)
  T-F1/                     # 终审任务文档:audit-r<r>.md / refactor-r<r>.md /
                            #   patch-r<r>.md / validate-r<r>.md / finalize.md
                            #   (各终审任务锚定自己的 docs/T-F<k>/,跨轮随任务递增,
                            #    见 P1 实施设计 P1-D1)
  handovers/                # 阶段交接蒸馏(永久):R<N>-<字母>-<slug>.md
  migration-kb/             # 迁移知识(永久):R<N>-migration-<时间戳>.md
  prior-kb/                 # 先验知识(永久)
  agents/                   # AGENTS.md 维护规则块路由的跨阶段知识(不变)
  phases.md                 # 当轮台账(不变)
  phases/                   # 纯过期状态,不被任何文档引用
    a-analysis/PLAN.md      # 阶段 PLAN.md 快照
    round-1/                # phases.md + 轮末 PLAN.md + AGENTS.md + 各阶段归档目录
```

规则条款:

- **R1 编号根本规则**:T-NNN 全局唯一、只增不减(`autoNumber` 缺省 on,D5);文档身份锚定
  任务编号;T-F<k> 终审编号独立命名空间,不进自动编号记录(既有语义)。
- **R2 永久性**:`docs/` 下文档(`docs/T-*/`、`docs/handovers/`、`docs/migration-kb/`、
  `docs/prior-kb/`、`docs/agents/`)一经创建永不移动、永不改名。
- **R3 目录化**:任务文档只出现在 `docs/T-NNN/` 内;子任务文档只出现在 `docs/T-NNN/S<kk>/`
  内(两位零填充,S04)。
- **R4 角色文件名固定**:context / subtasks / report / audit / fix / handoff / testhandoff / index。
- **R5 归档语义**:`docs/phases/` 只收过期状态文件——每阶段 PLAN.md 快照、每轮
  (台账 + 轮末 PLAN.md + AGENTS.md);状态文件不被任何文档引用。
- **R6 临时文件**:handoff.md / testhandoff.md 生命周期 = 执行范围,完成即 driver 删除
  (既有语义,仅位置移入目录)。
- **R7 阶段差异表达**:轮次经文件名前缀 `R<N>-` 与台账推导表达,不靠搬移目录。

### 3.2 引用语法

- 唯一合法形态:**目标目录根相对路径**,反引号或 Markdown 链接;允许 `path:line` 行号锚。
- 文档间引用指向 `docs/T-NNN/...` 永久路径;禁止引用 `docs/phases/` 状态文件与
  handover 路径(handover 是 driver 注入通道,非引用目标)。
- 豁免:代码围栏(``` 配对)内的路径;行内含 `已删除` / `已归档` / `历史` 标记的引用
  (描述过去状态)。
- 校验语义:路径存在;行号 ≤ 文件总行数。

### 3.3 一致性检查三层(D6)

| 层 | 时机 | 行为 |
|---|---|---|
| auto-correct | 每次统一提交前(driver,确定性) | git rename 配对成功的旧路径 → 机械改写活文档引用;删除类无法自动修复 → finding |
| check 子命令 | 手动 / CI | 全量活文档 doc→doc / doc→code 扫描,命中退出码 1 |
| verify 门禁 | 任务边界(verifyTask 流程内,driver 确定性预扫) | 任务产物文档失效引用 = 差距 → 既有 fix 轮;耗尽隐性阻塞退出 2;verify 未启用时退化为日志提示(维持"verify 未启用即宽松"契约) |

活文档范围:`docs/**/*.md`,排除 `docs/phases/**`;豁免围栏与标记行。

## 4. 机制设计(文件级)

### 4.1 `src/docpaths.ts`(新增,P1)

全部任务文档路径的唯一构造点(代码侧的"三方认知一致"由本模块强制):

- `taskDir(id)` / `taskDoc(id, role)` / `subtaskDir(id, k)` / `subtaskDoc(id, k, role)` /
  `knowledgeDoc(round, ts)` / `priorKnowledgeDoc(round, ts)` / `finalDoc(id, name)`。
  **偏差注记(2026-09-07,P2 实施)**:`handoverDoc(round, phase)` 落在
  `src/phases.ts` 而非本模块——文件名依赖阶段 slug 表(PHASE_SLUGS 归 phases.ts
  所有),放此可避免 docpaths→phases 反向依赖;`knowledgeDoc`/`priorKnowledgeDoc`
  按设计落本模块。
- `resolveTaskDoc(dir, id, role)`:读时新路径缺失 → 回落旧平铺路径(D4 读回落,镜像
  config.ts legacyModeFallback 先例);迁移完成后自然消亡。
- 消费方改造:src/runner.ts(context/subtasks/handoff/testhandoff 路径构造与遗留清扫)、
  src/prompt.ts(handoffFile/testHandoffFile)、src/resume.ts、src/numbering.ts(floor 扫描)、
  src/knowledge.ts、src/final.ts(终审产物路径)。

### 4.2 存量自动迁移(P1)

- 挂点:run 启动(loop.ts,server 拉起前);幂等——无平铺文件即跳过、不产生空提交。
- 扫描与搬移映射:
  - `docs/T-003.context.md` → `docs/T-003/context.md`(subtasks/report/audit/fix/handoff/testhandoff 同法);
  - `docs/T-003-S2.testhandoff.md` → `docs/T-003/S02/testhandoff.md`;
  - `docs/T-003/S04.md` → `docs/T-003/S04/index.md`;
  - 旧终审产物 `docs/final-audit.md`、`docs/final/audit-r<r>.md` 等 → `docs/T-F1/`(文件名不变)。
- 搬移后对活文档执行引用改写(旧路径 → 新路径,全路径词边界匹配;复用 §4.5 的
  extract/rewrite 基础函数,**该两函数在 P1 先行落地**,validate 与接线在 P4)。
- housekeeping 统一提交:新 stage 标签 `doc-migrate`(src/git.ts 伪任务 label 清单、
  behavior.md/structure.md 同步)。

### 4.3 归档缩减(P2:src/phases.ts / src/loop.ts / src/knowledge.ts)

- **删除**:`snapshotDocs` / `archivePhaseDocs` / `PHASE_PRODUCTS` / `.auto/phase-snapshot.json`
  全链路(loop.planPhase 的快照调用、k 阶段"快照不刷新"特判、archiveRound 的 rm)。
- **交接**(handoverPhase):蒸馏会话产物 = `docs/handovers/R<N>-<字母>-<slug>.md`
  (currentRound × phaseArchive 推导文件名,driver 先建目录);PLAN.md 快照仍拷入
  `docs/phases/<letter>-<slug>/`;appendLedger 新行协议
  `→ docs/phases/<letter>-<slug>/(交接: docs/handovers/R<N>-...md)`;**parseLedger 兼容
  旧行**(交接指针指向 docs/phases/.../handover.md 的行不 throw,字母与归档目录两列读取不变)。
  **实施注记(2026-09-07)**:planPhase 的前序交接注入自 handovers/ 永久路径读取,
  P2 前完成的阶段自归档目录内 handover.md 读回落(中轮升级兼容)。
- **archiveRound**:+ 根 AGENTS.md 快照(D7,拷贝不移动、无可归档内容时不建目录);
  不再搬 migration-kb / prior-kb;`round-<N>/` = 各阶段归档目录 + phases.md +
  轮末 PLAN.md + AGENTS.md。
- **knowledge.ts**:knowledgeFile → `docs/migration-kb/R<N>-migration-<时间戳>.md`;
  existingKnowledge 改轮次推导守卫——**实施细化(2026-09-07)**:守卫 = 本轮
  `R<round>-` 前缀非空 .md(交接前中断与已完成两窗口都覆盖;台账 k 行 done 时
  提取挂点本就不触发,无需读台账),第 1 轮无 `R<N>-` 前缀存量按读回落视为本轮
  产物;archivePriorKnowledge 整体删除——轮次前缀守卫取代轮间搬移
  (priorKnowledgeFile 同样 `R<N>-prior-<时间戳>.md`;**migrate 壳合入 P2 时需删
  archivePriorKnowledge 调用点并适配 existingKnowledge(round) 签名**,见
  shell-contract 合入流程)。
- **prevRoundDigest**:① 归档索引不变;② 最终 handover 改从 `docs/handovers/R<N>-<字母>-<slug>.md`
  读(最后完成字母推导;**P2 前轮次自归档目录内 handover.md 读回落**);③ 知识收集 =
  `docs/migration-kb/` 的 `R<N>-` 前缀文件(无前缀存量宽松归入上一轮;**P2 前轮次
  归档内 migration-kb/ 读回落收集**,否则升级项目的既有知识自 digest 消失)。
- renderPhaseHandover / phase-handover.md / phase-plan.md / knowledge.md /
  prior-knowledge.md / number-recovery.md 模板文案同步(产物约定改 docs/T-NNN/ 与
  handovers/,A.1 产物目录表述删除)。**实施注记(2026-09-07)**:number-recovery.md
  核对后零改动(证据清单双布局表述仍准确);phase-handover 协议标记随 `{{archive}}`
  变量化改为 `{{handover}}`(template.ts PROTOCOL_MARKERS 同步)。

### 4.4 编号默认开启(P3:src/config.ts / src/index.ts)

- `CONFIG_DEFAULTS.autoNumber = true`;formatProjectConfig 摘要逻辑不变(仍条件显示)。
- init/run 文案、README、behavior.md 用法同步;auto-number-design.md 文首加修订注记
  (缺省值翻转,机制零改动)。
- e2e / config 测试快照更新。

### 4.5 引用一致性三层(P4:src/refcheck.ts(新)/ src/check.ts / src/runner.ts / src/loop.ts)

refcheck 核心(P1 先落 extract/rewrite 供迁移复用,P4 补齐):

- `extractRefs(text)`:反引号路径与 md 链接;过滤代码围栏与标记行
  (`已删除|已归档|历史`);产出 `{ path, line?, at }`。
- `validateRefs(dir, refs)`:存在性 + 行号 ≤ 总行数;产出 findings(file/line/text)。
- `renamePairs(root)`:`git diff --find-renames --diff-filter=R HEAD` → `{ old, new }`。
- `rewriteRefs(docs, pairs)`:机械替换,仅全路径词边界匹配;**只配对 rename,删除/语义
  变化不自动改**(防误修复历史叙述);**改写不动排版**(2026-09-08 需求追加)——只
  就地替换命中 token 本身,行结构/空白/表格对齐/末尾换行原样保留,无命中不写回。

接线:

- **提交前 auto-correct**:loop/runner 任务边界 commitTree 之前——renamePairs →
  rewriteRefs(活文档)→ 复扫 findings;findings 在 verify 启用时入 fix 轮(既有
  修复轮语义),未启用时记 ⚠ 日志。
- **check 子命令**:findings 并入返回结构与 CLI 报文,命中退出码 1;对目标目录缺
  引用规范块给 note。
- **verify 门禁**:verifyTask 判定会话前 driver 先对任务产物文档跑 validateRefs——
  确定性差距直接进 fix 轮,不消耗判定会话。
- **init 下沉**:ensurePointer 增第六标记块 `opencode-auto:refs:start/end`(§3 规范
  全文,幂等补写);wrapup.md(report 引用要求)、verify-script-gen.md、fix.md 增
  引用规范提示文案。

> **2026-09-07 实施注记(stable-refs P4,以实现为准)**:
> - validateRefs 签名收敛为 `(dir, refs) → Map<path, problem>`,findings 的位置回填
>   (file/line/text)由 scanRefs 组装(扫描入口);校验豁免在 §3.2 基础上细化——
>   URL/绝对路径/`~`/`./`/`../` 形态与纯版本号 token(如 `v1.2`,扩展名以字母开头
>   才算路径状)不校验,md 链接 `#fragment` 剥后验,目录引用只查存在性(行号锚忽略)。
> - renamePairs 先 `git add -A` 暂存再 `git diff --cached --find-renames HEAD`——未跟踪
>   的新路径(AI 常见纯 mv 改名)否则不参与配对;暂存本就是下一次统一提交的前奏,不
>   改变提交结果;路径自仓库根换算为目标目录相对。
> - auto-correct 挂点取 runner 的 afterSession(全部统一提交的公共入口,含
>   requireArtifact 旁路会话),loop 任务边界提交前必已有会话提交先行覆盖,不另挂
>   loop;findings 统一记 ⚠ 日志,"verify 启用时入 fix 轮"由 verify 门禁承担(下条)。
> - verify 门禁在每个判定会话前执行(含修复轮后的重新判定),差距文案由 formatRefGap
>   组装;off 模式与判定差距同语义(回退 pending),FIX_ROUNDS 耗尽阻塞退出 2。
> - check 的非 git note 仅在 docs/ 存在(引用机制有对象)时给出。
> - **后缀消解与失效清单(2026-09-07,需求追加)**:validateRefs 对直接未命中的
>   路径按段边界后缀在目标目录树内找唯一文件匹配——带上下文语境的相对引用
>   (以引用者所在目录为基书写,尤其非 docs 引用)唯一命中即视为有效并消解到
>   匹配文件做行号校验,多重匹配属语境歧义按缺失(FileIndex 惰性全量文件清单,
>   node_modules/.git 剪枝,scanRefs 全程共享一份);autoCorrectRefs 另维护失效
>   清单 `.auto/invalid-refs.md`(键 = `文件 → 路径(problem)`,不含行号与原文——
>   随编辑漂移不能作身份;每轮按当前 findings 全量重写,修复后自动移除、复发
>   视为新出现),已收录键不再 ⚠,仅对新出现的失效引用输出警告日志——清单即
>   人工核验订正入口,同时防无休止重复警告;check 子命令为显式调用,报告不
>   按清单去重。同日另落 `script/fix-refs.ts`(bun run fix-refs [dir]):
>   autoCorrectRefs 的一次性手动入口,供迁移驱动运行前把按新目录结构重组后的
>   遗留工作树引用预清理(rename 配对改写 + 清单落盘,退出码 1 = 仍有失效引用);
>   `script/fix-docs.ts`(bun run fix-docs [dir])一条龙 = migrateLegacyDocs 目录
>   树还原 + autoCorrectRefs 引用清理。迁移冲突裁决升级为时间最新优先:候选按
>   目标新路径分组,组内 mtime 降序(同 mtime 路径字典序)依次搬移,最新者占领
>   空闲目标位,冲突方不移动原地保留(P1-D3 绝不覆盖不破);目标位为空目录不
>   算冲突,腾位后落位。同日补 P2 遗留落点空洞(P2 只定任务锚定口径,未给阶段
>   级自由产物——勘测/设计批次/覆盖矩阵/核验记录——落点):新增永久目录
>   `docs/phase-docs/R<N>-<字母>-<slug>/<name>.md`(D3 handovers 同款范式:落地
>   不移动、不参与轮次归档;R7 轮次前缀;与 handoverDoc 同名对位——蒸馏 =
>   `<slug>.md` 文件,原始产物 = 同名目录;构造器 phases.ts phaseDocsDir),
>   doc-layout 存放规范同步。旧版工具轮次归档提升(docpaths.phasesArchivePair
>   单一映射源,迁移扫描与旧引用改写共用):任务文档(含 T-F<k>)/伴生 S 产物
>   (S<k>.<name>.md)/交接变体(T-NNN.handover.md 实为阶段交接)/final/ 与
>   migration-kb、prior-kb(补 R<N> 前缀)/阶段自由产物(剥离首层阶段子目录)/
>   散落项目文档(docs/ 顶层编号系列)各归永久位;PLAN.md/phases.md/AGENTS.md
>   过期状态留在归档(R5);提升候选与平铺候选同池参与 mtime 裁决,跨轮同编号
>   任务文档自动保最新版。
> - AGENTS.md 引用规范块为 §3 规范的精编全文(逐字全文会使六个标记块累计逼近维护
>   规则块的 150 行预算);规范细则以本设计文档为准。

> **2026-09-08 修订注记(refcheck-scope-design,对 §4.5/D6 的修订)**:
> - 整个 refcheck 经 `OPENCODE_AUTO_REF_CHECK=on/off` 开关管控,**缺省 off**——
>   off 时三层挂点(提交前 auto-correct、check 引用扫描、verify 门禁预扫)全部
>   空转,目标目录零引用检查行为;fix-refs 手动脚本不受约束(P1 已实施)。
> - 摒弃移动适配:migrateLegacyDocs 存量迁移(含 run 启动挂点与轮次归档提升)与
>   fix-docs 脚本一并退役;旧平铺布局原地保留,读回落永久保留,遗留引用失效改走
>   git 历史追踪恢复(refcheck-scope-design §4,P2 已实施)。
> - 检查范围收敛为三类(缺失恢复/提交前移动修正/范围再确认 `@sha` 版本标记,
>   P3 已实施——行号锚漂移课题的落地即此项,见 §8),详见 refcheck-scope-design.md
>   D4 与 §4-§6。

## 5. 实施分期与清单(每期一个独立会话)

### P1 路径统一(行为等价改名 + 存量迁移)

- [x] `src/docpaths.ts` 新增(构造器 + 读回落)
- [x] runner / prompt / numbering / final 消费 docpaths(resume / knowledge 按 P1-D5 零改动)
- [x] testhandoff 遗留检测改 scope 枚举(`docs/T-NNN/**/testhandoff.md`,替换 `startsWith(task.id-S)`;旧平铺前缀扫描兼容期保留)
- [x] taskNumberFloor 扫描改 `docs/**/T-*/*.md`(兼容期并存扫存量平铺 `docs/T-*.md`)
- [x] 模板路径文案 16 处(understand / decompose×6 / subtask / context-base / handoff-steer /
      test 三段 / wrapup / verify-judge / review / review-fix / final-task / phase-plan /
      number-recovery)+ `_partials.md` 新增共享「文档存放规范」段(doc-layout);核对
      PROTOCOL_MARKERS(understand 的 `context.md` 标记是子串匹配,路径前缀化后仍匹配,P1-D7 全部不变)
- [x] refcheck 基础函数落地(extractRefs / rewriteRefs,§4.5;validate/renamePairs 留 P4)
- [x] 存量自动迁移(§4.2)+ `doc-migrate` 提交标签(git.ts / behavior / structure)
- [x] 测试:prompt / runner / template / numbering 快照更新 + docpaths / migrate 新测试
- [x] 文档:behavior.md(路径契约与 doc-migrate)、structure.md(docpaths / refcheck 条目)、
      包 AGENTS.md 导航行
- 收口:`bun typecheck` + `bun test` 全绿(2026-09-07,340 pass);手工冒烟——新任务产物落
  `docs/T-NNN/`、平铺存量被迁移、活文档引用被改写(待 auto/ worktree 集成会话执行,见 §7)

### P2 归档缩减(docs 永不移动)

- [x] phases.ts 删快照/归档链路;handoverPhase 改产出 `docs/handovers/`;appendLedger
      新行协议(parseLedger 兼容旧行不 throw——LEDGER_ENTRY 只约束到归档目录列,新旧
      指针形态均命中)
- [x] archiveRound 增 AGENTS.md 快照、去 migration-kb / prior-kb 搬移
- [x] knowledge.ts 轮次守卫 + `R<N>-` 前缀;prevRoundDigest 改读永久路径
      (实施细化与 migrate 壳适配点见 §4.3 注记)
- [x] loop.ts planPhase 去 snapshotDocs、k 阶段快照特判删除
- [x] 模板与提示词(phase-handover / phase-plan / knowledge / prior-knowledge /
      number-recovery——后者核对后零改动,见 §4.3 注记)
- [x] 测试:phases / knowledge / prompt 快照(含 P2 前布局读回落用例;
      archivePriorKnowledge 测试随函数删除)
- [x] 文档:phases-design.md F/M 节修订注记(另及 A.1/C.1/D.4/E 节)、behavior.md、
      structure.md、壳包 `packages/auto` README(归档布局变化)+ src/index.ts continue 文案
- 收口:`bun typecheck` + `bun test` 全绿(2026-09-07,auto-core 340 pass + 壳包
  27 pass/2 skip);冒烟——完整 admtvk 一轮 + continue 续轮,验证轮前后
  `docs/` 顶层与 `docs/handovers/` 路径不变、`round-1/` 只含状态文件
  (待 auto/ worktree 集成会话执行,同 P1)

### P3 编号默认开启

- [x] config.ts 缺省翻转 + config / e2e 快照
- [x] index.ts / README / behavior 文案;auto-number-design.md 修订注记
- 收口:typecheck + test;init 冒烟确认缺省摘要「自动编号 on」

### P4 引用一致性三层

- [x] refcheck.ts 补 validateRefs / renamePairs;活文档枚举 activeDocs(排除 `docs/phases/`;
      docs/phases.md 台账属活文档)+ scanRefs(逐文档提取→校验→findings)+
      taskRefFindings/formatRefGap(门禁预扫范围与差距文案)+ gitAvailable/check 形态豁免
- [x] 提交前 auto-correct + findings 修复路径接线(挂点 runner afterSession,覆盖全部
      统一提交;verify 未启用退化日志)
- [x] check.ts 扩展(refs 并入返回结构与 CLI 报文 + 退出码 1 + 缺规范块 note + 非 git note)
- [x] verifyTask 确定性预扫(每个判定会话前;off 模式回退 pending,耗尽阻塞退出 2)
- [x] ensurePointer 规范块(opencode-auto:refs)+ wrapup / verify-script-gen / fix 模板文案
- [x] 测试:refcheck / check 新测试 + e2e(CLI check 引用命中退出 1 / 干净退出 0)
- [x] 文档:behavior.md(检查契约)、structure.md、verify-review-design.md 注记、包 AGENTS.md 导航
- 收口:typecheck + test 全绿(2026-09-07,auto-core 351 pass + 壳包 29 pass/2 skip);冒烟——
  改代码文件名 → 活文档自动改写;删文件 → findings;check 命中退出 1(单测级覆盖,
  真实运行冒烟待 auto/ worktree 集成会话一并执行)

## 6. 会话交接约定

- 每期开工:读本文件 + `git log --oneline -10` 确认前序已合入;P2 起加读
  phases-design.md F/M 节(修订版)。
- 每期收尾:勾选 §5 清单、回写 §7 实施进度(日期 / commit / 验证结果);conventional
  commit(`type(scope): summary`);**commit 前征得用户确认**(仓库约定)。
- 偏差回写:实现与设计冲突时以实现为准回写本文对应小节并注明日期。
- 集成冒烟(三包全量)在 `auto/` worktree 做,对齐根 AGENTS.md 约定。

## 7. 实施进度

| 期 | 状态 | 日期 | 提交 | 验证 |
|---|---|---|---|---|
| P1 | 代码完成,集成冒烟待做 | 2026-09-07 | feat(refs): P1-S1..S4(四会话提交,见 stable-refs-p1-plan.md §8) | 本包 `bun typecheck` + `bun test` 全绿(340 pass);auto/ worktree 三包集成冒烟待执行 |
| P2 | 代码完成,集成冒烟待做 | 2026-09-07 | feat(refs): stable-refs P2 归档缩减(单会话提交) | 本包 typecheck + test 全绿(340 pass);壳包 packages/auto typecheck + test 绿(27 pass/2 skip);三包集成冒烟待执行(P1 冒烟一并补) |
| P3 | 代码完成,集成冒烟待做 | 2026-09-07 | feat(refs): stable-refs P3 编号默认开启(单会话提交) | 本包 typecheck + test 全绿(340 pass);壳包 packages/auto typecheck + test 绿(27 pass/2 skip);init 冒烟确认缺省摘要「自动编号 on」与 phases="m" ℹ 提示;structure.md 同步缺省注记 |
| P4 | 代码完成,集成冒烟待做 | 2026-09-07 | feat(refs): stable-refs P4 引用一致性三层(单会话提交) | 本包 typecheck + test 全绿(351 pass);壳包 packages/auto typecheck + test 绿(29 pass/2 skip);三层各就位(auto-correct 挂全部统一提交、check 子命令命中退出 1、verify 门禁进修复轮);真实运行冒烟待 auto/ worktree 集成会话执行(P1..P3 一并补) |

## 8. 遗留风险与边界

- **行号锚漂移(2026-09-08 已由 refcheck-scope P3 落地应对)**:文件被编辑修改后,引用中的
  `:N`/`:N-M` 所指代的行号范围随内容偏移失真——现契约:改动文件的不一致行号锚在
  统一提交前自动追加 `@<sha>` 版本标记(保留原范围,语义 = 该范围仅对标记的历史版本
  有效,豁免行号上限校验;已标记引用不再更新,留待人工订正),见
  refcheck-scope-design.md §6。内容位移的自动追踪(如锚行内容指纹)仍不纳入。
  用户另确认:花括号
  展开(`{a,b}.rs`)、通配符(`*_test.rs`)与散文标识符(`.ctr` 等)非单路径引用,
  不纳入校验契约,失效清单仅作人工分拣入口且已收录键不重复警告(迁移冲突跳过
  同款,登记 `.auto/migrate-skips.md`)。
- **parseLedger 旧指针行兼容**:当轮台账严格解析须容忍旧格式行(不 throw);round 归档内
  台账的宽松解析已先行,不受影响。P2 实施核对:LEDGER_ENTRY 只约束到归档目录列,
  新旧两种交接指针形态天然命中,零改动即兼容(2026-09-07)。
- **auto-correct 边界**:只做 rename 配对改写;删除/语义变化产出 findings 走修复路径,
  不自动改写历史叙述。
- **存量 migration-kb 无 `R<N>-` 前缀**:prevRoundDigest 宽松收集归入上一轮;新产出一律
  带前缀。
- **k 阶段重提取规程**:existingKnowledge 改轮次守卫后(P2 实施口径见 §4.3),人工
  重提取 = 删台账 k 行 + 删 docs/migration-kb/ 内本轮 `R<N>-` 前缀文档后重跑
  (P2 前规程"删归档目录"随差异归档链路一并废弃;README 回退规程已同步更新)。
- **非 git 目标目录**:renamePairs 依赖 git,auto-correct 不可用(validate 仍可跑);
  check 对此报 note。
- **--no-auto-number 项目**:目录化与永久性规范仍生效(路径稳定性不依赖编号唯一性;
  编号唯一性只影响跨任务引用的可信度),模板文案不做特殊分支。
- **migrate 壳合入 P2 的适配点(2026-09-07)**:`archivePriorKnowledge` 已从核心删除
  (轮次前缀守卫取代轮间搬移),`existingKnowledge(dir, round)` /
  `priorKnowledgeFile(round)` / `existingPriorKnowledge(dir, round)` 签名变更——
  migrate 分支 merge auto-core 后需删 tool.ts 的 archivePriorKnowledge 调用并适配
  签名(壳分支适配,核心零回流)。
- **既有 archiveRound 中断重跑轮号漂移(P2 范围外,2026-09-07 观察注记)**:归档在
  "建目录后、台账移动前"中断时,重跑 continue 经 currentRound 推得 N+1,剩余条目
  会被劈进 round-(N+1)/(M 节"自然续完"的表述在此窗口不成立);该边界自 M 节实现
  起即存在,P2 未改变其行为,如需修复应在后续单独设计(如台账在场时复用无 phases.md
  的既有 round-N 目录)。

### P1 实施期既定裁决(2026-09-06,详见 stable-refs-p1-plan.md §3)

- **终审产物按产出任务锚定**:`k = final 字段任务数 + 1` 推导,同轮四阶段与跨轮各锚定
  自己的 `docs/T-F<k>/`(§3.1 的 T-F1/ 注释为文件名示意)。
- **--review 终审审计并入任务审计路径**:`docs/final-audit.md` → `docs/<taskId>/audit.md`;
  旧文件迁移为 `docs/T-F1/final-audit.md`(文件名不变,纯历史归档)。
- **knowledge.ts / resume.ts 在 P1 零改动**(R<N>- 前缀与 handovers/ 属 P2;resume 不
  构造任务文档路径)——§4.1 消费方清单据此收窄。
- **通用壳文案一并同步**(packages/auto 的 --handover-test 帮助文案与 README 路径表述)。
