# Session-Fork Fine-Grained Task Decomposition Design (fork-decompose)

> For the cross-session implementation plan, see `plans/FORK_DECOMPOSITION_PLAN.md` at the repository root (step checkboxes and progress are authoritative in that file); this document is the mechanism design baseline; landed deviations must be written back here.
>
> **Landed status (2026-09-05)**: steps 1-4 are implemented and committed on the auto-core branch (`f481ba822` phase-specific decompose prompts / `8c6a18ff2` subtask artifacts as files + index-style wrapup / `0e95e0dcb` experiment-switch environment-variable layer / `00bad6a04` fork three-stage pipeline); `bun typecheck` / `bun test` all green (304 cases in auto-core, 27 in the auto shell; new unit tests test/switches.test.ts and test/runner.test.ts). For the A/B experiments and the finalization of default values see §11; promotion of the constitutional keys awaits the experiment conclusions.

## 1. Background and Motivation

The current subtask pipeline in auto mode has three structural problems:

1. **Coarsened granularity has a structural cause**: every subtask session must on its own 「阅读相关源码与 docs/」 ("read the relevant source code and docs/", decompose.md step 1); the finer the granularity, the larger the fixed cost of repeated exploration, so the model and the prompts tend to merge aspects into coarse-grained subtasks; coarse-grained sessions bloat their context → slow, expensive, more likely to trigger handovers.
2. **The decompose prompt is not phase-aware**: what "one aspect" means differs completely across the analysis, design, implementation, test, acceptance, and knowledge-distillation phases; a single decompose.md cannot give accurate splitting criteria.
3. **wrapup synthesis is costly**: the closing session reads the full set of artifacts to rewrite a summary report, a second token expenditure that is prone to distortion.

This revision adds two more motivations:

4. **The granularity rule lacks a baseline**: saying only "one aspect, one subtask" still leans toward task-level aggregation; it fits "task decomposition" better than "subtask decomposition". Subtask decomposition should take the task description as its basis and choose granularity within the scope it prescribes (files/modules/interfaces/behaviors/scenarios named in the description are natural splitting units); and granularity should come in two tiers, standard and fine, controlled by an independent switch for empirical comparison.
5. **The mechanism combination needs an experimental loop**: whether fork is enabled, whether the fork base is the end of the understand session or a digest session, and whether the over-limit handover steer is kept are all candidates among multiple options; a switch channel that changes no CLI interaction is needed for A/B testing, with promotion to constitutional-level configuration only after things are settled.

The opencode SDK already has session forking built in: `client.session.fork({ sessionID, messageID? })` (the `Session2` class of the `@opencode-ai/sdk/v2` client used by the driver, `POST /session/{sessionID}/fork`), which copies the message prefix into a new session at a specified message point (default = all). The fork prefix is verbatim-identical to the baseline system context, which is friendly to the provider prompt cache: the understanding cost is paid once, and each fork's incremental input cost is far lower than re-reading files. auto-core does not currently use this capability.

## 2. Goals and Non-Goals

**Goals**

1. A three-stage "understand → decompose → execute": the understand session loads the background once; the decompose session and every subtask execution session inherit context from the **fork base** with no re-reading.
2. Phase-specific (a/d/m/t/v/k) decompose prompts, with granularity rule = "task description as the baseline + one aspect per subtask + floor protection", plus a fine-grained tier that can be enabled via a switch.
3. Subtask artifacts become standalone files (`docs/<id>/S<NN>.md`); wrapup writes only an index, integrating by reference.
4. With `fork: "off"` (or when fork fails), behavior is exactly the status quo.
5. Two selectable fork-base modes: `session` (the end of the understand session, fullest information) and `digest` (a new base session created with context.md as input, leanest prefix, rebuildable from disk); the default is settled after empirical comparison.
6. During the experimental period, all switches are injected via `OPENCODE_AUTO_*` environment variables and parsed inside the core, with zero changes to the CLI shell.

**Non-Goals (first phase)**

- Parallel subtask execution (dependency-group DAG, concurrent-commit rework) - a later extension;
- Reworking the `subtask=off/ondemand` modes;
- Context inheritance for independent-verdict sessions such as verify/review/judge (see the invariants, §9);
- Promoting the switches to constitutional keys (ProjectConfig keys + init persistence + run rejection flag) - done separately once the experiments settle; path in §4.6;
- Hybrid base (session for decompose, digest for subtask execution) - open question (§11).

