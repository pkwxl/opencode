// The executor share coordinator. The shell supplies the authenticated stable
// token identity and channel. This surface is internal until the routes land.
import { randomUUID } from "node:crypto"
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { auditDueRows } from "./close-audit"
import { loadProjectConfig } from "./config"
import { docShapeProblems } from "./doccheck"
import { taskDoc, taskDocPaths } from "./docpaths"
import { namesRowId } from "./assurance"
import { constraintPitfallResolves, handoffStatus, parkDirective, parseResult, roleOf, validHandover, HANDOVER_SECTIONS } from "./document/roles"
import { parseIndex, tickedIndex } from "./document/unit"
import { parkCheck, STEER_CHAIN_BOUND } from "./execute"
import { composeSynthesizedTodo, readExecutorAdmissionBlock, readExecutorParkPlan, readExecutorPreview, readExecutorFollowUp, planPhaseOf, type ExecutorPreview, type FixPreview, type VerificationPreview } from "./executor-steps"
import {
  ensureExecutorWorkspace, executorWorkspacePath, ExecutorWorktreeError, landExecutorWorkspace,
  prepareExecutorLanding, removeExecutorWorkspace, validExecutorLanding, validExecutorWorkspace,
  type ExecutorLanding, type ExecutorWorkspace,
} from "./executor-worktree"
import { awaitingFormulation, constructFormulation } from "./formulate"
import { ledgerOf, coverageProblems } from "./formulate-synthesis"
import { contentAtBase, EMPTY_TREE, git, identityArgs, message, repoRoots, statusEntriesRead, WORKDIR_ROOTS, withinScopes, workdirEntry, driverStage } from "./git"
import { log } from "./log"
import { docEligible, docScope, scopesDisjoint } from "./lanes"
import { acquireRunLock, liveRunLock } from "./lock"
import { readPhases } from "./phases"
import { taskNumber } from "./numbering"
import { markDone, plannedTaskProblems, readyTasks, runtimeParked, setParked, takenTaskIds, taskStatePaths, type Task } from "./tasks"

export class ExecutorRequestError extends Error {}

// The executor wire's version literal (plans/0279's version ruling, enacted
// by 0280): `0.1`, PREVIEW — adding and removing routes, kinds, scopes and
// stage words stay open while it carries, and the exit criterion is
// sustained field testing, never a freeze claim. The `1` this replaces was
// recorded as premature (the tombstone note in docs/protocol.md, the
// spec's compatibility record); old clients fail loudly at the handshake.
// One home for the literal both packages stamp: the reply envelope's
// `protocol` field (executor-worker's 200 body) and the response-size
// measures below, which simulate that envelope's shape.
export const EXECUTOR_PROTOCOL = 0.1

export type ExecutorHolder = { token: string; channel: string }
type Holder = ExecutorHolder
type Execute = Extract<ExecutorPreview, { kind: "execute" }>
// 0276 (0256 stage 2's first convergence kind): the formulate step — the
// phase's planning session as claimable work. The claim address is the
// formulation unit's own task-shaped id (the durable record — the index
// row, the todo, the done rename, the tick — is task-shaped, and one
// formulation per phase makes the unit↔phase mapping functional both
// ways); the phase's identity rides the grant as data (`phase`, the
// qualified id; `index`, the phase's task-index path — the fence's
// per-kind arm and the settlement's collect read them, never a second
// lookup). The lease shape is serial: the formulation task declares no
// Touches, so no lane tier admits it (0095 D5's own rule — a phase's only
// ready unit, ahead of everything it plans).
type Formulate = Extract<ExecutorPreview, { kind: "formulate" }>
// 0277 (0256 stage 2's second convergence kind, the transfer advance's
// session work): the distill step — the phase-boundary distillation session
// as claimable work. The claim address is the phase's own qualified id (the
// durable record is phase-shaped here — the state files, the phases.md row
// and tick, the handover document itself; phases are units in the
// document/unit machinery, so no second address space is invented — 0276
// declined the phase id for formulation because THAT record was task-shaped,
// the grounds met by their opposite here); the write surface rides the grant
// as data (`handover`, the document path — the fence's per-kind arm and
// the settlement's collect read it, never a second lookup). The lease shape is
// serial: the boundary declares no Touches, no lane tier admits it.
type Distill = Extract<ExecutorPreview, { kind: "distill" }>
// 0278 (0256 stage 2's third and final convergence kind): the audit step —
// the round's standing close-audit unit's session work (the adjudication
// the close arms constructed the unit for) as claimable work beside its
// push twin. The claim address is the standing unit's own task-shaped id
// (the durable record is task-shaped — the constructor's whole design one
// delta-scoped task unit: the index row, the todo, the done rename, the
// findings document; 0276's grounds apply, the round-id declined — R-NN is
// the round's own name, not a unit address); the write surface and the
// round's identity ride the grant as data (`findings`, the document path,
// `round`, the marker field's own number — the fence's per-kind arm and
// the settlement's collect read them, never a second lookup). The lease
// shape is serial: the audit unit declares no Touches, no lane tier admits
// it, and the terminal phase's every other task is done — the standing
// emptiness the gate.
type Audit = Extract<ExecutorPreview, { kind: "audit" }>
// 0281 (0279's construction-determinized letter): the synthesize step — the
// formulation construction's re-voicing session (0097's constructor
// one-shot) as claimable work. The claim address is the construction
// unit's own task-shaped id (0276's grounds); the phase's identity rides
// the grant as data (`phase`, `index` — the same two fields the formulate
// grant carries). The lease shape is serial on the main tree (the
// formulation unit declares no Touches, the awaiting gate already stands
// the tiers down). The holder's write surface is the unit's todo path —
// the REPLY CHANNEL (the fence admits exactly it); the settlement parses,
// validates through the push pipeline's own checks, composes the
// synthesized todo and lands through constructFormulation under the
// phase-synthesize stage — never a session share commit. A landed
// synthesize receipt is terminal (no verify follows: the push one-shot had
// no wrap-up session), the unit continuing as formulate work over the
// synthesized todo.
type Synthesize = Extract<ExecutorPreview, { kind: "synthesize" }>
type Candidate = Execute | Formulate | Synthesize | Distill | Audit | FixPreview | VerificationPreview
type Grant = (Omit<Execute, "touches"> | Formulate | Synthesize | Distill | Audit | Omit<FixPreview, "touches"> | VerificationPreview) & { id: string; lease: string; attempt: number; workspace: string; deadline: number; budget: number; answerCursor?: string | null }
type BlockedReport = { kind: "blocked"; reason: "isolation" | "commitFailed"; detail: string }
// The blocked-cause classification (0272, 0262-03's fix): `escalated` marks
// the settlement causes whose remedy would require a write the holder's
// grant kind cannot make — Git ground truth (history, HEAD, the index), the
// never-set (driver state and driver-exclusive documents), the worktree's
// own machinery — the person's bracket, not a replay. The marker is
// coordinator-internal: settle()'s wrapper strips it and renders the
// ladder-named wire answer, so the frozen response vocabulary and shape are
// unchanged (P13; the ladder named inside `detail`, rendering) and the
// replay arm stays byte-identical (P10).
type SettlementBlocked = BlockedReport & { escalated?: true }
type VerifyVerdict = "pass" | "fail"
// The reconciled receipt (0285's fix ruling, plans/0287): the dead-letter
// booking — a lease that died without a report (expired or released, never
// booked) over a unit the durable record already closed. The receipt asserts
// nothing about the share itself: never landed, never verified, its commit —
// whatever the holder left in history — outside settledChain's known table
// (the walk's own classes judge it, 0248 D6 untouched). What it asserts is
// the ledger's claim ENDED: every receipt-keyed derivation (continuation,
// reservation, settlement wait) reads the entry closed through its existing
// home (P5 — the receipt is the one fact). `by` names the trigger's
// provenance: the automatic sweep reading the unit's completion in the
// record (the person's amendment, 0274), or the person's reconcile
// operation naming the unit.
type ReconciledReceipt = { kind: "reconciled"; by: "person-completion" | "person-reconcile" }
// `closed: "person"` (0289): the additive facet a landed receipt carries when
// the person's completion ended the unit's chain over a booked continuation —
// the share's landing stands in history (unlike the reconciled receipt, which
// asserts no share); the facet releases the reservation, closes the claim
// (no verify share over a person-closed unit, P3's parenthetical), and is the
// sweep's one write (P6 — the minimum the record's reading requires).
type Receipt = { kind: "landed"; commit: string; verdict?: VerifyVerdict; gapCount?: number; continuation?: true; parked?: string; closeCommit?: string; landingCommit?: string; closed?: "person" } | { kind: "without-landing"; reason: "failed" | "zero-write" } | BlockedReport | ReconciledReceipt
type CloseIntent = { share: string; sourceShare?: string; tree?: string }
// A nested repository's booked share evidence (0258): the root's checkout-
// relative path, its HEAD at booking, and its staged tree — the per-root
// witness a multi-root settlement replays against, beside the top
// repository's own booked tree.
type NestedEvidence = { root: string; base: string; tree: string }
type EndedBooking = { parent?: string; outcome: "ended"; note?: string; retireGaps?: true; intent?: { tree: string; verdict?: VerifyVerdict; gapCount?: number; continuation?: true; park?: { blocker: string; previous?: string }; nested?: NestedEvidence[] }; landing?: ExecutorLanding; close?: CloseIntent; receipt?: Receipt }
type Booking =
  | EndedBooking
  | { outcome: "failed"; note?: string; receipt: Receipt }
type Entry = {
  grant: Grant
  holder: Holder
  base: string
  issued: number
  touches?: readonly string[]
  scope?: readonly string[]
  worktree?: ExecutorWorkspace
  predecessor?: string
  released?: true
  booking?: Booking
}
type LeaseWait = { kind: "wait"; reason: "lease-held"; detail: string; deadline: number }
type BudgetBlock = { kind: "blocked"; reason: "attemptsExhausted" | "fixBudget"; detail: string }
// The settled-holder terminal (0273, 0264-05's fix): the additive step kind
// answering a same-token verify claim over an already booked report — the
// share's own producer (or its same-token successor) reading back its
// settled share. Names the booked evidence (`commit`, the settlement's own
// record) and states the ended claim. Distinct from `done` by ruling (P13's
// single meanings: `done` is the round's completion, this the holder's —
// verification by a different token is still pending work); terminal for
// the client, which reconciles against the commit and ends.
type SettledStep = { kind: "settled"; unit: string; commit: string; detail: string }
type DerivedStep = Exclude<ExecutorPreview, Execute | Formulate | Synthesize | Distill | Audit> | BlockedReport | LeaseWait | BudgetBlock | SettledStep
type Decision = DerivedStep | (Candidate & { scope?: readonly string[]; worktree?: true })
type Claim = DerivedStep | Grant
type LeaseKey = { step: string; lease: string }
// The pending person items on the read surface (0271, re-keyed by 0282 onto
// the document-derived gates alone): the ask channel is gone — no question
// rows, no answer or release arms — and the gate rows derive from the
// admission block's own reading of the documents (P6: no store, no replay),
// naming the gate and the document the person attends. The person's acts are
// the document writes and the deterministic operations (the clarify op, the
// transfer op), never a wire channel. 0287 adds the held rows: when the
// claimable set is empty, the derivation's own wait/blocked answer rides the
// menu as a row — an empty `claimable` beside a silent cause was 0285's
// honesty gap (P12: uncertainty never swallowed into a clean-looking
// verdict), the step vocabulary's own shapes reused, never a second meaning.
type MenuPending =
  | { kind: "gate"; gate: "project-start" | "survey-release"; document: string }
  | { kind: "wait"; reason: "lease-held" | "in-flight" | "not-ready"; detail: string }
  | { kind: "blocked"; reason: "isolation" | "commitFailed" | "attemptsExhausted" | "fixBudget" | "config" | "subtask" | "unreadable" | "cleanTree" | "mutualPark"; detail: string }
type Menu = {
  claimable: { unit: string; title: string; kinds: [Grant["kind"]]; touches?: readonly string[] }[]
  leases: (LeaseKey & Pick<Grant, "kind" | "deadline" | "attempt">)[]
  // 0261 D2's additive `types` block (enacted by 0269, under the
  // `protocol` wire version — P13): the restriction catalog rides the menu, the single
  // dispatch-time payload (0246 D4 b's "hub-as-scheduler's menu" letter); a
  // client that ignores it behaves byte-identically (P10).
  types: ExecutorTypes
  // 0271's additive `pending` list: the pending person items as dispatch-
  // time data on the same menu (0269's carrier letter — never an envelope
  // sibling, 0270's letter reserving those for handshake identity); derived
  // from the durable records personStep and offerGate already read (P6), a
  // reader that ignores it behaves byte-identically (P10).
  pending: MenuPending[]
}
type ScopedTask = { task: Task; worktree: boolean }
type Checkpoint = "booked" | "committed" | "park-recorded" | "close-index-written" | "closed-files" | "closed-commit" |
  "workspace-booked" | "workspace-created" | "landing-booked" | "lane-landed" | "nested-committed"
// The lease clock (0260, discharging 0246 §C's deferral): the budget is
// configured per project (config key executorLease, P16 — never hardcoded),
// this 60 the absent-key default (0246 D4 c's advisory figure); the window
// and the hard cap stay the lease grammar's fixed relations of whichever
// budget a grant carries (0246 D4 l: budget + grace, the cap twice the
// window). Both clock sites below derive them from the grant's own budget,
// so a lease keeps the clock it was issued under across a mid-lease config
// edit — the next grant carries the new value (P20: clock changes land at
// the issuance boundary, never under a live lease).
const DEFAULT_LEASE_BUDGET_MINUTES = 60
const LEASE_GRACE_MINUTES = 5
function leaseWindowMs(budget: number): number {
  return (budget + LEASE_GRACE_MINUTES) * 60_000
}
const MAX_ATTEMPTS = 3
const MAX_RESPONSE_BYTES = 256 * 1024
const STATE = join(".auto", "executor-progress.json")

function sameHolder(a: Holder, b: Holder): boolean {
  return a.token === b.token && a.channel === b.channel
}

function shareMessage(grant: Grant, parked = false): string {
  if (parked) return message(`${grant.unit} park ${grant.title}`, { id: grant.unit }, "park", [], `Executor lease ${grant.lease}`)
  // 0278: the audit share's stage word `close-audit` is the push family's
  // own — the construction commits' and the baselines commit's own word
  // (close-audit.ts's three commit sites), the only close-audit-specific
  // stage the push vocabulary carries (the session's own work lands
  // push-side under the ordinary task execute stage). The family's stamped
  // word is the one reused so the landed share's provenance stays
  // distinguishable from an ordinary execute share's — the FAIL finding's
  // reader reads the audit's commits by their stage.
  return message(grant.id, { id: grant.unit }, executorStageOf(grant.kind), [], `Executor lease ${grant.lease}`)
}

// The share stage word per grant kind (0280's ratchet table): one exported
// home the doc's stage-word enumeration pins against — each kind's word the
// push family's own (0278's close-audit letter states the reuse rule), never
// a protocol-invented word. The park, done and clarify stages are
// shape-specific (shareMessage's park arm, closeVerified's done commit,
// settleGate's clarify commit), enumerated beside the table in the spec.
export const SHARE_STAGE_OF_KIND: Record<Grant["kind"], string> = {
  execute: "exec",
  verify: "wrapup",
  fix: "fix",
  formulate: "phase-formulate",
  // 0281: the synthesize share's landing IS the construction commit — the
  // push construction's own family word with its own stage so a landed
  // synthesis stays distinguishable from a plain floor construction (the
  // new-word ruling: plans/0279's docket names `phase-synthesize`).
  synthesize: "phase-synthesize",
  distill: "phase-handover",
  audit: "close-audit",
}

// The protocol's whole stage-word vocabulary, one derivation (0280's ratchet
// table): the per-kind share words plus the three shape-specific commits —
// `park` (shareMessage's park arm), `done` (closeVerified's close-out) and
// `clarify` (settleGate's release). The literals at those sites move in the
// same conscious change as this derivation; the spec's enumeration
// (docs/protocol.md) pins against it, both directions.
export const SHARE_STAGE_WORDS = [...Object.values(SHARE_STAGE_OF_KIND), "park", "done", "clarify"] as const

function executorStageOf(kind: Grant["kind"]): string {
  return SHARE_STAGE_OF_KIND[kind]
}

