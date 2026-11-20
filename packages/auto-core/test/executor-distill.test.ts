// The distill grant kind's lifecycle proof (plans/0277, 0256 stage 2's
// second convergence kind — the transfer advance's session work): the
// phase-boundary distillation session — the one that writes the phase's
// permanent handover document — rides the executor protocol beside its push
// twin. The claimable derivation (the handover route MINUS the push skip
// condition, held behind the person's human gate), the claim address (the
// phase's own qualified id — the durable record phase-shaped here), the
// fence's per-kind arm (the handover document alone), the settlement's
// mechanical collect (the push collect's own grammars — validHandover and
// the OPEN-status lint), and the ruled terminal shape (a landed share ends
// the unit — no verification share, the apply the person's transfer through
// the push path's own idempotent skip) all composed with the standing
// machinery: 0272's escalation over the never-set cause, the byte-identical
// floors for every state that is not the claimable boundary (P10).
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { HANDOVER_SECTIONS } from "../src/document/roles"
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

function commitFixture(dir: string) {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Fixture")
}

function project() {
  const dir = mkdtempSync(join(tmpdir(), "executor-distill-"))
  projects.push(dir)
  git(dir, "init")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  return dir
}

const PHASE = "docs/R-01/P01-implement"
const PHASES = "docs/R-01/phases.md"
const HANDOVER = `${PHASE}/handover.md`

// A valid phase handover document: the four mandatory sections as
// standalone headings (the push collect's own grammar).
const VALID_HANDOVER = ["# Handover", "", ...HANDOVER_SECTIONS.map((section) => `${section}\n\nDistilled content.\n`)].join("\n")

// The boundary fixture (the push dispatch's handover route): the phase's
// every task done, the phase itself incomplete in the index, no handover
// document yet — exactly the durable records the advance's distillation
// keys on. A second phase listed when `next` is asked for (the brief's
// next-recipient arm).
function boundaryProject(next = false) {
  const dir = project()
  write(dir, PHASES, next ? "# Phases\n\n- [ ] P01 implement\n- [ ] P02 design\n" : "# Phases\n\n- [ ] P01 implement\n")
  write(dir, `${PHASE}/todo.md`, "# Phase\n")
  if (next) write(dir, "docs/R-01/P02-design/todo.md", "# Phase\n")
  write(dir, `${PHASE}/tasks.md`, "# Tasks\n\n- [x] T-001 Ship the widget\n")
  write(dir, "docs/T-001/done.md", "# Ship the widget\n")
  commitFixture(dir)
  return dir
}

const worker = { token: "worker-1", channel: "solo" }
const verifier = { token: "verifier-1", channel: "verify" }

test("the boundary distillation is claimable distill work addressed by the phase's own qualified id", async () => {
  const dir = boundaryProject(true)
  expect(await readExecutorPreview(dir)).toMatchObject({
    kind: "distill",
    unit: "R-01.P01",
    title: "P01-implement Implementation",
    handover: HANDOVER,
  })
  const preview = await readExecutorPreview(dir)
  if (preview.kind !== "distill") throw new Error(JSON.stringify(preview))
  // The brief is the same derivation the push-side distillation session
  // reads: renderPhaseHandover — the handover path, the next phase's title
  // (the last phase's arm reads below), no other write named.
  expect(preview.prompt).toContain(HANDOVER)
  expect(preview.prompt).toContain("P02-design Design")

  const coordinator = await openExecutorCoordinator(dir)
  try {
    // The menu names the distill row (kinds exactly the new id, no touches —
    // the boundary declares none); a targeted kind ask for another kind
    // waits naming the mismatch; the untargeted claim takes the boundary's
    // step whatever its kind.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({
      claimable: [{ unit: "R-01.P01", title: "P01-implement Implementation", kinds: ["distill"] }],
    })
    expect(await coordinator.claim({ token: "reader", channel: "menu" }, "R-01.P01", "execute")).toMatchObject({
      kind: "wait", reason: "not-ready", detail: "R-01.P01 has no execute step to claim.",
    })
    const grant = await coordinator.claim(worker, "R-01.P01", "distill")
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    expect(grant).toMatchObject({
      kind: "distill", unit: "R-01.P01", attempt: 1, workspace: dir, handover: HANDOVER,
    })
    expect(grant.id).toBe("R-01.P01 distill 1")
    expect(grant.prompt).toContain(HANDOVER)
    // The lease is serial on the main tree: another channel waits on it.
    expect(await coordinator.claim(verifier)).toMatchObject({ kind: "wait", reason: "lease-held" })
    // The brief refresh replays the same grant.
    expect(await coordinator.brief(worker, "R-01.P01", "distill")).toMatchObject({ kind: "distill", id: grant.id, lease: grant.lease })
  } finally {
    await coordinator.close()
  }
})

