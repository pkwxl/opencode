// The git service's home (the run services' commit-side seam): the session
// close-out afterSession with its proxy-answer marker collection, and the
// seam's shapes — createGitOps (production delegation to the free commit
// functions of src/git.ts), noCommitGit (the double that reproduces the
// `commit: false` off-path, which tests install instead of the retired
// option) and createDocLaneGit (the doc-lane decorator of plans/0099 D4–D6,
// wrapping any base with one serialized, path-scoped commit queue driven by
// the loop's registry). Split out of src/unit-commit.ts, which keeps the
// recovery-fidelity half (strict resume, model eligibility, rollback
// orchestration).
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
  addWorktree,
  beginUnit,
  changedFiles,
  commitPending,
  commitTree,
  driverStateFile,
  landBranch,
  pruneWorktrees,
  removeWorktree,
  unitBaseline,
  unitViolations,
  withinScopes,
  type CommitResult,
  type GitOps,
  type UnitBaseline,
  type UnitGate,
} from "./git"
import { clampRecordedResolves } from "./charter-clamp"
import { log, vlog } from "./log"
import { currentRound } from "./phases"
import type { PhaseKey } from "./phases/registry"
import { collectAgentResolves } from "./resolve"

// Unified commit after a session (the AI's commit right withdrawn, see
// src/git.ts): called once every session has ended and the driver finished
// its state writes (ticks and the like), recursively committing all changes
// — git history is the audit trail of AI changes, rollback granularity =
// the session. Skipped under dryrun (the H4 guard: the marker collection
// below is hoisted before that early return, so it is unaffected by it);
// the no-commit double overrides the method whole, and its body keeps the
// collection for the same reason. opts is the session options whole;
// structurally this reads its dryrun and phase fields only.
export async function afterSession(
  dir: string | undefined,
  opts: { dryrun?: boolean; phase?: PhaseKey },
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  baseline?: UnitBaseline,
): Promise<{ type: "ok" } | { type: "failed"; question: string }> {
  if (!dir) return { type: "ok" }
  await collectSessionMarks(dir, opts.phase, task, info.stage)
  if (opts.dryrun) return { type: "ok" }
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
  // The record-time charter check (plans/0082 §10 D12): every freshly
  // collected default gets one cheap one-shot check against the charter,
  // here at the scan that collected it — the flagged ones are clamped and
  // surface one line each. Auditing discipline: never affects flow or exit
  // code (the clamp swallows its own errors).
  for (const line of await clampRecordedResolves(dir)) log(line)
}

// The production instance: delegation to the free commit functions, and
// nothing else — the seam is a switchable strategy, not moved module state
// (no singleton moved into a closure here), so a per-test fresh holder
// needs no reset hook for it; a test that wants committing off installs
// the double below instead. The delegated functions keep their own gates:
// dryrun still idles beginUnit/commitPending/afterSession on this
// instance exactly as before the seam existed.
export function createGitOps(): GitOps {
  return {
    records: true,
    commitTree,
    beginUnit,
    commitPending,
    afterSession,
    unitBaseline,
    changedFiles,
    addWorktree,
    removeWorktree,
    pruneWorktrees,
    landBranch,
  }
}

// The one resolution point of the opts-carried git seam (D8, plans/0069
// §2.2): the member the loop filled for a run, else the holderless
// production fallback — a minimal test literal resolves onto committing-on,
// exactly what such a literal did before the seam existed. Every entry
// point below the loop (execute, exec-session, artifact, unit-commit,
// wrapup, knowledge) reads the seam through this helper instead of
// re-spelling the fallback; the services holder builds its own default
// member directly (createServices' `over.git ?? createGitOps()`), the
// composition root's sanctioned resolution. Structural slice: the home
// stays opts-free (see the header).
export function gitOf(opts: { git?: GitOps }): GitOps {
  return opts.git ?? createGitOps()
}

// The no-commit double: every method answers what the `commit: false`
// early returns inside the free functions answered before their removal,
// so a converted call site behaves identically — beginUnit ok with no
// baseline (the close-out check skips without one), commitPending "clean",
// commitTree ok with no failures (a gated site used not to call at all;
// the ok keeps its failure branch and warning log dead), unitBaseline and
// changedFiles empty (nothing to judge for the close-out and the dirty
// checks), and records false (strict resume keeps its record fields
// unwritten, as it did under the switch). afterSession still collects the
// session's proxy-answer markers first (H4: the collection was hoisted
// before the commit gate on purpose), then answers ok.
// The lane-worktree members fail closed: the double is the committing-off
// strategy, and a lane that cannot create its worktree or land its branch
// must surface that (a silent ok would strand a park directory nothing
// owns); removeWorktree/prune still answer ok — they only clean up.
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
    addWorktree: async () => ({ ok: false, error: "the no-commit git double does not manage lane worktrees" }),
    removeWorktree: async () => ({ ok: true }),
    pruneWorktrees: async () => ({ ok: true }),
    landBranch: async () => ({ type: "failed", error: "the no-commit git double does not merge lane branches" }),
  }
}

