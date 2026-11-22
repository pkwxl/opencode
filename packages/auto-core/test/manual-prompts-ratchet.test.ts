// The manual prompt ratchet (plans/0078): prompts/ is the manual suite —
// executor.md alone since plans/0296's slice 3 retired the push-era
// companions with the push CLI (run.md the master control and its
// run-task / run-verify / run-fix / run-handover / run-plan children,
// run-as-subtasks / resume-subtasks the subtask pipeline, plan-append the
// append planner, charter the greenfield discussion runbook — all teaching
// the push driver's flows, gone with them). The survivor is the executor
// protocol's manual floor: the runbook a coding-agent session claiming
// grants over the wire reads — host-neutral (any claimant's own host and
// model, nothing in the protocol provisioning one), ask-channel-free (the
// plain blocked answer the whole surface, plans/0282).
//
// The suite is prompt copy like templates/prompts/, but a separate carrier:
// no renderer assembles it, so nothing structural stops it from drifting
// from the wire — which it had (the `protocol: 1` literal and the question
// payload outliving the 0.1 preview wire and the ask channel's tombstone).
// This ratchet pins the protocol literals to the coordinator's own, in the
// constitution-ratchet pattern: the src anti-rot arm holds the canonical
// table against the producing code, the prompts arm holds the file to it,
// and the ruled divergences are pinned as explicit absence so reversing one
// is a conscious change that updates this file together with its ruling.
//
// plans/0203 rules the oracle boundary: the unit is the ruled relationship
// — the manual sentence, the retired defective sentence and the wire-side
// derivation producer held together (the coupling arms below), so a
// conscious change on either side trips this one file, which names the
// other side to carry with it. Scenario-execution machinery is declined
// there (prompt copy has no interpreter — a test-side re-statement would
// measure itself, never the prompt; the semantics' one behavior home is
// each producer's own suite); the named ceiling and the revisit trigger
// live in that ruling.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

const PROMPTS = resolve(import.meta.dir, "..", "prompts")
const SRC = resolve(import.meta.dir, "..", "src")
const DOCS = resolve(import.meta.dir, "..", "docs")

// The suite's pinned file set: a file added to prompts/ joins the ratchet
// consciously (this test fails until it is either listed or removed).
const FILES = ["executor.md"]

const text = (name: string) => readFileSync(join(PROMPTS, name), "utf8")
const src = (name: string) => readFileSync(join(SRC, name), "utf8")

