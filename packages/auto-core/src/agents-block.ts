import { chmod, rm } from "node:fs/promises"
import { join } from "node:path"
import { reprotect } from "./protect"

// AGENTS.md 的 opencode-auto 块: 单一标记块,内容 = 指针 + 测试执行原则(testByDriver 开关)+ 提交原则 + 摘要原则(非交互场景不产出会话末尾
// 总结)+ 引用规范,合并为一段英文文本。段落以数组 filter/join 拼接
// (\n\n 分隔),不走 template.ts 的 {{#if}} 引擎——标签独占一行吞掉整行换行的语义
// 会在开关关闭时让相邻段落粘连、丢失分隔空行,数组拼接不依赖该语义,恒为一个
// 空行分隔。
// AGENTS.md holds only this block (plus whatever a human wrote around it):
// sessions do not maintain it (plans/0054 D2). The file is gitignored
// (local-only), so session edits would escape the unified commit and the
// unit rollback; durable knowledge lives in committed docs/ documents
// instead, and run makes the file read-only (protect.ts). It is system
// context reread on every provider turn; init/amend/fix/run only keep this
// block in sync with the config.
export const AGENTS_BLOCK_START = "<!-- opencode-auto:start -->"
export const AGENTS_BLOCK_END = "<!-- opencode-auto:end -->"

// 唯一标准块(无 name 段)。
const CANONICAL_BLOCK = /<!--\s*opencode-auto:start\s*-->[\s\S]*?<!--\s*opencode-auto:end\s*-->/

// 任何带 `:<name>:` 段的 opencode-auto 块——旧六块格式(verify/test/commit/maint/
// refs)或未来任何游离标记块;不匹配上面的裸 start/end 标准块。
export const LEGACY_BLOCK = /<!--\s*opencode-auto:([\w-]+):start\s*-->[\s\S]*?<!--\s*opencode-auto:\1:end\s*-->\n*/g

const POINTER = `This directory is driven by opencode-auto. The session prompt already inlines the task for this turn, so you normally don't need to read state files separately. A task's own documents hold its full content and progress — \`docs/T-NNN/todo.md\` (goal, scope, acceptance) and \`docs/T-NNN/subtasks.md\` (the subtask checklist): reread them if context has been compacted, or whenever you are unsure about the current task or its progress, rather than relying on session memory. The \`todo.md\` → \`done.md\` renames of phases, tasks and subtasks and the ticks in their indexes are made by DRIVER alone. AGENTS.md is not a place for notes: do not edit it — anything worth keeping belongs in \`docs/\` documents.`

const TEST_PRINCIPLE = `Test principle: build, test, compile, and lint commands — which can be slow or produce large amounts of output — are always run by DRIVER outside the session; no session should run them directly. When needed, write the command as a script under \`test/\`, then write that script's path into \`tmp/test.sh\` to tell DRIVER to run it. After running it, DRIVER reports the exit code and the output file path (stdout and stderr merged into one file) back to the session, which reads the file directly to judge the result. Task descriptions and project conventions must not contain instructions that contradict this.`

const COMMIT_PRINCIPLE = `Commit principle: after a session ends, DRIVER performs one unified recursive commit of every change (nested sub-repositories first, then this repository), with commit messages carrying the task number and phase; no session should ever run \`git commit\`/\`amend\`/\`rebase\` or any other commit-type command, nor alter commit history. Background worth preserving belongs in \`docs/\` documents, which DRIVER's commit picks up automatically. Task descriptions and project conventions must not contain instructions that contradict this.`

const SUMMARY_PRINCIPLE = `Summary principle: do not produce a closing summary or wrap-up narration in your final chat turn when a session finishes. DRIVER is non-interactive and never reads chat text, and this system runs many unattended agent sessions back-to-back, so a spoken summary at the end of each one is pure wasted tokens with no reader. Anything worth keeping belongs in \`docs/\` files (or the task's report, where applicable) — once the required file writes are done, end the turn. Task descriptions and project conventions must not contain instructions that contradict this.`

