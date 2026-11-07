import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import type { AddedLine } from "./document/types"
import { taskDir } from "./docpaths"
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
// knowledge/final-plan/doc-migrate/housekeeping/carryover etc.);
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

// The concise form of a unit's title for commit subjects (plans/0148 D2):
// the task id identifies the unit, so the subject carries only the title's
// leading words — the first clause (cut at the first `:` / `(` / em-dash,
// where long titles park their parenthetical detail) capped at four words.
// The full title stays in tasks.md / todo.md and the run banners, where it
// lives anyway; a mechanical rule, never a judgment of the title's content.
export function shortTitle(title: string): string {
  let head = title
  for (const sep of [":", "(", "（", "—", "–"]) head = head.split(sep)[0]!
  const words = (head.trim() || title).split(/\s+/).filter(Boolean)
  return words.slice(0, 4).join(" ")
}

// The next per-session ordinal of a fix round (plans/0148 D1): the ordinals
// derive from the history itself — a resumed round instance continues the
// numbering instead of restarting it (a kill after a handover-boundary
// commit leaves `T-NNN fix <round>.<n>` in the log; the re-opened round's
// first dispatch is <n>+1, never a second <n>). Scans every repository root
// (a round's commits may land in any of them) for the highest
// `<id> fix <round>.<n>` subject; 1 when none exists (the fresh round, and
// the no-git floor — a failed read keeps the floor ordinal but logs its ⚠,
// plans/0174 D5).
export async function nextFixSession(dir: string, taskId: string, round: number): Promise<number> {
  const prefix = `${taskId} fix ${round}.`
  let max = 0
  for (const root of await repoRoots(dir)) {
    const listed = await git(root, ["log", "--format=%s"]).catch(() => undefined)
    if (listed === undefined || listed.code !== 0) {
      // The failed read is surfaced, never answered silently (plans/0174 D5,
      // 0165-204): the ordinal floor stays 1 — nothing gates on it, the
      // numbering is 0148 D1's session naming — but a history this process
      // could not read may hold sessions the floor would duplicate.
      log(`  ⚠ fix-session numbering could not read the history (${relative(dir, root) || "."}): ${listed === undefined ? "git unavailable" : firstLine(listed.err || listed.out) || `git log exit code ${listed.code}`} — the ordinal may duplicate an unread session`)
      continue
    }
    for (const subject of listed.out.split("\n")) {
      if (!subject.startsWith(prefix)) continue
      const n = Number.parseInt(subject.slice(prefix.length), 10)
      if (Number.isFinite(n) && n > max) max = n
    }
  }
  return max + 1
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
// skips the repository instead of failing the commit. allowEmpty (plans/
// 0132 D2): the wall close's record commit — when the tracked diff is empty
// (the door was already removed by hand, the targets recovered from the
// live allows) the commit still lands, carrying the recorded targets in its
// message; only the root repository honors it.
export async function commitTree(
  dir: string,
  task: { id: string; title: string },
  info: { stage: string; subject: string; body?: string; allowEmpty?: boolean },
  paths?: readonly string[],
): Promise<CommitResult> {
  // A work tree git refuses to open never idles the commit boundary
  // (plans/0174 D1, 0165-036): an empty root set over a refused read would
  // answer ok with nothing committed — P4's completion condition silently
  // absent for every unit. The block line carries git's own first line.
  const refused = (await workTree(dir)).problem
  if (refused) {
    const error = `git refuses the work tree (${refused}); cannot judge what to commit`
    log(`  ⚠ git commit failed (.): ${error}`)
    return { ok: false, failures: [{ rel: ".", error }] }
  }
  const roots = await repoRoots(dir)
  const subject = commitTitle(info.subject)
  const failures: { rel: string; error: string }[] = []
  for (const root of roots) {
    const rel = relative(dir, root) || "."
    const spec = root === dir ? paths : undefined
    // The pathspec the commit re-states below (plans/0174 D2): starts as the
    // add's, and narrows with the did-not-match tolerance's survivors.
    let live = spec ?? ["."]
    try {
      const changes = await hasChanges(root, spec)
      if (changes === undefined) {
        // The skip decision cannot be made over an unreadable status
        // (plans/0155 D1), and a blind add+commit would sweep a tree whose
        // dirt nobody judged — the failure line blocks; P4's halt owns the
        // stop.
        const error = "git status unreadable (repo missing or index corrupt); cannot judge what to commit"
        log(`  ⚠ git commit failed (${rel}): ${error}`)
        failures.push({ rel, error })
        continue
      }
      if (!changes && !(root === dir && info.allowEmpty === true)) continue
      let added = { code: 0, out: "", err: "" }
      if (changes) {
        added = await git(root, ["add", "-A", "--", ...live])
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
          if (drop.length) live = drop
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
      const committed = await git(root, [
        ...(await identityArgs(root)),
        "commit",
        // The wall's record commit on an empty diff (plans/0132 D2): the
        // message is the record; git would refuse without the flag.
        ...(!changes && info.allowEmpty ? ["--allow-empty"] : []),
        "-m",
        message(subject, task, info.stage, nested, info.body),
        // The subtree confinement's commit half (plans/0174 D2, 0165-138):
        // a bare `git commit` takes the whole index, and the person's staged
        // work elsewhere in an enclosing repository would ride the driver's
        // trailer — the commit takes the same pathspec the add staged with
        // (`git commit -- <paths>` commits exactly those paths, the person's
        // staging outside them left untouched). At the floor (`.` over the
        // whole repository) the committed tree is byte-identical.
        "--",
        ...live,
      ])
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
// happened in between — that is caught by unitViolations). A repository with
// no readable HEAD sha (an empty one, an unreadable one) is simply absent
// from this commit's alignment record (plans/0174 D5, 0165-204): the
// `Auto-Nested: <rel> @ ` line an unchecked read emitted was malformed and
// no alignment reader ever parsed it — absent is the record's own floor
// ("the state it was at", unborn included).
async function nestedHeads(dir: string, roots: string[]): Promise<{ rel: string; sha: string }[]> {
  const heads: { rel: string; sha: string }[] = []
  for (const root of roots) {
    if (root === dir) continue
    const got = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
    const sha = got?.code === 0 ? got.out.trim() : ""
    if (sha) heads.push({ rel: relative(dir, root) || ".", sha })
  }
  return heads
}

// Whether the worktree already has uncommitted changes (run's start-up notice
// to the user: they will be swept into the driver's next commit).
export async function pendingChanges(dir: string): Promise<boolean> {
  for (const root of await repoRoots(dir)) {
    const read = await hasChanges(root)
    // Unreadable counts as pending (plans/0155 D1): a caller that skips on
    // pending changes must not proceed over a tree it could not read (P12).
    if (read === undefined || read) return true
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
    const read = await hasChanges(root)
    if (read === undefined) {
      // The stash refuses over an unreadable status (plans/0155 D1): whether
      // this root holds anything to stash cannot be judged, and the caller
      // must refuse before writing anything.
      const error = "git status unreadable (repo missing or index corrupt); cannot judge what to stash"
      log(`  ⚠ git stash refused (${relative(dir, root) || "."}): ${error}`)
      failures.push({ rel: relative(dir, root) || ".", error })
      continue
    }
    if (!read) continue
    // The subtree pathspec (plans/0174 D2, amending 0053 D20 — rollbackUnit's
    // own shape): the target directory may sit inside a larger repository,
    // and the close's stash owns the target's tree alone — the person's
    // unrelated WIP outside the subtree stays in their worktree.
    const pushed = await git(root, ["stash", "push", "--include-untracked", "-m", message, "--", "."])
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
// walks them. The post-run read diffs the snapshot against the worktree
// directly (`git diff <stash-sha>`, both directions — a mutation AND a
// revert of the session's WIP to HEAD, plans/0175 D2), restores tracked
// deltas from the snapshot (`git checkout <stash-sha> -- <paths>`, pre-run
// content, session WIP included) and hard-blocks on a moved HEAD. Named
// residuals (D11): a mutation that lands byte-identical to the snapshot is
// undetectable and harmless; untracked files are not git-managed content and
// stay.

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

// The violation the post-run read found: tracked = the script moved tracked
// content away from the pre-run snapshot — a mutation OR a revert (already
// restored from the snapshot — restored lists the paths, target-directory-
// relative; unrestorable lists paths the restore could not put back, with
// git's error; snapshots carries each repository's pre-run stash sha, the
// recovery handle — `git stash create` leaves no ref, plans/0175 D2); head =
// the script moved a repository's HEAD (a commit/rebase/reset ran) — no
// auto-undo, the caller hard-blocks for the human, the corrupted-baseline
// family.
export type ScriptGuardViolation =
  | { kind: "tracked"; restored: string[]; unrestorable: { path: string; error: string }[]; snapshots: { root: string; sha: string }[] }
  | { kind: "head"; moved: { root: string; from: string; to: string }[] }

// The post-run read over every snapshotted repository. Returns undefined
// when the script left git-managed content alone.
export async function scriptGuardCheck(dir: string, shots: readonly ScriptGuardShot[]): Promise<ScriptGuardViolation | undefined> {
  if (!shots.length) return undefined
  const moved: { root: string; from: string; to: string }[] = []
  const changed: { root: string; source: string; paths: string[] }[] = []
  // A read the verdict rides on that itself failed (plans/0174 D3,
  // 0165-204): "untouched" over a failed toplevel/diff read is the
  // quiet-clean direction P12 forbids — the failure rides the violation
  // channel the callers already print.
  const unreadable: { root: string; error: string }[] = []
  for (const shot of shots) {
    const rel = relative(dir, shot.root) || "."
    const head = (await git(shot.root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined))?.out.trim() ?? ""
    if (head !== shot.head) moved.push({ root: rel, from: shot.head, to: head })
    // The empty-repository floor (plans/0175 D2): a repository with no
    // commits at the snapshot and none now (both HEAD reads empty) has no
    // snapshot source to diff against and nothing tracked to differ — the
    // unborn shape the baselines and audits keep. A repository whose HEAD
    // was readable at the snapshot and no longer is still reaches the diff
    // and fails into unreadable (P12).
    if (!shot.stash && !head && !shot.head) continue
    // The repository's toplevel: the diff below reports toplevel-relative
    // paths, and the restore's checkout must read the same origin — shot.root
    // may be a subdirectory of the toplevel (the target inside a larger
    // repository, plans/0174 D3).
    const top = await git(shot.root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) {
      unreadable.push({ root: rel, error: top ? firstLine(top.err || top.out) || `git rev-parse exit code ${top.code}` : "git unavailable" })
      continue
    }
    // The snapshot to compare against and restore from: the stash commit, or
    // HEAD when the worktree was clean before the run. The comparison is the
    // snapshot's tree against the WORKTREE, directly and over the whole
    // repository (plans/0175 D2, 0165-021): the pre-run `git stash create`
    // covered the whole repository (it takes no pathspec), the whole-repo
    // diff is the faithful comparison, and it catches BOTH directions — a
    // mutation the script wrote AND a revert it performed (`git checkout -- .`
    // , `git stash`: the path reads clean under status, so the old
    // status-then-diff enumeration never compared it and the session's WIP
    // was lost with the guard reading clean). A session-WIP path the script
    // never touched compares equal against the snapshot and drops out (the
    // byte-identical residual); untracked files are in neither tree and stay
    // (D11's residual).
    const source = shot.stash || "HEAD"
    const diff = await git(toplevel, ["diff", "--name-only", "-z", "--no-renames", "--ignore-submodules=all", source]).catch(() => undefined)
    if (!diff || diff.code !== 0) {
      unreadable.push({ root: rel, error: !diff ? "git unavailable" : firstLine(diff.err || diff.out) || `git diff exit code ${diff.code}` })
      continue
    }
    const differs = diff.out
      .split("\0")
      .filter(Boolean)
    if (differs.length) changed.push({ root: toplevel, source, paths: differs })
  }
  if (moved.length) return { kind: "head", moved }
  if (!changed.length && !unreadable.length) return undefined
  const restored: string[] = []
  const unrestorable: { path: string; error: string }[] = unreadable.map((read) => ({ path: read.root, error: `the guard cannot judge this repository (${read.error}); investigate the repository state` }))
  for (const repo of changed) {
    const checkout = await git(repo.root, ["checkout", repo.source, "--", ...repo.paths])
    if (checkout.code === 0) {
      restored.push(...repo.paths.map((path) => relative(dir, join(repo.root, path)) || path))
    } else {
      unrestorable.push(...repo.paths.map((path) => ({ path: relative(dir, join(repo.root, path)) || path, error: firstLine(checkout.err || checkout.out) || `git checkout exit code ${checkout.code}` })))
    }
  }
  if (!restored.length && !unrestorable.length) return undefined
  // The recovery handle (plans/0175 D2): the pre-run stash shas — an empty
  // stash (a clean pre-run tree) left no object to name.
  const snapshots = shots.filter((shot) => shot.stash).map((shot) => ({ root: relative(dir, shot.root) || ".", sha: shot.stash }))
  return { kind: "tracked", restored, unrestorable, snapshots }
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

// The driver's own write shapes over dirty driver-state paths (plans/0183 D1,
// 0165-112): the patterns above say where the driver writes, not what — a
// person's (or a stray session's) content edit of a todo.md, a tasks.md or a
// phases.md is person dirt on exactly those paths, and the carryover's old
// path-only trust swept it into a catch-up commit under an unrelated task's
// trailer. The carryover admits only three shapes: a deletion of the retired
// CURRENT.md (preflight's own removal); an index file whose only change is
// the driver's `[ ]`→`[x]` tick (tickIndexLine's write, parseIndex's shape —
// a hand tick is the same harmless redundant view, 0170 D4(b)); and a
// todo.md→done.md rename pair with byte-identical content for a unit whose
// runtime entry is gone (markDone's third step drops it — 0170 D4(a)'s
// runtime-record distinction: a done.md new while .auto/units.json still
// carries the unit is a session's self-rename, never the driver's close).
// Returns the dirty paths that are NOT one of those shapes (empty = all
// leftovers are the driver's own). The other driverStateFile consumers are
// attribution-by-construction or visibly-folding surfaces, ruled in 0183 D1:
// the doc-lane decorator and the lane landing filter the live driver's own
// writes (markDone moments before), and close/clarify fold state-path dirt
// into commits that name every folded path in their bodies.
export async function personDirtOverStatePaths(dir: string, dirty: readonly string[]): Promise<string[]> {
  if (!dirty.length) return []
  const phys = await physicalDir(dir)
  // One status pass over every root: each dirty path's XY code and the
  // repository (root + repo-relative spelling) its diff and blob reads need.
  const found = new Map<string, { status: string; root: string; repoRel: string }>()
  for (const root of await repoRoots(dir)) {
    const top = await git(root, ["rev-parse", "--show-toplevel"])
    if (top.code !== 0) continue
    const toplevel = top.out.trim()
    for (const entry of await statusEntries(dir, root)) {
      found.set(entry.rel, { status: entry.status, root, repoRel: relative(toplevel, resolve(phys, entry.rel)) })
    }
  }
  const off: string[] = []
  const push = (rel: string) => {
    if (!off.includes(rel)) off.push(rel)
  }
  const pendingState = /^docs\/(?:T-\d+|R-\d+\/P\d{2,}-[a-z][a-z0-9-]*)\/(?:todo|done)\.md$/
  for (const rel of dirty) {
    const path = rel.replaceAll("\\", "/")
    const entry = found.get(rel)
    if (entry === undefined) {
      // Not in any status (an inconsistent read) — conservative, P12.
      push(rel)
      continue
    }
    if (path === "CURRENT.md") {
      if (!entry.status.includes("D")) push(rel)
      continue
    }
    if (pendingState.test(path)) {
      // The rename pairs resolve as pairs, below.
      continue
    }
    if (!(await tickOnlyDiff(entry.root, entry.repoRel))) push(rel)
  }
  // The rename pairs: todo.md deleted + its done.md sibling new, contents
  // byte-identical to HEAD's todo.md, the owning unit's runtime entry gone.
  // Both paths of a failed pair are person dirt; a done.md without its dirty
  // todo sibling is never the driver's leftover (the driver's done.md only
  // arrives by rename).
  for (const rel of dirty) {
    const path = rel.replaceAll("\\", "/")
    if (!/\/todo\.md$/.test(path) || !pendingState.test(path)) continue
    const done = path.replace(/\/todo\.md$/, "/done.md")
    const todo = found.get(rel)
    const next = found.get(done)
    const unit = unitOfStatePath(path)
    const admitted =
      todo?.status.includes("D") === true &&
      next?.status === "??" &&
      dirty.includes(done) &&
      unit !== undefined &&
      (await runtimeEntryGone(dir, unit)) &&
      (await headBlobEquals(todo.root, todo.repoRel, resolve(dir, done)))
    if (!admitted) {
      push(rel)
      // The sibling joins the verdict only when it is itself dirty.
      if (dirty.includes(done)) push(done)
    }
  }
  for (const rel of dirty) {
    const path = rel.replaceAll("\\", "/")
    if (/\/done\.md$/.test(path) && pendingState.test(path) && !dirty.includes(path.replace(/\/done\.md$/, "/todo.md"))) push(rel)
  }
  return off
}

// An index file's diff is only the driver's tick: every changed line pair is
// `- [ ] <id> …` → `- [x] <id> …` (tickIndexLine's exact write). Anything
// else — a retitle, a reordered or added line, a mode-only change, an
// unreadable diff, a staged-only tick the driver never stages — reads as not
// the driver's shape.
async function tickOnlyDiff(root: string, repoRel: string): Promise<boolean> {
  const diff = await git(root, ["diff", "-U0", "--no-renames", "--no-color", "--no-ext-diff", "--ignore-submodules=all", "--", repoRel])
  if (diff.code !== 0) return false
  const removed: string[] = []
  const added: string[] = []
  for (const line of diff.out.split("\n")) {
    if (line.startsWith("diff --git") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("@@ ")) continue
    if (line.startsWith("-")) removed.push(line.slice(1))
    else if (line.startsWith("+")) added.push(line.slice(1))
    // Under -U0 no context lines appear; "\ No newline at end of file"
    // markers start with a backslash and fall through.
  }
  if (!removed.length || removed.length !== added.length) return false
  return removed.every((line, i) => /^[-*] \[ \]\s+\S/.test(line) && line.replace("[ ]", "[x]") === added[i])
}

// The unit id owning a unit state path (T-NNN tasks and P<nn> phase units —
// the two id shapes unitStatePaths spells), or undefined for a path that
// matches neither.
function unitOfStatePath(rel: string): string | undefined {
  const task = /^docs\/(T-\d+)\/todo\.md$/.exec(rel)
  if (task) return task[1]
  const phase = /^docs\/R-\d+\/(P\d{2,})-[a-z][a-z0-9-]*\/todo\.md$/.exec(rel)
  return phase?.[1]
}

// Whether the runtime record still carries the unit (the near-leaf read of
// .auto/units.json — tasks.ts owns the file and imports this module, so the
// spelling lives here like WORKDIR_ROOTS's, pinned by test). An absent or
// hand-corrupted file reads as no entry, the same degradation tasks.ts's
// readUnits gives every runtime field (the heal must not brick on
// recoverable state).
async function runtimeEntryGone(dir: string, unit: string): Promise<boolean> {
  const raw = await Bun.file(join(dir, ".auto", "units.json")).text().catch(() => undefined)
  if (raw === undefined) return true
  try {
    const parsed = JSON.parse(raw) as { tasks?: Record<string, unknown> }
    return parsed?.tasks === null || typeof parsed.tasks !== "object" || !(unit in parsed.tasks)
  } catch {
    return true
  }
}

// Whether a worktree file's text equals HEAD's blob of another (repo-relative)
// path — the rename pair's identical-content half.
async function headBlobEquals(root: string, repoRel: string, file: string): Promise<boolean> {
  const blob = await git(root, ["show", `HEAD:${repoRel}`])
  if (blob.code !== 0) return false
  const text = await Bun.file(file).text().catch(() => undefined)
  return text !== undefined && text === blob.out
}

// The driver workdir's roots, spelled without the trailing slash for the
// containment test below: gitignore.ts ENTRIES is the law (the ignore set is
// tracked law since plans/0138 — git does not see these directories' files
// once the set is on disk), and this module cannot import it back (gitignore
// already imports repoRoots from here) — the same near-leaf spelling as
// MODELS_ENTRY, pinned against ENTRIES by test/gitignore.test.ts.
export const WORKDIR_ROOTS = ["tmp", ".auto"]

// Whether a target-directory-relative path lies in the driver workdir
// (root-anchored, like the ignore entries themselves; a nested repository's
// own stray .auto/ is not the driver's workdir and does not match).
export function workdirEntry(rel: string): boolean {
  const path = rel.replaceAll("\\", "/")
  return WORKDIR_ROOTS.some((root) => path === root || path.startsWith(`${root}/`))
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

// The committed content of one directory-relative path at a unit-start
// baseline (plans/0205 D2): the formulation collect's fixed-prefix snapshot —
// the rows and documents as last committed when the unit began, the state the
// session was dispatched over (P4: the session writes nothing to git; the
// unified commit lands after the collect). `{ ok: false }` = the read failed
// (no baseline entry for the path's repository, an empty sha, or git itself
// refused) — the caller degrades to the unchecked floor, never blocks on a
// failed read (the addedLines precedent, plans/0199 D1); `{ ok: true }` with
// text undefined = the path is absent at the baseline.
export type BaseContent = { ok: true; text: string | undefined } | { ok: false }

export async function contentAtBase(dir: string, baseline: UnitBaseline, rel: string): Promise<BaseContent> {
  const abs = join(dir, rel)
  const entry = baseline.find(({ root }) => root === dir || abs === root || abs.startsWith(root + sep))
  if (!entry || !entry.sha) return { ok: false }
  const shown = await git(entry.root, ["show", `${entry.sha}:${relative(entry.root, abs).replaceAll("\\", "/")}`])
  if (shown.code === 0) return { ok: true, text: shown.out }
  if (/does not exist/i.test(shown.err)) return { ok: true, text: undefined }
  return { ok: false }
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
    const got = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
    const head = got?.code === 0 ? got.out.trim() : ""
    if (!head) {
      // HEAD unreadable: an empty baseline too (no commits when the unit
      // started, still none now) is the empty-repository floor; anything
      // else is an anomaly the close-out cannot certify over (plans/0155
      // D1, baselineIntact's own shape — a failed read is never a silent
      // pass, P12).
      if (!sha) continue
      problems.push(`${relative(dir, root) || "."}: HEAD unreadable (repo missing or history corrupt), close-out check failed`)
      continue
    }
    if (head === sha) continue
    // The ancestry check (plans/0173 D3, 0165-141): a baseline HEAD no
    // longer contains means the history below the unit was rewound or
    // rewritten — the range means nothing and the close-out must block on
    // it, never count the empty range as clean. An empty baseline (the
    // repository had no commits when the unit started) has nothing to
    // contain — the foreign count below reads the full history.
    if (sha) {
      const ancestry = await baselineAncestry(root, sha)
      if (ancestry !== true) {
        problems.push(
          ancestry === false
            ? `${relative(dir, root) || "."}: history rewritten below the unit baseline (HEAD ${head} does not contain ${sha})`
            : `${relative(dir, root) || "."}: the baseline ${sha} cannot be resolved against HEAD, close-out check failed`,
        )
        continue
      }
    }
    const foreign = await foreignCommits(root, sha)
    if (foreign === undefined) {
      problems.push(`${relative(dir, root) || "."}: the baseline..HEAD range cannot be judged (git log failed), close-out check failed`)
      continue
    }
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

// The unit's changed-file set (the data source of the full-document
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
// unreadable (plans/0176 D2, 0165-034): at least one repository's toplevel
// or diff read failed — the set is the same partial answer as before (the
// failing repository contributes nothing), and a caller whose verdict rides
// on completeness (the release posture) blocks on the flag; the round-time
// callers keep the floor their own plans rule.
export async function unitChangedFiles(dir: string, baseline: UnitBaseline, scope?: readonly string[]): Promise<{ files: Set<string>; unreadable: boolean }> {
  const phys = await physicalDir(dir)
  const files = new Set<string>()
  let unreadable = false
  for (const { root, sha } of baseline) {
    const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) {
      unreadable = true
      continue
    }
    // An empty-string baseline = the repository had no commits when the unit
    // started; compare against the empty tree (everything this unit posts
    // falls inside the range).
    // --ignore-submodules=all: a nested repository is a single gitlink in the
    // outer one; its inner files are listed separately by that repository's
    // own diff (the same reasoning as statusEntries).
    const diff = await git(root, ["diff", "--name-only", "-z", "--diff-filter=d", "--ignore-submodules=all", sha || EMPTY_TREE, "--", ...(scope ?? ["."])])
    if (diff.code !== 0) {
      unreadable = true
      continue
    }
    for (const path of diff.out.split("\0").filter(Boolean)) files.add(relative(phys, join(toplevel, path)))
  }
  for (const rel of await untrackedFiles(dir)) {
    if (scope !== undefined && !withinScopes(rel, scope)) continue
    files.add(rel)
  }
  return { files, unreadable }
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
// unreadable (plans/0176 D2, 0165-034): at least one repository's toplevel
// or diff read failed — the map is the same partial answer as before, and
// the release posture blocks on the flag (the round scans keep their floor).
export async function unitAddedLines(dir: string, baseline: UnitBaseline, scope?: readonly string[]): Promise<{ lines: Map<string, AddedLine[]>; unreadable: boolean }> {
  const phys = await physicalDir(dir)
  const added = new Map<string, AddedLine[]>()
  let unreadable = false
  const push = (rel: string, line: number, text: string) => {
    const list = added.get(rel) ?? []
    list.push({ line, text })
    added.set(rel, list)
  }
  for (const { root, sha } of baseline) {
    const top = await git(root, ["rev-parse", "--show-toplevel"]).catch(() => undefined)
    const toplevel = top?.code === 0 ? top.out.trim() : ""
    if (!toplevel) {
      unreadable = true
      continue
    }
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
    if (diff.code !== 0) {
      unreadable = true
      continue
    }
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
  return { lines: added, unreadable }
}

// git's empty-tree hash (a fixed constant): a commit-less repository's
// "diff against the baseline" uses it as the empty baseline end.
const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// The trailer block of a commit message (plans/0173 D2, 0165-140): the last
// paragraph of the body, witnessed only when every line of it is
// trailer-shaped (`Key: value`) — the one grammar of message()'s writer,
// which always ends the body with a trailer paragraph. A prose paragraph
// mentioning a trailer, a subject quoting it, or a body quoting another
// commit's message above the last paragraph never yields a block (undefined,
// the paragraph is not all trailers). The deliberate imitation door (any
// writer can author a block) is the commit-provenance guard's family
// (plans/0169 D4), not this reader's.
export function trailerBlock(body: string): Map<string, string> | undefined {
  const paragraphs = body.trimEnd().split(/\n[ \t]*\n/)
  const last = paragraphs.at(-1)
  if (last === undefined) return undefined
  const block = new Map<string, string>()
  for (const line of last.split("\n")) {
    const mark = /^([A-Za-z0-9-]+):[ \t]+(\S.*)$/.exec(line.trim())
    if (!mark) return undefined
    if (!block.has(mark[1]!)) block.set(mark[1]!, mark[2]!.trim())
  }
  return block.size ? block : undefined
}

// The driver-commit witness every audit reader shares (plans/0173 D2): the
// Auto-Stage value from the trailer block alone — a commit whose body's last
// paragraph is a trailer block carrying Auto-Stage. git's own
// %(trailers:key=Auto-Stage,valueonly) reads the same block; driverBaseline's
// walk matches the same line with git's anchored --grep.
export function driverStage(body: string): string | undefined {
  return trailerBlock(body)?.get("Auto-Stage")
}

// One non-driver commit inside a judged range, named (plans/0184 D2,
// 0165-024): the short sha, the author, the committer's ISO date — the
// adoption line's facts, and the while-the-driver-ran comparison's input
// (a committer time before the record's last write was made while the driver
// ran, not by the person after the kill).
export type ForeignCommit = { sha: string; author: string; date: string }

// The non-driver commits inside the `sha..<to>` range (= the external
// commits; to defaults to HEAD, the unit close-out and recovery callers'
// shape), each named. An empty-string sha means the repository had no commits
// when the range started — check the full history. undefined = the log itself
// failed (an unresolvable baseline, a corrupt repository — plans/0173 D3,
// 0165-141): the range cannot be judged, and the callers surface it as a
// problem line, never as zero (P12).
export async function foreignCommitRecords(root: string, sha: string, to: string = "HEAD"): Promise<ForeignCommit[] | undefined> {
  const log = await git(root, ["log", "-z", "--format=%h%x1f%an%x1f%cI%x1f%B%x1e", ...(sha ? [`${sha}..${to}`] : [to])])
  if (log.code !== 0) return undefined
  return log.out
    .split("\x1e")
    .map((entry) => entry.replaceAll("\0", ""))
    .map((entry) => entry.split("\x1f"))
    .filter(([id, author, date, body]) => Boolean(id?.trim()) && Boolean(body?.trim()) && driverStage(body) === undefined)
    .map(([id, author, date]) => ({ sha: id!.trim(), author: (author ?? "").trim(), date: (date ?? "").trim() }))
}

// The count front over the same walk (the unit close-out's and rollback's
// criterion — one walk, one driver-witness test, the count the named list's
// length). Shared by unitViolations, the recovery-fidelity rollback, and
// `land`'s foreign-commit refusal over the round branch (plans/0074 §2.3).
export async function foreignCommits(root: string, sha: string, to: string = "HEAD"): Promise<number | undefined> {
  return (await foreignCommitRecords(root, sha, to))?.length
}

// Whether a unit baseline sha is still an ancestor of HEAD (plans/0173 D3,// 0165-141): false means HEAD was rewound to or below the baseline (an
// agent's `git reset --hard HEAD~N` mid-unit) or rewritten past it — the
// `sha..HEAD` range means nothing and the audit must block on it. undefined
// = the check itself failed (unreadable repository); both callers treat
// non-ok as the rewritten verdict (conservative under uncertainty, P12).
export async function baselineAncestry(root: string, sha: string): Promise<boolean | undefined> {
  const check = await git(root, ["merge-base", "--is-ancestor", sha, "HEAD"])
  if (check.code === 0) return true
  return /not a valid commit|unknown revision|bad object/i.test(check.err) ? undefined : false
}

// The boundary of the driver run in a repository's history (plans/0173 D1,
// 0165-004 — the S1): the OLDEST commit reachable first-parent from HEAD
// that carries the driver witness or a landing subject, answered with its
// first parent — everything inside the HEAD..baseline range is the
// migration's writing, whoever committed it (the person's release-remedy
// fix commits, an adopted or agent-made commit: deliverable content is P1's
// subject whoever wrote it); everything below it is the pre-driver upstream,
// never the migration's ledger (0119's maintainer ruling kept — and kept
// cheap: git filters server-side through the anchored `--grep` forms, so a
// pristine upstream the migration only read matches nothing and never
// streams a full history into this process). The witnesses: a line starting
// `Auto-Stage:` (driverStage's own line — the anchored grep matches per
// line, so prose mentions and mid-line quotes never hit) or a line starting
// `land auto/` (the landing subject, git-land's grammar: the squashed round
// IS the migration's content). kind "none" = no boundary reachable — the
// repository's committed history holds nothing of the run (a pristine
// upstream; a history the person rebuilt); the baseline is HEAD itself, and
// the release caller refuses on it under config isolate, where the writing
// sits on the unlanded round branch (0074's landing commits stay
// trailer-less — the person's to curate — and are recognized by subject).
export type DriverBoundary = { baseline: string; kind: "driver" | "landing" | "none" }

export async function driverBoundary(root: string): Promise<DriverBoundary> {
  const head = await git(root, ["rev-parse", "HEAD"])
  if (head.code !== 0 || !head.out.trim()) return { baseline: "", kind: "none" }
  const log = await git(root, [
    "log",
    "--first-parent",
    "--grep=^Auto-Stage:",
    "--grep=^land auto/",
    "--format=%H %P %s",
    "HEAD",
  ])
  if (log.code !== 0) return { baseline: head.out.trim(), kind: "none" }
  let oldest: { sha: string; parent: string; subject: string } | undefined
  for (const line of log.out.split("\n").filter((entry) => entry.trim())) {
    const [sha, parent, ...subject] = line.split(" ")
    // git log walks newest-first: the last record seen is the oldest
    // boundary — the walk's deepest edge, whatever newer boundaries it
    // passed.
    oldest = { sha: sha!, parent: parent ?? "", subject: subject.join(" ") }
  }
  if (oldest === undefined) return { baseline: head.out.trim(), kind: "none" }
  return { baseline: oldest.parent, kind: oldest.subject.startsWith("land auto/") ? "landing" : "driver" }
}

// The SHA a destination-wide scan diffs from (plans/0119's ruling, re-ruled
// by 0173 D1): the boundary's parent above — shared by the release scan and
// the round-close ledger (0119 D2: both gates, one set). The boundary commit
// itself is the migration's oldest writing, so it sits inside the scanned
// range; "" (the boundary at the root) scans the whole history.
export async function driverBaseline(root: string): Promise<string> {
  return (await driverBoundary(root)).baseline
}

// —— Recovery fidelity (plans/0022-session-recovery-fidelity-design.md) ——

// Baseline check on recovery (design 3.1 ③): every repository's HEAD ==
// baseline, or the whole baseline..HEAD range is driver commits (Auto-Stage
// trailer) — only driver commits happened in between, so the session
// context's view of the present still holds. Unlike unitViolations: **it does
// not check uncommitted changes** — a half-finished session's dirty area is
// precisely the thing being recovered. The problems are typed (plans/0183
// D3, 0165-114): `foreign` holds every readable drift line (the person's
// commits since the interruption — and a rewound history, a fact read off a
// readable repository all the same), which the recovery ladder adopts as the
// scene (plans/0145 D1); `unreadable` holds the lines whose cause is a read
// that failed (a missing or corrupt repository, an unresolvable or
// unjudgeable range) — 0145's adoption never covered them, and the ladder
// stops on them instead of running a unit toward a commit that cannot land
// (0155 D1's direction). Both lists empty = baseline intact.
export type BaselineProblems = { foreign: string[]; unreadable: string[] }

// ranUntil (plans/0184 D2, 0165-024): the progress record's last write, epoch
// ms — a foreign commit whose committer time precedes it was made while the
// driver ran (the record is rewritten at every dispatch and boundary, so a
// live person's mid-run commit can postdate it only by landing between the
// act and the next write — the window the flag honestly admits). Those
// commits carry the P4 flag in the line: adoption still proceeds (the
// committed state is the scene either way — 0145 D1), but the person reads
// which commits the driver never made and judges them with the revert
// remedy. Absent = the names without the flag (the non-ladder callers).
export async function baselineIntact(dir: string, baseline: UnitBaseline, ranUntil?: number): Promise<BaselineProblems> {
  const problems: BaselineProblems = { foreign: [], unreadable: [] }
  for (const { root, sha } of baseline) {
    const rel = relative(dir, root) || "."
    const got = await git(root, ["rev-parse", "--short", "HEAD"]).catch(() => undefined)
    const head = got?.code === 0 ? got.out.trim() : ""
    if (!head) {
      // HEAD unreadable: an empty baseline too (no commits when the unit
      // started, still none now) is normal; anything else is an anomaly.
      if (!sha) continue
      problems.unreadable.push(`${rel}: HEAD unreadable (repo missing or history corrupt), baseline check failed`)
      continue
    }
    if (head === sha) continue
    // The same ancestry gate as unitViolations (plans/0173 D3): a rewound
    // HEAD makes the range meaningless — the factual line says so, and the
    // recovery ladder interprets (plans/0145 D1). An empty baseline (the
    // unit started from no commits) has nothing to contain.
    if (sha) {
      const ancestry = await baselineAncestry(root, sha)
      if (ancestry !== true) {
        // A rewound history is a fact read off a readable repository —
        // today's adoption stance keeps it (0145 D1's "the person acted");
        // an unresolvable baseline is a failed read.
        if (ancestry === false) problems.foreign.push(`${rel}: history rewritten below the unit baseline (HEAD ${head} does not contain ${sha})`)
        else problems.unreadable.push(`${rel}: the baseline ${sha} cannot be resolved against HEAD, baseline check failed`)
        continue
      }
    }
    const foreign = await foreignCommitRecords(root, sha)
    if (foreign === undefined) {
      problems.unreadable.push(`${rel}: the baseline..HEAD range cannot be judged (git log failed), baseline check failed`)
      continue
    }
    if (foreign.length > 0) {
      // Factual line only; the interpretation (adoption, no reuse, no
      // rollback) is the recovery ladder's (plans/0145 D1). Each commit
      // named (plans/0184 D2, 0165-024): the person reads exactly what was
      // adopted — an agent's own commit is no longer laundered as "the
      // person's commits" (bounded at five, the count naming the rest).
      problems.foreign.push(`${rel}: ${foreign.length} non-driver commit(s) since the recorded baseline (no Auto-Stage trailer): ${namedForeignCommits(foreign, ranUntil)}`)
    }
  }
  return problems
}

// The named-commit list of an adoption line: `<short sha> <author>, <committer
// date>` per commit, the while-the-driver-ran ones flagged with the P4
// judgment and its remedy (plans/0184 D2).
function namedForeignCommits(commits: readonly ForeignCommit[], ranUntil: number | undefined): string {
  const named = commits.slice(0, 5).map((commit) => {
    const whileDriverRan = ranUntil !== undefined && commit.date !== "" && !Number.isNaN(Date.parse(commit.date)) && Date.parse(commit.date) < ranUntil
    return (
      `${commit.sha} ${commit.author}, ${commit.date}` +
      (whileDriverRan ? ` [made while the driver ran — P4: the commit right is the driver's; judge whether to keep it, git revert ${commit.sha} reclaims it]` : "")
    )
  })
  return commits.length > 5 ? `${named.join("; ")}; … +${commits.length - 5} more` : named.join("; ")
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
      // An unreadable HEAD with a recorded baseline (plans/0174 D5,
      // 0165-204): the range cannot be judged, and the old silent path
      // stashed the scene, skipped every check and reported ok — the
      // repository goes to the human like every other shape the rollback
      // cannot certify. An empty baseline (the repository had no commits
      // when the unit started) is the unborn floor, not this case.
      if (entry?.sha && !head) {
        result.failures.push({ rel, error: "HEAD unreadable (repo missing or history corrupt); this repo is not rolled back, please handle manually" })
        continue
      }
      // External commits mixed in: this repository is not rolled back
      // (rollback reclaims only the driver's own within-unit changes). The
      // same judgment holds for a range that cannot be judged at all and
      // for a rewound HEAD (plans/0173 D3) — the repository goes to the
      // human, never to a blind reset (the reset --soft below over a
      // rewound HEAD would move HEAD forward and stash the reversal).
      if (entry && head && head !== entry.sha) {
        if (entry.sha) {
          const ancestry = await baselineAncestry(root, entry.sha)
          if (ancestry === false) {
            result.failures.push({ rel, error: `history rewritten below the unit baseline (HEAD ${head} does not contain ${entry.sha}); this repo is not rolled back, please handle manually` })
            continue
          }
          if (ancestry === undefined) {
            result.failures.push({ rel, error: `the baseline ${entry.sha} cannot be resolved against HEAD; this repo is not rolled back, please handle manually` })
            continue
          }
        }
        const foreign = await foreignCommits(root, entry.sha)
        if (foreign === undefined) {
          result.failures.push({ rel, error: `the baseline..HEAD range cannot be judged (git log failed); this repo is not rolled back, please handle manually` })
          continue
        }
        if (foreign > 0) {
          result.failures.push({ rel, error: `${foreign} non-driver commit(s) detected (no Auto-Stage trailer); this repo is not rolled back, please handle manually` })
          continue
        }
      }
      // ① stash preserves the scene (the pathspec confines it to this
      // directory's subtree — the target directory may sit inside a larger
      // repository). An unreadable status refuses the whole repository
      // (plans/0155 D1): the scene cannot be judged, so it is left for the
      // human beside a failure line, never half-rolled-back blind.
      const scene = await hasChanges(root)
      if (scene === undefined) {
        result.failures.push({ rel, error: "git status unreadable (repo missing or index corrupt); this repo is not rolled back, please handle manually" })
        continue
      }
      if (scene) {
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
      const reclaim = await hasChanges(root)
      if (reclaim === undefined) {
        result.failures.push({ rel, error: "git status unreadable (repo missing or index corrupt); this repo is not rolled back, please handle manually" })
        continue
      }
      if (reclaim) {
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

// The doc-lane seam decorator's relaxation of the unit start gate (plans/
// 0099 D5, made a parameter of the free gate by plans/0175 D4, 0165-139 —
// the decorator's hand copy had already missed two amendments to the base
// gate): tolerate names scopes whose dirt is sibling lanes' in-flight
// writes, filtered out of the dirty set before the judgments; reads names
// the seam members the gate reads through (the wrapped base, so the
// decorator keeps the seam's switchability over the double and recording
// fakes); commit replaces the free gate's own carryover heal with the
// caller's (the decorator's serialized, scoped commit queue). Absent = the
// free gate, byte-identical.
export type BeginUnitRelaxation = {
  tolerate: readonly string[]
  reads: Pick<GitOps, "changedFiles" | "unitBaseline" | "personDirtOverStatePaths">
  commit: (dir: string, task: { id: string; title: string }, info: { stage: string; subject: string; body?: string }) => Promise<CommitResult>
}

// Unit start gate: a clean worktree → record the baseline and pass; a dirty
// area entirely of driver-exclusive state files → self-heal with a carryover
// backfill commit then pass; any other dirty area → dirty (the caller blocks
// and halts, writing no state files and making no sweeping commit — the
// authority over git state stays with the human).
export async function beginUnit(dir: string, opts: { dryrun?: boolean }, task: { id: string; title: string }, relaxed?: BeginUnitRelaxation): Promise<UnitGate> {
  if (opts.dryrun) return { type: "ok", baseline: undefined }
  // A work tree git refuses to open blocks the gate (plans/0174 D1,
  // 0165-036): the probe's three states replace the old boolean — under a
  // refused read (dubious ownership, a corrupt config) the old path found no
  // roots, passed with an empty baseline and every unit closed with nothing
  // committed, P4's completion condition silently absent for the whole run.
  const refused = (await workTree(dir)).problem
  if (refused) {
    return {
      type: "dirty",
      files: [`.: git refuses the work tree (${refused}) — the tree's cleanliness cannot be judged; run the same git command directly to see its remedy (an ownership refusal teaches its safe.directory fix)`],
    }
  }
  // An unreadable status over any repository root blocks the gate (plans/
  // 0155 D1): the clean question cannot be answered, and a gate that passed
  // would hand the unit a tree whose close-out commit is already doomed —
  // the block line names the root (P12: the uncertain read resolves toward
  // dirty). One extra status pass per unit start buys the gate its own
  // strictness; the reads below keep their shapes.
  for (const root of await repoRoots(dir)) {
    if ((await statusEntriesRead(dir, root)) === undefined) {
      return {
        type: "dirty",
        files: [`${relative(dir, root) || "."}: git status unreadable (repo missing or index corrupt) — the tree's cleanliness cannot be judged; investigate the repository state`],
      }
    }
  }
  // The gate judges the person's tree, and the driver workdir is not part of
  // it (plans/0141 D1): an untracked .auto/ or tmp/ file is the driver's own
  // runtime state (the run lock, the stats heartbeat) — invisible to git once
  // the ignore set is on disk, and preflight ensures the set only after this
  // gate, so the first gate of a repository whose set has not arrived yet (a
  // hand-built one, a person who dropped the lines) would otherwise name the
  // driver's own state as the person's uncommitted work and block on a false
  // remedy. A tracked workdir file is the opposite fact — someone put it in
  // git, and the driver's every rewrite would dirty later units — and still
  // blocks.
  const untracked = await untrackedFiles(dir)
  const dirty = (await (relaxed?.reads.changedFiles ?? changedFiles)(dir))
    .filter((file) => !(untracked.has(file) && workdirEntry(file)))
    .filter((file) => !withinScopes(file, relaxed?.tolerate ?? []))
  if (dirty.length) {
    if (dirty.every(driverStateFile)) {
      // The admission shapes (plans/0183 D1, 0165-112): path membership alone
      // trusted any diff on these paths and swept a person's content edit of
      // a state file into the catch-up commit — only the driver's own write
      // shapes heal; anything else is the person's uncommitted work. The
      // shape read rides the same seam as changedFiles (the decorator's
      // wrapped base, a test's double).
      const notOurs = await (relaxed?.reads.personDirtOverStatePaths ?? personDirtOverStatePaths)(dir, dirty)
      if (!notOurs.length) {
        const info = { stage: "carryover", subject: `${task.id} carryover driver-state posting` }
        // The relaxation's own heal (plans/0175 D4): the decorator's queued,
        // scoped commit core instead of the free carryover (whose pathspec
        // excludes the workdir roots — this one commit can run before
        // preflight's ignore-set repair, and an unqualified add -A would
        // absorb the workdir into git).
        const healed = relaxed?.commit
          ? await relaxed.commit(dir, task, info)
          : await commitTree(dir, task, info, [".", ...WORKDIR_ROOTS.map((root) => `:(exclude)${root}`)])
        if (healed.ok) {
          log(`  ✓ driver state files not posted (${dirty.join(", ")}), self-healed with a catch-up commit`)
          return { type: "ok", baseline: await (relaxed?.reads.unitBaseline ?? unitBaseline)(dir) }
        }
      } else {
        log(
          `  ⚠ driver-state paths hold changes beyond the driver's own write shapes (${notOurs.join(", ")}) — ` +
            `the carryover admits only index ticks, a unit's todo→done rename with its runtime entry gone, and the retired CURRENT.md deletion; ` +
            `the rest is uncommitted work for the person`,
        )
      }
    }
    return { type: "dirty", files: dirty }
  }
  return { type: "ok", baseline: await (relaxed?.reads.unitBaseline ?? unitBaseline)(dir) }
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
  // The abort is judged over the merged repository alone (plans/0155): a
  // dirty or unreadable nested repository elsewhere under it is not the
  // abort's work and must not misreport the abort as failed. Unreadable
  // (a nonzero status over the root) reads as failed, never clean (P12).
  const entries = aborted.code === 0 ? await statusEntriesRead(root, root) : undefined
  if (entries !== undefined && !entries.length) {
    return { type: "conflict", detail: firstLine(merged.err || merged.out) }
  }
  if (aborted.code === 0) {
    return entries === undefined
      ? { type: "failed", error: `verifying the aborted merge failed (git status unreadable over the repository); ${whose} must be handled manually` }
      : { type: "failed", error: `git merge --abort left the repository dirty; ${whose} must be handled manually` }
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
  // commitTree's optional add pathspec: absent = the whole-subtree sweep, the
  // byte-identical floor most call sites keep by passing nothing. Two
  // conscious families pass it (plans/0207 D1 restating 0099 D4's premise,
  // first breached by the wall close's 0190 D2): the doc-lane seam decorator
  // INJECTS its own scoping (ignoring whatever a caller passed — a decorated
  // base never re-scopes), and an enumerated caller-side family names its own
  // write surface — the wall close's record commit (0190 D2) and the three
  // release consumptions (0207 D1: the brief install, the round-brief
  // install, the phase-sync commit), whose subjects claim exact contents and
  // which run ahead of the clean gate that would otherwise never judge what
  // they folded.
  commitTree(
    dir: string,
    task: { id: string; title: string },
    info: { stage: string; subject: string; body?: string; allowEmpty?: boolean },
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
  // The carryover's admission shapes (plans/0183 D1): which dirty
  // driver-state paths are NOT the driver's own write shapes — the read the
  // gate's heal branch judges over, injected the same way as changedFiles so
  // the doc-lane decorator's base and the test doubles own their copy.
  personDirtOverStatePaths(dir: string, dirty: readonly string[]): Promise<string[]>
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

// The target directory's work-tree state (plans/0174 D1, 0165-036): one
// probe answering three states. `git rev-parse --is-inside-work-tree` exits
// 0 only inside a work tree; its failures are two different facts git's
// exit code does not separate (both 128) — "not a git repository" (the
// genuine non-git floor: init bootstraps, the commit side idles by design)
// and everything else (dubious ownership — the container-mount/CI/sudo
// shape; a corrupt config; a vanished directory), which is an anomaly a
// verdict must never ride over silently. problem carries git's first line;
// the spawn-throw (git unavailable) stays the non-git floor. One home: the
// family's other reads (repoRoots below, the strict gates) consult this
// probe, never their own rev-parse.
export type WorkTreeRead = { inside: boolean; problem?: string }

export async function workTree(dir: string): Promise<WorkTreeRead> {
  const got = await git(dir, ["rev-parse", "--is-inside-work-tree"]).catch(() => undefined)
  if (got === undefined) return { inside: false }
  if (got.code === 0) return { inside: true }
  if (/not a git repository/i.test(got.err)) return { inside: false }
  const problem = firstLine(got.err) || `git rev-parse exit code ${got.code}`
  log(`  ⚠ git refuses the work tree (${dir}): ${problem} — the tree's state cannot be judged; run the same git command directly to see its remedy (an ownership refusal teaches its safe.directory fix)`)
  return { inside: false, problem }
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
  const read = await workTree(dir)
  const roots = new Set<string>(read.inside ? [dir] : [])
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

// The added lines of the worktree's uncommitted changes (plans/0199 D1): the
// marker scan's unit — what a session proxy-answered is what that session
// WROTE, and the AUTO-RESOLVE/AUTO-DECISION grammar is a line grammar, so the
// scan must see exactly the lines this session added, never the committed
// content of the files it happened to touch (a later task's edit of a file
// with committed markers re-booked them under the new task — 0165-109). Per
// repository root (repoRoots' own traversal, changedFiles' discipline): the
// tracked changes diff against HEAD at -U0 (added lines only, no context),
// the untracked files whole ("all" — beginUnit's clean start makes untracked
// mean this unit's own new write, every line of it added). Keyed by the
// target-directory-relative path, the same spelling changedFiles returns;
// the line numbers are 1-based positions in the file's CURRENT text (the new
// side of the diff), ready for a `path:line` record.
// The diff read is pinned against the person's own diff configuration
// (prefixes, renames, external drivers, colors, quoted paths): the parse
// below reads the a/b headers git prints by default, and the target's
// config must not change what the driver's own grammar sees.
// A repository whose HEAD does not resolve or whose diff exits nonzero falls
// back to whole-file for its tracked entries: unborn history has nothing
// committed to over-book (whole-file IS the added-lines truth there), and for
// the anomalous window the floor keeps today's whole-file scan — the ledger
// is best-effort auditing (0020 §F), never a flow-affecting read.
export type AddedLines = number[] | "all"

export async function addedLines(dir: string): Promise<Map<string, AddedLines>> {
  const out = new Map<string, AddedLines>()
  for (const root of await repoRoots(dir)) {
    const entries = await statusEntries(dir, root)
    if (!entries.length) continue
    const tracked = new Set<string>()
    for (const entry of entries) {
      if (entry.status === "??") out.set(entry.rel, "all")
      else tracked.add(entry.rel)
    }
    if (!tracked.size) continue
    const diff = await git(root, [
      "-c",
      "diff.noprefix=false",
      "-c",
      "diff.mnemonicPrefix=false",
      "-c",
      "core.quotePath=false",
      "diff",
      "HEAD",
      "-U0",
      "--patch",
      "--no-color",
      "--no-ext-diff",
      "--no-renames",
      "--",
      ".",
    ])
    if (diff.code !== 0) {
      for (const rel of tracked) out.set(rel, "all")
      continue
    }
    await collectAddedLines(dir, root, tracked, diff.out, out)
  }
  return out
}

// The -U0 hunk header: the capture is the first added line's number in the
// new file (the counter the `+` content lines below it advance).
const HUNK_HEAD = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

// One repository's diff parsed into added line numbers. Stateful by
// construction: a file's `--- a/…`/`+++ b/…` headers precede all its hunks,
// so a `+++ b/` line counts as the header exactly while no file is open
// (`rel === undefined`), and inside a hunk every line carries its `+`/`-`
// prefix — a content line whose text begins with `++ b/` renders as
// `+++ b/…` too, and must stay content. Paths are top-level-relative (the a/
// b/ prefixes are repository-root-relative), mapped to target-relative
// exactly the way statusEntries maps its own output, and accepted only when
// the mapping names a changed tracked file (a mangled or out-of-subtree
// mapping is skipped — the best-effort floor, never a wrong-line record).
async function collectAddedLines(
  dir: string,
  root: string,
  tracked: Set<string>,
  output: string,
  out: Map<string, AddedLines>,
): Promise<void> {
  const top = (await git(root, ["rev-parse", "--show-toplevel"])).out.trim()
  if (!top) {
    for (const rel of tracked) out.set(rel, "all")
    return
  }
  const phys = await physicalDir(dir)
  let rel: string | undefined
  let lineNo = 0
  for (const line of output.split("\n")) {
    if (line.startsWith("diff --git ")) {
      rel = undefined
      lineNo = 0
    } else if (rel === undefined) {
      if (line.startsWith("+++ b/")) {
        const mapped = relative(phys, join(top, line.slice(6)))
        if (tracked.has(mapped)) rel = mapped
      }
    } else {
      const hunk = HUNK_HEAD.exec(line)
      if (hunk) {
        lineNo = Number(hunk[1])
      } else if (lineNo > 0 && line.startsWith("+")) {
        const existing = out.get(rel)
        if (existing === undefined) out.set(rel, [lineNo])
        else if (existing !== "all") existing.push(lineNo)
        lineNo += 1
      }
    }
  }
}

// --porcelain -z --no-renames -uall: NUL-separated per-file output with no
// rename arrows; each entry is "XY <path>", the path relative to the
// repository root (the worktree top level), converted to a path relative to
// the target directory. Under -uall the only entries still collapsed to
// "?? dir/" are nested repository directories (their inner files are listed
// separately by that repository's own status), skipped to avoid duplication.
// The XY status code is kept with each entry (the untracked criterion and the
// listing share one parsing pass).
//
// undefined = the read itself failed: the toplevel probe or the status
// exited nonzero over a root the caller or repoRoots discovered (a corrupt
// index, a half-deleted .git — an anomaly, never a verdict; plans/0155 D1:
// the dirt question cannot be answered, and the strict gates block on it,
// P12 — a nonzero exit is never swallowed into a clean reading). A spawn
// throw (git unavailable) reads undefined too: the non-git environments
// never reach a root to ask, so the floor needs no shape of its own.
export async function statusEntriesRead(dir: string, root: string): Promise<{ rel: string; status: string }[] | undefined> {
  const phys = await physicalDir(dir)
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const toplevel = (await new Response(top.stdout).text()).trim()
  const topErr = (await new Response(top.stderr).text()).trim()
  const topCode = await top.exited
  if (topCode !== 0 || !toplevel) {
    log(`  ⚠ git status unreadable (${relative(dir, root) || "."}): ${firstLine(topErr) || `git rev-parse exit code ${topCode}`} — the dirt question cannot be judged; investigate the repository state`)
    return undefined
  }
  const proc = Bun.spawn(
    ["git", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."],
    // The same GIT_OPTIONAL_LOCKS=0 the spawn helper sets (plans/0099 D4):
    // this status runs outside the doc-lane commit queue (beginUnit's dirty
    // check, the close-out checks), and the env form covers the one site
    // that does not route through the helper.
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
  )
  const output = await new Response(proc.stdout).text()
  const err = (await new Response(proc.stderr).text()).trim()
  const code = await proc.exited
  if (code !== 0) {
    log(`  ⚠ git status unreadable (${relative(dir, root) || "."}): ${firstLine(err) || `git status exit code ${code}`} — the dirt question cannot be judged; investigate the repository state`)
    return undefined
  }
  return output
    .split("\0")
    .filter((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
    .map((entry) => ({ rel: relative(phys, join(toplevel, entry.slice(3))), status: entry.slice(0, 2) }))
}

// The legacy-typed front of the same read (plans/0155 D1 keeps the signature
// its many callers compile against): an unreadable status is surfaced by the
// ⚠ line above — never a silent clean verdict — and reads as empty for the
// callers that cannot carry a problem line; the strict gates (beginUnit,
// land's and isolateRound's clean gates) ask statusEntriesRead and block.
// Exported since plans/0074: `land`'s dirty gate lists one designated
// repository's uncommitted paths the same way isolateRound's does.
export async function statusEntries(dir: string, root: string): Promise<{ rel: string; status: string }[]> {
  return (await statusEntriesRead(dir, root)) ?? []
}

// Whether the repository has uncommitted changes (confined to this
// directory's subtree; a collapsed directory entry can only be a nested
// repository, handled separately by its own commit). undefined = the status
// read itself failed over the discovered root (plans/0155 D1: a nonzero git
// exit is an anomaly the callers resolve toward dirty/loud, P12 — never a
// quiet no-changes verdict); the spawn-throw (git unavailable) keeps the old
// quiet no-changes floor. paths narrows the check the way the commit's add
// step is narrowed (plans/0099 D4): absent = the whole subtree (today's
// question, byte-identical).
async function hasChanges(root: string, paths?: readonly string[]): Promise<boolean | undefined> {
  let status: Awaited<ReturnType<typeof git>> | undefined
  try {
    status = await git(root, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--", ...(paths ?? ["."])])
  } catch {
    return false // git unavailable (spawn throws): nothing git-side can be judged
  }
  if (status.code !== 0) return undefined
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
  // The three-state probe (plans/0174 D1, 0165-036): a refused read is not
  // "outside any work tree" — the old boolean here would `git init` a nested
  // repository INSIDE the person's monorepo, the one shape init must never
  // produce. The refusal carries git's own first line.
  const read = await workTree(dir)
  if (read.inside) return { type: "existing" }
  if (read.problem) {
    return { type: "failed", error: `git refuses the directory's work tree (${read.problem}) — refusing to nest a repository inside a repository git cannot read; run the same git command directly to see its remedy (an ownership refusal teaches its safe.directory fix)` }
  }
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
  // The driver's own variables are scrubbed from every git child's
  // environment (plans/0173 D4, 0165-142): the target's git hooks run inside
  // these children, and the switches layer's OPENCODE_AUTO_* (0059 X1's
  // measured carrier — a project's pre-commit hook starting real agent
  // sessions through OPENCODE_AUTO_AGENT) are the driver's alone, read by
  // nothing but src/switches.ts in this process.
  const env: NodeJS.ProcessEnv = { GIT_OPTIONAL_LOCKS: "0" }
  for (const [key, value] of Object.entries(process.env)) if (!key.startsWith("OPENCODE_AUTO_") && value !== undefined) env[key] = value
  const proc = Bun.spawn(["git", "-C", root, ...args], { stdout: "pipe", stderr: "pipe", env })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { code, out, err }
}

// The git hooks each repository under the target carries (plans/0173 D4,
// 0165-142): a non-sample file under the repository's hooks directory, or a
// core.hooksPath set inside the repository — the person's commit policy,
// which the driver's commits honor too (the ruling) while the spawn scrubs
// the driver's variables from their environment. Detection only (P8): the
// caller's one teaching line names what runs and what a failure means; no
// remediation is invented. Read-only, so it runs under dryrun as well.
export async function hookReports(dir: string): Promise<string[]> {
  const lines: string[] = []
  for (const root of await repoRoots(dir)) {
    const rel = relative(dir, root) || "."
    const configured = await git(root, ["config", "--get", "core.hooksPath"])
    const hooksDir = configured.code === 0 && configured.out.trim() ? resolve(root, configured.out.trim()) : join(root, ".git", "hooks")
    const names = (await readdir(hooksDir).catch(() => []))
      .filter((name) => !name.endsWith(".sample"))
      .sort()
    const inside = configured.code === 0 && configured.out.trim() ? hooksDir.startsWith(root) : true
    if (names.length && inside) {
      lines.push(
        `⚠ ${rel} carries git hook(s): ${names.join(", ")} — they run on the driver's commits too; a failing hook halts the run as a commit failure. The driver's OPENCODE_AUTO_* variables are scrubbed from their environment`,
      )
    }
  }
  return lines
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

// The cause of a git failure over its own progress lines (plans/0191 D3,
// 0165-145): `git worktree add` prints "Preparing worktree (…)" to stderr
// before the fatal line, so the FIRST line names progress, not the cause.
// The last `fatal:`/`error:` line is git's own verdict; failing that, the
// last non-empty line (a lone progress line still beats the empty string,
// and wholly silent failures keep the callers' `|| exit code` fallback).
export function causeLine(text: string): string {
  const lines = text.trim().split("\n").map((line) => line.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i]!.startsWith("fatal:") || lines[i]!.startsWith("error:")) return lines[i]!.slice(0, 200)
  }
  return (lines.at(-1) ?? "").slice(0, 200)
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
  // A tree the receipt does not cover vouches for nothing (plans/0174 D4,
  // 0165-110): a repository root that appeared after the green receipt (a
  // task vendoring a dependency, a sub-crate split out as its own
  // repository) contributes changed paths the loop below never diffs — the
  // recorded-HEADs diff is carry's whole claim, so a grown root set means
  // the receipt covers less than the tree and the answer is undefined (no
  // carry). The vanished-root direction already read undefined.
  const named = new Set(heads.map((head) => head.root))
  if ((await repoRoots(dir)).some((root) => !named.has(relative(dir, root) || "."))) return undefined
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

// The changed paths of this task's own commits (plans/0096 D7, the release
// note's re-merge surface): every commit whose message carries the task's
// `Auto-Task: <id>` trailer line — the same unit marker the close-out check
// and the suite's range grammar read — contributes its diff (a merge against
// its first parent, so a landed lane's merge names the branch's files; the
// runtime's landing merges carry the trailer like every driver commit).
// Commits of an earlier corpus under a re-issued id fall outside the task's
// corpus set (plans/0140, the same bound taskFirstCommit reads) so a
// wipe-and-restart never blends lineages into this surface either — and the
// bound reaches the NESTED repositories through the alignment record
// (plans/0174 D5): a nested root's corpus starts at the Auto-Nested sha the
// root boundary commit recorded for it. Paths come back
// target-directory-relative; an unreadable repository contributes nothing
// (the surface is advisory steer, never a gate).
export async function taskChangedPaths(dir: string, taskId: string): Promise<string[]> {
  const phys = await physicalDir(dir)
  const files = new Set<string>()
  const trailer = `Auto-Task: ${taskId}`
  const roots = await repoRoots(dir)
  // The corpus boundary of the root repository (the newest commit that added
  // the task's unit document): the nested roots' corpora derive from its
  // Auto-Nested alignment record below. A target outside any work tree has
  // no root repository and no record — the whole-log floor everywhere.
  const bound = roots.includes(dir) ? await taskCorpusBound(dir, taskId) : ""
  for (const root of roots) {
    const corpus = root === dir
      ? derivableBound(bound)
        ? await corpusSince(root, bound)
        : undefined
      : await nestedTaskCorpus(root, dir, bound, relative(dir, root) || ".")
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
      .filter(([sha]) => corpus === undefined || corpus.has(sha!.trim()))
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

// One task's corpus, as the commits of this one repository that belong to
// it (plans/0140): everything reachable from HEAD but not from the first
// parent of the newest commit that added the task's unit document
// `docs/T-NNN/todo.md`. Every corpus formulates a unit exactly once, so the
// newest addition is the current corpus's formulation-of-record, and the
// boundary commit itself counts inside — the creating commit can be a task
// commit (an interrupted first attempt committing its own todo.md, or a
// formulation task's collect writing the *next* task's document under its
// own id). Why a boundary is needed at all: task numbers never repeat
// within a corpus, but a wipe-and-restart over retained git history
// re-issues them (the numbering floor scans surviving files only,
// src/numbering.ts), and unbounded, the oldest trailer commit under a
// re-issued id belongs to an earlier corpus — a fork would land before the
// restart. With no re-issuance the set contains every trailer commit
// anyway, so the bound changes nothing (the byte-identical floor).
// undefined = no derivable boundary in this repository (a nested
// repository — task documents live in the target directory alone; a unit
// whose document no history commit added; a boundary at the repository's
// initial commit, where nothing exists before it): nothing separates
// lineages there and the whole-log scan stands.
// The boundary itself is split out (plans/0174 D5): taskChangedPaths'
// nested corpora read it from the root repository's alignment record, so
// the sha is derived once and both corpus forms build on it.
function derivableBound(bound: string): boolean {
  return /^[0-9a-f]{40}$/.test(bound)
}

async function taskCorpusBound(root: string, taskId: string): Promise<string> {
  const added = await git(root, ["log", "-n", "1", "--diff-filter=A", "--format=%H", "--", join(taskDir(taskId), "todo.md")]).catch(() => undefined)
  return added?.code === 0 ? added.out.trim() : ""
}

// The commits `bound^..HEAD` names in root — one corpus set; undefined when
// the rev-list cannot be read (the whole-log floor).
async function corpusSince(root: string, bound: string): Promise<Set<string> | undefined> {
  const listed = await git(root, ["rev-list", `${bound}^..HEAD`]).catch(() => undefined)
  if (!listed || listed.code !== 0) return undefined
  return new Set(listed.out.split("\n").filter(Boolean))
}

// The corpus of a NESTED repository (plans/0174 D5, 0165-204): nested roots
// hold no unit documents, so their own history derives no 0140 boundary —
// the alignment record does: the Auto-Nested line the ROOT repository's
// corpus boundary commit carries for this repository names the sha its
// corpus started from, and the commits above it are this corpus's. No
// record (a boundary commit that is not a driver commit and carries no
// lines, a repository the record does not name, history rewritten past the
// sha) floors to the unbounded whole-log scan — the same floor an
// underivable root boundary takes.
async function nestedTaskCorpus(root: string, dir: string, bound: string, rel: string): Promise<Set<string> | undefined> {
  if (!derivableBound(bound)) return undefined
  const sha = (await nestedShasAt(dir, bound)).get(rel)
  if (!sha) return undefined
  const listed = await git(root, ["rev-list", `${sha}..HEAD`]).catch(() => undefined)
  if (!listed || listed.code !== 0) return undefined
  return new Set(listed.out.split("\n").filter(Boolean))
}

async function taskCorpusCommits(root: string, taskId: string): Promise<Set<string> | undefined> {
  const bound = await taskCorpusBound(root, taskId)
  return derivableBound(bound) ? corpusSince(root, bound) : undefined
}

// The task-first derivation fork reads (plans/0128, the corpus bound
// plans/0140): `first` = the oldest commit of the task's *current corpus*
// carrying the `Auto-Task: <id>` trailer line — the unit's first commit in
// this repository, whose parent is the state the task started from, what a
// retry-from-the-beginning wants (interrupted earlier attempts carry the
// trailer too, so "oldest" sits before the task *first* started, not
// before its last attempt; trailer commits under the same id from a corpus
// before a wipe-and-restart fall outside the set). `older` = such
// out-of-corpus commits exist, the re-issued shape — fork's refusal and
// success line read it to say so. The scan is the same -z log walk
// taskChangedPaths filters; first undefined with older false = no commit
// here carries the trailer (the task never ran in this repository);
// undefined overall = the log itself is unreadable.
export type TaskFirstCommit = { first: string | undefined; older: boolean }

export async function taskFirstCommit(root: string, taskId: string): Promise<TaskFirstCommit | undefined> {
  const log = await git(root, ["log", "-z", "--format=%H%x1f%B%x1e"]).catch(() => undefined)
  if (!log || log.code !== 0) return undefined
  const corpus = await taskCorpusCommits(root, taskId)
  let first: string | undefined
  let older = false
  for (const entry of log.out.split("\x1e")) {
    const [sha, body] = entry.replaceAll("\0", "").split("\x1f")
    // The trailer block is the one grammar (plans/0173 D2): the Auto-Task
    // key read from the body's last paragraph, never a whole-line match
    // anywhere in the body (a quoted message above the block was the same
    // accidental shape the Auto-Stage readers carried).
    if (!sha?.trim() || trailerBlock(body ?? "")?.get("Auto-Task") !== taskId) continue
    // git log walks newest-first, so the last in-corpus hit is the oldest.
    if (corpus === undefined || corpus.has(sha.trim())) first = sha.trim()
    else older = true
  }
  return { first, older }
}

// The verification charter's true start (plans/0184 D1, 0165-023): per
// repository, the commit before the task's first unit commit —
// taskFirstCommit's corpus-bounded scan over the Auto-Task trailer — so a
// resume's or re-run's re-anchored HEAD (kept for the close-out audit's
// foreign-commit question) does not hand the verifier an empty HEAD..HEAD
// range over work the task's own sessions committed before the interruption
// (the re-run after a FAIL block, the kill during the wrap-up). A repository
// where the task has no unit commit yet keeps the given sha (nothing
// committed there — today's range); the corpus bound is the lineage's own (a
// re-issued id is a new lineage, 0140, and the charter of the restart never
// spans the wiped corpus); the first commit's parent is the state before the
// unit began, and a root first commit (no parent) renders the whole-history
// shape (""). An empty input baseline (non-git / the no-commit double) passes
// through — the charter words the inspection without a range, as today.
export async function charterBaseline(taskId: string, reanchored: UnitBaseline): Promise<UnitBaseline> {
  if (!reanchored.length) return reanchored
  const out: UnitBaseline = []
  for (const { root, sha } of reanchored) {
    const first = await taskFirstCommit(root, taskId)
    if (first?.first) {
      const parent = await git(root, ["rev-parse", "--short", `${first.first}^`]).catch(() => undefined)
      out.push({ root, sha: parent?.code === 0 ? parent.out.trim() : "" })
    } else {
      out.push({ root, sha })
    }
  }
  return out
}

// The nested-repository alignment one root-repository commit records: the
// `Auto-Nested: <rel> @ <sha>` trailer lines commitTree writes when the root
// commits last — the state every nested repository was at that commit ("any
// root commit can align cross-repository state"). fork's reconstruction reads
// the record back (plans/0128): rel keys are repository-relative paths as
// recorded, the SHAs the short form the trailer writes. An unreadable commit
// yields the empty map; the caller decides what that means.
export async function nestedShasAt(root: string, sha: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const body = await git(root, ["show", "-s", "--format=%B", sha]).catch(() => undefined)
  if (!body || body.code !== 0) return out
  for (const line of body.out.split("\n")) {
    const m = /^Auto-Nested:\s*(.+?)\s*@\s*([0-9a-f]+)\s*$/.exec(line.trim())
    if (m) out.set(m[1]!, m[2]!)
  }
  return out
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
