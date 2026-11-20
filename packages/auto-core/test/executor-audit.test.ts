// The audit grant kind's lifecycle proof (plans/0278, 0256 stage 2's third
// and final convergence kind — the close-audit session): the round's
// standing close-audit unit — the one the close arms construct when a
// round's close-due assurance rows lack adjudication receipts and no audit
// phase produces them — has its audit session work ride the executor
// protocol beside its push twin (`run` dispatching it through the ordinary
// pipeline). The claimable derivation (the marker field the constructor
// wrote, the construction itself the person's close attempt), the claim
// address (the standing unit's own task-shaped id), the fence's per-kind
// arm (the findings document beside the handoff), the settlement's
// mechanical collect (parseResult's receipt line and the adjudication
// gather's row-naming rule), the no-fix rule (a FAIL-finding audit spawns
// no fix grant — the findings surface through the round-close machinery as
// today), the independent verify share closing the unit (0276's ruling,
// the push closeout's wrap-up converged), and the floors for every state
// without a standing unit (P10) — all composed with the standing
// machinery: 0272's escalation over the never-set cause, 0273's settled
// terminal, the continuation handover, the verify-FAIL fix round carrying
// the findings context.
import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { ensureCloseAudit } from "../src/close-audit"
import { roundCloseProblems } from "../src/round-close"
import { readExecutorPreview } from "../src/executor-steps"
import { executorTypeCatalog, openExecutorCoordinator } from "../src/executor-coordinator"

