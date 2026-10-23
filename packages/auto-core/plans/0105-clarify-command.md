# 0105 — The clarify command

## Evidence

The `Clarified: yes` release is the person's single most repeated protocol act — it gates the
project start (the analysis release, 0084) and every human-gated phase boundary (the survey fork
release, 0081 D14.3) — and the manual path stacks three separate stumble points:

1. **Finding the document.** The mark lives in two different homes (`docs/analysis.md` at the
   project start, `docs/R-NN/P<nn>-survey/survey.md` at a held boundary); the stop lines name
   them, but a novice must still open the right file.
2. **Writing the marker exactly.** `clarifiedMark` (src/phases.ts) requires a whole line that trims
   to `Clarified: yes` — an inline form (`Clarified: yes — done`), a lowercase variant or a
   decorated bullet does not release, and the failure is silent: the next advance just repeats the
   same awaiting stop.
3. **Committing the edit.** Every stop line says "add the line …, **commit**, re-run", because
   preflight refuses a dirty tree (the advance runs only on a committed state). A person who
   edits but does not commit hits a *different*, more confusing refusal ("the worktree has
   uncommitted changes") that never names the mark.

The tool's own philosophy already answers the shape of the fix: the documents are the interface
and the gates stay mechanical over them, but the person's repeated acts have commands (`close`,
`amend`, `sync`) — the command is sugar over a correct hand edit, never a second release path.

## D1 — the ruling: a flagless, state-resolving `clarify` command

`clarify [dir]` performs the release the awaiting stop names: it writes the whole-line
`Clarified: yes` into the one document a gate is awaiting and commits it — byte-identical to a
correct manual edit plus its commit. The gates remain the sole authority: `clarifiedMark`,
`phaseGateProblems` and `analysisProblems` are unchanged, the command only produces the state they
read, and the manual path stays fully supported (the stop lines name both, the command first).

Two surfaces, resolved in state order (they are sequential by construction — the analysis releases
before any round exists):

- **The project analysis** (`docs/analysis.md` unreleased): mode-independent — transfer's
  project-start shape for a phased project, plan's m-mode rows. `OPENCODE_AUTO_ANALYSIS=off` means
  no analysis document, which is the quiet floor (nothing to release).
- **The held survey** (the current phase at its human gate): the phase route is the handover one
  (all tasks done, the phase not complete), the phase type carries the `human` gate, `survey.md`
  exists and records at least one open `Fork:` line, and no mark is present — the same predicate
  transfer's boundary refusal and run's boundary stop check ahead of any session.

Naming follows the repo's command grammar (imperative verb, marker participle): `close` →
`Closed:`, so `clarify` → `Clarified: yes`.

## D2 — the detection and the refusal matrix

Detection reads the same functions the gates read, in the states' own order:

1. `docs/analysis.md` exists and `clarifiedMark` is false → the analysis gate.
   - `analysisProblems` non-empty → **held** (exit 2): the problems listed, transfer's
     problems-stop shape, naming the fix channel ("fix them with your agent, then re-run") — the
     command never writes a mark onto a document the release checks would refuse anyway.
   - Else → release. (The analysis's `Fork:` lines do not mechanically hold the release —
     `analysisProblems` checks sections, roadmap grammar and brief proposals only — so a bare fork
     is not a refusal here; the print of D3 carries them for review.)
