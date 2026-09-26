import { readdir, realpath, rm } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import type { AddedLine } from "./document/types"
import { log } from "./log"

// driver unified commit mechanism: revokes the commit right from AI sessions —
// after any session ends the driver recursively commits all changes (nested
// repositories first, then the repository containing the target directory),
// with the commit message carrying the task id and phase, making git history
// the audit trail of AI changes (granularity of tracing and rollback =
// session). A session never runs git commit (constrained in sync by the
// AGENTS.md commit-principles block and the agent contract).

// Commit boundary (plans/0021-commit-boundary-design.md): a git commit is part
// of the completion condition of an execution unit (task/subtask/hidden task)
// — starting a unit requires a clean worktree (the information it depends on
// is all fixed by the previous commit), and close-out requires every change
// posted and only driver commits inside the commit range. This file provides
// the trio:
// - beginUnit: the unit start gate (clean check + the carryover backfill
//   commit self-healing driver-exclusive state-file leftovers + baseline);
// - unitBaseline/unitViolations: the SHA baseline and close-out check
//   (external-commit detection);
// - commitPending: the hidden-task idempotent entry's "artifacts on disk but
//   uncommitted → a backfill commit completes it" (③).
// Under --commit false / dryrun / a non-git environment the gates are wholly
// inactive.

// Commit message: an English subject line (for humans, since M0.6) + machine-
// readable trailers (so scripts can locate rollback points). Auto-Task carries
// the task id (T-F*/PLAN etc.), Auto-Stage the phase and ordinal (for a pseudo
// task, the bypass phase label: phase-plan/phase-handover/phase-transition/
// knowledge/numbering/final-plan/doc-migrate/housekeeping/carryover etc.);
// Auto-Stage is also the machine criterion for a "driver commit" (the unit
// close-out check detects external commits by it). The commit of the
// repository containing the target directory additionally records the final
// (or latest) SHA of **all** nested repositories in Auto-Nested lines — a new
// SHA for those with a commit this round, the unit baseline SHA for those
// without — so any root commit can align cross-repository state (commit
// boundary D4).
// body (plans/0053 D21): optional multi-line commit body between the subject
// and the trailers (the close commit lists the units it closed). Absent, the
// message is byte-identical to the bodyless format every existing commit uses.
function message(subject: string, task: { id: string }, stage: string, nested: { rel: string; sha: string }[] = [], body?: string): string {
  return [
    subject,
    "",
    ...(body ? [body.replace(/\s+$/, ""), ""] : []),
    `Auto-Task: ${task.id}`,
    `Auto-Stage: ${stage}`,
    ...nested.map((repo) => `Auto-Nested: ${repo.rel} @ ${repo.sha}`),
  ].join("\n")
}

// Commit title (also the session title; the short-label scheme
// `T-NNN <label> <title/subtask>`, see runner.ts): truncated past 100
// characters, keeping both the git subject line and the session list
// readable.
const TITLE_MAX = 100

export function commitTitle(subject: string): string {
  return subject.length > TITLE_MAX ? `${subject.slice(0, TITLE_MAX)}…` : subject
}

// Commit title with a suffix: base (the execution unit's title, possibly
// long) + suffix (e.g. `test handover #2 freeze`). When over length it is
// the **base** that gets truncated — the suffix is the only information
// distinguishing a unit's several commits; delegating to commitTitle, which
// truncates the tail, would shave off `#n`/`freeze` and make one subtask's
// successive handover commits indistinguishable.
export function suffixedTitle(base: string, suffix: string): string {
  // fit = the length available when the base is not truncated (one character
  // kept for the separator space); truncating must also leave one for the
  // ellipsis.
  const fit = TITLE_MAX - suffix.length - 1
  if (base.length <= fit) return `${base} ${suffix}`
  // The suffix alone exhausts the budget (should not happen): fall back to
  // the uniform truncation — at least it produces no over-long title.
  if (fit - 1 <= 0) return commitTitle(`${base} ${suffix}`)
  return `${base.slice(0, fit - 1)}… ${suffix}`
}

// Unified-commit result (plans/0021-commit-boundary-design.md P1): with
// ok=false, failures lists the repositories whose commit failed (path
// relative to the target directory + the error's first line). An empty array
// = all succeeded or nothing to commit.
export type CommitResult = { ok: boolean; failures: { rel: string; error: string }[] }

