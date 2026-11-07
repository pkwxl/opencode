# Step 046 — w8-adopt-reshape: adopt's test-channel gate + bare plan's phase-tail reshape

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W8-planning (the planning/boundary family: the standalone work-order
routes 0076, the driver test channel's derived condition 0083 D9 / 0142 D1,
plan's drift row 0053 D34 / 0101 D4/D6), findings **0165-094** (S07-04, S3)
and **0165-095** (S07-07, S3). Started 2026-11-07 at HEAD `51902f110`
(tree clean; steps 001–045 done; no recovery needed).

## Findings (from plans/0165-review/S07-planning-a.md)

- **0165-094 (S07-04)** — `plan --adopt` executes any `tmp/test.sh` with no
  channel gate: `adoptUnit` is never handed `testByDriver` or the phase, so a
  standalone session's marker runs as a driver process where the config turns
  the driver test channel off or the phase type is not code work. The export's
  render does receive `testByDriver` (the work order tells the session the
  channel is off) while the adopt step serves the same marker — the two
  channels disagree on one request, 0076 §2's "testByDriver unchanged" and
  0142 D1's "consumed and surfaced at every scope's close" both bypassed.
- **0165-095 (S07-07)** — bare plan still owns the phase-tail reshape in
  phased mode: row 3 re-syncs the tail uncommitted and teaches "re-run: plan",
  whose re-run then refuses naming transfer — two writers of one reshape
  (plan's uncommitted, transfer's committed `rederiveTail`), and the
  uncommitted one leaves `phases.md` dirty for transfer's own preflight.
  The drift machinery is phased-only (`phaseTailDrift` returns undefined in
  m mode), so the uncommitted apply was the pre-0101 residue in every state
  it could run.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0206** written first (Derives P2/P5/P8/P20; Amends 0053 D34's
   phased half, 0076 §2's premise, 0101 D6's mid-phase deferral and 0142
   D1's scope; premise guard against 0053 D34 / 0101 D6 (the transfer.test
   mid-phase pin) / 0076 §2; Category scope: the drift-apply family + the
   work-order test-handover family).
