// The close-audit unit (plans/0244 D5, enacted S4): a round whose close-due
// assurance rows lack adjudication receipts and which carries no audit phase
// to produce them (an open round, a trimmed pipeline) gets the round's LAST
// task unit — one delta-scoped adjudication task in the round's terminal
// phase, judging exactly the close-due rows at the closing tree. Modeled on
// addTask (plans/0058) and the constructFormulation pattern (plans/0095 D1):
// the DRIVER constructs the unit (never a session), it dispatches through the
// ordinary session pipeline (`run` finds it in the phase's task index like
// every task), its prompt copy lives in the registered `close-audit`
// template (P15), and its green adjudication updates the table's cited
// baselines — the table stays the single memory (P5), the update a
// mechanical rewrite of the citation cells (P7). Direction: a planning-side
// driver module like formulate/task-add — writes task documents and commits,
// never imports the loop or the session-driving layer.
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import { closeDueUncovered, readCoverSet, renderDeltaBlock, type CoverRow } from "./assurance"
import { ASSURANCE_DOC, roundDirName, taskDir } from "./docpaths"
import { parseUnitDoc, restoreUnitPending, untickIndexLine } from "./document/unit"
import { beginUnit, commitTree, git } from "./git"
import { dirtyStopLines, unreadableStopLines } from "./log"
import { taskNumberFloor } from "./numbering"
import { phaseHandoverDoc, phaseIndexPath, phaseRef, phaseTitle, readPhases, type PhaseUnit } from "./phases"
import { qualifiedPhase, renderTaskIndex, renderTaskTodo, taskIndexPath, taskStatePaths } from "./tasks"
import { renderTemplate } from "./template"

const roundName = roundDirName

// The close-audit unit's title (plans/0244 D5): the short title every
// task-title-bearing surface renders (0202's rule). The task document's
// `Close-audit:` field — driver-written, the Formulate: precedent's shape —
// carries the round's name (R-NN) whose close-due rows the unit adjudicates;
// it parses like any field-block line, loads onto Task.closeAudit, and is
// refused on a planned task (newTaskProblems' marker guard).
export const closeAuditTitle = (round: number): string => `Adjudicate the due assurance rows (${roundName(round)})`

// Whether the round carries an audit phase to produce the findings (D5's
// shape key): a phase whose type declares a `findings.md` task artifact —
// the audit artifact grammar's own name, the registry's data (P16: the
// cleanroom's audit type declares it; the core never names a type).
export async function roundCarriesAuditPhase(dir: string, round: number): Promise<boolean> {
  const state = await readPhases(dir, round).catch(() => undefined)
  return (state?.phases ?? []).some((unit) => unit.entry.taskArtifacts.some((spec) => spec.path === "findings.md"))
}

// The round's standing close-audit unit, recognized by the marker field
// wherever its row sits (the 0171 D7 orphan shape included — the scan reads
// the documents, never the index, so a dropped row is still a standing unit
// and the constructor never duplicates it). pending = the todo.md variant.
export type StandingCloseAudit = { id: string; pending: boolean }

export async function standingCloseAudit(dir: string, round: number): Promise<StandingCloseAudit | undefined> {
  const name = roundName(round)
  for (const state of ["todo.md", "done.md"] as const) {
    for await (const file of new Bun.Glob(join("docs", "T-*", state)).scan({ cwd: dir, onlyFiles: true })) {
      const id = /^docs\/(T-\d+)\/(todo|done)\.md$/.exec(file)?.[1]
      if (!id) continue
      const fields = parseUnitDoc(await Bun.file(join(dir, file)).text().catch(() => "")).fields
      if (fields["close-audit"] === name) return { id, pending: state === "todo.md" }
    }
  }
  return undefined
}

// The construction's outcome. `none` = nothing keyed (no table, no due rows,
// the rows covered, or the round carries an audit phase); `standing` = a
// unit already stands (idempotence — the constructor never duplicates);
// `dirty`/`unreadable` = the unit-start gate refused; `failed` = a step with
// its own manual recovery; `constructed` = the unit landed on its own commit.
export type EnsureCloseAudit =
  | { type: "none" }
  | { type: "standing"; id: string; pending: boolean }
  | { type: "constructed"; id: string; phase: PhaseUnit; reopened: boolean; lines: string[] }
  | { type: "dirty"; files: string[] }
  | { type: "unreadable"; files: string[] }
  | { type: "failed"; question: string }

