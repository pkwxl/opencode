// Prompt context assembly layer: all copy lives in templates/prompts/*.md
// (shared partials in _partials.md, rendered through src/template.ts; the
// target directory's .opencode/auto/prompts/ can override it); this layer
// only assembles plan/task/run info into template variables. The render*
// signatures stay stable, so runner/loop call sites are unaware of the
// template mechanism.
// Off the driver (E2, plans/0061 §6.3): this module imports the intent
// domain alone (the mode/template halves and the intent pack's loader).
// Everything it used to read from driver modules reaches it as data — one
// PromptFacts value per render call (the prompt globals, the switch-derived
// options, the implement-entry fallback; src/prompt-facts.ts is the
// composition helper), the view types below (which the driver's own types
// satisfy structurally, built by tasks.ts's promptViews), and the task's
// document-path view (docpaths' taskDocPaths). No module state remains here.
import type { ModeSpec } from "./mode"
import { dutiesForPhase, packSubsection } from "./intent/load"
import type { IntentPack, IntentSection, ParallelLevel } from "./intent/types"
import { renderTemplate, renderText, type Ctx } from "./template"

// —— The render layer's views of driver data (E2) ——

// The prompt facts: what the render layer reads beyond each template's own
// inputs — the prompt globals (module state before E2: the active intent
// pack, the humanQuestions flag), the template library handle, the
// switch-derived ask tier, and the phase registry's implement entry (the
// fallback of phase-less renders). One value per render call, built by the
// caller (src/prompt-facts.ts); an ask given explicitly in a render ctx
// still wins (the override the tests use).
export type PromptFacts = {
  // The active intent pack (the project overlay resolved): the (b)-class
  // content of the decompose family and the closing self-check sentences
  // lives in it, not in the core templates; preflight validated the load.
  pack: IntentPack
  // plan's attended-human mode (stopBefore === "execute"): the
  // question-rule partial renders its human-answer branch — the session
  // asks, the driver waits for the human's answer with no timeout, and no
  // AUTO-RESOLVE proxy answer or labeling applies.
  humanQuestions: boolean
  // The template library handle: the template names currently in effect
  // (built-ins + shell registrations + the project overlay), read once per
  // facts build; the decompose template choice consults it.
  templateNames: string[]
  // The ask tier (OPENCODE_AUTO_ASK, see src/switches.ts): question-rule's
  // attended branch.
  ask: boolean
  // The phase registry's implement entry: the phase view phase-less renders
  // fall back to (the single-phase flow's default).
  implementPhase: PhaseEntry
}

// A phase type as the render layer sees it (the phases registry's
// PhaseTypeEntry satisfies it structurally): the preset letter or type id
// (the {{phase}} var), the display name, and the decompose-side fields.
export type PhaseEntry = {
  type: string
  name: string
  letter?: string
  dutiesRef: string
  decomposeTemplate: string
  decomposeDuties?: string
}

// One checklist item as the render layer sees it: the full line text (the
// session's own item is matched by it), the display title (tasks.ts
// checklistTitle) and the effective done flag.
export type ChecklistView = { text: string; title: string; done: boolean }

// The task view (tasks.ts promptViews builds it): the task fields the
// templates read plus the plan-derived fields the render layer no longer
// computes — the effective prerequisites (the closed-prerequisite notes read
// them) and the checklist's display titles.
export type TaskView = {
  id: string
  title: string
  status: "pending" | "in_progress" | "blocked" | "done"
  closed?: string
  body: string
  prerequisites: string[]
  checklist?: readonly ChecklistView[]
}

// The plan view: what the done list, the closed map and the tick snapshot
// read. The whole plan enters as this view (its every task a TaskView).
export type PlanView = {
  tasks: readonly TaskView[]
  closed: ReadonlyMap<string, string>
}

// The task's document-path view (docpaths' taskDocPaths builds it — the
// render layer constructs no paths): the task-level paths the templates
// reference, and the S<nn>-scoped paths of checklist item k (its test
// handover document, state file and output file).
export type TaskDocs = {
  handoff: string
  subtasks: string
  testHandoff: string
  subtask(k: number): { testHandoff: string; todo: string; output: string }
}

// The wrap-up's proxy-answer entries (the resolve ledger's items satisfy it
// structurally): only the source flag, the driver-source pairing flag and
// the question text reach the render; the agent-source extras ride along
// with ledger items and are ignored.
export type ResolveEntry = {
  source: string
  question: string
  matched?: boolean
  option?: string
  reason?: string
  file?: string
  malformed?: boolean
}

// The stuck detector's hit as the render layer sees it (src/stuck.ts's
// StuckHit satisfies it structurally).
export type StuckHitView = {
  kind: "error" | "repeat"
  tool: string
  count: number
  level: number
  input: string
  detail: string
}

// Pack-section injection helper: address a `### <key>` subsection of the
// facts' intent pack and pre-render it with the session context (pack text
// may use the template syntax, same license as mode files); absent
// section/key yields undefined and the template guard drops the block
// cleanly. Exported for src/prompt-plan.ts, like renderPrompt, phaseTag and
// modeText.
export function intentText(facts: PromptFacts, section: IntentSection, key: string, ctx: Ctx): string | undefined {
  const text = packSubsection(facts.pack, section, key)
  return text && renderText(text, ctx)
}

