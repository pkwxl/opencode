// The remediation executor (plans/0082 §5 D7) — the mechanical half that
// runs the person's `Choice:` marks: one `Auto-Stage: remediation` commit per
// edit, old-span literal match on every edit (a stale document re-blocks,
// never a blind overwrite), a mid-sequence commit failure stopping the
// sequence and re-blocking naming the partial state, and the `Executed:`
// line appended after execution. plan.ts's prelude imports this module (its
// row executes the marks before any route decides), so it starts no session
// and imports no session-driving layer — the same constraint plan itself
// lives under. The interactive fast path (plans/0082 §6 D9) executes through
// the same single-document core, so the detached mark and the sideband pick
// produce identical artifacts.
//
// The write ratchet (test/blockage-executor.test.ts holds it, the
// chain-writes pattern): the executor's target writes are exactly the
// enumerated edit spec plus the blockage document's own mark lines, and the
// commit stages exactly `remediation` (plus `plan-input`, the existing
// write path the planning-input channel maps onto — its own commit, D7).
// Driver-exclusive state is never touched: an edit naming it is refused
// before anything is written.
import { join } from "node:path"
import {
  choiceMark,
  executedMark,
  locateEditSpan,
  parseRemediationPlan,
  readBlockageDocs,
  rejectedMark,
  type RemediationEdit,
  type RemediationOption,
} from "./blockage"
import { BRIEF_FILE } from "./brief"
import { roundDirName } from "./docpaths"
import { roleOf } from "./document/roles"
import { beginUnit, commitTree, headSha } from "./git"
import { log } from "./log"
import { savePlanInput } from "./plan-input"
import { allowWrite, reprotect } from "./protect"

// One executed document's result: the option id, the edits that landed
// (paths, in order) and their commits' short SHAs; an advice option records
// the advice it printed and executes nothing.
export type ExecutionOk = { type: "executed"; file: string; option: string; edits: string[]; shas: string[]; advice?: string[] }

// The executor refuses or re-blocks: a dirty tree before the first write, a
// stale old span, a commit failure mid-sequence, or an edit naming a surface
// no remediation may touch. The reason line names the partial state when
// some edits already landed. `stale` marks the one non-fatal class — the
// chosen edit's old span no longer locates (the file changed since the
// document, or the quoted anchors were born wrong): the rejection is
// recorded on the document and the run continues, because the blocked step
// re-runs its gate and re-diagnoses into a fresh, executable document. Every
// other refusal needs the person or a clean tree before anything downstream
// can run, and stops as before.
export type ExecutionStop = { type: "reblocked"; file?: string; landed: string[]; reason: string; stale?: boolean }

export type ExecutionOutcome = ExecutionOk | ExecutionStop | { type: "none" }

// The prelude row's body (plans/0082 §5 D7): find the round's unexecuted
// `Choice:` marks and execute them, oldest document first. Returns "none"
// when nothing is pending — the ordinary run's path.
export async function executeBlockageChoices(dir: string, round: number): Promise<ExecutionOutcome> {
  const docs = await readBlockageDocs(dir, round)
  const pending = docs.filter((doc) => choiceMark(doc.text) !== undefined && executedMark(doc.text) === undefined && !rejectedMark(doc.text))
  if (!pending.length) return { type: "none" }
  // The executor's edits are this row's first write: the tree must be clean
  // first (driver-state leftovers self-heal through beginUnit's gate, like
  // every unit start).
  const gate = await beginUnit(dir, {}, { id: "PLAN", title: `remediation (${roundDirName(round)})` })
  if (gate.type === "dirty") {
    return { type: "reblocked", landed: [], reason: `the worktree is not clean before executing a Choice mark; handle it manually (commit/clean) and re-run: ${gate.files.join(", ")}` }
  }
  let outcome: ExecutionOutcome = { type: "none" }
  for (const doc of pending) {
    const result = await executeBlockageChoice(dir, doc.file, doc.text)
    if (result.type === "reblocked" && result.stale) {
      // The stale continuation (D7): record the rejection on the document
      // (its own mark line, committed like the edits) and keep going — the
      // run reaches the blocked step, its gate fails again, and a fresh
      // diagnosis writes the next document. A Choice never dead-ends.
      const option = choiceMark(doc.text)!.choice
      await Bun.write(join(dir, doc.file), appendRejected(doc.text, option, result.reason))
      const recorded = await commitTree(dir, { id: "PLAN", title: `remediation (${doc.file})` }, { stage: "remediation", subject: `${remediationSubjectPrefix(doc.file)}${option}: record rejection (stale)` })
      if (!recorded.ok) log(`⏸ the rejection record of ${doc.file} is written but not committed (${recorded.failures.map((failure) => failure.rel).join(", ")}) — commit it manually`)
      outcome = result
      continue
    }
    if (result.type === "reblocked") {
      outcome = result
      break
    }
    outcome = result
  }
  return outcome
}

