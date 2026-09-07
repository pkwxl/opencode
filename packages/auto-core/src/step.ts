// 步进模式(OPENCODE_AUTO_STEP,设计文档 docs/step-mode-design.md): phase/task/
// subtask 三级包含式粒度,在对应(及更粗)的流水线边界硬暂停——phase 交接完成后、
// task 终态提交后、subtask 勾选提交后;任意输入行(含空回车)放行,无超时自动
// 继续(区别于 --wait-between 的带超时暂停)。暂停等待期间 ^C 转发进程级处理器,
// 连续两次 Ctrl+C 强退 130(与 askHuman/waitBetweenTasks 一致)。
import { createInterface } from "node:readline/promises"
import type { Interactive } from "./interactive"
import { log } from "./log"
import { autoSwitches, type StepMode } from "./switches"

// 边界与档位的细度序(off 恒为 0): 值越细序越大,边界序 ≤ 档位序即暂停。
const RANK: Record<StepMode | Boundary, number> = { off: 0, phase: 1, task: 2, subtask: 3 }

// 流水线边界(kind): phase = --phases 阶段交接完成;task = 任务终态提交完成;
// subtask = 检查项勾选提交完成。
export type Boundary = "phase" | "task" | "subtask"

// 档位是否覆盖该边界(纯函数,供单测): 包含式——subtask 覆盖全部边界,task 覆盖
// task 与 phase,phase 只覆盖 phase,off 全不暂停。
export function stepApplies(step: StepMode, boundary: Boundary): boolean {
  return RANK[boundary] <= RANK[step]
}

// 边界处步进暂停: 开关 off(缺省)时零行为直接返回;否则硬等待一行人工输入后
// 放行(不解释输入内容,空回车即继续)。interactive = --interactive 的常驻输入行
// (免两个 readline 争抢 stdin;其 close 回落语义同样适用);step 显式覆盖档位
// (缺省取 OPENCODE_AUTO_STEP 解析值,注入供单测);io 注入供单测。
export async function stepPause(
  boundary: Boundary,
  label: string,
  opts: { interactive?: Interactive; step?: StepMode; io?: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } } = {},
): Promise<void> {
  const step = opts.step ?? autoSwitches().step
  if (!stepApplies(step, boundary)) return
  const promptText = `⏸ 步进暂停(step=${step}): ${label} 已完成,回车继续: `
  if (opts.interactive) {
    await opts.interactive.question(promptText)
  } else {
    const rl = createInterface({ input: opts.io?.input ?? process.stdin, output: opts.io?.output ?? process.stdout })
    // raw 模式下 ^C 不会触发进程级 SIGINT,readline 会截获;转发给进程级
    // 处理器,使暂停等待期间连续两次 Ctrl+C 同样能强制终止。
    rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
    // stdin 关闭(管道结束等): 回落 undefined 自动放行,与 interactive 的 close 语义一致。
    const closed = new Promise<undefined>((resolve) => rl.on("close", () => resolve(undefined)))
    try {
      await Promise.race([rl.question(promptText), closed])
    } finally {
      rl.close()
    }
  }
  log(`→ 步进放行: ${label}`)
}
