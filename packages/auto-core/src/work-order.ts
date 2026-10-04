// The standalone work order and its adopt step (plans/0076, ruled 2026-10-04,
// T-137): the guest-model machinery — a coding-agent session the driver
// cannot drive executes a rendered work order in this driver-governed
// directory, and the driver stays the renderer and the bookkeeper. One
// process, two session engines, zero parallel prompt variants:
//   - workOrder renders the same bytes a driver-run whole-task session (auto's
//     fresh lead) receives, under the attended question flag — the person is
//     at the keyboard of the standalone session, so its questions come
//     straight to them (question-rule's humanQuestions branch, the attended
//     variant that already existed). The work order opens with the
//     constitution preamble (agents-block.ts's single source, T-131's second
//     rendering): a standalone session may run in an agent that reads no
//     AGENTS.md and never sees the auto.md contract, so its work order
//     carries the constitution itself — the full constitution, never a
//     trimmed selection. The export renders, never edits; templates stay the
//     only prompt source.
//   - adoptUnit runs the driver half for an externally-driven unit: standard
//     close-out validation, the test handover (the idle loop's replacement —
//     tmp/test.sh through the testrun/script machinery, one protocol), the
//     ticks and todo.md → done.md renames, and the unified commit with the
//     Auto-Stage trailer. The person must not hand-commit: a human commit
//     inside a unit's range breaks the SHA-baseline audit — adopt is the
//     required closer.
// The routes (when these run, their refusals) live in plan's prelude
// (src/plan.ts); this module holds the two halves' bodies so every shell
// reaches them through planPrelude alone.
import { join } from "node:path"
import { renderConstitutionPreamble } from "./agents-block"
import { docShapeProblems } from "./doccheck"
import { taskDoc, taskDocPaths } from "./docpaths"
import { processReferenceScan } from "./document/process-refs"
import { eofScanExempt, parseResult } from "./document/roles"
import { checklistProblems, scanSubtaskStates } from "./document/state"
import { commitTree, headText, unitAddedLines, unitBaseline, unitChangedFiles, unitQuiet, unitViolations } from "./git"
import { log } from "./log"
import type { ModeSpec } from "./mode"
import { renderWhole, type PhaseEntry } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { shellProfile } from "./shell"
import { scriptTmpDir } from "./script"
import { autoSwitches } from "./switches"
import { latestTestSeq, resolveTestScript, runTestScript, type TestRun } from "./testrun"
import { markDone, prerequisites, promptViews, subtasks, type Plan, type Task } from "./tasks"

// The render inputs that come from the run's config, exactly as any render
// reads them (plans/0076 §3: no new branches, everything from the config —
// mode, the test-execution protocol's two switches, and the phase the route
// names now, which keys the {{phase}} var the intent texts may read).
export type WorkOrderOpts = {
  mode?: ModeSpec
  testByDriver?: boolean
  handoverTest?: boolean
  phase?: { id: string; entry: PhaseEntry }
}

// The work order: the constitution preamble + the fresh whole-task session's
// prompt, rendered with the production renderer and facts under the attended
// flag. The render flags mirror what executeWhole computes for a task that
// starts now (the lead's first prompt under the default adaptive execution):
//   - ondemand true, continuation false — a session that starts the task, not
//     one that continues a handover document;
//   - budget = the steer switch — the context-budget protocol rides the
//     session exactly as a driver run's lead gets it;
//   - adaptive = the switch on and the committed checklist empty — the split
//     clause's own condition (a checklist a person committed is a split
//     already decided; executeWhole reads the base from HEAD, falling back to
//     the disk copy only without a commit — the same read here). The export
//     knows no fleet; a forking fleet is the default capability a driver run
//     starts from, so the clause is offered.
// No value here is the work order's own: every flag is what the driver
// session would compute, so the bytes cannot drift (test/agent-fake.test.ts
// pins the equality against the session the driver actually dispatches).
export async function workOrder(dir: string, plan: Plan, task: Task, opts: WorkOrderOpts = {}): Promise<string> {
  const facts = promptFacts({ dir, humanQuestions: true })
  const subtasksRel = taskDoc(task.id, "subtasks")
  const checklistBase = (await headText(plan.dir, subtasksRel)) ?? (await Bun.file(join(plan.dir, subtasksRel)).text().catch(() => ""))
  const steer = autoSwitches().steer
  const views = promptViews(plan, task)
  const prompt = renderWhole(facts, views.plan, views.task, taskDocPaths(task.id), {
    mode: opts.mode,
    testByDriver: opts.testByDriver,
    handoverTest: opts.handoverTest,
    phase: opts.phase,
    ondemand: true,
    continuation: false,
    budget: steer,
    adaptive: steer && subtasks(checklistBase).length === 0,
  })
  // The preamble's TEST_PRINCIPLE follows the same switch the AGENTS.md
  // block renders under (one source, two renderings): the test handover the
  // adopt step executes exists precisely under testByDriver.
  return `${renderConstitutionPreamble({ testByDriver: opts.testByDriver })}\n\n${prompt}`
}

