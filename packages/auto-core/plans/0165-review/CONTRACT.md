# The 0165 review contract — read once per step session

Every step of [the 0165 review](../0165-three-package-review.md) follows this contract. It is short on purpose:
read it, then read only your step's brief (`steps.md`, your `## Sxx` section) and the inputs it names.

## Hard rules

- **Read-only on the repository.** Never edit, create or delete anything under `/workspace/aseo/opencode` except
  your own output file `plans/0165-review/Sxx-<slug>.md` and your row in the plan's status table. Never run
  `git commit/stash/checkout/reset/branch/worktree add`, `bun install`, `UPDATE_GOLDEN=1`, `UPDATE_TURN_TRACE=1`, or
  anything with `OPENCODE_AUTO_E2E`. Read-only git (`log`, `show`, `blame`, `diff`, `grep`) is fine.
- **No subagents.** One step, one session, one context. Start each step in a fresh session (or after `/clear`).
- **Never write a `.ts` file inside the repository** — the package's `tsconfig.json` has no `include` (typecheck
  covers every `.ts` file) and `bun test` discovers every `*.test.ts`. Scratch work lives in a temp directory.
- **Cite at the HEAD you read.** Record `git rev-parse --short HEAD` at step start in your output header. Baseline is
  `d579016b2` (= `358be4003` + plan 0164). If HEAD moved, run `git diff --stat d579016b2..HEAD -- <your scope>` and
  cite current lines for changed files.
- **Do not edit plan originals** (`plans/NNNN-*.md` are immutable history). Remedies go to code, docs/, INDEX
  annotations, or a future ruling.

## Context budget (the reason this review is shaped as steps)

- Read in full only scope files ≤ 600 lines. Larger files: read the header comment (first ~60 lines), then
  navigate by symbol (`grep -n` → `sed -n 'a,bp'`), reading the functions your questions need.
- Tests: never read a whole test file; `grep -n` for the behavior, then read the one case.
- Do not re-run the full suites (S00 did). Run only targeted tests (`bun test test/x.test.ts -t "<name>"`) and leads.
- Do not re-derive what an earlier step recorded; the plan's digest and earlier `Sxx-*.md` files are inputs.
- **Write as you go**: create your output file at step start (header + empty sections), append each finding when
  you have it, and update `## Coverage` after each file. A session that dies mid-step leaves a resumable record.
- Output cap: ≤ 15 findings, ≤ ~200 lines. Aggregate S4 hygiene per file family into one finding.

## Reproduction harness (verified working)

```sh
T=$(mktemp -d /tmp/rv0165.XXXX)        # scratch dir OUTSIDE the repo
cp plans/0165-review/leads/<lead>.test.ts.txt $T/<lead>.test.ts   # or write your own test there
# a lead's TMP constant points at a dead scratchpad path: set it to "$T/tmp" before running
cd $T && env -u OPENCODE_AUTO_MODELS XDG_CONFIG_HOME=$T/xdg timeout 300 \
  bun test --preload /workspace/aseo/opencode/packages/auto-core/test/preload.ts ./<lead>.test.ts
```

Scratch tests import core sources by absolute path (`/workspace/aseo/opencode/packages/auto-core/src/<mod>.ts`,
fixtures from `.../auto-core/test/fixtures/*.ts`). Temporary git repositories go under `$T`. Ambient
`OPENCODE_AUTO_*` must be unset (`env | grep OPENCODE_AUTO_` empty). The shells have no bunfig test preload.

## Finding record (one JSON object per line, in a ```jsonl block)

`{"id":"Sxx-NN","title":"…","sev":"S1|S2|S3|S4","conf":"CONFIRMED|PLAUSIBLE","cat":"…","measures":["P12","0155 D1"],"loc":["auto-core/src/git.ts:412"],"symbol":"…","evidence":"quoted code or output","repro":{"cmd":"…","observed":"…"}|null,"impact":"inputs/state → wrong outcome","remedy":"what to change, where it lands","family":["other homes of the same rule"],"prior":"NEW|REGRESSION|RESIDUAL-01NN|RECORDED-0NNN|LEAD","wave_hint":"…"}`

Paths are relative to `/workspace/aseo/opencode/packages/`.

- **Severity.** S1: durable state or the person's work lost/corrupted; a false PASS or silently wrong verdict; a
  secret leak or auth bypass; a reachable Tier I violation. S2: reachable wrong behavior that is loud or
  recoverable; a reachable Tier II violation; a doc that misleads the person into a destructive act. S3: latent or
  edge-case defect; harmless doc/code divergence; governance-record defect; untested ruled requirement. S4: hygiene.
- **Confidence.** CONFIRMED only with a reproduction (observed output recorded) or a deterministic trace with every
  caller enumerated; otherwise PLAUSIBLE, saying why reproduction was infeasible. S1/S2 need a repro attempt.
- **Categories.** DEF (defect) · FAIL (failure direction) · STATE (durable state / crash-consistency) · CONC ·
  SEC · BOUND (boundary / ownership) · DUP · VOCAB (frozen vocabularies) · DOC · TRACE (requirements
  traceability) · TEST · CPLX (complexity / P21) · UX (remedy teaching) · GEN (genericity, P16).
- **Before reporting**, grep the corpus (`plans/`, `docs/principles.md` registers T1–T9/R1–R7) for the behavior: a
  deliberate ruling is not a defect — drop it, or report a design challenge (CPLX/BOUND) naming the ruling and why.
  A plan-named deferred residual → `prior: "RESIDUAL-01NN"`. A salvaged lead you confirmed → `prior: "LEAD"`.

## Output file `plans/0165-review/Sxx-<slug>.md`, sections in order

1. Header — step id and title, date, HEAD read, status (`in progress` / `done`).
2. `## Coverage` — every scope file: `deep` / `partial (which symbols)` / `probe (grep only)`.
3. `## Findings` — the jsonl block; then for each S1/S2 a short step-by-step failure scenario.
4. `## Leads` — each salvaged lead for this step: confirmed (finding id) / refuted (why) / not run (why).
5. `## Residuals` — each named prior residual: still open / fixed / now a defect — evidence — finding id.
6. `## Verified clean` — ≥ 3 invariants checked and holding, each with its location.
7. `## Design notes` — ≤ 8 lines: the area's health, best and worst choice, what to change first.
8. `## Seam notes` — open questions for named later steps (they read these).

## Lenses (primary — the 2026-10-30 review's lenses are used only for residual re-checks)

Cross-ruling interaction (two rulings on the same state) · crash-consistency (a kill between two durable writes:
does recovery re-derive, P6, and never destroy in-flight work, P20) · trust boundary & secrets (references never
values; agent output and target files steer nothing beyond the driver's grammar, P7) · test-oracle quality (does a
test pin the ruled behavior or the current implementation) · remedy teaching (every stop line teaches a true
remedy, P8) — plus ordinary expert review: correctness, failure direction, lifecycle, concurrency, edge cases,
single ownership (P5), duplication, speculative machinery (P21), doc-vs-code truth for the step's docs.
