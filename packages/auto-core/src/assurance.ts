// The assurance family's single home (plans/0244): what a round owes in
// verification, measured and closed mechanically. The enactment is staged,
// and this module grows with it — D1 (enacted) lands the round delta, the
// driver-measured commit range / grouped stat / changed-path list rendered
// into every planning input; D2/D4 (enacted) land the assurance table
// (docs/assurance.md, target-declared data), the due set (Δ ∩ watched
// surface, plus the cadence rows) and the cover-set check (fresh receipts,
// adjudication receipts, cited baselines with disjointness); S3 rendered
// the composition as the close listing's non-blocking observation, and S4
// (enacted) completes it — the receipts carry their provenance witness
// (0171 D2's janitor-commit rule), the adjudications read from the audit
// artifact family's documents, and `readCoverSet` is the one composition
// both halves consume (the observation renders it; round-close.ts's gate
// blocks on it; close-audit.ts constructs D5's unit from it).
// Direction: a kernel leaf (the run's records family, beside
// script/regression) over git's primitives and the document/phases path
// vocabulary; the planning loops and the close arms consume it, and it
// never imports a loop or session-driving module.
import { ASSURANCE_DOC, roundDir } from "./docpaths"
import { parseResult } from "./document/roles"
import { git, receiptDriverCommitted, repoRoots } from "./git"
import { laneTouches, parseLaneReceipt } from "./intent/test-lanes"
import { phaseIndexPath } from "./phases"
import { join } from "node:path"
import { relative } from "node:path"

// The round's measured delta (plans/0244 D1): pure P7 grammar over git —
// the driver measures, never judges. One entry per deliverable tree (the
// target repository plus every nested repository, isolation repos
// included): the commit range since the round opened, and the changed
// paths with their status letters and add/remove counts.
export type DeltaFile = {
  // Target-directory-relative path (nested repositories' paths carry their
  // prefix), forward slashes.
  path: string
  // The git status letter of the change (A/M/D/R…).
  status: string
  // Add/remove line counts of the change (-1 = binary or unmeasurable).
  added: number
  removed: number
}

export type DeltaRoot = {
  // Repository-root label: "the target repository" for the target itself,
  // else the nested repository's target-relative prefix.
  label: string
  // Target-relative prefix of this repository ("" for the target itself) —
  // the D4 due set intersects watched surfaces against target-relative
  // paths, so the measurement keeps that one shape everywhere.
  prefix: string
  // The range's two ends (short shas): the anchor is the round's opening
  // commit — the establishment's own G1 commit, the first commit that
  // introduced the round's phase index — and the head is the closing tree.
  anchor: string
  head: string
  // Commits in anchor..head (the anchor excluded: the establishment is the
  // round's frame, not its work).
  commits: number
  // Why the anchor is not the round's own establishment commit, when the
  // fallback fired (the residual's shape, named in the rendering); absent
  // = the anchor is the round's own G1 commit (or a nested repository's
  // time-anchored boundary, which carries its own clause instead).
  anchorNote?: string
  files: DeltaFile[]
}

export type RoundDelta = { round: number; roots: DeltaRoot[] }

// The well-known empty-tree object: the diff base of a repository born
// inside the round (its founding commit is round work, so the range opens
// at the empty tree, not at the founding commit's content-excluded self).
// Exported since plans/0244 D3: the lane receipts' `Tree:` bases share the
// same mapping (a unit-start baseline's empty SHA = a repository with no
// commits when the unit began).
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

// A git command's stdout lines, blank lines dropped; undefined when the
// command fails (every measurement is best-effort: an unreadable
// repository contributes nothing, never a stop — the delta is prompt-side
// measurement, and P12's uncertain readings resolve toward rendering the
// rest honestly).
async function lines(root: string, args: string[]): Promise<string[] | undefined> {
  const got = await git(root, args).catch(() => undefined)
  if (got?.code !== 0) return undefined
  return got.out.split("\n").filter((line) => line.trim() !== "")
}

async function shortHead(root: string): Promise<string | undefined> {
  return (await lines(root, ["rev-parse", "--short", "HEAD"]))?.[0]
}

// The mechanical file classification of the grouped stat (D1): docs = the
// process/declaration surfaces (docs/, .opencode/), test = the path-shape
// test vocabulary (a test/tests/__tests__ segment, or a basename the test
// grammars name — test_*/test.*/*_test.*/*.test.*/spec kin), code =
// everything else. Path shape only — no content is read (P7).
export type DeltaGroup = "code" | "test" | "docs"

export function deltaGroup(path: string): DeltaGroup {
  if (path === "docs" || path.startsWith("docs/") || path === ".opencode" || path.startsWith(".opencode/")) return "docs"
  const segments = path.split("/")
  const base = segments.at(-1) ?? ""
  if (segments.some((segment) => segment === "__tests__" || segment === "test" || segment === "tests" || segment === "spec" || segment === "specs")) return "test"
  if (/^(test|spec)[.-]/.test(base) || /\.(test|spec)\.[^.]+$/.test(base) || /_test\.[^.]+$/.test(base)) return "test"
  return "code"
}