// 0246 D4 i's never-list stated as path grammar for the fence's own input
// (0259, completing the widening below): with the role test yielding inside a
// declared scope, the driver-exclusive docs surfaces need their own arms —
// the unit state files todo.md/done.md (task, stream and phase-planning
// shapes), the index family (docs/R-NN/phases.md and the phase's tasks.md)
// and docs/T-NNN/subtasks.md (.opencode/ refused on the first line, .auto/
// by workdirEntry, git metadata never riding a status row). A person-owned
// root file such as the host's opencode.json needs no named arm (plans/0296:
// the tool takes no posture on it) — it sits outside every grant's write
// scopes, refused as out-of-scope like any other person file. Every shape
// here is non-freeform, so the undeclared floor below refuses them
// identically (P10).
const UNIT_STATE_DOC = /^docs\/(?:T-\d+(?:\/S\d+)?|R-\d+\/P\d{2,}-[a-z][a-z0-9-]*)\/(?:todo|done)\.md$/
const INDEX_DOC = /^docs\/R-\d+\/(?:phases|P\d{2,}-[a-z][a-z0-9-]*\/tasks)\.md$/
const SUBTASKS_DOC = /^docs\/T-\d+\/subtasks\.md$/
const CONFIG_DIR = ".opencode"
const AGENTS_NAME = "AGENTS.md"
export function driverExclusive(path: string): boolean {
  return UNIT_STATE_DOC.test(path) || INDEX_DOC.test(path) || SUBTASKS_DOC.test(path)
}

// The standing refusal set (0246 D4 i's never-list, stated as the one table
// both renderings read): the driver workdir roots (WORKDIR_ROOTS through
// workdirEntry), the root config directory and every AGENTS.md segment, plus
// driverExclusive's documents. The fence (permitted below, the settlement
// rendering) and the catalog (executorTypeCatalog, the dispatch rendering)
// are the two renderings of exactly this table — one source, P5/P7.
function standingRefusal(path: string): boolean {
  return workdirEntry(path) || path === CONFIG_DIR || path.startsWith(`${CONFIG_DIR}/`) ||
    path.split("/").includes(AGENTS_NAME) || driverExclusive(path)
}

// The formulation family (0276, the formulate kind's per-kind permitted
// arm): the phase's planning surfaces the formulation session writes — the
// phase's task index (the grant's own `index` anchor), the planned tasks'
// pending documents (the todo.md grammar MINUS the formulation unit's own
// todo — the session's single input, never its write), and the unit's
// coverage map (taskDoc's own construction). The arm rides grants carrying
// the formulation context — formulate grants and fix rounds over the
// formulation unit (the plan's repair) — and precedes the standing refusal
// for exactly this family: the fence admits the write SURFACE, the
// settlement judges the GRAMMAR (rows appended, nothing ticked, removed or
// reordered — the fixed-prefix discipline; the new documents valid —
// plannedTaskProblems; P7's letter). Everything the never-set refuses for
// every kind stays refused here: done.md (the todo→done rename is the
// close-out's alone), subtasks.md, phases.md, another phase's index, the
// workdir, config, AGENTS.md — and the formulate kind takes no freeform
// floor: the planning session's deliverables are documents, the fence
// admits exactly them beside the standing handoff arm.
const PENDING_PLAN_DOC = /^docs\/T-\d+\/todo\.md$/
function formulationFamily(entry: { grant: { kind: Grant["kind"]; unit: string; index?: string } }, path: string): boolean {
  return entry.grant.index !== undefined && (
    path === entry.grant.index || path === taskDoc(entry.grant.unit, "coverage") ||
    (PENDING_PLAN_DOC.test(path) && path !== taskStatePaths(entry.grant.unit).pending)
  )
}

export function permitted(entry: {
  grant: { kind: Grant["kind"]; unit: string; index?: string; handover?: string; findings?: string }
  scope?: readonly string[]
  touches?: readonly string[]
}, path: string): boolean {
  if ((entry.grant.kind === "formulate" || entry.grant.kind === "fix") && formulationFamily(entry, path)) return true
  // The synthesize kind's per-kind arm (0281): exactly the granted unit's
  // pending todo — the REPLY CHANNEL, the session's one write surface (the
  // settlement parses the reply there, composes the real document and lands
  // it through the construction — the channel is never the landed
  // document). The arm precedes the standing refusal because the todo path
  // is driver-exclusive grammar; everything else stays refused: every other
  // unit's todo, the done half, the index family, the workdir, config,
  // AGENTS.md. No freeform floor, no handoff arm — the constructor session
  // is tool-less push-side, its protocol twin exactly as narrow.
  if (entry.grant.kind === "synthesize") return path === taskStatePaths(entry.grant.unit).pending
  if (standingRefusal(path)) return false
  // The distill kind's per-kind arm (0277): exactly the granted handover
  // document, nothing else — the deliverable is a document, the task-doc
  // arms below are task-unit-shaped and never apply (the early return keeps
  // the phase-unit id out of taskDocPaths entirely). The never-set above
  // keeps everything else refused: phases.md (the tick is the apply's), the
  // phase's own todo.md/done.md (the completion rename is the apply's — the
  // person's transfer through completePhase), another phase's handover
  // document, subtasks.md, the workdir, config, AGENTS.md. No freeform
  // floor, no handoff arm — the push distillation is a one-shot bypass
  // session with no Status-line channel.
  if (entry.grant.kind === "distill") return path === entry.grant.handover
  const docs = taskDocPaths(entry.grant.unit)
  // The audit kind's per-kind arm (0278): the granted findings document —
  // the adjudication's one deliverable, the template's own law "an
  // adjudication judges and documents, it never repairs in-round: modify
  // nothing outside your own task directory" — beside the standing handoff
  // arm (the audit session is an ordinary whole-task session, the push
  // channel's own: an audit share hands over and continues like an execute
  // share). No freeform floor. The never-set above keeps everything else
  // refused: the unit's own todo.md/done.md (the close-out's), subtasks.md,
  // phases.md, the task indexes, the workdir, config, AGENTS.md.
  if (entry.grant.kind === "audit") return path === entry.grant.findings || path === docs.handoff
  // The fix context arm (0278): a fix round over the standing close-audit
  // unit carries the findings path — the repair rewrites the same document
  // the audit share wrote (the verify share's FAIL funnel repairing the
  // document's acceptance, never the invariant), the per-unit context
  // riding the grant (0276's fix-context discipline).
  if (entry.grant.kind === "fix" && entry.grant.findings !== undefined && path === entry.grant.findings) return true
  if (entry.grant.kind === "verify") return path === docs.report || path === docs.gaps
  if (entry.grant.kind === "formulate" || entry.grant.index !== undefined) return path === docs.handoff
  if (path === docs.handoff) return true
  const scope = entry.scope ?? entry.touches
  // The role test yields inside a declared scope (0259): the ruled permitted
  // set is the unit's effective scope plus the per-kind artifact paths
  // (0248 D5), so an in-scope artifact-role document — a unit whose `Touches:`
  // declares its register, receipts or evidence under docs/ — is task work,
  // never an out-of-contract write. With no declaration the freeform-only
  // serial floor stands unchanged (P10).
  if (scope !== undefined) return withinScopes(path, scope)
  return roleOf(path) === "freeform"
}

// The path-shaped causes' arm, derived through the never-set (0272): when
// every offending path is refused for every grant kind — standingRefusal's
// own table, the one source the fence and the catalog already read (P5/P7)
// — the remedy is necessarily a person or driver act (0248 D5's own letter:
// the out-of-contract writes are the person's to inspect, keep or remove),
// never a write the holder can make. A mixed set, or one merely outside
// this grant's scope, stays replay-side: the holder's own uncommitted edit
// remains its remedy and the boundary reads conservative (P12).
function neverSetRows(rows: readonly { rel: string }[]): boolean {
  return rows.length > 0 && rows.every(({ rel }) => standingRefusal(rel))
}

// Marking a settlement block person-necessary at its cause site (0272): the
// classification lives with the site that knows the cause; settle()'s
// wrapper is the one reader (one home, P5).
function outsidePerimeter(report: BlockedReport): SettlementBlocked {
  return { ...report, escalated: true }
}

// The executor restriction catalog (0261 D2, enacted by 0269): the
// machine-readable statement of each work type's restrictions on `ready`'s
// menu — the tool's whole duty toward a coding-agent consumer being
// information provision. Every letter is derived from the tables above, the
// same tables the landing fence reads: the `never` path grammar from the
// standing refusal set's own members (WORKDIR_ROOTS, the config and AGENTS
// arms, driverExclusive's documents — rendered as regex sources), the
// `writes` artifact paths from taskDocPaths itself over the placeholder unit,
// the `undeclared` floor's word from roleOf's own "freeform" role, and the
// person entries' authority vocabulary from the questionAuthority and
// releaseAuthority checks — never a second hand-maintained list (P5,
// P7). The one letter no path table carries is the Git prohibition: its home
// is the standing write contract's authority posture (0246 D4 i — the
// coordinator alone stages and commits, P4; executor.md teaches it), cited
// here as the frozen literal `git: "coordinator-only"`. Ids are frozen
// additive under the wire's `protocol` version (P13) and never exceed what
// the coordinator can grant: the work ids satisfy Grant["kind"], the person ids the step
// kinds personStep and offerGate deliver. The type-level letter only —
// per-unit scope stays where it rides (the menu's `touches`, the grant's
// `workspace`). No enforcement claim is made (P12): violations surface at
// the standing boundary checks, which fail loud.
const GIT_LETTER = "coordinator-only" as const
const CATALOG_UNIT = "T-NNN"
// Exported for the protocol-doc ratchet (0280): the doc's grant-kind
// enumeration pins against this table — the one home the catalog, the wire
// and the spec share (P5).
export const WORK_TYPE_IDS = ["execute", "verify", "fix", "formulate", "synthesize", "distill", "audit"] as const satisfies readonly Grant["kind"][]

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function neverPaths(): string[] {
  return [
    `^(?:${WORKDIR_ROOTS.map(escapeRe).join("|")})(?:/|$)`,
    `^${escapeRe(CONFIG_DIR)}(?:/|$)`,
    `(?:^|/)${escapeRe(AGENTS_NAME)}(?:/|$)`,
    UNIT_STATE_DOC.source,
    INDEX_DOC.source,
    SUBTASKS_DOC.source,
  ]
}

// The formulate entry's never letter (0276): the standing refusal MINUS the
// family its per-kind arm admits — the pending documents' grammar (the done
// half stays refused: the todo→done rename is the driver's close-out alone)
// and the owning phase's index (another phase's index stays refused through
// the anchor's per-unit letter). Rendered from UNIT_STATE_DOC's and
// INDEX_DOC's own sources by dropping the admitted alternative — one table,
// never a second (P5) — and the catalog test's corpus holds the rendering
// and the fence equal, both directions.
const DONE_STATE_DOC_SOURCE = UNIT_STATE_DOC.source.replace("(?:todo|done)", "done")
const PHASES_DOC_SOURCE = INDEX_DOC.source.replace("(?:phases|P\\d{2,}-[a-z][a-z0-9-]*\\/tasks)", "phases")

// The formulate letter's per-unit anchors: the placeholder forms of the
// phase's task index (the granted `index` names the real one) and the
// planned tasks' pending documents (the grammar's placeholder unit), beside
// the coverage map's taskDoc construction — the same convention verify's
// report/gaps paths carry (0269).
const CATALOG_PHASE_INDEX = "docs/R-NN/P<nn>-<type>/tasks.md"
// The distill letter's per-unit anchor (0277): the placeholder form of the
// phase's handover document (the granted `handover` names the real one).
const CATALOG_PHASE_HANDOVER = "docs/R-NN/P<nn>-<type>/handover.md"
// The audit letter's per-unit anchor (0278): the placeholder form of the
// standing close-audit unit's findings document (the granted `findings`
// names the real one), beside the standing handoff placeholder — the two
// paths the fence's per-kind arm admits.
const CATALOG_TASK_FINDINGS = "docs/T-NNN/findings.md"

function formulateNeverPaths(): string[] {
  return [
    `^(?:${WORKDIR_ROOTS.map(escapeRe).join("|")})(?:/|$)`,
    `^${escapeRe(CONFIG_DIR)}(?:/|$)`,
    `(?:^|/)${escapeRe(AGENTS_NAME)}(?:/|$)`,
    DONE_STATE_DOC_SOURCE,
    PHASES_DOC_SOURCE,
    SUBTASKS_DOC.source,
  ]
}

function workTypeLetter(id: Grant["kind"]): ExecutorWorkTypeLetter {
  if (id === "verify") {
    const docs = taskDocPaths(CATALOG_UNIT)
    return { id, never: { git: GIT_LETTER, paths: neverPaths() }, writes: { scope: "none", paths: [docs.report, docs.gaps] } }
  }
  if (id === "formulate") {
    return {
      id,
      never: { git: GIT_LETTER, paths: formulateNeverPaths() },
      writes: { scope: "none", paths: [CATALOG_PHASE_INDEX, taskStatePaths(CATALOG_UNIT).pending, taskDoc(CATALOG_UNIT, "coverage")] },
    }
  }
  // The synthesize entry (0281): the never letter renders the standing set
  // minus the pending-todo grammar (the formulate entry's own rendering —
  // DONE_STATE_DOC_SOURCE keeps the done half refused, the index arms
  // unchanged), the writes letter carrying the granted todo's placeholder
  // alone. The honest limit, stated once beside 0276/0277/0278's own:
  // another unit's todo matches neither the never grammar nor the writes
  // anchor — the per-unit anchor names the one admitted, the fence refuses
  // the rest, the coordinator's boundary checks the authority per 0261 D3.
  if (id === "synthesize") {
    return { id, never: { git: GIT_LETTER, paths: formulateNeverPaths() }, writes: { scope: "none", paths: [taskStatePaths(CATALOG_UNIT).pending] } }
  }
  // The distill entry (0277): the standing never paths whole — nothing the
  // never-set refuses is admitted for the distill kind (the handover
  // document is not in the never-set) — and the writes letter carrying the
  // handover document's placeholder alone. The honest limit, stated once
  // (0276's own): another phase's handover document matches neither the
  // never grammar nor the writes anchor — the per-unit anchor names the one
  // admitted, the fence refuses the rest, and the coordinator's boundary
  // checks are the authority either way (0261 D3's posture).
  if (id === "distill") {
    return { id, never: { git: GIT_LETTER, paths: neverPaths() }, writes: { scope: "none", paths: [CATALOG_PHASE_HANDOVER] } }
  }
  // The audit entry (0278): the standing never paths whole (the findings
  // document is not in the never-set) and the writes letter carrying the
  // findings document's placeholder beside the standing handoff's — the
  // two paths the fence's per-kind arm admits. The honest limit, stated
  // once beside 0276/0277's own: another unit's findings document matches
  // neither the never grammar nor the writes anchor — the per-unit anchor
  // names the one admitted, the fence refuses the rest, and the
  // coordinator's boundary checks are the authority either way (0261 D3's
  // posture).
  if (id === "audit") {
    return { id, never: { git: GIT_LETTER, paths: neverPaths() }, writes: { scope: "none", paths: [CATALOG_TASK_FINDINGS, taskDocPaths(CATALOG_UNIT).handoff] } }
  }
  return { id, never: { git: GIT_LETTER, paths: neverPaths() }, writes: { scope: "unit-effective", undeclared: "freeform", paths: [taskDocPaths(CATALOG_UNIT).handoff] } }
}

export type ExecutorNeverLetter = { readonly git: typeof GIT_LETTER; readonly paths: readonly string[] }
export type ExecutorWriteLetter = {
  readonly scope: "unit-effective" | "none"
  readonly paths: readonly string[]
  readonly undeclared?: "freeform"
}
export type ExecutorWorkTypeLetter = {
  readonly id: (typeof WORK_TYPE_IDS)[number]
  readonly never: ExecutorNeverLetter
  readonly writes: ExecutorWriteLetter
}
export type ExecutorTypes = {
  readonly execute: ExecutorWorkTypeLetter
  readonly verify: ExecutorWorkTypeLetter
  readonly fix: ExecutorWorkTypeLetter
  readonly formulate: ExecutorWorkTypeLetter
  readonly synthesize: ExecutorWorkTypeLetter
  readonly distill: ExecutorWorkTypeLetter
  readonly audit: ExecutorWorkTypeLetter
}

// The rendering beside menu(): one object computed from the tables at module
// init, every menu carrying the same reference. Exported for the wire — the
// coordinator is its one home (0269's ruling records the measured size).
const CATALOG: ExecutorTypes = {
  execute: workTypeLetter("execute"),
  verify: workTypeLetter("verify"),
  fix: workTypeLetter("fix"),
  formulate: workTypeLetter("formulate"),
  synthesize: workTypeLetter("synthesize"),
  distill: workTypeLetter("distill"),
  audit: workTypeLetter("audit"),
}
export function executorTypeCatalog(): ExecutorTypes {
  return CATALOG
}

