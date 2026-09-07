# 专用二次迁移工具改造设计(去子命令化)

本文是「把 opencode-auto 精简为专用二次迁移工具」的设计基准与实施计划。
改造后工具无子命令,直接执行主程序:前置知识提取 → 参数推断 → 完整
admtvk 二次迁移,自动推进至结束;中断后再次运行从断点恢复。

## 0. 已确认决策(与用户对齐)

1. 二次运行传入与首次固化值不一致的关键参数 → 报错退出码 1,报文指引编辑
   .opencode/auto/config.json(沿用原 run 拒绝已固化选项的设计)。
2. check 与 status 子命令 → 彻底删除(含 src/check.ts、测试、模板与
   AGENTS 原则块中对它们的引用)。
3. 前置知识提取会话失败(受阻或两次未产出)→ 仅 ⚠ 警告后继续(与 k 阶段
   哲学一致;参数推断会话可自行直读原始 docs/)。
4. 二次迁移全部完成后再次运行 → 报告已完成并退出 0(经 .auto/ 完成标记
   识别;删除该标记可显式开启新一轮)。

## 1. 总体流程(每次启动依序求值,逐步幂等)

```
读/建配置(.opencode/auto/config.json)
  → 模板维护(PLAN.md 空模板 / opencode.json / agent 契约)
  → [--next-path: 轮间过渡(§9.2;前置不满足则退出 1)]
  → .auto/tool.json.done === true → 报告完成,退出 0
  → 启动 server(全程一个实例,注入 runAll 复用)
  → [dryrun: 跳过以下前置步骤,直接走 runAll 的权限预检]
  → 前置知识提取(docs/prior-kb/R<N>-prior-<时间戳>.md,本轮前缀已有非空产物则跳过)
  → 现场清理(本轮标记未建立时;原 continue 流程): 台账有完成阶段/无法解析,
    或 PLAN.md 有任务,或 migration-kb 有本轮前缀残留 → archiveRound 归档 + PLAN.md 重置
  → 建立本轮标记 .auto/tool.json { "round": N }
  → 参数推断(config.source / destDir 缺失时;产物 .auto/infer.json,写回配置)
  → runAll(phases 固定 "admtvk")
  → 退出码 0 → 标记 done
```

状态载体全部沿用既有推导式机制,新增仅两个文件:

- `.auto/tool.json`(非版本化): 本轮标记,兼完成标记。缺失 = 本轮未建立,
  目录里的阶段状态(台账/PLAN.md/migration-kb)一律视为"别人的"遗留——
  本工具此前轮次(删除标记开新一轮)或人工/其他工具的迁移结果;知识提取
  落盘后按原 continue 流程归档(archiveRound)并重置 PLAN.md,本轮从头规划。
  `{ "round": N }` = 第 N 轮进行中: 建立后创建的文件视为"自己的",中断重跑
  依断点续跑,绝不清理自己的现场。`{ "round": N, "done": true }` = 二次迁移
  已完成,再跑报告完成退出 0。删除该文件可显式开启新一轮。
- `docs/prior-kb/R<N>-prior-<时间戳>.md`(版本化,永久): 前置知识提取产物,
  不随交接/轮次归档移动(stable-refs R2),轮次经 R<N>- 前缀表达。独立于
  k 阶段的 docs/migration-kb/(各自幂等检查只读本轮前缀,互不污染;k 阶段
  在本轮收尾照常产出本轮新知识;历轮文档原地保留、跨轮累积注入)。

中断恢复无需新增机制:台账 + PLAN.md + .auto/progress.json 推导断点;
前置步骤各自幂等(提取看本轮前缀产物是否存在、现场清理看本轮标记是否已建立、
推断看配置键是否已固化、归档各步 rename 幂等)。清理与建立标记之间中断:
重跑时 PLAN.md 已重置为空模板(无任务)、台账为空 → 不再清理,只补建标记。

## 2. CLI 面(src/index.ts 重写)

- 无子命令: `opencode-auto [dir] [选项]`。首参数为旧子命令名
  (init/run/check/status/continue)→ 报错并指向新用法。
- 关键参数(首次运行固化进 config.json,与原 init 同一套 parse* 校验):
  -p/--prompt、-m/--mode、--agent、--context-limit、--subtask、--verify、
  --idle-time/--idle-max、--commit、--test-by-driver/--handover-test、
  --source-dir/--source-path、--dest-dir。handoverTest 须搭配
  testByDriver(交叉校验保留)。
- 二次运行:显式给出且与固化值不一致 → 退出码 1(逐键比对,报文含键名
  与生效值);一致视同未给出。-p 每次均可重写 brief.md。
- --phases 移除:流程固定 admtvk(出现即用法错误)。config.phases 键保留
  在 schema 中(前向兼容),但工具恒定以 "admtvk" 驱动 runAll。
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

