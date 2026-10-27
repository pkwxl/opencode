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

After materialization the project owes its own declarations, none of them shipped content:
the lane rows commented in the shipped pack become the project's own declared rows — the
person installs them, commanded in the project's own terms (build, the paradigm-constraint
suite, the property suite, the divergence scan behind a bare target name, the acceptance
anchor); the brief states the wall kind; it declares the platform contract — the target
platform's abstractions the deliverable must build on: its execution model, its
memory/isolation discipline, its interface shapes; and it never states the divergence
corpus location — the corpus is a driver-side location outside the platform boundary whose
exact path is the person's driver-side fact, an environment fact for the person, never
session-visible content (a corpus path in any session-rendered surface, the brief
included, is a wall breach).

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

The deliverable is written in the target platform's paradigm: the
platform's own constructs and abstractions are the substrate you build on
— the platform contract the brief declares. The reference's idiom
families, whatever its paradigm's are (the project's own duty text names
them in its own terms), must be re-expressed in the target platform's
native constructs, never carried over; structures derived from the
reference's substrate shapes are defects, not defaults. The demand is
re-expression in the platform's terms, never difference for its own sake
— a shape that is also the rational design in the target is kept and
justified.
