# 测试交接前置化设计(判据解耦 + 一次交接两次提交)

状态:**已实施 2026-09-15**(`auto-core` 分支;P1..P5 落地,P6 灰度开关经评估未做,理由见 §F)。
**2026-09-15 修订(§H):测试时机由「真并发」改为「先交接、后运行」,重测守卫退役。**
**2026-09-15 修订(§I):交接途中被打断的恢复——按文件状态 × 提交状态定位断点续跑;PLAN.md 阻塞记事退役。**
**2026-09-16 修订(§J):交接收场即丢弃定版会话为重启复用/重试分叉锚点——记录不再指回交接之前的会话。**
D2/D3/D5/D6 的原文保留在下,作为改造前的事实基线;现行行为以 §H 为准。上游登记:`plans/0022-session-recovery-fidelity-design.md` §3.5 ①「交接触发解耦」。
现场证据:`docs/session-interruption-field-audit-20260915.md`(仓库根,未纳入版本控制)。

## A. 事实基线(改造前)

`--handover-test` 的交接判据是双条件,挂在**测试执行之后**:

```ts
const run = await executeTest(test, opts)
const failed = run.code !== 0
if (failed && test.handover && used >= test.limit) { …要求写交接文档… }
```

必须「测试失败 **且** 上下文已达 `contextLimit`」才交接。现场审计 §5 实证了这个判据的悖论:

| 目录 | 配置上限 | 交接触发时的实测上下文 | 该 run 的交接次数 |
|---|---|---|---|
| kernel-spi-nor | 80k | 90.7k – 264.3k | 9 |
| kernel-dm | 64k | 72.7k – 251.8k | 27 |

**普遍冲到上限的 2–4 倍**:测试连绿时会话无限增长,只有在「恰好测试失败」的那次才被动交接。
上下文越大,会话意外死亡(R1 复用失效转 R5 冷启动)时的损失面越大——恢复保真风险与交接
触发条件直接耦合。

## B. 决策表

| # | 决策 | 取值 | 理由 |
|---|---|---|---|
| D1 | 判据与时机 | **仅在 AI 发起测试(`tmp/test.sh` 出现)的那一刻判定并下发 prompt**;判据解耦为单条件 `used ≥ contextLimit`。这一刻取不到实时值时沿用起跑值 `startUsed` | 发起测试通常意味着相关工作已做完、正要验证——那是唯一天然干净的分割点;越过这一刻上下文就开始变化,不再好切 |
| D2 | 测试与收尾的关系 | ~~**真并发**~~(**已于 §H 改为顺序**;并发保留在 `OPENCODE_AUTO_HANDOVER_CONCURRENT=on` 之后):不 await 测试即 steer 收尾+交接指令。提示词**不**要求「别改源码」 | 串行会把会话晾到 provider 缓存失效;AI 发起测试时本就知道被测内容不该动,无需代劳,状态由 D3 的定版提交固定、由重测守卫兜底 |
| D3 | 提交策略 | **一次交接、两次提交**:下发脚本时提交 #1 定版,交接收口时提交 #2 确认。~~两次提交之间源码与脚本必须无修改~~(**§H 改**:顺序态的不变量是「被测的就是提交 #2 的那一份树」) | 每次交接都有可回退的留档;定版把「被测的是哪一份代码」变成事实而非约定 |
| D4 | 交接文档归档 | 同目录累积 `testhandoff-<n>.md`,新会话读最新一份 | 交接链可回溯;当前份名恒定,会话的写目标不变 |
| D5 | 重测触发面 | 只看 `test/**` 与**已跟踪**的非文档源文件;`docs/**`、`PLAN.md`/`CURRENT.md` 与未跟踪新增不计 | 会话收尾必然落盘文档,若一律触发就等于每次交接都多跑一遍测试;未跟踪新增参与编译的场景会漏判,是明确取舍 |
| D6 | ~~stash 处置~~(**§H 整体退役**) | `stash -u` → 对定版快照重跑 → `stash pop` → 提交 #2;pop 冲突即阻塞(退出码 2),stash 条目保留 | 收尾成果一份不丢;冲突不吞 |

## C. 交接时序(改造前;现行时序见 §H)

```
会话 idle,tmp/test.sh 在盘
  │
  ├─ testHandoverDue(test, used) == false ──► executeTest → steer test-result → 同会话继续
  │
  └─ true(上下文达上限)
       ① afterSession 提交 #1   stage `<单元> handoff-<n>-pin`   subject `<单元提交标题> 测试交接 #n 定版`
       ② test.running = executeTest(...)        ← 不 await
       ③ steer test-wrapup(落盘剩余工作 + 写交接文档 + 结束会话)
       …会话收尾中,测试并发跑…
       ④ attempt 在 watch 返回后 await test.running      ← 测试进程不跨会话悬挂
       ⑤ guardRetest: trackedSourceChanges 非空 → stashAll → runTestScript(同一脚本) → stashPopAll
       ⑥ rename testhandoff.md → testhandoff-<n>.md
       ⑦ afterSession 提交 #2   stage `<单元> handoff-<n>`      subject `T-NNN 测试交接 #n`
       ⑧ 新会话:任务提示词 + test-continue(先读归档交接文档,再判读那次测试的结果)
