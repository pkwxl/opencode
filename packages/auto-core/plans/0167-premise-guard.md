# 0167 — The premise guard: a ruling names the premises it changes

Status: **active**. Ruled 2026-11-05 by 0166 step 005 (wave W0-governance), enacting 0165's F22.

## Derives

Derives: P19 — both substance and method. P19 shows in the guard being grounded in a measured
census, not a style preference: the cross-ruling premise-drift pattern (S16/S18/S20) is the
process-level root of about a fifth of the 224-row 0165 register, each instance verified at
file:line. Tier: none — a development convention of this repository's own corpus (plans/0111's
tier test keeps such rules out of the constitution); no product behavior is ruled.

## Category scope (0123 D1's discipline)

Two families in one 0166 step, both drift guards; the step's findings are F22 (the guard) and
0165-201 (the ratchet). Home-set:

| home | disposition |
|---|---|
| `AGENTS.md` (Development conventions, beside the requirement-intake line) | changed — the premise-guard line, the convention's operative statement |
| `src/agent/opencode/server.ts` | changed — `SERVER_ENV` exported (one word; the restatement comment already stands), so the ratchet can compare it test-side |
| `test/agent-env.test.ts` | changed — the drift ratchet: `SERVER_ENV === SWITCH_ENV.server` (0165-201), mirroring the file's existing registry-vs-literal enumeration; the import is test-side, D8-legal |

Per-landing bookkeeping surfaces (`plans/INDEX.md` row, this document) carry no row — the standing
convention from step 003's reconstruction, restated here because this ruling lands one.

## The ruling

**D1 — the line and the duty it names.** A ruling that changes a surface a standing rule rests on
states, in its decision block, `premises this ruling changes: <ids>` — the ids of the prior
rulings or standing rules whose premises the change invalidates — and the same change re-reads
every named dependent, amending it explicitly or recording why it stands. A shared surface is
anything a dependent rule's reasoning cites as stable: a switch's semantics, a config key and its
readers, a permission surface, a commit trailer or document grammar, a shared data shape, a
lifecycle ordering, a restated literal. The line is the writing-time act; the re-read is the duty.
Absent a changed premise the line is absent — it is not boilerplate, and no parser reads it: unlike
`Derives:`/`Amends:` (probe-checked) it stays advisory grammar for the writer, its bite at review
and release-audit time (P8's deliberate enforcement moment — a convention taught, not a gate
erected).

**D2 — the census the guard answers.** Each named instance was verified sound when written and
broken by a later ruling that amended the shared surface without re-reading the dependent rule:
0057's scheduled wait and its stated resets (S16-02/S16-05 — 0144/0163's key marks changed the
wait's premise), 0055 §7.1's time-masked cache and §5's planning tier (S16-03/S16-04 — 0095's
formulation task changed both premises), 0041's permission map (S18/S20 — later adapters and
0147's boundary changed the surface the map assumed). About a fifth of the register traces to this
one pattern; one line that forces the re-read at the moment of change is the cheapest guard that
does not guess which surfaces matter (the writer already knows what the change touches).

**D3 — the companion ratchet (0165-201, the same drift in miniature).** The adapter's restated
`OPENCODE_AUTO_SERVER` and the switch registry's `SWITCH_ENV.server` are one vocabulary restated
across a domain seam the domain itself cannot import across (D8); the ratchet asserts their
identity test-side (`SERVER_ENV === SWITCH_ENV.server` in `test/agent-env.test.ts`, beside the
file's existing registry enumeration), so a rename on either side fails a test instead of silently
disabling the external-server override read. `src/agent/env.ts`'s restated `DRIVER_ENV_PREFIX`
needs no twin — it is exercised through `driverVariable()` in the same file.

## Tests

`test/agent-env.test.ts` — the identity assertion inside the existing X1 describe block (the
driver-vars enumeration block); no other suite due. The guard line itself has no mechanical check
(D1).
