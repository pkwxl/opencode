# 0055 — Model registry, reasoning tiers and multi-agent routing (design)

Status: **design, ruled** (2026-09-25; revised the same day with the follow-up requirements, §0 items 9–13, and every point of §11 ruled the same day). Step S0 is done (§13); S1 has begun with the window module `src/model-window.ts` (§4.4) and the registry loader `src/models.ts` (§4.1–§4.3). Source: the user's request of 2026-09-25 and its follow-up (§0). §11 lists the points for ruling, all ruled on 2026-09-25. Line numbers are as of auto-core `3ba1eb39c`; search by symbol if they drift. A constraint from the same day: **no source change outside `packages/auto-core` and `packages/auto`**. opencode and the other agents are reached only through surfaces they already have (§2 C1).

## 0. The request

1. Phases and sessions get different default models, chosen by whether the work needs deep logical reasoning.
2. Models fall into two classes: deep reasoning and simple reasoning.
3. A model may declare disabled (or available-only) time windows, mainly to stay off high-rate periods. A complementary model takes over inside the window (failover) and the first model comes back outside it (failback).
4. A model can be bound to one coding agent (claude's opus runs only under claude).
5. A model can list several API keys and move to the next when a quota runs out (opencode only).
6. Models have internal names, and their configuration stays out of opencode's own configuration.
7. claude, qoderclicn, kimi and agents that are not supported yet are logged in and authenticated outside the driver. The driver only invokes them.
8. Say what else needs considering.

Follow-up of the same day:

9. kimi's `k3-256k` and `k3` share a cache but differ in context window and price. A `k3-256k` session that outgrows its window should continue on `k3` seamlessly. How should that switch be expressed? (§4.5)
10. `OPENCODE_AUTO_HIBERNATE` can retire later: agreed (§9, R11).
11. A project-local file should be able to override the operator's registry (§4.1).
12. Some agents, claude especially, need proxy settings such as `HTTPS_PROXY` in their environment (§8.10).
13. A free model should read failure messages, for example to recognize a quota message while the agent is still retrying, before every retry has failed (§7.1).

## 1. Fact baseline

- **F1 — routing today is an env-only experiment.** `OPENCODE_AUTO_MODEL` maps keys to raw `provider/model` strings, with precedence role > phase type id > preset letter > `*` (`src/switches.ts` parseModelPolicy, `src/chain.ts` resolveModel). `OPENCODE_AUTO_MODEL_FALLBACK` is one ordered failover ring shared by every session. `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` and `/failback` decide when the primary is retried (`src/failback.ts`). Nothing is persisted, and there are no internal names, classes, windows, keys or agent bindings. The model is resolved in four places: `src/attempt.ts:192` (dispatch), `src/session.ts:192` (switchModel's "from"), `src/unit-commit.ts:147` (resumeModelNow), and the `/failback` override.
- **F2 — one agent per run.** `startAgent` (`src/agent-choice.ts`) starts exactly one `AgentHost`. The choice goes shell profile `agent` > `OPENCODE_AUTO_AGENT` > config `agent` > opencode. `degrade` clamps the switches once, from that one client's capabilities. `opts.server` is that host (restart, syncContext).
- **F3 — session ids are agent-local, and they are persisted without their agent.** Examples are `.auto/progress.json` `session`, `.auto/units.json` `forkBase` (with its `digest:` prefix, `src/tasks.ts:70`), and `handover` `pinSession`/`nextSession` (`src/handover.ts:31-34`). An opencode session cannot be resumed or forked by claude, and the reverse is also true.
- **F4 — opencode takes model and variant per prompt.** An explicit `input.model` beats the agent contract's model and the model stored on the session (0017 B.2). The v2 prompt body also accepts `variant?: string` (`packages/sdk/js/src/v2/gen/types.gen.ts`, SessionPromptData). The driver sends `model` only today, never `variant`.
- **F5 — opencode accepts driver-supplied config without touching the target's files.** `createOpencodeServer({ config })` passes `config` to the child as `OPENCODE_CONFIG_CONTENT` (`packages/sdk/js/src/v2/server.ts`). opencode merges that after the project's `opencode.json` (`packages/opencode/src/config/config.ts:468`) and applies `{env:NAME}` / `{file:path}` substitution to it, as to every config text (`loadConfig` → `ConfigVariable.substitute`, `:213-220`). The driver spawns with `createOpencodeServer({ port: 0 })` (`src/agent/opencode/server.ts:128`), so any `OPENCODE_CONFIG_CONTENT` in the operator's environment is already replaced by `{}` today.
- **F6 — a config apiKey wins over env and auth.json in the generic provider path.** Provider options from config are applied again after the env and `auth.json` keys (`packages/opencode/src/provider/provider.ts:1586-1593`). A stored key only fills in when `options.apiKey` is unset (`:1720`). Some provider-specific loaders pick their own token first: bedrock (`:310`), cloudflare (`:747`, `:794`), gitlab (`:614`), and a gateway loader (`:873-877`, env before config). So a key ring must be verified for each provider it is used with.
- **F7 — an alias provider starts with an empty model database.** A config provider id that models.dev does not know gets `models: existing?.models ?? {}` (`provider.ts:1425-1433`). Its models would need npm, api URL, limits and capabilities restated by hand, and opencode's per-provider custom loaders (keyed by provider id) would not apply to it. That rules out aliases (`zhipuai-b/…`) as the key mechanism.
- **F8 — sessions survive a managed server restart.** `host.restart` already exists, and the network-failure path restarts the server and then forks the failed session (`src/session.ts:384`). An external server (`--server`, `OPENCODE_AUTO_SERVER`) cannot be restarted (`server.ts:111-115`).
- **F9 — the claude adapter.** The model is fixed per process: `--model` is set at start, and a different model restarts the process between turns (`src/agent/claude/client.ts:258-268`). It slices the model string after the first `/`, so both `claude/opus` and `opus` work. Authentication is entirely external: `CLAUDE_ERROR_PATTERNS.auth` recognizes "not logged in". Context windows are learned only from a turn's `result` line (`client.ts:232`). The process env is the driver's env minus the Claude Code session variables.
- **F10 — hibernate is global.** `OPENCODE_AUTO_HIBERNATE` is one daily UTC window, checked at the safe boundaries and at run start. It pauses the whole run and knows nothing about models (`src/hibernate.ts`).
- **F11 — no per-model accounting.** `src/stats.ts` buckets usage by phase, round and task, never by model, so the savings of cheaper routing cannot be measured today.
- **F12 — routing keys already cover phase types.** Builtin types keep their preset letters (`src/phases/registry.ts`). Custom types load from `.opencode/auto/phases/<type>.md`, and a type id that is also a role word is refused (`phaseTypeRoleProblems`).
- **F13 — a mistaken opencode patch was on this branch (reverted in `bb8c02945`, S0).** Commit `724a591a8` (2026-09-24) changes `packages/opencode/src/session/prompt.ts` `currentModel`: `config.model` now beats the model stored on the session, and a stored model that no longer resolves falls through. It is the only source change outside auto/auto-core since the merge base with `dev` (`941e71dbb`). `dev`, `auto`, `migrate` and `test` do not contain it. It fixed two problems: an edited `opencode.json` model never reached a resumed session, and a vanished provider killed the session. Under a registry both go away inside auto-core, because every dispatch then names its model (D7). This design depends on nothing in the patch. Reverting it is step S0 (§13).
- **F14 — the SDK spawn takes neither env nor executable.** `createOpencodeServer` runs the fixed command `opencode serve` with `{ ...process.env, OPENCODE_CONFIG_CONTENT }` (`packages/sdk/js/src/v2/server.ts`). A per-profile `env` or `bin` for opencode therefore needs the driver to spawn `opencode serve` itself, with the same arguments and the same "listening on" line. That replaces `defaultSpawn` inside auto-core (`src/agent/opencode/server.ts:127`). The claude adapter already spawns its own processes. Their env is `process.env` minus the session variables (`src/agent/claude/client.ts:182-183`), and the transcript directory reads `process.env.CLAUDE_CONFIG_DIR` (`:122`), so a profile's env must reach both.
- **F15 — opencode picks the model per loop step, from the latest user message.** Each step of a running turn resolves `lastUser.model` (`packages/opencode/src/session/prompt.ts:1157`). A prompt sent to a busy session writes its user message and joins the running loop (`ensureRunning`, `:1362`), so the next step runs on the model that prompt named. The step's auto-compaction check uses that step's model (`:1176-1183`). Its threshold is the window minus the model's output reserve (`session/overflow.ts` `usable`). A provider context-overflow error also starts a compaction unless `compaction.auto` is false (`session/processor.ts:607-616`): the driver sees a `ContextOverflowError` event, and the session continues compacted. The driver's steers carry no model today (`src/watch.ts:130-133` steerText), so opencode resolves the steered turn's model itself.
- **F16 — the handover hint normally fires long before a large window fills.** The project cap defaults to 64k (`src/opts.ts:109`), and the in-turn handover hint fires at 2·cap (`src/usage.ts` steerDue). A 256k window is outgrown only when a project's `--context-limit` is above about 100k, or when a session keeps working after the hint.
- **F17 — the retry branch already settles early, but only on known wording.** A `retry` event is classified at once (`src/watch.ts:540-572`), and quota, auth and rate settle the turn (abort, then failover). A 429 counts as rate only after 3 attempts or a wait over 60 s (`src/chain.ts` RATE_ATTEMPTS / RATE_WAIT_MS). Wording the patterns miss stays `unknown`, and the agent's own backoff runs on. No reset time is extracted.
- **F18 — the v2 prompt body also takes `tools` and `format`.** `tools` (tool name → boolean) becomes allow/deny permission rules on the session (`prompt.ts:1077-1083`), and `format` requests structured output. The driver uses neither today.
- **F19 — local-only files and protection.** init writes `/.gitignore`, `/.env`, `/AGENTS.md` and `/opencode.json` as local-only gitignore entries (`src/gitignore.ts` INIT_ENTRIES). Nothing ignores the rest of `.opencode/auto/`, so the unified commit commits it. `run` makes `opencode.json`, `.opencode/auto/config.json` and `AGENTS.md` read-only (`src/protect.ts`).

## 2. Constraints

- **C1 — no source change outside auto-core and auto.** opencode is used only through its per-prompt `model`/`variant`, spawn-time `OPENCODE_CONFIG_CONTENT`, the managed restart, and `config.providers` (context windows). claude is used through CLI flags and the process env. Future agents are used through their own CLIs as they ship.
- **C2 — no registry, no change.** Without a registry (neither layer of §4.1 exists) the run is byte-identical to today, env switches included. 0017 invariant F keeps holding: with nothing configured, a prompt carries no `model` key.
- **C3 — the core does not know shells.** A shell may add an agent adapter through registration (§8.8), never by patching the core.
- **C4 — secrets stay out of everything the driver writes.** Keys never enter the driver's logs, the target directory, git, or strings the driver builds (§4.3). The driver resolves only one kind of referenced value itself: an agent profile's `env` value (§8.10). That value goes only into the child process's environment. It is never logged or written. Error text sent to the classifier is redacted first (§7.1).
- **C5 — exit codes are unchanged.** A bad registry exits 1, like a bad config. Waiting for a window or for a quota never exits.
- **C6 — orthogonal invariants hold.** Driver-exclusive state writes, the unified commit, and completion judged independently of the agent are untouched.

## 3. The split: the tier belongs to the work, the fleet to the operator

Two kinds of knowledge are mixed in "which model runs this session":

- **The tier** (deep or simple) is a property of the *work*. Planning a phase needs deep reasoning in every project and on every machine. The program declares it for its builtin sessions and phase types, and a project declares it for its custom phase types (§5).
- **The fleet** is a property of the *operator*: which models exist, which agent runs each one, which keys pay for it, and when it is cheap. It differs between two people running the same project, and it changes when a price list changes.

So the fleet lives in an operator-level **model registry** outside the target directory and outside opencode's configuration (request items 6, 7). The tier stays with the program and the project. This settles 0017 U1, which leaned toward moving routing into `config.json`: a model list in a versioned project file would be wrong for the next operator. What belongs in the project is the tier its custom work needs. The project layer of §4.1 does not change this. It belongs to the operator of one checkout and is gitignored, so it never reaches the next operator.

## 4. The model registry

### 4.1 Location, layers and lifetime

- **Operator layer:** `$OPENCODE_AUTO_MODELS` if set. Otherwise `$XDG_CONFIG_HOME/<app>/models.json`, where `$XDG_CONFIG_HOME` defaults to `~/.config` and `<app>` comes from the shell profile (new `ShellProfile.configDir`, default `opencode-auto`).
- **Project layer (request item 11):** `.opencode/auto/models.json` in the target directory, optional. It belongs to whoever operates this checkout, not to the project (§3), so it is local-only like `opencode.json` (F19):
  - init adds `/.opencode/auto/models.json` to its gitignore entries, and `reset` removes that entry but never the file, which the driver did not write.
  - `fix` gains a rule that adds the entry to projects initialized before this change.
  - Preflight refuses (exit 1, naming `fix`) a project layer that git does not ignore, because the unified commit would otherwise commit it.
  - `run` makes it read-only, as it does `opencode.json`.
- **Merge:** the project layer applies over the operator layer one level deep.
  - `tz` and `classifier` are replaced whole.
  - Each key of `agents`, `models`, `tiers` and `routes` in the project layer replaces the operator's value for that key whole. A `null` value removes the operator's entry.
  - Nothing merges inside an entry. A half-merged entry could join the operator's `avoid` to the project's `only`, a combination that neither file states.
  - Validation runs on the merged result, and each error names the layer its entry came from.
- Either layer alone is a registry, and without both there is no registry (C2). A relative `{file:…}` path resolves against the directory of the file that contains it.
- **Read once, at run start**, like the switches. An edit takes effect on the next run, and `/failback` remains the runtime override (§9). The driver only reads the layers. It never writes or locks them. The run lock (0053 D1) does not cover the operator layer, which is outside the target.
- **Strict:** bad JSON, an unknown field inside an entry, or a broken reference fails the run start with exit 1 and names the field. Unlike `config.json`, unknown fields are not ignored. A misspelled `aviod` would otherwise silently put a model back into its peak hours.

### 4.2 Format

JSON. The example is illustrative: the names are internal, and the windows are not any provider's real price schedule.

```json
{
  "tz": "Asia/Shanghai",
  "agents": {
    "opencode": { "adapter": "opencode", "env": { "HTTPS_PROXY": null } },
    "claude":   { "adapter": "claude", "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" } },
    "claude-b": { "adapter": "claude", "env": { "CLAUDE_CONFIG_DIR": "~/.claude-b", "HTTPS_PROXY": "{env:CLAUDE_B_PROXY}" } }
  },
  "models": {
    "opus":   { "agent": "claude",   "model": "opus", "avoid": ["mon-fri 09:00-18:00"] },
    "opus-b": { "agent": "claude-b", "model": "opus", "avoid": ["mon-fri 09:00-18:00"] },
    "k3":     { "agent": "opencode", "model": "moonshotai/kimi-k3-256k", "wider": ["moonshotai/kimi-k3"],
                "keys": ["{env:MOONSHOT_KEY_A}", "{env:MOONSHOT_KEY_B}"] },
    "glm":    { "agent": "opencode", "model": "zhipuai/glm-4.6", "only": ["00:00-08:00", "sat-sun 00:00-24:00"],
                "keys": ["{env:ZHIPU_KEY_A}", "{env:ZHIPU_KEY_B}", "{file:~/.secrets/zhipu-c}"] },
    "k2":     { "agent": "opencode", "model": "moonshotai/kimi-k2-turbo-preview" },
    "free":   { "agent": "opencode", "model": "opencode/some-free-model" }
  },
  "tiers": {
    "deep":   ["opus", "opus-b", "k3"],
    "simple": ["glm", "k2"]
  },
  "routes": {
    "acceptance": "deep",
    "phase-handover": ["k2"]
  },
  "classifier": ["free"]
}
```

The model ids are illustrative too (`kimi-k3-256k`/`kimi-k3` stand for the pair of request item 9).

**Agent profile** (`agents.<name>`). A session is bound to its profile name (§8.2).

| field | meaning |
|---|---|
| `adapter` | required: `opencode` \| `claude`, or any adapter a shell registered (§8.8); an unknown adapter is an error that lists the known ones |
| `bin` | optional: the executable (default: the adapter's own, `opencode` / `claude`). For opencode this needs the driver's own spawn (F14) |
| `env` | optional: env overlaid on the driver's for this agent's processes. A value is one of: a literal string (`~` expands); an `{env:NAME}` or `{file:path}` reference that the driver resolves at spawn (§8.10); or `null`, which removes an inherited variable. Two uses: `CLAUDE_CONFIG_DIR` turns two accounts of an externally logged-in agent into two profiles (§8.9), and the proxy variables route an agent through a proxy (§8.10). Logs name the variables, never their values |
| `server` | optional, opencode only: an external server URL (`--server` still overrides it for the run) |

With no `agents` section, one profile `opencode` with adapter `opencode` is implied.

**Model entry** (`models.<internal name>`). Internal names match `^[a-z][a-z0-9.-]*$`. They contain no `/`, so they never read as a raw `provider/model` string (§9).

| field | meaning |
|---|---|
| `agent` | required: an agent profile name (request item 4) |
| `model` | the adapter's model id. opencode: `provider/model`; claude: the `--model` value (`opus`, a full id). If absent, the agent uses its own default: the prompt carries no model (0017 invariant F), and the entry cannot have `keys`, `variant` or `wider`. This makes a registry that only pauses expressible (§9) |
| `wider` | optional, opencode profiles only in v1: an ordered list of model ids that continue a session on this entry once its context outgrows the current id's window (§4.5, request item 9) |
| `variant` | optional: opencode's per-prompt `variant` (F4), e.g. a reasoning-effort variant. An adapter that cannot apply a variant rejects the field at load. For claude this is v1 behavior, since no per-turn effort input has been verified for `claude -p` |
| `context` | optional: the context window of `model` in k tokens, for agents that do not report one before the first turn (F9). Used by the window clamp (§6.2) |
| `avoid` / `only` | optional, mutually exclusive: window lists (§4.4, request item 3) |
| `keys` | optional, opencode profiles only: an ordered key ring as references (§4.3, request item 5) |

**`tiers`** — `deep` and `simple`, each an ordered list of internal names. Listing a model in a tier *is* its classification (request item 2). A model may appear in both lists: a strong non-thinking model can be the first simple choice and the last deep one. The startup log notes any model that is in no tier and is not a classifier, since it is unused.

**`routes`** — optional overrides of the default tiers (§5). A key is a role word, a phase type id or a preset letter: the `OPENCODE_AUTO_MODEL` key vocabulary, with the same precedence role > type > letter. `*` is not allowed, because the tier lists already are the default. A value is a tier name, or an ordered list of internal names that replaces the tier's list for that key.

**`classifier`** — optional: an ordered list of internal names that read failure messages the patterns cannot classify (§7.1, request item 13). They are ordinary model entries on opencode profiles and do not need to be in a tier. A free model is the intended choice.

**`tz`** — the IANA time zone of every window in the file. The default is `UTC`, consistent with `OPENCODE_AUTO_HIBERNATE`. It is validated with `Intl.DateTimeFormat`, and wall-clock times follow DST.

### 4.3 Keys are references, and the ring belongs to the provider

- **References only.** A key is `{env:NAME}` or `{file:path}`, the syntax opencode itself substitutes (F5). The file holds no secret, the driver never reads a key's value into a string it builds, and logs name the reference (`key 2/3 ZHIPU_KEY_B`). Preflight checks that each variable is set and non-empty and each file is readable, without printing either. A literal key is refused (R8).
- **Injection.** The driver spawns the managed opencode server with `config: { provider: { <id>: { options: { apiKey: "{env:ZHIPU_KEY_B}" } } } }`. opencode substitutes the reference in its own process (F5), and a config apiKey wins in the generic path (F6). The driver does not edit `opencode.json`, touch `auth.json`, or copy the value into another variable.
- **Per provider.** A quota is spent by an account, and one server holds one apiKey per provider at a time. So a ring declared on a model entry applies to the entry's provider, and every entry on that provider shares it. Entries on the same provider must declare the same ring, or leave it out. In §4.2, k2 and every step of k3 share moonshotai's ring. Two different rings on one provider are a load error.
- **Rotation is a server restart** (F8). The next key is written into the spawn config and the managed server restarts. Sessions persist across the restart, so the failed session is forked and re-dispatched on the same model (§7). The ring position stays where it is afterwards: the driver never goes back to key A while key B works (§6.4).
- **Limits.** Rings are inactive under an external server, which cannot be restarted; the startup log notes it. The provider-specific loaders in F6 may ignore a config key, so each ringed provider is checked in the S3 smoke test before it is documented as supported.
- **Settled in `src/models.ts` (S1).** These points are recorded as AUTO-RESOLVE / AUTO-DECISION lines in the module.
  - **Loading.** `loadModels(dir, { phaseTypes, adapters?, env?, home?, configDir? })` returns `undefined` when neither layer exists and the merged registry otherwise.
    - Every entry carries its layer: `operator`, `project`, or `implied` for the implied profile.
    - Name-keyed sections are Maps.
    - `unused` lists the models that no tier, route list or classifier names.
  - **Locating the layers.**
    - An explicitly set `OPENCODE_AUTO_MODELS` that names a missing file means no operator layer, and the loader does not fall back to the XDG path.
    - A relative `XDG_CONFIG_HOME` is ignored.
    - `OPENCODE_AUTO_MODELS` is registered in `SWITCH_ENV` but stays out of `Switches` and the switch lines.
  - **Errors.**
    - Every problem is collected into one `ModelRegistryError`, one line each, in the form `model registry, <layer> layer <file>: <field>: <message>`.
    - No line quotes a `keys` or `env` value, and a bad-JSON line drops the quoted token the parser echoes.
    - Unknown top-level fields fail too.
  - **Merging.**
    - Only the entries of the four sections accept `null`. In the operator layer a `null` entry removes nothing.
    - A merged `agents` section left empty implies the `opencode` profile.
  - **Names and values.**
    - Agent profile names follow the internal-name pattern, and env variable names follow `[A-Za-z_][A-Za-z0-9_]*`.
    - A reference must be the whole value.
    - An opencode `model` must be `provider/model`, `server` must be an http(s) URL, and `bin` expands `~`.
    - `variant` is refused only on claude.
  - **Lists.**
    - `only: []`, `wider: []`, `keys: []` and an empty route list are refused.
    - `avoid: []`, an empty tier list and `classifier: []` are accepted; a project layer clears the operator's classifiers with `[]`.
    - No list names the same item twice.
  - **Rings.** The ring rule compares the ordered references per provider across all opencode profiles.
  - **Reference check.** `checkModelReferences(registry, env)` requires a `{env:}` variable to be set and non-empty. A `{file:}` path must be an existing, readable regular file; this is checked with stat and access, and the file is never opened.

### 4.4 Windows

- **Grammar:** `[days ]HH:MM-HH:MM`. `days` is `mon`..`sun`, a range (`mon-fri`), or a comma list (`sat,sun`); absent means every day. `24:00` is allowed as an end. A window that crosses midnight (`22:00-06:00`) belongs to the day it starts on.
- `avoid` makes the model unavailable inside any listed window. `only` makes it available only inside the listed windows.
- **Windows gate dispatches, never running turns.** Availability is checked when a prompt is dispatched (§6). A turn that is running when a window closes is not aborted: it finishes, and the next dispatch selects again. This is hibernate's rule ("graceful to the next safe point"), applied per model and at dispatch granularity.
- The clock is the machine clock. After a system suspend, a sleep simply wakes late, as with hibernate.
- **Settled in `src/model-window.ts` (S1).** A day range may wrap (`fri-mon` is fri, sat, sun and mon), and a comma list may hold ranges (`mon-wed,fri`). Day names are lowercase, hours and minutes have two digits, and one space separates days from times. A range whose ends are the same day (`mon-mon`), a window whose start equals its end, and `24:00` as a start are refused; each parse error names the window text and what was expected, and the loader prefixes the field and the layer. `tz` accepts what `Intl.DateTimeFormat` accepts and is shown in its canonical spelling. On a DST change day a window boundary is the first instant at which the local clock shows that time or a later one: a skipped time opens at the jump (a window lying wholly in the skipped hour is empty that day), and a repeated time means its first occurrence, so a window stays one span and adjacent windows never leave a gap. Searches (`nextOpening`, the window state) look 8 local days ahead, a week plus the DST shift; a model that does not open within them never opens. The window state reads `open`, `open until [ddd ]HH:MM <tz>`, `opens [ddd ]HH:MM <tz>` (a weekday when the time is not today) or `closed`.

### 4.5 Context steps: one model, several windows (request item 9)

Some providers sell one model under several ids that share a prompt cache and differ only in context window and price, like kimi's `k3-256k` and `k3`. For routing they are one model, with the same reasoning, the same account and the same cache. So they form **one entry with steps**, not two entries:

```json
"k3": { "agent": "opencode", "model": "moonshotai/kimi-k3-256k", "wider": ["moonshotai/kimi-k3"] }
```

- **The entry is the unit of routing.** Tiers, routes, windows (§4.4), the key ring (§4.3) and down marks (§6.4) apply to the entry as a whole. `model` is the base step, and each `wider` id is the next step up. The window clamp (§6.2 rule 5) reads the window of the top step.
- **Validation.** Every step must be on the entry's provider, because a shared cache implies one. Once the server is up, each step's window from `contextLimits()` must be strictly larger than the one before. If a step's window stays unknown, the steps from it upward are disabled with a startup warning. `wider` on a claude profile is rejected at load in v1, as `variant` is. The claude process takes its model at start (F9), claude reports usage only at turn end (`reported`), so there is no live figure to step on, and whether its larger-window ids share a cache is unverified.
- **Step-up point.** A session steps up when its context reaches the current step's window minus max(48k, window/5), which is 204.8k for a 256k step. The point must come before opencode compacts on that step (window minus the output reserve, F15). An early step-up is the cheaper mistake: it only costs the price difference for the rest of the session. A late one lets opencode compact.
- **Mechanism (opencode).** The watch reads `contextUsed` on every message update (usage tier `events`). At the step-up point it steers the same session with the next step's id and a one-line note (template `step-up.md`). opencode runs the next loop step on that model, and that step's compaction check uses the larger window (F15). The session, its history and its cache prefix stay the same: no fork and no handover. Between turns the note is not needed, because the chain's next prompt names the step the session reached.
- **Steers name their model.** Under a registry every steer (handover hint, test result, stuck hint, length continuation) names the chain's current id, which is the reached step. Otherwise a later steer could leave opencode to resolve the model (F15) and drop the session back to the base step.
- **One-way within a session.** A session never steps down. Every new session starts at the base step: a new prompt, the session after a handover, and a failover onto this entry. A continuation of the same session (§6.2) keeps the step it reached. On resume the step is recomputed from the context size in the session's history, so nothing is persisted.
- **Late step-up.** One step can jump past opencode's threshold before the steer lands. opencode then compacts as it does today, and the run goes on; the log says `step-up late`. Without `capabilities.steer`, a session steps up only at the next prompt.
- **Checking the cache claim.** `wider` asserts a shared cache, which the driver cannot know. The first step-finish on the wider id shows whether it holds: a large `cacheRead` confirms it, and a `cacheWrite` of the whole prefix contradicts it. The log reports a contradiction once per entry.
- **Relation to the handover hint.** The two are independent. With the default cap (64k, hint at 128k) a 256k base step is never outgrown (F16). Steps matter to projects with a larger `--context-limit` and to sessions that keep working after the hint.
- **Rejected alternatives.** (a) Two entries linked by a pointer (`"k3-256k": { "overflow": "k3" }`). Two names are two failover candidates with two down marks, so a spent quota on one would fail over to the other only to fail again. The tier lists would also have to keep the wider id out of the ordinary order. (b) Reacting to the `overflow` error class (0017 H). On opencode the overflow error comes together with a compaction (F15), so by then the session has already lost detail.

Log line: `⇡ T-004 context 205k reached the step-up point of k3 (moonshotai/kimi-k3-256k); continuing the same session on moonshotai/kimi-k3`.

## 5. Tiers: which sessions need deep reasoning

Every session has a tier, derived from its routing role and the current phase type. These are the program defaults (request item 1):

| session (routing role) | default tier | why |
|---|---|---|
| `phase-plan` (incl. append planning) | deep | splits a phase into tasks with dependencies; every later session inherits its mistakes |
| `implement-scan` | deep | the planning scan of m mode |
| `decompose` | deep | understands the task, writes `context.md` and the subtask plan |
| `whole`, `subtask` | the phase type's **execute tier** | below |
| `wrapup` | simple | a report over finished, committed work |
| `phase-handover` | simple | distils the phase's documents |
| `knowledge`, `prior-knowledge` | simple | extraction into the kb documents |
| `number-recovery` | simple | derives the next task number from disk |
| `bypass` | simple | confirm turns and the other one-off sessions (the digest base: §8.4) |

| phase type | execute tier | why |
|---|---|---|
| analysis (a) | deep | the work is reasoning |
| design (d) | deep | the work is reasoning |
| implement (m) | simple | subtasks come out of a deep decompose and are small and specified (0003); m mode is the implicit implement phase |
| test (t) | simple | writing and running tests against a specified behavior |
| acceptance (v) | deep | the `Result: PASS\|FAIL` verdict; a wrong PASS costs far more than the tokens |
| knowledge (k) | simple | extraction |
| custom type | its `Reasoning: deep\|simple` field; absent = deep | a custom type exists because its work is special; the conservative default costs money, not correctness |

- The builtin types' execute tiers become a field in the phase type registry (`src/phases/registry.ts`). The custom field is parsed with the other `.opencode/auto/phases/<type>.md` fields (`src/phases/custom.ts`). That field is project content: it is versioned and travels with the project, as §3 requires.
- An operator's `routes` override any of these for their own machine (`"implement": "deep"` for a hard migration).
- **Borrowing:** a simple session whose simple list has no usable model continues down the deep list (availability over cost). A deep session never borrows a simple model. It waits instead (§6.3), because quality is the reason it is deep (R3).

## 6. Selection

### 6.1 The candidate list of a dispatch

```
role  = roleOf(chain)                   // unchanged (chain.ts)
entry = opts.phase?.entry               // current phase type
route = routes[role] ?? routes[entry.type] ?? routes[entry.letter]
tier  = route is a tier name ? route : defaultTier(entry, role)        // §5
list  = route is a list ? route : tiers[tier] ++ (tier == simple ? tiers.deep : [])
list  = OPENCODE_AUTO_MODEL match for (role, entry) ?? /failback override ?? list   // §9
```

### 6.2 Picking from the list

A candidate is **usable now** when all of the following hold:
1. Its agent passes the run's agent filter: the shell profile's agent or `OPENCODE_AUTO_AGENT` (§9).
2. It is inside its windows (§4.4).
3. It is not marked down (§6.4).
4. Its provider's key ring, if any, has a key that is not down.
5. Its known context window is at least the project cap. For an entry with steps this is the top step's window (§4.5). This is today's clamp, `src/session.ts:175`, fed by `contextLimits()` or the entry's `context`.

- **A new prompt** takes the first usable candidate in list order. The primary comes back automatically when its window reopens or its down mark clears. Failback in low-rate periods therefore needs no extra state (request item 3).
- **A continuation of the same prompt** keeps the chain's model while it is still usable. Continuations are retries, forks after a failure, the wait loop's re-dispatch, and strict resume. The prompt is not moved to another model merely because a better one reappeared mid-prompt.
- **Continuity ties:** when the chain holds a live session and the first usable candidate is on another agent, a *new* prompt still moves (§8.3). Reuse is off by default, so a new prompt is a new session anyway.

### 6.3 Nothing usable

- If some candidate that is not down becomes usable later through its window, the dispatch **waits for the earliest such opening**. The wait sleeps inside the unit before dispatching, as the recovery wait does, logs one line (`⏸ T-004 decompose waits for a deep model: opus opens 18:00 Asia/Shanghai`), is booked as a `window` wait (`statsWaitBegin`), and can be force-quit with a double Ctrl+C. After the opening it adds hibernate's random delay of 0–600 s (0027 D3), so drivers sharing an account do not all dispatch at the same moment.
- If every candidate is down, the dispatch goes to the existing **wait-and-probe loop** (`awaitRecovery`). The probe uses the first candidate that is inside its window, ignoring down marks. A successful probe clears that candidate's mark, and the prompt continues through the existing fork-and-note path.
- A tier that the run's phases need and that has no candidate left after the agent filter is a **preflight error** (exit 1). It never becomes a silent wait.

### 6.4 Down marks

- A classified failure marks a model down, and a key failure marks a key down (§7).
- Marks are cleared at the boundaries of `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` (phase / task (default) / subtask / session) and by `/failback`. This is the existing scope semantics, generalized from "the chain's candidate" to "the marks". `src/failback.ts` keeps the marks instead of `sticky`.
- A cleared key mark does not move the ring back (§4.3). Only a failure of the current key moves it, so there is no restart churn. A cleared model mark does make the primary eligible again, which is the existing failback.
- Marks live in memory only (0017 D5). A new run starts with every model eligible.

### 6.5 Logging

- Run start, one block: each tier's list with every model's agent, window state now and ring size; the routes in force; and the agent filter.
- Each dispatch that shows a model (the existing `◈` rule, attempt.ts:209): `◈ T-004 using model opus [deep · claude:opus] (route decompose)`. The reason for a move is named in the line: `window`, `quota`, `key ring`, `failback`. A class that came from the classifier is marked, for example `quota (classifier)` (§7.1). Step-ups have their own line (§4.5).

## 7. Failure handling: key → model → wait

A dispatch that ends in a session error (`src/session.ts` runSession) escalates in this order. The retry ladder for transient errors is unchanged.

1. **Key.** If the error class is `quota`, `auth` or `rate`, and the model's provider has another key that is not down, the driver marks the current key down and restarts the managed server on the next key (§4.3). It then re-dispatches the *same model* from a fork of the failed session. The source choice and the note are those of the retry path. An `auth` error counts here because a revoked key looks like one.
2. **Model.** Otherwise the model is marked down and the next usable candidate is selected (§6.2). This generalizes `switchModel`, with the tier's list replacing the global `_FALLBACK` ring.
   - On the **same agent**, the failover proceeds as today: fork copy, `chain.model`, failover note, ladder reset.
   - On **another agent**, a fork is impossible (F3). A new session on that agent gets the worktree-check note, which is today's "blank new session" path.
3. **Wait.** With no usable candidate, the dispatch waits (§6.3).

- A transient error whose ladder runs out enters at step 2, as today (0017 P7).
- `overflow` still belongs to the handover mechanism, with one exception. On an entry with steps, an overflow below the top step is a late step-up, and the next prompt names the next step (§4.5). Moving any other overflow to a larger-window candidate stays future work (0017 H).
- **Reset times:** when the classifier reads a reset time from the message (§7.1), or an agent reports one, the down mark lasts until then instead of until the scope boundary (§10 item 9).

### 7.1 Reading failure messages with a model (request item 13)

The patterns in `classifySessionError` settle a turn early only on wording they know (F17). Provider wording varies: other languages, plan-specific limits, "resets at 15:00". And a 429 that really means a spent quota counts as rate only after three attempts, so the agent's own backoff keeps running until then. The registry's `classifier` models read what the patterns cannot.

- **When it is asked.** Only where the patterns are not decisive:
  - a `retry` event that the patterns class as `unknown`, or as a rate signal still below its threshold;
  - a session error that ends as `unknown`.

  It is never asked about `overflow`, which the steps and the handover own (§4.5), and never about a message that the patterns already class as quota or auth.
- **What it answers.** One JSON line: `{"class": "quota" | "rate" | "auth" | "transient" | "unknown", "resetAt": "<ISO 8601 with offset>" | null}`. The prompt (template `classify-error.md`) gives the current time in the registry's `tz`, so "resets at 3pm" becomes an absolute time. A reply that does not parse counts as no answer.
- **What it may change.** Its class replaces an `unknown`, and it may raise a rate signal below the threshold to `quota`. It never lowers a class the patterns found. A `quota` or `auth` answer settles the turn exactly as the patterns do today: the running turn is aborted, then key → model → wait. A `resetAt` in the future and at most 7 days away sets when the down mark clears (§6.4), in place of the scope boundary.
- **Timing.** The call runs beside the event stream while the agent keeps retrying. An answer that arrives while the turn is still retrying settles it. An answer that arrives after the turn ended only sets when the down mark clears. A 30 s timeout or any failure counts as no answer, and the pattern verdict stands. The classifier never delays a dispatch.
- **Cost.** Answers are cached for the run, keyed by the message with its digits, ids and times masked, so a repeated message costs one call. A run makes at most 20 calls. After that the patterns decide alone, and the log says so once.
- **How it runs.**
  - Each call is a one-shot session on the first usable classifier entry (windows, down marks and the agent filter apply), created through the pool and titled `auto: classify error`.
  - The session runs on the adapter's default agent, not the `auto` contract, and every tool is denied through the prompt body's `tools` (F18, `{"*": false}`). S3 checks that the wildcard really denies every tool before v1 relies on it. With no tools, instructions hidden in a provider's error body can do no more than produce a wrong class.
  - v1 accepts only opencode entries as classifiers, because the claude adapter has no verified way to run without tools.
  - The classifier's own failures are classified by the patterns alone, and they mark only the classifier entry down.
- **What it sees.** Only the error text: message and response body, truncated to 2,000 characters. Before sending, the driver redacts key-like tokens (`sk-…`, `Bearer …`, runs of 24 or more key characters), e-mail addresses and URL query strings. It never sends the prompt, the diff or any file. Free tiers may keep what they receive, which is why the input is kept this narrow.
- **Stats.** Its tokens are booked in a `classify` bucket (§10 item 12).

## 8. Several agents in one run

### 8.1 Agent pool

`src/agent-pool.ts` replaces `startAgent`. It holds one host per agent profile and **starts each one lazily** on the profile's first selection, so a profile nobody selects never spawns. Every driver call that takes a client resolves it from the chain's agent. `opts.server` becomes the pool, and `restart`/`syncContext` apply to the chain's host. `close` closes every host at run end. The claude adapter already accepts `bin`. Its factory also receives the profile's `env`, including `CLAUDE_CONFIG_DIR` for its transcript directory (F14). The opencode factory receives the spawn `config` (§4.3), and it spawns `opencode serve` itself so that a profile's `env` and `bin` apply (F14).

### 8.2 Binding sessions to agents

- `SessionChain` gains `agent`, set when the chain's session is created or forked.
- Persisted session ids gain their agent: `progress.json` (`agent`), `units.json` (`forkBase` becomes a map from agent to id, §8.4), and `handover` (`agent` next to `pinSession`/`nextSession`).
- An absent field means the default agent, i.e. the project's configured agent, so every record written before this change stays valid. A plain string `forkBase` reads as the default agent's.

### 8.3 Moving between agents

- A session never crosses agents: no fork, no resume.
- A move is a new session on the target agent with the worktree-check note (`retryNote`, session.ts:111).
- On resume, the recorded session is used only if its agent's model is usable. Otherwise it is treated as a dead session (the existing path: a new session with the resume note). Strict resume compares the recorded internal name and agent, not the raw string.

### 8.4 Fork base per agent

- A digest base is rebuilt deterministically from `context.md` (`ensureForkBase`), so a base can exist on every agent. `forkBase` becomes `{ <agent>: "digest:<id>" }`, and a base is built lazily for the agent of the first subtask that forks on it.
- The base is created with **the model selected for the `subtask` route**, not `bypass`. A base's value is a warm prefix (0003), and a prefix cached under one model is a miss under another.

### 8.5 Capabilities

`degrade` runs once at run start over the **intersection** of the capabilities of every agent that has a candidate in a list after the agent filter. Each note names the agent that forced it (`OPENCODE_AUTO_ASK=on needs question events; claude (opus) has none`). Per-session degradation would thread capabilities through every consumer. The intersection is simpler and conservative, and choosing a fleet without claude is how an operator gets the opencode-only behavior back.

### 8.6 Contract and permissions

Each adapter translates `.opencode/agent/auto.md` and the `opencode.json` permission rules itself, as claude's `contract.ts` does, and supplies `errorPatterns` for its quota, auth and rate wording. The driver still sends the contract name (`PromptInput.agent`). A new adapter is not done until both translations exist.

### 8.7 External authentication (request item 7)

- The driver never logs in, never reads credentials, and never passes secrets to external agents. Preflight only checks that each referenced profile's `bin` runs under the profile's env (`<bin> --version`, 10 s timeout).
- An expired or missing login surfaces at runtime as an `auth`-class error. That marks the model down, and the run fails over to the next candidate. If none is left, the wait-and-probe loop keeps probing, so when the operator logs in again the next probe succeeds and the run continues without a restart.

### 8.8 Agents not supported yet (kimi, qoderclicn, …)

- Each adapter is its own design with a measured fact baseline, like 0041, landing under `src/agent/<name>/`.
- `registerAgentAdapter(name, factory)` (new, `src/shell.ts` beside `registerTemplate`) lets a shell add an adapter without touching the core (C3). The registry's `adapter` field then accepts that name.
- Before writing per-CLI adapters, check whether these CLIs speak a common protocol such as ACP. If they do, one generic adapter could serve several of them. This is unverified here and belongs to the first adapter design.

### 8.9 Account failover for external agents

Keys are opencode-only (request item 5), but an externally logged-in agent can still fail over between accounts without the driver handling a secret. Declare two profiles that differ only in `env` (`CLAUDE_CONFIG_DIR`), log each in outside the driver, and list both models in the tier (`opus`, `opus-b` in §4.2). Sessions do not cross profiles (§8.3), so this is plain model failover.

### 8.10 Proxies (request item 12)

- A proxy is process env, so it is set on the agent profile: `"env": { "HTTPS_PROXY": "http://127.0.0.1:7890" }`. claude documents `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`. The opencode server's fetch runs on Bun, which reads the same variables, and opencode applies them to its WebSockets itself (`packages/opencode/src/plugin/openai/ws.ts`). A model is proxied by being on a profile that has a proxy.
- A proxy URL can carry credentials, so an `env` value may be an `{env:NAME}` or `{file:path}` reference. The driver resolves it at spawn and puts the value only into that child's environment (C4). Logs and `models` output show the variable names (`env: HTTPS_PROXY`), never the values.
- `null` removes an inherited variable. If the operator's shell exports a proxy for everything, `null` keeps it away from agents that must connect directly: `"opencode": { "adapter": "opencode", "env": { "HTTPS_PROXY": null } }` in §4.2.
- **One opencode server, one environment.** Every provider on a managed opencode server shares that server's env. opencode has no per-provider proxy setting, only the env lookup in `packages/opencode/src/util/proxy-env.ts`, and C1 rules out adding one. When only some opencode providers need the proxy, either list the direct hosts in `NO_PROXY`, or declare two opencode profiles, one with the proxy and one without. The pool then runs a managed server for each (§8.1). Their sessions do not cross (§8.3), and each server holds its own key rings.
- **The driver's own traffic.** The driver reaches its managed opencode server over loopback with Bun's fetch (`src/agent/opencode/server.ts` timeoutFetch). Setting proxies on profiles keeps them out of the driver's own process. If the driver's environment has a proxy and `NO_PROXY` does not cover `127.0.0.1` and `localhost`, preflight warns. S2 checks whether Bun bypasses loopback without being told, and settles the warning's wording from that.
- An external opencode server (`--server`, a profile `server`) keeps the env it was started with, so a profile `env` has no effect on it. The startup log notes this.

## 9. Existing switches, keys and commands

| surface | with no registry | with a registry |
|---|---|---|
| `OPENCODE_AUTO_MODEL` | unchanged | same key grammar; a value is an internal name, or a raw `provider/model` string that runs on the default agent with no window, ring or steps. It overrides the matching sessions' candidate list for this run |
| `OPENCODE_AUTO_MODEL_FALLBACK` | unchanged | usage error (exit 1): the tier lists are the failover order |
| `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` | unchanged | clears the down marks (§6.4) |
| `/failback [a b …]` | unchanged | the arguments are internal names; they replace every list for the rest of the run, as the override does today |
| `OPENCODE_AUTO_HIBERNATE` | unchanged until it retires | unchanged until it retires: a whole-run pause at safe boundaries, applied alongside the windows. **Ruled 2026-09-25 (R11): it retires later** (below) |
| `OPENCODE_AUTO_AGENT`, shell profile `agent` | choose the one agent | filter: only models on that agent are candidates |
| config `agent` (init `--agent`) | the run's agent | the default agent: the one for unqualified persisted session ids (§8.2) and for raw `OPENCODE_AUTO_MODEL` values. A startup note fires when no tier uses it (R6) |
| `--server` | unchanged | overrides the `opencode` profile's `server`; key rings are inactive under it |

**Retiring `OPENCODE_AUTO_HIBERNATE`** is a step after S2 (§13). Per-model windows cover its purpose, the price of peak hours. Two things must be in place first:

1. An entry without `model` (§4.2), so that a registry that only pauses is expressible without naming a model. With `{ "models": { "any": { "agent": "opencode", "avoid": ["04:00-10:00"] } }, "tiers": { "deep": ["any"], "simple": ["any"] } }`, every dispatch inside the window waits.
2. Window waits that keep hibernate's jitter (§6.3).

From then on the variable is a usage error (exit 1), in line with the tombstones of other retired switches, and the message names `avoid` as its replacement. One difference remains, and it is deliberate. Hibernate stops at the next safe boundary (phase, task or subtask). A window gates each dispatch, so a unit that has started pauses before its next prompt instead of at its end.

New shell command (`packages/auto`): `opencode-auto models [dir]` prints the effective table without starting any agent. It shows, per phase type and role, the tier, the candidates, and which of them are usable now and why, along with reference problems. It also shows the layer each entry came from (§4.1), each entry's steps, the classifier list, and each profile's env variable names. `--probe` sends the recovery probe prompt to each listed model; it is opt-in because it costs tokens. The core supplies `describeModels()` and `checkModels()`, and the shell only prints.

## 10. Other considerations (request item 8)

1. **Session continuity across agents** — sessions and fork bases are agent-local (§8.2–§8.4). Mixing agents costs the warm prefix and the cache at every move, so tier lists should put same-agent candidates next to each other.
2. **Capability differences** — the intersection rule (§8.5) means one claude model in the fleet turns off `ask` for the whole run. It is logged; the operator decides.
3. **Protocol adherence of simple models** — the driver parses `Result: PASS|FAIL`, relies on the todo/done protocol, and reads the subtask output conventions. A weaker model drifts on these (0017 G1). Before a model is listed, run `models --probe` and one short sample project. Per-model stats (item 12) then show its FAIL, stuck-hint and shape-check re-prompt counts.
4. **Prompt-cache economics** — every model move re-reads the prefix at the new model's full price. Windows move only at dispatches (§4.4), and continuations keep their model (§6.2). The digest base is built for the model that forks from it (§8.4).
5. **Subagents** — the per-prompt model may not reach subagents a session spawns (the opencode task tool, Claude Code subagents); each agent resolves its subagents' model in its own way. Verify per adapter, and record the result in that adapter's design.
6. **Time** — use IANA zones with DST, day-of-week windows, and the machine clock. A wait that spans a suspend wakes late but stays correct.
7. **Waiting forever** — a deep session whose deep models are all down and whose windows never reopen could wait indefinitely. The wait-and-probe loop is the backstop, and every wait line names what it waits for. A preflight error covers the empty-tier case (§6.3).
8. **Key rotation and parallelism** — rotation restarts the one managed server, which is safe while sessions run one at a time (`--max-sessions` is reserved at 1). Concurrent execution (0036/0046) will need a server per worker, or a rotation that waits for the other sessions to reach idle. Record that as a precondition in the scheduler design.
9. **Quota reset times** — the classifier reads a reset time from the message text (§7.1), and the down mark then lasts until that time rather than until the scope boundary. Some agents also state reset times in structured form. Surfacing that as an optional `AgentError` field needs an amendment, which remains deferred.
10. **Context windows** — the project cap (`contextLimit`) is one number, but windows differ per model. The clamp (§6.2 rule 5) keeps a candidate from being chosen into immediate overflow. `context` supplies the window for agents that report it late. Steps (§4.5) let one entry grow its window within a session.
11. **Strict resume** — the recorded model becomes an internal name plus agent, and eligibility replaces equality (§8.3). A window change alone does not roll a unit back.
12. **Observability and cost** — add usage by internal model and tier to the stats (F11), and add a per-model line to the conclusion. Without this the cost argument for tiers cannot be checked.
13. **Validation depth** — preflight checks the layers, the references, the bins and the tier coverage. After the opencode server starts, a registry model id that is missing from `contextLimits()` produces a warning, not an error, because some providers load models late. A step whose window is unknown or not larger than the step below disables the steps from it upward (§4.5).
14. **Reasoning effort as a dimension** — deep and simple need not be different models. With `variant`, `glm-think` and `glm` can be two internal names over one model id, and each tier lists one of them.
15. **Security** — a world-readable registry holds no secret (references only), so no permission check is needed. Only reference names ever appear in `status`, logs and `models` output.
16. **Backward compatibility** — no registry means no change (C2). Records written before the change read as the default agent's (§8.2). The env switches keep their meaning without a registry. An older project lacks the gitignore entry for the project layer; that matters only once someone creates the layer, and preflight then points to `fix` (§4.1).
17. **Layer shadowing** — a project layer silently replaces the operator's entries for that checkout, and a stale one can outlive the operator's price changes. The startup block and `models` mark every entry that comes from the project layer.
18. **The classifier is advisory** — it can only make a failover happen sooner or name a reset time. It never lowers a class, never judges completion (C6), and a wrong answer costs one unnecessary move, which the down-mark expiry and failback then undo.

## 11. Points for ruling

- **R1 — registry location.** **Ruled 2026-09-25: agreed.** Revised after request item 11. Recommended: an operator layer plus an optional project layer `.opencode/auto/models.json`, gitignored and merged over the operator layer one level deep (§4.1). Alternative: a project layer that replaces the operator file whole. It is simpler, but every project would then restate the whole fleet.
- **R2 — classification by tier lists.** **Ruled 2026-09-25: agreed.** Tier lists (a model may serve both tiers), rather than a `class` field on each model.
- **R3 — borrowing.** **Ruled 2026-09-25: agreed.** Recommended: simple may borrow deep, deep never borrows simple (it waits).
- **R4 — the default tier tables.** **Ruled 2026-09-25: agreed.** The tables of §5, especially implement = simple, acceptance = deep, and custom types defaulting to deep.
- **R5 — key ring scope.** **Ruled 2026-09-25: agreed.** Declared on models, applied per provider, and identical within one provider (§4.3). Recommended as stated. Per-model rings would need alias providers, which F7 rules out.
- **R6 — the project `agent` key under a registry.** **Ruled 2026-09-25: agreed.** Recommended: the default agent for unqualified records and raw strings, not a filter (§9). Making it a filter would force a single-agent fleet onto any project that was initialized with `--agent claude`.
- **R7 — env interplay.** **Ruled 2026-09-25: agreed.** `OPENCODE_AUTO_MODEL` accepts internal names, and `_FALLBACK` is a usage error under a registry (§9).
- **R8 — literal keys refused.** **Ruled 2026-09-25: agreed.** Keys are references only (§4.3).
- **R9 — window time zone.** **Ruled 2026-09-25: agreed.** A file-level `tz`, defaulting to UTC.
- **R10 — revert `724a591a8`.** **Ruled 2026-09-25: agreed.** Reverted as step S0 (F13) in `bb8c02945`. It restores opencode to upstream and touches nothing in auto/auto-core.
- **R11 — `OPENCODE_AUTO_HIBERNATE` retires later.** **Ruled 2026-09-25: agreed.** The step and its two preconditions are in §9.
- **R12 — context steps** (§4.5). **Ruled 2026-09-25: agreed.** One entry with `wider`, not two linked entries. opencode only in v1, stepping up by a steer at window − max(48k, window/5), and every steer names its model under a registry.
- **R13 — proxies** (§8.10). **Ruled 2026-09-25: agreed.** Through the profile `env`, with references and `null`. Partial proxying on one opencode server is done with `NO_PROXY` or a second opencode profile, with no opencode change.
- **R14 — the classifier** (§7.1). **Ruled 2026-09-25: agreed.** A registry-level `classifier` list of opencode entries, asked only where the patterns are not decisive. It never lowers a class, runs without tools, sees only redacted error text, and is limited to 20 calls per run.

## 12. Module map

| module | change |
|---|---|
| `src/models.ts` (new) | registry types, both layers and their merge, strict load and validation (incl. `wider`, `classifier`, profile `env`), reference checks, `describeModels` / `checkModels` |
| `src/classify.ts` (new) | the classifier: when to ask, redaction, cache, call limit, reply parsing, the one-shot session through the pool (§7.1) |
| `templates/prompts/step-up.md`, `classify-error.md` (new) | the step-up note and the classifier prompt, registered in `src/template.ts` |
| `src/watch.ts` | step-up trigger and steer (§4.5); steers name the chain's model; classifier answers next to the retry branch (§7.1) |
| `src/gitignore.ts`, `src/config-fix.ts`, `src/protect.ts`, `src/loop-preflight.ts` | project layer: init gitignore entry, `fix` rule, read-only during `run`, preflight refusal when not ignored (§4.1); proxy warning (§8.10) |
| `src/model-window.ts` (new) | window grammar, `usableAt(model, now)`, `nextOpening(models, now)`; pure, with an injected clock |
| `src/tier.ts` (new) | `defaultTier(entry, role)` from the role table and the phase type's execute tier |
| `src/select.ts` (new) | candidate list (§6.1), pick (§6.2), wait decision (§6.3); the one resolver behind attempt, session, unit-commit and failback when a registry exists (`resolveModel` stays for the no-registry path) |
| `src/keyring.ts` (new) | per-provider rings, down marks, the spawn `config` content |
| `src/agent-pool.ts` (new, replaces `agent-choice.ts` startAgent) | lazy hosts per profile, client by agent, intersection degrade |
| `src/failback.ts` | down marks replace `sticky`; `/failback` takes internal names |
| `src/session.ts` | escalation key → model → wait (§7); cross-agent moves; window wait |
| `src/attempt.ts`, `src/chain.ts` | `SessionChain.agent`; target and client from the selection |
| `src/resume.ts`, `src/tasks.ts`, `src/handover.ts`, `src/unit-commit.ts` | persisted `agent` fields; `forkBase` map; eligibility-based strict check |
| `src/session.ts` ensureForkBase | base per agent, built with the subtask route's model |
| `src/capability.ts` | notes that name the forcing agent |
| `src/phases/registry.ts`, `src/phases/custom.ts` | execute tier field; `Reasoning:` field |
| `src/switches.ts` | `OPENCODE_AUTO_MODELS` path; internal-name values; `_FALLBACK` refusal under a registry |
| `src/shell.ts` | `configDir`; `registerAgentAdapter` |
| `src/stats.ts`, `src/conclusion.ts` | per-model and per-tier usage |
| `src/agent/types.ts` | conscious amendment (0037 frozen): `PromptInput.variant` and `PromptInput.bare` (every tool denied, for the classifier); `AgentHostOptions.config` (spawn config content) and `env`/`bin` |
| `src/agent/opencode/server.ts`, `client.ts` | own spawn of `opencode serve` with profile `env`/`bin` (F14); spawn with `config`; restart with new content; send `variant`; `bare` → `tools: {"*": false}` |
| `src/agent/claude/host.ts`, `client.ts` | profile `bin`/`env`, incl. `CLAUDE_CONFIG_DIR` for the transcript directory; reject `variant` and `wider` at load |
| `src/hibernate.ts`, `src/switches.ts` | later: `OPENCODE_AUTO_HIBERNATE` retirement (§9) |
| `packages/auto` | `models` command, usage text, README |
| `test/import-direction.test.ts` | table rows for the new modules (select/keyring/pool sit below session, above the agent domain) |

No existing driver protocol string changes. The classifier reply (§7.1) is a new shape that the driver parses. It is English from the start, and its template and parser land in one change. 0035 registers only strings that still await a flip, so nothing is added there.

## 13. Stages and steps

| step | content | verification |
|---|---|---|
| S0 | revert `724a591a8` (F13). **Done 2026-09-25 in `bb8c02945`** | `git diff 941e71dbb -- packages/opencode` is empty (verified); `packages/opencode` `test/session/prompt.test.ts` passes |
| S1 | registry load and validation with both layers, `models` command (read-only), phase type tier fields; the project layer's gitignore entry, `fix` rule, protection and preflight refusal; no routing change | `bun test` (new `test/models.test.ts`); no-registry runs are byte-identical (C2) |
| S2 | selection with tiers, routes, windows and down marks on one agent (opencode); window wait with jitter; logging; profile `env`/`bin` for the run's agent (own opencode spawn, claude env); context steps and model-naming steers | fake clock and agent-fake cases (§14); check Bun's proxy handling of loopback (§8.10); a real step-up on a provider with a shared cache |
| S3 | key rings: spawn config, restart on rotation, escalation step 1; smoke-test each ringed provider. The classifier (§7.1), whose answers feed the same escalation | agent-fake + a real two-key smoke with a deliberately exhausted key; check that `tools: {"*": false}` denies every tool |
| S4 | agent pool, session binding, persisted agent fields, fork base per agent, capability intersection | agent-fake with two fake agents of different capabilities |
| S5 | per-model stats and conclusion lines | stats tests |
| S6 | docs: AGENTS.md navigation line, docs/structure.md, glossary terms (tier, registry, key ring, window), shell README | review |
| later | retire `OPENCODE_AUTO_HIBERNATE` once S2 is in (R11, §9); kimi / qoderclicn adapters (one design each, §8.8); structured reset times on `AgentError` (§10 item 9); overflow → larger window for models without steps | — |

## 14. Test plan

- **models.test.ts** — parsing, every strict error (unknown field, bad window, bad tz, unknown agent or adapter, ring conflict on one provider, missing env reference, `keys` on a claude profile, `variant` on claude, a literal key), and a missing file = no registry. Layers: a project entry replaces the operator's whole, `null` removes one, an error names its layer, a relative `{file:}` resolves against its own layer's directory, a project layer alone is a registry. `wider` on claude or on another provider; `classifier` naming a claude entry; `env` references and `null`; an entry without `model` that has `keys`.
- **classify.test.ts** — redaction; the masked cache key; the 20-call limit; unparsable replies; raise-only (never lowers a class the patterns found); `resetAt` in the past or beyond 7 days ignored; a timeout counts as no answer.
- **Preflight** — a project layer that git does not ignore exits 1 and names `fix`.
- **model-window.test.ts** — avoid and only; ranges crossing midnight; day lists; DST days in a zone that has them; `nextOpening` across a week.
- **select.test.ts** — precedence of route over default tier; borrowing rules; continuity for continuations; a new prompt returning to the primary when its window reopens; the `OPENCODE_AUTO_MODEL` and `/failback` overrides; the empty-tier preflight error.
- **agent-fake.test.ts** — (the MA.6 double, extended to two agents) quota → key rotation restarts the host and re-dispatches the same model; ring exhausted → model failover on the same agent (fork) and on another agent (new session + worktree note); all down → the probe loop; a window closing mid-turn does not abort; resume of a session whose agent is filtered out. Steps: the steer at the step-up point names the next id; later steers keep the step the session reached; a new session starts at the base; a compaction before the steer is logged as late; the cache-claim warning. Classifier: a quota answer during retries settles the turn before the agent's retries run out.
- **No-registry regression** — the existing routing, failover and failback suites pass unchanged.

## 15. Relationship to other designs

- **0017 (model routing)** — this design keeps its classifier, fork-based failover, notes and failback scopes. It replaces the global `_FALLBACK` ring with per-tier lists when a registry is present, settles U1 (§3), and keeps D5 (nothing persisted). Steps (§4.5) settle part of its H (overflow → a larger window) for models that share a cache.
- **0027 (hibernate)** — kept until it retires (ruled 2026-09-25, R11; §9). Per-model windows (§4.4) cover the price motive per model instead of per run, and window waits take over its jitter.
- **0037 / 0039 / 0040 / 0041 (agent domain)** — `AgentClient` is unchanged. `PromptInput` and `AgentHostOptions` are amended consciously (§12). The pool supersedes M6.1's one-agent choice. Capability degradation becomes an intersection.
- **0038 (usage tiers)** — the window clamp reads `contextLimits()` and falls back to the registry's `context`.
- **0022 (strict resume)** — the recorded model gains its agent; eligibility replaces equality.
- **0036 / 0046 (parallelism)** — key rotation by restart is a precondition to revisit (§10 item 8).
- **0052 / 0053 (config commands, run lock)** — the operator layer is outside the target, so neither the lock nor `amend`/`fix` apply to it. The project layer is local-only like `opencode.json`: init writes its gitignore entry and `fix` repairs a missing one, but no command writes the file itself. The `Reasoning:` field of a custom type is target content, versioned like the rest of the type file.

<!-- auto: eof -->
