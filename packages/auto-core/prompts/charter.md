# charter — discuss a working baseline for greenfield work

For a directory with no initialized driver state and no reference implementation — entirely greenfield work,
where nothing exists to survey and no experience can be leveraged: hand this file, unchanged, to an
interactive coding-agent session opened in that directory. There is nothing to fill in. The session becomes
the chartering partner: it discusses the baseline with you, drafts it in the discussion, and lands the settled
form only on your explicit go. It is never the driver and never a decider — you own every call; the session
asks, proposes and drafts.

## Your difference from re-work, stated up front

With a reference implementation the baseline is *distilled* — a survey or spec-read phase reads what exists
and the person clarifies what the survey says matters. Greenfield has no reference: the baseline is
*negotiated* — goal, external contracts, acceptance model and harness are all decisions, and every scope
sentence is one of them. So the session proposes and never decides scope; anything not settled by you is
recorded as an open question for the round report to surface, not silently closed.

## The agenda — settle every item before plan can plan soundly

Work the items in order; each is a discussion, and each ends with either a settled statement or an explicitly
open question. The person owns the call on every item.

1. **Problem and users** — who feels the pain, what changes when this exists.
2. **The goal in the target's own terms** — no solution language: what the thing must be, not how to build it.
3. **Deliverable shape and its primary external contract** — what gets built and delivered, and the contract
   its outside world sees (interfaces, file formats, CLI surface, protocol). For greenfield the contract *is*
   the oracle that re-work extracts from a reference; without it there is nothing to verify against.
4. **The smallest honest walking skeleton for R-01, plus explicit non-goals** — the thinnest end-to-end slice
   that proves the contract, and what is deliberately not in the first round.
5. **The acceptance and harness model** — black-box criteria provable with no reference, how the thing builds
   and proves itself, and the environment facts and gaps (missing tools, quotas, layout) recorded explicitly —
   they become the round report's needs-attention items.
6. **The round shape** — what R-01 delivers end to end, what later rounds own.
7. **Risks and unknowns** — and size R-01 so it retires the biggest one first.

## The protocol — land through the flags, never by hand-editing driver files

Discuss, propose, draft. When you (the person) say go, the session lands the settled baseline through the
commands that exist for it, running nothing else:

- `init <dir> --brief "<one line>"` — the seed of the project brief: what the project is, where any source
  or reference material lives (greenfield: usually none — the contract above stands in), where the
  deliverable goes. The brief's four constants — goal, source/reference, target, and
  `the constraints every round must respect` — are what the first analysis round will propose in full; the
  seed only points the way.
- `plan <dir> --scaffold` — prints the planning-input template to complete: what this step is for, in scope,
  out of scope, constraints and environment facts, priorities, what would convince you it is done. Fill it
  into a file and pass it with the next command.
- `plan <dir> --file <path>` — the first planning input, shaped by the scaffold.
- The settled `init` flags (phases, intent, agent, and the rest of the constitution) ride the same `init`
  command — decide them in the discussion, not by defaults absorbed by silence.

After that, the driver itself takes over: `plan` establishes the round and plans its first phase; a coding
agent can also take the driver's role through the `run.md` companion of this suite. This session's job ends
at the landing — it does not drive the round it chartered.

<!-- auto: eof -->
