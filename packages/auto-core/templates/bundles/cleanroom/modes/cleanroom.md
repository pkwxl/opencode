# cleanroom

## init

Clean-room redesign: this project reimplements the functional specification of an
existing system without reading that system's implementation. Plan against the
specification and acceptance inputs only (the brief, the planning input, and the
spec-notes the first phase produced); the deliverable is an independent implementation
satisfying the specification's external contracts — public interfaces, observable
behavior, state and lifecycle contracts, and error semantics.

## exec

Clean-room boundary: never access, search for, reconstruct, infer or request the
reference implementation — no source, no derived analysis notes, no private names or
internal structures from it. Implement the specification and pass the black-box checks.
Where the specification is silent, prefer the minimal behavior consistent with the
public interfaces and record the assumption in the task documents; never expand scope
on conjecture. Internal design is free — data structures, module decomposition and
control flow answer to the specification alone, and minimal changes beat speculative
architecture.
