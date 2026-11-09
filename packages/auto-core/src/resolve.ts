// The proxy-answer ledger (plans/0020-auto-resolve-design.md): separates
// "decisions that should have been asked of the user but were auto-approved
// or proxy-answered by the driver" (AUTO-RESOLVE) from "engineering
// discretion the AI was always free to take" (AUTO-DECISION), giving the
// former its own marker, its own ledger and its own highlight-message
// channel. The hard criterion is **whose call the point of divergence
// should have been**: the user's (requirement intent and scope trade-offs,
// external contracts, the standard for "what counts as done", fact
// confirmation, touching the task description's boundary) → AUTO-RESOLVE;
// the AI's (implementation means, where no option changes user-visible
// behavior) → AUTO-DECISION.
//
// Two sources: the driver source (question.asked auto-answered, wired at
// runner H1..H3) is authoritative but covers only the cases where the
// session actually asked; the agent source (the `AUTO-RESOLVE:` marker
// lines a session writes in documents/code, scanned at session close H4)
// covers as much as the session chooses to mark. The two are paired through
// sameIssue (the driver entry marked matched), and the messages show only
// the paired, merged result — a driver entry with a pair is replaced by the
// better-informed agent entry; one without is named with a ⚠ as "the
// session did not mark as required".
//
// Persisted in the target directory's `.auto/resolves.json` (inside
// gitignore, driver-exclusive writes, not on the protect list), the same
// family as `.auto/stats.json` but its own file — stats takes a 30s
// heartbeat of high-frequency writes, and stuffing a growing array of
// question text into it would rewrite the full text on every heartbeat.
// The ledger is only the driver's counting and highlight basis; losing it
// does not affect correctness: the persistent audit trail is the two
// things that enter git — the marker lines themselves and the
// "Proxy-answered questions" section of docs/T-NNN/report.md.
//
// Robustness mirrors src/stats.ts: atomic write (.tmp → rename + write
// queue serialization), lenient per-field parsing (bad = missing, no
// throw), every write failure caught and silenced — the audit never
// affects flow or exit codes. Every public API's first parameter is
// `dir: string | undefined`; undefined = no-op. Two concurrent runs in
// one directory are unsupported (the later write overwrites), the same
// accepted boundary as stats.json — and moot since the run lock (0053 D1,
// one driver per directory).
import { mkdir, realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { taskDoc } from "./docpaths"
import { addedLines, type AddedLines } from "./git"

// ===== schema (v:1, compact JSON on disk; plans/0020-auto-resolve-design.md §F) =====

type ResolveSource = "driver" | "agent"

export type ResolveItem = {
  at: number
  task: string // T-NNN; a bypass session's pseudo-task PLAN/AUTO (pseudoTask, runner.ts)
  phase: string // qualified phase id R-NN.P<nn>; "" when unknown
  round: number
  session?: string // carried by the driver source: the session id
  source: ResolveSource
  question: string // driver source = the question verbatim; agent source = the marker's <question> segment
  option?: string // the agent source's parsed <chosen option>
  reason?: string // the agent source's parsed <reason>
  file?: string // agent source: the marker's `path:line`
  malformed?: boolean // agent source: the marker lacks the arrow / the reason segment
  matched?: boolean // driver source: a paired agent marker was found
  clamped?: boolean // agent source: already clamped by the charter check (0082 D12)
  clamp?: string // the clamp's default (the reading that carries under the charter), a wide grant turned into an OPEN question's option
  checked?: boolean // agent source: the charter check has run (0082 D12) — later scans do not re-run it
}

// decisions: per-task AUTO-DECISION counts (no per-line detail persisted —
// the ledger exists to drive the highlight, and AUTO-DECISION does not
// take part in the highlight, so it needs no line-level persistence; its
// persistent trail is the marker lines that enter git themselves). The
// count is still persisted because the highlight block's last line folds
// it in (§H-④), while the scan happens at the runner's session close and
// the display at the loop's task close-out — several sessions and possibly
// a process restart sit in between, which memory cannot cross.
export type ResolveDoc = { v: 1; items: ResolveItem[]; decisions?: Record<string, number> }

// The driver source's within-turn observation (runner watch()'s
// Watch.resolves, wired at T-005): the task/phase/round needed for booking
// are completed by the attempt side after `await watching`, so the event
// itself carries only the question verbatim and the session id.
export type ResolveEvent = { at: number; question: string; session?: string }

// The bucket identity completed at booking time (shared by
// collectAgentResolves and the driver side).
type ResolveCtx = { task: string; phase?: string; round?: number; session?: string }

// The ledger's total cap: over it, the oldest entries are evicted FIFO.
// The cap is never reached in normal operation (a round of 24 tasks × a
// handful per task); it exists only so an anomalous flood cannot bloat the
// file.
const MAX_ITEMS = 512

// The decisions map's key cap: likewise FIFO-evicting the earliest-written
// task (JS objects keep string keys in insertion order). A count key is a
// dozen bytes; the cap again exists only against anomalous growth.
const MAX_DECISION_KEYS = 512

// The per-file scan cap: files over 2 MB are skipped (marker lines only
// ever appear in human-written documents and source).
const MAX_SCAN_BYTES = 2 * 1024 * 1024

// The highlight block's per-entry listing cap; beyond it, only "…and N more".
const MAX_HIGHLIGHT = 8

// The truncation length for one entry's question text in messages (a
// driver-source question may be multi-line long text, compacted to one
// line then truncated).
const MAX_TEXT = 80

const FILE = join(".auto", "resolves.json")

// AUTO-DECISION: the now injection follows stats.ts's module-level
// replaceable clock (the setResolveClock test hook) instead of an optional
// now parameter on every API — the two clock-injection styles stay
// consistent within one package, and tests simply reset in afterEach.
let clock: () => number = Date.now

// Replace this module's clock (tests inject a deterministic now); no
// argument restores Date.now.
export function setResolveClock(fn?: () => number) {
  clock = fn ?? Date.now
}

// ===== marker parsing (§D) =====

// Both marker-line prefixes are valid anywhere: a code comment
// (`// AUTO-RESOLVE: …`) and a markdown list item (`- AUTO-RESOLVE: …`)
// are equally legal, so the scan locates the marker itself and constrains
// nothing about the line head.
const RESOLVE_MARK = /AUTO-RESOLVE[ \t`*]*[:：][ \t]*/
const DECISION_MARK = /AUTO-DECISION[ \t`*]*[:：][ \t]*/
// The separator takes three spellings; the reason segment accepts both
// ASCII and fullwidth parentheses.
const ARROW = /[ \t]*(?:->|→|=>)[ \t]*/
const REASON = /[(（]([^()（）]*)[)）][\s`*]*$/

type ParsedResolve = {
  question: string
  option?: string
  reason?: string
  malformed?: boolean
}

// Single-line parsing (never across lines). No marker, empty body or a
// pure placeholder line returns undefined; **tolerance first**: a missing
// arrow still returns the whole line as the question (malformed, counted
// and booked the same) — under-reporting one proxy answer costs far more
// than format fastidiousness. A missing reason segment likewise sets
// malformed (the §F schema comment's wording: lacks the arrow / the
// reason segment).
export function parseResolveLine(text: string): ParsedResolve | undefined {
  const mark = RESOLVE_MARK.exec(text)
  if (!mark) return undefined
  const body = trimDecor(text.slice(mark.index + mark[0].length))
  if (!body) return undefined
  const arrow = ARROW.exec(body)
  if (!arrow || arrow.index === 0) return placeholder(body) ? undefined : { question: body, malformed: true }
  const question = trimDecor(body.slice(0, arrow.index))
  if (!question || placeholder(question)) return undefined
  const rest = trimDecor(body.slice(arrow.index + arrow[0].length))
  const reason = REASON.exec(rest)
  if (!reason) return { question, option: rest || undefined, reason: undefined, malformed: true }
  const option = trimDecor(rest.slice(0, reason.index))
  return { question, option: option || undefined, reason: trimDecor(reason[1]) || undefined }
}

// Strips whitespace and markdown decoration (inline-code backticks, bold
// asterisks) from both ends of the body, so a marker line written in a
// document as `` `AUTO-RESOLVE: …` `` parses the same as a bare one.
function trimDecor(text: string): string {
  return text.replace(/^[\s`*]+/, "").replace(/[\s`*]+$/, "")
}

// The placeholder segments of syntax-explanation lines (`<question>` and
// kin) are not real proxy answers: this design's own explanation
// document, the wrapup template and this very file all carry format
// samples, and they would otherwise be collected over and over in every
// task that edits those documents.
function placeholder(text: string): boolean {
  return /^<[^<>]*>$/.test(text)
}

// Equal after normalization, or either a substring of the other, counts as
// the same question. Hoisted here from runner.ts (the consolidation
// precedent: log.ts's formatter consolidation): it serves both the
// runner's repeated-question check and the ledger's dedup and
// driver↔agent pairing.
export function sameIssue(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  return x === y || x.includes(y) || y.includes(x)
}

// The one normalization home (whitespace removed, lowercased) — the pairing
// rule's own transform, exported since plans/0198 D2 for the charter clamp's
// exact-equality test (a write locator must prove equality, never substring
// likeness — sameIssue stays the pairing rule, this its arithmetic).
export function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase()
}

// ===== persistence (atomic write + write queue; mirrors stats.ts) =====

// Lenient per-field parsing (mirroring resume.ts parseProgress): bad
// entries skipped, bad fields defaulted, never a throw — a corrupt ledger
// should only restart the counts from now, never stop the run.
function parseDoc(raw: string): ResolveDoc {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== "object" || !parsed) return { v: 1, items: [] }
    const list = Array.isArray(parsed.items) ? parsed.items : []
    const items: ResolveItem[] = []
    for (const entry of list) {
      if (typeof entry !== "object" || !entry) continue
      const item = entry as Record<string, unknown>
      const question = typeof item.question === "string" ? item.question : ""
      if (!question) continue // an entry without question text has no display value; dropped
      items.push({
        at: typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0,
        task: typeof item.task === "string" ? item.task : "",
        phase: typeof item.phase === "string" ? item.phase : "",
        round: typeof item.round === "number" && Number.isFinite(item.round) ? item.round : 0,
        session: typeof item.session === "string" ? item.session : undefined,
        source: item.source === "agent" ? "agent" : "driver",
        question,
        option: typeof item.option === "string" ? item.option : undefined,
        reason: typeof item.reason === "string" ? item.reason : undefined,
        file: typeof item.file === "string" ? item.file : undefined,
        malformed: item.malformed === true ? true : undefined,
        matched: item.matched === true ? true : undefined,
        clamped: item.clamped === true ? true : undefined,
        clamp: typeof item.clamp === "string" ? item.clamp : undefined,
        checked: item.checked === true ? true : undefined,
      })
    }
    return { v: 1, items, decisions: parseDecisions(parsed.decisions) }
  } catch {
    return { v: 1, items: [] }
  }
}

// The count map's lenient parsing: a non-object is dropped wholesale, bad
// values (not finite positive integers) skipped key by key — the counts
// are a coarse signal, and bad data should be discarded rather than fail
// the read-back.
function parseDecisions(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== "object" || !raw || Array.isArray(raw)) return undefined
  const out: Record<string, number> = {}
  for (const [task, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!task || typeof value !== "number" || !Number.isFinite(value) || value <= 0) continue
    out[task] = Math.floor(value)
  }
  return Object.keys(out).length ? out : undefined
}

async function readDoc(dir: string): Promise<ResolveDoc> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  return raw ? parseDoc(raw) : { v: 1, items: [] }
}

// The .tmp → rename aligned with stats.ts/plan.ts; resolves.json is not a
// protect-list file, so no allowWrite/reprotect. Failures propagate up and
// are silenced by update's catch.
async function atomicWrite(dir: string, text: string) {
  const auto = join(dir, ".auto")
  await mkdir(auto, { recursive: true })
  const file = join(auto, "resolves.json")
  const target = await realpath(file).catch(() => file)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  await Bun.write(tmp, text)
  await rename(tmp, target)
}

// The write queue: read-modify-write serialized per directory, concurrent
// calls lose no entries (stats.ts has an in-memory document as its single
// write point; this module keeps no resident document, so what is
// serialized is the whole read-modify-write). Write failures silenced.
const writing = new Map<string, Promise<void>>()

function update(dir: string, mutate: (doc: ResolveDoc) => void): Promise<void> {
  const next = (writing.get(dir) ?? Promise.resolve())
    .then(async () => {
      const doc = await readDoc(dir)
      mutate(doc)
      if (doc.items.length > MAX_ITEMS) doc.items = doc.items.slice(-MAX_ITEMS) // FIFO-evict the oldest
      const tasks = doc.decisions ? Object.keys(doc.decisions) : []
      if (tasks.length > MAX_DECISION_KEYS) {
        doc.decisions = Object.fromEntries(tasks.slice(-MAX_DECISION_KEYS).map((task) => [task, doc.decisions![task]!]))
      }
      await atomicWrite(dir, JSON.stringify(doc))
    })
    .catch(() => {})
  writing.set(dir, next)
  return next
}

// The dedup key: source + task + normalized question (the same question
// booked twice within one task leaves one entry; the same question across
// tasks leaves one each, because they are two independent proxy answers).
function key(item: { source: ResolveSource; task: string; question: string }): string {
  return `${item.source}\u0000${item.task}\u0000${normalize(item.question)}`
}

// Append-booking. An entry with an existing key is not appended again, but
// its information may be completed (option/reason/file/matched updated in
// place from absent to present) — the driver entry's matched is completed
// exactly this way by the agent scan.
export async function recordResolves(dir: string | undefined, items: ResolveItem[]): Promise<void> {
  if (!dir || !items.length) return
  await update(dir, (doc) => {
    const index = new Map(doc.items.map((item) => [key(item), item]))
    for (const item of items) {
      const existing = index.get(key(item))
      if (!existing) {
        doc.items.push(item)
        index.set(key(item), item)
        continue
      }
      existing.option ??= item.option
      existing.reason ??= item.reason
      existing.file ??= item.file
      if (item.matched) existing.matched = true
    }
  })
}

// Accumulates the per-task AUTO-DECISION count. The accumulation's premise
// is that "each scan sees only the lines added by this session" (0199 D1:
// the scan's unit is the session's added lines — the diff against HEAD
// plus whole untracked files; afterSession scans and then commits
// uniformly, so committed content never re-enters later scans); under
// dryrun the commit is skipped and the diff against HEAD accumulates
// across sessions, the same batch of markers is seen repeatedly, and the
// count runs high — the AUTO-RESOLVE side absorbs this through the dedup
// key, the count side keeps no line detail and so cannot absorb it. This
// is an accepted boundary (0020 §K-10's ruling for --commit false,
// restated for dryrun, the one remaining no-commit world): the count is a
// coarse signal for "has the marking threshold lost control", never a
// source of fact.
function addDecisions(doc: ResolveDoc, task: string, count: number) {
  if (!task || count <= 0) return
  doc.decisions = { ...doc.decisions, [task]: (doc.decisions?.[task] ?? 0) + count }
}

// Test seam: accumulate-and-persist with no production caller — tests seed
// the ledger through it directly; production books counts through the
// private addDecisions, merged with the marker booking into one write
// inside collectAgentResolves.
export async function recordDecisions(dir: string | undefined, task: string, count: number): Promise<void> {
  if (!dir || !task || count <= 0) return
  await update(dir, (doc) => {
    addDecisions(doc, task, count)
  })
}

// Reads back one task's accumulated AUTO-DECISION count (the highlight
// block's last-line fold). Missing/corrupt reads as 0.
export async function decisionsOf(dir: string | undefined, task: string): Promise<number> {
  if (!dir || !task) return 0
  await writing.get(dir)?.catch(() => {})
  const doc = await readDoc(dir)
  return doc.decisions?.[task] ?? 0
}

// ===== the session-close scan (H4) =====

// Scans the **added lines** of this session's workspace changes and
// extracts the two marker kinds: AUTO-RESOLVE is booked (and pairs driver
// entries' matched back), AUTO-DECISION only accumulates the per-task
// count with no line-level detail — the ledger exists to drive the
// highlight, AUTO-DECISION takes no part in the highlight and so needs no
// line-level persistence (its persistent trail is the marker lines that
// enter git themselves); the count is the highlight block's last-line
// fold (§H-④).
// The scan's unit is the added line, not the changed file (0199 D1,
// 0165-109): the marker syntax is a line syntax, and what the session
// proxy-answered is the lines it wrote — when a later task edits a file
// carrying already-committed markers, a whole-file scan re-books the
// earlier task's markers under the later task (the dedup key carries the
// task id and cannot stop the cross-task re-seeing), and the highlight
// would point the user at proxy answers that task never made. Added lines
// come back per repository through git.ts's addedLines (the -U0 diff
// against HEAD; untracked files whole — beginUnit's clean baseline makes
// them this unit's new writes; nested sub-repositories are this project's
// normal shape); a non-git directory returns an empty list and the
// mechanism idles naturally. A repository whose HEAD cannot be parsed or
// whose diff cannot be read falls back to whole-file scanning (0199 D1's
// abnormal-case floor). Binary files and files over 2 MB are skipped.
// Returns the marker entries this scan saw (the pre-dedup count: it
// answers "the scan ran and saw this many markers", not "the ledger grew
// by this many").
export async function collectAgentResolves(
  dir: string | undefined,
  ctx: ResolveCtx,
): Promise<{ resolves: number; decisions: number }> {
  if (!dir) return { resolves: 0, decisions: 0 }
  const files = await addedLines(dir).catch(() => new Map<string, AddedLines>())
  const items: ResolveItem[] = []
  let decisions = 0
  const at = clock()
  for (const [file, added] of files) {
    const text = await readScannable(join(dir, file))
    if (text === undefined) continue
    const lines = text.split("\n")
    // "all" = an untracked file (this unit's new write): every line is one
    // this session added.
    const numbers: readonly number[] = added === "all" ? lines.map((_, i) => i + 1) : added
    for (const lineNo of numbers) {
      const line = lines[lineNo - 1]
      if (line === undefined) continue
      if (DECISION_MARK.test(line)) decisions++
      const parsed = parseResolveLine(line)
      if (!parsed) continue
      items.push({
        at,
        task: ctx.task,
        phase: ctx.phase ?? "",
        round: ctx.round ?? 0,
        source: "agent",
        question: parsed.question,
        option: parsed.option,
        reason: parsed.reason,
        file: `${file}:${lineNo}`,
        malformed: parsed.malformed,
      })
    }
  }
  // The marker booking and the count accumulation merge into one
  // read-modify-write: the two share this scan as their source, and two
  // updates would cost an extra disk read and atomic write.
  if (items.length || decisions) {
    await update(dir, (doc) => {
      if (items.length) mergeAgent(doc, items)
      addDecisions(doc, ctx.task, decisions)
    })
  }
  return { resolves: items.length, decisions }
}

// Books the agent entries and pairs the driver entries back: a driver
// entry of the same task hit through sameIssue is set matched (the
// message side folds it away on that basis, the better-informed agent
// entry standing for the proxy answer).
function mergeAgent(doc: ResolveDoc, items: ResolveItem[]) {
  const index = new Map(doc.items.map((item) => [key(item), item]))
  for (const item of items) {
    const existing = index.get(key(item))
    if (existing) {
      existing.option ??= item.option
      existing.reason ??= item.reason
      existing.file ??= item.file
      if (!item.malformed) existing.malformed = undefined
    } else {
      doc.items.push(item)
      index.set(key(item), item)
    }
    for (const other of doc.items) {
      if (other.source !== "driver" || other.task !== item.task) continue
      if (sameIssue(other.question, item.question)) other.matched = true
    }
  }
}

// Reads one scannable file: directories / missing / over-cap return
// undefined; content with NUL bytes is skipped as binary.
async function readScannable(path: string): Promise<string | undefined> {
  const file = Bun.file(path)
  const size = await file.exists().then((ok) => (ok ? file.size : -1)).catch(() => -1)
  if (size < 0 || size > MAX_SCAN_BYTES) return undefined
  const text = await file.text().catch(() => undefined)
  if (text === undefined || text.includes("\u0000")) return undefined
  return text
}

// ===== read-back (resolvesOf) =====

type ResolveScope = "task" | "phase" | "round"

// Read back filtered by bucket identity (task = T-NNN / phase = qualified id
// R-NN.P<nn> / round = round number). Waits for this directory's write queue to
// drain first so entries just posted are visible. dir === undefined or an empty
// id returns [] — an empty id would match every "phase unknown" entry, the
// window where bucket identity is untrustworthy, so better to return nothing.
export async function resolvesOf(
  dir: string | undefined,
  scope: ResolveScope,
  id: string | number,
): Promise<ResolveItem[]> {
  if (!dir) return []
  const want = String(id)
  if (!want) return []
  await writing.get(dir)?.catch(() => {})
  const doc = await readDoc(dir)
  return doc.items.filter((item) =>
    scope === "task" ? item.task === want : scope === "phase" ? item.phase === want : String(item.round) === want,
  )
}

// ===== the charter clamp (0082 §10 D12's ledger side) =====

// Agent-source entries not yet clamped (carrying the marker's file): the
// clamp check's input. Driver-source and fileless entries do not take
// part — the clamp rewrites the marker line itself, and only agent-source
// marker lines exist on disk.
export async function pendingClampItems(dir: string | undefined): Promise<ResolveItem[]> {
  if (!dir) return []
  await writing.get(dir)?.catch(() => {})
  const doc = await readDoc(dir)
  return doc.items.filter((item) => item.source === "agent" && item.file !== undefined && !item.checked)
}

// Books a clamp result: the same-key entry is completed in place with
// clamped/clamp (the same in-place update the driver entry's matched
// uses); no same-key entry (the ledger was cleared) is skipped — the
// clamp's persistent trail is first the rewritten marker line itself, the
// ledger only the driver's highlight and dedup basis.
export async function recordClamp(dir: string | undefined, item: ResolveItem, clamp?: string): Promise<void> {
  if (!dir) return
  await update(dir, (doc) => {
    const existing = doc.items.find((entry) => key(entry) === key(item))
    if (!existing) return
    existing.checked = true
    if (clamp) {
      existing.clamped = true
      existing.clamp = clamp
    }
  })
}

// ===== the highlight message (§H) =====

type HighlightOpts = {
  scope?: ResolveScope // default task
  id?: string | number // phase label P<nn>-<type> / round number (wording when scope !== "task")
  decisions?: number // this task's AUTO-DECISION count (folded into the last line when present)
}

// Builds the highlight block (a pure function). Empty items return an
// empty array — no proxy answers, no space taken. The driver↔agent merge
// happens before display: paired driver entries are dropped (the agent
// entry is better-informed, carrying the chosen option/reason/marker
// location), unpaired driver entries stay and are named "the session did
// not mark as required".
export function resolveHighlight(items: ResolveItem[], opts?: HighlightOpts): string[] {
  const shown = items.filter((item) => !(item.source === "driver" && item.matched))
  if (!shown.length) return []
  const scope = opts?.scope ?? "task"
  const unmarked = shown.filter((item) => item.source === "driver").length
  if (scope !== "task") {
    const subject = scope === "phase" ? `phase ${opts?.id ?? ""}` : `round ${opts?.id ?? ""}`
    const note = unmarked ? ` (${unmarked} not marked as required)` : ""
    return [`⚑ ${subject}: ${shown.length} questions awaiting confirmation were auto-answered${note}; see task reports for details`]
  }
  const report = taskDoc(shown[0]!.task || "T-NNN", "report")
  const lines = [`⚑ this task auto-answered ${shown.length} questions that should have been confirmed by you; please review:`]
  for (const [i, item] of shown.slice(0, MAX_HIGHLIGHT).entries()) {
    lines.push(`  ${i + 1}. ${entryText(item)}`)
    if (item.file) lines.push(`     ${item.file}`)
  }
  if (shown.length > MAX_HIGHLIGHT) {
    lines.push(`  …and ${shown.length - MAX_HIGHLIGHT} more, all in ${report}`)
  } else {
    lines.push(`  full record in the "Proxy-answered questions" section of ${report}`)
  }
  if (opts?.decisions) lines.push(`  plus ${opts.decisions} AUTO-DECISION entries (folded, see task report)`)
  return lines
}

// One entry's text: `<question> → <chosen option> (<reason>)`, shrinking to
// the parts that exist; an unpaired driver source and a malformed agent
// source each carry their own ⚠ (two different failures: the former never
// marked at all, the latter marked but not in the format).
function entryText(item: ResolveItem): string {
  const question = compactText(item.question)
  if (item.source === "driver") return `${question}  ⚠ session did not write the AUTO-RESOLVE marker as required`
  const option = item.option ? ` → ${compactText(item.option)}` : ""
  const reason = item.reason ? `(${compactText(item.reason)})` : ""
  const warn = item.malformed ? "  ⚠ malformed marker" : ""
  return `${question}${option}${reason}${warn}`
}

// Compacts to one line and truncates: a driver source's question verbatim
// may be multi-line long text, and pasting the whole of it into the
// conclusion line would drown the highlight block; the full text lives in
// the ledger and the task report. Exported for the runner's in-session
// immediate line (H1) to share the one compaction rule — both places
// display the same question text, and the truncation length should not be
// written twice.
export function compactText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT)}…` : line
}
