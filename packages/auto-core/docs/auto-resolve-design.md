# 自主决策(AUTO-DECISION)与代答决策(AUTO-RESOLVE)分离设计

状态: 实施中(2026-09-12;T-001 设计基准、T-002 开关接线、T-003 规则文本改造、
T-004 `src/resolve.ts` 模块、T-005 driver 侧采集接线已落地,T-006..T-008 待做)。计划文件
`plans/AUTO_RESOLVE_PLAN.md`(含动机、已确认口径与八任务拆分)。本文承担两件事:
① 把口径/判据/schema/挂点/报文固定为后续任务的唯一依据;② 记录 T-001 对计划所引
全部代码位置的核实结果与**四处修正**(§J)。行号以 auto-core 分支 `bf745fa94` 为准。

体例仿 `docs/stats-timing-design.md`。台账与报文机制常态启用、零开关,持久化在目标
目录 `.auto/resolves.json`(gitignore 内、driver 独占写、不进 protect 名单);**唯一
新增开关 `OPENCODE_AUTO_ASK` 管的是提问策略**,不是日志级别。

## A. 动机

现状只有一个标记 `AUTO-DECISION`,同时承载两种性质完全不同的事:

1. **纯工程裁量** —— AI 在多个合理实现方案中自行取舍(算法、内部结构、命名、文件
   组织、测试写法)。本就该由 AI 做,记录只为留档。
2. **被压制的提问** —— `templates/prompts/_partials.md:14` 的 `question-rule` 明确
   要求:除权限类问题外,"需求歧义、多种合理方案、数据异常、环境缺失"一律**不要
   调用 question 工具**。这类分歧点本应由用户拍板,是无人值守流水线为了不停机而让
   AI 代替用户闭环的。

两者混在同一标记里,第 2 类被第 1 类淹没:一个任务十几条 `AUTO-DECISION`,用户无从
分辨哪几条其实是"系统替我做了主"。

driver 侧对这两类**完全无感知**:`src/runner.ts:74` 的 `autoAnswer` 把非权限提问
自动答复掉,`src/runner.ts:2620` 打一行 `→ 自动答复: …` 就过去了;这一行淹没在会话
日志里,任务结束报文(`src/loop.ts:1006` taskEndLines)不提、阶段收口
(`src/loop.ts:1028`)不提、轮次完成(`src/loop.ts:1048`)不提。跑完一轮 24 个任务,
不翻日志就不知道系统替人做了多少主。

两条规则是**因果绑定**的:正因为 `question-rule` 压制提问,决策才不可见;正因为不
可见,才必须强制记录。既有设计把这条因果链固化成唯一形态,于是「计划已足够完备、
AI 本无须裁量」的场景也被迫产出大量 AUTO-DECISION 留痕。

目标: 把"代答决策"从"自主决策"里拆出来,给它独立标记 `AUTO-RESOLVE`、独立台账、
独立的高亮报文通道;并把那条因果链**做成可切换的两种提问策略**,让记录量与场景匹配。

## B. 口径(已确认决策)

- **`AUTO-DECISION`** = AI 思考过程中的自主决策,凭工程与架构能力在多个合理技术
  方案中自行裁量。归常规工程日志,**不上终端高亮**。
- **`AUTO-RESOLVE`** = 本应询问用户、但被自动放行或代答的决策。存在一个待决的交互
  分歧点,AI 代替用户将其闭环(Resolve)。任务结束时**高亮置顶**。
- **提问策略与 AUTO-DECISION 记录义务同进同退**,由单一开关切换(§E)。绑在一起
  是因果使然:压制提问 → 决策不可见 → 必须记录;允许提问 → 决策以提问形式浮出水面
  → 无须另行留痕。拆成两个独立布尔量会造出「压制提问且不记录」这种既无可见性又无
  留痕的组合,不提供。
- **`AUTO-DECISION` 在 ask 档下不是「降低门槛」而是「不要求」**。要留痕走缺省
  suppress 档,要轻量走 ask 档、由提问本身承担可见性。不设"按架构敏感度自适应"这类
  需 AI 自评的中间档 —— 那是在归属判据之外再叠一道模糊阈值,两道软判据串联只会比
  一道更不可控。
- **仅回落自动答复才计入 AUTO-RESOLVE**。`--wait-answer` 下人工真答了的提问不计
  (`src/runner.ts:2619` 的 `human !== undefined` 分支)—— 那是真人做的决定。
- **dryrun 预检会话不计**。预检只探查权限(`src/runner.ts:2609` 的
  `opts.dryrun ? false : …`),不产生工程决策。
- **展示分级复用既有 `vlog` 通道,不为「显示多少」新造开关**。`src/log.ts:11-34` 已
  提供三档:`--verbose` 终端+文件、`--interactive` 仅文件、外壳 `audit` 画像下
  `vlog` 恒写日志文件。AUTO-DECISION 的计数走 `vlog` 即"缺省不打扰、需要时可追溯"。
- **`AUTO-DECISION` 不进台账**。`collectAgentResolves` 对它只回计数、不落
  `.auto/resolves.json` —— 台账的存在理由是驱动高亮,AUTO-DECISION 不参与高亮就不
  需要行级持久化,它的持久轨迹本来就是进 git 的标记行本身。
- **独立文件,不并入 `stats.json`** —— stats 有 30s 心跳高频写(`src/stats.ts` 的
  增量落盘),塞进一个会增长的问题文本数组会让每次心跳重写全量文本。
