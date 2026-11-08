# Step 061 — we-renderer-prose: the renderer-owned prose boundary and the bundle parse's nested validators

Wave WE-policy, findings 0165-047 (S23-05, S2, CONFIRMED — a P15 design challenge), 0165-159
(S23-04, S3, CONFIRMED). Started 2026-11-08 at HEAD `afd1c59bd` (step 060's commit); the tree was
clean.

## Scope

The two arms the S23 record names:

- **0165-047**: session-facing prose still lives in renderers — `verifyPlanCharterText`
  (`src/intent/guarantees.ts:158-165`), `scriptViolationLine` (`src/prompt.ts:302-310`),
  `closedPrerequisiteNotes` (`src/prompt.ts:1023-1029`), `renderFormulationTodo`
  (`src/prompt-plan.ts:365-475`, the largest instance) — with the conscious rulings underneath
  (0095 D4 "the todo assembly is code, consciously not template-driven in Stage 1"; 0053 D16
  "driver text, so no template changes"; 0083 D11's caller-side join). The finding frames this as
  a design challenge to those rulings under the current P15, offering two remedies: re-home the
  prose in templates/partials, or explicitly amend P15 and the navigation.
- **0165-159**: `parseIntentBundle` (`src/bundle.ts:80-85`) parses the pack through
  `parseIntentFile` but never the nested semantic grammars (`guaranteesProblem`,
  `testLanesProblem`), so a malformed `### asserts` line or test-lane row passes init's
  validate-before-write boundary and fails only at every later run's preflight, after
  materialization.

Standing rulings read before ruling: P15's statement and derivations (docs/principles.md), P7/P13
(the same read 0220 made), 0031–0034 (the intent/artifact machinery), 0079 §3 (the bundle parse's
no-writes contract), 0080 §2/§8 (the guarantees grammar; driver feedback scoped out of the gate),
0095 D4 (the formulation protocol), 0053 D16 (the prerequisite note), 0083 D11 (the violation
line), 0100 D8–D11 (the verify-plan key family and its audit spelling), 0158 (the
documents/parsers lockstep culture), 0214 (the provenance parses of the binary's own bundle),
0220 D3 (the guarantees validator made vocabulary-complete — the bundle-parse arm builds on its
optional-templates design). Evidence: the register rows at 0165 §5 (lines ~229 and ~341) and
plans/0165-review/S23-policy.md S23-04/S23-05.

## Recovery state (maintained during the step)

- Ruling: `plans/0221-renderer-prose-bundle-validation.md` (created first).
- Code: `src/bundle.ts` (D1 the nested validators inside parseIntentBundle); comment-only
  pointers at the D2 census sites (`src/intent/guarantees.ts`, `src/prompt.ts`,
  `src/prompt-plan.ts`, `src/formulate.ts`).
- Tests: `test/bundle.test.ts` (D1 malformed-body rows + the positive own-vocabulary row + the
  shipped-family census arm), the docs ratchet pin for D2 (test/prompt-template.test.ts, the
  0216 D3 pattern), and one same-lockstep fixture repair in `test/provenance.test.ts` (the
  older-binary simulation's invented `### verify-plan-OLD` key re-spelled to the historically
  real legacy letter `### verify-plan-t` — an invented key is a strict parse error since D1).
- Docs: `docs/principles.md` (P15's statement + derivations gain the named boundary),
  `AGENTS.md` (the prompt-copy navigation line), `docs/structure.md` (the prompt-assembly row),
  `plans/INDEX.md` (the 0221 row).
- Bookkeeping: this record, the program row/ledger/Current position.
- Discovered outside scope, recorded not fixed: none yet.
- Next action if interrupted: see the program's Current position.

## Findings → decisions (summary; the ruling is the authority)

| finding | decision |
| --- | --- |
| 0165-159 | 0221 D1 — `parseIntentBundle` captures the parsed pack and runs `guaranteesProblem` (with the bundle's own custom phase type ids; the template vocabulary omitted — the library half stays with run preflight per 0220 D3's split) and `testLanesProblem`, throwing before a materializable bundle is returned |
| 0165-047 | 0221 D2 — by-design with a named boundary: P15's "code never authors copy" is amended (statement + derivations in docs/principles.md) to name the two renderer-owned classes — driver document-grammar teaching and dynamic driver feedback — with 0095 D4 / 0053 D16 / 0083 D11 / 0080 §8 re-read standing; the AGENTS.md prompt-copy line and the structure.md prompt-assembly row corrected to the truth; a docs ratchet pin holds the boundary |

## Verification (filled at the step's end)

- `bun typecheck` exit 0.
- auto-core full suite **3213 pass / 0 fail** over 156 files (the 3210 baseline + 3 net new:
  bundle +2, prompt-template +1), zero regressions; one fixture repaired in the same lockstep
  (the provenance older-binary simulation, above).
- Fail-before proof over /tmp/061-fixed (`src/bundle.ts` backed up, the `git show HEAD:./`
  pre-fix version swapped in, the bundle suite run, the fixed file restored and cmp-verified
  byte-identical): **the extended invalid-bundles test red on pre-fix source** —
  `Received function did not throw` over the malformed-asserts bundle, the parsed bundle
  returned whole: the finding's own deferred-failure scene (BUNDLE ACCEPTED) verbatim; the
  other 15 tests green on pre-fix source (the floor — a valid pack and the shipped family
  parse on both).
- Shell guard run (no shell src touched; `packages/auto`'s init consumes the parse):
  typecheck clean, **auto 159 pass / 8 skip / 6 fail** — the exact recorded baseline, every
  failure name matching the known environment-drift family (fork/remove-fork ×5, the
  phased-flow e2e ×1). auto-server untouched and not run (no bundle-parse surface — the
  register's S30 note).
- D2 changes no code behavior (comment pointers aside): every render byte-identical, no
  golden touched, the full suite's prompt/golden arms green unchanged.

## Result

Committed as the step's commit (subject `0166: step 061 done — ruling 0221 the renderer-owned
prose boundary and the bundle parse's nested validators`); the SHA is recovered from git history
by the next invocation.