const REFS_SPEC = `Reference and storage conventions (stable references; see the stable-refs design document for the full rationale):
1. Storage: task documents live only under \`docs/T-NNN/\` (the task's own \`todo.md\`/\`done.md\`, \`context\`/\`subtasks\`/\`report\`/\`handoff\`/\`testhandoff.md\`); subtask artifacts live only under \`docs/T-NNN/S<2-digit-seq>/\` (\`index.md\`, \`testhandoff.md\`); each round has one round directory \`docs/R-NN/\` (created at the start of the round, never moved afterward): the phase index \`phases.md\`, one phase directory \`P<nn>-<type>/\` per phase (its \`todo.md\`/\`done.md\` state file, task index \`tasks.md\`, handover \`handover.md\`, phase-level artifacts and standard artifacts such as the migration knowledge \`kb.md\`), and prior knowledge \`prior-kb.md\` all live inside the round directory. Once created, these paths are permanent — never move them, never rename them.
2. References: references between documents, and references into code, are always written as paths relative to the target directory root (for example \`docs/T-003/S04/index.md\`, \`src/runner.ts:120\`, in backticks or as links), optionally with a \`:line\` anchor; the anchor may further carry an \`@<sha>\` version marker (for example \`src/runner.ts:120@abc1234\`, meaning that range is valid only for that historical revision and is exempt from line-number checking). Do not reference state files inside round directories (the \`phases.md\` and \`tasks.md\` indexes, or phase \`todo.md\`/\`done.md\`); differences across rounds are expressed through separate \`docs/R-NN/\` directories, not by moving or renaming directories.
3. Checking: before the unified commit, DRIVER automatically rewrites references affected by renames and appends an \`@<sha>\` version marker to inconsistent line-number anchors on modified files (keeping the original range, left for manual correction), and reports broken references; the \`check\` subcommand does a full scan of all live documents. Paths inside code fences, and references inline-annotated as deleted/archived/historical, are exempt.`

export function renderAgentsBlock(opts: { testByDriver?: boolean } = {}): string {
  const paragraphs = [
    POINTER,
    opts.testByDriver ? TEST_PRINCIPLE : undefined,
    COMMIT_PRINCIPLE,
    SUMMARY_PRINCIPLE,
    REFS_SPEC,
  ].filter((p): p is string => Boolean(p))
  return `${AGENTS_BLOCK_START}\n${paragraphs.join("\n\n")}\n${AGENTS_BLOCK_END}`
}

// 幂等同步 AGENTS.md 的 opencode-auto 块: 按当前配置渲染模板,与文件中现有的标准块
// (裸 opencode-auto:start/end)比对——内容一致则不动,不一致则整块替换,不存在则
// 追加;文件中其余带 name 段的 opencode-auto 块(旧六块格式或任何游离标记块)一律
// 删除。旧格式的裸指针块本身就匹配标准块正则,因此会走替换分支被新合并内容取代,
// 其余五个带名块由删除分支清理——这就是从旧格式到新格式的迁移路径。
// dryRun computes the result without writing, so `fix` can print its plan first.
export async function ensurePointer(
  directory: string,
  opts: { testByDriver?: boolean; dryRun?: boolean } = {},
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

  if (!opts.dryRun && text !== existing) {
    // A killed run can leave the file read-only (protect.ts): unlock before
    // writing, then reprotect — a no-op unless a run is protecting it.
    await chmod(agentsFile, 0o644).catch(() => {})
    await Bun.write(agentsFile, text)
    await reprotect(agentsFile)
  }
  return { block, legacyRemoved }
}

// ensurePointer 的逆操作(reset 用): 摘除标准块与任何旧版带名块,文件其余内容
// (用户自写正文)原样保留。摘除后正文仅剩 `# AGENTS.md` 空壳标题——即该文件
// 本就是 ensurePointer 建的——则报 emptied,由调用方整个删除。dryRun 只算结果
// 不落盘,供 reset 先打印清单再确认。
export async function removePointer(
  directory: string,
  opts: { dryRun?: boolean } = {},
): Promise<{ removed: boolean; emptied: boolean }> {
  const agentsFile = join(directory, "AGENTS.md")
  const existing = await Bun.file(agentsFile).text().catch(() => undefined)
  if (existing === undefined) return { removed: false, emptied: false }

  let removed = false
  let text = existing.replace(LEGACY_BLOCK, () => {
    removed = true
    return ""
  })
  const match = CANONICAL_BLOCK.exec(text)
  if (match) {
    text = text.slice(0, match.index) + text.slice(match.index + match[0].length)
    removed = true
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim()

  const emptied = removed && (text === "" || text === "# AGENTS.md")
  if (!opts.dryRun && removed) {
    if (emptied) await rm(agentsFile, { force: true })
    else {
      await chmod(agentsFile, 0o644).catch(() => {})
      await Bun.write(agentsFile, `${text}\n`)
    }
  }
  return { removed, emptied }
}