- 持久审计轨迹靠进 git 的两样东西:代码/文档里的 `AUTO-RESOLVE:` 标记行本身,与
  `docs/T-NNN/report.md` 的「自动代答问题」节。`.auto/resolves.json` 只是 driver 的
  计数与高亮依据,丢了不影响正确性。
- 台账写失败**全静默**,永不影响流程与退出码(照搬 stats 的健壮性口径)。

## C. 判别硬判据(规则文本的核心,必须写死)

问的是**分歧点的决定权本应属于谁**,不是问决策有多重要。

- 属于**用户** → `AUTO-RESOLVE`:需求意图与范围取舍(做不做、做到哪)、对外可见行为
  与接口契约的变更、验收口径、事实确认类问题(数据异常、环境缺失、与文档不符的
  现状)、触碰任务描述边界(超出/收窄计划字面范围)。**提示词里“验收口径”落地为
  “「什么算做完」的判定标准”** —— `config.verify === false` 时提示词不得出现“验收”
  字样,理由见 §M。
- 属于**AI** → `AUTO-DECISION`:实现手段的选择,且任一选项都不改变用户可见行为
  (算法、内部结构、命名、文件组织、注入方式、测试写法)。
- 同一决策不重复标注两次;**拿不准时标 `AUTO-RESOLVE`** —— 宁可多提醒一次,漏报才
  是本机制的真实损失。

正反例(写进规则文案):
- 范围取舍 → AUTO-RESOLVE:"是否把 `prompt.ts` 的第三份 `formatTokens` 一并收口"
  (改变了任务范围,本应问用户)。
- 命名取舍 → AUTO-DECISION:"新字段叫 `matched` 还是 `paired`"(任一选项都不改变
  用户可见行为)。

## D. 标记语法与解析

```
AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)
AUTO-DECISION: <决策> (<理由>)
```

`AUTO-DECISION` 的现有写法 `AUTO-DECISION: <决策与理由>` 保持兼容 —— 括号段可选,
存量文档零改动(`src/stats.ts:239` 等既有标记行不受影响)。

`parseResolveLine`(纯函数)的解析口径:

- 分隔符接受 `->` / `→` / `=>`;理由段接受 `(…)` / `(…)`;
- **单行为界,不跨行**;代码注释内与 markdown 正文内同等有效(注释是合法标注位,
  `src/stats.ts:239` 即先例);
- 行内前缀允许(`// AUTO-RESOLVE: …`、`- AUTO-RESOLVE: …`);
- **容错优先**:无箭头时整行作 `question`、`option`/`reason` 留空,**仍然计数**,
  报文标 `⚠ 格式不规范` —— 少报一条代答比格式洁癖代价大得多。

## E. 提问策略开关 `OPENCODE_AUTO_ASK`

本次唯一新增开关,进 `src/switches.ts:12` 的 `SWITCH_ENV` 注册表(实验语义 = 本次
运行、不落盘;定型后再议宪法键转正 —— 该文件头注释写明的既定路径)。值域两档,
`onOff` 式解析(`src/switches.ts:204`),缺省 `off` 即**逐字节等价现状**:

| 值 | 提问策略 | AUTO-DECISION | AUTO-RESOLVE 的主来源 |
|---|---|---|---|
| `off`(缺省) | 压制:非权限问题一律不问,自主决策 | **要求标注**(现状) | agent 自觉标注,driver 观测为辅 |
| `on` | 允许:归属于用户的分歧点**主动发问** | **不要求**,不标不罚 | **driver 观测**,权威且完备 |

`on` 档把归属判据从「事后标什么」前移到「要不要问」:决定权属于用户的分歧点
**调 question 工具问**;纯实现手段自主决定,无须留痕。这一档下 driver 侧**不需要
任何新逻辑**就能拿到完备记录:AI 提问 → `question.asked` 事件 → 有人工答复记为人工
决策(不计)、无人值守则 `AUTO_ANSWER` 回落并落账。§G 的 H1 挂点原样服务两档。

**为什么 `on` 比缺省档更强**:缺省档下 driver 只能看见"AI 违背规则仍然发问"的少数
情形,绝大多数代答靠 AI 自觉,漏标不可检测(§K)。`on` 档把观测面从少数派变成全集
—— 提问是流经 driver 的事件,AI 想漏也漏不掉。代价是每个问题一次会话往返。

**副产品:提问数即计划完备度指标**。计划完备 → 提问寥寥 → 台账近空;提问密集 →
高亮块很吵 → 说明计划有洞。无须额外机制。

**先例对齐**:`OPENCODE_AUTO_DECOMPOSE_FINE`(`src/switches.ts:15`,解析
`:233`)就是一个改提示词渲染的 `onOff` 开关,其 `{{#if fine}}` 条件段写在
`_partials.md:29` 的 `decompose-rule` 片段内 —— 本开关与它同构,连挂点文件都相同。

接线面(T-002 逐一覆盖,**五处**,见 §J-4):`SWITCH_ENV`、`Switches` 类型、
`SWITCH_DEFAULTS`、`parseSwitches`、`nonDefaultSwitches` 与 `formatSwitches`。

**渲染侧注入取「出口统一」而非「逐函数透传」**(T-002 实施决策):`fine` 的先例是
逐 render 函数透传 `opts.fine`,因为它只服务 `decompose-<phase>` 一族,透传面可控;
`question-rule` 被 23 份模板引用、横跨 `src/prompt.ts` 的 25 个渲染出口与
runner/loop/final/implement/knowledge/numbering 六个调用方,逐函数透传会在新增模板
时静默漏档。故在 `src/prompt.ts` 新增模块私有 `renderPrompt(name, ctx)` 作为本层
唯一渲染出口,统一注入 `ask: autoSwitches().ask`,全部 25 处 `renderTemplate(` 改调
它;ctx 显式给出的 `ask` 优先(镜像 `src/step.ts:41` 的 `opts.x ?? autoSwitches().x`
口径,供单测直驱两档)。代价是 `prompt.ts` 从纯数据组装层变为读开关——但
`check.ts` / `step.ts` / `runner.ts` 已是同一读法,不引入新机制。

