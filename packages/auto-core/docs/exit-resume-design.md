# /exit 优雅退出与恢复设计

状态: 已实施(2026-09-09)。

## 1. 动机

`--interactive` 常驻输入行目前把任意非空回车行都当作发往当前活动会话的用户
消息(steer 语义)。长时间挂机运行时,人工希望能安全地叫停程序——不是任由它
跑到下一个阻塞/完成点,也不是粗暴 kill(容易正好打在一次工具调用、文件写入
或统一提交中途,留下脏现场)。`/exit` 提供"预约式"退出:立即确认收到,但真正
的暂停延迟到下一个既有的安全边界,随后照常保存进度;下次运行凭已持久化的
状态精确恢复——与任何一次真实 crash/kill 中断的恢复路径完全同构,不引入新的
恢复机制。

## 2. 触发

仅 `--interactive` 常驻输入行识别:一行 trim 后**完全等于** `/exit`(大小写
敏感,不做归一化)。识别位置在空行判断之后、会话转发之前——不发往会话。
`pending`(正在等待 ask 或步进硬暂停的回答)状态下不特判,输入原样作答——
/exit 只在"发消息"语境下承诺退出,避免在"回答别的问题"语境下产生歧义。
无活动会话(`sessionID` 未 attach)时同样置位——与消息转发"无活动会话则丢弃"
的语义不同,/exit 的意图与是否已连上会话无关。

置位是单进程一次性标记,无撤销入口:重复输入 /exit 无副作用;真要立刻强退,
双击 Ctrl+C(退出码 130)仍是最快通道,两者不冲突,互不影响。

## 3. 落点(与 step.ts 的三级边界完全复用)

| 边界 | 位置 | 时机 |
|---|---|---|
| subtask | `src/runner.ts` pipeline 子任务循环 | 检查项勾选与统一提交完成后、下一检查项前 |
| task | `src/loop.ts` runTaskLoop | 任务终态提交后、终审路由与下一任务前 |
| phase | `src/loop.ts` runPhaseLoop(handoverWithStep) | 阶段交接(归档+台账+提交)完成后、下一轮路由前 |

三处各自紧邻既有 `stepPause` 调用之后插入 `maybeExit(boundary, label)`——该处
的 PLAN.md/CURRENT.md/`.auto/progress.json` 已经是这个边界的正常收尾结果,
`maybeExit` 只是"提前停在这里",不做任何额外的保存动作。边界覆盖范围与
step-mode-design.md §5 的边界情况完全一致(--subtask off/ondemand 无 subtask
落点、单阶段 `m` 模式无 phase 落点等)。

## 4. 传播与退出码

`maybeExit` 命中时抛出 `ExitRequested`(普通异常,携带 boundary/label),**不**
占用 `Outcome` 的 `blocked`/`incomplete` 通道——那两个通道的语义是"需要人工
介入"(阻塞原因写 PLAN.md、任务回退 pending),/exit 不是,重新运行不需要人工
填任何字段。异常沿调用栈一路上抛,跳过 `runTask` 的非完成结局收尾(那段逻辑
专为真正的阻塞/pending 准备:改会话标题为 blocked/pending、写 CURRENT.md 中断
备注),避免误标状态。`src/loop.ts` 的 `runAll` 顶层统一捕获,转换为退出码 `3`
(新增,区别于 `2` 的"阻塞/pending 需人工"),既有 `finally` 中的
`repl?.close()`/`server?.close()`/`unprotect(directory)` 照常执行。

## 5. 恢复

不引入新的恢复路径——退出发生的位置本身就是三处既有边界之一,恢复完全复用
`resume.ts` 已有的语义(`recallProgress` 按 active/会话存活判定复用会话或开新
会话、按 `phase` 精确重入流水线),与该边界处发生真实 crash/kill 时的恢复路径
逐字节相同,详见 `src/resume.ts` 顶部注释与 `runTask` 中断恢复段。

## 6. 边界情况

- 非 `--interactive` 运行:无常驻输入行,/exit 无从触发,零行为。
- 单阶段 `m` 模式(`--phases` 缺省):无 phase 边界,task/subtask 边界照常。
- `--subtask off/ondemand`:无 subtask 边界,task/phase 边界照常——一次 /exit
  最长等到当前任务完成(与该模式下 `OPENCODE_AUTO_STEP=task` 的粒度上限一致)。
- 与步进模式(`OPENCODE_AUTO_STEP`)独立共存:同一边界先 `stepPause` 硬等待
  人工放行,放行后再判定 `exitRequested`,顺序不影响语义,可同时生效。
- `--dryrun`/`init`/`check`/`status` 无这三处落点,天然不受影响(与步进模式
  同口径)。

## 7. 实现

- `src/exit.ts`:`requestExit`/`exitRequested`/`maybeExit(boundary, label)`/
  `ExitRequested`,模块级单进程一次性标记(`resetExitRequest` 供单测复位)。
- `src/interactive.ts`:`rl.on("line")` 新增 /exit 分支(pending 与空行判断
  之后、会话转发之前拦截,不转发,不要求已 attach 会话)。
- `src/loop.ts`:task/phase 两处 `stepPause` 之后各调用一次 `maybeExit`;
  `runAll` 顶层 `try`/`finally` 之间新增 `catch (ExitRequested)` → log + 退出码 3。
- `src/runner.ts`:subtask 循环的 `stepPause` 之后调用 `maybeExit`。
- `docs/behavior.md`:退出码表新增 `3`,`--interactive` 一条补充 /exit 行为。

## 8. 测试

- `test/exit.test.ts`:`maybeExit` 命中/不命中、`requestExit` 幂等、异常携带
  正确的 boundary/label。
- `test/interactive.test.ts`:/exit 不发往会话且置位 `exitRequested`(含无活动
  会话场景),置位后输入行继续可用、后续消息照常转发。

## 9. 未覆盖范围(有意从简)

- ask/步进暂停等待中输入 /exit 不特判——仍按原语义作答。如需扩展为"任意场景
  下输入 /exit 都优先生效",需要在 `pending` 分支内也做一次 /exit 识别并回落
  该次等待(`settle(undefined)`),另议。
- 未提供"取消已置位的退出请求"的交互;单次运行内 /exit 是单向操作。
