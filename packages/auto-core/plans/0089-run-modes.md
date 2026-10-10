# 0089 — Run modes: window and sprint, chosen by one phrase in the hand-over

The working rulings, kept verbatim as the design record. Status: landed 2026-10-10.

## The problem

Two recurring person-directed ways to run the manual suite had no durable home: a launch window (no new
child sessions inside, say, 05:00–10:00 UTC — a quota or quiet-hours window) and a whole-run wall (the
ZCode idle-task kills its task after 3 hours; the run must terminate properly before the kill, not be
killed mid-flight with a broken child and no report). Both had been improvised as ad-hoc overlay prompts;
the person asked for a simple way to choose between them.

## The rulings

- **D1 — the chooser is one phrase in the hand-over line.** No second file, no fill-ins in run.md (its
  "handed unchanged, nothing to fill in" charter stands): the person writes `mode: window <HH:MM–HH:MM>
  [tz]` or `mode: sprint <minutes>` when handing the file over; no phrase = the unlimited classic run.
  The mode is part of the master control's charter (where it conflicts with the file's rules, the mode
  wins), and the run's closing report names the mode line so a restart repeats it.

- **D2 — window mode.** No new child session of any role inside the window (a clock check before every
  launch); a child already running when the window opens runs to its normal end — never stopped for the
  window. Blocked launches park: land the ended child's share, then either hold the session alive polling
  the clock (only sensible when the window outlives the platform's own session limit) or end the session
  with a restart-after-the-window note.

- **D3 — sprint mode.** No window — a wall for the whole run, set ~15 minutes below the platform's kill
  (a 3-hour task limit → `sprint 165`), measured from the master control's first action. Every launch
  fits the runway: a task/fix child's `<session budget>` is the smaller of the default and
  wall − now − 15 min (0086's budget machinery does the wrapping); verification, handover and planning
  children launch only with ≥15 min of runway. At the wall — or when a child overruns into the margin —
  land the last share, do not relaunch a `Status: continue` handover, Finish with the resume note. Ending
  properly before the wall is the sprint's own completion criterion.

- **D4 — shared park/resume, overriding the boundary refusal.** A parked run sits at a legal boundary
  (last share committed, tree clean except the transients, a report of what remains). On restart,
  uncommitted content means a child broke mid-session: the role from the task's last share commit
  (`T-NNN exec …` → task child, `T-NNN fix …` → fix child), the state from `handoff.md`'s `Status:` tail
  and `gaps.md`'s presence, the baseline re-derived as the parent of the first `T-NNN` share commit —
  then relaunch that role with one continue line, the suite's kill path. This consciously overrides
  run.md's "a task already began → stop and report" rule, which assumed a live master control; 0087's
  committed shares are what make the reconstruction mechanical. A parked phase transfer simply continues
  at the Phase transfer section.

- **D6 — pace mode (added in the same working session).** `mode: pace <minutes>` pauses between child
  sessions: after a child ends and its share is landed, wait <minutes> before the next launch of any role
  (the run's first launch goes immediately; a relaunch after a killed child waits too). The wait is the
  person's throttle against a rolling usage limit (a 5-hour account cap) — the master never computes
  quota, the figure is the knob. The wait itself survives the harness: short polled steps (`sleep 300`
  then `date`), never one long silent sleep. `pace` composes with sprint (`mode: sprint 165 pace 20`): the
  waits count inside the wall, and a wall arriving mid-wait ends the run properly — the unattended combo
  of the platform's task kill and the account's usage cap.

- **D7 — the ratchet pins the mode literals** (`mode: window …`, `mode: sprint …`, the `sprint 165`
  example, `mode: pace …`, the `sprint 165 pace 20` compound, and the baseline re-derivation rule) so
  drift is a conscious change.

## What is deliberately not done

- window+sprint stays undefined; `pace` composes with `sprint` only (the unattended combo: the platform's
  task kill plus the account's rolling usage cap).
- No persistence of the mode on disk — it lives in the hand-over line and the closing report; a restart
  repeats it because the person (or their restart prompt) names it again.
- The holding-alive option in window mode makes no promises against platform kills; where the platform
  kills on its own clock, ending the session is the sanctioned choice.
- No quota arithmetic: pace's figure is sized by the person against their own cap; the master control
  never estimates consumption.
