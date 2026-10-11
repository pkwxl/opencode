// The manual-driver prompt suite installer (plans/0093): `install-prompts`
// resyncs this package's `prompts/` directory into a target directory — every
// suite file copied byte-identical into `<dir>/prompts/`, one command instead
// of hand-copying files when the suite changes (0092's launch flip, a new
// companion). The suite stays outside the driver's machinery — no runtime
// code renders these files — but the installer embeds them the way templates
// are embedded (`with { type: "file" }` imports, so a compiled shell carries
// them); adding a suite file registers it here in the same change, and the
// guard test in test/install-prompts.test.ts holds this registry to the
// directory's contents.
//
// Semantics (0093 D2): overwrite is the point — a file whose content differs
// is rewritten, an already-identical one is left untouched; a file in the
// target's prompts/ the suite does not carry is reported and never deleted
// (local additions are the person's own). The command requires an initialized
// project (the suite presumes the driver's docs machinery, and the refusal
// keeps the command from littering arbitrary directories) and writes nothing
// a running driver reads — the automated driver never reads the target's
// prompts/ — so it takes no run lock (0093 D3). It runs no git command
// either: the suite files are tracked content in the target, so the person
// reviews and commits the resync.
import { mkdir } from "node:fs/promises"
import { CONFIG_FILE } from "./config"
import suiteCharter from "../prompts/charter.md" with { type: "file" }
import suitePlanAppend from "../prompts/plan-append.md" with { type: "file" }
import suiteResumeSubtasks from "../prompts/resume-subtasks.md" with { type: "file" }
import suiteRunAsSubtasks from "../prompts/run-as-subtasks.md" with { type: "file" }
import suiteRunFix from "../prompts/run-fix.md" with { type: "file" }
import suiteRunHandover from "../prompts/run-handover.md" with { type: "file" }
import suiteRunPlan from "../prompts/run-plan.md" with { type: "file" }
import suiteRunTask from "../prompts/run-task.md" with { type: "file" }
import suiteRunVerify from "../prompts/run-verify.md" with { type: "file" }
import suiteRun from "../prompts/run.md" with { type: "file" }

// The registry itself: every file of the suite, by name, in directory order.
// PROMPT_SUITE is the list the guard test compares against the directory.
const SUITE: readonly { readonly name: string; readonly file: string }[] = [
  { name: "charter.md", file: suiteCharter },
  { name: "plan-append.md", file: suitePlanAppend },
  { name: "resume-subtasks.md", file: suiteResumeSubtasks },
  { name: "run-as-subtasks.md", file: suiteRunAsSubtasks },
  { name: "run-fix.md", file: suiteRunFix },
  { name: "run-handover.md", file: suiteRunHandover },
  { name: "run-plan.md", file: suiteRunPlan },
  { name: "run-task.md", file: suiteRunTask },
  { name: "run-verify.md", file: suiteRunVerify },
  { name: "run.md", file: suiteRun },
]
export const PROMPT_SUITE: readonly string[] = SUITE.map((entry) => entry.name)

export type InstallPromptsResult = {
  /** Suite files whose content differed and were rewritten. */
  written: string[]
  /** Suite files already byte-identical on disk, left untouched. */
  unchanged: string[]
  /** Files in the target's prompts/ the suite does not carry — reported, never deleted. */
  extra: string[]
}

export async function installPrompts(dir: string): Promise<InstallPromptsResult> {
  if (!(await Bun.file(`${dir}/${CONFIG_FILE}`).exists())) {
    throw new Error(`nothing to install: ${dir} has no ${CONFIG_FILE}; run opencode-auto init ${dir} first`)
  }
  const targetDir = `${dir}/prompts`
  await mkdir(targetDir, { recursive: true })
  const written: string[] = []
  const unchanged: string[] = []
  for (const entry of SUITE) {
    const text = await Bun.file(entry.file).text()
    const target = `${targetDir}/${entry.name}`
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing === text) {
      unchanged.push(entry.name)
      continue
    }
    await Bun.write(target, text)
    written.push(entry.name)
  }
  const carried = new Set(PROMPT_SUITE)
  const extra: string[] = []
  for (const name of await Array.fromAsync(new Bun.Glob("*").scan({ cwd: targetDir }))) {
    if (!carried.has(name)) extra.push(name)
  }
  extra.sort()
  return { written, unchanged, extra }
}

export function formatInstallPrompts(dir: string, result: InstallPromptsResult): string[] {
  const total = result.written.length + result.unchanged.length
  const lines =
    result.written.length === 0
      ? [`prompt suite already current in ${dir}/prompts: ${total} files`]
      : [
          `prompt suite resynced into ${dir}/prompts: ${total} files (${result.written.length} rewritten, ${result.unchanged.length} unchanged)`,
          `  rewritten: ${result.written.join(", ")}`,
        ]
  if (result.extra.length) lines.push(`  left alone (not in the suite): ${result.extra.join(", ")}`)
  return lines
}