## F. 持久化 schema(`.auto/resolves.json`,compact JSON,v:1)

```ts
export type ResolveSource = "driver" | "agent"

export type ResolveItem = {
  at: number
  task: string          // T-NNN;旁路会话为伪任务 PLAN/AUTO(pseudoTask,runner.ts:850)
  phase: string         // 阶段字母,未知为 ""
  round: number
  session?: string      // driver 源携带会话 id
  source: ResolveSource
  question: string      // driver 源 = 提问原文;agent 源 = 标记的 <原问题> 段
  option?: string       // agent 源解析所得 <所选方案>
  reason?: string       // agent 源解析所得 <理由>
  file?: string         // agent 源:标记所在 `路径:行号`
  malformed?: boolean   // agent 源:标记缺箭头/理由段
  matched?: boolean     // driver 源:已找到配对的 agent 标记
}

// decisions: 逐任务 AUTO-DECISION 计数(T-006 补,只存整数、不存行级明细)
export type ResolveDoc = { v: 1; items: ResolveItem[]; decisions?: Record<string, number> }
```

**为什么 AUTO-DECISION 仍要持久化一个计数**(T-006 决策,与"AUTO-DECISION 不进台账"
不矛盾):不落的是**行级明细**,落的是每个任务一个整数。§H-④ 要求把该计数折进高亮块
末行,而扫描发生在 runner 的会话收尾、展示发生在 loop 的任务收口,中间隔着多个会话
与可能的进程重启,内存传不过去;备选"把计数挂上 `Outcome` 一路传回 loop"要穿透三个
结局分支且进程重启即丢,否决。键数上限同样 **512**,FIFO 淘汰最早写入的任务。

公共 API(首参一律 `dir: string | undefined`,undefined = 空转,与 `src/stats.ts`
同构):

- `recordResolves(dir, items)` —— 追加落账;按 `source + task + 归一化 question`
  去重;总量上限 **512** 条 FIFO 淘汰(上限内不会触及:一轮 24 任务 × 每任务个位数)。
- `collectAgentResolves(dir, ctx)` —— 扫描本次会话的工作区变更文件,提取
  `AUTO-RESOLVE:` 与 `AUTO-DECISION:` 两类标记;前者落账,后者累加逐任务计数(与
  标记落账合并为同一次读-改-写)。返回 `{ resolves: number; decisions: number }`。
- `parseResolveLine(text)` —— §D 的纯函数,单测直驱。
- `recordDecisions(dir, task, n)` / `decisionsOf(dir, task)` —— 计数的累加与读回。
- `resolvesOf(dir, scope, id)` —— `scope ∈ task | phase | round`,按桶身份过滤读回。
- `resolveHighlight(items, opts)` —— 纯函数构造高亮报文行(§H),单测直驱。
- `sameIssue(a, b)` —— **从 `src/runner.ts:2889` 上收到本模块并导出**,runner 改
  import(收口先例:`src/log.ts` 的 formatter 收口)。既供 runner 判重复提问,也供
  台账去重与 driver↔agent 配对。

**健壮性**照抄 `src/stats.ts` 既有手法:原子写(`.tmp → rename` + 写队列串行化,
`src/stats.ts:296`)、逐字段宽容解析(坏 = 缺失不 throw,镜像 `resume.ts`
`parseProgress`)、所有写失败 `catch` 静默。

**扫描范围与成本**:取未提交变更文件,**经 `repoRoots` 逐仓库遍历**(嵌套子仓库是
本项目的常态,见 §J-2);跳过二进制与超过 2MB 的文件;逐行正则。与既有
`autoCorrectRefs`(`src/refcheck.ts:609`)同量级,同一挂点、同一次会话收尾内完成。
非 git 目录返回空,机制自然空转。

## G. 挂点表(行号以 `bf745fa94` 为准)

| # | 位置 | 动作 |
|---|---|---|
| H1 | `src/runner.ts:2614-2624` question.asked 自动答复分支 | 仅 `human === undefined` 且非 dryrun 时 push 进回合内 `resolves[]`;`:2620` 日志行改高亮式。**两档共用,`on` 档下这里就是主来源** |
| H2 | `src/runner.ts:208` `Watch` 类型 + `:2421` `snapshot()` | 增 `resolves?: ResolveEvent[]`,**7 个** `return snapshot` 出口统一带出(与 `usage` 完全同构,STATS_PLAN P3 先例;数目见 §J-1) |
| H3 | `src/runner.ts:2271` 附近 `attempt` `await watching` 之后 | 与 `statsSessionEnd` 同处 `recordResolves(opts.dir, …)`,补 task/phase/round/session |
| H4 | `src/runner.ts:106` `afterSession` 开头 | `collectAgentResolves(dir, …)`,**提到 `:112` 的 `opts.commit === false \|\| opts.dryrun` 提前 return 之前** —— 采集是审计,不该受提交开关影响。`on` 档下降级为兜底(AI 仍可自愿标注),不跳过:标了就收 |
| H5 | `src/loop.ts:413` / `:426` / `:437` 任务三态行 | 高亮块打在 `✓/⏸` 结论行(`taskEndLines`,`:1006`)**之前**(置顶) |
| H6 | `src/loop.ts:687` 阶段收口(`phaseCloseLines`,`:1028`)/ `:369`+`:719` 轮次完成(`roundCompleteLines`,`:1048`) | 汇总计数行,同样置顶于 `■` 行之前 |
| H7 | `src/prompt.ts:184` `renderWrapup` + `templates/prompts/wrapup.md` | 注入 driver 观测到的代答清单,要求 report.md 写「自动代答问题」节 |