// testByDriver/handoverTest: the --test-by-driver test execution protocol (a
// run-level switch); when true the execution templates (subtask/whole)
// inject the protocol section.
// phase/contextLimit/fine: the phased flow's current phase ({ id, entry }:
// the qualified id plus the type entry), the context budget baseline
// (tokens) and the fine-grained decompose switch (OPENCODE_AUTO_DECOMPOSE_FINE,
// wiring in plans/0003-fork-decompose-design.md §4.6) — the entry's decompose
// template is chosen and rendered from these (phaseName = the display name;
// contextBudget = the half-budget granularity ceiling, an item's own work
// counted above the context its session starts with — plans/0059 T3: a fresh
// subtask session's harness and prompt alone can reach the whole half
// budget; fine injects the fine-grained criteria).
type Opts = {
  mode?: ModeSpec
  testByDriver?: boolean
  handoverTest?: boolean
  phase?: { id: string; entry: PhaseEntry }
  contextLimit?: number
  fine?: boolean
  // The parallel level in effect for this execution surface (plans/0068
  // D18/S5): the decompose family and the whole-task split clause inject the
  // `## parallelism` subsection of the configured level; absent (none, or a
  // serial run's options that never carried it) renders nothing — the
  // byte-identical floor.
  parallel?: ParallelLevel
}

// The single render exit, also for src/prompt-plan.ts's planning renderers.
// This layer's only render exit (every render* calls renderTemplate through
// it): uniformly injects the question-policy var ask (OPENCODE_AUTO_ASK,
// design doc plans/0020-auto-resolve-design.md §E). That var serves the
// question-rule partial of _partials.md, and that partial is referenced by
// 23 templates — threading opts through the render functions one by one
// would silently leave a newly added template uncovered, hence the uniform
// injection at the exit instead of copying fine's per-function threading
// (fine serves only the decompose-<phase> family, a controllable threading
// surface). An ask given explicitly in ctx wins, so unit tests can drive
// both tiers directly (mirroring the `opts.x ?? autoSwitches().x`
// convention at src/step.ts:41).
//
// The same exit feeds question-rule's governance hooks (M2.1, plans/0043): the
// "who should have owned this call" catalog and the recording discipline live
// in the active pack (`## governance` / `### decisions-unattended` and
// `### decisions-ask`), pre-rendered here for the branch ask selects. The
// marker line formats stay core-owned (the driver scans for them, src/resolve.ts)
// and reach the pack text as the resolveFormat/decisionFormat variables; the
// partial keeps a literal zero-intent fallback so its tier-1 anchors hold.
export const RESOLVE_FORMAT = "`AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)`"
export const DECISION_FORMAT = "`AUTO-DECISION: <decision> (<reason>)`"

// The exit's context completion, exported so tests that render the shared
// partials directly (renderText/renderTemplate) see what every session sees.
export function promptCtx(facts: PromptFacts, ctx: Ctx): Ctx {
  const full: Ctx = { ask: facts.ask, humanQuestions: facts.humanQuestions, resolveFormat: RESOLVE_FORMAT, decisionFormat: DECISION_FORMAT, ...ctx }
  const key = full.ask ? "decisionsAsk" : "decisionsUnattended"
  return { ...full, [key]: intentText(facts, "governance", full.ask ? "decisions-ask" : "decisions-unattended", full) }
}

// Parallelism guidance (MP.1, plans/0046 D10/D11; the decompose side since
// plans/0068 D18/S5): the level's `## parallelism` intent subsection. At
// none — or when the pack lacks the subsection — both keys are undefined and
// every template's block renders nothing. Shared by the planning renderers
// (src/prompt-plan.ts) and, since S5, by the decompose family and the
// whole-task split clause; the level's own text speaks of tasks, and the
// decompose/split blocks frame it onto subtasks and streams.
export function parallelismVars(facts: PromptFacts, level: ParallelLevel | undefined): { parallel?: string; parallelRules?: string } {
  const rules = level ? intentText(facts, "parallelism", level, {}) : undefined
  return rules ? { parallel: level, parallelRules: rules } : {}
}

export function renderPrompt(facts: PromptFacts, name: string, ctx: Ctx): string {
  return renderTemplate(name, promptCtx(facts, ctx))
}

// Run info of a driver-executed script, relayed to the session: out is the
// absolute path of the merged stdout+stderr file, read by the session directly
// (never truncated by tool output). timeoutReason: idle = killed by the
// no-output watchdog; max = killed after the absolute run-time cap.
export type ScriptRun = {
  script: string
  code: number
  ms: number
  timedOut: boolean
  timeoutReason?: "idle" | "max"
  out: string
}

// One test execution of --test-by-driver (ScriptRun + the sequence number
// for in-order archiving): after the driver runs an AI-designated test/
// script it is steered into the executing session; the AI reads the merged
// output file directly to judge.
export type TestRunInfo = ScriptRun & { seq: number }

// Test execution result feedback (steered into the executing session): exit code
// and output file path; the AI reads the file directly to judge.
export function renderTestResult(facts: PromptFacts, run: TestRunInfo): string {
  return renderPrompt(facts, "test-result", {
    seq: String(run.seq),
    script: run.script,
    code: String(run.code),
    ms: String(run.ms),
    runTimeout: run.timedOut
      ? `yes (terminated by the driver${run.timeoutReason === "max" ? ": absolute duration limit exceeded" : ": no output throughout, the watchdog judged no progress"})`
      : "no",
    out: run.out,
  })
}