- 时机:现场清理之前(在旧有迁移现场原状上分析)、参数推断之前(推断以
  其产物为输入之一)。知识落盘后才清理现场;提取失败仅警告,清理照常。
- 输入:brief.md、docs/ 全树(含 docs/phases/ 各阶段归档与 round-N 轮次
  归档——已有迁移结果不限于本工具此前的输出,也可能是人工或其他工具的
  产物)、git log 概览。
- 产物:docs/prior-kb/R<N>-prior-<时间戳>.md,章节骨架复用 knowledge.md 的
  知识库骨架(迁移概要/API 映射/实现模式/坑点/可复用规则/设计偏差/验证
  证据/参考)。
- 幂等(轮次前缀守卫):docs/prior-kb/ 下存在本轮 R<N>- 前缀的非空 .md →
  跳过;第 1 轮时无 R 前缀的存量(P2 前布局)按读回落视为本轮产物。
- 失败:仅 ⚠ 警告后继续(决策 3)。
- 消费:本轮首个阶段规划会话(台账为空时)经 loop.ts planPhase 注入——
  与 prevRoundDigest 合并为一个 prevRound 字符串传入 renderPhasePlan,
  模板零改动;同时作为参数推断会话的输入。

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
| test/tool.test.ts | 新增(infer 解析校验、prior 摘要、标记读写、现场清理判定) |
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
  运行的固化冲突比对。
- 严格前置:必须 `.auto/tool.json` 带 `done: true`(前一轮彻底完成),不做幂等
  宽容。不满足 → 退出码 1,报文区分两种形态:本轮进行中(`{round:N}`)→
  "不带 --next-path 重新运行即从断点续跑";首次运行/无标记 → "先完成一次完整
  迁移后再用 --next-path 开启下一轮"。
- 值域与互斥(CLI 层,全部先于任何写盘——用法错误不在目录留痕):非空、相对、
  不含 `..`;与 `--source-dir/--source-path/--dest-dir`(首跑固化参数)及
  `--dryrun`(过渡会清理并改写工作目录,违反 dryrun 契约)互斥;首跑直接拒绝。
  非首跑另做两项防御:`config.source` 已固化(缺失指引编辑
  .opencode/auto/config.json)、`<工作目录>/<source-dir>/<next-path>` 存在
  (stat 跟随软链接,与首跑 --source 校验同款)。

### 9.2 过渡步骤(prepareNextRound,纯 fs、不起 server)

过渡块插在 §1 的 done 完成检查之前,依序执行:

1. readToolState → `!done` → 报错退出 1(报文见 9.1 两种形态)。
2. `config.source.path → nextPath`,saveProjectConfig 落盘。
3. 删 `.auto/infer.json`(陈旧推断产物)与 `.auto/tool.json`(清 done 标记)。

prior-kb 不做轮间搬移(stable-refs R2:docs/prior-kb/ 永久):新一轮以轮次
前缀守卫区分——R<N>+1- 前缀无文件,提取幂等检查必然放行、重新蒸馏。

成功后必须重读 state(内存旧值仍是 done,直接复用会误报"已完成"提前退出)并
同步内存 config.source。此后零新增编排,自然流程接管:前置知识提取(本轮前缀
无产物 → 放行,重新蒸馏)→ 现场清理(marker 缺失 + 台账全满 →
archiveRound 归档完成轮 + PLAN 重置 + forgetProgress)→ 建新轮标记 → 参数推断
跳过(config 完整)→ runAll(新 source.path 生效)。

轮号口径:round-N/ 语义是"第 N 轮开始时的现场"。--next-path 过渡不建轮次
目录,archiveRound 把第 N 轮完成产物归档进 round-N/,新标记 round = N+1;
prevRoundDigest 取 round-N/ 恰为上一完成轮的交接与 migration-kb,注入
语义不变。

### 9.3 知识整理链路(零新增注入机制)

旧 prior-kb 与上一轮 migration-kb 原地保留(永久路径)→ 新一轮前置知识
提取会话细读 docs/ 全树(含轮次归档)重新蒸馏出新 prior 文档(R<N>+1- 前缀)→
priorKnowledgeDigest 注入本轮首个规划会话;prevRoundDigest(上轮最终交接 +
migration-kb 全文)照常注入同一会话;归档目录索引供各会话按需自行取用
("蒸馏产物唯一通道"纪律不变)。

### 9.4 中断恢复时序

过渡各步幂等(配置重写同值、rm force),任一步中断后:

- done 标记未删 → 重跑同一命令(带 --next-path)全流程重入,安全;
- done 标记已删、自然流程未建新标记 → 带 --next-path 重跑被严格前置拒绝
  (!done),不带参数重跑即自然流程续跑——严格拒绝方案在该时序下自洽。