规则文本挂点:`templates/prompts/_partials.md:14-21` 的 `question-rule` 片段,被
**23 份**模板经 `{{> question-rule}}` 引用(清单见 §J-3),改这一处即全量生效 ——
这是选择改片段而非改各模板的理由。**片段名保持 `question-rule` 不变**(目标目录
`.opencode/auto/prompts/_partials.md` 的覆盖按节名匹配,改名会让存量覆盖在渲染时
报错)。`_partials.md` 不在 `PROTOCOL_MARKERS`(`src/template.ts:98`)内;**本次不新增**
`question-rule` 的协议标记 —— 协议标记的语义是"driver 解析会话产出的依据",而
AUTO-RESOLVE 的解析对象是散落在文档与代码里的标记行,不是模板产出物。

同步改 `src/runner.ts:69-98` 的自动答复文案(`AUTO_ANSWER` 常量已改为 `autoAnswer(ask)` 函数):点明"**这是一个被代答的
提问**";`off` 档追加"请以 `AUTO-RESOLVE:` 标注,不要记成 `AUTO-DECISION`";`on`
档不要求标注(driver 已在事件侧完整落账),只告知自主决策继续。调用点 `src/runner.ts:2618` 一次取值,同时供 reply 与日志行。`src/agents-block.ts:33` 的 `MAINT_RULE` 第 4
条提到 `AUTO-DECISION`,顺带补一句两类标记的区分指引(英文,与该块其余文案同语种)。

## H. 报文(草案文案)

**① 会话内即时**(H1,替换 `src/runner.ts:2620` 现有 `→ 自动答复: …`):

```
⚑ 自动代答(AUTO-RESOLVE)第 2 个:是否把 prompt.ts 的第三份 formatTokens 一并收口?
  → 已代答,要求会话以 AUTO-RESOLVE 标注决策
```

**② 任务结束置顶块**(H5,`items` 非空才打):

```
⚑ 本任务自动代答了 3 个本应由你确认的问题,请重点确认:
  1. 是否把 prompt.ts 的第三份 formatTokens 一并收口 → 顺带收口(同层依赖,不引入反向 import)
     src/prompt.ts:501
  2. 折旧入账是否同样过 MAX_TICK 钳制 → 同样钳制(宁少不多)
     src/stats.ts:84
  3. 验收口径是否包含并发场景  ⚠ 会话未按要求写出 AUTO-RESOLVE 标记
  完整记录见 docs/T-001/report.md 的「自动代答问题」节
✓ T-001 完成: 用时 24 分 31 秒(AI 18 分 12 秒),会话 7 次
  tokens 入 1.2k / 出 340 / …
```

超过 **8 条**时只列前 8 条,末行 `…另有 N 条,全部见 docs/T-NNN/report.md`。

**③ 阶段收口 / 轮次完成**(H6):

```
⚑ 阶段 m 共自动代答 7 个待确认问题(其中 1 个未按要求标注),逐条见各任务报告
■ 阶段 m 迁移实现 收口: 总用时 52 分…
```

**④ AUTO-DECISION 折叠为计数**(H4 回计数),永不与 AUTO-RESOLVE 争版面:

- 本任务有 AUTO-RESOLVE 时,计数折进高亮块末行:
  `  另记录 AUTO-DECISION 5 条(已折叠,见任务报告)`;
- 没有 AUTO-RESOLVE 时,只 `vlog` 一行 `ℹ T-001 记录 AUTO-DECISION 5 条`,不上终端
  —— 常见情形下零新增终端行;
- 阶段/轮次汇总**完全不展示** AUTO-DECISION:跨任务累加出的"127 条决策"对任何人都
  不构成可行动信息。

计数本身仍有用:它是扫描确实跑过的证据,也是标注门槛是否失控的体感指标(每任务
稳定在两位数 = 门槛没被遵守,该收紧 §C 的规则文案)。

措辞体系与既有六处结论行(`docs/stats-timing-design.md` §F)一致:`✓/⏸/■/⏳/↻/◉`
各有归属,高亮块用**新前缀 `⚑`** 且只占置顶位,不侵占既有符号语义。

## I. 收尾闭环(H7)

driver 把本任务观测到的代答清单(优先列**未找到配对 agent 标记**的)注入收尾提示
词,`templates/prompts/wrapup.md` 新增条件段:

> 本任务执行期间 driver 自动代答了以下本应询问用户的问题:…
> 请在 `docs/{{taskId}}/report.md` 中单列「自动代答问题」一节,逐条写
> `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`;上面列出的每一条都必须出现,
> 你自主识别到的其他代答决策一并列入。

`renderWrapup` 是同步纯函数(`src/prompt.ts` 只做数据组装,见 AGENTS.md),所以清单
由两处调用点(`runTask` 的收尾与 `verifyTask` 修复轮后的收尾)先经模块私有
`wrapupResolves(dir, task.id)`(`resolvesOf` + `catch` 吞空)读出、再作为
`opts.resolves` 传入。

**已实施(T-007)**:

