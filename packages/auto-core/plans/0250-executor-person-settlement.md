# 0250 — Executor person-item settlement

Derives P2, P3, P4, P5, P6, P8, P12 and P13. Refines [0246 D4 h and D8](0246-executor-protocol.md), [0248 D7–D8](0248-executor-protocol-amendments.md) and [0249 D4](0249-executor-protocol-recovery.md) for the serial coordinator. The worker-only preview can ship independently of this slice.

## Identity and delivery

Keep person items and their first accepted decisions in project-local executor state under the shared run lock. The records survive coordinator idle exit and daemon restart. Use the daemon's authenticated token identifier, channel and delegation metadata as authority. Derive that metadata from the token store on each request and carry it across the authenticated worker bridge. The human's own channel requires an explicit unrestricted person grant. A delegated grant names the allowed kinds, `questions` and/or `releases`. A missing envelope conveys no authority.

Assign questions durable generated IDs at the raise. Deduplicate a pending question by authenticated token identifier, channel, optional task and exact text. The existing body only guarantees deduplication while the question is pending. A retry after settlement can raise the same text as a new question. Exact replay past settlement would require a client-supplied operation key. A task-scoped raise must include its issued `step` and `lease`. Require that the authenticated holder owns that live pair and that the pair belongs to the supplied task. A project-level raise without a task remains token-authorized under 0248. Lease expiry alone does not revoke that token authority.

A standing gate item represents one occurrence of one proposal. Store the gate kind, its project-relative document path, the current round or phase where applicable and a digest of the exact reviewed document bytes. Include any other input that determines what the release approves in that digest. Persist an item ID when an eligible person derivation first records that occurrence. Reuse it across claims and restarts. Supersede it when the gate disappears or the proposal changes, and issue a fresh ID when a new occurrence is offered. Evaluate eligibility before returning the oldest pending item. Escalation for out-of-envelope items may identify the kind and the need for a human decision. Only eligible channels receive proposal or question content.

Use one durable issuance order across both item kinds. Questions enter that order when raised. Gates enter when a release-authorized person derivation first records their proposal. For preview records that predate the shared order, retain per-kind order and place the older records ahead of new items, with legacy questions before legacy gates.

## Registered daemon routes

Use the 0248 response envelope. A raise returns `question: { id, state: "raised" }`. A person claim or answer returns `step`. A question step carries `id`, `text`, and an optional task. A human step carries `id`, `gate`, `document`, `proposal` and `review`. A task question requires all of `task`, `step` and `lease`.

The daemon scopes are `person` for unrestricted person authority, and `person-questions` and `person-releases` for the corresponding delegations. A token with both worker and person authority defaults to worker claims. A person-only token defaults to person claims. Claims may explicitly select their role. Person claims are untargeted.

An inline brief with more settled answers includes `answerCursor`. A brief request with a `cursor` field returns a `step` with `kind: "answers"`, the answer array and an optional `next` cursor. The cursor is the last delivered answer ID and `null` starts from the beginning. Scope paging to the same live holder, task and work kind as the inline brief. Use settlement order so new answers can follow a previously issued cursor.

## Answers and recovery

Authorize an answer for the item's kind before disclosing its state or replaying its receipt. An eligible answer to an already-settled item acknowledges the first decision and returns a fresh derivation. Preserve the original decision, token identifier, channel, envelope and rationale. For a pending question, persist the decision and terminal receipt together. Render the answer as data in a newly rendered brief for the authenticated asker and applicable task, including after lease replacement and restart. A delivered brief is a snapshot. Re-fetching a live brief must include applicable settled answers without issuing another lease.

A gate answer first re-derives the gate and compares the current proposal and target to the claimed item. A superseded ID cannot release a new proposal. Return a fresh person derivation so the caller can review it. The serial gate decision is approval of the current proposal. Proposal edits are made on the existing person surfaces and reviewed as a new occurrence.

Before writing a release, persist the approved proposal witness, decision and intended effect. Apply the standing clarification validation and release-mark grammar. A release needs a Git witness bound to the intent, including for a proposal that was untracked before approval. Record its proof from the commit, including its parent, scoped tree and item identifier. Once an intent is accepted, recovery can finish it without the original answerer. A valid witness allows receipt completion without a second release. A matching precondition allows the unfinished effect to run. Ambiguous evidence blocks with a remedy. A worktree mark alone cannot acknowledge a committed release. Its appearance during recovery also cannot make the gate vanish from coordinator state while the intent is pending.

The release commit must have an explicit permitted path set. The CLI clarification path can currently fold incidental configuration changes into its commit. The executor release must declare each required release path before writing and reject unrelated changes. Settle the release mark through the standing clarification rules and leave phase advancement to its existing path. Defer a gate write while an active lease or pending report owns its workspace. A question answer is a ledger update and can settle during an active lease.

## Ordering and acceptance

A valid new claim first resumes any pending report under the shared lock. Recovery uses the booked holder and effect witnesses. Neither a lost reporter nor a later person gate can prevent settlement. `ready` only derives state. For new worker grants, apply the common project gates before kind-specific eligibility checks. A worker's own pending question takes precedence over the general gate wait. Report and release actions may settle during either wait. Their responses reflect the resulting project state.

Before exposing both person routes, prove all of the following.

- A delegated claimant skips an older ineligible item. Direct answers enforce the same envelope as claim, including on replay. A dual-scope token defaults to worker and can select person explicitly.
- A question deduplicates only for its authenticated asker and task while pending. A stale lease cannot raise a task question or block the successor. Two eligible answers preserve the first decision across restart. The applicable resumed brief carries that answer.
- A changed proposal invalidates an old gate item. Kill the coordinator before the release write, after the mark and after its commit. Recover exactly one release and its original provenance without requiring the first answerer to retry.
- Execute, verify and fix all respect pending person items. A live holder can still report or release. A gate commit cannot absorb worker changes.

## Remaining freeze conditions

- Dependency parks need a recoverable landing effect. Exercise interruption around the park commit and registry update, dependency completion followed by continuation, and mutual-park refusal.
- Parallel leases need attributable changes and confined commits for each workspace. Exercise simultaneous claims, overlapping ownership, stale renewal and settled-report replay while another lease remains active.
- Open-mode creation follows 0249's slice 5 requirements. Exercise interruption after each durable creation step, repeat and conflicting requests, visibility during partial initialization, and containment when a directory component is replaced.
