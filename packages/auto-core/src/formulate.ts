// The formulation task (plans/0095 D1): every task-bearing phase the driver
// plans gets its planning as its first ordinary task unit. This module is the
// driver-side construction — allocate the number, write the formulation
// task's todo.md (the single synthesized prompt input, rendered by
// prompt-plan's renderFormulationTodo) and the index's first line, land the
// `PLAN formulate` commit — plus the recognition helpers the loop, the runner
// and closeUnit share. Modeled on addTask (plans/0058): no session starts
// here, the write path is beginUnit-gated, and the landing is idempotent (a
// re-entry that would rewrite the same body writes nothing). It never imports
// the loop or the session-driving layer.
import { mkdir } from "node:fs/promises"
import { join } from "node:path"
import { beginUnit, commitTree } from "./git"
import { resolvedVerifyPlan, verifyPlanCharterText } from "./intent/guarantees"
import { taskNumber, taskNumberFloor } from "./numbering"
import { phaseLabel, phaseName, type PhaseUnit } from "./phases"
import type { PhaseTypeEntry } from "./phases/registry"
import type { PromptFacts } from "./prompt"
import { loadPlan, qualifiedPhase, recordTodoDigest, renderTaskIndex, renderTaskTodo, taskIndexPath, taskStatePaths, todoDigest, type PlanPhase, type Task } from "./tasks"
import { parseIndex } from "./document/unit"

// The formulation marker (plans/0095 D1): the task document's `Formulate:`
// field, driver-written, carrying the owning phase's qualified id. It parses
// like any field-block line (document/unit keeps every key), loads onto
// Task.formulate, and is honored only where the value equals the owning
// index's phase — a hand-written look-alike on a task of another phase
// matches nothing and behaves as a normal task.
export const formulateTitle = (phase: PhaseUnit): string => `Formulate the ${phaseName(phase)} tasks`

const phaseText = (phase: PhaseUnit): string => `${phaseLabel(phase)} ${phaseName(phase)}`

// Whether one loaded task is the formulation unit of the phase it belongs to.
export const isFormulation = (task: Pick<Task, "formulate">, phase: PlanPhase): boolean => task.formulate === qualifiedPhase(phase)

// The phase's awaiting formulation task (plans/0101 D3/D4): constructed and
// not yet run — pending or blocked, never in flight — wherever it sits in the
// index (beside hand-added tasks too, the review-seam state --new-task
// creates). The one predicate of the dispatch seam: plan's dispatch route,
// transfer's advance pre-check, the loop's stop-condition branch and the
// compose digest-keep all ask this same question, so a hand-added task beside
// the todo never hides the awaiting review.
export function awaitingFormulation<T extends Pick<Task, "id" | "formulate" | "status">>(tasks: readonly T[], phase: PlanPhase): T | undefined {
  return tasks.find((task) => isFormulation(task, phase) && task.status !== "done" && task.status !== "in_progress")
}

// The awaiting formulation read from disk (the loaded plan's tasks); a broken
// index has none — the caller's own routing surfaces the loader's error.
export async function standingFormulation(dir: string, phase: PlanPhase): Promise<Task | undefined> {
  const plan = await loadPlan(dir, phase).catch(() => undefined)
  return plan === undefined ? undefined : awaitingFormulation(plan.tasks, phase)
}

// The phase's formulation state on disk (plans/0095 D4, the pending arm
// re-keyed by plans/0205 D1 onto the awaiting predicate): `none` = the index
// is absent, empty or lists no formulation unit (the fresh-construction
// path); `pending` = a formulation task of this phase stands in the index,
// not done (the re-entry path — rewrite-on-diff when the session has not
// started), WHEREVER it sits — beside hand-added tasks too, the review-seam
// state `--new-task` creates: plans/0101 stage C widened every dispatch
// predicate to that state, and the constructor's recognition now shares it
// (the todo is rewritten alone; the index's other rows are never touched);
// `foreign` = the index lists work and no formulation task of this phase
// stands in it, the formulation writer has no business here.
type FormulationState = { type: "none" } | { type: "pending"; id: string; inProgress: boolean } | { type: "foreign" }

export async function formulationState(dir: string, phase: PlanPhase): Promise<FormulationState> {
  const text = await Bun.file(join(dir, taskIndexPath(phase))).text().catch(() => undefined)
  if (text === undefined) return { type: "none" }
  const entries = parseIndex(text, "task").entries
  if (!entries.length) return { type: "none" }
  // An index the loader rejects (broken state files, a bad graph) is not the
  // constructor's to diagnose: entries exist, so the phase is not empty —
  // file routing surfaces the loader's error itself.
  const plan = await loadPlan(dir, phase).catch(() => undefined)
  if (plan === undefined) return { type: "foreign" }
  const standing = plan.tasks.find((task) => isFormulation(task, phase) && task.status !== "done")
  if (standing === undefined) return { type: "foreign" }
  return { type: "pending", id: standing.id, inProgress: standing.status === "in_progress" }
}