- 条件段是收尾提示词的**第 4 项**(前三项是文档更新 / report.md / 验收归属),受同一
  句"以上全部完成前不要结束会话"统辖;`{{#if resolveList}}` 整段消失时逐字节等价改造
  前的形态。
- 清单**只列 driver 源**:agent 源是会话自己已经标注过的,再报一遍徒增噪声;**未配对
  `matched` 的排在前**(§I 的"优先列未找到配对的"),它们正是最可能在报告里缺席的。
- **不截断条数、不截断正文**:提示词要求"上面每一条都必须出现",丢条目会与该要求
  自相矛盾;只把提问原文的换行与连续空白压成单行(多行提问会把清单结构冲散),空
  问题不占位。
- 预拼接在 `src/prompt.ts` 私有 `resolveList()`(模板语法刻意不做循环,清单类数据由
  调用方拼成字符串,见 `src/template.ts` 头注释),不复用 `resolveHighlight`/
  `compactText`:终端高亮要 80 字截断,提示词要全文,两者口径相反。

这条闭环让持久记录不依赖 AI 自觉:driver 观测到的那部分被强制写进 git。

## J. 现状勘测结果(T-001 对计划引用的核实)

计划所引位置**逐一核对通过**,以下四处需修正或补充,后续任务以本节为准。

1. **`watch()` 的 return 出口是 7 个,不是 8 个**(计划 §5 H2 写"8 个")。逐一清点
   `return snapshot(...)`:`src/runner.ts` 的 2530 / 2581 / 2610 / 2672 / 2727 /
   2752 / 2767,共 7 个(`handleIdleTest` 内的 `return { type: … }` 是另一类型,不
   经 snapshot)。STATS_PLAN 犯过同一处错并已在 `docs/stats-timing-design.md` §G
   记录;本计划沿用了那个旧数字。**不硬凑数字,逐一清点为准**。
2. **变更文件扫描必须走 `repoRoots`,不能用单次 `git -C dir status`**(计划 §3 写
   `git -C dir status --porcelain` + `git diff --name-only HEAD`)。本项目的目标
   目录常含嵌套 git 子仓库,既有代码一律逐仓库遍历:`gitChangedFiles`
   (`src/loop.ts:910`,module-private)经 `repoRoots(directory)` 分发到
   `gitStatusFiles`(`:919`,`--porcelain -z --no-renames -uall`,并跳过折叠输出的
   嵌套仓库目录以免重复);`autoCorrectRefs` 侧同理(`src/refcheck.ts:461` 的
   `git diff HEAD --name-only -z` 按 root 执行)。T-004 应把 `gitChangedFiles`
   导出复用,或镜像其嵌套遍历,**不要新写一份扁平扫描**。
3. **"23 份模板引用 `question-rule`" 属实,计划列出的清单与实际完全一致**:
   `decompose.md` 与 `decompose-a/d/k/m/t/v.md`(七份)、`whole` `subtask` `fix`
   `review` `review-fix` `verify-judge` `verify-script-gen` `phase-plan`
   `phase-handover` `knowledge` `prior-knowledge` `understand` `implement-plan`
   `infer-source` `final-task` `number-recovery`。`_partials.md` 自身定义该节(`:14`)
   不计入。
4. **T-002 的开关接线面是四处,计划只列了三处**:除 `SWITCH_ENV`
   (`src/switches.ts:12`)、`SWITCH_DEFAULTS`、`parseSwitches`(`:233` 一带)、
   `nonDefaultSwitches`(`:245`)外,还有 **`formatSwitches`(`:267`)** —— 全量开关
   描述的 verbose 日志同样逐项枚举,漏改会让 `ask` 在全量日志里缺席。
5. 伪任务先例的准确出处是 `pseudoTask()`(`src/runner.ts:850`)与其调用
   `runner.ts:847`(`AUTO`),`PLAN` 见 `src/loop.ts:539`/`:630`、
   `src/numbering.ts:115`、`src/final.ts:262`、`src/implement.ts:46`、
   `src/knowledge.ts:63`/`:183`;计划引的 `resume.ts:89` 只是 `Progress.task` 字段
   声明,不是伪任务构造点。

核对通过、无需修正的位置(行号为 T-003 改造**之前**的 `bf745fa94`):`runner.ts:70`
(AUTO_ANSWER)、`:89`(afterSession,`:94` 为 commit/dryrun 提前 return)、`:2418`(`autoAnswered` 局部量)、`:2593`
(重复提问判定)、`:2597-2606`(自动答复分支)、`:2871`(`sameIssue`,确为归一化后
子串包含)、`:679`/`:1424`(renderWrapup 调用点);`loop.ts:413`/`:426`/`:437`、
`:687`、`:369`/`:719`、`:1006`/`:1028`/`:1048`;`prompt.ts:184`、`:501`(第三份私有
`formatTokens`,与 §H 示例文案所指一致);`switches.ts:15`/`:233`;
`agents-block.ts:33`;`template.ts:98`;`log.ts:11-34`;`behavior.md:205-208`;
`test/loop-conclusion.test.ts` 存在(T-006 扩展点)。

## K. 风险与边界

1. **漏标是缺省 `off` 档的根本局限,`on` 档基本消解**。`off` 档的 `question-rule`
   劝阻 AI 调用 question 工具,driver 的观测面只覆盖"AI 仍然调了工具、被回落自动
   答复"的少数情形,绝大多数 AUTO-RESOLVE 靠自觉标注,漏标不可检测;缓解是 wrapup
   强制自查 + 判据写死 + 拿不准时标 AUTO-RESOLVE。"未标注"计数**只对 driver 观测到
   的那部分有意义**,不能解读为全量漏标率。**需要可审计的代答记录时应当用 `on`
   档** —— 这条建议必须同时写进 README,否则用户会以为缺省档的计数是完备的。
