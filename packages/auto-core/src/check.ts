import { join } from "node:path"
import { LEGACY_BLOCK, renderAgentsBlock } from "./agents-block"
import { loadProjectConfig } from "./config"
import { fixHint } from "./config-fix"
import { activeDocs, gitAvailable, scanRefs, type RefFinding } from "./refcheck"
import { autoSwitches, type Switches } from "./switches"

// check command's checking logic: ① principle check — scans the target
// directory's AGENTS.md and the task documents of unfinished tasks
// (docs/T-NNN/todo.md, which replaced PLAN.md as the task body in M3.4) and
// reports descriptions that violate the principles "the driver owns the
// execution of test/build-like commands" and "the driver owns the execution
// of commits" (see the opencode-auto single marker block in agents-block.ts)
// — i.e. sentences asking a session to directly run build/test/lint-like
// commands, or to run a git commit. Principle statements / negative sentences
// ("do not run…") and sentences attributed to the driver are not reported;
// matching is heuristic, findings go to a human for confirmation, files are
// not modified. The test-execution principle holds only when
// config.testByDriver is enabled (when disabled, the block comparison is also
// rendered as disabled — block presence is unaffected); the commit principle
// always holds.
// ② reference check (stable-refs P4, D6 second layer): scans all live
// documents (docs/**/*.md) for broken references (path does not exist / line
// number exceeds the file's total lines); hits go through refs into the CLI
// report (exit code 1); a target directory missing the opencode-auto block,
// or non-git (auto-correct unavailable), gets a note. Controlled by
// OPENCODE_AUTO_REF_CHECK (refcheck-scope-design D3, default off silently
// no-ops: refs stays empty, no reference-related notes).

// One violating description: file, line number, original text (task
// documents carry the task id).
export type Finding = { file: string; task?: string; line: number; text: string }

// The driver-maintained opencode-auto block in AGENTS.md (the single marker
// block `opencode-auto:start`, plus possibly leftover legacy named blocks) is
// skipped wholesale — the block's content is itself the statement of the
// principles.
const AUTO_BLOCK = /<!--\s*opencode-auto:[^\n]*?start\s*-->[\s\S]*?<!--\s*opencode-auto:[^\n]*?end\s*-->/g

// List-style field lines (`- key: value`): the field value is a state
// record, not a violation.
const FIELD_LINE = /^\s*-\s+[\w-]+\s*:/

// Test/build-like violation signatures (checked only when config.testByDriver
// is enabled): an execution verb + build/test/lint semantics. The
// verb-to-object distance is kept very tight to avoid same-sentence false
// positives; the leading negative lookbehind excludes the verb reading inside
// the compound word "executable (file)".
const TEST_PATTERNS: RegExp[] = [
  /(?<!可)(运行|执行|跑)[^。\n]{0,8}(编译|测试|单元测试|构建|lint)/i,
  /\b(run|execute|perform)\b[^.\n]{0,40}\b(build|compile|tests?|lint)\b/i,
]

// Commit-type violation signatures (always checked): running git add/commit
// inside a session, or an instruction like "commit all/every change" (the
// unified commit is run by the driver after the session); nominal phrases
// such as "commit message / commit SHA" do not match.
const COMMIT_PATTERNS: RegExp[] = [/\bgit\s+(add|commit)\b/i, /提交(全部|所有|一次)?(未提交)?(改动|变更|代码)/]

export async function checkPrinciple(
  dir: string,
  switches: Switches = autoSwitches(),
): Promise<{ findings: Finding[]; notes: string[]; refs: RefFinding[]; testOn: boolean }> {
  const findings: Finding[] = []
  const notes: string[] = []
  let testOn = false
  try {
    const config = await loadProjectConfig(dir)
    testOn = config.testByDriver
  } catch (error) {
    const hint = await fixHint(dir)
    notes.push(
      `⚠ project config (.opencode/auto/config.json) is invalid, test principle checks treated as disabled: ${error instanceof Error ? error.message : String(error)}` +
        (hint ? `; ${hint}` : ""),
    )
  }
  const patterns = [
    ...(testOn ? TEST_PATTERNS : []),
    ...COMMIT_PATTERNS,
  ]
  const taskDocs: string[] = []
  for await (const file of new Bun.Glob(join("docs", "T-*", "todo.md")).scan({ cwd: dir, onlyFiles: true })) taskDocs.push(file.replaceAll("\\", "/"))
  for (const name of ["AGENTS.md", ...taskDocs.sort()]) {
    const text = await Bun.file(join(dir, name)).text().catch(() => undefined)
    if (text === undefined) {
      notes.push(`${name} does not exist, run opencode-auto fix ${dir} to add the opencode-auto block`)
      continue
    }
    // Skip the driver-maintained opencode-auto block, then check line by line.
    const cleaned = name === "AGENTS.md" ? text.replaceAll(AUTO_BLOCK, "") : text
    const task = /^docs\/(T-[\w-]+)\//.exec(name)?.[1]
    cleaned.split("\n").forEach((line, index) => {
      if (violates(line, patterns)) findings.push({ file: name, task, line: index + 1, text: line.trim() })
    })
    if (name === "AGENTS.md") {
      if (!text.includes("opencode-auto:start")) {
        notes.push("AGENTS.md is missing the opencode-auto block, run opencode-auto fix to add it")
      } else {
        if (!text.includes(renderAgentsBlock({ testByDriver: testOn }))) {
          notes.push("AGENTS.md opencode-auto block content is inconsistent with the current config (stale), run opencode-auto fix (or run) to refresh")
        }
        const legacyCount = [...text.matchAll(LEGACY_BLOCK)].length
        if (legacyCount) {
          notes.push(`AGENTS.md contains ${legacyCount} legacy/redundant opencode-auto marker blocks, run opencode-auto fix (or run) to clean up`)
        }
      }
    }
  }
  // Reference check (P4): scan and emit notes only when live documents exist
  // (a directory without docs/ has no object for the reference mechanism yet).
  // With OPENCODE_AUTO_REF_CHECK=off (default) the whole section no-ops —
  // silent; verbose shows the full switch set.
  let refs: RefFinding[] = []
  if (switches.refCheck) {
    const docs = await activeDocs(dir)
    refs = docs.length ? await scanRefs(dir, docs) : []
    if (docs.length && !(await gitAvailable(dir))) {
      notes.push("non-git target directory: pre-commit reference auto-correct (rename rewrite) unavailable, reference check only validates")
    }
  }
  return { findings, notes, refs, testOn }
}

// Whether one line violates the principles: it matches "execution verb +
// build/test semantics" (when testByDriver is enabled) or "a session runs a
// git commit", and is not a negative sentence, not attributed to the driver,
// not a list-style field line.
function violates(line: string, patterns: RegExp[]): boolean {
  if (FIELD_LINE.test(line)) return false
  // Sentences attributed to the driver are compliant (the principles
  // themselves describe the driver's execution rights).
  if (/driver|opencode-auto/i.test(line)) return false
  for (const pattern of patterns) {
    const match = pattern.exec(line)
    if (!match) continue
    // Negative sentences (the negation words the preceding-window regex
    // tests for) state exactly what the principles require — not reported.
    const window = line.slice(Math.max(0, match.index - 4), match.index)
    if (/(不要|不得|不应|不许|不再|禁止|避免|无需|不必|别|不|未)/.test(window)) continue
    return true
  }
  return false
}
