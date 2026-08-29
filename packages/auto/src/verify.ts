import { access, chmod, constants, mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { verifyCommand, type Task } from "./plan"

// verify 产物统一落在目标目录下的 tmp/ 子目录(tmp/verify.sh、verify.out、
// verify.err): 位于工作目录内,会话(判定/生成)可直接读取,避免 /tmp 的权限
// 问题。run/init 会确保 tmp/ 与 .auto/logs/ 被 .gitignore 忽略(见 loop.ts
// ensureGitignore),清扫提交规则不受影响。
export function verifyTmpDir(dir: string): string {
  return join(resolve(dir), "tmp")
}

export type VerifyScript =
  | { kind: "existing"; script: string } // 直接使用既有可执行文件
  | { kind: "wrapped"; script: string } // driver 包装命令生成的 verify.sh
  | { kind: "generate" } // 需 AI 生成会话产出脚本

export const VERIFY_TIMEOUT_MS = 10 * 60 * 1000

// 依任务 verify 字段判定脚本来源(existing / wrapped / generate,见设计文档
// A.1)。wrapped 每次重新生成(幂等覆盖):verify 字段可能被人工改过。
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

// 在目标目录执行 verify 脚本:有执行位直接 spawn,否则经 bash 运行。
// stdout/stderr 经 Bun.file 写端整写 tmp/verify.out 与 verify.err
// (执行前 truncate;直接落文件不经管道,超时 kill 后孙进程占住管道也不会挂起
// 读取);退出码非 0 不直接判失败——判定权在 AI 会话。超时 kill 直接子进程,
// code 记 124(孙进程树不保证清理,V1 已知局限)。
export async function runVerifyScript(
  dir: string,
  script: string,
  timeoutMs: number = VERIFY_TIMEOUT_MS,
): Promise<{ code: number; ms: number; timedOut: boolean; out: string; err: string }> {
  const tmp = verifyTmpDir(dir)
  await mkdir(tmp, { recursive: true })
  const outPath = join(tmp, "verify.out")
  const errPath = join(tmp, "verify.err")
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
  const timer = setTimeout(() => {
    timedOut = true
    proc.kill()
  }, timeoutMs)
  await proc.exited
  clearTimeout(timer)
  const out = await Bun.file(outPath).text()
  const err = await Bun.file(errPath).text()
  return { code: timedOut || proc.exitCode === null ? 124 : proc.exitCode, ms: Date.now() - start, timedOut, out, err }
}

async function isExecutable(path: string): Promise<boolean> {
  return access(path, constants.X_OK).then(
    () => true,
    () => false,
  )
}
