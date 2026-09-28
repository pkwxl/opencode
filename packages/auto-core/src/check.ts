import { join } from "node:path"
import { LEGACY_BLOCK, renderAgentsBlock } from "./agents-block"
import { loadProjectConfig } from "./config"
import { fixHint } from "./config-fix"

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
// ② the reference scan over the live documents was removed together with the
// reference checker (its existence-and-line-cap layer, the pre-commit
// auto-correct and the stale list). The refs field stays in the result,
// always empty, until the check command itself retires, so the shell's
// report and its exit-code logic keep compiling unchanged.

// One violating description: file, line number, original text (task
// documents carry the task id).
export type Finding = { file: string; task?: string; line: number; text: string }

// The retired reference-scan layer's finding shape (kept only so the result
// and the shell's report keep their field; always an empty list now).
export type RefFinding = { file: string; line: number; text: string; path: string; problem: "missing" | "beyond-eof" }

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
// positives.
const TEST_PATTERNS: RegExp[] = [
  /\b(run|execute|perform)\b[^.\n]{0,40}\b(build|compile|tests?|lint)\b/i,
]

// Commit-type violation signatures (always checked): running git add/commit
// inside a session, or an instruction like "commit all/every change" (the
// unified commit is run by the driver after the session); nominal phrases
// such as "commit message / commit SHA" do not match — the verb must take the
// changes as its direct object, and a determiner before "commit" (the commit,
// this commit, …) marks the noun reading and is excluded by the lookbehind.
const COMMIT_PATTERNS: RegExp[] = [
  /\bgit\s+(add|commit)\b/i,
  /(?<!\b(?:a|an|the|this|that|each|every|one)\s)\bcommits?\s+(?:(?:all|every|any|the|your|these|those)\s+)?(?:(?:uncommitted|pending|outstanding)\s+)?(?:changes?|modifications?|code|work)\b/i,
]

export async function checkPrinciple(dir: string): Promise<{ findings: Finding[]; notes: string[]; refs: RefFinding[]; testOn: boolean }> {
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
  // The retired reference-scan layer's slot: always empty now (see the file
  // header).
  const refs: RefFinding[] = []
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
    // Negative sentences (a negation word immediately before the match)
    // state exactly what the principles require — not reported. The window
    // reaches a little further than the Chinese original needed to: English
    // negation words ("do not", "don't", "never") are longer than one
    // character.
    const window = line.slice(Math.max(0, match.index - 12), match.index)
    if (/(?:\b(?:no|not|never|avoid|without|except|cannot)\b|n['’]t)\s*$/i.test(window)) continue
    return true
  }
  return false
}