// Execute one document's mark. The document is re-parsed here — the marked
// text is what runs, so a person's edit of an option's lines before choosing
// is honored verbatim (the ratification semantics: the marked text became
// their words). An unparsable document (edited past the format) re-blocks
// naming it, never executes a guess.
export async function executeBlockageChoice(dir: string, file: string, text: string): Promise<ExecutionOk | ExecutionStop> {
  const mark = choiceMark(text)
  if (mark === undefined) return { type: "reblocked", file, landed: [], reason: `${file} carries no Choice line` }
  if (executedMark(text) !== undefined) return { type: "reblocked", file, landed: [], reason: `${file} was already executed` }
  const plan = parseRemediationPlan(text)
  if (plan === undefined) {
    return { type: "reblocked", file, landed: [], reason: `${file} no longer parses as a remediation plan (edited past the format?); fix the document or leave the Choice out, then re-run` }
  }
  if (plan.kind === "escalation") {
    return { type: "reblocked", file, landed: [], reason: `${file} carries an Escalation, not options — nothing to execute; the run stays blocked for the person` }
  }
  const option = plan.options.find((entry) => entry.id === mark.choice)
  if (option === undefined) {
    return { type: "reblocked", file, landed: [], reason: `${file} marks option ${mark.choice}, which the document does not carry; correct the Choice line or the option, then re-run` }
  }
  const landed: string[] = []
  const shas: string[] = []
  const advice: string[] = []
  for (const edit of option.edits) {
    const problem = editableSurfaceProblem(edit.path)
    if (problem) {
      return {
        type: "reblocked",
        file,
        landed,
        reason: `edit ${edit.path} of ${file} names a surface remediation never touches (${problem}); partial state: ${landed.length ? landed.join(", ") : "nothing executed"}`,
      }
    }
    if (option.channel === "planning-input") {
      // The existing write path (D7): savePlanInput persists and commits on
      // its own (stage plan-input); the edit text is the new input verbatim.
      const phase = planInputPhase(edit.path)
      if (phase === undefined) {
        return { type: "reblocked", file, landed, reason: `edit ${edit.path} of ${file} is not a phase's plan-input.md path; the planning-input channel writes exactly that file` }
      }
      const saved = await savePlanInput(dir, phase, { text: edit.text }, `${phase.id} remediated`)
      if (saved.type === "dirty") {
        return { type: "reblocked", file, landed, reason: `worktree not clean before the planning-input write: ${saved.files.join(", ")}; partial state: ${landed.length ? landed.join(", ") : "nothing executed"}` }
      }
      if (saved.type === "failed") {
        return { type: "reblocked", file, landed, reason: `${saved.question}; partial state: ${landed.length ? landed.join(", ") : "nothing executed"}` }
      }
      const sha = await headSha(dir)
      if (sha) shas.push(sha)
      landed.push(edit.path)
      log(`✓ remediation: planning input rewritten through its own commit — ${edit.path}`)
      continue
    }
    if (option.channel === "advice") continue // never reached: advice options carry no edits
    const applied = await applyEdit(dir, file, option, edit)
    if (applied.type === "reblocked") return { ...applied, landed }
    const subject = `${remediationSubjectPrefix(file)}${option.id}: ${edit.path}`
    const committed = await commitTree(dir, { id: "PLAN", title: `remediation (${file})` }, { stage: "remediation", subject })
    if (!committed.ok) {
      return {
        type: "reblocked",
        file,
        landed,
        reason:
          `the remediation commit of ${edit.path} failed: ${committed.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The edit is kept in the worktree; the sequence stops here — partial state: ${landed.length ? landed.join(", ") : "nothing executed"}`,
      }
    }
    const sha = await headSha(dir)
    if (sha) shas.push(sha)
    landed.push(edit.path)
    log(`✓ remediation executed: ${edit.path} (${subject})`)
  }
  if (option.channel === "advice" && option.advice) {
    advice.push(option.advice)
    log(`ℹ remediation advice (${file} option ${option.id}): ${option.advice}`)
  }
  // The execution record (D7): one `Executed:` line appended under the
  // Choice, committed like the edits.
  const updated = appendExecuted(text, option.id, shas)
  await Bun.write(join(dir, file), updated)
  const settled = await commitTree(dir, { id: "PLAN", title: `remediation (${file})` }, { stage: "remediation", subject: `${remediationSubjectPrefix(file)}${option.id}: record execution` })
  if (!settled.ok) {
    return {
      type: "reblocked",
      file,
      landed,
      reason: `the edits of ${file} landed (${landed.join(", ")}) but recording the execution failed to commit: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Commit the document manually and re-run`,
    }
  }
  const sha = await headSha(dir)
  if (sha) shas.push(sha)
  return { type: "executed", file, option: option.id, edits: landed, shas, ...(advice.length ? { advice } : {}) }
}

