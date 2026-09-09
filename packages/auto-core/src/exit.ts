// /exit 优雅退出(设计文档 docs/exit-resume-design.md): --interactive 常驻输入行
// 识别到 /exit 时置位;三处既有步进边界(phase/task/subtask,挂点同 step.ts)
// 逐一探测,命中第一处即在该安全落点抛出 ExitRequested——此刻 PLAN.md/CURRENT.md/
// .auto/progress.json 均已由该边界自身的常规收尾写好(与该处真实 crash/kill 中断
// 的现场完全同构),不需要任何额外的保存动作;下次运行据已持久化的进度精确恢复。
import type { Boundary } from "./step"

// 单进程一次性标记(每次 CLI 调用是独立进程,天然复位)。
let pending = false

export function requestExit(): void {
  pending = true
}

export function exitRequested(): boolean {
  return pending
}

// 仅供单测复位(bun test 单进程跑多个测试文件,模块级状态跨文件残留)。
export function resetExitRequest(): void {
  pending = false
}

export class ExitRequested extends Error {
  constructor(
    readonly boundary: Boundary,
    readonly label: string,
  ) {
    super(`/exit 已在 ${label} 边界生效`)
  }
}

// 三处步进边界共用的检查点,紧随 stepPause 调用之后触发:命中即抛出,交由
// loop.ts 顶层的 runAll 统一捕获转换为退出码 3(不占用 Outcome 的
// blocked/incomplete 通道——那两个通道意味着需要人工介入,/exit 不需要)。
export function maybeExit(boundary: Boundary, label: string): void {
  if (pending) throw new ExitRequested(boundary, label)
}
