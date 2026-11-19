// The executor share coordinator. The shell supplies the authenticated stable
// token identity and channel. This surface is internal until the routes land.
import { createHash, randomUUID } from "node:crypto"
import { readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { join, relative } from "node:path"
import { readClarificationProposal } from "./clarify"
import { loadProjectConfig } from "./config"
import { docShapeProblems } from "./doccheck"
import { taskDocPaths } from "./docpaths"
import { handoffStatus, parkDirective, parseResult, roleOf } from "./document/roles"
import { tickedIndex } from "./document/unit"
import { parkCheck, STEER_CHAIN_BOUND } from "./execute"
import { readExecutorAdmissionBlock, readExecutorParkPlan, readExecutorPreview, readExecutorFollowUp, type ExecutorPreview, type FixPreview, type VerificationPreview } from "./executor-steps"
import {
  ensureExecutorWorkspace, executorWorkspacePath, ExecutorWorktreeError, landExecutorWorkspace,
  prepareExecutorLanding, removeExecutorWorkspace, validExecutorLanding, validExecutorWorkspace,
  type ExecutorLanding, type ExecutorWorkspace,
} from "./executor-worktree"
import { EMPTY_TREE, git, identityArgs, message, repoRoots, statusEntriesRead, withinScopes, workdirEntry } from "./git"
import { docEligible, docScope, scopesDisjoint } from "./lanes"
import { acquireRunLock, liveRunLock } from "./lock"
import { markDone, readyTasks, runtimeParked, setParked, taskStatePaths, type Task } from "./tasks"

export class ExecutorRequestError extends Error {}

export type ExecutorHolder = { token: string; channel: string }
type Holder = ExecutorHolder
export type ExecutorPerson = ExecutorHolder & { delegation: "unrestricted" | readonly ("questions" | "releases")[] }
type Question = {
  id: string
  position?: number
  asker: Holder
  text: string
  task?: string
  answer?: { person: ExecutorPerson; decision: string; rationale?: string; order?: number }
}
type BriefAnswer = { id: string; question: string; decision: string; rationale?: string }
type AnswerPage = { answers: BriefAnswer[]; next?: string }
type Gate = {
  id: string
  position?: number
  gate: "project-start" | "survey-release"
  document: string
  digest: string
  superseded?: true
  intent?: {
    answer: NonNullable<Question["answer"]>
    base: string
    before: string
    after: string
    subject: string
    tree?: string
    commit?: string
  }
}
type GateOffer = Pick<Gate, "id" | "gate" | "document"> & { kind: "human"; proposal: string; review: string[] }
type GateStep = GateOffer | QuestionWait | BlockedReport
type QuestionOffer = { kind: "question"; id: string; text: string; task?: string }
type QuestionWait = { kind: "wait"; reason: "question" | "gate" | "not-ready"; detail: string }
type PersonStep = QuestionOffer | QuestionWait
type Execute = Extract<ExecutorPreview, { kind: "execute" }>
type Candidate = Execute | FixPreview | VerificationPreview
type Grant = (Omit<Execute, "touches"> | Omit<FixPreview, "touches"> | VerificationPreview) & { id: string; lease: string; attempt: number; workspace: string; deadline: number; budget: number; answerCursor?: string | null }
type BlockedReport = { kind: "blocked"; reason: "isolation" | "commitFailed"; detail: string }
type VerifyVerdict = "pass" | "fail"
type Receipt = { kind: "landed"; commit: string; verdict?: VerifyVerdict; gapCount?: number; continuation?: true; parked?: string; closeCommit?: string; landingCommit?: string } | { kind: "without-landing"; reason: "failed" | "zero-write" } | BlockedReport
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
type DerivedStep = Exclude<ExecutorPreview, Execute> | BlockedReport | LeaseWait | BudgetBlock | QuestionWait
type Decision = DerivedStep | (Candidate & { scope?: readonly string[]; worktree?: true })
type Claim = DerivedStep | Grant
type LeaseKey = { step: string; lease: string }
type Menu = {
  claimable: { unit: string; title: string; kinds: [Grant["kind"]]; touches?: readonly string[] }[]
  leases: (LeaseKey & Pick<Grant, "kind" | "deadline" | "attempt">)[]
}
type ScopedTask = { task: Task; worktree: boolean }
type Checkpoint = "booked" | "committed" | "park-recorded" | "close-index-written" | "closed-files" | "closed-commit" | "gate-booked" | "gate-marked" | "gate-committed" |
  "workspace-booked" | "workspace-created" | "landing-booked" | "lane-landed" | "nested-committed"
const EXECUTE_BUDGET_MINUTES = 60
const LEASE_WINDOW_MS = (EXECUTE_BUDGET_MINUTES + 5) * 60_000
const MAX_LEASE_AGE_MS = 2 * LEASE_WINDOW_MS
const MAX_ATTEMPTS = 3
const MAX_RESPONSE_BYTES = 256 * 1024
const ANSWER_PAGE_BYTES = 192 * 1024
const STATE = join(".auto", "executor-progress.json")
const GATE_STATE = join(".auto", "executor-gates.json")
const PERSON_STATE = join(".auto", "executor-questions.json")

function questionAuthority(person: ExecutorPerson): boolean {
  return person.delegation === "unrestricted" || (Array.isArray(person.delegation) && person.delegation.includes("questions"))
}

function sameHolder(a: Holder, b: Holder): boolean {
  return a.token === b.token && a.channel === b.channel
}

function shareMessage(grant: Grant, parked = false): string {
  if (parked) return message(`${grant.unit} park ${grant.title}`, { id: grant.unit }, "park", [], `Executor lease ${grant.lease}`)
  return message(grant.id, { id: grant.unit }, grant.kind === "verify" ? "wrapup" : grant.kind === "fix" ? "fix" : "exec", [], `Executor lease ${grant.lease}`)
}

function permitted(entry: Entry, path: string): boolean {
  if (workdirEntry(path) || path === ".opencode" || path.startsWith(".opencode/") || path.split("/").includes("AGENTS.md")) return false
  const docs = taskDocPaths(entry.grant.unit)
  if (entry.grant.kind === "verify") return path === docs.report || path === docs.gaps
  if (path === docs.handoff) return true
  const scope = entry.scope ?? entry.touches
  return roleOf(path) === "freeform" && (scope === undefined || withinScopes(path, scope))
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

export async function openExecutorCoordinator(
  directory: string,
  options: { checkpoint?: (point: Checkpoint) => void; now?: () => number } = {},
): Promise<{
  claim(holder: Holder, task?: string, kind?: Grant["kind"]): Promise<Claim>
  ready(holder: Holder): Promise<Menu>
  brief(holder: Holder, task: string, kind?: Grant["kind"]): Promise<Claim>
  briefAnswers(holder: Holder, task: string, after?: string, kind?: Candidate["kind"]): Promise<AnswerPage>
  verification(holder: Holder): Promise<DerivedStep | VerificationPreview>
  heartbeat(holder: Holder, leases: readonly LeaseKey[]): Promise<Menu>
  release(holder: Holder, step: string, lease: string): Promise<DerivedStep>
  report(holder: Holder, step: string, lease: string, outcome: "ended" | "failed", note?: string): Promise<Receipt | DerivedStep>
  next(holder: Holder): Promise<DerivedStep>
  question(holder: Holder, text: string, target?: LeaseKey & { task: string }): Promise<{ id: string; state: "raised" }>
  claimPerson(person: ExecutorPerson): Promise<PersonStep | GateStep>
  answerPerson(person: ExecutorPerson, id: string, decision: string, rationale?: string): Promise<PersonStep | GateStep>
  claimQuestion(person: ExecutorPerson): Promise<PersonStep>
  answerQuestion(person: ExecutorPerson, id: string, decision: string, rationale?: string): Promise<PersonStep>
  claimGate(person: ExecutorPerson): Promise<GateStep>
  answerGate(person: ExecutorPerson, id: string, decision: "approve", rationale?: string): Promise<GateStep>
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
  const questionFile = join(dir, PERSON_STATE)
  const gateFile = join(dir, GATE_STATE)
  let gates: Gate[]
  let entries: Entry[]
  let questions: Question[]
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
    questions = JSON.parse(await readState(questionFile)) as Question[]
    if (!Array.isArray(questions) || questions.some((item) =>
      typeof item?.id !== "string" || typeof item.text !== "string" ||
      typeof item.asker?.token !== "string" || typeof item.asker?.channel !== "string" ||
      (item.task !== undefined && typeof item.task !== "string") ||
      (item.answer !== undefined && typeof item.answer?.decision !== "string")
    )) throw new Error("Invalid executor question record.")
    gates = JSON.parse(await readState(gateFile)) as Gate[]
    if (!Array.isArray(gates) || gates.some((item) => typeof item?.id !== "string" ||
      (item.gate !== "project-start" && item.gate !== "survey-release") ||
      typeof item.document !== "string" || typeof item.digest !== "string" ||
      (item.intent !== undefined && (typeof item.intent?.base !== "string" ||
        typeof item.intent.before !== "string" || typeof item.intent.after !== "string" ||
        typeof item.intent.subject !== "string" || item.intent.answer?.decision !== "approve"))
    )) throw new Error("Invalid executor gate record.")
  } catch (error) {
    lock.release()
    throw error
  }

  let tail: Promise<unknown> = Promise.resolve()
  let closed = false
  function serialize<T>(act: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("The executor coordinator is closed."))
    const run = tail.then(act)
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

  async function persistQuestions(next: Question[]): Promise<void> {
    await replaceFile(questionFile, JSON.stringify(next), 0o600)
    questions = next
  }

  async function persistGates(next: Gate[]): Promise<void> {
    await replaceFile(gateFile, JSON.stringify(next), 0o600)
    gates = next
  }

  async function updateGate(item: Gate, next: Gate): Promise<Gate> {
    await persistGates(gates.map((gate) => gate === item ? next : gate))
    return next
  }

  function pendingGate(): Gate | undefined {
    return gates.find((item) => item.intent && !item.intent.commit)
  }

  function releaseAuthority(person: ExecutorPerson): boolean {
    return person.delegation === "unrestricted" || (Array.isArray(person.delegation) && person.delegation.includes("releases"))
  }

  async function gateProposal() {
    const admission = await readExecutorAdmissionBlock(dir)
    if (admission?.kind !== "human") return undefined
    const proposal = await readClarificationProposal(dir, await loadProjectConfig(dir))
    if (!proposal || proposal.document !== admission.document) return undefined
    if (!(await readFile(join(dir, proposal.document))).equals(Buffer.from(proposal.before))) return undefined
    const base = await gitRead(dir, "rev-parse", "HEAD")
    const digest = createHash("sha256").update(JSON.stringify({ base, gate: admission.gate, proposal })).digest("hex")
    return { ...proposal, base, digest, gate: admission.gate }
  }

  async function gateWorkspace(document: string): Promise<boolean> {
    const path = join(dir, document)
    if (await realpath(path).catch(() => undefined) !== path ||
        !(await stat(path).catch(() => undefined))?.isFile()) return false
    // Every repository root judged, not one (0258): nested dirt outside the
    // gate document holds the release exactly as top-repository dirt does.
    const status = await workspaceStatus(dir)
    return status !== undefined && status.every(({ rel, status }) =>
      rel === document || (status === "??" && workdirEntry(rel))
    )
  }

  async function settleGate(item: Gate): Promise<BlockedReport | undefined> {
    const intent = item.intent!
    const doc = item.document
    const path = join(dir, doc)
    const block = (detail: string): BlockedReport => ({ kind: "blocked", reason: "isolation", detail })
    const messageText = message(intent.subject, { id: "PLAN" }, "clarify", [], `Executor gate ${item.id}`)
    const head = await gitRead(dir, "rev-parse", "HEAD")
    if (head !== intent.base) {
      const witness = await gitRead(dir, "show", "-s", "--format=%P%n%T%n%B", head)
      if (!intent.tree || witness !== `${intent.base}\n${intent.tree}\n${messageText}`) {
        return block("HEAD does not match the booked gate release. Inspect the release before resuming.")
      }
      await updateGate(item, { ...item, intent: { ...intent, commit: head } })
      return
    }
    if (!await gateWorkspace(doc)) {
      return block(`Resolve workspace changes outside ${doc} before settling the gate release.`)
    }
    const current = await readFile(path)
    if (current.equals(Buffer.from(intent.before))) {
      const proposal = await gateProposal()
      if (proposal?.digest !== item.digest) return block("The booked proposal no longer matches the project gate.")
      // An interrupted temporary write stays in driver state and cannot
      // appear as an unrelated change when the next coordinator retries.
      await replaceFile(path, intent.after, (await stat(path)).mode & 0o777, gateFile)
      checkpoint?.("gate-marked")
    } else if (!current.equals(Buffer.from(intent.after))) {
      return block(`The release document ${doc} differs from its booked before and after state.`)
    }
    const pathspec = `:(literal)${doc}`
    const stage = await git(dir, ["add", "--", pathspec])
    if (stage.code !== 0) return { kind: "blocked", reason: "commitFailed", detail: stage.err.trim() }
    const tree = await gitRead(dir, "write-tree")
    const [diff, content] = await Promise.all([
      git(dir, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", head, tree]),
      git(dir, ["show", `${tree}:${doc}`]),
    ])
    if (diff.code !== 0 || diff.out !== `${doc}\0` || content.code !== 0 || content.out !== intent.after ||
        (intent.tree && intent.tree !== tree)) return block("The staged gate release differs from the booked document.")
    if (!intent.tree) item = await updateGate(item, { ...item, intent: { ...intent, tree } })
    const commit = await git(dir, [...await identityArgs(dir), "commit", "-m", messageText, "--", pathspec])
    if (commit.code !== 0) return { kind: "blocked", reason: "commitFailed", detail: commit.err.trim() || commit.out.trim() }
    checkpoint?.("gate-committed")
    const landed = await gitRead(dir, "rev-parse", "HEAD")
    const witness = await gitRead(dir, "show", "-s", "--format=%P%n%T%n%B", landed)
    if (witness !== `${head}\n${tree}\n${messageText}`) return block("The gate commit differs from its booked release.")
    await updateGate(item, { ...item, intent: { ...intent, tree, commit: landed } })
  }

  async function offerGate(person: ExecutorPerson): Promise<GateStep> {
    if (!releaseAuthority(person)) return { kind: "wait", reason: "gate", detail: "Gate releases require a person with release authority." }
    const pending = pendingGate()
    if (pending) {
      const blocked = await settleGate(pending)
      if (blocked) return blocked
    }
    const proposal = await gateProposal()
    const prior = gates.findLast((item) => !item.intent && !item.superseded)
    if (prior && prior.digest !== proposal?.digest) await updateGate(prior, { ...prior, superseded: true })
    if (!proposal) return { kind: "wait", reason: "not-ready", detail: "No validated gate awaits release." }
    const { gate, document, digest, review, before } = proposal
    const item = prior?.digest === digest ? prior : { id: randomUUID(), gate, document, digest, position: questions.length + gates.length }
    const offer: GateOffer = { kind: "human", id: item.id, gate, document, proposal: before, review }
    if (Buffer.byteLength(JSON.stringify({ protocol: 1, step: offer })) > MAX_RESPONSE_BYTES) {
      return { kind: "blocked", reason: "isolation", detail: "The gate proposal exceeds the executor response limit." }
    }
    if (item !== prior) await persistGates([...gates, item])
    return offer
  }

  function personStep(person: ExecutorPerson): PersonStep {
    const pending = questions.find((item) => !item.answer)
    if (!pending) return { kind: "wait", reason: "not-ready", detail: "No pending questions." }
    if (!questionAuthority(person)) return { kind: "wait", reason: "gate", detail: "A pending question requires a person with question authority." }
    const { id, text, task } = pending
    return { kind: "question", id, text, task }
  }

  async function settleQuestion(person: ExecutorPerson, id: string, decision: string, rationale?: string) {
    if (!questionAuthority(person)) throw new ExecutorRequestError("The person grant does not authorize answering questions.")
    const item = questions.find((question) => question.id === id)
    if (!item) throw new ExecutorRequestError("The question was never issued.")
    if (item.answer) return
    if (!decision.trim() || Buffer.byteLength(decision) > 8192 ||
        (rationale !== undefined && Buffer.byteLength(rationale) > 8192)) {
      throw new ExecutorRequestError("An answer requires a decision. The decision and rationale are limited to 8192 bytes each.")
    }
    const delegation = person.delegation === "unrestricted" ? person.delegation : [...person.delegation]
    const order = questions.reduce((max, question) => Math.max(max, question.answer?.order ?? 0), 0) + 1
    const answer = { person: { token: person.token, channel: person.channel, delegation }, decision, rationale, order }
    await persistQuestions(questions.map((question) => question === item ? { ...question, answer } : question))
  }

  async function approveGate(person: ExecutorPerson, id: string, decision: string, rationale?: string): Promise<QuestionWait | BlockedReport | undefined> {
    if (!releaseAuthority(person)) throw new ExecutorRequestError("The person grant does not authorize gate releases.")
    const item = gates.find((gate) => gate.id === id)
    if (!item) throw new ExecutorRequestError("The gate was never issued.")
    if (item.intent || item.superseded) return
    if (decision !== "approve" || (rationale !== undefined && Buffer.byteLength(rationale) > 8192)) {
      throw new ExecutorRequestError("A gate decision must approve the proposal. Rationale is limited to 8192 bytes.")
    }
    const proposal = await gateProposal()
    if (!proposal || proposal.digest !== item.digest) return
    if (entries.some((entry) => live(entry, now()) || (entry.booking && !entry.booking.receipt))) {
      return { kind: "wait", reason: "gate", detail: "The workspace must settle its current lease or report before releasing the gate." }
    }
    if (!await gateWorkspace(item.document)) {
      return { kind: "blocked", reason: "isolation", detail: `Resolve workspace changes outside ${item.document} before approving the gate release.` }
    }
    const delegation = person.delegation === "unrestricted" ? person.delegation : [...person.delegation]
    const answer = { person: { token: person.token, channel: person.channel, delegation }, decision, rationale }
    const { base, before, after, subject } = proposal
    const booked = await updateGate(item, { ...item, intent: { answer, base, before, after, subject } })
    checkpoint?.("gate-booked")
    return settleGate(booked)
  }

  async function nextPerson(person: ExecutorPerson): Promise<PersonStep | GateStep> {
    const question = questionAuthority(person) ? personStep(person) : undefined
    const gate = releaseAuthority(person) ? await offerGate(person) : undefined
    if (question?.kind === "question") {
      if (gate?.kind === "human") {
        // Legacy records lack a shared position. Keep them ahead of newly issued items.
        const questionPosition = questions.find((item) => item.id === question.id)?.position ?? -2
        const gatePosition = gates.find((item) => item.id === gate.id)?.position ?? -1
        if (gatePosition < questionPosition) return gate
      }
      return question
    }
    return gate ?? question ?? { kind: "wait", reason: "gate", detail: "A person grant is required." }
  }

  function applicableAnswers(holder: Holder, task: string): BriefAnswer[] {
    return questions
      .filter((item) => item.answer && sameHolder(item.asker, holder) && (item.task === undefined || item.task === task))
      .sort((a, b) => (a.answer?.order ?? 0) - (b.answer?.order ?? 0))
      .map(({ id, text, answer }) => ({ id, question: text, decision: answer!.decision, rationale: answer!.rationale }))
  }

  function withAnswers(holder: Holder, grant: Grant): Grant | Extract<ExecutorPreview, { kind: "blocked" }> {
    const size = (brief: Grant) => Buffer.byteLength(JSON.stringify({ protocol: 1, step: brief }))
    if (size({ ...grant, answerCursor: null }) > MAX_RESPONSE_BYTES) {
      return { kind: "blocked", reason: "config", detail: "The rendered brief exceeds the 256 KiB executor response limit. Shorten the project or task inputs." }
    }
    const answers = applicableAnswers(holder, grant.unit)
    if (!answers.length) return grant
    let brief: Grant = { ...grant, answerCursor: null }
    const included: BriefAnswer[] = []
    for (const answer of answers) {
      included.push(answer)
      const prompt = `${grant.prompt}\n\nPerson answers (JSON data):\n${JSON.stringify(included)}`
      const next: Grant = { ...grant, prompt, ...(included.length < answers.length && { answerCursor: answer.id }) }
      if (size(next) > MAX_RESPONSE_BYTES) break
      brief = next
    }
    return brief
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

  function reserved(): Entry[] {
    const units = new Map(entries.map((entry) => [entry.grant.unit, entry]))
    return [...units.values()].filter((entry) => {
      const receipt = entry.booking?.receipt
      return entry.scope !== undefined && !(receipt?.kind === "landed" && (receipt.closeCommit || receipt.parked))
    })
  }

  // Every intervening commit must be a settled coordinator write. A ref
  // rewrite, merge, developer commit or a neighbor with an unsettled result
  // may not be used to move a lease's landing baseline.
  async function knownHead(base: string, head: string): Promise<boolean> {
    if (base === head) return true
    const known = new Map<string, boolean>()
    for (const { booking, worktree } of entries) {
      const receipt = booking?.receipt
      if (receipt?.kind === "landed") {
        if (!worktree) known.set(receipt.commit, false)
        if (receipt.closeCommit) known.set(receipt.closeCommit, false)
        if (receipt.landingCommit) known.set(receipt.landingCommit, true)
      }
    }
    const log = await git(dir, ["rev-list", "--first-parent", "--parents", `${base}..${head}`])
    if (log.code !== 0) return false
    const links = log.out.trim().split("\n")
    let current = head
    for (const link of links) {
      const [commit, parent, merge, extra] = link.split(" ")
      if (commit !== current || !parent || extra || known.get(commit) !== Boolean(merge)) return false
      current = parent
    }
    return current === base
  }

  function siblingDirt(unit: string, path: string, status: string): boolean {
    return (status === "??" || status[0] === " ") &&
      reserved().some((sibling) => !sibling.worktree && sibling.grant.unit !== unit && permitted(sibling, path))
  }

  function reportedChanges(entry: Entry, rows: NonNullable<Awaited<ReturnType<typeof statusEntriesRead>>>) {
    return rows.filter(({ rel, status }) =>
      !(status === "??" && workdirEntry(rel)) && !(entry.scope && !entry.worktree && siblingDirt(entry.grant.unit, rel, status)))
  }

  async function settle(entry: Entry, booking: EndedBooking): Promise<Receipt> {
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
            return workspaceBlock(error)
          }
          if (!await knownHead(worktree.start, landing.parent)) {
            return blocked("Main HEAD moved outside the executor's settled shares. Inspect the retained lane before retrying.")
          }
          booking = { ...booking, landing }
          entry = await book(entry, booking)
          checkpoint?.("landing-booked")
        }
        try {
          landingCommit = await landExecutorWorkspace(dir, worktree, { id: grant.unit, title: grant.title }, booking.landing!)
        } catch (error) {
          return workspaceBlock(error)
        }
        checkpoint?.("lane-landed")
      }
      if (evidence.park) {
        const { blocker, previous } = evidence.park
        const recorded = await runtimeParked(dir, entry.grant.unit)
        if (recorded !== blocker) {
          if (recorded !== previous) return blocked("The dependency park record changed outside the booked share.")
          await setParked(dir, entry.grant.unit, blocker)
          checkpoint?.("park-recorded")
        }
        if (worktree) {
          try {
            await removeExecutorWorkspace(dir, worktree, commit)
          } catch (error) {
            return workspaceBlock(error)
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
        return blocked("The lane share no longer matches the booked landing.")
      }
      return finishShare(share, booking.intent)
    }
    const checkout = await openCheckout(entry)
    if (typeof checkout !== "string") return checkout
    const { grant } = entry
    const head = await gitRead(checkout, "rev-parse", "HEAD")
    const base = booking.parent ?? (entry.scope && !entry.worktree ? head : entry.base)
    if (head !== base) {
      const witness = await gitRead(checkout, "show", "-s", "--format=%P%n%T%n%B", head)
      if (booking.intent && witness === `${base}\n${booking.intent.tree}\n${shareMessage(grant, !!booking.intent.park)}` &&
          await nestedWitnesses(checkout, grant, booking.intent)) {
        return finishShare(head, booking.intent)
      }
      return blocked("HEAD moved outside the booked share. Inspect the commit and executor progress before resuming.")
    }
    if (entry.scope && !entry.worktree && !await knownHead(entry.base, base)) {
      return blocked("HEAD moved outside the executor's settled shares.")
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
    if (!status) return { kind: "blocked", reason: "commitFailed", detail: "Git status is unreadable. Inspect the index before replaying." }
    const { gaps, handoff } = taskDocPaths(grant.unit)
    let changes = reportedChanges(entry, status)
    const rejected = changes.filter(({ rel, status }) =>
      !permitted(entry, rel) && !(booking.retireGaps && rel === gaps && /^[ D]{2}$/.test(status))
    )
    if (rejected.length) return blocked(`Resolve out-of-scope edits before replaying: ${rejected.map(({ rel }) => rel).join(", ")}.`)
    let continuation: true | undefined
    let park: NonNullable<EndedBooking["intent"]>["park"]
    let artifact: { path: string; text: string } | undefined
    if (grant.kind !== "verify" && changes.some(({ rel }) => rel === handoff)) {
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
    if (grant.kind === "fix" && !continuation && changes.some(({ rel }) => rel !== gaps)) {
      // The old gap list is already durable in the verification commit. Its
      // removal is a driver effect, booked before mutation, so the reverify
      // turn can write identical FAIL evidence as a genuinely new artifact.
      if (!booking.retireGaps) {
        const original = await git(checkout, ["ls-tree", base, "--", gaps])
        if (original.code !== 0 || !original.out) return blocked("The landed fix input is missing from Git.")
        booking = { ...booking, retireGaps: true }
        entry = await book(entry, booking)
      }
      await rm(join(checkout, gaps), { force: true })
      status = await workspaceStatus(checkout, roots)
      if (!status) return { kind: "blocked", reason: "commitFailed", detail: "Git status is unreadable after retiring the gap list." }
      changes = reportedChanges(entry, status)
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
      const stage = rows.filter(({ status }) => status[1] !== " ").map(({ rel }) => `:(literal)${prefix ? rel.slice(prefix.length + 1) : rel}`)
      if (stage.length) await gitRead(root, "add", "-A", "--", ...stage)
      const rootTree = await gitRead(root, "write-tree")
      const diff = await git(root, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", rootBase || EMPTY_TREE, rootTree])
      const staged = diff.out.split("\0").filter(Boolean)
      const observed = new Set(rows.map(({ rel }) => (prefix ? rel.slice(prefix.length + 1) : rel)))
      if (diff.code !== 0 || staged.some((path) => !observed.has(path) ||
          (!permitted(entry, prefix ? `${prefix}/${path}` : path) && !(booking.retireGaps && prefix === "" && path === gaps)))) {
        return blocked("The staged tree contains an unverified path. Inspect the index before replaying.")
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
        return blocked("The new commit differs from the booked share. Inspect Git history before resuming.")
      }
      if (share.root === checkout) landed = head
    }
    return finishShare(landed, evidence)
  }

  async function closeVerified(entry: Entry, booking: EndedBooking, intent: CloseIntent): Promise<Receipt> {
    const grant = entry.grant
    const block = (detail: string): BlockedReport => ({ kind: "blocked", reason: "isolation", detail })
    if (grant.kind !== "verify") return block("A close-out has no verification grant.")
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
          return workspaceBlock(error)
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
      return block("HEAD moved outside the booked task close-out.")
    }
    const [todo, oldIndex, oldGaps, status] = await Promise.all([
      git(dir, ["show", `${intent.share}:${pending}`]),
      git(dir, ["show", `${intent.share}:${index}`]),
      git(dir, ["show", `${intent.share}:${gaps}`]),
      workspaceStatus(dir),
    ])
    if (oldGaps.code === 0) paths.add(gaps)
    if (todo.code !== 0 || oldIndex.code !== 0 || !status || reportedChanges(entry, status).some(({ rel }) =>
      !paths.has(rel)
    )) return block("Inspect unexpected workspace changes before replaying task close-out.")

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
      return block("The task documents no longer match the close-out's before or after state.")
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
    if (!changed || reportedChanges(entry, changed).some(({ rel }) => !paths.has(rel))) {
      return block("Unexpected workspace changes appeared during task close-out.")
    }
    const prepare = changed.filter(({ rel, status }) => paths.has(rel) && status[1] !== " ").map(({ rel }) => `:(literal)${rel}`)
    if (prepare.length) await gitRead(dir, "add", "-A", "--", ...prepare)
    const tree = await gitRead(dir, "write-tree")
    const diff = await git(dir, ["diff-tree", "--no-commit-id", "--name-only", "--no-renames", "-r", "-z", head, tree])
    const staged = diff.out.split("\0").filter(Boolean)
    if (diff.code !== 0 || staged.length !== paths.size || staged.some((path) => !paths.has(path)) ||
        (intent.tree && intent.tree !== tree)) {
      return block("The staged task close-out differs from the expected rename and tick.")
    }
    const [stagedDoc, stagedIndex, stagedGaps] = await Promise.all([
      git(dir, ["show", `${tree}:${complete}`]),
      git(dir, ["show", `${tree}:${index}`]),
      git(dir, ["ls-tree", `${tree}`, "--", gaps]),
    ])
    if (stagedGaps.code !== 0 || stagedGaps.out || stagedDoc.code !== 0 || !sameDocument(stagedDoc.out, todo.out) || stagedIndex.code !== 0 || !sameDocument(stagedIndex.out, nextIndex)) {
      return block("The staged task documents differ from the expected rename and tick.")
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
    if (witness !== `${intent.share}\n${tree}\n${commitMessage}`) return block("The task close-out commit differs from its booked changes.")
    return finish(landed)
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
    const prefix = step.kind === "fix" ? `${step.unit} fix ${step.round}.` : `${step.unit} exec `
    const completed = entries.filter(({ grant, booking }) => grant.id.startsWith(prefix) && booking?.receipt?.kind === "landed").length
    return `${prefix}${completed + 1}`
  }

  async function preview(at: number, last: Entry | null | undefined = entries.at(-1), task?: string, scoped = false): Promise<Decision> {
    if (last && live(last, at)) return leaseWait(last)
    const previous = last?.booking?.receipt
    const closedUnit = previous?.kind === "landed" && previous.closeCommit !== undefined
    if (last?.booking && (!previous || (previous.kind === "landed" && !closedUnit && !previous.continuation && !previous.parked))) {
      return { kind: "wait", reason: "in-flight", detail: "The previous share requires settlement or verification." }
    }

    // A failed, expired, or released lease can leave a continuation. Its
    // captured base and scope still govern every retained edit.
    if (last && last.grant.kind !== "execute" && !closedUnit) {
      return { kind: "wait", reason: "in-flight", detail: "The execute share has advanced to verification." }
    }
    const continuation = last && last.booking?.receipt?.kind !== "landed" ? last : undefined
    const handedOver = previous?.kind === "landed" && previous.continuation ? last : undefined
    const priorLanded = last?.grant.kind === "execute"
      ? entries.findLast(({ grant, booking }) =>
          grant.kind === "execute" && grant.unit === last.grant.unit &&
          booking?.receipt?.kind === "landed"
        )
      : undefined
    const priorHandoff = priorLanded?.booking?.receipt?.kind === "landed" && priorLanded.booking.receipt.continuation ? priorLanded : undefined
    const resumeUnit = (continuation ?? handedOver ?? priorHandoff)?.grant.unit
    const route = task ?? resumeUnit
    const checkout = last && !terminal(last) ? await openCheckout(last) : dir
    if (typeof checkout !== "string") return checkout
    const step = await readExecutorPreview(dir, resumeUnit, route ? { task: route, scoped } : undefined, checkout)
    if (step.kind !== "execute") return step
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
      if (!status || receipt?.kind !== "landed" || !(scoped && !handoff.worktree ? await knownHead(receipt.commit, head) : head === receipt.commit) ||
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
      if (!status || !(scoped && !continuation.worktree ? await knownHead(continuation.base, head) : head === continuation.base) ||
          reportedChanges(continuation, status).some(({ rel }) => !permitted(continuation, rel))) {
        return { kind: "blocked", reason: "isolation", detail: "The previous attempt's workspace needs inspection before continuation." }
      }
    }
    return step
  }

  async function menu(holder: Holder, at: number): Promise<Menu> {
    const leases = entries.filter((entry) => live(entry, at) && sameHolder(entry.holder, holder))
      .map(({ grant: { id: step, lease, kind, deadline, attempt } }) => ({ step, lease, kind, deadline, attempt }))
    if (leases.length) return { claimable: [], leases }
    const claimable: Menu["claimable"] = []
    const tasks = await scopeCandidates()
    const decisions = tasks.length
      ? await Promise.all(tasks.map(({ task }) => select(holder, at, undefined, task.id, tasks)))
      : [await select(holder, at)]
    for (const step of decisions) {
      if (step.kind === "execute" || step.kind === "verify" || step.kind === "fix") {
        claimable.push({
          unit: step.unit, title: step.title, kinds: [step.kind], ...(step.kind !== "verify" ? { touches: step.touches } : {}),
        })
      }
    }
    return { claimable, leases }
  }

  function withoutGrant(step: Decision): DerivedStep {
    return step.kind === "execute" || step.kind === "verify" || step.kind === "fix"
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
    if (!producer || receipt?.kind !== "landed" || (receipt.continuation || receipt.parked)) return nextWithoutGrant(at)
    if (booking?.outcome !== "ended" || !booking.intent || !producer.holder.token) {
      return { kind: "blocked", reason: "isolation", detail: "The landed share lacks durable producer provenance." }
    }
    const checkout = await openCheckout(producer)
    if (typeof checkout !== "string") return checkout
    const head = await gitRead(checkout, "rev-parse", "HEAD")
    const witness = await gitRead(checkout, "show", "-s", "--format=%P%n%T%n%B", receipt.commit)
    if (!(producer.scope && !producer.worktree ? await knownHead(receipt.commit, head) : head === receipt.commit) || witness !== `${booking.parent ?? producer.base}\n${booking.intent.tree}\n${shareMessage(producer.grant)}`) {
      return { kind: "blocked", reason: "isolation", detail: "The recorded execute share no longer matches Git history." }
    }
    if (producer.holder.token === holder.token) {
      return { kind: "wait", reason: "not-ready", detail: "Verification requires a different token from the execute share's producer." }
    }
    if (attempts(verifyID(producer.grant.unit)) >= MAX_ATTEMPTS) {
      return { kind: "blocked", reason: "attemptsExhausted", detail: `${producer.grant.unit} has reached the ${MAX_ATTEMPTS}-attempt verification limit.` }
    }
    const original = entries.find(({ grant, booking }) => grant.unit === producer.grant.unit &&
      grant.kind === "execute" && booking?.receipt?.kind === "landed"
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
    if (!(last.scope && !last.worktree ? await knownHead(expected, head) : head === expected)) {
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
    return receipt?.kind === "landed" && (receipt.closeCommit !== undefined || receipt.parked !== undefined)
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
    const needsFix = (result?.kind === "landed" && result.verdict === "fail") ||
      (last?.grant.kind === "fix" && (result?.kind !== "landed" || result.continuation))
    const needsVerification = (result?.kind === "landed" && !result.closeCommit && !result.continuation && !result.parked) ||
      (last?.grant.kind === "verify" && result?.kind !== "landed")
    if (kind === "execute" || (kind === undefined && !needsFix && !needsVerification)) return preview(at, last ?? null, task, scoped)

    return kind === "fix" || (kind === undefined && needsFix) ? fixing(at, last ?? null) : verification(holder, at, last ?? null)
  }

  async function select(holder: Holder, at: number, kind?: Grant["kind"], task?: string, candidates?: ScopedTask[]): Promise<Decision> {
    const last = entries.at(-1)
    const serial = serialReservation()
    if (serial && live(serial, at)) return leaseWait(serial)
    if (pendingReport()) return { kind: "wait", reason: "in-flight", detail: "A previous share requires settlement." }

    const pending = questions.filter((item) => !item.answer)
    if (pending.some((item) => sameHolder(item.asker, holder))) {
      return { kind: "wait", reason: "question", detail: "Your question is awaiting an answer." }
    }
    if (pending.length) return { kind: "wait", reason: "gate", detail: "A pending question requires a person decision." }

    if (pendingGate()) return { kind: "wait", reason: "gate", detail: "An approved gate release awaits settlement." }
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
      if (kind === undefined || kind === "execute") return preview(at, null, task)
      return { kind: "wait", reason: "not-ready", detail: `${task} has no ${kind} step to claim.` }
    }
    if (hasReservations || scopedTasks.length) {
      if (task) return scopedDecision(holder, at, kind, task, route)
      let wait: DerivedStep | undefined
      for (const scoped of scopedTasks) {
        const step = await scopedDecision(holder, at, kind, scoped.task.id, scoped)
        if (step.kind === "execute" || step.kind === "verify" || step.kind === "fix") return step
        wait ??= step
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
      const pending = pendingGate()
      if (pending) {
        const blocked = await settleGate(pending)
        if (blocked) return blocked
      }
      const step = await select(holder, now(), kind, task)
      if (step.kind !== "execute" && step.kind !== "verify" && step.kind !== "fix") return step
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
      if (step.kind !== "execute" && base !== step.head) {
        return { kind: "blocked", reason: "isolation", detail: "HEAD moved before the grant." }
      }
      const { touches, scope, worktree: _, ...work } = step.kind === "verify" ? { ...step, touches: undefined } : step
      const issued = now()
      const id = stepID(step)
      const grant: Grant = {
        ...work, id, lease: randomUUID(), attempt: attempts(id) + 1,
        workspace: workspace ? executorWorkspacePath(dir, workspace) : dir,
        deadline: issued + LEASE_WINDOW_MS, budget: EXECUTE_BUDGET_MINUTES,
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
    briefAnswers: (holder, task, after, kind) => serialize(async () => {
      const last = latest(task)
      if (!last || (kind !== undefined && last.grant.kind !== kind) || !sameHolder(last.holder, holder) || !live(last, now())) {
        throw new ExecutorRequestError("This channel has no live brief for the requested task.")
      }
      const all = applicableAnswers(holder, task)
      const cursor = after === undefined ? -1 : all.findIndex((answer) => answer.id === after)
      if (after !== undefined && cursor === -1) throw new ExecutorRequestError("The answer cursor does not belong to this brief.")
      const answers: BriefAnswer[] = []
      for (const answer of all.slice(cursor + 1)) {
        if (answers.length && Buffer.byteLength(JSON.stringify({ answers: [...answers, answer], next: answer.id })) > ANSWER_PAGE_BYTES) break
        answers.push(answer)
      }
      const next = cursor + 1 + answers.length < all.length ? answers.at(-1)?.id : undefined
      return { answers, ...(next && { next }) }
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
        const deadline = Math.min(at + LEASE_WINDOW_MS, entry.issued + MAX_LEASE_AGE_MS)
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
    question: (holder, text, target) => serialize(async () => {
      if (!text.trim() || Buffer.byteLength(text) > 8192) throw new ExecutorRequestError("A question must contain between 1 and 8192 bytes of text.")
      if (target) {
        const entry = lookup(target.step, target.lease)
        if (!live(entry, now()) || !sameHolder(entry.holder, holder) || entry.grant.unit !== target.task) {
          throw new ExecutorRequestError("A task question requires ownership of its live step and lease.")
        }
      }
      const task = target?.task
      const existing = questions.find((item) =>
        !item.answer && sameHolder(item.asker, holder) && item.task === task && item.text === text
      )
      if (existing) return { id: existing.id, state: "raised" }
      const id = randomUUID()
      await persistQuestions([...questions, { id, asker: { ...holder }, text, task, position: questions.length + gates.length }])
      return { id, state: "raised" }
    }),
    claimQuestion: (person) => serialize(async () => personStep(person)),
    claimPerson: (person) => serialize(() => nextPerson(person)),
    answerPerson: (person, id, decision, rationale) => serialize(async () => {
      if (questionAuthority(person) && questions.some((item) => item.id === id)) {
        await settleQuestion(person, id, decision, rationale)
      } else if (releaseAuthority(person) && gates.some((item) => item.id === id)) {
        const blocked = await approveGate(person, id, decision, rationale)
        if (blocked) return blocked
      } else {
        throw new ExecutorRequestError("The person grant does not authorize that item or the item was never issued.")
      }
      return nextPerson(person)
    }),
    answerQuestion: (person, id, decision, rationale) => serialize(async () => {
      await settleQuestion(person, id, decision, rationale)
      return personStep(person)
    }),
    claimGate: (person) => serialize(() => offerGate(person)),
    answerGate: (person, id, decision, rationale) => serialize(async () =>
      (await approveGate(person, id, decision, rationale)) ?? offerGate(person)),
    next: (holder) => serialize(async () => withoutGrant(await select(holder, now()))),
    busy: () => serialize(async () => entries.some((entry) => live(entry, now())) || pendingReport() !== undefined),
    async close() {
      closed = true
      await tail
      lock.release()
    },
  }
}
