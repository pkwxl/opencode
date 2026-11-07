# Step 060 — we-override-guards: the override guard's completeness and the assert vocabulary

Wave WE-policy, findings 0165-044 (S23-01, S2, CONFIRMED), 0165-045 (S23-02, S2, CONFIRMED),
0165-046 (S23-03, S2, CONFIRMED). Started 2026-11-08 at HEAD `c042f38f6` (step 059's commit); the
tree was clean.

## Scope

The tier-1 marker table's coverage (`src/template.ts` `PROTOCOL_MARKERS` — the decompose family's
Artifacts protocol, the whole/subtask/fix/fanout/handoff-steer handover and split protocols, the
winddown note's remaining figure) and the guarantee assertion's target vocabulary
(`src/intent/guarantees.ts` `guaranteesProblem` — unknown template names and phase qualifiers).
Standing rulings read before ruling: 0033 D4/§3–§4 (the two-tier marker model, `registerPartial`,
the accepted known-breakage class), 0080 §2/§7 (the guarantees grammar, the render gate, the
ratchet semantics), 0095 D4 (the retired phase-plan template's asserts keep their meaning on the
formulation todo assembly), 0096 D6 (the task `Artifacts:` field), 0035 D2 (case-insensitive
`artifacts:` must not silently yield zero specs — the parser-side leniency the guard's strict
literal compensates). Evidence: the register rows at 0165 §5 (lines 226–228) and
plans/0165-review/S23-policy.md S23-01/S23-02/S23-03.

## Recovery state (maintained during the step)

- Ruling: `plans/0220-override-guard-completeness.md` (created first).
- Code: `src/template.ts` (D1+D2 the marker table), `src/intent/guarantees.ts` (D3 the assert
  target vocabulary), `src/loop-preflight.ts` (D3 the caller threading the live template names).
- Tests: `test/template.test.ts` (the repaired subtask fixtures + the new rejection arms),
  `test/prompt-exec.test.ts` (the repaired decompose-m fixture — the finding's own permissive
  blessing — plus its render assertion), `test/intent.test.ts` (D3 unit arms),
  `test/loop-preflight.test.ts` (D3 preflight arm), `test/intent-guarantees.test.ts` (the census
  strengthened onto the real vocabulary), plus a `test/template.test.ts` lockstep pin binding the
  decompose marker sets to `SUBTASK_TODO_SECTIONS` + the `Artifacts:` token.
- Bookkeeping: this record, the program row/ledger/Current position, `plans/INDEX.md` (the 0220
  row), `AGENTS.md` (the prompt-copy / intent-selection navigation lines),
  `docs/structure.md` (the template-registry and intent rows).
- Discovered outside scope, recorded not fixed: none beyond the S23 record's own family notes
  (S23-04 bundle-parse validation is finding 047/step 061; S23-05 the P15 ↔ 0053/0095 tension is
  the renderer-prose step's; the raw-marker/conditional limitation is the ruled accident-guard
  posture, not a defect).
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
| --- | --- |
| 0165-044 | 0220 D1 — all seven decompose marker sets gain `Artifacts:`, `## Scope`, `## Artifacts` (the declaredArtifacts token + SUBTASK_TODO_SECTIONS, the parser-side lockstep source, pinned by a new ratchet test); the permissive fixture repaired to keep the real grammar, rendering it through decOf |
| 0165-045 | 0220 D2 — whole gains the park/continue/done statuses, {{handoffFile}}, {{subtasksFile}} and the split grammar (`Depends:`/`Artifacts:`); subtask and fix gain the status pair + {{handoffFile}}; fanout and handoff-steer gain {{handoffFile}}; usage-note-winddown gains {{remaining}} (the finding's family note) |
| 0165-046 | 0220 D3 — `guaranteesProblem` validates every assert's template against the caller-threaded live vocabulary (promptTemplateNames + the `phase-plan` assembly key) and every phase qualifier against the phaseTag range (builtin preset letters + declared custom ids), rejecting with a remedy naming the available values |

## Verification (filled at the step's end)

- `bun typecheck` exit 0.
- auto-core full suite **3210 pass / 0 fail** over 156 files (the 3204 baseline + 6 net new:
  template +2, intent +2, loop-preflight +2), zero regressions.
- Fail-before proof over /tmp/060-fixed (the three changed src files backed up, `git show HEAD:./`
  pre-fix versions swapped in, the pins run, the fixed files restored and cmp-verified
  byte-identical): **6 tests red on pre-fix source** — D1's seven-variant ratchet (the
  protocol-free overlay's missing list stopping at `todo.md`, no `Artifacts:, ## Scope,
  ## Artifacts`) and its two per-family arms (the scope-headings overlay and the token-dropping
  overlay both loading clean — the finding's silent zero-specs scene), D2's execution-family test
  (the `whole.md` overlay with no handover or split channels loading clean — no throw, the
  finding's repro verbatim) and the handoff-steer drops-path arm (statuses kept, `{{handoffFile}}`
  dropped, loading clean), D3's two unit tests (`guaranteesProblem(typo, [], vocabulary)`
  returning undefined — the inert assertion verbatim — and the unknown phase qualifier likewise)
  and D3's two preflight tests (the run proceeding past the guarantees check, no exit 1). The
  floors green on pre-fix source (the repaired fixtures — the protocol-keeping subtask/decompose-m
  overlays and the strengthened census — pass on both sides, the lockstep repairs they are; every
  other pre-existing test of the touched files).
- No shell suite re-measured — no packages/auto or auto-server surface touched (no overlay
  fixture of the affected templates exists in either shell, grepped before the change; the
  step-050 environment-drift records stand for the next shell-touching step).
