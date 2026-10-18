// The lane-worktree family (plans/0068 §6.5, D1/D16; split out of git.ts by
// plans/0102 E-α2, the complexity-1 move): worktree creation and teardown for
// the lane park `.auto/worktrees/`, the tier-1 sparse materialization and
// the reflink probe (plans/0096 D9/D10), and the lane landing merge (D7) —
// a leaf beside git.ts, importing its spawn helper, first-line error
// formatting, commit identity/message builders and merge-conflict
// vocabulary (WorktreeResult / LandResult / isConflict / abortToLandResult
// stay in git.ts: both split modules and the GitOps seam reference them, and
// the type-counted import graph keeps git.ts importing from neither split
// module — each imports it).
import { mkdir, rm, stat } from "node:fs/promises"
import { dirname, join, relative } from "node:path"
import {
  abortToLandResult,
  commitTitle,
  firstLine,
  git,
  identityArgs,
  isConflict,
  message,
  type LandResult,
  type WorktreeResult,
} from "./git"

// Create a lane worktree at path (the park, `.auto/worktrees/<task-id>`,
// gitignored with the rest of `.auto/`) on the new branch `auto-lane/<task-id>`
// at the repository's current HEAD (plans/0068 D1: the lane's commit boundary
// — beginUnit's clean gate, the SHA baseline, commitTree and unitViolations —
// then holds per worktree by construction). path and branch are the caller's
// protocol strings (src/lanes.ts builds them); nothing here knows task ids.
//
// sparse (plans/0096 D9, tier 1) switches the working materialization to the
// cheap one: `--no-checkout` registers the worktree without populating it, the
// cone directories are copied in from the base checkout by
// `cp -a --reflink=always` (byte-shared until divergence — the CoW capability
// the `auto` probe established; a per-file failure here fails the dispatch,
// never a silent full write), the index is populated by `read-tree` + a stat
// refresh so git sees the copied files as already materialized, and
// cone-mode `sparse-checkout set` then applies the patterns without rewriting
// them — every file outside the cone stays unmaterialized behind a
// skip-worktree bit. The landing machinery is untouched: skip-worktree entries
// ride the index unchanged, so the lane's commits record the FULL tree and the
// merge lands exactly as under tier 2; sparse affects only the working
// materialization, per D9's own words.
// The hazard the cheapness buys (named once, D11's register): a session that
// writes a path outside its unit's declared `Touches:` meets git's sparse
// guard — `git add -A` refuses such paths ("outside of your sparse-checkout
// definition") — so a wrong declaration surfaces as a dirty worktree and a
// failing unified commit, never as silently unlanded work.
export async function addWorktree(dir: string, path: string, branch: string, sparse?: readonly string[]): Promise<WorktreeResult> {
  if (sparse === undefined) {
    const added = await git(dir, ["worktree", "add", "-b", branch, path])
    if (added.code === 0) return { ok: true }
    return { ok: false, error: firstLine(added.err || added.out) || `git worktree add exit code ${added.code}` }
  }
  const added = await git(dir, ["worktree", "add", "--no-checkout", "-b", branch, path])
  if (added.code !== 0) return { ok: false, error: firstLine(added.err || added.out) || `git worktree add exit code ${added.code}` }
  // The cone set by reflink: each declared directory recursively, plus every
  // tracked root file (cone mode always materializes the root; `git ls-files`
  // lists the index, and the dispatch-time clean gate makes index and disk
  // agree). Root dotfiles included — .gitignore rides along exactly as the
  // scaffolding copy would need it to.
  const copied = await copyConeByReflink(dir, path, sparse)
  if (copied !== undefined) return { ok: false, error: copied }
  // Populate the index from HEAD without touching the worktree, then refresh
  // the stat cache: the copied cone files are recorded as already
  // materialized, so the sparse apply below rewrites nothing. The refresh
  // reports the not-yet-copied outside-cone files as "needs update" (they are
  // absent, and not yet behind skip-worktree bits) — expected at this point
  // in the sequence, and its exit code is deliberately ignored.
  if ((await git(path, ["read-tree", "HEAD"])).code !== 0) return { ok: false, error: "populating the sparse worktree's index failed (git read-tree HEAD)" }
  await git(path, ["update-index", "--refresh"])
  if ((await git(path, ["sparse-checkout", "init", "--cone"])).code !== 0) return { ok: false, error: "enabling cone-mode sparse checkout failed (git sparse-checkout init --cone)" }
  const applied = await git(path, ["sparse-checkout", "set", ...sparse])
  if (applied.code !== 0) return { ok: false, error: firstLine(applied.err || applied.out) || `git sparse-checkout set exit code ${applied.code}` }
  // The consistency guard, fail-closed: an empty status is the proof the
  // materialized cone matches HEAD (a copy that missed a file, or drifted,
  // shows here instead of surfacing mid-lane).
  const status = await git(path, ["status", "--porcelain"])
  if (status.code !== 0 || status.out.trim() !== "") {
    return { ok: false, error: `the sparse worktree is not clean after materialization${status.out.trim() ? ` (${firstLine(status.out)})` : ""}; remove ${path} manually and re-run` }
  }
  return { ok: true }
}