// The readiness predicate of both routes (plans/0076 ruling 4: any ready
// unit, not just the dependency graph's leaves — adopt re-checks anyway):
// next()'s own predicate over the loaded plan — the unit is not done and its
// effective prerequisites are (external ids count as done exactly as there;
// loadPlan admits them only as completed tasks). Returns the refusal line,
// undefined when the unit may be taken.
export function unitNotReady(plan: Plan, task: Task): string | undefined {
  if (task.status === "done") return `${task.id} is already done`
  const own = new Set(plan.tasks.map((unit) => unit.id))
  const done = new Set(plan.tasks.filter((unit) => unit.status === "done").map((unit) => unit.id))
  for (const unit of plan.tasks) {
    if (Array.isArray(unit.depends)) for (const dep of unit.depends) if (!own.has(dep)) done.add(dep)
  }
  const missing = prerequisites(plan, task.id).filter((dep) => !done.has(dep))
  if (missing.length) return `${task.id} is not ready: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not done yet`
  return undefined
}

// Adopt's result: ok lines print on stdout (exit 0); a refused or failed
// adopt carries its code (1 = refused by validation, 2 = the commit or the
// close-out check failed — close's own convention).
export type AdoptOutcome = { ok: boolean; code: 0 | 1 | 2; lines: string[] }

