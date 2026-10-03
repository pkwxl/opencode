# Cross-Interruption Cumulative Duration and Token Consumption Stats (Stats / Timing) Design

Status: implemented (2026-09-11, P1..P7 all landed -- the `src/stats.ts` stats core, wiring at the loop/runner/step
three sites, six messages, unit tests and docs; `bun typecheck` clean, `bun test` all green at 558 pass).
Plan file `plans/STATS_PLAN.md` (with the user's 6 requirements and the confirmed conventions); the implementation process and per-task
AUTO-DECISIONs live in `docs/T-001/` (S01..S05) through `docs/T-007/report.md`. Always-on stats,
**with no `OPENCODE_AUTO_*` switch added** (no violation of the "switches are not persisted" invariant); persisted in the target directory's
`.auto/stats.json` (inside gitignore, written exclusively by the driver, not on the protect list).

## A. Motivation

The driver's original duration stats assumed the program runs uninterrupted to completion: the task-duration start point is loop.ts's in-memory
`const start`, zeroed on every process restart; `✓ T-001 完成(用时 X)` (T-001 complete, duration X) in a resume scenario reports only the last segment with no
annotation; session duration exists only at watch()'s normal exit and is missing at the error/blocked exits; phases/rounds have no
timing at all; no level has Token stats (the per-round real consumption of a fork chain is invisible). The interruption-recovery mechanism
(`.auto/progress.json`) records only the recovery point, not cumulative amounts; a forced exit (SIGINT×2 → `process.exit(130)`)
and kill -9 skip all finally blocks -- **cumulative totals must be persisted incrementally**.

Goal: task/session/sub-session/phase/round levels each emit cross-interruption cumulative duration and Token breakdowns
(input/output/reasoning/cache read/cache write/hit rate/cost).

## B. Conventions (Confirmed Decisions)

- **AI duration** = pure AI-session run time (suspension waiting for a human reply to an in-session askHuman does not count).
- **Total duration (wallMs)** = accumulated over the process's lifetime, **excluding both downtime gaps and pure human waits**
  (stepPause, --wait-between, askHuman); human waits are tracked separately as `waitMs`.
- **Sub-session display scope**: every AI session through `runSession→attempt` (including verify adjudication/review/
  phase planning/handover distillation and other side paths, with pseudo-tasks PLAN/AUTO under the same convention), all emitting the two `◉ 会话结束` (session ended) lines uniformly.
- **Hit rate computed locally**: `hit = cacheRead / (cacheRead + input)` (after server-side normalization input no longer
  includes the cache portion); a zero denominator displays `—` (`src/log.ts:164` formatCacheHit).
- **Level aiMs semantics** = "AI-active wall-clock duration" (the union of wall-clock intervals where any session's AI segment is open), not
  the sum of the sessions' AI durations: with `--early` parallel sessions overlapping, `层级 aiMs ≤ Σ session aiMs` is expected,
  not undercounting; the nested-wait depth counting makes overlapping human waits count only once.
- **per-session wallMs** = aiMs + waitMs (in-session human waits count toward the session's wall clock), deliberately distinct from the three-bucket
  "wallMs excludes pure human waits" convention.

## C. Persistence schema (`.auto/stats.json`, compact JSON, v:1)

```ts
type Usage = { input; output; reasoning; cacheRead; cacheWrite; cost; steps }  // all number
type Totals = { aiMs; wallMs; waitMs; sessions; tasks; usage: Usage }
type Bucket = Totals & { id: string; since: number }
type SessionStat = { task; aiMs; wallMs; rounds; usage; at }   // per-sessionID cumulative
type StatsDoc = {
  v: 1; round: number; phase: string          // round snapshot = currentRound(dir) at load time
  open?: { at: number; ai: boolean }          // at most one in-flight segment
  lastWriteAt: number                          // refreshed by every write = proxy for the previous process's death moment
  taskB / phaseB / roundB: Bucket              // three buckets accumulated in parallel (no child-to-parent folding)
  sessions: Record<string, SessionStat>        // beyond 64, evicted by at (aggregates already booked, lossless)
  history: { rounds: number; totals: Totals }  // aggregates of past rounds rolled out (single bucket, bounded)
}
```

The `tasks` count = +1 upon entering a different task id (including the first entry in this process), accumulated in the phase/round buckets;
the alternative "count on task completion" was rejected because the completion moment (do blocked/incomplete count?) is convention-ambiguous -- the "entry"
semantics are simple and idempotent across interruptions (the same id is not counted twice).

## D. Timing Model: Single-Segment (segment) State Machine + Three-Bucket Parallel Accumulation

- `open?: { at, ai }` is at most one in-flight segment; each boundary **fold** accumulates `[open.at, now]` in parallel
  into the task/phase/round buckets (no child-to-parent folding -- a phase contains non-task time, and the folding style
  would lose it). ai segments accumulate aiMs/wallMs; wall-clock segments accumulate wallMs only.
- fold clamps to `[0, MAX_TICK=30min]` (`src/stats.ts:82`): defense against clock rollback/sleep, negatives clamped to 0.
- **Incremental persistence**: a 30s heartbeat during sessions (fold + persist; `unref()` does not block process exit) bounds
  kill -9 loss to ≤ ~30s; atomic writes (`.tmp → rename` + a promise-chain write queue for serialization, aligned with
  plan.ts edit); all write failures are caught silently -- stats never affect the flow/exit code.
- **Depreciation**: the next process's `loadStats` credits a segment left by the previous process only over `[open.at, lastWriteAt]`
  (lastWriteAt = death-moment proxy; better too little than too much, never inflated); depreciation likewise passes the MAX_TICK clamp,
  and does not enter per-session (an open segment carries no sessionID attribution; with nothing to attribute to, better too little than too much).
- **Round rollover**: a changed round number at load → roundB rolls into history and resets; a corrupted round field (<1)
  is treated as missing -- only the snapshot refreshes, no rollover, avoiding inflating history.rounds with an empty round.
- **This-process increment convention**: the `statsBoot` snapshot (taken at loadStats time, a copy of the three buckets after depreciation + rollover;
  when a bucket is reset in-process by statsTask/statsPhase the corresponding snapshot zeroes in step), "累计 X(本进程 Y)" (cumulative X, this process Y)
  = the same-named field difference of `statsTotals(scope) − statsBoot(scope)`.
- **Live read extrapolation**: `statsTotals` returns the open segment's unbooked portion on a **copy** (with the same clamp as fold),
  without modifying the doc or persisting -- the display layer reads current values at any moment and the state machine is unaffected.
- **Per-field lenient parsing** (mirroring resume.ts parseProgress): bad = missing does not throw; a corrupted/missing
  file = restart from the present (stats are not the source of truth).
- Test injection: a module-level replaceable clock `setStatsClock` (`src/stats.ts:93`) -- the alternative "add a now parameter to every API" would cut through all public
  APIs and wiring layers and pollute signatures; rejected.

## E. Hook Table (line numbers per the auto-core branch after the 2026-09-16 large-file split)

| Hook | Location | Action |
|---|---|---|
| Process start | `src/loop-preflight.ts:154` | `loadStats(directory)` (depreciation + round rollover + opening this process's first segment); with an existing document, print the resume banner `resumeBanner` (`src/loop-preflight.ts:155`) |
| Process close-out | `src/loop.ts:126` | runAll finally `flushStats(directory)` (close segment and persist, unload handles; before unprotect) |
| Task switch | `src/loop-task.ts:159` | At the task banner, `statsTask(dir, task.id)` (idempotent for the same id; switching clears the sessions map) |
| Phase switch | `src/loop-phase.ts:350` (phased, after routePhase), `src/loop.ts:103` (unphased "m") | `statsPhase(dir, letter)` (idempotent for the same letter) |
| Session start | `src/attempt.ts:199` | Before prompt dispatch, `statsSessionBegin(opts.dir, task.id)` (fold, open the AI segment, start the heartbeat) |
| Session end | `src/attempt.ts:226` | After `await watching`, `statsSessionEnd(dir, sessionID, usage)` produces the printed report; `finally` provides an idempotent backstop guarded by `booked` (`src/attempt.ts:306`, zero usage still recorded) |
| Token collection | `src/watch.ts:203` | watch's `message.part.updated` branch deduplicates step-finish parts by `part.id` (a `billedSteps` dedicated set) and accumulates the seven components; all 7 return exits of watch() carry durationMs + usage uniformly via `snapshot` |
| Human wait ×3 | `src/session-api.ts:221` (askHuman), `src/loop-progress.ts:18` (waitBetweenTasks), `src/step.ts:46` (stepPause) | `statsWaitBegin/End` wrapped in try/finally pairs (covering the interactive and exception paths) |
| Progress heartbeat | `src/loop-progress.ts:81` | `subtaskProgressLine` reads `statsTotals(dir,"task").wallMs`, guarded by `statsId === task.id` |
| Conclusion lines ×3 | `src/conclusion.ts:72` (taskEndLines), `src/conclusion.ts:94` (phaseCloseLines), `src/conclusion.ts:114` (roundCompleteLines) | Message-builder functions exported; the loop body only logs; unit tests drive them directly |

Formatter consolidation (`src/log.ts`): `formatDuration` (Chinese-style + an hours tier, :120),
`formatDurationCompact` (compact style kept verbatim, :131), `formatTokens` (:142), `formatCost`
(0 → undefined, :152), `formatCacheHit` (:164), `formatUsageLine` (tokens breakdown line,
:176 -- built from the same source as session-end line 2 and the task/phase/round conclusion lines); the two private formatDuration
copies in runner.ts/loop.ts were deleted in favor of an import (consolidating the private formatTokens copies of runner.ts and prompt.ts
is legacy left for later, see `docs/T-003/report.md`).

## F. Six Messages (Implemented Copy)

1. **Session/sub-session end** (from `src/attempt.ts:241`, printed **unconditionally** for every attempt session):
   line 1 `◉ 会话结束: 上下文 42% (35.2k/83.1k tokens),用时 12.4s(累计 1m40s / 3 轮)` ("session ended: context 42%, duration 12.4s (cumulative 1m40s / 3 rounds)");
   line 2 `tokens 入 1.2k / 出 340 / 缓存读 28.4k / 缓存写 3.1k,命中率 95.9%,费用 $0.041(累计 $0.31)` ("tokens in 1.2k / out 340 / cache read 28.4k / cache write 3.1k, hit rate 95.9%, cost $0.041, cumulative $0.31").
   Omission rules: single-round (session.rounds ≤ 1) omits the "(累计…)" part (cumulative); reasoning=0 omits the reasoning item
   (positioned between "出" (output) and "缓存读" (cache read), matching the Usage declaration order); cost=0 omits the whole cost item (never showing an
   orphaned "(累计 $X)" (cumulative $X)); a zero hit-rate denominator displays `—`. Line 1's duration takes `report.thisAiMs` (pure-AI
   convention) rather than the old line's watch durationMs (which includes in-session human waits), falling back to
   durationMs when there is no stats directory; the context segment keeps the old line verbatim. The dispatch-failure path returns early without printing (no session event occurred).
2. **Task three-state line** (runTaskLoop; done/blocked/incomplete all print):
   `✓ T-003 完成: 用时 24 分 31 秒(AI 18 分 12 秒[,其中本进程 6 分 12 秒]),会话 7 次` ("T-003 complete: duration 24m31s (AI 18m12s [, of which this process 6m12s]), 7 sessions")
   + the tokens line; "本进程" (this process) takes the wall-clock difference (same word, same meaning as the heartbeat line) and prints only when the formatted result ≠ the cumulative;
   blocked/incomplete use a ⏸ prefix with "阻塞/未完成" (blocked/incomplete) wording; on guard failure (statsId mismatch/not loaded)
   it falls back verbatim to the old copy `✓ … 完成(用时 …)` (complete, duration …).
3. **Phase close-out line** (at the end of handoverPhase, after commitTree, before return 0):
   `■ 阶段 t 测试 收口: 总用时 …(含规划/交接/提交;AI …[,人工等待 …]),任务 N 个 / 会话 N 次` ("phase t testing closed out: total duration ... (including planning/handover/commits; AI ... [, human wait ...]), N tasks / N sessions")
   + the tokens line; the human-wait segment prints only when waitMs > 0.
4. **Round-complete line** (the phased runPhaseLoop complete route / the unphased `✓ 全部任务已完成` (all tasks complete) spot):
   `■ 第 2 轮完成: 总用时 …(AI …[,人工等待 …]),阶段 6 / 任务 24 / 会话 96` ("round 2 complete: total duration ... (AI ... [, human wait ...]), 6 phases / 24 tasks / 96 sessions") + the tokens line;
   when `history.rounds > 0`, append a two-line indented past-round cumulative segment (`  历轮累计(N 轮): …` ("past-round cumulative (N rounds)") + `  历轮 tokens …` ("past-round tokens")),
   not merged into this round's numbers (merging would blur into cross-round weighted hit rates/costs and break the "this round" semantics); the unphased path omits
   the phase segment (the "m" pseudo-phase count is always 1, no information).
5. **Progress heartbeat** (every 10 minutes): `⏳ T-002 子任务进度 3/7,累计用时 24 分(本进程 8 分),预计剩余 32 分` ("T-002 subtask progress 3/7, cumulative duration 24m (this process 8m), est. 32m remaining");
   guard failure skips this heartbeat, with no in-memory since backstop (the heartbeat fires every 10 minutes; skipping one costs far less than
   a distorted convention); estimated remaining is linearly extrapolated on the cumulative convention.
6. **Startup resume banner** (when loadStats finds an existing document):
   `↻ 统计续接: 第 2 轮 / m 阶段 / T-003 已累计 18 分(AI 12 分),上次进程止于 12:03` ("stats resumed: round 2 / phase m / T-003 has accumulated 18m (AI 12m), last process stopped at 12:03");
   the snapshot is taken after depreciation and before round rollover (showing where the previous process stopped).

## G. Decision Log (summary of the in-code AUTO-DECISIONs; details in `docs/T-001/` through `docs/T-006/report.md`)

- **Depreciation likewise passes the MAX_TICK clamp** (`src/stats.ts:239` comment): an anomalous lastWriteAt (lenient parsing of a bad file)
  would, unclamped, inflate by hours in one shot; under the "better too little than too much" principle, clamping everything is safest.
- **now injection = the module-level replaceable clock setStatsClock** (`src/stats.ts:86` comment); the per-API
  now parameter was rejected (it would cut through all public APIs and wiring layers).
- **Depreciation does not enter per-session** (`src/stats.ts:239` comment): an open segment carries no sessionID, so there is nothing
  to attribute it to; better too little than too much.
- **tasks count = +1 on entering a different task id** (`src/stats.ts:449` comment); "count on completion" rejected.
- **statsId is kept in sync and does not trigger lazy loading** (`src/stats.ts:481` comment): guard reads must be side-effect-free.
- **statsSessionBegin does not persist** (`src/stats.ts:545` comment): the first heartbeat (≤30s) persists anyway,
  so kill -9 loss stays bounded by the heartbeat period; one extra disk write per session is not worth it.
- **The begin hook sits at "before prompt dispatch"** (T-003 report): it follows the planned hook; shapes without a paired begin, such as a subscribe failure,
  are backstopped by statsSessionEnd's defined semantics (thisAiMs=0, zero usage still recorded, sessions+1).
- **The finally backstop uses zero usage** (T-003 report): when watch throws, the local accumulator is unreachable; rescuing it would require
  hoisting the signature; better too little than too much.
- **watch() in fact has 7 return exits** (T-003 report): the plan's "8" was an earlier version; a one-by-one tally shows
  full coverage via snapshot, with no number forced (handleIdleTest's 5 returns are another type).
- **◉ line 1's duration takes report.thisAiMs** (comment near `src/attempt.ts:248`): to be comparable with the "累计" (cumulative)
  (session.aiMs) on the same line, they must share a base; the durationMs alternative would split conventions with that base.
- **Wait intervals pair waitEnd with try/finally (including exception paths)** (T-005 report): a rejected readline/
  an interactive throw must not leave a dangling wait segment.
- **waitBetweenTasks/askHuman exported for direct unit-test driving** (T-005 report): aligned with the subtaskProgressLine
  precedent; the wiring itself (dir pass-through, pairing) must have coverage.
- **The task line's "本进程" (this process) takes the wall-clock difference** (comment near `src/conclusion.ts:67`): the T-002 heartbeat line already established "本进程"
  as the wall-clock convention; the same word must mean the same thing across lines; the AI-subset reading was rejected.
- **Past-round cumulative on its own two lines, not merged** (`src/loop.ts` roundCompleteLines comment); **the human-wait segment
  prints only when waitMs > 0** (same style as omitting zero cost/reasoning items).
- **The cacheHit convention lives in the display-layer pure function formatCacheHit** rather than a statsTotals field (T-001 S04).

## H. Risks and Boundaries (the plan's six "Risks and Boundaries" items, written out one by one)

1. **kill -9 loss bound ≈ the 30s heartbeat period**: depreciation credits only up to lastWriteAt -- better too little than too much, never inflated.
2. **After a machine change or clearing `.auto/`, stats restart from the present**: stats.json is this machine's running footprint, not the source of truth;
   recovery correctness is unaffected (it takes part in no recovery decision of `.auto/progress.json`).
3. **Two concurrent runs in one directory are not supported**: the later write overwrites; it skews low and does not blow up; the same applies when `--server` points at someone else's instance.
   Accepted boundary; no lock file added.
4. **A manual rollback-rerun of the same task is indistinguishable from an interruption resume** → manual procedure: before a rerun,
   `rm .auto/stats.json` (zeroing means deleting the file).
5. **digest/fork prefixes are not double-billed**: the per-step-finish-part incremental convention avoids it naturally (the server-side
   assistantMessage.tokens is a last-step overwrite and session.tokens includes the fork-inherited prefix; neither can be
   summed directly; per-part deduplication by part.id is the only convention that neither double-counts nor misses).
6. **Zero damage to core invariants**: exit-code semantics (0/1/2/130), driver-exclusive writes, unified commits, independent adjudication
   without fork, switches not persisted -- all unaffected; every stats write failure is silent and never affects the flow.

## I. Implementation Steps (checklist; P1..P7 all complete)

| Step | Content | Landing spot | Status |
|---|---|---|---|
| P1 | Full stats.ts + log.ts formatter consolidation + test/stats.test.ts | T-001 (S01..S05) | ✅ 531 pass |
| P2 | Loop-lifecycle wiring (loadStats/banner/flushStats/statsPhase/statsTask) + trackSubtasks switched to cumulative | T-002 | ✅ 534 pass |
| P3 | Runner session boundaries (Watch.usage, step-finish accumulation, the 7 returns completed, begin/end/finally backstop) | T-003 | ✅ 539 pass |
| P4 | ◉ session-end line split into two lines + unconditional printing | T-004 | ✅ 543 pass |
| P5 | Deduct duration at the three wait points (step.ts/waitBetweenTasks/askHuman) | T-005 | ✅ 549 pass |
| P6 | Task three-state line / phase close-out line / round-complete line (including the past-round cumulative segment) | T-006 | ✅ 558 pass |
| P7 | Doc sync (this file, structure.md, behavior.md, README, AGENTS.md navigation) | T-007 | ✅ this task |

Manual smoke test (a credentialed environment, the `auto/` integration branch): kill -9 mid-subtask → rerun and check the resume banner and
"其中本进程" ("of which this process") ≠ cumulative; --wait-between without pressing Enter for 40s → those 40s go to waitMs, not total duration;
rm / corrupt stats.json → runs as usual.
