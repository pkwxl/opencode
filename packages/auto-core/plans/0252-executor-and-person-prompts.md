# 0252 — Executor and person prompts

Derives P2, P3, P4, P6, P12, P13, P15, P17 and P20. Implements slice 6
of [0246 D10](0246-executor-protocol.md#d10--the-staged-enactment) with the
[wire amendments](0248-executor-protocol-amendments.md),
[recovery rules](0249-executor-protocol-recovery.md) and
[person settlement rules](0250-executor-person-settlement.md).

`executor.md` teaches the solo worker and hub, stable channels, lease
ownership and replay, independent verification, and the coordinator's
write boundary. `person.md` teaches eligibility, delegation and escalation,
proposal-bound approvals, and settle-once answers. Both use an
operator-supplied local connection file outside the target checkout. They
ship through the existing embedded installer and suite manifest beside
the manual-driver prompts. The ratchet pairs their obligations with
coordinator guards and keeps commit grammar out of both prompts.

The prompts target the serial preview. One lease can be live per project.
A worker receives a gate as a wait and the person role retrieves the
proposal. Project creation uses the existing open-mode preview for new
directories. Same-project parallelism and convergence remain staged.
