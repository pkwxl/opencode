# 0254 — Executor worktree leases

Implements tier 2 of [0246 D9 and D10](0246-executor-protocol.md#d9--v1s-scope-and-the-concurrency-staging-p21-cost-recorded).
Derives P3, P4, P6, P12, P13, P17, P18 and P20.

## Category scope

Tier: mechanism. P3 and P4 govern verification and the coordinator's Git
writes. P6 and P18 put recovery evidence in the ledger and Git history.
P12 holds a landing over unexplained state. P13 reuses the workspace field
and lease protocol. P17 requires declared scopes and P20 keeps unfinished
work in the registered checkout.

Premises this ruling changes: 0253's documentation tier serializes code
units in the project checkout. `treeLanes: on` admits concurrently ready
code units with disjoint scopes in separate worktrees. The same-tree
admission and scoped settlement rules stand for documentation units.

With `treeLanes: on`, ready code tasks with disjoint declared scopes can
hold independent worktree leases. Their existing `workspace` field names
the checkout. The coordinator drains same-tree tasks before admitting a
worktree cohort and drains established worktrees before starting main-tree
tasks. A missing scope retains the serial route.

A task's execute, verify and fix shares use its registered checkout
through the terminal PASS or dependency park. The coordinator persists
the branch, creation base and granted path before materializing the
checkout. An expired lease keeps the checkout and its edits available for
reclaim under a fresh lease id. Independent verification still checks the
producer's token and the share's Git witness.

The coordinator books the main parent, lane share and merged tree before
using the standing lane landing merge. The merge's parents, tree and
message prove an interruption after the commit. An interrupted merge can
resume from the booked lane parent and staged tree. The main-tree task
close and park record follow the merge, then the coordinator removes the
clean worktree and branch. A conflicting or unexplained state retains the
checkout and gives the operator its location. The protocol retains the
same polling, fencing and recovery surface.