2. **`on` 档新增两项成本**。① 每个问题一次会话往返(token 与时长);② 提问变多后
   `src/runner.ts:2610` 的重复提问判定更易触发 —— `sameIssue` 用的是归一化后**子串
   包含**(`x.includes(y) || y.includes(x)`,`:2893`),短问题被长问题包含即判为同一
   问题,命中即 abort 会话并阻塞退出 2。缓解在于 `autoAnswered` 是 `watch()` 内的
   局部量(`:2435`),作用域仅当前回合而非整个任务,误判半径有限;但 `on` 档冒烟必须
   专门验这条,若出现误阻塞则**收紧 `sameIssue`(改为全等 + 长度比阈值)而非放弃
   重复检测** —— 重复提问停机是防 AI 空转的安全网,不能拆。
3. **误标风险(反向)**:AI 可能为求稳把纯工程取舍也标成 AUTO-RESOLVE,高亮块噪声化
   后用户就不看了。缓解:判据给正反例、报文截断到 8 条、阶段/轮次只给计数。若冒烟
   发现噪声化,**收紧判据文案而非加开关**。
4. **两档文案互相污染**:`off` 档教「少问、多标」,`on` 档教「该问就问、不必标」,
   同处一个片段内。条件段若写得不干净(比如把标注要求写在 `{{#if}}` 外),`on` 档会
   渲染出「不要问但要标」的自相矛盾文本。T-003 后按 §L 的逐字节比对与 `on` 档无
   `AUTO-DECISION` 字样两条断言把关,并人工复读两档渲染结果各一遍。
5. **档位选择是人的判断,程序不代劳**:计划是否完备只有写计划的人知道,不做"自动
   识别计划完备度再切档"。缺省保持 `off`(现状语义、零行为变化),`on` 是使用者对
   自己计划质量的显式声明。
6. 台账在 `.auto/` 内不进 git(`ensureGitignore` 保证,`src/loop.ts`);换机或清
   `.auto/` 后计数从当下重开(与 stats 同一性质:本机运行足迹,非事实来源)。持久
   轨迹在标记行与 report.md 节,二者都进 git。
7. **同目录并发两个 run 不支持**(后写覆盖),与 `stats.json` 同一已接受边界。
8. **人工回退重跑同一任务与中断续跑不可区分** → 人工规程:重跑前
   `rm .auto/resolves.json`(与 stats 同款规程)。
9. 扫描按会话触发、只看未提交变更:若某会话未产生任何文件改动,该会话内的 agent
   标记不会被采集 —— 但没有文件改动就没有标记可采,不构成漏洞。
10. **`--commit false` 下 AUTO-DECISION 计数偏大**(T-006 记):累加口径成立的前提是
    "每次扫描只看得见本次会话的未提交改动"(afterSession 扫描完即统一提交)。不提交
    时改动跨会话堆积,同一批标记被反复看见 —— AUTO-RESOLVE 侧由去重键吸收,计数侧
    因不存行级明细吸收不了。已接受边界:该计数是"标注门槛是否失控"的体感指标而非
    事实来源,且 `--commit false` 本身就已破坏该前提(整个 H4 扫描都建立其上)。
11. **核心不变量零破坏**:退出码不变(`on` 档的重复提问阻塞走既有退出码 2 通道);
    driver 独占写状态文件不变(`.auto/resolves.json` 是运行时状态,不进 protect
    名单);统一提交不变;独立判定会话不 fork 不变;新增的 `OPENCODE_AUTO_ASK` 只读
    环境、不落盘,符合"实验语义 = 本次运行"。

## L. 实施步骤与测试(勾选表)

| 步 | 内容 | 落点 | 状态 |
|---|---|---|---|
| T-001 | 本设计文档 + 现状勘测(§J) | 无代码改动 | ✅ 本任务 |
| T-002 | `OPENCODE_AUTO_ASK` 开关五处接线 + 渲染出口统一注入 `ask`,**不改文案** | `switches.ts` / `prompt.ts` | ✅ 563 pass |
| T-003 | `question-rule` 两档重写 + `autoAnswer` 改函数 + `MAINT_RULE` 补句 + `whole`/`subtask` 条款条件化 | `_partials.md` / `runner.ts:69` / `agents-block.ts:33` / 两份模板 | ✅ 567 pass |
| T-004 | `src/resolve.ts` 全量 + `sameIssue` 上收 + `changedFiles` 上收 git.ts + `test/resolve.test.ts` | 新模块 | ✅ 593 pass |
| T-005 | driver 采集接线 H1..H4 + `test/runner.test.ts` 七例 | `runner.ts` | ✅ 600 pass |
| T-006 | 报文输出 H5/H6(三处置顶块构造函数 + 五处调用点)+ 逐任务 AUTO-DECISION 计数 | `loop.ts` / `resolve.ts` | ✅ 612 pass |
| T-007 | 收尾闭环 H7(`renderWrapup` 增 `resolves` 入参 + `wrapup.md` 条件段 + 两处调用点读台账) | `prompt.ts` / `wrapup.md` / `runner.ts` | ✅ 616 pass |
| T-008 | 文档同步(本文回填、structure.md、behavior.md、README、AGENTS.md 导航) | 文档 | ⬜ |