function sameDocument(left: string | undefined, right: string): boolean {
  return left !== undefined && left.replaceAll("\r\n", "\n") === right.replaceAll("\r\n", "\n")
}

async function gitRead(dir: string, ...args: string[]): Promise<string> {
  const result = await git(dir, args)
  if (result.code !== 0) throw new Error(result.err.trim() || `git ${args[0]} failed`)
  return result.out.trim()
}

// A root's HEAD, "" when the repository has no commits yet (a session-created
// nested root the settlement gives its first commit, 0258).
async function headOf(root: string): Promise<string> {
  const got = await git(root, ["rev-parse", "HEAD"])
  return got.code === 0 ? got.out.trim() : ""
}

// The workspace's dirt across every repository root, rows checkout-relative
// (0258): the nested-first posture the push path's unified commit already
// carries (0073) — each root read through statusEntriesRead, which remaps
// nested output to checkout-relative paths. undefined = any root unreadable
// (P12: never a silent clean verdict).
async function workspaceStatus(checkout: string, roots?: readonly string[]): Promise<{ rel: string; status: string }[] | undefined> {
  const rows: { rel: string; status: string }[] = []
  for (const root of roots ?? await repoRoots(checkout)) {
    const read = await statusEntriesRead(checkout, root)
    if (!read) return undefined
    rows.push(...read)
  }
  return rows
}

// The settlement observes the grant's own per-kind artifact paths
// ignore-aware (0263, 0262-01's fix): 0249's perimeter letters keep porcelain
// blind to ignored paths — those surfaces stay forbidden, the fence unchanged
// — but the per-kind artifacts (report/gaps on verify, the handoff else) are
// the protocol's own landed evidence (0248 D5), and 0245's ignore set holds
// exactly that path grammar ignored in targets the manual suite has run. The
// concession is confined to the artifact paths absent from the plain rows:
// every other ignored path stays invisible exactly as 0249 words it, and an
// unreadable confined read adds nothing — the plain rows stand, and a
// shadowed artifact of bad grammar then blocks visibly at the verdict check,
// never a wrong verdict (P12). The "!!" rows ride `changes` into the fence
// (which permits the artifact paths per kind) and the staging force-adds
// them: git refuses an ignored pathspec without -f, and the evidence must
// land. Once landed the artifact is tracked and the ignore rule is inert for
// it — the manual suite's transient posture governs untracked instances only,
// so the two lifecycles compose on the one path grammar (0263's letter).
async function ignoredArtifactRows(checkout: string, grant: Grant, plain: readonly { rel: string }[]): Promise<{ rel: string; status: string }[]> {
  const docs = taskDocPaths(grant.unit)
  // The distill kind's artifact is the granted handover document itself
  // (0277) — the phase-unit id never reaches taskDocPaths' arms. The audit
  // kind's artifact is the granted findings document (0278).
  const artifacts = grant.kind === "verify" ? [docs.report, docs.gaps] : grant.kind === "distill" ? [grant.handover] : grant.kind === "audit" ? [grant.findings] : grant.kind === "synthesize" ? [taskStatePaths(grant.unit).pending] : [docs.handoff]
  const seen = new Set(plain.map(({ rel }) => rel))
  const ask = artifacts.filter((path) => !seen.has(path))
  if (!ask.length) return []
  const read = await git(checkout, ["status", "--porcelain", "-z", "--no-renames", "-uall", "--ignored", "--", ...ask.map((path) => `:(literal)${path}`)])
  if (read.code !== 0) return []
  return read.out.split("\0")
    .filter((entry) => entry.startsWith("!! "))
    .map((entry) => ({ rel: entry.slice(3), status: "!!" }))
}

// Every booked nested root's commit still sits witnessed at its HEAD (0258):
// the replay of a landed multi-root share proves each root, never the top
// repository alone. gitRead trims its output, so a session-created root's
// parentless first commit compares without the leading blank line.
async function nestedWitnesses(checkout: string, grant: Grant, intent: NonNullable<EndedBooking["intent"]>): Promise<boolean> {
  const messageText = shareMessage(grant, !!intent.park)
  for (const record of intent.nested ?? []) {
    const root = join(checkout, record.root)
    const head = await headOf(root)
    const witness = head ? await gitRead(root, "show", "-s", "--format=%P%n%T%n%B", head) : ""
    const expected = record.base ? `${record.base}\n${record.tree}\n${messageText}` : `${record.tree}\n${messageText}`
    if (witness !== expected) return false
  }
  return true
}

// The formulate settlement's mechanical collect (0276): every grammar the
// push path's collect carries (runner's formulation arm) judged here — the
// unit's own row staying in the index, the first attempt's fixed prefix
// (pre-existing rows and their state files byte-identical to the claim-time
// base), plannedTaskProblems over the index the session wrote, and the
// coverage map against the landed ledger. Read-only, so a settlement
// replay re-derives it unchanged. Two push checks have no window on the
// protocol and are deliberately not rebuilt (P21): the landed-todo digest
// (the fence excludes the unit's own todo, so an edit is an out-of-scope
// never-set row that 0272's classification escalates to the person — the
// push digest guarded a commit window the lease's live tree does not
// have) and the driver's own-row restore (the holder is live: the blocked
// voice teaches restoring its own row, a write inside the family). Content
// quality stays the verify share's judgment (P3); this collect is
// grammars alone (P7), its problems the holder's own remedy — replayable,
// never escalated (every remedy a write inside the formulation family).
async function formulationProblems(dir: string, grant: Extract<Grant, { kind: "formulate" }>, base: string): Promise<string[]> {
  const phase = planPhaseOf(grant.phase, grant.index)
  const indexText = await Bun.file(join(dir, grant.index)).text().catch(() => undefined)
  if (indexText === undefined) return [`${grant.index} is missing`]
  const entries = parseIndex(indexText, "task").entries
  if (!entries.some(({ id }) => id === grant.unit)) {
    return [
      `${grant.index} no longer lists the formulation task ${grant.unit} — its own row must stay in the index (the driver ticks and closes the unit through it); restore the row, then re-run`,
    ]
  }
  const problems: string[] = []
  const skip = new Set([grant.unit])
  const baseline = [{ root: dir, sha: base }]
  if (grant.attempt === 1) {
    // The fixed prefix (0205 D2): the pre-existing rows are the person's and
    // the driver's — every row beside the formulation arrived through
    // `plan --new-task` or a person's commit — fixed in place and content,
    // judged against the claim-time base exactly as the push collect judges
    // its unit-start baseline (a failed read degrades to the unchecked
    // floor, never a block; a retry replans over its own prior output).
    const indexed = await contentAtBase(dir, baseline, grant.index)
    if (indexed.ok && indexed.text !== undefined) {
      const expected = parseIndex(indexed.text, "task").entries
      if (entries.length < expected.length) {
        problems.push(
          `${grant.index} lists ${entries.length} task(s) but held ${expected.length} before the session; the pre-existing lines are fixed — plan beside them, never remove one`,
        )
      } else {
        for (let i = 0; i < expected.length; i++) {
          const was = expected[i]!
          const now = entries[i]!
          if (now.id !== was.id) {
            problems.push(`${grant.index} line ${now.line}: ${now.id} sits where ${was.id} sat; the pre-existing lines are fixed — plan after them, never reorder or replace`)
            break
          }
          if (now.title !== was.title || now.ticked !== was.ticked) {
            problems.push(`${grant.index} line ${now.line}: the existing line of ${was.id} was edited; pre-existing lines are fixed`)
            break
          }
        }
      }
      for (const row of expected.filter((entry) => entry.id !== grant.unit)) {
        skip.add(row.id)
        const paths = taskStatePaths(row.id)
        for (const key of ["pending", "complete"] as const) {
          const was = await contentAtBase(dir, baseline, paths[key])
          if (!was.ok) continue
          const now = await Bun.file(join(dir, paths[key])).text().catch(() => undefined)
          if (was.text === undefined && now !== undefined) {
            problems.push(`${paths[key]} of the pre-existing task ${row.id} is new; a formulation session never touches a pre-existing task's state files`)
          } else if (was.text !== undefined && now !== was.text) {
            problems.push(`${paths[key]} of the pre-existing task ${row.id} was changed or removed; a formulation session never edits a pre-existing task's document`)
          }
        }
      }
    }
  }
  const checked = await plannedTaskProblems(dir, phase, { before: await takenTaskIds(dir, phase), numberStart: (taskNumber(grant.unit) ?? 1) + 1, skip })
  const ledger = ledgerOf(await Bun.file(join(dir, taskStatePaths(grant.unit).pending)).text().catch(() => ""))
  const coverage = ledger !== undefined
    ? coverageProblems(ledger, await Bun.file(join(dir, taskDoc(grant.unit, "coverage"))).text().catch(() => ""), checked.ids)
    : []
  return [...problems, ...checked.problems, ...coverage]
}

// The distill settlement's mechanical collect (0277): the push collect's own
// grammars judged here — validHandover (the four mandatory sections,
// HANDOVER_SECTIONS' own function) and the OPEN-status lint
// (constraintPitfallResolves, an AUTO-RESOLVE marker under "Constraints and
// pitfalls" is status laundering). The acceptance-draft half of the push
// collect never applies on the protocol (executor mode refuses
// acceptanceGate, configBlock's own arm — the draft cannot exist); the
// write-time charter check is a default-off experiment-switch session the
// grant does not carry (0276's own precedent for push-side session
// concerns). Content quality stays the person's boundary review (the
// advance's stop and the phase gates) exactly as push-side — this collect is
// grammars alone (P7), its problems the holder's own remedy (rewrite the
// document, a write inside its family) — replayable, never escalated. The
// push reset (rm of a partly written handover) is deliberately not rebuilt
// (P21, 0276's two-checks precedent: the holder is live, the next attempt
// rewrites the document wholesale).
async function distillationProblems(checkout: string, grant: Extract<Grant, { kind: "distill" }>): Promise<string[]> {
  const text = await Bun.file(join(checkout, grant.handover)).text().catch(() => undefined)
  if (text === undefined) return [`${grant.handover} is missing`]
  const problems: string[] = []
  if (!validHandover(text)) {
    problems.push(`${grant.handover} must carry the four mandatory sections as standalone headings exactly: ${HANDOVER_SECTIONS.map((section) => `\`${section}\``).join(" / ")}`)
  }
  const lint = constraintPitfallResolves(text)
  if (lint) problems.push(lint)
  return problems
}

// The audit settlement's mechanical collect (0278): the push path's own
// grammars over the findings document, judged through their own functions —
// parseResult (the one `Result:` grammar home: the document must end with
// its adjudication's receipt line, PASS or FAIL, the line the driver reads
// as the cover evidence) and the due-row linkage (namesRowId, the
// adjudication gather's own naming rule: every row the round owes at the
// closing tree — auditDueRows reading the cover set with the unit's own
// findings document excluded, so the claim-time set the constructor keyed
// the unit on stands — named in the document). The verdict itself is never
// judged here (P7 — the FAIL finding is the person's decision surface, the
// no-fix rule: the share lands whatever the verdict); a table that does
// not parse stands the naming check down (the constructor's own posture —
// it keys nothing on an unjudgeable set, the close gate holding the named
// problem at the person's moment). Replayable by classification (every
// remedy a rewrite of the holder's own document), so the plain blocked
// answer — 0272's ladder, the details themselves teaching the holder's
// remedy. The push halves with no window on the protocol deliberately not
// rebuilt (P21): the close arms' construction, the baseline citation
// (`updateAssuranceBaselines`, the close arms' own commit) and the
// person's remediation itself.
async function auditProblems(dir: string, grant: Extract<Grant, { kind: "audit" }>): Promise<string[]> {
  const text = await Bun.file(join(dir, grant.findings)).text().catch(() => undefined)
  if (text === undefined) return [`${grant.findings} is missing`]
  const problems: string[] = []
  if (parseResult(text) === undefined) {
    problems.push(`${grant.findings} must end with its adjudication's result line as the last line of body text: \`Result: PASS\`, or \`Result: FAIL <one-sentence reason>\` — the driver reads it as the receipt`)
  }
  const due = await auditDueRows(dir, grant.round, grant.findings)
  if (due !== undefined) {
    const missing = due.filter(({ due: entry }) => !namesRowId(text, entry.row.id)).map(({ due: entry }) => `${entry.row.id} (${entry.row.invariant})`)
    if (missing.length) {
      problems.push(`${grant.findings} must carry one section per due row, the row's id in the section's heading — missing: ${missing.join(", ")}`)
    }
  }
  return problems
}

