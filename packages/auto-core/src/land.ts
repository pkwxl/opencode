// The land command's core (plans/0074 §2.3, U-L2, ruled 2026-10-04 §5): the
// person-invoked return path of branch isolation — each repository the
// config's isolate key designated gets its round of work (the commits the
// driver posted on the round branch auto/R-NN since establishment) landed
// back onto its original branch as one commit, the round branch deleted
// (--keep retains it for a mid-round landing; --abandon discards it as the
// undo path, nothing landing). Landing mid-round is allowed: the branch
// simply continues — under --keep whatever was checked out before the
// landing is checked back out, normally the round branch itself.
//
// The audit-trail trade-off is stated, not hidden (plans/0074 §2): during
// the round the per-unit record lives in the working repository + the
// isolated branch; after land the deliverable's history holds one commit,
// and the full per-unit trail remains in the driven root's git — the 0064
// record model (the driven root is the process layer of record; the
// deliverable repository is the person's to curate).
//
// Exit-code contract: 0 landed / 1 usage / 2 blocked for human. A refusal is
// never an automated merge resolution (plans/0074 §4): an original branch
// that moved, foreign commits mixed into the round branch's range, a dirty
// repository or an ambiguous original branch all block naming what the
// person must settle — landing on a diverged original branch is a conflict
// surface by design.
//
// AUTO-DECISION (stateless derivation of the original branch): nothing is
// recorded at establishment — land derives it: among the repository's local
// branches, the round family (auto/R-*) and the lane family (auto-lane/*,
// plans/0074 §2.4 — lane branches live inside whichever branch is checked
// out) are never the original, and exactly one remaining branch identifies
// it; several candidates or none block naming them, never a guess. This
// keeps U-L1's shipped surface (isolateRound, the establish route) untouched
// and needs no state file an interrupted run could leave stale. The
// isolation point is the merge base of the two branches; "the original
// branch moved" means its tip left that point — except onto exactly a
// previous landing's tree (a mid-round --keep land leaves the original at a
// squash commit whose tree equals the round branch's tip at that moment,
// recognized by tree equality among the round branch's commits), which is
// where a re-landing continues from.
// AUTO-DECISION (all-or-nothing refusals): every refusal condition is
// checked for every designated repository before any repository's git state
// is touched, so a mixed set (one landable, one refusing) lands nothing —
// the person settles the named problems and re-runs. A git failure that
// strikes mid-landing (after some repositories landed) blocks with what
// already landed named as done: the command is re-runnable (a landed
// repository no longer holds the round branch and is skipped), so the re-run
// finishes the rest.
import { join } from "node:path"
import { roundDirName } from "./docpaths"
import { CONFIG_FILE } from "./config"
import {
  branchCommits,
  checkoutBranch,
  currentBranch,
  deleteBranch,
  foreignCommits,
  localBranches,
  mergeBaseFull,
  mergeNoFf,
  mergedIntoHead,
  revSha,
  squashOnto,
  statusEntries,
} from "./git"
import { currentRound, legacyLayoutProblem } from "./phases"
import { shellProfile } from "./shell"

export type LandOptions = {
  // config `isolate`: the designated repositories, by repository-relative
  // path (empty = the project runs no branch isolation; usage).
  isolate: readonly string[]
  // --keep: retain the round branch — the mid-round landing; the branch
  // simply continues (what was checked out before the landing is checked
  // back out).
  keep?: boolean
  // --abandon: discard the round branch after a person-reviewed reset — the
  // undo path. Nothing lands; the branch's tip is printed so the work stays
  // recoverable (git reflog) if the review was wrong.
  abandon?: boolean
  // --merge: the explicit alternative landing mode — a true merge commit
  // (git merge --no-ff) instead of the default squash-one-commit.
  merge?: boolean
}

export type LandOutcome = { type: "landed" | "usage" | "blocked"; lines: string[] }

// One designated repository that passed every check: its original branch,
// the isolation point (merge base), the commit whose tree the original
// matches when it sits at a previous landing (mid-round re-landing), and the
// number of commits one landing folds.
type LandingRepo = { rel: string; root: string; original: string; base: string; landedAt?: string; count: number }

