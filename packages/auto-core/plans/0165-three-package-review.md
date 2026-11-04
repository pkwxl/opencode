# 0165 — The three-package review (auto-core, auto, auto-server): a resumable program

Status: **in progress** — 24 of 36 steps done (S00–S22, S29). Opened 2026-11-02 at HEAD 358be4003 (branch `auto-core`,
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
| 25 | S23 policy-as-data, code side | 2.8K | todo | | |
| 26 | S24 templates — prompt copy, default pack | md | todo | | |
| 27 | S25 bundles and the manual-driver suite | md | todo | | |
| 28 | S26 CLI shell A — parser, help, option policy | ~1.2K | todo | | |
| 29 | S27 CLI shell B — command blocks | ~2.1K | todo | | |
| 30 | S28 CLI docs and the e2e strategy | docs (grep) | todo | | |
| 31 | S30 service shell B — operations, observation | 3.0K | todo | | |
| 32 | S31 service shell C — web, docs, test health | 2.4K + docs | todo | | |
| 33 | S32 cross-cutting design synthesis | step outputs | todo | | |
| 34 | S33 verification A (S04–S18) | findings | todo | | |
| 35 | S34 verification B (S19–S32 + S02/S03) | findings | todo | | |
| 36 | S35 report assembly + INDEX row | all outputs | todo | | |

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

## Report (written at S35)

The sections below are filled by S35 from the step outputs; until then they are placeholders.

- §0 Executive summary — counts by severity × package, top risks, release readiness, what is healthy.
- §1 Method and provenance — this program, the first attempt, the baseline move, coverage matrix pointer.
- §2 Baseline — suites, typecheck, flakes, censuses (S00, S01).
- §3 Release audit (the next cut's draft, shaped like releases.md) — rule→principle, principle→code, family
  consistency, cross-ruling interactions, vocabulary registries, register currency, deprecation and breaking-change
  candidates, falsification replay, findings F9… (S02, S03, S32–S34).
- §4 Prior residuals of 0155–0160 → state at HEAD.
- §5 Findings by layer — `id | sev | conf | cat | measures | essence (file:line) | disposition`; prose for S1/S2.
- §6 Cross-cutting design — incl. the state-homes table (S32).
- §7 Verified clean — the confirmed problem-free list.
- §8 Refuted and by-design.
- §9 Matters for the maintainer's ruling.
- §10 The fix-wave program — W0 governance acts first, then one wave per layer, S1/S2 first; each wave: its
  findings, the family home-set (its Category scope seed), proposed Derives, code and test homes, order, residuals.
- Appendix — schema, censuses, the coverage matrix, probe and lead index.
