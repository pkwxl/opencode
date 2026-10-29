# Spec read

Wall: seal
Phase-artifacts: spec-notes.md
Task-artifacts: notes.md

## plan duties

Extraction duties — this phase's sessions are the specification room.
Plan one task per specification concern, each reading the reference
implementation at the location the brief names: functional scope,
entities and lifecycles, public interface contracts, data-plane
behaviors, error semantics, and the black-box acceptance criteria. The
concern list is a floor, not a ceiling: a concern may span several tasks
sized to a session, and every feature area of the reference is assigned
to exactly one task (a coverage/accounting task may hold the mapping).
Each task produces one standalone behavior-only specification notes
document `notes.md` in its own task directory — observable behavior and
contracts only, never the implementation's private names, internal
structures or translated code. A closing task consolidates the notes into spec-notes.md
in this phase directory — the single specification the later phases
implement. Documents only — no implementation code in this phase.

Vocabulary hygiene: the notes state observable behavior as contracts at the
boundary, in the target platform's terms — no infra-shaped vocabulary, no
concept whose meaning hangs on the reference's particular internal
organization; the clause targets the concept, never the word, and
domain-natural infrastructure names a target needs regardless are fine. At
spec-read close the driver-side divergence instrument's cheap half scans the
notes: a private identifier of the reference in a note is a hard finding,
cheap to fix at the source before later phases build on the note. This
phase's sessions read the reference lawfully, so a session may be told the
colliding identifier outright. The committed receipt carries counts and note ids alone;
a reference identifier never persists in any session-readable document.

Entry provenance, property-first: every specification entry records its evidence kind —
published specification, standard, black-box observation, or directed source read — so
independence is auditable from the notes alone. Capabilities with no public interface of
their own (internal enablers) are specified property-first: their notes state the invariants
and guarantees — no lost wakeup, ordering and flush visibility, latency bounds, never-fail
reserves — never mechanism narration, and their acceptance criteria are consumer-shaped
where a consumer is imminent.

The sealed wall: this phase's close seals the reference wall — the driver
removes the reference door(s) and the admitting allows as one recorded act
at the next person's advance, and every later phase is mechanically walled.
This document carries the sealing semantics alone; the door path(s) are the
project's own fill here at materialization (`Wall: seal <door>` — the
top-level reference symlink names, comma or space separated; an unfilled
field seals against every top-level symlink that resolves outside the
project). Evidence layer, this phase's pre-wall duty: the verification
reports keep verdicts and counts in-tree; their anchors and spot-check
citations — any reference internals — land in the project's declared
out-of-tree compliance home beside the divergence receipts, never in a
session-readable document. Commit messages are covered by the same rule:
they are the one in-tree channel that can never be restated — no reference
anchor, identifier or file:line ever rides one, this phase's sessions and
the driver's own commits alike.

<!-- auto: eof -->
