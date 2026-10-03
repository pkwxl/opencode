# Stuck Loop Detection Design

Status: implemented (2026-09-09). Detection runs on the driver side and hints are steered into the session; it is on by default,
can be turned off via an environment variable, with zero changes to the CLI shell.

## 1. Motivation

Weaker models show a stable class of failure: doing the same action over and over, failing each time, unable to walk out
of it on their own. Three typical scenes:

- the same edit repeatedly reports "String not found" (unaware that the file content differs from what it assumes);
- retrying after micro-tuning the parameters (one extra space, a different escaping), with the error message verbatim identical;
- repeatedly reading the same file, repeatedly running the same read-only command, the output completely identical, yet treated as new information for further reasoning.

None of the three self-heals: the context piles up the same failure, and the model's next round is more inclined to copy
the previous one. The driver is the only party that can see from outside that "you have already done this three times", so the driver detects it and proactively hints.

No existing mechanism covers this shape: the `--idle-time` watchdog only handles **no output** (a stuck loop produces
lively output), the context-handover steer only handles **usage-limit overrun** (a stuck loop often happens midway), and
silent-block detection rules only **after the session ends** (a stuck-loop session does not end).

## 2. Criteria

Scoped to the **session**, observe the terminal state (completed / error) of every tool call; two criteria:

| Criterion | Signature | Threshold |
|---|---|---|
| `error` same-error repeat | tool name + error text (**parameters excluded**) | 3 times |
| `repeat` same-args-same-result repeat | tool name + parameters + output text | 4 times |

- **The error criterion ignores parameters**: micro-tuned parameters still hitting the same pit is the most typical shape
  of a weak model, and a changed parameter must not be treated as a new attempt.
- **The same-args-same-result criterion requires exact sameness**: parameters and output both verbatim identical, so the
  call brought no new information. The threshold is one notch above the error criterion - occasionally re-reading the same file in a normal session is legitimate.
- **Any change in the result counts as progress**: a different error or different output is not counted, without guessing
  which changes qualify as "real progress" (the cost of guessing wrong is misjudgment).
- **Consecutiveness is not required**: alternating retries like `A,B,A,B,A` are equally stuck loops, recognizable simply
  by accumulating by signature; signature normalization (whitespace folding + lowercasing) absorbs formatting differences.
- Parameters are serialized sorted by key name, independent of writing order; long texts are compressed into short hash keys, so long sessions do not grow memory.

The thresholds and caps are exported constants of `src/stuck.ts` (`STUCK_ERROR_REPEAT` /
`STUCK_SAME_REPEAT` / `STUCK_MAX_HINTS`), injectable for unit tests.

## 3. Hints

On a hit, a hint is steered into that session via `session.promptAsync` (v2 prompts steer by default; it enters the
session at the next provider-turn boundary - exactly the moment the model is deciding "what to do next"); the copy
lives in `templates/prompts/stuck-hint.md` and escalates level by level:

| Level | Content |
|---|---|
| 1 | lay out the evidence (tool/parameters/error verbatim) + re-check the premises + switch to a different approach |
| 2 | require first writing out "the goal / what has been tried and where each attempt failed / what to switch to next", only then acting |
| 3 | stop retrying: mark the leftovers with `AUTO-FIXME: <原因与计划>` (reason and plan), report progress, then end the session |

At most 3 per session (`STUCK_MAX_HINTS`); on a hit that signature's count resets to zero - the hint fires again only
after another full round of hits, avoiding pestering every call once triggered. After the cap is reached, detection continues but stays silent.

## 4. Hint Only, No Shutdown

Detection **does not abort the session, change verdicts, or write any state file**. However sound, the criteria can still
misjudge (some tasks genuinely require repeatedly running the same command to wait for external state to change), and
the cost of a shutdown far exceeds one superfluous hint; the level-3 hint hands the "wrap-up" decision back to the
model, which writes out AUTO-FIXME and progress and then naturally ends the session, the existing pipeline (acceptance/review/fallback to pending) taking over. A failed steer delivery is only logged, not treated as a block.

## 5. Hooks and Switches

- Detector: `src/stuck.ts` (pure logic, no dependency on SDK types; one `createStuckTracker` instance per session).
- Observation point: `watch` in `src/runner.ts` - the terminal state of tool parts in `message.part.updated`
  events, with the same deduplication basis as the existing detail logs (by part.id, one call fed exactly once).
- Prompt: `renderStuckHint` (`src/prompt.ts`, data assembly only) + the `stuck-hint` template.
- Switch: `OPENCODE_AUTO_STUCK` (on|off, **default on**), registered in the OPENCODE_AUTO_* registry in
  `src/switches.ts` (parsed once, consistent across the whole pipeline, not persisted).
- **dryrun preflight sessions are never checked** (regardless of the switch): they probe the permission boundary by
  being repeatedly denied in the first place, so repeated errors are their normal shape.

## 6. Relation to Existing Mechanisms

- Independent of the context-handover steer (`OPENCODE_AUTO_STEER`): each counts on its own, and both can occur together.
- Orthogonal to the `--test-by-driver` test-execution protocol: the latter is about the driver running scripts on behalf
  of the session, the former is about repeated shapes of in-session tool calls; tests repeatedly failing while the script content changes will not hit this mechanism.
- Complementary to the `--handover-test` "more than 10 consecutive handovers" reminder (cross-session, task-level):
  this mechanism is in-session and action-level.