test("the floor: every state that is not the claimable boundary is byte-identical", async () => {
  // Pending work: the standing execute row, no distill step.
  const dir = boundaryProject()
  rmSync(join(dir, "docs/T-001/done.md"))
  write(dir, `${PHASE}/tasks.md`, "# Tasks\n\n- [ ] T-001 Ship the widget\n")
  write(dir, "docs/T-001/todo.md", "# Ship the widget\n\n## Scope\n\nShip it.\n")
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "execute", unit: "T-001" })

  // A valid handover already on disk: the push skip condition — the boundary
  // step stands, the apply the person's transfer.
  const done = boundaryProject()
  write(done, HANDOVER, VALID_HANDOVER)
  commitFixture(done)
  expect(await readExecutorPreview(done)).toEqual({ kind: "phase-boundary", phase: "R-01.P01", problems: [] })

  // An open round never distills (0243 B: its phases never hand over).
  const open = project()
  write(open, PHASES, "# Phases\n\nKind: open\n\n- [ ] P01 implement\n")
  write(open, `${PHASE}/todo.md`, "# Phase\n")
  write(open, `${PHASE}/tasks.md`, "# Tasks\n\n- [x] T-001 Ship the widget\n")
  write(open, "docs/T-001/done.md", "# Ship the widget\n")
  commitFixture(open)
  expect(await readExecutorPreview(open)).toEqual({
    kind: "wait", reason: "not-ready", detail: "The open round has no pending tasks. Add work or close the round.",
  })

  const coordinator = await openExecutorCoordinator(done)
  try {
    const menu = await coordinator.ready({ token: "reader", channel: "menu" })
    expect(menu.claimable).toEqual([])
    for (const row of menu.claimable) expect(row.kinds).not.toContain("distill")
    // The types block carries the distill entry beside the standing six —
    // the additive growth, one rendering.
    expect(menu.types).toEqual(executorTypeCatalog())
    expect(Object.keys(menu.types)).toContain("distill")
  } finally {
    await coordinator.close()
  }
})

test("the person brackets: the human gate answers ahead of the distillation, the apply never claimable", async () => {
  // A survey-gated phase with open forks: the person's release gate — never
  // a distill step (the advance's own discipline, the human gate checked
  // first, ahead of any session).
  const dir = project()
  write(dir, ".opencode/auto/phases/survey.md", "# Survey\n\nGate: human\n\n## plan duties\n\nRead the sources.\n\n<!-- auto: eof -->\n")
  write(dir, PHASES, "# Phases\n\n- [ ] P01 survey\n")
  write(dir, "docs/R-01/P01-survey/todo.md", "# Phase\n")
  write(dir, "docs/R-01/P01-survey/tasks.md", "# Tasks\n\n- [x] T-001 Survey sources\n")
  write(dir, "docs/T-001/done.md", "# Survey sources\n")
  write(dir, "docs/R-01/P01-survey/survey.md", "# Survey\n\nFork: scope — widen coverage? Recommend: keep it narrow.\n")
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({
    kind: "human", gate: "survey-release", document: "docs/R-01/P01-survey/survey.md",
  })

  // The person's release lands; the distillation becomes claimable.
  write(dir, "docs/R-01/P01-survey/survey.md", "# Survey\n\nFork: scope — widen coverage? Recommend: keep it narrow.\n\nClarified: yes\n")
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "distill", unit: "R-01.P01", handover: "docs/R-01/P01-survey/handover.md" })
})

