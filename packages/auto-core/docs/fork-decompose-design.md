# 会话分叉式细粒度任务分解设计(fork-decompose)

> 跨会话实施计划见仓库根 `plans/FORK_DECOMPOSITION_PLAN.md`(步骤勾选与进度以该文件为准);本文档是机制设计基准,落地偏差须回写本文。
>
> **落地状态(2026-09-05)**:步骤 1-4 已实现并提交于 auto-core 分支(`f481ba822` 分阶段分解提示词 / `8c6a18ff2` 子任务产物文件化 + 索引式 wrapup / `0e95e0dcb` 实验开关环境变量层 / `00bad6a04` fork 三段式流水线),`bun typecheck` / `bun test` 全绿(auto-core 304 例、auto 壳 27 例;新增 test/switches.test.ts 与 test/runner.test.ts 单测)。A/B 实验与默认值定型见 §11,宪法键转正待实验结论。

## 1. 背景与动机

auto 模式当前的子任务流水线存在三个结构性问题:

1. **粒度粗化有结构性诱因**:每个子任务会话都要自行「阅读相关源码与 docs/」(decompose.md 第 1 步),粒度越细、重复探索的固定开销越大,模型与提示词因此倾向合并方面成粗粒度子任务;粗粒度会话上下文膨胀 → 慢、贵、更易触发交接。
2. **分解提示词不分阶段**:分析、设计、实现、测试、验收、知识提炼各阶段的「一个方面」含义完全不同,单一 decompose.md 无法给出准确的切分准则。
3. **wrapup 综合成本高**:收尾会话读全量产物重写汇总报告,Token 二次消耗且易失真。

本轮修订补充两个动机:

4. **粒度准则缺基准**:只讲「一个方面一个子任务」仍偏任务级聚合,更适配「任务分解」而非「子任务分解」——子任务分解应以任务描述为基础、在其规定的范围内选择粒度(描述点名的文件/模块/接口/行为/场景即天然切分单元);且粒度应有标准/细粒度两档,独立开关控制,供实测对比。
5. **机制组合需要实验闭环**:fork 是否启用、分叉基点取理解末端还是摘要会话、超限交接 steer 是否保留,都是多方案候选;需要一条不改 CLI 交互的开关通道做 A/B,定型后再转正为宪法级配置。

opencode SDK 已内置会话分叉:`client.session.fork({ sessionID, messageID? })`(驱动器所用 `@opencode-ai/sdk/v2` 客户端的 `Session2` 类,`POST /session/{sessionID}/fork`),在指定消息点(缺省=全部)复制消息前缀为新会话。fork 前缀与 baseline system context 逐字一致,provider prompt-cache 友好——理解成本付一次,各分叉的增量输入成本远低于重读文件。auto-core 目前未使用该能力。

## 2. 目标与非目标

**目标**

1. 「理解 → 分解 → 执行」三段式:理解会话一次性加载背景;分解与每个子任务执行会话都从**分叉基点**继承上下文免重读。
2. 分阶段(a/d/m/t/v/k)分解提示词,粒度准则 =「以任务描述为基准 + 一个方面一个子任务 + 下限保护」,并可经开关启用细粒度档。
3. 子任务产物独立成文件(`docs/<id>/S<NN>.md`),wrapup 只写索引,引用式整合。
4. `fork: "off"`(或 fork 失败)时行为与现状完全一致。
5. fork 基点双模式可选:`session`(理解会话末端,信息最全)与 `digest`(以 context.md 为输入新建基点会话,前缀最瘦、可从磁盘重建),实测对比后定默认。
6. 实验期全部开关经 `OPENCODE_AUTO_*` 环境变量注入、核心内解析,CLI 壳零改动。

**非目标(首期)**

- 子任务并行执行(依赖组 DAG、并发提交改造)——后续扩展;
- `subtask=off/ondemand` 模式改造;
- verify/review/judge 等独立判定会话的上下文继承(见不变量 §9);
- 开关的宪法键转正(ProjectConfig 键 + init 固化 + run 拒绝旗标)——实验定型后另做,路径见 §4.6;
- 混合基点(分解用 session、子任务执行用 digest)——开放问题(§11)。

