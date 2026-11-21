// The dead-letter reconciliation suite (0287, 0285's measured deadlock). A
// lease that died without a report — expired or released, never booked —
// over a unit the durable record already closed (the person's completion,
// the 0274 amendment class) stranded the lane totally: measured on the
// pre-fix tree, every claim — targeted and untargeted alike — answered the
// continuation's not-ready wait (`"T-001 is not ready."`, the field's
// `"T-006 is not ready."` byte-identical in shape) because the serial
// reservation emptied the scoped candidates and select's fallthrough routed
// every claim at the dead continuation; and the scoped flavor fenced every
// overlapping unit (`reserves an overlapping scope until settlement`). The
// sweep books the dead letter with the reconciled receipt at the head of
// the next serialized wire act — the pin self-clears, zero person acts
// beyond the completion the person already made.
import { afterEach, expect, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { openExecutorCoordinator } from "../src/executor-coordinator"

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function write(dir: string, path: string, text: string) {
  const file = join(dir, path)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

function git(dir: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", dir, ...args])
  if (result.exitCode) throw new Error(result.stderr.toString())
  return result.stdout.toString().trim()
}

const index = "docs/R-01/P01-implement/tasks.md"
const worker = { token: "worker", channel: "work" }
const peer = { token: "peer", channel: "other" }
const person = ["-c", "user.name=Person", "-c", "user.email=person@example.invalid"]
const pass = "# Verification\n\nThe changed source implements the task and leaves the other declared scopes intact.\n\nResult: PASS\n\n<!-- auto: eof -->\n"

// The field's own shape (0285): the dead unit declares no Touches — the
// serial same-tree floor, the formulation-planning unit — with doc-tier
// units standing behind it.
function project() {
  const dir = mkdtempSync(join(tmpdir(), "executor-dead-letter-"))
  roots.push(dir)
  git(dir, "init")
  git(dir, "config", "user.name", "Executor test")
  git(dir, "config", "user.email", "executor@example.invalid")
  write(dir, ".gitignore", "/.auto/\n")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, "docs/T-001/todo.md", "# Task 1\n\nDepends: none\n\n## Scope\n\nDo it.\n")
  write(dir, "docs/T-002/todo.md", "# Task 2\n\nDepends: none\nTouches: docs/T-002/notes.md\n\n## Scope\n\nDo it.\n")
  write(dir, "docs/T-003/todo.md", "# Task 3\n\nDepends: none\nTouches: docs/T-003/notes.md\n\n## Scope\n\nDo it.\n")
  write(dir, index, "# Tasks\n\n- [ ] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
  git(dir, "add", ".")
  git(dir, "commit", "-m", "Fixture")
  return dir
}

// The person's completion amendment (0274's class): exactly the marks the
// dead session owed — the index tick and the todo→done rename — committed
// as the person's own act.
function personComplete(dir: string, unit: string, ticked: string) {
  write(dir, index, ticked)
  git(dir, "mv", `docs/${unit}/todo.md`, `docs/${unit}/done.md`)
  git(dir, "add", "--", index)
  git(dir, ...person, "commit", "-m", `person: complete ${unit} the killed session left open`)
}

type Coordinator = Awaited<ReturnType<typeof openExecutorCoordinator>>
type Grant = Extract<Awaited<ReturnType<Coordinator["claim"]>>, { lease: string }>

async function claim(coordinator: Coordinator, actor: typeof worker, unit?: string) {
  const result = await coordinator.claim(actor, unit, "execute")
  if (!("lease" in result) || result.kind !== "execute") throw new Error(JSON.stringify(result))
  return result
}

function ledger(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".auto/executor-progress.json"), "utf8")) as { grant: { id: string; unit: string }; booking?: { receipt?: { kind: string; by?: string } } }[]
}

