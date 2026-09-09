import { join } from "node:path"

// AGENTS.md 的 opencode-auto 块: 单一标记块,内容 = 指针 + 验证原则(verify 开关)+
// 测试执行原则(testByDriver 开关)+ 提交原则 + 摘要原则(非交互场景不产出会话末尾
// 总结)+ 维护规则 + 引用规范,合并为一段英文文本。段落以数组 filter/join 拼接
// (\n\n 分隔),不走 template.ts 的 {{#if}} 引擎——标签独占一行吞掉整行换行的语义
// 会在开关关闭时让相邻段落粘连、丢失分隔空行,数组拼接不依赖该语义,恒为一个
// 空行分隔。
export const AGENTS_BLOCK_START = "<!-- opencode-auto:start -->"
export const AGENTS_BLOCK_END = "<!-- opencode-auto:end -->"

// 唯一标准块(无 name 段)。
const CANONICAL_BLOCK = /<!--\s*opencode-auto:start\s*-->[\s\S]*?<!--\s*opencode-auto:end\s*-->/

// 任何带 `:<name>:` 段的 opencode-auto 块——旧六块格式(verify/test/commit/maint/
// refs)或未来任何游离标记块;不匹配上面的裸 start/end 标准块。
export const LEGACY_BLOCK = /<!--\s*opencode-auto:([\w-]+):start\s*-->[\s\S]*?<!--\s*opencode-auto:\1:end\s*-->\n*/g

const POINTER = `This directory is driven by opencode-auto. The session prompt already inlines the task for this turn, so you normally don't need to read state files separately. \`CURRENT.md\` (when present) mirrors the current task's full content and progress: read it if context has been compacted, or whenever you are unsure about the current task or its progress — its content takes priority over anything in session memory. Do not edit \`CURRENT.md\` or \`PLAN.md\`; they are maintained exclusively by the driver.`

const VERIFY_PRINCIPLE = `Verify principle: task-level verification scripts and verification commands are always run by the driver outside the session — no session should run them directly to reach an acceptance conclusion; acceptance criteria live in the task's \`verify\` field. If a session judges the verification script itself to be flawed, it may write a new verification script to replace the designated one (\`tmp/verify.sh\`, a driver-managed working directory inside the target directory); the driver re-runs it and relays the output to an independent judging session. With driver authorization, a judging session may also update the \`verify\` field of later, not-yet-done tasks in \`PLAN.md\` (to carry forward verification experience — limited strictly to the \`verify\` field); beyond that, \`PLAN.md\` and \`CURRENT.md\` remain exclusively maintained by the driver. Task descriptions and project conventions must not contain instructions that contradict this.`

const TEST_PRINCIPLE = `Test principle: build, test, compile, and lint commands — which can be slow or produce large amounts of output — are always run by the driver outside the session; no session should run them directly. When needed, write the command as a script under \`test/\`, then write that script's path into \`tmp/test.sh\` to tell the driver to run it. After running it, the driver reports the exit code and the output file path (stdout and stderr merged into one file) back to the session, which reads the file directly to judge the result. Task descriptions and project conventions must not contain instructions that contradict this.`

const COMMIT_PRINCIPLE = `Commit principle: after a session ends, the driver performs one unified recursive commit of every change (nested sub-repositories first, then this repository), with commit messages carrying the task number and phase; no session should ever run \`git commit\`/\`amend\`/\`rebase\` or any other commit-type command, nor alter commit history. Background worth preserving belongs in \`docs/\` documents, which the driver's commit picks up automatically. Task descriptions and project conventions must not contain instructions that contradict this.`

const SUMMARY_PRINCIPLE = `Summary principle: do not produce a closing summary or wrap-up narration in your final chat turn when a session finishes. The driver is non-interactive and never reads chat text, and this system runs many unattended agent sessions back-to-back, so a spoken summary at the end of each one is pure wasted tokens with no reader. Anything worth keeping belongs in \`docs/\` files (or the task's report, where applicable) — once the required file writes are done, end the turn. Task descriptions and project conventions must not contain instructions that contradict this.`

const MAINT_RULE = `AGENTS.md maintenance rules (this file is a workflow entry point, not a knowledge base):
1. Stay concise: the whole file must not exceed 150 lines; do not record implementation details, long explanations, command output, or single-task knowledge.
2. Route, don't duplicate: module-, phase-, or task-specific information goes into \`docs/agents/<topic>.md\`; this file keeps only a one-line routing entry (topic → path).
3. Update, don't append: before adding anything new, check whether an existing rule or routing entry should be revised instead; retire stale content rather than accumulating historical notes.
4. Only durable workflow knowledge belongs here: record only conventions that affect how most future tasks are carried out; temporary debugging state, one-off decisions, and conversation history do not belong here (log one-off decisions as an \`AUTO-DECISION\` entry in the relevant document instead).`