## 3. 总体流程

```
T-001(subtask=auto, fork=on)
  ├─ ① understand 会话(全新):预算内选读源码/docs,写摘要 docs/T-001.context.md 后结束
  │     driver 写任务字段  - fork-base: <①的sessionID>   ← session 模式;磁盘持久,断点可再分叉
  ├─ ①′(仅 fork-base=digest)context-base 会话(全新,driver 主导):
  │     提示词 = context.md 全文 + 「确认理解,简短回复」;无工作区改动、不提交
  │     driver 改写  - fork-base: <①′的sessionID>        ← 每次运行从磁盘重建的易失指针
  ├─ ② decompose 会话 = fork(fork-base 末端):提示词 = decompose-<phase> 模板
  │     (粒度以任务描述为基准;fine 开关启用时注入细粒度段)
  │     写 docs/T-001.subtasks.md → driver setSubtasks 注入 PLAN.md(现机制不变)
  └─ ③ 子任务 i(串行):会话 = fork(fork-base 末端,同一分叉点)
        提示词 = subtask 模板 + 全量检查项列表 + "执行第 i 项" + 产出文件约定
        会话结束 → driver 勾选 + 统一提交(不变)
  wrapup 会话(不 fork,沿用链内复用规则):索引式报告
```

进入条件:auto 模式、任务体无检查项、`fork=on` → 先 ①(及 ①′)后 ②;`fork=off` → 直接走现状 `ensureDecomposed()`(不加理解会话)。已有人工检查项的任务跳过 ①②。① 幂等:`docs/<id>.context.md` 已存在(中断恢复/上一轮遗留)时跳过理解会话,仅补写缺失的 `fork-base`。`docs/<id>.subtasks.md` 已存在的中断注入路径不变(有可用 fork-base 则 ③ 照常分叉,无则冷启动)。

## 4. 关键机制

### 4.1 理解会话与摘要文件

- 新模板 `understand.md`(全文见 §6):只读理解、预算内**选读**(优先任务正文点名文件与直接相关模块)、写 `docs/<id>.context.md` 四节摘要(相关文件与关键符号 / 约束与前提 / 已有决策与现状 / 风险与未知)、写完即结束。
- 驱动侧 `ensureUnderstood()`:`requireArtifact` 同款骨架(两次重试 + 隐性阻塞),commit stage `"understand"`,成功后写任务字段 `fork-base: <sessionID>`(session 模式下即最终基点;digest 模式随后被 ①′ 覆写)。摘要文件已存在时幂等跳过,仅补写缺失的 `fork-base`(中断恰好落在摘要写盘与 setForkBase 之间的恢复路径)。
- **摘要文件是磁盘态兜底**,三重用途:fork 失败时冷启动输入;wrapup/verify/后续任务低成本引用;人工审计(「从磁盘即可理解」哲学)。它不是 fork 的替代品——fork 省的是重复阅读的往返,摘要是降级通道与长期记忆。
- digest 模式下它还是**基点原料**:context.md 会被逐字注入基点会话、成为全部分叉的前缀,故模板要求摘要紧凑(建议 200 行以内,见 §6 约束 4)。

### 4.2 fork 基点:session | digest

基点 = decompose/子任务会话统一分叉的会话,持久化为 PLAN.md 任务字段 `fork-base`(两模式同名字段,语义均为「分叉基点会话」)。

- **`session`**:基点 = 理解会话末端。
  - 优点:前缀含实际读过的源码与探索过程,分解与执行的接地最全,行级细节不丢失;
  - 缺点:前缀大小不受控(取决于探索量),逼近 `cap/2` 会触发冷启动防护;provider 缓存未命中时前缀全额计费;基点 sessionID 跨运行失效只能回退冷启动。