2. D1 (0165-094): `consumeDeadTestMarker` split into `dropDeadTestMarker`
   (the consume + its one wording, returning `{why, line}`) and the logging
   wrapper (byte-identical for the run flows); `adoptUnit` receives
   `testByDriver` + the route's `PhaseKey` and gates its test handover through
   the same derived condition (`testChannelOffFor`: the config flag AND the
   phase's code work) — a marker left where the channel is off is consumed
   with its ⚠ line riding the adopt's own outcome lines, never executed;
   plan's adopt caller threads the two facts the export already renders.
3. D2 (0165-095, the plan half): plan's row 3, phased, refuses before any
   write naming transfer as the reshape's apply — one refusal family for
   every channel (bare; input / --new-task / --export / --adopt with their
   resumption actions); m mode keeps the D34 uncommitted shape (unreachable —
   `phaseTailDrift` never reports an m-mode tail), the blocked arm (a value
   the sync refuses) unchanged.
4. D3 (0165-095, the apply's completion): the advance's mid-phase arm (route
   execute, no awaiting formulation — the state whose pinned shape was
   "refuses without re-deriving") re-derives the tail first, on the advance's
   own commit, before its "execute them first: run" refusal — with plan no
   longer applying, the refusal's teaching ("transfer re-derives it") must be
   true in every state, and the mid-phase run restart (run's drift stop →
   transfer → run) keeps its exit instead of a two-command loop.
5. D4 (0165-095, the run half): run's drift stop names transfer (the
   teaching follows the apply's one home); the comment restated (lifecycle
   belongs to the phased advance).
6. Pins: work-order.test.ts (the two gate arms — config off; flag on over a
   non-code phase — plus the channel-on execution re-pinned under
   `testByDriver: true`); plan.test.ts (the row-3 refusal pins re-pinned from
   the apply, the run-side stops re-pinned, the --export/--adopt channel);
   transfer.test.ts (the mid-phase pin re-pinned to the re-derivation).
   Fail-before on pre-fix source over a /tmp backup.
7. Full verification (`bun typecheck` + `bun test`; the packages/auto suite
   as a guard — its README's drift row is restated), docs (ruling 0206,
   INDEX row + annotations, AGENTS.md navigation, structure.md), ledger rows,
   program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over
/tmp/046-prefix and /tmp/046-fixed (the five changed src files backed up both
ways — HEAD's pre-fix content and the fixed working tree — the pre-fix files
swapped in, the suites run, the fixed files restored, cmp-verified
byte-identical, the suites re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3119 pass / 0 fail**
  (155 files) — the 3117/155 baseline + 2 net new tests (work-order +2, the
  plan drift describe net 0: the extend/shrink pairs test merged into the
  combined refusal pin, the --export/--adopt channel pin added), zero
  regressions; the doc-reading suites (constitution-ratchet,
  import-direction) re-run green after the full doc sweep (AGENTS.md,
  structure.md, INDEX.md, shell-contract.md).
- **packages/auto** (its README and one e2e drift pin touched): `bun
  typecheck` clean; **160 pass / 8 skip / 5 fail** (173 tests) — the exact
  baseline (the 5 = the pre-existing fork/remove-fork family, reproduced by
  name); the e2e drift test re-pinned to the new truth (run naming transfer,
  plan refusing before any write) — red on the pre-fix core source, green on
  the fixed one.
- **auto-server**: not run — no server source or surface touched.
- **Fail-before proof** (the new/re-pinned pins, each red on pre-fix source;
  the pre-existing tests of the three files green on it — the byte-identical
  floor):
  - work-order (0165-094): both gate pins red with the defect verbatim —
    `tmp/test.1.out` **exists** (the agent-authored script executed under the
    driver's process where the channel was declared off), the log showing
    "test script exit code 0"; the two channel-on execution pins (updated to
    `testByDriver: true`) green on pre-fix — the serving channel's floor;
  - plan (0165-095): 7 red — the row-3 refusal pins (bare, input,
    --export/--adopt, roadmap-moved, --new-task) receiving the pre-fix exit-0
    apply / the old re-sync spellings, and the two runAll stops receiving the
    old "run plan to re-sync" line; 48 green;
  - transfer (0165-095's D3 half): the mid-phase pin red — no re-derivation
    on pre-fix (the pinned "refuses without re-deriving" shape), no PLAN
    resync commit; 23 green.
  - Fixed sources restored byte-identical (cmp over all five), the three
    suites re-run 91/0 green.

## Dispositions

- **0165-094 (S07-04)** — **fixed** under ruling **0206 D1**: the adopt
  step's test handover gates through the channel's own derived condition
  (`testByDriver && codeWork(phase)`) — the two facts the export already
  renders, threaded by plan's `--adopt` caller (`phaseKey(route.phase)`, a
  phase-less call resolving onto implement). A marker left where the channel
  is off is consumed and surfaced through the 0142 D1 seam, split into
  `dropDeadTestMarker` (the consume + its one wording, returning the reason
  and the line) with `consumeDeadTestMarker` the byte-identical logging
  wrapper for the run flows; the ⚠ line rides the adopt's own outcome lines
  (both arms, where the executed handover's ⚙ report rides). Under a serving
  channel the handover executes byte-identically. Both gate arms pinned
  (config off outright over a code-work phase; flag on over analysis), the
  blocked arm's ⚠-first ordering included.
- **0165-095 (S07-07)** — **fixed** under ruling **0206 D2/D3/D4**: plan's
  row 3, phased, refuses before any write naming transfer as the reshape's
  apply — one refusal family, four channels (bare; input / --new-task /
  --export / --adopt with their resumption actions), the retired
  "run plan to re-sync" spellings dying with the apply they taught (their
  plan.test and shell e2e pins re-pointed in the same lockstep); m mode keeps
  the D34 uncommitted shape (unreachable — `phaseTailDrift` never reports an
  m-mode tail), the blocked arm unchanged. The apply's completion: the
  advance's mid-phase arm (execute route, no awaiting formulation — the state
  whose pinned shape was "refuses without re-deriving") now re-derives first
  on its own `phase-sync` commit ahead of its nothing-to-advance refusal
  (0101 D6's deferral amended, the transfer.test pin re-pinned), so the
  refusal's teaching is true in every state and the mid-phase run restart
  keeps its exit instead of a run↔transfer loop; no drift writes nothing (the
  floor pinned). run's drift stop names transfer (Q4 standing). The README's
  drift row and re-derivable-tail passage restated, the adopt section's
  handover sentence extended.
- **Discovered in-change** (recorded, unacted on): the shell's e2e drift test
  pinned the whole pre-fix flow (run naming plan → plan's exit-0 re-sync) —
  re-pinned as part of the family's lockstep, not a new finding; the
  mid-phase dead loop the narrow remedy would have introduced (run's stop
  naming transfer, transfer refusing without applying, run stopping again)
  is the measured ground for D3 — 0101-era `transfer.test.ts`'s own
  "refuses without re-deriving" pin documented the state that produced it.
  A final doc sweep (grep for the retired spellings over both packages)
  found four more stale teachings, all re-stated in this change:
  `docs/shell-contract.md`'s D34 paragraph (run's stop + plan's row 3),
  `packages/auto/README.md`'s init-validation line ("re-syncing belongs to
  `plan`") and its prefix-guardrail drift sentence, `packages/auto/AGENTS.md`'s
  prefix-guard line, and one e2e comment; the doc-reading suites
  (import-direction, constitution-ratchet) re-run green after them.
