# 0092 — The facility-keyed child launch: background-first for every run, foreground only forced

The working rulings, kept verbatim as the design record. Status: landed 2026-10-11. Supersedes 0090 D1's
attendance keying; 0090's D2–D5 and 0089's mode rulings stand unchanged.

## The problem

0090 keyed the launch facility on attendance — a sprint mode or an idle-task session was the marker of an
unattended run, and every other run kept the foreground preference for the transcript's inspectability.
Two facts void that keying. First, no run of this suite is attended in the watching sense: the person
hands the file over and returns for the hand-overs and reports — nobody ever watches a child's live
transcript, so the foreground preference's reason never materializes while its cost (the harness's
~10-minute quiet kill on a foreground child) is paid by every plain run. Second, the one case 0090 marked
for background-first — a sprint on its native idle-task host — is the one host with no background
facility at all, so the preference could not fire where it was most needed.

## The rulings

- **D1 — the launch keys on the host's facility set, not attendance.** Launch children background-first
  whenever the host has a background facility: a background child cannot be quiet-killed, and nobody
  watches the foreground transcript in any run. Foreground (synchronous) launch is the shape of a host
  with no background facility alone — the idle-task session, sprint mode's native host.

- **D2 — the killed or lost child relaunches through the channel it launched on.** The same role, one
  line of feedback to continue on the dirty tree it left; on the forced-foreground host the quiet-child
  nudge rides that line (0090 D2's wording unchanged), the companions' polling discipline stays the
  child's only shield, and the sprint wall bounds repeated kills (0090 D3 unchanged). The retry stays
  budget-exempt.

- **D3 — sprint remains 0089's wall mode, its native host the idle-task session.** No restriction
  machinery: any hand-over may name `mode: sprint <minutes>`, and on a host with both facilities its
  children simply launch background-first like every other run's.

- **D4 — the ratchet repins the launch literals.** The 0090 block's attendance-keyed pins are replaced
  by the facility-keyed ones, so drift stays a conscious change (0090 D5's stance carried forward).

## What is deliberately not done

- No attendance detection and no new configuration surface: the policy reads the host's own facility
  set, nothing else (0090's "no per-launch host interrogation" stance carried forward).
- Nothing in the companions changes — their survival constraints stay unconditional (0090 D2's stance).
- 0091's phase boundary stop is untouched: the person's presence at boundaries — reading the report,
  handing the file over again — is a different thing from watching children execute, and remains the
  classic run's shape.
