# 0078 — Manual-driver prompt consistency

Status: **executed, 2026-10-04.** One unit, prompt-copy plus a ratchet. The subject is
`prompts/` — the manual-driver suite (created 2026-09-29, rewritten 2026-10-02): runbooks a
coding-agent session uses to run as the driver itself, its child sessions as workers.
Role model: `run.md` (the master control) and the `run-verify.md` close-out are
**driver-role** — they own the driver-exclusive writes and the commit grammar; `run-task.md`,
`run-fix.md` and the Stage 1–3 child prompts are **workers** — no commits, no state writes.

## 1. The drift

The suite's stated goal is that "the state files and git history afterwards look exactly as
if the driver had run" — but it had drifted from the driver on four axes (found against the
sources, not the docs):

1. **Close-out commit grammar**: the suite's close-out was two commits ending
   `T-NNN carryover driver-state posting` / `Auto-Stage: carryover`, and folded the wrap-up
   report into the work commit. The driver's sequence is three commits — `T-NNN exec <title>`
   (`src/execute.ts`), `T-NNN wrapup <title>` (`src/wrapup.ts`, the report committed
   separately), `T-NNN done <title>` (`src/loop-task.ts`, the rename+tick settle). The
   carryover subject is only the self-heal string for uncommitted driver-state leftovers
   (`src/git.ts` beginUnit) — resume-subtasks' reconstruction of exactly those leftovers is
   the one place the suite legitimately keeps it.
2. **0075's `Decompose:` field** was unknown to `plan-append.md`, whose driver counterpart
   (`plan --append` → `phase-append.md` + the `task-decompose` partial) now carries the duty.
3. **0077's measured rewrite** reworded the worker-side rules the suite had hand-inlined
   (question-rule's record duty, digest-rule, ground-state, the result-line protocol) — the
   copies lagged.
4. **`testByDriver`/`handoverTest`** config keys were silently ignored; the suite has no
   driver process to run the test script or relay its result.

## 2. The rulings (the person, 2026-10-04)

1. **No context-budget handover protocol** in the worker prompts — the suite stays minimal;
   `docs/T-NNN/handoff.md` remains this suite's verification gap-list channel (see §3).
2. **Test-protocol keys → preflight refusal**, not silent ignoring, not manual
   reimplementation: the three run files stop at preflight when either key is set.
3. **`run.md` ignores the `Decompose:` field** at execution (it stays the whole-task suite);
   `plan-append.md` still learns to write the field, matching the real append planner.
4. **Ratchet + docs**: a drift ratchet pinning the suite's protocol literals to the driver's
   own, plus the AGENTS.md navigation line and the `docs/structure.md` row this document
   completes.

## 3. Deliberate divergences (pinned, not accidental)

- `docs/T-NNN/handoff.md` is the verification gap list here, where the driver uses that path
  for the context-budget handover ending `Status: continue|done` (`src/docpaths.ts`
  `handoffFile`). Ruled acceptable: the gap list is transient (deleted at the verify
  close-out), and the manual suite offers no handover protocol, so the two uses never
  coexist inside the suite. The ratchet pins the absence of any `Status:` protocol in
  run-task/run-fix so the divergence stays single-sided.
- The verification child is driver-role and performs the close-out commits itself — the
  manual analog of the driver's mechanical completion checks (the same set `adoptUnit`
  validates: state files untouched, non-zero diff, eof terminators, P1 scan). Elsewhere in
  the product no session ever commits; here the session **is** the driver.

## 4. What changed

- `prompts/run-verify.md` — the close-out is the driver's sequence: delete the stale gap
  list → work commit (`execute`) → report + its commit (`wrapup`) → state writes + their
  commit (`done`); the result line carries `wrapup.md`'s protocol wording.
- `prompts/run.md` — the PASS check verifies exactly that commit sequence (three commits
  under WRITE, two under SKIP); preflight refuses `testByDriver`/`handoverTest`; the intro
  no longer names a carryover commit.
- `prompts/run-as-subtasks.md` / `prompts/resume-subtasks.md` (lockstep) — preflight
  refusal; Stage 3's close-out commit is `T-NNN done <task title>` / `Auto-Stage: done`;
  the Stage 1 child prompt gains the digest-rule discipline and the record duty; Stage 2's
  ground-state notes the ticks are driver-maintained; the record duty and result-line
  wording align with the 0077 partials. resume-subtasks keeps `carryover` in its
  reconstruction section only (the self-heal's own case, now named in its stage list too).
- `prompts/run-task.md` / `prompts/run-fix.md` — the record duty verbatim from
  question-rule's unattended branch.
- `prompts/plan-append.md` — the optional `Decompose:` field in the task-document skeleton
  and the weighing duty (split/whole/pipeline, omit for no opinion, protocol strings
  verbatim, any other value rejected at load).
- `test/manual-prompts-ratchet.test.ts` — the ratchet: the src anti-rot arm (the producing
  code still states the commit grammar the table claims) and the prompts arm (the files
  carry the subjects, stages, trailers, verdict/marker/result strings, the P1 list, the
  `Decompose:` field, the preflight refusal, and the pinned file set of exactly seven);
  the ruled divergences of §3 pinned as explicit absence.
- `AGENTS.md` — one navigation line for the suite; `docs/structure.md` — the layout-tree
  entry and the intent-section row.

## 5. Maintenance

The suite is prompt copy like `templates/prompts/`, but a separate carrier with no renderer
assembling it — the ratchet is what binds it. Changing a driver protocol string (a commit
subject or stage, a verdict or marker) fails the ratchet until `prompts/` changes with it;
reversing a §3 ruling means changing the pinned-absence test together with this document.
No goldens are involved (nothing renders these files).