test("the lifecycle: the settlement lands the handover under the push stage word and the share is terminal — no verification, the apply the person's", async () => {
  const dir = boundaryProject()
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    // The session writes the handover document — the family's only surface.
    write(dir, HANDOVER, VALID_HANDOVER)
    const receipt = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    if (receipt.kind !== "landed") throw new Error(JSON.stringify(receipt))
    // The share commit carries the push distillation's own stage word — no
    // new stage vocabulary.
    expect(git(dir, "show", "-s", "--format=%B", receipt.commit)).toContain("Auto-Stage: phase-handover")
    expect(git(dir, "log", "--format=%s", "-1", receipt.commit)).toContain("R-01.P01 distill 1")

    // The landed share is terminal for the unit: no verify row ever derives
    // (D7's ruling — the boundary's content judgment the person's, the
    // wrap-up brief task-shaped and nonexistent here), the same token reads
    // the boundary step (never a settled terminal — that is the verify
    // producer's shape), and the boundary teaches the person's transfer.
    expect(await coordinator.ready({ token: "reader", channel: "menu" })).toMatchObject({ claimable: [] })
    expect(await coordinator.claim(worker)).toMatchObject({ kind: "phase-boundary", phase: "R-01.P01" })
    expect(await coordinator.claim(verifier, "R-01.P01", "verify")).toMatchObject({
      kind: "wait", reason: "not-ready", detail: "R-01.P01 has no verify step to claim.",
    })
    // The apply never happened coordinator-side: the completion shapes —
    // the phases index tick and the phase's todo.md → done.md rename — are
    // the person's transfer act (completePhase push-side).
    expect(readFileSync(join(dir, PHASES), "utf8")).toContain("- [ ] P01 implement")
    expect(readFileSync(join(dir, `${PHASE}/todo.md`), "utf8")).toBe("# Phase\n")
    expect(git(dir, "rev-list", "--count", `${base}..HEAD`).trim()).toBe("1")
  } finally {
    await coordinator.close()
  }

  // The push path composes through its own idempotent skip: the complete
  // document on a committed tree reads the boundary — exactly the
  // interrupted-handover shape (C.2) the advance already recovers.
  expect(await readExecutorPreview(dir)).toEqual({ kind: "phase-boundary", phase: "R-01.P01", problems: [] })
})

test("the fence: a never-set write escalates to the person (0272 composed); another phase's handover is refused replayable", async () => {
  const dir = boundaryProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    // The session edited the phase's own state file — a never-set path for
    // every grant kind (the completion rename the apply's alone).
    write(dir, `${PHASE}/todo.md`, "# Phase (edited)\n")
    write(dir, HANDOVER, VALID_HANDOVER)
    const blocked = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(blocked).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    expect(blocked.detail).toContain("Resolve out-of-scope edits before replaying: docs/R-01/P01-implement/todo.md.")
    expect(blocked.detail).toContain("The cause is outside this lease's permitted writes — a person must inspect the state")
    expect(blocked.detail).toContain("retrying cannot fix it")
    // No question item is raised (plans/0282): the plain blocked answer is
    // the whole surface, the pending list empty.
    expect((await coordinator.ready({ token: "reader", channel: "menu" })).pending).toEqual([])

    // Another phase's handover document: refused, but not never-set (no arm
    // of the standing table names it) — the plain blocked answer, the
    // holder's own remedy (remove the edit), replayable.
    write(dir, `${PHASE}/todo.md`, "# Phase\n")
    write(dir, "docs/R-02/P01-design/handover.md", VALID_HANDOVER)
    const replay = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(replay).toMatchObject({ kind: "blocked", reason: "isolation" })
    if (replay.kind !== "blocked") throw new Error(JSON.stringify(replay))
    expect(replay.detail).toContain("Resolve out-of-scope edits before replaying: docs/R-02/P01-design/handover.md.")
    expect(replay.detail).not.toContain("retrying cannot fix it")
  } finally {
    await coordinator.close()
  }
})

