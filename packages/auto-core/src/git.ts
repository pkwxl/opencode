import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { AddedLine } from "./document/types"
import { log } from "./log"
import type { PhaseKey } from "./phases/registry"

// driver unified commit mechanism: revokes the commit right from AI sessions —
// after any session ends the driver recursively commits all changes (nested
// repositories first, then the repository containing the target directory),
// with the commit message carrying the task id and phase, making git history
// the audit trail of AI changes (granularity of tracing and rollback =
// session). A session never runs git commit (constrained in sync by the
// AGENTS.md commit-principles block and the agent contract).
//
// Split (plans/0102 E-α2): the lane-worktree family lives in
// src/git-worktree.ts, the branch-isolation/landing family in
// src/git-land.ts — leaves importing this module's spawn helper and the
// shared merge vocabulary; this file keeps the commit-boundary core and the
// git service seam.

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
// Under dryrun (and under the test-only no-commit double in git-ops.ts) the
// gates are wholly inactive.

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
export function message(subject: string, task: { id: string }, stage: string, nested: { rel: string; sha: string }[] = [], body?: string): string {
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
// paths (plans/0099 D4): the add step's pathspec, target-directory-relative —
// absent = today's whole-subtree sweep (`.`), the byte-identical floor. The
// doc-lane seam decorator injects it (never a caller): a live doc unit's
// effective scope, or everything-minus-the-live-scopes
// (`. ':(exclude)<scope>' …`). The scoping applies at the outer repository
// only (the root that is the target directory itself); nested roots commit
// whole as before — they are reachable solely through doc-ineligible units,
// which drain first (D9), and the D6 landing guard has already blocked any
// stray nested write before the add runs. The skip check narrows with the
// same pathspec (hasChanges below), so a scoped add that would stage nothing
// skips the repository instead of failing the commit.
export async function commitTree(
  dir: string,
  task: { id: string; title: string },
  info: { stage: string; subject: string; body?: string },
  paths?: readonly string[],
): Promise<CommitResult> {
  const roots = await repoRoots(dir)
  const subject = commitTitle(info.subject)
  const failures: { rel: string; error: string }[] = []
  for (const root of roots) {
    const rel = relative(dir, root) || "."
    const spec = root === dir ? paths : undefined
    try {
      if (!(await hasChanges(root, spec))) continue
      let added = await git(root, ["add", "-A", "--", ...(spec ?? ["."])])
      if (added.code !== 0 && spec !== undefined) {
        // The pathspec tolerance (plans/0099 D4): `git status` beside the
        // add tolerates a pathspec matching nothing, `git add` fatals on it
        // — and a declared `Touches` entry is a scope bound, never a
        // promise the file exists (a shared document the unit ends up not
        // touching, a directory still empty). The offending pathspecs are
        // named in the message; dropped, the add stages everything the
        // remaining scope covers, which is exactly the dirt hasChanges
        // already vouched for.
        let drop = [...spec]
        while (added.code !== 0 && /did not match any files/.test(`${added.err}${added.out}`)) {
          const named = [...`${added.err}${added.out}`.matchAll(/pathspec '([^']+)' did not match/g)].map((match) => match[1]!)
          if (!named.length || drop.length === named.length) break
          drop = drop.filter((entry) => !named.includes(entry))
          added = drop.length ? await git(root, ["add", "-A", "--", ...drop]) : { code: 0, out: "", err: "" }
        }
      }
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

// —— The side-effect guard of driver-run scripts (plans/0083 D11) ——
//
// Causality by construction: a driver-run script executes synchronously while
// the session sits idle at its turn boundary waiting for the result, so any
// tracked delta between the pre-run and post-run reads *is* the script's.
// The pre-run read is `git stash create` — it snapshots index + worktree
// (session work-in-progress included) touching nothing on disk and storing
// no ref, so the stash list and the worktree are exactly as they were — plus
// the HEAD sha, recursively over nested repositories as the unified commit
// walks them. The post-run read restores tracked mutations from the snapshot
// (`git checkout <stash-sha> -- <paths>`, pre-run content, session WIP
// included) and hard-blocks on a moved HEAD. Named residuals (D11): a
// mutation that lands byte-identical to the snapshot is undetectable and
// harmless; untracked files are not git-managed content and stay.

// One repository's pre-run snapshot. stash is the `git stash create` commit
// sha, or the empty string when the worktree was clean (the snapshot then is
// HEAD itself).
export type ScriptGuardShot = { root: string; head: string; stash: string }

export async function scriptGuardSnapshot(dir: string): Promise<ScriptGuardShot[]> {
  const shots: ScriptGuardShot[] = []
  for (const root of await repoRoots(dir)) {
    const head = (await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim() ?? ""
    const stash = (await git(root, ["stash", "create"]).catch(() => undefined))?.out.trim() ?? ""
    shots.push({ root, head, stash })
  }
  return shots
}

// The violation the post-run read found: tracked = the script modified or
// deleted tracked files (already restored from the snapshot — restored lists
// the paths, target-directory-relative; unrestorable lists paths the restore
// could not put back, with git's error); head = the script moved a
// repository's HEAD (a commit/rebase/reset ran) — no auto-undo, the caller
// hard-blocks for the human, the corrupted-baseline family.
export type ScriptGuardViolation =
  | { kind: "tracked"; restored: string[]; unrestorable: { path: string; error: string }[] }
  | { kind: "head"; moved: { root: string; from: string; to: string }[] }

// The post-run read over every snapshotted repository. Returns undefined
// when the script left git-managed content alone.
export async function scriptGuardCheck(dir: string, shots: readonly ScriptGuardShot[]): Promise<ScriptGuardViolation | undefined> {
  if (!shots.length) return undefined
  const moved: { root: string; from: string; to: string }[] = []
  const changed: { root: string; source: string; paths: string[] }[] = []
  for (const shot of shots) {
    const head = (await git(shot.root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim() ?? ""
    if (head !== shot.head) moved.push({ root: relative(dir, shot.root) || ".", from: shot.head, to: head })
    // The tracked-changed paths of this repository (porcelain paths are
    // root-relative under -C; untracked entries are not git-managed content
    // and stay, D11's residual).
    const status = await git(shot.root, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."]).catch(() => undefined)
    const tracked = (status?.out ?? "")
      .split("\0")
      .filter((entry) => entry && !entry.startsWith("?? "))
      .map((entry) => entry.slice(3))
    if (!tracked.length) continue
    // The snapshot to compare against and restore from: the stash commit, or
    // HEAD when the worktree was clean before the run.
    const source = shot.stash || "HEAD"
    // Only paths the script actually changed (a session-WIP path the script
    // never touched compares equal against the snapshot and drops out — the
    // byte-identical residual). One diff per repository over the tracked set.
    const diff = await git(shot.root, ["diff", "--name-only", "-z", "--ignore-submodules=all", source, "--", ...tracked]).catch(() => undefined)
    const differs = (diff?.out ?? "")
      .split("\0")
      .filter(Boolean)
    if (differs.length) changed.push({ root: shot.root, source, paths: differs })
  }
  if (moved.length) return { kind: "head", moved }
  if (!changed.length) return undefined
  const restored: string[] = []
  const unrestorable: { path: string; error: string }[] = []
  for (const repo of changed) {
    const checkout = await git(repo.root, ["checkout", repo.source, "--", ...repo.paths])
    if (checkout.code === 0) {
      restored.push(...repo.paths.map((path) => relative(dir, join(repo.root, path)) || path))
    } else {
      unrestorable.push(...repo.paths.map((path) => ({ path: relative(dir, join(repo.root, path)) || path, error: firstLine(checkout.err || checkout.out) || `git checkout exit code ${checkout.code}` })))
    }
  }
  if (!restored.length && !unrestorable.length) return undefined
  return { kind: "tracked", restored, unrestorable }
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

// Whether a repository-relative path lies inside one of the scope entries
// (an entry may name a file or a directory, trailing slash optional): equal
// paths count, and a directory entry contains every path under it. The doc
// lanes' surfaces read it (plans/0099): the seam decorator's landing guard
// and start-gate relaxation (src/git-ops.ts), the close-out exclusion and
// the scans' scope filter (below). git.ts is a leaf module, so the
// containment lives here rather than in lanes.ts's overlap vocabulary
// (which would close a cycle); an empty entry set — like an absent
// parameter — contains nothing.
export function withinScopes(rel: string, scopes: readonly string[]): boolean {
  const path = rel.replaceAll("\\", "/")
  return scopes.some((scope) => {
    const dir = scope.replaceAll("\\", "/").replace(/\/+$/, "")
    return dir !== "" && (path === dir || path.startsWith(`${dir}/`))
  })
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
// exclude (plans/0099 D7): paths clause ① tolerates — under doc-lane
// concurrency a unit's range closes while sibling scopes hold in-flight
// writes, and quarantined stray writes survive for the human by design, so
// the doc-lane caller passes the live scopes ∪ quarantine. Absent (or
// empty) = today's function, byte-identical; clause ② is unchanged either
// way (interleaved sibling commits all carry the trailer, a foreign commit
// is still caught).
export async function unitViolations(dir: string, baseline: UnitBaseline, exclude?: readonly string[]): Promise<string[]> {
  if (!baseline.length) return []
  const problems: string[] = []
  const dirty = (await changedFiles(dir)).filter((rel) => !withinScopes(rel, exclude ?? []))
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
// scope (plans/0099 D7): the diff gains the pathspec and the untracked walk
// filters by it, so blame never crosses units under doc-lane concurrency
// (the baseline..worktree range contains the siblings' writes). Absent =
// today's whole-subtree question, byte-identical.
export async function unitChangedFiles(dir: string, baseline: UnitBaseline, scope?: readonly string[]): Promise<Set<string>> {
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
    // own diff (the same reasoning as statusEntries).
    const diff = await git(root, ["diff", "--name-only", "-z", "--diff-filter=d", "--ignore-submodules=all", sha || EMPTY_TREE, "--", ...(scope ?? ["."])])
    if (diff.code !== 0) continue
    for (const path of diff.out.split("\0").filter(Boolean)) files.add(relative(phys, join(toplevel, path)))
  }
  for (const rel of await untrackedFiles(dir)) {
    if (scope !== undefined && !withinScopes(rel, scope)) continue
    files.add(rel)
  }
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
// scope (plans/0099 D7): the diff gains the pathspec and the untracked walk
// filters by it — under doc-lane concurrency the unit's attribution must be
// its own writes alone. Absent = today's whole-subtree diff, byte-identical.
export async function unitAddedLines(dir: string, baseline: UnitBaseline, scope?: readonly string[]): Promise<Map<string, AddedLine[]>> {
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
      ...(scope ?? ["."]),
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
    if (scope !== undefined && !withinScopes(rel, scope)) continue
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
// `sha..<to>` range (= the number of external commits; to defaults to HEAD,
// the unit close-out and recovery callers' shape). An empty-string sha means
// the repository had no commits when the range started — check the full
// history. Shared by unitViolations, the recovery-fidelity baseline check /
// rollback, and `land`'s foreign-commit refusal over the round branch
// (plans/0074 §2.3).
export async function foreignCommits(root: string, sha: string, to: string = "HEAD"): Promise<number> {
  const bodies = await git(root, ["log", "-z", "--format=%B", ...(sha ? [`${sha}..${to}`] : [to])])
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
// means the gate idled — dryrun here, or the no-commit double on the seam,
// and the close-out check skips with it); dirty = the dirty area cannot
// self-heal, hand it to a human.
export type UnitGate = { type: "ok"; baseline: UnitBaseline | undefined } | { type: "dirty"; files: string[] }

// Unit start gate: a clean worktree → record the baseline and pass; a dirty
// area entirely of driver-exclusive state files → self-heal with a carryover
// backfill commit then pass; any other dirty area → dirty (the caller blocks
// and halts, writing no state files and making no sweeping commit — the
// authority over git state stays with the human).
export async function beginUnit(dir: string, opts: { dryrun?: boolean }, task: { id: string; title: string }): Promise<UnitGate> {
  if (opts.dryrun) return { type: "ok", baseline: undefined }
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
// the gate idles (dryrun; the seam's no-commit double answers "clean"
// without reaching here).
export async function commitPending(
  dir: string,
  opts: { dryrun?: boolean },
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  files: string[],
): Promise<"clean" | CommitResult> {
  if (opts.dryrun) return "clean"
  const dirty = await changedFiles(dir)
  if (!files.some((file) => dirty.includes(file))) return "clean"
  return commitTree(dir, task, info)
}

// —— The split modules' shared vocabulary (plans/0102 E-α2) ——
//
// The lane-worktree family lives in src/git-worktree.ts and the branch-
// isolation/landing family in src/git-land.ts — leaves beside this module,
// importing the spawn helper and the builders exported here (git,
// firstLine, identityArgs, message). The merge vocabulary below stays at
// this common root on purpose: both split families and the GitOps seam
// reference these types, and the type-counted import graph keeps git.ts
// importing from neither split module (each imports this one), so a type
// either side named would close a cycle the direction suite rejects.

// The result of the landing/repair merges (landBranch and mergeLaneUpstream
// in git-worktree.ts; squashOnto and mergeNoFf in git-land.ts): ok, a
// conflict (the merge aborted back to a clean state, kept for the caller's
// conflict protocol), or the raw failure.
export type LandResult = { type: "ok" } | { type: "conflict"; detail: string } | { type: "failed"; error: string }

// The conflict classifier every landing/repair merge shares: git's own
// wording for a conflicted or un-mergeable state (across its versions and
// translations, hence the alternation).
export function isConflict(out: string, err: string): boolean {
  return /conflict|CONFLICT|Automatic merge failed|could not be fast-forwarded/i.test(`${out}\n${err}`)
}

// The abort tail of a conflicted real merge (landBranch, mergeLaneUpstream,
// mergeNoFf): `git merge --abort` restores the pre-merge state, which the
// clean check verifies — a clean abort reports the conflict (the caller's
// protocol keeps the branch for manual resolution), a dirty or failed abort
// is beyond the tool. `merged` is the failed merge itself (its first line is
// the conflict detail); `whose` names who must handle the dirty case.
export async function abortToLandResult(root: string, merged: { code: number; out: string; err: string }, whose: string): Promise<LandResult> {
  const aborted = await git(root, ["merge", "--abort"])
  if (aborted.code === 0 && !(await changedFiles(root)).length) {
    return { type: "conflict", detail: firstLine(merged.err || merged.out) }
  }
  return { type: "failed", error: `git merge --abort exit code ${aborted.code} (${firstLine(aborted.err || aborted.out)}); ${whose} must be handled manually` }
}

// The result of a lane-worktree operation: ok, or the error's first line (the
// caller logs it and decides between blocking and keeping the scene). Shared
// by git-worktree.ts's worktree operations and git-land.ts's checkoutBranch.
export type WorktreeResult = { ok: boolean; error?: string }

// —— The git service (the run services' commit-side seam) ——

// The run's git service: the commit-side operations the kernel and the
// session-driving engine call, behind one seam so the strategy is
// switchable per run — the production instance (createGitOps,
// src/git-ops.ts) delegates to the free functions of this module and the
// lane-worktree family (src/git-worktree.ts), committing always on, while
// a test installs the no-commit double (noCommitGit) and
// the engine runs with committing off, answering exactly what the gates
// these functions used to carry under `commit: false` answered then (the
// commit halves are gone; the double is the off path now). The free
// exports stay for the callers outside a run's services (the close
// command, the recovery paths): they keep calling the functions directly.
//
// The opts parameters carry no commit half — only the dryrun flag remains
// (dryrun still idles the production instance's delegated gates; the
// double overrides each method whole, so the flag is inert there).
// afterSession keeps an options slice — dryrun plus the phase its marker
// collection keys the ledger on; callers pass the session Opts whole,
// which the slice accepts structurally.
//
// `records` is the strategy marker the strict-resume activation and the
// baseline-reading sites consult (the commit switch's former "not false"
// conjunct): true = this instance commits and the recovery records may
// carry their baseline/model fields; false = the double, under which they
// stay unwritten, exactly as the gates kept them.
// AUTO-DECISION: the type's home is git.ts — opts.ts type-imports it for
// the Opts.git carrier, and git.ts imports neither opts.ts nor any module
// above it, so the type-counted import graph stays a DAG (the module is a
// leaf beside log and the document types, so every reader may reference
// the type cheaply). Rejected homes: unit-commit.ts and git-ops.ts (the
// factories' home — both import modules that read run state, unit-commit
// even opts at runtime, which the cycle rule forbids for an opts.ts
// type-import target). afterSession's return shape is inlined structurally
// for the same reason: importing SessionCommit from opts.ts would close
// opts → git → opts.
export type GitOps = {
  readonly records: boolean
  // commitTree's optional add pathspec (plans/0099 D4) is the doc-lane seam
  // decorator's injection point — never a caller's argument: absent = the
  // whole-subtree sweep, the byte-identical floor every existing call site
  // keeps by passing nothing.
  commitTree(
    dir: string,
    task: { id: string; title: string },
    info: { stage: string; subject: string; body?: string },
    paths?: readonly string[],
  ): Promise<CommitResult>
  beginUnit(dir: string, opts: { dryrun?: boolean }, task: { id: string; title: string }): Promise<UnitGate>
  commitPending(
    dir: string,
    opts: { dryrun?: boolean },
    task: { id: string; title: string },
    info: { stage: string; subject: string },
    files: string[],
  ): Promise<"clean" | CommitResult>
  afterSession(
    dir: string | undefined,
    opts: { dryrun?: boolean; phase?: PhaseKey },
    task: { id: string; title: string },
    info: { stage: string; subject: string },
    baseline?: UnitBaseline,
  ): Promise<{ type: "ok" } | { type: "failed"; question: string }>
  unitBaseline(dir: string): Promise<UnitBaseline>
  changedFiles(dir: string): Promise<string[]>
  // Lane worktrees and the landing merge (plans/0068 §6.5, D7): the dispatch
  // and landing choreography (src/lanes.ts) reaches these through the seam so
  // a test's holder can switch the whole lane machinery off with the double.
  // addWorktree's optional sparse set is plans/0096 D9's tier-1 materialization
  // (a --no-checkout worktree populated by cone-mode sparse + reflink);
  // absent = the full checkout of 0068.
  addWorktree(dir: string, path: string, branch: string, sparse?: readonly string[]): Promise<WorktreeResult>
  removeWorktree(dir: string, path: string): Promise<WorktreeResult>
  pruneWorktrees(dir: string): Promise<WorktreeResult>
  landBranch(dir: string, branch: string, task: { id: string; title: string }, own?: readonly string[]): Promise<LandResult>
}

// The repository containing the target directory plus every nested repository
// root under the tree that holds a .git (node_modules excluded; the descent
// continues inside a nested repository, and a nested-of-nested one takes part
// the same). The target directory may sit inside a larger repository, decided
// by git rev-parse; each git command's pathspec `.` keeps the commit scope
// inside that subtree. Returned sorted by descending path depth, guaranteeing
// inner-before-outer commits; the loop's verbose changed-file watch
// (watchFiles) also reuses this discovery.
// The lane park (plans/0068 D16/F6) is skipped: a linked worktree parked in
// `.auto/worktrees/` holds a `.git` **file**, and the entry test below cannot
// tell it from a nested repository — a lane worktree classified as one would
// be separately committed by the unified commit and swept into the parent's
// Auto-Nested lines. The park is gitignored with the rest of `.auto/`, so
// skipping its subtree changes nothing else.
export async function repoRoots(dir: string): Promise<string[]> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((out) => out.code === 0)
    .catch(() => false)
  const roots = new Set<string>(inRepo ? [dir] : [])
  const park = join(dir, ".auto", "worktrees")
  const pending = [dir]
  while (pending.length) {
    const current = pending.pop()!
    const entries = await readdir(current, { withFileTypes: true }).catch(() => [])
    if (entries.some((entry) => entry.name === ".git")) roots.add(current)
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== ".git" && entry.name !== "node_modules" && join(current, entry.name) !== park) {
        pending.push(join(current, entry.name))
      }
    }
  }
  return [...roots].sort((a, b) => depth(b) - depth(a))
}

function depth(path: string): number {
  return path.split(sep).length
}

// The nested repositories inside the target, as directory-relative path
// prefixes (repoRoots minus the target itself; callers pass either the
// roots or a unit baseline's root list): each is a shipped, self-contained
// deliverable — the destination of a migration or an isolated component —
// and the P1 scan's destination-containment rules key on the membership
// (document/process-refs.ts, plans/0103). Sorted longest-first so the
// deepest prefix wins where nested repositories nest.
export function nestedRepoPrefixes(dir: string, roots: readonly string[]): string[] {
  return roots
    .map((root) => relative(dir, root).replaceAll("\\", "/").replace(/\/+$/, ""))
    .filter((prefix) => prefix.length > 0 && !prefix.startsWith(".."))
    .sort((a, b) => b.length - a.length)
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
// listing share one parsing pass). Exported since plans/0074: `land`'s dirty
// gate lists one designated repository's uncommitted paths the same way
// isolateRound's does.
export async function statusEntries(dir: string, root: string): Promise<{ rel: string; status: string }[]> {
  const phys = await physicalDir(dir)
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const toplevel = (await new Response(top.stdout).text()).trim()
  if ((await top.exited) !== 0 || !toplevel) return []
  const proc = Bun.spawn(
    ["git", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."],
    // The same GIT_OPTIONAL_LOCKS=0 the spawn helper sets (plans/0099 D4):
    // this status runs outside the doc-lane commit queue (beginUnit's dirty
    // check, the close-out checks), and the env form covers the one site
    // that does not route through the helper.
    { stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
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
// (spawn throws), treat as no changes. paths narrows the check the way the
// commit's add step is narrowed (plans/0099 D4): absent = the whole subtree
// (today's question, byte-identical).
async function hasChanges(root: string, paths?: readonly string[]): Promise<boolean> {
  const status = await git(root, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--", ...(paths ?? ["."])]).catch(() => undefined)
  if (!status || status.code !== 0) return false
  return status.out.split("\0").some((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
}

// init's prerequisite check: when the target directory is inside a git work
// tree, a commit identity must resolve (user.name/user.email config or the
// GIT_*_NAME/GIT_*_EMAIL env vars; judged via `git var`, the same resolution a
// commit applies) — the unified commit is the completion condition, so a
// missing identity means every later commit fails. A non-git directory
// returns undefined (init bootstraps a repository first — bootstrapRepository
// below — so the probe at init always sees a work tree; the non-git answer
// remains for the other callers and the test seam).
// The probes run with `-c user.useConfigOnly=true`: plain `git var` also
// succeeds with an auto-detected ident (username@hostname, fabricated from the
// machine without any config file) on machines where git can build one, while
// a real commit still refuses that ident (strict mode) — useConfigOnly
// disables exactly that auto-detection fallback and nothing else, so the probe
// fails precisely when the identity is not explicit (config or env), matching
// "nothing to fall back to" semantics.
// AUTO-DECISION: inject user.useConfigOnly=true into both `git var` probes
// (auto-detected user@host idents pass plain `git var` on machines that can
// fabricate them, so init would wrongly accept a repository whose commits all
// fail; useConfigOnly makes the probe fail exactly when no explicit identity
// resolves, while env-provided identity is still honored).
//
// Identity policy, target-root half (plans/0073 §2.2, the pair of the
// identityArgs block below): init demands an explicit, attributable identity
// for the repository at the target root — a resolving global/`GIT_*` identity
// (this probe) → proceed, nothing written; else init's --name/--email flags →
// written as repository-local config (writeLocalIdentity below, never
// --global); else init refuses. The opencode-auto@local fallback is
// deliberately NOT applied to the target root: the root repository's history
// is the audit trail of AI changes, and it keeps a real person's name on it.
export async function commitIdentityProblem(dir: string): Promise<string | undefined> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((result) => result.code === 0)
    .catch(() => false)
  if (!inRepo) return undefined
  for (const [variable, role] of [["GIT_AUTHOR_IDENT", "author"], ["GIT_COMMITTER_IDENT", "committer"]] as const) {
    const result = await git(dir, ["-c", "user.useConfigOnly=true", "var", variable]).catch(() => undefined)
    if (result?.code !== 0) return `${role} identity unknown (${result?.err.trim().split("\n").at(-1) ?? "git is not available"})`
  }
  return undefined
}

// —— init's git bootstrap (plans/0073) ——

// init's git bootstrap result: "existing" = the target directory already sits
// inside a git work tree (nothing done — in-repo init behavior unchanged);
// "created" = the repository was initialized, branch naming the HEAD branch
// the bootstrap left (an unborn symbolic ref, read via symbolic-ref);
// "failed" = git init itself failed (error = git's first line), the caller
// refuses init rather than running on without the record.
export type BootstrapResult = { type: "existing" } | { type: "created"; branch: string } | { type: "failed"; error: string }

// init's git bootstrap (plans/0073): when the target directory sits inside no
// git work tree, init creates the repository itself, so the unified commit,
// the unit baselines, the rollback and the audit trail can never again be
// silently absent (the retired non-git tier: commitIdentityProblem returned
// undefined, repoRoots returned [], and every commit-side gate idled without
// a word — the person discovered it only when looking for the history that
// was never written).
// Branch: the person's init.defaultBranch when they set one (any config layer
// git reads; git init applies it on its own), `-b main` only as the fallback
// (ruling 3 of 2026-10-04 — never git's own master-era default). In init only
// (the caller's duty); no escape hatch exists — no --no-git, the caller's
// loud print is the disclosure. Runs before the identity probe and before
// ensureInitGitignore, joining init's everything-before-first-write check
// phase: a refusal later in that phase still leaves no config written, and
// the empty repository the bootstrap leaves behind is `rm -rf .git` away from
// undone (plans/0073 §4's mitigation).
export async function bootstrapRepository(dir: string): Promise<BootstrapResult> {
  const inRepo = await git(dir, ["rev-parse", "--is-inside-work-tree"])
    .then((out) => out.code === 0)
    .catch(() => false)
  if (inRepo) return { type: "existing" }
  // init.defaultBranch decides when the person set it (global/system/whatever
  // git reads in this environment); its absence is the -b main fallback.
  const setting = await git(dir, ["config", "--get", "init.defaultBranch"]).catch(() => undefined)
  const created = await git(dir, setting?.code === 0 && setting.out.trim() ? ["init"] : ["init", "-b", "main"])
  if (created.code !== 0) {
    return { type: "failed", error: firstLine(created.err || created.out) || `git init exit code ${created.code}` }
  }
  // The unborn HEAD's symbolic name (symbolic-ref works before the first
  // commit, where rev-parse HEAD does not) — what the caller prints loudly.
  const named = await git(dir, ["symbolic-ref", "--short", "HEAD"])
  const branch = named.code === 0 ? named.out.trim() : ""
  if (!branch) return { type: "failed", error: "the created repository's branch is unreadable (git symbolic-ref failed)" }
  return { type: "created", branch }
}

// The flag half of the identity policy (plans/0073 §2.2, the pair of the
// comment blocks at commitIdentityProblem above and identityArgs below):
// --name/--email given at init are written as **repository-local** git config
// (user.name/user.email in the repository at the target root — never
// --global; the tool never edits the person's global config). The caller
// reaches here only when the probe found no resolving global/`GIT_*`
// identity; a resolving one always wins and nothing is written. Returns
// git's first error line, or undefined on success.
export async function writeLocalIdentity(dir: string, identity: { name: string; email: string }): Promise<string | undefined> {
  for (const [key, value] of [["user.name", identity.name], ["user.email", identity.email]] as const) {
    const set = await git(dir, ["config", key, value])
    if (set.code !== 0) return firstLine(set.err || set.out) || `git config ${key} exit code ${set.code}`
  }
  return undefined
}

// git identity fallback: when the repository has no user.email configured,
// commit under a fixed identity so a pristine environment does not fail the
// commit (-c applies to that one call only; configured repositories are
// unaffected).
//
// Identity policy, nested-repository half (plans/0073 §2.3, the pair of the
// comment block at commitIdentityProblem above): this fallback covers only
// the **nested repositories the person brought in** — repositories whose
// discovery repoRoots finds under the target tree, whose identity the person
// never promised and whose unattributable commits the parent's Auto-Nested
// lines still record. The **target root** is the other policy: init demands
// an explicit identity there (a resolving global/`GIT_*` identity, or
// --name/--email written as local config by writeLocalIdentity above, or
// refusal) — the root's history is the audit trail of AI changes and keeps a
// real name; opencode-auto@local is deliberately never auto-written at init.
export async function identityArgs(root: string): Promise<string[]> {
  const email = await git(root, ["config", "user.email"])
  if (email.code === 0 && email.out.trim()) return []
  return ["-c", "user.name=opencode-auto", "-c", "user.email=opencode-auto@local"]
}

export async function git(root: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  // GIT_OPTIONAL_LOCKS=0 (plans/0099 D4): read-shaped commands (`git status`,
  // `git diff`) opportunistically take the index lock to refresh the stat
  // cache; under doc lanes those reads run beside the decorator's serialized
  // commits, and a status's brief lock makes a concurrent queued `git commit`
  // fail with "index.lock: File exists". Optional locks are exactly that —
  // optional: this env drops only the opportunistic refresh write, never the
  // locks commands require (add/commit/stash take theirs regardless).
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } })
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

export function firstLine(text: string): string {
  return text.trim().split("\n")[0]!.slice(0, 200)
}

// The paths changed between each repository's recorded sha and HEAD
// (committed-only, `git diff --name-only <sha>..HEAD`) — the test-lane
// carry-forward's range (plans/0096 D5): the recorded-HEADs diff is what
// makes cross-task carry sound, a receipt from an earlier task carrying over
// exactly when nothing its surfaces touch changed since its tree. heads are
// the receipt's recorded tree HEADs (target-relative root names, "." = the
// target directory itself); paths come back target-directory-relative like
// every other listing here. undefined = the range is unreadable somewhere
// (an unknown sha, a vanished root, an empty heads list): the caller must
// treat that as "everything changed" and re-run — carry is the optimization,
// never a guess.
export async function rangeChangedFiles(dir: string, heads: readonly { root: string; sha: string }[]): Promise<string[] | undefined> {
  if (!heads.length) return undefined
  const phys = await physicalDir(dir)
  const files = new Set<string>()
  for (const { root, sha } of heads) {
    const abs = resolve(dir, root)
    const top = await git(abs, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) return undefined
    const diff = await git(abs, ["diff", "--name-only", "-z", "--ignore-submodules=all", `${sha}..HEAD`, "--", "."]).catch(() => undefined)
    if (!diff || diff.code !== 0) return undefined
    for (const path of diff.out.split("\0").filter(Boolean)) files.add(relative(phys, join(toplevel, path)))
  }
  return [...files]
}

// The changed paths of one task's own commits (plans/0096 D7, the release
// note's re-merge surface): every commit whose message carries the task's
// `Auto-Task: <id>` trailer line — the same unit marker the close-out check
// and the suite's range grammar read — contributes its diff (a merge against
// its first parent, so a landed lane's merge names the branch's files; the
// runtime's landing merges carry the trailer like every driver commit).
// Paths come back target-directory-relative; an unreadable repository
// contributes nothing (the surface is advisory steer, never a gate).
export async function taskChangedPaths(dir: string, taskId: string): Promise<string[]> {
  const phys = await physicalDir(dir)
  const files = new Set<string>()
  const trailer = `Auto-Task: ${taskId}`
  for (const root of await repoRoots(dir)) {
    const log = await git(root, ["log", "-z", "--format=%H%x1f%B%x1e"]).catch(() => undefined)
    if (!log || log.code !== 0) continue
    // -z separates commits with NUL (not whitespace — trim keeps it), so
    // every entry after the first carries a leading \0 that would break the
    // sha's diff-tree call below; strip them before splitting the record.
    const shas = log.out
      .split("\x1e")
      .map((entry) => entry.replaceAll("\0", ""))
      .map((entry) => entry.split("\x1f"))
      .filter(([sha, body]) => Boolean(sha?.trim()) && (body ?? "").split("\n").some((line) => line.trim() === trailer))
      .map(([sha]) => sha!.trim())
    for (const sha of shas) {
      const tree = await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", "-m", "--first-parent", "--ignore-submodules=all", sha]).catch(() => undefined)
      if (!tree || tree.code !== 0) continue
      const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
      const toplevel = top?.code === 0 ? top.out.trim() : ""
      if (!toplevel) continue
      for (const path of tree.out.split("\0").filter(Boolean)) files.add(relative(phys, join(toplevel, path)))
    }
  }
  return [...files].sort()
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

// A file's content in the last commit (HEAD), relative to dir: "" when HEAD
// does not hold it; undefined when there is no commit to read (not a git
// work tree, or no commit yet) — the caller then has nothing to compare with.
export async function headText(dir: string, rel: string): Promise<string | undefined> {
  const head = await git(dir, ["rev-parse", "--verify", "-q", "HEAD"]).catch(() => undefined)
  if (head?.code !== 0) return undefined
  const shown = await git(dir, ["show", `HEAD:./${rel}`]).catch(() => undefined)
  return shown?.code === 0 ? shown.out : ""
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
