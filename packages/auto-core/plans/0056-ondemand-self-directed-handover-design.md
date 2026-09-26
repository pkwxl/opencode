# 0056 — Ondemand self-directed session handover (OPENCODE_AUTO_STEER on by default)

Status: **implemented** (2026-09-26). Request: `--subtask ondemand` was effectively `--subtask off` because `OPENCODE_AUTO_STEER` defaulted to off, disabling the whole handover mechanism. Make it on by default and turn ondemand into the token-optimization path for too-large contexts — but the trigger must not be a fixed threshold that interrupts the session mid-thought: the session should decide when to hand over, informed by the driver rather than interrupted by it.

## 1. Fact baseline

- **F1 — the loop already existed, dormant.** The driver already measures a live session's context per completed assistant message (`AgentMessage.contextUsed`, `src/usage.ts` usageSource; watch logs `context: X/Y tokens (Z%)`), can steer text into the running session (`promptAsync`), and `executeWhole` already had the handoff.md (`Status: continue|done`) → commit → fresh continuation-session loop. With the switch off, `handoffSteer` returned `undefined` and both the in-turn hint and the post-session check (`sessionHandoverDue` requires a steer) were dead — hence ondemand ≈ off.
- **F2 — the fixed-threshold hint interrupts at an arbitrary point.** The old design fired the wind-down order at exactly 2×cap, whenever that measurement happened to land — mid-edit, mid-reasoning. A handover forced at a bad boundary makes the continuation reload the same files to re-derive what it was doing, paying the token cost the mechanism exists to save.
- **F3 — the session cannot see its own usage.** The model has no accurate figure for its context occupancy; the driver does. Any session-driven timing needs the driver to feed the figures in.
- **F4 — the budget can exceed the model's window.** With the default cap (64k → wall 128k) on a 128k-window model, a wall-ordered wind-down would overflow while writing the handover document. The window is known at the measurement point (`client.contextLimits()`).
- **F5 — the auto-mode subtask wiring shared the switch.** `runSubtask` built the same steer (execute.ts); subtask sessions are small by decomposition, and the operator asked for ondemand as *the* context-management mode. Per the decision taken in planning, subtask sessions stop handing over altogether.

## 2. Decisions

- **D1 — the switch default flips to on; the mechanism becomes ondemand-only.**
  - `SWITCH_DEFAULTS.steer = true` (src/switches.ts). `nonDefaultSwitches`/`formatSwitches` compare against the defaults, so `OPENCODE_AUTO_STEER=off` becomes the logged non-default item; capability degradation (an agent without mid-turn messages) still forces it off with the existing note.
  - `runSubtask` no longer builds a steer and its post-session handover block is removed (D5 of the plan); subtask.md's driver-notice clause is retired with it. The interruption-recovery seeding that reads a leftover subtask handoff document stays (it only ever sees documents from runs of earlier releases), as does the close-out cleanup of such leftovers. A subtask session over the cap now runs into the provider-side compression / cap errors and the existing session-error retry path.
  - `--subtask off` never builds a steer — unchanged. `OPENCODE_AUTO_STEER=off` restores the old behavior exactly: no notices, no hint, no post-session handover check, and a spontaneously written handoff document ignored.
- **D2 — three layers, all switch-gated.**
  1. *Usage notices (driver → session, informational).* At the watch measurement point, when usage crosses 50% and then 85% of the effective wall, a one-line `[DRIVER] context: {{used}} … ({{pct}}% …, wall {{wall}})` notice is steered in, once per band (`Steer.notes`, `fillUsageNote` fills the figure slots at send time — the figures do not exist at render time, so the templates round-trip them as literal placeholders guarded as tier-1 markers). The 50% band says "keep working, structure the rest so it could be handed over at a natural boundary"; the 85% band advises winding down at the next natural boundary (and explicitly allows finishing first when the task is nearly done).
  2. *Self-directed handover (session → driver).* The whole-task prompt (`whole.md`, `{{#if budget}}` — rendered only while the steer is built) states the notice protocol and delegates the timing to the session. The post-session check becomes **document-authoritative**: a *fresh* handoff document (differing from the text the dispatch was seeded with — `consumed`) is honored whatever the usage figure; `Status: continue` → commit + continuation session, `Status: done` → complete. A document the session did not touch, with no wall hit and no hint, means a natural finish.
  3. *Hard wall (last resort).* The old forced hint, retuned as such, now at the effective wall `min(2×cap, 80% of the model's window)` (`steerWall`, recomputed per measurement so a mid-session model step-up widens it). One steer per measurement point: a jump crossing bands and the wall sends the wall hint only and spends the bands; notices never suppress the context step-up check, the wall hint still owns its measurement point.
- **D3 — the handover document's job is spelled out: no context reloading.** Both the wind-down notice and the hard-wall text instruct the session to record the progress, key decisions, verified facts and file paths, dead ends, and next steps — what the continuation needs so it does not re-read what was already read (F2's cost). The continuation prompt's opening sentence now says "ended with a context-budget handover" instead of "interrupted by the context limit".

## 3. Behavior matrix

| run | handover behavior |
|---|---|
| `--subtask ondemand`, switch on (default) | notices at 50%/85% of the wall; session-decided handoff honored any time; forced wind-down only at the wall |
| `--subtask ondemand`, `OPENCODE_AUTO_STEER=off` | single session to natural completion; a written document is ignored |
| `--subtask auto` (default mode) | subtask sessions never hand over (wiring removed); overflow takes the error/retry path |
| `--subtask off` | unchanged — no protocol, no steer |
| agent without mid-turn steer | degrade forces the switch off at run start (existing note) |
| usage tier `reported`/`none` | no live figure — no notices, no in-turn hint; a written document is still honored (ondemand) |

## 4. Touch points

src/switches.ts (default, comment), src/testrun.ts (`Steer.notes`, `handoffSteer`, `fillUsageNote`, `steerWall`), src/watch.ts (wall + band logic at the measurement point, `noteSent`), src/execute.ts (`executeWhole`'s `consumed`/fresh-document gate, `budget` prompt flag; `runSubtask` wiring removal), src/prompt.ts (`renderUsageNoteInfo`/`renderUsageNoteWinddown`, `renderWhole`'s `budget`), src/template.ts (registry + tier-1 markers), templates/prompts/{usage-note-info,usage-note-winddown}.md (new), whole.md / handoff-steer.md / subtask.md (copy), tests (switches / testrun / agent-fake usage-tier band cases / execute-handover / golden `whole-budget` + the two notices), docs/glossary.md (session handover), AGENTS.md (navigation line).

The post-session *figure* rule is unchanged (`sessionHandoverDue`: hinted OR the final figure over `steer.limit` = the raw 2×cap budget); the wall clamp lives only in the in-turn hint, so the check keeps its pre-0056 semantics.