const projects: string[] = []
afterEach(() => {
  for (const dir of projects.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function write(dir: string, path: string, text: string) {
  const file = join(dir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString()
}

function commitFixture(dir: string, message = "Fixture") {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", message)
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "executor-audit-"))
  projects.push(dir)
  git(dir, "init")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  return dir
}

// The assurance table this suite walks: one close-due judgment row
// (cadence every-round — due at every close regardless of the delta, the
// unit's own adjudication) — synthetic ids and phrases (P16).
const HEADER = "| id | invariant | kind | watched surface | cadence | close | baseline |"
const SEPARATOR = "| --- | --- | --- | --- | --- | --- | --- |"
const S_ROW = "| S-20 | clean-room independence | judgment | crossing events | every-round | close-due |  |"

const PHASE = "docs/R-01/P01-implement"
const PHASES = "docs/R-01/phases.md"
const INDEX = `${PHASE}/tasks.md`
const FINDINGS = "docs/T-002/findings.md"

// The closing round's shape the close arms key on (the open round's form,
// 0243 B: the phase never ticked, its every task done, the close listing
// filled) with the table declared — exactly the durable records
// ensureCloseAudit reads. `construct` runs the real close-arms write (the
// same function transfer's close arm calls), landing the standing unit on
// its own commit.
async function closingProject(opts: { table?: boolean; auditPhase?: boolean; construct?: boolean } = {}) {
  const dir = project()
  if (opts.auditPhase) {
    write(dir, join(".opencode", "auto", "phases", "audit.md"), ["# Spec audit", "", "Task-artifacts: findings.md", "", "## plan duties", "", "Audit the dimensions.", "", "<!-- auto: eof -->", ""].join("\n"))
  }
  write(dir, PHASES, `# Phases\n\nKind: open\n\n- [ ] P01 ${opts.auditPhase ? "audit" : "implement"}\n`)
  const phaseDir = opts.auditPhase ? "docs/R-01/P01-audit" : PHASE
  write(dir, join(phaseDir, "todo.md"), "# Phase\n")
  write(dir, join(phaseDir, "tasks.md"), "# Tasks\n\n- [x] T-001 task T-001\n")
  write(dir, "docs/T-001/done.md", "# T-001: task T-001\n")
  write(dir, "docs/R-01/round.md", "# Round R-01\n\n## Close\n\n- The round's work is restated in the target's own docs; nothing accepted as lost.\n")
  if (opts.table !== false) write(dir, "docs/assurance.md", [`# Assurance`, ``, HEADER, SEPARATOR, S_ROW].join("\n"))
  commitFixture(dir, "closing shape, the table declared")
  if (opts.construct) {
    const audit = await ensureCloseAudit(dir, 1)
    if (audit.type !== "constructed") throw new Error(`the close-audit unit did not construct: ${JSON.stringify(audit)}`)
  }
  return dir
}

// The audit session's valid findings document: one section per due row, the
// row's id in the section's heading, the result line as the last line of
// body text (the registered template's own grammar).
function findingsDoc(result: "PASS" | "FAIL") {
  return [
    "# Findings (T-002)",
    "",
    "## S-20 — the adjudicated row",
    "",
    "The round's delta raises nothing on this surface; the invariant holds first-hand (commit-read, path-checked).",
    "",
    result === "PASS" ? "Result: PASS" : "Result: FAIL the row does not hold at the closing tree",
    "",
  ].join("\n")
}

const worker = { token: "worker-1", channel: "solo" }
const verifier = { token: "verifier-1", channel: "verify" }
const PASS_REPORT = "# Verification\n\nThe findings document carries one section per due row, its verdict line last, and the adjudication cites what it examined.\n\nResult: PASS\n\n<!-- auto: eof -->\n"
const FAIL_GAPS = "# Verification\n\n## Gaps\n\n### Gap 1 — Name the second examined path\n\nThe findings section cites one path only.\n\nResult: FAIL the citation is thin\n"

test("the standing close-audit unit is claimable audit work addressed by its own unit id", async () => {
  const dir = await closingProject({ construct: true })
  expect(await readExecutorPreview(dir)).toMatchObject({
    kind: "audit",
    unit: "T-002",
    title: "Adjudicate the due assurance rows (R-01)",
    findings: FINDINGS,
    round: 1,
  })
  const preview = await readExecutorPreview(dir)
  if (preview.kind !== "audit") throw new Error(JSON.stringify(preview))
  // The brief is the same derivation the push-side audit session reads:
  // renderWhole over the standing unit, its todo (the registered
  // close-audit template's rendering) the single input.
  expect(preview.prompt).toContain("Adjudicate round R-01's close-due assurance rows")
  expect(preview.prompt).toContain("S-20 (clean-room independence)")

  const coordinator = await openExecutorCoordinator(dir)
  try {
    // The menu names the audit row (kinds exactly the new id, no touches);
    // a targeted kind ask for another kind waits naming the mismatch; the
    // untargeted claim takes the unit's step whatever its kind.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "T-002", title: "Adjudicate the due assurance rows (R-01)", kinds: ["audit"] }],
    })
    expect(await coordinator.claim({ token: "reader", channel: "menu" }, "T-002", "execute")).toMatchObject({
      kind: "wait", reason: "not-ready", detail: "T-002 has no execute step to claim.",
    })
    const grant = await coordinator.claim(worker, "T-002", "audit")
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    expect(grant).toMatchObject({
      kind: "audit", unit: "T-002", attempt: 1, workspace: dir,
      findings: FINDINGS, round: 1,
    })
    expect(grant.id).toBe("T-002 audit 1")
    // The lease is serial on the main tree: another channel waits on it.
    expect(await coordinator.claim(verifier)).toMatchObject({ kind: "wait", reason: "lease-held" })
    // The brief refresh replays the same grant.
    expect(await coordinator.brief(worker, "T-002", "audit")).toMatchObject({ kind: "audit", id: grant.id, lease: grant.lease })
  } finally {
    await coordinator.close()
  }
})