- **`digest`(默认)**:理解完成后 driver 建一个**全新基点会话**——提示词 = context.md 全文 + 要求一句确认(模板见 §7),经 `runSession` 一次性链(`{ pct: 100, used: 0, at: 0, subject: "T-NNN ctxbase …" }`,不带 phase、不写进度记录)运行,结束后的 `chain.id` 即基点,`setForkBase` 覆写字段。
  - 优点:前缀 = 紧凑摘要(大小可控可预估,cap 利用率最高,`cap/2` 防护基本不触发);**可从磁盘确定性重建**——恢复运行无条件重建(context.md 未变则前缀逐字一致,provider 缓存仍命中),「基点 sessionID 失效」这一回退场景在 digest 模式下不存在;
  - 缺点:丢失探索过程的原始细节,子任务需要具体代码时须按摘要指引回读文件(定向回读远廉于盲目探索,但多一跳);
  - 确认 turn 无工作区改动,`commitTree` 对无改动仓库自然跳过(不产生空提交);session 模式基点持久跨运行,digest 模式基点是**每次运行重建的易失指针**(重建后字段值更新,旧基点会话自然沉没)。
- **回退链**:digest turn 失败(三次瞬时重试后仍会话错误)→ 回退 session 基点(本运行的理解会话仍存活)→ 再回退冷启动。

### 4.3 fork 会话创建与回退

- `forkSession(client, base, title)`:`base` 为 §4.2 选定的生效基点;封装 `client.session.fork({ sessionID: base })`;返回 `{data}` 取 `.data.id`;`{error}` 或任何异常 → log「↻ fork 失败(原因),回退全新会话」→ `undefined`。**写成可注入依赖**(fake client 可测)。外部旧版 `--server` 无此路由属预期回退场景,不是错误。分叉成功后把新会话改名为本阶段提交标题(`session.update`,与 git 历史/任务进度对齐,失败仅记明细)。
- `SessionChain` 增加两个字段:
  - `forkBase?: string` —— 分叉基点(生效基点会话);
  - `pending?: string` —— 预创建会话 id,`attempt()` 在 `!reuse` 时优先消费(等效于 `session.create` 的结果),消费即清。
- 调用时序(**先 fork 后渲染**,warm/cold 提示词才能选对):
  0. 恢复续跑优先于分叉:链上仍有存活会话且恢复说明(note)待注入 → 不分叉,首个提示词进复用会话(`warm = true`);
  1. 分叉前经 server 句柄 `syncAgents()`(与 create 路径同款,AGENTS.md 有更新则先重启 server 再分叉);
  2. `const forked = await forkSession(client, forkBase, title)`;
  3. 成功 → `chain.pending = forked`、`warm = true`;失败 → 走 `session.create`、`warm = false`;
  4. 渲染提示词(warm 条件段见 §8 的 subtask 模板);
  5. `runExecSession(...)` → `attempt()` 消费 `pending`。
- 瞬时错误重试(`runSession` 的三次重试)会开全新会话——`pending` 已被首次尝试消费,重试自然回落 create 路径,反馈闭环不受影响。

### 4.4 链与上下文计量

- **每阶段/每子任务新种子链**:`{ pct: 100, used: <基点用量>, at: 0, forkBase }` —— `pct:100` 强制首次不复用(fork 优先);`used` 播种使 `watch()` 的 2×cap steer 阈值按「前缀+新增」计算。
- 基点用量来源:同次运行取基点会话 `chain.used`(session 模式 = 理解会话跟踪值,基点恰为链上会话时直接取跟踪值;digest 模式 = 基点确认会话跟踪值,≈ 摘要大小,极小)。恢复运行:session 模式经 `client.session.messages({ sessionID })` 取末条 assistant 消息 `tokens.input + tokens.cache.read` 重建(近似即可,首个 turn 的事件跟踪会自行校正;取不到按 0);digest 模式基点本就无条件重建,用量随建随取。
- 同一子任务内的反馈重试仍可自然复用当次会话(复用规则不变);**跨子任务不复用**,每项重新从基点分叉。wrapup 与 verify 修复轮不 fork:wrapup 沿用链内复用规则(可能复用末个子任务会话,与现状一致)。
- 基点用量达到 `cap/2` 时驱动侧不起 fork,直接冷启动(防前缀逼近上限;digest 模式基本不触发)。
- **steer 开关**(`OPENCODE_AUTO_STEER=off`):`runSubtask`/`executeWhole`(ondemand)不构造 steer——2×cap 交接提示不注入;**且会话结束后的 `used < 2×cap` 交接判定一并停用**(否则自然结束但用量超限的会话会被误要求补写交接文档)。停用后会话要么自然完成,要么由 provider 侧压缩/上限错误收场(错误走既有「会话错误」换新会话重试,磁盘进度与统一提交不受影响)。`--handover-test` 的测试交接是独立机制,不受此开关影响;`used`/`pct` 计量始终保留(复用决策与日志依据)。

