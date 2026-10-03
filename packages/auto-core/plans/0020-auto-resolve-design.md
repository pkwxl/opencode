# Design: separating autonomous decisions (AUTO-DECISION) from auto-resolved decisions (AUTO-RESOLVE)

Status: **Implemented** (2026-09-12; T-001..T-008 all landed, `bun typecheck` passes,
`bun test` 616 pass). Plan file `plans/AUTO_RESOLVE_PLAN.md` (contains the motivation, the confirmed stances, and the
eight-task breakdown). This document does two things: ① fix the stances/criteria/schema/hooks/report messages as the single basis for implementation;
② record T-001's verification of every code location cited by the plan, plus **four corrections** (§J). Design-baseline line numbers follow the
auto-core branch `bf745fa94` (before the changes); the end of the §G table appends the actual post-implementation landing points (backfilled in T-008).

Style follows `plans/0019-stats-timing-design.md`. The ledger and report mechanisms are always on with zero switches, persisted in the target
directory's `.auto/resolves.json` (inside gitignore, driver-exclusive writes, not on the protect list); **the sole
new switch `OPENCODE_AUTO_ASK` governs question strategy**, not log level.

## A. Motivation

Today a single marker `AUTO-DECISION` carries two things of completely different natures:

1. **Pure engineering discretion** — the AI picks among several reasonable implementation options on its own (algorithms, internal structure, naming, file
   organization, test style). This was always the AI's to make; the record exists only for archiving.
2. **Suppressed questions** — the `question-rule` at `templates/prompts/_partials.md:14` explicitly
   requires that, apart from permission-related problems, "需求歧义、多种合理方案、数据异常、环境缺失" (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) all **must not
   call the question tool**. These divergence points should have been decided by the user; the unattended pipeline has the AI close the loop
   in the user's place so as not to stop.

With both mixed into one marker, category 2 drowns in category 1: a task produces a dozen-plus `AUTO-DECISION` lines and the user has no way to
tell which ones are actually "the system decided on my behalf".

The driver side is **completely blind** to both categories: `autoAnswer` at `src/runner.ts:74` auto-answers non-permission questions,
`src/runner.ts:2620` prints a `→ 自动答复: …` (auto-answer) line and moves on; that line drowns in the session
log — the task-end report (`src/loop.ts:1006` taskEndLines) does not mention it, the phase close
(`src/loop.ts:1028`) does not, the round completion (`src/loop.ts:1048`) does not. After a 24-task round,
you cannot know how often the system decided for humans without digging through the logs.

The two rules are **causally bound**: precisely because `question-rule` suppresses questions, the decisions are invisible; precisely because they are
invisible, forced recording becomes necessary. The existing design persists this causal chain as the only form, so even scenarios where "the plan is already complete enough that
the AI needs no discretion" are forced to produce large amounts of AUTO-DECISION traces.

Goal: split "proxy decisions" out of "autonomous decisions", giving them the separate marker `AUTO-RESOLVE`, a separate ledger,
and a separate highlight report channel; and turn that causal chain into **two switchable question strategies** so the amount of recording matches the scenario.

## B. Stances (confirmed decisions)

- **`AUTO-DECISION`** = an autonomous decision made in the AI's thinking process, exercising its own judgment among several reasonable technical
  options on engineering and architectural merit. It belongs to regular engineering logs, **no terminal highlight**.
- **`AUTO-RESOLVE`** = a decision that should have been asked of the user but was automatically waved through or answered in their place. A pending interactive
  divergence point exists, and the AI closes it (Resolve) for the user. **Highlighted and pinned** at task end.
- **The question strategy and the AUTO-DECISION recording obligation advance and retreat together**, switched by a single switch (§E). Binding them
  is dictated by causality: suppress questions -> decisions invisible -> must record; allow questions -> decisions surface as questions
  -> no separate trace needed. Splitting them into two independent booleans would create a "suppress questions and don't record" combination with neither visibility nor
  trace; not offered.
- **Under the ask mode `AUTO-DECISION` is not "a lowered bar" but "not required"**. For traces, use the default
  suppress mode; for lightweight, use the ask mode and let the questions themselves carry visibility. No "adapt by architectural sensitivity" style
  middle tier that requires AI self-assessment — that would stack a fuzzy threshold on top of the ownership criteria; two soft criteria in series are only less
  controllable than one.
- **Only fallback auto-answers count as AUTO-RESOLVE**. Questions genuinely answered by a human under `--wait-answer` do not count
  (the `if (human)` branch at `src/watch.ts:317`) — that is a real person's decision.
- **Dryrun pre-check sessions do not count**. The pre-check only probes permissions (the
  `opts.dryrun ? false : …` at `src/watch.ts:301`) and produces no engineering decisions.
- **Display tiering reuses the existing `vlog` channel; no new switch for "how much to show"**. `src/log.ts:11-34` already
  provides three tiers: `--verbose` terminal+file, `--interactive` file only, and under the shell `audit` profile
  `vlog` always writes the log file. Routing the AUTO-DECISION count through `vlog` means "quiet by default, traceable when needed".
- **`AUTO-DECISION` does not enter the ledger**. `collectAgentResolves` returns only a count for it and does not persist to
  `.auto/resolves.json` — the ledger's reason to exist is driving the highlight; since AUTO-DECISION does not participate in the highlight it needs no
  line-level persistence, and its persistent trace is anyway the marker lines themselves, which go into git.
- **A separate file, not merged into `stats.json`** — stats has high-frequency 30s heartbeat writes (incremental persistence in `src/stats.ts`);
  stuffing in a growing array of question texts would make every heartbeat rewrite the full text.
- The persistent audit trail rests on two things that enter git: the `AUTO-RESOLVE:` marker lines themselves in code/docs, and
  the 「自动代答问题」 (auto-resolved questions) section of `docs/T-NNN/report.md`. `.auto/resolves.json` is only the driver's
  basis for counting and highlighting; losing it does not affect correctness.