// One edit's application: the shared span locator (D7's old-span guard) —
// exact lines at the recorded position, a unique exact occurrence elsewhere,
// then the same two tiers whitespace-trimmed; a pair that locates nowhere,
// or trimmed-matches more than once, is a non-fatal stale rejection (recorded
// on the document, the run continues into the gate's fresh diagnosis), never
// a blind overwrite.
async function applyEdit(dir: string, doc: string, option: RemediationOption, edit: RemediationEdit): Promise<{ type: "ok" } | ExecutionStop> {
  const path = join(dir, edit.path)
  const raw = await Bun.file(path).text().catch(() => undefined)
  if (raw === undefined) {
    return { type: "reblocked", stale: true, file: doc, landed: [], reason: `the file changed since diagnosis: ${edit.path} no longer exists (${doc} option ${option.id})` }
  }
  const lines = raw.split("\n")
  const located = locateEditSpan(lines, edit)
  if (!("at" in located)) {
    return {
      type: "reblocked",
      stale: true,
      file: doc,
      landed: [],
      reason: `the file changed since diagnosis: ${edit.path}'s old span no longer matches the quoted lines${"ambiguous" in located ? " (the quoted pair matches more than one place)" : ""} (${doc} option ${option.id}) — the rejection is recorded and the gate re-diagnoses into a fresh document`,
    }
  }
  const width = edit.last - edit.first + 1
  const next = [...lines.slice(0, located.at), ...edit.text.split("\n"), ...lines.slice(located.at + width)]
  const text = next.join("\n")
  // brief-amend writes through the brief's protect-passing channel (D7, the
  // survey install's mechanism); every other channel writes plainly.
  if (edit.path === BRIEF_FILE) await allowWrite(path)
  await Bun.write(path, text)
  if (edit.path === BRIEF_FILE) await reprotect(path)
  return { type: "ok" }
}

// The surfaces an enumerated edit may touch (D7's channel table): the
// process documents (handover-edit, task-doc-note), the planning input's own
// path, the materialized pack, and — through its protect-passing write — the
// brief. Driver-exclusive state (the phase index, .auto/*, the config) and
// the round-level gates' documents are refused before anything is written.
function editableSurfaceProblem(path: string): string | undefined {
  const role = roleOf(path)
  if (path === BRIEF_FILE) return undefined
  if (role === "driverState") return "driver-exclusive state"
  if (role === "ledger") return "the round phase index"
  if (role === "phaseAcceptance") return "an acceptance record (the human's sign alone)"
  if (role === "blockage") return "another blockage document"
  return undefined
}

// A plan-input path → its PlanPhase identity (docs/R-NN/P<nn>-<type>/
// plan-input.md); undefined for anything else.
export function planInputPhase(path: string): { round: string; id: string; dir: string } | undefined {
  const match = /^(docs\/(R-\d+)\/(P\d{2,})-[a-z][a-z0-9-]*)\/plan-input\.md$/.exec(path.replaceAll("\\", "/"))
  if (!match) return undefined
  return { round: match[2]!, id: match[3]!, dir: match[1]! }
}

// The commit subject's stable prefix: `remediate <seq> option <id>` — names
// the blockage seq and the option (D7).
function remediationSubjectPrefix(file: string): string {
  const seq = /blockage-(\d+)\.md$/.exec(file)?.[1] ?? "?"
  return `PLAN remediate ${seq} option `
}

// Append the execution record under the Choice line (D7): `Executed: A
// (<shas>)`. The advice channel records with no SHAs.
export function appendExecuted(text: string, option: string, shas: readonly string[]): string {
  const record = `Executed: ${option} (${shas.length ? shas.join(", ") : "no commits — advice recorded"})`
  return appendMarkLine(text, record)
}

// The stale rejection's record (D7's continuation), same placement: one line
// under the Choice, committed like the edits.
export function appendRejected(text: string, option: string, reason: string): string {
  return appendMarkLine(text, `Rejected: ${option} — ${reason}`)
}

function appendMarkLine(text: string, record: string): string {
  const lines = text.split("\n")
  const at = lines.findLastIndex((line) => /^Choice:/.test(line))
  if (at < 0) return `${text.trimEnd()}\n\n${record}\n`
  lines.splice(at + 1, 0, record)
  return lines.join("\n")
}

// What the executor says it did (the prelude's log lines; pure).
export function executionLines(outcome: ExecutionOutcome): string[] {
  if (outcome.type === "none") return []
  if (outcome.type === "executed") {
    const done = outcome.edits.length ? `executed ${outcome.edits.length} edit(s): ${outcome.edits.join(", ")}` : "recorded (advice — nothing to execute)"
    return [`✓ remediation ${outcome.file} option ${outcome.option} ${done}`]
  }
  return [`⏸ remediation re-blocked: ${outcome.reason}`]
}
