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
  → .auto/tool.json.done === true → 报告完成,退出 0
  → 启动 server(全程一个实例,注入 runAll 复用)
  → [dryrun: 跳过以下前置步骤,直接走 runAll 的权限预检]
  → 前置知识提取(docs/prior-kb/prior-<时间戳>.md,已有非空产物则跳过)
  → 现场清理(本轮标记未建立时;原 continue 流程): 台账有完成阶段/无法解析,
    或 PLAN.md 有任务,或 migration-kb 残留 → archiveRound 归档 + PLAN.md 重置
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
- `docs/prior-kb/prior-<时间戳>.md`(版本化): 前置知识提取产物。独立于
  k 阶段的 docs/migration-kb/(existingKnowledge 只读该目录顶层,互不
  污染;k 阶段在本轮收尾照常产出本轮新知识)。

中断恢复无需新增机制:台账 + PLAN.md + .auto/progress.json 推导断点;
前置步骤各自幂等(提取看产物是否存在、现场清理看本轮标记是否已建立、
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

## 3. 前置知识提取(新会话,模板 prior-knowledge.md)

- 时机:现场清理之前(在旧有迁移现场原状上分析)、参数推断之前(推断以
  其产物为输入之一)。知识落盘后才清理现场;提取失败仅警告,清理照常。
- 输入:brief.md、docs/ 全树(含 docs/phases/ 各阶段归档与 round-N 轮次
  归档——已有迁移结果不限于本工具此前的输出,也可能是人工或其他工具的
  产物)、git log 概览。
- 产物:docs/prior-kb/prior-<时间戳>.md,章节骨架复用 knowledge.md 的
  知识库骨架(迁移概要/API 映射/实现模式/坑点/可复用规则/设计偏差/验证
  证据/参考)。
- 幂等:docs/prior-kb/ 下已存在非空 .md → 跳过。
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
