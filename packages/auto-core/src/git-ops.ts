// The git service's home (the run services' commit-side seam): the session
// close-out afterSession with its proxy-answer marker collection, and the
// two instances of the seam — createGitOps (production delegation to the
// free commit functions of src/git.ts) and noCommitGit (the double that
// reproduces the `commit: false` off-path, which tests install instead of
// the retired option). Split out of src/unit-commit.ts, which keeps the
// recovery-fidelity half (strict resume, model eligibility, rollback
// orchestration) and re-exports afterSession until its callers convert to
// the seam.
//
// The module's defining constraint is what it may not import: opts.ts. The
// services holder (src/services.ts) builds the production instance as its
// default git member, and opts.ts type-imports the holder's members for its
// carrier fields — so a home that imports opts at runtime closes
// opts → interactive → services → home → opts, a cycle in the type-counted
// import graph the direction suite rejects. Everything afterSession needs
// is therefore parameterized structurally (an opts slice naming the three
// fields it reads) instead of through the Opts type.
// AUTO-DECISION: the home is a new git-ops.ts, not unit-commit.ts (the
// natural sibling of these functions, but an opts importer at runtime —
// the cycle above) and not git.ts (a leaf below resolve and phases: the
// marker collection reads the resolve ledger and the current round, and
// both already import git, so git cannot import either back). A factory
// injected into the holder by the composition root was rejected too: the
// process-default holder and the per-test preload build through
// createServices(), so the default instance must be reachable from there.
// This mirrors exit.ts (the control service's home) and router.ts: the
// service's home keeps its factory.
import {
  beginUnit,
  changedFiles,
  commitPending,
  commitTree,
  unitBaseline,
  unitViolations,
  type GitOps,
  type UnitBaseline,
} from "./git"
import { vlog } from "./log"
import { currentRound } from "./phases"
import type { PhaseKey } from "./phases/registry"
import { collectAgentResolves } from "./resolve"

// Unified commit after a session (the AI's commit right withdrawn, see
// src/git.ts): called once every session has ended and the driver finished
// its state writes (ticks and the like), recursively committing all changes
// — git history is the audit trail of AI changes, rollback granularity =
// the session. Skipped under --commit false and dryrun (the H4 guard: the
// marker collection below is hoisted before that early return, so it is
// unaffected by it). opts is the session options whole; structurally this
// reads its commit, dryrun and phase fields only.
export async function afterSession(
  dir: string | undefined,
  opts: { commit?: boolean; dryrun?: boolean; phase?: PhaseKey },
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  baseline?: UnitBaseline,
): Promise<{ type: "ok" } | { type: "failed"; question: string }> {
  if (!dir) return { type: "ok" }
  await collectSessionMarks(dir, opts.phase, task, info.stage)
  if (opts.commit === false || opts.dryrun) return { type: "ok" }
  const result = await commitTree(dir, task, info)
  if (!result.ok) {
    return {
      type: "failed",
      question: `unified commit failed: ${result.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Changes are left in the worktree; please handle git manually and re-run.`,
    }
  }
  if (baseline) {
    const violations = await unitViolations(dir, baseline)
    if (violations.length) return { type: "failed", question: `unit close-out check failed: ${violations.join("; ")}` }
  }
  return { type: "ok" }
}

// Proxy-answer marker collection (auto-resolve H4,
// plans/0020-auto-resolve-design.md §G), hoisted **before** afterSession's
// commit/dryrun early return — collection is auditing and must not depend
// on the commit switch; in the on mode it degrades to a backstop (the
// driver already logged everything on the event side), but markers the
// session wrote voluntarily are still collected. Scans this session's
// uncommitted changed files: AUTO-RESOLVE lands in the ledger,
// AUTO-DECISION only returns a count.
// The H4 collector: counts go only into the verbose log (vlog), never the
// terminal — AUTO-DECISION never competes with AUTO-RESOLVE for layout space
// (§H-④), while "the scan really ran, and how many markers it saw" stays
// traceable evidence. The task's highlight block is constructed on the loop
// side from the ledger. Ledger write failures are fully silent and
// collection itself must not affect flow or exit code either, hence one
// catch swallowing everything.
async function collectSessionMarks(
  dir: string,
  phase: PhaseKey | undefined,
  task: { id: string },
  stage: string,
): Promise<void> {
  const found = await collectAgentResolves(dir, {
    task: task.id,
    phase: phase?.id ?? "",
    round: await currentRound(dir).catch(() => 0),
  }).catch(() => undefined)
  if (!found) return
  if (found.resolves) vlog(`⚑ ${task.id} ${stage}: collected ${found.resolves} AUTO-RESOLVE marker(s)`)
  if (found.decisions) vlog(`ℹ ${task.id} ${stage}: recorded ${found.decisions} AUTO-DECISION entries`)
}

// The production instance: delegation to the free commit functions, and
// nothing else — the seam is a switchable strategy, not moved module state
// (no singleton moved into a closure here), so a per-test fresh holder
// needs no reset hook for it; a test that wants committing off installs
// the double below instead. The delegated functions keep their own gates:
// dryrun (and, until their retirement slice, the commit key) still idle
// beginUnit/commitPending/afterSession on this instance exactly as before
// the seam existed.
export function createGitOps(): GitOps {
  return {
    records: true,
    commitTree,
    beginUnit,
    commitPending,
    afterSession,
    unitBaseline,
    changedFiles,
  }
}

// The no-commit double: every method answers what the `commit: false`
// early returns inside the free functions answer today, so a converted
// call site behaves identically — beginUnit ok with no baseline (the
// close-out check skips without one), commitPending "clean", commitTree
// ok with no failures (a gated site used not to call at all; the ok keeps
// its failure branch and warning log dead), unitBaseline and changedFiles
// empty (nothing to judge for the close-out and the dirty checks), and
// records false (strict resume keeps its record fields unwritten, as it
// did under the switch). afterSession still collects the session's
// proxy-answer markers first (H4: the collection was hoisted before the
// commit gate on purpose), then answers ok.
export function noCommitGit(): GitOps {
  return {
    records: false,
    commitTree: async () => ({ ok: true, failures: [] }),
    beginUnit: async () => ({ type: "ok", baseline: undefined }),
    commitPending: async () => "clean",
    afterSession: async (dir, opts, task, info) => {
      if (!dir) return { type: "ok" }
      await collectSessionMarks(dir, opts.phase, task, info.stage)
      return { type: "ok" }
    },
    unitBaseline: async () => [],
    changedFiles: async () => [],
  }
}