// Copy the cone set of a fresh `--no-checkout` worktree by reflink from the
// base checkout (tier 1's materialization core): the declared directories
// recursively (`cp -a` preserves modes and timestamps, `--reflink=always`
// shares the bytes), every tracked root file individually. Returns the error
// that failed the dispatch, or undefined. A reflink failure here is a real
// one — the probe established the capability moments earlier — so it blocks
// the dispatch (the caller fails and names the path) rather than degrading
// to a full write the tier never asked for.
async function copyConeByReflink(dir: string, worktree: string, cone: readonly string[]): Promise<string | undefined> {
  const reflink = async (src: string, dst: string, recursive: boolean): Promise<string | undefined> => {
    await mkdir(dirname(dst), { recursive: true })
    const copied = Bun.spawn(["cp", ...(recursive ? ["-a"] : []), "--reflink=always", src, dst], { stdout: "ignore", stderr: "pipe" })
    const err = await new Response(copied.stderr!).text().catch(() => "")
    const code = await copied.exited
    if (code !== 0) return `copying ${relative(dir, src).replaceAll("\\", "/")} into the lane worktree by reflink failed: ${firstLine(err) || `cp exit code ${code}`}`
    return undefined
  }
  for (const rel of cone) {
    const failed = await reflink(join(dir, rel), join(worktree, rel), true)
    if (failed !== undefined) return failed
  }
  const listed = await git(dir, ["ls-files", "-z"])
  if (listed.code !== 0) return undefined // no root files to copy; the set step still applies
  for (const rel of listed.out.split("\0")) {
    if (!rel || rel.includes("/")) continue
    const dst = join(worktree, rel)
    if (await stat(dst).then(() => true, () => false)) continue
    const failed = await reflink(join(dir, rel), dst, false)
    if (failed !== undefined) return failed
  }
  return undefined
}

// The working tree's size in MB (plans/0096 D10's probe input): the sum of
// the tracked files' sizes — the per-lane disk cost of a worktree, since git
// already shares the object store between linked worktrees (D8's cost model;
// untracked state never materializes in one). Read-only, never a seam member.
// undefined = not a git environment (no tree to weigh; the budget check
// passes vacuously — there is nothing to materialize).
export async function workingTreeMB(dir: string): Promise<number | undefined> {
  const listed = await git(dir, ["ls-files", "-z"]).catch(() => undefined)
  if (!listed || listed.code !== 0) return undefined
  let bytes = 0
  for (const rel of listed.out.split("\0")) {
    if (!rel) continue
    bytes += (await stat(join(dir, rel)).catch(() => undefined))?.size ?? 0
  }
  return bytes / (1024 * 1024)
}

// Whether `cp --reflink=always` clones here: one small file under the target's
// own `.auto/` — the same filesystem the lane park and the regression copy
// (plans/0098 D4) materialize on, so the probe measures exactly the copy that
// would run — cloned and removed again. Any failure (no cp, no reflink, a
// read-only tree) reads as incapable, which is the fall-through answer; the
// probe file is cleaned up either way and is driver state `.auto/` already
// gitignores. Shared by the preflight tier probe (plans/0096 D9) and the
// regression lane's copy gate, which is why it lives beside the tree
// primitives instead of the preflight.
export async function probeReflink(dir: string): Promise<boolean> {
  const root = join(dir, ".auto")
  const src = join(root, "reflink-probe")
  const dst = join(root, "reflink-probe.copy")
  try {
    await mkdir(root, { recursive: true })
    await Bun.write(src, "reflink probe\n")
    const copied = Bun.spawn(["cp", "--reflink=always", src, dst], { stdout: "ignore", stderr: "ignore" })
    return (await copied.exited) === 0
  } catch {
    return false
  } finally {
    await rm(src, { force: true }).catch(() => {})
    await rm(dst, { force: true }).catch(() => {})
  }
}

