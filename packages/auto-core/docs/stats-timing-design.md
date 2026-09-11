# 跨中断累计用时与 Token 消耗统计(Stats / Timing)设计

状态: 已实施(2026-09-11,P1..P7 全部落地——`src/stats.ts` 统计核心、loop/runner/step
三处接线、六处报文、单测与文档;`bun typecheck` 干净、`bun test` 全绿 558 pass)。
计划文件 `plans/STATS_PLAN.md`(含用户 6 点需求与已确认口径);实施过程与逐任务
AUTO-DECISION 见 `docs/T-001/`(S01..S05)至 `docs/T-007/report.md`。常态统计,
**不加 `OPENCODE_AUTO_*` 开关**(不违反"开关不落盘"不变量);持久化在目标目录
`.auto/stats.json`(gitignore 内、driver 独占写、不进 protect 名单)。

## A. 动机

driver 原有用时统计假设程序不间断执行到结束:任务用时起点是 loop.ts 的内存
`const start`,进程重启即归零,`✓ T-001 完成(用时 X)` 在续跑场景下只报最后一段却无
标注;会话耗时只在 watch() 正常出口存在,error/blocked 出口缺失;阶段/轮次完全没有
计时;任何层级都没有 Token 统计(fork 链的每回合真实消耗不可见)。中断恢复机制
(`.auto/progress.json`)只记恢复点、不记累计量;强退(SIGINT×2 → `process.exit(130)`)
与 kill -9 跳过所有 finally——**累计必须增量落盘**。

目标: 任务/会话/子会话/阶段/轮次各级输出跨中断累计用时与 Token 分项
(input/output/reasoning/缓存读/缓存写/命中率/cost)。

## B. 口径(已确认决策)

- **AI 用时** = 纯 AI 会话运行时间(会话内等人工答复 askHuman 的挂起不计)。
- **总用时(wallMs)** = 进程存活期间累计,**同时排除停机空档与纯人工等待**
  (stepPause、--wait-between、askHuman);人工等待单记 `waitMs`。
- **子会话展示范围**: 所有经 `runSession→attempt` 的 AI 会话(含 verify 判定/审核/
  阶段规划/交接蒸馏等旁路,伪任务 PLAN/AUTO 同口径),统一输出 `◉ 会话结束` 两行。
- **命中率自算**: `hit = cacheRead / (cacheRead + input)`(服务端归一化后 input 已不
  含 cache 部分);分母 0 显示 `—`(`src/log.ts:164` formatCacheHit)。
- **层级 aiMs 语义** = "AI 活跃墙钟时长"(任一会话 AI 段开放的墙钟区间并集),而非
  各会话 AI 时长之和:`--early` 并行会话重叠时 `层级 aiMs ≤ Σ session aiMs`,属预期
  而非漏计;等待嵌套深度计数使重叠人工等待只计一次。
- **per-session wallMs** = aiMs + waitMs(会话内人工等待计入会话墙钟),与三桶
  "wallMs 排除纯人工等待"口径刻意区分。

## C. 持久化 schema(`.auto/stats.json`,compact JSON,v:1)

```ts
type Usage = { input; output; reasoning; cacheRead; cacheWrite; cost; steps }  // 全 number
type Totals = { aiMs; wallMs; waitMs; sessions; tasks; usage: Usage }
type Bucket = Totals & { id: string; since: number }
type SessionStat = { task; aiMs; wallMs; rounds; usage; at }   // per-sessionID 累计
type StatsDoc = {
  v: 1; round: number; phase: string          // round 快照 = 装载时 currentRound(dir)
  open?: { at: number; ai: boolean }          // 至多一个进行中的段
  lastWriteAt: number                          // 任一写入刷新 = 上一进程死亡时刻的代理
  taskB / phaseB / roundB: Bucket              // 三桶并行累加(不做子层向父层折叠)
  sessions: Record<string, SessionStat>        // 超 64 按 at 淘汰(聚合已入账,无损)
  history: { rounds: number; totals: Totals }  // 已滚出历轮聚合(单桶有界)
}
```

`tasks` 计数 = 进入一个不同任务 id 计 +1(含本进程首次进入),累加在 phase/round 桶;
备选"按任务完成计数"因完成时刻(blocked/incomplete 算不算)口径模糊被否决——"进入"
语义简单且跨中断幂等(同 id 不重复计)。

## D. 计时模型: 单段(segment)状态机 + 三桶并行累加

- `open?: { at, ai }` 至多一个进行中的段;每次边界 **fold** 把 `[open.at, now]` 并行
  累加进 task/phase/round 三个桶(不做子层向父层折叠——阶段内含非任务时间,折叠式
  会丢)。ai 段同时累加 aiMs/wallMs,墙钟段只累加 wallMs。