### 4.5 中断恢复

- `PhaseKind` 增加 `"understand"`(persistStage/恢复路由对齐现有 decompose 处理)。
- `.auto/progress.json` 语义不变(单 session 字段,逐会话 active);fork 基点持久在 PLAN.md 任务字段 `fork-base`,恢复运行据此重新获取基点:**digest 模式无条件从 context.md 重建**(不降级);session 模式校验存活,sessionID 失效(存储清理)→ 自动回退冷启动。
- PLAN.md 字段行机制(`  - key: value` 紧跟标题且连续)自动承载新字段,解析规则零改动,`setForkBase()` 为 driver 独占写入。

### 4.6 运行开关:环境变量层(实验期)

命名沿用核心既有先例 `OPENCODE_AUTO_SERVER`(src/server.ts)。**核心内一次解析(memo)、全流水线一致,CLI 壳零改动**——实验期免改 `packages/auto` 等壳的命令行交互。

| 环境变量 | 值域 | 缺省 | 作用域 |
|---|---|---|---|
| `OPENCODE_AUTO_FORK` | on\|off | on | 总开关:off = 现状流水线(无理解会话、无分叉),行为零变化 |
| `OPENCODE_AUTO_FORK_BASE` | session\|digest | digest | 基点模式,仅 fork=on 有意义(§4.2) |
| `OPENCODE_AUTO_DECOMPOSE_FINE` | on\|off | on | 细粒度分解:decompose-\<phase\> 模板注入细粒度准则段(§5.1) |
| `OPENCODE_AUTO_STEER` | on\|off | off | 超限交接 steer(2×cap):off = 停用注入与会话后交接判定(§4.4) |

- 解析(实现独立成 `src/switches.ts`:`parseSwitches` 纯函数供单测直接构造 env 记录驱动 + `autoSwitches` memo 访问器):值为空串视同未设;非法值 throw 中文报错(含变量名与期望值域)→ CLI 退出码 1(与配置「坏文件严格失败」哲学一致)。runner 入口解析一次;`runTask` 启动日志列出**非默认**生效项(默认组合静默,verbose 可查全量)。
- **不落盘**:环境变量覆盖不写回任何状态文件(区别于宪法键的 init 固化),实验语义 = 本次运行;同一次运行内开关恒定,会话中途不变。
- **转正路径**:某开关实测定型后 → 升为宪法级键(如 `fork: "on" | "off"`)进 `ProjectConfig` + init 固化 + run 出现对应旗标退出码 1(仿 `--auto-number`);届时环境变量可保留为运行期覆盖通道(优先级 env > config)或退役,另议。原设计 §4.5 的宪法键方案即此路径,实验期暂缓。

### 4.7 产物文件化与索引式整合

- 子任务产出文件 driver 机械命名:`docs/<id>/S<NN>.md`(NN 两位递增),避免 slug 清洗歧义;标题写在文件首行。代码类产出即源码树,不重复落文档。
- wrapup 报告(`docs/<id>.report.md`)改索引式(auto 模式):逐子任务一行(序号 + 一句话结论 + 产物路径),不复制产物内容;只新增整体结论/遗留问题节。off/ondemand(solo,无子任务产物可索引)保持摘要式报告。

## 5. 分阶段分解提示词准则(decompose-\<phase\>)

### 5.1 共通准则(_partials.md 新节 `decompose-rule`)

前提:本流水线做的是**子任务分解**——在任务描述规定的范围内切分执行单元,不重新划定任务范围。粒度基准 = 任务描述本身:

```
2. 分解粒度准则(以任务描述为基准——在其规定的范围内选择粒度,不扩大、不缩小):
   - 一个方面一个子任务:调研、实现、文档、接线等不同性质的工作不合并为一项;
     任务描述点名的文件/模块/接口/行为/场景是天然的切分参考;
{{#if fine}}   - 细粒度模式:按任务正文点名的文件/模块/接口/行为/场景等自然单元逐一
      成项,宁细勿粗——fork 流水线已消除子任务间重复理解的固定开销,细项的边际
      成本低;细项间显式排出可执行顺序,依赖前项的排在后;
{{/if}}   - 每项自包含:仅凭该项描述、CURRENT.md 与 docs/ 即可执行,并包含验证方式;
   - 每项声明产出:文档类注明文件路径,代码类注明模块/文件范围;
   - 上限导向:每项以单个会话用较小上下文(约 {{contextBudget}} tokens 量级)可完成为宜;
```

(`contextBudget` = `formatTokens((contextLimit ?? 64_000) / 2)`,`fine` 为开关解析出的布尔,均经 `baseCtx` 注入;模板引擎对片段内条件段与模板同级求值——`renderPartial` 以同一 ctx 递归渲染,`{{#if fine}}` 写在 `_partials.md` 节内可直接生效。细粒度段仍受各阶段下限保护条款约束,见 §5.2 m。)

### 5.2 阶段化准则(各模板差异段)

- **a 分析**(`decompose-a.md`):

```
   - 按问题/疑点/子系统/风险面切分:每项回答一个明确的问题(如"模块 X 的数据流是
     什么"、"某类 API 差异清单"、"某风险是否存在");
   - 每项产出一份独立分析文档,写入 docs/ 下独立文件;
   - 本阶段只产出分析与结论,禁止修改任何实现代码;
```

- **d 设计**(`decompose-d.md`):

```
   - 按设计关注点切分:数据模型、API 契约、模块边界、错误处理、迁移策略等各自成项;
   - 每项产出一份设计文档,含备选方案取舍与理由;
   - 跨关注点一致性检查(各设计文档之间是否矛盾)必须作为独立的收尾子任务;
```

- **m 迁移实现**(`decompose-m.md`,默认阶段):

```
   - 垂直薄切片优先:一条可调用路径端到端成项,不按水平层(先全部 schema 再全部
     实现)切分;
   - schema/接口、实现、接线、文档等不同方面分开成项;
   - 下限保护:每项完成时源码树保持一致——可编译、既有测试不倒退;禁止拆出会留下
     破损中间状态的碎片;
   - 存在依赖顺序时按可执行顺序排列(依赖前项的排在后);
```

- **t 测试**(`decompose-t.md`):

```
   - 按测试面/场景族切分:每项对应一个测试文件或一族紧密相关的场景;
   - 写测试与修缺陷分离:测试暴露的实现缺陷作为独立修复项追加,不与写测试混在
     一项;
   - 测试执行遵守测试执行协议(启用 --test-by-driver 时脚本交 driver 执行);
```

- **v 验收**(`decompose-v.md`):

```
   - 按验收维度切分(功能符合度、文档完备性、环境与运行、回归等),每维度一项;
   - 每项产出一份核验记录(核验方式、证据、结论),写入 docs/ 独立文件;
   - 只核验与记录,不做修复(差距走既有终审闭环);
```

- **k 知识提炼**(`decompose-k.md`):

```
   - 按知识产物切分:坑点清单、可复用模式、README/交接文档等各自成项;
   - 每项产出一份独立文档,可被后续任务直接引用;
```

### 5.3 模板骨架与选择逻辑

- 六份模板骨架一致:现有 decompose.md 的 head/taskBlock/blocked/mode 段 + 「你本次只做任务分解,不写实现代码。当前处于阶段 {{phaseName}}」+ `{{> decompose-rule}}` + 阶段化准则段 + 检查项格式(`- [ ]`,描述自包含、末尾注明产出)+ 现有约束段(只做分解/state-rule/question-rule/硬性要求/写完即结束)。
- `renderDecompose` 模板名 `decompose-${opts.phase ?? "m"}`;库中无此名回退 `decompose`。目标目录覆盖按名生效(`.opencode/auto/prompts/decompose-m.md`),`PROTOCOL_MARKERS` 六份均登记 `["- [ ]"]`。
- `baseCtx` 增加 `phase`/`phaseName`/`contextBudget`/`fine`。

