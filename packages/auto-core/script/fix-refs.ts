// Reference pre-cleaning script (a one-off entry point independent of the
// session hook, stable-refs §4.5): before the migration driver runs for
// real, manually runs one pass of autoCorrectRefs over the working
// directory — git rename pairing → mechanical rewrite of live-document
// references → missing recovery (refcheck-scope P2: missing references are
// restored in place by tracking the destination through the git history's
// rename map) → scope re-confirmation (refcheck-scope P3: inconsistent line
// anchors in changed files get an @<sha> version marker appended in place)
// → re-scan maintaining the broken-reference list .auto/invalid-refs.md
// (only unrestored items are registered, only newly appeared ⚠).
// Typical scenario: after a legacy work tree is reorganized into the new
// directory structure (moves/renames need no manual git add; the script
// stages everything automatically before pairing), run this script and the
// document references are mechanically rewritten to the new paths; the
// remaining missing references take .auto/invalid-refs.md as the entry
// point for human verification. Rewrite and scan scope = docs/**/*.md
// (excluding docs/phases/**, stable-refs §3.3) — when reorganizing, first
// put the documents in place under docs/, then run.
// Usage: bun script/fix-refs.ts [dir] (default: current directory)
// Exit code: 0 no broken references; 1 usage/environment error or broken
// references remain (the list is the handling entry point).
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { autoCorrectRefs, gitAvailable } from "../src/refcheck"

const dir = resolve(process.argv[2] ?? ".")
const info = await stat(dir).catch(() => undefined)
if (!info?.isDirectory()) {
  console.error(`directory does not exist: ${dir}`)
  process.exit(1)
}
console.log(`reference pre-cleaning: ${dir}`)
if (!(await gitAvailable(dir))) console.log("  note: non-git directory, rename pairing unavailable (validation + broken-reference list only)")
const findings = await autoCorrectRefs(dir)
console.log(
  findings.length
    ? `${findings.length} broken references remain, human verification entry point: .auto/invalid-refs.md`
    : "no broken references",
)
process.exit(findings.length ? 1 : 0)