// Measure the round's delta (plans/0244 D1). The anchor of the target
// repository is the round's establishment commit — the first commit that
// introduced the round's phase index (the G1 setup is uncommitted until
// the person's round-start review lands it, so that commit IS the round's
// opening stamp, and the derivation is content-based, re-derivable on
// every read — P6, no persisted anchor). The residual fallback: a round
// whose own anchor is not derivable opens at the prior round's close (the
// last commit that touched its phase index), named in the rendering.
// Nested repositories carry no round documents; their boundary is the
// first commit at or after the target anchor's time (a rebased nested
// history can only move commits later, so the boundary over-names, never
// under-names — the honest direction for a measurement).
// undefined = nothing measurable (no git history, or no anchor derivable
// anywhere): the caller renders nothing and the planning inputs keep
// today's bytes exactly (the P10 floor).
export async function measureRoundDelta(dir: string, round: number): Promise<RoundDelta | undefined> {
  // The target repository first: repoRoots returns inner roots first (the
  // unified commit's ordering), while the nested repositories' boundary
  // needs the target anchor's time — so the two passes run in that order.
  const roots = await repoRoots(dir)
  const target = roots.find((root) => {
    const prefix = relative(dir, root).replaceAll("\\", "/").replace(/\/+$/, "")
    return prefix === "" || prefix === "." || prefix.startsWith("..")
  })
  if (target === undefined) return undefined
  const head = await shortHead(target)
  if (head === undefined) return undefined
  let anchor = (await lines(target, ["log", "--reverse", "--diff-filter=A", "--format=%h", "--", phaseIndexPath(round)]))?.[0]
  let anchorNote: string | undefined
  if (anchor === undefined && round > 1) {
    // The fallback (the plan's residual): open at the prior round's
    // close — the last commit that touched its phase index (the close
    // transition ticks/rewrites it, so that commit is the prior round's
    // settling point).
    anchor = (await lines(target, ["log", "-1", "--format=%h", "--", phaseIndexPath(round - 1)]))?.[0]
    if (anchor !== undefined) anchorNote = "the range opens at the prior round's close — this round's own establishment commit is not derivable"
  }
  if (anchor === undefined) return undefined
  const measured: DeltaRoot[] = []
  const entry = await deltaRoot(target, "", anchor, head, anchorNote)
  if (entry) measured.push(entry)
  const stamp = (await lines(target, ["show", "-s", "--format=%ct", `${anchor}^{commit}`]))?.[0]
  const anchorTime = stamp === undefined ? undefined : Number(stamp)
  for (const root of roots) {
    if (root === target) continue
    const prefix = relative(dir, root).replaceAll("\\", "/").replace(/\/+$/, "")
    if (prefix === "" || prefix.startsWith("..")) continue
    // A nested repository: anchored at the round's opening time.
    const nestedHead = await shortHead(root)
    if (nestedHead === undefined || anchorTime === undefined || !Number.isFinite(anchorTime)) continue
    const first = (await lines(root, ["log", "--reverse", `--since=@${Math.floor(anchorTime)}`, "--format=%h"]))?.[0]
    if (first === undefined) continue
    const parent = (await lines(root, ["rev-parse", "--short", `${first}^`]))?.[0]
    const nested = await deltaRoot(root, prefix, parent ?? EMPTY_TREE, nestedHead, undefined)
    // The born-inside-the-round shape opens at the empty tree (the founding
    // commit is round work); the note names that boundary so a reader never
    // mistakes it for a stamp.
    if (nested) {
      measured.push({ ...nested, ...(parent === undefined ? { anchorNote: "the range opens at the empty tree — this repository was born inside the round" } : {}) })
    }
  }
  if (!measured.length) return undefined
  return { round, roots: measured }
}

// One repository's range measurement: the commit count and the changed
// files (status letters from --name-status, add/remove counts from
// --numstat, joined per path; a rename counts at its new path).
async function deltaRoot(root: string, prefix: string, anchor: string, head: string, anchorNote?: string): Promise<DeltaRoot | undefined> {
  const counted = await lines(root, ["rev-list", "--count", `${anchor}..${head}`])
  if (counted === undefined) return undefined
  const commits = Number(counted[0] ?? "0")
  // The empty-tree anchor is not a commit; every commit of a repository
  // born inside the round is the round's work.
  const range = anchor === EMPTY_TREE ? [head] : [`${anchor}..${head}`]
  const status = new Map<string, string>()
  for (const line of (await lines(root, ["diff", "--name-status", "-M", ...range])) ?? []) {
    const [letter, path, , newPath] = line.split("\t")
    if (path === undefined) continue
    status.set(newPath ?? path, (letter ?? "M").charAt(0))
  }
  const counts = new Map<string, [number, number]>()
  for (const line of (await lines(root, ["diff", "--numstat", ...range])) ?? []) {
    const [added, removed, path] = line.split("\t")
    if (path === undefined) continue
    counts.set(path.replaceAll(/^"|"$/g, ""), [added === "-" ? -1 : Number(added) || 0, removed === "-" ? -1 : Number(removed) || 0])
  }
  const files: DeltaFile[] = []
  for (const [path, stat] of status) {
    const [added, removed] = counts.get(path) ?? [-1, -1]
    files.push({ path: prefix ? `${prefix}/${path}` : path, status: stat, added, removed })
  }
  return {
    label: prefix === "" ? "the target repository" : `the nested repository ${prefix}`,
    prefix,
    anchor,
    head,
    commits: Number.isFinite(commits) ? commits : 0,
    ...(anchorNote !== undefined ? { anchorNote } : {}),
    files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  }
}