## 6. understand 模板全文

```
{{> head}}

当前任务(完整内容同时见 CURRENT.md):

{{taskBlock}}

{{#if blockedAnswered}}该任务此前被阻塞。上次的问题:"{{question}}",已获解答:"{{answer}}"。请据此继续。

{{/if}}{{#if blockedUnanswered}}该任务此前因以下问题被阻塞:"{{question}}"。用户未提供解答,直接重新运行了 driver,说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。

{{/if}}{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}你本次只做任务背景理解,不写实现代码、不做任务分解:

1. 围绕该任务的目标,有选择地阅读相关源码与 docs/(控制阅读总量,优先任务正文
   点名的文件与直接相关模块,不求全);
2. 把理解结果写入 docs/{{taskId}}.context.md,包含四节:
   ## 相关文件与关键符号(路径 + 为什么相关,一两句)
   ## 约束与前提
   ## 已有决策与现状
   ## 风险与未知
3. 写完该文件后立即结束会话。

约束:
1. 只读理解:不修改任何实现代码;{{> state-rule}}
{{> question-rule}}
3. 写出该文件是硬性要求:不产出有效文件会导致任务阻塞停机;
4. 该文件是后续所有子任务会话的背景摘要来源——写得紧凑、可检索(建议 200 行
   以内;fork-base=digest 时本文件会被逐字注入分叉基点会话,成为全部后续会话的
   前缀);后续会话默认继承本会话已加载的上下文,仅缺漏时回读此文件。
```

(marker:`["context.md"]`;渲染函数 `renderUnderstand`。)

## 7. context-base 模板全文(digest 基点会话)

```
以下内容是任务 {{taskId}} 理解阶段产出的背景摘要(docs/{{taskId}}.context.md 全文)。
本会话由 driver 建立,将作为该任务后续会话(分解、子任务执行)的分叉基点——后续
会话带着这份摘要上下文继续工作。

{{digest}}

请通读上述摘要并确认已理解:回复一句简短确认即可。不要读取文件、不要展开分析、
不要修改任何内容,确认后立即结束会话。
```

(登记 embedded 注册表 + `with { type: "file" }` 导入;无 driver 解析协议,不登记 `PROTOCOL_MARKERS`;渲染函数 `renderContextBase(task, digest)`,`digest` = context.md 全文。)

## 8. subtask / wrapup 模板增补

**subtask.md**(在现有基础上):

- 任务列表段(替换现有单条呈现):

```
本任务的完整子任务列表(按序执行,其他项由其他会话完成,不要碰):

{{subtaskList}}

你本次只负责其中的第 {{index}} 项:

- [ ] {{subtask}}
```

- 背景段(warm/cold 单一模板条件化;warm 对 session/digest 两基点通用):

```
{{#if warm}}本会话已继承任务背景上下文(理解阶段的摘要与已加载内容),无需重读已在
上下文中的文件;如仍缺背景,可读 docs/{{taskId}}.context.md 摘要。{{/if}}{{^warm}}如存在
docs/{{taskId}}.context.md,先读之了解任务背景再开始(不存在则按需自行阅读源码)。{{/if}}
```

- 产出约定段:

```
产出约定:本项若产出文档/分析/设计类内容,写入 {{outputFile}}(独立文件,标题写在
首行,不并入其他文档);代码类产出直接落于源码树。
```

(`outputFile` = `docs/<id>/S<NN>.md`,driver 机械命名。`subtaskList`/`outputFile` 均带条件回退:调用方未提供时 `renderSubtask` 从任务正文检查项推导 index/列表/产出文件,无列表时渲染单条呈现——旧调用不传参仍完整;`runSubtask` 现传 `index`/`warm`,列表与产出文件经推导。)

**wrapup.md**:报告改索引式——逐子任务一行(序号 + 一句话结论 + 产物路径 `docs/<id>/S<NN>.md` 或代码位置),不复制/改写子任务产物内容;仅新增整体结论与遗留问题两节(solo 模式保持摘要式,见 §4.7)。

## 9. 不变量(实现不得破坏)