```

不变量:**提交 #1 与提交 #2 之间,源码与 `test/` 脚本逐字节相同**(⑤ 保证)。
——该不变量已随 ⑤ 的退役一并作废,替代物见 §H。

## D. 文案硬约束(D2 的落实)

`test-wrapup.md` **不得出现「上下文 / 超限 / 上限 / tokens」**。现场实证:会话一旦知道自己
上下文吃紧,就会自行判定余量不足而省略本应完成的落盘工作——而这次交接恰恰要求它先把
不依赖测试结果的剩余工作做完。文案只陈述「需要交接并切换新会话」这一事实,并明写
「不要因为要交接就省略,这些工作不做完,新会话要从头重做」。同理不写「不要改源码」:
说了反而提示它这是个可以自由裁量的边界。`test/prompt-exec.test.ts` 以反向断言锁住这条约束。

`subtask.md`/`whole.md`/`fix.md` 的协议段同样改口径——把交接描述成「既定的交接节奏,
不是出了问题」,不提失败与上限。

## E. 与既有机制的关系

- **与 ondemand 上下文交接正交**:`handoff.md` / `handoffSteer` / `handoverDue` 阈值仍是
  `2×cap`,两套判据并列不合并(`switches.ts` 的 `OPENCODE_AUTO_STEER` 只管前者)。
- **与提交边界体系相容**:`unitViolations` 只校验区间内每个提交带 `Auto-Stage` trailer,
  不限提交个数,单元内多两笔 driver 提交合法。`rollbackUnit` 回滚到单元基线时一并丢弃
  交接提交,语义正确(整个单元重做)。
- **消解一处已知局限**:`plans/0021-commit-boundary-design.md` 登记的「交接续跑期间工作区脏、clean
  门禁豁免」在测试交接这条路径上不再成立——交接点工作区已被两次提交清空。
- **与交接边界写核共存**:测试交接文档的有效性判据仍是「非空」(不要求 `状态: 继续|完成`
  行)——判定发生在测试结果尚未判读时,会话无从判定「完成」,加了也只能恒为「继续」。
  严格恢复下无效一次即回滚重做的通道原样保留。
- **与 stable-refs R2 的关系**:`testhandoff.md` 是协议性临时文件(driver 一直在删它),
  重命名为 `testhandoff-<n>.md` 后才是永久路径;归档份在执行范围完成时随整链清除,
  历史交接内容由 git 提交记录承载。

## F. 未做的与已知取舍

- **未做灰度开关**(原计划 P6 的 `OPENCODE_AUTO_HANDOVER_EARLY`):旧双条件与新流程的
  控制流形状不同(旧的「先执行后判定」与新的「先判定、定版、并发」无法共用一条路径),
  加开关等于在最精细的 `handleIdleTest` 里长期养一条平行分支——正是 `--commit false`
  (D7)退役时判定为有害的形态。回退口子是 `--handover-test` 本身(关掉即完全回到
  改造前行为),已足够。
- **未跟踪新增不触发重测**(D5):会话收尾新建的源文件若参与编译,重测守卫看不见。
  换来的是「收尾落盘文档/产物不会白白多跑一遍测试」。
- ~~**stash `-u` 与构建产物**~~(随重测守卫退役,§H):首次测试若产出未 gitignore 的构建产物,它们会被卷进 stash,
  重跑再产一遍可能让 `pop` 冲突 → 按 D6 阻塞、stash 条目保留交人工。目标项目应把构建
  产物纳入 `.gitignore`。
- ~~**重跑脚本靠 `tmp/` 被忽略才活下来**~~(重跑已取消;但顺序态把脚本挂在
  `TestRun.pending` 上跨会话边界存活,内联形态的 `tmp/test.<n>.sh` 仍依赖 `tmp/` 被忽略,
  这条依赖原样成立,§H):`git stash -u` 收走未跟踪文件但不动 **被忽略**
  的文件,而 `tmp/` 由 `ensureGitignore` 登记为忽略——内联形态的 `tmp/test.<n>.sh` 与
  历次 `.out` 因此在 stash 期间原样留在盘上,重跑拿得到脚本(`test/` 形态本就已提交)。
  若将来改动 driver 工作目录的忽略策略,这条依赖必须一并复核。
- **提交 #1 是 mid-session 提交**:安全性依赖「`handleIdleTest` 由 idle 事件驱动,此刻
  会话没有半写文件」。这条前提若变(例如将来在非 idle 时机检测测试请求),定版提交必须
  跟着换位置。

## G. 步骤勾选表

- [x] P1 判据解耦与取值回落 —— `TestRun.startUsed`、`attempt` 按 `reuse` 分档取样、
      导出纯判据 `testHandoverDue`(`src/runner.ts`)
- [x] P2 测试请求时刻的三件事 —— 提交 #1 / 并发起测试 / 下发收尾(`handleIdleTest`),
      并发句柄挂 `TestRun.running`、由 `attempt` 在 `watch` 返回后统一收口
- [x] P3 重测守卫 —— `git.ts` 的 `trackedSourceChanges` / `stashAll` / `stashPopAll`,
      `runner.ts` 的 `guardRetest` + `runTestScript` 执行内核
- [x] P4 收尾提示词 —— 新模板 `templates/prompts/test-wrapup.md`(取代 `test-handover.md`)、
      `renderTestWrapup`、`test-continue.md` 与三份任务模板协议段改口径
- [x] P5 交接文档归档累积 —— `docpaths.ts` 的 `archivedTestHandoff` / `latestHandoffSeq`、
      `runExecSession` 两态恢复播种与归档+提交 #2、`handoffChainExists` / `removeHandoffChain`
      与各处 glob 放宽到 `testhandoff*.md`
- [ ] ~~P6 灰度开关~~ —— 经评估不做,见 §F
- [x] P7 测试 —— `prompt.test.ts` 反向断言、`runner.test.ts` 判据四档、`git.test.ts` 守卫
      五例(含嵌套仓库)、`docpaths.test.ts` 归档命名与编号接续
- [x] P8 文档 —— 本文档、`behavior.md`、`structure.md`、`plans/0022-session-recovery-fidelity-design.md`
      §3.5 ①、`plans/0021-commit-boundary-design.md`、`packages/auto/README.md`、CLI 帮助、导航与根 AGENTS.md
- [ ] 真实冒烟(三包全量,在 `auto/` 集成 worktree;需有凭证的环境)

## H. 修订(2026-09-15):先交接、后运行

### H.1 事故与根因

`auto-migrate` 在 `/workspace/kernel-spi-nor` 跑 T-028 时阻塞退出(退出码 2):

```
⏸ T-028 已阻塞: 交接重测后恢复暂存改动冲突
  (asterinas: error: Your local changes to the following files would be overwritten by merge:),
  stash 条目已保留(git stash list),请人工处理后重新运行。
