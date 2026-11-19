# 0258 — Executor nested-root settlement

Discharges [0257](0257-executor-preview-findings.md) finding 01 (the
coordinator refused the nested destination repository outright). Derives P4
(the admission shape and the settlement's commit discipline are the
git-anchored letter: the target directory itself a work-tree root, the share
a commit of the repository whose history the receipt, verification and
close-out witnesses key), P6 and P3 (the multi-root settlement re-derives
every root from disk and replays exactly — per-root booked evidence beside
the booked tree, a crashed attempt's landed nested root skipped by its
witness, never re-committed), P12 (any root's unreadable status or drifting
witness blocks, never a silent clean verdict), P17 (the lane refusal that
stands: isolation bought at the worktree tier is one commit on the main
tree), P20 (nothing in flight is destroyed — retained edits, crashed
settlements and session-created roots all settle or block with their remedy),
and P16 (the shape rule is structural — a work-tree root plus inherited
nested surface — no project's paths enter it). Amends none: 0246 D4 b/D5's
admission contract never carried a repository-shape criterion; this ruling
closes that silence in words rather than by code deletion alone.

## Category scope

Tier: mechanism (code home `src/executor-coordinator.ts`, one export in
`src/git.ts`, test homes beside it).

Premises this ruling changes: none — the ruling adds the shape line the
admission contract left silent; no standing letter rested on a single-root
executor. Re-read in this change: 0246 D2 (the driver acts "through the
core's existing boundaries" — boundaries nested-repo-aware by 0073 and
0021's `Auto-Nested`), 0246 D4 b and D5 (admission = readiness, live lease,
scope disjointness — the shape line joins that enumeration), 0248 D5 and
0249 D3 (the landing-time path check over the write contract — unchanged,
now judged per root), 0253 (same-tree reservations and scoped settlement —
the aggregated rows compose unchanged through `siblingDirt`/
`reportedChanges`), 0254 (worktree leases and the lane landing — the one
root check this family keeps), 0073 (the nested-first unified commit whose
posture the settlement inherits). All stand.

## The ruling

**The admission shape, one line.** A claim requires the target directory to
itself be a Git work-tree root (`rev-parse --show-toplevel` = the target) —
P4's settlement anchor. Repositories nested under the target are workspace
surface inherited from the push path (0073's nested-first unified commit,
`Auto-Nested` 0021), fenced by the write contract and settled root by root;
never an admission criterion. The claim-time refusal keeps reason
`isolation` and names the work-tree-root remedy; the gate workspace, fix
continuation, close-out and continuation reads judge **all** roots (nested
dirt outside each check's permitted set holds it exactly as top-repository
dirt does).

**The settlement.** Status aggregates per root (`repoRoots` deepest-first,
`statusEntriesRead` remapping each nested root's rows to checkout-relative
paths — the fence, sibling-dirt and reported-changes filters compose
unchanged). Each root with observed changes stages its own rows, proves its
staged set against its own base (a session-created root's parentless first
commit diffs from the empty tree), and commits with the share's message,
**nested-first** — repoRoots' order, the unified commit's own. The booking's
`intent.tree` keeps witnessing the **top repository alone**; beside it the
intent books per-root evidence `{root, base, tree}` so replay is exact: a
booked nested root still dirty re-stages to its booked tree, a booked nested
root already committed is proven by its `%P%n%T%n%B` witness and skipped,
and a booked root whose dirt vanished blocks. The share's receipt, the
verification and close-out witnesses still key the top repository's history.

**The top anchor.** A share *is* a commit of the target repository, with
nested commits riding beneath it as the unified commit's `Auto-Nested`
alignment rides the root commit. A settlement whose observed changes all
fall under nested roots blocks with its remedy — include a top-repository
path; every step kind's own artifacts (`handoff.md`, `report.md`, `gaps.md`)
are one, and a fix's gap retirement is itself a top-repository change.

**The lane refusal that stands** (the finding's own adjudication): an
established worktree checkout settling a surface that contains a repository
the session created inside the lane is refused — the lane lands as one
commit on the main tree (0254's merge) and a nested repository cannot ride
it. The main tree has no such constraint: it settles root by root.

Boundary recorded, no machinery added: between shares the nested roots stand
as booked; foreign movement there surfaces at the next settlement's per-root
base compare. The push path's `unitViolations` close-out audit has no
executor counterpart and this change adds none.

## Tests

`test/executor-steps.test.ts` — the reproduction fixture (a target whose
deliverable includes a nested repository, outer `.gitignore` listing it,
config `isolate` naming it): claim succeeds where the standalone refusal
answered; the fence rejects an out-of-scope nested row by name; the
nested-only settlement blocks on the anchor remedy; a nested write plus the
handoff settles nested-first (one nested commit under the share's subject,
one top commit); the continuation lands and PASS close-out completes on the
target; `crashReport` at the new `nested-committed` checkpoint proves the
crash-window replay (booked nested witness proven, never committed twice).
`test/executor-worktree.test.ts` — a session-made repository inside an
established lane checkout blocks with reason `isolation` and the lane
message. Form checks: `bun typecheck` exit 0; the three executor suites and
the four reconciliation suites green; no cross-module import changed
(`EMPTY_TREE` exported from the already-imported `src/git.ts`).
