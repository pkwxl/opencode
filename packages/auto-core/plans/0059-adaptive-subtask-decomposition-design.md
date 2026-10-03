# 0059 — Adaptive decomposition: `--subtask auto` becomes cost-aware, the planned pipeline moves to `true`

Status: **design, ruled; S1–S7 implemented** (2026-09-27, recorded in §12); §8 ruled 2026-09-27 (every recommendation accepted). Request: `--subtask auto` was meant to cut one large task into subtasks so each session's context stays small and cache overhead drops. On the field it did the opposite: T-008, decomposed into 11 subtasks on the claude adapter, used a whole five-hour quota window. The operator estimates that a single session would have needed about 30% of one. Every later task ran `off`. For `auto` to mean anything it must cost less than a single session. The current pipeline is kept under the new value `true`, for a complex task made of several unrelated subtasks. `auto` becomes intelligent, cost-aware decomposition.

## 0. The answer in one paragraph

The session transcripts confirm the operator's estimate: T-008 cost 2–3× a comparable single session, and about 3.5× once stray sessions are counted. Almost none of that comes from context size. With prompt caching, the token class that decomposition saves (cache reads) is the cheapest, about 1/33 of a cache write. The classes it multiplies are the expensive ones:

- **Cache writes.** Every new session rebuilds context by re-reading.
- **Output.** A plan is written three times, and every subtask writes its own record.

On top of that come fixed per-unit costs: prompt boilerplate, full-suite verification, and shape-check re-prompts. A leaked environment variable also turned each test run into a real claude session.

So "keep contexts small" is the wrong goal for a cached agent. The right goal is **never re-establish context and never duplicate artifacts**. The new `auto` follows from that:

- **Lead first.** It starts one lead session (a whole-task session under the 0056 usage protocol) that reads what it needs and works.
- **Split only when it pays.** The lead may fan the rest out only when the numbers say it pays: the streams are separable and its context is already large. The fan-out sessions are **forks of the lead**, so the understanding stays in the cached prefix and nothing is re-read.
- **Otherwise one session.** In every other case `auto` is one session with a self-directed handover.

On most tasks `auto` costs what `off` costs. On large, separable tasks it should cost 10–20% less, an estimate (§2, §7). It is never the 2–3× of today's pipeline.

## 1. Field evidence: T-008 (2026-09-24 01:14–02:12, `/workspace/aseo`)

Method: the driver log `.auto/logs/run-2026-09-24_01-14-43.log` and the claude transcripts `~/.claude/projects/-workspace-aseo/<session>.jsonl` of its 20 sessions. Usage is deduplicated by `requestId`, because a fork copies its parent's messages. The deduplicated totals equal the driver's figures exactly.

Configuration:

- Agent: claude (`claude-opus-5-5`), with `subtask auto`, `contextLimit 64k` and wrap-up on.
- Switches at their defaults: fork on, fork base `digest`, `DECOMPOSE_FINE` on. `STEER` was off, before 0056.
- Deliverable: +539 −29 lines in 18 files of the nested repository.

### 1.1 Where the cost went (claude's own per-session cost, total $12.28)

| sessions | cost | share |
|---|---|---|
| decompose (understanding + plan), 1 | $3.21 | 26.2% |
| digest fork base, 1 | $0.12 | 1.0% |
| subtask sessions S01–S10, 10 | $4.78 | 38.9% |
| S11 close-out subtask, 1 | $1.49 | 12.1% |
| shape-check re-prompt forks, 6 | $1.77 | 14.4% |
| wrap-up, 1 | $0.91 | 7.4% |
| **stray e2e sessions (W1), 29, not in the driver's total** | **≈ $6.3** | — |

Token classes, T-008 total:

| class | tokens | share of cost |
|---|---|---|
| output (incl. 54k reasoning) | 179k | ≈ 30% |
| cache write (all 1h TTL) | 678k | ≈ 40% |
| cache read | 16.4M | ≈ 30% |

The per-class shares use weights fitted to 61 recorded Opus 5.5 session costs (max error 10%): output ≈ $19.7/M, cache write ≈ $7.2/M, cache read ≈ $0.22/M. A cache write weighs about **33×** a cache read, and output about 90×.

### 1.2 Against single sessions of the same round (claude, `subtask off`, wrap-up off)

| task | sessions | change | cost | cost with cache reads free |
|---|---|---|---|---|
| **T-008** | 20 | +539 −29, 18 files | **$12.28** (+≈$6.3 stray) | **$8.41** |
| T-023 | 1 | +254 −12, 12 files | $2.29 | $1.47 |
| T-021 | 1 | +618 −1, 4 files | $2.68 | $2.03 |
| T-022 | 1 | +1815 −1, 8 files | $4.53 | $3.08 |
| T-024 | 2 (limit restart) | +467 −33, 19 files | $6.25 | $3.71 |
| T-025 | 1 | +1500 −19, 9 files | $6.74 | $3.92 |
| T-026 | 2 (limit restart) | +1034 −50, 15 files | $6.88 | $4.29 |
| T-032 | 1 | +1636 −45, 23 files | $10.57 | $5.91 |

A single session for T-008 would plausibly have cost $4–6. T-008 as decomposed cost more than T-032, which changed three times as much code. Without wrap-up it would still have been $11.37.

### 1.3 The quota windows

Limits were hit on three windows, and T-008 has its own window for comparison:

| window | limit hit | output | cache read | cache write | API-equivalent |
|---|---|---|---|---|---|
| 09-23 00:50–03:58 | yes | 393k | 49.8M | 1.44M | $29.0 |
| 09-25 07:30–11:44 | yes | 372k | 28.6M | 0.92M | $20.2 |
| 09-25 12:30–14:39 | yes | 205k | 24.9M | 0.59M | $13.7 |
| 09-24 01:14–02:13 (T-008) | — | 269k | 19.9M | 1.20M | $18.3 |

No single weighting makes the three limit-hit windows agree. API weights, cache reads free and cache reads at full input price all leave a spread of ±38–44%. So the subscription limit is not a stable token-weighted sum visible from this machine: the account is shared with other clients, and limits may move. How much a cache read counts on the plan therefore cannot be settled from these logs.

It does not need to be. T-008's window is at least the smallest limit-hit window under every weighting tested: $18.3 against $13.7 at API weights, $13.98 against $8.28 with cache reads free. If the plan counts cache reads for less than the API does, decomposition looks worse, not better: the only class it saves gets cheaper, and the classes it multiplies do not (§2).

### 1.4 The duplicated work, itemized

- **W1 — stray real agents (≈ $6.3, 29 sessions).**
  - Every agent process inherits the driver's environment, including `OPENCODE_AUTO_AGENT=claude`. When a subtask ran `bun test` in `packages/auto`, the e2e CLI test started a real claude "[auto] AUTO permission preflight" session in `/tmp/auto-cli-*`. In 11 of the 29 sessions the temp dir was deleted under it when the test hit its 5 s timeout.
  - This coincides with the "known failing `CLI: fix` test" the sessions kept recording as pre-existing.
  - The shell suite ran about 22 times, because every subtask's `Verify:` said "both packages".
  - T-015 (09-24 05:49) gave `runCli` a scrubbed environment. That closes the leak for this repository's e2e test only: the driver still passes its switches to every agent process (X1).
