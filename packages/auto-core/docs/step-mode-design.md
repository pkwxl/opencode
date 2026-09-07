# 步进模式(Step Mode)设计

状态: 已实施(2026-09-07)。实验期经环境变量控制,CLI 壳零改动。

## 1. 动机

调试与观摩流水线时,需要在关键边界停下来人工检查产物(git log、docs/、PLAN.md)
后再手动放行。既有的 `--wait-between` 是任务间的**带超时**暂停(超时自动继续),
不适合"必须人工看过才继续"的步进场景;步进模式提供**硬暂停**(无限期等待回车)。

## 2. 开关

| 环境变量 | 值域 | 缺省 |
|---|---|---|
| `OPENCODE_AUTO_STEP` | off\|phase\|task\|subtask | off |

注册于 `src/switches.ts` 的 OPENCODE_AUTO_* 注册表:核心内一次解析(memo)、
全流水线一致、不落盘(实验语义 = 本次运行)、非法值 throw 中文报错(含变量名
与期望值域)→ CLI 退出码 1。非默认生效项进入启动日志,与既有开关同口径。

## 3. 语义

### 3.1 包含式粒度

phase < task < subtask 三级细度,**边界序 ≤ 档位序即暂停**:

| 档位 | 暂停边界 |
|---|---|
| off | 无(缺省,零行为) |
| phase | 阶段交接完成 |
| task | 任务完成 + 阶段交接完成 |
| subtask | 子任务完成 + 任务完成 + 阶段交接完成 |

### 3.2 硬暂停

- 等待一行人工输入,任意行(含空回车)放行,不解释内容,**无超时自动继续**
  (区别于 `--wait-between`)。
- `--interactive` 下经常驻输入行接收(`Interactive.question` 的无超时形态),
  免两个 readline 争抢 stdin;stdin 关闭(管道结束)回落自动放行。
- 暂停等待期间 ^C 转发进程级处理器:单次提示、连续两次强退 130
  (与 askHuman / waitBetweenTasks 一致)。

## 4. 挂点

| 边界 | 位置 | 时机 |
|---|---|---|
| phase | `src/loop.ts` runPhaseLoop(handoverWithStep 包装) | 阶段交接(归档+台账+提交)完成后、下一轮路由前;最后一个阶段暂停后回车即"全部阶段已完成"退出 |
| task | `src/loop.ts` runTaskLoop | 任务 done 终态提交后、终审路由与下一任务前(终审追加的 T-F 任务同暂停) |
| subtask | `src/runner.ts` pipeline 子任务循环 | 检查项勾选与统一提交完成后、下一检查项前(review 注入的 fix 检查项同循环,一并覆盖) |

## 5. 边界情况

- 单阶段 `m` 模式(`--phases` 缺省):无 handover 边界 → `step=phase` 无暂停点;
  task/subtask 暂停照常生效。
- `--subtask off/ondemand`:无检查项循环 → 无 subtask 暂停点;task/phase 照常。
- 与 `--wait-between` 相互独立(一个硬暂停一个带超时),同时设置则各自生效。
- `--dryrun` / `init` / `check` / `status` 无暂停点,天然不受影响。
- 任务的最后一个检查项完成后紧跟 task 暂停,phase 的最后一个任务完成后紧跟
  phase 暂停——包含式语义下连续两暂停属预期。

## 6. 实现与测试

- `src/step.ts`:`stepApplies(step, boundary)` 纯函数(细度序判定,单测直测);
  `stepPause(boundary, label, opts)` 暂停 IO(interactive 常驻行 / readline 硬等待,
  io 注入供单测;opts.step 显式覆盖档位,缺省取 OPENCODE_AUTO_STEP 解析值)。
- `src/interactive.ts`:`question(promptText, minutes?)` 的 minutes 缺省 = 无超时
  (close 仍回落 undefined),askHuman / waitBetweenTasks 调用点不变。
- 测试:`test/switches.test.ts`(值域/缺省/非法值/日志)+ `test/step.test.ts`
  (包含式矩阵、回车放行、stdin 关闭回落、interactive 透传)。

## 7. 转正路径

实验定型后升为 CLI 旗标 `--step=phase|task|subtask`(或宪法键固化,另议),
路径同 fork-decompose-design.md §4.6:环境变量可保留为运行期覆盖通道或退役。
