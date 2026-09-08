# 专用二次迁移工具改造设计(去子命令化)

本文是「把 opencode-auto 精简为专用二次迁移工具」的设计基准与实施计划。
改造后工具无子命令,直接执行主程序:轮首建立 → 前置知识提取 → 参数推断 →
完整 admtvk 二次迁移(--phases 可显式裁剪),自动推进至结束;中断后再次运行
从断点恢复。

## 0. 已确认决策(与用户对齐)

1. 二次运行传入与首次固化值不一致的关键参数 → 报错退出码 1,报文指引编辑
   .opencode/auto/config.json(沿用原 run 拒绝已固化选项的设计)。
2. check 与 status 子命令 → 彻底删除(含 src/check.ts、测试、模板与
   AGENTS 原则块中对它们的引用)。
3. 前置知识提取会话失败(受阻或两次未产出)→ 仅 ⚠ 警告后继续(与 k 阶段
   哲学一致;参数推断会话可自行直读原始 docs/)。
4. 二次迁移全部完成后再次运行 → 报告已完成并退出 0(经 .auto/ 完成标记
   识别;开启新一轮用 --next-path,§9)。
5. 轮次专用目录 docs/R-NN(2026-09-08,见仓库根 plans/ROUND_WORKDIR_PLAN.md):
   轮首即建、落盘即永久,取代"共用目录 + 文件名前缀 + 轮末搬移归档";流程
   裁剪改由 --phases 显式指定(§10),复杂度评估自动裁剪协议已删除。

## 1. 总体流程(每次启动依序求值,逐步幂等)

```
读/建配置(.opencode/auto/config.json)
  → 模板维护(PLAN.md 空模板 / opencode.json / agent 契约)
  → [--next-path: 轮间过渡(§9.2;前置不满足则退出 1)——含轮首建立与本轮标记]
  → .auto/tool.json.done === true → 报告完成,退出 0
  → 启动 server(全程一个实例,注入 runAll 复用)
  → [dryrun: 跳过以下前置步骤,直接走 runAll 的权限预检]
  → 轮已推进(本轮标记在且台账有完成阶段)→ 跳过前置步骤,从断点直接恢复
  → 轮首建立(核心 establishRound): 建 docs/R-NN/(轮内 PLAN.md 初值 = 根
    PLAN.md 现状或空模板)、根 PLAN.md 重指轮内符号链接、写 AGENTS.md.bak;
    生效流程(标记固化值 → config.phases)随本轮标记固化
    ※ 旧布局在途轮次(本轮无轮目录而根 docs/phases.md 台账已推进)不打断:
      本轮维持旧布局,下轮起进入轮次目录布局
  → 前置知识提取(新布局 = 轮内 docs/R-NN/prior-kb.md,恒空 → 必重新蒸馏)
  → 参数推断(config.source / destDir 缺失时;产物 .auto/infer.json,写回配置)
  → runAll(phases = 生效流程,缺省 "admtvk";--phases 显式裁剪,§10)
  → 退出码 0 → 标记 done
```

状态载体全部沿用既有推导式机制,新增仅一个文件:

- `.auto/tool.json`(非版本化): 本轮标记,兼完成标记。
  `{ "round": N, "phases": "..." }` = 第 N 轮进行中: 轮首建立时写入,生效流程
  随标记固化(--phases 是轮首一次性决策),中断重跑依断点续跑、复用固化值。
  `{ ..., "done": true }` = 二次迁移已完成,再跑报告完成退出 0。开启新一轮用
  --next-path(§9)。
- 前置知识产物(版本化,永久): 新布局 = 轮内固定名 docs/R-NN/prior-kb.md
  (轮目录轮首即建且恒空,必重新蒸馏,"旧轮文档误判本轮已提取"的缺陷结构性
  消除);旧布局存量 = docs/prior-kb/R<N>-prior-<时间戳>.md(读回落)。独立于
  k 阶段的 migration-kb(新布局轮内 migration-kb.md;旧布局 docs/migration-kb/
  R<N>-migration-<时间戳>.md)——各自幂等检查只认本轮产物;历轮文档原地保留、
  跨轮累积注入。

