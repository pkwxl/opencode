# 0086 — Manual-suite session handover: the one-hour budget wall, the two-phase task shape, and the handoff channel

The working rulings, kept verbatim as the design record. Status: landed 2026-10-10.

## The problem

The manual-driver suite (`prompts/`, 0078) ran each task as one child session carrying
the whole task, with no continuation mechanism: a session lost to the harness (~10-minute
quiet kill), to infrastructure, or to a context swollen past usefulness left only a dirty
tree, and the master control's sole recovery was one blind relaunch with a feedback line.
Three directed upgrades (person session, 2026-10-10) plus the background adjustments
already in the working tree (survive-the-harness discipline, multi-repo baselines,
labeled launches, foreground-first with background relaunch) settle the design:

1. Task child sessions in implementing phases should split their work into two phases —
   implementation, then testing — with a handover at each phase boundary.
2. In the testing phase, each test type should get an independent handover when the test
   work is long (tests can be numerous and lengthy).
3. The master control sets a maximum running time per child session; the settled figure
   is one hour, and crossing the wall turns the handover on (no kill).

## The rulings

- **D1 — two channels, the driver's own names and shapes.** The verification gap list
  stays `docs/T-NNN/gaps.md` (0083 D3; verifier-written, no terminator — its last body
  line is its last entry). The session handover is `docs/T-NNN/handoff.md`: worker-written
  (task and fix children), its last body line the driver's own status protocol
  `Status: continue|done`, no `<!-- auto: eof -->` terminator — the status line is its
  shape (mirroring src/docpaths.ts `handoffFile` and the handoff role's shape check).
  The working tree's wholesale rename of gaps.md to handoff.md is reversed: it collided
  with the driver's vocabulary (handoff.md already means the worker continuation channel)
  and failed the ratchet's converged-channel case.

- **D2 — the handover triggers.** A task session hands over (a) at the
  implementation→testing boundary — code tasks run as two phases, implement first
  (self-checked), then test; (b) between test types inside the testing phase when the
  remaining test work is long (numerous or slow suites), the handover recording which
  types are done and which remain; (c) at the budget wall: `<session budget>` per child
  session, `60 minutes` by default (the person may direct another figure), with winddown
  ten minutes before — stop starting new work, finish the step in flight, write the
  handover, end. Never overrun silently; a session that needs more time hands over. Fix
  children hand over on the budget wall the same way (progress + open gap entries +
  `Status: continue`); verification children never hand over — their verdict plus
  close-out is atomic, and the harness-kill relaunch path covers the pathological case.

- **D3 — the master control stays mechanical.** It tails the handover's last body line
  the way it already tails `report.md`'s `Result:` line — a tail is a check, not a read;
  the never-read-a-handover context rule stands. The loop's task branch: `Status:
  continue` → relaunch the task child (fresh budget; the successor reads the handoff
  itself); `Status: done` or no document → verification. An invalid handover (missing
  status line) gets one relaunch with the driver's own re-prompt wording
  (src/execute.ts:182's shape), then stop and report. The zero-write check counts the
  handover document as a write. Bounds against unattended loops: more than ten
  task-child sessions per task, or more than three fix sessions per fix round → stop
  and report.

- **D4 — foreground is advisory, background is enforced.** A foreground (synchronous)
  subagent call cannot be stopped mid-flight, so the budget rides inside the child
  prompt as a self-limiting instruction (the core's own model: its usage walls are
  communicated to the session, with the hard wall last). A background child that runs
  past its budget without ending is stopped and relaunched with the continue line —
  the same path as a harness kill; the survive-the-harness checkpointing makes the
  stopped session's tree recoverable, and children never commit, so a stop cannot
  damage history.

- **D5 — close-out clears both transient channels** (`gaps.md` and `handoff.md`),
  mirroring the driver's own completion (src/execute.ts removes the handoff at stage
  end; src/close.ts removes handoff and gaps together). The verification's eof check
  exempts the handover document (its shape is its status line), as the core's
  `eofScanExempt` does. Final-state equivalence stands: the suite still lands exactly
  the commits and state writes the driver itself would make; both channels are deleted
  before the work commit. A bonus of the driver's own format: a manual-suite run
  interrupted mid-continuation leaves a `handoff.md` the driver's own resume machinery
  (src/execute.ts resume-after-interruption) understands.

- **D6 — the ratchet reversal is pinned, not just permitted.** 0078 §3's other half
  ("no worker prompt carries a Status protocol — handoff.md deliberately not offered")
  is reversed consciously: the ratchet case now pins the handoff path and the
  `Status: continue` / `Status: done` / `<session budget>` literals as present in
  run-task/run-fix, the close-out's dual deletion, `60 minutes` in run.md, and the
  boundary (run-verify and the subtask pipeline / charter stay outside the channel).
  Reversing again means updating that test together with this document.

## What is deliberately not done

- No config key for the budget (config is driver-owned; the suite's preflight refuses
  to write it) — the figure is conversational, person-directed, defaulted in run.md.
- The subtask pipeline (`run-as-subtasks.md` / `resume-subtasks.md`) keeps its own
  handover-free loop; its Stage 1–3 children were not in scope.
- The per-test-type cadence stays conditional (D2b) rather than mandatory: small suites
  finish in one session, and the budget wall bounds the long ones anyway.