const REFS_SPEC = `Reference and storage conventions (stable references; see the stable-refs design document for the full rationale):
1. Storage: task documents live only under \`docs/T-NNN/\` (\`context\`/\`subtasks\`/\`report\`/\`audit\`/\`fix\`/\`handoff\`/\`testhandoff.md\`); subtask artifacts live only under \`docs/T-NNN/S<2-digit-seq>/\` (\`index.md\`, \`testhandoff.md\`); final-review artifacts live under \`docs/T-F<k>/\`; each round has one round directory \`docs/R-NN/\` (created at the start of the round, never moved afterward): the phase ledger \`phases.md\`, phase archives \`<letter>-<slug>/\`, phase handovers \`handovers/<letter>-<slug>.md\`, phase-level artifacts \`phase-docs/<letter>-<slug>/\`, migration knowledge \`migration-kb.md\`, and prior knowledge \`prior-kb.md\` all live inside the round directory. Once created, these paths are permanent — never move them, never rename them.
2. References: references between documents, and references into code, are always written as paths relative to the target directory root (for example \`docs/T-003/S04/index.md\`, \`src/runner.ts:120\`, in backticks or as links), optionally with a \`:line\` anchor; the anchor may further carry an \`@<sha>\` version marker (for example \`src/runner.ts:120@abc1234\`, meaning that range is valid only for that historical revision and is exempt from line-number checking). Do not reference state files inside round directories (the \`phases.md\` ledger, or PLAN snapshots inside phase archives); differences across rounds are expressed through separate \`docs/R-NN/\` directories, not by moving or renaming directories.
3. Checking: before the unified commit, the driver automatically rewrites references affected by renames and appends an \`@<sha>\` version marker to inconsistent line-number anchors on modified files (keeping the original range, left for manual correction), and reports broken references; the \`check\` subcommand does a full scan of all live documents; when \`verify\` is enabled, broken references in a task's artifact documents are blocked by the acceptance gate into a fix round. Paths inside code fences, and references inline-annotated as deleted/archived/historical, are exempt.`

export function renderAgentsBlock(opts: { verify?: boolean; testByDriver?: boolean } = {}): string {
  const paragraphs = [
    POINTER,
    opts.verify ? VERIFY_PRINCIPLE : undefined,
    opts.testByDriver ? TEST_PRINCIPLE : undefined,
    COMMIT_PRINCIPLE,
    SUMMARY_PRINCIPLE,
    MAINT_RULE,
    REFS_SPEC,
  ].filter((p): p is string => Boolean(p))
  return `${AGENTS_BLOCK_START}\n${paragraphs.join("\n\n")}\n${AGENTS_BLOCK_END}`
}

// 幂等同步 AGENTS.md 的 opencode-auto 块: 按当前配置渲染模板,与文件中现有的标准块
// (裸 opencode-auto:start/end)比对——内容一致则不动,不一致则整块替换,不存在则
// 追加;文件中其余带 name 段的 opencode-auto 块(旧六块格式或任何游离标记块)一律
// 删除。旧格式的裸指针块本身就匹配标准块正则,因此会走替换分支被新合并内容取代,
// 其余五个带名块由删除分支清理——这就是从旧格式到新格式的迁移路径。
export async function ensurePointer(
  directory: string,
  opts: { verify?: boolean; testByDriver?: boolean } = {},
): Promise<{ block: "inserted" | "replaced" | "unchanged"; legacyRemoved: number }> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => "")
  let text = existing

  let legacyRemoved = 0
  text = text.replace(LEGACY_BLOCK, () => {
    legacyRemoved++
    return ""
  })
  text = text.replace(/\n{3,}/g, "\n\n")
  if (legacyRemoved) text = text.replace(/\n{2,}$/, "\n")

  const rendered = renderAgentsBlock(opts)
  const match = CANONICAL_BLOCK.exec(text)
  let block: "inserted" | "replaced" | "unchanged"
  if (!match) {
    text = text ? `${text.trimEnd()}\n\n${rendered}\n` : `# AGENTS.md\n\n${rendered}\n`
    block = "inserted"
  } else if (match[0] === rendered) {
    block = "unchanged"
  } else {
    text = text.slice(0, match.index) + rendered + text.slice(match.index + match[0].length)
    block = "replaced"
  }

  if (text !== existing) await Bun.write(agentsFile, text)
  return { block, legacyRemoved }
}