1. **driver 独占状态写入**:PLAN.md/CURRENT.md/verified(含新字段 `fork-base`)全由 driver 写;`protect.ts` 无需改动(driver 写入已放行)。
2. **统一提交**:逐会话 `afterSession` 提交不变;fork 只改会话创建方式,不改 git 行为(digest 基点会话无工作区改动,自然零提交)。
3. **独立判定会话永不 fork**:verify-judge/review/review-fix/final 系会话全新创建——独立判断是完成判定的基石。
4. **串行执行**:同一时刻至多一个会话写目标目录文件(现状注释明示的假设)。
5. **完成判定不靠自报**:子任务仍由 driver 勾选(信任 + 任务级验收兜底);fork 不改变勾选时机。
6. **退出码语义**不变。
7. 运行期对 opencode server 的依赖面只新增 fork 路由,且失败自动回退——外部 `--server` 兼容性不降级。
8. **实验开关只读环境**:环境变量层不写任何状态文件;解析一次、全流水线一致;宪法键转正前不进 `ProjectConfig`。
9. **基点会话 driver 主导**:context-base 会话由 driver 建立、提示词 driver 拼装,AI 仅确认不产出;`fork-base` 字段始终 driver 独占写入。
10. **steer=off 不改判定与提交语义**:仅停用 2×cap 交接注入与交接判定;勾选、验收、统一提交照旧。

## 10. 回退矩阵

| 场景 | 行为 |
|---|---|
| fork=off | 现状流程,零变化(无理解会话) |
| fork 调用返回 error / 抛错(旧路由、基点被清理) | log 后全新会话 + 冷启动提示词 |
| 基点用量 > cap/2 | 驱动侧不起 fork,直接冷启动(digest 基点极小,基本不触发) |
| 恢复运行基点 sessionID 失效 | session 模式:回退冷启动;digest 模式:从 context.md 重建基点(不降级) |
| digest 基点会话建立失败(会话错误×3) | 回退 session 基点(本运行理解会话)→ 再回退冷启动 |
| understand 两次未产出 context.md | 隐性阻塞(现有 requireArtifact 语义) |
| context.md 缺失 + 冷启动 | 提示词已兜底(「不存在则按需自行阅读源码」) |
| steer=off 且会话撞 provider 上限 | 会话错误 → 既有换新会话重试(RETRIES=3),磁盘进度不丢 |

## 11. 风险与开放问题

- provider 缓存未命中时 fork 前缀全额计费:冷启动路径 + `fork=off` 兜底;日志同时输出基点用量供人工判断。
- fork 会话 SDK 返回形状(已落地):`{ data }` 取 `.data.id`、`{error}` 与调用异常三分支在 `forkSession` 统一处理(与 `session.create` 同构),fake client 单测覆盖(test/runner.test.ts)。
- **A/B 实验矩阵**(定型默认值与转正范围的依据):{fork on\|off} × {fork-base session\|digest} × {fine on\|off} × {steer on\|off};指标:任务墙钟时间、总 tokens(input / cache.read 分计,取自 chain.used 跟踪与日志)、交接与重试次数、子任务数与子任务均上下文、verify/review 通过率。注意 fine=on 且 fork=off 会重现「细粒度 × 重复探索」的旧成本结构,仅作对照组,不建议日常使用。
- digest 模式摘要失真:摘要缺细节时子任务须按指引回读文件;session 模式与冷启动提示词兜底;**混合基点**(分解用 session 保接地、执行用 digest 保瘦前缀)为候选改进,首期不做。
- digest 确认 turn 依赖模型自律(应只回一句):实现期可验证 fork 的 `messageID` 语义——若支持「仅复制到指定消息为止」,可只以摘要 user 消息为前缀、去掉确认 turn,前缀完全确定化。
- 摘要超长(model 无视紧凑建议)时 digest 前缀优势收窄:`cap/2` 防护与 understand 模板的行数建议兜底。
- steer=off 下长会话可能触发 provider 侧压缩(compaction)而非交接:对比「压缩续命」与「交接换新」的质量差异正是实验目的之一;机制上两者都不破坏磁盘进度与统一提交。
- 后续扩展(非本期):依赖组声明与只读子任务组并行;`subtaskList` 中标注依赖序的协议。
