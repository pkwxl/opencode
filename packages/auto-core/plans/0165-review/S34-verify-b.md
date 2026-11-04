# S34 — Verification B: findings of S19–S32, and the corpus findings

Date: 2026-11-04. HEAD read: 3d52292e3. Status: done.

## Method

Batch: 30 S1/S2 + 1 PLAUSIBLE from S19–S32, plus all 14 findings of S02/S03 — 45 rows. Verification acts:

1. **Lines at HEAD**: `git diff --name-only d579016b2..HEAD` lists only `packages/auto-core/plans/` files — **every code, template, test and doc citation in the corpus is byte-identical** to what each finding's step read.
2. **Reproduction**: lead R6-r6 (git/wall family, 7 scenes) re-run — **7/7 pass**; lead R9-daemon re-run — **2/2 pass** (the bridge secret in argv; restored-run immortality); S29-04 re-verified this session (S30's scene B); S22-05 probed fresh this step (truncated config.json → `fix --dryrun` reports it as a manual finding, `init` refuses — both observed).
3. **Opposing tests / rulings**: no test pins the opposite of any row (the steps' sweeps stand); no contradicting ruling found in re-checks; S02's mechanical probes re-run (family-check.ts, `git tag -l`).

## Verdict table

| id | verdict | evidence | final sev |
| --- | --- | --- | --- |
| S19-01 | **CONFIRMED (family lead re-run)** | R6-r6 7/7 incl. the release-scan scenes; the substring-witness code re-shown at step; lines at HEAD | S1 |
| S20-05 | **CONFIRMED (family lead re-run)** | R6-r6's wall×fix and receipt scenes pass; the `newestGreenReceipt` location-trust re-shown | S1 |
| S25-01 | **CONFIRMED (guard-traced)** | the manual-ratchet analysis over the companions (no independent verify/fix path); templates at HEAD byte-identical | S1 |
| S19-02 | CONFIRMED (family lead re-run) | R6-r6; step repro (the corrupt-vendor status read) stands | S2 |
| S19-03 | CONFIRMED (family lead re-run) | R6-r6; step repro (the subdir guard verdicts) stands | S2 |
| S19-05 | CONFIRMED (family lead re-run) | R6-r6; step repro (repoRoots' subdir probe) stands | S2 |
| S20-01 | CONFIRMED (family lead re-run) | R6-r6's wall scenes; step repro (the recovery loop) stands | S2 |
| S20-02 | CONFIRMED (family lead re-run) | R6-r6's wall×fix scene output above: fix re-adds the allow, the covering check misses it | S2 |
| S20-03 | CONFIRMED (family lead re-run) | R6-r6; step repro (the glob-shape edit stamps) stands | S2 |
| S20-04 | CONFIRMED | lines at HEAD; step repro (claudePermissions' missing row) stands | S2 |
| S21-01 | CONFIRMED | lines at HEAD; step repro (the freeform role match escaping) stands | S2 |
| S21-02 | CONFIRMED | lines at HEAD; step repro (the unsanitized attempts read) stands | S2 |
| S22-01 | CONFIRMED | lines at HEAD; step repro (the direction ternary on body-only diffs) stands | S2 |
| S22-05 | **CONFIRMED (upgraded from PLAUSIBLE, probed this step)** | truncated config.json → `fix --dryrun`: "manual: not valid JSON" + the skipped checks note (fix defers, never heals); `init`: ".opencode/auto/config.json is not valid JSON" — both refusals observed; loud with remedy, so S3 stands | S3 |
| S23-01 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S23-02 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S23-03 | CONFIRMED | lines at HEAD; step repro (inert asserts) stands | S2 |
| S23-05 | CONFIRMED | lines at HEAD; step repro (code-authored charter accepted) stands | S2 |
| S24-01 | CONFIRMED | lines at HEAD; step analysis (154 renders, no ownership lines) stands | S2 |
| S24-02 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S25-02 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S25-03 | CONFIRMED | lines at HEAD; step repro (share numbering) stands | S2 |
| S25-04 | CONFIRMED | lines at HEAD; step analysis stands | S2 |
| S25-05 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S25-06 | CONFIRMED | lines at HEAD; step repro (the divergence receipt carrying source lines) stands | S2 |
| S25-07 | CONFIRMED | lines at HEAD; step repro stands | S2 |
| S29-01 | **CONFIRMED (re-reproduced)** | R9-daemon 2/2: the argv payload carrying transport.token read back from the spawn | S2 |
| S29-04 | **CONFIRMED (re-verified this session)** | S30's scene B: server init 200 on a plain dir, no .git; the run half recorded at step | S2 |
| S29-10 | CONFIRMED | lines at HEAD; step repro (E2BIG on unbounded text) stands | S2 |
| S32-01 | CONFIRMED (synthesis union) | a union row by construction; its 15 member findings all CONFIRMED (S33 verified the S04–S18 members) | S2 |
| S32-04 | CONFIRMED (synthesis union) | union of S17-01/02/03 + S16-01, all individually CONFIRMED (S33 verified) | S2 |

**Totals**: 30/30 S1/S2 confirmed (3 re-reproduced/re-verified beyond their step repros, 7 covered by the R6-r6 family re-run, 2 synthesis unions), 1/1 PLAUSIBLE resolved (S22-05 upgraded). 0 REFUTED, 0 BY-DESIGN, 0 DUPLICATE. No severity changes.

## Corpus re-checks (S02/S03)

| id | verdict | re-check | final sev |
| --- | --- | --- | --- |
| S02-01 | **CONFIRMED** | `bun tools/family-check.ts` re-run: "no Category scope section" for 0142–0161, 0163, 0164 (spot-listed 0142/0145/0150/0155/0160/0163/0164 = 0 each) | S3 |
| S02-02 | CONFIRMED | 0132's Category scope vs the enactment commit — step's git evidence stands (S20's R6-r6 wall×fix scene now *demonstrates* the live consequence) | S3 |
| S02-03 | CONFIRMED | the deprecation-lifecycle text vs 0150 D2's instant break — corpus text unchanged since the step read it | S3 |
| S02-04 | CONFIRMED | principles.md's mid-cycle edit (0146) — text unchanged at HEAD | S3 |
| S02-05 | **CONFIRMED** | `git tag -l` = v0.1.0, v0.2.0 only — no v0.3.0 | S4 |
| S02-06 | CONFIRMED | the release-due state (41 rulings) — unchanged; this review's own steps add to it | S3 |
| S02-07 | CONFIRMED | glossary census — unchanged at HEAD | S4 |
| S02-08 | CONFIRMED | register staleness — unchanged at HEAD | S4 |
| S02-09 | CONFIRMED | derivation-wording vs practice — unchanged at HEAD | S4 |
| S03-01 | CONFIRMED | principles.md:96 area re-read at HEAD (unchanged): P4's text beside 0145's adoption ruling — the mismatch stands; S19-01/S12's findings are its live consequences | S2 |
| S03-02 | CONFIRMED | the informational class's absence from the constitution (0135's info notes) — unchanged | S3 |
| S03-03 | CONFIRMED | the replay's constitution silences — unchanged | S4 |
| S03-04 | CONFIRMED | the replay-protocol leak (AGENTS.md auto-loaded) — this very session's system prompt demonstrates it | S4 |

**Corpus totals**: 14/14 CONFIRMED (3 mechanically re-probed this step: S02-01, S02-05, and S03-04 demonstrated).

## Split note

45 rows, one session; reproduction policy as stated (the two family leads + one fresh probe + the mechanical corpus re-runs; remaining rows carried by their step repros and the corpus-wide empty code diff). S35 consumes both tables as-is.