```

链路:该项目的测试脚本在步骤 0b **原地改写被测源码**(`rustfmt --edition 2024 nor.rs`,
`--check` 非零即 apply 定格)。于是——

1. 并发执行的测试 #1 把 `nor.rs` 改成 rustfmt 形态;
2. 会话收尾只写了文档,但 `trackedSourceChanges` 看到 `nor.rs` 变了,守卫判为「收尾期间改动了
   被测内容」(**归因即已出错**:动它的是 driver 自己并发跑的测试脚本,不是会话);
3. 守卫 stash 后对定版快照重跑同一脚本,rustfmt **再次**应用同一份 reflow,工作区又脏;
4. `git stash pop` 拒绝——已验证 git 在本地改动与 stash 内容**逐字节相同**时同样报
   「Your local changes … would be overwritten by merge」。

这不是竞态而是**确定性陷阱**:凡测试脚本对跟踪文件做确定性改写,重跑必然复现同一改动,
每一次测试交接都必然阻塞。D2 的前提(「会话收尾期间本不该动被测内容」)被 D2 自己引入的
并发执行打破;而 `TEST_PRINCIPLE`(`src/agents-block.ts`)从未要求测试脚本只读。

### H.2 决策

| # | 决策 | 取值 |
|---|---|---|
| E1 | 测试时机 | **顺序**:会话结束 → 归档交接文档 → 提交 #2 → **才跑测试**。脚本自身对跟踪文件的改写留作未提交增量,由下一单元的提交吸纳 |
| E2 | 回退口子 | `OPENCODE_AUTO_HANDOVER_CONCURRENT`,缺省 `off`(顺序);`on` 回到 D2 的真并发 |
| E3 | 重测守卫 | `guardRetest` / `stashAll` / `stashPopAll` **整体删除**。并发态只用 `trackedSourceChanges` 打一行漂移告警(提交 #2 之前,之后 diff 恒空),不 stash、不重跑、不阻塞 |
| E4 | 提交 #1 定版 | **保留**,一次交接仍两次提交——它不再承担 D3 的逐字节不变量,但仍是测试请求时刻的可回退检查点 |

**不变量更替**:D3 的「两次提交之间源码与脚本逐字节相同」作废且不再需要;顺序态的不变量是
**被测的就是提交 #2 的那一份树**。这比原来更强——测试覆盖了会话收尾落盘的工作,而不只是定版快照。

**代价**:交接的墙钟时间由 `max(收尾, 测试)` 变为 `收尾 + 测试`,即每次交接多出一个「收尾时长」。
现场量级:kernel-spi-nor 的测试中位数约 300s、收尾约 74s,单次交接多付约 1–2 分钟。
E2 的开关正是为赶时间时换回并发准备的。

### H.3 现行时序

```
会话 idle,tmp/test.sh 在盘
  │
  ├─ testHandoverDue == false ──► executeTest → steer test-result → 同会话继续
  │
  └─ true(上下文达上限)
       ① afterSession 提交 #1   stage `<单元> handoff-<n>-pin`   subject `T-NNN 测试交接 #n 定版`
       ② resolveTestScript: 消费 tmp/test.sh,把脚本定下来挂 TestRun.pending  ← 不执行
          (并发态: test.running = executeTest(...),不 await)
       ③ steer test-wrapup(落盘剩余工作 + 写交接文档 + 结束会话)
       …会话收尾中,没有任何并发写…
       ④ 并发态才做: trackedSourceChanges 非空 → 打一行漂移告警(必须在 ⑥ 之前)
       ⑤ rename testhandoff.md → testhandoff-<n>.md
       ⑥ afterSession 提交 #2   stage `<单元> handoff-<n>`      subject `<单元提交标题> 测试交接 #n`
       ⑦ runTestScript(test.pending):**被测的就是提交 #2 的树**
       ⑧ 新会话:任务提示词 + test-continue(先读归档交接文档,再判读那次测试的结果)
