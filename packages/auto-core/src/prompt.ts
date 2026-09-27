// Prompt context assembly layer: all copy lives in templates/prompts/*.md
// (shared partials in _partials.md, rendered through src/template.ts; the
// target directory's .opencode/auto/prompts/ can override it); this layer
// only assembles plan/task/run info into template variables. The render*
// signatures stay stable, so runner/loop call sites are unaware of the
// template mechanism.
import { dirname, join } from "node:path"
import type { ModeSpec } from "./mode"
import { dutiesForPhase, loadIntents, packSubsection, resolveIntent } from "./intent/load"
import type { IntentPack, IntentSection } from "./intent/types"
import { subtaskDoc, taskDoc } from "./docpaths"
import { prerequisites, type Plan, type Status, type Task } from "./tasks"
import type { ResolveItem } from "./resolve"
import type { StuckHit } from "./stuck"
import { phaseType, REQUIRED_TYPE, type PhaseKey, type PhaseTypeEntry } from "./phases/registry"
import { autoSwitches, type TaskContextMode } from "./switches"
import { promptTemplateNames, renderTemplate, renderText, type Ctx } from "./template"

// The active intent pack (M1.2/M1.3, plans/0032+0033): the (b)-class content
// of the decompose family (split granularity criteria + per-phase duties) and
// the subtask family's closing self-check sentences lives in the pack, not in
// the core templates; the assembly point injects it as pre-rendered data
// (decomposeRule/phaseDuties/selfCheck vars). Default state = the built-in
// preset; loop-preflight calls useIntentPacks(dir) next to usePromptLibrary so
// the project overlay (.opencode/auto/intents/) applies; invalid pack files
// throw there as usage errors. Degenerate composition only (F8): one active
// pack, a same-named project file overrides the built-in wholesale.
let activeIntentPack: IntentPack = resolveIntent(loadIntents())

export function useIntentPacks(dir: string | undefined): void {
  activeIntentPack = resolveIntent(loadIntents(dir))
}

// plan's sessions (RunAllOpts.stopBefore === "execute"): a human is attending,
// so the question-rule partial renders its human-answer branch — the session
// asks, the driver waits for the human's answer with no timeout, and no
// AUTO-RESOLVE proxy answer or labeling applies. Set once in preflight next to
// usePromptLibrary/useIntentPacks (same per-process load point), read by
// promptCtx below; run sets it false and renders exactly as before.
let humanQuestions = false

export function useHumanQuestions(on: boolean): void {
  humanQuestions = on
}

// Pack-section injection helper: address a `### <key>` subsection of the
// active pack and pre-render it with the session context (pack text may use
// the template syntax, same license as mode files); absent section/key
// yields undefined and the template guard drops the block cleanly.
// Exported for src/prompt-plan.ts, like renderPrompt, phaseTag and modeText.
export function intentText(section: IntentSection, key: string, ctx: Ctx): string | undefined {
  const text = packSubsection(activeIntentPack, section, key)
  return text && renderText(text, ctx)
}