// Construct the close-audit unit when the round's shape keys it (plans/0244
// D5, the close arms' write — 0243 D4's amendment: a non-empty close-due set
// without receipts constructs the unit BEFORE the close may land). The key is
// derived, never persisted: uncovered `close-due` rows at the closing tree +
// no audit phase + no standing unit. A ticked terminal phase (a phased
// round's completed close) is re-opened for the unit — its state file
// restored pending and its index line un-ticked — so the ordinary pipeline
// (`run`) can dispatch into it and the phase completes again at its own
// boundary; an open round's never-ticked phase needs nothing.
export async function ensureCloseAudit(dir: string, round: number): Promise<EnsureCloseAudit> {
  let rows: readonly CoverRow[]
  let deltaBlock: string | undefined
  try {
    const reading = await readCoverSet(dir, round)
    if (reading === undefined) return { type: "none" }
    rows = reading.rows
    deltaBlock = reading.delta === undefined ? undefined : renderDeltaBlock(reading.delta)
  } catch {
    // A table that does not parse keys nothing here: the round-close gate
    // blocks on the named problem (P12), and constructing against an
    // unjudgeable due set would be judgment (P7's line).
    return { type: "none" }
  }
  const due = closeDueUncovered(rows)
  if (!due.length) return { type: "none" }
  if (await roundCarriesAuditPhase(dir, round)) return { type: "none" }
  const standing = await standingCloseAudit(dir, round)
  if (standing) return { type: "standing", ...standing }
  const state = await readPhases(dir, round).catch(() => undefined)
  const terminal = state?.phases.at(-1)
  if (terminal === undefined) {
    return { type: "failed", question: `the round ${roundName(round)} has no readable phase index — the close-audit unit needs the round's terminal phase to land in; fix the index the loader names and re-run` }
  }
  const task = { id: "PLAN", title: `close-audit (${roundName(round)})` }
  const gate = await beginUnit(dir, {}, task)
  if (gate.type === "dirty" || gate.type === "unreadable") return { type: gate.type, files: gate.files }
  // The stale handover goes first, in its own commit (the addTask ordering,
  // plans/0053 D25/F13): a distilled terminal phase would otherwise carry a
  // handover that predates the unit while it runs; removal-first keeps every
  // kill point a state a plain re-run completes.
  const handover = phaseHandoverDoc(terminal)
  let handoverRemoved = false
  if (await Bun.file(join(dir, handover)).exists()) {
    await rm(join(dir, handover))
    const settled = await commitTree(dir, task, { stage: "close-audit", subject: `PLAN close-audit ${roundName(round)}: remove the stale handover` })
    if (!settled.ok) {
      return {
        type: "failed",
        question: `stale-handover removal commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Nothing was added; the deletion is kept in the worktree — commit manually and re-run`,
      }
    }
    handoverRemoved = true
  }
  // The number and the unit (the deterministic floor, plans/0150).
  const n = await taskNumberFloor(dir)
  const id = `T-${String(n).padStart(3, "0")}`
  const body = renderCloseAuditBody({ round, taskId: id, rows: due, delta: deltaBlock })
  const paths = taskStatePaths(id)
  await mkdir(join(dir, taskDir(id)), { recursive: true })
  await Bun.write(
    join(dir, paths.pending),
    renderTaskTodo({ id, title: closeAuditTitle(round), phase: qualifiedPhase(terminal), closeAudit: roundName(round), decompose: "whole", depends: "none", ...body }),
  )
  const index = taskIndexPath(terminal)
  const indexFile = join(dir, index)
  const current = await Bun.file(indexFile).text().catch(() => undefined)
  const line = `- [ ] ${id} ${closeAuditTitle(round)}`
  await Bun.write(
    indexFile,
    current === undefined ? renderTaskIndex(qualifiedPhase(terminal), [{ id, title: closeAuditTitle(round) }]) : current.endsWith("\n") ? `${current}${line}\n` : `${current}\n${line}\n`,
  )
  // The re-open (a phased round's ticked terminal phase): the state file
  // back to pending and the index line back to un-ticked, so routing makes
  // the phase current again and `run` dispatches the unit through the
  // ordinary pipeline; the phase completes again at its own boundary. An
  // open round's phase never ticked — both writes no-op.
  const reopened = await restoreUnitPending(dir, phaseRef(terminal))
  if (reopened) await untickIndexLine(join(dir, phaseIndexPath(round)), terminal.id)
  const settled = await commitTree(dir, task, { stage: "close-audit", subject: `PLAN close-audit ${id} (${roundName(round)})` })
  if (!settled.ok) {
    return {
      type: "failed",
      question: `close-audit commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. The unit is written but uncommitted (${paths.pending} and the index line) — commit the left changes by hand; the construction is complete, no re-run needed (a re-run after the commit finds the unit standing)`,
    }
  }
  const lines = [
    `✓ close-audit unit ${id} constructed in ${terminal.dir} — the round's close-due assurance rows (${ASSURANCE_DOC}) are adjudicated by an ordinary task unit at the closing tree`,
    ...(handoverRemoved ? [`the terminal phase's stale handover removed (the phase distills again after the unit runs)`] : []),
    ...(reopened
      ? [`the terminal phase ${phaseTitle(terminal)} re-opened for it (its completion restored pending) — execute the unit with \`run\`; the phase completes again at its own boundary`]
      : [`execute it with \`run\`, then re-run this close`]),
  ]
  return { type: "constructed", id, phase: terminal, reopened, lines }
}