// The delta block's name lists stay bounded: a wide round names the first
// DELTA_NAME_CAP paths per group and counts the rest.
const DELTA_NAME_CAP = 30

// Measure and render in one step — the planning loops' single entry (the
// formulation todo, the append input and — as the enactment proceeds — the
// due-set computation and the round-brief drafter all consume the same
// measured block, so the composition has one home too).
export async function roundDeltaBlock(dir: string, round: number): Promise<string | undefined> {
  const delta = await measureRoundDelta(dir, round)
  return delta === undefined ? undefined : renderDeltaBlock(delta)
}

const groupStat = (files: readonly DeltaFile[], group: DeltaGroup): { count: number; added: number; removed: number } => {
  const mine = files.filter((file) => deltaGroup(file.path) === group)
  return {
    count: mine.length,
    added: mine.reduce((sum, file) => (file.added < 0 ? sum : sum + file.added), 0),
    removed: mine.reduce((sum, file) => (file.removed < 0 ? sum : sum + file.removed), 0),
  }
}

// Render the delta block (plans/0244 D1): the measured-run-state copy the
// formulation todo and the append input splice verbatim — renderer-owned
// under 0221's named class (dynamic driver feedback lines naming measured
// run state), so the one block serves both surfaces and the copy has one
// home. undefined = a quiet round (nothing measured, or no commit and no
// changed file anywhere): the caller renders nothing and the document
// keeps today's bytes (the P10 floor).
export function renderDeltaBlock(delta: RoundDelta): string | undefined {
  const roots = delta.roots.filter((root) => root.commits > 0 || root.files.length > 0)
  if (!roots.length) return undefined
  const stat = (group: DeltaGroup): string => {
    const totals = roots.reduce(
      (sum, root) => {
        const s = groupStat(root.files, group)
        return { count: sum.count + s.count, added: sum.added + s.added, removed: sum.removed + s.removed }
      },
      { count: 0, added: 0, removed: 0 },
    )
    return totals.count ? `${group} ${totals.count} file(s) (+${totals.added}/−${totals.removed})` : `${group} 0 file(s)`
  }
  const lines: string[] = [
    "## Input: the round's measured delta (driver-measured)",
    "",
    `The driver measured this round's change below from git when this document was composed — what the round has`,
    `already changed since it opened. It is measurement, never judgment: the remaining plan keys its verification`,
    `to this change, not to the standing surface.`,
    "",
  ]
  for (const root of roots) {
    const code = groupStat(root.files, "code")
    const test = groupStat(root.files, "test")
    const docs = groupStat(root.files, "docs")
    lines.push(
      `- ${root.label}: ${root.commits} commit(s) in ${root.anchor}..${root.head} — ` +
        `code ${code.count} file(s) (+${code.added}/−${code.removed}), test ${test.count} file(s) (+${test.added}/−${test.removed}), docs ${docs.count} file(s)`,
    )
    if (root.anchorNote) lines.push(`  (anchor: ${root.anchorNote})`)
  }
  for (const group of ["test", "code"] as const) {
    const names = roots.flatMap((root) => root.files.filter((file) => deltaGroup(file.path) === group).map((file) => file.path))
    if (!names.length) continue
    const shown = names.slice(0, DELTA_NAME_CAP)
    lines.push("")
    lines.push(`Changed ${group === "test" ? "tests" : "code files"} (${names.length}${names.length > DELTA_NAME_CAP ? `, first ${DELTA_NAME_CAP} shown` : ""}):`)
    for (const name of shown) lines.push(`- ${name}`)
  }
  return `${lines.join("\n")}\n`
}

// —— The assurance table (plans/0244 D2) ——
// docs/assurance.md, target-declared committed data, the capability
// catalog's twin applied to assurance itself: one markdown table row per
// standing invariant, the single owner of *what must hold* (P5). The core
// knows the grammar, never any row's meaning (P16); a project with no table
// keeps today's behavior exactly (P10 — the loader answers undefined and
// every consumer renders nothing). The grammar (D8's frozen vocabulary, one
// markdown pipe table in the file; prose around it is free):
//   | id | invariant | kind | watched surface | cadence | close | baseline |
//   |----|-----------|------|-----------------|---------|-------|----------|
//   | S-06 | suite green at close | mechanical | src, test | every-round | blocks | receipts T-287/* |
// — kind: judgment | mechanical; cadence: on-reach | every-round |
// person-forced | periodic (a `periodic` row may carry its schedule as free
// text after the keyword — `periodic: weekly` — read as data, judged by the
// predicate the close arm supplies, never by the core); close: blocks |
// accrue | close-due; baseline: free text carrying a cited commit (the
// carry arm's citation, git-addressable end to end — P18). The watched
// surface is comma-separated tokens in the two vocabularies D2 names: a
// bare token is a repository-relative path/prefix (the `Touches:`
// discipline — matched against Δ by segment prefix, the laneTouches
// convention), a token carrying whitespace is a process-fact phrase for
// independence rows (matched by substring against the round's measured
// facts). A bare single-word fact token reads as a path — the collision
// over-names (a changed path of that name dues the row), the honest
// direction for a surface declared too narrowly (the plan's own residual).

