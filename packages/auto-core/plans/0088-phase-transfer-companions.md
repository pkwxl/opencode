# 0088 — Phase-transfer companions: run-handover.md and run-plan.md, the suite spanning a round's phases

The working rulings, kept verbatim as the design record. Status: landed 2026-10-10.

## The problem

The manual suite covered one phase's task loop and stopped at its edge: "Nothing ready → Finish" — a
completed phase was never handed over, the next phase never planned, and a person had to run the driver
itself (or re-feed the suite) at every phase boundary. The person's ruling (session of 2026-10-10): add
`prompts/run-handover.md` and `prompts/run-plan.md` for the transfer between phases.

## The rulings

- **D1 — two companions, the driver's own phase grammar.** `run-handover.md` mirrors the driver's
  handoverPhase: the distiller's four-section handover document
  `docs/R-NN/P<nn>-<type>/handover.md` (`## Key decisions`, `## Constraints and pitfalls`, `## Required
  reading for the next phase`, `## Artifact index`, headings verbatim — templates/prompts/phase-handover.md
  carried into the suite), then the close-out: the phase `todo.md` → `done.md` rename, the `phases.md` tick,
  and the two commits — `PLAN handover <P nn>-<type> <name>` (stage `phase-handover`) and `PLAN transition
  <A> → <B|flow complete>` (stage `phase-transition`), both trailer `Auto-Task: PLAN`. `run-plan.md` mirrors
  the driver's phase-plan session: the task index `tasks.md` (`- [ ] T-NNN <task title>`, at least one) and
  each task's `docs/T-NNN/todo.md` (`# T-NNN: <task title>`, `Phase: R-NN.P<nn>`, `## Goal` / `## Scope` /
  `## Acceptance`, the eof terminator), numbers continuing past the highest taken.

- **D2 — the role split follows the suite's precedents.** The handover child is driver-role for its second
  half (write handover, then close out — run-verify's pattern: a child that authors a document and then
  performs the driver's completion writes and commits). The planning child is a worker (documents only);
  its output lands as the master control's `PLAN plan` commit (stage `phase-plan`) — the master control's
  write set grows from "the share commits alone" to "the share commits and the phase-plan commit". Workers
  still never commit.

- **D3 — the loop spans the round.** run.md's loop gains step 0 (an established phase without tasks.md is
  unplanned — plan it first) and its completion branch (nothing ready = all done → the Phase transfer
  section, or an unsatisfiable dependency graph → stop and report). The transfer section: confirm
  completion, pass the human gate, run the handover child (mechanical checks: the four headings by grep,
  done.md, the tick, exactly the two PLAN commits, clean tree), then the next phase — planned ahead → back
  to the task loop, else the planning child (mechanical checks: ≥1 index line, each todo.md present with
  terminator, no number reuse) and the plan commit. The suite's charter sentence widens from "the phase" to
  "the round".

- **D4 — scope rulings.** The round's close stays out: when the last phase completes, Finish — the round
  report and the review are the person's (the driver's round-close gate is not replicated). The survey
  human gate holds minimally: `Clarified: yes` with no open `Fork:` lines before the handover child runs;
  the brief install (installApprovedBrief) is not replicated — the person releases through the driver's
  `plan` or their own `amend`. The acceptance gate is refused at preflight (config `acceptanceGate` joins
  `testByDriver`/`handoverTest`): the suite drafts no acceptance.md. A changed plan-input after planning is
  not tracked (the driver's restart rule has no manual equivalent — the person re-directs instead).

- **D5 — the ratchet pins the transfer.** FILES gains the two names; the src arm pins the PLAN grammar at
  its producers (loop-phase.ts / loop-plan.ts); a new prompts-arm case pins the four section headings, the
  taskTodoSpec literals, and the grammar split (the PLAN plan commit in run.md alone — the planning child
  never commits).

## What is deliberately not done

- No round-establishment path: the round, its phases.md and the phase directories still come from the
  driver's `plan` (0084's rows); the suite operates within an established round.
- No append/repair routing at the phase level (`--append`, `--repair` are the driver's plan-side surface).
- The plan-verify charter check (0080) is not replicated for the planning child; the mechanical task-spec
  validation is the manual bar.
