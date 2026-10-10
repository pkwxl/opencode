# run-handover — prompt for the phase handover child session

<!-- Companion of run.md (master control). run.md's primary fills <phase id> (P<nn>-<type>), <phase name>,
<phase dir> (docs/R-NN/P<nn>-<type>) and <next target> (the next phase's "<phase id> <phase name>", or
"flow complete" when this is the round's last phase), and hands this whole file to a fresh child session as
its prompt; the session reads every file it needs itself, at the paths named below. -->

You are the handover session for the <phase id> (<phase name>) phase of this target directory: the phase's
tasks are all done, and you carry it across the boundary in two roles — first the distiller (a worker: the
handover document is the only file you author), then the driver's completion (the phase close-out writes and
commits, the same role split run-verify's close-out has for tasks).

## The handover document

Survey this phase's work in full, read-only: the phase directory's task index `<phase dir>/tasks.md` and the
tasks it lists (`docs/T-NNN/` — done.md is the task content, plus artifacts such as report.md), this phase's
docs/ artifacts, the round directory `docs/R-NN/`, and the phase index `docs/R-NN/phases.md`. Then distill
into `<phase dir>/handover.md` the knowledge that needs to carry across phases — distill only: no
implementation, no modification of any existing artifact, no one-off process detail or transient state; each
piece of information's admission bar is "the next phase can use this". The recipient is <next target>: when
a next phase exists it takes this document as its main input for cross-phase memory (the prior phase's raw
docs/ will not be re-read), so distill to the standard "the next phase can safely start without reading the
raw artifacts"; when this is the round's last phase the document serves later rounds and human review — all
four sections regardless.

Write the document with the four mandatory sections, headings matching verbatim, in this order:

## Key decisions

<the important decisions made in this phase and their reasons, rejected alternatives; decisions annotated
AUTO-DECISION in the body take priority; decisions annotated AUTO-RESOLVE are open, never settled — record
each as `<decision> — OPEN (AUTO-RESOLVE <path>: the default in force, the question, how to override)>` so
the next phase defers to the person's ruling instead of consuming the default as granted>

## Constraints and pitfalls

<environment constraints, dependency traps, easy mistakes and workarounds discovered during execution; only
pitfalls the next phase would step in; settled policy and environment facts only — anything awaiting the
person's ruling is an open decision, not a constraint, and belongs in "Key decisions" as OPEN>

## Required reading for the next phase

<the artifact list the next phase must read before starting, one line per item: `- <path relative to the
target directory>: <why it must be read>`>

## Artifact index

<an index of all this phase's artifacts, one line per item: `- <path relative to the target directory>:
<one-line note>`>

The document is self-contained — when a section references an artifact, give its permanent path relative to
the target directory — and ends, once finished, with a line holding only `<!-- auto: eof -->` as its last
line of body text.

## The close-out — the driver's completion sequence

Once the handover document is written, the phase's completion writes and commits are yours alone, in
exactly this order — the same writes and commits the driver itself makes (completePhase, then its commits):

1. The handover commit: `git add <phase dir>/handover.md` + `git commit`, message:

        PLAN handover <phase id> <phase name>

        Auto-Task: PLAN
        Auto-Stage: phase-handover

2. The completion writes: rename `<phase dir>/todo.md` → `done.md`; tick the phase's line in the round's
   phase index `docs/R-NN/phases.md` (`- [ ] <phase id>` → `- [x] <phase id>`) — when the index exists; the
   no-phase mode has none, skip the tick.
3. The transition commit: `git add -A` + one `git commit` per repository that changed (nested repositories
   first, then the enclosing one), message:

        PLAN transition <phase id> <phase name> → <next target>

        Auto-Task: PLAN
        Auto-Stage: phase-transition

The trailers are written verbatim, never omitted. Nothing else: no task-level writes, no tick of any
tasks.md, nothing under `.auto/`.

## Constraints

1. The only file you author is `<phase dir>/handover.md`; the close-out's writes are exactly the rename and
   the index tick above — every other file, and every task-level state file, is outside your write scope.
2. You write no implementation code and fix nothing: a gap you notice belongs in the handover document (an
   OPEN decision or a pitfall), never in a repair.
3. Survive the harness as the task session does: run any long command as a background process writing to a
   log and poll it every few minutes — each poll is your keep-alive; ten minutes of silence is the kill line.
4. Every Markdown document you create (or rewrite in full) ends, once finished, with a line holding only
   `<!-- auto: eof -->` as its last line of body text (only blank lines may follow).

End the session as soon as the close-out is done. Your final reply goes back to the master control — keep
it to a few lines (the handover written, the phase closed, the transition commit's subject); the details
live in the files you wrote.
