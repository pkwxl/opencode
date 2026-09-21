# 0040 Capability degradation (MA.4): every missing flag lands on an existing fallback

> Milestone MA.4 of `plans/AUTO_NEXT_REFACTOR_PLAN.md` (root). Wires the
> `AgentCapabilities` record frozen in MA.1 (`plans/0037` D8) into the driver,
> and amends the frozen interface a second time (0031 D4 path). It also takes
> one of the two items MA.3 carried forward (`plans/0039` §5). A
> stage-assisting document per D6: it retires as history once MA closes.

## 1. Scope

1. **Run-start clamp.** `src/capability.ts` `degrade(caps, switches, opts)`
   maps each missing flag onto the "off" side of an experiment switch. loop.ts
   applies it right after the host starts, before the first session, and
   logs one `⚙` line per degradation.
2. **Helper guards** for the paths that no switch governs. Each guard sits
   where the fallback already lives.
3. **Permission preset.** `--permission` becomes a `PermissionPreset` that is
   handed to the host factory. Only agents without permission events use it.
4. **Agent profile.** `setShellProfile` gets an `agent: { name, host }` field.
   A shell selects its coding agent there. When the field is absent, the
   built-in opencode adapter is used.
5. **Carried-over fix.** The post-session handover check now also reads
   "was the hint sent" (0038 §6 latent, 0039 §5).

## 2. Degradation table (per flag)

| Flag off | Before MA.4 | After | Existing fallback reused |
|---|---|---|---|
| `resume` | never read | `REUSE_SESSION` and `FORK` forced off. `sessionAlive` returns false. attempt neither reuses nor resumes the chain's session | "session gone" → new session (recovery, base reuse, forks from a stored id) |
| `fork: "none"` | never read | `FORK` forced off. `forkSession` returns undefined without a request | fork failure → new session + full prompt |
| `fork: "session"` | never read | `forkSession` drops the message anchor | seedPinFork's "anchor gone → whole-session fork" |
| `steer` | never read | `STEER` and `STUCK` forced off. No length resume. `--interactive` discards typed lines | steer=off (no hint, natural finish accepted); stuck=off; `LENGTH_CONTINUE_MAX` exhausted |
| `steer` + `--test-by-driver` | — | **startup error, exit 1** | none (see D3) |
| `question` | never read | `ASK` forced off | the ask=off tier (decide autonomously, label AUTO-RESOLVE) |
| `permission` | never read | `--permission` → preset fixed at host start | the no-answer outcome of each mode |
| `history` | never read | `sessionUsage` → unknown (`pct 100`). `sessionUsed` → undefined. The pin fork skips the anchor lookup | failed `messages()` read; 0038 G1 (unknown base → cold start) |
| `abort` | never read | unchanged | every abort is already best-effort |

The usage tier is the MA.2 matrix (`src/usage.ts`) and is not repeated here.

## 3. Decisions

