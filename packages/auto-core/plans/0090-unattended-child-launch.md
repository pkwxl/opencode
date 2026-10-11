# 0090 — The unattended launch policy: background-first, the forced-foreground relaunch

The working rulings, kept verbatim as the design record. Status: landed 2026-10-10.

## The problem

An idle-task session — sprint mode's native host — forces every child session through the foreground
subagent facility, and its harness kills a session that sits ~10 minutes without activity. run.md's
launching bullet already named the foreground quiet-kill trade and answered it with the companions'
survival discipline plus one fallback: a killed child is relaunched through the platform's background
facility, which has no inactivity kill. The idle-task host breaks that fallback's assumption — there is
no background facility to fall back to — and voids the foreground preference's own reason: nobody is
present to watch the transcript.

## The rulings

- **D1 — an unattended run prefers background when the host has both.** A sprint mode or an idle-task
  session launches children through the background facility first: the foreground transcript's
  inspectability pays only when the person is watching, and a background child cannot be quiet-killed.
  The foreground preference stands for attended runs unchanged.

- **D2 — the forced-foreground host relaunches foreground, with the nudge folded into the continue
  line.** When the host has no background facility, a killed child's relaunch is foreground again: the
  same one-line feedback to continue on the dirty tree it left, plus the quiet-child nudge ("poll your
  log in short steps — never sit waiting on a long command") as its one addition. The companions'
  polling discipline (run-task constraint 5, run-fix constraint 7 — the ten-minute kill line, stated
  unconditionally) remains the child's only shield; no mode-specific wording enters the companions.

- **D3 — a repeat kill is accepted, bounded by the wall.** A child whose work pattern makes silence
  unavoidable can be killed repeatedly; retries stay budget-exempt (0087's rule), no kill-counter
  machinery is added, and the sprint wall bounds the loop — the run ends properly with the shares
  landed. In an unlimited run the person's presence is the bound.

- **D4 — the verification child gets no survival constraint.** run-verify re-runs none of the
  executable checks and reads diffs and documents — no ten-minute-quiet stretch is part of its shape.

- **D5 — the ratchet pins the policy literals** (the background-first preference, the
  no-background-facility tolerance, the forced-foreground fact, the nudge wording) so drift is a
  conscious change.

## What is deliberately not done

- No per-launch host interrogation: the policy keys on attendance (a sprint mode named, or the host's
  own facility set), not on a new configuration surface.
- No change to the sprint bullet: the launch policy has one home, the launching bullet, and governs
  every mode.
- Nothing in the companions changes — their survival constraints were already unconditional.