中断恢复无需新增机制:台账 + PLAN.md + .auto/progress.json 推导断点;
前置步骤各自幂等(轮首建立 establishRound 幂等、提取看本轮产物是否存在、
推断看配置键是否已固化)。

## 2. CLI 面(src/index.ts 重写)

- 无子命令: `opencode-auto [dir] [选项]`。首参数为旧子命令名
  (init/run/check/status/continue)→ 报错并指向新用法。
- 关键参数(首次运行固化进 config.json,与原 init 同一套 parse* 校验):
  -p/--prompt、-m/--mode、--agent、--context-limit、--subtask、--verify、
  --idle-time/--idle-max、--commit、--test-by-driver/--handover-test、
  --source-dir/--source-path、--dest-dir、--phases。handoverTest 须搭配
  testByDriver(交叉校验保留)。
- --phases <串>: 阶段流程手动裁剪(复用核心 parsePhases 校验: admtvk 子序列
  且含 m),缺省 admtvk。首跑固化、二次运行参与冲突校验;唯一例外是与
  --next-path 同给——此时不参与比对,作为新一轮流程覆盖随本轮标记
  (.auto/tool.json 的 phases 键)固化,续跑沿用(§10)。
- 二次运行:显式给出且与固化值不一致 → 退出码 1(逐键比对,报文含键名
  与生效值);一致视同未给出。-p 每次均可重写 brief.md。
- 运行级参数(每次生效,不固化,与原 run 一致): --server、--verbose、
  --interactive/-i、--wait-answer、--wait-between、--permission、
  --review、--early/--early-review、--final-review、--dryrun。
- 校验顺序不变式: 两类选项的 parse* 值域与互斥校验全部排在固化块之前,
  日志文件也延后到固化之后创建 —— 用法错误不得在新目录留下任何痕迹
  (尤其 `.opencode/auto/config.json`,否则坏值退出后二次运行被已固化值绑死)。
- --continue/--commit-subtask/--verify-idle/--verify-max 等历史选项的
  拦截报文删除(工具已不存在那些概念)。
- 未知选项拦截: 白名单(值选项∪布尔选项∪help 与历史拦截项)之外的
  `--xxx` 一律报错退出 1,防拼错被静默忽略(如 --next-path 误写为
  --next);近似名(前缀匹配)给出提示。先于取值校验,同受"不留痕"
  不变式约束。

## 3. 前置知识提取(新会话,模板 prior-knowledge.md)

- 时机:轮首建立之后(提取目标锁定为轮内 docs/R-NN/prior-kb.md)、参数推断
  之前(推断以其产物为输入之一)。历轮文档(轮次目录/旧平铺)原地保留,
  提取会话在既有迁移结果全量现场上复盘。
- 输入:brief.md、docs/ 全树(历轮 docs/R-*/ 与旧布局 docs/phases/ 各阶段
  归档、round-N 轮次归档——已有迁移结果不限于本工具此前的输出,也可能是
  人工或其他工具的产物)、git log 概览。
- 产物:轮内 docs/R-NN/prior-kb.md(旧布局存量项目本轮无轮目录时回落
  docs/prior-kb/R<N>-prior-<时间戳>.md),章节骨架复用 knowledge.md 的
  知识库骨架(迁移概要/API 映射/实现模式/坑点/可复用规则/设计偏差/验证
  证据/参考)。
- 幂等:新布局查轮内 prior-kb.md(恒空 → 必重新蒸馏);旧布局本轮 R<N>-
  前缀守卫,轮已推进(台账有完成阶段)的续跑回落接受无前缀存量(核心
  knowledge.ts existingPriorKnowledge)。
- 失败:仅 ⚠ 警告后继续(决策 3)。
- 消费:本轮首个阶段规划会话(台账为空时)经 loop.ts planPhase 注入——
  与 prevRoundDigest 合并为一个 prevRound 字符串传入 renderPhasePlan,
  模板零改动;同时作为参数推断会话的输入。