// --handover-test wrap-up + handover demands (steered into the executing
// session): at the moment the AI initiates the test the driver has already
// decided a handover is needed — the commit is frozen and the script
// settled — and this prompt asks the session to finish writing out the
// remaining work that does not depend on the test result, write the
// handover document, then end the session; the test result is left for the
// next session to judge. The wording stays neutral about the test's timing
// ("will be executed by the driver"): the test runs only after the handover
// close-out, and the session does not need to know when.
//
// Hard copy constraint (test-handover front-loading design D2): **must not
// mention "context / over the limit / limit / tokens"** — once a session
// knows its context is tight, it judges the remaining budget insufficient
// itself and skips the write-out work it should have completed
// (field-verified); state only the fact that "a handover is needed and the
// session must switch". Likewise it never says "do not modify source": the
// session's wrap-up changes land in commit #2
// anyway and are covered by the test, so saying it would instead hint that
// this is a boundary it may dispose of freely.
// The document's content checklist carries one more item, "work not yet
// finished within this execution scope": step 1 asks to finish the
// remaining work not depending on the test result, but the session cannot
// always finish it (it does not know why it is handing over either);
// remaining work that is not listed silently disappears at the handover —
// the new session cannot read it, does not know it exists, and treats it
// as done: permanently missed.
// The only input is the handover document path — at this moment the test
// has not produced a result yet, so exit code/output do not exist.
//
// The completeness discipline is split out (M2.3, plans/0045 D9): the
// protocol — what to write, where, the status line — stays in the template;
// the two sentences that forbid leaving work undone come from the active
// pack's `## governance` / `### test-handover-finish` and
// `### test-handover-leftover`, and drop out cleanly when a pack omits them.
export function renderTestWrapup(facts: PromptFacts, info: { handoffFile: string }): string {
  const ctx: Ctx = { handoffFile: info.handoffFile }
  return renderPrompt(facts, "test-wrapup", {
    ...ctx,
    finishRule: intentText(facts, "governance", "test-handover-finish", ctx),
    leftoverRule: intentText(facts, "governance", "test-handover-leftover", ctx),
  })
}

// Continuation instructions for the new session after a test handover
// (appended to the execution prompt): read the handover document (the
// archived copy testhandoff-<n>.md) and this run's test output before
// continuing — judging the test result is precisely this session's first
// job. stuck is the reminder when consecutive handovers exceed the
// threshold (10) — assess whether the session is stuck in a temporarily
// unsolvable problem; it may continue after marking the leftover with
// AUTO-FIXME.
export function renderTestContinue(facts: PromptFacts, input: { handoffFile: string; run?: TestRunInfo; stuck?: number }): string {
  return renderPrompt(facts, "test-continue", {
    handoffFile: input.handoffFile,
    runScript: input.run?.script,
    runCode: input.run ? String(input.run.code) : undefined,
    runOut: input.run?.out,
    stuck: input.stuck ? String(input.stuck) : undefined,
  })
}

// digest base session (①′, driver-led, fork-decompose design §7): the
// full digest text + one confirmation sentence; when the session ends it
// becomes the prefix fork base for every fork (subtask) of the task.
export function renderContextBase(facts: PromptFacts, task: { id: string }, digest: string): string {
  return renderPrompt(facts, "context-base", { taskId: task.id, digest })
}

// Merged understand+decomposition session (M1.0, plans/0030): read-only
// understanding (docs/<id>/context.md four sections) + shared-context
// reference index (docs/<id>/shared.md) + subtask split (docs/<id>/subtasks.md
// checklist) + one scope file per subtask (docs/<id>/S<nn>/todo.md). The
// driver reads the checklist from subtasks.md and ticks it itself.
// Template chosen per phase: decompose-<phase> (default m; the granularity
// criteria take the task description as their baseline, fine turns on the
// fine-grained tier), falling back to the generic decompose when the
// library has no such name.
// Intent injection (M1.2/M1.3): the granularity criteria and per-phase duties
// come from the active pack (`### decompose` under `## quality`, and the
// `### <letter>` subsection under `## phase duties`), pre-rendered with this
// ctx (fine/contextBudget/phaseName resolve inside the pack text, same
// license as mode sections) and injected as data; when the pack lacks the
// subsection the block disappears entirely (zero-intent baseline) and the
// core template keeps only role boundaries, format protocols, and eof.
export function renderDecompose(facts: PromptFacts, plan: PlanView, task: TaskView, docs: TaskDocs, opts: Opts = {}): string {
  const ctx = baseCtx(facts, plan, task, docs, opts)
  const entry = phaseEntry(facts, opts.phase)
  // A custom type's own `## decompose duties` wins; otherwise the active
  // pack's `### <dutiesRef>` subsection.
  const duties = entry.decomposeDuties ?? dutiesForPhase(facts.pack, entry.dutiesRef)
  return renderPrompt(facts, decomposeTemplateName(entry, facts.templateNames), {
    ...ctx,
    decomposeRule: intentText(facts, "quality", "decompose", ctx),
    phaseDuties: duties && renderText(duties, ctx),
    // context.md section layout (M2.1): `## artifact spec` / `### context-digest`.
    contextDigest: intentText(facts, "artifactSpec", "context-digest", ctx),
    // D18 (plans/0068 S5): the level's parallelism guidance, so decomposition
    // arranges subtask independence the way planning arranges task
    // independence — injected only where the caller's options carry a level
    // (real width; the byte-identical floor at one session).
    ...parallelismVars(facts, opts.parallel),
  })
}

// decompose template-name resolution (a pure function, easy to unit-test):
// phase type entry → decomposeTemplate; names is the currently active
// template-name list (the facts' templateNames); an absent name falls back
// to the generic decompose. The caller resolves the phase-less fallback
// (the facts' implement entry) before calling.
export function decomposeTemplateName(entry: PhaseEntry, names: string[]): string {
  const candidate = entry.decomposeTemplate
  return names.includes(candidate) ? candidate : "decompose"
}

// The current phase's type entry; outside the phase loop, the implement
// entry the facts carry.
function phaseEntry(facts: PromptFacts, phase: { id: string; entry: PhaseEntry } | undefined): PhaseEntry {
  return phase?.entry ?? facts.implementPhase
}