- **W2 — the understanding is paid for, then thrown away.**
  - The decompose session made 40 reads (125k characters of source) and reached 143k context ($3.21).
  - The digest fork base kept only the 10.6k-character `context.md`. Each subtask forked from a 23.2k-token prefix: the harness plus that digest.
- **W3 — every subtask re-reads.**
  - S01–S10 re-read 13–36k characters of source each, about 230k in total.
  - Reads of `shared.md` and `todo.md` recur in 12 sessions, about 87k characters in all.
  - The subtask prompt told them they had "inherited the task-background context (the understanding stage's digest and loaded content), so do not re-read files". Under the digest base that is not true.
- **W4 — prompt duplication.**
  - Each subtask prompt is 22.1k characters (≈ 9.3k tokens written per session), about half of it the full text of all 11 items.
  - That repeated across 17 sessions (the 11 subtasks and the 6 re-prompts).
- **W5 — process-document output.**
  - The process documents total 94.7k characters: `context.md` 10.4k, `shared.md` 4.8k, `subtasks.md` 9.0k, eleven `todo.md`/`done.md` 25.5k, eleven `S<nn>/index.md` records 39.4k, `report.md` 5.6k.
  - That is more text than the deliverable itself. The decompose session's output alone was 52.7k tokens.
  - The plan is stated three times: in `subtasks.md` items, in `todo.md` scopes, and in the digest.
- **W6 — per-item full verification.**
  - Across the 18 working sessions: 58 typecheck runs, about 9 full core-suite runs and about 22 full shell-suite runs.
  - They cost few tokens (outputs were tailed), but they were slow and they multiplied W1.
- **W7 — shape-check re-prompts (6 of 11 items, $1.77), all false positives.**
  - The P1 scan flagged `docs/T-…` and `docs/R-…` strings in the driver's own test fixtures, which are data, not references.
  - The eof scan demanded the terminator on a prompt template (`templates/prompts/phase-handover.md`). To satisfy it, the S09 re-prompt changed `src/template.ts` to strip a trailing terminator, so deliverable code changed to please a checker (still in the tree).
  - Single sessions do not run the per-unit scan, so the per-unit check multiplies the exposure by the item count.
- **W8 — ceremony units.**
  - The S11 close-out subtask re-ran everything and wrote notes ($1.49).
  - The wrap-up re-read 75.8k characters to write the report ($0.91). It is needed because no session saw the whole task.
- **W9 — an over-fine, coupled split.**
  - 11 items averaging about 50 changed lines each. 9 of 11 depend on another item; the longest chain is S01→S02→S07→S08→S11.
  - 8 files are touched by two or more items: `tasks.ts`, `phases.ts`, `loop-plan.ts`, `prompt.ts` (three items), and four test files. This is the opposite of the conditions under which a split pays (§2).
  - The split followed the fine-mode criterion "one item per natural unit… prefer finer over coarser — the fork pipeline has removed the fixed cost of re-understanding between subtasks". That premise holds only for a `session` fork base, not for the `digest` default (W2, W3).
  - Its granularity budget, "on the order of `contextLimit/2` = 32k tokens" per item, is below a claude subtask session's own starting context (32.5k).

## 2. Why decomposition cannot win on context size alone

A session turn with context C re-sends C and pays `w_r·C` to read the cached prefix, plus `w_w·ΔC` to write the new tail and `w_o·o` for output. The fitted weights are `w_r : w_w : w_o ≈ 0.22 : 7.2 : 19.7` ($/M).

- **One session** growing from B to F over T turns reads about `T·(B+F)/2` and writes about F.
- **A split** at context C, continued by a session that must re-establish R tokens and runs T′ more turns:
  - saves about `w_r·(C−R)·T′` in reads;
  - costs `w_w·R` plus a fixed overhead O (prompt, first turn, close-out) plus whatever ceremony the split adds.
  - Break-even: `T′ ≈ (w_w·R + O) / (w_r·(C−R))`. With R = 40k and O ≈ $0.10:

