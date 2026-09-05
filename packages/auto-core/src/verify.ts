import { access, chmod, constants, mkdir } from "node:fs/promises"
import { statSync } from "node:fs"
import { join, resolve } from "node:path"
import { verifyCommand, type Task } from "./plan"

// verify 产物统一落在目标目录下的 tmp/ 子目录(tmp/verify.sh、verify.out;
// --test-by-driver 的测试脚本同用该目录: tmp/test.sh 为请求标记、test.<n>.out
// 按序归档,被引用的脚本本身在 test/ 目录): 位于工作目录内,会话(判定/生成)
// 可直接读取,避免 /tmp 的权限问题。run/init 会确保 tmp/ 与 .auto/logs/ 被
// .gitignore 忽略(见 loop.ts ensureGitignore),清扫提交规则不受影响。
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
  // stdout 与 stderr 合并后的整文件内容(driver 执行脚本统一合并为单输出文件,
  // 见 runVerifyScript)。内容字段目前仅作日志/调试,判定会话读的是磁盘路径。
  out: string
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
// stdout 与 stderr 经 shell 重定向合并落入单个输出文件(`> out 2>&1`,tee 等价但
// 非交互下更干净、kill 后不留管道;直接落文件不经管道,超时 kill 后孙进程占住
// 输出 fd 也不会挂起读取)。执行前 truncate;退出码非 0 不直接判失败——判定权在
// AI 会话。缺省输出为 tmp/verify.out;opts.out 指定其他绝对路径(test 脚本按序
// 归档为 tmp/test.<n>.out)。超时是进度看门狗而非固定时长: 每隔 pollMs 轮询输出
// 文件大小,有增长即视为有进度并重置 idle 计时;连续 idleMs 无增长才 kill(idle)。
// maxMs > 0 时另设绝对时长上限(max)。kill 直接子进程,孙进程树不保证清理(V1 已知局限)。
export async function runVerifyScript(
  dir: string,
  script: string,
  opts: { idleMs?: number; maxMs?: number; pollMs?: number; out?: string } = {},
): Promise<VerifyRunResult> {
  const idleMs = opts.idleMs ?? DEFAULT_VERIFY_IDLE_MS
  const maxMs = opts.maxMs ?? 0
  const pollMs = opts.pollMs ?? 5_000
  const tmp = verifyTmpDir(dir)
  await mkdir(tmp, { recursive: true })
  const outPath = opts.out ?? join(tmp, "verify.out")
  await Bun.write(outPath, "")
  const start = Date.now()
  // 经 bash -c 以位置参数注入脚本与输出路径,免 shell 引用;脚本自身 stdout/stderr
  // 由内层重定向合并到输出文件,外层 bash 无输出。可执行脚本直接 exec,否则经 bash。
  const exec = await isExecutable(script)
  const proc = Bun.spawn({
    cmd: ["bash", "-c", `${exec ? 'exec "$0"' : 'bash "$0"'} > "$1" 2>&1`, script, outPath],
    cwd: dir,
    stdout: "ignore",
    stderr: "ignore",
  })
  let timedOut = false
  let timeoutReason: "idle" | "max" | undefined
  let outSize = 0
  let lastProgress = start
  const timer = setInterval(() => {
    const out = sizeOf(outPath)
    if (out > outSize) {
      outSize = out
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
  return { code: timedOut || proc.exitCode === null ? 124 : proc.exitCode, ms: Date.now() - start, timedOut, timeoutReason, out }
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
