import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

// 会话记忆: run 期间 driver 把任务链上的当前会话 ID 持久化到目标目录
// .auto/session.json;应用崩溃/被强制终止后重新运行时,若距上次记录不超过
// RESUME_WINDOW_MS 且会话在 server 上仍存在,则复用该会话继续(上下文不丢);
// 超窗或会话已不可用则开新会话,并在首个提示词中告知 AI 这是任务/子任务中断后
// 的继续。任务结束(完成/阻塞/回退)即删除记忆。
export const RESUME_WINDOW_MS = 30 * 60 * 1000
export const RESUME_WINDOW_MINUTES = RESUME_WINDOW_MS / 60_000

export type RememberedSession = { task: string; session: string; at: number }

const FILE = join(".auto", "session.json")

export async function rememberSession(dir: string, task: string, session: string) {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, FILE), JSON.stringify({ task, session, at: Date.now() }))
}

// 任务结束(任何 Outcome)即删除记忆;force 使缺失时也无害。
export async function forgetSession(dir: string) {
  await rm(join(dir, FILE), { force: true })
}

// 读取属于该任务的记忆会话(不校验时间窗——超窗也要提示"中断后的继续",窗口
// 判定在 runner)。任务不符、文件缺失或损坏返回 undefined。
export async function recallSession(dir: string, task: string): Promise<RememberedSession | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (!raw) return undefined
  try {
    const remembered = JSON.parse(raw) as Partial<RememberedSession>
    if (remembered.task !== task || typeof remembered.session !== "string") return undefined
    return { task, session: remembered.session, at: typeof remembered.at === "number" ? remembered.at : 0 }
  } catch {
    return undefined
  }
}
