# 0288 — The transfer operation threads the project's intent: the advance's pack-dependent halves read the materialized pack, not the default

Status: **enacted, 2026-11-21.** 0286 F1's fix ruling. The defect reproduced
end to end on the pre-fix tree before the change (the discipline of 0287):
an intent-bearing project whose sealing phase's advance runs through the
operation answers the wall's no-instrument finding — the field's own bytes,
`⏸ the wall's admission scan has no instrument: the intent pack declares no
regression-cost lane row …` — while the project's materialized pack declares
the divergence row; with the key threaded the same fixture's admission runs
the row green, the wall closes (the door removed, the allow retired to the
deny, the wall commit landed), and the advance continues into the next
phase's construction. The re-measure also extended the record's locus: the
operation's opts literal is the first dropped-key site, and the
deterministic advance's own minimal wall context is the second — the
`WallCtx` built at the apply boundary carried `stopBefore` alone, so even a
threaded key died there; both sites carry the key now, either alone
changing nothing.

Derives P5 (the config→opts translation has one canonical home,
`configRunOptions`, whose 0160 comment carries the defect class's own words
— "a dropped key is a silently different run"; the operation's hand-built
literals are the escape hatch that became the defect, and the ruling
restores the dropped key at every literal rather than fabricating the
`ModeSpec` the canonical home demands), P6 (the active pack resolves from
the config at read time — nothing new persists, the advance's halves
re-derive), P12 (the defect surfaced loudly at the wall's own gate — the
finding's bytes the field record carried; the fix restores the evidence
read, never a fallback), P19 (the field record's measurement, re-measured
pre-fix on a faithful wall fixture through the operation itself and
post-fix self-cleared), P10 (the intent-less floor byte-identical: an
unset `config.intent` reads the built-in default pack exactly as before —
the CLI's own default — and the wall ctx's other optional keys stay the
lane runner's own defaults, the pre-change shape). Amends none — 284's ops
surface, 0282's deterministic advance and 0265's daemon environment are
cited as the measures (the translation's three homes), not challenged;
0286 F1's locus is extended, not corrected (the record's chain named
`ctx.opts.intent`; the chain has two links).

## Category scope

Tier: server (the operations) + core (the advance's wall context). Code
homes: `packages/auto-server/src/ops.ts` — the three hand-built option
literals (`runTransferOp` the live defect; `runPlan` and `runTaskAdd` the
latent siblings, their prelude arms carrying no reachable intent consumer
today, the key riding for the day one grows) — and
`auto-core/src/transfer.ts` — `applyBoundaryDeterministic`'s `WallCtx`,
which now threads the advance's own `opts.intent` beside its `stopBefore`.
Test home: `packages/auto-server/test/ops.test.ts` (the wall fixture end to
end through the operation). `docs/protocol.md` is untouched (the wire
changed nothing; the person's operations and the advance's exits read the
same).

Premises this ruling changes: none. Re-read in this change: 0284 (the ops
surface — the state-resolved advance still needs the project's pack; the
literals now carry every config key the deterministic halves consume),
0282 (the deterministic advance — the boundary apply's context threads the
advance's inputs), 0265 (the daemon environment — the environment pinned
and the config carried), 0160's absorb (the one-home rule the defect
dodged) — all stand.

## The sibling audit (the remedy family's own demand)

Every operation that builds options-shaped inputs for a core call, audited
for intent consumers:

| Operation | Core call | Intent consumer | Verdict |
|---|---|---|---|
| transfer | `transferDeterministic` | the wall admission's regression lanes, the blockage diagnosis, the round-open scaffold | **live defect** — the measured finding |
| plan | `planPrelude` | the scaffold arm (`plan.ts`, the `--phase` route) — no field the operation passes reaches it | latent — the key rides |
| task-add | `planPrelude` (the new-task route) | none on the route | latent — the key rides |
| close | `closeUnit` | none | clean |
| clarify | `clarifyGate` | none | clean |
| reconcile | the coordinator (0287) | none | clean |

## The residual, resolved as no-change

0286 F1's remedy family left one question: whether an unset
`config.intent` should default silently to the built-in pack inside the
pack resolution at all, or the operations layer should refuse an
unconfigured intent loudly (P12's direction). No-change: the built-in
default is documented, configured behavior — the CLI floors to the same
pack, and a loud operations-side refusal would *diverge* the surfaces on
unset-intent projects (a P10 break). The defect was dropping a **set**
value, never the default.

## Site-side

The igb boundary, held on this alone since the sitting (the person's
re-seal `3f95a65` cleared the sealed-channel findings), advances on the
next transfer invocation: the admission reads the cleanroom pack's
divergence row, and the boundary's own gates take over from there. The
demolition track's marker, at (0288+) by 0287's ruling, shifts to (0289+)
by this ruling's landing.
