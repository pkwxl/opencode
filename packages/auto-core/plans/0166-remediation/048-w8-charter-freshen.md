# Step 048 — w8-charter-freshen: charter-check fallback rendering, freshen scope, format-sketch terminator

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W8-planning (the planning/boundary family: the record-time charter check's
fail-closed rendering 0082 §10 D12/D14b / 0113 D1's audit-truth pattern, the
compose loop's remediable-source contract 0156 D4 / 0082 §5 D7, the
formulation todo's session-facing format sketch 0131 D1/D2), findings
**0165-097** (S08-02, S3), **0165-098** (S08-03, S3) and **0165-099**
(S08-05, S3). Started 2026-11-07 at HEAD `030b0bb94` (tree clean; steps
001–047 done; no recovery needed).

## Findings (from plans/0165-review/S08-formulation.md)

- **0165-097 (S08-02, S3, P12)** — the record-time charter check's fail-closed
  result is indistinguishable from a real flag: a 60 s timeout, a session
  error or an unparsable reply returns `flagged` with the OPEN reading and a
  `reason` the type drops and no caller logs — the admission warn tells the
  person their planning input conflicts with the charter and commits that WARN
  into the round's audit wall; in the clamp path every recorded AUTO-RESOLVE
  default is clamped to OPEN with no line saying the check never ran (the
  fail-closed direction is ruled; its silence is not).
- **0165-098 (S08-03, S3, 0156 D4)** — 0156 D4's freshen stops at the
  planning input and the brief, but the remediation executor also rewrites the
  round brief, the analysis and the handovers (every role
  `editableSurfaceProblem` passes, and the block map names them as located
  sources): an executed round.md option is committed, the second compose
  verifies the stale entry-time capture, re-blocks, and the run ends on a
  "diagnosis failed closed" line teaching a model fix for a stale read.
- **0165-099 (S08-05, S3, 0131 D1/D2)** — the formulation session never sees
  the format sketch's closing terminator: `taskBody` drops every standalone
  `<!-- auto: eof -->` line from the body the whole-task prompt renders, so
  the sketch the session copies ends at `<acceptance: …>` — the likely cause
  of 0131's 38/38 omission, which 0131 attributed to "an HTML comment reads
  as decoration" and left "the sketch itself unchanged".

## Plan (enactment order; each ingredient lands green)

1. Ruling **0208** written first (Derives P12/P8/P18/P6/P20/P7/P19/P15;
   Amends 0156 D4's remediable-set premise; premise guard against 0156 D4
   (the freshen's captured set) and 0131 D1/D2 (the incident's measured
   cause); Category scope: the charter-check verdict-rendering family, the
   compose loop's source-freshen family, the body-reader terminator family).
2. D1 (0165-097): `CharterCheck` gains a `failed` arm
   (`{ kind: "failed"; reading; reason }` — the strict reading rides along so
   the kernel-side clamp caller reaches no policies import);
   `admissionWarn` renders it as "could not be judged — no conflict
   recorded" (one ⚠ log line + a FAILED-shaped audit entry, verifyAuditEntry's
   pattern), a WARN only for a real flag; the clamp keeps the ruled
   fail-closed direction (clamp to the strict reading) with the ⚡ line naming
   the failure.
3. D2 (0165-098): `formulationParts` split — the digest half (prior
   knowledge / prev round, the one statsDigest booking, the cap decision)
   reads once at entry (0156 D4's residual reason, kept and now scoped to it);
   the side-effect-free half (handovers joined + per-doc, the round brief,
   the analysis) re-reads before every compose pass through the same one
   derivation.
4. D3 (0165-099): `taskBody` strips only the document's own trailing
   terminator (its last non-empty line), never an interior standalone
   terminator — the format sketch's terminator is body content the session
   must see and copy; every ordinary document's body byte-identical.
5. Pins: charter-clamp.test.ts (the failed arm's clamp + named-failure line),
   agent-fake.test.ts (the admission failed arm through the loop: the
   ⚠ could-not-judge line, the FAILED audit entry, no WARN, the run
   proceeding), blockage-diagnosis.test.ts (the round.md remediation reaches
   the second pass beside the planning-input pin), tasks.test.ts (the body
   carries the sketch's terminator; the document's own terminator still
   stripped). Fail-before on pre-fix source over a /tmp backup.
6. Full verification (`bun typecheck` + `bun test`), docs (ruling 0208,
   INDEX row + the 0156 D4 and 0131 annotations, AGENTS.md navigation,
   structure.md), ledger rows, program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over
/tmp/048-prefix and /tmp/048-fixed (the four changed src files —
`prompt-verify.ts`, `loop-plan.ts`, `charter-clamp.ts`, `tasks.ts` — backed up
both ways: HEAD's pre-fix content and the fixed working tree; the pre-fix
files swapped in, the suites run, the fixed files restored, cmp-verified
byte-identical, the suites re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3131 pass / 0 fail**
  (155 files) — the 3126/155 baseline + 5 net new tests (charter-clamp +1,
  agent-fake +1, blockage-diagnosis +1, tasks +2), zero regressions; the
  doc-reading suites (import-direction, constitution-ratchet) and the golden
  suite re-run green after the doc sweep (AGENTS.md, structure.md, INDEX.md).
- **packages/auto / auto-server**: not run — no shell or server source or
  surface touched (no template, README or e2e surface names a changed
  literal; the four src changes are core-internal).
- **Fail-before proof** (each of the 5 new pins red on pre-fix source; the
  201 pre-existing tests of the four touched files green on it — the
  byte-identical floor):
  - charter-clamp (0165-097's clamp half): red — the failed arm not existing
    pre-fix, the fake's `{kind:"failed"}` falling into the flagged path: the
    ⚡ line carrying no "the check could not judge" clause (the silence the
    finding names);
  - agent-fake (0165-097's admission half): red — the old "⚠ the planning
    input conflicts with the intent charter" line and the audit's `WARN — the
    planning input conflicts with the charter; in force: no default in
    force…` committed against the person's consistent words (the defect
    verbatim, the flaky-endpoint shape the finding reproduced);
  - blockage-diagnosis (0165-098): red — exit 2 with the stale-capture
    re-block (the second verify seeing the entry-time round brief, the run
    ending blocked after the person's executed remediation landed and was
    committed); green for the fix with exit 0, 2 verdicts, the remediated
    round.md on disk and the formulation prompt free of the contrary
    sentence;
  - tasks (0165-099, both pins): red — the quoted interior terminator
    stripped from the body, and the formulation todo's session-facing body
    carrying zero standalone terminator lines (the sketch ending at
    `<acceptance: …>`, 0131's omission shape verbatim);
  - the fixed sources restored byte-identical (cmp over all four), the four
    suites re-run 206/0 green.

## Dispositions

- **0165-097 (S08-02)** — **fixed** under ruling **0208 D1**:
  `CharterCheck`'s fail-closed return is its own `failed` arm
  (`{ kind: "failed"; reading; reason }` — the strict reading riding in the
  arm so the kernel-side clamp caller needs no policies import); the
  admission warn renders it as one ⚠ "could not be judged — no conflict
  recorded" line plus a `FAILED — …` audit entry in `verifyAuditEntry`'s
  pattern (the wall never implying a verification that did not run, 0113
  D1), a WARN a real flag's alone (the flagged flow byte-identical); the
  clamp keeps the ruled fail-closed direction (the item clamped to the arm's
  reading through the same `clampItem` — the ledger mark and the re-record)
  with the ⚡ surfaced line naming the failure. The treat-as-skipped
  alternative declined: it would leave the wider grant in force unjudged —
  the direction is the ruling (0082 §10 D12), the silence was the defect.
- **0165-098 (S08-03)** — **fixed** under ruling **0208 D2**:
  `formulationParts` split per 0156 D4's corrected premise — the booking half
  (the prior-knowledge/previous-round digest texts, the cap decision, the
  one `statsDigest` booking) plus the driver-exclusive phase state (and its
  `trimmedPhases` derivation) read once at entry; the side-effect-free half
  — the joined handovers, the per-document list with its health findings,
  the round brief, the analysis — re-read before every compose pass through
  the one `readFormulationSources` derivation (`freshen` assigning into
  `parts`), so an executed remediation of any source the executor's channel
  table passes is verified as landed. 0156 D4's INDEX row annotated; the
  digest half's own sources' mid-pass remediation named as the residual
  (unmeasured, the booking/cap-identity cost real — P21).
- **0165-099 (S08-05)** — **fixed** under ruling **0208 D3**: `taskBody`
  strips only the document's own trailing terminator (its last non-empty
  line — the `endsWithEof` rule at the reader too), keeping every standalone
  terminator inside the body: the format sketch's terminator now reaches the
  session's prompt and agrees with the 0131 protocol line beside it; every
  ordinary document's body byte-identical (the existing taskBody pins green
  on the fix). 0131's INDEX row annotated with the corrected measured cause
  (the sessions copied a sketch that ended at `<acceptance: …>` — the body
  reader stripped the mark, not "an HTML comment reads as decoration"); the
  teaching itself stands as landed. The indent/fence alternative declined
  (it would teach a shape the format's own words call "exactly", the defect
  was the reader's).
- **Discovered in-change** (recorded, unacted on): none beyond the ruling's
  named residuals. Noted: the agent-fake fixtures' default turn echoes the
  whole prompt back as the reply, so the admission charter check in the
  pre-existing verifier tests flags with the default-check template's own
  placeholder `Clamp:` line (a parsed flag, unchanged behavior pre and post
  — the D1 change touches only the unparsable/timeout/error arm; the new pin
  scripts the unparsable reply explicitly).