// Unified commit after a session. Per repository (depth-first, nested
// repositories commit first): only with uncommitted changes does it run
// git add -A + git commit — no changes → skip, non-git environment → skip
// wholesale; a single repository's failure goes into the returned failures
// (the caller disposes of it by the completion condition — a caller with the
// gate off ignoring the return value is the old behavior). subject is the
// subject line.
export async function commitTree(dir: string, task: { id: string; title: string }, info: { stage: string; subject: string; body?: string }): Promise<CommitResult> {
  const roots = await repoRoots(dir)
  const subject = commitTitle(info.subject)
  const failures: { rel: string; error: string }[] = []
  for (const root of roots) {
    const rel = relative(dir, root) || "."
    try {
      if (!(await hasChanges(root))) continue
      const added = await git(root, ["add", "-A", "--", "."])
      if (added.code !== 0) {
        const error = `git add exit code ${added.code} (${firstLine(added.err || added.out)})`
        log(`  ⚠ git commit failed (${rel}): ${error}`)
        failures.push({ rel, error })
        continue
      }
      // Auto-Nested covers every nested repository (the root repository
      // commits last, by which time each nested repository has settled its
      // final SHA).
      const nested = root === dir ? await nestedHeads(dir, roots) : undefined
      const committed = await git(root, [...(await identityArgs(root)), "commit", "-m", message(subject, task, info.stage, nested, info.body)])
      if (committed.code !== 0) {
        const error = firstLine(committed.err || committed.out) || `git commit exit code ${committed.code}`
        log(`  ⚠ git commit failed (${rel}): ${error} (changes left in the worktree)`)
        failures.push({ rel, error })
        continue
      }
      log(`  ✓ git commit (${rel}): ${subject}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      log(`  ⚠ git commit failed (${rel}): ${text}`)
      failures.push({ rel, error: firstLine(text) })
    }
  }
  return { ok: failures.length === 0, failures }
}

// The current HEAD of every nested repository (relative path + short SHA):
// read one by one when the root repository commits, so Auto-Nested records
// both the repositories "committed this round" and those "untouched this
// round" (the latter at their baseline SHA, unless an external commit
// happened in between — that is caught by unitViolations).
async function nestedHeads(dir: string, roots: string[]): Promise<{ rel: string; sha: string }[]> {
  const heads: { rel: string; sha: string }[] = []
  for (const root of roots) {
    if (root === dir) continue
    heads.push({ rel: relative(dir, root) || ".", sha: (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim() })
  }
  return heads
}

// Whether the worktree already has uncommitted changes (run's start-up notice
// to the user: they will be swept into the driver's next commit).
export async function pendingChanges(dir: string): Promise<boolean> {
  for (const root of await repoRoots(dir)) {
    if (await hasChanges(root)) return true
  }
  return false
}

// Short HEAD sha of the repository containing dir (undefined outside git or
// before the first commit). The close command's undo pointer names it
// (plans/0053 D21/D30: `git revert <sha>`).
export async function headSha(dir: string): Promise<string | undefined> {
  const got = await git(dir, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
  const sha = got?.code === 0 ? got.out.trim() : ""
  return sha || undefined
}

// The close command's stash option (plans/0053 D20): stash every change of
// every repository root, nested repositories first, and report each created
// stash with its `git stash list` line. Roots without changes are skipped; a
// root where `git stash push` fails is reported as a failure so the caller can
// refuse before writing anything.
export async function stashTree(
  dir: string,
  message: string,
): Promise<{ failures: { rel: string; error: string }[]; stashes: { rel: string; line: string }[] }> {
  const failures: { rel: string; error: string }[] = []
  const stashes: { rel: string; line: string }[] = []
  for (const root of await repoRoots(dir)) {
    if (!(await hasChanges(root))) continue
    const pushed = await git(root, ["stash", "push", "--include-untracked", "-m", message])
    if (pushed.code !== 0) {
      const error = firstLine(pushed.err || pushed.out) || `git stash exit code ${pushed.code}`
      log(`  ⚠ git stash failed (${relative(dir, root) || "."}): ${error}`)
      failures.push({ rel: relative(dir, root) || ".", error })
      continue
    }
    const listed = await git(root, ["stash", "list", "-n", "1"])
    const line = listed.out.split("\n")[0]?.trim()
    if (line) stashes.push({ rel: relative(dir, root) || ".", line })
  }
  return { failures, stashes }
}

// —— Unit commit boundary (plans/0021-commit-boundary-design.md) ——

// Driver-exclusive state writes (when a unit starts dirty: the dirty area
// being entirely of this kind = leftover driver postings from a failed
// previous commit → self-healed by a carryover backfill commit; any other
// dirty area (manual edits / half-finished AI output) always blocks for human
// attention, never swept automatically): the ticks of the phase index
// phases.md and the task index tasks.md, and the todo.md → done.md renames of
// phase and task units (M3.4; a subtask's rename commits with the subtask,
// and its failure takes the blocked path's interruption-scene commit).
// CURRENT.md is the retired task mirror (plans/0054 D3): the driver no longer
// writes it, but preflight deletes one an earlier release left behind, and
// that deletion carries over here like any driver write.
const DRIVER_STATE = [
  /^CURRENT\.md$/,
  /^docs\/R-\d+\/phases\.md$/,
  /^docs\/R-\d+\/P\d{2,}-[a-z][a-z0-9-]*\/(?:tasks|todo|done)\.md$/,
  /^docs\/T-\d+\/(?:todo|done)\.md$/,
]

export function driverStateFile(rel: string): boolean {
  const path = rel.replaceAll("\\", "/")
  return DRIVER_STATE.some((re) => re.test(path))
}

// Unit SHA baseline: each repository's short HEAD SHA (an empty repository
// records the empty string — every commit after it happens during this unit,
// and the close-out check examines the full history).
export type UnitBaseline = { root: string; sha: string }[]

export async function unitBaseline(dir: string): Promise<UnitBaseline> {
  const baseline: UnitBaseline = []
  for (const root of await repoRoots(dir)) {
    baseline.push({ root, sha: (await git(root, ["rev-parse", "--short", "HEAD"])).out.trim() })
  }
  return baseline
}

// Unit close-out check: ① the worktree must be clean (still dirty after a
// successful unified commit = a commit failed or new changes appeared);
// ② within each repository's baseline..HEAD range every commit must carry the
// Auto-Stage trailer (= a driver commit) — a commit without the trailer = an
// external commit (human / another process) happened in between, breaking
// "a commit is the isolation boundary". Returns the violation list (empty =
// pass); an empty baseline (non-git environment / gate off) always passes.
export async function unitViolations(dir: string, baseline: UnitBaseline): Promise<string[]> {
  if (!baseline.length) return []
  const problems: string[] = []
  const dirty = await changedFiles(dir)
  if (dirty.length) {
    problems.push(`worktree still has uncommitted changes: ${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ` … (${dirty.length} files total)` : ""}`)
  }
  for (const { root, sha } of baseline) {
    const head = (await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim()
    if (head === undefined || head === sha) continue
    const foreign = await foreignCommits(root, sha)
    if (foreign) {
      problems.push(`${relative(dir, root) || "."}: ${foreign} non-driver commit(s) detected (no Auto-Stage trailer); external commits occurred during the unit`)
    }
  }
  return problems
}

// Whether the worktree has zero changes against the unit baseline (the
// zero-write criterion of session-boundary-hardening §4.3): every
// repository's HEAD has left the baseline nowhere (no commit within this
// unit — after beginUnit this unit's driver commits happen only at the
// handover/close-out boundaries, so at the natural-finish check an unmoved
// HEAD = the whole unit posted nothing) and the worktree has no uncommitted
// changes. An empty baseline (non-git environment / gate off) cannot be
// judged and always counts as not zero-write.
export async function unitQuiet(dir: string, baseline: UnitBaseline): Promise<boolean> {
  if (!baseline.length) return false
  if ((await changedFiles(dir)).length) return false
  for (const { root, sha } of baseline) {
    const head = (await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim()
    if (head !== sha) return false
  }
  return true
}

// This unit's list of git-changed files (the data source of the full-document
// eof-marker scan, session-boundary-hardening §4.6): each repository's
// tracked changes over baseline..worktree (git diff <baseline> — this unit's
// driver commits at handover boundaries during the unit also fall inside the
// range; git diff compares against the worktree and reports the committed and
// the uncommitted together) plus untracked new files (untracked = created by
// this unit, the same criterion as untrackedFiles). Deletions are excluded
// (the file is not on disk, no shape-check subject); an empty baseline
// (non-git environment / gate off) returns the empty set.
export async function unitChangedFiles(dir: string, baseline: UnitBaseline): Promise<Set<string>> {
  const phys = await physicalDir(dir)
  const files = new Set<string>()
  for (const { root, sha } of baseline) {
    const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) continue
    // An empty-string baseline = the repository had no commits when the unit
    // started; compare against the empty tree (everything this unit posts
    // falls inside the range).
    // --ignore-submodules=all: a nested repository is a single gitlink in the
    // outer one; its inner files are listed separately by that repository's
    // own diff (the same reasoning as gitDiffFiles/statusEntries).
    const diff = await git(root, ["diff", "--name-only", "-z", "--diff-filter=d", "--ignore-submodules=all", sha || EMPTY_TREE, "--", "."])
    if (diff.code !== 0) continue
    for (const path of diff.out.split("\0").filter(Boolean)) files.add(relative(phys, join(toplevel, path)))
  }
  for (const rel of await untrackedFiles(dir)) files.add(rel)
  return files
}

// Lines this unit added, per file relative to the target directory (M2.3, the
// P1 prohibition scan's input, plans/0045): the `+` lines of the baseline..
// worktree diff of tracked files, plus every line of the untracked (new-in-
// unit) files. The scan's scope is what the unit wrote, never what a file
// already held — a unit touching a file with older references is not blamed
// for them. Deletions contribute nothing; binary files neither (git prints no
// hunks for them; untracked files with NUL bytes or over 1 MiB are skipped).
// Nested repositories are covered per baseline root, like unitChangedFiles.
export async function unitAddedLines(dir: string, baseline: UnitBaseline): Promise<Map<string, AddedLine[]>> {
  const phys = await physicalDir(dir)
  const added = new Map<string, AddedLine[]>()
  const push = (rel: string, line: number, text: string) => {
    const list = added.get(rel) ?? []
    list.push({ line, text })
    added.set(rel, list)
  }
  for (const { root, sha } of baseline) {
    const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) continue
    const diff = await git(root, [
      "-c",
      "core.quotePath=false",
      "diff",
      "-U0",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--diff-filter=d",
      "--ignore-submodules=all",
      sha || EMPTY_TREE,
      "--",
      ".",
    ])
    if (diff.code !== 0) continue
    // A file header runs from `diff --git` to the first hunk; only there is a
    // `+++ ` line the new-side path (an added content line "++ x" also starts
    // with "+++ ").
    let file: string | undefined
    let header = false
    let line = 0
    for (const raw of diff.out.split("\n")) {
      if (raw.startsWith("diff --git ")) {
        header = true
        file = undefined
        continue
      }
      if (header) {
        if (raw.startsWith("+++ ")) {
          const path = raw.slice(4).replace(/^"(.*)"$/, "$1")
          file = path.startsWith("b/") ? relative(phys, join(toplevel, path.slice(2))) : undefined
        }
        const hunk = /^@@ -\S+ \+(\d+)/.exec(raw)
        if (!hunk) continue
        header = false
        line = Number(hunk[1])
        continue
      }
      const hunk = /^@@ -\S+ \+(\d+)/.exec(raw)
      if (hunk) {
        line = Number(hunk[1])
        continue
      }
      if (file && raw.startsWith("+")) push(file, line++, raw.slice(1))
    }
  }
  for (const rel of await untrackedFiles(dir)) {
    const handle = Bun.file(join(dir, rel))
    if (handle.size > 1 << 20) continue
    const text = await handle.text().catch(() => "")
    if (text.includes("\0")) continue
    text.split("\n").forEach((content, i) => push(rel, i + 1, content))
  }
  return added
}

// git's empty-tree hash (a fixed constant): a commit-less repository's
// "diff against the baseline" uses it as the empty baseline end.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// The count of commits without the Auto-Stage trailer inside the
// baseline..HEAD range (= the number of external commits); an empty-string
// sha means the repository had no commits when the unit started — check the
// full history. Shared by unitViolations and the recovery-fidelity baseline
// check / rollback.
async function foreignCommits(root: string, sha: string): Promise<number> {
  const bodies = await git(root, ["log", "-z", "--format=%B", ...(sha ? [`${sha}..HEAD`] : ["HEAD"])])
  return bodies.out
    .split("\0")
    .filter((body) => body.trim())
    .filter((body) => !body.includes("Auto-Stage:")).length
}

// —— Recovery fidelity (plans/0022-session-recovery-fidelity-design.md) ——

// Baseline check on recovery (design 3.1 ③): every repository's HEAD ==
// baseline, or the whole baseline..HEAD range is driver commits (Auto-Stage
// trailer) — only driver commits happened in between, so the session
// context's view of the present still holds. Unlike unitViolations: **it does
// not check uncommitted changes** — a half-finished session's dirty area is
// precisely the thing being recovered. Returns the problem list (empty =
// baseline intact).
export async function baselineIntact(dir: string, baseline: UnitBaseline): Promise<string[]> {
  const problems: string[] = []
  for (const { root, sha } of baseline) {
    const rel = relative(dir, root) || "."
    const got = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
    const head = got?.code === 0 ? got.out.trim() : ""
    if (!head) {
      // HEAD unreadable: an empty baseline too (no commits when the unit
      // started, still none now) is normal; anything else is an anomaly.
      if (!sha) continue
      problems.push(`${rel}: HEAD unreadable (repo missing or history corrupt), baseline check failed`)
      continue
    }
    if (head === sha) continue
    const foreign = await foreignCommits(root, sha)
    if (foreign > 0) {
      problems.push(`${rel}: ${foreign} non-driver commit(s) since baseline (no Auto-Stage trailer); external commits mixed in, session context is stale`)
    }
  }
  return problems
}

// Rollback result (design 3.3): non-empty failures = some repository could
// not be rolled back (the caller hands it to a human as dirty); stashes is
// the number of stashes actually run (scene preservation + the reset
// reclaim); resets/skipped are for the log (repositories that skipped reset:
// has an upstream / empty baseline / created during the unit).
export type RollbackResult = {
  ok: boolean
  failures: { rel: string; error: string }[]
  stashes: number
  resets: string[]
  skipped: string[]
}

// Rollback protocol (design 3.3, when fidelity cannot be kept): per
// repository (depth-first, mirroring commitTree's traversal) ① git stash
// push -u preserves the scene (uncommitted changes stay recoverable by hand;
// the gitignored .auto/ and tmp/ never take part); ② when this unit's driver
// commits exist in baseline..HEAD, git reset --soft back to the baseline then
// stash again (reclaiming the already-posted partial work too; with an
// upstream detected, skip the reset and only stash with a warning — pushed or
// referenced history stays untouched). A repository with external commits
// mixed in is not rolled back at all (left to human disposal) and goes into
// failures; a repository absent from the baseline (created during the unit)
// only stashes, no reset.
export async function rollbackUnit(
  dir: string,
  baseline: UnitBaseline,
  info: { task: string; unit: string },
): Promise<RollbackResult> {
  const result: RollbackResult = { ok: true, failures: [], stashes: 0, resets: [], skipped: [] }
  const message = `auto-rollback ${info.task} ${info.unit} ${new Date().toISOString()}`
  for (const root of await repoRoots(dir)) {
    const rel = relative(dir, root) || "."
    try {
      const entry = baseline.find((line) => line.root === root)
      const got = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
      const head = got?.code === 0 ? got.out.trim() : ""
      // External commits mixed in: this repository is not rolled back
      // (rollback reclaims only the driver's own within-unit changes).
      if (entry && head && head !== entry.sha) {
        const foreign = await foreignCommits(root, entry.sha)
        if (foreign > 0) {
          result.failures.push({ rel, error: `${foreign} non-driver commit(s) detected (no Auto-Stage trailer); this repo is not rolled back, please handle manually` })
          continue
        }
      }
      // ① stash preserves the scene (the pathspec confines it to this
      // directory's subtree — the target directory may sit inside a larger
      // repository).
      if (await hasChanges(root)) {
        const stashed = await git(root, ["stash", "push", "-u", "-m", message, "--", "."])
        if (stashed.code !== 0) {
          result.failures.push({ rel, error: `git stash exit code ${stashed.code} (${firstLine(stashed.err || stashed.out)})` })
          continue
        }
        result.stashes++
      }
      // ② reclaim this unit's driver commits: no reset is needed without a
      //    baseline (started on an empty repository / created during the
      //    unit) or when HEAD has not moved; a repository with an upstream
      //    only stashes and leaves history untouched.
      const sha = entry?.sha ?? ""
      if (!sha || !head || head === sha) {
        if (!sha && head) {
          result.skipped.push(rel)
          log(`  ⚠ ${rel}: baseline is empty or repo not in baseline; stash only, history not rewound`)
        }
        continue
      }
      const upstream = await git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(() => undefined)
      if (upstream?.code === 0) {
        result.skipped.push(rel)
        log(`  ⚠ ${rel}: upstream detected (${upstream.out.trim()}), skipping reset, stash only (branch history may be referenced)`)
        continue
      }
      const reset = await git(root, ["reset", "--soft", sha])
      if (reset.code !== 0) {
        result.failures.push({ rel, error: `git reset --soft ${sha} exit code ${reset.code} (${firstLine(reset.err || reset.out)})` })
        continue
      }
      result.resets.push(rel)
      if (await hasChanges(root)) {
        const stashed = await git(root, ["stash", "push", "-u", "-m", `${message} (reset)`, "--", "."])
        if (stashed.code !== 0) {
          result.failures.push({ rel, error: `git stash (reset reclaim) exit code ${stashed.code} (${firstLine(stashed.err || stashed.out)})` })
          continue
        }
        result.stashes++
      }
      log(`  ↻ ${rel}: rolled back to baseline ${sha}`)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      result.failures.push({ rel, error: firstLine(text) })
    }
  }
  result.ok = result.failures.length === 0
  return result
}

// Unit start gate result: ok = the baseline is recorded (baseline undefined
// means the gate is off — --commit false / dryrun, and the close-out check
// skips with it); dirty = the dirty area cannot self-heal, hand it to a
// human.
export type UnitGate = { type: "ok"; baseline: UnitBaseline | undefined } | { type: "dirty"; files: string[] }

// Unit start gate: a clean worktree → record the baseline and pass; a dirty
// area entirely of driver-exclusive state files → self-heal with a carryover
// backfill commit then pass; any other dirty area → dirty (the caller blocks
// and halts, writing no state files and making no sweeping commit — the
// authority over git state stays with the human).
export async function beginUnit(
  dir: string,
  opts: { commit?: boolean; dryrun?: boolean },
  task: { id: string; title: string },
): Promise<UnitGate> {
  if (opts.commit === false || opts.dryrun) return { type: "ok", baseline: undefined }
  const dirty = await changedFiles(dir)
  if (dirty.length) {
    if (dirty.every(driverStateFile)) {
      const healed = await commitTree(dir, task, { stage: "carryover", subject: `${task.id} carryover driver-state posting` })
      if (healed.ok) {
        log(`  ✓ driver state files not posted (${dirty.join(", ")}), self-healed with a catch-up commit`)
        return { type: "ok", baseline: await unitBaseline(dir) }
      }
    }
    return { type: "dirty", files: dirty }
  }
  return { type: "ok", baseline: await unitBaseline(dir) }
}

// The ③ backfill commit of a hidden task's idempotent entry: any of the
// named artifact files on the uncommitted list → unified commit (backfill)
// and return the result; none of them (already committed / nonexistent) →
// "clean", no action. The completion condition = artifacts on disk and
// committed, so a successful backfill commit counts as done. A no-op while
// the gate is off.
export async function commitPending(
  dir: string,
  opts: { commit?: boolean; dryrun?: boolean },
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  files: string[],
): Promise<"clean" | CommitResult> {
  if (opts.commit === false || opts.dryrun) return "clean"
  const dirty = await changedFiles(dir)
  if (!files.some((file) => dirty.includes(file))) return "clean"
  return commitTree(dir, task, info)
}

// The repository containing the target directory plus every nested repository
// root under the tree that holds a .git (node_modules excluded; the descent
// continues inside a nested repository, and a nested-of-nested one takes part
// the same). The target directory may sit inside a larger repository, decided
// by git rev-parse; each git command's pathspec `.` keeps the commit scope
// inside that subtree. Returned sorted by descending path depth, guaranteeing
// inner-before-outer commits; the loop's verbose changed-file watch
// (watchFiles) also reuses this discovery.
export async function repoRoots(dir: string): Promise<string[]> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((out) => out.code === 0)
    .catch(() => false)
  const roots = new Set<string>(inRepo ? [dir] : [])
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    if (entries.some((entry) => entry.name === ".git")) roots.add(current)
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules") {
        pending.push(join(current, entry.name))
      }
    }
  }
  return [...roots].sort((a, b) => depth(b) - depth(a))
}

function depth(path: string): number {
  return path.split(sep).length
}

// The worktree's list of uncommitted changed files (paths relative to the
// target directory): the target directory itself (possibly inside a larger
// repository, confined to the subtree by the pathspec `-- .`) plus every
// subdirectory holding a .git (nested repositories, including the .git files
// of worktrees/submodules; repository discovery reuses this file's
// repoRoots). A non-git environment returns the empty array.
// This function (and gitStatusFiles) was hoisted here from loop.ts for the
// loop's changed-file watch and resolve.ts's end-of-session scan to share:
// exporting it from loop.ts would create a loop → runner → resolve → loop
// circular dependency, and mirroring a copy in resolve.ts would leave two
// repository traversals that must evolve in sync; git.ts is a leaf module
// (depends only on log.ts) and already holds repoRoots and the same porcelain
// parsing. The decision is recorded in plans/0020-auto-resolve-design.md §N.
export async function changedFiles(dir: string): Promise<string[]> {
  const lists = await Promise.all((await repoRoots(dir)).map((root) => statusEntries(dir, root)))
  return lists.flat().map((entry) => entry.rel)
}

// The list of untracked (= created by this unit) files (the "new .md"
// criterion of the shape check, session-boundary-hardening §4.3): the ??
// entries of each repository's porcelain status, relative to the target
// directory. beginUnit guarantees a clean worktree when the unit starts, so
// untracked = created by this unit; a nested repository's inner files are
// listed by its own status, so the criterion is uniform across repositories.
// A non-git environment returns the empty set.
export async function untrackedFiles(dir: string): Promise<Set<string>> {
  const lists = await Promise.all((await repoRoots(dir)).map((root) => statusEntries(dir, root)))
  return new Set(lists.flat().filter((entry) => entry.status === "??").map((entry) => entry.rel))
}

// --porcelain -z --no-renames -uall: NUL-separated per-file output with no
// rename arrows; each entry is "XY <path>", the path relative to the
// repository root (the worktree top level), converted to a path relative to
// the target directory. Under -uall the only entries still collapsed to
// "?? dir/" are nested repository directories (their inner files are listed
// separately by that repository's own status), skipped to avoid duplication.
// The XY status code is kept with each entry (the untracked criterion and the
// listing share one parsing pass).
async function statusEntries(dir: string, root: string): Promise<{ rel: string; status: string }[]> {
  const phys = await physicalDir(dir)
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const toplevel = (await new Response(top.stdout).text()).trim()
  if ((await top.exited) !== 0 || !toplevel) return []
  const proc = Bun.spawn(
    ["git", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."],
    { stdout: "pipe", stderr: "ignore" },
  )
  const output = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return []
  return output
    .split("\0")
    .filter((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
    .map((entry) => ({ rel: relative(phys, join(toplevel, entry.slice(3))), status: entry.slice(0, 2) }))
}

// Whether the repository has uncommitted changes (confined to this
// directory's subtree; a collapsed directory entry can only be a nested
// repository, handled separately by its own commit). When git is unavailable
// (spawn throws), treat as no changes.
async function hasChanges(root: string): Promise<boolean> {
  const status = await git(root, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."]).catch(() => undefined)
  if (!status || status.code !== 0) return false
  return status.out.split("\0").some((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
}

// init's prerequisite check: when the target directory is inside a git work
// tree, a commit identity must resolve (user.name/user.email config or the
// GIT_*_NAME/GIT_*_EMAIL env vars; judged via `git var`, the same resolution a
// commit applies) — the unified commit is the completion condition, so a
// missing identity means every later commit fails. A non-git directory (where
// the driver never commits) returns undefined.
export async function commitIdentityProblem(dir: string): Promise<string | undefined> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.code === 0)
    .catch(() => false)
  if (!inRepo) return undefined
  for (const [variable, role] of [["GIT_AUTHOR_IDENT", "author"], ["GIT_COMMITTER_IDENT", "committer"]] as const) {
    const result = await git(dir, ["var", variable]).catch(() => undefined)
    if (result?.code !== 0) return `${role} identity unknown (${result?.err.trim().split("\n").at(-1) ?? "git is not available"})`
  }
  return undefined
}

// git identity fallback: when the repository has no user.email configured,
// commit under a fixed identity so a pristine environment does not fail the
// commit (-c applies to that one call only; configured repositories are
// unaffected).
async function identityArgs(root: string): Promise<string[]> {
  const email = await git(root, ["config", "user.email"])
  if (email.code === 0 && email.out.trim()) return []
  return ["-c", "user.name=opencode-auto", "-c", "user.email=opencode-auto@local"]
}

async function git(root: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out, err }
}

// git names paths physically: after `git -C <dir>` chdir resolves symlinks,
// `rev-parse --show-toplevel` and the porcelain/diff/ls-files listings all
// report real paths, while dir may reach the same directory through a symlink
// (macOS $TMPDIR → /private/var/…, or any symlinked project path). Mixing the
// two in relative() climbs out in ../../.. chains instead of naming the file
// inside the tree, so every point that turns git output into a
// target-directory-relative path canonicalizes dir first and compares
// physical against physical; on a symlink-free path realpath(dir) is dir
// itself and the result is byte-identical to before.
export async function physicalDir(dir: string): Promise<string> {
  return await realpath(dir).catch(() => dir)
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0]!.slice(0, 200)
}

// The document side: the target directory's own docs/ — changes there do not
// affect test results and do not trigger a handover retest (the test-handover
// front-loading design D5). All other tracked files (source code and scripts
// under test/, files inside nested repositories included) always count.
function documentOnly(rel: string): boolean {
  return rel === "docs" || rel.startsWith(`docs${sep}`)
}

// The list of **tracked** files changed since HEAD (= the handover freeze
// commit), relative to the target directory, excluding the document side.
// Untracked additions do not count (D5) — a newly created file that takes
// part in compilation slips through; that is the known trade-off, buying
// "documents/artifacts the session wrote at its end do not trigger a
// registration for nothing". The test handover's concurrent mode registers
// drift by this: non-empty means "the frozen snapshot this test ran on and
// the tree about to be posted are not the same"; it records the fact and
// takes no action (E3). A non-git environment returns the empty array.
export async function trackedSourceChanges(dir: string): Promise<string[]> {
  const lists = await Promise.all((await repoRoots(dir)).map((root) => gitDiffFiles(dir, root)))
  return lists.flat().filter((rel) => !documentOnly(rel))
}

// git diff --name-only -z HEAD -- .: tracked files' changes against HEAD
// (staged and unstaged merged, untracked excluded), paths relative to the
// repository root, converted to relative to the target directory. Before the
// first commit (no HEAD) and in a non-git directory, returns empty.
async function gitDiffFiles(dir: string, root: string): Promise<string[]> {
  const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
  const toplevel = top?.code === 0 ? top.out.trim() : ""
  if (!toplevel) return []
  const phys = await physicalDir(dir)
  // --ignore-submodules=all: a nested repository is a single gitlink in the
  // outer one; changes to its inner files are listed separately by that
  // repository's own diff; not ignoring it would report the whole nested
  // directory once more (the same reasoning as gitStatusFiles skipping
  // collapsed directory entries).
  const diff = await git(root, ["diff", "--name-only", "-z", "--ignore-submodules=all", "HEAD", "--", "."]).catch(() => undefined)
  if (!diff || diff.code !== 0) return []
  return diff.out.split("\0").filter(Boolean).map((path) => relative(phys, join(toplevel, path)))
}


// Scene restoration of handover documents (test-handover interruption
// recovery F3): the list of files that are committed and tracked yet deleted
// in the worktree (relative to the target directory). After a test handover
// is interrupted midway, the next run's stale cleanup may delete an
// already-posted handover document — that is not a "leftover", it is
// in-flight state; restore it with git as the authority, and the restoration
// incidentally clears the dirty area, letting the unit clean gate pass
// naturally. The pathspec confines it to the target directory's subtree.
export async function deletedFiles(dir: string, pathspec: string): Promise<string[]> {
  const top = await git(dir, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
  const toplevel = top?.code === 0 ? top.out.trim() : ""
  if (!toplevel) return []
  const phys = await physicalDir(dir)
  const listed = await git(dir, ["ls-files", "--deleted", "-z", "--", pathspec]).catch(() => undefined)
  if (!listed || listed.code !== 0) return []
  // ls-files paths are relative to the repository root (also when the cwd is
  // a subdirectory); converted to relative to the target directory.
  return listed.out.split("\0").filter(Boolean).map((path) => relative(phys, join(toplevel, path)))
}

// Restoring a single file: retrieve it from the index (a deleted tracked
// file's index entry is still there; retrieving yields the last commit's
// content). Returns false in a non-git environment or when the file is not
// tracked; the caller treats it as "nothing to restore".
export async function restoreFile(dir: string, rel: string): Promise<boolean> {
  const done = await git(dir, ["checkout", "--", rel]).catch(() => undefined)
  return done?.code === 0
}

// Whether a single file is tracked by git (already posted): the stale cleanup
// distinguishes "leftover" from "in-flight" by this.
export async function fileTracked(dir: string, rel: string): Promise<boolean> {
  const tracked = await git(dir, ["ls-files", "--error-unmatch", "--", rel]).catch(() => undefined)
  return tracked?.code === 0
}

// Whether git ignores a path relative to dir (`git check-ignore`): true =
// ignored; false = not ignored, which includes a tracked file (ignore rules
// apply to untracked files only, so a tracked file's changes still commit);
// undefined = dir is not inside a git work tree (nothing commits the path).
export async function gitIgnored(dir: string, rel: string): Promise<boolean | undefined> {
  const result = await git(dir, ["check-ignore", "-q", "--", rel]).catch(() => undefined)
  if (result?.code === 0) return true
  if (result?.code === 1) return false
  return undefined
}

// Delete only when git does not track the file (the shared semantics of the
// handover-document family's stale cleanup, the same narrowing as
// testhandoff's F4): a tracked file is already-posted state, deleting it is a
// dirty area — the authority to judge in-flight or not is left to the
// recovery semantics (or a human); the cleanup never manufactures a dirty
// area by itself to hit the next execution unit's clean gate.
export async function removeIfUntracked(dir: string, rel: string): Promise<void> {
  if (await fileTracked(dir, rel)) return
  await rm(join(dir, rel), { force: true })
}

// Whether a single file is "already posted": tracked by git and the worktree
// copy equals the commit. Test-handover recovery judges by this whether
// commit #2 has already happened (the archived copy posted = the handover
// close-out complete), and by it also certifies the content whole (F2: the
// file was whole at the moment of the commit; a missing status line is a
// historical-format problem, not a truncated file).
export async function fileCommitted(dir: string, rel: string): Promise<boolean> {
  if (!(await fileTracked(dir, rel))) return false
  const status = await git(dir, ["status", "--porcelain", "-z", "--", rel]).catch(() => undefined)
  if (!status || status.code !== 0) return false
  return status.out.split("\0").filter(Boolean).length === 0
}