2. Else the survey gate: `readPhases` — undefined (m mode, no round yet, `OPENCODE_AUTO_ANALYSIS`
   off) is the quiet skip; a throw is an environment error (**exit 1**, transfer's blocked shape).
   With a state, `routePhase` over it:
   - `handover` + the phase's gates include `human` → read `survey.md` directly:
     missing → **held** naming the gate problem (nothing to clarify into); `clarifiedMark` true →
     **held** "already released — re-run transfer"; zero forks → not awaiting (the general
     refusal); `forksWithoutRecommend` > 0 → **held** naming the bare forks (the release would
     not take: the person decides from consequences plus one default, and the agent must add the
     missing `Recommend:` clauses first); else → release.
   - `execute` (pending tasks) → **held** naming `run`: the gate follows the phase's completion.
   - `plan` / `complete` / `handover` without a human gate → the general refusal.
3. Neither → the general **held** refusal: what was checked (the analysis released or absent; the
   current phase and its route), where the mark is valid (exactly the two moments of D1), and the
   next command.

Exit codes: 0 released; 1 environment errors (an unreadable phase index, the legacy layout, a
missing config at the shell); 2 every held refusal and a failed commit — the "blocked for human
attention" arm of the contract, the same code the awaiting stops themselves use.

## D3 — the command is the review: print what the release accepts

Before writing, the command prints the content the mark authorizes, so running it *is* the
review rather than pressing enter past a dialog:

- the survey: every `Fork:` line verbatim (each carries its `Recommend:` default), with the
  gate's own semantics named — the mark accepts every default, and an override is the person's
  answer written beside the fork line;
- the analysis: the `## Roadmap` round lines being authorized (the round/phase commitments the
  release puts in force, 0101 D5 / 0103), the `Fork:` lines if any, and the presence of the
  `## Project brief` proposal whose verbatim install rides the release.

Overrides keep their existing channel and their existing timing freedom: an answer written beside
a fork line before the command rides the release commit; one written after is a plain committed
edit to a living document (the release stays, the planners read the current file). Nothing is
confirmed interactively — the deliberate invocation of the command at a stop that named it is the
confirmation, `close`'s discipline ("the explicit ref and the required `--reason` are the
confirmation, so there is no prompt").

## D4 — the write and the commit

The write is the exact line the gate scans for, placed to keep the document's own contracts:
before the `<!-- auto: eof -->` terminator when the document carries one (the survey does; the
terminator must stay the document's last line), else appended at the document's end with one
blank line of separation (the analysis carries no terminator). Reached only when no mark is
present, the write is by construction not idempotent-relevant; the mark is never repositioned or
deduplicated.

The commit is the driver's own, the person act recorded the way `close` and `installBriefProposal`
record theirs: `commitTree` with `Auto-Stage: clarify` and the subjects
`PLAN clarify the project analysis (release docs/analysis.md)` /
`PLAN clarify R-NN.P<nn> (release the survey's forks)` — the `PLAN` family the release's other
halves (`PLAN brief install …`) already sit in, so `git log --grep clarify` finds the person's
every release. A commit failure leaves the mark written and exits 2 naming the manual commit and
the re-run — the brief-install warning discipline, promoted to the command's own exit.

## D5 — the dirty-tree discipline (close's D20 tightened to the target)

- Changes to the target document itself — the person's uncommitted fill, the common novice state
  (the whole analysis often still untracked) — fold into the release commit: that is precisely
  what "add the line and commit" means, one commit for the content and the signature.
- The driver's own surfaces fold silently: the driver-state leftovers (`driverStateFile`, close's
  rule) and the `.opencode/` config layer — init never commits its output, so a fresh project at
  the analysis gate holds `config.json` and the agent contract uncommitted beside the analysis,
  and refusing them would strand exactly the novice the command serves; the manual act the command
  emulates (`git add -A` at the awaiting stop) sweeps them too. Each non-target fold is listed in
  the commit body (close's body discipline), so the commit stays honest about what it carries.
- Everything else refuses (exit 2, the files listed, "commit or stash them first"): no change
  options exist (the command is flagless), and folding unrelated person changes — real work —
  into a release commit would mislabel them.

(Revised during enactment: the first draft folded only the target document and the driver-state
leftovers, and the live smoke run refused a freshly initialized project — init's uncommitted
config layer blocked the release, the exact novice dead-end the command exists to remove. The
`.opencode/` fold is the recorded correction.)

## D6 — the shell row

`clarify [dir]` joins `status`/`models`/`install-prompts` in the flagless family (a directory
argument only — every option is a usage error), the legacy-layout refusal, and the run-lock
refusal family beside `amend`/`fix`/`sync`: it writes survey.md/analysis.md, documents a running
driver's gate re-reads, so it refuses while another process holds `.auto/run.lock` (it never
takes the lock itself — one atomic check → write → commit, nothing for a second process to
interleave with). The command block follows close's: a missing `config.json` refuses outright
("nothing to clarify: … run init first"), then the core's result lines print — released to
stdout with exit 0, held refusals to stderr with exit 2. No run log (no session, no loop — the
status/install-prompts family), no banner.

## D7 — the stop lines teach the command

Every awaiting stop that instructs the manual release gains the command as the first-named way —
this is where the novice actually meets it:

- `logGateStop`'s survey lines (shared by run's boundary stop, the in-loop gate stop and
  transfer's gate-held refusal): "…or `clarify` writes and commits the line".
- transfer's project-start stops (the stub-open line and the awaiting line) and plan's m-mode
  analysis rows, the same clause.
- `status`'s awaiting parenthetical, the same clause.

The pinned substrings of the existing suites (survey-gate's "add \`Clarified: yes\` to release
the phase", the accepts-defaults sentence) are kept byte-identical — the clause is appended, the
manual instruction never removed.

## D8 — tests

`test/clarify.test.ts` (repo lane — real git repositories over the loop fixture, the
survey-gate/transfer conventions):

- the analysis release: an unreleased analysis → `clarifyGate` releases (the mark appended, the
  `Auto-Stage: clarify` commit landed, exit "released"), and the following `runTransfer`
  establishes R-01 — the byte-equivalence with the hand edit proven end-to-end;
- the survey release: the held-boundary fixture → `clarifyGate` in place of the hand edit (the
  mark before the eof terminator, the terminator still last), then the loop's advance completes
  the phase and installs the approved brief;
- the fold: the person's uncommitted answer beside a fork line + the release land as one commit;
- the refusals: analysis problems (no write, no commit), bare forks, the missing survey, the
  dirty tree beyond the target (named), nothing awaiting (the general refusal), the already
  released survey naming transfer, and the shell-independent exit mapping.

The suite joins `REPO_LANE` in the lane manifest; `clarify` joins the import-direction table's
flat driver classification.

## D9 — documentation

The usage text's command list and its paragraph; README's transfer section (the project-start
bullet and the phase-boundary bullet name the command beside the manual way, one new sentence at
the section's head) and the command table if one lists clarify-able moments; MANUAL §2/§3 beside
the existing manual instructions; `docs/structure.md` gains the `src/clarify.ts` row; this
package's AGENTS.md gains the navigation line.

## Enactment notes

- `src/clarify.ts` exports `clarifyGate(directory, { phases })` returning close's result shape
  (`{type: "released" | "held" | "error", lines}` — released exit 0, held exit 2, error exit 1)
  — the complete printable output, so the shell row is a thin wrapper and the core is testable
  without one; `phases` is the config value, read only for the next-command line (plan consumes a
  released analysis in m mode, transfer in a phased project).
- The m-mode analysis release rides the same detection (the analysis gate is mode-independent);
  m mode simply never reaches the survey half (no phase index — the quiet skip).
- No new protocol strings beyond the command name and the stage; the mark, the gates and the
  released readers are untouched — a hand-released project and a clarify-released project are
  indistinguishable to every later reader, which is the whole point.
