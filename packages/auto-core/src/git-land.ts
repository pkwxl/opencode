// The branch-isolation and landing family (plans/0074 §2.2/§2.3; split out
// of git.ts by plans/0102 E-α2, the complexity-1 move): round-establishment
// isolation onto the round branches and the `land` command's git half —
// read-only inspection primitives plus the two landing operations, all
// operating on one repository root the caller names, knowing nothing of
// rounds or task ids (the orchestration, refusal lines and exit semantics
// live in src/land.ts). A leaf beside git.ts (spawn helper, first-line
// errors, commit identity, the merge-conflict vocabulary it shares with
// src/git-worktree.ts — see that module's header for why the shared types
// stay at the common root), reaching into git-worktree.ts for currentBranch,
// which the isolation's idempotent skip consults.
import { join } from "node:path"
import {
  abortToLandResult,
  changedFiles,
  firstLine,
  git,
  identityArgs,
  isConflict,
  statusEntries,
  type LandResult,
  type WorktreeResult,
} from "./git"
import { currentBranch } from "./git-worktree"

// —— Branch isolation (plans/0074 §2.2, U-L1) ——
//
// Round-establishment isolation: each repository the config's isolate key
// designates gets the round branch (auto/R-NN, the caller's protocol string)
// created from its current HEAD and checked out, so every later per-session
// unified commit, rollback, SHA baseline and foreign-commit check lands on
// that branch unchanged — commitTree, rollbackUnit and the baseline functions
// above are untouched by design; only which branch is checked out differs,
// which is why repoRoots walking, the init gitignore's nested-repo entries
// and the Auto-Nested lines keep working. The original branch never moves.

// One isolation attempt's outcome: ok lists the repositories now on the round
// branch (repository-relative paths); dirty names the designated repositories
// that are not clean — a precondition of the same class as the run-start
// clean gate, so the caller blocks for human attention listing each repo's
// uncommitted paths (relative to the target directory); failed carries one
// repository's git error (branch creation or checkout), with nothing written
// by this function on that path beyond the branches already switched (a
// branch at HEAD changes no file content, so the scene stays recoverable —
// the re-run's idempotent skips finish the rest).
type IsolationResult =
  | { type: "ok"; isolated: string[] }
  | { type: "dirty"; repos: { rel: string; files: string[] }[] }
  | { type: "failed"; error: string }

// Isolate every designated repository onto the round branch. Idempotent: a
// repository already on the branch (an interrupted establishment re-run) is
// counted as isolated without touching git; a branch left by an earlier
// attempt of the same round is checked out as it is (its commits are this
// round's recoverable state, plans/0074 §4). Dirty repositories are all
// reported in one refusal; branch operations start only when every designated
// repository is clean.
export async function isolateRound(dir: string, isolate: readonly string[], branch: string): Promise<IsolationResult> {
  const dirty: { rel: string; files: string[] }[] = []
  const clean: string[] = []
  for (const rel of isolate) {
    // The designated path is a repository root (the config validated a .git
    // entry), so its own status — the same porcelain pass changedFiles runs
    // per repoRoot — covers it whole; paths relative to the target directory.
    const files = (await statusEntries(dir, join(dir, rel))).map((entry) => entry.rel)
    if (files.length) dirty.push({ rel, files })
    else clean.push(rel)
  }
  if (dirty.length) return { type: "dirty", repos: dirty }
  const isolated: string[] = []
  for (const rel of clean) {
    const root = join(dir, rel)
    try {
      if ((await currentBranch(root)) === branch) {
        isolated.push(rel)
        continue
      }
      const exists = await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])
      if (exists.code !== 0) {
        const created = await git(root, ["branch", branch])
        if (created.code !== 0) {
          return { type: "failed", error: `${rel}: ${firstLine(created.err || created.out) || `git branch exit code ${created.code}`}` }
        }
      }
      const checkedOut = await git(root, ["checkout", branch])
      if (checkedOut.code !== 0) {
        return { type: "failed", error: `${rel}: ${firstLine(checkedOut.err || checkedOut.out) || `git checkout exit code ${checkedOut.code}`}` }
      }
      isolated.push(rel)
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      return { type: "failed", error: `${rel}: ${firstLine(text)}` }
    }
  }
  return { type: "ok", isolated }
}

// —— Branch-isolation landing (plans/0074 §2.3, U-L2) ——
//
// The `land` command's git half (the orchestration, refusal lines and exit
// semantics live in src/land.ts): read-only inspection primitives plus the
// two landing operations. All of them operate on one repository root the
// caller names — like isolateRound above, they know nothing of rounds or
// task ids. The landing commit deliberately carries no Auto-Stage trailer:
// it is the deliverable's own history entry (the person's to curate —
// plans/0074 §2's audit-trail trade-off), not a driver session commit, and
// no unit close-out ever scans the original branch's new range (the round's
// checks ran on the isolation branch).

// The repository's local branch names (refs/heads, short form). The caller
// filters the families: the round branches (auto/R-*), the lane branches
// (auto-lane/*, which live inside whichever branch is checked out,
// plans/0074 §2.4) and the fork branches (auto-fork/*, plans/0128) are never
// a repository's original branch.
export async function localBranches(root: string): Promise<string[]> {
  const listed = await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads"])
  return listed.out.split("\n").map((line) => line.trim()).filter(Boolean)
}