## 3. Overall Flow

```
T-001(subtask=auto, fork=on)
  ├─ ① understand session (brand new): selectively read source/docs within budget, write the digest docs/T-001.context.md, then end
  │     driver writes task field  - fork-base: <①'s sessionID>   ← session mode; persisted on disk, an interrupted run can fork from it again
  ├─ ①′ (fork-base=digest only) context-base session (brand new, driver-led):
  │     prompt = full text of context.md + 「确认理解,简短回复」 ("confirm understanding, reply briefly"); no workspace changes, no commit
  │     driver rewrites  - fork-base: <①′'s sessionID>        ← a volatile pointer rebuilt from disk on every run
  ├─ ② decompose session = fork(end of fork-base): prompt = decompose-<phase> template
  │     (granularity baselined on the task description; the fine-grained section is injected when the fine switch is on)
  │     writes docs/T-001.subtasks.md → driver setSubtasks injects into PLAN.md (existing mechanism unchanged)
  └─ ③ subtask i (serial): session = fork(end of fork-base, the same fork point)
        prompt = subtask template + the full checklist + "执行第 i 项" ("execute item i") + the output-file convention
        session ends → driver checks the item off + unified commit (unchanged)
  wrapup session (no fork, keeps the in-chain reuse rules): index-style report
```

Entry conditions: auto mode, no checklist in the task body, `fork=on` → run ① (and ①′) first, then ②; `fork=off` → go directly through the status-quo `ensureDecomposed()` (no understand session added). Tasks that already have a manual checklist skip ① and ②. ① is idempotent: when `docs/<id>.context.md` already exists (recovery from interruption / a leftover from a previous round), the understand session is skipped and only a missing `fork-base` is backfilled. The interrupted-injection path for an existing `docs/<id>.subtasks.md` is unchanged (if a usable fork-base exists, ③ forks as usual; otherwise cold start).

## 4. Key Mechanisms

### 4.1 Understand Session and Digest File

- New template `understand.md` (full text in §6): read-only understanding, **selective reading** within budget (prioritizing files named in the task body and directly related modules), writing a four-section digest to `docs/<id>.context.md` (relevant files & key symbols / constraints & preconditions / existing decisions & current state / risks & unknowns), and ending as soon as it is written.
- Driver-side `ensureUnderstood()`: the same skeleton as `requireArtifact` (two retries + silent block), commit stage `"understand"`; on success it writes the task field `fork-base: <sessionID>` (in session mode this is the final base; in digest mode it is later overwritten by ①′). Idempotent skip when the digest file already exists, backfilling only a missing `fork-base` (the recovery path for an interruption that lands exactly between the digest being written to disk and setForkBase).
- **The digest file is the on-disk fallback**, with three uses: cold-start input when fork fails; a low-cost reference for wrapup/verify/subsequent tasks; manual audit (the "understandable from disk alone" philosophy). It is not a replacement for fork: fork saves the round trips of repeated reading, while the digest is the degradation channel and the long-term memory.
- In digest mode it is also the **base material**: context.md is injected verbatim into the base session and becomes the prefix of all forks, so the template requires the digest to be compact (recommended within 200 lines; see §6, constraint 4).

### 4.2 fork base: session | digest

The base = the session from which the decompose/subtask sessions uniformly fork, persisted as the PLAN.md task field `fork-base` (same-named field in both modes, meaning "fork base session" in both).

- **`session`**: the base = the end of the understand session.
  - Pros: the prefix contains the source actually read and the exploration process, giving decomposition and execution the fullest grounding, with no line-level detail lost;
  - Cons: the prefix size is uncontrolled (it depends on how much was explored); approaching `cap/2` triggers the cold-start guard; on a provider cache miss the prefix is billed in full; a base sessionID that expires across runs can only fall back to cold start.