- 引用化(2026-09-07 增量):工作目录已有蒸馏产物(历轮 migration-kb、
  交接文档、历轮 prior-kb)时,提取会话(knowledge.ts
  existingDistilledDocs)收到路径清单,「引用化要求」条件段生效——已覆盖的
  知识点只写一行引用、不得复述(引用目标同场注入:prevRoundDigest 注入上一轮
  交接与 migration-kb 全文,priorKnowledgeDigest 注入历轮 prior 全文),蒸馏
  精力聚焦本轮迁移对象的差分增量(映射预判/坑点/规则),避免前序
  已是完整迁移轮时 473 行级的重复摘抄;清单为空(首轮、无既有知识)时条件段
  消失,行为同全量蒸馏。

## 4. 参数推断(新会话,模板 infer-source.md)

- 触发:config.source 或 config.destDir 任一缺失(用户首次运行时未给全)。
- 输入:brief.md、prior-kb 文档路径清单(会话直读)、已固化的已知键值、
  工作目录顶层布局。
- 产物协议:会话把结论整写 `.auto/infer.json`(非版本化,driver 工作区):
  - 成功: `{"sourceDir": "...", "sourcePath": "...", "destDir": "..."}`
  - 无法推断: `{"blocked": "<原因与需要人工提供的信息>"}`
- driver 校验(collect 内,无效 = 未产出,带反馈重试一次):合法 JSON;
  三键为非空、不含 .. 的相对路径;<工作目录>/<sourceDir> 为现存目录且
  <sourceDir>/<sourcePath> 存在(stat 跟随软链接,与原 init 校验一致);
  destDir 不校验存在性。
- 采纳:仅写入缺失键(已固化键不受会话影响),saveProjectConfig 落盘,
  打印推断结果;`{"blocked": ...}` → 阻塞退出码 2,报文指引人工用
  --source-dir/--source-path/--dest-dir 显式给出或直接编辑配置。
- 推断结果固化进 config.json 后,天然满足"二次执行关键参数与首次运行
  对齐"(配置即唯一事实源)。

## 5. loop.ts / runAll 改动

1. runAll Opts 新增 `managed?: ServerHandle`:提供时不再自行 manage/close
   (server 生命周期归 tool.ts);SIGINT 强制终止路径不变。
2. planPhase 的续轮注入扩展:台账为空时,prevRound = prior-kb 全文摘要
   (knowledge.ts 新增 priorKnowledgeDigest)+ prevRoundDigest 拼接。
3. 报文清理:agent 契约缺失/不一致的恢复提示不再引用 init 子命令;
   AGENTS 原则块文案删除"可用 opencode-auto check 检查"。
4. runAll 其余行为(阶段循环、交接、终审挂接、进度恢复)零改动。

## 6. 删除项

- src/check.ts、test/check.test.ts 删除;引用清理:templates/PLAN.md、
  loop.ts 原则块文案、README。
- index.ts 中 init/continue/run/check/status 五分支与 usage 全文重写。
- config.ts 的 legacyModeFallback 保留(run 横幅提示沿用旧位置 mode 的
  场景仍存在;保留无成本)。
- 现场清理机制整体删除(2026-09-08,轮次专用目录方案): 轮末搬移归档
  (archiveRound)、PLAN.md 重置、forgetProgress、needsSceneCleanup 判定——
  新轮目录轮首即建且恒空,无现场可清;旧布局文档原地保留为读回落源。

## 7. 文件级改动清单

| 文件 | 改动 |
| --- | --- |
| src/index.ts | 重写(无子命令,参数解析 + 固化/冲突校验 + 委托 tool.ts) |
| src/tool.ts | 新增(主编排;导出纯函数供测试) |
| src/loop.ts | server 注入、prior-kb 注入、报文清理 |
| src/knowledge.ts | 新增 priorKnowledgeDigest;prior 提取编排(可与 k 阶段共用骨架) |
| src/prompt.ts | renderPriorKnowledge / renderInferSource |
| src/template.ts | 注册两个新模板(嵌入 + 覆盖校验清单) |
| templates/prompts/prior-knowledge.md | 新增 |
| templates/prompts/infer-source.md | 新增 |
| templates/PLAN.md、loop.ts 原则块 | 删除 check 引用 |
| src/check.ts、test/check.test.ts | 删除 |
| test/tool.test.ts | 新增(infer 解析校验、标记读写、轮间过渡) |
| README.md、AGENTS.md | 重写用法与行为约定 |