// testByDriver/handoverTest: the --test-by-driver test execution protocol (a
// run-level switch); when true the execution templates (subtask/whole) inject
// the protocol section.
// phase/contextLimit/fine: the phased flow's current phase (PhaseKey: the
// qualified id plus the type entry), the context budget baseline (tokens) and
// the fine-grained decompose switch (OPENCODE_AUTO_DECOMPOSE_FINE, wiring in
// plans/0003-fork-decompose-design.md §4.6) — the entry's decompose template is
// chosen and rendered from these (phaseName = the display name; contextBudget =
// the half-budget granularity ceiling; fine injects the fine-grained criteria).
// taskContext: the understanding digest's line-count tier
// (OPENCODE_AUTO_TASK_CONTEXT, see src/switches.ts); the understand template
// renders contextLines from it (suggested wording, not a hard cut).
type Opts = {
  mode?: ModeSpec
  testByDriver?: boolean
  handoverTest?: boolean
  phase?: PhaseKey
  contextLimit?: number
  fine?: boolean
  taskContext?: TaskContextMode
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
export function promptCtx(ctx: Ctx): Ctx {
  const full: Ctx = { ask: autoSwitches().ask, humanQuestions, resolveFormat: RESOLVE_FORMAT, decisionFormat: DECISION_FORMAT, ...ctx }
  const key = full.ask ? "decisionsAsk" : "decisionsUnattended"
  return { ...full, [key]: intentText("governance", full.ask ? "decisions-ask" : "decisions-unattended", full) }
}

export function renderPrompt(name: string, ctx: Ctx): string {
  return renderTemplate(name, promptCtx(ctx))
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

// --handover-test's test handover document (relative to the target
// directory): when the context limit is reached (the decision point is
// fixed at "the moment the AI initiates the test"; test failure no longer
// stacks onto it), the session writes its progress and next steps into
// this file and ends; the driver archives it as testhandoff-<n>.md and
// opens a new session that continues on the continuation prompt. The file
// is named per execution scope: a subtask session writes
// docs/<id>/S<two-digit ordinal>/testhandoff.md, a whole-task session is
// task-level (docs/<id>/testhandoff.md) — the handover document applies
// only to its own execution scope, preventing the next subtask from
// misreading the previous subtask's leftover handover. Path construction
// goes through docpaths (the single construction point of the
// directory-based layout); the exported name and signature stay stable,
// zero change to runner's call surface.
export function testHandoffFile(task: Task, subtask?: number): string {
  return subtask !== undefined ? subtaskDoc(task.id, subtask, "testhandoff") : taskDoc(task.id, "testhandoff")
}

// Test execution result feedback (steered into the executing session): exit code
// and output file path; the AI reads the file directly to judge.
export function renderTestResult(run: TestRunInfo): string {
  return renderPrompt("test-result", {
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
// ("will be executed by the driver"): in the sequential mode the test only
// runs after the handover close-out, in the concurrent mode
// (OPENCODE_AUTO_HANDOVER_CONCURRENT=on) it is already running at this
// moment — one copy holds in both modes.
//
// Hard copy constraint (test-handover front-loading design D2): **must not
// mention "context / over the limit / limit / tokens"** — once a session
// knows its context is tight, it judges the remaining budget insufficient
// itself and skips the write-out work it should have completed
// (field-verified); state only the fact that "a handover is needed and the
// session must switch". Likewise it never says "do not modify source": in
// the sequential mode the session's wrap-up changes land in commit #2
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
export function renderTestWrapup(info: { handoffFile: string }): string {
  const ctx: Ctx = { handoffFile: info.handoffFile }
  return renderPrompt("test-wrapup", {
    ...ctx,
    finishRule: intentText("governance", "test-handover-finish", ctx),
    leftoverRule: intentText("governance", "test-handover-leftover", ctx),
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
export function renderTestContinue(input: { handoffFile: string; run?: TestRunInfo; stuck?: number }): string {
  return renderPrompt("test-continue", {
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
export function renderContextBase(task: Task, digest: string): string {
  return renderPrompt("context-base", { taskId: task.id, digest })
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
export function renderDecompose(plan: Plan, task: Task, opts: Opts = {}): string {
  const ctx = baseCtx(plan, task, opts)
  const entry = phaseEntry(opts.phase)
  // A custom type's own `## decompose duties` wins; otherwise the active
  // pack's `### <dutiesRef>` subsection.
  const duties = entry.decomposeDuties ?? dutiesForPhase(activeIntentPack, entry.dutiesRef)
  return renderPrompt(decomposeTemplateName(entry, promptTemplateNames()), {
    ...ctx,
    decomposeRule: intentText("quality", "decompose", ctx),
    phaseDuties: duties && renderText(duties, ctx),
    // context.md section layout (M2.1): `## artifact spec` / `### context-digest`.
    contextDigest: intentText("artifactSpec", "context-digest", ctx),
  })
}

// decompose template-name resolution (a pure function, easy to unit-test):
// phase type entry → decomposeTemplate (default implement); names is the
// currently active template-name list (promptTemplateNames()); an absent
// name falls back to the generic decompose.
export function decomposeTemplateName(entry: PhaseTypeEntry | undefined, names: string[]): string {
  const candidate = (entry ?? phaseEntry(undefined)).decomposeTemplate
  return names.includes(candidate) ? candidate : "decompose"
}

// The current phase's type entry; outside the phase loop, implement.
function phaseEntry(phase: PhaseKey | undefined): PhaseTypeEntry {
  return phase?.entry ?? phaseType(REQUIRED_TYPE)!
}

// The `{{phase}}` prompt var: the preset letter of a builtin type, the type id
// of a custom one.
export const phaseTag = (entry: PhaseTypeEntry): string => entry.letter ?? entry.type

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
const STATUS_TEXT: Record<Status, string> = { pending: "not started", in_progress: "in progress", blocked: "blocked", done: "done" }

// Tick snapshot: S01☑ S02☐ …, done k/n (effective done flags — the state files
// win — which is exactly the authoritative information the session cannot read).
function subtaskSnapshot(items: { done: boolean }[]): string | undefined {
  if (!items.length) return undefined
  const ticks = items.map((item, i) => `S${String(i + 1).padStart(2, "0")}${item.done ? "☑" : "☐"}`).join(" ")
  return `${ticks}, done ${items.filter((item) => item.done).length}/${items.length}`
}

// Inline list of previously completed task ids (same source as head's doneList;
// the grounded-state declaration line inlines ids only and does not restate the
// title list, avoiding duplication with head's completed list).
function doneIds(plan: Plan): string | undefined {
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
// fork-decompose design §8): inject the full checklist list plus "you are
// responsible for only item N of it this run", the standalone write-out
// file for document-type outputs (mechanically named by the driver), and
// warm = the session inherited the task background context from the fork
// base (a cold start instead prompts reading the context.md digest first).
// When absent, index/list/output file are derived from the task checklist
// (subtasks.md) (same convention as the runner's subtask loop); old
// callers passing no params still render the full prompt.
export function renderSubtask(
  plan: Plan,
  task: Task,
  subtask: string,
  opts: Opts & { continuation?: boolean; index?: number; subtaskList?: string; outputFile?: string; warm?: boolean } = {},
): string {
  const items = task.checklist ?? []
  const at = opts.index !== undefined ? opts.index - 1 : items.findIndex((item) => !item.done && item.text === subtask)
  const index = at >= 0 ? String(at + 1) : undefined
  const ctx = baseCtx(plan, task, { ...opts, index: index !== undefined ? Number(index) : undefined })
  const outputFile = opts.outputFile ?? (index !== undefined ? subtaskOutputFile(task, at + 1) : undefined)
  return renderPrompt("subtask", {
    // The derived index value is fed back into baseCtx: the test handover
    // document naming (the test protocol section) and the "item N" injected
    // here share one source, so under default derivation (old callers not
    // passing index) the naming likewise lands in the subtask-level
    // directory.
    ...ctx,
    subtask,
    continuation: Boolean(opts.continuation),
    handoffFile: handoffFile(task),
    // Closing self-check sentence (M1.3): (b)-class quality intent from the
    // active pack's `## quality` / `### self-check-subtask`; the guard drops
    // the wrap-up item cleanly when the pack omits it (zero-intent baseline).
    selfCheck: intentText("quality", "self-check-subtask", ctx),
    // Output-placement convention (M1.4, plans/0034 D7/D8): (b)-class artifact
    // convention from the active pack's `## artifact spec` / `### subtask-output`,
    // pre-rendered with the output-file slot (the convention text references
    // {{outputFile}}). Injected only when the slot exists (index given or
    // derived); a pack omitting the subsection drops the block cleanly.
    artifactConvention: outputFile ? intentText("artifactSpec", "subtask-output", { ...ctx, outputFile }) : undefined,
    // P1 discipline (M2.3, plans/0045): the deliverable must not reference
    // process documents — `## governance` / `### process-references`; the
    // DRIVER's prohibition scan at close-out is the mechanical side.
    processRefs: intentText("governance", "process-references", ctx),
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
    subtaskList: opts.subtaskList ?? (items.length ? items.map((item, i) => `${i + 1}. ${item.text}`).join("\n") : undefined),
    outputFile,
    // Subtask-directory state protocol (M1.0): the scope declaration file
    // fixed at decompose time; old-shape tasks lack the file, and the
    // template conditions on it with "if it exists" wording.
    todoFile: index !== undefined ? subtaskDoc(task.id, Number(index), "todo") : undefined,
    warm: Boolean(opts.warm),
  })
}

// Subtask output file (relative to the target directory): the standalone
// write-out file for document/analysis/design-type subtasks, mechanically
// named by the driver (two-digit increment, avoiding slug-cleaning
// ambiguity) with the title on the file's first line; code-type outputs
// land directly in the source tree and are not duplicated as documents
// (fork-decompose design §4.7). Constructed through docpaths' directory
// layout.
export function subtaskOutputFile(task: Task, index: number): string {
  return subtaskDoc(task.id, index, "index")
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
export function renderWrapup(plan: Plan, task: Task, opts: Opts & { solo?: boolean; resolves?: ResolveItem[] } = {}): string {
  const ctx = baseCtx(plan, task, opts)
  return renderPrompt("wrapup", {
    ...ctx,
    solo: Boolean(opts.solo),
    resolveList: resolveList(opts.resolves),
    reportForm: intentText("artifactSpec", opts.solo ? "report-solo" : "report-indexed", ctx),
    auditScope: intentText("governance", "wrapup-audit", ctx),
    // Result-line discipline (plans/0044 §3.1): when to write the line and what
    // counts as FAIL is intent (`## acceptance` / `### result-line`); the literal
    // and its placement stay core. A pack without the subsection drops the
    // whole instruction — no result line, the run never stops on a verdict.
    resultRule: intentText("acceptance", "result-line", ctx),
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
function resolveList(items: ResolveItem[] | undefined): string | undefined {
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
export function renderNumberRecovery(input: { floor: number }): string {
  return renderPrompt("number-recovery", {
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
export function renderPhaseHandover(input: {
  phase: PhaseTypeEntry
  handover: string
  next?: string
  acceptance?: string
  closedTasks?: { id: string; title: string; reason: string }[]
}): string {
  const closed = input.closedTasks ?? []
  return renderPrompt("phase-handover", {
    phase: phaseTag(input.phase),
    phaseName: input.phase.name,
    handover: input.handover,
    next: input.next,
    acceptance: input.acceptance,
    acceptanceRules: input.acceptance ? intentText("acceptance", "phase-acceptance-draft", { acceptance: input.acceptance }) : undefined,
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
export function renderKnowledge(input: { file: string; mode?: ModeSpec }): string {
  const ctx = { file: input.file, ...modeCtx(input.mode) }
  return renderPrompt("knowledge", { ...ctx, qualityRules: intentText("quality", "knowledge", ctx) })
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
export function renderPriorKnowledge(input: { file: string; brief?: string; mode?: ModeSpec; distilled?: string[] }): string {
  const distilled = input.distilled?.filter(Boolean) ?? []
  const ctx = {
    file: input.file,
    brief: input.brief?.trim() || undefined,
    distilled: distilled.length ? distilled.map((path) => `- ${path}`).join("\n") : undefined,
    ...modeCtx(input.mode),
  }
  return renderPrompt("prior-knowledge", { ...ctx, qualityRules: intentText("quality", "prior-knowledge", ctx) })
}

// Handover document (relative to the target directory): written by an ondemand
// whole-task session when it hands its context over (self-decided at a natural
// boundary, or after the hard-wall steer; plans/0056) — the session writes its
// progress into this file, and the trailing line `Status: continue|done` is
// parsed by the driver. Constructed through docpaths (the task-directory
// layout).
export function handoffFile(task: Task): string {
  return taskDoc(task.id, "handoff")
}

// The hard-wall steer the driver inserts while a session is running (usage
// reached the wall, testrun.ts steerWall: 2x contextLimit, raised to a quarter
// of a large model window and clamped to 80% of it; ondemand
// whole-task sessions only — the last resort after the usage notices went
// unacted-on, plans/0056). The v2 prompt is a steer by default, entering the
// session at the next provider-turn boundary.
export function renderHandoffSteer(task: Task): string {
  return renderPrompt("handoff-steer", { handoffFile: handoffFile(task) })
}

// Usage notices steered into a running ondemand whole-task session at budget
// milestones (plans/0056): the 50% band is informational, the 85% band advises
// winding down at the next natural boundary. The figures do not exist at
// render time — the {{used}}/{{pct}}/{{wall}} slots round-trip as literal
// placeholders that the driver fills at send time (fillUsageNote in
// src/testrun.ts).
export function renderUsageNoteInfo(task: Task): string {
  return renderPrompt("usage-note-info", usageNoteCtx(task))
}

export function renderUsageNoteWinddown(task: Task): string {
  return renderPrompt("usage-note-winddown", usageNoteCtx(task))
}

function usageNoteCtx(task: Task): Ctx {
  return { handoffFile: handoffFile(task), used: "{{used}}", pct: "{{pct}}", wall: "{{wall}}" }
}

// Context step-up note (steered into the same session when its context
// reaches the current step's step-up point, plans/0055 §4.5): the session
// continues in place on the next step's id — same history, shared prompt
// cache — and the steer itself names that id, so the next provider turn
// runs on it. One line: the session needs to know only that nothing else
// changed.
export function renderStepUp(input: { from: string; next: string }): string {
  return renderPrompt("step-up", { fromModel: input.from, toModel: input.next })
}

// The failure-message classifier's prompt (plans/0055 §7.1, src/classify.ts):
// the current time in the registry's time zone (`now`, ISO 8601 with the
// zone's offset), the zone itself, and the redacted error text — nothing
// else leaves the driver in this session. The reply shape (one JSON line of
// class and resetAt) is parsed by src/classify.ts parseClassifierReply.
export function renderClassifyError(input: { now: string; tz: string; error: string }): string {
  return renderPrompt("classify-error", { now: input.now, tz: input.tz, error: input.error })
}

// Stuck-loop hint (steered into a running session when the driver detects
// repeated actions, src/stuck.ts): level sets the force of the hint — 1 switch
// approach, 2 write the diagnosis before acting, 3 stop retrying and close out
// (at most three per session). Injected by steer like the handover steer; the
// two do not interfere.
// The level-2 reflection discipline (M2.1) comes from `## quality` /
// `### stuck-reflection`; the reminder framing stays core.
export function renderStuckHint(hit: StuckHit): string {
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
  return renderPrompt("stuck-hint", { ...ctx, reflection: hit.level === 2 ? intentText("quality", "stuck-reflection", ctx) : undefined })
}

// Raw (unrendered) subsection of the active intent pack, for consumers outside
// the prompt templates — preflight's check that the configured `## parallelism`
// level exists.
export function activeIntentText(section: IntentSection, key: string): string | undefined {
  return packSubsection(activeIntentPack, section, key)
}

// --subtask off/auto/ondemand: a single session completes the whole task (no
// subtask decomposition; auto's lead, which has no split clause yet, renders
// as ondemand — plans/0059 D2). ondemand additionally carries the context-budget
// protocol (usage notices + self-directed handover, plans/0056) when budget
// is set — the caller passes it only while the steer is built, so
// OPENCODE_AUTO_STEER=off renders no protocol and ignores handover documents;
// continuation means the previous session handed its context over and this
// one must read the handover document before continuing.
export function renderWhole(
  plan: Plan,
  task: Task,
  opts: Opts & { ondemand?: boolean; continuation?: boolean; budget?: boolean } = {},
): string {
  const ctx = baseCtx(plan, task, opts)
  return renderPrompt("whole", {
    ...ctx,
    ondemand: Boolean(opts.ondemand),
    continuation: Boolean(opts.continuation),
    budget: Boolean(opts.budget),
    handoffFile: handoffFile(task),
    // Closing self-check sentence (M1.3, same as renderSubtask but keyed to
    // the whole-task scope): `## quality` / `### self-check-whole`.
    selfCheck: intentText("quality", "self-check-whole", ctx),
    // P1 discipline (M2.3), same subsection as renderSubtask.
    processRefs: intentText("governance", "process-references", ctx),
  })
}

// --dryrun: the permission-preflight session; its report goes to
// .auto/dryrun.md.
export function renderDryrun(): string {
  return renderPrompt("dryrun", {})
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
function doneList(plan: Plan): string {
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

// The understand digest's suggested line-count tiers
// (OPENCODE_AUTO_TASK_CONTEXT, the switch layer is src/switches.ts): off is
// the status quo (200, matching the pre-change hardcoded wording);
// small/medium/large loosen step by step. Only the "suggested line count"
// wording in the prompt changes — ensureDecomposed only checks that
// context.md is non-empty, never truncates by or rejects on line count;
// raising the tier changes no validation behavior.
const TASK_CONTEXT_LINES: Record<TaskContextMode, number> = { off: 200, small: 300, medium: 400, large: 500 }

// Driver notes appended to the task block (plans/0053 D16): one line per
// effective prerequisite (explicit or implicit) that was closed, so the
// session does not build on deliverables that never landed. Empty without
// closures, keeping the task block byte-identical.
function closedPrerequisiteNotes(plan: Plan, task: Task): string {
  return prerequisites(plan, task.id)
    .filter((id) => plan.closed.has(id))
    .map(
      (id) =>
        `[DRIVER] Prerequisite ${id} was closed without completing (${plan.closed.get(id)}); do not assume its deliverables exist.`,
    )
    .join("\n")
}

function baseCtx(plan: Plan, task: Task, opts: Opts & { index?: number } = {}): Ctx {
  const entry = phaseEntry(opts.phase)
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
    testHandoffFile: opts.testByDriver ? testHandoffFile(task, opts.index) : undefined,
    phase: phaseTag(entry),
    phaseName: entry.name,
    contextBudget: formatTokens((opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT) / 2),
    fine: Boolean(opts.fine),
    contextLines: String(TASK_CONTEXT_LINES[opts.taskContext ?? "off"]),
  }
}

export function modeText(text: string): string {
  return renderText(text, {})
}