// The frozen vocabularies (D8, P13 — additive-only; retirements go through
// tombstones).
export type AssuranceKind = "judgment" | "mechanical"
export type AssuranceCadence = "on-reach" | "every-round" | "person-forced" | "periodic"
export type AssuranceClose = "blocks" | "accrue" | "close-due"

const KINDS: readonly AssuranceKind[] = ["judgment", "mechanical"]
const CADENCES: readonly AssuranceCadence[] = ["on-reach", "every-round", "person-forced", "periodic"]
const CLOSES: readonly AssuranceClose[] = ["blocks", "accrue", "close-due"]

const TABLE_COLUMNS = ["id", "invariant", "kind", "watched surface", "cadence", "close", "baseline"] as const

export type AssuranceRow = {
  // The stable row id (the table's diff key, the catalog's discipline).
  id: string
  // The invariant's one-line name (free text, rendering only).
  invariant: string
  kind: AssuranceKind
  // The watched-surface cell verbatim (rendering only).
  surface: string
  // The path/prefix tokens (target-relative; a token of Δ under one of
  // these dues an on-reach row).
  paths: string[]
  // The process-fact phrases (matched by substring against the round's
  // measured facts — the minimal mechanical rule, P7).
  facts: string[]
  cadence: AssuranceCadence
  // A periodic row's schedule text, carried as data (the predicate input
  // judges it; the core never does — P6, no persisted schedule state).
  schedule?: string
  close: AssuranceClose
  // The cited baseline (free text; "" = no carry basis — the row can never
  // ride the carried arm).
  baseline: string
}

// One pipe-table line's cells: split on |, the outer empties dropped, every
// cell trimmed. A line carrying no pipe yields no cells.
const tableCells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim())

// The cadence cell: the frozen keyword, optionally `: <schedule text>` on a
// periodic row (the schedule carried as data).
const CADENCE_CELL = /^([a-z-]+)(?::\s*(\S.*))?$/

// Parse the table (strict, the declared-surface discipline: a malformed row
// throws naming the row and the problem — P12/P13; the renderers turn the
// throw into the named observation, never a crash). Prose and headings ride
// free around the table; every pipe-carrying line is table.
export function parseAssuranceTable(text: string): AssuranceRow[] {
  const rows: AssuranceRow[] = []
  const ids = new Set<string>()
  const linesWithCells = text
    .split("\n")
    .map((line) => ({ raw: line, cells: tableCells(line.trim()) }))
    .filter((line) => line.raw.trim().startsWith("|"))
  // A file with no table at all is the floor's twin (no rows), not an error.
  if (!linesWithCells.length) return rows
  const head = linesWithCells[0]!
  if (head.cells.length !== TABLE_COLUMNS.length || head.cells.some((cell, i) => cell.toLowerCase() !== TABLE_COLUMNS[i])) {
    throw new Error(`${ASSURANCE_DOC}: the table's header must be exactly "| ${TABLE_COLUMNS.join(" | ")} |" (the frozen grammar, plans/0244 D8)`)
  }
  const separator = linesWithCells[1]
  if (separator === undefined || !separator.cells.length || separator.cells.some((cell) => !/^:?-{3,}:?$/.test(cell))) {
    throw new Error(`${ASSURANCE_DOC}: the table's second line must be the markdown separator row (| --- | --- | …)`)
  }
  for (const line of linesWithCells.slice(2)) {
    const where = `row "${line.cells[0] ?? "(no id)"}"`
    if (line.cells.length !== TABLE_COLUMNS.length) {
      throw new Error(`${ASSURANCE_DOC}: ${where} carries ${line.cells.length} cell(s), exactly ${TABLE_COLUMNS.length} required (| ${TABLE_COLUMNS.join(" | ")} |)`)
    }
    const [id, invariant, kindCell, surfaceCell, cadenceCell, closeCell, baseline] = line.cells as [string, string, string, string, string, string, string]
    if (!id) throw new Error(`${ASSURANCE_DOC}: a row is missing its id`)
    if (ids.has(id)) throw new Error(`${ASSURANCE_DOC}: the table declares row "${id}" twice`)
    ids.add(id)
    if (!invariant) throw new Error(`${ASSURANCE_DOC}: row "${id}" is missing its invariant`)
    if (!KINDS.includes(kindCell as AssuranceKind)) {
      throw new Error(`${ASSURANCE_DOC}: row "${id}": kind must be judgment or mechanical, got: ${kindCell || "(empty)"}`)
    }
    if (!CLOSES.includes(closeCell as AssuranceClose)) {
      throw new Error(`${ASSURANCE_DOC}: row "${id}": close must be blocks, accrue or close-due, got: ${closeCell || "(empty)"}`)
    }
    const cadence = CADENCE_CELL.exec(cadenceCell)
    if (cadence === null || !CADENCES.includes(cadence[1] as AssuranceCadence)) {
      throw new Error(`${ASSURANCE_DOC}: row "${id}": cadence must be on-reach, every-round, person-forced or periodic, got: ${cadenceCell || "(empty)"}`)
    }
    if (cadence[2] !== undefined && cadence[1] !== "periodic") {
      throw new Error(`${ASSURANCE_DOC}: row "${id}": only a periodic row carries schedule text after its cadence, got: ${cadenceCell}`)
    }
    if (!surfaceCell) throw new Error(`${ASSURANCE_DOC}: row "${id}" is missing its watched surface`)
    const tokens = surfaceCell.split(",").map((token) => token.trim())
    if (tokens.some((token) => !token)) throw new Error(`${ASSURANCE_DOC}: row "${id}": the watched surface must name at least one token, got: ${surfaceCell}`)
    const paths: string[] = []
    const facts: string[] = []
    for (const token of tokens) {
      if (/\s/.test(token)) {
        facts.push(token)
        continue
      }
      if (token.startsWith("/") || token.split(/[\\/]+/).includes("..")) {
        throw new Error(`${ASSURANCE_DOC}: row "${id}": a watched-surface path token must be target-relative (no absolute paths, no ..), got: ${token}`)
      }
      paths.push(token)
    }
    rows.push({
      id,
      invariant,
      kind: kindCell as AssuranceKind,
      surface: surfaceCell,
      paths,
      facts,
      cadence: cadence[1] as AssuranceCadence,
      ...(cadence[2] !== undefined ? { schedule: cadence[2] } : {}),
      close: closeCell as AssuranceClose,
      baseline: baseline ?? "",
    })
  }
  return rows
}