// The formulation number without landing (the compose-and-verify loop's
// preview needs it before construction commits): a standing formulation keeps
// its id's number — wherever it sits in the index (plans/0101 D4's awaiting
// predicate, the same widening the digest-keep made); a fresh construction
// takes the deterministic floor — the same allocation constructFormulation
// makes, over the same unchanged state (nothing runs between the two).
export async function formulationNumber(dir: string, phase: PlanPhase): Promise<number> {
  const standing = await standingFormulation(dir, phase)
  if (standing) return taskNumber(standing.id) ?? (await taskNumberFloor(dir))
  return taskNumberFloor(dir)
}

// The construction (plans/0095 D1): write the formulation task's todo.md plus
// the index's first line, one `PLAN formulate` commit (stage phase-formulate).
// `body` is the rendered single input (renderFormulationTodo's goal / scope /
// acceptance). Idempotent: when a pending formulation task stands in the
// index — beside hand-added rows too (plans/0205 D1) — the body is re-rendered
// and the todo alone rewritten (its own commit of the same grammar — the
// changed-input restart path) only when it differs, and a formulation task
// already in_progress is never rewritten (the session may have read it).
// `record` (plans/0205 D2/D3) threads the construction's two committed
// records into the todo's field block: the floor-assembly digest the
// digest-keep compares (`Floor-Digest:`) and the pre-existing rows the todo
// was constructed beside (`Prefix:`) — both omitted when absent, so a
// construction without them renders the pre-0205 document byte-identically.
// numberStart of the result is the formulation number + 1 — the first number
// the formulation session's own tasks may take.
type ConstructedFormulation =
  | { type: "constructed"; id: string; numberStart: number }
  | { type: "current"; id: string; numberStart: number }
  | { type: "dirty"; files: string[] }
  | { type: "unreadable"; files: string[] }
  | { type: "failed"; question: string }

export async function constructFormulation(
  dir: string,
  phase: PhaseUnit,
  body: { goal: string; scope: string; acceptance: string },
  record?: { digest?: string; prefix?: string[] },
): Promise<ConstructedFormulation> {
  const state = await formulationState(dir, phase)
  if (state.type === "foreign") {
    return { type: "failed", question: `${taskIndexPath(phase)} lists work and no formulation task of this phase stands in it; the formulation constructor only writes an empty phase` }
  }
  if (state.type === "pending" && state.inProgress) {
    return {
      type: "failed",
      question: `the formulation task ${state.id} is already in progress — its todo is the session's single input and is not rewritten mid-run; let the run finish it, or close the phase (${qualifiedPhase(phase)}) to plan anew`,
    }
  }
  const task = { id: "PLAN", title: `phase formulate (${phaseText(phase)})` }
  const gate = await beginUnit(dir, {}, task)
  if (gate.type === "dirty" || gate.type === "unreadable") return { type: gate.type, files: gate.files }
  // The number: a re-entry keeps the formulation task's own id (the index
  // line and any audit trail already name it); a fresh construction takes
  // the deterministic floor (plans/0150: the surviving files are the whole
  // numbering evidence — a fork worktree continues its own lineage's
  // numbers, and nothing persisted can push past them).
  const floor = await taskNumberFloor(dir)
  const n = state.type === "pending" ? taskNumber(state.id) ?? floor : floor
  const id = `T-${String(n).padStart(3, "0")}`
  const title = formulateTitle(phase)
  const pending = taskStatePaths(id).pending
  const document = renderTaskTodo({
    id,
    title,
    phase: qualifiedPhase(phase),
    formulate: qualifiedPhase(phase),
    decompose: "whole",
    depends: "none",
    ...(record?.prefix?.length ? { prefix: record.prefix } : {}),
    ...(record?.digest !== undefined ? { floorDigest: record.digest } : {}),
    goal: body.goal,
    scope: body.scope,
    acceptance: body.acceptance,
  })
  const previous = await Bun.file(join(dir, pending)).text().catch(() => undefined)
  const fresh = state.type === "none"
  // The landed-todo digest (plans/0171 D6): recorded beside the floor digest
  // on every construction (and re-recorded on the idempotent `current`
  // return, which heals a pre-0171 standing construction whose todo still
  // matches the render) — the formulation collect compares the file on disk
  // against it, so the ledger and the Acceptance it judges are the driver's
  // landed text, never the session's edited copy.
  if (previous === document && !fresh) {
    await recordTodoDigest(dir, id, todoDigest(document))
    return { type: "current", id, numberStart: n + 1 }
  }
  await mkdir(join(dir, "docs", id), { recursive: true })
  await Bun.write(join(dir, pending), document)
  const index = taskIndexPath(phase)
  const indexFile = join(dir, index)
  if (fresh) {
    await Bun.write(indexFile, renderTaskIndex(qualifiedPhase(phase), [{ id, title }]))
  }
  const settled = await commitTree(dir, task, { stage: "phase-formulate", subject: `PLAN formulate ${phaseText(phase)}` })
  if (!settled.ok) {
    return {
      type: "failed",
      question: `formulation commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The task is left in the worktree; commit manually — a re-run writes the same content and does not duplicate it`,
    }
  }
  await recordTodoDigest(dir, id, todoDigest(document))
  return { type: fresh ? "constructed" : "current", id, numberStart: n + 1 }
}