export async function landUnit(dir: string, opts: LandOptions): Promise<LandOutcome> {
  const { bin } = shellProfile()
  const usage = (lines: string[]): LandOutcome => ({ type: "usage", lines })
  const blocked = (lines: string[]): LandOutcome => ({ type: "blocked", lines })
  if (!opts.isolate.length) {
    return usage([
      `nothing to land: the config designates no branch-isolated repositories (the isolate key of ${CONFIG_FILE} is empty); ` +
        `land is the return path of branch isolation — designate the repositories with ${bin} init ${dir} --isolate <rel-path> first`,
    ])
  }
  if (opts.keep && opts.abandon) {
    return usage(["--keep and --abandon are mutually exclusive: --keep retains auto/R-NN for a mid-round landing, --abandon discards it as the undo path"])
  }
  if (opts.merge && opts.abandon) {
    return usage(["--merge is a landing mode and --abandon lands nothing: drop one of the two"])
  }
  const legacy = await legacyLayoutProblem(dir)
  if (legacy) return usage([legacy])
  const round = roundDirName(await currentRound(dir))
  const branch = `auto/${round}`

  // —— Pass 1: every refusal, before any repository's git state is touched ——
  // A dirty repository blocks like the establishment gate does (uncommitted
  // changes would ride into the landing or block the checkout).
  const dirty: { rel: string; files: string[] }[] = []
  for (const rel of opts.isolate) {
    const files = (await statusEntries(dir, join(dir, rel))).map((entry) => entry.rel)
    if (files.length) dirty.push({ rel, files })
  }
  if (dirty.length) {
    return blocked([
      `⏸ landing requires clean repositories (uncommitted changes would ride into the landing); handle them manually (commit/clean) and re-run:`,
      ...dirty.flatMap(({ rel, files }) => [`  ${rel}:`, ...files.map((file) => `    ${file}`)]),
    ])
  }
  const problems: string[] = []
  const pending: LandingRepo[] = []
  let anyBranch = false
  for (const rel of opts.isolate) {
    const root = join(dir, rel)
    if (!(await revSha(root, `refs/heads/${branch}`))) continue // nothing to land in this repository
    anyBranch = true
    // The original branch: the one local branch that is neither of the
    // driver's families (auto/R-* round branches, auto-lane/* lane
    // branches). Exactly one identifies it; anything else blocks.
    const candidates = (await localBranches(root)).filter((name) => !name.startsWith("auto/") && !name.startsWith("auto-lane/"))
    if (candidates.length !== 1) {
      problems.push(
        `${rel}: ${candidates.length > 1 ? `cannot tell which of ${candidates.join(", ")} is the original branch` : `no candidate original branch remains beside ${branch}`}; ` +
          `landing needs exactly one — settle the branches manually or land by hand`,
      )
      continue
    }
    const original = candidates[0]!
    const base = (await mergeBaseFull(root, original, branch))!
    if (opts.abandon) {
      pending.push({ rel, root, original, base, count: 0 })
      continue
    }
    // Refusal 1 — the original branch moved. Its tip must be the isolation
    // point, or exactly a previous landing's tree (a mid-round --keep land):
    // landing anywhere else is a conflict surface, never auto-merged.
    const tip = (await revSha(root, original))!
    let landedAt: string | undefined
    if (tip !== base) {
      const tree = (await revSha(root, `${original}^{tree}`))!
      landedAt = (await branchCommits(root, branch, base)).find((commit) => commit.tree === tree)?.sha
      if (!landedAt) {
        problems.push(
          `${rel}: the original branch ${original} moved since ${branch} was isolated (its tip left the isolation point ${base.slice(0, 7)} and matches no landing of the round branch); ` +
            `landing on a moved branch is a conflict surface by design — merge by hand, or reset ${original} to the isolation point and re-run`,
        )
        continue
      }
    }
    // Refusal 2 — foreign commits mixed into the round branch's range
    // (commits without the Auto-Stage trailer): never landed automatically.
    const foreign = await foreignCommits(root, base, branch)
    if (foreign > 0) {
      problems.push(`${rel}: ${foreign} non-driver commit(s) on ${branch} since the isolation point (no Auto-Stage trailer); foreign commits are never landed automatically — land by hand`)
      continue
    }
    pending.push({ rel, root, original, base, ...(landedAt ? { landedAt } : {}), count: (await branchCommits(root, branch, landedAt ?? base)).length })
  }
  if (problems.length) {
    return blocked([`⏸ round ${round} cannot land yet:`, ...problems.map((problem) => `  ${problem}`), `next: settle the above by hand, then re-run: ${bin} land ${dir}`])
  }
  if (!anyBranch) {
    return { type: "landed", lines: [`ℹ nothing to land: no designated repository holds ${branch} (already landed, or this round never isolated one)`] }
  }

  // —— Pass 2: the landings (each repository independent; see the header's
  // re-runnability note for a failure that strikes mid-way) ——
  const lines: string[] = []
  for (const repo of pending) {
    const { rel, root, original } = repo
    // --abandon: check out the original branch and discard the round branch.
    // The flag is the person's confirmation of the review; the tip is
    // printed so the work stays recoverable (plans/0074 §4).
    if (opts.abandon) {
      const tip = (await revSha(root, branch))!.slice(0, 7)
      const back = await checkoutBranch(root, original)
      if (!back.ok) return blocked([...lines, `⏸ ${rel}: checking out ${original} failed: ${back.error}; settle the repository and re-run`])
      const deleted = await deleteBranch(root, branch)
      if (!deleted.ok) {
        return blocked([...lines, `⏸ ${rel}: deleting ${branch} failed: ${deleted.error}; the repository is on ${original} — fix git and re-run (the branch is still there)`])
      }
      lines.push(`✓ ${rel}: abandoned ${branch} (was ${tip}, recoverable via git reflog until collection); back on ${original}, nothing landed`)
      continue
    }
    // Nothing to land: the round branch's current tree is already the
    // original branch's (an empty round, or a --keep landing followed by no
    // further work) — the branch is dropped (retained under --keep), no
    // commit made. The round branch is what the isolation checked out, so it
    // is what the worktree sits on: move onto the original before the
    // deletion (git refuses to delete the branch a worktree has checked out);
    // under --keep nothing is deleted, so the worktree stays as it is.
    if ((await revSha(root, `${branch}^{tree}`)) === (await revSha(root, `${original}^{tree}`))) {
      if (opts.keep) {
        lines.push(`✓ ${rel}: nothing to land — ${branch} holds no change beyond ${original}; branch retained`)
        continue
      }
      const on = await checkoutBranch(root, original)
      if (!on.ok) return blocked([...lines, `⏸ ${rel}: checking out ${original} failed: ${on.error}; settle the repository and re-run`])
      const deleted = await deleteBranch(root, branch)
      if (!deleted.ok) return blocked([...lines, `⏸ ${rel}: deleting the changeless ${branch} failed: ${deleted.error} — delete it by hand`])
      lines.push(`✓ ${rel}: nothing to land — ${branch} holds no change beyond ${original}; branch deleted`)
      continue
    }
    const was = await currentBranch(root)
    const on = await checkoutBranch(root, original)
    if (!on.ok) return blocked([...lines, `⏸ ${rel}: checking out ${original} failed: ${on.error}; settle the repository and re-run`])
    const subject = `land ${branch}: ${repo.count} commit(s) of round ${round}`
    const landed = opts.merge ? await mergeNoFf(root, branch, subject) : await squashOnto(root, branch, subject)
    if (landed.type !== "ok") {
      return blocked([
        ...lines,
        `⏸ ${rel}: landing ${branch} onto ${original} failed: ${landed.type === "conflict" ? landed.detail : landed.error}; ` +
          `${branch} is intact — resolve the repository by hand, or re-run once the cause is fixed`,
      ])
    }
    const sha = (await revSha(root, "HEAD"))!.slice(0, 7)
    const shape = `${repo.count} commit(s) of ${branch} as one${opts.merge ? " (merge commit)" : ""}`
    if (opts.keep) {
      if (was && was !== original) await checkoutBranch(root, was)
      lines.push(
        `✓ ${rel}: landed ${sha} on ${original} (${shape}); ${branch} retained${was === branch ? " and checked out — the round simply continues on it" : ""}`,
      )
      continue
    }
    const deleted = await deleteBranch(root, branch)
    if (!deleted.ok) {
      return blocked([...lines, `✓ ${rel}: landed ${sha} on ${original} (${shape}), but deleting ${branch} failed: ${deleted.error} — delete it by hand`])
    }
    lines.push(`✓ ${rel}: landed ${sha} on ${original} (${shape}); ${branch} deleted`)
  }
  if (opts.abandon) {
    lines.push(`next: the isolation branches are gone and the original branches hold what they held before the round; the driven root's git keeps the round's record`)
  } else {
    lines.push(
      `the deliverable's history now holds the landing commit(s) while the full per-unit trail stays in ${dir}'s git — the driven root is the process layer of record (plans/0064's model)`,
    )
  }
  return { type: "landed", lines }
}

// The leftover branches of an abandoned isolation (plans/0074 §4), as
// preflight's warning lines: round branches (auto/R-*) other than the live
// one that still hold commits the repository's current HEAD does not —
// recoverable state, not corruption; `land --abandon` (the current round's
// branch) and plain git both address the rest. Read-only.
export async function leftoverIsolationLines(dir: string, isolate: readonly string[], liveBranch: string): Promise<string[]> {
  const lines: string[] = []
  for (const rel of isolate) {
    const root = join(dir, rel)
    const leftover: string[] = []
    for (const name of await localBranches(root)) {
      if (!/^auto\/R-\d+$/.test(name) || name === liveBranch) continue
      if (!(await mergedIntoHead(root, name))) leftover.push(name)
    }
    if (leftover.length) {
      lines.push(
        `⚠ ${rel}: ${leftover.join(", ")} ${leftover.length === 1 ? "holds" : "hold"} unlanded work from an earlier round — recoverable state, not corruption: ` +
          `land by hand (git checkout <original> && git merge --squash ${leftover[0]}), or remove the branch (git branch -D ${leftover[0]})`,
      )
    }
  }
  return lines
}