// The teardown retry schedule (plans/0068 §10's Windows hardening): attempt 1
// plain, attempts 2..N with `--force`, a short wait between attempts — a
// removal that races an antivirus scanner or a transient file lock usually
// succeeds a moment later, and the force pass covers leftover ignored state.
type WorktreeTeardown = { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> }

export const WORKTREE_TEARDOWN: WorktreeTeardown = { attempts: 3, delayMs: 250 }

const teardownSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Remove a lane worktree (D7's landing step ⑤): the retry schedule above,
// best-effort — the worktree is clean by then, the landing verification
// passed, so a failure is environmental (AV, a lock), not a fact about the
// work. The terminal failure keeps the scene and names the path in the error
// (the caller blocks or warns with it; never a silent loss).
export async function removeWorktree(dir: string, path: string, retry: WorktreeTeardown = WORKTREE_TEARDOWN): Promise<WorktreeResult> {
  let last: { code: number; out: string; err: string } | undefined
  const attempts = Math.max(1, Math.floor(retry.attempts))
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await (retry.sleep ?? teardownSleep)(retry.delayMs)
    const removed = await git(dir, attempt === 1 ? ["worktree", "remove", path] : ["worktree", "remove", "--force", path])
    if (removed.code === 0) return { ok: true }
    last = removed
  }
  const reason = firstLine(last!.err || last!.out) || `git worktree remove exit code ${last!.code}`
  return { ok: false, error: `${reason} (after ${attempts} attempt${attempts === 1 ? "" : "s"}; the worktree is kept at ${path} — remove it manually with \`git worktree remove --force ${path}\` and re-run)` }
}

// `git worktree prune`: drop the administrative entries of worktrees whose
// directories are gone (the park-straggler cleanup primitive; which straggler
// may be pruned is D14's orphan scan's to decide, not this one's).
export async function pruneWorktrees(dir: string): Promise<WorktreeResult> {
  const pruned = await git(dir, ["worktree", "prune"])
  if (pruned.code === 0) return { ok: true }
  return { ok: false, error: firstLine(pruned.err || pruned.out) || `git worktree prune exit code ${pruned.code}` }
}

// The short SHA of the merge base of two revisions (D7's landing step ① needs
// the lane branch's creation point — where the lane worktree forked the main
// tree's history — as the unitViolations baseline; the main tree's HEAD may
// have moved past it through sibling landings). undefined when either side
// cannot be resolved. The full SHA is cut to the 7-character form the
// baselines elsewhere carry (rev-parse --short's floor).
export async function mergeBaseSha(dir: string, a: string, b: string): Promise<string | undefined> {
  const base = await git(dir, ["merge-base", a, b]).catch(() => undefined)
  const sha = base?.code === 0 ? base.out.trim() : ""
  return sha ? sha.slice(0, 7) : undefined
}

// The short SHAs of the commits in `<sha>..HEAD` (the lane report's `commits`
// list, D8: what the lane worker's run posted since it started — an empty
// baseline sha lists the whole history). Read-only; never a seam member.
export async function commitsSince(dir: string, sha: string): Promise<string[]> {
  const listed = await git(dir, ["log", "--format=%h", ...(sha ? [`${sha}..HEAD`] : ["HEAD"])]).catch(() => undefined)
  if (!listed || listed.code !== 0) return []
  return listed.out.split("\n").map((line) => line.trim()).filter(Boolean)
}

// Delete a lane branch (D7's landing step ⑤; called only after the branch
// merged, so -d would do — -D keeps a decided teardown from failing on a
// hand-moved ref and silently keeping park state alive).
export async function deleteBranch(dir: string, branch: string): Promise<WorktreeResult> {
  const deleted = await git(dir, ["branch", "-D", branch])
  if (deleted.code === 0) return { ok: true }
  return { ok: false, error: firstLine(deleted.err || deleted.out) || `git branch -D exit code ${deleted.code}` }
}