// Read the target's table; undefined when the document is absent (or holds
// no table) — the P10 floor, never an error. A malformed table propagates
// the named problem to the caller (the observation renders it; S4's gate
// decides its blocking form).
export async function readAssuranceTable(dir: string): Promise<AssuranceRow[] | undefined> {
  const text = await Bun.file(join(dir, ASSURANCE_DOC)).text().catch(() => undefined)
  if (text === undefined) return undefined
  const rows = parseAssuranceTable(text)
  return rows.length ? rows : undefined
}

// —— The due set (plans/0244 D4, the first computation) ——
// Δ ∩ watched-surface ≠ ∅ per row (Δ = the D1 round delta's changed paths,
// target-relative, all roots), plus the cadence rows: every-round always;
// person-forced when the person's force mark stands (the forced-row set the
// close arm supplies — a positive declaration, absence a definite negative);
// periodic when its schedule condition stands (the boolean predicate input;
// absent = unreadable, and P12's uncertain reading resolves toward dirty —
// the row dues). Pure P7: path sets and name matches, never content.

export type DueInput = {
  // The measured round delta; absent = a quiet/unmeasurable round (only the
  // cadence rows can be due).
  delta?: RoundDelta
  // The round's measured process facts (the independence rows' vocabulary;
  // the producers land with the later stages — a fact phrase dues a row by
  // case-insensitive substring).
  facts?: readonly string[]
  // The forced-row ids whose person-forced mark stands.
  forced?: readonly string[]
  // The periodic schedule predicate (the schedule text rides the row).
  periodic?: (row: AssuranceRow) => boolean
}

export type DueRow = { row: AssuranceRow; why: AssuranceCadence; touched: string[] }

// Whether a row's watched surface is reached by this input's measurement:
// a Δ path under a watched path token, or a measured fact carrying a
// watched fact phrase.
function surfaceReached(row: AssuranceRow, deltaPaths: readonly string[], facts: readonly string[]): boolean {
  if (laneTouches(row.paths, deltaPaths)) return true
  return row.facts.some((phrase) => facts.some((fact) => fact.toLowerCase().includes(phrase.toLowerCase())))
}

export function dueSet(table: readonly AssuranceRow[], input: DueInput = {}): DueRow[] {
  const deltaPaths = (input.delta?.roots ?? []).flatMap((root) => root.files.map((file) => file.path))
  const facts = input.facts ?? []
  const due: DueRow[] = []
  for (const row of table) {
    const touched = deltaPaths.filter((path) => laneTouches(row.paths, [path]))
    const reached = surfaceReached(row, deltaPaths, facts)
    const stands =
      row.cadence === "on-reach"
        ? reached
        : row.cadence === "every-round"
          ? true
          : row.cadence === "person-forced"
            ? (input.forced ?? []).includes(row.id)
            : (input.periodic?.(row) ?? true)
    if (stands) due.push({ row, why: row.cadence, touched })
  }
  return due
}

// —— The cover-set check (plans/0244 D4, the second computation) ——
// For every due row, the cover, kind-keyed (the plan's letter): a fresh
// receipt at the closing tree (mechanical rows), an adjudication receipt
// (judgment rows — a findings document per the audit artifact grammar that
// names the row id and concludes `Result:`; the readers live below, fed by
// readCoverSet), or a valid cited baseline with a recorded disjointness
// argument (either kind — the citation plus Δ ∩ watched = ∅, mechanical and
// re-derivable). Pure over inputs; P7 throughout — tree shas, path sets,
// row ids; content is never judged.

