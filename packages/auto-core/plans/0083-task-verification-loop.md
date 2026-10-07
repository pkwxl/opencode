# 0083 — The task verification loop: verify → fix → report

Status: **proposal** (2026-10-07), awaiting review. Settled in design review the same day
(including the test channel's two scoping rulings, the "test in" ruling, and the side-effect
contract); the reference implementation already ships as the manual-driver suite
(`prompts/run-verify.md` / `run-fix.md`, plans/0078) — this document restores that loop as
driver machinery. Triggering context: large-scale migration runs, where one task moves
thousands to tens of thousands of lines; the work session ends context-exhausted and
self-confirming, and the first independent look at the work arrives rounds later (the
test/acceptance phase) — too late for the tasks that landed on top in between.

The problem, in two paragraphs. **The wrap-up session narrates; it does not verify.** Today's
wrap-up template summarizes what the work sessions produced, and the only verdict
(`Result: PASS|FAIL`, plans/0044 §3) is written by that narrative session with no verification
charter, no evidence form, and no consequence short of stopping the run — a self-judged
verdict from a session that never inspected the work against the acceptance criteria.

**And the first FAIL jumps straight to the heavyweight path.** A FAIL blocks (exit 2) or, with
`--repair <n>` (plans/0079 §4), closes the task and appends replanned rework — right for
architectural failure, expensive for "three gaps in a ten-thousand-line migration": the task is
closed, its context forfeit, and a planning session re-derives what a verifier already knew and
wrote down.

> The fix, in one line each. **Part A:** the wrap-up session becomes the verification session —
> fresh eyes, the task's own commit range, one report section per acceptance criterion with the
> evidence; a FAIL lands as a gap list (`docs/T-NNN/gaps.md`); a bounded fix round (at most two)
> closes exactly the gaps under the pack's repair discipline; re-verification runs from scratch;
> then today's ladder unchanged — block → `--repair` → the human. **Part B:** the
> `--test-by-driver` channel's contract is pinned — the protocol runs only in code-producing
> phases, covers compilation and test runs only (never formatting), and driver-run scripts never
> change git-managed content.

## Part A — the loop

### The pipeline

Per task, the tail of `runTask` — the same place in every subtask mode, lane-local under
parallelism:

```
work session(s)  →  verify session  ── PASS ──→ wrapup commit → closeout → done
(stage execute)        │                        (report.md committed, as today)
                      FAIL (round ≤ 2)
                       ↓
                 docs/T-NNN/gaps.md
                       ↓
                 fix session (stage execute) → re-verify from scratch → …
                       ↓ (2 rounds spent, still FAIL)
                 today's path verbatim: block with the repair fact
                 (--repair: closeUnit + append; else exit 2 for the person)
```

### D1 — the wrap-up session is re-pointed as the verification session

One session does verify + report, exactly as `run-verify.md` does verify + report + close-out.

- A **fresh session** on the task's chain, never a fork of the work sessions — fresh eyes is
  the point, and re-buying a ten-thousand-line session's context defeats it.
- Inputs the driver already holds: the task block, the **unit's commit range** (the SHA
  baseline at unit start through HEAD — the manual suite approximates this with its baseline
  commit), the pack's `reportForm`/`resultRule`, the resolveList. The verifier inspects the
  task's diff, not the repository's history.