```

② 必须在定版那一刻消费标记:标记留到收尾之后,会话若重写它,driver 就会跑错脚本;内联形态也
要与定版提交同一时刻物化。执行与「定出脚本」因此拆成 `resolveTestScript` / `runTestScript` 两半,
`executeTest` 退化为两者的串联。

交接提交的标题主体取**本执行单元自己的提交标题**(子任务 `T-NNN S<n> <子任务标题>`、
整任务 `T-NNN exec <标题>`、修复轮 `T-NNN fix<n> <标题>`),与该单元完成时的提交同题,
git 历史里一眼看得出这几次中间提交属于哪个子任务。标题超长时截的是**主体**而非后缀
(`suffixedTitle`)——`#n` 与「定版」才是区分同一单元多次交接提交的唯一信息,交给
`commitTitle` 从尾部截会把它们削掉。交接相关的日志行同理带 `T-NNN S<n>` 短标签:这些行
大多发生在会话横幅之外(定版、收口、恢复判定,以及顺序态下在会话结束之后才跑的测试脚本),
只打任务编号看不出归属哪个子任务。

### H.4 文案

交接文档的内容清单里有一条「本执行范围内还没做完的事」:H.3 的 ① 要求把不依赖测试结果的
剩余工作做完落盘,但会话并不总能做完(按 D2 的硬约束,它也不知道自己为什么要交接)。没被
列进交接文档的剩余工作会在交接处**静默消失**——新会话既读不到、也不知道有,会当成已完成
而永久遗漏。这条与 ① 不冲突:该做完的仍要做完,它只是兜住确实做不完的那部分。
`test-continue.md` 对称地要求新会话开场就读走这份未完成清单。

`test-wrapup.md` 首句对测试时机保持**中性**(「你刚提交的测试脚本将由 driver 执行」)——顺序态
此刻还没跑,并发态已在跑,一份文案两态都成立,不做双模板。D 节的硬约束(不得出现
上下文/超限/上限/tokens,不代劳禁改源码)原样有效,反向断言仍锁在 `test/prompt-exec.test.ts`。

### H.5 目标项目侧的建议(未强制)

