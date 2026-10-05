# cleanroom

## init

Clean-room redesign in two rooms: a specification room (the spec-read
phase) reads the existing system's implementation and distills the
specification; the clean rooms after it implement that specification
without ever seeing the implementation. The brief must name where the
reference implementation lives — its location is an input, not something
to discover — and the wall is only as strong as the layout keeping that
source out of the clean rooms' reach, so the brief also states how the
source is kept apart from the target worktree the clean rooms work in.
Plan against the specification and acceptance inputs only (the brief, the
planning input, and the spec-notes the first phase produced); the
deliverable is an independent implementation satisfying the
specification's external contracts — public interfaces, observable
behavior, state and lifecycle contracts, and error semantics.

## exec

Two-room clean room. The specification room is the spec-read phase: its
sessions are the specification team — they read the reference
implementation at the location the brief names and distill behavior-only
specification notes. Extraction hygiene: the notes describe observable
behavior only — no private names, no internal structures, no translated
code — and the notes are the specification the later phases implement.
Every session of a later phase works in a clean room.

Clean-room boundary: never access, search for, reconstruct, infer or
request the reference implementation — no source, no analysis notes
derived from it, no private names or internal structures from it.
Implement the specification and pass the black-box checks. Where the
specification is silent, prefer the minimal behavior consistent with the
public interfaces and record the assumption in the task documents; never
expand scope on conjecture. Internal design is free — data structures,
module decomposition and control flow answer to the specification alone,
and minimal changes beat speculative architecture.