// One lane receipt's validity claim, the fields D3 added: the per-root
// base..head range and the decided paths (the parse is test-lanes' own
// parseLaneReceipt; this is the cover-side view of its result).
export type CoverReceipt = {
  // The receipt document's target-relative path (rendering; committed
  // evidence — P18).
  path: string
  lane: string
  verdict: "green" | "red"
  tree: { root: string; base: string; head: string }[]
  decides: string[]
  // The composition's tree-walked freshness judgment (S4): the receipt's
  // recorded head is an ancestor of the closing head and nothing the
  // receipt decides changed between them (D3's intersection rule — a
  // verdict is invalidated exactly by the surfaces it intersects). Absent =
  // no walk judged it (the pure callers' shape) and freshness falls back to
  // the exact-head match below.
  fresh?: boolean
}

// One adjudication receipt (judgment rows' cover): the document, the row
// ids it adjudicates, and its `Result:` verdict. Only a PASS adjudicates.
export type AdjudicationReceipt = {
  doc: string
  rows: string[]
  result: "PASS" | "FAIL"
}

export type CoverState = "fresh" | "adjudicated" | "carried" | "uncovered"

export type CoverRow = {
  due: DueRow
  state: CoverState
  // The covering evidence's own name (the receipt, the findings document,
  // the cited baseline) — present on the three covered states.
  cover?: string
}

export type CoverInput = {
  // The closing measurement (the same delta the due set read); absent = no
  // freshness is judgeable (P12: no-reuse — no receipt is fresh).
  delta?: RoundDelta
  // The same measured facts the due set read — the carried arm's
  // disjointness argument shares the reach vocabulary (Δ ∩ watched = ∅ in
  // both vocabularies).
  facts?: readonly string[]
  receipts?: readonly CoverReceipt[]
  adjudications?: readonly AdjudicationReceipt[]
}

// Two recorded tree spellings name the same commit (both sides record
// `rev-parse --short`; the abbreviation length may grow between records —
// a hex prefix match is the same mechanical fact).
const sameTree = (a: string, b: string): boolean => a === b || (a.length <= b.length ? b.startsWith(a) : a.startsWith(b))

// Whether a decided path set carries a verdict for one watched path: some
// decide token is a segment prefix of the watched path (the one-directional
// containment — a receipt deciding src/ decides src/a.ts; the reverse, a
// receipt deciding one file, never covers a watched directory).
const segments = (path: string): string[] => path.split(/[\\/]+/).filter((part) => part !== "" && part !== ".")

const decidesPath = (decides: readonly string[], watched: string): boolean => {
  const w = segments(watched)
  return decides.some((decide) => {
    const d = segments(decide)
    return d.length <= w.length && d.every((part, i) => part === w[i])
  })
}

// Whether a green receipt stands at the closing tree: its `Tree:` names
// every measured root (the receipts record every repository root, the
// writer's scriptGuardSnapshot basis) and each root's head is the delta's
// closing head — the fallback rule over pure inputs (no tree walk judged
// it, and only an exact match is judgeable without one — P12 toward
// no-reuse). The composition's walked judgment (`fresh`, D3's intersection
// rule) replaces it when present: a receipt's own janitor commit always
// lands one commit past its recorded tree, so the exact-head rule is the
// pure floor, never the production arm.
function receiptFreshAt(receipt: CoverReceipt, delta: RoundDelta | undefined): boolean {
  if (receipt.verdict !== "green" || !receipt.tree.length || delta === undefined) return false
  if (receipt.fresh !== undefined) return receipt.fresh
  return delta.roots.every((root) => receipt.tree.some((entry) => entry.root === (root.prefix || ".") && sameTree(entry.head, root.head)))
}

export function coverSet(due: readonly DueRow[], input: CoverInput = {}): CoverRow[] {
  const deltaPaths = (input.delta?.roots ?? []).flatMap((root) => root.files.map((file) => file.path))
  const facts = input.facts ?? []
  return due.map((entry) => {
    const row = entry.row
    if (row.kind === "mechanical") {
      const fresh = input.receipts?.find((receipt) => receiptFreshAt(receipt, input.delta) && row.paths.every((path) => decidesPath(receipt.decides, path)))
      if (fresh) return { due: entry, state: "fresh", cover: `${fresh.lane} (${fresh.path})` }
    } else {
      const adjudicated = input.adjudications?.find((a) => a.result === "PASS" && a.rows.includes(row.id))
      if (adjudicated) return { due: entry, state: "adjudicated", cover: adjudicated.doc }
    }
    // The carried arm, either kind: a cited baseline plus the recorded
    // disjointness argument — Δ ∩ watched = ∅ in both vocabularies (the
    // row's surface is exactly what this round did not touch).
    if (row.baseline.trim() !== "" && !surfaceReached(row, deltaPaths, facts)) {
      return { due: entry, state: "carried", cover: row.baseline }
    }
    return { due: entry, state: "uncovered" }
  })
}

// —— The close-listing observation (plans/0244 D4, S3 landed; S4 holds the
// gate) —— The cover set rendered for the person at close time — due rows
// with their states, accrual rows recorded, uncovered rows named with the
// receipt or adjudication that would cover them (P8: every line teaches its
// remedy). The lines themselves are observations, never enforcement: the
// blocking half lives in round-close.ts's `roundCloseProblems` (S4), whose
// named-rows refusals render at the close gate's stop — beside this
// listing, never inside it. Renderer-owned copy under 0221's named class
// (dynamic driver feedback lines naming measured run state).