// The adopt step: the driver half for a unit a standalone session executed.
// Order (plans/0076 §2.3):
//   1. the test handover first — tmp/test.sh is the session's request, and it
//      is consumed and executed whatever the validation finds: a blocked
//      validation must not strand the session's last request, and a leftover
//      marker would be misread by the next driver run as a live session's
//      request (testrun.ts's own warning). The exit code and the merged
//      output path are reported back — the verdict belongs to the session
//      that reads the output, never to the driver (script.ts's own rule).
//      tmp/ is gitignored, so this writes nothing the commit below would
//      sweep; "a failing validation blocks without writes" is about the
//      driver's state writes, which all sit behind the validation gate.
//   2. validation, all checks before any driver write:
//      - state-file grammar through unitProblems: the task level is
//        loadPlan's own throw (the caller catches it); the subtask level is
//        the state scan + the checklist graph — the subtask loop's own entry
//        prechecks, so a standalone session cannot strand an illegal S<nn>
//        state behind a done task;
//      - zero disk writes (the session left nothing to adopt — also the
//        shape a hand-committed session takes, the exact break the
//        SHA-baseline audit exists for);
//      - the eof terminators: every .md of the unit's git changes (the
//        uncommitted tree — the session cannot commit) must be non-trivial
//        and end with the terminator, the whole-unit scan of the subtask
//        close-out;
//      - the P1 scan over the unit's added lines (deliverable files must not
//        reference process documents);
//      - the report result line: a Result: FAIL blocks (missing report or
//        line = no verdict, the closeout's own semantics).
//   3. the ticks and the todo.md → done.md rename (markDone), then
//   4. the unified commit with the Auto-Stage trailer (stage "done", the
//      serial loop's own terminal-commit shape — an adopted unit is
//      indistinguishable in history from a driver-run one), then
//   5. the close-out check over the baseline taken at adopt time: the
//      commit range must be all driver commits.
// The baseline (the ledger snapshot) is re-derived here, never trusted from
// the export: everything the session wrote sits in baseline..worktree,
// because the constitution forbids it to commit.
export async function adoptUnit(
  dir: string,
  plan: Plan,
  task: Task,
  opts: { scanExempt?: readonly string[]; idleMs?: number; maxMs?: number } = {},
): Promise<AdoptOutcome> {
  const { bin } = shellProfile()
  const baseline = await unitBaseline(dir)
  // 1. The test handover (the idle loop's replacement).
  const testLines: string[] = []
  const tmp = scriptTmpDir(dir)
  if (await Bun.file(join(tmp, "test.sh")).exists()) {
    const test: TestRun = {
      dir,
      tmp,
      handoffFile: "",
      handover: false,
      limit: 0,
      seq: await latestTestSeq(tmp),
      task,
      unit: task.id,
      subject: `${task.id} exec ${task.title}`,
      label: task.id,
      handovers: 0,
      startUsed: 0,
    }
    const pending = await resolveTestScript(test)
    const info = await runTestScript(test, { idleMs: opts.idleMs, maxMs: opts.maxMs }, pending.script, pending.seq)
    testLines.push(`⚙ test handover executed (exit code ${info.code}); the merged output is in ${info.out} — the standalone session judges the result, not the driver`)
  }
  // 2. Validation (a failure blocks with no driver write).
  const problems: string[] = []
  const items = task.checklist ?? []
  const scan = await scanSubtaskStates(dir, task.id, items.length)
  for (const bad of scan.illegal) {
    const which = bad.kind === "both" ? "both todo.md and done.md exist" : "neither todo.md nor done.md exists"
    problems.push(`docs/${task.id}/S${String(bad.index).padStart(2, "0")} state files are illegal (${which})`)
  }
  problems.push(...checklistProblems(items))
  if (await unitQuiet(dir, baseline)) problems.push("no changes relative to HEAD (the standalone session left nothing to adopt)")
  for (const rel of await unitChangedFiles(dir, baseline)) {
    if (!rel.toLowerCase().endsWith(".md") || eofScanExempt(rel, [...(opts.scanExempt ?? [])])) continue
    const content = await Bun.file(join(dir, rel)).text().catch(() => "")
    problems.push(...docShapeProblems(content, rel))
  }
  const refs = processReferenceScan(await unitAddedLines(dir, baseline), [...(opts.scanExempt ?? [])])
  for (const warning of refs.warnings) log(`  ⚠ ${warning}`)
  problems.push(...refs.problems)
  const report = await Bun.file(join(dir, taskDoc(task.id, "report"))).text().catch(() => "")
  const result = parseResult(report)
  if (result?.type === "fail") problems.push(`the task report concluded Result: FAIL${result.reason ? ` (${result.reason})` : ""}`)
  if (problems.length) {
    return {
      ok: false,
      code: 1,
      lines: [
        ...testLines,
        `⏸ ${task.id} adopt blocked: ${problems.join("; ")}`,
        `the session's work stays in the worktree, nothing was closed out; continue the standalone session or fix the problems, then re-run: ${bin} plan ${dir} --adopt ${task.id}`,
      ],
    }
  }
  // 3. The ticks and the rename (the driver's own writes; the commit lands
  // them together with the session's work).
  await markDone(plan, task.id)
  // 4. The unified commit with the Auto-Stage trailer.
  const settled = await commitTree(dir, task, { stage: "done", subject: `${task.id} done ${task.title}` })
  if (!settled.ok) {
    return {
      ok: false,
      code: 2,
      lines: [
        `⏸ ${task.id} adopted but the unified commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The task mark is still in the worktree; commit manually and re-adopt`,
      ],
    }
  }
  // 5. The close-out check (the SHA-baseline audit over the adopt-time
  // baseline: a commit without the trailer inside the range is a human
  // commit — the isolation break adopt exists to prevent).
  const violations = await unitViolations(dir, baseline)
  if (violations.length) {
    return {
      ok: false,
      code: 2,
      lines: [
        `⏸ ${task.id} unit close-out check failed (the task counts as done, but the isolation boundary has been violated; investigate manually):`,
        ...violations.map((problem) => `  ${problem}`),
      ],
    }
  }
  return {
    ok: true,
    code: 0,
    lines: [
      ...testLines,
      `✓ ${task.id} adopted: the externally-driven unit closed out (docs/${task.id}/todo.md → done.md, ${plan.index} ticked, unified commit landed)`,
      `next: continue with ${bin} run ${dir}, or export another work order with ${bin} plan ${dir} --export <task id>`,
    ],
  }
}
