# S03 — the falsification replay

Date 2026-11-02 · principles.md as of d579016b2 (unchanged since 7401fe7b5) · status: done.

releases.md l.31: "the constitution must answer real, already-ruled questions with the plans closed; the answers
come out the same, or the principle set returns to synthesis — never to the ruling."

## Runs

- **Run 1 — contaminated, not admissible** (`S03-replay-run1-contaminated.md`): a subagent read only principles.md,
  but the harness auto-loads `packages/auto-core/AGENTS.md` into every session whose working directory is the
  package, and its navigation names all six rulings. The agent itself flagged the breach. Kept for its
  ambiguity list, which reproduces the blind run's.
- **Run 2 — blind, admissible** (`S03-replay-blind.md`): `claude -p --allowedTools Read` started in an isolated
  directory holding only a copy of principles.md, prompt `S03-blind-prompt.txt` (six neutrally phrased questions,
  no plan numbers or mechanism names). **Method rule for future replays: never run the replay from inside the
  repository** — the project instructions leak the rulings.

## Scoring (blind run vs the rulings)

| Q | ruled | blind decision (confidence) | verdict |
|---|---|---|---|
| Q1 foreign commits in an interrupted unit's range | 0145: adopt and continue, never a stop | **stop for the person**, neither adopt nor roll back (high) — from l.96 + l.99 | **MISMATCH** |
| Q2 experiment worktree vs the run lock | 0129 (+0139): no lock | no lock; own reserved branch; loud on git lockfile collision (medium) | match |
| Q3 task numbering | 0150: derive from surviving artifacts | derive — but from files **and git history** (medium on the amendment) | match (the amendment is 0140's corpus bound, which the constitution never states) |
| Q4 fix-round budget | 0146: progress-gated, two no-progress rounds block | the same (high on direction, low on "progress") | match — **inadmissible**: l.61 states the answer (recall, not derivation) |
| Q5 an expected posture in a config check | 0135/0136: agreement silent; divergence an `info` note, exit 0 | agreement silent; **divergence a finding, exit 1** (medium) | **partial MISMATCH** (the divergence half) |
| Q6 graceful /exit mid-task | 0143: the next handover point / wrap-up entry | the same, conditioned on a committed outgoing session and a resumable record (medium-high) | match |

## The constitution's gaps the replay exposed (both runs agree)

1. **P4's derivations contradict 0145.** l.95 "every commit in `baseline..HEAD` carries the driver trailer", l.99
   "The person must not hand-commit inside a unit's range — it breaks the SHA-baseline audit — 0076", l.185 strict
   resume "uncertainty → no reuse, roll back", against l.96 "foreign commits are never rolled back". The text predicts
   "stop"; the ruling is "adopt". Nothing says whether a re-run is the person's consent, and nothing states
   precedence between Tier I and Tier II when they conflict (l.445 only calls a tension "a ruling's material").
2. **No informational class.** P8/P13 know findings and the exit-1 convention (l.278) only; 0135's `info` class
   and 0136's divergence-only note have no principle-level statement; l.67 "the config stays constitutional" reads
   against supersession (0114/0136).
3. **l.61** carries a threshold and the misreadable "no-gap rounds" (S02-04); "progress" is undefined there.
4. **Lock scope** unstated (l.157 "One lock per directory"); "shared git state" (l.347) undefined for refs and
   worktree registrations.
5. **Task-id uniqueness** never stated as a rule; l.134 permits deleting the top unit, after which artifact-only
   derivation re-issues its number (0140's corpus bound answers it in code, not in the constitution).
6. **"safe boundary"** undefined (l.183, l.401 — the examples are unit/dispatch-grain; 0143 moved boundaries inside a
   unit).

## Findings (F-series candidates — S34 verifies, S35 numbers them)

```jsonl
{"id":"S03-01","title":"falsification replay fails on Q1: the constitution predicts 'stop' where 0145 ruled 'adopt the person's foreign commits, never a stop' — P4's derivation text contradicts the ruling","sev":"S2","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.31","P4","P2","P8","0145"],"loc":["auto-core/docs/principles.md:95-99","auto-core/docs/principles.md:185"],"symbol":"P4 Derivations","evidence":"blind run Q1: 'The driver stops for the person … (d) Confidence: high … l.96 and l.99 together nearly decide it'","repro":{"cmd":"cd <isolated dir with principles.md> && claude -p --allowedTools Read < S03-blind-prompt.txt","observed":"S03-replay-blind.md Q1"},"impact":"by the release rule the principle set returns to synthesis: the constitution misleads every reader (agents included) on the person's commits in a unit's range","remedy":"at the cut, amend P4's derivations: the person's commit inside a unit's range is adopted on the interrupted resume (0145), the SHA-baseline audit's purity scoped to sessions; state Tier I over Tier II precedence or the resolution rule","family":["S02-04","principles.md l.185 (0022)"],"prior":"NEW","wave_hint":"release cut"}
{"id":"S03-02","title":"falsification replay partially fails on Q5: no principle states the informational class, so a divergent superseded key reads as an exit-1 finding","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.31","P8","P13","0135","0136"],"loc":["auto-core/docs/principles.md:197-216","auto-core/docs/principles.md:67","auto-core/docs/principles.md:278"],"symbol":"P8 / P13","evidence":"blind run Q5: 'When they disagree: report a finding and exit 1'","repro":{"cmd":"as S03-01","observed":"S03-replay-blind.md Q5"},"impact":"the constitution under-determines the info class two rulings rely on","remedy":"at the cut, P8 gains the recorded-state (info) class: detection that needs no person act is a note, never a finding","family":[],"prior":"NEW","wave_hint":"release cut"}
{"id":"S03-03","title":"constitution silences surfaced by the replay: lock scope, 'shared git state', task-id uniqueness, 'safe boundary', Tier precedence","sev":"S4","conf":"CONFIRMED","cat":"TRACE","measures":["releases.md l.31"],"loc":["auto-core/docs/principles.md:157","auto-core/docs/principles.md:347","auto-core/docs/principles.md:134","auto-core/docs/principles.md:183","auto-core/docs/principles.md:401","auto-core/docs/principles.md:445"],"symbol":"definitions","evidence":"see 'gaps' items 4–6 and 1","repro":null,"impact":"blind readers guess where the corpus has ruled (0129/0139, 0140, 0143)","remedy":"one definitional sentence each at the cut","family":[],"prior":"NEW","wave_hint":"release cut"}
{"id":"S03-04","title":"the replay protocol leaks: any agent session started inside the package auto-loads AGENTS.md, which names the rulings — a replay run there is never blind","sev":"S4","conf":"CONFIRMED","cat":"TEST","measures":["releases.md l.31"],"loc":["auto-core/docs/releases.md:31"],"symbol":"falsification replay method","evidence":"run 1's own isolation-breach note","repro":null,"impact":"v0.3.0's replay ('a fresh child holding the amended principles.md alone', releases.md l.124) may have been contaminated the same way","remedy":"releases.md's audit duty names the method: run outside the repository with principles.md alone","family":[],"prior":"NEW","wave_hint":"release cut"}
```