export async function openExecutorCoordinator(
  directory: string,
  options: { checkpoint?: (point: Checkpoint) => void; now?: () => number } = {},
): Promise<{
  claim(holder: Holder, task?: string, kind?: Grant["kind"]): Promise<Claim>
  ready(holder: Holder): Promise<Menu>
  brief(holder: Holder, task: string, kind?: Grant["kind"]): Promise<Claim>
  verification(holder: Holder): Promise<DerivedStep | VerificationPreview>
  heartbeat(holder: Holder, leases: readonly LeaseKey[]): Promise<Menu>
  release(holder: Holder, step: string, lease: string): Promise<DerivedStep>
  report(holder: Holder, step: string, lease: string, outcome: "ended" | "failed", note?: string): Promise<Receipt | DerivedStep>
  next(holder: Holder): Promise<DerivedStep>
  reconcile(unit?: string): Promise<{ lines: string[] }>
  busy(): Promise<boolean>
  close(): Promise<void>
}> {
  const dir = await realpath(directory)
  const now = options.now ?? Date.now
  const { checkpoint } = options
  // The shared run lock is reentrant within one process. A coordinator needs
  // exclusive ownership even when two callers share that process.
  if (liveRunLock(dir)) throw new Error("The project already has an active driver.")
  const lock = acquireRunLock(dir, "executor")
  if (!lock.ok) throw new Error("The project already has an active driver.")
  const file = join(dir, STATE)
  let entries: Entry[]
  try {
    const readState = (path: string) => readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error
      return "[]"
    })
    entries = JSON.parse(await readState(file)) as Entry[]
    if (!Array.isArray(entries) || entries.some((entry) =>
      !entry?.grant || !entry.holder || typeof entry.base !== "string" ||
      !Number.isFinite(entry.issued) || !Number.isFinite(entry.grant.deadline) ||
      (entry.worktree !== undefined && (!validExecutorWorkspace(entry.worktree) || !entry.scope ||
        entry.grant.workspace !== executorWorkspacePath(dir, entry.worktree))) ||
      (entry.booking?.outcome === "ended" && entry.booking.landing !== undefined &&
        (!entry.worktree || !entry.booking.intent || !validExecutorLanding(entry.booking.landing)))
    )) throw new Error("Invalid executor progress record.")
  } catch (error) {
    lock.release()
    throw error
  }

  let tail: Promise<unknown> = Promise.resolve()
  let closed = false
  function serialize<T>(act: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("The executor coordinator is closed."))
    // The dead-letter sweep rides every serialized operation's head (0287),
    // the continuation re-derivation beside it (0289): one home, serialized
    // against every derivation — the pin self-clears at the next wire act of
    // any kind (a claim, a menu read, a heartbeat), so no derivation sees a
    // reconcileable dead letter or a correctable continuation. Idempotent and
    // free when none stands (every entry booked or live, no flag whose
    // evidence flipped — a healthy history's loops skip whole, the
    // byte-identical floor, P10).
    const run = tail.then(async () => {
      await reconcileDeadLetters(now())
      await reconcileContinuations()
      return act()
    })
    tail = run.catch(() => undefined)
    return run
  }

  async function replaceFile(path: string, text: string, mode: number, tempBase = path, beforeRename?: () => void): Promise<void> {
    const temp = `${tempBase}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, text, { mode, flag: "wx" })
      beforeRename?.()
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async function persist(next: Entry[]): Promise<void> {
    await replaceFile(file, JSON.stringify(next), 0o600)
    entries = next
  }

  // The brief's response-size bound (0282: the ask channel's answers are
  // gone, the size measure stays — the wire envelope's shape governs).
  function withAnswers(holder: Holder, grant: Grant): Grant | Extract<ExecutorPreview, { kind: "blocked" }> {
    void holder
    if (Buffer.byteLength(JSON.stringify({ protocol: EXECUTOR_PROTOCOL, step: grant })) > MAX_RESPONSE_BYTES) {
      return { kind: "blocked", reason: "config", detail: "The rendered brief exceeds the 256 KiB executor response limit. Shorten the project or task inputs." }
    }
    return grant
  }


  async function book(entry: Entry, booking: Booking): Promise<Entry> {
    const next = { ...entry, booking }
    await persist(entries.map((item) => item === entry ? next : item))
    return next
  }

  function workspaceBlock(error: unknown): BlockedReport {
    if (!(error instanceof ExecutorWorktreeError)) throw error
    return { kind: "blocked", reason: "isolation", detail: error.message }
  }

  async function openCheckout(entry: Entry): Promise<string | BlockedReport> {
    if (!entry.worktree?.established) return dir
    try {
      return await ensureExecutorWorkspace(dir, entry.worktree)
    } catch (error) {
      return workspaceBlock(error)
    }
  }

  async function grantCheckout(holder: Holder, entry: Entry): Promise<Claim> {
    const reply = withAnswers(holder, entry.grant)
    if (reply.kind === "blocked" || !entry.worktree) return reply
    try {
      await ensureExecutorWorkspace(dir, entry.worktree)
    } catch (error) {
      return workspaceBlock(error)
    }
    if (!entry.worktree.established) {
      checkpoint?.("workspace-created")
      const established = { ...entry, worktree: { ...entry.worktree, established: true as const } }
      await persist(entries.map((item) => item === entry ? established : item))
    }
    return reply
  }

  function latest(unit: string): Entry | undefined {
    return entries.findLast(({ grant }) => grant.unit === unit)
  }

  // The unit's latest *landed* entry — the position the continuation flag
  // actually routes from (the priorHandoff read below walks landed entries
  // with findLast, position-independent of later dead or non-landing
  // entries). 0290 F1's fix 0291 keyed the correction sweep to this same
  // read: a flag shadows only behind a later landed entry, never behind a
  // dead tail.
  function lastLanded(unit: string): Entry | undefined {
    return entries.findLast(({ grant, booking }) => grant.unit === unit && booking?.receipt?.kind === "landed")
  }

  function reserved(): Entry[] {
    const units = new Map(entries.map((entry) => [entry.grant.unit, entry]))
    return [...units.values()].filter((entry) => {
      const receipt = entry.booking?.receipt
      // A reconciled receipt releases the reservation (0287): the ledger's
      // claim on the unit ended — the scope it fenced is free.
      return entry.scope !== undefined && !(receipt?.kind === "landed" && (receipt.closeCommit || receipt.parked || receipt.closed === "person")) && receipt?.kind !== "reconciled"
    })
  }

  // The dead-letter completion derivation (0287): does the durable record
  // already read this lease's unit closed? Task-shaped units (execute,
  // verify, fix, formulate, synthesize, audit — and their fix rounds) key on
  // the phase's task index, the row's tick (the driver's close-out or the
  // person's amendment, 0274 — P3's own parenthetical: a unit a person
  // closed is done). The boundary's unit is phase-shaped (0277, distill) and
  // keys on the phases index instead: the person advanced the boundary. Both
  // reads are the standing derivations' own (readExecutorParkPlan,
  // readPhases) — re-derived from disk every sweep, nothing persisted beside
  // the booking itself (P6).
  async function unitCompleted(unit: string, kind: Grant["kind"]): Promise<boolean> {
    if (kind === "distill") {
      const state = await readPhases(dir).catch(() => undefined)
      return state?.done.has(unit.split(".")[1] ?? unit) === true
    }
    const plan = await readExecutorParkPlan(dir)
    return plan?.tasks.some((task) => task.id === unit && task.status === "done") === true
  }

  // The dead-letter sweep (0287, 0285's measured deadlock): a lease that
  // died without a report — expired or released, never booked — over a unit
  // the record closed strands the lane: no holder identity exists to report
  // or release it, every route trusts the ledger over the index, and the
  // reservation fences the scope until a settlement that can never come. The
  // sweep reconciles the ledger DOWNWARD to the record (P6): it books the
  // entry with the reconciled receipt, one idempotent write every
  // receipt-keyed derivation then reads closed. Live leases are untouched
  // (P12 — their own machinery owns them), and a dead lease whose unit
  // still stands open is the takeover's, not the sweep's — the continuation
  // routing a successor at it is the designed recovery. The person's forced
  // arm (the reconcile operation naming the unit) books a dead lease
  // regardless of completion — the person's terminal act for the states the
  // record cannot evidence (P2: every wedge terminates at a person-reachable
  // act). Each booking logs its finding and provenance (P8), the isolation
  // walk's amendment line its precedent.
  // 0290 F2's fix 0292 — the booked non-landing receipt joins the class: a
  // booked `without-landing` (a settled report that landed nothing — the
  // field's zero-write replays) over a unit the record completes holds the
  // same pin (neither landed nor reconciled, the continuation arm routes at
  // it, the reservation fences on), and 0287's channels enumerated only the
  // unbooked dead letter — the recorded residual, its field record standing.
  // The same two arms reach it: the record's completion books it
  // `person-completion` at the head of every wire act (the prior booking's
  // outcome and reason preserved in the re-booking's note — the ledger's
  // claim reconciled downward, never history rewritten), and the forced arm
  // books it by name for the record-blind shapes. Every other booked
  // receipt is another mechanism's (P12 — a landed share is history, a
  // pending report the settlement's, a blocked receipt 0287's standing
  // residual), and a pending settlement is never the sweep's.
  // The sweep's bookings this coordinator session, in order — the reconcile
  // operation drains the buffer so its answer carries every line the sweep
  // booked during the call (the serialize head's included), never a stale
  // repeat.
  let reconciliationLines: string[] = []

  async function reconcileDeadLetters(at: number, forced?: string): Promise<string[]> {
    const lines: string[] = []
    const completed = new Map<string, boolean>()
    const recordCloses = async (unit: string, kind: Grant["kind"]) => {
      if (!completed.has(unit)) completed.set(unit, await unitCompleted(unit, kind))
      return completed.get(unit)
    }
    for (const entry of entries) {
      const booking = entry.booking
      const reason = booking?.receipt?.kind === "without-landing" ? booking.receipt.reason : undefined
      const dead = !booking && !live(entry, at)
      // The sweep's two classes — 0287's unbooked dead letter and 0292's
      // booked without-landing receipt; live leases (no booking, deadline
      // standing) and every other booked receipt stay outside. Both arms
      // below reach both classes: the forced arm by name, the automatic
      // arm through the record's completion.
      if (!dead && reason === undefined) continue
      const named = forced !== undefined && entry.grant.unit === forced
      if (!named && !(await recordCloses(entry.grant.unit, entry.grant.kind))) continue
      const by: ReconciledReceipt["by"] = named ? "person-reconcile" : "person-completion"
      const note = named ? "reconciled: the person's reconcile operation named the unit" : "reconciled: the unit reads done in the durable record"
      await book(entry, reason !== undefined
        ? { ...booking!, note: `${note} (over a without-landing share: ${reason})`, receipt: { kind: "reconciled", by } }
        : { outcome: "ended", note, receipt: { kind: "reconciled", by } })
      const line = reason !== undefined
        ? `ℹ reconciled the booked share ${entry.grant.id} on ${entry.grant.unit} — ${named ? "the person's reconcile operation named the unit" : "the unit reads done in the durable record (the person's completion)"}; the never-landed receipt (${reason}) stays noted`
        : `ℹ reconciled the dead lease ${entry.grant.id} on ${entry.grant.unit} — ${named ? "the person's reconcile operation named the unit" : "the unit reads done in the durable record (the person's completion)"}; the never-reported share stays unbooked`
      lines.push(line)
      reconciliationLines.push(line)
      log(line)
    }
    return lines
  }

  // The continuation re-derivation (0289, 0286 F2's re-measured fix): a
  // landed receipt carrying the continuation flag — the holder's own
  // `Status: continue` handoff statement — routes every follow-up arm as
  // "more work remains": the verify arm declines (the producer walk excludes
  // continuations), the menu letters execute, and a fresh claim re-grants the
  // next exec ordinal (the field's `T-064 exec 2` — the commissioning
  // session's flag on a unit whose work stood whole, the record's own bytes
  // the discriminator: a plain landed share routes its verify in both tiers,
  // the flag alone strands it). The flag is derived state over the handoff's
  // committed bytes (P6), and the person's two document channels correct it:
  // amending the handoff's Status line — the flag strips, the plain-landed
  // routing takes over, the verify share follows — or completing the unit
  // (0274's marks): the re-booking adds the additive `closed: "person"`
  // facet, the fence releases, the claim ends, no verify over a person-closed
  // unit (P3). Only the unit's latest landed entry's flag routes (the
  // priorHandoff read's own findLast position — 0290 F1's shadow: dead or
  // booked non-landing tails shadow nothing, a later landed entry still
  // shields the older flag as routing-dead); a handoff that still reads
  // continue over an open unit holds the designed continuation (the floor,
  // pinned by the standing suite); live leases are never touched (P12);
  // each re-booking logs its finding and provenance (P8).
  async function reconcileContinuations(): Promise<string[]> {
    const lines: string[] = []
    for (const entry of entries) {
      const booking = entry.booking
      const receipt = booking?.receipt
      if (receipt?.kind !== "landed" || !receipt.continuation || booking?.outcome !== "ended") continue
      if (lastLanded(entry.grant.unit) !== entry) continue
      if (await unitCompleted(entry.grant.unit, entry.grant.kind)) {
        await book(entry, { ...booking, receipt: { ...receipt, continuation: undefined, closed: "person" } })
        const line = `ℹ re-derived ${entry.grant.id} on ${entry.grant.unit} — the unit reads done in the durable record (the person's completion); the continuation claim ended, the unit closed without a verify share`
        lines.push(line)
        reconciliationLines.push(line)
        log(line)
        continue
      }
      const { handoff } = taskDocPaths(entry.grant.unit)
      const text = await gitRead(dir, "show", `HEAD:${handoff}`).catch(() => "")
      if (handoffStatus(text) === "continue") continue
      await book(entry, { ...booking, receipt: { ...receipt, continuation: undefined } })
      const line = `ℹ re-derived ${entry.grant.id} on ${entry.grant.unit} — the amended handoff no longer reads a continue status (the person's act); the share's work stands whole and the verification follows`
      lines.push(line)
      reconciliationLines.push(line)
      log(line)
    }
    return lines
  }

  // The isolation walk's one home (0274, 0264-03's fix — 0132 D2's
  // sealedChannelCheck person-amendment class mirrored into the isolation
  // walk 0253 ruled): every commit on the walked first-parent chain since
  // the booked base must be a settled coordinator write — a booked share,
  // close or landing, exactly as the `known` table records it — or a
  // **person amendment**: a plain (non-merge) commit whose message's trailer
  // block carries no driver stage (`driverStage` — the wall's own
  // classifier; every road the coordinator commits through stamps
  // `Auto-Stage`, the person's direct commits never do). An amendment is
  // logged (the line at the exit, P8 — a finding that teaches what it saw,
  // never a block) and the walk continues past it — the anchor re-based
  // over the person's commit, the lane unwedged (P2: the person's acts are
  // legitimate; P20: in-flight work kept). Everything else still blocks
  // conservatively (P12): a commit in the driver's grammar the walk did not
  // book (a share outside this ledger, a forged trailer) is terminal
  // divergence, a merge is structure the walk cannot read (a booked landing
  // alone passes as one), and an unreadable history fails the walk. Returns
  // the amendments passed (short shas; [] over the exactly-booked chain),
  // undefined on divergence — the callers' blocked answers byte-identical
  // to the pre-class walk.
  async function settledChain(at: string, base: string, head: string): Promise<string[] | undefined> {
    if (base === head) return []
    const known = new Map<string, boolean>()
    for (const { booking, worktree } of entries) {
      const receipt = booking?.receipt
      if (receipt?.kind === "landed") {
        if (!worktree) known.set(receipt.commit, false)
        if (receipt.closeCommit) known.set(receipt.closeCommit, false)
        if (receipt.landingCommit) known.set(receipt.landingCommit, true)
      }
    }
    const read = await git(at, ["rev-list", "--first-parent", "--parents", `${base}..${head}`])
    if (read.code !== 0) return undefined
    const links = read.out.trim().split("\n")
    const amendments: string[] = []
    let current = head
    for (const link of links) {
      const [commit, parent, merge, extra] = link.split(" ")
      if (commit !== current || !parent || extra) return undefined
      if (known.get(commit) !== Boolean(merge)) {
        // The class's bound: the person's own plain commits only. A merge
        // rides a second parent's whole history — unreadable structure; and
        // a commit carrying the driver's stage grammar outside the ledger
        // is driver-family divergence, never the person's act.
        const body = merge ? undefined : await git(at, ["show", "-s", "--format=%B", commit])
        if (body === undefined || body.code !== 0 || driverStage(body.out) !== undefined) return undefined
        amendments.push(commit.slice(0, 7))
      }
      current = parent
    }
    if (current !== base) return undefined
    if (amendments.length) {
      log(
        `ℹ the isolation walk passed ${amendments.length} person amendment(s) since ${base.slice(0, 7)} (${amendments.join(", ")}) — ` +
          `commit(s) with no driver stage trailer, the person's direct acts; review them: git log --oneline ${base.slice(0, 7)}..${head.slice(0, 7)}`,
      )
    }
    return amendments
  }

  // Every intervening commit must be a settled coordinator write or a
  // bounded person amendment (0274). A ref rewrite, merge, a driver-grammar
  // commit outside the ledger, or a neighbor with an unsettled result may
  // not be used to move a lease's landing baseline.
  async function knownHead(base: string, head: string): Promise<boolean> {
    return (await settledChain(dir, base, head)) !== undefined
  }

  function siblingDirt(unit: string, path: string, status: string): boolean {
    return (status === "??" || status[0] === " ") &&
      reserved().some((sibling) => !sibling.worktree && sibling.grant.unit !== unit && permitted(sibling, path))
  }

  function reportedChanges(entry: Entry, rows: NonNullable<Awaited<ReturnType<typeof statusEntriesRead>>>) {
    return rows.filter(({ rel, status }) =>
      !(status === "??" && workdirEntry(rel)) && !(entry.scope && !entry.worktree && siblingDirt(entry.grant.unit, rel, status)))
  }

  // The report settlement's own body (0272 renames it settleShare): the
  // blocked causes are classified at their sites — outsidePerimeter where
  // the remedy is a write no grant kind can make, the plain blocked()
  // where the holder's own remedy stands — and the settle() wrapper below
  // is the one wire boundary that reads the classification.
  async function settleShare(entry: Entry, booking: EndedBooking): Promise<Receipt | SettlementBlocked> {
    if (booking.close) return closeVerified(entry, booking, booking.close)
    const finishShare = async (commit: string, evidence: NonNullable<EndedBooking["intent"]>) => {
      let landingCommit: string | undefined
      const { worktree, grant } = entry
      if (worktree && (evidence.park || evidence.verdict === "pass")) {
        if (!booking.landing) {
          let landing: ExecutorLanding
          try {
            landing = await prepareExecutorLanding(dir, commit)
          } catch (error) {
            return outsidePerimeter(workspaceBlock(error))
          }
          if (!await knownHead(worktree.start, landing.parent)) {
            return outsidePerimeter(blocked("Main HEAD moved outside the executor's settled shares. Inspect the retained lane before retrying."))
          }
          booking = { ...booking, landing }
          entry = await book(entry, booking)
          checkpoint?.("landing-booked")
        }
        try {
          landingCommit = await landExecutorWorkspace(dir, worktree, { id: grant.unit, title: grant.title }, booking.landing!)
        } catch (error) {
          return outsidePerimeter(workspaceBlock(error))
        }
        checkpoint?.("lane-landed")
      }
      if (evidence.park) {
        const { blocker, previous } = evidence.park
        const recorded = await runtimeParked(dir, entry.grant.unit)
        if (recorded !== blocker) {
          if (recorded !== previous) return outsidePerimeter(blocked("The dependency park record changed outside the booked share."))
          await setParked(dir, entry.grant.unit, blocker)
          checkpoint?.("park-recorded")
        }
        if (worktree) {
          try {
            await removeExecutorWorkspace(dir, worktree, commit)
          } catch (error) {
            return outsidePerimeter(workspaceBlock(error))
          }
        }
        return finish({ kind: "landed", commit, parked: blocker, ...(landingCommit && { landingCommit }) })
      }
      if (evidence.verdict !== "pass") {
        const { verdict, gapCount, continuation } = evidence
        return finish({
          kind: "landed", commit, ...(verdict && { verdict }), ...(gapCount && { gapCount }), ...(continuation && { continuation }),
        })
      }
      const close = landingCommit ? { share: landingCommit, sourceShare: commit } : { share: commit }
      const closing = { ...booking, close }
      return closeVerified(await book(entry, closing), closing, close)
    }
    const finish = async (receipt: Receipt) => {
      await book(entry, { ...booking, receipt })
      return receipt
    }
    const blocked = (detail: string): BlockedReport => ({ kind: "blocked", reason: "isolation", detail })
    if (booking.landing && booking.intent) {
      const { share } = booking.landing
      const witness = await gitRead(dir, "show", "-s", "--format=%P%n%T%n%B", share)
      if (witness !== `${booking.parent ?? entry.base}\n${booking.intent.tree}\n${shareMessage(entry.grant, !!booking.intent.park)}`) {
        return outsidePerimeter(blocked("The lane share no longer matches the booked landing."))
      }
      return finishShare(share, booking.intent)
    }
    const checkout = await openCheckout(entry)
    if (typeof checkout !== "string") return outsidePerimeter(checkout)
    const { grant } = entry
    const head = await gitRead(checkout, "rev-parse", "HEAD")
    const base = booking.parent ?? (entry.scope && !entry.worktree ? head : entry.base)
    // The synthesize settlement (0281): the holder's deliverable is its
    // REPLY at the unit's todo path (the one write surface the fence
    // admits), never a session share — the landing is the construction
    // commit itself. The branch precedes the generic head-mismatch check
    // because the construction commit IS the legitimate head move.
    if (grant.kind === "synthesize") return settleSynthesis(entry, booking, checkout, head, base)
    if (head !== base) {
      const witness = await gitRead(checkout, "show", "-s", "--format=%P%n%T%n%B", head)
      if (booking.intent && witness === `${base}\n${booking.intent.tree}\n${shareMessage(grant, !!booking.intent.park)}` &&
          await nestedWitnesses(checkout, grant, booking.intent)) {
        return finishShare(head, booking.intent)
      }
      return outsidePerimeter(blocked("HEAD moved outside the booked share. Inspect the commit and executor progress before resuming."))
    }
    if (entry.scope && !entry.worktree && !await knownHead(entry.base, base)) {
      return outsidePerimeter(blocked("HEAD moved outside the executor's settled shares."))
    }

    const roots = await repoRoots(checkout)
    // A lane worktree lands as one commit on the main tree, so a repository
    // created inside the lane cannot ride its landing (0258 — the one root
    // check the findings adjudicate legitimate). The main tree settles root
    // by root instead, nested first — the posture the push path's unified
    // commit already carries (0073).
    if (entry.worktree?.established && (roots.length !== 1 || roots[0] !== checkout)) {
      return blocked("The executor requires a single repository inside a lane checkout.")
    }
    let status = await workspaceStatus(checkout, roots)
    if (!status) return outsidePerimeter({ kind: "blocked", reason: "commitFailed", detail: "Git status is unreadable. Inspect the index before replaying." })
    const { gaps, handoff } = taskDocPaths(grant.unit)
    let changes = [...reportedChanges(entry, status), ...await ignoredArtifactRows(checkout, grant, status)]
    const rejected = changes.filter(({ rel, status }) =>
      !permitted(entry, rel) && !(booking.retireGaps && rel === gaps && /^[ D]{2}$/.test(status))
    )
    if (rejected.length) {
      const detail = `Resolve out-of-scope edits before replaying: ${rejected.map(({ rel }) => rel).join(", ")}.`
      return neverSetRows(rejected) ? outsidePerimeter(blocked(detail)) : blocked(detail)
    }
    let continuation: true | undefined
    let park: NonNullable<EndedBooking["intent"]>["park"]
    let artifact: { path: string; text: string } | undefined
    // The handoff-status arm is the task kinds' channel (0277: a distill
    // share's deliverable is the handover document alone — the push
    // distillation is a one-shot bypass session with no Status-line
    // semantics, so the kind never reads a task handoff).
    if (grant.kind !== "verify" && grant.kind !== "distill" && changes.some(({ rel }) => rel === handoff)) {
      const text = await Bun.file(join(checkout, handoff)).text().catch(() => "")
      const blocker = parkDirective(text)
      if (blocker && grant.kind === "execute") {
        const plan = await readExecutorParkPlan(dir)
        const task = plan?.tasks.find(({ id }) => id === grant.unit)
        if (!plan || !task) return blocked("The parked task is outside the current phase.")
        const check = await parkCheck(checkout, plan, task, blocker)
        if (check.type !== "ok") return {
          kind: "blocked", reason: "commitFailed",
          detail: check.type === "foreign" ? `${blocker} is outside this phase's index.` : check.problems.join("; "),
        }
        park = { blocker, previous: task.parked }
        artifact = { path: handoff, text }
      } else {
        const status = handoffStatus(text)
        if (text && (!status || blocker)) {
          return { kind: "blocked", reason: "commitFailed", detail: "The handoff needs a recognized Status line for this step." }
        }
        if (status === "continue") continuation = true
      }
    }
    // The formulation output's collect (0276): grammars alone, before any
    // staging — the share lands only over an index that passes the same
    // mechanical checks the push path's collect enforces. Replayable by
    // classification (every remedy is a write inside the holder's own
    // formulation family), so the plain blocked answer — 0272's ladder, the
    // details themselves teaching the holder's remedy.
    if (grant.kind === "formulate") {
      const problems = await formulationProblems(dir, grant, base)
      if (problems.length) {
        return { kind: "blocked", reason: "commitFailed", detail: `the formulation output is invalid: ${problems.join("; ")}` }
      }
    }
    if (grant.kind === "fix" && !continuation && changes.some(({ rel }) => rel !== gaps)) {
      // The old gap list is already durable in the verification commit. Its
      // removal is a driver effect, booked before mutation, so the reverify
      // turn can write identical FAIL evidence as a genuinely new artifact.
      if (!booking.retireGaps) {
        const original = await git(checkout, ["ls-tree", base, "--", gaps])
        if (original.code !== 0 || !original.out) return outsidePerimeter(blocked("The landed fix input is missing from Git."))
        booking = { ...booking, retireGaps: true }
        entry = await book(entry, booking)
      }
      await rm(join(checkout, gaps), { force: true })
      status = await workspaceStatus(checkout, roots)
      if (!status) return outsidePerimeter({ kind: "blocked", reason: "commitFailed", detail: "Git status is unreadable after retiring the gap list." })
      changes = [...reportedChanges(entry, status), ...await ignoredArtifactRows(checkout, grant, status)]
    }
    const paths = changes.map(({ rel }) => rel)
    if (booking.retireGaps && !paths.some((path) => path !== gaps)) {
      return blocked("The booked fix's changes are missing. Restore them before replaying.")
    }
    let verdict: VerifyVerdict | undefined
    let gapCount: number | undefined
    if (grant.kind === "verify") {
      const { report, gaps } = taskDocPaths(grant.unit)
      const [reportText, gapText] = await Promise.all([
        Bun.file(join(checkout, report)).text().catch(() => ""),
        Bun.file(join(checkout, gaps)).text().catch(() => ""),
      ])
      if (paths.length === 1 && paths[0] === report &&
          parseResult(reportText)?.type === "pass" && docShapeProblems(reportText, report).length === 0) {
        verdict = "pass"
        artifact = { path: report, text: reportText }
      } else if (paths.length === 1 && paths[0] === gaps && !reportText.trim() &&
          parseResult(gapText)?.type === "fail" && /^### Gap\b/m.test(gapText)) {
        verdict = "fail"
        artifact = { path: gaps, text: gapText }
        gapCount = gapText.split("\n").filter((line) => /^### Gap\b/.test(line)).length
      } else {
        return { kind: "blocked", reason: "commitFailed", detail: "Verification must write one valid PASS report or one countable FAIL gap list." }
      }
    }
    if (!paths.length) {
      if (booking.intent) return blocked("The booked share's changes are missing. Restore them before replaying.")
      return finish({ kind: "without-landing", reason: "zero-write" })
    }
    // The distillation output's collect (0277): grammars alone, ahead of any
    // staging and past the zero-write answer (a share that wrote nothing has
    // no output to judge — the formulate precedent's zero-write floor). The
    // share lands only over a handover document that passes the same
    // mechanical checks the push collect enforces; replayable by
    // classification (the holder's remedy is rewriting its own document),
    // the plain blocked answer — 0272's ladder.
    if (grant.kind === "distill") {
      const problems = await distillationProblems(checkout, grant)
      if (problems.length) {
        return { kind: "blocked", reason: "commitFailed", detail: `the handover distillation is invalid: ${problems.join("; ")}` }
      }
    }
    // The audit output's collect (0278): grammars alone, in the distill
    // placement — past the zero-write answer (a share that wrote nothing
    // has no adjudication to judge) and ahead of any staging. The share
    // lands whatever the verdict (the no-fix rule: a FAIL finding is the
    // person's, routed at the round's close, never a repair input here);
    // replayable by classification (the holder's remedy is rewriting its
    // own document), the plain blocked answer — 0272's ladder.
    if (grant.kind === "audit") {
      const problems = await auditProblems(checkout, grant)
      if (problems.length) {
        return { kind: "blocked", reason: "commitFailed", detail: `the close-audit findings are invalid: ${problems.join("; ")}` }
      }
    }

    // Stage and prove every repository root that carries observed changes
    // (0258): each root stages its own rows and the staged set must name
    // exactly the rows observed there — the single-root settlement's
    // complete-staged-set proof, per root. Nested roots commit deepest-first
    // beneath the top repository's share (repoRoots' order, the unified
    // commit's own — 0073), which alone the booking's tree witnesses.
    const bookedRoots = booking.intent?.nested ?? []
    const claimedRows = new Set(changes.map(({ rel }) => rel))
    const shares: { root: string; prefix: string; base: string; tree: string; staged: string[] }[] = []
    for (const root of roots) {
      const prefix = relative(checkout, root).replaceAll("\\", "/")
      const rows = changes.filter(({ rel }) => claimedRows.has(rel) && (prefix === "" || rel.startsWith(`${prefix}/`)))
      for (const { rel } of rows) claimedRows.delete(rel)
      if (!rows.length) continue
      const rootBase = root === checkout ? base : await headOf(root)
      const literal = ({ rel }: { rel: string }) => `:(literal)${prefix ? rel.slice(prefix.length + 1) : rel}`
      const stage = rows.filter(({ status }) => status[1] !== " " && status !== "!!").map(literal)
      const shadowed = rows.filter(({ status }) => status === "!!").map(literal)
      if (stage.length) await gitRead(root, "add", "-A", "--", ...stage)
      if (shadowed.length) await gitRead(root, "add", "-f", "--", ...shadowed)
      const rootTree = await gitRead(root, "write-tree")
      const diff = await git(root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", rootBase || EMPTY_TREE, rootTree])
      const staged = diff.out.split("\0").filter(Boolean)
      const observed = new Set(rows.map(({ rel }) => (prefix ? rel.slice(prefix.length + 1) : rel)))
      if (diff.code !== 0 || staged.some((path) => !observed.has(path) ||
          (!permitted(entry, prefix ? `${prefix}/${path}` : path) && !(booking.retireGaps && prefix === "" && path === gaps)))) {
        return outsidePerimeter(blocked("The staged tree contains an unverified path. Inspect the index before replaying."))
      }
      if (root !== checkout) {
        const record = bookedRoots.find((item) => item.root === prefix)
        if (booking.intent && (!record || record.base !== rootBase || record.tree !== rootTree)) {
          return blocked("The workspace no longer matches the booked share. Restore its contents before replaying.")
        }
      }
      shares.push({ root, prefix, base: rootBase, tree: rootTree, staged })
    }
    const top = shares.find((share) => share.root === checkout)
    if (!top) {
      if (booking.intent) return blocked("The booked share's changes are missing. Restore them before replaying.")
      return blocked("The share's landing anchors the target repository's own commit; a settlement that changes only nested repositories cannot witness one. Include a top-repository path such as the unit's handoff.")
    }
    const tree = top.tree
    for (const record of bookedRoots) {
      if (shares.some((share) => share.prefix === record.root)) continue
      // A booked nested root with no observed rows at replay: its commit
      // must already sit witnessed at the root's HEAD, else its booked
      // changes vanished (0258).
      const root = join(checkout, record.root)
      const head = await headOf(root)
      const witness = head ? await gitRead(root, "show", "-s", "--format=%P%n%T%n%B", head) : ""
      const messageText = shareMessage(grant, !!booking.intent?.park)
      const expected = record.base ? `${record.base}\n${record.tree}\n${messageText}` : `${record.tree}\n${messageText}`
      if (head === record.base || witness !== expected) {
        return blocked("The booked share's changes are missing. Restore them before replaying.")
      }
    }
    if (booking.intent && (tree !== booking.intent.tree || verdict !== booking.intent.verdict || gapCount !== booking.intent.gapCount || continuation !== booking.intent.continuation || park?.blocker !== booking.intent.park?.blocker || park?.previous !== booking.intent.park?.previous)) {
      return blocked("The workspace no longer matches the booked share. Restore its contents before replaying.")
    }
    if (booking.retireGaps) {
      const retired = await git(checkout, ["ls-tree", tree, "--", gaps])
      const work = shares.some((share) => share.staged.some((path) => share.root !== checkout || path !== gaps))
      if (retired.code !== 0 || retired.out || !work) {
        return blocked("The staged fix must include work and retire the previous gap list.")
      }
    }
    if (artifact) {
      const stagedArtifact = await git(checkout, ["show", `${tree}:${artifact.path}`])
      if (stagedArtifact.code !== 0 || !sameDocument(stagedArtifact.out, artifact.text)) {
        return blocked("The staged verdict or handoff differs from the evidence read on disk.")
      }
    }
    if (!top.staged.length) return finish({ kind: "without-landing", reason: "zero-write" })
    const nestedEvidence = shares.filter((share) => share.root !== checkout).map(({ prefix, base, tree }) => ({ root: prefix, base, tree }))
    const evidence: NonNullable<EndedBooking["intent"]> = { tree, verdict, gapCount, continuation, park, ...(nestedEvidence.length ? { nested: nestedEvidence } : {}) }
    if (!booking.intent) {
      booking = { ...booking, parent: base, intent: evidence }
      entry = await book(entry, booking)
    }
    // Verify the complete staged set before the hooked commit, then prove the
    // resulting parent, tree, and operation identity before recording success.
    const commitMessage = shareMessage(grant, !!park)
    for (const share of shares) {
      const specs = share.staged.map((path) => `:(literal)${path}`)
      const committed = await git(share.root, [...await identityArgs(share.root), "commit", "-m", commitMessage, "--", ...specs])
      if (committed.code !== 0) {
        return { kind: "blocked", reason: "commitFailed", detail: committed.err.trim() || committed.out.trim() }
      }
      if (share.root !== checkout) checkpoint?.("nested-committed")
    }
    checkpoint?.("committed")
    let landed = ""
    for (const share of shares) {
      const head = await headOf(share.root)
      // gitRead trims its output, so a session-created root's parentless
      // first commit compares without the leading blank line (0258).
      const witness = head ? await gitRead(share.root, "show", "-s", "--format=%P%n%T%n%B", head) : ""
      const expected = share.base ? `${share.base}\n${share.tree}\n${commitMessage}` : `${share.tree}\n${commitMessage}`
      if (!head || witness !== expected) {
        return outsidePerimeter(blocked("The new commit differs from the booked share. Inspect Git history before resuming."))
      }
      if (share.root === checkout) landed = head
    }
    return finishShare(landed, evidence)
  }

  // The synthesize share's settlement (0281): the push constructor
  // one-shot's mechanical ladder, judged here over the reply channel —
  // parse (the strict delimiters), validate (checkSynthesisReply: the
  // ledger grammar, the seeded sequence, the quote anchoring — the same
  // checks the push loop ran, one home), compose (renderFormulationTodo's
  // synthesis shape, the guarantee gate's throw a blocked problem — the
  // push's retry cause is the holder's remedy), land (the driver restores
  // the channel to the booked floor, then constructFormulation writes and
  // commits the composed todo under the phase-synthesize stage). Every
  // problem is replayable (the holder rewrites its reply, a write inside
  // its own one admitted path), so the plain blocked answer — 0272's
  // ladder, the details teaching the remedy. The crash windows: a
  // construction already landed books the same commit (the witness below);
  // a crash between the restore and the commit voids the attempt honestly
  // (the zero-write floor, the floor standing again for a fresh claim).
  async function settleSynthesis(entry: Entry, booking: EndedBooking, checkout: string, head: string, base: string): Promise<Receipt | SettlementBlocked> {
    const { grant } = entry
    const finish = async (receipt: Receipt) => {
      await book(entry, { ...booking, receipt })
      return receipt
    }
    const blocked = (detail: string): BlockedReport => ({ kind: "blocked", reason: "commitFailed", detail })
    const todo = taskStatePaths(grant.unit).pending
    // A prior settlement's construction already landed: the witness is the
    // commit's own shape — the booked parent beside the construction's
    // subject and stage (nothing else commits between the report and the
    // replay; the coordinator holds the lock).
    if (head !== base) {
      const witness = await gitRead(checkout, "show", "-s", "--format=%P%n%B", head)
      // The witness shape: the parent line first (`%P`), the body (`%B`)
      // opening with the construction's own subject.
      const subject = witness.split("\n")[1] ?? ""
      if (!witness.startsWith(`${base}\n`) || driverStage(witness) !== "phase-synthesize" || !subject.startsWith("PLAN formulate")) {
        return outsidePerimeter(blocked("HEAD moved outside the booked synthesis construction."))
      }
      return finish({ kind: "landed", commit: head })
    }
    // Out-of-scope edits beside the reply channel refuse exactly as the
    // standing settlement does (the fence admits only the todo path).
    const status = await workspaceStatus(checkout)
    if (!status) return outsidePerimeter({ kind: "blocked", reason: "commitFailed", detail: "Git status is unreadable. Inspect the index before replaying." })
    const dirt = status.filter(({ rel, status: row }) => !(row === "??" && workdirEntry(rel)))
    const rejected = dirt.filter(({ rel }) => rel !== todo)
    if (rejected.length) {
      const detail = `Resolve out-of-scope edits before replaying: ${rejected.map(({ rel }) => rel).join(", ")}.`
      const report: BlockedReport = { kind: "blocked", reason: "isolation", detail }
      return neverSetRows(rejected) ? outsidePerimeter(report) : report
    }
    if (!dirt.some(({ rel }) => rel === todo)) return finish({ kind: "without-landing", reason: "zero-write" })
    // The reply, read off the channel before anything touches it.
    const replyText = await Bun.file(join(checkout, todo)).text().catch(() => undefined)
    if (replyText === undefined) return blocked(`The reply is missing: rewrite ${todo} with the prescribed reply shape, then re-report.`)
    // The landing's first act restores the channel to the booked floor —
    // the session's write is the channel, never the document, and every
    // derivation below (the assembly, the plan loads) reads the clean
    // tree — then the reply is parsed, validated through the shared
    // derivation and composed; the standing construction path commits the
    // composed todo under the phase-synthesize stage. A crash between the
    // restore and the commit voids the attempt honestly (the zero-write
    // floor; the floor stands again for a fresh claim).
    const restore = await git(checkout, ["restore", "--source", base, "--", `:(literal)${todo}`])
    if (restore.code !== 0) return blocked(restore.err.trim() || "The reply channel could not be restored to the booked floor.")
    const composed = await composeSynthesizedTodo(checkout, replyText)
    if (composed.kind === "problems") {
      return blocked(`the synthesis reply is invalid: ${composed.problems.join("; ")} — rewrite the reply at ${todo} in the exact prescribed shape, fixing exactly these findings`)
    }
    const construction = composed.construction
    const landedDoc = await constructFormulation(checkout, construction.phase, construction.todo, construction.record)
    if (landedDoc.type === "dirty" || landedDoc.type === "unreadable") {
      return blocked(`the construction's entry gate refused: ${landedDoc.files.join(", ")}`)
    }
    if (landedDoc.type === "failed") {
      // The construction left its write in the worktree; restore the floor
      // so the next attempt starts clean (the reply is consumed either
      // way — a fresh claim re-runs the session over the standing floor).
      await git(checkout, ["restore", "--source", base, "--", `:(literal)${todo}`]).catch(() => undefined)
      return blocked(landedDoc.question)
    }
    const commit = await gitRead(checkout, "rev-parse", "HEAD")
    return finish({ kind: "landed", commit })
  }

  async function closeVerified(entry: Entry, booking: EndedBooking, intent: CloseIntent): Promise<Receipt | SettlementBlocked> {
    const grant = entry.grant
    const block = (detail: string): BlockedReport => ({ kind: "blocked", reason: "isolation", detail })
    if (grant.kind !== "verify") return outsidePerimeter(block("A close-out has no verification grant."))
    const { unit, index } = grant
    const { pending, complete } = taskStatePaths(unit)
    const { gaps } = taskDocPaths(unit)
    const paths = new Set([pending, complete, index])
    const commitMessage = message(`${unit} done`, { id: unit }, "done", [], `Executor close ${grant.lease}`)
    const finish = async (closeCommit: string): Promise<Receipt> => {
      if (entry.worktree && intent.sourceShare) {
        try {
          await removeExecutorWorkspace(dir, entry.worktree, intent.sourceShare)
        } catch (error) {
          return outsidePerimeter(workspaceBlock(error))
        }
      }
      const receipt = {
        kind: "landed", commit: intent.sourceShare ?? intent.share, verdict: "pass", closeCommit,
        ...(intent.sourceShare && { landingCommit: intent.share }),
      } as const
      await book(entry, { ...booking, receipt })
      return receipt
    }
    const head = await gitRead(dir, "rev-parse", "HEAD")
    if (head !== intent.share) {
      const witness = await gitRead(dir, "show", "-s", "--format=%P%n%T%n%B", head)
      if (intent.tree && witness === `${intent.share}\n${intent.tree}\n${commitMessage}`) return finish(head)
      return outsidePerimeter(block("HEAD moved outside the booked task close-out."))
    }
    const [todo, oldIndex, oldGaps, status] = await Promise.all([
      git(dir, ["show", `${intent.share}:${pending}`]),
      git(dir, ["show", `${intent.share}:${index}`]),
      git(dir, ["show", `${intent.share}:${gaps}`]),
      workspaceStatus(dir),
    ])
    if (oldGaps.code === 0) paths.add(gaps)
    const unexpected = status ? reportedChanges(entry, status).filter(({ rel }) => !paths.has(rel)) : []
    if (todo.code !== 0 || oldIndex.code !== 0 || !status || unexpected.length) {
      const detail = "Inspect unexpected workspace changes before replaying task close-out."
      return neverSetRows(unexpected) ? outsidePerimeter(block(detail)) : block(detail)
    }

    const [pendingText, doneText, indexText, gapText] = await Promise.all(
      [pending, complete, index, gaps].map((path) => readFile(join(dir, path), "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
        return undefined
      })),
    )
    const nextIndex = tickedIndex(oldIndex.out, unit)
    const validUnit = (sameDocument(pendingText, todo.out) && doneText === undefined) ||
      (pendingText === undefined && sameDocument(doneText, todo.out))
    if ((gapText !== undefined && (oldGaps.code !== 0 || !sameDocument(gapText, oldGaps.out))) || !validUnit || nextIndex === oldIndex.out || (!sameDocument(indexText, oldIndex.out) && !sameDocument(indexText, nextIndex))) {
      return outsidePerimeter(block("The task documents no longer match the close-out's before or after state."))
    }

    // Post the tick atomically before markDone's idempotent rename and
    // runtime cleanup. Both the original and ticked index are replayable.
    if (indexText !== undefined && !sameDocument(indexText, nextIndex)) {
      const indexFile = join(dir, index)
      await replaceFile(indexFile, tickedIndex(indexText, unit), (await stat(indexFile)).mode & 0o777, file,
        () => checkpoint?.("close-index-written"))
    }
    await markDone({ dir, index }, unit)
    if (oldGaps.code === 0) await rm(join(dir, gaps), { force: true })
    checkpoint?.("closed-files")
    const changed = await workspaceStatus(dir)
    const appeared = changed ? reportedChanges(entry, changed).filter(({ rel }) => !paths.has(rel)) : []
    if (!changed || appeared.length) {
      const detail = "Unexpected workspace changes appeared during task close-out."
      return neverSetRows(appeared) ? outsidePerimeter(block(detail)) : block(detail)
    }
    const prepare = changed.filter(({ rel, status }) => paths.has(rel) && status[1] !== " ").map(({ rel }) => `:(literal)${rel}`)
    if (prepare.length) await gitRead(dir, "add", "-A", "--", ...prepare)
    const tree = await gitRead(dir, "write-tree")
    const diff = await git(dir, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", head, tree])
    const staged = diff.out.split("\0").filter(Boolean)
    if (diff.code !== 0 || staged.length !== paths.size || staged.some((path) => !paths.has(path)) ||
        (intent.tree && intent.tree !== tree)) {
      return outsidePerimeter(block("The staged task close-out differs from the expected rename and tick."))
    }
    const [stagedDoc, stagedIndex, stagedGaps] = await Promise.all([
      git(dir, ["show", `${tree}:${complete}`]),
      git(dir, ["show", `${tree}:${index}`]),
      git(dir, ["ls-tree", `${tree}`, "--", gaps]),
    ])
    if (stagedGaps.code !== 0 || stagedGaps.out || stagedDoc.code !== 0 || !sameDocument(stagedDoc.out, todo.out) || stagedIndex.code !== 0 || !sameDocument(stagedIndex.out, nextIndex)) {
      return outsidePerimeter(block("The staged task documents differ from the expected rename and tick."))
    }
    if (!intent.tree) {
      booking = { ...booking, close: { ...intent, tree } }
      entry = await book(entry, booking)
    }
    const commit = await git(dir, [...await identityArgs(dir), "commit", "-m", commitMessage, "--", ...staged.map((path) => `:(literal)${path}`)])
    if (commit.code !== 0) return { kind: "blocked", reason: "commitFailed", detail: commit.err.trim() || commit.out.trim() }
    checkpoint?.("closed-commit")
    const landed = await gitRead(dir, "rev-parse", "HEAD")
    const witness = await gitRead(dir, "show", "-s", "--format=%P%n%T%n%B", landed)
    if (witness !== `${intent.share}\n${tree}\n${commitMessage}`) return outsidePerimeter(block("The task close-out commit differs from its booked changes."))
    return finish(landed)
  }

  // The pending-question dedup key's one home (0250's letter; 0272 names
  // it): an unanswered question of the same asker, task and exact text —
  // the holder's own `question` route and the settlement's raise both read
  // this predicate, so a retrying holder's repeated blocked reports and a
  // re-raised settlement answer ride one item while it is pending.
  // The settlement's one wire boundary (0272, amended by 0282's no-ask-channel
  // ruling): both the report route and a successor claim's settlement replay
  // pass through here. The escalation question is gone — the plain `blocked`
  // answer with its remedy is the whole surface, the round waiting until a
  // person looks at the state (the honest cost the order accepts, P2 keeping
  // the person's bracket on documents and ops). The classification's marker
  // still names the person-necessary causes in the detail — the teaching
  // stays, the channel does not.
  async function settle(entry: Entry, booking: EndedBooking): Promise<Receipt> {
    void entry
    const receipt = await settleShare(entry, booking)
    if (receipt.kind !== "blocked" || !("escalated" in receipt && receipt.escalated === true)) return receipt
    const { escalated: _, ...report } = receipt
    return { ...report, detail: `${report.detail} The cause is outside this lease's permitted writes — a person must inspect the state; retrying cannot fix it.` }
  }


  function live(entry: Entry, at: number): boolean {
    return !entry.booking && !entry.released && entry.grant.deadline > at
  }

  function leaseWait(entry: Entry): LeaseWait {
    return { kind: "wait", reason: "lease-held", deadline: entry.grant.deadline, detail: `Lease held by channel ${entry.holder.channel || "default"} until ${new Date(entry.grant.deadline).toISOString()}.` }
  }

  function lookup(step: string, lease: string): Entry {
    const entry = entries.find(({ grant }) => grant.id === step && grant.lease === lease)
    if (!entry) throw new ExecutorRequestError("The step and lease pair was never issued.")
    return entry
  }

  function attempts(id: string): number {
    return entries.filter((entry) => entry.grant.id === id && !entry.released).length
  }

  function verifyID(unit: string): string {
    const completed = entries.filter(({ grant, booking }) =>
      grant.unit === unit && grant.kind === "verify" && booking?.receipt?.kind === "landed"
    ).length
    return `${unit} verify ${completed + 1}`
  }

  function stepID(step: Candidate): string {
    if (step.kind === "verify") return verifyID(step.unit)
    if (step.kind === "formulate") return `${step.unit} formulate ${entries.filter(({ grant, booking }) => grant.kind === "formulate" && grant.unit === step.unit && booking?.receipt?.kind === "landed").length + 1}`
    if (step.kind === "synthesize") return `${step.unit} synthesize ${entries.filter(({ grant, booking }) => grant.kind === "synthesize" && grant.unit === step.unit && booking?.receipt?.kind === "landed").length + 1}`
    if (step.kind === "distill") return `${step.unit} distill ${entries.filter(({ grant, booking }) => grant.kind === "distill" && grant.unit === step.unit && booking?.receipt?.kind === "landed").length + 1}`
    if (step.kind === "audit") return `${step.unit} audit ${entries.filter(({ grant, booking }) => grant.kind === "audit" && grant.unit === step.unit && booking?.receipt?.kind === "landed").length + 1}`
    const prefix = step.kind === "fix" ? `${step.unit} fix ${step.round}.` : `${step.unit} exec `
    const completed = entries.filter(({ grant, booking }) => grant.id.startsWith(prefix) && booking?.receipt?.kind === "landed").length
    return `${prefix}${completed + 1}`
  }

  async function preview(at: number, last: Entry | null | undefined = entries.at(-1), task?: string, scoped = false): Promise<Decision> {
    if (last && live(last, at)) return leaseWait(last)
    const previous = last?.booking?.receipt
    // A landed distill receipt is terminal for its unit (0277): no verify
    // share follows the distillation (the boundary's content judgment is the
    // person's — the advance's stop and the phase gates), and no close-out
    // rides the coordinator (the completion rename and tick are the apply,
    // the person's transfer). The unit's claim chain ends at the landing.
    // A person-closed landed receipt (0289) joins the closed unit: the sweep
    // booked the person's completion over the share's continuation — the
    // chain ended at the landing, nothing pends and no verify follows (P3's
    // parenthetical: a unit a person closed is done).
    const closedUnit = previous?.kind === "landed" && (previous.closeCommit !== undefined || previous.closed === "person" || last?.grant.kind === "distill" || last?.grant.kind === "synthesize")
    // A reconciled receipt is neither settlement-pending nor verifiable
    // (0287): the landed arm below already refuses it — its booking asserts
    // no share — so the wait never fires over a reconciliation.
    if (last?.booking && (!previous || (previous.kind === "landed" && !closedUnit && !previous.continuation && !previous.parked))) {
      return { kind: "wait", reason: "in-flight", detail: "The previous share requires settlement or verification." }
    }

    // A failed, expired, or released lease can leave a continuation. Its
    // captured base and scope still govern every retained edit. A formulate
    // share continues like an execute share (0276): its handed-over
    // continuation resumes as the next formulate attempt on the same unit.
    // A distill entry continues the same way (0277): its retained edit — the
    // partial handover document, the family's own write — rides the next
    // attempt on the same phase unit. An audit entry joins them (0278): the
    // audit session is an ordinary whole-task session, its handed-over
    // continuation resuming as the next audit attempt on the same unit.
    if (last && last.grant.kind !== "execute" && last.grant.kind !== "formulate" && last.grant.kind !== "synthesize" && last.grant.kind !== "distill" && last.grant.kind !== "audit" && !closedUnit) {
      return { kind: "wait", reason: "in-flight", detail: "The execute share has advanced to verification." }
    }
    // A reconciled entry is never a continuation (0287): its claim ended —
    // the unbooked-expired-released shapes alone continue (the takeover's
    // designed routing, a successor attempt on the same unit).
    const continuation = last && last.booking?.receipt?.kind !== "landed" && last.booking?.receipt?.kind !== "reconciled" ? last : undefined
    const handedOver = previous?.kind === "landed" && previous.continuation ? last : undefined
    const priorLanded = last && (last.grant.kind === "execute" || last.grant.kind === "formulate" || last.grant.kind === "audit")
      ? entries.findLast(({ grant, booking }) =>
          (grant.kind === "execute" || grant.kind === "formulate" || grant.kind === "audit") && grant.unit === last.grant.unit &&
          booking?.receipt?.kind === "landed"
        )
      : undefined
    const priorHandoff = priorLanded?.booking?.receipt?.kind === "landed" && priorLanded.booking.receipt.continuation ? priorLanded : undefined
    const resumeUnit = (continuation ?? handedOver ?? priorHandoff)?.grant.unit
    const route = task ?? resumeUnit
    const checkout = last && !terminal(last) ? await openCheckout(last) : dir
    if (typeof checkout !== "string") return checkout
    const step = await readExecutorPreview(dir, resumeUnit, route ? { task: route, scoped } : undefined, checkout)
    if (step.kind !== "execute" && step.kind !== "formulate" && step.kind !== "synthesize" && step.kind !== "distill" && step.kind !== "audit") return step
    if (attempts(stepID(step)) >= MAX_ATTEMPTS) {
      return { kind: "blocked", reason: "attemptsExhausted", detail: `${step.unit} has reached the ${MAX_ATTEMPTS}-attempt limit.` }
    }
    // The admission shape (0258): the target directory must itself be a Git
    // work-tree root — the git-anchored settlement posture (P4). Repositories
    // nested under it are workspace surface inherited from the push path
    // (0073's nested-first unified commit), fenced and settled root by root,
    // never an admission criterion.
    const top = await gitRead(dir, "rev-parse", "--show-toplevel")
    if (top !== dir) {
      return { kind: "blocked", reason: "isolation", detail: "The executor requires the target directory to be its own Git work-tree root." }
    }
    const handoff = handedOver ?? priorHandoff
    if (handoff?.grant.unit === step.unit) {
      const status = await workspaceStatus(checkout)
      const head = await gitRead(checkout, "rev-parse", "HEAD")
      const receipt = handoff.booking?.receipt
      if (!status || receipt?.kind !== "landed" || !(scoped && !handoff.worktree ? await knownHead(receipt.commit, head) : (await settledChain(checkout, receipt.commit, head)) !== undefined) ||
          (!continuation && reportedChanges(handoff, status).length > 0)) {
        return { kind: "blocked", reason: "isolation", detail: "The handed-over workspace must still match the landed share." }
      }
      if (entries.filter(({ grant, booking }) => grant.unit === step.unit &&
          booking?.receipt?.kind === "landed" && booking.receipt.continuation).length >= STEER_CHAIN_BOUND) {
        return { kind: "blocked", reason: "attemptsExhausted", detail: "The execution handover chain reached its bound." }
      }
    }
    if (continuation?.grant.unit === step.unit && (!continuation.worktree || continuation.worktree.established)) {
      const status = await workspaceStatus(checkout)
      const head = await gitRead(checkout, "rev-parse", "HEAD")
      if (!status || !(scoped && !continuation.worktree ? await knownHead(continuation.base, head) : (await settledChain(checkout, continuation.base, head)) !== undefined) ||
          reportedChanges(continuation, status).some(({ rel }) => !permitted(continuation, rel))) {
        return { kind: "blocked", reason: "isolation", detail: "The previous attempt's workspace needs inspection before continuation." }
      }
    }
    return step
  }

  async function menu(holder: Holder, at: number): Promise<Menu> {
    const types = executorTypeCatalog()
    // The pending person items (0282's document-derived re-keying): the
    // admission block's own reading of the documents — a human gate names
    // its gate and document; no store, no replay (P6).
    const admission = await readExecutorAdmissionBlock(dir)
    const pending: MenuPending[] = admission?.kind === "human"
      ? [{ kind: "gate", gate: admission.gate, document: admission.document }]
      : []
    const leases = entries.filter((entry) => live(entry, at) && sameHolder(entry.holder, holder))
      .map(({ grant: { id: step, lease, kind, deadline, attempt } }) => ({ step, lease, kind, deadline, attempt }))
    if (leases.length) return { claimable: [], leases, types, pending }
    const claimable: Menu["claimable"] = []
    let held: MenuPending | undefined
    const tasks = await scopeCandidates()
    const decisions = tasks.length
      ? await Promise.all(tasks.map(({ task }) => select(holder, at, undefined, task.id, tasks)))
      : [await select(holder, at)]
    for (const step of decisions) {
      if (step.kind === "execute" || step.kind === "verify" || step.kind === "fix" || step.kind === "formulate" || step.kind === "synthesize" || step.kind === "distill" || step.kind === "audit") {
        claimable.push({
          unit: step.unit,
          title: step.title,
          kinds: [step.kind],
          ...(step.kind !== "verify" && step.kind !== "formulate" && step.kind !== "synthesize" && step.kind !== "distill" && step.kind !== "audit" ? { touches: step.touches } : {}),
        })
      } else if (step.kind === "wait" || step.kind === "blocked") {
        // The held row (0287): the first non-grantable derivation rides the
        // menu when nothing is claimable — the lane's own answer, never a
        // silent empty list.
        const row: MenuPending = step.kind === "wait"
          ? { kind: "wait", reason: step.reason, detail: step.detail }
          : { kind: "blocked", reason: step.reason, detail: step.detail }
        held ??= row
      }
    }
    return { claimable, leases, types, pending: held && !claimable.length ? [...pending, held] : pending }
  }

  function withoutGrant(step: Decision): DerivedStep {
    return step.kind === "execute" || step.kind === "verify" || step.kind === "fix" || step.kind === "formulate" || step.kind === "synthesize" || step.kind === "distill" || step.kind === "audit"
      ? { kind: "wait", reason: "not-ready", detail: `${step.unit} is available for a new claim.` }
      : step
  }

  async function nextWithoutGrant(at: number): Promise<DerivedStep> {
    return withoutGrant(await preview(at))
  }

  function waitForSuccessor(entry: Entry, at: number): LeaseWait | undefined {
    const last = latest(entry.grant.unit)
    if (last && last !== entry && last.grant.id === entry.grant.id && live(last, at)) return leaseWait(last)
  }

  async function verification(holder: Holder, at: number, last: Entry | null | undefined = entries.at(-1)): Promise<DerivedStep | VerificationPreview> {
    if (!last) return nextWithoutGrant(at)
    if (live(last, at)) return leaseWait(last)
    if (last.booking && !last.booking.receipt) return nextWithoutGrant(at)
    if (last.grant.kind === "verify" && last.booking?.receipt?.kind === "landed") {
      return last.booking.receipt.closeCommit
        ? nextWithoutGrant(at)
        : { kind: "wait", reason: "in-flight", detail: "The verification verdict awaits fix routing." }
    }
    if (last.grant.kind !== "verify" && last.booking?.receipt?.kind !== "landed") return nextWithoutGrant(at)
    const producer = entries.findLast((entry) => entry.grant.unit === last.grant.unit && entry.grant.kind !== "verify" && entry.booking?.receipt?.kind === "landed")
    const booking = producer?.booking
    const receipt = booking?.receipt
    // A person-closed producer never verifies (0289): the completion ended the
    // chain — the honest answer is the fresh-claim step, exactly as the
    // distill/synthesize terminal below.
    if (!producer || receipt?.kind !== "landed" || (receipt.continuation || receipt.parked || receipt.closed === "person")) return nextWithoutGrant(at)
    // No verify share over a distillation (0277): the distill producer's
    // landed receipt is terminal — the boundary's content judgment is the
    // person's (the advance's stop and the phase gates), the wrap-up brief
    // the verify kind renders is task-shaped and does not exist for the
    // phase unit. The honest answer is the fresh-claim step (the boundary
    // step naming the person's transfer).
    if (producer.grant.kind === "distill" || producer.grant.kind === "synthesize") return nextWithoutGrant(at)
    if (booking?.outcome !== "ended" || !booking.intent || !producer.holder.token) {
      return { kind: "blocked", reason: "isolation", detail: "The landed share lacks durable producer provenance." }
    }
    const checkout = await openCheckout(producer)
    if (typeof checkout !== "string") return checkout
    const head = await gitRead(checkout, "rev-parse", "HEAD")
    const witness = await gitRead(checkout, "show", "-s", "--format=%P%n%T%n%B", receipt.commit)
    if (!(producer.scope && !producer.worktree ? await knownHead(receipt.commit, head) : (await settledChain(checkout, receipt.commit, head)) !== undefined) || witness !== `${booking.parent ?? producer.base}\n${booking.intent.tree}\n${shareMessage(producer.grant)}`) {
      return { kind: "blocked", reason: "isolation", detail: "The recorded execute share no longer matches Git history." }
    }
    if (producer.holder.token === holder.token) {
      // The settled-holder terminal (0273, 0264-05's fix). The producer this
      // walk reached is by construction a landed share (the findLast filter
      // pins the booking state — outcome ended, the evidence booked at
      // receipt.commit), so a same-token claim here is the rotated successor
      // or the holder that lost its report response reading back its own
      // settled share: terminal for this token (the producer is pinned in
      // history, 0248 D6's token-distinct rule), yet answered with a wait
      // that can never clear for it — the finding's ambiguity. The terminal
      // names the booked evidence (the settlement's own record, P6 — no new
      // state) and the ended claim. Every neighboring answer is untouched
      // (P10): a live share answers the lease-held wait above, a pending
      // report the settlement waits, and a different token reads the grant
      // below.
      return {
        kind: "settled", unit: producer.grant.unit, commit: receipt.commit,
        detail: `The report for ${producer.grant.id} was accepted; its evidence is booked at ${receipt.commit}. This token's claim on ${producer.grant.unit} has ended — a different token performs the verification.`,
      }
    }
    if (attempts(verifyID(producer.grant.unit)) >= MAX_ATTEMPTS) {
      return { kind: "blocked", reason: "attemptsExhausted", detail: `${producer.grant.unit} has reached the ${MAX_ATTEMPTS}-attempt verification limit.` }
    }
    // The verify share's charter baseline: the unit's true start — its first
    // landed producer share (execute, formulate, or audit; 0184's adoption
    // letter), falling to the producer's own base where none landed before.
    const original = entries.find(({ grant, booking }) => grant.unit === producer.grant.unit &&
      (grant.kind === "execute" || grant.kind === "formulate" || grant.kind === "audit") && booking?.receipt?.kind === "landed"
    )
    return readExecutorFollowUp(dir, { kind: "verify", unit: producer.grant.unit, baseline: original?.base ?? producer.base, head }, false, !!producer.scope, checkout)
  }

  async function fixing(at: number, last: Entry | null | undefined = entries.at(-1)): Promise<DerivedStep | FixPreview> {
    if (!last || live(last, at) || (last.booking && !last.booking.receipt)) return nextWithoutGrant(at)
    const failures = entries.filter(({ grant, booking }) =>
      grant.unit === last.grant.unit && booking?.receipt?.kind === "landed" && booking.receipt.verdict === "fail"
    )
    const failed = failures.at(-1)
    const receipt = failed?.booking?.receipt
    const latest = last.booking?.receipt
    if (!failed || receipt?.kind !== "landed" ||
        (last !== failed && !(last.grant.kind === "fix" && (latest?.kind !== "landed" || latest.continuation)))) {
      return nextWithoutGrant(at)
    }
    let best = Infinity
    let noProgress = 0
    for (const entry of failures) {
      const evidence = entry.booking?.receipt
      if (evidence?.kind !== "landed" || !evidence.gapCount) {
        return { kind: "blocked", reason: "isolation", detail: "A verification gap count is missing." }
      }
      if (evidence.gapCount < best) {
        best = evidence.gapCount
        noProgress = 0
      } else {
        noProgress++
      }
    }
    if (noProgress >= 2) {
      return { kind: "blocked", reason: "fixBudget", detail: "Two fix rounds made no progress against the best recorded gap count." }
    }
    const unit = last.grant.unit
    const round = failures.length
    const fixChain = entries.filter(({ grant, booking }) => grant.kind === "fix" && grant.unit === unit && grant.round === round &&
      booking?.receipt?.kind === "landed" && booking.receipt.continuation)
    if (fixChain.length >= STEER_CHAIN_BOUND ||
        attempts(`${unit} fix ${round}.${fixChain.length + 1}`) >= MAX_ATTEMPTS) {
      return { kind: "blocked", reason: "attemptsExhausted", detail: `${unit} has reached the fix attempt limit.` }
    }
    const checkout = await openCheckout(last)
    if (typeof checkout !== "string") return checkout
    const head = await gitRead(checkout, "rev-parse", "HEAD")
    const handedOver = fixChain.at(-1)?.booking?.receipt
    const expected = handedOver?.kind === "landed" ? handedOver.commit : receipt.commit
    if (!(last.scope && !last.worktree ? await knownHead(expected, head) : (await settledChain(checkout, expected, head)) !== undefined)) {
      return { kind: "blocked", reason: "isolation", detail: "HEAD no longer matches the landed gap list or fix handover." }
    }
    const dirty = await workspaceStatus(checkout)
    const continuation = last.grant.kind === "fix"
    const ownedDirt = latest?.kind !== "landed"
    if (!dirty || (continuation && reportedChanges(last, dirty).some(({ rel }) => !ownedDirt || !permitted(last, rel)
    ))) {
      return { kind: "blocked", reason: "isolation", detail: "Inspect the fix workspace before continuing." }
    }
    return readExecutorFollowUp(dir, { kind: "fix", unit, round, head }, continuation, !!last.scope, checkout)
  }

  const terminal = (entry: Entry) => {
    const receipt = entry.booking?.receipt
    // A landed distill receipt is terminal (0277, preview's closedUnit
    // letter): no verification follows it, so it holds no serial
    // reservation — the boundary is the person's transfer until the next
    // round of work routes. A reconciled receipt is terminal the same way
    // (0287): the ledger's claim ended, no verification follows, no
    // reservation holds. A person-closed landed receipt joins both (0289):
    // the completion ended the chain over the share's landing.
    return (receipt?.kind === "landed" && (receipt.closeCommit !== undefined || receipt.parked !== undefined || receipt.closed === "person" || entry.grant.kind === "distill" || entry.grant.kind === "synthesize")) ||
      receipt?.kind === "reconciled"
  }

  function pendingReport() {
    return entries.find((entry) => entry.booking?.outcome === "ended" && !entry.booking.receipt)
  }

  function serialReservation(): Entry | undefined {
    const last = entries.at(-1)
    if (last && !last.scope && !terminal(last)) return last
  }

  async function scopeCandidates(target?: string): Promise<ScopedTask[]> {
    if (serialReservation()) return []
    const plan = await readExecutorParkPlan(dir)
    if (!plan) return []
    // While the phase's formulation unit stands (0276), it is the phase's
    // only claimable work — 0095 D5's serial rule ("a phase's only ready
    // unit, its Touches everything, ahead of everything it plans"). The
    // lane tiers stand down and the fresh-claim path derives the formulate
    // step; today's behavior for a phase past its formulation is unchanged
    // (the gate reads the same predicate the dispatch keys on, P6).
    if (awaitingFormulation(plan.tasks, planPhaseOf(plan.phase, plan.index))) return []
    const reservations = reserved()
    const worktrees = (await loadProjectConfig(dir).catch(() => undefined))?.treeLanes === "on"
    const candidates = readyTasks(plan).map((task): ScopedTask | undefined => {
      const active = reservations.find(({ grant }) => grant.unit === task.id)
      if (active) return { task, worktree: !!active.worktree }
      if (docEligible(task)) return { task, worktree: false }
      if (worktrees && task.touches?.length && (task.decompose === undefined || task.decompose === "whole")) {
        return { task, worktree: true }
      }
    })
    const first = target === undefined ? candidates[0] : candidates.find((entry) => entry?.task.id === target)
    const mode = reservations.length ? !!reservations[0].worktree : first?.worktree
    return candidates.filter((entry): entry is ScopedTask => !!entry && entry.worktree === mode)
  }

  async function scopedDecision(
    holder: Holder, at: number, kind: Grant["kind"] | undefined, task: string, route?: ScopedTask,
  ): Promise<Decision> {
    const last = latest(task)
    const reservation = last?.scope && !terminal(last) ? last : undefined
    const neighbors = reserved().filter(({ grant }) => grant.unit !== task)
    if (!route) {
      const held = neighbors.find((entry) => live(entry, at))
      return held ? leaseWait(held) : { kind: "wait", reason: "not-ready", detail: `${task} is not ready in the current workspace tier.` }
    }
    const scope = reservation?.scope ?? docScope(route.task)
    const conflict = neighbors.find((entry) => !scopesDisjoint(scope, entry.scope!))
    if (conflict || (reservation && live(reservation, at))) {
      const held = conflict ?? reservation!
      return live(held, at) ? leaseWait(held) : { kind: "wait", reason: "in-flight", detail: `${held.grant.unit} reserves an overlapping scope until settlement.` }
    }
    const status = await workspaceStatus(dir)
    let dirt = status?.filter(({ rel, status }) => !(status === "??" && workdirEntry(rel)) && !siblingDirt(task, rel, status))
    if (route.worktree) {
      if (!dirt || dirt.length) return { kind: "blocked", reason: "isolation", detail: "Resolve main checkout changes before continuing worktree leases." }
      const head = await gitRead(dir, "rev-parse", "HEAD")
      for (const { worktree } of reserved()) {
        if (worktree && !await knownHead(worktree.start, head)) {
          return { kind: "blocked", reason: "isolation", detail: "Main HEAD moved outside the executor's settled shares. Inspect the retained lanes before retrying." }
        }
      }
      if (reservation?.worktree?.established) {
        const checkout = await openCheckout(reservation)
        if (typeof checkout !== "string") return checkout
        const edits = await statusEntriesRead(checkout, checkout)
        dirt = edits && reportedChanges(reservation, edits)
      }
    }
    const previous = reservation?.booking?.receipt
    const continuing = reservation && previous?.kind !== "landed"
    if (!dirt || dirt.some(({ rel }) => !continuing || !permitted(reservation, rel))) {
      return { kind: "blocked", reason: "isolation", detail: "Resolve workspace changes outside the reserved scopes before continuing." }
    }
    const step = await unitDecision(holder, at, kind, reservation, task, true)
    return step.kind === "execute" || step.kind === "verify" || step.kind === "fix"
      ? { ...step, scope, ...(route.worktree && { worktree: true as const }) } : step
  }

  async function unitDecision(holder: Holder, at: number, kind: Grant["kind"] | undefined, last?: Entry, task?: string, scoped = false): Promise<Decision> {
    const result = last?.booking?.receipt
    // A person-closed receipt (0289) needs neither fix nor verification: the
    // person's completion ended the unit's chain over the landing.
    const needsFix = (result?.kind === "landed" && result.verdict === "fail" && result.closed !== "person") ||
      (last?.grant.kind === "fix" && (result?.kind !== "landed" || result.continuation))
    // A landed distill receipt never needs verification (0277 — the boundary's
    // judgment is the person's, D6's ruling): the unit's chain ended at the
    // landing. An audit producer's landed receipt does need it (0278, D6's
    // ruling: the push closeout runs the wrap-up for the unit, the verify
    // kind is that session converged).
    const needsVerification = (result?.kind === "landed" && !result.closeCommit && !result.continuation && !result.parked && result.closed !== "person" && last?.grant.kind !== "distill" && last?.grant.kind !== "synthesize") ||
      (last?.grant.kind === "verify" && result?.kind !== "landed")
    // A formulate ask routes through the fresh-claim preview (0276): the
    // formulate step derives where it stands, and claim's kind guard answers
    // the mismatch — a formulate ask over a phase past its formulation, an
    // execute ask while the formulation stands. A distill ask joins it
    // (0277): the boundary step derives where it stands the same way. An
    // audit ask joins both (0278): the audit step derives where the standing
    // unit routes it.
    if (kind === "execute" || kind === "formulate" || kind === "synthesize" || kind === "distill" || kind === "audit" || (kind === undefined && !needsFix && !needsVerification)) return preview(at, last ?? null, task, scoped)

    return kind === "fix" || (kind === undefined && needsFix) ? fixing(at, last ?? null) : verification(holder, at, last ?? null)
  }

  async function select(holder: Holder, at: number, kind?: Grant["kind"], task?: string, candidates?: ScopedTask[]): Promise<Decision> {
    const last = entries.at(-1)
    const serial = serialReservation()
    if (serial && live(serial, at)) return leaseWait(serial)
    if (pendingReport()) return { kind: "wait", reason: "in-flight", detail: "A previous share requires settlement." }

    const admission = await readExecutorAdmissionBlock(dir)
    if (admission) return admission

    const previous = task ? latest(task)?.booking?.receipt : undefined
    if (previous?.kind === "landed" && previous.closeCommit) {
      return withoutGrant(await select(holder, at))
    }

    const scopedTasks = candidates ?? await scopeCandidates(task)
    const route = task ? scopedTasks.find((entry) => entry.task.id === task) : undefined
    const hasReservations = reserved().length > 0
    if (task && !serial && !hasReservations && !route && !scopedTasks.length) {
      const plan = await readExecutorParkPlan(dir)
      const declaration = plan?.tasks.find(({ id }) => id === task)
      if (declaration && docEligible(declaration)) return scopedDecision(holder, at, kind, task)
      if (kind === undefined || kind === "execute" || kind === "formulate" || kind === "synthesize" || kind === "distill" || kind === "audit") return preview(at, null, task)
      return { kind: "wait", reason: "not-ready", detail: `${task} has no ${kind} step to claim.` }
    }
    if (hasReservations || scopedTasks.length) {
      if (task) return scopedDecision(holder, at, kind, task, route)
      let wait: DerivedStep | undefined
      for (const scoped of scopedTasks) {
        const step = await scopedDecision(holder, at, kind, scoped.task.id, scoped)
        if (step.kind === "execute" || step.kind === "verify" || step.kind === "fix") return step
        // A formulate step never rides the scoped tiers (the candidates
        // gate, 0276); reached only by type totality, it answers as the
        // available new claim it is. The distill step joins the exclusion
        // (0277): the boundary declares no Touches, so no scoped tier ever
        // derives it. The audit step joins both (0278): the audit unit
        // declares no Touches and the terminal phase's every other task is
        // done — the standing emptiness the gate.
        wait ??= step.kind === "formulate" || step.kind === "synthesize" || step.kind === "distill" || step.kind === "audit" ? withoutGrant(step) : step
      }
      if (wait) return wait
      return { kind: "wait", reason: "in-flight", detail: "The current workspace tier must settle before other work starts." }
    }
    return unitDecision(holder, at, kind, last)
  }

  return {
    claim: (holder, task, kind) => serialize(async () => {
      const at = now()
      const held = entries.findLast((entry) => live(entry, at) && sameHolder(entry.holder, holder))
      if (held) return (kind === undefined || kind === held.grant.kind) && (task === undefined || task === held.grant.unit)
        ? grantCheckout(holder, held)
        : leaseWait(held)
      // The report already authorized settlement. A replacement's claim can
      // finish it without impersonating the original holder or booking again.
      const booked = pendingReport()
      if (booked?.booking?.outcome === "ended") {
        const result = await settle(booked, booked.booking)
        if (result.kind === "blocked") return result
      }
      const step = await select(holder, now(), kind, task)
      if (step.kind !== "execute" && step.kind !== "verify" && step.kind !== "fix" && step.kind !== "formulate" && step.kind !== "synthesize" && step.kind !== "distill" && step.kind !== "audit") return step
      // The asked-kind guard (0276): a targeted claim receives its own kind
      // or an honest wait naming the mismatch — dead code for the standing
      // kinds (their routing guarantees the match by construction), made
      // load-bearing by the formulate join, where the fresh-claim preview
      // can derive a different step than the ask (an execute ask while the
      // phase's formulation stands, a formulate ask over a phase past it).
      // An untargeted claim takes the next step whatever its kind — the
      // menu's claimable row named it. The distill join rides the same
      // guard (0277): a distill ask over a phase whose handover already
      // stands valid, an execute ask at the boundary. The audit join rides
      // it too (0278): an audit ask before the close arms construct the
      // unit, an execute ask while the standing unit routes the phase.
      if (kind !== undefined && step.kind !== kind) {
        return { kind: "wait", reason: "not-ready", detail: `${step.unit} has no ${kind} step to claim.` }
      }
      if (task !== undefined && task !== step.unit) {
        return { kind: "wait", reason: "not-ready", detail: `${task} is not the next serial unit.` }
      }
      const last = latest(step.unit)
      const retained = step.worktree && last && !terminal(last) ? last.worktree : undefined
      const workspace = step.worktree
        ? retained ?? { id: randomUUID(), start: await gitRead(dir, "rev-parse", "HEAD") }
        : undefined
      const checkout = workspace && last && retained ? await openCheckout(last) : dir
      if (typeof checkout !== "string") return checkout
      const base = workspace && !workspace.established ? workspace.start : await gitRead(checkout, "rev-parse", "HEAD")
      if (step.kind !== "execute" && step.kind !== "formulate" && step.kind !== "synthesize" && step.kind !== "distill" && step.kind !== "audit" && base !== step.head) {
        return { kind: "blocked", reason: "isolation", detail: "HEAD moved before the grant." }
      }
      const { touches, scope, worktree: _, ...work } = step.kind === "verify" || step.kind === "formulate" || step.kind === "synthesize" || step.kind === "distill" || step.kind === "audit" ? { ...step, touches: undefined } : step
      // The grant's budget is the project's declared executorLease (0260);
      // select's admission arm already proved the config loads, so a throw
      // here is a hand edit landing mid-claim and fails loud.
      const budget = (await loadProjectConfig(dir)).executorLease ?? DEFAULT_LEASE_BUDGET_MINUTES
      const issued = now()
      const id = stepID(step)
      const grant: Grant = {
        ...work, id, lease: randomUUID(), attempt: attempts(id) + 1,
        workspace: workspace ? executorWorkspacePath(dir, workspace) : dir,
        deadline: issued + leaseWindowMs(budget), budget,
      }
      // 0294 (0290 F4d): the landed context rides an execute grant over a
      // unit with a landed share — the prior share's id and its landing
      // commit, 0276's per-unit context discipline (the fix grant's
      // phase/index/findings the precedent): a takeover or continuation
      // holder reads its unit's already-landed state from the grant, not
      // the tree. Attached at the ledger's own boundary (the steps
      // derivation never touches receipts, P5); a fresh unit carries
      // nothing — the byte-identical floor.
      if (grant.kind === "execute") {
        const landed = lastLanded(step.unit)
        if (landed?.booking?.receipt?.kind === "landed") grant.landed = { id: landed.grant.id, commit: landed.booking.receipt.commit }
      }
      const brief = withAnswers(holder, grant)
      if (brief.kind === "blocked") return brief
      const predecessor = last?.grant.id === grant.id ? last.grant.lease : undefined
      const entry = { grant, holder: { ...holder }, base, issued, touches, scope, predecessor, worktree: workspace }
      await persist([...entries, entry])
      if (workspace && !retained) checkpoint?.("workspace-booked")
      return workspace ? grantCheckout(holder, entry) : brief
    }),
    ready: (holder) => serialize(() => menu(holder, now())),
    brief: (holder, task, kind) => serialize(async () => {
      const last = latest(task)
      if (last && (kind === undefined || kind === last.grant.kind) && live(last, now())) {
        if (!sameHolder(last.holder, holder)) return leaseWait(last)
        if (last.worktree && !last.worktree.established) {
          return { kind: "wait", reason: "in-flight", detail: "Retry the claim to complete workspace creation." }
        }
        const checkout = await openCheckout(last)
        return typeof checkout === "string" ? withAnswers(holder, last.grant) : checkout
      }
      return { kind: "wait", reason: "not-ready", detail: `This channel has no live brief for ${task}.` }
    }),
    verification: (holder) => serialize(async () => {
      const step = await select(holder, now(), "verify")
      return step.kind === "verify" ? step : withoutGrant(step)
    }),
    heartbeat: (holder, leases) => serialize(async () => {
      const requested = new Set(leases.map(({ step, lease }) => lookup(step, lease)))
      const at = now()
      const renewed = entries.map((entry) => {
        if (!requested.has(entry) || !sameHolder(entry.holder, holder) || !live(entry, at)) return entry
        // Renewal derives the window and cap from the grant's own budget
        // (0260): a lease keeps the clock it was issued under even after a
        // config edit mid-lease; the hard cap stays twice that window.
        const window = leaseWindowMs(entry.grant.budget)
        const deadline = Math.min(at + window, entry.issued + 2 * window)
        return deadline > entry.grant.deadline ? { ...entry, grant: { ...entry.grant, deadline } } : entry
      })
      if (renewed.some((entry, i) => entry !== entries[i])) await persist(renewed)
      return menu(holder, at)
    }),
    release: (holder, step, lease) => serialize(async () => {
      const entry = lookup(step, lease)
      const at = now()
      if (!sameHolder(entry.holder, holder)) return live(entry, at) ? leaseWait(entry) : withoutGrant(await select(holder, at))
      if (entry.released) return withoutGrant(await select(holder, at))
      if (entry.booking || !live(entry, at)) return waitForSuccessor(entry, at) ?? withoutGrant(await select(holder, at))
      await persist(entries.map((item) => item === entry ? { ...item, released: true } : item))
      return withoutGrant(await select(holder, at))
    }),
    report: (holder, step, lease, outcome, note) => serialize(async () => {
      let entry = lookup(step, lease)
      const at = now()
      if (outcome !== "ended" && outcome !== "failed") throw new Error("Invalid report outcome.")
      if (!sameHolder(entry.holder, holder)) return live(entry, at) ? leaseWait(entry) : withoutGrant(await select(holder, at))
      if (entry.worktree && !entry.worktree.established) {
        return { kind: "wait", reason: "in-flight", detail: "Retry the claim to complete workspace creation before reporting." }
      }
      if (entry.booking) {
        // A reconciled entry answers its (late) holder with the
        // reconciliation truth before any outcome bookkeeping (0287): the
        // lease died unreported, the unit closed without the share — the
        // receipt says so, whatever outcome the late report claims.
        if (entry.booking.receipt?.kind === "reconciled") return entry.booking.receipt
        if (entry.booking.outcome !== outcome) throw new ExecutorRequestError("The report outcome conflicts with the booked outcome.")
        if (entry.booking.receipt) return entry.booking.receipt
      } else {
        if (!live(entry, at)) return waitForSuccessor(entry, at) ?? withoutGrant(await select(holder, at))
        if (pendingReport()) return { kind: "wait", reason: "in-flight", detail: "A previous report requires settlement first." }
        entry = await book(entry, outcome === "failed"
          ? { outcome, note, receipt: { kind: "without-landing", reason: "failed" } }
          : { outcome, note })
        checkpoint?.("booked")
      }
      const booking = entry.booking!
      if (booking.receipt) return booking.receipt
      if (booking.outcome !== "ended") throw new Error("Invalid executor booking.")
      return settle(entry, booking)
    }),
    next: (holder) => serialize(async () => withoutGrant(await select(holder, now()))),
    // The person's reconciliation act (0287): the deterministic-op arm of
    // the dead-letter sweep, exposed for the daemon's control-scope
    // operation. No unit: the automatic sweep alone (book exactly the dead
    // leases — and, 0292, the booked without-landing receipts — whose units
    // the record closed). A unit: the forced arm beside it — every dead
    // lease and every booked without-landing receipt of that unit books
    // with the person's provenance, the person's terminal act for the
    // states the record cannot evidence. A live lease of the named unit
    // refuses (P20: control changes land at safe boundaries); every other
    // booked receipt is never the sweep's (a landed share history, a
    // pending report the settlement's, a blocked receipt 0287's standing
    // residual). The continuation re-derivation (0289) rides the same head
    // sweep, evidence-gated alone — no forced arm (the person's channels
    // are the handoff amendment and the unit's completion, both document
    // acts), so a named unit whose continuation still stands answers with
    // the teaching, never a flat nothing. The lines carry each booking's
    // finding (P8).
    reconcile: (unit?: string) => serialize(async () => {
      const at = now()
      if (unit !== undefined) {
        const named = entries.filter((entry) => entry.grant.unit === unit)
        if (!named.length) return { lines: [...reconciliationLines.splice(0), `ℹ no lease stands on ${unit} — nothing to reconcile`] }
        if (named.some((entry) => live(entry, at))) {
          throw new ExecutorRequestError(`${unit} holds a live lease; the reconciliation lands at safe boundaries — retry after the lease settles or expires`)
        }
      }
      await reconcileDeadLetters(at, unit)
      const lines = reconciliationLines.splice(0)
      if (lines.length) return { lines }
      const standing = unit !== undefined ? latest(unit)?.booking?.receipt : undefined
      if (standing?.kind === "landed" && standing.continuation) {
        return { lines: [`ℹ ${unit}'s landed share still continues — its handoff at HEAD reads a continue status and the unit stands open; amend the handoff's Status line (and commit) or complete the unit to correct the continuation`] }
      }
      return { lines: ["ℹ nothing to reconcile: no dead lease stands (every entry is booked, live, or already reconciled)"] }
    }),
    busy: () => serialize(async () => entries.some((entry) => live(entry, now())) || pendingReport() !== undefined),
    async close() {
      closed = true
      await tail
      lock.release()
    },
  }
}