// The `{{phase}}` prompt var: the preset letter of a builtin type, the type id
// of a custom one.
export const phaseTag = (entry: PhaseEntry): string => entry.letter ?? entry.type

// The L1 authoritative grounded-state block (session-boundary-hardening design
// §4.1): a subtask session is injected with the authoritative state the driver
// derives from the unit state (task status / fully qualified id / tick snapshot
// / declaration that prior tasks are independent), so a previous task's
// completion narrative cannot be read as this task's state — the data is
// assembled here, the wording lives in the ground-state partial of
// _partials.md. The display layer (subtasks.md) keeps the short S01 numbering;
// the fully qualified id only ever reaches the prompt (L3).
// Task status wording (while the driver runs a subtask session the task is always
// in progress; the other states are rendered faithfully for completeness).
const STATUS_TEXT: Record<TaskView["status"], string> = { pending: "not started", in_progress: "in progress", blocked: "blocked", done: "done" }

// Tick snapshot: S01☑ S02☐ …, done k/n (effective done flags — the state files
// win — which is exactly the authoritative information the session cannot read).
function subtaskSnapshot(items: readonly { done: boolean }[]): string | undefined {
  if (!items.length) return undefined
  const ticks = items.map((item, i) => `S${String(i + 1).padStart(2, "0")}${item.done ? "☑" : "☐"}`).join(" ")
  return `${ticks}, done ${items.filter((item) => item.done).length}/${items.length}`
}

// Inline list of previously completed task ids (same source as head's doneList;
// the grounded-state declaration line inlines ids only and does not restate the
// title list, avoiding duplication with head's completed list).
function doneIds(plan: PlanView): string | undefined {
  const ids = plan.tasks.filter((item) => item.status === "done").map((item) => item.id)
  return ids.length ? ids.join(", ") : undefined
}

// Subtask session: exactly one checklist item. The session implements it and
// self-checks; ticking the checkbox is the driver's job when the session ends
// (the unified commit after the session is likewise executed by the driver,
// see src/git.ts).
// handoff-steer also applies to subtask sessions: when the context reaches
// 2x contextLimit the driver inserts the handover steer; the session writes
// its progress into docs/<id>/handoff.md and a new session continues;
// continuation means the previous session was interrupted by the context
// limit and must read the handover document before continuing.
// index/subtaskList/outputFile/warm (the fork three-stage pipeline,
// fork-decompose design §8): inject the checklist list plus "you are
// responsible for only item N of it this run", the standalone write-out
// file for document-type outputs (mechanically named by the driver), and
// warm = the session inherited the task background context from the fork
// base (a cold start instead prompts reading the context.md digest first).
// The list names every item by title (the view items' display titles) and
// the session's own item follows in full (plans/0059 T1: the other items'
// full text was half of every subtask prompt, repeated in each). digest = the base
// is the digest base, which holds the context.md digest but none of the files
// the decompose session read, so the warm sentence must not claim them (T2).
// last = every other item is done: the item runs the task's full acceptance
// verification once, after its own targeted checks (T5/T6 — no close-out
// item re-runs it); derived from the checklist when absent.
// When absent, index/list/output file are derived from the task checklist
// (subtasks.md) (same convention as the runner's subtask loop); old
// callers passing no params still render the full prompt.
// budget: the session runs under the context-budget protocol (usage notices
// and a self-directed handover, plans/0056) — a stream of auto's split that
// starts without a fork of the lead, or continues from a handover (plans/0059
// D5); the planned pipeline's subtasks never pass it (0056 D1).
// AUTO-DECISION: the protocol is a conditional block of subtask.md rather than a separate template (the stream without a fork needs the whole subtask prompt anyway, and without the flag the prompt stays byte-identical)
export function renderSubtask(
  facts: PromptFacts,
  plan: PlanView,
  task: TaskView,
  docs: TaskDocs,
  subtask: string,
  opts: Opts & { continuation?: boolean; index?: number; subtaskList?: string; outputFile?: string; warm?: boolean; digest?: boolean; last?: boolean; budget?: boolean; handoff?: string } = {},
): string {
  const items = task.checklist ?? []
  const at = opts.index !== undefined ? opts.index - 1 : items.findIndex((item) => !item.done && item.text === subtask)
  const index = at >= 0 ? String(at + 1) : undefined
  const last = opts.last ?? (at >= 0 && at < items.length && items.every((item, i) => item.done || i === at))
  const ctx = baseCtx(facts, plan, task, docs, { ...opts, index: index !== undefined ? Number(index) : undefined })
  const outputFile = opts.outputFile ?? (index !== undefined ? docs.subtask(at + 1).output : undefined)
  return renderPrompt(facts, "subtask", {
    // The derived index value is fed back into baseCtx: the test handover
    // document naming (the test protocol section) and the "item N" injected
    // here share one source, so under default derivation (old callers not
    // passing index) the naming likewise lands in the subtask-level
    // directory.
    ...ctx,
    subtask,
    continuation: Boolean(opts.continuation),
    handoffFile: opts.handoff ?? docs.handoff,
    // Closing self-check sentence (M1.3): (b)-class quality intent from the
    // active pack's `## quality` / `### self-check-subtask`; the guard drops
    // the wrap-up item cleanly when the pack omits it (zero-intent baseline).
    selfCheck: intentText(facts, "quality", "self-check-subtask", ctx),
    // Output-placement convention (M1.4, plans/0034 D7/D8): (b)-class artifact
    // convention from the active pack's `## artifact spec` / `### subtask-output`,
    // pre-rendered with the output-file slot (the convention text references
    // {{outputFile}}). Injected only when the slot exists (index given or
    // derived); a pack omitting the subsection drops the block cleanly.
    artifactConvention: outputFile ? intentText(facts, "artifactSpec", "subtask-output", { ...ctx, outputFile }) : undefined,
    // P1 discipline (M2.3, plans/0045): the deliverable must not reference
    // process documents — `## governance` / `### process-references`; the
    // DRIVER's prohibition scan at close-out is the mechanical side.
    processRefs: intentText(facts, "governance", "process-references", ctx),
    // L1 ground-state block vars (the ground-state partial): the ledger's
    // authoritative state is injected with every subtask session;
    // qualifiedId is given only when the number is known (old-shape tasks
    // without a checklist have no S number).
    taskTitle: task.title,
    taskStatusText: STATUS_TEXT[task.status],
    qualifiedId: index !== undefined ? `${task.id}.S${index.padStart(2, "0")}` : undefined,
    subtaskSnapshot: subtaskSnapshot(items),
    doneIds: doneIds(plan),
    index,
    subtaskList: opts.subtaskList ?? (items.length ? items.map((item, i) => `${i + 1}. ${item.title}`).join("\n") : undefined),
    outputFile,
    // Subtask-directory state protocol (M1.0): the scope declaration file
    // fixed at decompose time; old-shape tasks lack the file, and the
    // template conditions on it with "if it exists" wording.
    todoFile: index !== undefined ? docs.subtask(Number(index)).todo : undefined,
    warm: Boolean(opts.warm),
    digest: Boolean(opts.digest),
    last,
    budget: Boolean(opts.budget),
  })
}

