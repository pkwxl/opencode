# 0172 — The person's Choice executes where the protocol says, and the analysis document is the person's between commands

Status: **active**. Ruled 2026-11-06 by 0166 step 012 (wave W1-person-marks), enacting 0165-025
(S12-06, S2, CONFIRMED — the Choice execution dead-end) and 0165-093 (S07-03, S3, PLAUSIBLE — the
analysis document's run-time write boundary).

## Derives

Derives: P2 — the person brackets every boundary, and a boundary instrument is defect when the act it
teaches cannot be performed as taught: the blockage document's protocol line 1 promises "The next
`run`/`plan` executes an un-executed `Choice:` mark mechanically", but `run` carried no executor row
(the executor lived only in plan's prelude), and under `plan` the executor's own clean gate refused
the uncommitted `Choice:` line the protocol taught the person to write — their one-line answer, the
whole obligation 0082 D6/D7 designed, was called dirt, and under `run` a fresh paid diagnosis session
re-wrote blockage-\<n+1\> on every re-run (D8's suspension counts executed documents only). The same
principle's other face is 0165-093: the analysis document — whose release mark installs the brief
verbatim, whose roadmap lines establish rounds (0101 D5), whose `### R-NN` proposals install verbatim
past the round-start gate (0115) — was writable by every run-time session while the brief it feeds is
run-protected (0081 D6c/D11); a session's edit, committed by the driver's unified commit, would act
under the person's earlier release mark with no person ever reading it. P8 shows in the executor's
answer-commit subject naming the person's choice and in every reblock line keeping its remedy; P4
shows in the person's choice landing as its own `Auto-Stage: remediation` commit before any edit
commit; P5 shows in the analysis joining the one read-only set protect owns (no second enforcement
mechanism invented for it). Tier: operating — P2's statement applied to two existing surfaces; no
Tier I statement changes.

premises this ruling changes: 0082 (D7's clean-tree sentence — "the executor's edits are this row's
first write" and the gate that refused everything uncommitted) is amended: the pending documents'
own uncommitted edits are no longer dirt to the executor's gate — each is committed first, as its own
remediation commit naming the person's choice — and the clean-tree requirement stands unchanged for
everything else (the executor still absorbs no unrelated work). Re-readings: 0082 D6 ("the person's
whole obligation is one line") stands and is now performable exactly as taught on both commands;
0082 D9 (the sideband pick's identical artifacts) stands — the sideband path already committed its
choice through the diagnosis stage, and the detached mark now reaches the same committed state
through the executor's answer commit; 0084 ("the person and their coding agent produce it together —
the agent's instructions travel in the AGENTS.md block's analysis guidance state, not in a
driver-driven session") stands and gains its enforcement half — protect's read-only set now matches
what 0084 already stated about who writes the analysis; 0115 D1 ("no new release mark is needed for
the edit", the living-governance proposal channel) stands — the person's edits happen between
commands, where protection is off (unprotect restores 0o644 in runAll's finally; clarify and plan
write with no protection active); 0116 (clarify, the person's release command) stands unchanged —
the command runs protection-off and its release commit needs no allowWrite path.

## Category scope (0123 D1's discipline)

Two families, each enacted category-complete in this change:

1. *The person-mark consumption family* (who executes the blockage document's Choice and on what
   tree): home-set `src/blockage-execute.ts` (the executor), `src/blockage-diagnose.ts` (the taught
   lines), `src/plan.ts` (the prelude row), `src/loop-preflight.ts` (the new run-side row),
   `test/blockage-executor.test.ts` + `test/loop-preflight.test.ts` (the regressions).
2. *The run-time read-only set family* (protect's FILES): home-set `src/protect.ts` (the list and
   its spelled-out rationale), `src/document/roles.ts` (unchanged — the analysis keeps its own
   `analysisDoc` role, exactly as AGENTS.md keeps its role beside the set), `test/protect.test.ts`
   (the pin), `test/document-roles.test.ts` (the PROTECTED_FILES⊆driverState assertion — untouched,
   the analysis joins protect's own extension list, not the driverState set).

No frozen vocabulary changes: the person's-choice commit reuses the `remediation` stage (no new
stage word), the blockage document's grammar and protocol lines are untouched, and no exit code
moves (a reblocked executor row exits 2 like every person-attention stop).

## D1 — the person's choice is committed first, never refused as dirt

`executeBlockageChoices` gains a pre-gate pass: after the pending documents are found and before
`beginUnit` judges, each pending document's own uncommitted changes are committed — `commitTree`
with the document as its pathspec, stage `remediation`, subject `PLAN remediate <seq> option
<letter>: the person's choice` (the same stable prefix as every executor commit). The whole-file
commit absorbs the person's edits to the document itself — the ratification semantics 0082 D7
already gave the marked text ("the marked text became their words"); their Notes line and any edit
of an option's lines ride the same commit. A commit failure keeps the line in the worktree and
reblocks naming the manual commit — the discipline every executor commit failure already follows.
The gate below then judges the remaining tree: dirt anywhere else still reblocks with the existing
line, and the executor never absorbs unrelated work. The interactive sideband path is unchanged
(its pick already commits through the diagnosis stage before inline execution); the detached mark —
the canonical protocol, the one that works over nohup and SSH — now reaches the same committed
state.

The executor's own tests committed the Choice in setup (the fixture 0165 named): the regression
pins the person's real act — the diagnosis commits the document carrying the placeholder, the
person's edit writes `Choice: A` over it uncommitted, and the executor succeeds, with the
person's-choice commit present between the diagnosis commit and the edit commits.

## D2 — run's preflight gains the executor row

`src/loop-preflight.ts` runs the executor row before the start clean gate (after protect and the
test-handover restoration, so the executor's brief-edit channel stays protect-aware and its edit
targets exist): `executeBlockageChoices(directory, await currentRound(directory))`, skipped by lane
workers (`opts.lane` — the parent's row runs ahead of every dispatch, and the worker's copy carries
the executed marks) and by dryrun (no writes). A non-stale reblock logs the reason and exits 2 —
the same stop plan's prelude row makes; a stale rejection records and continues; execution lines
log as under plan. The round is `currentRound`'s derived value (a project before R-01 reads round
1's empty directory and finds nothing — the row is a no-op, the byte-identical floor for projects
without blockage documents). The row is not gated on `OPENCODE_AUTO_REMEDIATE`: that switch gates
the diagnosis (the machinery's spending), while a pending `Choice:` is the person's standing
consent — the mark's execution honors it exactly as plan's prelude row already does, symmetric on
both commands; with the switch off no new documents are written, and a mark left from a switch-on
window is still the person's given answer (executing it honors P2; stranding it is the dead-end
this ruling closes).

The protocol line's promise — "The next `run`/`plan` executes" — is now true of both commands, and
the render-gate blockage (the one diagnosis site live today, loop's PromptGuaranteeError path) is
consumable by re-running either.

## D3 — docs/analysis.md joins the run-time read-only set

`src/protect.ts`'s FILES gains `docs/analysis.md`, spelled out from `src/docpaths.ts`'s
`ANALYSIS_DOC` (the same layering discipline as MODELS_FILE and PROVENANCE_FILE: this
document-domain module imports nothing from the driver plane, and test/protect.test.ts pins the
two together). The rationale line in the list's comment: the analysis is the person's
between-commands governance document — its release mark, roadmap lines and round-brief proposals
all act with the person's authority, the driver never writes it during a run (the stub is plan's
row, the release is clarify's or the person's hand commit — all commands, protection off), and a
run-time session has no legitimate write to it (0084: the drafting agent works interactively at
stops, never as a driver-driven session). It joins the brief's precedent: the pre-round governance
document is the person's between commands. The chmod is the guardrail half, defense in depth beside
the prompt contract exactly as for every FILES entry — a same-user process could chmod back, the
standing protect.ts residual.

Not enacted (the alternative remedy the finding named): recording the release's commit and judging
analysis edits by their introducing commit's stage at the install/roadmap readers. The read-only
set reaches the same boundary with one mechanism P5 already owns; a provenance witness over a
living document's edits remains the 0169 D4 commit-provenance guard's family (the forged-mark
residual already recorded there), not this change's.

## Residuals

- **The combined interrupted-unit + pending-Choice state.** With an interrupted unit's resumable
  progress in the tree (0149) and a pending Choice, the executor's clean gate reblocks naming the
  unit's files and the remedy line teaches "handle it manually" — the same stop plan's prelude row
  makes today (pre-existing on that side, unchanged here); the person's Choice is now committed
  first, so their answer is never lost and never dirt, but the state's exit conflicts with 0149's
  "re-run resumes" interface. Named for the W5-control carryover family (0166 step 023); not
  solved here — executing remediation edits over foreign dirt would absorb it (the executor's edit
  commits are pathspec-less by D7's clean-tree design, and per-file pathspecs cannot split two
  writers of one file).
- **The chmod guardrail teaches nothing by itself.** A run-time session that tries the analysis
  edit the primer's reshape sentence describes hits EACCES with no surfaced remedy line; the
  primer's teaching addresses the person's interactive agent at stops (protection off then). A
  prompt-contract sentence naming the analysis read-only is template-copy territory (W-template-copy,
  0166 step 056's family), recorded there, not silently widened into this change.

## Tests

- `test/blockage-executor.test.ts`: the person's uncommitted Choice (the placeholder committed by
  the diagnosis, `Choice: A` written over it uncommitted) executes — the person's-choice commit
  lands between the diagnosis commit and the edit commits, every commit keeps the `remediation`
  stage, the tree ends clean; the committed-Choice flow (the existing fixtures) is unchanged —
  the answer pass is a no-op when the document carries no uncommitted changes.
- `test/loop-preflight.test.ts`: a run-side Choice (the same document shape, round R-01 on disk)
  — preflight executes it and proceeds (no exit), where before the start gate exited 2 on the
  person's uncommitted line; the row is silent (nothing logged) for a project without blockage
  documents.
- `test/protect.test.ts`: `docs/analysis.md` goes read-only during protection and writable after
  (the MODELS_FILE/PROVENANCE_FILE pin shape), the path pinned to ANALYSIS_DOC.

Fail-before: the executor regression reblocked "the worktree is not clean" on the pre-fix code
(0165's own repro); the preflight regression exited 2 at the start gate; the protect pin had no
analysis entry to lose.