// The landing merge (D7's step ②): `git merge --no-ff <branch>` in the main
// tree, the merge commit carrying `Auto-Task: <task>` / `Auto-Stage: landing`
// so the parent's own close-outs see a trailer-bearing range. Conflict
// detection leaves the main tree clean again (`git merge --abort`): the caller
// keeps the lane's worktree and branch for the conflict protocol.
// `own` names the parent-exclusive files (D6: the phase index) the caller
// re-derives at landing (syncIndexTicks): a conflict over exactly those is
// not a lane conflict — concurrent lanes tick adjacent index lines, which no
// textual merge survives — so the merge resolves them onto the main tree's
// side and concludes; the re-derivation right after sets the true ticks. Any
// other conflicted path is a real conflict and aborts.
export async function landBranch(dir: string, branch: string, task: { id: string; title: string }, own: readonly string[] = []): Promise<LandResult> {
  const subject = message(commitTitle(`${task.id} landing ${task.title}`), task, "landing")
  // The identity fallback applies to the merge commit like any other.
  const merged = await git(dir, [...(await identityArgs(dir)), "merge", "--no-ff", "-m", subject, branch])
  if (merged.code === 0) return { type: "ok" }
  // A conflicted merge leaves MERGE_HEAD and conflicted entries; aborting
  // restores the pre-merge state (a merge refused before starting — dirty
  // tree, unknown revision — has no MERGE_HEAD and needs no abort).
  if (!isConflict(merged.out, merged.err)) return { type: "failed", error: firstLine(merged.err || merged.out) || `git merge exit code ${merged.code}` }
  // The parent-owned files: resolve onto the main tree's side and conclude
  // the merge — but only when the conflict set is exactly them (a conflict
  // that also touches anything else stays a real conflict).
  const conflicted = (await git(dir, ["diff", "--relative", "--name-only", "--diff-filter=U"])).out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
  if (conflicted.length && conflicted.every((path) => own.includes(path))) {
    // Only the actually-conflicted subset: an `own` entry a lane never
    // touched (a task without a checklist, an index line moved) matches no
    // pathspec and would leave the merge unmerged (S5's checklist entry
    // exposed the shape).
    for (const path of conflicted) await git(dir, ["checkout", "--ours", "--", path])
    await git(dir, ["add", "--", ...conflicted])
    const concluded = await git(dir, [...(await identityArgs(dir)), "commit", "-m", subject])
    if (concluded.code === 0) return { type: "ok" }
    const aborted = await git(dir, ["merge", "--abort"])
    return { type: "failed", error: `concluding the landing merge over ${own.join(", ")} failed: ${firstLine(concluded.err || concluded.out)} (git merge --abort exit code ${aborted.code}); the main tree must be handled manually` }
  }
  return abortToLandResult(dir, merged, "the main tree")
}


// The branch name HEAD of dir is on (plans/0068 D7's conflict path: the
// "parent's current main branch" a repair merge names). undefined when HEAD is
// detached or unreadable — the caller blocks rather than guessing a branch.
export async function currentBranch(dir: string): Promise<string | undefined> {
  const named = await git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => undefined)
  const branch = named?.code === 0 ? named.out.trim() : ""
  return branch && branch !== "HEAD" ? branch : undefined
}


// The repair merge of D7's conflict path (plans/0068 S3): merge the parent's
// current main branch into the lane branch, inside the lane's worktree, as one
// of the lane's own commits — the merge commit carries the `Auto-Stage:
// merge-repair` trailer so the landing verification (unitViolations over the
// merge-base baseline) still sees a driver-only range; the base the merge
// brings in is the sibling landings' own trailer-bearing history. A conflict
// aborts the merge and leaves the worktree clean (the caller reports it — the
// semantic resolution a session would do is not this merge's to invent).
export async function mergeLaneUpstream(dir: string, branch: string, task: { id: string; title: string }): Promise<LandResult> {
  const merged = await git(dir, [...(await identityArgs(dir)), "merge", "--no-ff", "-m", message(commitTitle(`${task.id} merge repair ${task.title}`), task, "merge-repair"), branch])
  if (merged.code === 0) return { type: "ok" }
  if (isConflict(merged.out, merged.err)) return abortToLandResult(dir, merged, "the worktree")
  return { type: "failed", error: firstLine(merged.err || merged.out) || `git merge exit code ${merged.code}` }
}