- **`digest` (default)**: once understanding completes, the driver creates a **brand-new base session**: the prompt = the full text of context.md + a request for one sentence of confirmation (template in §7), run through `runSession` as a one-shot chain (`{ pct: 100, used: 0, at: 0, subject: "T-NNN ctxbase …" }`, carrying no phase and writing no progress record); the `chain.id` after it ends is the base, and `setForkBase` overwrites the field with the `digest:` prefix. **(Revised 2026-09-18) Once established, the base persists across runs**: every later run (including recovery from interruption and re-runs while subtasks are not all complete) first checks that the persisted base is alive; if alive, it reuses the same sessionId and keeps forking instead of rebuilding on every run; only when it has expired (storage cleanup) is it rebuilt from context.md and the field overwritten. Once established, the base session is only forked and never prompted again; its prefix is always the full digest text, so reuse introduces no drift (the cost: manual edits to context.md between runs are no longer reflected into the base automatically; deleting the `fork-base` field triggers a rebuild, and the original "unconditional rebuild" semantics happen to cover this scenario, a registered trade-off).
  - Pros: the prefix = a compact digest (size controllable and predictable, highest cap utilization, the `cap/2` guard essentially never triggers); **deterministically rebuildable from disk**: when the base sessionID expires, rebuilding from context.md restores it (if context.md is unchanged the prefix is verbatim-identical and the provider cache still hits), so "base expired" only costs one rebuild and is not a degradation;
  - Cons: the raw detail of the exploration process is lost; when a subtask needs specific code it must read files back following the digest's pointers (targeted read-back is far cheaper than blind exploration, but it is one extra hop);
  - The confirmation turn makes no workspace changes, and `commitTree` naturally skips a repository with no changes (no empty commit is produced); in both modes the base persists across runs (digest too, since 2026-09-18).
