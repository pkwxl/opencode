# Hibernate Window Design (avoiding LLM high-tariff hours)

Opened 2026-09-18; S1–S6 were implemented the same day (auto-core branch).

## Requirements

LLM services have high-tariff hours, so a mechanism is needed for the driver to pause its progress during a specified window: `OPENCODE_AUTO_HIBERNATE="04:00+6"` specifies a daily 6-hour hibernate starting at 04:00 UTC. When the hibernate time arrives, gracefully wait for the current task/subtask to run to a safe exit point (the `/exit` point) before pausing; once the hibernate window has passed, resume subsequent work after a further random delay of 0~600 seconds.

## Factual baseline

- Switch layer: `src/switches.ts` is the sole registry of all `OPENCODE_AUTO_*` switches (`SWITCH_ENV` constant + `Switches` type + `parseSwitches` pure function + memo); an illegal value throws a Chinese error; the CLI shell needs zero changes; nothing is written to disk or enters ProjectConfig (core invariant: "experimental switches are read from the environment only").
- Safe exit points: `src/exit.ts`/`src/step.ts` have already established three existing boundary abstractions (phase/task/subtask, `stepPause` + `maybeExit` hooks) — when one is hit, PLAN.md/CURRENT.md/.auto/progress.json have all been routinely finalized by the boundary itself, fully isomorphic to a real crash/kill interruption at that spot. The three sit respectively in `src/loop-task.ts` (after a task's final-state commit), `src/runner.ts` (after subtask checkboxes + the unified commit; review fixrun check items are covered by the same loop), and `src/loop-phase.ts` (after a phase handover completes).
- Waiting paradigm: long waits are wrapped in `statsWaitBegin(dir, reason)`/`statsWaitEnd(dir)` (wallMs/aiMs deducted, waitMs recorded separately); minute-scale `Bun.sleep` has existing precedent (`src/session.ts`'s retry ladder and awaitRecovery); during a wait, a double Ctrl+C force-quits (130) via the process-level SIGINT handler in `src/loop.ts`.
- No expiry surface: the driver has no lease/external heartbeat, so sleeping in-process for hours expires no state; in-chain session reuse (REUSE_IDLE_MS, 5 minutes) naturally degrades to opening a new session after a long pause — harmless.

## Decision table

| # | Topic | Decision | Rationale |
|---|---|---|---|
| D1 | Implementation | **in-process sleep**: at the boundary, detect in-window → `Bun.sleep` until the window ends + a random 0~600s → continue | matches the requirement literally; no external scheduler needed. The alternative (exit via ExitRequested + cron/systemd restart) does have design guarantees for exact resumption, but it requires users to set up a scheduler separately, violating the simple intent of "just configure a hibernate window" |
| D2 | Format | `HH:MM+H`: UTC, repeats daily, single window; H allows decimals (6.5 = 6h30m), H ∈ (0,24); HH ∈ 00..23, MM ∈ 00..59; crossing midnight (e.g. `22:00+8`) is naturally supported by the modulo in the window computation | minimal expressive power that covers the requirement; multiple windows are left as a future extension |
| D3 | Random delay | a fixed random 0~600 seconds after the window ends (`HIBERNATE_JITTER_MS`); the randomness source is injectable for unit tests | the value is given by the requirement; it staggers multiple instances waking at the same time |
| D4 | In-window at startup | check after preflight completes and before the server is brought up; if in-window, sleep straight through to the wake-up | avoids doing housekeeping and a first execution unit for nothing |
| D5 | Trigger semantics | the hooks only check "am I in-window right now"; the next unit is not predicted | when the current unit spans the window's start moment, it is naturally stopped at its ending boundary — precisely "gracefully wait for the safe exit point, then pause"; zero prediction logic |
| D6 | dryrun | the startup check and the boundary hooks are no-ops under dryrun (the precheck is not a money-burning path) | dryrun only does the permission precheck and passes through no task/subtask boundary; the startup check is skipped explicitly |
| D7 | Coverage granularity | hidden tasks (planPhase/handoverPhase distillation/k-phase extraction/advanceFinal appends) and the interior of verify's fixRound get no hooks | these units are minute-scale; fixrun repair check items go through the runner subtask loop and are already covered. Declared a known trade-off |
| D8 | Hook order | `stepPause` → `maybeExit` → `hibernatePause` | /exit answers human intent first; hibernation is the last, environmental constraint |
| D9 | No recheck after waking | sleep once, all the way through; after waking, the window is not rechecked | oversleeping due to system suspension only resumes later; the semantics still satisfy "continue after the hibernate window has passed"; the window judgment naturally takes effect again at the next boundary |

## Implementation

- `src/switches.ts`: `SWITCH_ENV.hibernate` + `Switches.hibernate: HibernateWindow | undefined` (default undefined = no hibernation, zero change from the status quo) + `parseHibernate` (regex `^(\d{1,2}):(\d{2})\+(\d+(?:\.\d+)?)$`; out-of-range throws a Chinese error) + `formatHibernate` (the canonical HH:MM+H form for logs/unit tests).
- `src/hibernate.ts` (new module): `hibernateSleepMs(window, now, random)` pure function (UTC same-day minute positioning, cross-midnight modulo, window start-inclusive/end-exclusive, plus the random delay) + `hibernatePause(label, opts)` hook (no-op when the switch is unset; the sleep interval wrapped in `statsWaitBegin(dir, "hibernate")`/`statsWaitEnd(dir)`; `now`/`random`/`sleep`/`window` injectable for unit tests).
- Wiring in four places: the task boundary in `src/loop-task.ts`, the subtask boundary in `src/runner.ts`, the phase boundary in `src/loop-phase.ts` (all after `maybeExit`), and `src/loop.ts` after preflight and before the server is brought up (skipped under dryrun).

## Checklist

- [x] S1: switches.ts switch parsing (type/default/parse/render/log registration)
- [x] S2: src/hibernate.ts new module (pure function + hook)
- [x] S3: wiring in four places (task/subtask/phase boundaries + the startup check)
- [x] S4: tests (test/switches.test.ts parsing and logging cases + test/hibernate.test.ts window-computation and hook cases; 864 all green)
- [x] S5: this document + package-level/root AGENTS.md navigation
- [x] S6: verification (`bun typecheck` clean, `bun test` all green; the `packages/auto` typecheck confirms zero shell changes)
