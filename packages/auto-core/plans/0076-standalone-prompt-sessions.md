# 0076 — Standalone prompt sessions (guest model)

Status: **proposal, 2026-10-03.** Direction settled in discussion 2026-10-03: the
symmetric use of `templates/prompts/*.md` is a **guest session** in a driver-governed
directory — a coding agent takes the session role where the driver cannot drive (no
`opencode serve` behind it, or the person prefers their own agent); the driver stays the
renderer and the bookkeeper. Companion to plans/0072 (carrier layering — its constitution
layer exists for exactly these sessions). Enters via `plan --append` behind this doc +
ruling. Ruled 2026-10-04: all four rulings accepted as recommended (§5).

## 1. Why

The driver can drive only what it can spawn. Inside other coding agents the person can
still run the same process steps by hand — on the same task documents, the same state
files, under the same fences — and let the driver's bookkeeping govern the result. The
split of labor: **the prompt is the work order, any agent session executes it, the driver
owns the rendering, the ticks and the close.** One process, two session engines, zero
parallel prompt variants.

## 2. Proposal — three pieces

1. **Work-order export.** A driver surface (shell command; exact shape is a ruling)
   renders a chosen ready unit's prompt with the production renderer and facts
   (`src/prompt-facts.ts`), flagged `humanQuestions: true` — the attended variant of
   `question-rule` already exists in `_partials.md`; the person is at the keyboard, so
   questions come straight to them instead of through the proxy-answer machinery. The
   output is the same text a driver-run session would get.
2. **Constitution preamble, generated.** The rendered work order opens with the
   constitution rendered from the same `agents-block.ts` constants that build the AGENTS.md
   block (0072 U-B's single source): a standalone session may run in an agent that does
   not read AGENTS.md, and it never sees the `auto.md` contract (that binds only the
   driver's `auto` agent).
3. **Adopt step.** A driver route that runs the driver half for an externally-driven
   unit: standard close-out validation (state-file grammar through `unitProblems`, eof
   terminators, the P1 scan, the report result line) → ticks / `todo.md`→`done.md`
   renames → the unified commit with the `Auto-Stage` trailer. The person must **not**
   hand-commit: a human commit inside a unit's range breaks the SHA-baseline audit. The
   adopt step is also the test executor — `testByDriver` unchanged: the session hands
   tests over via `tmp/test.sh`, and the driver runs them (reusing the
   `testrun.ts`/`script.ts` machinery), one protocol with the adopt step in the idle
   loop's place.

## 3. Fences and parameter mapping

While a standalone session runs, the driver is not running: `protect()` is inactive, so
the constitution prose is the only live fence; the adopt step is the mechanical backstop
— its validation and the commit-range check catch violations after the fact. Parameter
mapping adds **no new branches**: `humanQuestions` true, everything else from the config
as in any render — no "no-driver" prompt variant exists to drift.

## 4. Risks

- Export freshness: a rendered work order ages as the unit graph moves (dependencies
  land, ticks change). The export names its unit; the adopt step re-checks readiness and
  the ledger snapshot is re-derived at adopt, not trusted from the export.
- A poor standalone session surfaces only at adopt — block/rework is the person's lever
  (`close`, or rework like a failed driver session today).
- The export must not become a second prompt authoring path: templates stay the only
  source; the export renders, never edits.

## 5. Rulings (decided 2026-10-04 — all as recommended)

1. Export shape: stdout (recommended — the person pastes or references it; nothing
   persisted to go stale) vs a file under `.auto/`?
2. Adopt route: a `plan.ts` prelude row (recommended — it is a route, not recovery) vs a
   `resume-gate` variant vs a new subcommand?
3. Preamble: full constitution (recommended — one rendering, no second selection to
   maintain) vs trimmed to work-order-relevant rules?
4. May a standalone session take any ready unit, or only leaves of the dependency graph
   (recommended: any ready unit — adopt re-checks readiness anyway)?
