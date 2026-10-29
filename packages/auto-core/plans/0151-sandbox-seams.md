# 0151 — the sandbox seams: lane logs redirect by environment, and lane branches carry the target directory

The maintainer's ruling (2026-10-29, over the aster-mig cleanroom workspace, continuing the 0147 field
line into the environment layer): *"When executing opencode-auto run across each independent clean-room
migration project, conflict issues between shared environments may arise — especially when conducting
backtest comparative studies via the fork mechanism, where such conflicts become even more severe. …
We need to introduce a sandbox execution mechanism to ensure that opencode-auto and its related
processes operate strictly within the sandbox, with the sandbox's actual access scope confined to
opencode-auto's current target directory environment, while still providing a complete host-like
environment configuration."* The tool-side half of that ruling is two seams — everything else (the
mount-namespace wrapper itself) is workspace machinery, not tool machinery (P16, P21).

## The measurement (the shared surfaces a concurrent fork family writes through)

- **The lane-log dir is global and unkeyed.** `LANE_LOG_DIR = "/tmp/opencode"` — one constant, every
  run of every project and every fork arm of every project writing its lane and regression logs, the
  rust-strip shim and the target scripts' fixed-name evidence files through it. 0147 D3 measured the
  contamination already (the t083-250 verifications judging verity7, another fork's receipt, as their
  own exec round's evidence) and named the remedy — *"a per-run receipts dir the target projects' own
  convention, the reopen trigger when a consumer locks the shape, P21"*. The consumer now exists: the
  cleanroom workspace's sandbox wrapper (bubblewrap, per-run identity derived from the target
  directory) mounts a per-run dir over the path and must point the driver's own lane-log writes at
  the same dir — the shape is locked, the trigger fires.
- **The lane branch namespace belongs to the object store, the stability rule to the directory.**
  0068 D16's grammar `auto-lane/<task-id>` is stable across a task's retries — within one target
  directory. But a linked worktree's branch refs land in the *parent repository's* ref store, and
  fork arms of one repository share that store (0129: a fork's only writes there are the reserved
  branch families). Two arms retrying the same unit (the A/B stochastic study — the exact backtest
  the maintainer's ruling names) race `git worktree add -b auto-lane/<unit>` on one namespace: the
  second arm's dispatch fails on the existing branch, and nothing in the name says whose it is. The
  fork family's own fields show the arms genuinely collide in time (forkA and forkB driven
  concurrently 2026-10-28, the dm-glm budget arms interleaved overnight).

## D1 — the lane-log dir becomes an environment seam

`laneLogDir(env = process.env)` replaces the `LANE_LOG_DIR` constant: `OPENCODE_AUTO_LANE_LOG_DIR`
redirects every lane and regression log write and every receipt `Log:` line; unset or empty (the
switch registry's convention) keeps the prescribed `/tmp/opencode` byte-identical; the `opts.logDir`
test injection is unchanged and still wins. The models registry's `operatorLayerPath(options.env ?? process.env)`
is the precedent shape — an environment seam read at the point of use, never persisted, never a
config key (experiment semantics = this run only, the 0003 env-layer rule). The cleanroom sandbox
exports the variable; every other environment sees nothing.

## D2 — `laneBranch` carries the target directory's digest

`auto-lane/<task-id>` becomes `auto-lane/<task-id>-<digest>`, the digest the first 8 hex of the
SHA-256 of the target directory's path. D16's stability rule keeps exactly its scope — one target
directory, one branch per unit across every retry and re-dispatch (the orphan-recovery and
straggler-pruning paths derive the same name from the same dir); two arms of one object store
dispatching the same unit now own disjoint names. land's original-branch derivation matches on the
`auto-lane/` prefix, which the grammar keeps, so the one-non-auto-branch invariant is untouched.

## D3 — the floors and the named residuals

- The sandbox itself is not tool machinery: no wrapper, no container layer, no path list ships here
  (P16 — no environment facts in tool source; P21 — the workspace consumer owns its confinement).
  The tool ships exactly the two seams the ruling needs and nothing speculative beside them.
- The receipts convention keeps its default: an environment that exports nothing gets today's exact
  behavior — the boundary's `/tmp` allowance (0147) still points where the protocol prescribed it.
- The digest changes existing branch names — lane branches are ephemeral by design (created at
  dispatch, deleted at teardown, stragglers pruned), so no migration is owed; a park left by an
  earlier release prunes through the same straggler path it always did.
- Fork's `auto-fork/<target>` family and its first-free `-2` suffixing are untouched (0129's
  resolution already handles same-point arms).

Derives: P21 (the consumer locked the shape — the wrapper exists, the seam ships), P16 (the seam is
an environment variable at the point of use; the sandbox's paths and mounts never enter tool
source), P10 (unset environment = the byte-identical prescribed behavior), P17 (the arms' concurrent
use of one object store is now structurally declared in the branch grammar, not discovered as a
dispatch failure), P19 (the measured surfaces: the verity7 cross-fork receipt, the shared executor
bind, the same-unit worktree-add race).

Amends: 0147 D3's named residual is ruled — the per-run receipts dir takes the tool-seam shape
`OPENCODE_AUTO_LANE_LOG_DIR` (the workspace's convention owns the value; the boundary pair and its
`/tmp` allowance stand unchanged). 0068 D16's branch grammar carries the directory digest with the
stability rule's scope unchanged.

Tier: mechanism (src/script.ts `laneLogDir`; src/lanes.ts `laneBranch` + the four derivation sites;
src/loop-preflight.ts's two; tests).

## Tests

- test/script.test.ts: the `laneLogDir` describe (the prescribed default; the redirect; empty counts
  as unset).
- test/lanes-scheduler.test.ts: the `laneBranch` describe (two directories of one store → distinct
  branches under the `auto-lane/<unit>-<digest>` grammar; one directory → stable across calls,
  distinct per unit).
- The twelve `laneBranch` test-site moves (loop-isolation, lanes-scheduler) and the two e2e
  exact-name pins (the blocked-lane scene, the isolation round trip) moved to the digest grammar in
  the same lockstep.

Full typecheck clean in both packages; auto-core 2854 and the shell 156 passing (+ the E2E-gated
skips).