- Judges every `## Acceptance` criterion **by inspection of the work, never from the work
  sessions' claims**; does not re-run the acceptance's executable checks (the work session's
  self-check constraint already ran them — `run-task.md`'s division of labor). The
  `test-protocol` partial does not render for it (today's wrap-up template already omits it —
  kept).
- Keeps the existing wrap-up duties: docs/ updates, the proxy-answers section (the resolves),
  the pack channels.

### D2 — the report form becomes evidence

`docs/T-NNN/report.md` on PASS: one short section per acceptance criterion — what was done,
with the evidence (the inspection and its outcome, the artifact path or code location) — then
overall conclusion and open issues, ending `Result: PASS`. Core default in the template; the
pack's `reportForm` overrides (the existing channel). On FAIL **no report is written at all**
(`run-verify.md`'s rule).

### D3 — the gap list is `docs/T-NNN/gaps.md`, overturning 0078 §3's ruled divergence

- Form (`run-verify.md`'s handoff form in substance): a compact summary of what was verified
  OK — so the fix session does not redo it — then one entry per gap: the missing or wrong
  required action, where (files), and what exactly to do.
- The driver-side file is **not** `handoff.md`: the driver parses handoff.md's `Status:` line
  (`handoffStatus`, src/document/roles.ts) at task start, and a status-less gap list sitting
  there after an interrupted blocked task trips the invalid-handoff check; distinct protocol
  shapes get distinct roles. This **overturns plans/0078 §3's ruling** that the manual suite's
  gap channel is `handoff.md` — the ratchet test itself names what reversing requires (the
  test, `prompts/`, the ruling's record): the manual suite converges on `gaps.md` in the same
  change that lands the mechanism (M1).
- Shape gate, the existing `runWrapup` pattern: a FAIL verdict requires gaps.md present and
  non-empty; a PASS verdict requires the report shape (existence / non-trivial / terminator —
  unchanged); one re-prompt with feedback (the fork path), still failing → blocked.
- Lifecycle, transient like handoff.md: deleted at closeout (PASS) and by `closeUnit` (the
  removal set in src/close.ts gains it beside handoff.md); a committed gap list from an
  interrupted round is overwritten by the next verify round — the earlier gaps being closed
  exempts nothing else.

### D4 — the fix round

- A fresh fix session (`run-fix.md` as driver machinery): reads gaps.md + the task document;
  closes exactly the listed gaps and nothing else — the pack's repair discipline
  (`repairDutiesText`, plans/0080 §6) renders into its prompt as the anti-re-architecting
  boundary; re-runs the checks covering its own changes.
- The driver commits its output after the session with stage `execute` (it is execution; the
  close-out trailer validation is untouched), subject `<id> fix <round> <title>`.
- Then re-verification runs **from scratch** (D3's overwrite rule).

### D5 — the budget and the ladder

- At most **two** fix rounds per task — a constant (the `FIX_ROUNDS` plans/0044 deleted
  returns with one clear meaning); no CLI flag, no config key. Width, if ever needed, arrives
  run-side the way `--repair`'s did.
- The escalation ladder, one sentence for the whole system: **fix loop → `--repair` (close +
  replan, plans/0079 §4 unchanged) → the human.** The block message names the rounds spent.
  plans/0082 §7's "FAIL verdicts stay with `--repair`" is amended by this document (the
  cross-reference lands there in the same change).

### D6 — the verdict protocol is unchanged; the zero-intent floor with it

Closeout still reads `docs/T-NNN/report.md` (`reportResult`) — this design changes *who writes
the verdict* (an independent verifier with a charter), not the line, the parser, or the
consequence. A pack without `### result-line` writes no verdict → no FAIL → no fix loop: the
zero-intent floor is byte-identical today-behavior. `--no-wrapup` keeps its meaning (no verify
session; a task-written report is still read at closeout, unchanged).

### D7 — persistence and resume

The persisted stage stays `{kind: "wrapup"}` (resume compatibility) and gains `round` (fix
rounds already run). Interruption mid-verify resumes as wrap-up does today (the record's
session reused when alive); interruption between a fix commit and the re-verify re-enters the
verify session with the round count preserved. The rounds book into the task's `attempts` in
`.auto/units.json`.

### D8 — scope

Task-level only — subtask close-out is unchanged (a verifier per `S<nn>` multiplies sessions
fivefold for no additional signal). Lane-local: the loop sits in `runTask`'s tail, so a lane
runs it without parent involvement — unlike repair's parent-owned append, which keeps its
lanes refusal. `stopBefore: "execute"` is unaffected. The mechanical checks stay the driver's
(eof scan, P1) — the verifier judges acceptance, nothing else.

## Part B — the test channel's contract

### D9 — the protocol runs only in code-producing phases

- A new optional `codeWork` flag on `PhaseTypeEntry` (src/phases/registry.ts); builtin
  `implement` and `test` carry it (the review ruling: test in); a custom type declares it in
  its file beside `Reasoning:`; the no-phase mode is implement by definition.
- The active condition becomes `testByDriver && codeWork(phase)` — derivation, not
  configuration; the config keys keep their constitutional on/off meaning.
- Gates: the `{{> test-protocol}}` render (whole/subtask), `execSession` and the engine's test
  concern, and the capability clamp (src/capability.ts keys on the raw flag today). AGENTS.md's
  TEST_PRINCIPLE scopes itself in wording ("in implementation and testing tasks, …") — the
  block is rendered per config and cannot vary per phase.
- Housekeeping (`restoreTestHandoffs` / `cleanTestHandoffs`) stays unconditional — cheap and
  harmless. A stray `tmp/test.sh` in a gated-off session is inert (tmp/ is driver-local; the
  marker never fires).

### D10 — compilation and test runs only

- `TEST_PRINCIPLE` drops lint from its list and gains the negative clause: the protocol covers
  compilation and test runs (build, typecheck, test suites); formatting or style validation is
  not a test script and is not routed through `tmp/test.sh`. The `test-protocol` partial
  carries the same pin.
- The honest caveat, written into the charter: the driver runs whatever script path lands in
  `tmp/test.sh` and cannot mechanically tell a lint script — this is charter enforcement. It
  does not override a task document: a task whose `## Acceptance` literally requires formatting
  conformance makes that conformance acceptance *for that task*; the narrowing removes the
  protocol's default invitation, never the task document's authority.

### D11 — side-effect freedom: driver-run scripts never change git-managed content

- Charter (both tier-1 surfaces): a driver-run script is an observation — it must not modify,
  create or delete tracked files and must not run git state commands (commit, checkout,
  rebase, …); scratch output goes to `tmp/` or other gitignored paths; a check that inherently
  rewrites tracked content (snapshot updates, codegen) does not go through the protocol at
  all.
- The mechanical guard, with causality by construction (the script runs synchronously while
  the session sits idle at its turn boundary waiting for the result — any tracked delta in
  between *is* the script's): before the run, `git stash create` (snapshots index + worktree,
  session work-in-progress included, touching nothing on disk) plus a status/HEAD snapshot,
  recursively over nested repositories as the unified commit does; after the run, re-read:
  - tracked files modified or deleted → restored from the snapshot
    (`git checkout <stash-sha> -- <paths>` — only paths the script changed, pre-run content,
    session WIP included); the steered-back result names the violation and the instruction to
    rewrite the script read-only; a per-model protocol-drift counter books it;
  - HEAD moved (a script ran a commit/rebase/reset) → no auto-undo — hard block for the
    human, the corrupted-baseline family.
- Named residuals: a mutation that lands byte-identical to the pre-run snapshot is
  undetectable and harmless; untracked files are not git-managed content and stay.

## Explicitly not

- No resurrection of the retired `--verify` surface (plans/0044 D1's tombstone stands) and no
  second verdict (0044 §3's single result line remains the only one) — "verify session" names
  the wrap-up session's charter, not a mechanism 0044 retired. Completion stays
  gate-earned and artifact-earned; the verifier's PASS is an inspection verdict, never a
  driver-parsed completion certificate for state writes.
- No new tier-1 protocol markers: `Result: PASS|FAIL` unchanged (plans/0044 §3.1's
  registration stands); gaps.md is checked by existence and shape only.
- No new config or CLI knobs: the round budget is a constant; the phase scoping is
  registry-derived.
- The verifier never re-runs the acceptance's executable checks, and verification never clears
  anything — only a gate or artifact re-earned does.
- AGENTS.md's REFS_SPEC storage enumeration gains gaps.md (the CONSTITUTION single source and
  its drift ratchet move together); the document-role table gains the role (process,
  transient, no terminator) and the standardization-boundary comment extends to name it.

## The touched surfaces, one list

Each moves in the same change as the mechanism that needs it: docpaths `TaskRole` + `taskDoc`
(src/docpaths.ts); the roles table + boundary comment (src/document/roles.ts); REFS_SPEC and
TEST_PRINCIPLE (src/agents-block.ts, with the drift ratchet and config-fix contract
re-render); the removal set (src/close.ts); the runner tail and block message
(src/runner.ts, src/loop-task.ts); the charter render and shape gates (src/wrapup.ts,
templates/prompts/wrapup.md); `Phase.round` (src/resume.ts); `codeWork` + the custom-type
field (src/phases/, src/phases/custom.ts); the gates (src/exec-session.ts, the engine test
concern, src/capability.ts); the guard (src/script.ts, git helpers in src/git.ts); the manual
suite's convergence (prompts/ artifact lists and gap channel) with the ratchet's
ruled-divergence test; goldens for every template named above.

## Test surface

- agent-fake (MA.6): FAIL → fix → re-verify → PASS completes; FAIL × 3 blocks with the repair
  fact and the spent-rounds message; the escalation into a `--repair` round still fires after
  the loop; `--no-wrapup` and the zero-intent floor unchanged; resume mid-round (round
  preserved, session reuse as wrap-up today); the lane path runs the loop lane-locally.
- The shape gates: FAIL without a gap list → one re-prompt → blocked; the PASS report shape
  unchanged.
- Part B: the partial renders per phase type (implement/test yes; survey/design/analysis no;
  custom types by their field); the capability clamp threads the derived fact; the stash
  guard — mutation restored (nested repos included), HEAD-move block, byte-identical no-op
  passes.
- Goldens: the evolved wrap-up template, the TEST_PRINCIPLE/REFS_SPEC constitution text, the
  ratchet's converged gap-channel literal; import-direction entries for any new module.

## Stages

- **M1 — the loop (D1–D8)**: the charter, the report form, the gap list, the fix rounds, the
  persistence; the manual suite converges on gaps.md with the ratchet in the same change.
- **M2 — the test channel (D9–D10)**: the `codeWork` scoping and the charter narrowing; small,
  independently shippable.
- **M3 — the side-effect guard (D11)**: the stash snapshot/restore and the HEAD block.

<!-- auto: eof -->