- fold 钳制 `[0, MAX_TICK=30min]`(`src/stats.ts:82`):时钟回拨/休眠防御,负值归 0。
- **增量落盘**: 会话期 30s 心跳(fold + 落盘,`unref()` 不阻止进程退出)限制
  kill -9 损失 ≤ ~30s;原子写(`.tmp → rename` + promise 链写队列串行化,对齐
  plan.ts edit);所有写失败 catch 静默——统计永不影响流程/退出码。
- **折旧**: 下一进程 `loadStats` 只承认上一进程遗留段的 `[open.at, lastWriteAt]`
  (lastWriteAt = 死亡时刻代理,宁少不多、绝不虚高);折旧同样过 MAX_TICK 钳制,
  且不进 per-session(open 段无 sessionID 归属,无从归属故宁少不多)。
- **轮次滚动**: 装载时轮号变化 → roundB 滚进 history 并重置;round 字段损坏(<1)
  视为缺失,只刷快照不滚动,避免空轮次虚增 history.rounds。
- **本进程增量口径**: `statsBoot` 快照(loadStats 时刻、折旧+滚动之后的三桶副本;
  桶在本进程内被 statsTask/statsPhase 重置时对应快照同步归零),"累计 X(本进程 Y)"
  = `statsTotals(scope) − statsBoot(scope)` 同名字段差。
- **读数实时外推**: `statsTotals` 把开放段未落账部分计入**副本**返回(与 fold 同一
  钳制),不修改 doc、不落盘——展示层任意时刻读到当前值,状态机不受影响。
- **解析逐字段宽容**(镜像 resume.ts parseProgress):坏 = 缺失不 throw;损坏/缺失
  文件 = 从当下重开(统计非事实来源)。
- 测试注入: 模块级可替换时钟 `setStatsClock`(`src/stats.ts:93`)——备选"各 API 加
  now 形参"要穿透全部公共 API 与接线层,污染签名,否决。

## E. 挂点表(行号以 auto-core 分支 T-007 时 HEAD 为准)

| 挂点 | 位置 | 动作 |
|---|---|---|
| 进程启动 | `src/loop.ts:205` | `loadStats(directory)`(折旧+轮次滚动+开本进程首段);有旧文档打续接横幅 `resumeBanner`(`src/loop.ts:978`) |
| 进程收口 | `src/loop.ts:847` | runAll finally `flushStats(directory)`(关段落盘、卸载句柄;unprotect 之前) |
| 任务切换 | `src/loop.ts:381` | 任务横幅处 `statsTask(dir, task.id)`(同 id 幂等;切换清空 sessions 映射) |
| 阶段切换 | `src/loop.ts:722`(分阶段 routePhase 后)、`src/loop.ts:466`(非分阶段 "m") | `statsPhase(dir, letter)`(同字母幂等) |
| 会话开始 | `src/runner.ts:2235` | prompt 下发前 `statsSessionBegin(opts.dir, task.id)`(fold、开 AI 段、启心跳) |
| 会话结束 | `src/runner.ts:2254` | `await watching` 后 `statsSessionEnd(dir, sessionID, usage)` 取打印报告;`finally` 以 `booked` 守卫幂等兜底(`src/runner.ts:2322`,零 usage 照记) |
| Token 采集 | `src/runner.ts:2489` | watch 的 `message.part.updated` 分支对 step-finish part 按 `part.id` 去重(`billedSteps` 专用集合)累加七分项;watch() 全部 7 个 return 出口经 `snapshot` 统一携带 durationMs + usage |
| 人工等待 ×3 | `src/runner.ts:2891`(askHuman)、`src/loop.ts:862`(waitBetweenTasks)、`src/step.ts:46`(stepPause) | `statsWaitBegin/End` try/finally 配对包裹(含 interactive 路径与异常路径) |
| 进度心跳 | `src/loop.ts:955` | `subtaskProgressLine` 读 `statsTotals(dir,"task").wallMs`,守卫 `statsId === task.id` |
| 结论行 ×3 | `src/loop.ts:1003`(taskEndLines)、`src/loop.ts:1025`(phaseCloseLines)、`src/loop.ts:1045`(roundCompleteLines) | 导出报文构造函数,loop 主体只负责 log,单测直驱 |