## 8. 实施步骤

1. 模板与渲染层(§3/§4 模板 + template.ts 注册 + prompt.ts render)。
2. knowledge.ts 的 prior 提取与摘要。
3. tool.ts 主编排(含纯函数:infer 解析校验、标记读写)。
4. index.ts 重写。
5. loop.ts 改动。
6. 删除 check 及引用。
7. 测试:bun test + bun typecheck 全绿。
8. README.md 与 AGENTS.md 更新。

每步完成后跑相关测试;7 为总验收。

## 9. --next-path 轮间续迁(增量设计)

> 本节是「前一轮彻底完成后继续迁移新模块」的增量设计,叠加在 §1-§4 基础流程
> 之上;实施过程记录见仓库根 plans/MIGRATE_NEXT_PATH_PLAN.md。

### 9.1 参数语义与前置条件

- `--next-path <相对路径>` = 新模块在既有 `--source-dir` 下的相对路径,即只修订
  `config.source.path`;`source.dir` 与 `destDir` 不变,新模块在目标树下的落点
  由新一轮规划会话决定。它是轮间修订指令,不是配置键——不进首跑固化与二次
  运行的固化冲突比对。可搭配 `--phases` 显式给出新一轮流程(§10):此时
  --phases 豁免冲突比对,作为轮次流程覆盖随本轮标记固化。
- 严格前置:必须 `.auto/tool.json` 带 `done: true`(前一轮彻底完成),不做幂等
  宽容。不满足 → 退出码 1,报文区分两种形态:本轮进行中(`{round:N}`)→
  "不带 --next-path 重新运行即从断点续跑";首次运行/无标记 → "先完成一次完整
  迁移后再用 --next-path 开启下一轮"。
- 值域与互斥(CLI 层,全部先于任何写盘——用法错误不在目录留痕):非空、相对、
  不含 `..`;与 `--source-dir/--source-path/--dest-dir`(首跑固化参数)及
  `--dryrun`(过渡会改写工作目录,违反 dryrun 契约)互斥;首跑直接拒绝。
  非首跑另做两项防御:`config.source` 已固化(缺失指引编辑
  .opencode/auto/config.json)、`<工作目录>/<source-dir>/<next-path>` 存在
  (stat 跟随软链接,与首跑 --source 校验同款)。

### 9.2 过渡步骤(prepareNextRound,纯 fs、不起 server)

过渡块插在 §1 的 done 完成检查之前,依序执行:

1. readToolState → `!done` → 报错退出 1(报文见 9.1 两种形态)。
2. `config.source.path → nextPath`,saveProjectConfig 落盘。
3. 删 `.auto/infer.json`(陈旧推断产物)。
4. 轮首建立(核心 establishRound,轮号 = nextRound): 建 docs/R-(N+1)/(轮内
   PLAN.md 恒为空模板——新轮目录恒空,无现场可清)、根 PLAN.md 重建为指向
   轮内的相对符号链接、写 AGENTS.md.bak 快照。
5. 写本轮标记 `{ round: N+1[, phases] }`(覆盖旧 done 标记;phases 为同给的
   --phases 覆盖值,缺省不写、生效流程回落 config.phases)。

历轮文档不做轮间搬移(落盘即永久):新轮轮内 prior-kb.md 恒空,提取幂等
检查必然放行、重新蒸馏;历轮轮次目录与旧平铺 docs/prior-kb/ 等原地保留为
读回落源,跨轮累积注入。

成功后必须重读 state(内存旧值仍是 done,直接复用会误报"已完成"提前退出)并
同步内存 config.source。此后零新增编排,自然流程接管:轮首建立幂等补建 →
前置知识提取(轮内产物恒空 → 放行,重新蒸馏)→ 参数推断跳过(config 完整)
→ runAll(新 source.path 生效)。