test("the floor and the person bracket: no standing unit, nothing due, or an audit phase is byte-identical — the close itself never claimable", async () => {
  // A closing round with the table declared but the person's close attempt
  // not yet run: the construction is the close arms' write (the person's
  // transfer), so nothing is claimable — the standing open-round wait, the
  // empty menu, byte-identical.
  const pending = await closingProject()
  expect(await readExecutorPreview(pending)).toEqual({
    kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round.",
  })
  const coordinator = await openExecutorCoordinator(pending)
  try {
    const menu = await coordinator.ready({ token: "reader", channel: "menu" })
    expect(menu.claimable).toEqual([])
    expect(await coordinator.claim(worker)).toMatchObject({
      kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round.",
    })
    // The types block carries the audit entry beside the standing six — the
    // additive growth, one rendering.
    expect(menu.types).toEqual(executorTypeCatalog())
    expect(Object.keys(menu.types)).toContain("audit")
  } finally {
    await coordinator.close()
  }

  // No table: the constructor keys nothing — the same standing wait.
  const bare = await closingProject({ table: false })
  expect(await ensureCloseAudit(bare, 1)).toEqual({ type: "none" })
  expect(await readExecutorPreview(bare)).toEqual({
    kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round.",
  })

  // An audit phase present: the round's findings' producer is the phase,
  // never a unit — the constructor's own shape key.
  const phased = await closingProject({ auditPhase: true })
  expect(await ensureCloseAudit(phased, 1)).toEqual({ type: "none" })
  expect(await readExecutorPreview(phased)).toEqual({
    kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round.",
  })
})

test("the lifecycle: the settlement lands the findings under the family's stage word, the verify share closes the unit, the push close composes over a PASS", async () => {
  const dir = await closingProject({ construct: true })
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    // The session writes the findings document — the family's one surface.
    write(dir, FINDINGS, findingsDoc("PASS"))
    const receipt = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    if (receipt.kind !== "landed") throw new Error(JSON.stringify(receipt))
    // The share commit carries the push family's own stage word (the
    // construction and baselines commits' own) — no new stage vocabulary.
    expect(git(dir, "show", "-s", "--format=%B", receipt.commit)).toContain("Auto-Stage: close-audit")
    expect(git(dir, "log", "--format=%s", "-1", receipt.commit)).toContain("T-002 audit 1")

    // The producer token's further claims read the settled terminal (0273
    // composed): its work on the unit has ended, a different token
    // performs the verification — 0278 D6's ruling, the push closeout's
    // wrap-up session converged.
    expect(await coordinator.claim(worker)).toMatchObject({
      kind: "settled", unit: "T-002", commit: receipt.commit,
    })
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "T-002", kinds: ["verify"] }],
    })
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-002/report.md", PASS_REPORT)
    const closed = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(closed).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD").trim() })
    // The close-out ticked the unit's row and renamed its todo — the
    // driver-exclusive shapes, the coordinator's alone.
    expect(existsSync(join(dir, "docs/T-002/done.md"))).toBe(true)
    expect(readFileSync(join(dir, INDEX), "utf8")).toContain("- [x] T-002")
  } finally {
    await coordinator.close()
  }

  // The push close composes over the landed findings: the adjudication
  // covers the due row, the round's close gate holds nothing (the baseline
  // citation and the close itself the person's transfer, never claimable).
  const close = await roundCloseProblems(dir, 1)
  expect(close.problems).toEqual([])
})

test("the no-fix rule: a FAIL-finding audit spawns no fix grant; the findings surface through the round-close machinery as today", async () => {
  const dir = await closingProject({ construct: true })
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    // The audit's FAIL: the share lands whatever the verdict — the FAIL
    // finding is the person's decision surface, never a repair input (the
    // template's own law, the red path's discipline).
    write(dir, FINDINGS, findingsDoc("FAIL"))
    const receipt = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    // No fix grant ever spins off the findings: the next step is the
    // standing verify share (the push closeout's own judgment), and a fix
    // ask answers a wait — never a fix grant (the audit share's landed
    // receipt carries no verdict, the funnel keyed on a landed verify
    // verdict cannot fire).
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "T-002", kinds: ["verify"] }],
    })
    const fixAsk = await coordinator.claim({ token: "fixer", channel: "fix" }, "T-002", "fix")
    expect(fixAsk.kind).not.toBe("fix")
    expect(fixAsk).toMatchObject({ kind: "wait" })
    // A compliant FAIL document passes the acceptance (both verdicts are
    // valid adjudications): the verify share passes, the close-out
    // completes — the unit done, the findings standing.
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-002/report.md", PASS_REPORT)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({
      kind: "landed", verdict: "pass",
    })
    expect(existsSync(join(dir, "docs/T-002/done.md"))).toBe(true)
  } finally {
    await coordinator.close()
  }

  // The findings surface through the round-close machinery exactly as
  // today: the row stays uncovered (only a PASS adjudicates), the gate's
  // remedy naming the standing unit's findings document — the person's
  // bracket, never a spawned repair.
  const close = await roundCloseProblems(dir, 1)
  expect(close.problems).toHaveLength(1)
  expect(close.problems[0]).toContain("S-20 (clean-room independence) is due at this close and uncovered")
  expect(close.problems[0]).toContain("the close-audit unit T-002 already ran — its findings document is the adjudication to read (a FAIL is a finding for the person, never repaired in-round)")
})