- Ledger write failures are **fully silent** and never affect flow or exit codes (copying stats' robustness stance).

## C. Hard discrimination criteria (the core of the rule text, must be nailed down)

What it asks is **who the decision right over a divergence point should originally belong to**, not how important the decision is.

- Belongs to the **user** -> `AUTO-RESOLVE`: requirement intent and scope trade-offs (whether to do it, how far), externally visible behavior
  and interface-contract changes, acceptance criteria, fact-confirmation questions (anomalous data, missing environment, state contradicting the
  docs), touching the task-description boundary (exceeding/narrowing the plan's literal scope). **In the prompt, “验收口径” (acceptance criteria) is rendered as
  “「什么算做完」的判定标准” (the standard for judging "what counts as done")** — when `config.verify === false` the prompt must not contain the word “验收”
  (acceptance); see §M for the reason.
- Belongs to the **AI** -> `AUTO-DECISION`: choice of implementation means where no option changes user-visible behavior
  (algorithms, internal structure, naming, file organization, injection approach, test style).
- The same decision is not marked twice; **when unsure, mark `AUTO-RESOLVE`** — better to over-remind once; under-reporting is
  this mechanism's real loss.

Positive and negative examples (written into the rule copy):
- Scope trade-off -> AUTO-RESOLVE: "whether to also close out the third copy of `formatTokens` in `prompt.ts`"
  (changes task scope; the user should have been asked).
- Naming trade-off -> AUTO-DECISION: "call the new field `matched` or `paired`" (neither option changes
  user-visible behavior).

## D. Marker syntax and parsing

```
AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)
AUTO-DECISION: <决策> (<理由>)
```

The existing `AUTO-DECISION` form `AUTO-DECISION: <决策与理由>` stays compatible — the parenthesized segment is optional,
so existing documents need zero changes (`src/stats.ts:239` and other existing marker lines are unaffected). (Placeholders in the two blocks above read: original question, chosen option, reason; decision and reason.)

`parseResolveLine` (pure function) parsing rules:

- Separators accepted: `->` / `→` / `=>`; reason segments accepted: `(…)` / `(…)`;
- **One line is the boundary, never spanning lines**; equally valid inside code comments and in markdown body text (comments are legitimate marking spots;
  `src/stats.ts:239` is the precedent);
- Inline prefixes allowed (`// AUTO-RESOLVE: …`, `- AUTO-RESOLVE: …`);
- **Fault tolerance first**: with no arrow the whole line becomes `question`, `option`/`reason` left empty, **still counted**,
  and the report flags `⚠ 格式不规范` (malformed format) — under-reporting one auto-resolve costs far more than format fastidiousness.

## E. Question-strategy switch `OPENCODE_AUTO_ASK`

The only new switch this time, registered in the `SWITCH_ENV` registry at `src/switches.ts:12` (experimental semantics = this run only,
nothing persisted; promotion to a constitutional key is discussed once things settle — the established path written in that file's header comment). Two values,
parsed `onOff`-style (`src/switches.ts:204`); the default `off` is **byte-for-byte equivalent to the status quo**:

| Value | Question strategy | AUTO-DECISION | Primary source of AUTO-RESOLVE |
|---|---|---|---|
| `off` (default) | Suppress: never ask non-permission questions, decide autonomously | **Marking required** (status quo) | Voluntary agent marking, driver observation as a supplement |
| `on` | Allow: divergence points that belong to the user get **actively asked** | **Not required**, no penalty for not marking | **Driver observation**, authoritative and complete |

The `on` mode moves the ownership criterion from "what to mark afterwards" up front to "whether to ask": divergence points whose decision right belongs to the user
**are asked via the question tool**; pure implementation means are decided autonomously with no trace needed. Under this mode the driver side needs **no
new logic at all** to obtain a complete record: the AI asks -> `question.asked` event -> a human answer is recorded as a human
decision (not counted); unattended, `AUTO_ANSWER` falls back and lands in the ledger. The §G H1 hook serves both modes unchanged.

**Why `on` is stronger than the default mode**: under the default the driver sees only the few cases of "the AI broke the rule and asked anyway";
the vast majority of auto-resolves rely on AI diligence, and missing marks are undetectable (§K). The `on` mode turns the observation surface from a minority into the full set
— questions are events flowing through the driver, so the AI cannot slip one past even if it wants to. The cost is one session round-trip per question.

**Byproduct: the question count is a plan-completeness metric**. A complete plan -> few questions -> a nearly empty ledger; dense questioning ->
a noisy highlight block -> the plan has holes. No extra mechanism needed.

**Precedent alignment**: `OPENCODE_AUTO_DECOMPOSE_FINE` (`src/switches.ts:15`, parsed at
`:233`) is exactly an `onOff` switch that changes prompt rendering; its `{{#if fine}}` conditional section lives inside
the `decompose-rule` partial at `_partials.md:29` — this switch is isomorphic to it, down to the same hook file.

Wiring surface (covered one by one in T-002, **five places**, see §J-4): `SWITCH_ENV`, the `Switches` type,
`SWITCH_DEFAULTS`, `parseSwitches`, `nonDefaultSwitches` and `formatSwitches`.

**Render-side injection takes "unified exit" rather than "per-function pass-through"** (T-002 implementation decision): the `fine` precedent
passes `opts.fine` through render functions one by one because it serves only the `decompose-<phase>` family, where the pass-through surface is controllable;
`question-rule` is referenced by 23 templates, spanning 25 render exits in `src/prompt.ts` and
six callers across runner/loop/final/implement/knowledge/numbering; per-function pass-through would silently miss newly added templates.
Hence `src/prompt.ts` gains a module-private `renderPrompt(name, ctx)` as this layer's
single render exit, uniformly injecting `ask: autoSwitches().ask`; all 25 `renderTemplate(` call sites switch to it;
an `ask` given explicitly in ctx wins (mirroring the `src/step.ts:41` rule at `opts.x ?? autoSwitches().x`,
so unit tests can drive both modes directly). The cost is that `prompt.ts` goes from a pure data-assembly layer to reading switches — but
`check.ts` / `step.ts` / `runner.ts` already read them the same way; no new mechanism is introduced.

## F. Persistence schema (`.auto/resolves.json`, compact JSON, v:1)

```ts
export type ResolveSource = "driver" | "agent"

export type ResolveItem = {
  at: number
  task: string          // T-NNN; bypass sessions use the pseudo-task PLAN/AUTO (pseudoTask, src/runner.ts:570)
  phase: string         // phase letter, "" when unknown
  round: number
  session?: string      // driver source carries the session id
  source: ResolveSource
  question: string      // driver source = the raw question text; agent source = the marker's <原问题> (original question) segment
  option?: string       // parsed from the agent source's <所选方案> (chosen option)
  reason?: string       // parsed from the agent source's <理由> (reason)
  file?: string         // agent source: the marker's `路径:行号` (path:line)
  malformed?: boolean   // agent source: marker missing arrow/reason segment
  matched?: boolean     // driver source: a matching agent marker has been found
}

// decisions: per-task AUTO-DECISION counts (added in T-006; integers only, no line-level detail)
export type ResolveDoc = { v: 1; items: ResolveItem[]; decisions?: Record<string, number> }
```

**Why AUTO-DECISION still persists a count** (T-006 decision; not in contradiction with "AUTO-DECISION does not enter the ledger":
what is not persisted is **line-level detail**, what is persisted is one integer per task). §H-④ requires folding that count into the highlight block's
last line, but the scan happens at the runner's session wrap-up while the display happens at the loop's task close, separated by multiple sessions
and possible process restarts — memory cannot carry it across; the alternative "hang the count on `Outcome` and pass it back to loop" would pierce three
outcome branches and be lost on process restart; rejected. The key-count cap is likewise **512**, FIFO-evicting the earliest-written task.

Public API (the first parameter is always `dir: string | undefined`; undefined = no-op,
isomorphic to `src/stats.ts`):

- `recordResolves(dir, items)` — appends to the ledger; dedupes by `source + task + 归一化 question`
  (normalized question); total cap **512** entries with FIFO eviction (never reached in practice: a 24-task round x single digits per task).
- `collectAgentResolves(dir, ctx)` — scans this session's changed workspace files and extracts
  both `AUTO-RESOLVE:` and `AUTO-DECISION:` markers; the former go to the ledger, the latter accumulate into per-task counts (merged with
  marker persistence as a single read-modify-write). Returns `{ resolves: number; decisions: number }`.
- `parseResolveLine(text)` — the §D pure function, driven directly by unit tests.
- `recordDecisions(dir, task, n)` / `decisionsOf(dir, task)` — accumulate and read back the counts.
- `resolvesOf(dir, scope, id)` — `scope ∈ task | phase | round`; reads back filtered by bucket identity.
- `resolveHighlight(items, opts)` — pure function building the highlight report lines (§H), driven directly by unit tests.
- `sameIssue(a, b)` — **hoisted from `src/runner.ts:2889` into this module and exported**, with runner switched to
  import it (precedent for such consolidation: the formatter consolidation in `src/log.ts`). Serves runner's duplicate-question detection as well as
  ledger dedup and driver<->agent pairing.

**Robustness** copies the existing `src/stats.ts` techniques: atomic writes (`.tmp → rename` + write-queue serialization,
`src/stats.ts:296`), per-field lenient parsing (bad = missing without a throw, mirroring `resume.ts`
`parseProgress`), all write failures silently swallowed by `catch`.

**Scan scope and cost**: takes uncommitted changed files, **traversing repository by repository via `repoRoots`** (nested sub-repositories are
the norm in this project, see §J-2); skips binaries and files over 2MB; line-by-line regex. Same order of magnitude as the existing
`autoCorrectRefs` (`src/refcheck.ts:609`), same hook, completed within the same session wrap-up.
Non-git directories return empty and the mechanism naturally no-ops.

## G. Hook table (line numbers per `bf745fa94`)

| # | Location | Action |
|---|---|---|
| H1 | `src/runner.ts:2614-2624` question.asked auto-reply branch | Push into the turn's `resolves[]` only when `human === undefined` and not dryrun; the `:2620` log line becomes highlight-style. **Shared by both modes; under `on` this is the primary source** |
| H2 | `src/runner.ts:208` `Watch` type + `:2421` `snapshot()` | Add `resolves?: ResolveEvent[]`, carried out uniformly by **7** `return snapshot` exits (fully isomorphic to `usage`, STATS_PLAN P3 precedent; count see §J-1) |
| H3 | `src/runner.ts:2271` vicinity, after `attempt`'s `await watching` | `statsSessionEnd` alongside `recordResolves(opts.dir, …)`, adding task/phase/round/session |
| H4 | `src/runner.ts:106` start of `afterSession` | `collectAgentResolves(dir, …)`, **hoisted before the early return for `opts.commit === false \|\| opts.dryrun` at `:112`** — collection is auditing and must not be gated by the commit switch. Under `on` it degrades to a backstop (the AI may still voluntarily mark), not skipped: if marked, it is collected |
| H5 | `src/loop.ts:413` / `:426` / `:437` task three-state lines | The highlight block prints **before** (pinned above) the `✓/⏸` conclusion line (`taskEndLines`, `:1006`) |
| H6 | `src/loop.ts:687` phase close (`phaseCloseLines`, `:1028`) / `:369`+`:719` round completion (`roundCompleteLines`, `:1048`) | Summary count line, likewise pinned above the `■` line |
| H7 | `src/prompt.ts:184` `renderWrapup` + `templates/prompts/wrapup.md` | Inject the driver-observed auto-resolve list; require report.md to write the 「自动代答问题」 (auto-resolved questions) section |

**Post-implementation landing points (backfilled in T-008; line numbers per the auto-core worktree after the large-file split of 2026-09-16)**:

| # | Landing point | Notes |
|---|---|---|
| H1 | `src/watch.ts:317-323` | When `human === undefined` and not dryrun, `resolves.push({ at, question, session })`, then immediately prints `⚑ 自动代答(AUTO-RESOLVE)第 N 个: …` (proxy answer #N); the original `→ 自动答复: <长文案>` (long auto-answer text) demoted to `vlog` |
| H2 | `src/chain.ts:49` (`Watch.resolves`) + `src/watch.ts:63` `snapshot()` | Carried out uniformly by **7** `return snapshot` exits (`:238` / `:290` / `:332` / `:394` / `:449` / `:474`·`:477` / `:500`) |
| H3 | `src/attempt.ts:231` | After `await watching`, `attempt` calls module-private `recordDriverResolves` (`:32`), zero IO with nothing observed; the round number is taken on the spot from `currentRound` |
| H4 | `src/unit-commit.ts:101` (inside `afterSession`, from `:55`) | `collectAgentResolves` **before** the early return for `opts.commit === false \|\| opts.dryrun` |
| H5 | `src/loop-task.ts:196` / `:215` / `:228` | The three-state lines are preceded by `taskResolveLines` (`src/conclusion.ts:34`); block body via `resolveHighlight`; the AUTO-DECISION count folded into the last line via `decisionsOf` |
| H6 | `src/loop-phase.ts:301` (phase) / `src/loop-task.ts:125`+`src/loop-phase.ts:341` (round) | `phaseResolveLines` (`src/conclusion.ts:42`) / `roundResolveLines` (`src/conclusion.ts:50`), count lines only |
| H7 | `src/prompt.ts:199` `renderWrapup` + private `resolveList` (`:212`) + item 4 of `templates/prompts/wrapup.md` | The two call sites `src/runner.ts:488` and `src/review.ts:92` first read the ledger via `wrapupResolves` (`src/unit-commit.ts:115`) |

Rule-text hook: the `question-rule` partial at `templates/prompts/_partials.md:14-21`, referenced by
**23** templates via `{{> question-rule}}` (list in §J-3); changing this one spot takes effect for all of them —
that is why the partial is changed rather than each template. **The partial name stays `question-rule`** (overrides in the target
directory's `.opencode/auto/prompts/_partials.md` match by section name; renaming would make existing overrides fail at render
time). `_partials.md` is not in `PROTOCOL_MARKERS` (`src/template.ts:98`); **this change adds no**
protocol marker for `question-rule` — a protocol marker means "a basis the driver parses out of session output", whereas
AUTO-RESOLVE's parse targets are marker lines scattered through documents and code, not template outputs.

Also update the auto-reply copy at `src/runner.ts:69-98` (the `AUTO_ANSWER` constant has become an `autoAnswer(ask)` function): it states
"**这是一个被代答的提问**" (this is a proxy-answered question); `off` mode appends "请以 `AUTO-RESOLVE:` 标注,不要记成 `AUTO-DECISION`" (mark with AUTO-RESOLVE:, do not record as AUTO-DECISION); `on`
mode requires no marking (the driver has already fully recorded on the event side) and only says to continue deciding autonomously. The call site `src/runner.ts:2618` reads the value once, serving both the reply and the log line. Item 4 of `MAINT_RULE` at `src/agents-block.ts:33`
mentions `AUTO-DECISION`; add one sentence distinguishing the two marker types (in English, same language as the rest of that block's copy).

## H. Report messages (draft copy)

**① In-session, immediate** (H1; replaces the existing `→ 自动答复: …` (auto-answer) line at `src/runner.ts:2620`; draft below kept verbatim in the original Chinese):

```
⚑ 自动代答(AUTO-RESOLVE)第 2 个:是否把 prompt.ts 的第三份 formatTokens 一并收口?
  → 已代答,要求会话以 AUTO-RESOLVE 标注决策
```

**② Task-end pinned block** (H5; printed only when `items` is non-empty; draft below kept verbatim in the original Chinese):

```
⚑ 本任务自动代答了 3 个本应由你确认的问题,请重点确认:
  1. 是否把 prompt.ts 的第三份 formatTokens 一并收口 → 顺带收口(同层依赖,不引入反向 import)
     src/prompt.ts:501
  2. 折旧入账是否同样过 MAX_TICK 钳制 → 同样钳制(宁少不多)
     src/stats.ts:84
  3. 验收口径是否包含并发场景  ⚠ 会话未按要求写出 AUTO-RESOLVE 标记
  完整记录见 docs/T-001/report.md 的「自动代答问题」节
✓ T-001 完成: 用时 24 分 31 秒(AI 18 分 12 秒),会话 7 次
  tokens 入 1.2k / 出 340 / …
```

Beyond **8 entries**, only the first 8 are listed, with a final line `…另有 N 条,全部见 docs/T-NNN/report.md` (...N more, all in docs/T-NNN/report.md).

**③ Phase close / round completion** (H6; draft below kept verbatim in the original Chinese):

```
⚑ 阶段 m 共自动代答 7 个待确认问题(其中 1 个未按要求标注),逐条见各任务报告
■ 阶段 m 迁移实现 收口: 总用时 52 分…
```

**④ AUTO-DECISION collapsed into a count** (H4 returns the count), never competing with AUTO-RESOLVE for layout space:

- When the task has AUTO-RESOLVE entries, the count folds into the highlight block's last line:
  `  另记录 AUTO-DECISION 5 条(已折叠,见任务报告)`; (also recorded: AUTO-DECISION 5 entries, collapsed; see the task report)
- Without AUTO-RESOLVE, only one `vlog` line `ℹ T-001 记录 AUTO-DECISION 5 条` (info: T-001 recorded 5 AUTO-DECISION entries), never the terminal
  — zero new terminal lines in the common case;
- Phase/round summaries **never display** AUTO-DECISION at all: a cross-task accumulated "127 decisions" is not actionable
  information for anyone.

The count itself is still useful: it is evidence that the scan actually ran, and a gut-feel indicator of whether the marking threshold has run away (a stable
double-digit count per task = the threshold is not being obeyed; tighten the §C rule copy).

The wording system matches the six existing conclusion lines (`plans/0019-stats-timing-design.md` §F): each of `✓/⏸/■/⏳/↻/◉`
has its own role; the highlight block uses **the new prefix `⚑`** and occupies only the pinned top position, without encroaching on existing symbol semantics.

## I. Wrap-up closed loop (H7)

The driver injects the auto-resolve list observed for this task (listing first the ones **with no matching agent marker found**) into the wrap-up
prompt; `templates/prompts/wrapup.md` gains a new conditional section (the draft below, quoted verbatim in the original Chinese, requires every listed proxy answer to appear in the report):

> 本任务执行期间 driver 自动代答了以下本应询问用户的问题:…
> 请在 `docs/{{taskId}}/report.md` 中单列「自动代答问题」一节,逐条写
> `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`;上面列出的每一条都必须出现,
> 你自主识别到的其他代答决策一并列入。

`renderWrapup` is a synchronous pure function (`src/prompt.ts` only does data assembly, see AGENTS.md), so the list
is read out by the two call sites (`runTask`'s wrap-up and `verifyTask`'s wrap-up after the fix rounds) via the module-private
`wrapupResolves(dir, task.id)` (`resolvesOf` + `catch` swallowing to empty) and then passed in as
`opts.resolves`.

**Implemented (T-007)**:

- The conditional section is the wrap-up prompt's **item 4** (the first three are documentation updates / report.md / acceptance ownership), governed by the same
  sentence "以上全部完成前不要结束会话" (do not end the session before all of the above is complete); when the whole `{{#if resolveList}}` section disappears, the result is byte-for-byte equivalent to
  the pre-change form.
- The list **contains driver-source entries only**: agent-source entries are ones the session has already marked itself, and reporting them again is pure noise; **unmatched
  (`matched` unset) ones come first** (§I's "list first the ones with no match found") — they are exactly the ones most likely to be missing from the report.
- **No count cap, no body truncation**: the prompt demands "every one listed above must appear", and dropping entries would contradict that demand;
  only the raw question's newlines and runs of whitespace are squeezed into a single line (a multi-line question would wreck the list structure), and empty
  questions take no slot.
- Pre-concatenation lives in `src/prompt.ts` private `resolveList()` (the template syntax deliberately has no loops; list-like data is
  concatenated into a string by the caller, see the `src/template.ts` header comment), not reusing `resolveHighlight`/
  `compactText`: the terminal highlight wants 80-character truncation while the prompt wants full text — the two requirements run in opposite directions.

This closed loop frees persistent recording from relying on AI diligence: the part the driver observed is forcibly written into git.

## J. Survey results (T-001's verification of the plan's references)

The locations cited by the plan **check out one by one**; the following four places need correction or supplementation, and later tasks defer to this section.

1. **`watch()` has 7 return exits, not 8** (plan §5 H2 says "8"). Counting
   `return snapshot(...)` one by one: 2530 / 2581 / 2610 / 2672 / 2727 /
   2752 / 2767 in `src/runner.ts`, 7 in total (the `return { type: … }` inside `handleIdleTest` is another type and does not
   go through snapshot). STATS_PLAN made the same mistake and already recorded it in `plans/0019-stats-timing-design.md` §G;
   this plan carried over that stale number. **No forcing numbers to fit — the one-by-one count is authoritative**.
2. **The changed-file scan must go through `repoRoots`, not a single `git -C dir status`** (plan §3 writes
   `git -C dir status --porcelain` + `git diff --name-only HEAD`). This project's target directories often contain nested
   git sub-repositories, and the existing code always traverses repository by repository: `gitChangedFiles`
   (`src/loop.ts:910`, module-private) dispatches through `repoRoots(directory)` to
   `gitStatusFiles` (`:919`, `--porcelain -z --no-renames -uall`, also skipping nested-repository directories folded into the output to avoid
   duplicates); the `autoCorrectRefs` side does the same (the `src/refcheck.ts:461`
   `git diff HEAD --name-only -z` runs per root). T-004 should export `gitChangedFiles`
   for reuse, or mirror its nested traversal — **do not write a new flat scan**.
3. **"23 templates reference `question-rule`" is accurate; the list in the plan matches reality exactly**:
   `decompose.md` and `decompose-a/d/k/m/t/v.md` (seven), `whole` `subtask` `fix`
   `review` `review-fix` `verify-judge` `verify-script-gen` `phase-plan`
   `phase-handover` `knowledge` `prior-knowledge` `understand` `implement-plan`
   `infer-source` `final-task` `number-recovery`. `_partials.md` itself defines the section (`:14`)
   and is not counted.
4. **T-002's switch wiring surface is four places; the plan lists only three**: besides `SWITCH_ENV`
   (`src/switches.ts:12`), `SWITCH_DEFAULTS`, `parseSwitches` (around `:233`),
   `nonDefaultSwitches` (`:245`), there is also **`formatSwitches` (`:267`)** — the verbose log describing the full set of
   switches enumerates them item by item too; missing it would leave `ask` absent from the full log.
5. The accurate sources of the pseudo-task precedent are `pseudoTask()` (`src/runner.ts:850`) and its call at
   `runner.ts:847` (`AUTO`); `PLAN` appears at `src/loop.ts:539`/`:630`,
   `src/numbering.ts:115`、`src/final.ts:262`、`src/implement.ts:46`、
   `src/knowledge.ts:63`/`:183`; the plan's cited `resume.ts:89` is only the `Progress.task` field
   declaration, not a pseudo-task construction point.

Locations that check out and need no correction (line numbers per `bf745fa94`, **before** the T-003 changes): `runner.ts:70`
(AUTO_ANSWER), `:89` (afterSession; `:94` is the commit/dryrun early return), `:2418` (`autoAnswered` local), `:2593`
(duplicate-question detection), `:2597-2606` (auto-reply branch), `:2871` (`sameIssue`, indeed normalized substring
containment), `:679`/`:1424` (renderWrapup call sites); `loop.ts:413`/`:426`/`:437`,
`:687`, `:369`/`:719`, `:1006`/`:1028`/`:1048`; `prompt.ts:184`, `:501` (the third private
`formatTokens`, matching what the §H sample copy points at); `switches.ts:15`/`:233`;
`agents-block.ts:33`;`template.ts:98`;`log.ts:11-34`;`behavior.md:205-208`;
`test/loop-conclusion.test.ts` exists (T-006 extension point).

## K. Risks and boundaries

1. **Missing marks are the default `off` mode's fundamental limitation; `on` largely dissolves it**. Under `off`, `question-rule`
   discourages the AI from calling the question tool, and the driver's observation surface covers only the few cases of "the AI called the tool anyway and got the fallback
   auto-answer"; the vast majority of AUTO-RESOLVE relies on voluntary marking, and missing marks are undetectable; the mitigations are the wrapup
   forced self-check + hard-coded criteria + mark AUTO-RESOLVE when unsure. The "unmarked" count **is meaningful only for the part the driver
   observed** and must not be read as the overall miss rate. **Use the `on`
   mode when auditable auto-resolve records are needed** — this advice must also go into the README, otherwise users will assume the default mode's count is complete.
2. **The `on` mode adds two costs**. ① One session round-trip per question (tokens and wall time); ② with more questions, the duplicate-question
detection at `src/watch.ts:302` triggers more easily — `sameIssue` uses normalized **substring
containment** (`x.includes(y) || y.includes(x)`, `src/resolve.ts:142`): a short question contained by a long one is judged the same
question, and a hit aborts the session and blocks with exit code 2. The mitigation is that `autoAnswered` is a local inside `watch()`
(`src/watch.ts:76`), scoped to the current turn rather than the whole task, so the misjudgment radius is limited; but the `on`-mode smoke test must
   specifically verify this; if false blocks appear, **tighten `sameIssue` (switch to equality + a length-ratio threshold) rather than abandon
   duplicate detection** — the duplicate-question stop is a safety net against AI spinning; it must not be dismantled.
3. **Mis-marking risk (the reverse direction)**: the AI may, playing it safe, mark pure engineering trade-offs as AUTO-RESOLVE too; once the highlight block turns to noise,
   users stop reading it. Mitigations: criteria with positive/negative examples, reports truncated to 8 entries, phase/round counts only. If smoke testing
   shows noisification, **tighten the criteria copy rather than add a switch**.
4. **Cross-contamination of the two modes' copy**: `off` teaches "ask little, mark much", `on` teaches "ask when you should, no need to mark",
   within the same partial. If the conditional sections are written sloppily (say the marking requirement left outside `{{#if}}`), the `on` mode would
   render self-contradictory text like "do not ask but do mark". After T-003 this is gated by the two §L assertions — the byte-for-byte comparison, and no
   `AUTO-DECISION` wording — plus one manual re-read of each mode's rendered output.
5. **Mode choice is a human judgment; the program does not make it for them**: only the plan's author knows whether the plan is complete; there is no "auto-detect
   plan completeness then switch modes". The default stays `off` (status-quo semantics, zero behavior change); `on` is the user's explicit
   declaration about their own plan's quality.
6. The ledger lives in `.auto/` and never enters git (guaranteed by `ensureGitignore`, `src/loop.ts`); after switching machines or clearing
   `.auto/`, counting restarts from the present (same nature as stats: a local-machine run footprint, not a source of truth). The persistent
   trace lives in the marker lines and the report.md section, both of which enter git.
7. **Two concurrent runs in the same directory are unsupported** (later writes overwrite) — the same accepted boundary as `stats.json`.
8. **A manual rollback-and-rerun of the same task is indistinguishable from an interrupted resume** -> manual procedure:
   `rm .auto/resolves.json` before rerunning (same procedure as stats).
9. The scan is session-triggered and only looks at uncommitted changes: if a session produced no file changes, agent markers from that session are
   not collected — but with no file changes there are no markers to collect, so this is not a hole.
10. **Under `--commit false` the AUTO-DECISION count runs large** (T-006 note): the accumulation rule holds on the premise that
    "each scan sees only this session's uncommitted changes" (afterSession commits everything right after scanning). Without commits,
    changes pile up across sessions and the same batch of markers is seen repeatedly — the AUTO-RESOLVE side absorbs this via the dedup key, the count side
    cannot, since it stores no line-level detail. Accepted boundary: that count is a gut-feel indicator of "has the marking threshold run away", not a
    source of truth — and `--commit false` itself already breaks the premise (the whole H4 scan is built on it).
11. **Zero breakage of core invariants**: exit codes unchanged (the `on`-mode duplicate-question block goes through the existing exit-code-2 channel);
    the driver's exclusive write of state files unchanged (`.auto/resolves.json` is runtime state, not on the protect
    list); unified commits unchanged; independent-judgment sessions not forking unchanged; the new `OPENCODE_AUTO_ASK` only reads the
    environment and persists nothing, per "experimental semantics = this run only".

## L. Implementation steps and tests (checklist)

| Step | Content | Landing point | Status |
|---|---|---|---|
| T-001 | This design document + the §J survey | No code changes | ✅ this task |
| T-002 | `OPENCODE_AUTO_ASK` switch wired in five places + unified injection of `ask` at the render exit, **no copy changes** | `switches.ts` / `prompt.ts` | ✅ 563 pass |
| T-003 | `question-rule` rewritten for both modes + `autoAnswer` turned into a function + the `MAINT_RULE` extra sentence + the `whole`/`subtask` clauses made conditional | `_partials.md` / `runner.ts:69` / `agents-block.ts:33` / two templates | ✅ 567 pass |
| T-004 | all of `src/resolve.ts` + `sameIssue` hoisted up + `changedFiles` hoisted into git.ts + `test/resolve.test.ts` | New module | ✅ 593 pass |
| T-005 | driver collection wiring H1..H4 + seven cases in `test/runner.test.ts` | `runner.ts` | ✅ 600 pass |
| T-006 | report output H5/H6 (three pinned-block constructor functions + five call sites) + per-task AUTO-DECISION counts | `loop.ts` / `resolve.ts` | ✅ 612 pass |
| T-007 | wrap-up closed loop H7 (`renderWrapup` gains a `resolves` parameter + the `wrapup.md` conditional section + two call sites reading the ledger) | `prompt.ts` / `wrapup.md` / `runner.ts` | ✅ 616 pass |
| T-008 | documentation sync (this file backfills §G landing points + status + §Q, structure.md, behavior.md, README, AGENTS.md navigation) | Docs | ✅ 616 pass |

**Unit tests** (`test/resolve.test.ts`, mkdtemp style following `test/stats.test.ts`):
`parseResolveLine` six states (full three segments / `→` and `=>` variants / Chinese parentheses / no-arrow malformed
but counted / no reason segment / inline prefix); ledger round-trip, lenient handling of corrupt files, dedup, the 512-cap FIFO, concurrent writes leaving no
`.tmp` residue; `collectAgentResolves` (no-op in non-git directories, binaries and oversized files skipped,
AUTO-DECISION counted but not persisted, driver<->agent pairing via `sameIssue` setting `matched`, **nested sub-repository
changes collected**); `resolveHighlight` (empty list returns empty, truncation past 8 entries, malformed carries ⚠,
wording of unmarked items); `resolvesOf` filtering across the three scopes with bucket-identity guards.

**Runner tests** (`test/runner.test.ts`): `Watch.resolves` = number of auto-answers; a human answer
(`--wait-answer` hit) not counted; dryrun not counted; the blocked exit does not lose resolves; `AUTO_ANSWER`
copy of both modes hit respectively.

**Switch tests** (`test/switches.test.ts`): `ask` defaults to `off`; `on`/`off` parsing; empty string treated as
unset; illegal values throw including the variable name and the value domain; `nonDefaultSwitches` and `formatSwitches` both list it when set to
that mode.

**Prompt tests** (`test/prompt.test.ts`): all 23 templates render under both modes; **the `off`-mode
render is compared byte-for-byte against the pre-change output** (evidence for T-002's "wiring only, no copy changes" promise); the `on` render contains no
`AUTO-DECISION` wording; the `wrapup` conditional section in both the with/without-resolves states.

**Manual smoke test** (credentialed environment, the `auto/` integration branch): run a task that will really ask a question -> see the ⚑ immediate line and
the task-end pinned block; answer manually within `--wait-answer` -> confirm it is not counted; `kill -9` mid-run then rerun ->
the ledger resumes with entries neither lost nor duplicated; `rm .auto/resolves.json` -> runs as usual; **under `on`, specifically verify the §K-2
duplicate-question false block**.

## M. Decision record (T-003 rule-text changes)

- **AUTO-RESOLVE: whether to also make the AUTO-DECISION clauses of `whole.md` / `subtask.md` conditional by mode
  -> make them conditional too (the plan §4 file list names only `_partials.md`, `runner.ts`,
  `agents-block.ts`, so this item exceeds its literal scope; but the two templates' "若必须修改按 AUTO-DECISION 记入相关文档"
  (if you must modify something, record it into the relevant documents as AUTO-DECISION) is unconditional text — left unchanged, the `on` mode would be saying "no trace needed" while still teaching the session to leave traces, exactly
  the two-mode contamination §K-4 guards against)**. The change: `(若必须修改,{{^ask}}按 AUTO-DECISION 标注并{{/if}}记入相关文档)` (if you must modify something, {{^ask}}mark as AUTO-DECISION and{{/if}} record into the relevant documents) —
  the `off` mode keeps the current wording verbatim, and the `on` mode is left with only "记入相关文档" (record into the relevant documents).
- **AUTO-DECISION: the ownership criterion "验收口径" (acceptance criteria) is rewritten as "「什么算做完」的判定标准" (the standard for judging "what counts as done")**
  (`templates/prompts/_partials.md`). When `config.verify === false` the prompt must not contain the
  "验收 (acceptance)/verify" wording (the standing rule in the `src/prompt.ts:14` comment); `test/prompt-exec.test.ts` /
  `test/prompt-phase.test.ts` each guard that invariant with `not.toContain("验收")`; the criteria list is referenced unconditionally by 23 templates, and embedding
  `{{#if verify}}` would cut in half a criterion unrelated to the verify switch — rewording is cleaner with no loss of meaning.
- **AUTO-DECISION: the two modes' conditional sections join their opening/closing tags to the content on the same line** (`…{{/if}}{{#if ask}}…`).
  `src/template.ts:277`'s standalone detection makes a block tag alone on its line swallow the whole line together with its newline, but the
  newline left between the two branches falls outside the branches and is **emitted unconditionally**, leaving an extra blank line at the end of the partial that glues onto the caller's
  "3." line. This constraint is written into the `_partials.md` header for later maintainers.
- **AUTO-DECISION: the `on`-mode "contains no AUTO-DECISION wording" assertion excludes `knowledge.md` /
  `prior-knowledge.md` / `phase-handover.md`** from its scope. These three require the session to summarize the decisions marked AUTO-DECISION in existing documents;
  what they read are historical markers that always live in git, orthogonal to "whether this run leaves traces",
  so both modes keep them.
- **AUTO-RESOLVE: whether both modes' `autoAnswer` copy states "这是一个被代答的提问"
  (this is a proxy-answered question) -> both state it** (plan §4 only requires the `off` mode to append marking guidance). Making the session recognize that it is deciding in the user's place is that copy's
  primary function, independent of whether marking is required; dropping the sentence under `on` would make the auto-answer read like an ordinary
  "do whatever you think".
- **AUTO-DECISION: the `AUTO_ANSWER` constant becomes an `autoAnswer(ask)` function rather than two constants**
  (`src/runner.ts:74`). The opening segment shared by both modes is written once; the call site
  (`src/runner.ts:2618`) reads the value once, serving both the reply and the log line, avoiding two separate reads that could leave
  the log inconsistent with the actual reply.

## N. Decision record (T-004 `src/resolve.ts`)

- **AUTO-RESOLVE: how the changed-file scan reuses `gitChangedFiles`' nested traversal -> hoist
  `gitChangedFiles`/`gitStatusFiles` from `src/loop.ts` up into `src/git.ts` and export as
  `changedFiles(dir)` (§F only says "export for reuse or mirror the traversal", and both paths have real flaws; this item changed
  T-004's literal file scope — a scope trade-off that should have been asked of the user)**. Exporting from `loop.ts` would create a
  loop -> runner -> resolve -> loop circular dependency (resolve is consumed by both runner and loop);
  mirroring a copy in resolve.ts would leave two repository traversals that must evolve in lockstep. `git.ts` is a leaf module (depending only on
  log.ts) that already holds `repoRoots` and the same porcelain parsing; the two consumers each reference it one-way,
  the same technique as the `log.ts` formatter consolidation. On the `loop.ts` side only a one-line import changes.
- **AUTO-RESOLVE: whether the syntax-explanation line (`AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`; original question -> chosen option (reason)) is
  collected -> not collected (skipped when the question segment is entirely a `<…>` placeholder)**. This design document, `wrapup.md` (T-007)
  and `src/resolve.ts` itself all contain format samples; without the skip, any task touching these files would collect a
  fake auto-resolve — exactly the noisification §K-3 guards against. The criterion is "the question segment is entirely an angle-bracket placeholder"; no wider pattern
  matching, to avoid hitting angle brackets in real questions.
- **AUTO-DECISION: the report shows only the driver<->agent merged result** (`resolveHighlight` drops the
  driver entries with `matched` set). One auto-resolve leaves one ledger entry per source (different sources, different dedup keys — the audit
  needs both sides), but at display time the agent entry carries more information (chosen option/reason/marker location), and listing the paired driver entry again
  would waste layout; unpaired driver entries are kept and named with ⚠ as "会话未按要求标注" (the session did not mark as required) — the
  §H draft report is exactly this shape.
- **AUTO-DECISION: a missing reason segment sets `malformed` just like a missing arrow** (the §F schema comment's wording "缺箭头/理由段"
  (missing arrow/reason segment)). Both share `⚠ 格式不规范` (malformed format) in the report; the only difference is that with a missing arrow the whole line falls into the question segment.
- **AUTO-DECISION: `collectAgentResolves`' return count is "the number of markers seen by this scan", not
  "the number of new ledger entries"**. It answers "did the scan actually run, and how many markers did it see" (the use of the §H-④ count:
  evidence the scan ran and a gut-feel indicator of the marking threshold); on an interrupted resume that rescans the same files the count should be stable, whereas
  new ledger entries would zero out through dedup.
- **AUTO-DECISION: the read-modify-write is serialized as a whole** (a per-dir write queue in `update`), rather than stats.ts's
  "in-memory single writer + write queue". This module has no resident in-memory document (entries are appended sporadically per session; no 30s heartbeat needed),
  and every persistence must first read the existing entries back for dedup and `matched` re-pairing, so the unit of serialization is the whole read-modify-write.
- **AUTO-DECISION: each report entry's text is squeezed to one line and truncated at 80 characters**. The driver source's `question` is the
  raw question, possibly multi-line and possibly very long; pasting it whole into the conclusion line would drown the highlight block; the full original text lives in the ledger and the task report,
  and truncation only affects the terminal glance.

## O. Decision record (T-005 driver-side collection wiring)

- **AUTO-RESOLVE: whether a permission question's fallback after the `--wait-answer` timeout counts as an auto-resolve -> it counts
  (§B only says "only fallback auto-answers count", without splitting permission/non-permission; under the ownership criteria this is a trade-off that should have been asked
  of the user)**. A permission question's fallback is equally the driver deciding in the user's place (the `ask-*` three-tier timeout fallbacks each have their own semantics,
  but "no human answered, the driver decided" is the same fact); omitting it would leave absent exactly the category of auto-resolve most worth seeing. The cost is that
  permission-type entries mix into the ledger, naturally distinguishable by the raw `question` text.
- **AUTO-RESOLVE: whether AUTO-DECISION's task-level count (the number §H-④ folds into the highlight block's last line) is
  implemented in this task -> not implemented, left to T-006 (beyond H1..H4's literal scope)**. H4 returns once per session the
  "number of markers seen by this scan"; the task-level aggregation rule is decided by the report side: under `--commit true` (the default)
  each session scans only its own changes, so summing per session is correct; under `--commit false` a later scan re-sees the previous one's
  markers, so summing double-counts. This trade-off belongs to T-006's report decisions; this task only logs each scan's count into the
  `vlog` detail log (§H-④'s "evidence the scan actually ran") and builds no cross-session accumulator.
- **AUTO-DECISION: `compact` is hoisted up into the exported `compactText`** (`src/resolve.ts`). The in-session
  immediate line (§H-①) and the highlight block display the same question text; single-lining and the 80-character truncation rule should not each be written once.
- **AUTO-DECISION: `afterSession` and `autoAnswer` are exported for unit tests** (the same "testable exits of internal wiring" pattern as `gatedAutoCorrectRefs`/
  `askHuman`). H4's "collection before the commit switch's early return" and the two modes' reply copy
  have no other reachable path; unexported, both could only be checked by manual re-reading.
- **AUTO-DECISION: H3's persistence is factored out into module-private `recordDriverResolves`, zero IO with nothing observed**. A turn
  without questions is the norm; in that case neither the round number is read nor the ledger file touched — the round number is taken on the spot only when an auto-resolve actually happened.
- **AUTO-DECISION: the round number is derived on the spot via `currentRound(dir)`, not read from stats' in-memory handle**.
  `currentRound` is the existing derived source of truth (one readdir); stats exports no round-number read port, and opening one just for this
  would make the two modules share the same cached state — not worth it.
- **AUTO-DECISION: the in-session immediate line's second line takes copy by mode** (`off` = "要求会话以 AUTO-RESOLVE 标注决策"
  (require the session to mark the decision as AUTO-RESOLVE), `on` = "driver 已完整记录,本档不要求会话另行标注" (the driver has already recorded it in full; this mode does not ask the session to mark separately)), taking the same single
  `autoSwitches().ask` read as `autoAnswer` — log and actual reply never disagree (§M already set the same rule for `autoAnswer`).
  The original `→ 自动答复: <长文案>` (long auto-answer text) is demoted to `vlog`: the full reply text is identical every time, occupying two or
  three terminal lines while carrying nothing about this run; dryrun pre-checks do not count as auto-resolves and still go through the original line.

## P. Decision record (T-007 wrap-up closed loop)

- **AUTO-RESOLVE: does the injected list contain agent-source entries -> driver-source only (§I only says "the driver-observed
  auto-resolve list" without settling the agent entries' fate; this changed the wrap-up prompt's visible content — a scope trade-off that should have been asked
  of the user)**. Agent entries are markers the session itself already wrote into docs/code; reporting them again in the prompt adds no new
  information and easily induces it to write the same item into the report twice in two wordings; whereas what the "forcibly written into git" closed loop guards against is precisely
  the part the session did **not** mark — and that part exists only in the driver source.
- **AUTO-RESOLVE: does the list get a count cap or body truncation -> neither (§I left it open; a cap would make the prompt's
  "every one must appear" contradict the list actually given — a trade-off of externally visible behavior)**. The terminal highlight block has an
  8-entry cap and 80-character truncation because terminal space is limited and the full record lives in the report; the prompt is that report's sole
  input — truncated means lost forever. The entry count is capped by the session's actual question count (single digits per task, §F), so it poses no risk.
- **AUTO-DECISION: pre-concatenation lands in `src/prompt.ts` private `resolveList()`, not reusing
  `resolveHighlight`**. The template syntax deliberately has no loops (list-like data is concatenated into a string by the caller, see
  the `src/template.ts` header comment), and the two display sites run in opposite directions: the terminal wants truncation, the prompt wants full text.
- **AUTO-DECISION: the conditional section becomes the wrap-up's 4th numbered item, not a separate standalone paragraph**. The wrap-up prompt's three
  requirements are governed by the final sentence "以上全部完成前不要结束会话" (do not end the session before all of the above is complete); a standalone paragraph would escape that governance and become an optional
  side note.
- **AUTO-DECISION: the two call sites go through module-private `wrapupResolves` rather than each inlining `resolvesOf`**.
  "Ledger read failures are always swallowed to empty" (auditing never affects flow or exit codes) should be written only once, in line with the three pinned
  blocks in `loop.ts` that use the same `catch` stance.

## Q. Decision record (T-008 documentation sync wrap-up)

- **AUTO-RESOLVE: in the `src/switches.ts` entry of `docs/structure.md`, does `OPENCODE_AUTO_MODEL`
  / `_FALLBACK`'s numbering yield to `ask` -> they yield, changing from 「第十/十一变量」 (tenth/eleventh variables) to 「第十一/十二变量」 (eleventh/twelfth variables) (the plan's §documentation-update for structure.md only says "
  `src/resolve.ts` new line + runner/loop/prompt
  entries gain hooks + a design-document index line", so renumbering existing switch entries exceeds that literal scope)**. `SWITCH_ENV`
  registry `ask` sorts before `model`; without yielding, the document numbering would disagree with the registry order, and the next new switch
  would keep numbering along the misalignment; yielding is a one-time two-character change, not yielding is a steadily accumulating skew.
- **AUTO-RESOLVE: does `packages/auto/README.md` get a whole section or an added sentence in an existing paragraph -> a new top-level section
  「提问策略与代答审计(AUTO-RESOLVE)」 (question strategy and auto-resolve auditing) (the plan only says "sync the question auto-answer paragraphs +
  advice on choosing between the two `OPENCODE_AUTO_ASK` modes", without fixing the form; a new top-level section changes the outward documentation's structure)**.
  §K-1 requires that "use the `on` mode when auditable auto-resolve records are needed" be prominent — otherwise users will take the default mode's count
  as complete, exactly what that risk item guards against; one sentence squeezed into an existing paragraph cannot achieve it, and the criteria table, report samples, and the two-mode
  comparison table would not fit either. The style follows the 「死循环检测」 (infinite-loop detection) section (likewise driver-autonomous behavior during unattended
  periods, likewise needing "why it exists" explained before the switch). The existing paragraph becomes a one-sentence summary + anchor link, without repeating the detail.
- **AUTO-DECISION: §G appends a "post-implementation landing points" table at the end rather than rewriting the hook table's line numbers in place**. The hook table's
  line numbers follow the pre-change `bf745fa94` — the factual baseline of the T-001 survey, and the anchor for §J's four corrections;
  overwriting in place would lose both the baseline and the "designed landing point -> actual landing point" mapping — exactly the column most wanted when
  rereading a design document.
- **AUTO-DECISION: `.auto/resolves.json`'s contract is merged into the `docs/behavior.md`
  `.auto/stats.json` paragraph, not a separate bullet**. The two are the same family with the same contract (driver-exclusive writes, inside gitignore,
  not on the protect list, participating in no recovery decisions, corrupt-or-missing just restarts from the present, zeroing = a manual
  `rm`); writing them separately would make readers think there are two rule sets; the only difference is the one sentence "why it is a separate file", and side-by-side comparison saves the
  reader the effort.
- **AUTO-DECISION: `AGENTS.md` gains only one navigation line, phrasing question strategy and the auto-resolve ledger together**. That file's
  maintenance rule says "a new mechanism only adds one navigation line or invariant here; details go into the corresponding document under `docs/`"; splitting it into
  a "switch" line and an "audit" line would break the granularity of existing entries like stats/stuck/model-routing, and these two things
  are the two ends of one causal chain (§B: suppress questions -> decisions invisible -> must record).