test("a person-completed unit's expired unbooked lease reconciles at the next wire act and the lane resumes", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const dead = await claim(coordinator, worker, "T-001")
    // The holder dies before any report; the lease expires.
    await coordinator.close()
    clock = dead.deadline + 1
    personComplete(dir, "T-001", "# Tasks\n\n- [x] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    // The menu read — the first wire act — sweeps: the dead letter books,
    // the units behind list claimable (the pre-fix menu answered the silent
    // claimable: [] beside these very units).
    const menu = await coordinator.ready(peer)
    expect(menu.claimable.map(({ unit }) => unit)).toEqual(["T-002", "T-003"])
    expect(menu.pending).toEqual([])
    expect(ledger(dir)[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-completion" })
    expect(printed.join("\n")).toContain("reconciled the dead lease T-001 exec 1 on T-001")
    expect(printed.join("\n")).toContain("the never-reported share stays unbooked")
    // The untargeted claim grants the next unit — the pin self-cleared.
    const next = await claim(coordinator, peer)
    expect(next.unit).toBe("T-002")
    // The targeted claim behind it grants too (the pre-fix flavor answered
    // the dead continuation's not-ready wait for targeted and untargeted
    // alike).
    const third = await claim(coordinator, { token: "third", channel: "lane" }, "T-003")
    expect(third.unit).toBe("T-003")
    // Idempotent: a further act books nothing more, logs nothing more.
    const before = printed.length
    await coordinator.ready(peer)
    expect(printed.length).toBe(before)
    expect(ledger(dir).filter(({ booking }) => booking?.receipt?.kind === "reconciled")).toHaveLength(1)
    // The dead holder's late report is answered with the reconciliation
    // truth — whatever outcome it claims (the lease died unreported).
    expect(await coordinator.report(worker, dead.id, dead.lease, "failed")).toEqual({ kind: "reconciled", by: "person-completion" })
    // The lane completes over the reconciliation: T-002 and T-003 settle
    // through the ordinary shares.
    write(dir, "docs/T-002/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    const secondShare = await coordinator.report(peer, next.id, next.lease, "ended")
    expect(secondShare).toMatchObject({ kind: "landed" })
    const verify = await coordinator.claim({ token: "verifier", channel: "verify" }, "T-002", "verify")
    if (!("lease" in verify) || verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-002/report.md", pass)
    expect(await coordinator.report({ token: "verifier", channel: "verify" }, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, index), "utf8")).toContain("- [x] T-002")
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})

test("a person-completed unit's scoped dead lease releases its fence for overlapping units", async () => {
  const dir = project()
  // The scoped flavor: the dead unit declares a Touches scope the unit
  // behind it shares — the pre-fix fence answered every overlap with
  // "reserves an overlapping scope until settlement".
  write(dir, "docs/T-001/todo.md", "# Task 1\n\nDepends: none\nTouches: docs/spec/read.md\n\n## Scope\n\nDo it.\n")
  write(dir, "docs/T-002/todo.md", "# Task 2\n\nDepends: none\nTouches: docs/spec/read.md\n\n## Scope\n\nDo it.\n")
  git(dir, "add", "--", "docs/T-001/todo.md", "docs/T-002/todo.md")
  git(dir, "-c", "user.name=Fix", "-c", "user.email=fix@example.invalid", "commit", "-m", "Overlapping scopes")
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const dead = await claim(coordinator, worker, "T-001")
    await coordinator.close()
    clock = dead.deadline + 1
    personComplete(dir, "T-001", "# Tasks\n\n- [x] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    const next = await claim(coordinator, peer, "T-002")
    expect(next.unit).toBe("T-002")
    expect(ledger(dir)[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-completion" })
  } finally {
    await coordinator.close()
  }
})

test("a released dead lease over a person-completed unit reconciles the same way", async () => {
  const dir = project()
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const dead = await claim(coordinator, worker, "T-001")
    // The holder surrenders live without a report; the person completes.
    await coordinator.release(worker, dead.id, dead.lease)
    await coordinator.close()
    personComplete(dir, "T-001", "# Tasks\n\n- [x] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    const next = await claim(coordinator, peer)
    expect(next.unit).toBe("T-002")
    expect(ledger(dir)[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-completion" })
  } finally {
    await coordinator.close()
  }
})

test("a live lease is never the sweep's — the person's mid-lease completion surfaces as the menu's held row", async () => {
  const dir = project()
  let clock = 1
  const coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    await claim(coordinator, worker, "T-001")
    // The person completes the unit while the lease stands: the sweep
    // declines (P12 — the lease's own machinery owns it), the fence holds,
    // and the menu answers the held row instead of a silent empty list
    // (0287's honesty letter).
    personComplete(dir, "T-001", "# Tasks\n\n- [x] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
    const menu = await coordinator.ready(peer)
    expect(menu.claimable).toEqual([])
    expect(menu.pending).toContainEqual({
      kind: "wait", reason: "lease-held", detail: expect.stringContaining("channel work") && expect.any(String),
    })
    expect(ledger(dir).every(({ booking }) => booking === undefined)).toBe(true)
  } finally {
    await coordinator.close()
  }
})

test("a dead lease whose unit stands open is the takeover's, never the sweep's", async () => {
  const dir = project()
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const dead = await claim(coordinator, worker, "T-001")
    await coordinator.close()
    clock = dead.deadline + 1
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    // The unit is still open: the designed recovery routes a successor at
    // the same step (the continuation), and the automatic sweep declines.
    const retry = await claim(coordinator, peer)
    expect(retry.unit).toBe("T-001")
    expect(retry.id).toBe(dead.id)
    expect(retry.attempt).toBe(2)
    expect(ledger(dir)[0]!.booking).toBeUndefined()
  } finally {
    await coordinator.close()
  }
})

test("the reconcile act: the forced arm books a dead lease by name, refuses live leases, and answers nothing-to-do honestly", async () => {
  const dir = project()
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    // Nothing dead: the honest nothing-to-reconcile line, no writes.
    expect(await coordinator.reconcile()).toEqual({ lines: [expect.stringContaining("nothing to reconcile")] })
    const dead = await claim(coordinator, worker, "T-001")
    await coordinator.close()
    clock = dead.deadline + 1
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    // The unit stands open: the automatic arm declines, the person's named
    // arm books it.
    const swept = await coordinator.reconcile()
    expect(swept.lines).toEqual([expect.stringContaining("nothing to reconcile")])
    const forced = await coordinator.reconcile("T-001")
    expect(forced.lines).toEqual([expect.stringContaining("reconciled the dead lease T-001 exec 1 on T-001")])
    expect(ledger(dir)[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-reconcile" })
    // Idempotent: the second call finds nothing.
    expect(await coordinator.reconcile("T-001")).toEqual({ lines: [expect.stringContaining("nothing to reconcile")] })
    // A fresh claim re-grants the still-open unit past the dead letter.
    const retry = await claim(coordinator, peer)
    expect(retry.unit).toBe("T-001")
    expect(retry.attempt).toBe(2)
    // A live lease of a named unit refuses (P20: control changes land at
    // safe boundaries).
    await expect(coordinator.reconcile("T-001")).rejects.toThrow("holds a live lease")
    // A unit with no lease answers the honest no-lease line.
    expect(await coordinator.reconcile("T-016")).toEqual({ lines: [expect.stringContaining("no lease stands on T-016")] })
  } finally {
    await coordinator.close()
  }
})

test("a dead worktree lease over a person-completed unit reconciles beside its retained workspace", async () => {
  const dir = project()
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", treeLanes: "on" }))
  write(dir, "docs/T-001/todo.md", "# Task 1\n\nDepends: none\nTouches: src/one.ts\n\n## Scope\n\nDo it.\n")
  write(dir, "docs/T-002/todo.md", "# Task 2\n\nDepends: none\nTouches: src/two.ts\n\n## Scope\n\nDo it.\n")
  git(dir, "add", "-A")
  git(dir, "-c", "user.name=Fix", "-c", "user.email=fix@example.invalid", "commit", "-m", "Code lanes")
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const dead = (await coordinator.claim(worker, "T-001", "execute")) as Grant
    await coordinator.close()
    clock = dead.deadline + 1
    personComplete(dir, "T-001", "# Tasks\n\n- [x] T-001 Task 1\n- [ ] T-002 Task 2\n- [ ] T-003 Task 3\n")
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    const next = await claim(coordinator, peer, "T-002")
    expect(next.unit).toBe("T-002")
    expect(next.workspace).not.toBe(dir)
    expect(ledger(dir)[0]!.booking?.receipt).toEqual({ kind: "reconciled", by: "person-completion" })
    // The retained workspace stands exactly as the expired-worktree floor
    // leaves it (0248): the reconciliation books, never rewrites.
    expect(existsSync(dead.workspace)).toBe(true)
  } finally {
    await coordinator.close()
  }
})

test("the healthy floor: a completed lane carries no reconciliation, no lines", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  const verifier = { token: "verifier", channel: "verify" }
  const coordinator = await openExecutorCoordinator(dir)
  try {
    for (const unit of ["T-001", "T-002"]) {
      const grant = await claim(coordinator, worker, unit)
      write(dir, unit === "T-001" ? "docs/T-001/handoff.md" : "docs/T-002/notes.md", unit === "T-001" ? "# Handoff\n\nStatus: done\n" : "# Notes\n\n<!-- auto: eof -->\n")
      expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
      const verify = await coordinator.claim(verifier, unit, "verify")
      if (!("lease" in verify) || verify.kind !== "verify") throw new Error(JSON.stringify(verify))
      write(dir, `docs/${unit}/report.md`, pass)
      expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    }
    // The P10 floor: the byte-identical healthy path — no reconciled
    // receipt, no sweep line, every close committed through the ledger's
    // own receipts.
    expect(ledger(dir).every(({ booking }) => booking?.receipt?.kind !== "reconciled")).toBe(true)
    expect(printed.join("\n")).not.toContain("reconciled")
    expect(readFileSync(join(dir, index), "utf8")).toContain("- [x] T-002")
    expect(git(dir, "status", "--porcelain")).toBe("")
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})
