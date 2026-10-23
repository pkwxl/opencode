# 0117 — The single-session mode and the working-period window

Two rulings over the manual-driver suite's run modes (`prompts/run.md`, plans/0089's vocabulary): a
`mode: single <minutes>` phrase for platforms whose providers disallow child sessions entirely, and the
`window` mode re-ruled from a prohibited launch stretch (UTC, optional zone) to a working period (local
time, soft end). Prompt copy and its ratchet alone — no src change.

This ruling Derives: **P3** (completion never judged by self-report — the single mode's sharpest bend:
verification becomes self-verification, and the principle's compensation is stated in the prompt itself,
the close-out still keyed on mechanical checks over committed evidence rather than the worker's say-so,
the lost fresh eyes named in the report, and the default phase-boundary stop kept as the person's
review bracket), **P4** and **P20** (committing is the completion condition; in-flight work never
destroyed — the wall and the soft end share one discipline: stop new work, finish the step in flight,
settle the lanes, write the handoff, land the share, report — inside the gap below the platform's kill,
the committed share the recovery seam, never a mid-flight kill), **P10** (the byte-identical floor —
both changes are opt-in phrases; the unnamed run and, under `single`, every grammar, commit sequence
and state write stay byte-identical to the delegated run's), **P12** (fail loud — `parallel: <n>` with
`single` is a stop and report, never a silently ignored phrase) and **P13** (frozen additive-only
vocabularies — the window literal changes meaning and drops `[tz]`: a conscious lockstep, run.md, the
ratchet's pinned literals and this document in one change). Tier touched: **mechanism only** — the
manual suite's prompt copy and its ratchet; no principle change; the INDEX release cell stays open
until the next release event.

## Evidence

Two field facts, both from the suite's actual operating conditions:

1. **Providers that withhold the subagent facility.** The suite's design delegation rests entirely on
   the host's ability to launch child sessions (run.md's preflight check 5 stops without it — "the
   whole design rests on them"). Some providers disallow child sessions under certain circumstances
   (quota posture, plan tier, platform policy), which made the whole suite unusable there: the person
   could not run the round manually at all, although every other mechanism (the task units, the commit
   grammar, the close-out sequence) is plain files and git the session can operate directly.
2. **The prohibited window expressed the wrong thing.** 0089's `window` named when *not* to work
   (a blocked stretch, UTC by default). The recurring field need is the complement — name when *to*
   work (the provider's off-peak hours, the person's night) — and in the machine's own local time,
   which is what `date` returns and the person reads off their clock. A complement of a daily stretch
   is itself one stretch spanning midnight (`17:00–09:00`), so one range grammar covers both once
   midnight-spanning is stated.

## D1 — `mode: single <minutes>`: every role in the one session

The hand-over line's `mode: single <minutes>` names the provider-restricted shape: **no child session
of any role is ever launched**; the one session takes every role itself — master control, task, fix,
verification, handover, planning — reading each companion file as the rulebook of the role it
currently holds. The companions' worker rules bind unchanged (scope discipline, record markers,
terminator, lane protocol, handover document); only their *session-boundary* rules (a child's
`<session budget>`, a child's final reply) are read against the whole session. Preflight 5's stop is
carved accordingly: the facility is required *or* the phrase names its absence — "the whole design
rests on one of the two".

The invariant that makes the fold safe: **git is identical to the delegated run's**. One commit per
role share at each role boundary (a task's execution share when its work ends or hands over, a fix
round's share, the close-out's wrapup and done, the park commit), the same grammar, the same order,
the same state writes — "afterwards git cannot tell the two runs apart; what changes is who was in the
room." The share boundary is the *role* boundary, not the session end: each task's verification needs
its committed range and each new task its clean tree, so no uncommitted work heaps across tasks. A
`Status: continue` boundary mid-session (implement→test, a context pinch) lands its share and the
session continues from its own handoff — the same boundary the delegated run relaunches on; a task too
large for one share spans shares that way (the subtask pipeline never runs under `single` — its stage
children are child sessions).

## D2 — the wall: the one-hour child budget's whole-session replacement

`<minutes>` bounds the **whole session**, replacing the 60-minute child budget (which does not exist
here — there is no child prompt to fill). Sprint's arithmetic carried over: record the start time at
the first action; the wall is start + <minutes>, set below the platform's own kill of the session so
the gap between them is the wrap-up's room (a 3-hour kill → `single 175`). Runway gates role switches
exactly as sprint gates launches: a new task or fix round needs ≥10 minutes of runway, a verification,
handover or planning role ≥15.

The wrap-up discipline is the user-facing point of the mode: **the wall stops new work, never the
wrap-up** — finish the step in flight (never end with a lane process running: wait it out or kill it
deliberately with its log state recorded), write the handover document when mid-task
(`Status: continue`, the successor session's entry point), land the share, Finish with the resume
note; the landing, the handover document and the report complete inside the gap even past the wall,
the platform's kill the only hard line. "Never let the platform kill this session mid-flight" is the
mode's own completion criterion. Context is named the wall's twin scarce resource: when it fills, the
same cut (handoff, share, report) is taken voluntarily at any moment — the run's continuity rests on
the committed share, never on one session surviving.

## D3 — self-verification, and the P3 compensation

Steps 5–6's verification becomes self-verification: land the share first, then take run-verify's
checks over the committed range in the same session — the range grammar, the state files, the diff
against the acceptance, the terminator — and on pass perform its close-out exactly as written; on a
failed check, the gap list and the fix rounds (at most two, re-verifying after each) under run-fix's
rules. The verdict line's child-to-master channel is empty (no child, no other master) — the verdicts
record in the Finish report instead.

P3's bend is deliberate and disclosed in the prompt copy itself: the checks are mechanical over
committed evidence (not the worker's self-assessment — the close-out still runs the same inspection),
but the fresh pair of eyes is gone, and the prompt makes the session *name the loss honestly in the
report*: "the person's review is the independent check this mode does not have, and the default
phase-boundary stop is where it lands." The phase boundary stays a stop by default (0091) — under
`phases: all` + `single` the person has consciously chosen unattended self-verification (P2: their
bracket, their call to lift).

## D4 — composition, conflicts, restart

- `single` rides with `window` **alone** among the modes: the working period gates the session's own
  work starts exactly as it gates launches (no new role's work outside the period; an end arriving
  mid-task wraps up the wall's way). Never with `sprint` (the wall bounds time once) and never with
  `pace` (a wall-bounded run spends its runway on work, not on waiting — sprint's standing rationale,
  extended).
- `parallel: <n>` never rides with `single` — a wave needs child sessions; both phrases in one
  hand-over line are a stop and report (P12: never a silently ignored phrase). The Parallel waves
  section's "composes with every run mode" claim is corrected in the same change.
- The Phase transfer folds the same way: the handover document under run-handover's four sections and
  its close-out commits; an unplanned phase's PLAN formulate construction and execution under
  run-plan's rules, closed through the same self-verified task flow.
- Restart is the park/resume rules verbatim with one re-keying: the successor session takes the
  identified role up itself instead of relaunching it — same role from the last share commit, same
  continue context from the handoff (P6: re-derived from disk, nothing session-resident).
- One role at a time, always — the delegated run's one-writing-child-at-a-time held by one session's
  attention instead of the launch facility. The "Keep your own context small" discipline bends exactly
  one notch: the unit in flight's documents are the worker's reads; every other unit's stay
  pointer-only.

## D5 — the window re-ruled: the working period

`mode: window <HH:MM–HH:MM>` (times in this machine's local time; a range may span midnight —
`22:00–06:00` runs to six the next morning) names the **working period**: no new child session of any
role may be created **outside** it — the polarity of 0089's prohibited stretch is flipped, and the
`[tz]` suffix retires (local time is what `date` returns on the person's machine; a zone named was a
UTC default's patch, not a need).

- **Launches fit the runway the end leaves**: a task or fix child's `<session budget>` is the smaller
  of the default and the runway itself; a task or fix child launches only with ≥10 minutes of runway,
  a verification, handover or planning child only with ≥15 — sprint's numbers, applied to the clock
  instead of a wall.
- **The end is a soft deadline**: a child already running when the end arrives is never stopped for
  the clock (its own budget bounds it) and its share lands after; the wrap-up alone — land the ended
  child's share, do not relaunch a `Status: continue` handover, Finish with the resume note — may
  overrun it slightly. New work never starts past it.
- **Before the start** the same gate holds from the other side — no launch until the period opens:
  hold the session alive polling the clock (only sensible when the wait fits inside the platform's own
  session limit), or end and report that the person should restart at the start time, inside the
  working period.
- `pace`'s composition flips with the polarity: its waits apply **inside** the window (outside it no
  launch happens anyway) — the same token-burn throttle, now on the working stretches themselves.

## D6 — the ratchet lockstep (P13)

The window literal changed meaning and shape, which is a vocabulary change under P13's conscious
lockstep rule: `prompts/run.md`, the ratchet's pinned literals
(`test/manual-prompts-ratchet.test.ts` — the `[tz]` forms replaced, the working-period and
single-mode pins added, the 0089 test's comment corrected with the 0117 re-rule named) and this
document landed in the one change. No other surface reads the mode phrases (they are hand-over-line
vocabulary the person writes and run.md alone parses), so no src or shell change was needed; the
suite's file set is unchanged (no new companion — the single session reads the existing five as its
role rulebooks), leaving `install-prompts` untouched.

## Enactment notes

- All changes are in `prompts/run.md` (the intro's two carve-outs, preflight 5, the context-discipline
  exception, the budget paragraph's window fit and single carve-out, the Parallel waves composition
  sentence, the new "Single-session runs" section, the Run modes heading/list/bullets, the park/resume
  pointer, the Hands-off parenthetical) and the ratchet test; nothing in `src/`, no template touched.
- The companions (`run-task.md` etc.) are untouched by design: their worker rules bind the single
  session unchanged, and run.md's overlay section does the re-keying (session-boundary rules read
  against the whole session) — one home for the mode, no companion forks (P5).
- Indexed in plans/INDEX.md's post-baseline table with an open release cell; the suite's navigation
  line in AGENTS.md gains the pointer.
