# S33 — Verification A: findings of S04–S18

Date: 2026-11-04. HEAD read: 7ae1469a2. Status: done.

## Method

Batch: every S1/S2 (42) and every PLAUSIBLE (4) finding of S04–S18 — 46 rows. Three verification acts:

1. **Lines at HEAD**: `git diff --stat d579016b2..HEAD -- src/ test/ ../auto/src ../auto-server/src ../auto-server/web` is **empty** — every cited line in this batch is byte-identical to what the finding's step read (each step already verified "= d579016b2 in scope"). Per-row line re-showing therefore reduces to the guard traces below.
2. **Reproduction (mandatory for S1)**: the four S1s with lead drafts re-run independently this step (all pass again). The other three S1s guard-traced (their repros were step-built scratch, dead paths; the cited gates re-shown at HEAD).
3. **Opposing tests / rulings**: batched sweep over the three largest families (survey install, self-report, Choice) — **no test pins the opposite**; the existing fixtures write the person's mark / the report themselves (survey-gate.test.ts:114 writes `Clarified: yes`; verify-loop.test.ts:124 writes report.md), i.e. they pin current behavior, not the ruled boundary — confirming the weak-oracle family (S32-05). Each step's corpus check stands; no contradicting ruling found in re-checks.

## Verdict table

| id | verdict | evidence | final sev |
| --- | --- | --- | --- |
| S11-01 | **CONFIRMED (re-reproduced)** | lead R3-selfreport re-run at HEAD: the work session's PASS report beats the verifier's FAIL; task done | S1 |
| S11-02 | **CONFIRMED (re-reproduced)** | lead R3-oscillate re-run: gap counts 2,1,2,1… never trip the 0146 block | S1 |
| S12-01 | **CONFIRMED (re-reproduced)** | lead R3-selfclose re-run: session-written done.md survives a FAIL block | S1 |
| S12-02 | **CONFIRMED (re-reproduced)** | lead R3-choice re-run: agent-written `Choice:` read as the person's | S1 |
| S04-06 | **CONFIRMED (guard-traced)** | loop-phase.ts:337 `if (gates.includes("human")) await installApprovedBrief(ctx, phase)` — no mark check re-shown; phases.ts:404 holds only `forks > 0`; forkLines `/^\s*(?:[-*]\s*)?Fork:/` — the zero-fork/near-miss paths have no guard | S1 |
| S07-01 | **CONFIRMED (guard-traced)** | phases.ts:359-361 re-shown: `some((line) => line.trim() === CLARIFIED_MARK)` — any line, indented or fenced, releases; step's end-to-end repro (run 0 + brief install) stands | S1 |
| S10-02 | **CONFIRMED (guard-traced)** | execute.ts:446-452 re-shown: `priorText` read, `prior === "done"` trusted, no freshness/authorship witness | S1 |
| S07-02 | CONFIRMED | lines at HEAD; step repro (clarify's held refusals) stands; no opposing test | S2 |
| S07-06 | CONFIRMED | lines at HEAD; repro (the sweep commit's file list) stands; clarify's D5 discipline is the named sibling — no ruling covers the three committers | S2 |
| S07-03 | **CONFIRMED (upgraded from PLAUSIBLE)** | protect.ts:40 re-shown: FILES = PROTECTED_FILES + AGENTS.md + models.json + provenance.json — no analysis.md; every other chain component individually CONFIRMED (S07-06's pathspec-less commit, S09-01's verbatim install, transfer's proposal-skip) — the assembled trace is deterministic | S3 |
| S04-01 | CONFIRMED | lines at HEAD; repro (two paths cross the handover beside the wall) stands | S2 |
| S05-02 | CONFIRMED | lines at HEAD; repro (the not-ready freeze) stands | S2 |
| S06-01 | CONFIRMED | lines at HEAD; repro (free-line promptAsync) stands; attach-only state re-shown at attempt.ts:275 | S2 |
| S06-05 | CONFIRMED | lines at HEAD; repro (the launcher argv) stands | S2 |
| S08-01 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S08-04 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S08-06 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S08-09 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S09-01 | CONFIRMED | lines at HEAD; repro (the `####` truncation) stands | S2 |
| S10-03 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S10-05 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S10-07 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S10-08 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S11-03 | CONFIRMED | lines at HEAD; repro (SIGKILL survivors) stands | S2 |
| S11-04 | CONFIRMED | lines at HEAD; repro (`/tmp/outside-secret.txt` mode 755) stands | S2 |
| S11-06 | CONFIRMED | lines at HEAD; repro (the unchecked `Lane:` field) stands | S2 |
| S11-08 | CONFIRMED | lines at HEAD; repro (checkout/stash bypass) stands | S2 |
| S12-03 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S12-04 | CONFIRMED | lines at HEAD; repro (the HEAD-at-rerun baseline) stands | S2 |
| S12-05 | CONFIRMED | trace-confirmed at step (every caller enumerated); lines at HEAD; no guard found in re-check | S2 |
| S12-06 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S12-12 | CONFIRMED | lines at HEAD; repro (the outside-file remediation executed) stands | S2 |
| S13-01 | CONFIRMED | lines at HEAD; repro (the 14-turn ladder loop) stands | S2 |
| S13-04 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S13-06 | CONFIRMED | lines at HEAD; repro (forkSources never qualifying) stands | S2 |
| S14-01 | CONFIRMED | lines at HEAD; repro (the unpinned Bun network faces) stands | S2 |
| S14-05 | CONFIRMED | lines at HEAD; repro (the false-alive probe) stands | S2 |
| S14-06 | **CONFIRMED (upgraded from PLAUSIBLE)** | attempt.ts:275 re-shown: attach on every dispatch, probes included; S06-01's reproduced never-clear mechanism makes the probe case deterministic — count once under S06-01's family | S3 |
| S16-01 | CONFIRMED | lines at HEAD; repro (router≠server key after /failback) stands | S2 |
| S16-04 | CONFIRMED | lines at HEAD; repro (the tier render facts) stands | S2 |
| S16-05 | CONFIRMED | lines at HEAD; repro stands | S2 |
| S17-01 | CONFIRMED | lines at HEAD; repro (the forward walk) stands | S2 |
| S17-02 | CONFIRMED | lines at HEAD; repro (the sibling restart) stands | S2 |
| S18-01 | CONFIRMED | lines at HEAD; repro (no external_directory rule emitted) stands | S2 |
| S18-02 | **CONFIRMED (upgraded from PLAUSIBLE)** | server.ts restart re-shown: `server.close(); server = await spawn(...)` with no mutex; the overlap is reachable (S17-02's confirmed concurrent restarts of one shared host) — the loser interleaving leaks the serve child | S3 |
| S18-04 | **CONFIRMED, re-rated S4** (was PLAUSIBLE S3) | session.ts:382 re-shown: the teaching line prints only on restart's return-false path; a throw (spawn failure after close) propagates loudly — the failure direction is correct, only the hint is missing on a rare path | S4 |

**Totals**: 46 verified — 46 CONFIRMED (4 re-reproduced, 3 guard-traced S1s, 3 PLAUSIBLE upgraded, 1 re-rated S3→S4), 0 REFUTED, 0 BY-DESIGN, 0 DUPLICATE. No severity changes except S18-04 ↓.

## Split note

The batch (46 rows) exceeds the ~20 guidance; it ran in one session with the reproduction policy above (the four S1 lead repros re-run; trace-confirmed S2s not re-run — their recorded repros and the global empty diff carry the line-level half). S35 consumes this table as-is.
