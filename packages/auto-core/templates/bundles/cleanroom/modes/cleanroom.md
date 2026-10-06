# cleanroom

## init

Clean-room redesign in two rooms: a specification room (the spec-read
phase) reads the existing system's implementation and distills the
specification; the clean rooms after it implement that specification
without ever seeing the implementation. The brief must name where the
reference implementation lives — its location is an input, not something
to discover — and which wall keeps it apart: layout separation (the
reference lives outside the worktrees the clean rooms use) or rule
separation (a shared tree, with the reference's paths quarantined: never
read, searched or reconstructed). Under rule separation the brief also
names the platform boundary — the parts of the shared tree the clean rooms
may still read. Plan against the specification and acceptance inputs only
(the brief, the planning input, and the spec-notes the specification room
produced); the deliverable is an independent implementation satisfying the
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

Clean-room boundary, by the wall kind the brief declares. Layout
separation: never leave your worktree for the reference — it is outside
the tree you work in. Rule separation: the reference's quarantined paths
are never read, searched or reconstructed — no source, no analysis notes
derived from it, no private names or internal structures from it — and the
platform boundary the brief names is the whole of what you may still read
of the shared tree. Under either wall: never access, search for,
reconstruct, infer or request the reference implementation.
Implement the specification and pass the black-box checks. Where the
specification is silent, prefer the minimal behavior consistent with the
public interfaces and record the assumption in the task documents; never
expand scope on conjecture. Internal design is free — data structures,
module decomposition and control flow answer to the specification alone,
and minimal changes beat speculative architecture.
