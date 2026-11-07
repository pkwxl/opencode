# Step 054 — w-provenance: the body-only direction label, the interrupted applySync, the direction-test oracle

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-provenance, findings **0165-043** (S22-01, S2), **0165-154** (S22-02,
S3) and **0165-158** (S22-08, S3). Started 2026-11-08 at HEAD `6156738cb`
(steps 001–053 done); ruled by
[../0214-provenance-body-direction.md](../0214-provenance-body-direction.md).

## Findings (from plans/0165-review/S22-config.md)

- **0165-043 (S22-01, S2, DEF, 0100 D2)** — a body-only provenance
  difference is labelled `binary-newer` whichever binary is older: the
  direction ternary (`removed.length === 0 ? "binary-newer" : …`) sends a
  sha-differing, heading-identical file into binary-newer, so fix/status
  assert "the running bundle is newer", the preflight notice's aggregate
  says "can fast-forward to the running binary's bundle (sync)", and
  `formatSyncPlan` prints its downgrade caveat only for `binary-older` —
  a project materialized by a NEWER binary opened by an older one is told
  to sync and the confirmed sync silently writes the older bytes over the
  newer committed pack (0100's own second-checkout scene).
- **0165-154 (S22-02, S3, STATE, P6)** — a crash mid-applySync (managed
  files written, the sidecar rewrite never reached) leaves disk = the
  binary's bytes while the stamp still holds the old digests:
  `compareProvenance`'s only remaining branch classifies person-edited,
  sync's edited branch stands on the old stamp entry forever, and every
  later fix/status/sync reports a file the person never touched as
  "edited after materialization" with no convergence path.
- **0165-158 (S22-08, S3, TEST, 0100 D2)** — the provenance direction
  tests pin only heading-delta cases; the body-only (direction-ambiguous)
  case is unpinned — the oracle gap behind 0165-043. Resolves as coverage
  landing alongside 043's fix.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary per finding first. Write
   ruling **0214** first (Status: active; Derives with showing clauses;
   Category scope; D1–D3; premise guard re 0100 D2; named residuals).
2. Enact per decision; regression pins that fail on pre-fix source
   (both time-directions of the body-only case, every message surface,
   the interrupted-applySync convergence).
3. Full verification (`bun typecheck`, `bun test`; baseline 3169/0/155).
   Core-only homes expected — the shells print the core formatters'
   output verbatim; no packages/auto or auto-server source touched.
4. Docs lockstep (INDEX row + the 0100 annotation, AGENTS.md navigation
   line, structure.md rows), ledger rows for 043/154/158, program
   position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `6156738cb`). Read the S22-01/S22-02/S22-08 evidence, the source
  homes (provenance.ts's direction ternary and the three message
  surfaces; sync.ts's planSync edited branch, the SyncEntry direction
  union, formatSyncPlan's single caveat), every consumer (bundle.ts /
  config-fix.ts / status.ts / driver-helper.ts / loop-preflight.ts all
  route through `provenanceComparison` + the core formatters; the shells
  print `formatSyncPlan` verbatim — no shell-side wording pin exists,
  verified by grep over packages/auto and auto-server), plans/0100 D1–D5
  and docs/principles.md (P6/P12/P13 for the rulings; 0158 D-notice for
  the aggregate). Ruling 0214 written first.
- 2026-11-08: enactment — provenance.ts (D1 the additive `body-only`
  direction value in the ternary, the type union and the grammar comment;
  the findings arm "the running bundle differs in body only (either
  binary may be newer)"; the notice's per-file body-only arm and its
  fourth aggregate, ordered after predates and retired), sync.ts (D1 the
  fast-forward direction union widened, the caveat's body-only second
  arm; D2 the additive `re-stamp` entry — the edited branch's
  disk = binary convergence, the stamp entry moving to the binary's
  digests with the file never written; the header comment's
  stamped-project description extended).
