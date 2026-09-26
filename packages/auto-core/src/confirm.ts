// Interactive confirmation for destructive operations (init full overwrite,
// reset de-initialization): asks only on an interactive terminal; non-TTY
// (CI, scripts, tests' Bun.spawn) counts as authorized and goes straight
// through — nobody can answer in a non-interactive environment, asking would
// only hang. The real guard against accidental invocation on the
// non-interactive side is carried by the worktree cleanliness gate (git.ts
// changedFiles). io is injectable, same convention as interactive.ts /
// step.ts, so unit tests need no real TTY.
import { createInterface } from "node:readline/promises"

export type ConfirmIO = { input?: NodeJS.ReadableStream; output?: NodeJS.WritableStream; tty?: boolean }

// Only y / yes (case-insensitive, surrounding whitespace ignored) is true;
// an empty line and anything else is false (default: do not execute). A
// closed stdin (end of pipe) likewise falls back to false — a destructive
// operation is not let through because input ended unexpectedly.
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