// One stream of auto's taken split, sent alone into a fork of the lead
// (plans/0059 D5): the fork already holds the task, its rules and everything
// the lead read, so the prompt is only the delta —
//   - the item line in full, the other streams by title (siblings, one
//     pre-rendered line each);
//   - changed: the files changed since the split, given to a stream whose
//     prerequisites ran (the fork holds them as they were at the split);
//     without it the stream is told not to re-read;
//   - targeted verification, with the task's full acceptance verification
//     run once by the last stream (last);
//   - no per-item record for code changes (the commit is the record), a
//     document output into the item's output file;
//   - the document terminator discipline, which the lead's prompt never
//     carried and the stream's close-out checks;
//   - budget: the context-budget protocol, scoped to the stream.
// cold (plans/0068 S5/D19): the stream is a lane unit that starts fresh — no
// fork holds the task — so the delta is the whole prompt: it opens with the
// task block, the stream's own scope file in full (scope) and the per-stream
// handoff document (handoff, docs/T-NNN/S<nn>/handoff.md), and the template
// words the opening for a session that inherited nothing. The serial in-lane
// delta (no cold) is byte-identical to before.
// AUTO-DECISION: the delta also carries the terminator rule and names the stream's own test-handover document (the lead's prompt had neither — its test handover is the task-level one — and the stream's close-out checks the terminator and reads the stream-level document)
export function renderFanout(
  facts: PromptFacts,
  plan: PlanView,
  task: TaskView,
  docs: TaskDocs,
  subtask: string,
  index: number,
  opts: Opts & { siblings: string[]; changed?: string[]; last?: boolean; budget?: boolean; cold?: boolean; scope?: string; handoff?: string },
): string {
  const ctx = baseCtx(facts, plan, task, docs, { ...opts, index })
  return renderPrompt(facts, "fanout", {
    ...ctx,
    subtask,
    qualifiedId: `${task.id}.S${String(index).padStart(2, "0")}`,
    siblings: opts.siblings.map((line) => `- ${line}`).join("\n"),
    changed: opts.changed?.length ? opts.changed.map((path) => `- ${path}`).join("\n") : undefined,
    last: Boolean(opts.last),
    budget: Boolean(opts.budget),
    cold: Boolean(opts.cold),
    scope: opts.scope,
    handoffFile: opts.handoff ?? docs.handoff,
    subtasksFile: docs.subtasks,
    todoFile: docs.subtask(index).todo,
    outputFile: docs.subtask(index).output,
    // The stream's closing self-check (M1.3), the subtask one.
    selfCheck: intentText(facts, "quality", "self-check-subtask", ctx),
  })
}

// Wrap-up session: every subtask is already ticked by the driver. Only docs
// and the output-summary report remain.
// resolves (wrap-up closed loop H7, plans/0020-auto-resolve-design.md §I):
// the proxy-answer list the driver observed for this task; once injected,
// report.md is required to carry a dedicated "Proxy-answered questions"
// section — the persistent audit trail thus no longer depends on the
// session labeling them on its own, and the part the driver saw is forced
// into git. This layer is a synchronous pure function (prompt.ts only
// assembles data); the list is read from the ledger via resolvesOf by the
// call site (the two wrap-up points in runner) and passed in.
// Intent injection (M2.1, plans/0043): the report's content form comes from
// `## artifact spec` (`### report-indexed` for the subtask form, `### report-solo`
// for the single-session form), and the audit's scope beyond the driver-listed
// items (which session-identified proxy calls also belong in the section) from
// `## governance` / `### wrapup-audit`. The driver-listed items and their
// "every one must appear" demand stay core: they are the persistent audit trail.
export function renderWrapup(facts: PromptFacts, plan: PlanView, task: TaskView, docs: TaskDocs, opts: Opts & { solo?: boolean; resolves?: ResolveEntry[] } = {}): string {
  const ctx = baseCtx(facts, plan, task, docs, opts)
  return renderPrompt(facts, "wrapup", {
    ...ctx,
    solo: Boolean(opts.solo),
    resolveList: resolveList(opts.resolves),
    reportForm: intentText(facts, "artifactSpec", opts.solo ? "report-solo" : "report-indexed", ctx),
    auditScope: intentText(facts, "governance", "wrapup-audit", ctx),
    // Result-line discipline (plans/0044 §3.1): when to write the line and what
    // counts as FAIL is intent (`## acceptance` / `### result-line`); the literal
    // and its placement stay core. A pack without the subsection drops the
    // whole instruction — no result line, the run never stops on a verdict.
    resultRule: intentText(facts, "acceptance", "result-line", ctx),
  })
}