测试脚本原地改写跟踪文件,在顺序态下不再引发阻塞(改写落在提交 #2 之后,成为下一单元的增量),
但它仍意味着「提交里的内容不是测试验证过的内容」。格式化类步骤更宜 `--check` 留证、把 apply
交给会话,由会话在下一轮落盘。此处不加机制门禁,只在本文登记。

---

## I. 修订(2026-09-15):交接途中被打断的恢复

状态:**已实施**(`auto-core` 分支)。§H 解决了「交接会不会阻塞」,本节解决「交接被打断之后
还能不能接着跑」。

### I.1 现场:一次中断,毁掉整个交接

`/workspace/kernel-spi-nor` T-028 子任务 3 在测试交接途中阻塞退出(§H 的 stash 陷阱),重新运行
(`.auto/logs/run-2026-09-15_14-42-37.log`)不但没有续跑,反而当场阻塞:

```
[14:42:57] ⏸ T-028 执行单元启动前工作区不净…请人工处置后重新运行:
  CURRENT.md / docs/R-01/PLAN.md / docs/T-028/S03/testhandoff.md
```

`git status` 里最后那行是 ` D docs/T-028/S03/testhandoff.md`——**交接文档是被这次运行自己删掉的**:

1. 阻塞退出把进度记成 `active:false`;
2. 下次运行据此判定「非恢复续跑」,`cleanTestHandoffs` 按陈旧遗留把交接文档整链删除;
3. 该文件已被上一次的收口提交跟踪,删除即脏区;
4. 单元启动 clean 门禁(`beginUnit`)拦下整个运行。

于是:交接文档被销毁、定版提交悬空、待跑脚本丢失、运行起不来。改造前的恢复只有
「`testhandoff.md` 非空即补归档续跑」一句播种,既不看提交状态,也不管脚本跑没跑过,
更接不回被打断的会话。

### I.2 决策表

| # | 决策 | 取值 |
|---|---|---|
| F1 | 交接文档「完整」判据 | 文末 `状态: 继续`(复用 `handoffStatus`,与 ondemand 的 handoff.md 同款解析);非空但无状态行 = 半截文件。**测试交接没有 `完成` 这一态**——测试结果恒由下一个会话判读,交接之后一定还有工作;handoff.md 那边的交接 steer 只是建议,活干完了自然不交接,`完成` 才是真实出口。driver 只消费"这行在不在",不对值分支 |
| F2 | 已落账内容视同完整 | 已跟踪且与提交一致 → 按构造是整的(提交那一刻文件完整),缺状态行由 driver 补写,不返工 |
| F3 | 工作区副本丢失 | 以 git 为权威:HEAD 里有、工作区没有 → 复原;复原即消脏,门禁自然放行 |
| F4 | 陈旧清理 | 只删**未被 git 跟踪**的遗留;已跟踪 = 在途交接(单元正常完成时由 `removeHandoffChain` 在单元内删除并随单元提交落账),交给恢复状态机 |
| F5 | 会话接回方式 | fork 而非复用:收尾未完成 → 从定版那一刻的会话状态分叉;续跑会话已存在 → 整份分叉 |
| F6 | 脚本幂等 | 测试脚本可重复执行,恢复时该跑就跑,不为「可能已经跑过」而跳过 |
| F7 | PLAN.md 阻塞记事 | `question` / `answer` / `blocked-at` 整体退役——原因与结果在日志里都在案,写进 PLAN.md 只是对它的又一次改写 |

### I.3 恢复状态机

判定在 `runExecSession` 入口(整任务与子任务会话共用),观测量是**交接文档 × 它的提交状态**:

| 态 | 观测 | 动作 |
|---|---|---|
| H1 收尾未完成 | 有在途记录;当前份缺失/半截,且无归档份 | 从定版锚点分叉新会话、重下 `test-wrapup`;待跑脚本从记录还原,收尾后照常归档 → 提交 #2 → 跑脚本 |
| H2 已写完未收口 | 当前份完整,或已归档但归档份未落账 | 补状态行 → 归档 → 提交 #2 → 跑脚本 → 续跑会话 |
| H3 已收口 | 归档份已落账 | 执行结果已固化(记录 `ran`)则直接引用、否则重跑脚本(F6,口径见 §M)→ 续跑会话;记录里的续跑会话尚存则从它分叉接回,fork 成功且本次无新跑测试时恢复提示词收敛为一句继续(§M) |
| H4 无记录的存量现场 | 没有记录但文档在册 | 同 H2/H3,脚本回落到 `tmp/` 下最新一份 `test.<n>.sh`;一份都没有就只凭交接文档续跑 |
| H5 无交接痕迹 | 记录与文档都没有 | 现状行为,零变化 |

每一态开工前先做 F3 复原,所以「文档被上一次运行删掉」不再是故障,只是一个前置修补步骤。
复原另有一处更早的挂点:`loop` 的启动 clean 门禁**之前**——运行开始前一份被删掉的已落账交接
文档没有任何正当解释,不先复原就会被门禁在入口拦死。同一处顺带把启动门禁改为走 `beginUnit`,
使 driver 独占状态文件(PLAN.md/CURRENT.md)的遗留以 carryover 自愈:上一次运行以非提交路径
退出(如单元门禁不净直接 `return 2`)会留下它们的写盘,拦在入口只会让下一次运行永远起不来。

### I.4 在途记录 `.auto/handover.json`

只记「从文件和提交推不出来的东西」,阶段判定不依赖它(丢了就退化为 H4):

```ts
{ task, scope, unit, n, script?, seq?, pinSession?, pinMessage?, nextSession? }
```

写入时点是**定版之后、收尾之前**那一刻——待跑脚本刚从 `tmp/test.sh` 消费出来(标记已被拿走,
重新运行再也读不到),会话锚点还没被收尾的消息盖过。收口后记录转「已收口」态(脚本与定版锚点
作废),续跑会话由 `attempt` 回填 `nextSession`;交接循环闭环(会话自然结束)即清除,阻塞退出
则保留——那正是下次运行要落回的断点。

分叉锚点:server 的 fork 语义是「复制 target **之前**的消息」
(`packages/opencode/src/session/session.ts` 的 `Session.fork`),故取定版时观测到的末条消息的
**后一条**;取不到时整份分叉,收尾提示词重下一遍,至多把收尾做两遍,不丢东西。

### I.5 PLAN.md 阻塞记事退役(F7)

`block()` 只改 `status: blocked`,并清掉存量的 `question` / `answer` / `blocked-at` 三行
(`edit` 会原样保留未知字段行,不显式清就永远留着)。`Task` 的两个字段、`baseCtx` 的
`blockedAnswered` / `blockedUnanswered` / `question` / `answer` 四个渲染量,以及十一个提示词模板里
那两段「该任务此前被阻塞…」文案一并移除。理由有二:阻塞原因与处置结果在运行日志和终端里
完整在案,复刻进 PLAN.md 是重复记账;而 PLAN.md 的每一次改写都要落账、都参与下一个执行单元的
clean 门禁,少写一次就少一次摩擦。

## J. 修订(2026-09-16):交接收场即丢弃定版会话为重启复用锚点

状态:**已实施**(`auto-core` 分支)。§I 让交接途中被打断的运行能落回断点;本节修的是断点
**之后**的一类错位——重启复用/重试分叉的对象落回了交接**之前**的会话。

### J.1 现场

交接收口(归档 + 提交 #2 + 跑脚本)之后,续跑会话发生 AI 会话错误且重试阶梯耗尽、程序退出。
此时 `.auto/progress.json` 里的 active 记录指向**定版前的旧会话**:该记录由定版会话末次成功
回合的认领(`remember`)写入,「会话已交接、任务已告完成」这一状态没有反映进记录;续跑会话的
可重试错误又把记录还原为下发前快照——正是那份陈旧认领。于是再次运行触发的会话复用、以及
`runSession` 重试环的分叉源选择(`chain.id` 还原为定版会话,凭满额上下文成为首选分叉源),
对象都是交接之前的会话——一个上下文已用满(这正是交接的原因)、任务已经完成的会话。

### J.2 决策

- **交接文档写出 `状态: 继续` = 当前会话的任务即告完成,理应被丢弃**:`attempt` 的成功路径
  对带 `testHandover` 的结果不再认领会话——`chain.id` 清空(此后续跑会话出错,重试分叉源只剩
  续跑谱系 `chain.failed`),`progress.json` 转「无会话在途态」:`session` 丢弃(下次运行无会话
  可复用),`active` 保留(单元仍在途——恢复续跑的 clean 豁免与交接文档保留依赖它),`phase`
  保留(阶段精确重入不受影响)。
- **记录中待重启复用的会话与重试所依赖的会话保持同源**:交接之后,恢复只经
  `.auto/handover.json` 的 `nextSession`(续跑会话,由 attempt 回填)或定版锚点(收尾未完成时)
  分叉接回,不再存在落回定版前旧会话的路径。任务/子任务处理过程中本就不始终依赖活跃 AI 会话
  (归档、提交 #2、跑脚本都是无会话窗口),这些窗口中断后的恢复由 §I 状态机承载,记录不认领
  会话正是它成立的前提。

### J.3 修订(2026-09-17):nextSession 认领遵循「下发即写 + 失败还原」

**现场**(virtio T-005,配额连败):41.3k 续跑会话遇配额类会话错误后,重试环的 fork 副本 /
基点重播种会话每个都在起跑时认领了 `nextSession`,又逐个 0-token 即死;进程终止时
`handover.json` 的 `nextSession` 停在最后一个 0-token 桩上——重启恢复(`exec-session` 的
stage=test 分支)只能 fork 空壳,41.3k 会话虽活着却不再被任何记录指向。

**决策**:认领保留「起跑即写」(半途被 kill 也有锚点,§J.2 同源语义不变),但会话以
**0-token 可重试错误**收场时,`attempt` 把认领还原为认领前的记录——纯报错桩不配作恢复
锚点;`used > 0` 的失败保留认领(该会话是旧锚点的严格超集)。与 `chain.failed` 的更替
invariant(见 plans/0015-session-error-retry-plan.md「2026-09-17 修正五」)同一口径、同批实施。
单测:`test/session.test.ts` 新增两例(0-token 桩还原锚点 / 带内容失败保留认领)。

## K. 修订(2026-09-16):steer 交接文档 handoff.md 的陈旧清理同样只删未跟踪份

### K.1 缺口(§I 只修了 testhandoff一族)

§I/F4 给 `cleanTestHandoffs` 加了两道收窄(有在途记录整段跳过、只删未被 git 跟踪的
份),但 steer 交接文档 `docs/<id>/handoff.md`(ondemand 整任务与 auto 子任务的 2×cap
交接)在 `runTask` 流水线的陈旧清理仍是**无条件 `rm`**(条件仅「非恢复续跑」)。触发链:
交接续跑会话被非会话错误阻塞(权限 ask-fail、重复提问、steer 投递失败、两次未写出有效
交接文档)→ `runTask` 把进度记录转总结态(`active=false`)→ 该 handoff.md 已被续跑前的
`afterSession` 提交(`git add -A` 一并落账)→ 下次运行 cleanup 无条件删已跟踪文件 →
删除即脏区 → 下一执行单元的 `beginUnit` clean 门禁阻塞退出 2。人工 `git checkout`
恢复文件后再运行,cleanup 又删一次——循环阻塞;人工若选择「提交删除」破局,交接文档里
「还没做完的事」清单随之丢失,续跑只剩阶段级 resumeNote 指引,剩余步骤可能永久遗漏
(test-wrapup.md 警告的正是这个损失形态)。与 kernel-spi-nor T-028 现场同类。

### K.2 决策

- **陈旧清理只删未被 git 跟踪的份**(与 F4 同语义):`removeIfUntracked` 从
  `testrun.ts` 的私有函数上收到 `git.ts` 导出,`runTask` 两处(auto 分支与 ondemand
  分支)的 handoff.md/旧平铺名清理改走它。已跟踪的 handoff.md 必属未收口的执行单元
  (单元收口时删除随提交落账,盘上与 HEAD 同时消失;检查项按序执行,未收口单元必是
  首个未勾选项),保留在盘上正好被重跑的 `runSubtask`/`executeWhole` 的
  `handoffStatus` 读走、凭交接续跑——这正是恢复语义要的载体,删它没有任何收益。
- **不对 handoff.md 做 git 复原**(不并入 `restoreTestHandoffs`):testhandoff 按执行
  范围命名,复原不会串范围;handoff.md 是任务级、跨子任务共享,若把「单元收口时删
  除尚未提交」窗口的工作区删除复原回来,下一子任务会把上一子任务的交接误读成自己
  的续跑依据。该窗口的脏区维持「阻塞交人工」现状(量小且安全)。
- 已知取舍:若人工在 PLAN.md 手动勾掉了交接所属子任务(检查项按序的不变量被人工
  打破),盘上保留的 handoff.md 会被下一子任务误读;此前该场景的表现是脏区阻塞,
  两种都需要人工介入,不改判。

### K.3 落地范围

`packages/auto-core`:`src/git.ts`(`removeIfUntracked` 导出)、`src/testrun.ts`
(私有副本删除,改 import)、`src/runner.ts`(两处陈旧清理改用)、
`test/git.test.ts`(`removeIfUntracked` 真实仓库用例)。`bun typecheck` 干净,
`bun test` 全绿(778 pass)。

## L. 修订(2026-09-17):归档命名族防伪——观测序号以在途记录为权威

### L.1 现场(kernel-mig/virtio T-005 S06)

交接 #1 正常收口后,续跑会话判读完探针 run 1,**自发**把判读结论与脚本修正落成
`testhandoff-2.md`(产物 index.md 按交接文档约定要留到 b 探针之后,会话于是占用了
归档命名族当落盘点),随后撞配额错误、人工 Ctrl+C,误写件留在脏区。下一次运行时
恢复状态机的归档序号来自盘扫描 `latestHandoffSeq`:误写件占住 2 号位 → 观测指向
`testhandoff-2.md` → 人工提交脏区过门禁后它「在盘且已落账」→ H3 误判
「交接 #2 已收口」——一场从未发生的交接被当成事实,记录计数永久虚一,还会把
已跑过的脚本再虚跑一次。

### L.2 根因

两层叠加:

1. **提示词无排他条款**:三处测试执行协议模板只说「driver 有时会要求你写
   {{testHandoffFile}}」,没有任何一处声明 testhandoff 命名族是 driver 交接时序的
   观测量、会话不得自行创建/续号;doc-layout 还把 testhandoff.md 当中性存储路径
   介绍。判读结论往哪落盘,提示词从未回答。
2. **状态机信任命名族**:恢复观测 = 盘扫描最大号,盘上任何 `testhandoff-<n>.md`
   都直接成为状态机输入,无防伪。

### L.3 决策

| # | 决策 | 理由 |
|---|---|---|
| L-D1 | 提示词补排他条款:只在 driver 明确要求时写当前份,不得自行创建/续号归档份;判读结论写入本执行范围既定产物文档或并入下一次交接 | 堵行为源头;三处模板(subtask/fix/whole)同文条款 |
| L-D2 | 观测序号以在途记录的 n 为权威,盘扫描只在记录缺失时兜底(纯函数 `handoverSeq`) | 记录是 driver 在收口时写下的,指着真正收口的归档份;盘扫描可被会话落笔污染,不可信 |
| L-D3 | 归档续号仍取「盘扫描与记录」两侧最大 | D4 不覆盖历史的语义保留,连误写件也不覆盖(文件本身是进度证据,只不再是状态机输入) |
| L-D4 | 不做 Auto-Stage trailer 校验归档份归属 | 过度工程:记录权威化已足够,存量现场(记录缺失)仍需盘扫描兜底,trailer 校验会让存量现场无路可走 |

### L.4 落地范围

`packages/auto-core`:`src/handover.ts`(新增纯函数 `handoverSeq`)、
`src/exec-session.ts`(观测序号/续号分离;H2/H3 恢复分支的收口号 `closedN`
跟随真归档份,在途记录 n 与之一致)、`templates/prompts/subtask.md`/`fix.md`/
`whole.md`(handoverTest 条款补排他规则)、`test/handover.test.ts`
(`handoverSeq` 三组用例)。`bun typecheck` 干净,`bun test` 全绿(831 pass)。

## M. 修订(2026-09-17):执行结果固化 + fork 恢复提示词收敛

### M.1 现场与问题(kernel-mig/virtio T-005 S06 同一现场的两个后续观察)

1. **已执行的测试被虚跑**:交接 #1 收口后,续跑会话又发起 run 2(driver 已执行、
   结果已被会话读走),随后会话撞配额错误、人工 Ctrl+C。此时在途记录是已收口态
   (`script` 已在收口时清除),旧 H3 恢复因记录无 `script` 而回落
   `latestTestScript`,把已经跑过的 `test.7.sh` 再跑一遍——`tmp/test.sh` 标记在
   消费时即删、每次执行的证据落在 `tmp/test.<n>.out`,但「执行已完成」这件事本身
   没有任何固化记录,恢复只能保守重跑(F6)。而本地脚本除断电/强制终止外必然
   跑完,重跑是纯浪费(该探针单跑约 20s–1min,含 124 超时探针更长)。
2. **fork 恢复整份重发提示词**:H3 从 `nextSession` fork 出续跑副本后,仍对该副本
   下发整份 `promptText + 续跑说明`——而续跑会话在上一场运行开出时就已收到
   这两者,fork 副本全量继承,重发是逐字重复。

### M.2 决策

| # | 决策 | 理由 |
|---|---|---|
| M-D1 | **已执行即完成**: 定版脚本的执行结果(脚本/序号/退出码/输出路径/耗时)在收口执行落定后随在途记录固化(`ran` 字段),恢复认记录不重跑,凭 `ran` 重建 `test.last` 供续跑提示引用 | 本地脚本的执行中断只有断电/双击 Ctrl+C 一类,且那种情形下 `ran` 根本来不及落盘,自然落回重跑分支——固化是无损的 |
| M-D2 | 重跑窗口收敛到唯一不可判区间: 仅「定版已消费出脚本而 `ran` 未落盘」(执行途中被打断)才重跑;记录缺失的存量现场维持 `latestTestScript` 兜底重跑;**旧格式记录(无 `ran` 亦无 `script`)按已执行处理**——收口时清脚本即表示已执行,这是旧代码同样成立的不变量;不重跑、不臆造结果 | F6 的保守性只留给无法证明执行发生的情形;旧格式记录因此向后兼容,本修订对在现场直接生效 |
| M-D3 | fork 续跑会话成功的恢复提示词收敛为一句继续;本次恢复有新跑的测试才单发 `renderTestContinue`(携带新结果);fork 失败(会话已沉没)维持整份 `promptText + 续跑说明` | 与恢复保真「复用会话的恢复说明收敛为一句 continue」同口径;冷启动会话没有上下文,仍需要完整提示词 |
| M-D4 | 运行中的瞬时错误重试阶梯**不动**: fork 重试重发同一提示词是刻意的「续命」语义(副本尾部垫着报错桩,同一提示词再现需解释),且提示词缓存使命中成本极低 | 与跨运行恢复的场景不同,不混为一谈 |

### M.3 落地范围

`packages/auto-core`:`src/handover.ts`(`Handover.ran` 字段,结构化声明避免
handover → prompt 反向依赖)、`src/exec-session.ts`(H2/H3 分支按 `ran` 跳过已
固化执行、fork 成功时 `firstPrompt` 收敛;正常收口 `ran` 固化,并发态取
`test.last`)、`test/handover.test.ts`(已收口态往返用例)。
`bun typecheck` 干净,`bun test` 全绿(832 pass)。

## N. 修订(2026-09-17):正确性审查六项修复

起因:对 testhandoff 机制的一次整体正确性/完备性/健壮性审查(非现场事故驱动),
发现六处缺陷,按「可能性 × 影响」排序修复。

### N.1 修复表

| # | 缺陷 | 修复 |
|---|---|---|
| N-1 | **进程内重试丢失整场在途交接**(最重): `testHandoverAsked` 是 watch 实例状态,收尾途中会话出错被 runSession 重试环/降级环 fork 续跑时,新实例把「收尾完成」误判为自然结束 → 交接循环丢失(定版脚本永不执行、文档永不归档、定版提交悬空)——跨进程中断有记录可恢复,进程内重试反而没有 | watch 定版 steer 投递成功即置 `test.resumeWrapup`(与 H1 跨进程恢复同一旗标、同一语义),重试出的新 watch 实例直接进收尾校验态;收口后由 runExecSession 既有清零行复位 |
| N-2 | **任务级交接链永不清理 → 陈旧归档被误判 H3**: `removeHandoffChain` 只在 runSubtask 收口调用;executeWhole 与修复轮(任务级 scope)正常完成后归档份永留盘上且已落账,F4 收窄又使陈旧清理不删已跟踪份 → 同 scope 再入(任务回退重跑/下一轮修复)时「无记录 + 归档已落账」被判「已收口」,重跑旧脚本并向新会话注入上一范围的陈旧交接 | executeWhole 与 fixRound 在 runExecSession 返回后、收口提交前补 `removeHandoffChain`(新路径 + 旧平铺名),删除随收口提交落账——「单元完成必清链」自此对三类执行范围都成立,F4 收窄依赖的不变量闭合 |
| N-3 | **恢复编号 off-by-one**: 未收口记录的 `n` 是在途交接已分配的号而非已收口计数,直接当 `handovers` 初值使恢复收口归档跳空一号(定版「#n 定版」与收口「#n+1」标题不对应) | 新纯函数 `closedHandovers`: 记录未收口(带 script/pinSession)且 `nextBase === record.n` 时基数退一格;盘扫描更大(误写件)仍由 diskMax 托住不覆盖 |
| N-4 | **严格恢复回滚不清在途记录**: 写核失败回滚重做后,旧记录让恢复状态机把重做接回「继续被丢弃的交接」(从定版点 fork 重做收尾、对回滚后的树跑定版脚本) | `rollbackUnitState` 回滚成功即 `forgetHandover`(在途记录按构造必属当前单元) |
| N-5 | **0-token 认领还原只覆盖可重试分支**(§J.3 缺口): 不可重试 0-token 错误与 prompt 下发失败两条路径不还原 nextSession 认领,进程在等待-探测环被强退后重启只能从报错桩 fork | 还原条件扩到这两处(首发即死的空会话/报错桩不配作恢复锚点,同一口径) |
| N-6 | **H2 已归档未落账分支不补状态行**: 存量现场(归档发生于状态行约定之前)会把缺状态行的归档随提交 #2 落账 | 该分支补 `fillHandoffStatus`(幂等) |

### N.2 登记不改的(已知取舍)

- **H4 回落可被误写的当前份触发升级**: 无记录 + 半截当前文档按「已交接」处理并补
  状态行落账——§L 给归档命名族做了防伪,当前份没有。有提示词排他条款压着,且该
  分支本意是兜住机制上线前的存量进度,不改。
- **收尾期重发的测试请求被静默丢弃**: 定版消费标记后,会话在收尾期重写 tmp/test.sh
  不会被结算(收尾校验优先),下一 attempt 开局清除。会话预期落空但无损:续跑会话
  凭交接文档可重新发起。
- **并发态跨进程中断丢定版测试**: 并发态记录不写 script(定版即起跑),进程死于
  收尾途中后恢复无任何执行入口,测试永不重跑。并发态(`OPENCODE_AUTO_HANDOVER_CONCURRENT`)
  缺省 off 且本身是降级形态,登记备用。

### N.3 落地范围

`packages/auto-core`:`src/watch.ts`(N-1)、`src/execute.ts` + `src/review.ts`(N-2)、
`src/handover.ts` + `src/exec-session.ts`(N-3/N-6)、`src/unit-commit.ts`(N-4)、
`src/attempt.ts`(N-5);测试 `test/watch.test.ts`(N-1 定版播种与重试接续,经真实
git 仓库驱动)、`test/handover.test.ts`(N-3 三组)、`test/unit-commit.test.ts`(N-4
真实仓库回滚)、`test/session.test.ts`(N-5 两例,与 §J.3 用例同族)。每个修复的
用例均验证过「撤掉修复即红」。`bun typecheck` 干净,`bun test` 全绿(840 pass)。
