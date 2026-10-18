// The release gate (plans/0103 D2/D3, ruled from spi-nor-glm's R-01 close):
// the destination repository ships standalone, so the containment rules the
// working rounds only record (document/process-refs.ts `deferred` — task
// ids, paths leading outside the repository's own root) become blocking
// here. The maintainer's ruling: restating citations away is churn a working
// round should not be forced into, so during the migration's rounds the
// findings ride as recorded lines (close-out logs, round-close warnings —
// the running ledger), and the one moment their price is worth paying is
// the person's `release`.
//
// A gate, not a scrubber: removal is content work (restate the decision the
// id pointed at, vendor or rewrite what the path named) that the person's
// agent does; release certifies the result. Two checks per destination
// repository, both read-only:
//   1. a clean tree — an uncommitted state is not a certifiable release;
//   2. the whole-tree scan under the release posture — every process-path
//      reference, task id and out-of-root path blocks, the same shapes the
//      rounds recorded, now with removal wording.
// AUTO-* marker lines are deliberately not demanded away (plans/0103 D3):
// they are self-contained content, and stripping them would erase recorded
// rationale — editorial work the person may do by choice, never a gate.
// No state is written; routing stays a pure function of the tree.
import { nestedRepoPrefixes, repoRoots, statusEntries, unitAddedLines, git } from "./git"
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
export async function releaseCheck(dir: string, opts: { scanExempt?: readonly string[] } = {}): Promise<ReleaseCheck> {
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
    // 2. The whole-tree scan of this repository alone (an empty baseline
    // makes every tracked line "added"), filtered to its own paths — the
    // workspace's files are not the destination's business — and run under
    // the release posture.
    const added = new Map([...await unitAddedLines(dir, [{ root, sha: "" }])].filter(([rel]) => rel === prefix || rel.startsWith(`${prefix}/`)))
    const scan = processReferenceScan(added, opts.scanExempt, { nested: [prefix], dir, release: true })
    problems.push(...scan.problems)
    if (!scan.problems.length) certified.push(`✓ ${prefix} @ ${head.out.trim()} — no process references, no task ids, no paths outside its own root`)
  }
  return { problems, certified, nothing: undefined }
}