- 2026-11-08: test homes — provenance.test.ts (+1: the both-directions
  pin — scene A materialized from a body-reworded older bundle against
  the current binary, scene B the current bundle against a body-reworded
  older binary, asserting the one honest answer at the comparator, the
  finding and the notice), sync.test.ts (+2: the body-only fast-forward
  caveat pin over the aged-reworded fixture; the interrupted-applySync
  convergence pin — plan.writes applied with stampText withheld, the
  re-plan re-stamping, the file byte-identical, detection silent
  after). One in-change repair: the first draft's assertHonest helper
  took the `materialized()` record instead of its `.dir` — caught by
  typecheck, fixed before any test run.
- 2026-11-08: fail-before proof over /tmp/054-fixed (the two changed src
  files backed up, `git show HEAD:./` pre-fix versions swapped in, the
  pins run, the fixed files restored and cmp-verified byte-identical);
  full verification; docs lockstep (the 0214 INDEX row + the 0100
  annotation, the AGENTS.md provenance navigation line, the structure.md
  rows for both modules); the program status/ledger/position updated;
  committed.

## Verification

`bun typecheck` exit 0; auto-core full suite **3172 pass / 0 fail** (155
files = the 3169/155 baseline + 3 net new, zero regressions). Fail-before
proof over /tmp/054-fixed: **3 pins red on pre-fix source** —

- D1 comparator (1 pin, both scenes): `direction` received
  **"binary-newer"** where `body-only` is expected — the guessed label
  verbatim, in the scene where the running binary is the older one too;
  the finding then reading "the running bundle is newer" and the notice
  "can fast-forward to the running binary's bundle" (`not.toContain`
  failures behind the first).
- D1 sync caveat (1 pin): the fast-forward entry received
  `direction: "binary-newer"` over the body-only fixture, so the
  direction-unknown caveat line was absent from `formatSyncPlan`.
- D2 (1 pin): the interrupted-applySync scene received
  `{action: "edited", onDisk: true, …}` where `re-stamp` is expected —
  the person-edit misattribution verbatim, the pre-fix dead-end (the
  stamp entry standing, sync never converging).

The floors green on pre-fix source (all 26 pre-existing tests of the two
touched files — every named-direction case, the 0158 notice pin, the
stale-pack detection sites, the bootstrap, extras, retired, open-round,
formatSyncPlan's line pin). No packages/auto or auto-server source
touched: the shells print the core formatters' output verbatim (no
wording pin exists in either package, verified by grep before the
change), so the step-050 environment-drift records stand unmeasured this
step.

## Dispositions

- **0165-043 (S22-01, S2)** — fixed (ruling 0214 D1): the direction
  vocabulary grows additively with `body-only`; the finding, the notice
  (per-file and aggregate) and the sync plan's caveat all derive their
  honest arm from the one value; the unqualified fast-forward aggregate
  and the bare "the running bundle is newer" are unreachable for the
  ambiguous shape; the three named directions byte-identical.
- **0165-154 (S22-02, S3)** — fixed (ruling 0214 D2): sync's edited
  branch converges the tool's own interrupted write (disk at the
  binary's bytes under a stale stamp) by `re-stamp` — the file never
  written, the sidecar rewrite riding the byte-honest gate, detection
  silent after; the comparator's person-edited classification unchanged
  (honest at detection time). Named residuals: the byte-identical
  hand-copy indistinguishable (content truth), the
  interrupted-older-sync-under-newer-binary scene degrading to an
  ordinary fast-forward, fix/status reporting the shape until the
  person runs sync.
- **0165-158 (S22-08, S3)** — fixed as coverage landing with 043's fix
  (ruling 0214 D1/D3; no separate source change — the gap was 043's
  defect): exactly what landed is the both-time-directions body-only pin
  in test/provenance.test.ts (the comparator's value, the finding's
  wording, the notice's aggregate and per-file arms — the oracle gap's
  both directions) plus the body-only caveat pin in test/sync.test.ts
  (the direction label and the plan line the confirmed sync prints);
  every pre-existing direction case keeps pinning the named directions.
- Premise guard: 0100 D2's direction premise re-read and its INDEX row
  annotated in the same change; 0158's notice rule re-read, standing
  unannotated (extended by its own terms, the finding record's own
  note).
- Commit: the step's single coherent commit (subject "0166: step 054
  done — ruling 0214 …", finding ids in the body's trailing
  parenthetical); the SHA recorded in the program table's row by the
  next step's start HEAD convention.
