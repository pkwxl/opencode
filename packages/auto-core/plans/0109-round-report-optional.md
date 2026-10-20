# 0109 — the round report retired to optional; the recorded findings counted, not listed

Ruled from the maintainer's review (2026-10-20), two rulings. First, verbatim:
*`report-for-user.md` is no longer mandatory (it can be omitted by default),
because with the introduction of the `driver-helper` subcommand, users no
longer need to read through all docs; instead, they can leverage
`driver-helper` sessions to track project progress and resolve decisions
that require human intervention.* Second: *in docs — especially within the
output of `driver-helper` — do not list all list items like `T-NNN
references` (they are too verbose and unreadable); only an aggregate total
count is needed (informing how many such references are pending fixes).*

## The ruling and its lineage

0081 made the round user report the round's account to the person:
unconditional (D5), gate-required at round close (D4), self-healing through
an appended task, and a second hard artifact on k-final rounds (D6b). The
account existed because the person had no other window into the run — every
provisional default, every AUTO-RESOLVE decision, every FAIL had to be
collected somewhere once per round or it was invisible.

0105–0107 then built `driver-helper`: the person-proxy brief rendered from
the same state derivation the stops use, on demand at any moment. The live
brief **is** the account — and fresher than any written artifact, because
it re-derives from the tree at every render where a report freezes at the
round's end. What the report still uniquely did was gather the
needs-attention material into one place; but every piece of that material
already has a standing surface (the ⚑ proxy-answer summaries at
task/phase/round ends, the ⚡ charter-clamp lines at phase boundaries, the
"Proxy-answered questions" sections of the task reports). The report's
price never dropped: a mandated task in every final phase, a gate check, a
self-heal, a second artifact on k-final rounds, and the largest single
document a round produces — written for a reader the tool now serves better
another way.

The ruling retires the mandate. The document stays writable: a person who
wants a round report can still commission one (a line in the planning
input, `plan --new-task`), and the document role keeps it classified and
protected. What disappears is every place the driver *required* it.

## D1 — the round-close gate drops the report check

Round-close check 4 (plans/0081 D4) retires; the gate is the whole-tree P1
scan of the destinations, the configured build, and the `## Close`
restatement listing. A report that exists is never read at the gate — the
driver judged only existence and shape before, and now judges nothing.

## D2 — the planner duty retires

The `finalPhase`/`reportFile` render facts retire from every formulation
surface — the phased parts (`formulationParts`), the m-mode implicit final
phase, `renderFormulationTodo`'s input, the `report-duty` partial
(removed from `templates/prompts/_partials.md`), and the synthesis
pipeline's seeded protocol row (`protocolFrameText`/`seededLedgerRows` drop
the parameters). No plan is told to end with a wrap-up task. A
person-commissioned report task carries its charter the way every
hand-added task does: in the person's own words in the planning input.

## D3 — the self-heal retires

`ensureRoundReport`, `reportAppendInput` and `REPORT_TASK_TITLE`
(`src/round-report.ts`, deleted) — the bounded-once append that guaranteed
the report task existed — go with the mandate. A final phase completing
without a report is now the normal case, not a gap to heal.

## D4 — the k-final second artifact retires

`extractKnowledge` loses its `report` parameter: the knowledge session
writes kb.md alone, and an extraction failure warns again (never blocks) —
the blocking branch existed only because "a round without its report does
not close", which D1 unmade.

## D5 — the person's decision surfaces re-keyed

Every surface that named the report as the person's window now names the
surfaces that stand:

- the DRIVER_PRIMER's close sentence drops `report-for-user.md` (a round
  closes on its `## Close` section) — the AGENTS.md blocks re-render at the
  next run;
- the round-start guidance state derives from the previous round's
  `## Close` listing and its report *when one was written*;
- the charter-clamp ⚡ line and the `question-rule` record sentence point
  at the ⚑ round summary and `driver-helper` instead of the report's
  needs-attention section;
- the synthesis-fallback log names `docs/R-NN/prompt-audit.md` (the record
  the audit already commits) as its carrier;
- the round-complete line and the boundary/stop lines that pointed at the
  report name it only when the file exists;
- the person-proxy brief: the missing-report channel and its verbatim
  charter block (0106 D2) retire with the stop that rendered them, and the
  standing-decisions fact arrives in their place — the round's
  auto-answered-question count (`resolvesOf`) and clamped-grant count
  (`clampedItemsOf`), detection by import as every map row is. The brief
  becomes the decisions surface the ruling names it as; POLICY keeps the
  conditional needs-attention entry for a report the person did commission.

## D6 — the counts ruling

The round-time containment ledger — the per-finding `T-NNN reference` and
out-of-root lines the rounds record — renders as one aggregate count, at
every surface that enumerated it:

- `processReferenceScan` answers `deferredCount` (out-of-root references
  plus task-id-flagged lines) instead of the `deferred` string list;
- the unit close-out (execute, work-order adopt) logs one ⚠ line carrying
  the count and the 0106 restatement remedy compressed onto it ("restate
  what each anchored in place, never delete");
- the round-close gate's warnings carry one ⚠ line with the whole tree's
  pending count — which is also what the person-proxy brief renders
  through the stop-line twins, byte-identical as ever.

Two enumerations deliberately stay: the **release gate** keeps its
itemized problems — it is the enforcement moment, and its output is the fix
list a person's agent works from (a count there would leave nothing to act
on); and the blocking ✗ process-reference problems stay itemized at round
time, for the same reason — they are the stop's own work, and the unit
close-out has already blocked on each of them per unit.

## D7 — deliberately not changed

No new config keys, switches, protocol literals or document roles;
`reportForUserPath` and the `userReport` role stand (a commissioned report
is classified, eof-scanned and protected like any document). Existing
projects need no migration: a report task a planner already wrote runs as
an ordinary task, existing reports stand as documents, and the AGENTS.md
block re-renders at the next run. The manual prompt suite
(`prompts/run.md`) never carried the report duty's machinery and is
untouched. The `## Close` restatement listing keeps its gate — the
round-close stop's person moment is the close listing now, with the report
named only when one exists.

## Verification

`bun typecheck` clean and the full core suite green with the expectation
changes this change deliberately makes (the report gate/self-heal/k-final
pins flip to the optional floors; the containment-ledger pins flip from
per-finding lines to the aggregate counts; the formulation goldens lose
the report-duty block); the shell typecheck and suite green with the
transfer help text and README rows re-keyed;
`test/driver-helper.test.ts` pinning the retired missing-report stop, the
new standing-decisions fact, and the aggregated containment line through
the twins.
