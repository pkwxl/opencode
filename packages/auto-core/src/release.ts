// The release gate (plans/0103 D2/D3, ruled from spi-nor-glm's R-01 close):
// the destination repository ships standalone, so the containment rules the
// working rounds only record (document/process-refs.ts `deferredCount` —
// process-document references, task ids, paths leading outside the
// repository's own root, the full set since 0103's second addendum) become
// blocking here. The maintainer's ruling: restating citations away is churn
// a working round should not be forced into, so during the migration's
// rounds the findings ride as the recorded count (the close-out log, the
// round-close warning — the running ledger), and the one moment their price
// is worth paying is the person's `release`.
//
// A gate, not a scrubber: removal is content work (restate the decision the
// id pointed at, vendor or rewrite what the path named) that the person's
// agent does; release certifies the result. Two checks per destination
// repository, both read-only:
//   1. a clean tree — an uncommitted state is not a certifiable release;
//   2. the destination scan under the release posture — the same
//      driver-written set the rounds record (the driver boundary, plans/0173
//      D1 over 0119's modified view: everything from the oldest boundary
//      commit's parent — driver commit or landing subject — to the worktree,
//      whoever committed it in between, plus the uncommitted state, which
//      check 1 already demands be empty), so every process-path
//      reference, task id and out-of-root path the migration wrote blocks,
//      the same shapes the rounds recorded, now with removal wording.
// AUTO-* marker lines are deliberately not demanded away (plans/0103 D3):
// they are self-contained content, and stripping them would erase recorded
// rationale — editorial work the person may do by choice, never a gate.
// No state is written; routing stays a pure function of the tree.
import { nestedRepoPrefixes, repoRoots, statusEntries, unitAddedLines, driverBoundary, git } from "./git"
import { currentRound } from "./phases"
import { roundDirName } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"

export type ReleaseCheck = {
  // Blocking: release refuses (the shell's exit 2) while any is listed.
  problems: string[]
  // One ✓ line per destination repository that passed, naming its HEAD —
  // the certified state.
  certified: string[]
  // Set when the target holds no nested repository: nothing to release.
  nothing: string | undefined
}

// scanExempt = config scanExempt (plans/0059 X2): deliverable paths whose
// process-shaped strings are content, skipped here like at every scan site.
// isolate = config isolate (plans/0074): the nested repositories under
// branch isolation — a destination of that set whose committed history
// reaches no boundary commit is the unlanded-round shape (the writing sits
// on the auto/R-NN branch), and release refuses naming it instead of
// certifying over an empty range (plans/0173 D1, 0165-004).
export async function releaseCheck(dir: string, opts: { scanExempt?: readonly string[]; isolate?: readonly string[] } = {}): Promise<ReleaseCheck> {
  const problems: string[] = []
  const certified: string[] = []
  const roots = (await repoRoots(dir)).filter((root) => root !== dir)
  if (!roots.length) {
    return { problems, certified, nothing: `nothing to release: ${dir} holds no nested repository — release certifies a destination repository standing alone` }
  }
  for (const root of roots) {
    const prefix = nestedRepoPrefixes(dir, [root])[0]!
    // 1. A clean tree: any entry (staged, unstaged or untracked) means the
    // repository is mid-flight, not releasable.
    const dirty = await statusEntries(dir, root)
    if (dirty.length) {
      problems.push(`${prefix} holds ${dirty.length} uncommitted path(s) (e.g. ${dirty[0]!.rel}): commit or clean them, then re-run release`)
      continue
    }
    const head = await git(root, ["rev-parse", "--short", "HEAD"])
    if (head.code !== 0 || !head.out.trim()) {
      problems.push(`${prefix} has no commits to release (an empty repository cannot stand alone)`)
      continue
    }
    // The unlanded-round refusal (plans/0173 D1): a repository under branch
    // isolation whose history reaches no boundary commit carries the round's
    // writing on its round branch instead — name it, never certify the
    // empty range.
    const boundary = await driverBoundary(root)
    const isolated = (opts.isolate ?? []).some((entry) => prefix === entry || prefix.startsWith(`${entry}/`))
    if (boundary.kind === "none" && isolated) {
      const round = await currentRound(dir)
      problems.push(`${prefix} reaches no driver or landing commit from HEAD — its round branch auto/${roundDirName(round)} holds the round's writing unlanded; land it (or merge it by hand), then re-run release`)
      continue
    }
    // 2. The destination scan of this repository alone — the driver
    // boundary (plans/0173 D1 over 0119's modified view): everything from
    // the oldest boundary commit's parent to the worktree, whoever
    // committed it — the person's release-remedy fix commits above the run
    // are deliverable content like the run's own — filtered to its own
    // paths, the workspace's files never the destination's business, and
    // run under the release posture.
    const added = new Map([...await unitAddedLines(dir, [{ root, sha: boundary.baseline }])].filter(([rel]) => rel === prefix || rel.startsWith(`${prefix}/`)))
    const scan = processReferenceScan(added, opts.scanExempt, { nested: [prefix], dir, release: true })
    problems.push(...scan.problems)
    if (!scan.problems.length) {
      // The ✓ states what was scanned (plans/0173 D1): the boundary kind,
      // the baseline it diffed from and the changed-file count — the
      // certified state is checkable, not asserted.
      const range = boundary.kind === "none" ? `HEAD (no driver or landing commit in history)` : `${boundary.baseline ? `baseline ${boundary.baseline.slice(0, 7)}` : "the empty tree"} (${boundary.kind} boundary)`
      certified.push(`✓ ${prefix} @ ${head.out.trim()} — no process references, no task ids, no paths outside its own root (scanned ${added.size} changed file(s) since ${range})`)
    }
  }
  return { problems, certified, nothing: undefined }
}
