# 0245 — The manual suite's gap-list ignore set

Status: **active-authority** — the manual-driver suite's one sanctioned dirty
transient, the fix-round gap list (`docs/T-NNN/gaps.md`), moves from tolerated
porcelain dirt to a **gitignored entry** the master control ensures at run
start, and the retry residue that once met a stop-and-report (or worse, a ride
inside a share commit) gets the same append-and-commit treatment. The landing
adds **no new commit vocabulary**: the delta rides the driver's own run-start
housekeeping grammar (`PLAN housekeeping …`, `Auto-Stage: housekeeping` —
`src/loop-preflight.ts`), mirrored by the manual master exactly as it mirrors
the park grammar. Every clean-seam check in the suite simplifies to "the
porcelain lists nothing".

## Derivation

Derives: **P4** (committing is the completion condition — the ignore-set delta
lands as the master control's own commit in the driver's own grammar; junk and
transients never land inside a session's share, and the commit right stays
with the driver-role session alone), **P6** (derived state, idempotence,
re-derivation — the entry is re-derived from `.gitignore` at every run start,
an already-present entry commits nothing; the pending-fix state is re-derived
from the file's existence on disk, nothing persists a fresh read cannot), **P8**
(deliberate enforcement moments — the sweep renders its remedy exactly at the
moments the tree must be clean, and blocking narrows to the unclassifiable
file, each stop naming what it found), **P12** (conservative under
uncertainty — residue is untracked files only, never deleted, and a file the
master cannot classify rides the share as work and is named in the report),
**P13** (frozen additive-only vocabularies — zero new words: the `PLAN
housekeeping` subject family and stage are the driver's own run-start commit
reused by the manual twin; the one additive surface is the ignore-set entry
`docs/T-*/gaps.md`, a 0138 committed-surface delta landed through git), **P18**
(the record outlives the tool — the ignore set is `.gitignore` plus git
history, plain files; the pending-fix hint stays a file on disk that nothing
but ordinary tools reads), **P20** (in-flight work is never destroyed — the
sweep's only write is the ignore append, never a deletion or edit; a killed
child's writes still ride its successor's share; the interrupted-restart
exemption keeps an uncommitted tree out of a PLAN commit), **P21** (machinery
waits for its consumer — the consumer is `run.md`'s whole-task family per the
field report; the subtask companions and the driver's own gap lifecycle are
deferred with the cost recorded in C). Amends: **plans/0087** (the
share-landing aftermath — the tolerated-transient exception family retires and
the residue stop-and-report becomes the sweep with a narrowed stop), **plans/
0104** (the waves' tolerated list loses the gap-lists entry and gains the
drain-deferred sweep). Tier: **mechanism** — prompt-copy carrier, one reused
commit grammar, one computation (every seam check's simplification).

## The measured findings

The person's field report (2026-11-17, three messages):

1. *"some times, retries of a fix child session managed by `prompts/run.md`
   will leave files even if works properly. such files should be add to
   `.gitignore` so as to keep the git clean."*
2. *"And if the git is unclean between tasks or fixes, `prompts/run.md`
   should make it clean first."*
3. The mechanism, clarified: *"the gaps.md seam — not committed by a
   verification session, left for the next fix. when verification is done,
   but the fix is not started. gaps.md lives there dirty"* — with the
   observation that the file's presence is *"a hint of a fix session"*.

Read against the suite:

- **F1 — the gap list is the one sanctioned dirty transient.** Written by an
  INCOMPLETE verification, read by the fix child, deleted by the passing
  close-out, unstaged from every fix share, and tolerated **by name** in every
  clean-seam check: the launching bullet and loop step 3's aftermath ("the
  porcelain lists only the transient gap list"), park/resume's boundary ("the
  tree clean except the transient gap list"), run-verify's intro and check 1.
  The window between a verification's INCOMPLETE verdict and its fix round's
  re-verification spans the fix child's whole run — and survives restarts and
  overnight parks: the porcelain reads dirty **by design** for hours.
- **F2 — the signal never was the dirt.** Every mechanism keys on the file's
  **existence on disk**: step 5 keys the re-verification on `gaps.md`
  existing, the park/resume rules read its presence to derive the fix role on
  a restart, the passing close-out deletes it. An ignored file keeps every one
  of these keys working; only the porcelain exception disappears.
- **F3 — the tolerated-dirt design strained its own gates.** The preflight
  clean check (check 4) demands a porcelain that lists nothing at every
  hand-over, while the park/resume rules expect a mid-fix-round restart to
  carry the transient — a latent tension the exception wording papered over.
- **F4 — retry residue had no good home.** Untracked scratch a relaunched
  session left behind (patch leftovers, tool backups, scratch and log files)
  either tripped "anything else is residue: stop and report" (run.md's two
  sites) — halting an unattended run for junk — or was absorbed by a share's
  whole-tree add into the share commit: junk landing in history as if it were
  the session's work.

## Category scope

The requirement family: **the manual-driver prompt suite's copy family**
(plans/0078's corpus), with the ignore-set surface riding 0138's
committed-project-surface law.

| home | carries | this ruling |
| --- | --- | --- |
| `prompts/run.md` | the master control | **changed** (D1–D3): the run-start ignore set section, the preflight tolerance, the seam restatements, the single-mode and hands-off clauses |
| `prompts/run-verify.md` | the verification child | **changed** (D4): the clean-porcelain expectation, check 1's housekeeping range shape |
| `test/manual-prompts-ratchet.test.ts` | the suite's ratchet | **changed**: the 0245 block — the entry and grammar pins, the residue arm's clauses, the retired literals pinned absent, the src-side housekeeping coupling |
| `src/loop-preflight.ts` | the driver's own run-start housekeeping commit | **held** — mirrored, not modified (the coupling pin's src side) |
| `prompts/run-as-subtasks.md` + `prompts/resume-subtasks.md` | the subtask pipeline | **held** (C: deferred — the repo-global entry cleans their porcelain mechanically; their `git restore --staged` step stays correct as belt-and-braces) |
| `src/gitignore.ts` + the driver's gap lifecycle | the automated driver | **held** (C: untouched — the driver keeps `gaps.md` out of commits by its own machinery; a manual run's entry is an unknown line the driver's `fix` leaves alone, and its unified commit skipping an ignored gap list matches its own intent) |

## Decisions

### D1 — the entry and its run-start landing (findings 1–3)

The entry `docs/T-*/gaps.md`, root-anchored, covering every task's gap list
(the subtask pipeline's task-level lists included). The master control ensures
it after the preflight passes: append when missing, land the delta as its own
housekeeping commit — subject `PLAN housekeeping ignore set`, trailers
`Auto-Task: PLAN` and `Auto-Stage: housekeeping`, the `Auto-Nested:` lines
riding as they ride every commit the master lands here. Idempotent: an
already-present entry commits nothing. One exemption mirrors the driver's own
interrupted-unit exemption (`src/loop-preflight.ts`'s `exemptResume`): a tree
holding uncommitted work — a child broke mid-session, the park/resume rules
relaunch its successor on that tree — is never absorbed into a PLAN commit;
the append rides the resumed child's next share instead. The preflight's
clean check tolerates exactly the gaps family for its first read (the entry
lands only after the preflight passes), then reads clean from this run on —
resolving F3's tension in both directions.

### D2 — the residue arm (finding 4)

Classification, conservative by construction: residue is **untracked files
only** — a modified or deleted tracked file is unlanded work, the kill path's
own case, riding its successor's share — and **never anything under `docs/`**
(the process documents' channels are governed by their own rules). The
characteristic kinds are named so a path reader can classify without reading
content: patch and merge leftovers (`*.orig`, `*.rej`), tool backups (`*.bak`,
`*~`), scratch and log files (`*.log`, `*.tmp`), lock files, build or test
output directories. The sweep's only write is the ignore append — the files
themselves are never deleted or edited (P20: even junk is not destroyed). A
file the master cannot so classify may be work: it rides the share as before
and the report names it (P12 — a new source file and a scratch dump look
alike to a path reader; the default favors work, and the share's add pass
lands it exactly as before this change). Residue never counts as a session's
writes (the zero-write check judges work). Nested repositories: residue there
appends to that repository's own `.gitignore`, one housekeeping commit per
repository that changed, nested first — the share pass's shape. Under
`parallel: <n>` a sweep defers to the drain: it runs when no child is in
flight, never overlapping a verification's flight (untracked junk endangers
no sibling in flight).

### D3 — the clean-seam restatement (findings 2, 3)

Every seam check simplifies to **"the porcelain lists nothing"**: the
launching bullet and loop step 3's aftermath, the waves' tolerated list (which
keeps the live siblings' scope paths, an ended task's deferred landing and a
held park handover — real work, never ignored), park/resume's boundary
description, run-verify's intro and check 1 (a wave's sibling writes stay
tolerated). The retired literals — "anything else is residue: stop and
report" (two sites) and the "except/only the transient gap list" family — are
pinned absent in the ratchet. The `git restore --staged docs/T-NNN/gaps.md`
step stays verbatim: the entry makes it a no-op, and run.md stays consistent
with the subtask companions that teach it.

### D4 — the verification child's acceptance (finding 4)

Check 1's legitimate range shapes grow one: the master control's housekeeping
commits — `Auto-Task: PLAN`, `Auto-Stage: housekeeping`, the ignore-set
maintenance that keeps the transient gap list and a session's residue out of
the porcelain, never work content — protocol state, excluded from check 3's
diff, worded self-containedly (the verification child never reads run.md).
The worktree expectation becomes a clean porcelain, the transient gap list
gitignored (its write never dirties the tree); a wave's sibling scope writes
remain the tolerated exceptions.

### C — declined and deferred (P21)

- The **subtask companions** keep their tolerated-transient wording and their
  unstage step; a subtask-flow consumer's report is the trigger to carry the
  section across.
- The **automated driver's** gap lifecycle and clean gate are untouched; a
  driver-side ignore entry of its own would be a 0138 ignore-set family
  decision, declined here.
- **Preflight dirt beyond the gaps family** remains the person's: the
  hand-over tree is theirs to judge.

## Premise guard

premises this ruling changes: **plans/0087** (the post-share aftermath —
amended above), **plans/0104** (the waves tolerated-residue list — amended
above). Re-read in this change: **plans/0161** (the Auto-Nested enumeration —
the housekeeping commit joins it, the rule itself untouched), **plans/0200
D1 / plans/0201 D2** (the gap channel's grammar and lifecycle — the file's
shape, its countable grammar and its deletion untouched; only its porcelain
visibility changes), **plans/0138** (the ignore set a committed project
surface — the entry lands by commit, the law respected). Each stands as
written for every surface this change does not touch.

## Residuals

- The first run on a target still reads the transient in the preflight's one
  tolerated slot (the entry lands only after the preflight passes) — a
  one-run window, named in the check itself.
- A person who removes the entry returns to listed-gap-list dirt: the unstage
  step and every existence key still hold, the seam checks stop and name the
  listed file, and the remedy is the sweep's own (re-add the entry).
- Junk classification is a judgment over named kinds, never content (P7's
  boundary); a project whose deliverables match the named kinds — a shipped
  `.log` as a deliverable — lets those files ride the share and be named in
  the report, the conservative default.

## Tests

`test/manual-prompts-ratchet.test.ts` — the 0245 block: the entry pattern,
the housekeeping grammar and its idempotence, the residue arm's three clauses
(untracked-only, never-delete, rides-when-unsure), the retired literals pinned
absent in both files, and the src-side coupling pin (`stage: "housekeeping"`
in `src/loop-preflight.ts` — 0203's two-sided form). The unchanged suites
hold the floors: the gap-channel, waves, single-mode and park pins pass
unmodified — no literal they pin moved.