export function renderCoverObservation(rows: readonly CoverRow[]): string[] {
  const lines = [`assurance cover set — ${rows.length} row(s) due at this close under ${ASSURANCE_DOC} (observations of the cover set; the blocking refusals render at the close gate's stop):`]
  for (const cover of rows) {
    const row = cover.due.row
    const state = cover.state
    const accrual = row.close === "accrue" ? "accrues, " : ""
    const clause =
      state === "fresh"
        ? `fresh — the green receipt ${cover.cover} stands at the closing tree and decides its watched surface`
        : state === "adjudicated"
          ? `adjudicated — ${cover.cover} carries Result: PASS for it`
          : state === "carried"
            ? `carried — this round's delta misses its watched surface, the cited baseline (${cover.cover}) stands`
            : row.kind === "mechanical"
              ? `uncovered — a green lane receipt at the closing tree deciding ${row.paths.join(", ")} covers it${row.facts.length ? ` (its fact phrases: ${row.facts.join(", ")})` : ""}`
              : `uncovered — an adjudication receipt (an audit findings document naming ${row.id} with Result: PASS) covers it`
    lines.push(`${row.id} (${row.invariant}): ${accrual}${clause}${state === "uncovered" && row.close === "accrue" ? "; the next round that reaches its surface pays it" : ""}`)
  }
  return lines
}

// The receipts the cover set reads (the D3 fields' lookup): every lane
// receipt under the task families and the round's regression directory,
// parsed by the one grammar home; unparsable, headless or field-less
// receipts claim nothing and drop out (P12's no-reuse direction). Stale
// receipts from earlier rounds stay in the walk — freshness is judged per
// tree, never by age. Since S4 each surviving receipt passes the provenance
// witness (plans/0171 D2, receiptDriverCommitted — git.ts's home): a
// receipt is cover basis only when a receipt janitor commit (the
// `Auto-Stage: testhands`/`regression` trailer family) introduced its
// current bytes and the tree holds no uncommitted change to it — a session
// forged or person-committed receipt does not cover (P12 toward no-reuse).
async function gatherCoverReceipts(dir: string, round: number, delta: RoundDelta | undefined): Promise<CoverReceipt[]> {
  const files: string[] = []
  for (const pattern of [join("docs", "*", "testhands", "*.md"), join(roundDir(round), "regression", "*.md")]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: dir, onlyFiles: true })) files.push(file)
  }
  const receipts: CoverReceipt[] = []
  for (const file of files) {
    const parsed = parseLaneReceipt(await Bun.file(join(dir, file)).text().catch(() => ""))
    if (!parsed || !parsed.tree?.length || !parsed.decides?.length) continue
    if (!(await receiptDriverCommitted(dir, file))) continue
    receipts.push({ path: file, lane: parsed.lane, verdict: parsed.verdict, tree: parsed.tree, decides: parsed.decides })
  }
  if (delta !== undefined) for (const receipt of receipts) receipt.fresh = await receiptStandsAtClosingTree(dir, receipt, delta)
  return receipts
}

// The receipt document families' own paths — the evidence's landing is not
// a tree motion that invalidates a verdict (a janitor commit that adds
// receipts changes what the round owes nothing about).
const RECEIPT_DOC_PATH = /^(docs\/[^/]+\/testhands\/|docs\/R-\d+\/regression\/)/

// The walked freshness judgment (plans/0244 D3's intersection rule, S4's
// arm): the receipt's recorded per-root head must be an ancestor of (or
// equal to) the closing head — the receipt ran at a tree the close
// descends from — and nothing the receipt DECIDES changed between the two
// (git's own changed-path list, minus the receipt documents themselves). A
// receipt whose recorded head is not an ancestor (a foreign or rebased
// history), a root mismatch, or an unreadable walk is not fresh (P12:
// uncertain readings resolve toward no-reuse). Pure git grammar — path
// sets and shas, never content (P7).
async function receiptStandsAtClosingTree(dir: string, receipt: CoverReceipt, delta: RoundDelta): Promise<boolean> {
  if (receipt.verdict !== "green") return false
  // The Tree: line names every measured root (the writer's snapshot basis);
  // a root the delta measures that the receipt never saw is unseen surface.
  const roots = new Map((await repoRoots(dir)).map((root) => [relative(dir, root).replaceAll("\\", "/").replace(/\/+$/, "") || ".", root]))
  for (const root of delta.roots) {
    const entry = receipt.tree.find((item) => item.root === (root.prefix || "."))
    if (entry === undefined) return false
    if (sameTree(entry.head, root.head)) continue
    const abs = roots.get(root.prefix || ".")
    if (abs === undefined) return false
    const ancestor = await git(abs, ["merge-base", "--is-ancestor", entry.head, root.head]).catch(() => undefined)
    if (ancestor?.code !== 0) return false
    const changed = await lines(abs, ["diff", "--name-only", `${entry.head}..${root.head}`])
    if (changed === undefined) return false
    const moved = changed.filter((path) => !RECEIPT_DOC_PATH.test(path.replaceAll("\\", "/")))
    if (laneTouches(receipt.decides, moved)) return false
  }
  return true
}

