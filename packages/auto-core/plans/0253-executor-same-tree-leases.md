# 0253 — Same-tree executor leases

Derives P3, P4, P5, P6, P12, P13, P17 and P20. Enacts the documentation
tier of [0246 D9 and D10](0246-executor-protocol.md#d9--v1s-scope-and-the-concurrency-staging),
with the fencing and recovery amendments in [0248](0248-executor-protocol-amendments.md)
and [0249](0249-executor-protocol-recovery.md).

## Category scope

Tier: mechanism. P3 and P4 govern Git-backed settlement and coordinator
writes. P5 and P6 put scope ownership and replay in the coordinator's
existing ledger. P12 holds out-of-scope landings. P13 keeps the served
protocol intact. P17 and P20 govern admission by declared scope and
preservation of sibling writes.

Premises this ruling changes: 0252's worker guidance assumes one live lease
per project. The installed executor prompt directs each concurrent worker
to use a distinct channel and stay inside its granted workspace and scope.
The person prompt's authority and the existing lease and replay rules stand.

Independent whole-task units with declared documentation paths use the
existing doc-lane scope rule. A reservation includes the declarations and
the unit's own task directory. Its scope stays reserved through execute,
verification, fix and retry, until the unit closes or parks. A targeted
claim names a ready unit. The ready menu reports available claims or the
calling channel's live lease. An untargeted claim starts with the
established index order. A channel can recover its existing lease by
repeating the claim. Serial units and project-level person gates retain
exclusive admission.

The coordinator remains the only Git writer. Report settlement checks
Git-visible changes against the reporting unit's scope and write contract.
An unstaged change inside another reservation stays on disk for its unit.
Unowned paths and staged sibling paths hold the landing. The coordinator
stages the observed paths and checks the resulting tree and commit against
the durable report booking. A sibling commit may advance HEAD if the
intervening first-parent chain consists entirely of settled coordinator
commits. The booking records the actual landing parent so replay uses the
same witness. A PASS close checks its own rename and index tick and keeps
other reservations' work in place.

The shared checkout supplies path ownership without author attribution.
A write inside a sibling reservation is indistinguishable from that
sibling's own write. The coordinator can prove that a report excludes
sibling paths and rejects edits outside all reservations. Workers must
respect their granted scope and stop writing after losing their lease.

The executor tests cover independent and overlapping claims, serial
admission, scoped landing and close-out, stale report fencing after
restart, booked parent replay and refusal of unreserved or staged
sibling changes.