test("the fence: a never-set write escalates to the person (0272 composed); an out-of-family write is refused replayable", async () => {
  const dir = await closingProject({ construct: true })
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    // The session edited its own todo — a never-set path for every grant
    // kind (the close-out's alone).
    write(dir, "docs/T-002/todo.md", readFileSync(join(dir, "docs/T-002/todo.md"), "utf8").replace("## Goal", "## Edited goal"))
    write(dir, FINDINGS, findingsDoc("PASS"))
    const blocked = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(blocked).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    expect(blocked.detail).toContain("Resolve out-of-scope edits before replaying: docs/T-002/todo.md.")
    expect(blocked.detail).toContain("The cause is outside this lease's permitted writes — a person must inspect the state")
    expect(blocked.detail).toContain("retrying cannot fix it")
    // No question item is raised (plans/0282): the plain blocked answer is
    // the whole surface, the pending list empty.
    expect((await coordinator.ready({ token: "reader", channel: "menu" })).pending).toEqual([])

    // Another unit's findings document: refused, but not never-set (no arm
    // of the standing table names it) — the plain blocked answer, the
    // holder's own remedy (remove the edit), replayable. The per-unit
    // anchor names the one admitted findings document.
    const todo = readFileSync(join(dir, "docs/T-002/todo.md"), "utf8")
    write(dir, "docs/T-002/todo.md", todo.replace("## Edited goal", "## Goal"))
    write(dir, "docs/T-009/findings.md", findingsDoc("PASS"))
    const replay = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(replay).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (replay.kind !== "blocked") throw new Error(JSON.stringify(replay))
    expect(replay.detail).toContain("Resolve out-of-scope edits before replaying: docs/T-009/findings.md.")
    expect(replay.detail).not.toContain("retrying cannot fix it")
  } finally {
    await coordinator.close()
  }
})

test("the collect: findings missing the result line or a due row block replayable; the zero-write floor and re-claim", async () => {
  const dir = await closingProject({ construct: true })
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    // A zero-write share reports without landing — no adjudication to
    // judge — and the next attempt re-claims.
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toEqual({
      kind: "without-landing", reason: "zero-write",
    })
    const retry = await coordinator.claim(worker)
    if (retry.kind !== "audit") throw new Error(JSON.stringify(retry))
    expect(retry).toMatchObject({ kind: "audit", unit: "T-002", attempt: 2 })

    // A findings document with no result line: the receipt grammar is the
    // settlement's own voice, the holder's remedy, replayable.
    write(dir, FINDINGS, "# Findings (T-002)\n\n## S-20 — the adjudicated row\n\nProse only, no verdict line.\n")
    const invalid = await coordinator.report(worker, retry.id, retry.lease, "ended")
    expect(invalid).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (invalid.kind !== "blocked") throw new Error(JSON.stringify(invalid))
    expect(invalid.detail).toContain("the close-audit findings are invalid")
    expect(invalid.detail).toContain("must end with its adjudication's result line")

    // A findings document that parses but names no due row: the naming
    // linkage (the adjudication gather's own rule) — every row the round
    // owes, re-derived with this document excluded so the claim-time set
    // stands.
    write(dir, FINDINGS, "# Findings (T-002)\n\n## Some other row\n\nNothing owed here.\n\nResult: PASS\n")
    const unnamed = await coordinator.report(worker, retry.id, retry.lease, "ended")
    expect(unnamed).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (unnamed.kind !== "blocked") throw new Error(JSON.stringify(unnamed))
    expect(unnamed.detail).toContain("the close-audit findings are invalid")
    expect(unnamed.detail).toContain("missing: S-20 (clean-room independence)")
    // Nothing landed: the coordinator wrote nothing.
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(base)

    // The valid document lands — the holder's remedy, a write inside its
    // own family, whatever the verdict.
    write(dir, FINDINGS, findingsDoc("FAIL"))
    expect(await coordinator.report(worker, retry.id, retry.lease, "ended")).toMatchObject({ kind: "landed" })
  } finally {
    await coordinator.close()
  }
})

