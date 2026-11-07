# Step 056 — w-template-copy: fix.md's commit cadence, the acceptance duty's fix loop, the mode brief's exit vocabulary

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W-template-copy, findings **0165-160** (S24-03, S3), **0165-161**
(S24-04, S3) and **0165-162** (S24-05, S3). Started 2026-11-08 at HEAD
`f8a570e52` (steps 001–055 done); ruled by
[../0216-template-copy-truth.md](../0216-template-copy-truth.md).

## Findings (from plans/0165-review/S24-templates.md)

- **0165-160 (S24-03, S3, DOC, P4/P13)** — `templates/prompts/fix.md`'s
  constraint 5 says "DRIVER performs the close-out commits once the
  re-verification passes", contradicting 0148 D1's per-session durable
  batches (each fix session's batch commits at its handover and at natural
  round end, BEFORE the fresh verification judges the round). The targeted
  handover test emits `fix 1.1` and `fix 1.2` before the re-verification
  session; its old title still says "the round commits once".
- **0165-161 (S24-04, S3, DOC, P2)** — the default pack's `### v
  acceptance` duty (`templates/intents/default.md`) says "`Result: FAIL`
  stops the run for a person to plan the fix", describing the pre-0083
  lifecycle. The actual wrap-up template says a bounded fix loop follows
  every FAIL and only two consecutive no-progress rounds stop for the
  person (0083 D5, 0146 D2/D3, 0198 D1). The pinned goldens
  (`decompose-v`, `formulation-todo-v`) carry the defective line.
- **0165-162 (S24-05, S3, VOCAB, P13)** — `templates/prompts/_mode-brief.md`
  lists exit codes 0/1/2/130 only; the frozen vocabulary (AGENTS.md's
  operational line, 0014/0143/0182) also defines 3 (`/exit` under
  `--interactive`, paused at a safe boundary, rerun to recover) and
  143/129 (SIGTERM/SIGHUP — the supervisor's stop). A diagnosis session
  receives an incomplete operating-mode contract and can misclassify a
  deliberate paused run as an anomalous block.

## Plan (enactment order; each ingredient lands green)

1. Read docs/principles.md; answer the boundary per finding first (P4 the
   commit truth for 160 — 0148 D1 re-read; P2 the person bracket for 161 —
   what 0083 D5/0146 D2/D3/0198 D1 actually ruled the fix loop to be;
   P13's frozen vocabulary for 162 — AGENTS.md's exit-code line the single
   owner, 0014/0143 D1/D5/0182 its letters). Write ruling **0216** first.
2. Enact copy-only changes (P15: `templates/prompts/*.md` and
   `templates/intents/*.md`; no renderer change), with the fail-before
   proof pattern over /tmp/056-fixed (`git show HEAD:<path>` pre-fix
   templates swapped in, the new pins red, restore, cmp-verify).
3. Test homes in the same change: the goldens regenerated in lockstep;
   new pins that receive the OLD copy's defect verbatim on pre-fix
   templates; the S24-03 stale handover test title repaired.
4. Full verification (`bun typecheck`, `bun test`; baseline 3183/0/156),
   the three named prompt suites named in AGENTS.md.
5. Docs lockstep (INDEX row for 0216; AGENTS.md/structure.md only if the
   mapping changes — judge honestly), ledger rows for 160/161/162,
   program position; single commit.

## Work log

- 2026-11-08: step record created; status table marked `doing` (starting
  HEAD `f8a570e52`). Read the S24-03/S24-04/S24-05 evidence, the three
  defective templates (fix.md constraint 5; default.md `### v
  acceptance`; _mode-brief.md's "Gates and exit codes" section), the true
  protocols (wrapup.md's result line: the bounded fix loop, progress
  hold, two consecutive no-gap rounds blocking for the person; 0148 D1's
  per-session `fix <round>.<session>` commits at handover and natural
  round end; AGENTS.md's frozen exit-code line — 0/1/2/3/130/143/129),
  the consumers (blockage-diagnose.ts renders _mode-brief verbatim into
  the diagnosis prompt; planDutiesPartial injects default.md's `### v`
  subsection into decompose-v/formulation-todo renders — the two goldens
  pinning it), the bundle intents (cleanroom/faithful/faithful-lean carry
  their own acceptance copy — none carries the defective sentence; the
  templates README already states the true lifecycle), and
  docs/principles.md (P2's own derivation already carries the true
  lifecycle: "fix rounds (progress-gated, never count-capped — two
  consecutive no-gap rounds block, 0146 amending 0083 D5) → --repair →
  the human" — the phase-level `Accepted: yes` gate the "never
  auto-repair" line names is a different boundary from the task
  verification's FAIL). Ruling 0216 written first.
- 2026-11-08: enactment — copy only. `templates/prompts/fix.md`
  (constraint 5's second half: the DRIVER commits each finished fix
  session's batch at the session's own end, a handover included, before
  the fresh re-verification judges the round and decides the task's
  completion), `templates/intents/default.md` (the `### v acceptance`
  duty's parenthetical: `Result: FAIL` ending the verification's gap
  list, the DRIVER's bounded fix loop, only two consecutive fix rounds
  closing no gap stopping the run for a person), `_mode-brief.md` (the
  exit line: 0/1/2/3/130/143/129 — 2 completed to the owner's "blocked
  or reverted to pending for human attention", 3's deliberate `/exit`
  pause with rerun recovery, 143/129 the supervisor's stop through the
  same force-terminate cleanup). Test homes: `test/verify-loop.test.ts`
  (the stale handover title repaired to "each session's batch commits at
  its own boundary" + the dispatched-prompt copy pin with the retired
  sentence's not.toContain), `test/prompt-phase.test.ts` (the v-duty
  lifecycle pin), `test/blockage.test.ts` (the exit-line ratchet reading
  AGENTS.md's owner line — every backticked code asserted present in the
  rendered brief — plus the meaning pins for 3 and 143/129), the goldens
  `fix`/`decompose-v`/`formulation-todo-v` regenerated (UPDATE_GOLDEN;
  the diff verified to be exactly the three sentences).
- 2026-11-08: fail-before proof over /tmp/056-fixed (the three fixed
  templates backed up, `git show HEAD:./` pre-fix versions swapped in,
  the pins run, the fixed files restored and cmp-verified
  byte-identical); full verification; docs lockstep (the 0216 INDEX row,
  no annotations — no premise changed; AGENTS.md/structure.md judged:
  content-only template edits shift no mapping, neither touched); the
  program status/ledger/position updated; committed.

## Verification

`bun typecheck` exit 0; the three named prompt suites
(`test/prompt-exec.test.ts test/prompt-phase.test.ts
test/prompt-template.test.ts`) **155 pass / 0 fail**; auto-core full
suite **3185 pass / 0 fail** (156 files = the 3183 baseline + 2 net new,
zero regressions). Fail-before proof over /tmp/056-fixed: **every new
pin and all three goldens red on pre-fix templates** —

- D1 (1 pin): the handover test's received fix prompt carrying "DRIVER
  performs the close-out commits once the re-verification passes"
  verbatim — the finding's own sentence in the dispatched prompt.
- D2 (1 pin): the v-duty lifecycle pin failing on the old sentence (the
  toContain for the bounded-loop wording over the pre-fix duty).
- D3 (1 pin): the exit-line ratchet failing first on "exit code 3 of the
  frozen set" — the finding's own subject — over the pre-fix brief's
  0/1/2/130 line.
- The three goldens red on pre-fix templates (decompose-v, fix,
  formulation-todo-v), each diff exactly the one defective sentence.

The floors green on pre-fix templates (every other pre-existing test of
the touched files, the rest of the golden suite included — the
regeneration changed nothing else, verified by the golden diff). No
shell suite re-measured — no shell surface touched (the step-050
environment-drift records stand).

## Dispositions

- **0165-160 (S24-03, S3)** — fixed (ruling 0216 D1): the fix session is
  taught 0148 D1's durability boundary (each finished session's batch
  committed at its own end, before the re-verification judges); the
  no-agent-commit rule byte-identical; the retry/coldstart exception
  stays out of the copy; the stale handover-test title repaired.
- **0165-161 (S24-04, S3)** — fixed (ruling 0216 D2): the duty teaches
  the lifecycle the driver runs — record-only for the session, the gap
  list (never a report) carrying FAIL, the DRIVER's bounded fix loop,
  only the exhausted progress budget stopping for the person; the two
  goldens regenerated in lockstep and a named pin added; the bundle
  packs checked (none carries the defective sentence; the templates
  README already states the true lifecycle).
- **0165-162 (S24-05, S3)** — fixed (ruling 0216 D3): the brief states
  the full frozen set, and the ratchet binds it to AGENTS.md's owner
  line — the next additive growth goes red until the brief carries it.
  Family checks read: prompts/ restates no exit vocabulary (its two
  "exit code" hits are lane-log protocol); auto-server's daemon already
  maps 3 (`paused`), its 143/129 comment note recorded as a named
  residual (S30's surface, no finding there).
- Premise guard: no ruling's premise changed — 0148 D1, 0146 D2/D3,
  0198 D1, 0014, 0143 D1/D5 and 0182 re-read standing (their mechanism
  letters unchanged; this ruling completes their copy halves), 0082 D3
  re-read standing (its "versions with the code" premise is the
  ratchet's own charter); no INDEX row annotated.
- Commit: the step's single coherent commit (subject "0166: step 056
  done — ruling 0216 …", finding ids in the body's trailing
  parenthetical); the SHA recorded in the program table's row by the
  next step's start HEAD convention.
