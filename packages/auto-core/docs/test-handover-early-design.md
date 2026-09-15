# 测试交接前置化设计(判据解耦 + 一次交接两次提交)

状态:**已实施 2026-09-15**(`auto-core` 分支;P1..P5、P7、P8 落地,P6 灰度开关经评估未做,
理由见 §F)。上游登记:`session-recovery-fidelity-design.md` §3.5 ①「交接触发解耦」。
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
| D2 | 测试与收尾的关系 | **真并发**:不 await 测试即 steer 收尾+交接指令。提示词**不**要求「别改源码」 | 串行会把会话晾到 provider 缓存失效;AI 发起测试时本就知道被测内容不该动,无需代劳,状态由 D3 的定版提交固定、由重测守卫兜底 |
| D3 | 提交策略 | **一次交接、两次提交**:下发脚本时提交 #1 定版,交接收口时提交 #2 确认。两次提交之间源码与脚本必须无修改 | 每次交接都有可回退的留档;定版把「被测的是哪一份代码」变成事实而非约定 |
| D4 | 交接文档归档 | 同目录累积 `testhandoff-<n>.md`,新会话读最新一份 | 交接链可回溯;当前份名恒定,会话的写目标不变 |
| D5 | 重测触发面 | 只看 `test/**` 与**已跟踪**的非文档源文件;`docs/**`、`PLAN.md`/`CURRENT.md` 与未跟踪新增不计 | 会话收尾必然落盘文档,若一律触发就等于每次交接都多跑一遍测试;未跟踪新增参与编译的场景会漏判,是明确取舍 |
| D6 | stash 处置 | `stash -u` → 对定版快照重跑 → `stash pop` → 提交 #2;pop 冲突即阻塞(退出码 2),stash 条目保留 | 收尾成果一份不丢;冲突不吞 |

## C. 交接时序

```
会话 idle,tmp/test.sh 在盘
  │
  ├─ testHandoverDue(test, used) == false ──► executeTest → steer test-result → 同会话继续
  │
  └─ true(上下文达上限)
       ① afterSession 提交 #1   stage `<单元> handoff-<n>-pin`   subject `T-NNN 测试交接 #n 定版`
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

## D. 文案硬约束(D2 的落实)

`test-wrapup.md` **不得出现「上下文 / 超限 / 上限 / tokens」**。现场实证:会话一旦知道自己
上下文吃紧,就会自行判定余量不足而省略本应完成的落盘工作——而这次交接恰恰要求它先把
不依赖测试结果的剩余工作做完。文案只陈述「需要交接并切换新会话」这一事实,并明写
「不要因为要交接就省略,这些工作不做完,新会话要从头重做」。同理不写「不要改源码」:
说了反而提示它这是个可以自由裁量的边界。`test/prompt.test.ts` 以反向断言锁住这条约束。

`subtask.md`/`whole.md`/`fix.md` 的协议段同样改口径——把交接描述成「既定的交接节奏,
不是出了问题」,不提失败与上限。

## E. 与既有机制的关系

- **与 ondemand 上下文交接正交**:`handoff.md` / `handoffSteer` / `handoverDue` 阈值仍是
  `2×cap`,两套判据并列不合并(`switches.ts` 的 `OPENCODE_AUTO_STEER` 只管前者)。
- **与提交边界体系相容**:`unitViolations` 只校验区间内每个提交带 `Auto-Stage` trailer,
  不限提交个数,单元内多两笔 driver 提交合法。`rollbackUnit` 回滚到单元基线时一并丢弃
  交接提交,语义正确(整个单元重做)。
- **消解一处已知局限**:`commit-boundary-design.md` 登记的「交接续跑期间工作区脏、clean
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
- **stash `-u` 与构建产物**:首次测试若产出未 gitignore 的构建产物,它们会被卷进 stash,
  重跑再产一遍可能让 `pop` 冲突 → 按 D6 阻塞、stash 条目保留交人工。目标项目应把构建
  产物纳入 `.gitignore`。
- **重跑脚本靠 `tmp/` 被忽略才活下来**:`git stash -u` 收走未跟踪文件但不动 **被忽略**
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
- [x] P8 文档 —— 本文档、`behavior.md`、`structure.md`、`session-recovery-fidelity-design.md`
      §3.5 ①、`commit-boundary-design.md`、`packages/auto/README.md`、CLI 帮助、导航与根 AGENTS.md
- [ ] 真实冒烟(三包全量,在 `auto/` 集成 worktree;需有凭证的环境)
