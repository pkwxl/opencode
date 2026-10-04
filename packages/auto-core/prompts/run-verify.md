# run-verify — prompt for the verification child session

<!-- Companion of run.md (master control). run.md's primary fills <task id>, <baseline commit>, <task title>
and the wrap-up line, and hands this whole file to a fresh verification child session as its prompt; the session
reads every file it needs itself, at the paths named below. -->

You are the verification session for task <task id> of this target directory: a fresh pair of eyes judging
whether the task session's output genuinely completes the task — and, when it does, performing the task's
close-out: the driver's completion commits and state writes. You write no implementation code and you fix
nothing — a finding is reported, not repaired; the repair belongs to a separate fix session. The uncommitted
working tree is the unit's entire output; the worktree is dirty by design.

Read first: `docs/<task id>/todo.md` — the task document (title line, `Phase:` field, `## Goal` / `## Scope` /
`## Acceptance`). It is the standard you verify against.

If `docs/<task id>/handoff.md` exists, a previous verification round found gaps and a fix session has worked
through them since: verify the whole task again from scratch — the earlier gaps being closed exempts nothing
else — and overwrite that handoff with the current gap list.

## Verify — all hard

1. Nothing was committed during the unit: HEAD still equals `<baseline commit>`. A task or fix session that ran
   a commit command is a hard failure — report it as such.
2. The driver's state files are untouched: `docs/<task id>/todo.md` still present, no `done.md`, the task's
   index line still unticked.
3. The task's required actions: every `## Scope` item acted on and every `## Acceptance` criterion actually met —
   judged from the work itself, never from the task session's claims. Verify by inspection: read the changed
   sources and deliverables against what the task requires. Do not re-run the acceptance's executable checks
   (its tests, the typecheck or build) — the task session already ran them and repaired what they found; a
   re-run usually surfaces nothing new, and a defect it alone would catch is left for the person to judge once
   all tasks are done. Never accept a claim you have not inspected yourself.
4. Every Markdown file created or modified in this unit ends with a line holding only `<!-- auto: eof -->` as
   its last line of body text (only blank lines may follow).
5. Process documents are not design dependencies: lines this unit added to deliverable files (every path outside
   the process documents `docs/T-*`, `docs/R-*`, `docs/phases/`, `PLAN.md`, `.auto/`, and outside `AGENTS.md`
   and `.opencode/`) must not reference those process paths. `AUTO-*` marker lines inside code comments are fine
   when self-contained; a bare task id in a comment is a warning to log, not a failure.

## The verdict

- All checks pass → close the task out — the driver's completion sequence; the commits and state writes are
  yours alone, in exactly this order — the same commits the driver itself makes after a whole-task session
  (the work, then the report, then the state writes, each with its own commit):
  1. Delete `docs/<task id>/handoff.md` when present: a fixed round's gap list is stale state and must not land
     in a commit.
  2. The work commit: `git add -A` + one `git commit` per repository (nested repositories first, then the
     enclosing one), message:

          <task id> exec <task title>

          Auto-Task: <task id>
          Auto-Stage: execute

     The subject is truncated past 100 characters. Write the `Auto-Task`/`Auto-Stage` trailers verbatim, never
     omit them.
  3. Wrap-up report: <WRITE|SKIP> — when WRITE, write `docs/<task id>/report.md`, the task's wrap-up report:
     one short section per acceptance criterion — what was done, with the evidence (your inspection and its
     outcome, the artifact path or code location) — then two sections of your own, overall conclusion and open
     issues, ending with the result line: the last line of body text before the terminator, on a line of its
     own, `Result: PASS` — a protocol string, written exactly as given, never translated, bolded or
     list-marked. Every Markdown document you create ends with the terminator as above. Then the wrap-up
     commit: the same add + commit pass, message:

          <task id> wrapup <task title>

          Auto-Task: <task id>
          Auto-Stage: wrapup

     When SKIP, write no report and make no wrap-up commit.
  4. The completion writes: rename `docs/<task id>/todo.md` → `done.md`; tick the task's line in its phase's
     index (the `tasks.md` of the round/phase directory the document's `Phase:` field names:
     `- [ ] <task id>` → `- [x] <task id>`); if `.auto/units.json` holds a record for this task, remove it.
  5. The completion commit: the same add + commit pass, message:

          <task id> done <task title>

          Auto-Task: <task id>
          Auto-Stage: done

  Then end your reply, on a line of its own, with `Verification: PASS` (a protocol string for the master
  control, verbatim) — it certifies the task as verified, committed and state-advanced: the master control may
  move on to the next task.
- Any check fails → your reply ends, on a line of its own, with `Verification: INCOMPLETE` (verbatim). Commit
  nothing and touch no state files. Write `docs/<task id>/handoff.md` (overwriting whatever is there): the gap
  list a fix session will act on — first a compact summary of what you verified as OK (so the fix session does
  not redo it), then one entry per gap: what required action is missing or wrong, where (files), and what
  exactly to do. Every Markdown document you create ends with the terminator as above. Do not write report.md.

End the session as soon as the verdict is delivered — on PASS, once the close-out above is done as well. Your
final reply is the master control's only intake from you — keep it to a few lines around the verdict line; the
details belong in `report.md` / `handoff.md` on disk, not in the reply.
