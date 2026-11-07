# Step 044 — w8-clarify-state: clarify's state resolution + the review print's round-brief proposals

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W8-planning (the planning/boundary family: `src/clarify.ts` + `src/phases.ts`
+ `src/analysis.ts` + the shell's clarify row, 0116; assisted-planning preparation
0084/0085/0101/0172; the round-brief proposal channel 0101/0114/0115/0136/0158),
findings **0165-012** (S07-02, S2) and **0165-096** (S07-08, S3).
Started 2026-11-07 at HEAD `dc75d2154` (tree clean; steps 001–043 done; no
recovery needed).

## Findings

- **0165-012 (S07-02, S2)** — clarify resolves the analysis gate first in every
  state, not only at the project start. 0116 D1's own definition scopes the
  analysis moment to "the unreleased analysis **at the project start**" and its
  detection order rests on a "sequential by construction" claim, but
  establishment never requires the analysis: with `OPENCODE_AUTO_ANALYSIS=off`
  the transfer/plan rows establish from config with the stub on disk (0101 D8),
  and the analysis is a living document a person may draft at any time. Past
  R-01's establishment an unreleased `docs/analysis.md` therefore captures the
  command: (a) the switch-off stub holds the held survey's release under
  analysis problems — the survey gate unreleasable by the command its own stop
  names first; (b) a valid later-drafted analysis is released and committed in
  the survey's place under a false "R-01 opens / the brief installs" next line —
  a consequential release the person never chose (the roadmap goes into force
  mid-project, 0114 supersession) and a brief install only projectStart
  performs. The analysis gate's own condition (`analysisOn && round === 1 &&
  !roundRoot(dir, 1)` — plan.ts:~248, transfer.ts projectStart) is the state
  predicate clarify does not share.
- **0165-096 (S07-08, S3)** — the analysis review print (0116 D3: "the command
  is the review: print what the release accepts") omits the `## Round briefs`
  proposals: the print list (roadmap lines, forks, brief presence) was ruled
  after 0115's channel and never names it, yet each released `### R-NN`
  installs verbatim at that round's open and skips the round-start gate on the
  strength of this one mark. A stale or agent-drafted proposal rides the
  release unseen (S07-03's write boundary is the sibling question, step 012's).

## Plan (enactment order; each ingredient lands green)

1. Ruling **0204** written first (Amends 0116 D1/D3; Derives P2/P5/P8; premise
   guard against 0116's construction claim; Category scope). The design ruling:
   D1 the analysis branch is taken only while no round is established (the
   gate's own project-start condition, `currentRound === 1 && !roundRoot(1)`,
   the switch deliberately not imported — recorded residual); past it an
   unreleased analysis is one note line beside the survey branch's result (the
   refusal's analysis bullet a third spelling), never the target; D2 the
   review print lists every `### R-NN` round-brief proposal from analysis.ts's
   own parser, with the absent-posture line; D3 the header's construction claim
   restated.
2. Enactment in `src/clarify.ts` only (no `src/phases.ts`, `src/analysis.ts`,
   or shell change — the round-brief parser already exists and exports; the
   shell row's "at the project start" was already truthful).
3. Pins in `test/clarify.test.ts`: the two probe shapes of 0165-012 (stub
   beside a held survey — the survey releases, the stub untouched; valid
   analysis beside a held survey — the survey releases, no analysis commit,
   the note present) + the refusal's third spelling + 0165-096's review pins
   (per-proposal lines, the absent line). Fail-before on pre-fix source.
4. Full verification (`bun typecheck` + `bun test`; no shell package source
   touched), docs (ruling 0204, INDEX row, AGENTS.md clarify navigation line),
   ledger rows, program position, single commit.

## Verification

All measured on the committed-state sources; the fail-before proof over the
/tmp/044-fixed backup (the fixed `src/clarify.ts` backed up, HEAD's pre-fix
source written in, the suite run, the fixed file restored and cmp-verified
byte-identical, the suite re-run green).

- **auto-core**: `bun typecheck` clean; full suite **3111 pass / 0 fail**
  (155 files) — the 3107/155 baseline + the 4 new tests, zero regressions; the
  constitution ratchet re-run green after the doc edits (INDEX row + 0116's
  row annotated, AGENTS.md clarify line, structure.md Clarify row).
- **packages/auto** (guard run — no auto source touched): `bun typecheck`
  clean; **160 pass / 8 skip / 5 fail** (173 tests) — the exact baseline; the
  5 = the pre-existing fork/remove-fork family (fork ×2, remove-fork ×3),
  identical names to step 043's verified baseline.
- **auto-server**: not run — no auto-server source or surface touched.
- **Fail-before proof** (4 pins, each red on pre-fix source, the 7 pre-existing
  clarify tests green on it — the byte-identical floor):
  - the review pin (0165-096): Expected true / Received false — the `### R-01`
    proposal line missing from the review print;
  - the stub pin (0165-012 repro a): Expected "released" / Received "held" —
    the stub's analysis problems captured the command at the held survey;
  - the later-drafted pin (0165-012 repro b): Expected true / Received false —
    the survey's release line missing (the analysis was released in its place);
  - the refusal pin (0165-012's refusal half): Expected "held" / Received
    "released" — the analysis released at the interrupted-establishment state.
  - Fixed source restored byte-identical (cmp), the suite re-run 11/0 green.
- Focused runs during enactment: the clarify suite 11 pass / 0 fail after the
  pins landed (7 pre-existing + 4 new).

## Dispositions

- **0165-012 (S07-02)** — **fixed** under ruling **0204 D1/D3**: the analysis
  branch is taken only while no round is established — the gate's own
  project-start condition (`currentRound === 1 && !roundRoot(1)`), the switch
  deliberately not imported (the release's consequences are posture-blind;
  every measured stub shape post-establishment). Past the moment an unreleased
  analysis is one teaching — the refusal's analysis bullet a third spelling,
  one appended ℹ line beside every other non-error survey-branch result —
  naming the hand channel and its real consequences; the header's
  "sequential by construction" claim restated. Both repro shapes pinned
  (stub-capture, later-drafted-capture) plus the refusal's third spelling.
  Named residual (recorded in the ruling): pre-round + off posture + a stray
  valid analysis still releases with the walkthrough's continuation sentence
  half-unhonored (the roadmap half true — the establishment readers are
  posture-blind; the brief-install half false).
- **0165-096 (S07-08)** — **fixed** under ruling **0204 D2**: the review print
  lists every `### R-NN` round-brief proposal — one line per round from
  analysis.ts's own parser, each installing verbatim and passing that round's
  round-start gate on the mark — plus the absent-posture line (every round
  keeps its round-start gate). 0116 D3's list now covers the whole
  proposal-install family the release puts in force (roadmap, forks, round
  briefs, project brief); pinned with the two-shape review test.
- **Discovered in-change** (recorded, unacted on): none beyond the named
  residual above; the stub's own comment hint carries the literal
  `Clarified: yes` (a whole-line mark check, `clarifiedMark`, is the correct
  absence assertion — noted in the pin's comment), and the analysis-branch
  next line at the project start is true in every posture-blind reader
  respect — no further defect measured.