// Pre-joining of the proxy-answer list (the template syntax deliberately
// has no loops; list-type data is joined into a string by the caller, see
// the src/template.ts header comment). Only driver-source items are
// listed: agent-source items are already labeled by the session itself,
// and reporting them again is pure noise. Items whose agent marker found
// no pair come first (§I's "prefer listing the ones that found no pair")
// — they are exactly the ones most likely to be missing from the report.
// Neither entry count nor body is truncated — the prompt demands "every
// one above must appear", and dropping entries would contradict that
// demand; only the newlines of the original question are squeezed into a
// single line, otherwise multi-line questions would break the list
// structure.
function resolveList(items: ResolveEntry[] | undefined): string | undefined {
  const driver = (items ?? []).filter((item) => item.source === "driver")
  const lines = [...driver.filter((item) => !item.matched), ...driver.filter((item) => item.matched)]
    .map((item) => item.question.replace(/\s+/g, " ").trim())
    .filter((question) => question.length > 0)
    .map((question) => `   - ${question}`)
  return lines.length ? lines.join("\n") : undefined
}

// The number-record recovery session of auto numbering (config.autoNumber,
// src/numbering.ts): a one-shot bypass session whose artifact =
// .auto/next-task as written by the AI (a single positive integer). floor
// is the lower bound of used numbers from the driver's deterministic scan,
// one value shared by the template input and the driver-side collect
// check.
export function renderNumberRecovery(facts: PromptFacts, input: { floor: number }): string {
  return renderPrompt(facts, "number-recovery", {
    floor: String(input.floor),
    floorPadded: String(input.floor).padStart(3, "0"),
  })
}

// Phase handover distillation session (design doc plans/0006-phases-design.md
// F.1 step 1): a one-shot bypass session that reads through this phase's
// task index and docs/ artifacts and distills the permanent-path handover
// document (the four required-sections protocol is inlined in the
// template). handover = phaseHandoverDoc(unit) (src/phases.ts, the
// docs/R-NN/P<nn>-<type>/handover.md inside the phase directory); next is
// the next phase's "P<nn>-<type> Chinese name" or undefined (the last
// phase has no next phase and still writes the handover for later
// reference).
// acceptance = the phase's acceptance.md when its acceptance gate is on
// (plans/0049 G7): the session also drafts it; what the draft holds is intent
// (`## acceptance` / `### phase-acceptance-draft`).
// closedTasks = the phase's tasks closed without completing (plans/0053 D16):
// an optional block tells the distillation to record them as not delivered;
// absent or empty renders nothing, so the output without closures is unchanged.
export function renderPhaseHandover(facts: PromptFacts, input: {
  phase: PhaseEntry
  handover: string
  next?: string
  acceptance?: string
  closedTasks?: { id: string; title: string; reason: string }[]
}): string {
  const closed = input.closedTasks ?? []
  return renderPrompt(facts, "phase-handover", {
    phase: phaseTag(input.phase),
    phaseName: input.phase.name,
    handover: input.handover,
    next: input.next,
    acceptance: input.acceptance,
    acceptanceRules: input.acceptance ? intentText(facts, "acceptance", "phase-acceptance-draft", { acceptance: input.acceptance }) : undefined,
    closedTasks: closed.length
      ? closed.map((task) => `- ${task.id}: ${task.title} (closed without completing: ${task.reason})`).join("\n")
      : undefined,
  })
}

// The knowledge-extraction session of the k (knowledge distillation) phase
// (plans/0006-phases-design.md P4, wholesale adoption of
// plans/0002-fixme-knowledge-design.md §D.3): a one-shot bypass session
// that reads through the phase index and every phase handover document
// (inside this round's round directory docs/R-NN/) and distills the
// finally verified migration-knowledge document (permanent path: kb.md
// inside the knowledge phase directory). file is the output path (relative
// to the target directory); mode.exec is injected as scenario background
// (reusing ModeSpec's existing fields, adding no registration surface).
// The quality hard constraints (M2.1) come from `## quality` / `### knowledge`.
export function renderKnowledge(facts: PromptFacts, input: { file: string; mode?: ModeSpec }): string {
  const ctx = { file: input.file, ...modeCtx(input.mode) }
  return renderPrompt(facts, "knowledge", { ...ctx, qualityRules: intentText(facts, "quality", "knowledge", ctx) })
}

