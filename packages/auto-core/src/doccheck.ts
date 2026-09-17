// 文档形检的确定性判据(session-boundary-hardening 设计 §4.3/§4.5/§4.6): 子任务
// 声明产物(D4)、自动会话产物(D5)与全量文档终止符扫描(D6)共用的「非平凡 +
// 末行终止符」检查。纯函数叶子模块,不做任何 IO;eof 只证明「写完了」(机械
// 可判定),质量归 verify/review。

// 非语义终止符: 与 handoff/testhandoff 的 `状态:` 行刻意异构——避免撞语义,也
// 避免给 report 等跨任务叙事文件盖「完成」字样(D5 决策)。
export const EOF_MARK = "<!-- auto: eof -->"

// 非平凡阈值(保守,按去空白后字符数): 低于此长度的新建 .md 视为空壳/截断嫌疑。
export const MIN_DOC_CHARS = 120

// 末行终止符判定: 最后一个非空行恰为终止符(其后只允许空行;终止符之后再有
// 正文即不过——正是「追加在终止符之后」的截断形态)。
export function endsWithEof(text: string): boolean {
  return text.trimEnd().split("\n").at(-1)?.trim() === EOF_MARK
}

// 单文档形检问题清单(空 = 通过): path 进问题文案供重提示反馈引用。
export function docShapeProblems(text: string, path: string): string[] {
  const trimmed = text.trim()
  const problems: string[] = []
  if (trimmed.length < MIN_DOC_CHARS) {
    problems.push(`${path}: 内容过短(${trimmed.length} 字符 < 阈值 ${MIN_DOC_CHARS}),疑似空壳或截断`)
  }
  if (!endsWithEof(text)) problems.push(`${path}: 末行终止符缺失(最后一行正文须为 ${EOF_MARK})`)
  return problems
}

// D2/D4 形检是否启用(session-boundary-hardening §4.3): dryrun / 提交门禁关闭
// (--commit false 已退役,防御性保留)/ 非 git(无基线)不判;测试交接收场会话
// 豁免——其完成判据在 testhandoff.md,已由交接边界写核覆盖(现接线 runExecSession
// 不把 testHandover 结果外透给 runSubtask,守卫按设计显式保留)。
export function shapeCheckOn(
  opts: { dryrun?: boolean; commit?: boolean },
  baseline: { length: number } | undefined,
  testHandover: boolean,
): boolean {
  if (opts.dryrun || opts.commit === false) return false
  if (!baseline?.length) return false
  return !testHandover
}