formatter 收口(`src/log.ts`):`formatDuration`(中文式+小时档,:120)、
`formatDurationCompact`(紧凑式逐字保持,:131)、`formatTokens`(:142)、`formatCost`
(0 → undefined,:152)、`formatCacheHit`(:164)、`formatUsageLine`(tokens 分项行,
:176——会话结束行 2 与任务/阶段/轮次结论行同源构造);runner.ts/loop.ts 两份私有
formatDuration 副本已删改 import(runner.ts 与 prompt.ts 的 formatTokens 私有副本收口
属遗留,见 `docs/T-003/report.md`)。

## F. 六处报文(已实施文案)

1. **会话/子会话结束**(`src/runner.ts:2265` 起,所有 attempt 会话**无条件打印**):
   行 1 `◉ 会话结束: 上下文 42% (35.2k/83.1k tokens),用时 12.4s(累计 1m40s / 3 轮)`;
   行 2 `tokens 入 1.2k / 出 340 / 缓存读 28.4k / 缓存写 3.1k,命中率 95.9%,费用 $0.041(累计 $0.31)`。
   省略规则: 单轮(session.rounds ≤ 1)省略"(累计…)";reasoning=0 省略思考项
   (位次在"出"与"缓存读"之间,与 Usage 声明序一致);cost=0 费用整项省略(不显示
   孤立的"(累计 $X)");命中率分母 0 显示 `—`。行 1 用时取 `report.thisAiMs`(纯 AI
   口径)而非旧行 watch durationMs(含会话内人工等待),无 stats 目录时回落
   durationMs;上下文段逐字保留旧行。下发失败路径提前 return 不打印(未发生会话事件)。
2. **任务三态行**(runTaskLoop,done/blocked/incomplete 都打):
   `✓ T-003 完成: 用时 24 分 31 秒(AI 18 分 12 秒[,其中本进程 6 分 12 秒]),会话 7 次`
   + tokens 行;"本进程"取墙钟差(与心跳行同词同义)且仅当格式化结果 ≠ 累计时输出;
   blocked/incomplete 用 ⏸ 前缀配"阻塞/未完成"措辞;守卫失败(statsId 不符/未装载)
   逐字回落旧文案 `✓ … 完成(用时 …)`。
3. **阶段收口行**(handoverPhase 末尾 commitTree 之后、return 0 之前):
   `■ 阶段 t 测试 收口: 总用时 …(含规划/交接/提交;AI …[,人工等待 …]),任务 N 个 / 会话 N 次`
   + tokens 行;人工等待段仅 waitMs > 0 时输出。
4. **轮次完成行**(分阶段 runPhaseLoop complete 路由 / 非分阶段 `✓ 全部任务已完成` 处):
   `■ 第 2 轮完成: 总用时 …(AI …[,人工等待 …]),阶段 6 / 任务 24 / 会话 96` + tokens 行;
   `history.rounds > 0` 时追加两行缩进历轮累计段(`  历轮累计(N 轮): …` + `  历轮 tokens …`),
   不并入本轮数字(并入会混成跨轮加权命中率/费用且破坏"本轮"语义);非分阶段路径省略
   阶段段("m" 伪阶段计数恒 1 无信息)。
5. **进度心跳**(每 10 分钟):`⏳ T-002 子任务进度 3/7,累计用时 24 分(本进程 8 分),预计剩余 32 分`;
   守卫失败跳过本次心跳,不保留内存 since 兜底(心跳 10 分钟一次,跳过一代价远小于
   口径失真);预计剩余按累计口径线性外推。
6. **启动续接横幅**(loadStats 有旧文档时):
   `↻ 统计续接: 第 2 轮 / m 阶段 / T-003 已累计 18 分(AI 12 分),上次进程止于 12:03`;
   快照在折旧之后、轮次滚动之前截取(呈现上一进程停下时的位置)。

## G. 决策记录(代码内 AUTO-DECISION 汇总,详见 `docs/T-001/` 至 `docs/T-006/report.md`)

- **折旧同样过 MAX_TICK 钳制**(`src/stats.ts:239` 注释):lastWriteAt 异常(坏文件
  宽容解析)时不受钳制会一次性虚增数小时;"宁少不多"原则下一律钳制最稳妥。
- **now 注入 = 模块级可替换时钟 setStatsClock**(`src/stats.ts:86` 注释),否决逐 API
  now 形参(穿透全部公共 API 与接线层)。
- **折旧不进 per-session**(`src/stats.ts:239` 注释):open 段不携带 sessionID,无从
  归属,宁少不多。
- **tasks 计数 = 进入不同任务 id +1**(`src/stats.ts:449` 注释),否决"按完成计数"。
- **statsId 同步且不触发惰性装载**(`src/stats.ts:481` 注释):守卫读数应无副作用。
- **statsSessionBegin 不落盘**(`src/stats.ts:545` 注释):首次心跳(≤30s)即持久化,
  kill -9 损失仍受心跳周期上界约束;每次会话多一次写盘不值。