| context at the split | turns needed after it to break even |
|---|---|
| 250k | ≈ 8 |
| 128k | ≈ 20 |
| 64k (T-008's items) | never practical |

- **Fork from the understanding point.** The understanding is not re-established but cache-read: R ≈ 0 for that part. A fan-out item only avoids carrying its siblings' growth. With 3 items of 30 turns each growing 40k, that saves about `w_r·(30·40k + 30·80k)` ≈ $0.8. On a $10 task that is under 10%, but it is positive and bounded by construction.
- **If the plan weighs cache reads lower than the API** (the operator's point about the Pro plan), `w_r` shrinks and every break-even moves further out.

The consequences for design:

1. The default must be one session: decomposition is justified by size and separability, not by habit.
2. A split must come from the session that holds the understanding, at the point it holds it, and continue as forks, not as cold sessions reading a digest.
3. A split must add no ceremony: no second statement of the plan, no per-item records, no per-item full verification, no close-out unit.
4. A split must never be finer than a few substantial streams.
5. The handover wall must sit where a handover pays for almost any remaining work: well above 128k on a 1M-window model.

## 3. Decisions

- **D1 — `true` is today's `auto` pipeline, verbatim.**
  - `SubtaskMode` becomes `"off" | "auto" | "true" | "ondemand"`. Every branch that tests for `"auto"` today tests for `"true"`: runner dispatch, the resume gate's `decompose`/`whole` ownership, preflight dispatch needs, and prompt selection.
  - The pipeline itself (decompose, fork base, subtask sessions, wrap-up) and its switches (`OPENCODE_AUTO_FORK`, `_FORK_BASE`, `_DECOMPOSE_FINE`) are untouched and govern `true` only.
  - The config accepts `"true"` and the JSON boolean `true` as the same value. The shell's `--subtask` takes `off|auto|true|ondemand`, and bare `--subtask` stays `auto`. That change is on the shell branch.
- **D2 — `auto` is adaptive: one lead session first.**
  - The lead is a whole-task session: `whole.md` with the 0056 usage protocol (notices at 50%/85% of the wall, a self-directed handover), plus a new `{{#if adaptive}}` split clause.
  - There is no decompose session, no digest base, no `context.md`/`shared.md`. The lead reads what it needs and works.
  - It ends one of three ways:
    - it finishes the task;
    - it hands over by time (0056: `handoff.md`, then a continuation session, which is again a lead);
    - it declares a split (D3).
- **D3 — the split clause (criteria from §2, stated with the figures).** The lead may split only when all of these hold:
  - (a) The remaining work is 2–5 streams that each change their own files. A file two streams would both change is either finished by the lead first or its streams are ordered with `Depends:`.
  - (b) Each stream is substantial: tens of tool turns, not a function or a test case.
  - (c) The driver's first usage notice (50% of the wall) has arrived. Below it, finishing in this session is cheaper.

  The lead does the shared foundation itself before splitting: the types, helpers or fixtures every stream needs. In T-008 terms, that is S01–S03. To split, it writes `docs/T-NNN/subtasks.md`, one checklist line per stream (`- [ ] <title>: <what, where, how to verify> Depends: S01 Artifacts: <paths>`), and ends. The driver, not the session, writes each `S<nn>/todo.md` from its line (the field block from `Depends:`/`Artifacts:`, `## Scope`, `## Artifacts`). The plan is stated once.
- **D4 — the driver's split guard (mechanical).**
  - A split is honored when all of these hold:
    - 2 ≤ items ≤ 5;
    - every line parses and the dependency graph is valid (existing `checklistProblems`);
    - no path is declared by two items unless one (transitively) depends on the other;
    - the lead's final measured context is at least 50% of the wall. This enforces (c) where a live figure exists; usage tiers without one skip this check.
  - Otherwise the driver removes `subtasks.md` and re-prompts a fork of the lead: "[DRIVER] the split was not taken: <reason>; finish the task in this session". That continuation carries no split clause, so there is one rejection at most, and a `subtasks.md` that appears anyway is ignored and removed.
  - Work the lead did before splitting is committed as the task's execution unit (`T-NNN exec`) before the fan-out starts.
- **D5 — fan-out items are forks of the lead.**
  - The lead's session id becomes the task's fork base: the existing `session`-mode record (`setForkBase`), per agent under a registry (0055 §8.2).
  - Items run in `nextReady` order over their `Depends:` fields. Each is seeded by `seedForkSession` from the lead and prompted with a short delta, a new template `fanout.md`. The rules and the task are already in the forked prefix. The delta contains:
    - the item line in full, with the siblings by title only;
    - "this session is a fork of yours: do not re-read what you read; re-read only the files changed since the split: <`git diff --name-only <split>..HEAD`>". The list is present only when prerequisites ran.
    - verification: targeted checks for this item; the last item runs the task's full acceptance verification once.
    - no `S<nn>/index.md` for code-only items.
  - The unit state protocol, commit boundary and shape check are `runSubtask`'s, unchanged.
  - Items start from a large prefix, so they run under the ondemand usage protocol. A handed-over item continues in a fresh session from its `handoff.md`, scoped to the item. This re-enables handover for this subtask kind only; `true` subtasks keep 0056 D1.
  - Sibling forks share a split point and have disjoint artifacts, so they are parallel-ready. Running them in parallel is 0046's business, not this design's.
- **D6 — the wall on large windows: `min(max(2×cap, window/4), 0.8×window)`.**
  - This is `steerWall` for `auto` and `ondemand`. It is unchanged for windows up to 512k at the default cap: 128k → 102k, 200k → 128k, 512k → 128k. On a 1M window it rises from 128k to 250k.
  - The T-008 decompose session reached 143k on understanding alone, so a 128k wall would force a handover right after the understanding is paid for: the worst boundary, where everything read is lost. At 250k a handover pays after about 8 turns (§2).
- **D7 — degradation.** An agent without session fork, or without mid-turn steer (`AgentCapabilities`), runs `auto` without the split clause (`auto` ≡ `ondemand`), with the existing run-start degrade note.
- **D8 — the default and stored values.** The config default stays `"auto"` and now means adaptive. A stored `"subtask": "auto"` takes the new meaning with no migration. The pipeline stays one `amend --subtask true` away. (Ruled, §8 item 1.)
- **D9 — `OPENCODE_AUTO_DECOMPOSE_FINE` defaults to off.** Its premise is refuted for the `digest` default (W9). The switch stays for `true`. (Ruled, §8 item 3.)

## 4. Fixes independent of the mode

- **X1 — the driver's switches never reach agent processes.**
  - `claudeEnv` (the claude spawn) and the `opencode serve` spawn environment drop `OPENCODE_AUTO_*`. The switches are read once at run start; a session and the tools it launches have no use for them. A profile's `env` overlay can still set one explicitly.
  - This closes W1 for every target, not just this repository's e2e test.
- **X2 — process-shaped strings in a deliverable that legitimately contains them.**
  - This repository's test fixtures and prompt templates trip the P1 scan and the eof scan (W7).
  - Ruled (§8 item 4): a project-owned exemption list (globs) consulted by `p1Scope` and `eofScanExempt`, carried as a key of `.opencode/auto/config.json`. It is shared with the repository and changed with `amend`, like every config key, so `init`/`amend`/`fix` and their validation learn it. The key name is settled at implementation.
  - Separately, review whether the S09 terminator-stripping in `src/template.ts` should stay.
- **X3 — harness overhead per fresh claude session** (lower priority; measure first).
  - A fresh `claude -p` session loads the operator's skill listing, claude.ai connectors and their instructions: about 12k tokens written beyond the shared 10.8k system prefix. The digest base's reply even commented on the Google Drive connector.
  - Candidate: start driver sessions with `--strict-mcp-config` and the equivalent switches for skills, if the CLI offers them.

## 5. Trims for `true` (the method stays; only its waste goes; all six ruled in, §8 item 5)

- **T1** — siblings by title only in the subtask prompt; the current item in full (W4).
- **T2** — under the `digest` base, the warm sentence stops claiming the loaded files were inherited (W3).
- **T3** — the granularity budget is measured above the agent's session base, not as `contextLimit/2` (W9).
- **T4** — D9.
- **T5** — targeted verification per item; the full suite once, in the last item (W6).
- **T6** — no separate close-out item: final verification folds into the last item (W8).

## 6. Behavior matrix

| mode | sessions | who decides the split | fork base | handover |
|---|---|---|---|---|
| `off` | one whole-task session | — | — | none |
| `ondemand` | whole-task session + continuations | — | — | self-directed (0056), wall D6 |
| `auto` (new) | lead (+ continuations) [+ fan-out items] | the lead, after understanding, under D3/D4 | the lead itself | lead and items: self-directed, wall D6 |
| `true` (old `auto`) | decompose + subtasks + wrap-up | the decompose session, upfront | `digest` (default) / `session` | none in subtasks (0056 D1) |
| `auto` on an agent without fork or steer | as `ondemand` without notices | — | — | as degraded today |

## 7. Expected effect

- **T-008 replayed under `auto`.**
  - The lead reads what the decompose session read.
  - The split is rejected by the lead's own criteria, or failing that by D4: 9 of 11 items were dependent, and 8 files were shared.
  - It finishes as one session: an estimated $4–6 against $12.28, and against about $18.6 including the stray sessions (X1).
- **A large, separable task (T-032-sized, 365k peak context).**
  - The lead understands and builds the shared foundation, then fans out 2–4 streams from its fork.
  - The saving over `off` is estimated at 10–20%: the siblings' growth is not carried, and the understanding is cache-read, not rewritten.
- **Everything else** costs what `off` costs, plus a split clause of a few hundred tokens in the prompt.
- The target is **`auto` ≤ `off` on every task, below it on large, separable ones**. No mechanism under prompt caching makes decomposition dramatically cheaper than one well-run session. The 3× seen on T-008 was waste, not the price of decomposition.

## 8. Rulings (2026-09-27: every recommendation accepted)

1. **Stored `"auto"`** takes the new meaning, with no migration (D8). Rejected: `fix` rewriting it to `"true"` once to preserve the old behavior.
2. **The D6 wall** applies to `ondemand` as well as `auto`. Rejected: `auto` only.
3. **`DECOMPOSE_FINE` defaults to off** (D9). Rejected: leaving it on for `true`.
4. **X2's carrier** is a glob list in `.opencode/auto/config.json` (amendable, shared with the repository). Rejected: a local-only file.
5. **T1–T6 for `true`**: all six are taken. Rejected: keeping `true` byte-identical to today.

## 9. Stages and steps

- **S1 — X1.** Scrub the switches in `claudeEnv` and the `opencode serve` spawn. Tests: the adapter env case, and an `agent-fake` case asserting that no `OPENCODE_AUTO_*` reaches the agent's environment.
- **S2 — D1.** Add the `"true"` mode and move every `"auto"` branch to it.
  - Until S4, `auto` runs as the lead without the split clause (≡ `ondemand`), so S2 is safe to ship alone.
  - Config parse and validation, the resume gate, preflight dispatch needs, runner dispatch.
  - The shell's `--subtask` values and help text land on the shell branch.
- **S3 — D6.** `steerWall` with the window-quarter floor. Tests: the `testrun` wall table.
- **S4 — D2–D4.**
  - The `whole.md` split clause (`{{#if adaptive}}`) and its renderer flag.
  - Split detection after the lead ends, the guard, the driver-written `todo.md`, the rejection re-prompt through `forkEndedSession`, and the lead's commit before fan-out.
- **S5 — D5.**
  - The lead as the fork base, `fanout.md` with its renderer, and the changed-files list for dependent items.
  - Item handover through the ondemand loop; last-item full verification.
- **S6 — D7, D9, and T1–T6 and X2 as ruled** (§8).
- **S7 — documentation and measurement.**
  - Documentation: the AGENTS.md navigation line, glossary rows (adaptive decomposition, lead session, fan-out), `docs/structure.md`, and the shell README.
  - One measured A/B run on two comparable tasks, compared on `stats.json` per-task usage. This is the 0003 §11 A/B matrix, finally run on claude.

## 10. Touch points

- **Mode and dispatch:** `src/opts.ts` (`SubtaskMode`), `src/config.ts` (value, default), `src/runner.ts` (dispatch), `src/resume-gate.ts`, `src/loop-preflight.ts` (dispatch needs: the lead is the `whole` role, items the `subtask` role).
- **Execution:** `src/execute.ts` (lead, split detection and guard, fan-out), `src/session.ts` `ensureForkBase` (lead as base), `src/tasks.ts` (driver-written `S<nn>/todo.md`), `src/testrun.ts` `steerWall`, `src/capability.ts` (D7).
- **Prompts:** `src/prompt.ts` + `templates/prompts/whole.md` + new `templates/prompts/fanout.md` (registered in `src/template.ts`).
- **Switches and fixes:** `src/switches.ts` (`fine` default), `src/agent/claude/client.ts` `claudeEnv` + `src/agent/opencode/server.ts` (X1), `src/document/roles.ts` (X2).
- **Tests:** `test/agent-fake.test.ts` (no split / accepted split / rejected split / dependent item with changed files / degraded agent).
- **Shell:** `packages/auto` (flag values, help, README).

## 11. Relationship to other designs

- **0003** (fork-decompose): its premise ("understanding paid once, each fork's incremental cost far below re-reading files") holds for the `session` base. D5 applies it where it holds; T-008 measured the `digest` default where it does not.
- **0030** (merged understand+decompose): unchanged under `true`.
- **0056** (ondemand): `auto`'s lead is an ondemand session with a split clause. D5 re-enables handover for fan-out items only. D6 amends the wall.
- **0045** (P1): X2 narrows a false-positive class without weakening the rule.
- **0046** (parallel): fan-out siblings are parallel-ready.
- **0055** (registry): the fork base per agent; the lead takes the `whole` role's tier, items the `subtask` role's.

## 12. Implementation record

- **S1 — X1, done 2026-09-27.**
  - `src/agent/env.ts` `driverVariable`: an inherited variable with the `OPENCODE_AUTO_` prefix is the driver's. `claudeEnv` drops it next to the Claude Code session variables. `serverEnv` drops it before the profile overlay and `OPENCODE_CONFIG_CONTENT`. The overlay comes after the scrub, so a profile's `env` can still set one.
  - The agent domain cannot import the switch registry, so it restates the prefix; a test checks every `SWITCH_ENV` name and `OPENCODE_AUTO_SERVER` against it.
  - Two exceptions, each marked in the code:
    - opencode's own flags that share the prefix (`OPENCODE_AUTO_SHARE`, `OPENCODE_AUTO_HEAP_SNAPSHOT`) stay (`src/agent/env.ts`);
    - a variable the spawn config names as `{env:NAME}` (a key ring's key) stays in the server's environment, since the server substitutes the reference from it (`serverEnv`).
  - Out of reach: an external server (`--server`, `OPENCODE_AUTO_SERVER`, a profile's `server`) keeps the environment it was started with.
  - Tests: `test/agent-claude.test.ts` (the claude client's process start), `test/agent-server.test.ts` (the real `opencode serve` spawn over a fake executable that records its environment; the SDK-equivalence case now expects exactly this difference) and `test/agent-env.test.ts` (the registry check; both spawn environments drop every driver variable). §9's `agent-fake` case lives in those suites instead: the native fake starts no process, so it has no environment to observe.
- **S2 — D1, done 2026-09-27.**
  - `src/opts.ts` `SUBTASK_MODES` = `off|auto|true|ondemand`, and `SubtaskMode` is derived from it. `src/config.ts` accepts the four strings and the JSON boolean `true`, which it reads as `"true"`, so the next `amend` writes the string. The JSON boolean `false` is still invalid. The default stays `"auto"` (D8).
  - Every branch that tested for the pipeline now tests for `"true"`:
    - `src/runner.ts`: the decompose/fork-base/subtask branch, the phase an interrupted run persists, and the wrap-up's `solo`;
    - `src/resume-gate.ts` `unitReruns`: `decompose` is owned under `true` only, `whole` under every other mode. A `decompose` record left by a pre-0059 `auto` run owns no unit under today's `auto`, so its lead starts fresh;
    - `src/loop-preflight.ts` `dispatchNeeds`: the `decompose` role under `true` only. Everywhere else the `whole` role is needed, so a default m-mode run no longer needs the deep tier unless it plans or scans.
  - `auto` joins `ondemand` at a single point, `selfHandover` in `src/runner.ts`. It gets the same stale-handover cleanup, `executeWhole` with the handover protocol, and the same prompt. The split clause (S4) will be added at that point, so this is also where the temporary `auto` ≡ `ondemand` equivalence ends (marked in `src/opts.ts`).
  - Shell (`packages/auto`): `--subtask` takes `off|auto|true|ondemand` from `SUBTASK_MODES`, and bare `--subtask` stays `auto`. The usage lines of `init`/`amend` and the invalid-value message list the four values. The README's config table, flag table and execution-pipeline section describe `auto` as the lead (≡ `ondemand` for now) and `true` as the pipeline.
  - Not changed: the planning templates' parenthetical "the DRIVER's decompose session generates those [checklist items] at execution time" (`implement-plan.md`, `phase-plan.md`). The rule it explains, not to hand-write checklist items, still holds for every mode; the wording is left for S4, when the lead's split changes who writes `subtasks.md`.
  - Tests: `test/config.test.ts` (the four values, the boolean alias, the rejected `false`), `test/resume-gate.test.ts` (ownership under `true` and `auto`), `test/loop-preflight.test.ts` (the deep tier is needed under `true`, and not under the default, `auto`, `ondemand` or `off`), `test/agent-fake.test.ts` (runner dispatch: `auto` and the default send exactly `ondemand`'s single prompt, and `true` opens with the decompose session), and the shell's `test/e2e.test.ts` (`init --subtask true`, the boolean read back through `status` and `amend`, bare `--subtask`, the invalid-value message).
- **S3 — D6, done 2026-09-27.**
  - `steerWall(limit, window)` = `min(max(limit, ⌊window/4⌋), ⌊0.8·window⌋)`, and the budget when the window is unknown. The result is unchanged wherever window/4 ≤ 2×cap.
  - The post-session check had to follow. `sessionHandoverDue` measured the final figure against the raw 2×cap budget, which was sound only while the wall never exceeded it. On a 1M window, a session finishing at 150k was never hinted (the wall is 250k) but would have been judged due and asked for a handover document. The watch now reports the wall of its last measurement (`Watch.wall`, copied to `SessionChain.wall` by attempt). The figure rule uses the larger of the budget and that wall, which is the budget, as before, on every window up to 512k at the default cap (`src/usage.ts`).
  - Tests: `test/testrun.test.ts` (the wall table), `test/agent-fake.test.ts` (a 1M window: a notice at 150k naming the 250k wall, no hint, not due; the hint at 260k) and `test/execute-handover.test.ts` (a 150k finish on a 1M window is one natural session). Two `agent-fake` cases that steered at a 500-token budget on the fixture's 100k window now use a 30k budget and figure: the floor lifts a 500-token budget to 25k there.

- **S4 — D2–D4, done 2026-09-27.**
  - The split clause: `templates/prompts/whole.md` renders it under `{{#if adaptive}}` after the context-budget protocol, and replaces the single-session sentence with the lead's. `renderWhole` takes `adaptive`; `executeWhole(…, lead)` passes it while the clause is open. The clause states D3's three criteria, the shared-foundation rule, the line format and the guard, and tells the lead to write neither `handoff.md` nor any `S<nn>/todo.md`.
  - When the clause is offered: auto's lead with the steer built (criterion (c) is the first usage notice, so `OPENCODE_AUTO_STEER=off`, or an agent the run start degraded to steer off, gets none — the steer half of D7 comes for free), and no checklist committed for the task. A checklist committed before the stage is one written by hand: the lead runs without the clause and the checklist runs after it, as under `ondemand`. The starting checklist is read from HEAD (`src/git.ts` `headText`), so a split an interrupted lead left uncommitted is still judged by the resumed lead; without a commit to read it is the copy on disk.
  - Split detection and the guard (`src/execute.ts` `executeWhole`, `src/split.ts`): after every lead session, before its commit, a `subtasks.md` that differs from the starting copy and has checklist lines is a split. `src/split.ts` parses each line (the description, `Depends:` and `Artifacts:` in either order, `Artifacts:` through the spec parser) and checks D4's structure: 2–5 items, a description and at least one path per line, `checklistProblems` over the lines' `Depends:` and paths, and no path (a directory covering the files under it) declared by two items unless one transitively depends on the other — an absent `Depends:` is the previous item, as for every checklist. The usage condition is `src/usage.ts` `splitUsageReached`: on a live tier the lead's final figure must reach half the wall of its last measurement (the 2×cap budget where none was taken); the other tiers skip it.
  - Taken: `writeSplitTodos` writes each line's `S<nn>/todo.md` (`Depends:` as declared, `Touches:` from the paths, `## Scope` with the description, `## Artifacts`, the terminator), the lead's `handoff.md` is removed (a stream would read its status as its own), and the session's commit is the task's `T-NNN exec` commit with the lead's work, the checklist and the scope files. The runner's existing subtask loop then runs the streams with `runSubtask` — cold sessions until S5 makes them forks.
  - Rejected: `subtasks.md` is put back as the stage found it (removed, normally), with any `S<nn>/todo.md` the lead wrote against the clause; the lead's work is committed; `forkEndedSession` forks the lead and the note `templates/prompts/split-rejected.md` (the reason, the removed file, no second split, the handover protocol still applies) is its whole prompt. Without a fork, a new session gets the full whole-task prompt without the clause plus the note, which then says the earlier work is committed. After a rejection no session of the stage gets the clause, and a `subtasks.md` written anyway is removed with a log line.
  - A lead stopped before its split is judged (a blocked session) has the unjudged checklist removed first: the loop's interruption commit would otherwise keep it, and the next run would read it as written by hand.
  - Resume: under auto a checklist whose state files exist is a split already taken (`splitTaken`). The runner skips the lead and the loop continues the streams, and `unitReruns` owns no `whole` unit then (`UnitRerunCtx.split`), so the lead's recorded session is never continued as a stream. A checklist the pre-0059 pipeline left (it writes the same files) reads the same way: its remaining items run, with no fresh lead first — this replaces the S2 note that such a task starts its lead fresh.
  - The planning templates' parenthetical left by S2 now reads "whether and how a task is split is decided at execution time" (`implement-plan.md`, `phase-plan.md`, `phase-append.md`).
  - `SubtaskMode`'s temporary `auto` ≡ `ondemand` marker (`src/opts.ts`) is retired; the core `AGENTS.md` navigation, `docs/structure.md` and the shell README describe the split.
  - Tests: `test/split.test.ts` (the line parser, the guard, the scope file, `splitTaken`, `splitUsageReached`), `test/agent-fake.test.ts` (no split, a taken split with its commits and scope files, a rejected split with the fork's note and the ignored second checklist, the usage condition, an agent without fork, a blocked lead, a split taken by an earlier run, a hand-written checklist, steer off), `test/resume-gate.test.ts`, `test/prompt-exec.test.ts`, `test/template.test.ts` and the goldens (`whole-adaptive`, `split-rejected`, the planning templates).

- **S5 — D5, done 2026-09-27.**
  - The lead as the fork base: when the split is taken, `executeWhole` records the lead's session as the task's fork base (`setForkBase`, per agent under a registry) and, after the `T-NNN exec` commit, the split point as `split` in `.auto/units.json` (`src/tasks.ts` `setSplit`, a `UnitBaseline`; empty under dryrun or without the commit gate). A lead that starts again drops the record. The runner's subtask loop reads it under auto: `leadForkBase` (`src/execute.ts`) returns the lead when its session is alive, and `runSubtask(…, split)` runs the item as a stream. No split record means plain subtasks, the pre-S5 path: a hand-written checklist, one the planned pipeline left, or a split whose record was lost between its commit and the record.
  - The fork guard: the lead is at least half the wall, so `forkBaseAllowed` (`src/usage.ts`) takes a `lead` flag that lifts the cap/2 ceiling (the lead's figure is already bounded by its own hard-wall hint). `ForkBaseInfo.lead` carries it to `seedForkSession`, and `SessionChain.forkLead` carries it to the transient-error retry, which re-seeds from `chain.forkBase` alone. The pipeline's fork switches (`OPENCODE_AUTO_FORK`/`_FORK_BASE`) are not read for streams (D1: they govern `true`).
  - `templates/prompts/fanout.md` + `src/prompt.ts` `renderFanout`: the delta a fork gets as its whole prompt — the item line, the qualified stream id, the other streams by title (`src/split.ts` `splitTitle`, "(done)" on those that ran), the changed-files list or the "do not re-read" sentence, the verification scope, the stream's own record (no output document for code changes; the driver ticks the checklist), the terminator rule, the stream's test-handover document, the stream-scoped usage protocol and the self-check. Registered in `src/template.ts` with tier-1 markers (the item line and both status strings).
  - The changed-files list: only for a stream with prerequisites (`src/document/state.ts` `checklistPrerequisites`, an absent `Depends:` is the previous item). It is `unitChangedFiles(dir, split)` — tracked diffs and untracked files across the nested repositories, deletions left out — minus the driver's own `subtasks.md` and `S<nn>/todo|done.md` (`splitStateFile`).
  - Item handover through the ondemand loop: a stream runs under the lead's steer (`handoffSteer`: notices at 50%/85% of the wall, the hard-wall hint; none with `OPENCODE_AUTO_STEER=off`). After each session, a handover due by the figure or a fresh `handoff.md` is read: `Status: continue` continues the stream in a new session (not a fork of the lead, which would restart at the lead's size) with the full subtask prompt and the continuation line; `done` goes on to the shape check; no valid document costs one re-prompt through a fork of the ended session (the feedback alone), then blocks — or the strict-resume rollback redo when it is on. The stream's commit stays one unit commit at its close-out. `subtask.md` gains the same protocol under `{{#if budget}}`, which only a stream passes; the pipeline's prompt is byte-identical.
  - Last-item full verification: the delta asks every stream for the checks of its own changes, and the stream whose siblings are all done for the task's full acceptance verification once.
  - Fallbacks: the lead gone (`sessionAlive`), an agent without fork, or a failed fork gives a new session with the full subtask prompt and the protocol; a session resumed after an interruption gets the full prompt as well.
  - Not in S5: withholding the split clause from an agent that cannot fork (D7, S6); running streams side by side (0046).
  - Tests: `test/usage.test.ts` (the lead row), `test/split.test.ts` (`splitTitle`, `splitStateFile`, `checklistPrerequisites`, the split record), `test/prompt-exec.test.ts` and the goldens (`fanout`, `fanout-last`, `subtask-budget`), `test/template.test.ts`, `test/prompt-template.test.ts` (`fanout.md` among the terminator rule's consumers), and `test/agent-fake.test.ts` (a taken split forks the lead for each stream with the delta; a dependent stream's changed files; a stream handing over and continuing in a new session; a stream hinted without a document; a failed fork; a split record left by an earlier run).

- **S6 — D7, D9, T1–T6 and X2, done 2026-09-27.**
  - D7, the fork half (the steer half came with S4): `src/capability.ts` `forksSessions` (a fork capability and resume). `degrade` sets the run-start fact `leadSplit: false` when the agent cannot fork sessions; under a registry `degradeAgents` runs it over the fleet's intersection, so one agent without fork withholds the clause from every lead. The fact travels `startPool` → the loop context → `runTask` (`Opts.leadSplit`), and `executeWhole` offers the clause only while it is not `false`. The note (under `--subtask auto` only; the fact itself is set in every mode, where only auto reads it): "the lead's split needs an agent that can fork sessions … the lead runs without its split clause, as an ondemand session does", with the forcing agent under a registry. Under auto the steer note also names the missing split clause. A lead whose fork fails at run time is the existing rejection fallback (a new session with the full prompt).
  - D9: `SWITCH_DEFAULTS.fine` is `false`; `OPENCODE_AUTO_DECOMPOSE_FINE=on` restores the criteria, and the switch line lists `=on` as non-default.
  - T1: `src/tasks.ts` `checklistTitle` (moved from `split.ts` `splitTitle`, since the prompt layer may not import the split module) cuts a line at its field block (`Depends:`/`Artifacts:`), then at the first colon, then at 60 characters. `renderSubtask` lists the siblings as `n. <title>`, and the list header says so. The decompose templates (all seven) ask each line to open with `<short title>:`, and the format line shows it.
  - T2: `ForkBaseInfo.digest` marks a base that holds the digest alone (both digest returns of `ensureForkBase`, and a digest record read in session mode). `runSubtask` passes it, and `subtask.md`'s warm sentence then says only `context.md` is inherited and the understanding stage's files are not in context.
  - T3: the intent pack's budget bullet measures an item's own work above the context its session starts with (the harness, the prompt, the inherited background); the figure stays `contextBudget` (half the cap).
  - T5: `subtask.md` gains a verification paragraph: the checks aimed at the subtask's own changes, not the full suite, and in the last item the task's full acceptance verification once. `last` is derived from the checklist (every other item done); `renderSubtask` takes an override. The decompose rule's self-contained bullet says the same of each item's own verification.
  - T6: a new decompose rule bullet: the task's final verification is no item of its own, the last item runs it after its own work. The design phase's consistency-check duty (`decompose-d.md`) stays: it is a review producing its own findings, not a re-run of the verification.
  - X2: the key is `scanExempt`, an array of globs relative to the target directory (`src/config.ts`: validated at load, each glob by `scanExemptProblem` — not empty, not absolute, no `..`; `[]` loads as absent; the summary line shows it). `src/document/roles.ts` `scanExempted` matches a glob against the path and each of its parent directories (a named directory covers its files), for freeform paths only: a process document stays under its role's rules whatever the list says. `p1Scope` and `eofScanExempt` take the list; `processReferenceScan` passes it through. The consumers are the subtask close-out (`subtaskArtifactProblems`, both scans) and the round-close gate (`roundCloseProblems`, from the phase loop and from `plan`'s prelude). Shell: `init`/`amend --scan-exempt <globs>|none` (a brace-aware comma split, `splitGlobList`; the list replaces the stored one; `none` drops the key; an empty or unusable list is a usage error); `run`/`plan` refuse it as a frozen config flag. A plain `init` drops it like every flag-carried key.
  - The template terminator stripping (`src/template.ts`) stays: a project overlay under `.opencode/auto/prompts/` is a deliverable the terminator scan covers unless the project lists it, so both choices must render the same prompt, and the builtin templates that end with the line would otherwise put it into prompts.
  - This repository's own config is not changed by S6 (the run protects it). The exemption W7 asks for is one command: `amend --scan-exempt "opencode/packages/auto-core/test/**,opencode/packages/auto-core/templates"` or the like.
  - Tests: `test/switches.test.ts` (the `fine` default and its switch-line forms), `test/split.test.ts` (`checklistTitle`), `test/prompt-exec.test.ts` (titles only, the verification paragraph and `last`, the digest sentence, the decompose line format), `test/session-api.test.ts` and `test/agent-fake.test.ts` (`digest` on the base; D7 — no clause, one lead, no streams, under `leadSplit: false`; the rejection fallback now by a failed fork; the `true` pipeline's subtask prompts end to end), `test/capability.test.ts` (the `leadSplit` fact and the notes), `test/agent-pool.test.ts` (the fleet intersection's `leadSplit`), `test/config.test.ts` (`scanExempt` load, save, summary, `scanExemptProblem`, `splitGlobList`), `test/document-roles.test.ts` (`scanExempted`, the scopes, the scan), `test/subtask-shape.test.ts` (an exempted fixture passes the close-out), `test/round-gates.test.ts` (round close with the list), the goldens (`subtask`, the decompose templates), and the shell's `test/e2e.test.ts` (`--scan-exempt` through init, amend, none and the refused values; `run` refuses it).

- **S7 — documentation, tests and the measured A/B run, 2026-09-27.**
  - Documentation: the glossary's rows for the planned pipeline, adaptive decomposition, the lead session, the split, the split clause, the split guard, a stream, fan-out, the split point and the wall, with two confusable pairs (decomposition / split, stream / subtask); `docs/structure.md` (the task pipeline's dispatch by mode, the task store's runtime records, the test-run module's wall); the core `AGENTS.md` navigation (the lead's figure, the fork switches governing `true`); the shell README (the config row's wall, the ondemand protocol as 0056 and D6 made it, the `true` subtasks without a handover protocol — both paragraphs still described the pre-0056 2×cap hint — the lead's figure, the repair note).
  - A defect found while writing the claude end-to-end test: on an agent with no readable session history (claude, `history: false`) only the first stream forked the lead. `leadForkBase` read the lead's size from the chain while the chain still held the lead, and from the session's history otherwise; claude has none, so the second and later streams, and every stream of a resumed run, logged "base usage unknown; not forking (cold start)" and started cold with the full subtask prompt. The fix: the lead's final figure is kept with the split point (`.auto/units.json` `leadUsed`, `src/tasks.ts` `setSplit`, written only where the guard measured it, on a live usage tier), and `leadForkBase` falls back to it after the history read, so an agent with history behaves as before.
  - Tests: `test/split.test.ts` (the record written, dropped and sanitized), `test/agent-fake.test.ts` (an agent without history: both streams fork the lead, in the run that split and in a resumed one), and the shell's `test/e2e.test.ts` over the fake `claude` CLI (`test/fixtures/fake-claude.ts` now plays the lead, its streams, the rejected lead's fork, the wrap-up and the phase handover, and records each turn's session arguments): a taken split — the usage notice reaches the lead's live process mid-turn, both streams are claude processes started with `--resume <lead> --fork-session`, the second one from the recorded figure — and a rejected one, finished by a fork of the lead.
  - Measured, 2026-09-27: `claude-opus-5-5` (claude 2.1.283). Two identical copies of a small Bun library each
    got the same task (add csv, ini and query-string modules with tests, export and document them). The arms
    ran side by side with config defaults (contextLimit 64k, wrap-up on) and differed only in `--subtask`.
    Figures are `stats.json` per-task usage; the API-equivalent uses the §1.1 weights with reasoning counted as
    output.

    | | `true` | `auto` | auto / true |
    |---|---|---|---|
    | claude cost | $5.62 | $2.66 | 0.47 |
    | API-equivalent | $5.41 | $2.57 | 0.48 |
    | output incl. reasoning | 137.0k | 71.8k | 0.52 |
    | cache write | 287.2k | 120.9k | 0.42 |
    | cache read | 2.91M | 1.30M | 0.45 |
    | sessions | 9 | 2 | — |
    | AI time | 21.4 min | 11.0 min | 0.51 |

    - `true` spent its sessions as follows:
      - decomposition cost $1.38, 25% of the task (T-008: 26%);
      - a digest base;
      - five subtask forks, each writing 12k–43k of cache on top of the 23.8k prefix;
      - one shape-check re-prompt;
      - the wrap-up.
    - `auto` ran the lead ($2.10) and the wrap-up ($0.57). The lead got the usage notice at 68.6k and declined
      to split ("the rest should fit in this session's budget"), as §7 expects for a task this size, so no
      stream ran.
    - Both deliverables pass their own tests (73 and 76 cases). The stats agree with the claude transcripts
      deduplicated by `requestId`, and neither arm waited on quota.
    - The §7 target holds here: `auto` cost about half the pipeline, which matches §0's 2–3× at its low end. This
      was one run per arm. The saving a taken split should bring on a large, separable task is still
      unmeasured.
    - Finding: on claude the lead's notice measured against a 128k wall, the 2×cap budget, not the 250k a 1M
      window gives. The adapter learns a window only from a turn's result event, per run, so the first turn of a
      run's first session always runs on the budget. Left as D6's designed fallback. Seeding the window from the
      model registry would change every claude session's steering, and belongs to a design of its own.

- **S7 measurement fold, 2026-10-03.** The record above rests on raw artifacts the docs-governance round rules
  for deletion: `docs/T-043/ab/summary.md` (the printed summary tables), `docs/T-043/ab/true.stats.json` and
  `docs/T-043/ab/auto.stats.json` (both arms' driver stats), and `docs/T-043/report.md` (the task report, its
  AUTO-RESOLVEs folded below). After deletion the raw files stay findable in this repository's git history. This
  fold carries what the measured record above does not already hold — the per-session tables, the class shares,
  the transcript cross-check, the deliverable comparison, the corrected column and the rulings — so nothing
  unique is lost with the artifacts.
  - Setup beyond the record above: both arms started side by side at 18:46:12, claude 2.1.283, agent
    `claude-opus-5-5`; the claude usage windows stood at 5h 51% and 7d 84% at the start; input was 0.1k in both
    arms; inner exit codes 0 and 0; no quota wait (`waitMs` 0). `stats.json` `taskB`, arm `true`: 9 sessions,
    9 steps, aiMs 1,284,108 (21.4 min), usage input 136 / output 63,731 / reasoning 73,229 / cacheRead 2,912,269 /
    cacheWrite 287,186, cost $5.6197. Arm `auto`: 2 sessions, 2 steps, aiMs 660,894 (11.0 min), input 52 /
    output 24,739 / reasoning 47,035 / cacheRead 1,300,830 / cacheWrite 120,885, cost $2.6629.
  - Sessions, arm `true` (roles from the order in the run log; every subtask forked the digest base, prefix
    23.8k tokens; S5 failed the artifact shape check once and was re-prompted through a fork):

    | session | role | AI time | output | reasoning | cache read | cache write | claude cost | API-equiv. |
    |---|---|---|---|---|---|---|---|---|
    | 392d99df | understanding + decomposition | 6.1 min | 15.5k | 23.9k | 378.1k | 64.7k | $1.38 | $1.32 |
    | d65cda54 | digest fork base | 0.2 min | 0.5k | 0.3k | 10.8k | 13.0k | $0.12 | $0.11 |
    | f9621080 | S1 csv | 3.6 min | 9.1k | 14.2k | 396.5k | 32.7k | $0.81 | $0.78 |
    | e258ed71 | S2 ini | 3.9 min | 10.6k | 14.9k | 420.6k | 40.8k | $0.92 | $0.89 |
    | 014b19ee | S3 query | 3.0 min | 9.5k | 10.5k | 347.1k | 35.9k | $0.76 | $0.73 |
    | a3b781f4 | S4 barrel exports | 0.5 min | 2.5k | 0.1k | 186.7k | 12.0k | $0.19 | $0.18 |
    | be5fcb77 | S5 README + final checks | 2.8 min | 10.6k | 7.8k | 555.5k | 43.3k | $0.83 | $0.80 |
    | 1c2c8ae2 | S5 shape-check re-prompt | 0.3 min | 0.8k | 0.5k | 206.8k | 4.1k | $0.10 | $0.10 |
    | 126134f7 | wrap-up | 1.1 min | 4.6k | 1.1k | 410.2k | 40.6k | $0.52 | $0.49 |

  - Sessions, arm `auto`: `db1abab8`, the lead (the whole task), 9.4 min, output 19.3k, reasoning 43.5k, cache
    read 889.5k, cache write 82.7k, $2.10 ($2.03 API-equiv.); `0f6e98d4`, the wrap-up, 1.6 min, output 5.4k,
    reasoning 3.5k, cache read 411.3k, cache write 38.2k, $0.57 ($0.54). The driver steered the usage notice
    once, at 68.6k tokens — 54% of the 128k wall; with a known 1M window the wall would be 250k
    (`min(max(128k, 250k), 800k)`), so the notice would not have fired at 27% of it. The lead answered "The rest
    should fit in this session's budget, so I'm not splitting the task" and finished at 90.9k, with no
    `subtasks.md`, no guard verdict and no stream — the fan-out path (and the claude-side `leadUsed` fix) was
    therefore not exercised live, and is covered by the shell e2e over the fake claude CLI.
  - API-equivalent shares by class (output including reasoning / cache write / cache read): `true` $2.70 (50%) /
    $2.07 (38%) / $0.64 (12%); `auto` $1.41 (55%) / $0.87 (34%) / $0.29 (11%).
  - Cross-check against the claude transcripts, deduplicated by `requestId` (whole run): `true` 9 files, 68
    requests, input 0.1k, output incl. thinking 137.0k, cache read 2.91M, cache write 287.2k, API-equiv. $5.41;
    `auto` 2 files, 26 requests, input 0.1k, output 71.8k, cache read 1.30M, cache write 120.9k, $2.57. The
    stats agree with the transcripts (output plus reasoning 136.96k against 137.0k, and 71.77k against 71.8k;
    cache classes equal; claude's own cost within 4% of the API-equivalent in both arms).
  - Deliverables: both arms touch the same eight files (`src/{csv,ini,query,index}.ts`, the three test files,
    `README.md`); `true` 8 files, +764, its own `bun test` 73 pass / 0 fail / 139 `expect()` calls; `auto`
    8 files, +580, 76 pass / 0 fail / 103 `expect()` calls; both inner reports end with `Result: PASS`. The
    pipeline wrote more test assertions and a longer README (139 against 103 `expect()` calls, 101 against 56
    README lines); the adaptive lead wrote three more test cases.
  - The corrected API-equivalent column: as printed, the summary script's stats-based column gave $3.96
    (`true`) and $1.64 (`auto`) — it weighted `output` but not `reasoning`, while §1.1 fitted its weights with
    reasoning counted as output, as claude's transcripts count it. With reasoning at the output weight the
    column reads $5.41 and $2.57, equal to the transcript cross-check; those corrected figures are the ones this
    §12 record uses. Re-running the paid A/B only to reprint a column was rejected; the script now carries that
    weight.
  - The six AUTO-RESOLVEs around the A/B (from `docs/T-043/report.md`). AUTO-DECISION: the report holds seven
    AUTO-RESOLVEs; the seventh (does S7 fix the stream-fork defect found on claude, beyond documentation and
    tests? -> yes, in this task) is the S7 implementation record above the measured section and is not repeated
    here.
    1. AUTO-RESOLVE: rewrite the shell README's `ondemand` and `true`-subtask handover paragraphs, which predate
       0056? -> yes (S7 names the shell README, and both paragraphs describe the very context-budget protocol
       auto's lead and streams run under; left stale, they contradict the `auto` section above them).
    2. AUTO-RESOLVE: which two arms does the "one measured A/B run" compare? -> `--subtask true` (the planned
       pipeline, what `auto` was when T-008 was measured) against `--subtask auto` (the new default); `off` is
       not a third arm (the literal scope is one A/B; when the lead does not split, the `auto` arm is the
       single-session reference itself, plus the split clause).
    3. AUTO-RESOLVE: "two comparable tasks" -> the same task, run once per arm on identical copies of one seed
       project (the most comparable pair there is; two different tasks would add their own variance to a sample
       of one per arm).
    4. AUTO-RESOLVE: where does the A/B run? -> a scratch project under `/tmp` (a small Bun library with one
       module and its tests; the task adds three independent format modules with tests), not this repository
       (the round's next tasks are not this task's to run, and the config is read-only during the run).
    5. AUTO-RESOLVE: fix the unknown-window wall on a claude run's first turn in this task? -> no; recorded as
       the finding above (it is D6's designed fallback when the window is unknown; a fix, such as seeding the
       window from the model registry or from a previous run, changes steering for every claude session and
       belongs to a design of its own).
    6. AUTO-RESOLVE: what counts as done for "one measured A/B run"? -> PASS when both suites pass; both arms
       complete (exit 0) and each deliverable passes its own tests; the adaptive arm costs no more than the
       planned pipeline (§7's target `auto` ≤ `off`, with the pipeline as the measured reference); the figures
       cross-check against the transcripts. A second, split-inducing task was not run (the literal scope is one
       A/B; it costs more real quota; the split path is covered end to end by the fake-claude e2e).
  - One further finding, not this design's: both inner runs listed "malformed marker" warnings among their
    auto-answered questions — the sessions wrapped long AUTO-RESOLVE lines across several markdown lines, or
    quoted the marker in prose. The existing reader flagging agent format drift; recorded here only because the
    raw artifacts go.

<!-- auto: eof -->
