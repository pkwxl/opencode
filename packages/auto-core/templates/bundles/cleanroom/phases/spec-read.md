# Spec read

Phase-artifacts: spec-notes.md

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
document under its task directory — observable behavior and contracts
only, never the implementation's private names, internal structures or
translated code. A closing task consolidates the notes into spec-notes.md
in this phase directory — the single specification the later phases
implement. Documents only — no implementation code in this phase.

<!-- auto: eof -->