describe("manual prompt ratchet", () => {
  test("the suite's file set is exactly the pinned one", () => {
    expect(readdirSync(PROMPTS).sort()).toEqual([...FILES].sort())
  })

  test("the executor prompt keeps work, recovery and settlement on their assigned channels", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    // The holder recovers the issued pair and resumes the existing grant.
    expect(executor).toContain("same channel's `menu.leases` with `ready` before trying another untargeted claim")
    expect(executor).toContain("If the menu shows a lease, claim again with its `kind` and the same channel.")
    expect(executor).toContain("A matching `id` and `lease` recovers the held brief.")
    expect(executor).toContain("Use the grant's `id` as request field `step` and retain its exact `lease`.")
    expect(coordinator).toContain("(kind === undefined || kind === held.grant.kind) && (task === undefined || task === held.grant.unit)")
    expect(coordinator).toContain("live(entry, at) && sameHolder(entry.holder, holder)")
    expect(coordinator).toContain("!requested.has(entry) || !sameHolder(entry.holder, holder) || !live(entry, at)")
    // A replay settles the original booking, while the next verification needs an independent producer.
    expect(executor).toContain("Retry a lost report or release with its original pair and the same report outcome.")
    expect(executor).toContain("a fresh agent context and a different token from the producer of the immediately preceding execute, fix, formulate, or audit share")
    expect(coordinator).toContain("entry.booking.outcome !== outcome")
    expect(coordinator).toContain("if (entry.booking.receipt) return entry.booking.receipt")
    // 0273 moved the same-token answer's rendering from the retired wait line
    // to the settled terminal; the independence test itself is the anchor.
    expect(coordinator).toContain("producer.holder.token === holder.token")
    // Only the coordinator can commit. The verifier's document scope is fixed.
    expect(executor).toContain("The coordinator owns staging, commits, and driver state.")
    expect(executor).toContain("Never run Git staging or commit operations.")
    expect(executor).toContain("Leave `.auto/`")
    expect(executor).toContain("Verification may write only the task's report or gap list.")
    expect(coordinator).toContain('if (entry.grant.kind === "verify") return path === docs.report || path === docs.gaps')
    expect(executor).toContain("Start work only after the coordinator grants a lease for that task.")
    expect(executor).toContain("Use a separate channel for each concurrent worker and keep each worker inside its assigned workspace and scope.")
    expect(executor).not.toMatch(/\bgit\s+(?:add|commit|reset|stash)\b|Auto-Stage:/)
  })

  test("the hub chooses the child by kind and preserves single-writer ownership across rotation (0275)", () => {
    const executor = text("executor.md")
    expect(executor).toContain("spawn the typed child for the granted kind")
    expect(executor).toContain("Use a hub-held grant when a child's turn can outlast a heartbeat")
    expect(executor).toContain("Use a self-serving channel when the child can renew throughout its turn")
    expect(executor).toContain("stop the child first, then report failed for work that began or release an unused grant")
    expect(executor).toContain("The operator decides when to rotate a hub session")
    expect(executor).toContain("end the session with its live grants riding to their deadlines")
    expect(executor).toContain("first duty in an inherited workspace is to stop any orphaned child")
    expect(executor).toContain("Recover through `menu.leases` on the same token and channel before dispatching another writer")
  })

  // plans/0269 (enacting plans/0261 D2/D4/D5): the restriction catalog's 0203
  // both-sides ratchet — the wire `types` block, the fence's permitted-set
  // tables and executor.md's catalog sentence are one ruled relationship, so
  // a change to the fence's grammar cannot land without the catalog and the
  // prompt line moving with it. The derivation's behavioral proof lives in
  // test/executor-catalog.test.ts (the catalog proven equal to
  // permitted/driverExclusive over a path corpus, both directions, the
  // absent-block floor beside); this arm pins the two copy-bearing sides to
  // each other — the manual sentence beside the standing per-kind teaching
  // pinned above, and the producer's derivation anchors (the ids satisfy the
  // grant kinds, the never grammar rendered from the never-list constants'
  // own sources, the artifact paths through taskDocPaths, the block riding
  // the menu).
  test("the catalog: executor.md's sentence and the wire's types block are pinned together (plans/0269)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    // The manual sentence (0261 D4's catalog half): the block states the
    // restrictions, provisioning them is the operator's affair, the
    // coordinator's boundary checks the authority either way — the catalog
    // type-level only, per-unit scope riding touches/workspace.
    expect(executor).toContain("The `types` block on `ready`'s menu states each work type's restrictions in machine-readable form")
    expect(executor).toContain("per-unit scope riding the menu's `touches` and the grant's `workspace`")
    expect(executor).toContain("Provisioning against it — sub-agent templates, sandbox allowlists, or nothing — is the operator's affair")
    expect(executor).toContain("the coordinator's boundary checks are the authority either way")
    // The driver-side producer: one rendering derived from the fence's own
    // tables — never a second hand-maintained list (P5/P7). The formulate id
    // joined with its own enactment (0276, 0261 D2's id-growth letter); the
    // distill id with 0277's, the audit id with 0278's.
    expect(coordinator).toContain("const WORK_TYPE_IDS = [\"execute\", \"verify\", \"fix\", \"formulate\", \"synthesize\", \"distill\", \"audit\"] as const satisfies readonly Grant[\"kind\"][]")
    expect(coordinator).toContain("export function executorTypeCatalog(): ExecutorTypes {")
    expect(coordinator).toContain("UNIT_STATE_DOC.source")
    expect(coordinator).toContain("taskDocPaths(CATALOG_UNIT).handoff")
    expect(coordinator).toContain("const GIT_LETTER = \"coordinator-only\"")
    expect(coordinator).toContain("const types = executorTypeCatalog()")
  })

  // plans/0276 (0256 stage 2's first convergence kind): the formulate grant
  // kind's 0203 both-sides arm — the executor.md item-2 sentences, the
  // fence's family table and the catalog's formulate letter are one ruled
  // relationship, so the kind's write boundary cannot drift on one side.
  // The behavioral proof lives in test/executor-catalog.test.ts (the letter
  // equal to the family arm over the corpus, both directions) and
  // test/executor-formulate.test.ts (the lifecycle); this arm pins the
  // copy-bearing sides to the producer's anchors.
  test("the formulate kind: executor.md's sentences and the fence's family arm are pinned together (plans/0276)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    const steps = src("executor-steps.ts")
    // The enumeration and the write letter: the family named in prose, the
    // input todo's exclusion taught, the driver's close-out shapes refused.
    // (0277 grew the enumeration with distill and 0278 with audit; the
    // sentence anchor moved with each — the standing moved-anchor
    // discipline.)
    expect(executor).toContain("For `execute`, `verify`, `fix`, `formulate`, `synthesize`, `distill`, or `audit`, work in the returned `workspace` and follow `prompt`.")
    expect(executor).toContain("Formulation may write only the granted phase's planning documents — the `index` path the grant names, the planned tasks' `todo.md` files, and its coverage map and handoff")
    expect(executor).toContain("never its own input `todo.md`, and never a `done.md`, a tick, or a rename")
    // The producer's anchors: the family table and the exclusion, the
    // catalog's formulate letter and its never rendering, the derivation's
    // predicate and the grant's carried identity.
    expect(coordinator).toContain("const PENDING_PLAN_DOC = /^docs\\/T-\\d+\\/todo\\.md$/")
    expect(coordinator).toContain("path !== taskStatePaths(entry.grant.unit).pending")
    expect(coordinator).toContain("DONE_STATE_DOC_SOURCE")
    expect(coordinator).toContain("CATALOG_PHASE_INDEX")
    // 0280 moved the shareMessage ternary into SHARE_STAGE_OF_KIND (the
    // protocol-doc ratchet's table) — the pin moved with it, the standing
    // moved-anchor discipline: the kind's stage word stays coupled to the
    // executor.md enumeration.
    expect(coordinator).toContain('formulate: "phase-formulate",')
    expect(steps).toContain("awaitingFormulation(plan.tasks, phase)")
    expect(steps).toContain("followUp: true")
    expect(steps).toContain("kind: \"formulate\"")
  })

  // plans/0277 (0256 stage 2's second convergence kind, the transfer
  // advance's session work): the distill grant kind's 0203 both-sides arm —
  // the executor.md item-2 sentences, the fence's per-kind arm and the
  // catalog's distill letter are one ruled relationship, so the kind's write
  // boundary cannot drift on one side. The behavioral proof lives in
  // test/executor-catalog.test.ts (the letter equal to the fence over the
  // corpus, both directions) and test/executor-distill.test.ts (the
  // lifecycle); this arm pins the copy-bearing sides to the producer's
  // anchors.
  test("the distill kind: executor.md's sentences and the fence's per-kind arm are pinned together (plans/0277)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    const steps = src("executor-steps.ts")
    // The enumeration and the write letter: the family named in prose — the
    // granted handover path alone, the completion shapes refused, the
    // person's transfer act named, the landed share terminal (no
    // verification share follows the distillation).
    expect(executor).toContain("For `execute`, `verify`, `fix`, `formulate`, `synthesize`, `distill`, or `audit`, work in the returned `workspace` and follow `prompt`.")
    expect(executor).toContain("Distillation may write only the granted phase's `handover` document — the path the grant names, its four protocol sections")
    expect(executor).toContain("the boundary's completion shapes (the rename, the tick, the transition) stay the person's `transfer` act")
    expect(executor).toContain("a landed distillation ends the unit — no verification share follows it")
    // The producer's anchors: the fence's per-kind arm keyed on the carried
    // handover path, the catalog's placeholder anchor, the stage word (the
    // push distillation commit's own), the derivation's boundary predicate
    // and the landed-receipt terminal the preview reads.
    expect(coordinator).toContain('if (entry.grant.kind === "distill") return path === entry.grant.handover')
    expect(coordinator).toContain("CATALOG_PHASE_HANDOVER")
    // 0280 moved the shareMessage ternary into SHARE_STAGE_OF_KIND — the
    // pin moved with it (the kind's stage word stays coupled to the
    // executor.md sentences).
    expect(coordinator).toContain('distill: "phase-handover",')
    expect(coordinator).toContain("async function distillationProblems(checkout: string, grant: Extract<Grant, { kind: \"distill\" }>): Promise<string[]> {")
    // 0289 inserted the person-closed facet into the closed-unit predicate
    // (the completion ending a chain over a landed continuation) — the pin
    // re-keyed to the new shape, the distill terminal's own letter unchanged.
    expect(coordinator).toContain("previous.closeCommit !== undefined || previous.closed === \"person\" || last?.grant.kind === \"distill\"")
    expect(steps).toContain("kind: \"distill\"")
    expect(steps).toContain("phaseHandoverDoc(phase)")
    expect(steps).toContain("!current.handoverValid")
  })

  // plans/0278 (0256 stage 2's third and final convergence kind): the audit
  // grant kind's 0203 both-sides arm — the executor.md item-2 sentences, the
  // fence's per-kind arm and the catalog's audit letter are one ruled
  // relationship, so the kind's write boundary cannot drift on one side.
  // The behavioral proof lives in test/executor-catalog.test.ts (the letter
  // equal to the fence over the corpus, both directions) and
  // test/executor-audit.test.ts (the lifecycle — the no-fix rule pinned
  // there); this arm pins the copy-bearing sides to the producer's anchors.
  test("the audit kind: executor.md's sentences and the fence's per-kind arm are pinned together (plans/0278)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    const steps = src("executor-steps.ts")
    // The enumeration and the write letter: the granted findings path alone
    // beside the handoff, the verdict grammar named, the FAIL routed to the
    // person with no fix ever spinning off the audit, the round's close the
    // person's act — and the independence sentence naming the audit
    // producer (a verification share follows it).
    expect(executor).toContain("For `execute`, `verify`, `fix`, `formulate`, `synthesize`, `distill`, or `audit`, work in the returned `workspace` and follow `prompt`.")
    expect(executor).toContain("The close audit may write only the granted unit's `findings` document — the path the grant names, one section per due row with the row's id in its heading, the document ending with its `Result: PASS` or `Result: FAIL` line — and the unit's handoff")
    expect(executor).toContain("a FAIL is a finding for the person routed at the round's close — no fix ever spins off the audit itself")
    expect(executor).toContain("the round's close stays the person's `transfer` act")
    expect(executor).toContain("a fresh agent context and a different token from the producer of the immediately preceding execute, fix, formulate, or audit share")
    // The producer's anchors: the fence's per-kind arm keyed on the carried
    // findings path beside the handoff, the fix context arm, the catalog's
    // placeholder anchor, the stage word (the push family's own
    // `close-audit`), the derivation's marker-field branch and its carried
    // identity, the settlement's collect.
    expect(coordinator).toContain('if (entry.grant.kind === "audit") return path === entry.grant.findings || path === docs.handoff')
    expect(coordinator).toContain('if (entry.grant.kind === "fix" && entry.grant.findings !== undefined && path === entry.grant.findings) return true')
    expect(coordinator).toContain("CATALOG_TASK_FINDINGS")
    expect(coordinator).toContain('audit: "close-audit",')
    expect(coordinator).toContain("async function auditProblems(dir: string, grant: Extract<Grant, { kind: \"audit\" }>): Promise<string[]> {")
    expect(steps).toContain("kind: \"audit\"")
    expect(steps).toContain("closeAuditFindingsDoc(task.id)")
  })

  // plans/0281 (0279's construction-determinized letter): the synthesize
  // grant kind's both-sides arm — the executor.md sentences (the reply
  // channel's write letter, the AUTO-shape remedy, the landed share
  // terminal) and the fence's per-kind arm / the derivation's assembly /
  // the settlement's composition are one ruled relationship.
  test("the synthesize kind: executor.md's sentences and the fence's reply channel are pinned together (plans/0281)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    const steps = src("executor-steps.ts")
    const synthesis = src("formulate-synthesis.ts")
    // The enumeration and the write letter: the channel named in prose, the
    // reply shape taught, the landing the driver's alone.
    expect(executor).toContain("Synthesis may write only the granted unit's own `todo.md` path")
    expect(executor).toContain("the driver parses the reply, validates it mechanically (every quote must locate in its named source), composes the real synthesized todo and lands the construction itself")
    expect(executor).toContain("A landed synthesis ends the unit's claim — no verification share follows it")
    // The producer's anchors: the fence's one-path arm, the catalog's
    // placeholder anchor, the stage word (the construction family's own
    // word with its own stage), the derivation's identical-prompt render
    // and the settlement's composition through the shared validation.
    expect(coordinator).toContain('if (entry.grant.kind === "synthesize") return path === taskStatePaths(entry.grant.unit).pending')
    expect(coordinator).toContain('synthesize: "phase-synthesize",')
    expect(coordinator).toContain("if (grant.kind === \"synthesize\") return settleSynthesis(entry, booking, checkout, head, base)")
    expect(steps).toContain("synthesizePromptText(state.synthesis.facts, {")
    expect(steps).toContain("checkSynthesisReply(replyText, assembly.seeded, assembly.sources)")
    // The shared homes: the push pipeline and the executor settlement read
    // the same assembly, the same prompt text, the same reply validation —
    // never a second home (P5).
    expect(synthesis).toContain("export function synthesisSources(")
    expect(synthesis).toContain("export function synthesizePromptText(")
    expect(synthesis).toContain("export function checkSynthesisReply(")
  })

  // plans/0270 (0264-04's fix): the fingerprint letter on the protocol
  // sentence. The ruled relationship is three-sided — the manual sentence,
  // the wire field, the identity's home — but two of the sides live in
  // packages/auto-server (src/version.ts the one home, the e2e pinning the
  // `build` field with the dev fallback and the stripped envelope floor);
  // this arm holds the manual side so the teaching cannot drift from the
  // ruled vocabulary (the additive-fields letter keeping the stop-and-ask
  // keyed on unknown protocols and step kinds, never on the additive field).
  // plans/0296's slice 3 re-keyed the sentence to the 0.1 preview wire
  // (0279's version ruling; the `protocol: 1` literal a tombstone) and the
  // step/menu payload pair (0282's ask-channel tombstone), the reply
  // envelope's literal pinned to EXECUTOR_PROTOCOL beside.
  test("the executor prompt's protocol sentence carries the wire version and the build fingerprint letter (plans/0270; re-keyed plans/0296)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("Successful responses carry `protocol: 0.1` — the preview wire — and one payload, `step` or `menu`")
    expect(coordinator).toContain("export const EXECUTOR_PROTOCOL = 0.1")
    // The retired literals must not return: the pre-0280 `protocol: 1` and
    // the ask channel's question payload are tombstones.
    expect(executor).not.toContain("`protocol: 1`")
    expect(executor).not.toContain("`question`")
    expect(executor).toContain("The `ready` response also carries `build`, the server's version and build commit")
    expect(executor).toContain("read it to detect a stale daemon")
    expect(executor).toContain("unknown extra fields are additive, not an unknown protocol")
    expect(executor).toContain("Stop and ask the operator to update the client if the protocol or a step kind is unknown")
  })

  // plans/0274 (0264-03's fix): the accepted act vocabulary named in the
  // executor prompt and the isolation walk's classifier held together — the
  // manual sentence teaches exactly what the machine passes (the person's
  // direct commits, no stage trailer, logged and passed) and what it still
  // refuses, so neither side can drift from the other.
  test("the executor prompt's act vocabulary and the isolation walk's classifier are pinned together (plans/0274)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("The person's direct commits — plain commits carrying none of the coordinator's stage trailers — may appear in the workspace's history between the executor's own shares")
    expect(executor).toContain("the protocol logs and passes them")
    expect(executor).toContain("Never author such a commit yourself — this prohibition is unchanged")
    expect(executor).toContain("an isolation block over any other unknown commit still means divergence")
    // The driver-side classifier: the wall's driverStage grammar inside the
    // walk's one home, and the log line that names what it passed.
    expect(coordinator).toContain("async function settledChain(at: string, base: string, head: string): Promise<string[] | undefined>")
    expect(coordinator).toContain("driverStage(body.out) !== undefined")
    expect(coordinator).toContain("the isolation walk passed")
  })

    // plans/0271 (0262-04's fix): the pending-items letter on the person
  // prompt, pinned beside the read surface's producer anchors — the menu's
  // pending list (kind and id for every reader, question text gated to the
  // same authority check the claim path reads) and the wait arm that names
  // pending gate existence. The wire side lives in the executor e2e and the
  // coordinator-side behavior in test/executor-steps.test.ts.
    // plans/0272 (0262-03's fix): the blocked settlement's escalation ladder
  // on the executor prompt, pinned beside the producer's anchors — the
  // settlement's raise through the standing channel (the dedup predicate's
  // one home, the mechanical text template, the never-set derivation and
  // the cause-site marker) and the one wire boundary that strips the
  // internal classification and names the ladder in the detail. The
  // behavior lives in test/executor-steps.test.ts; person.md untouched,
  // ruled (the raised item arrives through the standing question surface).
  // plans/0272's ladder, amended by 0282's no-ask-channel ruling: the
  // classification stays (neverSetRows/outsidePerimeter), the raise is gone
  // — the plain blocked answer naming the person-necessary cause is the
  // whole surface, the round waiting until a person looks at the state.
  test("the executor prompt names the blocked settlement's person-necessary cause plainly (plans/0272, amended by 0282)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("A `blocked` remedy that names a person-necessary cause puts it outside the lease's permitted writes")
    expect(executor).toContain("there is no ask channel (plans/0282)")
    expect(coordinator).toContain("function neverSetRows(")
    expect(coordinator).toContain("function outsidePerimeter(")
    expect(coordinator).toContain("The cause is outside this lease's permitted writes — a person must inspect the state; retrying cannot fix it.")
  })

  // plans/0273 (0264-05's fix): the settled-holder terminal on the executor
  // prompt, pinned beside the producer's anchors — the same-token verify
  // claim over a booked report answering with the additive `settled` step
  // kind naming the booked commit (the settlement's own evidence record),
  // the client's act reconcile-and-end, and the lost-report letter naming
  // the terminal as the lost response's reconciliation. The wire side lives
  // in the executor e2e (wireStep's rendering arm); the behavior — the
  // split, the live-share floor, the different-token independence — in
  // test/executor-steps.test.ts.
  test("the executor prompt names the settled-holder terminal (plans/0273)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("A `settled` step answers a claim from a token whose share's report was already accepted")
    expect(executor).toContain("reconcile against the commit and end the session")
    expect(executor).toContain("A `settled` answer to a same-token claim also reconciles a lost report response")
    expect(coordinator).toContain("kind: \"settled\", unit: producer.grant.unit, commit: receipt.commit,")
    expect(coordinator).toContain("This token's claim on ${producer.grant.unit} has ended")
  })

  // plans/0296's slice 3 (0295's remedy family 2 enacted): the ask-free
  // brief refresh — the question route's arms (the question request,
  // question.id, project-wide raises, deduplicate-while-pending) retired
  // from the manual with the wire's own tombstone (plans/0282), the brief
  // route surviving as the held grant's re-read alone. The answers paging
  // (answerCursor/cursor/answers[].next) died with the ask channel — the
  // coordinator's withAnswers reduced to the response-size bound — so the
  // manual carries neither the vocabulary nor the arms, pinned absent
  // beside the surviving route's producer anchor.
  test("the ask-free arms: the brief refresh stays, the question vocabulary never returns (plans/0282; re-keyed plans/0296)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("Refresh the live brief with `brief {\"task\":\"T-012\",\"kind\":\"execute\"}` on the same channel")
    expect(executor).toContain("a held lease is re-answered with the same grant for its holder")
    expect(coordinator).toContain("brief: (holder, task, kind) => serialize(async () => {")
    expect(coordinator).toContain("typeof checkout === \"string\" ? withAnswers(holder, last.grant) : checkout")
    // The ask channel's vocabulary must not return to the manual: no
    // question route, no answers paging.
    expect(executor).not.toContain("`question`")
    expect(executor).not.toContain("answerCursor")
    expect(executor).not.toContain("`answers`")
    expect(executor).not.toContain("`cursor`")
  })

  // plans/0294 (0290 F4d): the landed context's both-sides arm — the
  // executor.md item-2 sentence and the coordinator's grant-assembly attach
  // are one ruled relationship, so the field cannot drift from the letter.
  // The wire pass-through lives in packages/auto-server's wireStep (its
  // serialization suite pins the key carried and absent); the behavior —
  // the takeover reading its landed state from the grant — in
  // test/executor-continuation.test.ts.
  test("the landed context rides the execute grant over a unit with a landed share (plans/0294)", () => {
    const executor = text("executor.md")
    const coordinator = src("executor-coordinator.ts")
    expect(executor).toContain("An execute grant over a unit with a landed share carries `landed: { id, commit }`")
    expect(executor).toContain("the takeover or continuation holder reads its unit's already-landed state from the grant, not the tree")
    expect(executor).toContain("the key is absent on a fresh unit")
    expect(coordinator).toContain("grant.landed = { id: landed.grant.id, commit: landed.booking.receipt.commit }")
  })

  // plans/0296's slice 3 (0295's remedy family 1 + plans/0284's lifecycle):
  // the manual floor mirrors the standing spec — the host-neutrality letter
  // (the coordinator model-free, the claimant's host and model its own
  // affair) against docs/protocol.md's model-free coordinator letter, and
  // the projects letter (the directory-named creation, the parent the
  // anchor) against the spec's lifecycle letter. The daemon-side producer
  // lives in packages/auto-server (src/project-creation.ts); this arm holds
  // the two copy-bearing sides so neither drifts from the other.
  test("the manual floor mirrors the spec's model-free coordinator and lifecycle letters (plans/0284; plans/0296)", () => {
    const executor = text("executor.md")
    const doc = readFileSync(join(DOCS, "protocol.md"), "utf8")
    // The host-neutrality letter: the manual's statement and the spec's
    // model-free coordinator paragraph held together.
    expect(executor).toContain("The claimant's host and model are its own affair: any coding-agent session may claim a grant")
    expect(executor).toContain("nothing in the protocol presumes, provisions, or names a host")
    expect(doc).toContain("The coordinator is model-free")
    expect(doc).toContain("no grant kind implies a host")
    // The projects letter: the directory-named creation, the parent the
    // anchor, the basename the name — root retired with the declared-roots
    // gate, creation always mounted.
    expect(executor).toContain('`POST /projects` with `projects` takes `{"directory": "<absolute path>"}`')
    expect(executor).toContain("the request names the directory to create, its parent the anchor")
    expect(executor).toContain("the basename the project name, an optional `name` field overriding it")
    expect(executor).not.toContain("a declared root")
    expect(doc).toContain("the request names the directory to create")
    expect(doc).toContain("the destination's own parent the anchor")
  })

  test("protocol strings: the terminator", () => {
    for (const name of FILES) expect(text(name), name).toContain("<!-- auto: eof -->")
  })
})