// The unit's task body (P15: the copy is the registered `close-audit`
// template; only the measured-run-state values — the due rows, the delta
// block, the paths — render here, 0221's named exception). The template
// carries the three section headings (its tier-1 markers pin them); the
// split is mechanical, and a template that loses them fails loudly here —
// never a malformed todo.
function renderCloseAuditBody(input: { round: number; taskId: string; rows: readonly CoverRow[]; delta?: string }): { goal: string; scope: string; acceptance: string } {
  const findingsDoc = closeAuditFindingsDoc(input.taskId)
  const dueRows = input.rows
    .map((cover) => {
      const row = cover.due.row
      return `- ${row.id} (${row.invariant}) — watched surface: ${row.surface}; cadence: ${row.cadence}; close: ${row.close}${row.baseline.trim() ? `; cited baseline: ${row.baseline}` : " (no cited baseline — this round's adjudication is its first evidence)"}`
    })
    .join("\n")
  const rendered = renderTemplate("close-audit", {
    round: roundName(input.round),
    assuranceDoc: ASSURANCE_DOC,
    dueRows,
    ...(input.delta !== undefined ? { delta: input.delta } : {}),
    findingsDoc,
  })
  const split = (heading: string): string => {
    const at = rendered.indexOf(`## ${heading}\n`)
    if (at < 0) return ""
    const rest = rendered.slice(at + `## ${heading}\n`.length)
    const next = ["Goal", "Scope", "Acceptance"].map((name) => rest.indexOf(`## ${name}\n`)).filter((index) => index >= 0)[0]
    return (next === undefined ? rest : rest.slice(0, next)).trim()
  }
  const goal = split("Goal")
  const scope = split("Scope")
  const acceptance = split("Acceptance")
  if (!goal || !scope || !acceptance) {
    throw new Error(`the close-audit prompt template did not render its three task sections (## Goal / ## Scope / ## Acceptance — its protocol markers); an override dropped them`)
  }
  return { goal, scope, acceptance }
}