轮号口径:R-NN 目录轮首即建,当前轮 = R 系目录最大号;新一轮 = nextRound
(R 系最大号 + 1,无 R 系目录时按旧布局 docs/phases/round-* 归档续号,
混合项目自然衔接);prevRoundDigest 取 R-(N-1)/ 恰为上一完成轮的交接与
migration-kb,注入语义不变。

### 9.3 知识整理链路(零新增注入机制)

历轮 prior-kb 与上一轮 migration-kb 原地保留(永久路径)→ 新一轮前置知识
提取会话细读 docs/ 全树(含历轮轮次目录)重新蒸馏出本轮 prior 文档(轮内
prior-kb.md)→ priorKnowledgeDigest 注入本轮首个规划会话;prevRoundDigest
(上轮最终交接 + migration-kb 全文)照常注入同一会话;轮次目录索引供各会话
按需自行取用("蒸馏产物唯一通道"纪律不变)。

### 9.4 中断恢复时序

过渡各步幂等(配置重写同值、rm force、establishRound 幂等、标记覆写),
任一步中断后:

- 标记未覆写(done 仍在)→ 重跑同一命令(带 --next-path)全流程重入,安全;
- 标记已覆写(新轮号、未 done)→ 带 --next-path 重跑被严格前置拒绝(!done),
  不带参数重跑即自然流程续跑——严格拒绝方案在该时序下自洽。

## 10. 流程裁剪(--phases 手动指定)

> 背景:对微小迁移对象(如 81 行的 dm-zero.c),阶段化流程的固定开销(236 行级
> 阶段计划)远超任务本身。2026-09-08 起改为手动指定(轮次专用目录方案决策 2):
> 删除「复杂度评估」机器可读协议(prior 文档协议行 + 核心 parsePriorVerdict +
> tool.ts phasesForVerdict/resumePhases 的 verdict 回落)——自动判裁曾把复杂
> 模块误裁为 mtvk(旧轮文档误判所致),裁错代价远高于省下的开销;是否裁剪由
> 用户按迁移对象复杂度显式决策。底线保障不随裁剪消失。

### 10.1 用法

- `--phases <串>`:复用核心 parsePhases 校验(admtvk 子序列且含 m)。缺省
  admtvk(完整流程);`--phases mtvk` = 跳过独立分析/设计阶段。
- 首跑作为关键参数固化进 config.phases;二次运行显式给出且与固化值不一致 →
  退出码 1(修订通道 = 编辑配置文件)。
- 轮间修订:`--next-path <路径> --phases mtvk` 同给时,--phases 豁免冲突比对,
  作为新一轮流程覆盖写入本轮标记(.auto/tool.json 的 phases 键),续跑沿用。

### 10.2 driver 侧生效(tool.ts)

- 生效流程来源 = 轮标记固化值(phases 键,须为合法流程串)→ config.phases
  (`effectivePhases`);台账已完成阶段必须落在流程内,固化值/配置值异常时
  钳制回完整流程(裁剪不得低于已完成进度,否则 routePhase 越界拦截)。
- 裁剪结果用于:阶段进度行展示与 runAll 的 phases 入参。
- dryrun 不做前置会话,维持缺省完整流程。

### 10.3 裁剪语义与底线承接

- 跳过的只是「独立的 a/d 阶段」,不是底线:before 基线、守卫/翻转/排除/随批
  更新(AU)四清单、AUTO-TODO 对账、计数账目等零漂移保障改由 m 阶段首批任务
  承接——核心 phase-plan.md 的 m 阶段「简化流程判定」条件块(driver 注入
  trimmedPhases 标志,生效 phases 不含 a/d 时渲染)向规划会话明示:本轮流程
  经 --phases 裁剪、无独立分析/设计阶段,勘察与设计要点并入首批任务,底线
  保障不省。
- 台账/归档零特殊:routePhase、阶段交接均按实际 phases 串推导,mtvk 轮的
  台账自然不含 a/d 行。
