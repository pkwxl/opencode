# 0307 — Separate deterministic transfer from the push loop

## Category scope

Tier: push session removal. Under 0282 the daemon's transfer operation
already applied the boundary deterministically. Its module still loaded
the push loop and used two shared phase-boundary helpers through
`loop-phase.ts`. The legacy `runTransfer` entry still has regression
coverage for session-driven advance.

## Decision

Keep deterministic transfer on the existing public entry and share the
survey's approved-brief install and gate-stop logging through `src/plan.ts`.
Keep the old helper exports on `loop-phase` for existing callers. Load
the push loop only when the legacy entry reaches its session-driven
advance. Carry the selected advance through project start and next-round
opening. A released round-brief proposal can pass the round-start gate and
continue into construction in the same invocation. That path previously
called the session-driven advance for both entries. The daemon now follows
its deterministic route through that continuation. Preserve the lock, gate
wording, survey install order, and round-close behavior. The legacy route
remains available for its existing callers and tests.

Derives: P10 (both transfer entry points keep their behavior) and P21
(shared helpers leave the push loop before removal of its callers).