// The blocked collect's own self-heal (plans/0171 D7, enacting S08-06): a
// formulation session that dropped its own row from the phase index left
// the unit invisible to every later load — the collect's blocked voice
// taught a hand restore while a plain re-run silently executed the unjudged
// plan through a "clean phase end". The driver re-inserts the row at the
// head (construction's position, ahead of the planned tasks) and commits it
// as its own write, so the re-run re-dispatches the formulation over the
// surviving files exactly as 0141 D2 promises. Idempotent — a row already
// present, or no index at all, writes nothing.
export async function restoreFormulationRow(dir: string, phase: PlanPhase, id: string, title: string): Promise<boolean> {
  const index = taskIndexPath(phase)
  const text = await Bun.file(join(dir, index)).text().catch(() => undefined)
  if (text === undefined) return false
  if (parseIndex(text, "task").entries.some((entry) => entry.id === id)) return false
  const lines = text.split("\n")
  const at = lines.findIndex((line) => /^[-*] \[.[x ]\] /.test(line))
  const row = `- [ ] ${id} ${title}`
  if (at < 0) lines.push(row)
  else lines.splice(at, 0, row)
  await Bun.write(join(dir, index), `${lines.join("\n")}${text.endsWith("\n") ? "" : "\n"}`)
  return true
}

// The charter-as-acceptance (plans/0095 D2, phase-aware since 0097 D1): the
// generic plan-quality core every formulation task is verified against, plus
// — when the active pack's `## guarantees` declares charters for this
// formulation — the resolved charter verbatim under its lead-in: the
// pack-global `### verify-plan` first, then the phase's own
// `### verify-plan-<phase type id>` when declared (the id is canonical, a
// builtin's preset letter a legacy spelling still resolved, plans/0100 D9;
// m mode passes no entry and gets the pack-global charter alone, plans/0097
// D10). The wrap-up session judges these by inspection of the unit's commit
// range. The charter prose is driver document-grammar teaching over the
// durable todo the driver parses — renderer-owned under P15's named boundary
// (plans/0221 D2).
const FORMULATION_CHARTER = [
  "- every obligation the Scope's inputs name — the planning input's asks, the round brief's goals, the phase duties, and what the prior phases' handovers mark as required reading or as open — is covered by some planned task's scope, or explicitly deferred with the reason recorded in that task's document;",
  "- every planned task's `## Acceptance` states criteria a later session can verify by inspecting the work (named evidence, observable outcomes, the executable checks that apply), never a bare \"done\";",
  "- every planned task is executable from its own document plus docs/ alone — a self-contained scope, no reliance on reasoning that stayed in this session;",
  "- a task whose output other tasks consume declares it in its document's `Artifacts:` field (the concrete file paths it will land), so the dependency park's honesty gate can check those consumables are complete before the task ever parks (plans/0096 D6);",
  "- decisions taken while planning are recorded where they belong (AUTO-RESOLVE / AUTO-DECISION lines in the documents they shape), and deferrals say so openly;",
  "- the task index and task documents follow the driver's format protocol exactly (the protocol strings parse, or the phase blocks).",
].join("\n")

export function formulationAcceptance(facts: PromptFacts, entry?: PhaseTypeEntry): string {
  const resolved = resolvedVerifyPlan(facts.pack, entry)
  const charter = verifyPlanCharterText(resolved)
  return charter
    ? `${FORMULATION_CHARTER}\n\nThe project's intent charter binds this plan in addition:\n\n${charter}`
    : FORMULATION_CHARTER
}