| # | Decision | Content |
|---|---|---|
| D1 | Degrade through the switches, once | Most flags already have a switch whose "off" path is the fallback (`OPENCODE_AUTO_FORK`, `_REUSE_SESSION`, `_STEER`, `_STUCK`, `_ASK`). The run start forces those off with `clampSwitches`, which mutates the memoized switches in place, so every holder of `autoSwitches()` sees the value in force. The alternative was a capability check at every consumer. It was rejected: `ask` alone is read by 25 render exits through `renderPrompt` (0020 §E), and a per-site check would silently miss the next template. Nothing is persisted, so the switch invariant (env only, this run only) holds. |
| D2 | Guards where no switch reaches | Retry, failover, shape-check and pin forks do not go through the fork switch. Recovery does not go through the reuse switch. Length resume is not steer-switched. Each gets one guard in the helper that owns its fallback: `forkSession`, `sessionAlive`, `sessionUsage` / `sessionUsed`, attempt's `resumable`, watch's length branch, interactive send, and the seedPinFork anchor lookup. Each guard only turns a request into the result the helper already returns on failure. |
| D3 | `--test-by-driver` without steer is refused | The driver sends the test results, the wrapup request and the handover backfill back into the live session, and nothing else carries them. Unlike every other row there is no degraded mode, so the run stops at start (exit 1, environment error). It does not fail halfway through a unit. `--test-by-driver` is constitutional (init-fixed), so the message says to re-init. The dryrun preflight is exempt because it never tests. |
| D4 | Permission preset = each mode's no-answer outcome | Without permission events no human can be asked, so each mode resolves the way it does when `--wait-answer` times out: `auto-allow` / `ask-allow` → `allow`, `ask-deny` (the default) → `deny`, `ask-fail` → `block`. `block` is the "blocked tier" of the plan entry: the adapter refuses the request and ends the turn with a non-retryable error, so the run blocks as `ask-fail` does. The dryrun preflight maps to `deny`, as it denies and records. The preset is computed before the host starts because it is a host option, and it is logged once the capabilities show it applies. |
| D5 | Agent profile carries the host factory | The plan entry asked for "`setShellProfile` extended to carry the agent profile". The profile gets `agent: { name, host: AgentHostFactory }`, optional. Absent means `opencodeHost` (a one-line wrapper over `manage`), which keeps every existing shell byte-equal: no `◇ agent:` line, same host. Capabilities are not declared in the profile. They come from `host.client.capabilities`, so a profile cannot claim what its adapter cannot do. `opts.managed` still takes precedence (shell-held handles). |
| D6 | Hint sent ORed into the post-session check | Under `events`, `sessionHandoverDue` read only the final figure. A session that compacted after the hint could end below 2·cap with a written `状态: 继续` handover and was taken as a natural finish (0038 §6). watch now reports `hinted` on its snapshot. attempt copies it to `chain.hinted` on promotion and restores it with the rest of the chain on a retryable failure. `sessionHandoverDue(tier, steer, used, hinted)` is due when `hinted` is set **or** the figure rule holds. The OR keeps every previous "due" (for example a session recovered after a restart, where the flag is lost but the figure is not). It only adds the compacted case. |
| D7 | Interface amended, second time | `PermissionPreset`, `AgentHostOptions` (`server?`, `permission`, `log`) and `AgentHostFactory` move into `agent/types.ts`, because adapters consume them and a domain file may not import the driver (rule 6). `AgentCapabilities` and `AgentClient` are unchanged. |

## 4. Observable deltas

- opencode (all flags on) degrades nothing. `degrade` returns no patch and no
  notes, so run start, logs and behavior are unchanged (tested).
- New log lines appear only for a degraded agent: `◇ agent: <name>` (profile
  set), `⚙ …` notes, `↻ base usage unknown; not forking (cold start)`,
  `(usage unknown)` in the base-ready lines, and `▷ the agent cannot resume
  sessions; starting a new session`.
- D6 changes behavior only in the compacted-after-hint case described above.

## 5. Not done here

- **U7 "has output" (0038 §6):** deferred to MA.5. It only matters under
  `estimated`, and it needs watch to report produced output next to `used`.
  0039 §5 already deferred the other estimated-tier inputs (inherited start,
  initial prompt) to the first estimated adapter, and U7 goes with them.
- **Agent-specific wording** that still says opencode: the contract path
  `.opencode/agent/<name>.md` in `missingAgentHint` and in the preflight, and
  "opencode.json permission rules" in the ask-fail message. These belong to
  the contract surface, which is open question 7 and in MA.5 scope. The
  profile's `name` is the place to hang them.
- **Adapter-side preset semantics.** No adapter reads the preset yet (opencode
  has permission events). MA.5 maps it onto claude's permission mode and
  checks that `block` surfaces as a non-retryable session error.
- **`abort` off** has no degradation. Early settlement on quota errors
  aborts before forking so the turns do not run concurrently. An agent that
  cannot abort would leave its old turn running. For a subprocess adapter,
  abort is killing the process, so MA.5 is expected to report `abort: true`.

## 6. Verification

- `test/capability.test.ts` (16 cases): `degrade` for opencode (empty),
  a headless-like profile, switches already off, fork/resume rows, the
  `--test-by-driver` error with the dryrun exemption; `permissionPreset`
  table; helper guards (fork none → no request, fork session → anchor
  dropped, no resume → not alive without a request, no history → unknown usage
  with no request and a cold-start fork base, pin fork without anchor lookup);
  driving (no steer → no length resume, no resume → new session despite the
  resume note, hint sent → `chain.hinted` and the OR rule, no hint → reset);
  `runAll` with a profile factory (options and preset delivered, notes logged,
  `--test-by-driver` gap → exit 1 before any session, host closed).
- Import direction: `capability` classified as driver (no table edits
  otherwise; `shell` imports only `agent/types`).
- auto-core 1003 pass / 0 fail (987 + 16) and typecheck clean.
  `packages/auto`: 52 pass + 2 skip, typecheck clean.