- **Fallback chain**: persisted digest base alive → reuse directly; expired / never established → digest rebuild; digest turn fails (still a session error after three transient retries) → fall back to the session base (the current run's understand session is still alive) → then fall back to cold start.

### 4.3 fork Session Creation and Fallback

- `forkSession(client, base, title)`: `base` is the effective base selected per §4.2; wraps `client.session.fork({ sessionID: base })`; on `{data}` take `.data.id`; on `{error}` or any exception → log 「↻ fork 失败(原因),回退全新会话」 ("↻ fork failed (reason), falling back to a brand-new session") → `undefined`. **Written as an injectable dependency** (testable with a fake client). An external legacy `--server` without this route is an expected fallback scenario, not an error. After a successful fork, the new session is renamed to the current phase's commit title (`session.update`, aligned with git history / task progress; a failure is only logged in detail).
- `SessionChain` gains two fields:
  - `forkBase?: string` - the fork base (the effective base session);
  - `pending?: string` - a pre-created session id; `attempt()` consumes it first when `!reuse` (equivalent to the result of `session.create`), cleared once consumed.
- Call ordering (**fork first, then render**, so that the warm/cold prompt is chosen correctly):
  0. Resumption takes precedence over forking: the chain still has a live session and a recovery note is pending injection → do not fork; the first prompt goes into the reused session (`warm = true`);
  1. Before forking, go through the server handle `syncAgents()` (same as the create path; if AGENTS.md has changed, restart the server first, then fork);
  2. `const forked = await forkSession(client, forkBase, title)`;
  3. Success → `chain.pending = forked`, `warm = true`; failure → take the `session.create` path, `warm = false`;
  4. Render the prompt (the warm conditional section is in the subtask template, §8);
  5. `runExecSession(...)` → `attempt()` consumes `pending`.
- Transient-error retries (the three retries of `runSession`) open a brand-new session: `pending` was already consumed by the first attempt, so retries naturally fall back to the create path and the feedback loop is unaffected.

### 4.4 Chains and Context Accounting

- **New seeded chain per phase/subtask**: `{ pct: 100, used: <基点用量>, at: 0, forkBase }` (the `used` placeholder denotes the base session's usage); `pct:100` forces no reuse on the first turn (fork takes priority); seeding `used` makes `watch()`'s 2×cap steer threshold account for "prefix + new input".
- Source of the base usage: within the same run, take the base session's `chain.used` (session mode = the understand session's tracked value, taken directly from tracking when the base happens to be a session on the chain; digest mode at creation time = the base confirmation session's tracked value, ≈ the digest size, tiny). A resumed run reconstructs it via `client.session.messages({ sessionID })` from the last assistant message's `tokens.input + tokens.cache.read` (an approximation suffices: the first turn's event tracking corrects it itself; if unavailable, use 0) - since 2026-09-18, reuse of a persisted digest base uses the same basis.
- Feedback retries within the same subtask can still naturally reuse the current session (reuse rules unchanged); **across subtasks there is no reuse**: each item forks anew from the base. wrapup and verify repair rounds do not fork: wrapup keeps the in-chain reuse rules (it may reuse the last subtask session, same as the status quo).
- When the base usage reaches `cap/2`, the driver does not fork and cold-starts directly (to keep the prefix from approaching the cap; essentially never triggers in digest mode).
- **steer switch** (`OPENCODE_AUTO_STEER=off`): `runSubtask`/`executeWhole` (ondemand) build no steer, so the 2×cap handover prompt is not injected; **and the post-session `used < 2×cap` handover check is disabled along with it** (otherwise a session that ends naturally but over budget would be wrongly asked to write a supplementary handover document). Once disabled, a session either completes naturally or ends via a provider-side compaction/cap error (errors go through the existing "session error" path of retrying in a new session; on-disk progress and unified commits are unaffected). The test handover of `--handover-test` is an independent mechanism, unaffected by this switch; `used`/`pct` accounting is always kept (the basis for reuse decisions and logs).

### 4.5 Interrupted-Run Recovery

- `PhaseKind` gains `"understand"` (persistStage / recovery routing aligned with the existing decompose handling).
- `.auto/progress.json` semantics unchanged (single session field, active per session); the fork base persists in the PLAN.md task field `fork-base` (digest bases carry the `digest:` prefix, distinguishing them from the understand session id), and a resumed run re-acquires the base accordingly: **digest mode first checks that the persisted base is alive, reusing it if alive and rebuilding from context.md only if expired** (since 2026-09-18; previously an unconditional rebuild); session mode checks liveness, and an expired sessionID (storage cleanup) → automatic fallback to cold start. If session mode encounters a leftover field with the `digest:` prefix (the base mode was switched mid-run), it strips the prefix and checks; a live digest base is likewise reused as a warm prefix.
- The PLAN.md field-line mechanism (`  - key: value` immediately after the title and contiguous) carries the new field automatically, with zero changes to the parsing rules; `setForkBase()` is written by the driver alone.

### 4.6 Runtime Switches: Environment-Variable Layer (experimental period)

Naming follows the core's existing precedent `OPENCODE_AUTO_SERVER` (src/server.ts). **Parsed once inside the core (memo), consistent across the whole pipeline, zero CLI-shell changes**: during the experimental period there is no need to touch the command-line interaction of shells like `packages/auto`.

| Env var | Value domain | Default | Scope |
|---|---|---|---|
| `OPENCODE_AUTO_FORK` | on\|off | on | Master switch: off = the status-quo pipeline (no understand session, no forking), zero behavior change |
| `OPENCODE_AUTO_FORK_BASE` | session\|digest | digest | Base mode, only meaningful when fork=on (§4.2) |
| `OPENCODE_AUTO_DECOMPOSE_FINE` | on\|off | on | Fine-grained decomposition: the decompose-\<phase\> template injects the fine-grained rule section (§5.1) |
| `OPENCODE_AUTO_STEER` | on\|off | off | Over-limit handover steer (2×cap): off = disables injection and the post-session handover check (§4.4) |

- Parsing (implemented as a standalone `src/switches.ts`: the `parseSwitches` pure function lets unit tests drive it by directly constructing env records + the `autoSwitches` memo accessor): an empty-string value counts as unset; an invalid value throws a Chinese-language error (including the variable name and the expected value domain) → CLI exit code 1 (consistent with the configuration philosophy of "failing strictly on bad files"). Parsed once at the runner entry; the `runTask` startup log lists the effective **non-default** items (the default combination stays silent; verbose can show the full set).
- **Not persisted to disk**: environment-variable overrides are written back to no state file (unlike the init persistence of constitutional keys); the experimental semantics = this run only; switches are constant within a run and never change mid-session.
- **Promotion path**: once a switch is settled empirically → promoted to a constitutional-level key (e.g. `fork: "on" | "off"`) into `ProjectConfig` + init persistence + run exiting 1 when the corresponding flag is present (modeled on `--auto-number`); at that point the environment variable can remain a runtime override channel (priority env > config) or be retired, to be decided separately. The constitutional-key scheme in §4.5 of the original design is exactly this path, deferred during the experimental period.

### 4.7 Artifacts as Files and Index-Style Integration

- Subtask artifact files are mechanically named by the driver: `docs/<id>/S<NN>.md` (NN two digits, incrementing), avoiding slug-sanitization ambiguity; the title goes on the first line of the file. Code artifacts are the source tree itself and are not duplicated into documents.
- The wrapup report (`docs/<id>.report.md`) becomes index-style (auto mode): one line per subtask (index + one-sentence conclusion + artifact path), without copying artifact content; it only adds overall-conclusion / leftover-issues sections. off/ondemand (solo, no subtask artifacts to index) keeps the summary-style report.

## 5. Phase-Specific Decompose Prompt Rules (decompose-\<phase\>)

### 5.1 Common Rules (new `_partials.md` section `decompose-rule`)

Premise: what this pipeline does is **subtask decomposition**: splitting execution units within the scope prescribed by the task description, not re-drawing the task's scope. The granularity baseline = the task description itself:

```
2. 分解粒度准则(以任务描述为基准——在其规定的范围内选择粒度,不扩大、不缩小):
   - 一个方面一个子任务:调研、实现、文档、接线等不同性质的工作不合并为一项;
     任务描述点名的文件/模块/接口/行为/场景是天然的切分参考;
{{#if fine}}   - 细粒度模式:按任务正文点名的文件/模块/接口/行为/场景等自然单元逐一
      成项,宁细勿粗——fork 流水线已消除子任务间重复理解的固定开销,细项的边际
      成本低;细项间显式排出可执行顺序,依赖前项的排在后;
{{/if}}   - 每项自包含:仅凭该项描述、CURRENT.md 与 docs/ 即可执行,并包含验证方式;
   - 每项声明产出:文档类注明文件路径,代码类注明模块/文件范围;
   - 上限导向:每项以单个会话用较小上下文(约 {{contextBudget}} tokens 量级)可完成为宜;
```

(`contextBudget` = `formatTokens((contextLimit ?? 64_000) / 2)`; `fine` is the boolean parsed from the switches; both are injected via `baseCtx`. The template engine evaluates a partial's conditional sections at the same level as templates: `renderPartial` renders recursively with the same ctx, so `{{#if fine}}` written inside a `_partials.md` section takes effect directly. The fine-grained section is still bound by each phase's floor-protection clause; see §5.2 m.)

### 5.2 Phase-Specific Rules (per-template difference sections)

- **a analysis** (`decompose-a.md`):

```
   - 按问题/疑点/子系统/风险面切分:每项回答一个明确的问题(如"模块 X 的数据流是
     什么"、"某类 API 差异清单"、"某风险是否存在");
   - 每项产出一份独立分析文档,写入 docs/ 下独立文件;
   - 本阶段只产出分析与结论,禁止修改任何实现代码;
```

- **d design** (`decompose-d.md`):

```
   - 按设计关注点切分:数据模型、API 契约、模块边界、错误处理、迁移策略等各自成项;
   - 每项产出一份设计文档,含备选方案取舍与理由;
   - 跨关注点一致性检查(各设计文档之间是否矛盾)必须作为独立的收尾子任务;
```

- **m migration implementation** (`decompose-m.md`, default phase):

```
   - 垂直薄切片优先:一条可调用路径端到端成项,不按水平层(先全部 schema 再全部
     实现)切分;
   - schema/接口、实现、接线、文档等不同方面分开成项;
   - 下限保护:每项完成时源码树保持一致——可编译、既有测试不倒退;禁止拆出会留下
     破损中间状态的碎片;
   - 存在依赖顺序时按可执行顺序排列(依赖前项的排在后);
```

- **t test** (`decompose-t.md`):

```
   - 按测试面/场景族切分:每项对应一个测试文件或一族紧密相关的场景;
   - 写测试与修缺陷分离:测试暴露的实现缺陷作为独立修复项追加,不与写测试混在
     一项;
   - 测试执行遵守测试执行协议(启用 --test-by-driver 时脚本交 driver 执行);
```

- **v acceptance** (`decompose-v.md`):

```
   - 按验收维度切分(功能符合度、文档完备性、环境与运行、回归等),每维度一项;
   - 每项产出一份核验记录(核验方式、证据、结论),写入 docs/ 独立文件;
   - 只核验与记录,不做修复(差距走既有终审闭环);
```

- **k knowledge distillation** (`decompose-k.md`):

```
   - 按知识产物切分:坑点清单、可复用模式、README/交接文档等各自成项;
   - 每项产出一份独立文档,可被后续任务直接引用;
```

### 5.3 Template Skeletons and Selection Logic

- The six templates share one skeleton: the existing decompose.md's head/taskBlock/blocked/mode sections + 「你本次只做任务分解,不写实现代码。当前处于阶段 {{phaseName}}」 ("this time you only do task decomposition and write no implementation code; the current phase is {{phaseName}}") + `{{> decompose-rule}}` + the phase-specific rule section + the checklist-item format (`- [ ]`, self-contained description, artifact noted at the end) + the existing constraint sections (decomposition only / state-rule / question-rule / hard requirements / end as soon as written).
- `renderDecompose` uses the template name `decompose-${opts.phase ?? "m"}`; if the library has no such name it falls back to `decompose`. Target-directory overrides take effect by name (`.opencode/auto/prompts/decompose-m.md`); all six are registered in `PROTOCOL_MARKERS` as `["- [ ]"]`.
- `baseCtx` gains `phase`/`phaseName`/`contextBudget`/`fine`.

## 6. Full understand Template Text

```
{{> head}}

当前任务(完整内容同时见 CURRENT.md):

{{taskBlock}}

{{#if blockedAnswered}}该任务此前被阻塞。上次的问题:"{{question}}",已获解答:"{{answer}}"。请据此继续。

{{/if}}{{#if blockedUnanswered}}该任务此前因以下问题被阻塞:"{{question}}"。用户未提供解答,直接重新运行了 driver,说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。

{{/if}}{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}你本次只做任务背景理解,不写实现代码、不做任务分解:

1. 围绕该任务的目标,有选择地阅读相关源码与 docs/(控制阅读总量,优先任务正文
   点名的文件与直接相关模块,不求全);
2. 把理解结果写入 docs/{{taskId}}.context.md,包含四节:
   ## 相关文件与关键符号(路径 + 为什么相关,一两句)
   ## 约束与前提
   ## 已有决策与现状
   ## 风险与未知
3. 写完该文件后立即结束会话。

约束:
1. 只读理解:不修改任何实现代码;{{> state-rule}}
{{> question-rule}}
3. 写出该文件是硬性要求:不产出有效文件会导致任务阻塞停机;
4. 该文件是后续所有子任务会话的背景摘要来源——写得紧凑、可检索(建议 200 行
   以内;fork-base=digest 时本文件会被逐字注入分叉基点会话,成为全部后续会话的
   前缀);后续会话默认继承本会话已加载的上下文,仅缺漏时回读此文件。
```

(marker: `["context.md"]`; render function `renderUnderstand`.)

## 7. Full context-base Template Text (digest base session)

```
以下内容是任务 {{taskId}} 理解阶段产出的背景摘要(docs/{{taskId}}.context.md 全文)。
本会话由 driver 建立,将作为该任务后续会话(分解、子任务执行)的分叉基点——后续
会话带着这份摘要上下文继续工作。

{{digest}}

请通读上述摘要并确认已理解:回复一句简短确认即可。不要读取文件、不要展开分析、
不要修改任何内容,确认后立即结束会话。
```

(Registered in the embedded registry + imported `with { type: "file" }`; no driver-parsing protocol, not registered in `PROTOCOL_MARKERS`; render function `renderContextBase(task, digest)`, where `digest` = the full text of context.md.)

## 8. subtask / wrapup Template Additions

**subtask.md** (on top of the existing template):

- Task-list section (replacing the existing single-item presentation):

```
本任务的完整子任务列表(按序执行,其他项由其他会话完成,不要碰):

{{subtaskList}}

你本次只负责其中的第 {{index}} 项:

- [ ] {{subtask}}
```

- Background section (warm/cold conditionalized in a single template; warm applies to both the session and digest bases):

```
{{#if warm}}本会话已继承任务背景上下文(理解阶段的摘要与已加载内容),无需重读已在
上下文中的文件;如仍缺背景,可读 docs/{{taskId}}.context.md 摘要。{{/if}}{{^warm}}如存在
docs/{{taskId}}.context.md,先读之了解任务背景再开始(不存在则按需自行阅读源码)。{{/if}}
```

- Output convention section:

```
产出约定:本项若产出文档/分析/设计类内容,写入 {{outputFile}}(独立文件,标题写在
首行,不并入其他文档);代码类产出直接落于源码树。
```

(`outputFile` = `docs/<id>/S<NN>.md`, mechanically named by the driver. `subtaskList`/`outputFile` both carry a conditional fallback: when the caller does not provide them, `renderSubtask` derives the index/list/artifact file from the task body's checklist items, and renders the single-item presentation when there is no list, so old calls that pass no arguments remain complete; `runSubtask` currently passes `index`/`warm`, with the list and artifact file derived.)

**wrapup.md**: the report becomes index-style: one line per subtask (index + one-sentence conclusion + artifact path `docs/<id>/S<NN>.md` or code location), without copying/rewriting subtask artifact content; only two new sections, overall conclusion and leftover issues (solo mode keeps the summary style; see §4.7).

## 9. Invariants (the implementation must not break them)

1. **Driver-exclusive state writes**: PLAN.md/CURRENT.md/verified (including the new field `fork-base`) are all written by the driver; `protect.ts` needs no change (driver writes are already allowed through).
2. **Unified commits**: the per-session `afterSession` commit is unchanged; fork only changes how sessions are created, not git behavior (the digest base session makes no workspace changes, so naturally zero commits).
3. **Independent-verdict sessions never fork**: the verify-judge/review/review-fix/final family of sessions are created brand new: independent judgment is the cornerstone of completion determination.
4. **Serial execution**: at most one session writes target-directory files at any moment (the assumption stated explicitly in the current comments).
5. **Completion determination does not rely on self-reporting**: subtasks are still checked off by the driver (trust + task-level acceptance as the backstop); fork does not change when check-offs happen.
6. **Exit-code semantics** unchanged.
7. The runtime dependency surface on the opencode server only adds the fork route, with automatic fallback on failure: external `--server` compatibility does not degrade.
8. **Experimental switches only read the environment**: the environment-variable layer writes no state files; parsed once, consistent across the whole pipeline; nothing enters `ProjectConfig` before promotion to constitutional keys.
9. **The base session is driver-led**: the context-base session is created by the driver and its prompt is assembled by the driver; the AI only confirms and produces nothing; the `fork-base` field is always written by the driver alone.
10. **steer=off changes no determination or commit semantics**: it only disables 2×cap handover injection and the handover check; check-offs, acceptance, and unified commits proceed as before.

## 10. Fallback Matrix

| Scenario | Behavior |
|---|---|
| fork=off | Status-quo flow, zero change (no understand session) |
| fork call returns error / throws (legacy route, base cleaned up) | log, then a brand-new session + cold-start prompt |
| Base usage > cap/2 | The driver does not fork; cold start directly (digest bases are tiny, essentially never triggers) |
| A resumed run finds the base sessionID expired | session mode: fall back to cold start; digest mode: rebuild the base from context.md (since 2026-09-18, rebuilt only on expiry: if alive, the persisted base is reused directly instead of rebuilding on every run) |
| digest base session fails to be established (session error ×3) | Fall back to the session base (the current run's understand session) → then to cold start |
| understand produces no context.md in two tries | Silent block (existing requireArtifact semantics) |
| context.md missing + cold start | The prompt already covers it (「不存在则按需自行阅读源码」, "if absent, read the source code on your own as needed") |
| steer=off and the session hits the provider cap | Session error → the existing retry in a new session (RETRIES=3); on-disk progress is not lost |

## 11. Risks and Open Questions

- When the provider cache misses, the fork prefix is billed in full: the cold-start path + `fork=off` are the fallback; the log also prints the base usage for human judgment.
- The SDK's return shape for fork sessions (landed): take `.data.id` from `{ data }`; the three branches, `{error}` and call exceptions included, are handled uniformly in `forkSession` (isomorphic with `session.create`), covered by fake-client unit tests (test/session-api.test.ts).
- **A/B experiment matrix** (the basis for settling defaults and the promotion scope): {fork on\|off} × {fork-base session\|digest} × {fine on\|off} × {steer on\|off}; metrics: task wall-clock time, total tokens (input / cache.read counted separately, taken from chain.used tracking and logs), handover and retry counts, number of subtasks and average per-subtask context, verify/review pass rate. Note that fine=on together with fork=off reproduces the old cost structure of "fine granularity × repeated exploration"; it is a control group only, not recommended for daily use.
- Digest distortion in digest mode: when the digest lacks detail, subtasks must read files back following its pointers; session mode and the cold-start prompt are the fallbacks; **hybrid base** (session for decompose to keep grounding, digest for execution to keep a lean prefix) is a candidate improvement, not in the first phase.
- The digest confirmation turn relies on model self-discipline (it should reply with a single sentence): the semantics of fork's `messageID` have been confirmed in the source (see the last item of §11.1), but removing the confirmation turn on that basis would leave the fork's last message a user message; whether providers accept two consecutive user messages needs real testing, so the implementation is left unchanged for now.
- When the digest runs overlong (the model ignores the compactness advice), the digest prefix's advantage narrows: the `cap/2` guard and the understand template's line-count advice are the backstops.
- With steer=off, long sessions may trigger provider-side compaction instead of a handover: comparing the quality difference between "compaction to stay alive" and "handover to a new session" is exactly one of the experiment's goals; mechanically, neither breaks on-disk progress or unified commits.
- Later extensions (not this phase): dependency-group declarations and parallel read-only subtask groups; a protocol for annotating dependency order in `subtaskList`.

### 11.1 Rejected: using a "minimal opening session" as the global fork base

`AUTO-DECISION: 不引入任务无关的「开局基点」会话(先用极简输入如 hi 建一个会话完成 system 组装与缓存预热,此后全流水线会话都从它分叉)——opencode 的 fork 语义决定这条路没有净增益。已否决,记录如下备查。`

- **fork only carries messages**: `Session.fork` (`packages/opencode/src/session/session.ts:693`) clones each message's info and parts (including tool outputs) one by one; it does not copy agent / model / permission, does not set `parentID`, and **copies no system context whatsoever**.
- **The system is rebuilt on the spot every turn**: `session/prompt.ts` re-evaluates `SystemPrompt.environment` / `Instruction.system()` (reads AGENTS.md, CLAUDE.md, `config.instructions`; see `session/instruction.ts`) / `SystemPrompt.skills` / `SystemPrompt.mcp` at every step, then `session/llm/request.ts` assembles the system together with the agent contract, and the tool set is recomputed per agent/permission; on the auto side, every `client.session.prompt` explicitly carries `agent` (`attempt` in `src/runner.ts`). So forked sessions and brand-new sessions receive **exactly identical** systems and tools: AGENTS.md and tool context apply unconditionally to brand-new sessions anyway and need no fork to carry them over.
- **The cacheable prefix does not grow**: the `system + tools` prefix is verbatim-identical on both paths; an opening session does not enlarge the reusable prefix, and on the contrary adds one extra user/assistant message pair to every fork (a plain-text base is token-equivalent to "injecting the same piece of text into every first-turn prompt", plus one extra assistant turn).
- **Cache warm-up yields no gain**: the first real session of this run completes the warm-up; a dedicated opening session merely moves the warm-up one turn earlier and pays one extra inference round trip.
- **The concern that "the base must be rebuilt once AGENTS.md changes" does not hold**: AGENTS.md is re-read on the spot every turn, so forked sessions never carry stale content; the existing `syncAgents()` (`src/server.ts`, restarts the server on a fingerprint change) already covers both paths, creating a new session and forking.
- **Scope of the conclusion**: the only thing fork alone carries over is **message history (including tool outputs)**. That is why bases like §4.2's digest / session bases, ones that "have already read the files and formed an understanding", still stand; a task-agnostic opening base has nothing to carry over. In the future, if the goal is merely for more sessions to share a fixed piece of text, simply make it a common `_partials.md` partial injected into every first-turn prompt.
- **(Open question closed) `messageID` semantics**: `msgs.slice(0, target)`, where `target` = that message's index: it copies up to just **before** the specified message, excluding it. Forking at the digest confirmation turn's assistant message id yields a deterministic prefix that "contains only the digest user message"; but the session forked that way ends on a user message, and issuing another prompt would form two consecutive user messages: whether providers accept that **needs real testing**, so this time only the semantics are recorded and `ensureForkBase` is not changed.
