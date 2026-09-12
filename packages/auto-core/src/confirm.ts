// 破坏性操作的交互确认(init 全量覆盖、reset 反初始化): 仅在交互式终端提问,
// 非 TTY(CI、脚本、测试的 Bun.spawn)视为已授权直接放行——非交互环境没有人
// 能回答,提问只会挂死;真正的防误触在非交互侧由工作区干净度闸门(git.ts 的
// changedFiles)承担。io 可注入,沿用 interactive.ts / step.ts 的同款惯例,
// 使单测无须真 TTY。
import { createInterface } from "node:readline/promises"

export type ConfirmIO = { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; tty?: boolean }

// 仅 y / yes(忽略大小写、忽略首尾空白)为真;空行与其余一律为假(缺省不执行)。
// stdin 关闭(管道结束)同样回落为假——破坏性操作不因输入意外中断而放行。
export async function confirm(question: string, io?: ConfirmIO): Promise<boolean> {
  const tty = io?.tty ?? process.stdin.isTTY
  if (!tty) return true
  const rl = createInterface({ input: io?.input ?? process.stdin, output: io?.output ?? process.stdout })
  rl.on("SIGINT", () => process.kill(process.pid, "SIGINT"))
  const closed = new Promise<undefined>((resolve) => rl.on("close", () => resolve(undefined)))
  try {
    const answer = await Promise.race([rl.question(question), closed])
    const normalized = (answer ?? "").trim().toLowerCase()
    return normalized === "y" || normalized === "yes"
  } finally {
    rl.close()
  }
}