- **begin 挂点取"prompt 下发前"**(T-003 报告):遵循计划挂点;subscribe 失败等无配对
  begin 的形态由 statsSessionEnd 定义语义兜底(thisAiMs=0、usage 零值照记、sessions+1)。
- **finally 兜底用零 usage**(T-003 报告):watch 抛异常时局部累加器不可达,抢救需
  外提签名,宁少不多。
- **watch() return 出口实为 7 个**(T-003 报告):计划写"8 个"系较早版本;逐一清点
  经 snapshot 全覆盖,不硬凑数字(handleIdleTest 的 5 个 return 是另一类型)。
- **◉ 行 1 用时取 report.thisAiMs**(`src/runner.ts:2270` 附近注释):与同行"累计"
  (session.aiMs)同基才有可比性;备选 durationMs 会与本基口径分裂。
- **等待区间 try/finally 配对 waitEnd(含异常路径)**(T-005 报告):readline 被拒/
  interactive 抛错不留悬挂关段。
- **waitBetweenTasks/askHuman 导出供单测直驱**(T-005 报告):对齐 subtaskProgressLine
  先例,接线本身(dir 透传、配对)必须有覆盖。
- **任务行"本进程"取墙钟差**(`src/loop.ts:999` 附近注释):T-002 心跳行已把"本进程"
  确立为墙钟口径,同词跨行必须同义;否决 AI 子集读法。
- **历轮累计单列两行不并入**(`src/loop.ts` roundCompleteLines 注释);**人工等待段
  仅 waitMs > 0 时输出**(与费用/思考项 0 省略同风格)。
- **cacheHit 口径落展示层纯函数 formatCacheHit** 而非 statsTotals 字段(T-001 S04)。

## H. 风险与边界(计划「风险与边界」六条,逐条写入)

1. **kill -9 损失上界 ≈ 心跳周期 30s**:折旧只承认到 lastWriteAt,宁少不多、绝不虚高。
2. **换机/清 `.auto/` 后统计从当下重开**:stats.json 是本机运行足迹、非事实来源,
   恢复正确性不受影响(不参与 `.auto/progress.json` 任何恢复判定)。
3. **同目录并发两个 run 不支持**:后写覆盖,偏小不炸;`--server` 指向他人实例时同理。
   已接受边界,不加锁文件。
4. **人工回退重跑同一任务与中断续跑不可区分** → 人工规程:重跑前
   `rm .auto/stats.json`(清零即删除文件)。
5. **digest/fork 前缀不重复计费**:逐 step-finish part 增量口径天然规避(服务端
   assistantMessage.tokens 是末步覆盖值、session.tokens 含 fork 继承前缀,均不可
   直接求和;逐 part 按 part.id 去重是唯一不重不漏的口径)。
6. **核心不变量零破坏**:退出码语义(0/1/2/130)、driver 独占写、统一提交、独立判定
   不 fork、开关不落盘——全部不受影响;统计所有写失败静默,永不影响流程。

## I. 实施步骤(勾选表,P1..P7 全部完成)

| 步 | 内容 | 落点 | 状态 |
|---|---|---|---|
| P1 | stats.ts 全量 + log.ts formatter 收口 + test/stats.test.ts | T-001(S01..S05) | ✅ 531 pass |
| P2 | loop 生命周期接线(loadStats/横幅/flushStats/statsPhase/statsTask)+ trackSubtasks 改累计 | T-002 | ✅ 534 pass |
| P3 | runner 会话边界(Watch.usage、step-finish 累加、7 return 补齐、begin/end/finally 兜底) | T-003 | ✅ 539 pass |
| P4 | ◉ 会话结束行两行化 + 无条件打印 | T-004 | ✅ 543 pass |
| P5 | 三处等待点扣时长(step.ts/waitBetweenTasks/askHuman) | T-005 | ✅ 549 pass |
| P6 | 任务三态行/阶段收口行/轮次完成行(含历轮累计段) | T-006 | ✅ 558 pass |
| P7 | 文档同步(本文、structure.md、behavior.md、README、AGENTS.md 导航) | T-007 | ✅ 本任务 |

手工冒烟(有凭证环境,`auto/` 集成分支):子任务中途 kill -9 → 重跑看续接横幅与
"其中本进程" ≠ 累计;--wait-between 不回车 40s → 该 40s 不进总用时进 waitMs;
rm/写坏 stats.json → 照常跑。