// Prior-knowledge extraction session (the shell's second-migration
// orchestration, src/knowledge.ts extractPriorKnowledge): a one-shot
// bypass session that reads through the existing migration results (not
// limited to prior rounds — the whole docs/ tree, past rounds' round
// directories docs/R-NN/, produced code and git history) and distills the
// prior-knowledge document (docs/R-NN/prior-kb.md within the round) as
// input to the second migration and parameter inference. file is the
// output path of the intermediate artifact temp-kb.md (relative to the
// target directory; only after the driver confirms the finish marker is it
// renamed into place — the completion-verdict protocol is in
// knowledge.ts); brief is the project intent verbatim (may be empty);
// distilled is the list of existing distillation artifact paths
// (knowledge.ts existingDistilledDocs; when non-empty the template injects
// a reference-style conditional block: already-covered knowledge points
// are referenced, not restated, and the distillation effort focuses on the
// differential increment of new objects).
// The quality hard constraints (M2.1) come from `## quality` / `### prior-knowledge`.
export function renderPriorKnowledge(facts: PromptFacts, input: { file: string; brief?: string; mode?: ModeSpec; distilled?: string[] }): string {
  const distilled = input.distilled?.filter(Boolean) ?? []
  const ctx = {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    distilled: distilled.length ? distilled.map((path) => `- ${path}`).join("\n") : undefined,
    ...modeCtx(input.mode),
  }
  return renderPrompt(facts, "prior-knowledge", { ...ctx, qualityRules: intentText(facts, "quality", "prior-knowledge", ctx) })
}

// The hard-wall steer the driver inserts while a session is running (usage
// reached the wall, testrun.ts steerWall: 2x contextLimit, raised to a quarter
// of a large model window and clamped to 80% of it; ondemand
// whole-task sessions, auto's lead and the streams of its split, plans/0059
// D5 — the last resort after the usage notices went unacted-on, plans/0056). The v2 prompt is a steer by default, entering the
// session at the next provider-turn boundary. The handover document path it
// names is the task's (docs/<id>/handoff.md), read from the document-path
// view.
export function renderHandoffSteer(facts: PromptFacts, docs: TaskDocs): string {
  return renderPrompt(facts, "handoff-steer", { handoffFile: docs.handoff })
}

// Usage notices steered into a running ondemand whole-task session (or auto's
// lead, or a stream of its split) at budget milestones (plans/0056): the 50% band is informational, the 85% band advises
// winding down at the next natural boundary. The figures do not exist at
// render time — the {{used}}/{{pct}}/{{wall}} slots round-trip as literal
// placeholders that the driver fills at send time (fillUsageNote in
// src/testrun.ts).
export function renderUsageNoteInfo(facts: PromptFacts, docs: TaskDocs): string {
  return renderPrompt(facts, "usage-note-info", usageNoteCtx(docs))
}

export function renderUsageNoteWinddown(facts: PromptFacts, docs: TaskDocs): string {
  return renderPrompt(facts, "usage-note-winddown", usageNoteCtx(docs))
}

function usageNoteCtx(docs: TaskDocs): Ctx {
  return { handoffFile: docs.handoff, used: "{{used}}", pct: "{{pct}}", wall: "{{wall}}" }
}

// Context step-up note (steered into the same session when its context
// reaches the current step's step-up point, plans/0055 §4.5): the session
// continues in place on the next step's id — same history, shared prompt
// cache — and the steer itself names that id, so the next provider turn
// runs on it. One line: the session needs to know only that nothing else
// changed.
export function renderStepUp(facts: PromptFacts, input: { from: string; next: string }): string {
  return renderPrompt(facts, "step-up", { fromModel: input.from, toModel: input.next })
}

// The failure-message classifier's prompt (plans/0055 §7.1, src/classify.ts):
// the current time in the registry's time zone (`now`, ISO 8601 with the
// zone's offset), the zone itself, and the redacted error text — nothing
// else leaves the driver in this session. The reply shape (one JSON line of
// class and resetAt) is parsed by src/classify.ts parseClassifierReply.
export function renderClassifyError(facts: PromptFacts, input: { now: string; tz: string; error: string }): string {
  return renderPrompt(facts, "classify-error", { now: input.now, tz: input.tz, error: input.error })
}

// Stuck-loop hint (steered into a running session when the driver detects
// repeated actions, src/stuck.ts): level sets the force of the hint — 1 switch
// approach, 2 write the diagnosis before acting, 3 stop retrying and close out
// (at most three per session). Injected by steer like the handover steer; the
// two do not interfere.
// The level-2 reflection discipline (M2.1) comes from `## quality` /
// `### stuck-reflection`; the reminder framing stays core.
export function renderStuckHint(facts: PromptFacts, hit: StuckHitView): string {
  const ctx: Ctx = {
    tool: hit.tool,
    count: String(hit.count),
    level: String(hit.level),
    input: hit.input || "(no arguments)",
    detail: hit.detail || "(empty)",
    repeatError: hit.kind === "error",
    level1: hit.level === 1,
    level2: hit.level === 2,
    level3: hit.level >= 3,
  }
  return renderPrompt(facts, "stuck-hint", { ...ctx, reflection: hit.level === 2 ? intentText(facts, "quality", "stuck-reflection", ctx) : undefined })
}

// --subtask off/auto/ondemand: a single session completes the whole task (no
// subtask decomposition). ondemand and auto's lead additionally carry the
// context-budget protocol (usage notices + self-directed handover, plans/0056)
// when budget is set — the caller passes it only while the steer is built, so
// OPENCODE_AUTO_STEER=off renders no protocol and ignores handover documents;
// continuation means the previous session handed its context over and this
// one must read the handover document before continuing. adaptive is auto's
// lead with its split clause (plans/0059 D2–D3): the option to end by writing
// the remaining streams into subtasks.md instead of finishing; the caller
// passes it only with the protocol (the clause's criterion (c) is the first
// usage notice), and drops it after a rejected split.
export function renderWhole(
  facts: PromptFacts,
  plan: PlanView,
  task: TaskView,
  docs: TaskDocs,
  opts: Opts & { ondemand?: boolean; continuation?: boolean; budget?: boolean; adaptive?: boolean } = {},
): string {
  const ctx = baseCtx(facts, plan, task, docs, opts)
  return renderPrompt(facts, "whole", {
    ...ctx,
    ondemand: Boolean(opts.ondemand),
    continuation: Boolean(opts.continuation),
    budget: Boolean(opts.budget),
    adaptive: Boolean(opts.adaptive),
    handoffFile: docs.handoff,
    subtasksFile: docs.subtasks,
    // Closing self-check sentence (M1.3, same as renderSubtask but keyed to
    // the whole-task scope): `## quality` / `### self-check-whole`.
    selfCheck: intentText(facts, "quality", "self-check-whole", ctx),
    // P1 discipline (M2.3), same subsection as renderSubtask.
    processRefs: intentText(facts, "governance", "process-references", ctx),
    // D18 (plans/0068 S5): the level's parallelism guidance inside the split
    // clause, so the lead's streams are arranged for the width they will
    // actually get (lane streams under the scheduler).
    ...parallelismVars(facts, opts.parallel),
  })
}

