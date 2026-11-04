# 0165 — The three-package review (auto-core, auto, auto-server): a resumable program

Status: **done** 2026-11-04 (36 of 36 steps). Opened 2026-11-02 at HEAD 358be4003 (branch `auto-core`,
clean tree); baseline moved to **d579016b2** (= 358be4003 + the maintainer's plan 0164) before the code steps.

A full expert review of the auto tool family — the core library `auto-core`, the CLI shell `auto`, the service
shell `auto-server` — covering **implementation** (correctness, failure direction, lifecycle, concurrency,
security), **design** (architecture, boundaries, duplication, complexity, the constitution's own quality) and
**requirements consistency** (principles ↔ rulings ↔ code ↔ tests ↔ docs, which doubles as the overdue
per-release audit: v0.3.0 was cut 2026-10-25, plans 0124–0164 are unaudited). Read-only on code: it produces a
findings register and a proposed fix-wave program; every fix becomes its own ruling (Derives/Amends, tier,
Category scope). This document **rules nothing**: each finding carries `measures` (the P-ids and rulings it checks
against) instead of a derivation.

**Why this shape.** The first attempt ran nine parallel reviewer agents; all of them hit the account's 5-hour
usage limit before writing anything, were resumed, and hit it again — the token cost of nine large contexts
re-reading the same corpus. At the maintainer's instruction (2026-11-02) the review is a sequence of
**single-session steps**, each with a bounded scope (~2–4K source lines), its own durable output file under
[`0165-review/`](./0165-review/), and a status row here — so any session can stop (or be stopped by a limit) and the
next one resumes at the first unfinished step with nothing re-derived. The first attempt's reproduction drafts are
kept as unverified leads (`0165-review/leads/`).

The previous review (2026-10-30) recorded no report — only its fix waves 0155–0160 exist, each naming deferred
residuals; the steps below re-check those residuals and use fresh primary lenses (cross-ruling interaction,
crash-consistency, trust boundary & secrets, test-oracle quality, remedy teaching).

## Derivation and Category scope

Derives: P19 — method only: every finding rests on a cited line at the baseline, a reproduction, or a probe output,
and a speculation stays a `PLAUSIBLE` lead. Tier: none — a governance record, no mechanism ruled.

### Category scope

None. This document changes no requirement family and no code, test or doc home. Each fix wave it proposes is a
later ruling with its own Derives/Amends, tier and Category scope (0110 D5, 0123). Its working papers live under
[`0165-review/`](./0165-review/): `CONTRACT.md`, `steps.md`, `leads/`, `tools/` and the `Sxx-*.md` step outputs.

## How to resume — the protocol (every session)

1. Start a **fresh session** in `packages/auto-core` (or `/clear`). Prompt: *"Run the next step of
   plans/0165-three-package-review.md."* One step per session; no subagents.
2. Read this file (it is kept short) and [`0165-review/CONTRACT.md`](./0165-review/CONTRACT.md).
3. Pick the step: the first row of the status table (in table order) whose status is `doing` — resume it from its
   partial output file — otherwise the first `todo`.
4. Set its row to `doing <date>`; create the output file with the contract's header and empty sections.
5. Read only your brief: `sed -n '/^## S11 /,/^## S[0-9]/p' plans/0165-review/steps.md` (your id), then only the
   inputs it names. Use earlier outputs instead of re-deriving; the digest below lists what is already established.
6. Work; append findings and coverage to the output file as you go.
7. Finish: header status `done`; the row gets `done`, the HEAD read, and the counts `S1/S2/S3/S4`. Stop.
8. Never commit — the maintainer commits the working papers at their discretion (committing after each few steps
   keeps the progress durable across machines). If HEAD moved past d579016b2, follow the contract's rule.

## Status

Order is execution order (highest risk first); ids follow the layer map. Counts are S1/S2/S3/S4.

| # | step | scope | status | output | counts |
|---|---|---|---|---|---|
| 1 | S00 baseline & health | suites, typecheck, mutation baseline | done 2026-11-02 @358be4003/d579016b2 | [S00](./0165-review/S00-baseline.md) | 0/0/2/0 |
| 2 | S01 mechanical probes | INDEX, code homes, nav docs, switches, test census | done 2026-11-02 @d579016b2 | [S01](./0165-review/S01-probes.md) | 0/0/6/2 |
| 3 | S02 corpus audit | rule→principle, family check, lifecycle, release state, registers | done 2026-11-02 @d579016b2 | [S02](./0165-review/S02-corpus-audit.md) | 0/0/5/4 |
| 4 | S03 falsification replay | blind replay of six 0124–0163 rulings | done 2026-11-02 | [S03](./0165-review/S03-replay.md) | 0/1/1/2 |
| 5 | S11 task pipeline B — verification, scripts, receipts | 3.0K | done 2026-11-02 @36614f72f (=d579016b2 in scope) | [S11](./0165-review/S11-verification.md) | 2/4/4/1 |
| 6 | S12 recovery and blockage | 2.1K | done 2026-11-02 @f3c24fc1c (=d579016b2 in scope) | [S12](./0165-review/S12-recovery.md) | 2/5/4/1 |
| 7 | S29 service shell A — daemon, auth, spawn | 2.7K | done 2026-11-02 @2674dbaf3 (=d579016b2 in scope) | [S29](./0165-review/S29-daemon.md) | 0/3/7/1 |
| 8 | S17 models, key rings, secrets | 2.9K | done 2026-11-03 @2674dbaf3 (=d579016b2 in scope) | [S17](./0165-review/S17-models.md) | 0/2/6/2 |
| 9 | S10 task pipeline A — dispatch, execution | 3.4K | done 2026-11-03 @423d24bbd (=d579016b2 in scope) | [S10](./0165-review/S10-dispatch.md) | 1/4/3/1 |
| 10 | S13 session driving | 3.2K | done 2026-11-03 @2d586e16e (=d579016b2 in scope) | [S13](./0165-review/S13-session.md) | 0/3/2/2 |
| 11 | S14 the turn engine | 3.0K | done 2026-11-03 @f9556a00d (=d579016b2 in scope) | [S14](./0165-review/S14-engine.md) | 0/2/4/1 |
| 12 | S19 git core and the commit boundary | 2.3K | done 2026-11-03 @17af6f844 (=d579016b2 in scope) | [S19](./0165-review/S19-git.md) | 1/3/5/1 |
| 13 | S20 isolation, fork, the wall, permissions | 2.4K | done 2026-11-03 @cea51c524 (=d579016b2 in scope) | [S20](./0165-review/S20-isolation.md) | 1/4/8/1 |
| 14 | S21 the task store and documents | 2.6K | done 2026-11-03 @87efcfae0 (=d579016b2 in scope) | [S21](./0165-review/S21-tasks.md) | 0/2/3/1 |
| 15 | S04 loop composition A — root and phases | 3.6K | done 2026-11-03 @247d49061 (=d579016b2 in scope) | [S04](./0165-review/S04-loop-root.md) | 1/1/7/1 |
| 16 | S05 loop composition B — task loop and lanes | 2.9K | done 2026-11-03 @018ed7715 (=d579016b2 in scope) | [S05](./0165-review/S05-loop-task.md) | 0/1/8/1 |
| 17 | S06 run control — services, lock, exit, interactive | 2.0K | done 2026-11-03 @ee3af2c6f (=d579016b2 in scope) | [S06](./0165-review/S06-control.md) | 0/2/6/1 |
| 18 | S07 planning A — person-boundary commands | 2.9K | done 2026-11-03 @71763228f (=d579016b2 in scope) | [S07](./0165-review/S07-planning-a.md) | 1/2/4/2 |
| 19 | S08 planning B — formulation | 2.9K | done 2026-11-03 @92f45c501 (=d579016b2 in scope) | [S08](./0165-review/S08-formulation.md) | 0/4/6/2 |
| 20 | S09 round documents and read-outs | 1.9K | done 2026-11-03 @1d81d6bd9 (=d579016b2 in scope) | [S09](./0165-review/S09-round-docs.md) | 0/1/4/1 |
| 21 | S15 accounting and journals | 2.3K | done 2026-11-03 @ac64730f0 (=d579016b2 in scope) | [S15](./0165-review/S15-accounting.md) | 0/0/5/1 |
| 22 | S16 routing and recovery policy | 3.8K | done 2026-11-03 @7d4eea707 (=d579016b2 in scope) | [S16](./0165-review/S16-routing.md) | 0/3/4/1 |
| 23 | S18 agent adapters and the pool | 2.9K | done 2026-11-04 @119ffdcf1 (=d579016b2 in scope) | [S18](./0165-review/S18-agent-adapters.md) | 0/1/3/3 |
| 24 | S22 config and materialization | 2.6K | done 2026-11-04 @119ffdcf1 (=d579016b2 in scope) | [S22](./0165-review/S22-config.md) | 0/1/5/2 |
| 25 | S23 policy-as-data, code side | 2.8K | done 2026-11-04 @119ffdcf1 (=d579016b2 in scope) | [S23](./0165-review/S23-policy.md) | 0/4/1/0 |
| 26 | S24 templates — prompt copy, default pack | md | done 2026-11-04 @d617ee3b9 (=d579016b2 in scope) | [S24](./0165-review/S24-templates.md) | 0/2/3/1 |
| 27 | S25 bundles and the manual-driver suite | md | done 2026-11-04 @7a33654f6 (=d579016b2 in scope) | [S25](./0165-review/S25-bundles.md) | 1/6/3/1 |
| 28 | S26 CLI shell A — parser, help, option policy | ~1.2K | done 2026-11-04 @e9c166fba (=d579016b2 in scope) | [S26](./0165-review/S26-cli-parser.md) | 0/0/2/3 |
| 29 | S27 CLI shell B — command blocks | ~2.1K | done 2026-11-04 @bb7daf7cd (=d579016b2 in scope) | [S27](./0165-review/S27-cli-commands.md) | 0/0/1/1 |
| 30 | S28 CLI docs and the e2e strategy | docs (grep) | done 2026-11-04 @98bbf0e55 (=d579016b2 in scope) | [S28](./0165-review/S28-cli-docs.md) | 0/0/0/4 |
| 31 | S30 service shell B — operations, observation | 3.0K | done 2026-11-04 @80e3c9300 (=d579016b2 in scope) | [S30](./0165-review/S30-server-ops.md) | 0/0/3/2 |
| 32 | S31 service shell C — web, docs, test health | 2.4K + docs | done 2026-11-04 @dca9544ab (=d579016b2 in scope) | [S31](./0165-review/S31-server-web.md) | 0/0/0/3 |
| 33 | S32 cross-cutting design synthesis | step outputs | done 2026-11-04 @06cc471e0 (=d579016b2 in scope) | [S32](./0165-review/S32-synthesis.md) | 0/2/3/1 |
| 34 | S33 verification A (S04–S18) | findings | done 2026-11-04 @7ae1469a2 | [S33](./0165-review/S33-verify-a.md) | 46 confirmed |
| 35 | S34 verification B (S19–S32 + S02/S03) | findings | done 2026-11-04 @3d52292e3 | [S34](./0165-review/S34-verify-b.md) | 45 confirmed |
| 36 | S35 report assembly + INDEX row | all outputs | done 2026-11-04 @bee9ba4d7 | [S35](./0165-three-package-review.md#report) | report |

## Digest — established facts (do not re-derive; cite the step)

- **Health (S00):** typecheck clean ×3; auto-core 2912/0; auto 154 pass/8 opt-in skips/0; **auto-server 134/2** —
  the known observe `sawDirty` flake + `worker.test.ts` "usage vocabulary" deterministically over bun's 5 s default
  (6.9 s alone). The shells have no bunfig test preload.
- **Corpus (S01/S02):** INDEX grammar broken in 27 rows; 11 stale code homes (9 in active rows); `## Category scope`
  absent in 22 requirement-bearing rulings (0142–0161, 0163, 0164); 0132's enactment touched a proper subset of its
  enumeration (config-fix.ts, document/roles.ts untouched — S20 decides if that is a defect); the deprecation
  lifecycle as written vs the practiced instant tombstone (0150 D2 breaks a v0.3.0-valid registry); principles.md
  edited mid-cycle by 0146 (l.61, a threshold, "no-gap rounds"); no v0.3.0 tag; a cut is due (41 rulings); glossary
  and registers stale; AGENTS.md navigation 67 bullets (R4); six undocumented switches; untested modules
  stats-schema, engine/fx, engine/sources, overlay, clean; loop-plan.ts 1184 lines vs its "under 600" header.
- **Replay (S03, blind):** Q1 **mismatch** — the constitution predicts "stop" where 0145 adopts the person's foreign
  commits (P4 l.95/l.99 contradict the ruling); Q5 partial mismatch (no info class in the constitution); Q2, Q3, Q6
  match; Q4 inadmissible (l.61 states it). Replays must run outside the repository (AGENTS.md leaks the rulings).
- **Known seeds (to verify in their steps, not rediscover):** shell duplication — `runOptions` threaded by hand in
  auto/src/index.ts and auto-server/src/worker.ts:380, key tables ×3, ops.ts re-implementing init/amend, fake-claude
  duplicated (61 lines differ); auto-server init lacks 0122 `applyExternalAllows`, 0073 git bootstrap, `amend --brief`;
  auto-server/src/worker-interactive.ts:46,164,167 reaches the core's `services()`; both shells' `phasesLine` still
  say "plan to establish the round"; the kernel→pipeline import edge git-ops.ts:45 → charter-clamp.
- **High-value leads (unverified, `0165-review/leads/README.md`):** a work session's own report.md PASS outranking
  the verifier's FAIL, a self-renamed done.md read as done, an agent-written `Choice:` parsed as the person's (S11,
  S12 — possible P3/P2 breaks); 0146's oscillating gaps never blocking (S11); 0163's walk moving forward /
  oscillating / restarting a shared server under a sibling's turn (S17); the per-run bridge secret in the worker's
  argv (S29); the server's amend accepting the retired `phases` key (S30).

## Report

Written at S35 (2026-11-04) from the step outputs; verified verdicts (S33/S34: 91/91 confirmed) win over step ratings. The findings register's full records (evidence, repro commands, remedies, families) live in the step files under [`0165-review/`](./0165-review/) — §5 carries the deduped, numbered register.

### §0 Executive summary

- **246 findings recorded, 224 after dedupe** (4 synthesis unions absorbing 22 members): **6 S1 · 51 S2 · 118 S3 · 49 S4**; 246/246 CONFIRMED (4 S1 repros re-run independently at verification, 3 upgraded from PLAUSIBLE, 1 re-rated S3→S4; 0 refuted, 0 by-design-recanted).
- By package: auto-core carries ~80% of the findings (the driver's logic is where the family's risk lives); auto ~8% (parser/docs polish — its one S2-class theme is drift from the core's emitters); auto-server ~12% (the spawn boundary and the hand-maintained CLI mirror).
- **Top risks** (all S1): the survey gate installs the agent's brief proposal with no person mark (`0165-001/002`); the verification loop's progress rule never blocks on oscillating gaps (`0165-003`); the release gate certifies after any person commit because "a driver commit" is a message substring (`0165-004`); the manual subtask companions bypass independent verification entirely (`0165-005`); and the umbrella: **every driver-verdict surface is trusted by location, not provenance** (`0165-006`, ∪15).
- **Release readiness**: a cut is due (41+ rulings, no v0.3.0 tag) and **should not ship before W1 and W6 land** — the person-mark and release-gate defects are reachable on every shipped bundle's default flow. The corpus is otherwise healthy: no S1 found in the CLI or web surfaces, secrets handling strong where designed, both adapters honor the frozen interface.
- **What is healthy**: the constitution's architecture held up under a hostile replay; the turn engine, the lane landing sequence, the question journal, the token/scopes design and the web client's DOM discipline are the family's best work; the step program itself (28 bounded sessions, every finding with measures) is the review method that worked.

### §1 Method and provenance

Single-session bounded steps over the three packages (~2–4K source lines each), each with a durable output and a status row; the first attempt (nine parallel agents, all usage-limited) survives only as unverified leads — every lead was run and dispositioned by its owning step (34 confirmed → findings, the rest refuted or superseded). Baseline `d579016b2` (= `358be4003` + plan 0164); only `plans/` changed after it, so every citation is byte-identical at the review's HEAD. Lenses: cross-ruling interaction, crash-consistency, trust boundary & secrets, test-oracle quality, remedy teaching. Verification passes S33/S34 re-reproduced every S1 with a lead draft, re-ran the family leads (R6-r6 7/7, R9-daemon 2/2), probed the one open PLAUSIBLE (upgraded), and mechanically re-ran the corpus probes. The coverage matrix: every src module of the three packages has an owning step (S01's census); the appendix of each step file lists deep/partial/probe coverage.

### §2 Baseline (S00, S01)

Typecheck clean ×3. Suites: auto-core 2912/0; auto 154 pass/8 opt-in skips/0; auto-server 134/2 — the observe `sawDirty` poll-window flake (root-caused at S30-05: a 150 ms poll racing the immediate-answer fixture's dirty window; fix = the server's own FAKE_CLAUDE_DELAY_MS) and the deterministic `worker.test.ts` "usage vocabulary" breach of bun's 5 s default (~15 spawns in one test; fix = split, S31-03). Census: six undocumented switches resolved (two tombstones, two opencode's own, two live — S17-09); untested modules stats-schema/engine-fx/engine-sources/overlay/clean; loop-plan.ts 1184 lines vs its "under 600" header.

### §3 Release audit (the next cut's draft) — findings F9…

The corpus findings of S02/S03, mechanically re-verified at S34. Numbering continues releases.md's F1–F8 (v0.1.0/v0.2.0, closed).

- **F9 (S02-01, S3)** — Category scope lapsed: 22 requirement-bearing rulings (0142–0161, 0163, 0164) carry no `## Category scope`; the family-consistency check cannot run on them (family-check.ts re-run confirms).
- **F10 (S02-02, S3)** — 0132's enactment touched a proper subset of its own Category scope (config-fix.ts, document/roles.ts untouched); S20-02's reproduction (fix re-adding an allow a closed wall retired) is the live consequence.
- **F11 (S02-03, S3)** — the written deprecation lifecycle (tombstone → warning → removal) is not the practiced instant tombstone; 0150 D2 breaks a v0.3.0-valid registry.
- **F12 (S02-04, S3)** — the constitution was edited between releases (0146 rewrote P2's derivative threshold mid-cycle).
- **F13 (S02-05, S4)** — the v0.3.0 git tag was never created (`git tag -l` = v0.1.0, v0.2.0).
- **F14 (S02-06, S3)** — a release cut is due: 41 unreleased rulings (now 47 with 0161–0165) and a completed ruled program.
- **F15 (S02-07, S4)** / **F16 (S02-08, S4)** — glossary and registers stale against 0124–0164.
- **F17 (S02-09, S4)** — derivation-wording vs practice: most decision blocks carry no `Derives:` despite principles.md asking for one (the corpus's own convention drift).
- **F18 (S03-01, S2)** — falsification replay Q1: P4's text contradicts 0145's foreign-commit adoption ("stop" vs "adopt, never a stop"); the constitution and the ruling must be reconciled in the cut.
- **F19 (S03-02, S3)** — Q5: the informational class (0135) has no principle stating it.
- **F20 (S03-03, S4)** — replay silences: lock scope, "shared git state", task-id uniqueness have no constitutional home.
- **F21 (S03-04, S4)** — the replay protocol leaks: an agent session inside the package auto-loads AGENTS.md (which contains the rulings); replays must run outside.
- **F22 (cross, S3)** — the cross-ruling premise-drift pattern (S16/S18/S20): a later ruling amends a shared surface without re-reading dependent rules (0057's wait, 0055's caches and tiers, 0041's permission map). One template line — "premises this ruling changes" — is the proposed guard; it explains roughly a fifth of the register.

### §4 Prior residuals of 0155–0160 → state at HEAD

All dispositioned by their owning steps: **0155**'s failure-direction sweep extended to every git spawn (S19's enumerated map; the remaining quiet-clean reads are now findings `0165-…` S19-02/05); its stashTree asymmetry and coveringAllowKeys counting confirmed as defects (S20). **0156**'s D1 keep-marks hold under the doc scheduler; D2's once-captured formulation confirmed half-built (S08); D4's freshen holds; D7's SIGKILL-direct-child confirmed (S11-03); D8's attribution confirmed drifting in the manual suite (S25). **0157**'s queued-ask-behind-hard-wait and blocked-settle abort confirmed (S06/S14); the probe-sideband "harmless" residual upgraded to a real defect family (S06-01 ∪ S14-06). **0158**'s CRLF floor holds across the task store (S21 verified); the near-miss heading terminator confirmed eating the natural brief shape (S09-01). **0159**'s extra positionals still open (S26-03). **0160**'s registry eviction confirmed missing (S29-02/05); the web form's minimal options stand by construction (S31). **0162**'s observe flake root-caused with a deterministic fix shape (S30-05).

### §5 Findings by layer — the register

Deduped by `pkg:path#symbol#cat` (owner = where the fix lands; highest severity kept, evidence unioned); `∪n` marks a synthesis union of n member findings. 246 recorded → **224 rows**: 6 S1 · 51 S2 · 118 S3 · 49 S4. Disposition = the fix-wave program's bucket (§10). Full records: the step file named in each id.

#### The six S1s (prose)

1. **`0165-001` (S04-06)** — the survey phase installs the agent's `## Project brief` proposal as "approved" whenever the human gate passes, and zero `Fork:` lines pass it — including near-miss shapes (`1. Fork:`, `**Fork:**`) the scan never sees. The project's constants become the session's proposal with no person act beyond a routine transfer. Reproduced end-to-end; remedy: gate the install on the mark, hold zero-fork surveys carrying a proposal, count near-miss forks.
2. **`0165-002` (S07-01)** — the release mark is read anywhere in the agent-written survey.md: an indented example line or fenced snippet equal to `Clarified: yes` releases a forked survey. Same gate, same fix wave.
3. **`0165-003` (S11-02)** — 0146's progress rule compares with the previous round's gap count, not the best: oscillating 2,1,2,1… never blocks, unbounded fix rounds (re-reproduced at verification). The ruled `2 + N` bound is false in code.
4. **`0165-004` (S19-01)** — the release gate's baseline walk stops at the first trailer-less commit, so any person commit ends the driver-commit range: release certifies a tree whose provenance it did not audit — P1's only enforcement moment is a function of who made HEAD.
5. **`0165-005` (S25-01)** — the manual-driver subtask companions close from a narrative wrap-up, bypassing the driver's independent verification and fix loop the suite claims to mirror.
6. **`0165-006` (S32-01, ∪15)** — the umbrella: report.md outranking the verifier's FAIL (S11-01), the session's own todo→done rename surviving a FAIL (S12-01), an agent-written `Choice:` parsed as the person's (S12-02), receipts and the test marker trusted by location (S11-04, S20-05), the formulation unit's surfaces session-writable (S08), the handover document ownerless (S10) — one trust-boundary wave.

The 51 S2s cluster: person marks and commit scope (planning), the recovery ladder's unbounded re-dispatch (S13), the sideband's unwatched channel (S06-01), the key-ring walk family (S17/S16 → `0165-006`-adjacent ∪ under `S32-04`), the wall's matcher blind spots (S20), the release-consumption pathspec-less commits (S07-06), the daemon spawn boundary (S29-01/10), the policy-as-data overrides (S23), the manual-suite vocabulary drift (S25) — prose per finding in the step files.

#### The register

| id (origin) | sev | conf | cat | measures | essence (first loc) | wave |
| --- | --- | --- | --- | --- | --- | --- |
| 0165-001 · S04-06 | S1 | CONF | BOUND | P2 | The survey phase installs the agent's `## Project brief` proposal as 'approved' with no `Clarified: yes`: the install runs whenever the human gate… — auto-core/src/loop-phase.ts:334-337 | W1-person-marks |
| 0165-002 · S07-01 | S1 | CONF | BOUND | P2 | The survey gate's release mark is read anywhere in the agent-written survey.md: a session line equal to `Clarified: yes` after trim — an indented e… — auto-core/src/phases.ts:359-361 | W1-person-marks |
| 0165-003 · S11-02 | S1 | CONF | DEF | P2 | 0146's progress rule compares with the previous count, not the best: oscillating gap counts never block; the ruled `2 + N` bound is false — auto-core/src/wrapup.ts:641-643 | W7-verify |
| 0165-004 · S19-01 | S1 | CONF | BOUND | P1 (enforced at the person's release … | The release gate certifies after any person commit: driverBaseline's walk stops at the first trailer-less commit, so release's own remedy loop ('fi… — auto-core/src/git.ts:679-721 | W6-git |
| 0165-005 · S25-01 | S1 | CONF | DEF | P3 | the subtask companions close from a narrative wrap-up, bypassing the driver's independent verification and fix loop — auto-core/prompts/run-as-subtasks.md:224-259 | W-manual-subtasks |
| 0165-006 · S32-01 (∪15) | S1 | CONF | BOUND | P3 | The trust boundary of every driver-verdict surface is location, not provenance — one family across seven steps: report.md outranks the verifier (S1… — auto-core/src/wrapup.ts | W1-person-marks |
| 0165-007 · S03-01 | S2 | CONF | TRACE | releases.md l.31 | falsification replay fails on Q1: the constitution predicts 'stop' where 0145 ruled 'adopt the person's foreign commits, never a stop' — P4's deriv… — auto-core/docs/principles.md:95-99 | WA-docs |
| 0165-008 · S04-01 | S2 | CONF | BOUND | 0132 D2 (the close at the person's ad… | The sealed wall is skipped whenever the sealing phase's handover runs outside transfer: `run --boundary flow` and plain run's re-entry of an interr… — auto-core/src/wall.ts:543-547 | W4-wall-perms |
| 0165-009 · S05-02 | S2 | CONF | STATE | P6 (recovery re-derives) | A doc-eligible in_progress leftover without an active progress record dead-ends the doc loop on every re-run, and on the way it loses the protectio… — auto-core/src/loop-task.ts:1320-1323 | W9-lanes |
| 0165-010 · S06-01 (∪1) | S2 | CONF | BOUND | P4 (the driver's commit boundary: an … | The --interactive sideband never detaches: a free line typed while no turn runs — the driver's close-out and commit, a driver-run test script, the… — auto-core/src/interactive.ts:215-234 | W5-control |
| 0165-011 · S06-05 | S2 | CONF | DEF | P12 (loud, but the relayed line teach… | defaultLaneLauncher cannot re-invoke a compiled binary: it spawns [execPath, process.argv[1], '_lane', …], and in a `bun build --compile` executabl… — auto-core/src/shell.ts:43-48 | W9-lanes |
| 0165-012 · S07-02 | S2 | CONF | DEF | 0116 D1 ('the unreleased analysis at … | clarify resolves the analysis gate first in every state, not only at the project start: past R-01's establishment an unreleased docs/analysis.md (t… — auto-core/src/clarify.ts:79-113 | W8-planning |
| 0165-013 · S07-06 | S2 | CONF | STATE | P4 | The release consumptions commit pathspec-less ahead of any clean-tree gate: transfer's project start (and m-mode plan's row 0d) folds the person's… — auto-core/src/plan.ts:1083-1085 | W8-planning |
| 0165-014 · S08-01 | S2 | CONF | DEF | 0101 D3/D4 (fix the inputs and re-run… | The reviewed formulation todo cannot be reconstructed once a `plan --new-task` task sits beside it: 0101 stage C widened the digest-keep, formulati… — auto-core/src/formulate.ts:61-74 | W8-planning |
| 0165-015 · S08-09 | S2 | CONF | STATE | P20 (in-flight work never destroyed) | Dispatching the reviewed formulation beside a `--new-task` task overwrites the person's task without a line: the todo (constructed before the add,… — auto-core/src/loop-plan.ts:305-311 | W8-planning |
| 0165-016 · S09-01 | S2 | CONF | DEF | 0115 D2 ("the body is free markdown, … | A round-brief proposal structured like the round.md it becomes is silently truncated: since 0158 D3 any `####` sub-heading ends the subsection (the… — auto-core/src/analysis.ts:85 | W-round-docs |
| 0165-017 · S10-03 | S2 | CONF | BOUND | P7 | Outside the lead's split clause, a checklist a whole-task session writes into subtasks.md is run as the person's: mode off (or auto's lead without… — auto-core/src/execute.ts:387-392 | W9-lanes |
| 0165-018 · S10-05 | S2 | CONF | BOUND | P2 | The context-handover chain has no bound and no advisory: every scope (whole task, stream, fix round) re-dispatches a fresh session for each fresh `… — auto-core/src/execute.ts:173-194 | W0-governance |
| 0165-019 · S10-08 | S2 | CONF | CONC | P17 | Under concurrent doc lanes the handover engine's strict rollback redo is tree-wide: one unit's due-but-invalid handover stashes every sibling's in-… — auto-core/src/execute.ts:484-501 | WC-hygiene |
| 0165-020 · S11-03 | S2 | CONF | FAIL | P20 | A timed-out driver-run lane's command is never killed: the lane wrapper's subshell puts the command beyond SIGTERM and 0156 D7's SIGKILL; it keeps… — auto-core/src/script.ts:438-449 | W6-git |
| 0165-021 · S11-08 | S2 | CONF | STATE | P20 | The script side-effect guard misses a script that reverts the session's uncommitted work to HEAD (git checkout -- ., git stash, reset --hard): the… — auto-core/src/git.ts:349-395 | W6-git |
| 0165-022 · S12-03 | S2 | CONF | DEF | P7 | The charter clamp rewrites the first line that matches by position OR by a substring-equal question: an earlier unrelated marker is overwritten (it… — auto-core/src/charter-clamp.ts:94 | W7-verify |
| 0165-023 · S12-04 | S2 | CONF | STATE | P3 | Every resume or re-run re-anchors the unit baseline at the current HEAD, so the verification charter's commit range (0083 D1, 'every change this ta… — auto-core/src/loop-task.ts:495-507 | W5-control |
| 0165-024 · S12-05 | S2 | CONF | BOUND | P4 | The resume re-anchor puts every trailer-less commit made before the interruption outside the close-out audit: an agent's own `git commit` (the temp… — auto-core/src/loop-task.ts:497-499 | W5-control |
| 0165-025 · S12-06 | S2 | CONF | UX | P2 | The person's one-line Choice dead-ends: `run` never executes a Choice (the executor row lives only in plan's prelude), and under `plan` the executo… — auto-core/src/plan.ts:359-362 | W1-person-marks |
| 0165-026 · S13-01 | S2 | CONF | FAIL | P2 (every automatic escalation bounde… | runSession's catch-all reclassifies every driver-side exception as a transient session fault: under the agent domain's never-reject contract (0037… — auto-core/src/session.ts:914-927 | W-session |
| 0165-027 · S13-04 | S2 | CONF | STATE | 0018 B ('write the active record as s… | 0018's in-flight claim is void under the opencode adapter: attempt writes the active record only after the prompt POST resolves, and opencode's POS… — auto-core/src/attempt.ts:468-489 | W-session |
| 0165-028 · S13-06 | S2 | CONF | FAIL | 0017 D.1/D6 (overflow: do not switch,… | A terminal context-overflow error is classed `overflow` ('handled by the handover mechanism', 0017) but no path hands it over: the ladder labels it… — auto-core/src/engine/ladder.ts:115-199 | W-session |
| 0165-029 · S14-01 | S2 | CONF | FAIL | P2 (every automatic escalation bounde… | The ladder's managed-server restart matches no connection fault the Bun runtime produces: T-057's 'verbatim' move of NETWORK_FAILURE dropped an N (… — auto-core/src/engine/ladder.ts:95 | W-session |
| 0165-030 · S14-05 | S2 | CONF | FAIL | 0026 D3 (the in-flight probe: 'only a… | The liveness probe cannot see the half-open shape it was built for: probeSession asks only whether a GET on a new connection succeeds, so with the… — auto-core/src/session-api.ts:282-296 | W-engine |
| 0165-031 · S16-04 | S2 | CONF | TRACE | 0055 §5 (the default tiers: planning … | Since 0095 the phase's planning (the formulation task) routes as an ordinary `whole` task — the phase type's execute tier, `simple` for implement/t… — auto-core/src/formulate.ts:136 | WD-routing |
| 0165-032 · S16-05 | S2 | CONF | FAIL | 0055 §6.3 (the probe ignores the marks) | The wait-and-probe loop probes against its own evidence: the probe candidate is the first in-window candidate in list order 'ignoring the down mark… — auto-core/src/select.ts:268-273 | WD-routing |
| 0165-033 · S18-01 | S2 | CONF | BOUND | P8 | claude drops permission.external_directory — the 0122 knowledge boundary and 0147 read-only allows have no translation — auto-core/src/agent/claude/contract.ts:30 | WD-routing |
| 0165-034 · S19-02 | S2 | CONF | FAIL | P12 (a failed read never a clean verd… | Release certifies a destination whose git it cannot read: the clean-tree check takes the legacy-typed statusEntries (unreadable → []), and unitAdde… — auto-core/src/release.ts:54 | W-release |
| 0165-035 · S19-03 | S2 | CONF | DEF | 0083 D11 (driver-run scripts never ch… | The script side-effect guard is inert when the target directory sits inside a larger repository: scriptGuardCheck feeds porcelain paths (always top… — auto-core/src/git.ts:358-374 | W6-git |
| 0165-036 · S19-05 | S2 | CONF | FAIL | P4 (committing is the completion cond… | repoRoots reads any failed `rev-parse --is-inside-work-tree` as 'not a repository': a target directory inside a larger repository that git refuses… — auto-core/src/git.ts:1089-1093 | W6-git |
| 0165-037 · S20-01 | S2 | CONF | DEF | 0132 D2 | The wall close's recovery sweeps every live `<path>/**` allow as a recovered door: under the template's boundary it refuses naming /tmp as the refe… — auto-core/src/wall.ts:433-446 | W4-wall-perms |
| 0165-038 · S20-02 | S2 | CONF | BOUND | 0132 D2 | The closed predicate under-reads every reopen except the recorded door name and `<path>/**` allows covering the target: a door under another name o… — auto-core/src/wall.ts:187-194 | W4-wall-perms |
| 0165-039 · S20-03 | S2 | CONF | DEF | 0147 D2 | The 0147 read-only composite's edit deny never matches: opencode's live edit/write/apply_patch tools ask `edit` with a worktree-relative pattern, t… — auto-core/src/external-dirs.ts:97-104 | W4-wall-perms |
| 0165-040 · S20-04 | S2 | CONF | BOUND | 0147 D1 | The knowledge boundary and the wall's standing deny are opencode-only: the claude adapter's translation drops `external_directory` entirely, and no… — auto-core/src/agent/claude/contract.ts:30-40 | W4-wall-perms |
| 0165-041 · S21-01 | S2 | CONF | BOUND | P1 | roleOf classifies any file named handoff.md / testhandoff(-n).md as the handoff process role before the docs/ gate, so a nested destination file of… — auto-core/src/document/roles.ts:158 | WA-docs |
| 0165-042 · S21-02 | S2 | CONF | STATE | P3 | loadPlan reads units.json `status` and `attempts` unsanitized: a runtime `"status":"done"` makes a task done with no done.md (0047 R1's 'done exact… — auto-core/src/tasks.ts:533 | WC-hygiene |
| 0165-043 · S22-01 | S2 | CONF | DEF | 0100 D2 | a body-only provenance difference is labelled binary-newer whichever binary is older — fix/status assert "the running bundle is newer", the notice… — auto-core/src/provenance.ts:174-181 | W-provenance |
| 0165-044 · S23-01 | S2 | CONF | VOCAB | P15 | The decomposition override guard omits the Artifacts protocol it claims to protect — auto-core/src/template.ts:153-159 | WE-policy |
| 0165-045 · S23-02 | S2 | CONF | VOCAB | P15 | Whole/subtask/fix handover and split protocols can be removed by overlays that pass the tier-1 guard — auto-core/src/template.ts:152-231 | WE-policy |
| 0165-046 · S23-03 | S2 | CONF | FAIL | P12 | A guarantee assertion naming an unknown template or phase passes preflight and is silently inert — auto-core/src/intent/guarantees.ts:75-94 | WE-policy |
| 0165-047 · S23-05 | S2 | CONF | BOUND | P15 | Session-facing prose still lives in renderers, including a consciously un-overridable formulation protocol — auto-core/src/intent/guarantees.ts:158-165 | WE-policy |
| 0165-048 · S25-02 | S2 | CONF | STATE | P6 | resume-subtasks rejects exactly the state a completed subtask leaves: its decomposition gate requires every S<nn>/todo.md after earlier items were… — auto-core/prompts/resume-subtasks.md:59-70 | W-manual-subtasks |
| 0165-049 · S25-03 | S2 | CONF | VOCAB | P13 | the manual fix subject derives <session> as the landed-share count, not one past the highest landed ordinal — auto-core/prompts/run.md:252-257 | W-manual-fix |
| 0165-050 · S25-04 | S2 | CONF | VOCAB | P13 | the manual verifier never writes 0146's countable gap grammar, while the master bases its fix budget on counting those entries — auto-core/prompts/run-verify.md:108-114 | W-manual-fix |
| 0165-051 · S25-05 | S2 | CONF | BOUND | P5 | cleanroom's audit-plan verifier sends every dimension's findings to shared audit.md, contradicting the declared per-task findings.md owner — auto-core/templates/bundles/cleanroom/intents/cleanroom.md:446-458 | W-cleanroom-policy |
| 0165-052 · S25-06 | S2 | CONF | SEC | P12 | the cleanroom source-free receipt rule has no enforcement at the raw-log boundary: driver and manual receipts copy arbitrary red-lane evidence into… — auto-core/src/script.ts:470-489 | W-cleanroom-policy |
| 0165-053 · S25-07 | S2 | CONF | DEF | P6 | both subtask companions select the first phase lacking a closed suffix but ignore its [x] tick, so a completed earlier phase wins over the current… — auto-core/prompts/run-as-subtasks.md:35-44 | W-manual-subtasks |
| 0165-054 · S29-01 | S2 | CONF | SEC | AGENTS.md Security family (references… | The per-run worker-bridge secret rides the worker's argv (the spawn payload's transport.token): any local user — and the run's own agent session, a… — auto-server/src/daemon.ts:413 | W-server-trust |
| 0165-055 · S29-10 | S2 | CONF | STATE | P12 | A spawn that throws (E2BIG from an argv payload over 128 KiB — a large plan `input` or switch value, both uncapped; ENOENT for a missing `bash` und… — auto-server/src/daemon.ts:450-479 | WF-server |
| 0165-056 · S32-02 (∪7) | S2 | CONF | DUP | P5 | The shell mirror is maintained by hand and drifts by lockstep misses: runOptions ×2 (auto/index.ts, auto-server/worker.ts), init/amend ×2 (ops.ts r… — auto-server/src/ops.ts | W-shell-seam |
| 0165-057 · S32-04 (∪5) | S2 | CONF | BOUND | P17 | Every restart of a shared managed host is an unsynchronized act: the 0163 walk (S17-01/02/03), the failure rotation and the AGENTS.md sync restart… — auto-core/src/router.ts:535-551 | W2-keyring |
| 0165-058 · S00-01 | S3 | CONF | TEST | P12 | auto-server suite red at HEAD: worker.test.ts usage-vocabulary case deterministically exceeds bun's 5 s per-test default — auto-server/test/worker.test.ts:246 | WF-server |
| 0165-059 · S00-02 | S3 | PLAU | TEST | P12 | the shells' test suites have no bunfig preload — not hermetic against the operator's model registry and ambient OPENCODE_AUTO_* — auto/ (no bunfig.toml) | WB-test |
| 0165-060 · S01-01 | S3 | CONF | TRACE | P18 | INDEX table grammar broken in 27 rows: an undefined 7th cell in 0139–0164, 8 cells in 0162, an unescaped pipe in 0086 — auto-core/plans/INDEX.md:106 | W0-governance |
| 0165-061 · S01-03 | S3 | CONF | TRACE | P18 | 11 INDEX code homes name src files that no longer exist, 9 of them in active-authority rows — auto-core/plans/INDEX.md (rows 0001, 0003, 0004, 0006, 0010, 0020, 0023, 0034, 0054) | W0-governance |
| 0165-062 · S01-04 | S3 | CONF | DOC | P13 | six OPENCODE_AUTO_* switches parsed in code are documented nowhere (README, MANUAL, daemon docs, core docs) — auto-core/src/switches.ts | WC-hygiene |
| 0165-063 · S01-05 | S3 | CONF | TEST | principles 'How to rule': a requireme… | five auto-core modules have no direct test import (stats-schema 635 lines, engine/fx, engine/sources, overlay, clean); loop-plan/loop-phase thinly… — auto-core/src/stats-schema.ts | WB-test |
| 0165-064 · S01-06 | S3 | CONF | DOC | P13 | docs drift: shell-contract §A names a nonexistent core module `server` and omits clarify/release/fork/remove-fork/driver-helper; §C claims CONTRACT… — auto-core/docs/shell-contract.md:9-10 | WA-docs |
| 0165-065 · S01-07 | S3 | CONF | CPLX | R4 | AGENTS.md navigation regrown into R4's documented failure mode: 67 bullets averaging ~485 characters (longest ~2.6K) — auto-core/AGENTS.md (## Navigation) | W0-governance |
| 0165-066 · S02-01 | S3 | CONF | TRACE | 0123 D1/D3 | Category scope discipline lapsed: 22 requirement-bearing rulings (0142–0161, 0163, 0164) carry no Category scope section — auto-core/plans/0142-*.md … 0164-*.md | W0-governance |
| 0165-067 · S02-02 | S3 | CONF | TRACE | principles.md l.447 | 0132's enactment touched a proper subset of its own Category scope (config-fix.ts and document/roles.ts marked changed, untouched; the parser home… — auto-core/plans/0132-sealed-reference-wall.md (Category scope) | W0-governance |
| 0165-068 · S02-03 | S3 | CONF | VOCAB | P13 | the written deprecation lifecycle (tombstone → warning release → removal) is not the practiced one (instant parse-time tombstones); 0150 D2 breaks… — auto-core/docs/releases.md:24 | WA-docs |
| 0165-069 · S02-04 | S3 | CONF | TRACE | releases.md l.5 | the constitution was edited between releases: 0146 (7401fe7b5) rewrote Tier I P2's derivation line, stamp unchanged; the line imports a threshold a… — auto-core/docs/principles.md:61 | WA-docs |
| 0165-070 · S02-06 | S3 | CONF | TRACE | releases.md l.5 | a release cut is due: 41 unreleased rulings and a completed ruled program (0155–0160) — auto-core/plans/INDEX.md (release column) | WA-docs |
| 0165-071 · S03-02 | S3 | CONF | TRACE | releases.md l.31 | falsification replay partially fails on Q5: no principle states the informational class, so a divergent superseded key reads as an exit-1 finding — auto-core/docs/principles.md:197-216 | WA-docs |
| 0165-072 · S04-02 | S3 | CONF | STATE | P6 | The survey's approved brief installs after the phase's completion rename: a kill between them loses the install for good (the phase reads done, no… — auto-core/src/loop-phase.ts:303 | WC-hygiene |
| 0165-073 · S04-03 | S3 | CONF | STATE | P8 | preflight's late exits (the run-start dirty gate, orphan recovery, the housekeeping commit failure) return after protect() and never unprotect: the… — auto-core/src/loop-preflight.ts:542 | WC-hygiene |
| 0165-074 · S04-04 | S3 | CONF | FAIL | 0155 D1 | 0149's run-start exemption consumes 0155 D1's unreadable-status sentinel: with an active progress record, a corrupt index or a broken nested reposi… — auto-core/src/loop-preflight.ts:596-602 | WC-hygiene |
| 0165-075 · S04-05 | S3 | CONF | VOCAB | 0096 D7 (l.252-254, l.261) | A park on an id that exists nowhere is treated as a cross-phase park and throws: exit 1 through the unexpected-throw path (a run-status `failure`),… — auto-core/src/execute.ts:245-251 | WC-hygiene |
| 0165-076 · S04-07 | S3 | CONF | BOUND | 0132 D2/D4 | The wall closes before the phase's gates are checked: on a sealing phase that also carries a gate (config `acceptanceGate` naming it, or a custom t… — auto-core/src/loop-phase.ts:295-301 | W4-wall-perms |
| 0165-077 · S04-08 | S3 | CONF | FAIL | P12 | A phase type file's field block ends at the first non-field line, so a blank line between fields, a comment after the title, `Wall :`, `Wall：` or `… — auto-core/src/phases/custom.ts:76-81 | WA-docs |
| 0165-078 · S04-09 | S3 | CONF | UX | P8 | The run-start clean gate cannot tell driver-written leftovers from the person's: a kill inside the k-phase extraction (no progress record by design… — auto-core/src/loop-preflight.ts:622-624 | WC-hygiene |
| 0165-079 · S05-01 | S3 | CONF | CONC | P20 | runDocLaneLoop's Promise.race over the pipelines has no rejection arm: any throw out of one doc unit's pipeline (S04-05's cross-phase park, a Promp… — auto-core/src/loop-task.ts:1404 | W9-lanes |
| 0165-080 · S05-03 | S3 | CONF | STATE | 0068 D8 ('absence (crash, kill) is th… | D14's recovery treats every dead pid as an orphan even when the worker wrote its controlled-exit report (the matrix row is 'crash / no report'), re… — auto-core/src/loop-preflight.ts:896-922 | W9-lanes |
| 0165-081 · S05-04 | S3 | CONF | FAIL | P12 | The orphan recovery awaits any live process under a recorded lane pid with no bound, no /exit and no identity check: a pid recycled after a reboot… — auto-core/src/loop-preflight.ts:896-900 | W9-lanes |
| 0165-082 · S05-05 | S3 | CONF | DEF | P2 (a pending /exit lands at the firs… | The serial path's park and repair-close arms return 0 without the task-boundary hook set: no step pause, no /exit checkpoint, no hibernate check, n… — auto-core/src/loop-task.ts:527-539 | W9-lanes |
| 0165-083 · S05-06 | S3 | CONF | TRACE | 0079 §4 / §6 ('No repair under lanes … | The --repair confinement ('never under worktree lanes or branch isolation' — RunAllOpts.repair, AGENTS.md; 0079 §4 'under lanes … the option does n… — auto-core/src/loop-task.ts:431 | W9-lanes |
| 0165-084 · S05-07 | S3 | CONF | BOUND | P18 (machine-addressable history — th… | The doc-lane decorator's driver-state rider sweeps a sibling's in-transit completion into this unit's commit: a sibling's markDone rename (docs/T-B… — auto-core/src/git-ops.ts:294-296 | W9-lanes |
| 0165-085 · S05-08 | S3 | CONF | DEF | 0151 D2 ('stability is per target dir… | The lane branch digest hashes the directory string, not its identity: a lane dispatched by `run /link/proj` and recovered by `run .` from inside (p… — auto-core/src/lanes.ts:725-726 | W-fork/W-lanes |
| 0165-086 · S05-09 | S3 | CONF | DOC | 0125 D1/D4 | The CLI README's parallel-execution contract predates 0099/0125/0151: it says width without a parallel level is a usage error (0125 made it legal,… — auto/README.md:199 | WA-docs |
| 0165-087 · S06-02 | S3 | CONF | FAIL | P2 (the person's stop is honored at t… | The two planned multi-hour sleeps ignore /exit: the hibernate window (bookedSleep on Bun.sleep at every boundary, after maybeExit) and the window w… — auto-core/src/hibernate.ts:29-40 | W5-control |
| 0165-088 · S06-03 | S3 | CONF | UX | P8 (every surfaced line teaches its r… | Design challenge to 0014 §2/§9: /exit (and /failback) typed while the line is pending is consumed as the answer — at a step pause, whose content is… — auto-core/src/interactive.ts:151-154 | W5-control |
| 0165-089 · S06-04 | S3 | CONF | BOUND | P14 (differences inject through decla… | The services() allowlist is evaded across the package boundary: auto-server/src/worker-interactive.ts calls the ambient accessor (requestExit, requ… — auto-server/src/worker-interactive.ts:46 | W3-shell-seam |
| 0165-090 · S06-06 | S3 | CONF | CONC | P17 (one sole writer of shared state;… | The run lock's liveness reading assumes one pid space per hostname: its own-pid shortcut reads a lock naming this pid on this host as a dead predec… — auto-core/src/lock.ts:143-155 | W5-control |
| 0165-091 · S06-07 | S3 | CONF | FAIL | P20 (no unwatched work; control lands… | No SIGTERM/SIGHUP handler anywhere: a plain `kill <pid>`, `timeout`, or a supervisor's stop ends the driver with none of the force-terminate path's… — auto-core/src/loop.ts:121-139 | W5-control |
| 0165-092 · S06-08 | S3 | CONF | UX | P8 (the surfaced line teaches a false… | The startup hibernate sleeps before runAll installs its SIGINT handler and after preflight protected the driver-owned files: one Ctrl+C during it (… — auto-core/src/loop.ts:116 | W5-control |
| 0165-093 · S07-03 | S3 | PLAU | BOUND | P2 | docs/analysis.md — the roadmap that shapes every later round and the round-brief proposals that install verbatim past the round-start gate — is wri… — auto-core/src/protect.ts:39 | W1-person-marks |
| 0165-094 · S07-04 | S3 | CONF | BOUND | 0076 §2 ('testByDriver unchanged') | plan --adopt executes any tmp/test.sh with no channel gate: adoptUnit is never handed testByDriver or the phase, so a standalone session's marker r… — auto-core/src/work-order.ts:163-185 | W8-planning |
| 0165-095 · S07-07 | S3 | CONF | BOUND | 0101 D4 ('every phased state that is … | Bare plan still owns the phase-tail reshape in phased mode: row 3 re-syncs the tail uncommitted and teaches 're-run: plan', whose re-run then refus… — auto-core/src/plan.ts:363-395 | W8-planning |
| 0165-096 · S07-08 | S3 | CONF | TRACE | 0116 D3 ('the command is the review: … | clarify's analysis review omits the `## Round briefs` proposals its release puts in force: 0116 D3's print list (roadmap lines, forks, brief presen… — auto-core/src/clarify.ts:98-109 | W8-planning |
| 0165-097 · S08-02 | S3 | CONF | FAIL | P12 (degradation renders its fallback… | The record-time charter check's fail-closed result is indistinguishable from a real flag: a 60 s timeout, a session error or an unparsable reply re… — auto-core/src/prompt-verify.ts:239-245 | W8-planning |
| 0165-098 · S08-03 | S3 | CONF | STATE | 0156 D4 ('the second pass verifies wh… | 0156 D4's freshen stops at the planning input and the brief, but the remediation executor also rewrites the round brief, the analysis and the hando… — auto-core/src/loop-plan.ts:260-277 | W8-planning |
| 0165-099 · S08-05 | S3 | CONF | TRACE | 0131 D1/D2 + its analysis (P19: the m… | The formulation session never sees the format sketch's closing terminator: taskBody drops every standalone `<!-- auto: eof -->` line from the body… — auto-core/src/tasks.ts:283-296 | W8-planning |
| 0165-100 · S08-07 | S3 | CONF | STATE | P18 (plain files and git the only dur… | The reviewed todo's identity lives only in gitignored `.auto/units.json` (synthDigest): in a fresh clone, a `fork` worktree, or after `.auto/` is c… — auto-core/src/loop-plan.ts:357-369 | W8-planning |
| 0165-101 · S08-10 | S3 | CONF | DOC | P10 derivations (docs/principles.md:226) | The constitution still lists OPENCODE_AUTO_PLAN_VERIFY as a kill switch that 'removes machinery, never checks': since 0113 it is a default-off opt-… — auto-core/docs/principles.md:226 | W0-governance |
| 0165-102 · S09-02 | S3 | CONF | FAIL | round-close.ts:40-41 ("a hung build m… | The round-close build's 30-minute cap does not bound the wait: runBuild kills only `sh` and then awaits EOF on pipes a grandchild still holds, so a… — auto-core/src/round-close.ts:102-115 | WC-hygiene |
| 0165-103 · S09-03 | S3 | CONF | STATE | P6 (every step idempotent; recovery r… | The brief install's idempotence skips the commit: an equal brief.md on disk returns [] before committing, so a kill between the write and the brief… — auto-core/src/brief.ts:119 | W-round-docs |
| 0165-104 · S09-04 | S3 | CONF | UX | 0081 D14.3 (the awaiting note: tasks … | status's awaiting-clarification note fires for every not-done human-gated phase whose survey.md is missing or still being written: an unstarted sur… — auto-core/src/status.ts:106-120 | W-round-docs |
| 0165-105 · S09-05 | S3 | CONF | UX | 0105 (the brief renders the stop's st… | driver-helper's build-less round close tells two untruths: the held shape renders round-close's "⚠ build: no build command configured" beside its o… — auto-core/src/driver-helper.ts:240-244 | W-round-docs |
| 0165-106 · S10-04 | S3 | CONF | STATE | P6 | A kill between the decompose session's end and its `decompose` commit is not re-derived: the re-run's 'already exists' path injects the uncommitted… — auto-core/src/execute.ts:695-710 | W9-lanes |
| 0165-107 · S10-06 | S3 | CONF | STATE | P6 | requireArtifact runs the unit clean gate before `spec.reset`: an interrupted phase step whose session is gone (or a --new-session / legacy-record /… — auto-core/src/artifact.ts:186-196 | W9-lanes |
| 0165-108 · S11-05 | S3 | CONF | DEF | P12 | Driver script output is read whole into memory: runScript's `out` field (no consumer) and every lane/regression verdict read load the full log to k… — auto-core/src/script.ts:111 | W6-git |
| 0165-109 · S11-07 | S3 | CONF | DEF | P9 (counts presentation) | The proxy-answer scan reads every marker in each changed file, not the session's diff: a later task re-books an earlier task's AUTO-RESOLVE and AUT… — auto-core/src/resolve.ts:310-350 | W7-verify |
| 0165-110 · S11-09 | S3 | CONF | FAIL | P12 | Receipt coverage diffs only the repositories the receipt recorded: a nested repository that appeared after the green receipt is never diffed, so it… — auto-core/src/git.ts:1403-1417 | W6-git |
| 0165-111 · S11-10 | S3 | CONF | UX | P8 | 0142's dead-marker consumption skips the verify FAIL path: a verify session's unservable tmp/test.sh survives into the fix round, whose close block… — auto-core/src/wrapup.ts:222-229 | W7-verify |
| 0165-112 · S12-07 | S3 | CONF | BOUND | P4 | beginUnit's carryover classifies any content edit of docs/T-NNN/todo.md\|done.md, a tasks.md or a phases.md as a driver-state leftover: a person's… — auto-core/src/git.ts:394-411 | W5-control |
| 0165-113 · S12-08 | S3 | CONF | STATE | P6 | The progress record — the recovery point itself — is written in place (Bun.write), the one driver recovery file without the .tmp → rename disciplin… — auto-core/src/resume.ts:153-156 | W5-control |
| 0165-114 · S12-09 | S3 | CONF | FAIL | P12 | 0145's adoption swallows 0155 D1's unreadable-HEAD problem: a baseline repository whose HEAD no longer reads (removed, corrupt) is reported as 'for… — auto-core/src/resume-gate.ts:208-214 | W5-control |
| 0165-115 · S12-10 | S3 | CONF | UX | P8 | The 0149 run-start line promises 'the resumed unit's close commits them', but under strict resume a dead or ineligible recorded session takes the r… — auto-core/src/loop-preflight.ts:599-601 | W5-control |
| 0165-116 · S13-02 | S3 | CONF | FAIL | P12 | askHuman with no timeout (plan's attended-human questions) never returns on a closed or non-interactive stdin: Bun's readline question() stays pend… — auto-core/src/session-api.ts:351-372 | W-session |
| 0165-117 · S13-05 | S3 | CONF | CONC | P17 (one sole writer of shared state) | Concurrent restarts of one managed opencode host double-spawn and leak a server: restart() closes the current instance and awaits a fresh spawn wit… — auto-core/src/agent/opencode/server.ts:198-207 | W-session |
| 0165-118 · S14-02 | S3 | CONF | DEF | 0055 §4.5/§7 (the late step-up: an ov… | The late step-up re-fires on every later failure of the same turn: it classifies the failure slice's merged message (an error appends, a message-le… — auto-core/src/engine/concerns/step-up.ts:161-175 | W-engine |
| 0165-119 · S14-03 | S3 | CONF | FAIL | P12 (fail loud — not a silent disable) | One throw inside a synthetic (concurrent) handler poisons the spine's emission chain for the rest of the turn: `emissions = emissions.then(…)` neve… — auto-core/src/engine/spine.ts:364-377 | W-engine |
| 0165-120 · S14-04 | S3 | CONF | FAIL | P20 (the concurrent-writes guard: abo… | The usage concern's two mid-turn steer failures (the wall's handover hint, a milestone notice) settle the turn blocked without aborting the still-r… — auto-core/src/engine/concerns/usage.ts:58-59 | W-engine |
| 0165-121 · S15-01 | S3 | CONF | STATE | 0152 D2 ('Exactly-once per stint', 'C… | 0152's 'exactly-once per stint' breaks in the crash window of the task switch: statsTask appends the closing stint's ledger line synchronously, the… — auto-core/src/stats.ts:423-435 | W9-lanes |
| 0165-122 · S15-02 | S3 | CONF | STATE | 0068 S4 AUTO-DECISIONs (the honesty m… | The stats document's lanes section is never reset — not at the round rollover, not at flush — so every later round's conclusion reports every lane… — auto-core/src/stats.ts:187-202 | W9-lanes |
| 0165-123 · S15-03 | S3 | CONF | CONC | 0099 D8 (the stats audit 'audit and f… | statsSessionEnd still assumes one live session: under doc lanes (0099 D8's per-unit active map) one sibling's end stops the shared heartbeat and re… — auto-core/src/stats.ts:602-616 | W9-lanes |
| 0165-124 · S15-04 | S3 | CONF | DEF | 0067 P2b ('the emitter totals the run… | The run-end bracket's run-scope usage total is wrong both ways — it re-adds earlier runs' consumption, and it omits every lane's: the session roll-… — auto-core/src/stats.ts:631-659 | W9-lanes |
| 0165-125 · S15-06 | S3 | CONF | STATE | 0152 D1 ('identity and bracket: task,… | A ledger line's identity and time are the close moment's, not the stint's: taskStintRecord stamps `phase`/`round` from the document at the next tas… — auto-core/src/stats-schema.ts:613-634 | W9-lanes |
| 0165-126 · S16-02 | S3 | CONF | TRACE | 0057 S4 (the scheduled wait: 'a ring … | recoveryAt still treats an exhausted key ring as 'instant unknown' (0057: 'waiting alone may never cure it'), but since 0144 D1/0163 D1 every key m… — auto-core/src/select.ts:276-306 | W2-keyring |
| 0165-127 · S16-03 | S3 | CONF | DEF | 0055 §7.1 (Cost: the masked key; What… | The classifier's run cache keys on the message with its times and digits masked (0055 §7.1 'Cost'), but the cached answer carries an absolute reset… — auto-core/src/classify.ts:126-141 | WD-routing |
| 0165-128 · S16-06 | S3 | CONF | UX | P8 (every surfaced line teaches its r… | The capability clamp's one blocking line teaches the most destructive remedy: '--test-by-driver needs an agent that takes messages into a live sess… — auto-core/src/capability.ts:186-193 | WD-routing |
| 0165-129 · S16-08 | S3 | CONF | BOUND | P20 (transient faults waited out with… | Design challenge: the strict-resume eligibility verdict treats a scheduled, self-curing condition — the recorded model outside its `avoid`/`only` w… — auto-core/src/router.ts:1118-1157 | WD-routing |
| 0165-130 · S17-04 | S3 | CONF | SEC | AGENTS.md Security family ('Logs, mod… | A credentialed external-server URL is printed whole on three driver lines — the run-start switch line (`OPENCODE_AUTO_SERVER=<url>`), the opencode… — auto-core/src/switches.ts:731 | W-secrets |
| 0165-131 · S17-05 | S3 | CONF | SEC | AGENTS.md Security family | The loader quotes an env-overlay *name* back verbatim, so the most natural misplaced secret — a .env line pasted as a key (`"OPENAI_API_KEY=sk-…":… — auto-core/src/models.ts:475-480 | W-secrets |
| 0165-132 · S17-06 | S3 | CONF | TRACE | docs/principles.md:434 (the family to… | The security requirement family as written — 'keys and env values are references, never literals; a resolved value never enters anything the tool b… — auto-core/docs/principles.md:434 | W0-governance |
| 0165-133 · S17-07 | S3 | CONF | BOUND | 0059 X1 ('This closes W1 for every ta… | The X1 scrub has two gaps: the claude adapter's own `claude --version` child inherits the driver's OPENCODE_AUTO_* whole whenever the profile sets… — auto-core/src/agent/claude/host.ts:33 | W-secrets |
| 0165-134 · S17-08 | S3 | CONF | UX | P8 (every surfaced line teaches its r… | Retired route words fail strict validation as unknown words, never as tombstones: a v0.3.0-valid `routes.number-recovery` (0150 D2) or `understand`… — auto-core/src/models.ts:791-797 | W-vocab |
| 0165-135 · S18-02 | S3 | PLAU | CONC | P12 | manage.restart and close are unserialized — overlapping calls orphan a spawned opencode serve process — auto-core/src/agent/opencode/server.ts:198 | WD-routing |
| 0165-136 · S18-03 | S3 | CONF | DEF | P20 | claude's unbounded awaits: live.done on the model-change path and pump's live.proc.exited — a process that never exits hangs the dispatch with no c… — auto-core/src/agent/claude/client.ts:324 | WD-routing |
| 0165-137 · S18-04 | S3 | PLAU | FAIL | P12 | a restart that throws mid-way leaves the host on a closed server, and the rotation path's fallback log line never fires on that path — auto-core/src/agent/opencode/server.ts:204 | WC-hygiene |
| 0165-138 · S19-04 | S3 | CONF | BOUND | P4 (the driver commits the session's … | The subtree confinement of a target inside a larger repository is half-applied: status and add carry `-- .`, but commitTree's `git commit` takes th… — auto-core/src/git.ts:207-214 | W6-git |
| 0165-139 · S19-06 | S3 | CONF | DUP | P5 (one owning home per mechanism; du… | The doc-lane decorator's beginUnit is a hand copy of the base gate that missed two later amendments — 0141 D1 (untracked driver-workdir files are n… — auto-core/src/git-ops.ts:317-332 | W6-git |
| 0165-140 · S19-07 | S3 | CONF | VOCAB | P4 (the SHA baseline audit) | The driver-commit criterion is the substring 'Auto-Stage:' anywhere in a commit message — subject, body or quoted text — not git's trailer block: a… — auto-core/src/git.ts:658 | W6-git |
| 0165-141 · S19-08 | S3 | CONF | FAIL | P4 (git history as the rollback ancho… | foreignCommits answers 0 whenever its range does not mean what the audit assumes: a failed `git log` (unresolvable baseline sha) is never checked,… — auto-core/src/git.ts:653-659 | W6-git |
| 0165-142 · S19-09 | S3 | CONF | BOUND | 0059 X1 (the driver's variables never… | The driver's unified commit runs every git hook of the target repository — unruled (no --no-verify, no hooksPath, no plan mentions hooks) — and the… — auto-core/src/git.ts:207-214 | W6-git |
| 0165-143 · S20-06 | S3 | CONF | DEF | 0128 | fork cannot build a project with nested-of-nested repositories: it adds worktrees in repoRoots' commit order (deepest first), so the parent's `work… — auto-core/src/fork.ts:174 | W-fork |
| 0165-144 · S20-07 | S3 | CONF | DEF | 0139 | fork and remove-fork disagree with git about the worktree path whenever it is reached through a symlink: git registers the realpath, remove-fork lo… — auto-core/src/fork.ts:103 | W-fork |
| 0165-145 · S20-08 | S3 | CONF | UX | P8 | Every worktree-creation failure reports git's progress line instead of its cause: `git worktree add` prints 'Preparing worktree (new branch …)' bef… — auto-core/src/git-worktree.ts:46 | W-fork |
| 0165-146 · S20-09 | S3 | CONF | UX | 0139 | remove-fork's 'the tips above stay recoverable via git reflog until collection' is false: the fork's commits were made in the linked worktree, whos… — auto-core/src/fork.ts:431-433 | W-fork |
| 0165-147 · S20-10 | S3 | CONF | TRACE | 0138 | 0138 made opencode.json a committed surface, but the stamp and wall code still argue from 'untracked machine state': every wall commit's message re… — auto-core/src/wall.ts:497 | W4-wall-perms |
| 0165-148 · S20-11 | S3 | CONF | CPLX | 0074 §2.3/§5 | land derives the original branch as 'the one local branch outside the driver families': any designated repository with a second ordinary branch can… — auto-core/src/land.ts:25-33 | W-land |
| 0165-149 · S20-12 | S3 | CONF | UX | 0132 D2 | The wall's edges teach false remedies: a dangling re-created door is not a reopen (stat follows the link, the comment says 'any entry'), and a fail… — auto-core/src/wall.ts:182-194 | W4-wall-perms |
| 0165-150 · S20-13 | S3 | CONF | TEST | 0122 | The stamp placement recognizes only a `/**` catch-all: a person catch-all spelled `*` (or `**`, `/*`) lands last and silently kills the 0122 allows… — auto-core/src/external-dirs.ts:166-174 | W4-wall-perms |
| 0165-151 · S21-03 | S3 | CONF | FAIL | P12 | An unparseable units.json reads as empty and the next write replaces it with the one new entry: every lane record (0068 D14's orphan-scan input), p… — auto-core/src/tasks.ts:424-433 | WC-hygiene |
| 0165-152 · S21-04 | S3 | CONF | FAIL | P12 | Field-block near-misses drop declared fields silently: a blank line between fields, `Key :`, a fullwidth `：` (tolerated by every other driver proto… — auto-core/src/document/unit.ts:238-258 | WA-docs |
| 0165-153 · S21-05 | S3 | CONF | DUP | P5 | `Depends:` has two homes for subtasks: the split reads it from the checklist line (split.ts), the decompose pipeline only from S<nn>/todo.md — a li… — auto-core/src/tasks.ts:204-225 | WA-docs |
| 0165-154 · S22-02 | S3 | CONF | STATE | P6 | a crash mid-applySync misattributes the tool's own write as person-edited forever: disk=binary≠stamp classifies person-edited, the stamp entry stan… — auto-core/src/sync.ts:143-147 | W-provenance |
| 0165-155 · S22-03 | S3 | CONF | STATE | P6 | fix's source/destDir→brief move is not idempotent across the brief→config write gap: a re-run after a crash between the two writes duplicates the m… — auto-core/src/config-fix.ts:148-158 | W-config |
| 0165-156 · S22-04 | S3 | CONF | FAIL | P12 | sync answers a broken config.json with ✓ exit 0: bundleNameOfConfig swallows the load failure and the nothing-message claims "the config's intent n… — auto-core/src/sync.ts:192-201 | W-config |
| 0165-157 · S22-05 | S3 | PLAU | STATE | P6 | the config layer's committed-state writes are plain Bun.write, not write-then-rename — a kill mid-write leaves unparsable state that blocks the ver… — auto-core/src/config.ts:271-275 | W-config |
| 0165-158 · S22-08 | S3 | CONF | TEST | 0100 D2 | the provenance direction tests pin only heading-delta cases — the body-only (ambiguous) direction is unpinned, the oracle gap behind S22-01 — auto-core/test/provenance.test.ts:106-195 | W-provenance |
| 0165-159 · S23-04 | S3 | CONF | FAIL | P12 | Bundle parsing accepts malformed guarantee and test-lane bodies, deferring failure until after materialization — auto-core/src/bundle.ts:80-85 | WE-policy |
| 0165-160 · S24-03 | S3 | CONF | DOC | P4 | fix.md still says the DRIVER commits only after re-verification passes, contradicting 0148's per-session durable batches — auto-core/templates/prompts/fix.md:34 | W-template-copy |
| 0165-161 · S24-04 | S3 | CONF | DOC | P2 | The default acceptance duty says every task FAIL stops immediately for a person, skipping the automatic fix loop — auto-core/templates/intents/default.md:93-100 | W-template-copy |
| 0165-162 · S24-05 | S3 | CONF | VOCAB | P13 | The remediation mode brief omits exit code 3 from the frozen exit vocabulary — auto-core/templates/prompts/_mode-brief.md:20-28 | W-template-copy |
| 0165-163 · S25-08 | S3 | CONF | VOCAB | P13 | 0148's short-title grammar is still incomplete across the manual suite: subtask close-outs keep full-title placeholders and the formulation share k… — auto-core/prompts/run-as-subtasks.md:83-88 | W-manual-vocabulary |
| 0165-164 · S25-09 | S3 | CONF | STATE | P6 | resume-subtasks unconditionally recommits an already-committed FAIL report — auto-core/prompts/resume-subtasks.md:93-103 | W-manual-subtasks |
| 0165-165 · S25-11 | S3 | CONF | TEST | P13 | the ratchets pin vocabulary presence but not the ruled relationships, allowing all of the above protocol drift to ship green — auto-core/test/manual-prompts-ratchet.test.ts:77-113 | W-manual-ratchet |
| 0165-166 · S26-03 | S3 | CONF | DEF | 0159 | extra positionals are silently ignored on every command — auto/src/index.ts:1210 | W3-shell-seam |
| 0165-167 · S27-01 | S3 | CONF | UX | P8 | phasesLine's missing-index remedy names plan, but its only caller context (phased projects) is exactly where plan refuses naming transfer — auto/src/index.ts:3234 | W3-shell-seam |
| 0165-168 · S29-02 | S3 | CONF | STATE | P6 | A restored run whose worker never reconnects is restored again at every daemon restart, forever: nothing in the daemon retires it, DELETE answers 4… — auto-server/src/question-journal.ts:186-211 | WF-server |
| 0165-169 · S29-03 | S3 | CONF | DEF | P12 | An IPv6 bind (`serve --hostname ::1` or `::`) writes a transport URL (`ws://::1:<port>/…`, unbracketed) that the worker's own parseTransport refuse… — auto-server/src/daemon.ts:477 | WF-server |
| 0165-170 · S29-05 | S3 | CONF | STATE | 0160 Deferred (run-registry eviction) | The run registry and the hubs are never evicted: every terminal run keeps its 8 KiB tail and request for the daemon's life, and its hub keeps the p… — auto-server/src/daemon.ts:218 | WF-server |
| 0165-171 · S29-06 | S3 | CONF | BOUND | AGENTS.md Security family ('nothing b… | The per-run `switches` carrier admits the two env-only names that are not switches — OPENCODE_AUTO_MODELS (the operator registry layer's path) and… — auto-server/src/request.ts:111 | W-server-trust |
| 0165-172 · S29-09 | S3 | CONF | DEF | P12 (fail loud, early) | `serve --launch <relative path>` is never resolved or checked: from the source layout the spawn cwd is the package's src/, so every run fails with… — auto-server/src/index.ts:396-399 | WF-server |
| 0165-173 · S30-03 | S3 | CONF | FAIL | P12 | observe's worktree verdict resolves a git read failure to clean — an unreadable repository serves 'clean' to the web UI (P12's uncertain-readings-t… — auto-server/src/observe.ts:127 | WF-server |
| 0165-174 · S32-03 | S3 | CONF | BOUND | P14 | The core's internal layering is guarded by a hand-mapped ~200-row table while the package boundary is fully open (`./*` exports every src file), an… — package.json:2-5 | W3-shell-seam |
| 0165-175 · S32-05 | S3 | CONF | TEST | P19 | Weak-oracle tests pin defects as behavior: the blockage suite's whole-text Choice match (S12's note), the turn-trace golden freezing a missing abor… — auto-core/test/blockage-diagnosis.test.ts:233-236 | WC-hygiene |
| 0165-176 · S01-02 | S4 | CONF | TRACE | INDEX ordering rule | INDEX row order: 0148 listed before 0147 — auto-core/plans/INDEX.md:175-176 | W0-governance |
| 0165-177 · S01-08 | S4 | CONF | CPLX | P5 | loop-plan.ts is 1184 lines against its own header's promise to stay under 600 — auto-core/src/loop-plan.ts:6 | WC-hygiene |
| 0165-178 · S02-05 | S4 | CONF | TRACE | releases.md l.128 | the v0.3.0 git tag was never created — auto-core/docs/releases.md:128 | W0-governance |
| 0165-179 · S02-07 | S4 | CONF | DOC | P13 | glossary lags the vocabulary: a dozen terms in code and docs have no glossary entry — auto-core/docs/glossary.md | WA-docs |
| 0165-180 · S02-08 | S4 | CONF | TRACE | principles.md registers | the registers are stale against 0124–0164 (R2, R4, R7 'last showed'; T8 and two candidate new trade-off rows) — auto-core/docs/principles.md:464-488 | WA-docs |
| 0165-181 · S02-09 | S4 | CONF | TRACE | principles.md l.439 | wording vs practice: principles.md asks a derivation per decision block; the corpus states one consolidated Derives paragraph per document — auto-core/docs/principles.md:439 | WA-docs |
| 0165-182 · S03-03 | S4 | CONF | TRACE | releases.md l.31 | constitution silences surfaced by the replay: lock scope, 'shared git state', task-id uniqueness, 'safe boundary', Tier precedence — auto-core/docs/principles.md:157 | WA-docs |
| 0165-183 · S03-04 | S4 | CONF | TEST | releases.md l.31 | the replay protocol leaks: any agent session started inside the package auto-loads AGENTS.md, which names the rulings — a replay run there is never… — auto-core/docs/releases.md:31 | WA-docs |
| 0165-184 · S04-10 | S4 | CONF | DOC | P13 | S04 scope hygiene: stale comments and fragile ordering — auto-core/src/loop.ts:43-46 | WC-hygiene |
| 0165-185 · S05-10 | S4 | CONF | DOC | P8 | Hygiene across loop-task.ts: comments that state behavior the code does not have (step pause 'stops scheduling and drains'; the park arm's 'hooks r… — auto-core/src/loop-task.ts:781-782 | W9-lanes |
| 0165-186 · S06-09 | S4 | CONF | DEF | 0061 (installServices/uninstallServic… | Run-control hygiene (aggregate): formatDurationCompact rounds into '60.0s' and '1m60s'; the services install stack is one slot deep while its heade… — auto-core/src/log.ts:164-171 | WC-hygiene |
| 0165-187 · S07-05 | S4 | CONF | UX | P8 | The person-boundary commands' failed-commit and crash lines teach a re-run their own refusals stop: adopt's 'commit manually and re-adopt' meets 'T… — auto-core/src/work-order.ts:220-227 | W8-planning |
| 0165-188 · S07-09 | S4 | CONF | DUP | P5 | Hygiene — the person-boundary stop lines: transfer's proposal continuation re-composes `✓ round … established` and `✓ branch isolation …` inline be… — auto-core/src/transfer.ts:312-314 | W8-planning |
| 0165-189 · S08-11 | S4 | CONF | DOC | P8 | S08 scope hygiene: stale numbering-record comments, stale classifier-route comments, the formulation todo's nested section headings, coverage rows… — auto-core/src/loop-plan.ts:215-216 | WC-hygiene |
| 0165-190 · S08-12 | S4 | CONF | CPLX | P5 | loop-plan.ts (1184 lines against its own '600' promise) has three clean seams: the append half (snapshot/collect/reset + appendPlan/appendWithStep/… — auto-core/src/loop-plan.ts:6 | WC-hygiene |
| 0165-191 · S09-06 | S4 | CONF | DOC | P13 | S09 scope hygiene: stale comments and teaching, unused imports, a duplicated composition, a dead free-content scan — auto-core/src/analysis.ts:59 | W-round-docs |
| 0165-192 · S10-09 | S4 | CONF | TEST | 0156 D5 | S10 scope hygiene: a 0156 D5 surface missed in runner.ts; stale and orphan comments; the in-flight test-handover record written in place; the recov… — auto-core/src/runner.ts:341 | WC-hygiene |
| 0165-193 · S11-11 | S4 | CONF | DOC | AGENTS.md Overview (comments in English) | S11 scope hygiene: resolve.ts commented in Chinese (119 lines); stale subject shape in TestRun.subject; nextFixSession scans the unbounded history… — auto-core/src/resolve.ts:1-490 | WC-hygiene |
| 0165-194 · S12-11 | S4 | CONF | CPLX | P21 | S12 scope hygiene: resumeModelNow exported and unit-tested with no production caller (resume-gate.ts:219 records it as dropped); parseProgress pass… — auto-core/src/unit-commit.ts:123-126 | WC-hygiene |
| 0165-195 · S13-03 | S4 | CONF | TEST | P5 | The chain-write ratchet is regex-based and misses ten write shapes (\|\|=, aliasing, Object.assign, bracket access, an optional `chain?: SessionCha… — auto-core/test/chain-writes.test.ts:182-186 | W-tests |
| 0165-196 · S13-07 | S4 | CONF | DOC | P12 | Session-driving comment/code hygiene: ensureForkBase's header claims the ctxbase turn 'is verified to leave no worktree changes' (no check exists —… — auto-core/src/session.ts:53-56 | W-session |
| 0165-197 · S14-07 | S4 | CONF | DOC | 0061 §4.3/§4.4 (the I/O seam, the audit) | Engine hygiene: the contract's 'All I/O goes through the TurnFx' (contract.ts:8) is false four ways — askClassifier's model call, questions' emitSt… — auto-core/src/engine/contract.ts:8 | WA-docs |
| 0165-198 · S15-05 | S4 | CONF | DOC | P18 (machine-addressable history — a … | Accounting-store hygiene: 32 comments in 17 src files cite plans/STATS_PLAN.md (and context.md) by line and section — a file that never existed in… — auto-core/src/stats.ts:1 | WC-hygiene |
| 0165-199 · S16-07 | S4 | CONF | VOCAB | 0163 P13 clause ('the skip-flag vocab… | Routing-family hygiene: the router still speaks the retired skip-flag vocabulary 0163 said it retired in lockstep (l.328 'flags and `until` marks a… — auto-core/src/router.ts:326-329 | W2-keyring |
| 0165-200 · S17-09 | S4 | CONF | DOC | P13 | Switch census (S01-04 resolved): of the six 'undocumented' names two are tombstones (HANDOVER_CONCURRENT, TASK_CONTEXT — self-documenting notices),… — auto-core/src/switches.ts:17-112 | WA-docs |
| 0165-201 · S18-05 | S4 | CONF | VOCAB | P13 | the restated SERVER_ENV literal has no drift ratchet against the switch registry — auto-core/src/agent/opencode/server.ts:38 | W0-governance |
| 0165-202 · S18-06 | S4 | CONF | UX | P8 | defaultConnect's health check has no explicit timeout — auto-core/src/agent/opencode/server.ts:230 | WD-routing |
| 0165-203 · S18-07 | S4 | CONF | DEF | P7 | claude send silently ignores a requested model change while the live process is busy — auto-core/src/agent/claude/client.ts:318 | WD-routing |
| 0165-204 · S19-10 | S4 | CONF | FAIL | P12 | git-core failure-direction and test hygiene: nestedHeads writes `Auto-Nested: <rel> @ ` (empty sha) for an empty nested repository; nextFixSession… — auto-core/src/git.ts:244 | W6-git |
| 0165-205 · S20-14 | S4 | CONF | DUP | P5 | Hygiene across the family: the door scan written twice, chmod failures swallowed, a duplicated containment helper, double parses — auto-core/src/external-dirs.ts:57-87 | WC-hygiene |
| 0165-206 · S21-06 | S4 | CONF | UX | P8 | Task-store hygiene: a park-problem remedy that names the wrong file, a header claim about load-time subtask checks, CR-carrying bodies, and Artifac… — auto-core/src/tasks.ts:509-513 | WC-hygiene |
| 0165-207 · S22-06 | S4 | CONF | DOC | P8 | reset is not the inverse of init for a materialized bundle — the pack/mode/phase files and provenance.json survive reset while the header claims "r… — auto-core/src/reset.ts:1-4 | WA-docs |
| 0165-208 · S22-07 | S4 | CONF | DEF | P7 | person-file rewrites reach beyond the driver's own lines: removePointer's whitespace collapse is unconditional, the .gitignore rewrite collapses th… — auto-core/src/agents-block.ts:321 | WC-hygiene |
| 0165-209 · S24-06 | S4 | CONF | GEN | P16 | The shipped permission template retains an unexplained host-specific /home/* bash grant — auto-core/templates/opencode.json:16-20 | WC-hygiene |
| 0165-210 · S25-10 | S4 | CONF | DEF | P5 | every red lane receipt emits the Log field twice — auto-core/src/script.ts:509 | WC-hygiene |
| 0165-211 · S26-01 | S4 | CONF | UX | P8 | the `--` end-of-options token floods the refusal with the entire flag vocabulary — auto/src/index.ts:1002 | W3-shell-seam |
| 0165-212 · S26-02 | S4 | CONF | DEF | P12 | boolean flags' --flag=value form is unvalidated: any non-false value means true — auto/src/index.ts:217-224 | W3-shell-seam |
| 0165-213 · S26-05 | S4 | CONF | DOC | P13 | enumeration drift in the CLI's own prose: 'the public sixteen' (18 rows), AGENTS.md's command list (15, no fork/remove-fork/driver-helper), the -f… — auto/src/index.ts:721-722 | WA-docs |
| 0165-214 · S27-02 | S4 | CONF | UX | P8 | run on a never-initialized directory prints a defaults config banner, then refuses on the missing agent contract naming fix — which itself refuses… — auto/src/index.ts:1310-1313 | WC-hygiene |
| 0165-215 · S28-01 | S4 | CONF | DOC | 0081 D11 | README's reset table teaches a retired rule: brief.md 'deleted only when byte-identical to the project brief stub' — reset keeps it unconditionally… — auto/README.md:508 | WA-docs |
| 0165-216 · S28-02 | S4 | CONF | DOC | P13 | README's retirement row says the continue notice points at plan; the notice names transfer — auto/README.md:289 | WA-docs |
| 0165-217 · S28-03 | S4 | CONF | DOC | P13 | MANUAL's cheat sheet omits fork, remove-fork and driver-helper (15 of 18 public commands) — auto/MANUAL.md:226-245 | WA-docs |
| 0165-218 · S28-04 | S4 | CONF | DOC | P13 | README's key-ring paragraph asserts 'The walk never oscillates' — refuted by S17-03's reproduction (short stated resets make the fork's walk undo t… — auto/README.md:1308-1309 | WC-hygiene |
| 0165-219 · S29-11 | S4 | CONF | UX | P8 | Hygiene across the service shell's entry files: stale P1-era refusal texts and comments, a token-name fallback that collides after a revoke, run-id… — auto-server/src/request.ts:149-153 | W3-shell-seam |
| 0165-220 · S30-05 | S4 | CONF | TEST | P19 | The observe e2e's sawDirty expectation races the fixture's dirty window: the immediate-answer fake can write-and-commit between two 150 ms polls, s… — auto-server/test/observe.test.ts:520-542 | WB-test |
| 0165-221 · S31-01 | S4 | CONF | DOC | P13 | Three comments older than the shipped surface: ops.ts's status vocabulary says 'the models probe is not exposed' (its own header's P4b sentence and… — auto-server/src/ops.ts:49-50 | WA-docs |
| 0165-222 · S31-02 | S4 | CONF | DOC | P13 | daemon.md's honestly-absent list omits release and install-prompts — two CLI-side surfaces not stated in the section whose own standard is 'stated… — auto-server/docs/daemon.md:804-812 | WA-docs |
| 0165-223 · S31-03 | S4 | CONF | TEST | P19 | worker.test.ts's usage-vocabulary case spawns ~15 workers in one test — deterministically 6.9 s against bun's 5 s default (the S00 breach); the fix… — auto-server/test/worker.test.ts:116-177 | WB-test |
| 0165-224 · S32-06 | S4 | CONF | CPLX | P21 | Complexity standing debts: loop-plan.ts 1184 lines against its own 'under 600' header (the compose split, S08-12), planPrelude's 16 hand-ordered ro… — auto-core/src/loop-plan.ts | WC-hygiene |

### §6 Cross-cutting design (S32)

Layering: the core/shell contract holds in the large; the package boundary exports everything (`./*`), discipline beyond the hand-mapped import-direction ratchet is conventional, and the ratchet is layer-blind at the services seam (git-ops → charter-clamp, both "driver"). Duplication: the shell mirror (runOptions ×2, init/amend ×2, banner/phase-line/hint tables ×2, fake-claude ×2) drifts by lockstep misses — one core-provided seam removes the family. The **state-homes table** (S32) inventories every durable home with owner, writers, atomicity, re-derivation and external readers; its two systematic weaknesses: session-writable verdict surfaces trusted by location (`0165-006`), and two-homes state synced by convention (the key position/spawn config). Concurrency: the lane landing is mature; restart-under-siblings, the lock's pid-space identity and the attach-only sideband are the standing hazards. Security: strong where designed (reference-only keys, spawn-config substitution, scoped tokens, timing-safe compares, memory-only web tokens, textContent-only DOM); leaky at the edges (family statement vs code S17-06, URL/name-position leaks, the bridge secret in argv). Complexity: the size-promise debts (loop-plan, planPrelude, session.ts) and one P21 item (the probe-form /exit). Tests: the strong oracles (0159 enum guard, chain-writes ratchet, turn-trace replay, manual-prompts ratchet) vs the weak-oracle family (S32-05: tests pinning defects as behavior). Constitution: the P-set survived a hostile replay; the practice around it drifted (§3).

### §7 Verified clean (the confirmed problem-free list)

The exit-code vocabulary across all three packages; the parser's value validation and the 0159 enumeration guard; RunAllOpts threading (only `managed` deliberately unset); the destructive-gate family with `-f` semantics; init's validate-then-write and idempotent re-run; the run-lock matrix; the turn engine's spine (declarative arbitration, per-slice ownership, the replay proof); the chain consolidation; the lane landing's serialized steps; the question journal's durability model; observe's defensive-read tolerance (documented and implemented); the web client's XSS/CSRF/token posture; both adapters' 13-call contract; the claude stream grammar pins; the e2e suite's hermeticity; the CRLF floor; the provenance three-state comparator; the install-prompts/0164 manifest design; the release command's refusal vocabulary. (Per-invariant locations in each step's `## Verified clean`.)

### §8 Refuted and by-design

Nothing refuted (every lead run either confirmed or superseded by a stronger code-level finding). By-design, recorded as challenges not defects: install-prompts' ungated overwrite (0093 D2 "overwrite is the point"; the P20 challenge stands if manual suites grow local edits); fix's manual-findings exit 1 beside the "2 = blocked for human" family; the sync question journal's in-memory-first design (P3c-ruled); the v1 loopback/no-Origin posture of the daemon (documented, bearer-only auth makes CSRF inapplicable); the trace goldens freezing pre-engine behavior (a deliberate stage-D equivalence proof now due a re-blessing — S14).

### §9 Matters for the maintainer's ruling

1. **P4 vs 0145** (F18): fix the constitution's text or restate the ruling — the falsification replay is right that they contradict.
2. **The registry `bin` path** (S17's seam): the project layer can name a driver-spawned executable — the one path from agent-written bytes to executed code; consistent with the same-user posture, but 0162's confinement makes it worth an explicit ruling.
3. **The exports question** (S32-03): entry modules vs the fully-open `./*` boundary — one conscious ruling either way.
4. **The turn-trace goldens**: re-bless a golden as the reference now that the engine is (S14's remedy prerequisite).
5. **0163's three measurement claims**: correct them through INDEX annotations when W2 lands (the claims are false in reachable states).
6. **The deprecation lifecycle** (F11): write the practiced instant-tombstone rule or return to the written one.
7. **The release cut itself** (F13/F14): due; W1 and W6 should land first.

### §10 The fix-wave program

W0 governance first (F9–F22's acts: Category scope resumption, INDEX grammar repair, the premise-drift template line, the P4 reconciliation, the tag), then one wave per seam, S1/S2 first. Buckets below consolidate the register's disposition column; each wave is its own ruling with Derives/Amends, tier, Category scope (0110 D5, 0123) and its test homes in the same change.

- **W1 person-marks/verdict provenance** (3 rows + `0165-006` ∪15) — the S1s: mark-gated installs, section-scoped marks, authorship witnesses on verdict files, the commit-boundary guard, the handover lifecycle.
- **W2 keyring/restart** (`0165-006`-family ∪5 under S32-04) — `rekey()` as a safe-boundary act, the walk bound, the rotation-seeded fork skip, the double-spawn fix.
- **W3 shell-seam parity** (∪7 under S32-02 + the shell rows) — one core init/amend sequence, one option/banner/hint emitter family, the fake fixture shared; the CLI parser polish rides here.
- **W4 wall/permissions** — the opencode-matcher oracle first, then the wall's matcher blind spots and the 0147-pair recovery.
- **W5 control/recovery** — the sideband detach, the /exit-wakeable sleeps, the recovery ladder's driver-fault class, the lock's process identity.
- **W6 git boundary** — the release-scan baseline ruling (`0165-004`), the failure-direction stragglers, the trailer witness, the subdirectory-target scenario.
- **W7 verification** — the progress bound, the process-group kill, the spawn helper, the marker/receipt provenance (with W1).
- **W8 planning/formulation** — the review-seam completion, the compose split, the collect's surfaces (with W1), the round-brief grammar amendment.
- **W9 lanes/accounting** — the doc-loop recovery reads, the orphan probes, the stats identity rulings.
- **WD routing**, **WE policy-as-data**, **WF server** (spawn payload off argv, the registry retire helper, the observe verdict, the served-line vocabulary), **WA docs**, **WB/WC tests and hygiene** (the two deterministic flakes, the census tests, the doc tables).

Order: W0 → W1 → W6 → W2 → W5 → W4 → W3 → W7 → W8 → the rest. Residuals: each wave names its own (the pattern 0155–0160 set).

### Appendix

- Schema of the finding record and the output-file sections: [`0165-review/CONTRACT.md`](./0165-review/CONTRACT.md).
- Censuses and probes: [`tools/probe.ts`](./0165-review/tools/probe.ts), [`tools/family-check.ts`](./0165-review/tools/family-check.ts); the leads index [`leads/README.md`](./0165-review/leads/README.md) (every lead dispositioned).
- Coverage: each `Sxx-*.md`'s `## Coverage` section; the per-step verified-clean lists are §7's sources.
- The verification tables: [`S33-verify-a.md`](./0165-review/S33-verify-a.md), [`S34-verify-b.md`](./0165-review/S34-verify-b.md).
