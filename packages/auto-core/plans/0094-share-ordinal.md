# 0094 — The share ordinal: a share landed at a handover numbers itself

The working rulings, kept verbatim as the design record. Status: landed 2026-10-11. Amends 0087's
share-commit grammar; 0087's trailers, stages and landing procedure stand unchanged.

## The problem

A multi-session task lands several share commits with one identical subject — dm-glm's T-085 landed
eight `T-085 exec K3 snapshot family (batch B16)` commits in a row. The log cannot say which share was
which session; only the handoff document (a transient, deleted at close-out) numbered them, and only
while it lived. The master control knows the count all along — it counts sessions for the ten-session
cap and lands every share itself.

## The rulings

- **D1 — the ordinal rides the share subject when the session handed over.** A share landed while
  `docs/T-NNN/handoff.md` exists (the session ended by handing over) carries the share ordinal in its
  subject: `<task id> exec <task title> [<k>]`, and for a fix round `<task id> fix <round> <task
  title> [<k>]`. A share landed without a handover document carries no ordinal — the condition is the
  document's presence at landing time. The title truncates so the subject, ordinal included, stays
  within 100 characters.

- **D2 — the ordinal is the share's own count.** `<k>` is one past the number of the unit's landed
  shares of the same role and round — the task's exec shares for an exec share, the round's fix
  shares for a fix share. A live master control counts its own landings; a restarted one derives the
  same figure from the log, so the ordinal needs no state beyond the commits themselves. It numbers
  shares, not launches: a killed session lands nothing, and its successor's absorbed share takes the
  next number.

- **D3 — the range checks accept it.** run-verify's check 1 and run.md's own PASS check name the
  grammar with the optional ` [<k>]` tail. The automated driver's commit grammar is untouched (its
  subjects come from src/execute.ts; the ratchet's shared literals — trailers and stages — are
  unchanged).

- **D4 — the ratchet pins the ordinal literals** (both subject forms and the verification's
  acceptance), so drift stays a conscious change.

## What is deliberately not done

- No ordinal on the close-out commits (wrapup/done) — each lands exactly once per unit; there is
  nothing to distinguish.
- No change to the handoff document's own numbering — the child's session heading is its own affair;
  the ordinal numbers shares, which is what the log keeps.
- No automated-driver change: its units.json already tracks attempts per unit, and a subject change
  there is its own conscious decision.