// The full SHA of one revision (a branch name, HEAD, `<rev>^{tree}` …),
// undefined when it does not resolve.
export async function revSha(root: string, ref: string): Promise<string | undefined> {
  const got = await git(root, ["rev-parse", "--verify", "--quiet", ref]).catch(() => undefined)
  const sha = got?.code === 0 ? got.out.trim() : ""
  return sha || undefined
}

// The full SHA of the merge base of two revisions, undefined when either side
// does not resolve. The landing's isolation point: round-establishment
// created auto/R-NN from the original branch's then-tip, so the merge base is
// exactly where the fork happened — the anchor both refusal checks of `land`
// (the moved original, the foreign-commit range) measure from.
export async function mergeBaseFull(root: string, a: string, b: string): Promise<string | undefined> {
  const base = await git(root, ["merge-base", a, b]).catch(() => undefined)
  const sha = base?.code === 0 ? base.out.trim() : ""
  return sha || undefined
}

// The commits of `<base>..<branch>`, newest first, each with its full commit
// and tree SHA: the round branch's history since the isolation point. The
// landing walks it to recognize a previous landing (a mid-round `--keep` land
// left the original branch at a squash commit whose tree equals one of these
// trees) and to count the commits one landing folds.
export async function branchCommits(root: string, branch: string, base: string): Promise<{ sha: string; tree: string }[]> {
  const log = await git(root, ["log", "--format=%H %T", `${base}..${branch}`]).catch(() => undefined)
  if (!log || log.code !== 0) return []
  return log.out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [sha = "", tree = ""] = line.split(" ")
      return { sha, tree }
    })
}

// Whether branch is fully contained in the repository's current HEAD
// (merge-base --is-ancestor): a leftover round branch that holds no commit
// HEAD lacks is merged — preflight's leftover report (plans/0074 §4) reports
// only the unmerged ones, the true recoverable state.
export async function mergedIntoHead(root: string, branch: string): Promise<boolean> {
  const check = await git(root, ["merge-base", "--is-ancestor", branch, "HEAD"]).catch(() => undefined)
  return check?.code === 0
}

// Check out a branch in the repository (the landing's move onto the original
// branch, and --keep's move back onto the round branch). Same shape as the
// worktree operations: ok, or git's first error line.
export async function checkoutBranch(root: string, branch: string): Promise<WorktreeResult> {
  const checkedOut = await git(root, ["checkout", branch])
  if (checkedOut.code === 0) return { ok: true }
  return { ok: false, error: firstLine(checkedOut.err || checkedOut.out) || `git checkout exit code ${checkedOut.code}` }
}

// The default landing (plans/0074 §5.3): `git merge --squash <branch>` —
// never a commit of its own — followed by one commit under subject, so the
// round's net change reaches the original branch as exactly one commit. The
// guards in src/land.ts (the original branch at the isolation point or a
// previous landing's tree) make the squash conflict-free by construction; a
// conflict that still happens is aborted (the tree was clean before the
// merge — the guards' precondition — so a hard reset to HEAD restores
// exactly the pre-merge state; a conflicted squash carries no MERGE_HEAD,
// which `git merge --abort` requires) and reported for manual landing.
export async function squashOnto(root: string, branch: string, subject: string): Promise<LandResult> {
  const squashed = await git(root, ["merge", "--squash", branch])
  if (squashed.code !== 0) return squashFailure(root, squashed, "git merge --squash")
  const committed = await git(root, [...(await identityArgs(root)), "commit", "-m", subject])
  if (committed.code === 0) return { type: "ok" }
  // The squash is staged but would not conclude: undo it to the clean
  // pre-merge state so the caller's scene stays describable.
  await git(root, ["reset", "--hard", "HEAD"])
  return { type: "failed", error: `${firstLine(committed.err || committed.out) || `git commit exit code ${committed.code}`} (the staged squash was reset away; the worktree is back to its pre-merge state)` }
}

// The explicit alternative landing (plans/0074 §5.3): `git merge --no-ff` —
// the round's commits enter the original branch's history as themselves,
// under one merge commit. Conflict handling mirrors landBranch: abort the
// merge (a real merge carries MERGE_HEAD) and report.
export async function mergeNoFf(root: string, branch: string, subject: string): Promise<LandResult> {
  const merged = await git(root, [...(await identityArgs(root)), "merge", "--no-ff", "-m", subject, branch])
  if (merged.code === 0) return { type: "ok" }
  if (isConflict(merged.out, merged.err)) return abortToLandResult(root, merged, "the repository")
  return { type: "failed", error: firstLine(merged.err || merged.out) || `git merge exit code ${merged.code}` }
}

// A failed squash's common tail: a conflict aborts back to the clean
// pre-merge state (see squashOnto), anything else is the raw failure.
async function squashFailure(root: string, failed: { code: number; out: string; err: string }, what: string): Promise<LandResult> {
  if (isConflict(failed.out, failed.err)) {
    const reset = await git(root, ["reset", "--hard", "HEAD"])
    if (reset.code === 0 && !(await changedFiles(root)).length) return { type: "conflict", detail: firstLine(failed.err || failed.out) }
    return { type: "failed", error: `resetting the conflicted squash failed (git reset --hard exit code ${reset.code}: ${firstLine(reset.err || reset.out)}); the repository must be handled manually` }
  }
  return { type: "failed", error: `${firstLine(failed.err || failed.out) || `${what} exit code ${failed.code}`}` }
}