// The note that continues auto's lead after the driver rejected its split
// (plans/0059 D4): reason is the guard's verdict. It goes alone into a fork
// of the lead, which already holds the task and its work; fresh is the
// fallback where no fork could be made — the note then follows the full
// whole-task prompt of a new session, and says the earlier work is committed.
// AUTO-DECISION: the note is a template (split-rejected.md), not an inline string like the shape-check feedback (it is session-facing copy a project may override through its prompt library, as the usage notes are)
export function renderSplitRejected(facts: PromptFacts, docs: TaskDocs, reason: string, fresh = false): string {
  return renderPrompt(facts, "split-rejected", { reason, subtasksFile: docs.subtasks, fresh })
}

// --dryrun: the permission-preflight session; its report goes to
// .auto/dryrun.md.
export function renderDryrun(facts: PromptFacts): string {
  return renderPrompt(facts, "dryrun", {})
}

// Mode-note context (the mode part of baseCtx, exported separately): the
// one-shot bypass sessions (knowledge etc.) and the shell's hand-written
// render* functions share one convention for mode-var assembly, so the
// shell need not modify prompt.ts. Mode text is rendered through the
// template engine first, then injected as a variable; with no mode all
// three vars are undefined (the template's conditional block disappears
// entirely).
export function modeCtx(mode?: ModeSpec): Ctx {
  return {
    modeName: mode?.name,
    modeInit: mode && modeText(mode.init),
    modeExec: mode && modeText(mode.exec),
  }
}

// A closed task (plans/0053 D16) is done for scheduling but not delivered: it
// stays in the "already done" list, labelled `[closed]` with its reason. The
// label is session-facing prose, not a protocol string.
function doneList(plan: PlanView): string {
  return plan.tasks
    .filter((t) => t.status === "done")
    .map((t) =>
      t.closed !== undefined
        ? `- [closed] ${t.id}: ${t.title} (closed without completing: ${t.closed})`
        : `- [done] ${t.id}: ${t.title}`,
    )
    .join("\n")
}

// Shared context: the vars needed by the head (done list) / blocked
// (blocked Q&A) / mode-section (mode note) shared partials and by the task
// block; phase/phaseName default to m (the single-phase flow, consistent
// with renderDecompose's template choice); contextBudget/fine serve the
// decompose granularity-criteria block (decompose-rule).
// The context-budget baseline default matches runner's
// DEFAULT_CONTEXT_LIMIT (64k tokens); the local declaration avoids the
// prompt layer depending backward on runner. formatTokens matches the
// runner log convention.
const DEFAULT_CONTEXT_LIMIT = 64_000

function formatTokens(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

// Driver notes appended to the task block (plans/0053 D16): one line per
// effective prerequisite (explicit or implicit) that was closed, so the
// session does not build on deliverables that never landed. Empty without
// closures, keeping the task block byte-identical. The prerequisite ids are
// the task view's (tasks.ts resolves them when it builds the view).
function closedPrerequisiteNotes(plan: PlanView, task: TaskView): string {
  return task.prerequisites
    .filter((id) => plan.closed.has(id))
    .map(
      (id) =>
        `[DRIVER] Prerequisite ${id} was closed without completing (${plan.closed.get(id)}); do not assume its deliverables exist.`,
    )
    .join("\n")
}

function baseCtx(facts: PromptFacts, plan: PlanView, task: TaskView, docs: TaskDocs, opts: Opts & { index?: number } = {}): Ctx {
  const entry = phaseEntry(facts, opts.phase)
  const notes = closedPrerequisiteNotes(plan, task)
  return {
    ...modeCtx(opts.mode),
    taskId: task.id,
    taskBlock: `# ${task.id}: ${task.title}\n\n${task.body}${notes ? `\n\n${notes}` : ""}`,
    doneList: doneList(plan),
    testByDriver: Boolean(opts.testByDriver),
    handoverTest: Boolean(opts.handoverTest),
    // The test handover document is named per execution scope: when index
    // (passed only by renderSubtask, the subtask ordinal) exists it lands
    // in the subtask-level directory (docs/<id>/S<kk>/testhandoff.md); the
    // whole task gets task-level naming.
    testHandoffFile: opts.testByDriver ? (opts.index !== undefined ? docs.subtask(opts.index).testHandoff : docs.testHandoff) : undefined,
    phase: phaseTag(entry),
    phaseName: entry.name,
    contextBudget: formatTokens((opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 2),
    fine: Boolean(opts.fine),
    // The digest's suggested line count, fixed at 200 (the wording knob was
    // retired, ruling P-2 of plans/0070): suggested wording only —
    // ensureDecomposed checks that context.md is non-empty, never truncates
    // by or rejects on line count.
    contextLines: "200",
  }
}

export function modeText(text: string): string {
  return renderText(text, {})
}