// The green path's baseline citation (plans/0244 D5): every row this close
// covered by an adjudication receipt gets its table cell cited to the
// introducing commit of the findings document that adjudicated it — the
// `R-NN audit @<sha>` shape, a mechanical rewrite of the cited cell (P7: the
// driver writes the citation's grammar, never content; P5: the table stays
// the single memory, the next round's carry reads the citation). Idempotent:
// a cell already carrying the citation writes nothing, and a findings
// document git cannot name is skipped loudly, never cited blind (P12).
export async function updateAssuranceBaselines(dir: string, round: number): Promise<string[]> {
  let reading
  try {
    reading = await readCoverSet(dir, round)
  } catch {
    return []
  }
  const adjudicated = (reading?.rows ?? []).filter((cover) => cover.state === "adjudicated" && cover.cover !== undefined)
  if (!adjudicated.length) return []
  const cellOf = new Map<string, string>()
  const lines: string[] = []
  for (const cover of adjudicated) {
    const doc = cover.cover!
    const read = await git(dir, ["log", "-1", "--format=%h", "--", doc]).catch(() => undefined)
    const sha = read?.code === 0 ? read.out.trim() : ""
    if (!sha) {
      lines.push(`⚠ the adjudication document ${doc} names no introducing commit (uncommitted, or git unreadable) — the ${cover.due.row.id} baseline is left as it stands`)
      continue
    }
    cellOf.set(cover.due.row.id, `${roundName(round)} audit @${sha}`)
  }
  if (!cellOf.size) return lines
  const file = join(dir, ASSURANCE_DOC)
  const text = await Bun.file(file).text().catch(() => undefined)
  if (text === undefined) return lines
  const out: string[] = []
  let changed = false
  for (const raw of text.split("\n")) {
    // The mechanical cell rewrite: the row's own table line, the seventh
    // cell (the baseline) replaced with the citation — nothing else touched.
    const cells = raw.split("|")
    const id = cells[1]?.trim()
    if (cells.length === 9 && raw.trim().startsWith("|") && id !== undefined && cellOf.has(id) && cells[7]!.trim() !== cellOf.get(id)) {
      cells[7] = ` ${cellOf.get(id)} `
      out.push(cells.join("|"))
      changed = true
      lines.push(`✓ assurance baseline of ${id} cited to ${cellOf.get(id)} (${ASSURANCE_DOC})`)
    } else {
      out.push(raw)
    }
  }
  if (!changed) return lines
  await Bun.write(file, out.join("\n"))
  const settled = await commitTree(dir, { id: "PLAN", title: `close-audit (${roundName(round)})` }, { stage: "close-audit", subject: `PLAN close-audit baselines ${roundName(round)}` }, [ASSURANCE_DOC])
  if (!settled.ok) {
    lines.push(
      `⚠ the baseline citation commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")} — the rewrite is kept in the worktree; commit ${ASSURANCE_DOC} manually (a re-run finds the cells cited and writes nothing)`,
    )
  }
  return lines
}

// The findings document's path within the unit directory (the audit
// artifact grammar's own file name — the artifact spec family, not a task
// role; docpaths' R4 list stays roles-only by design, and the artifact spec
// machinery resolves the same relative path).
export const closeAuditFindingsDoc = (id: string): string => join(taskDir(id), "findings.md")

// The due rows an audit settlement judges its findings document against
// (plans/0278, the protocol arm): the round's close-due uncovered set with
// the unit's own findings document excluded from the adjudication gather —
// the claim-time key the constructor keyed the unit on, re-derived at
// settlement (P6: no persisted due set, the cover read fresh; a row
// hand-covered mid-lease simply leaves the set, the collect naming what
// stands). undefined = a table that does not parse or nothing due — the
// naming check stands down, the close gate holding the same problem
// separately, exactly the constructor's own posture above.
export async function auditDueRows(dir: string, round: number, findings: string): Promise<readonly CoverRow[] | undefined> {
  let rows: readonly CoverRow[]
  try {
    rows = (await readCoverSet(dir, round, { excluding: findings }))?.rows ?? []
  } catch {
    return undefined
  }
  const due = closeDueUncovered(rows)
  return due.length ? due : undefined
}

// The ensure result's terminal lines (the close arms' own rendering): the
// construction's lines verbatim, the gate's two strict arms through the
// shared stop-line shapes (the unreadable arm teaching investigation, never
// commit/clean — plans/0236 D4), the failed arm its named question, and the
// quiet arms (nothing keyed, a unit already standing) nothing at all.
export function closeAuditStopLines(audit: EnsureCloseAudit): string[] {
  if (audit.type === "constructed") return audit.lines
  if (audit.type === "dirty") return dirtyStopLines("the round's close-audit unit could not be constructed — the worktree is not clean at the unit-start gate", audit.files)
  if (audit.type === "unreadable") return unreadableStopLines("the round's close-audit unit could not be constructed — the repository state cannot be read", audit.files)
  if (audit.type === "failed") return [`⏸ the round's close-audit unit could not be constructed: ${audit.question}`]
  return []
}