// —— Doc lanes (plans/0099 D4–D6): the seam's decorator —— //

// The registry the doc loop owns and the decorator reads (D4): the live doc
// lanes' effective scopes (keyed by unit id — the loop updates the map at
// dispatch, landing and recovery, and empties it when the lanes drain), and
// the quarantine set (D6: the stray-write paths a blocked landing recorded —
// tolerated by every later guard so sibling lanes land around them; the
// human still owns the dirt, and the quarantine dies with the run: the next
// run's clean gate sees it and blocks).
export type DocLaneRegistry = {
  live: Map<string, string[]>
  quarantine: Set<string>
}

export function createDocLaneRegistry(): DocLaneRegistry {
  return { live: new Map(), quarantine: new Set() }
}

// The GitOps decorator of doc-lane mode (D4–D6), installed by the doc loop
// at entry for its duration — wrapping ctx.git — while the run's activation
// holds (docScheduler). An empty registry makes every method a pass-through
// (the post-drain phase machinery and the serial degrade run safely with it
// in place), so the decorator's deltas are exactly the three the registry
// drives:
//   - D4, committed sequentially and path-scoped: every commit-shaped call
//     funnels through one awaited queue (commit-at-a-time — the parent is
//     the sole writer of git state, and the serialized commits keep the
//     index and the object store single-writer in practice). A live doc
//     unit's commit adds its effective scope plus the dirty driver-exclusive
//     state files — the index tick of its close-out rides the unit's own
//     commit exactly as the serial world's done commit does (dm-glm's
//     measured shape: `docs/T-NNN/done.md` plus the phase `tasks.md` tick);
//     every other call adds everything except the live scopes (with no
//     lanes in flight that is `.` — today's sweep, byte-identical).
//   - D5, the start gate relaxes by exactly the live scopes: beginUnit
//     tolerates dirt inside the *other* live doc units' effective scopes
//     (the in-flight set's own writes), everything else keeps today's
//     semantics — driver-state-only dirt self-heals through the carryover
//     commit (itself queued and exclude-scoped), anything else blocks for
//     the human.
//   - D6, the landing guard: before a live doc unit's commit lands, every
//     changed path must lie inside the unit's own effective scope ∪ the
//     live siblings' scopes ∪ the quarantine ∪ driver-exclusive state (the
//     tick is a driver write, never a session's — tolerating it does not
//     weaken the "a session wrote past its declaration" check those paths
//     exist to make loud). Anything else is recorded in the quarantine and
//     the commit fails naming the files — the caller's block stops
//     dispatching, the in-flight lanes drain, the run exits 2 (a wrong
//     `Touches` declaration surfaces as a failing unified commit, never as
//     silently unlanded work — the tier-1 sparse guard's posture).
// The existing call sites are unchanged: afterSession, commitTree and
// commitPending already carry the task, which is all the decorator needs to
// read the registry by unit id.
export function createDocLaneGit(base: GitOps, registry: DocLaneRegistry): GitOps {
  // The one awaited queue (D4). The stage-A precedent (updateUnits,
  // tickIndexLine): a module-scope promise chain per instance; here it lives
  // in the decorator's closure, so each installed decorator owns exactly its
  // run's commits. Errors never wedge the queue — the failing caller gets
  // the rejection, the chain continues from a resolved placeholder.
  let queue: Promise<unknown> = Promise.resolve()
  const serialized = <T>(run: () => Promise<T>): Promise<T> => {
    const next = queue.then(run)
    queue = next.catch(() => {})
    return next
  }
  // The live scopes as one flat list, the given unit's own scope excepted —
  // the sibling set both D5's tolerance and D6's guard read. Read inside the
  // queue's continuation (or from a plain call that precedes one), where the
  // loop's single-threaded landing continuation is the only mutator.
  const siblingScopes = (unit: string): string[] =>
    [...registry.live.entries()].filter(([id]) => id !== unit).map(([, scope]) => scope).flat()
  // The queued, scoped, guarded commit core every commit-shaped method of
  // the decorator routes through — the one place the D4 scoping and the D6
  // guard exist, so beginUnit's carryover, commitPending's backfill and
  // afterSession's close-out cannot drift apart.
  const commitDocTree = (dir: string, task: { id: string; title: string }, info: { stage: string; subject: string; body?: string }): Promise<CommitResult> =>
    serialized(async () => {
      const scope = registry.live.get(task.id)
      if (scope === undefined) {
        // Everything except the live scopes — the serial degrade's units,
        // the carryover self-heal, the janitorial commits, close-out
        // commits. With no lanes in flight: today's sweep, byte-identical.
        const live = siblingScopes("")
        return base.commitTree(dir, task, info, live.length ? [".", ...live.map((path) => `:(exclude)${path}`)] : undefined)
      }
      // D6's landing guard: everything dirty must be the unit's own scope,
      // a live sibling's in-flight scope, a quarantined stray, or a
      // driver-exclusive state file. The rest is a session that wrote past
      // its declaration — quarantined here so the sibling lanes' guards and
      // close-outs tolerate exactly those paths while they drain.
      const dirty = await base.changedFiles(dir)
      const stray = dirty.filter(
        (rel) => !withinScopes(rel, [...scope, ...siblingScopes(task.id)]) && !registry.quarantine.has(rel) && !driverStateFile(rel),
      )
      if (stray.length) {
        for (const rel of stray) registry.quarantine.add(rel)
        log(`  ⚠ ${task.id} wrote outside its declared scope: ${stray.join(", ")}; the paths are quarantined — sibling doc lanes keep landing around them, the run stops once they drain`)
        return { ok: false, failures: [{ rel: ".", error: `stray writes outside the unit's declared scope (Touches + docs/${task.id}/): ${stray.join(", ")}` }] }
      }
      // The driver-state files riding the unit's own commit: the close-out
      // tick of the phase index (a driver write outside every scope, left
      // dirty by markDone moments before); the unit's own todo/done state
      // files are already inside the scope and stay deduplicated away.
      return base.commitTree(dir, task, info, [...scope, ...dirty.filter((rel) => driverStateFile(rel) && !withinScopes(rel, scope))])
    })
  return {
    records: base.records,
    commitTree: commitDocTree,
    // D5's relaxed gate. Byte-identical to the base gate over an empty
    // registry: no tolerated scope survives the filter, so `rest` is the
    // full dirty set, the driver-state-only shape heals through the same
    // carryover subject, and anything else returns the same dirty files.
    beginUnit: async (dir, opts, task): Promise<UnitGate> => {
      if (opts.dryrun) return { type: "ok", baseline: undefined }
      const dirty = await base.changedFiles(dir)
      if (!dirty.length) return { type: "ok", baseline: await base.unitBaseline(dir) }
      const rest = dirty.filter((rel) => !withinScopes(rel, siblingScopes(task.id)))
      if (!rest.length) return { type: "ok", baseline: await base.unitBaseline(dir) }
      if (rest.every(driverStateFile)) {
        const healed = await commitDocTree(dir, task, { stage: "carryover", subject: `${task.id} carryover driver-state posting` })
        if (healed.ok) {
          log(`  ✓ driver state files not posted (${rest.join(", ")}), self-healed with a catch-up commit`)
          return { type: "ok", baseline: await base.unitBaseline(dir) }
        }
      }
      return { type: "dirty", files: rest }
    },
    // The named-files rule unchanged (D4: the files are outside every live
    // scope by D6's guard, or the guard has already blocked); the backfill
    // commit itself routes through the queued, scoped core.
    commitPending: async (dir, opts, task, info, files) => {
      if (opts.dryrun) return "clean"
      const dirty = await base.changedFiles(dir)
      if (!files.some((file) => dirty.includes(file))) return "clean"
      return commitDocTree(dir, task, info)
    },
    afterSession: async (dir, opts, task, info, baseline) => {
      if (!dir) return { type: "ok" }
      await collectSessionMarks(dir, opts.phase, task, info.stage)
      if (opts.dryrun) return { type: "ok" }
      const result = await commitDocTree(dir, task, info)
      if (!result.ok) {
        return {
          type: "failed",
          question: `unified commit failed: ${result.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Changes are left in the worktree; please handle git manually and re-run.`,
        }
      }
      if (baseline) {
        // The close-out check under concurrency (D7): the live scopes hold
        // in-flight sibling writes and the quarantine holds the blocked
        // unit's strays — excluded, never swept and never judged. Clause ②
        // (the commit range) is the free function's own, unchanged.
        const violations = await unitViolations(dir, baseline, [...siblingScopes(""), ...registry.quarantine])
        if (violations.length) return { type: "failed", question: `unit close-out check failed: ${violations.join("; ")}` }
      }
      return { type: "ok" }
    },
    unitBaseline: base.unitBaseline,
    changedFiles: base.changedFiles,
    addWorktree: base.addWorktree,
    removeWorktree: base.removeWorktree,
    pruneWorktrees: base.pruneWorktrees,
    landBranch: base.landBranch,
  }
}