**单测**(`test/resolve.test.ts`,mkdtemp 风格照 `test/stats.test.ts`):
`parseResolveLine` 六态(完整三段 / `→` 与 `=>` 变体 / 中文括号 / 无箭头 malformed
但计数 / 无理由段 / 行内前缀);台账往返、坏文件宽容、去重、512 上限 FIFO、并发写无
`.tmp` 残留;`collectAgentResolves`(非 git 目录空转、二进制与超大文件跳过、
AUTO-DECISION 只计数不落账、driver↔agent 经 `sameIssue` 配对置 `matched`、**嵌套子
仓库变更被采集**);`resolveHighlight`(空列表返回空、超 8 条截断、malformed 带 ⚠、
未标注项文案);`resolvesOf` 三 scope 过滤与桶身份守卫。

**runner 测**(`test/runner.test.ts`):`Watch.resolves` = 自动答复次数;人工答复
(`--wait-answer` 命中)不计;dryrun 不计;blocked 出口 resolves 不丢;`AUTO_ANSWER`
两档文案分别命中。

**开关测**(`test/switches.test.ts`):`ask` 缺省 `off`、`on`/`off` 解析、空串视同
未设、非法值 throw 含变量名与值域、`nonDefaultSwitches` 与 `formatSwitches` 在 `on`
时均列出。

**prompt 测**(`test/prompt.test.ts`):23 份模板在两档下全部渲染通过;**`off` 档
渲染结果与改造前逐字节比对**(T-002 只接线不改文案这一承诺的证据);`on` 档不含
`AUTO-DECISION` 字样;`wrapup` 在有/无 resolves 两态的条件段。

**手工冒烟**(有凭证环境,`auto/` 集成分支):跑一个会真提问的任务 → 看 ⚑ 即时行与
任务结束置顶块;人工在 `--wait-answer` 内答复 → 确认不计入;中途 `kill -9` 后重跑 →
台账续接、条目不丢不重;`rm .auto/resolves.json` → 照常跑;**`on` 档专项验 §K-2 的
重复提问误阻塞**。

## M. 决策记录(T-003 规则文本改造)

- **AUTO-RESOLVE: 是否把 `whole.md` / `subtask.md` 的 AUTO-DECISION 条款一并按档条件
  化 -> 一并条件化(计划 §4 的文件清单只列 `_partials.md`、`runner.ts`、
  `agents-block.ts`,本项超出其字面范围;但两份模板的"若必须修改按 AUTO-DECISION
  记入相关文档"是无条件文本,不改则 `on` 档一边说"无须留痕"一边仍在教会话留痕,正是
  §K-4 要防的两档污染)**。改法:`(若必须修改,{{^ask}}按 AUTO-DECISION 标注并{{/if}}
  记入相关文档)` —— `off` 档逐字保留现状口径,`on` 档只剩"记入相关文档"。
- **AUTO-DECISION: 归属判据中的"验收口径"改写为"「什么算做完」的判定标准"**
  (`templates/prompts/_partials.md`)。`config.verify === false` 时提示词不得出现
  "验收/verify" 字样(`src/prompt.ts:14` 注释的既定口径),`test/prompt.test.ts` 有三
  处 `not.toContain("验收")` 守卫该不变量;判据列表被 23 份模板无条件引用,内嵌
  `{{#if verify}}` 会把一个与验收开关无关的判据切成两半,换词更干净且语义不减。
- **AUTO-DECISION: 两档条件段的开闭标签与内容同行相接**(`…{{/if}}{{#if ask}}…`)。
  `src/template.ts:277` 的 standalone 判定使独占一行的块标签整行连同换行被吞掉,但两
  个分支之间残留的换行会落在分支外**无条件输出**,让片段末尾多出空行、与调用处的
  "3." 行粘连。该约束已写进 `_partials.md` 抬头供后续维护者参照。
- **AUTO-DECISION: `on` 档"不含 AUTO-DECISION 字样"的断言范围排除 `knowledge.md` /
  `prior-knowledge.md` / `phase-handover.md`**。这三份要求会话汇总既有文档里
  AUTO-DECISION 标记的决策,读的是 git 里恒存的历史标记,与"本次运行是否留痕"正交,
  两档下都应保留。
- **AUTO-RESOLVE: `autoAnswer` 两档文案是否都点明"这是一个被代答的提问" -> 都点明**
  (计划 §4 只要求 `off` 档追加标注指引)。让会话认清自己正在替用户做主是该文案的
  首要作用,与是否要求标注无关;`on` 档省掉这句会使自动答复读起来像一次普通的
  "你自己看着办"。
- **AUTO-DECISION: `AUTO_ANSWER` 常量改为 `autoAnswer(ask)` 函数而非两个常量**
  (`src/runner.ts:74`)。两档共享的开头段只写一次,调用点
  (`src/runner.ts:2618`)一次取值同时供 reply 与日志行,避免两处各取一次导致
  日志与实际答复不一致。

## N. 决策记录(T-004 `src/resolve.ts`)

- **AUTO-RESOLVE: 变更文件扫描如何复用 `gitChangedFiles` 的嵌套遍历 -> 把
  `gitChangedFiles`/`gitStatusFiles` 从 `src/loop.ts` 上收进 `src/git.ts` 并以
  `changedFiles(dir)` 导出(§F 只写"导出复用或镜像遍历",两条路都有硬伤;本项改动了
  T-004 的字面文件范围,属本应问用户的范围取舍)**。从 `loop.ts` 导出会造成
  loop → runner → resolve → loop 的循环依赖(resolve 由 runner 与 loop 两侧消费);
  在 resolve.ts 镜像一份则留下两份必须同步演进的仓库遍历。`git.ts` 是叶子模块(只
  依赖 log.ts)且已持有 `repoRoots` 与同款 porcelain 解析,两个消费方各自单向引用,
  与 `log.ts` 的 formatter 收口同一手法。`loop.ts` 侧只剩一行 import 改动。
