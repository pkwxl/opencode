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
//
// The vintage pin (plans/0164): the installer also writes `<dir>/prompts/
// MANIFEST` — every suite file's SHA-256 digest plus a suite-level digest
// over the name:digest pairs — so a target records which suite revision was
// installed without tracking the suite's bytes (an arm commits the manifest
// alone and the vintage is provable). The manifest is installer output, not
// a suite file: it never enters SUITE, never counts as written or unchanged,
// and is excluded from the extras report. `checkPrompts` (the `--check`
// half) answers the drift question the manifest enables: does the target's
// prompts/ still match this binary's embedded suite, and does its manifest
// pin it? It writes nothing; the caller turns any drift into exit 1 — the
// scripted gate an operator runs before handing a target to a manual-driver
// session (a stale suite once drifted silently between arms: the qoder arm
// of the aster-mig cleanroom ran an October-30 copy that predated 0161's
// Auto-Nested lines, and nothing on disk said so).
import { createHash } from "node:crypto"
import { mkdir, stat } from "node:fs/promises"
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

// The manifest's own name inside the target's prompts/ — installer output,
// never a suite file and never an extra.
export const MANIFEST_NAME = "MANIFEST"

type SuiteManifest = {
  generator: string
  suite: string
  files: Record<string, string>
}

const sha256 = (text: string): string => `sha256-${createHash("sha256").update(text).digest("hex")}`

// The manifest of this binary's embedded suite, derived fresh every call —
// deterministic over the registry's fixed order, so the same suite always
// pins the same digest and a differing one always differs.
const suiteManifest = async (): Promise<SuiteManifest> => {
  const files: Record<string, string> = {}
  for (const entry of SUITE) files[entry.name] = sha256(await Bun.file(entry.file).text())
  const suite = sha256(
    SUITE.map((entry) => `${entry.name}  ${files[entry.name]}`).join("\n"),
  )
  return { generator: "opencode-auto install-prompts", suite, files }
}

const manifestText = (manifest: SuiteManifest): string => `${JSON.stringify(manifest, null, 2)}\n`

const requireInitialized = async (dir: string): Promise<void> => {
  if (!(await Bun.file(`${dir}/${CONFIG_FILE}`).exists())) {
    throw new Error(`nothing to install: ${dir} has no ${CONFIG_FILE}; run opencode-auto init ${dir} first`)
  }
}

type InstallPromptsResult = {
  /** Suite files whose content differed and were rewritten. */
  written: string[]
  /** Suite files already byte-identical on disk, left untouched. */
  unchanged: string[]
  /** Files in the target's prompts/ the suite does not carry — reported, never deleted. */
  extra: string[]
  /** The suite-level digest the manifest pins (this binary's suite). */
  suite: string
}

export async function installPrompts(dir: string): Promise<InstallPromptsResult> {
  await requireInitialized(dir)
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
  const manifest = await suiteManifest()
  await Bun.write(`${targetDir}/${MANIFEST_NAME}`, manifestText(manifest))
  const carried = new Set(PROMPT_SUITE)
  const extra: string[] = []
  for (const name of await Array.fromAsync(new Bun.Glob("*").scan({ cwd: targetDir }))) {
    if (!carried.has(name) && name !== MANIFEST_NAME) extra.push(name)
  }
  extra.sort()
  return { written, unchanged, extra, suite: manifest.suite }
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
  lines.push(`  manifest: prompts/${MANIFEST_NAME} pins this suite (${result.suite})`)
  if (result.extra.length) lines.push(`  left alone (not in the suite): ${result.extra.join(", ")}`)
  return lines
}

type CheckPromptsResult = {
  /** Suite files whose on-disk content differs from this binary's embedded suite. */
  drifted: string[]
  /** Suite files absent from the target's prompts/ entirely. */
  missing: string[]
  /** The manifest's state against this binary's suite. */
  manifest: "current" | "missing" | "stale"
  /** Files in the target's prompts/ the suite does not carry — reported, never drift. */
  extra: string[]
}

// The read-only half of plans/0164: the same comparisons installPrompts
// makes, answered without writing anything. Clean means every suite file
// byte-identical on disk and the manifest pinning exactly this binary's
// suite; anything else is drift the caller reports with exit 1. An absent
// prompts/ directory is missing wholesale, not an error — a project that
// never installed the suite is simply not yet a manual-driver target (the
// caller's wording says which).
export async function checkPrompts(dir: string): Promise<CheckPromptsResult> {
  await requireInitialized(dir)
  const targetDir = `${dir}/prompts`
  const drifted: string[] = []
  const missing: string[] = []
  for (const entry of SUITE) {
    const text = await Bun.file(entry.file).text()
    const target = `${targetDir}/${entry.name}`
    const existing = await Bun.file(target).text().catch(() => undefined)
    if (existing === undefined) missing.push(entry.name)
    else if (existing !== text) drifted.push(entry.name)
  }
  const manifest = await suiteManifest()
  const onDisk = await Bun.file(`${targetDir}/${MANIFEST_NAME}`).text().catch(() => undefined)
  let manifestState: CheckPromptsResult["manifest"]
  if (onDisk === undefined) manifestState = "missing"
  else {
    try {
      const parsed = JSON.parse(onDisk) as SuiteManifest
      manifestState =
        parsed.suite === manifest.suite && parsed.files !== undefined &&
        Object.keys(parsed.files).length === SUITE.length &&
        SUITE.every((entry) => parsed.files[entry.name] === manifest.files[entry.name])
          ? "current"
          : "stale"
    } catch {
      manifestState = "stale"
    }
  }
  const carried = new Set(PROMPT_SUITE)
  const extra: string[] = []
  if (await stat(targetDir).then(
    () => true,
    () => false,
  )) {
    for (const name of await Array.fromAsync(new Bun.Glob("*").scan({ cwd: targetDir }))) {
      if (!carried.has(name) && name !== MANIFEST_NAME) extra.push(name)
    }
  }
  extra.sort()
  return { drifted, missing, manifest: manifestState, extra }
}

export function formatCheckPrompts(dir: string, result: CheckPromptsResult): string[] {
  if (!result.drifted.length && !result.missing.length && result.manifest === "current") {
    const lines = [`prompt suite current in ${dir}/prompts (the manifest pins this binary's suite)`]
    if (result.extra.length) lines.push(`  left alone (not in the suite): ${result.extra.join(", ")}`)
    return lines
  }
  const lines = [`prompt suite drift in ${dir}/prompts:`]
  if (result.drifted.length) lines.push(`  drifted from this binary's suite: ${result.drifted.join(", ")}`)
  if (result.missing.length) lines.push(`  missing: ${result.missing.join(", ")}`)
  if (result.manifest === "missing")
    lines.push(`  manifest absent: prompts/${MANIFEST_NAME} pins no vintage (installed before it existed, or removed)`)
  if (result.manifest === "stale")
    lines.push(`  manifest stale: it pins a suite other than this binary's`)
  if (result.extra.length) lines.push(`  left alone (not in the suite): ${result.extra.join(", ")}`)
  return lines
}