// The documents that adjudicate (plans/0244 D4/D5, S4's real reading): a
// findings document of the audit artifact family — a task's
// docs/T-NNN/findings.md (the audit type's Task-artifacts grammar; the
// close-audit unit's own receipt once it exists) or the round's phase-level
// audit.md / verdict.md (the consolidation, the file names the audit
// artifact grammar fixes) — that NAMES the row id and concludes a `Result:`
// verdict (parseResult — 0083's vocabulary, the one home). Only a PASS
// adjudicates; the row-naming linkage itself is data the S5 bundle copy
// carries (the audit duties will teach their sessions to name the row ids),
// so until then the honest reading is mechanical: a document that names the
// id and carries the verdict adjudicates, one that does not names nothing
// (P7 — the driver checks grammars, never content).
export async function gatherAdjudications(dir: string, round: number, rows: readonly AssuranceRow[], exclude?: string): Promise<AdjudicationReceipt[]> {
  const files: string[] = []
  for (const pattern of [join("docs", "*", "findings.md"), join(roundDir(round), "P*", "audit.md"), join(roundDir(round), "P*", "verdict.md")]) {
    for await (const file of new Bun.Glob(pattern).scan({ cwd: dir, onlyFiles: true })) files.push(file)
  }
  const receipts: AdjudicationReceipt[] = []
  for (const file of files) {
    // 0278: one document of the gather excluded on request — the audit
    // settlement's naming check reads the round's cover with the unit's own
    // findings document left out, so the claim-time due set stands at
    // settlement (the freshly written adjudication cannot cover its own
    // owed rows out from under the collect).
    if (exclude !== undefined && file === exclude) continue
    const text = await Bun.file(join(dir, file)).text().catch(() => "")
    const result = parseResult(text)
    if (result === undefined) continue
    const named = rows.filter((row) => namesRowId(text, row.id)).map((row) => row.id)
    if (!named.length) continue
    receipts.push({ doc: file, rows: named, result: result.type === "pass" ? "PASS" : "FAIL" })
  }
  return receipts
}

// The row-naming linkage, one home (0278): the word-boundary rule the
// adjudication gather reads — a document names a row when the row's id
// appears delimited (never as a substring of a longer token). Exported for
// the audit settlement's collect, which judges the same grammar over the
// unit's own findings document.
export function namesRowId(text: string, id: string): boolean {
  return new RegExp(`(^|[^A-Za-z0-9-])${id}([^A-Za-z0-9-]|$)`).test(text)
}

// The one composition both halves of the cover set consume (S4): load the
// table, measure the round's delta, compute the due set, gather the
// witnessed receipts and the adjudication receipts, and cover every due
// row. undefined = no table or no due rows (the P10 floor — every consumer
// renders nothing and blocks nothing); a malformed table propagates the
// named problem to the caller (the observation renders it, the gate blocks
// on it — P12: an unjudgeable due set is never silently empty).
export type CoverSetReading = { delta: RoundDelta | undefined; due: DueRow[]; rows: CoverRow[]; adjudications: AdjudicationReceipt[] }

export async function readCoverSet(dir: string, round: number, opts: { excluding?: string } = {}): Promise<CoverSetReading | undefined> {
  const table = await readAssuranceTable(dir)
  if (table === undefined) return undefined
  const delta = await measureRoundDelta(dir, round)
  const due = dueSet(table, { delta })
  if (!due.length) return undefined
  const receipts = await gatherCoverReceipts(dir, round, delta)
  const adjudications = await gatherAdjudications(dir, round, table, opts.excluding)
  return { delta, due, rows: coverSet(due, { delta, receipts, adjudications }), adjudications }
}

// The rows the gate blocks on (plans/0244 D4's blocking half): uncovered
// rows whose close behavior is `blocks` or `close-due` — `accrue` rows
// never block (the observation records their accrual; the next round that
// reaches their surface pays them).
export function blockingCoverRows(rows: readonly CoverRow[]): CoverRow[] {
  return rows.filter((cover) => cover.state === "uncovered" && (cover.due.row.close === "blocks" || cover.due.row.close === "close-due"))
}

// The rows D5's close-audit unit judges: uncovered `close-due` rows — the
// judgment rows the round owes an adjudication at its close.
export function closeDueUncovered(rows: readonly CoverRow[]): CoverRow[] {
  return rows.filter((cover) => cover.state === "uncovered" && cover.due.row.close === "close-due")
}

// Measure, gather and render in one step — the close listing's single
// entry (the person-proxy brief's round-close rows render it; the gate in
// round-close.ts reads the same composition through readCoverSet).
// undefined = nothing renders (no table, or a table with no due rows) —
// the P10 floor, byte-identical output. A malformed table renders its named
// problem as the observation (fail loud at the person's surface; the gate
// holds the close on the same problem).
export async function coverSetObservation(dir: string, round: number): Promise<string[] | undefined> {
  let reading: CoverSetReading | undefined
  try {
    reading = await readCoverSet(dir, round)
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error)
    return [`⚠ the assurance table does not parse: ${problem} — fix the row it names; the cover-set records render once the table loads`]
  }
  if (reading === undefined) return undefined
  return renderCoverObservation(reading.rows)
}