test("the collect: an invalid handover blocks replayable with the push collect's own grammars", async () => {
  const dir = boundaryProject()
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    // A handover missing its sections: the settlement's mechanical voice.
    write(dir, HANDOVER, "# Handover\n\nOnly prose, no protocol sections.\n")
    const invalid = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(invalid).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (invalid.kind !== "blocked") throw new Error(JSON.stringify(invalid))
    expect(invalid.detail).toContain("the handover distillation is invalid")
    expect(invalid.detail).toContain("## Key decisions")
    expect(invalid.detail).toContain("## Artifact index")

    // The OPEN-status lint (0082 §10 D13): an AUTO-RESOLVE marker under
    // "Constraints and pitfalls" is status laundering — the push collect's
    // own finding, the marker inside the section it lints.
    const lintDoc = ["# Handover\n\n"]
    for (const section of HANDOVER_SECTIONS) {
      lintDoc.push(`${section}\n\n${section === "## Constraints and pitfalls" ? "AUTO-RESOLVE: tabs — the provisional default stands\n" : "Distilled content.\n"}`)
    }
    write(dir, HANDOVER, lintDoc.join(""))
    const linted = await coordinator.report(worker, grant.id, grant.lease, "ended")
    expect(linted).toMatchObject({ kind: "blocked", reason: "commitFailed" })
    if (linted.kind !== "blocked") throw new Error(JSON.stringify(linted))
    expect(linted.detail).toContain("the handover distillation is invalid")
    expect(linted.detail).toContain("AUTO-RESOLVE")
    // Nothing landed: the coordinator wrote nothing.
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(base)

    // The valid document lands — the holder's remedy, a write inside its
    // own family.
    write(dir, HANDOVER, VALID_HANDOVER)
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
  } finally {
    await coordinator.close()
  }
})

test("a zero-write distill share reports without landing and the next attempt re-claims", async () => {
  const dir = boundaryProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toEqual({
      kind: "without-landing", reason: "zero-write",
    })
    const retry = await coordinator.claim(worker)
    expect(retry).toMatchObject({ kind: "distill", unit: "R-01.P01", attempt: 2 })
  } finally {
    await coordinator.close()
  }
})

test("a failed attempt's partial handover rides the continuation as the next attempt on the same phase unit", async () => {
  const dir = boundaryProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(worker)
    if (grant.kind !== "distill") throw new Error(JSON.stringify(grant))
    // A partial handover left uncommitted by a failed attempt: the retained
    // edit is the family's own write — the next claim (whatever token)
    // continues the unit over it, never the clean-tree block.
    write(dir, HANDOVER, "# Handover\n\nHalf distilled.\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "failed")).toMatchObject({
      kind: "without-landing", reason: "failed",
    })
    const resume = await coordinator.claim(verifier)
    if (resume.kind !== "distill") throw new Error(JSON.stringify(resume))
    expect(resume).toMatchObject({ kind: "distill", unit: "R-01.P01", id: "R-01.P01 distill 1", attempt: 2 })
    // The resumed share rewrites the document wholesale — the push reset's
    // protocol shape (the next attempt's document, never a diff).
    write(dir, HANDOVER, VALID_HANDOVER)
    expect(await coordinator.report(verifier, resume.id, resume.lease, "ended")).toMatchObject({ kind: "landed" })
  } finally {
    await coordinator.close()
  }
})