test("an audit share hands over and resumes as the next attempt on the same unit", async () => {
  const dir = await closingProject({ construct: true })
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    // A partial adjudication beside a `Status: continue` handoff: the share
    // lands as a continuation, and the next claim resumes the unit — the
    // execute continuation machinery joined, never a verification wait.
    write(dir, FINDINGS, findingsDoc("PASS"))
    write(dir, "docs/T-002/handoff.md", "# Handoff\n\nThe second due row's adjudication remains.\n\nStatus: continue\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "landed", continuation: true,
    })
    const resume = await coordinator.claim(worker)
    if (resume.kind !== "audit") throw new Error(JSON.stringify(resume))
    // The continuation opens a new step id (the landed audit shares
    // counted, the formulate numbering's shape), its attempt fresh.
    expect(resume).toMatchObject({ kind: "audit", unit: "T-002", id: "T-002 audit 2" })
    // The resumed brief carries the continuation teaching — the handoff the
    // successor reads first, the whole template's own letter.
    expect(resume.prompt).toContain("The previous session ended with a context-budget handover")
    expect(resume.prompt).toContain("docs/T-002/handoff.md")
  } finally {
    await coordinator.close()
  }
})

test("the verify FAIL opens the standing fix round carrying the findings context; the repaired document re-verifies and closes", async () => {
  const dir = await closingProject({ construct: true })
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "audit") throw new Error(JSON.stringify(grant))
    write(dir, FINDINGS, findingsDoc("PASS"))
    await coordinator.report(worker, grant.id, grant.lease, "ended")
    // The verify share's own FAIL — the push verify path's funnel, never
    // the audit's: the fix round repairs the document's acceptance.
    const verify = await coordinator.claim(verifier)
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-002/gaps.md", FAIL_GAPS)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({
      kind: "landed", verdict: "fail", gapCount: 1,
    })
    // The fix round over the audit unit carries the audit context — the
    // findings path on the grant, the family arm admitting the same
    // document the audit share wrote.
    const fix = await coordinator.claim({ token: "fixer", channel: "fix" })
    if (fix.kind !== "fix") throw new Error(JSON.stringify(fix))
    expect(fix).toMatchObject({ kind: "fix", unit: "T-002", round: 1, findings: FINDINGS })
    write(dir, FINDINGS, findingsDoc("PASS").replace("(commit-read, path-checked)", "(commit-read, path-checked, both named paths examined)"))
    expect(await coordinator.report({ token: "fixer", channel: "fix" }, fix.id, fix.lease, "ended")).toMatchObject({ kind: "landed" })
    // The gap list retired with the fix (the standing retireGaps shape);
    // the re-verification passes and the close-out completes.
    const reverify = await coordinator.claim({ token: "verifier-2", channel: "verify" })
    if (reverify.kind !== "verify") throw new Error(JSON.stringify(reverify))
    expect(reverify).toMatchObject({ kind: "verify", unit: "T-002" })
    write(dir, "docs/T-002/report.md", PASS_REPORT)
    expect(await coordinator.report({ token: "verifier-2", channel: "verify" }, reverify.id, reverify.lease, "ended")).toMatchObject({
      kind: "landed", verdict: "pass",
    })
    expect(readFileSync(join(dir, INDEX), "utf8")).toContain("- [x] T-002")
  } finally {
    await coordinator.close()
  }
})
