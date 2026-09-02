import { access, chmod, constants, mkdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { join, resolve } from "node:path"
import { verifyCommand, type Task } from "./plan"

// verify 产物统一落在目标目录下的 tmp/ 子目录(tmp/verify.sh、verify.out、
// verify.err;--test-by-driver 的测试脚本同用该目录: tmp/test.sh 待执行、
// test.<n>.sh/out/err 按序归档): 位于工作目录内,会话(判定/生成)可直接读取,
// 避免 /tmp 的权限问题。run/init 会确保 tmp/ 与 .auto/logs/ 被 .gitignore 忽略
// (见 loop.ts ensureGitignore),清扫提交规则不受影响。
export function verifyTmpDir(dir: string): string {
  return join(resolve(dir), "tmp")
}

export type VerifyScript =
  | { kind: "existing"; script: string } // 直接使用既有可执行文件
  | { kind: "wrapped"; script: string } // driver 包装命令生成的 verify.sh
  | { kind: "generate" } // 需 AI 生成会话产出脚本

// 无进度判定窗口缺省值: verify.out/verify.err 连续这么久无任何增长才 kill
// (--verify-idle n 分钟覆盖)。只要脚本持续有输出,运行时长不受限。
export const DEFAULT_VERIFY_IDLE_MS = 10 * 60 * 1000

export type VerifyRunResult = {
  code: number
  ms: number
  timedOut: boolean
  // 超时原因: idle = 持续无输出被终止;max = 超过绝对时长上限被终止。
  timeoutReason?: "idle" | "max"
  out: string
  err: string
}

// 依任务 verify 字段判定脚本来源(existing / wrapped / generate,见设计文档
// A.1)。wrapped 每次重新生成(幂等覆盖):verify 字段可能被人工或判定会话改过。
export async function resolveVerifyScript(task: Task, dir: string): Promise<VerifyScript> {
  const cmd = verifyCommand(task)
  if (!cmd) return { kind: "generate" }
  if (/^\S+$/.test(cmd) && !cmd.startsWith("-")) {
    const script = resolve(dir, cmd)
    if (await isExecutable(script)) return { kind: "existing", script }
  }
  const script = join(verifyTmpDir(dir), "verify.sh")
  await mkdir(verifyTmpDir(dir), { recursive: true })
  // 首行 shebang,其后为原命令原文;不加 set -e 等额外语义,退出码原样透传。
  await Bun.write(script, `#!/usr/bin/env bash\n${cmd}\n`)
  await chmod(script, 0o755)
  return { kind: "wrapped", script }
}

// 在目标目录执行 driver 托管脚本(verify 与 --test-by-driver 的 test 脚本共用):
// 有执行位直接 spawn,否则经 bash 运行。stdout/stderr 经 Bun.file 写端整写输出
// 文件(执行前 truncate;直接落文件不经管道,超时 kill 后孙进程占住管道也不会
// 挂起读取);退出码非 0 不直接判失败——判定权在 AI 会话。缺省输出为 tmp/verify.out
// 与 verify.err;opts.out/err 指定其他绝对路径(如 test.<n>.out/err 按序归档)。
// 超时是进度看门狗而非固定时长: 每隔 pollMs 轮询两个输出文件的大小,任一增长
// 即视为有进度并重置 idle 计时;连续 idleMs 无增长才 kill(idle)。maxMs > 0 时
// 另设绝对时长上限(max)。kill 直接子进程,孙进程树不保证清理(V1 已知局限)。
export async function runVerifyScript(
  dir: string,
  script: string,
  opts: { idleMs?: number; maxMs?: number; pollMs?: number; out?: string; err?: string } = {},
): Promise<VerifyRunResult> {
  const idleMs = opts.idleMs ?? DEFAULT_VERIFY_IDLE_MS
  const maxMs = opts.maxMs ?? 0
  const pollMs = opts.pollMs ?? 5_000
  const tmp = verifyTmpDir(dir)
  await mkdir(tmp, { recursive: true })
  const outPath = opts.out ?? join(tmp, "verify.out")
  const errPath = opts.err ?? join(tmp, "verify.err")
  await Bun.write(outPath, "")
  await Bun.write(errPath, "")
  const start = Date.now()
  const proc = Bun.spawn({
    cmd: (await isExecutable(script)) ? [script] : ["bash", script],
    cwd: dir,
    stdout: Bun.file(outPath),
    stderr: Bun.file(errPath),
  })
  let timedOut = false
  let timeoutReason: "idle" | "max" | undefined
  let outSize = 0
  let errSize = 0
  let lastProgress = start
  const timer = setInterval(() => {
    const out = sizeOf(outPath)
    const err = sizeOf(errPath)
    if (out > outSize || err > errSize) {
      outSize = out
      errSize = err
      lastProgress = Date.now()
    }
    if (timedOut) return
    const now = Date.now()
    if (maxMs > 0 && now - start >= maxMs) {
      timedOut = true
      timeoutReason = "max"
      proc.kill()
      return
    }
    if (now - lastProgress >= idleMs) {
      timedOut = true
      timeoutReason = "idle"
      proc.kill()
    }
  }, pollMs)
  await proc.exited
  clearInterval(timer)
  const out = await Bun.file(outPath).text()
  const err = await Bun.file(errPath).text()
  return { code: timedOut || proc.exitCode === null ? 124 : proc.exitCode, ms: Date.now() - start, timedOut, timeoutReason, out, err }
}

// statSync 而非异步 stat: 轮询回调里避免与下一次 tick 竞态;缺失按 0(尚未建表)。
function sizeOf(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  )
}