- **AUTO-RESOLVE: 语法说明行(`AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`)是否
  采集 -> 不采集(问题段整体为 `<…>` 占位即跳过)**。本设计文档、`wrapup.md`(T-007)
  与 `src/resolve.ts` 自身都写有格式样例,不跳过则任何改动这些文件的任务都会采到一
  条假代答,恰是 §K-3 要防的噪声化。判据取"问题段整体是尖括号占位",不做更宽的模式
  匹配,避免误伤真问题里的尖括号。
- **AUTO-DECISION: 报文只展示 driver↔agent 合并后的结果**(`resolveHighlight` 丢弃
  `matched` 的 driver 项)。同一次代答两源各留一条台账(来源不同、去重键不同,审计
  两侧都要留),但展示时 agent 项信息更全(所选方案/理由/标记位置),driver 项配对后
  再列一遍即重复占版面;未配对的 driver 项保留并以 ⚠ 点名"会话未按要求标注"——§H 的
  报文草案正是这个形态。
- **AUTO-DECISION: 缺理由段与缺箭头同样置 `malformed`**(§F schema 注释的口径"缺箭头
  /理由段")。两者在报文里共用 `⚠ 格式不规范`,差别只在缺箭头时整行落进问题段。
- **AUTO-DECISION: `collectAgentResolves` 的返回计数是"本次扫描看见的标记条数",不是
  "台账新增条数"**。它回答的是"扫描确实跑过、看见了多少标记"(§H-④ 计数的用途:
  扫描跑过的证据与标注门槛的体感指标),中断续跑重扫同一批文件时计数应稳定,而台账
  新增数会因去重归零。
- **AUTO-DECISION: 读-改-写整体串行化**(`update` 的 per-dir 写队列),而非 stats.ts
  的"内存单写点 + 写队列"。本模块无常驻内存文档(条目按会话零散追加,无需 30s 心跳),
  每次落账都要先读回现有条目做去重与 `matched` 回配,故串行化的单位是整个读-改-写。
- **AUTO-DECISION: 报文单条文本压成单行并截断到 80 字**。driver 源的 `question` 是提
  问原文,可能多行、可能很长,整段贴进结论行会把高亮块淹掉;完整原文在台账与任务报告
  里,截断只影响终端一瞥。

## O. 决策记录(T-005 driver 侧采集接线)

- **AUTO-RESOLVE: 权限提问在 `--wait-answer` 超时后的回落是否计入代答 -> 计入
  (§B 只写"仅回落自动答复才计入",未就权限/非权限分流,归属判据下这是本应问用户
  的取舍)**。权限提问回落同样是 driver 替用户拍板(`ask-*` 三档的超时回落各有语义,
  但"人没答、driver 定了"这件事一致);漏掉它会让最该被看见的一类代答缺席。代价是
  权限类条目混进台账,可由 `question` 原文自然区分。
- **AUTO-RESOLVE: AUTO-DECISION 的任务级计数(§H-④ 折进高亮块末行的那个数)是否在
  本任务实现 -> 不实现,留给 T-006(超出 H1..H4 的字面范围)**。H4 每会话回一次
  "本次扫描看见的标记条数",任务级聚合口径由报文侧决定: `--commit true`(缺省)下
  每会话只扫自己的变更,逐会话求和即对;`--commit false` 下后一次扫描会重看前一次的
  标记,求和即重复计数。这个取舍属 T-006 的报文决策,本任务只把每次扫描的计数落进
  `vlog` 明细日志(§H-④ 的"扫描确实跑过的证据"),不造跨会话累加器。
- **AUTO-DECISION: `compact` 上收为导出的 `compactText`**(`src/resolve.ts`)。会话内
  即时行(§H-①)与高亮块展示同一份提问文本,单行化与 80 字截断口径不该各写一份。
- **AUTO-DECISION: `afterSession` 与 `autoAnswer` 导出供单测**(与 `gatedAutoCorrectRefs`
  /`askHuman` 同款"内部接线的可测出口")。H4 的"采集在 commit 开关的提前 return 之前"
  与两档答复文案都无其他可达路径,不导出则这两条只能靠人工复读。
- **AUTO-DECISION: H3 落账抽成模块私有 `recordDriverResolves`,无观测时零 IO**。回合
  无提问是常态,此时既不读轮号也不碰台账文件;轮号只在确有代答时现场取。
- **AUTO-DECISION: 轮号取 `currentRound(dir)` 现场推导,不从 stats 的内存 handle 读**。
  `currentRound` 是既有推导式真源(一次 readdir),stats 未导出轮号读口;为此新开读口
  会让两个模块共享同一份缓存状态,不值当。
- **AUTO-DECISION: 会话内即时行的第二行按档取文案**(`off` = "要求会话以 AUTO-RESOLVE
  标注决策",`on` = "driver 已完整记录,本档不要求会话另行标注"),与 `autoAnswer`
  同一次 `autoSwitches().ask` 取值——日志与实际答复永不打架(§M 已就 `autoAnswer`
  立过同样的口径)。原 `→ 自动答复: <长文案>` 降为 `vlog`: 答复全文每次都一样,占着
  终端两三行却不携带本次信息;dryrun 预检不计代答,仍走原行。
