# 休眠时段设计(避开 LLM 高收费时段)

2026-09-18 立项,同日 S1–S6 已实施(auto-core 分支)。

## 需求

LLM 服务存在高收费时段,需要一种机制让 driver 在指定时段暂停推进:`OPENCODE_AUTO_HIBERNATE="04:00+6"` 指定 UTC 自 04:00 起每日休眠 6 小时。到达休眠时间时优雅等待当前任务/子任务执行至安全退出点(`/exit` 点)后再暂停;度过休眠时段后,再随机延迟 0~600 秒继续执行后续工作。

## 事实基线

- 开关层:`src/switches.ts` 是全部 `OPENCODE_AUTO_*` 开关的唯一注册表(`SWITCH_ENV` 常量 + `Switches` 类型 + `parseSwitches` 纯函数 + memo),非法值 throw 中文报错,CLI 壳零改动,不落盘、不进 ProjectConfig(核心不变量「实验开关只读环境」)。
- 安全退出点:`src/exit.ts`/`src/step.ts` 已确立三处既有边界抽象(phase/task/subtask,`stepPause` + `maybeExit` 挂点)——命中时 PLAN.md/CURRENT.md/.auto/progress.json 均已由边界自身常规收尾写好,与该处真实 crash/kill 中断现场完全同构。三处分别位于 `src/loop-task.ts`(task 终态提交后)、`src/runner.ts`(子任务勾选+统一提交后,review fixrun 检查项同循环覆盖)、`src/loop-phase.ts`(阶段交接完成后)。
- 等待范式:长等待以 `statsWaitBegin(dir, reason)`/`statsWaitEnd(dir)` 包裹(wallMs/aiMs 扣除、单记 waitMs);分钟级 `Bun.sleep` 有既有先例(`src/session.ts` 重试阶梯与 awaitRecovery);等待期间双 Ctrl+C 经 `src/loop.ts` 进程级 SIGINT 处理器强退(130)。
- 无失效面:driver 无 lease/对外心跳机制,进程内睡眠数小时无任何状态过期;链内会话复用(REUSE_IDLE_MS 5 分钟)在长时间暂停后自然降级为开新会话,无害。

## 决策表

| # | 议题 | 结论 | 理由 |
|---|---|---|---|
| D1 | 实现方式 | **进程内睡眠**:边界处检测在窗口内 → `Bun.sleep` 至窗口结束 + 随机 0~600s → 继续 | 贴合需求字面;无需外部调度器。备选(ExitRequested 退场 + cron/systemd 重启)恢复精确性虽有设计保证,但要求用户另配调度,违背「配置休眠时段即可」的简洁意图 |
| D2 | 格式 | `HH:MM+H`:UTC、每日重复、单窗口;H 允许小数(6.5 = 6h30m),H ∈ (0,24);HH ∈ 00..23、MM ∈ 00..59;跨午夜(如 `22:00+8`)由窗口计算取模天然支持 | 最小表达力覆盖需求;多窗口留作后续扩展 |
| D3 | 随机延迟 | 窗口结束后固定随机 0~600 秒(`HIBERNATE_JITTER_MS`),随机源可注入供单测 | 需求给定值;错开同时唤醒的多实例 |
| D4 | 启动即窗口内 | preflight 完成后、server 拉起前先检查,在窗口内直接睡到唤醒 | 避免白做 housekeeping 与首个执行单元 |
| D5 | 触发语义 | 只在挂点检查「现在是否在窗口内」,不预判下一单元 | 当前单元跨越窗口开始时刻时,在其结束的边界自然被截停——即「优雅等待到安全退出点再暂停」的精确实现;零预估逻辑 |
| D6 | dryrun | 启动检查与边界挂点对 dryrun 零行为(预检非烧钱路径) | dryrun 只做权限预检,不经过任务/子任务边界;启动检查显式跳过 |
| D7 | 覆盖粒度 | 隐藏任务(planPhase/handoverPhase 蒸馏/k 阶段提取/advanceFinal 追加)与 verify 的 fixRound 内部不挂点 | 这些单元分钟级;fixrun 修复检查项走 runner 子任务循环已被覆盖。声明为已知取舍 |
| D8 | 挂点顺序 | `stepPause` → `maybeExit` → `hibernatePause` | /exit 优先响应人工意图;休眠是最后的环境约束 |
| D9 | 唤醒后不复查 | 睡眠一次到位,唤醒后不重新检查窗口 | 系统挂起导致睡过头只会更晚恢复,语义仍满足「度过休眠时段后继续」;窗口判定在下一边界自然再生效 |

## 实现

- `src/switches.ts`:`SWITCH_ENV.hibernate` + `Switches.hibernate: HibernateWindow | undefined`(缺省 undefined = 不休眠,现状零变化)+ `parseHibernate`(正则 `^(\d{1,2}):(\d{2})\+(\d+(?:\.\d+)?)$`,越界 throw 中文报错)+ `formatHibernate`(规范写法 HH:MM+H 供日志/单测)。
- `src/hibernate.ts`(新模块):`hibernateSleepMs(window, now, random)` 纯函数(UTC 当日分钟定位、跨午夜取模、窗口起点含/终点不含、附随机延迟)+ `hibernatePause(label, opts)` 挂点(开关未设零行为;睡眠区间 `statsWaitBegin(dir, "hibernate")`/`statsWaitEnd(dir)` 包裹;`now`/`random`/`sleep`/`window` 注入供单测)。
- 接线四处:`src/loop-task.ts` task 边界、`src/runner.ts` subtask 边界、`src/loop-phase.ts` phase 边界(均在 `maybeExit` 之后)、`src/loop.ts` preflight 后 server 拉起前(dryrun 跳过)。

## 勾选表

- [x] S1: switches.ts 开关解析(类型/缺省/parse/render/日志登记)
- [x] S2: src/hibernate.ts 新模块(纯函数 + 挂点)
- [x] S3: 四处接线(task/subtask/phase 边界 + 启动检查)
- [x] S4: 测试(test/switches.test.ts 解析与日志用例 + test/hibernate.test.ts 窗口计算与挂点用例;864 全绿)
- [x] S5: 本文档 + 包级/根 AGENTS.md 导航
- [x] S6: 验证(`bun typecheck` 干净、`bun test` 全绿;`packages/auto` typecheck 确认壳零改动)
