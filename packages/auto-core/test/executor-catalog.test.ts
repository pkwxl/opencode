// The executor restriction catalog's derivation proof (plans/0269, enacting
// plans/0261 D2/D5): the `types` block on `ready`'s menu is one rendering of
// the same tables the landing fence reads — the fence at settlement
// (permitted/driverExclusive, 0248 D5 as restored by 0259), the catalog at
// dispatch. This file is the behavioral half of the 0203 both-sides ratchet
// the enactment pins (the manual half lives in manual-prompts-ratchet.test.ts
// beside the executor.md sentence): every letter is proven against the
// fence's own behavior over a path corpus, both directions, so a change to
// the fence's grammar cannot land without the catalog moving with it — and
// the absent-block floor (a client that ignores the block reads the
// pre-change menu, P10) is pinned beside them.
import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CONFIG_FILE } from "../src/config"
import { taskDoc, taskDocPaths } from "../src/docpaths"
import { roleOf } from "../src/document/roles"
import { taskStatePaths } from "../src/tasks"
import { withinScopes } from "../src/git"
import { driverExclusive, executorTypeCatalog, openExecutorCoordinator, permitted } from "../src/executor-coordinator"

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

function project(subtask = "off") {
  const dir = mkdtempSync(join(tmpdir(), "executor-catalog-"))
  projects.push(dir)
  git(dir, "init")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask }))
  return dir
}

function commitFixture(dir: string) {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Fixture")
}

const catalog = executorTypeCatalog()
const neverMatch = (path: string) =>
  catalog.execute.never.paths.some((pattern) => new RegExp(pattern).test(path))
// 0276: the formulate entry's never letter — the standing refusal minus the
// family the per-kind arm admits.
const neverFormulateMatch = (path: string) =>
  catalog.formulate.never.paths.some((pattern) => new RegExp(pattern).test(path))

// The corpus's paths are the fence's own input grammar — checkout-relative,
// forward-slash status rows. Git metadata is unreachable by construction (it
// never rides a status row); the Git letter the catalog carries is the verb
// prohibition (`git: "coordinator-only"`), whose home is the standing write
// contract, not a path table.
const PATHS = [
  "src/widget.ts",
  "src/deep/nested/file.ts",
  "README.md",
  "docs/notes/widget.md",
  "docs/T-001/register.md",
  "docs/T-001/handoff.md",
  "docs/T-001/report.md",
  "docs/T-001/gaps.md",
  "docs/T-001/findings.md",
  "docs/T-002/findings.md",
  "docs/T-002/handoff.md",
  "docs/T-001/todo.md",
  "docs/T-001/done.md",
  "docs/T-001/S1/todo.md",
  "docs/T-001/S12/done.md",
  "docs/R-01/phases.md",
  "docs/R-01/P01-implement/tasks.md",
  "docs/R-01/P02-design/tasks.md",
  "docs/T-004/todo.md",
  "docs/T-004/coverage.md",
  "docs/T-004/handoff.md",
  "docs/R-01/P01-implement/todo.md",
  "docs/R-01/P01-implement/handover.md",
  "docs/R-02/P03-design/handover.md",
  "docs/R-99/P12-data-model/done.md",
  "docs/T-1/subtasks.md",
  "docs/T-001/subtasks.md",
  "subtasks.md",
  "opencode.json",
  ".opencode",
  ".opencode/auto/config.json",
  ".auto",
  ".auto/executor-progress.json",
  "tmp",
  "tmp/scratch.txt",
  "AGENTS.md",
  "AGENTS.md/inner.md",
  "docs/AGENTS.md",
  "pkg/AGENTS.md",
  "docs/T-001/AGENTS.md",
]

test("the catalog's ids are exactly the ids the coordinator can grant", () => {
  expect(Object.keys(catalog)).toEqual(["execute", "verify", "fix", "formulate", "synthesize", "distill", "audit"])
  // The work ids are the wire's grant kinds (compile-time satisfies beside
  // the rendering); the person ids are the step kinds the person channel
  // delivers — never an id the coordinator cannot grant (P13). The
  // formulate id joined with its own enactment (0276, 0261 D2's id-growth
  // letter: each new id its own change with its fence-tables entry and
  // ratchet pin); the distill id with 0277's (the transfer advance's
  // session work), the audit id with 0278's (the close-audit session — the
  // docket's convergence kinds complete).
  expect(catalog.execute.id).toBe("execute")
  expect(catalog.verify.id).toBe("verify")
  expect(catalog.fix.id).toBe("fix")
  expect(catalog.formulate.id).toBe("formulate")
  expect(catalog.distill.id).toBe("distill")
  expect(catalog.audit.id).toBe("audit")
})

test("the never grammar equals the fence's standing refusal, both sides", () => {
  for (const path of PATHS) {
    // A self-declaring scope isolates the standing refusal: with the path its
    // own scope, permitted refuses exactly the standing set (the never-list
    // dominates every scope arm — the fence's ordering).
    const fence = permitted({ grant: { kind: "execute", unit: "T-001" }, scope: [path] }, path)
    expect(neverMatch(path), path).toBe(!fence)
    expect(driverExclusive(path) || neverMatch(path), path).toBe(neverMatch(path))
  }
})

test("the verify letter equals the fence's verify arm and taskDocPaths' own grammar", () => {
  const docs = taskDocPaths("T-001")
  for (const path of PATHS) {
    const fence = permitted({ grant: { kind: "verify", unit: "T-001" } }, path)
    expect(fence, path).toBe(path === docs.report || path === docs.gaps)
  }
  expect(catalog.verify.writes.scope).toBe("none")
  // The artifact paths are rendered through taskDocPaths itself over the
  // placeholder unit — the same function the fence calls, never a retyped
  // literal (P5).
  expect(catalog.verify.writes.paths).toEqual([taskDocPaths("T-NNN").report, taskDocPaths("T-NNN").gaps])
})

test("the execute and fix letters equal the fence's scope, handoff and freeform arms", () => {
  const scope = ["src", "docs/T-001"]
  const handoff = taskDocPaths("T-001").handoff
  for (const path of PATHS) {
    // The declared arm: the unit's effective scope plus the per-kind artifact
    // path, and nothing else — no hidden third arm.
    const declared = !neverMatch(path) && (withinScopes(path, scope) || path === handoff)
    expect(permitted({ grant: { kind: "execute", unit: "T-001" }, scope }, path), path).toBe(declared)
    expect(permitted({ grant: { kind: "fix", unit: "T-001" }, scope }, path), path).toBe(declared)
    expect(permitted({ grant: { kind: "execute", unit: "T-001" }, touches: scope }, path), path).toBe(declared)
    // The undeclared arm: roleOf's own freeform floor plus the handoff.
    const undeclared = !neverMatch(path) && (roleOf(path) === "freeform" || path === handoff)
    expect(permitted({ grant: { kind: "execute", unit: "T-001" } }, path), path).toBe(undeclared)
  }
  expect(catalog.execute.writes.scope).toBe("unit-effective")
  expect(catalog.fix.writes.scope).toBe("unit-effective")
  // The undeclared word is roleOf's own vocabulary — one home (P5).
  expect(catalog.execute.writes.undeclared).toBe("freeform")
  expect(catalog.fix.writes.undeclared).toBe("freeform")
  expect(roleOf("README.md")).toBe("freeform")
  expect(catalog.execute.writes.paths).toEqual([taskDocPaths("T-NNN").handoff])
  expect(catalog.fix.writes.paths).toEqual([taskDocPaths("T-NNN").handoff])
  expect(catalog.execute.never.git).toBe("coordinator-only")
})

test("the formulate letter equals the fence's family arm, both sides (plans/0276)", () => {
  const index = "docs/R-01/P01-implement/tasks.md"
  const grant = { grant: { kind: "formulate" as const, unit: "T-004", index } }
  // The family formula — the writes letter's behavioral statement: the
  // granted phase index (the per-unit anchor), the planned tasks' pending
  // documents' grammar MINUS the formulation unit's own input todo, the
  // coverage map, and the standing handoff arm. No freeform floor: the
  // planning session's deliverables are documents, the fence admits exactly
  // them.
  const family = (path: string) =>
    path === index || path === taskDoc("T-004", "coverage") ||
    (path !== taskStatePaths("T-004").pending && /^docs\/T-\d+\/todo\.md$/.test(path)) ||
    path === taskDocPaths("T-004").handoff
  for (const path of PATHS) {
    expect(permitted(grant, path), path).toBe(family(path))
  }
  expect(catalog.formulate.writes.scope).toBe("none")
  expect(catalog.formulate.writes.paths).toEqual([
    "docs/R-NN/P<nn>-<type>/tasks.md",
    taskStatePaths("T-NNN").pending,
    taskDoc("T-NNN", "coverage"),
  ])
  expect(catalog.formulate.writes.undeclared).toBeUndefined()
  // The never letter is sound — everything it denies, the fence denies —
  // and the fence keeps the standing refusal for everything outside the
  // family (another phase's task index included: the letter's per-unit
  // anchor names the one admitted, a deny-list provisioner reading the
  // letter alone under-dennies the rest, the coordinator's checks the
  // authority per 0261 D3).
  for (const path of PATHS) {
    if (neverFormulateMatch(path)) expect(permitted(grant, path), path).toBe(false)
    const standing = !permitted({ grant: { kind: "execute", unit: "T-001" }, scope: [path] }, path)
    if (standing && !family(path)) expect(permitted(grant, path), path).toBe(false)
  }
  // The done half and the phases half stay refused — the admitted classes
  // are exactly the pending grammar and the anchor.
  expect(neverFormulateMatch("docs/T-001/done.md")).toBe(true)
  expect(neverFormulateMatch("docs/T-004/todo.md")).toBe(false)
  expect(neverFormulateMatch("docs/R-01/phases.md")).toBe(true)
  expect(neverFormulateMatch("docs/R-01/P01-implement/tasks.md")).toBe(false)
  // A fix round over the formulation unit carries the same context (the
  // family arm rides the grant's data, not the kind alone — the plan's
  // repair writes the plan's surfaces); every other fix grant keeps the
  // ordinary fix letter, and neither verify nor execute ever carries it.
  expect(permitted({ grant: { kind: "fix", unit: "T-004", index } }, "docs/R-01/P01-implement/tasks.md")).toBe(true)
  expect(permitted({ grant: { kind: "fix", unit: "T-004" } }, "docs/R-01/P01-implement/tasks.md")).toBe(false)
  expect(permitted({ grant: { kind: "execute", unit: "T-004", index } }, "docs/R-01/P01-implement/tasks.md")).toBe(false)
  expect(permitted({ grant: { kind: "formulate", unit: "T-004" } }, "docs/R-01/P01-implement/tasks.md")).toBe(false)
})

// plans/0281 (0279's construction-determinized letter): the synthesize
// letter — the reply channel's write boundary stated from the same table
// the fence reads. The writes letter carries the granted unit's pending
// todo placeholder alone (the per-unit anchor names the real one); the
// never letter is the formulate rendering (the standing set minus the
// pending-todo grammar — the done half stays refused), the honest limit
// stated beside the other per-unit anchors'.
test("the synthesize letter equals the fence's per-kind arm, both sides (plans/0281)", () => {
  const todo = taskStatePaths("T-004").pending
  const grant = { grant: { kind: "synthesize" as const, unit: "T-004" } }
  for (const path of PATHS) {
    expect(permitted(grant, path), path).toBe(path === todo)
  }
  expect(catalog.synthesize.writes.scope).toBe("none")
  expect(catalog.synthesize.writes.paths).toEqual([taskStatePaths("T-NNN").pending])
  expect(catalog.synthesize.writes.undeclared).toBeUndefined()
  // The never letter is sound both directions: everything it denies the
  // fence denies, and everything outside the one admitted path the fence
  // refuses for the synthesize kind — the done half, the index family and
  // every other unit's todo included (the honest limit 0276 stated for the
  // formulate anchor: a deny-list provisioner reading the letter alone
  // under-dennies the rest, the coordinator's checks the authority per
  // 0261 D3).
  expect(catalog.synthesize.never.paths).toEqual(catalog.formulate.never.paths)
  for (const path of PATHS) {
    if (neverFormulateMatch(path)) expect(permitted(grant, path), path).toBe(false)
    if (path !== todo) expect(permitted(grant, path), path).toBe(false)
  }
  expect(neverFormulateMatch("docs/T-001/todo.md")).toBe(false)
  expect(neverFormulateMatch("docs/T-001/done.md")).toBe(true)
  // No other kind ever carries the arm: the unit's own todo stays refused
  // for every other kind (driver-exclusive grammar, the fence's standing
  // refusal — the formulation family's exclusion is the formulate grant's
  // own).
  expect(permitted({ grant: { kind: "execute", unit: "T-004" } }, todo)).toBe(false)
  expect(permitted({ grant: { kind: "fix", unit: "T-004" } }, todo)).toBe(false)
  expect(permitted({ grant: { kind: "formulate", unit: "T-004", index: "docs/R-01/P01-implement/tasks.md" } }, todo)).toBe(false)
  expect(permitted({ grant: { kind: "synthesize", unit: "T-004" } }, "docs/R-01/P01-implement/tasks.md")).toBe(false)
})

// plans/0277 (0256 stage 2's second convergence kind, the transfer advance's
// session work): the distill letter — the boundary distillation's write
// boundary stated from the same table the fence reads. The writes letter
// carries the handover document's placeholder alone (the granted `handover`
// names the real one); the never letter is the standing refusal whole —
// nothing the never-set refuses is admitted for the distill kind.
test("the distill letter equals the fence's per-kind arm, both sides (plans/0277)", () => {
  const handover = "docs/R-01/P01-implement/handover.md"
  const grant = { grant: { kind: "distill" as const, unit: "R-01.P01", handover } }
  for (const path of PATHS) {
    expect(permitted(grant, path), path).toBe(path === handover)
  }
  expect(catalog.distill.writes.scope).toBe("none")
  expect(catalog.distill.writes.paths).toEqual(["docs/R-NN/P<nn>-<type>/handover.md"])
  expect(catalog.distill.writes.undeclared).toBeUndefined()
  // The never letter is the standing rendering (verify's own array) — sound
  // both directions: everything it denies the fence denies, and everything
  // outside the one admitted path the fence refuses for the distill kind —
  // the completion shapes (phases.md, the phase's todo/done) and another
  // phase's handover document included (the honest limit 0276 stated for the
  // formulate anchor: the per-unit anchor names the one admitted, a
  // deny-list provisioner reading the letter alone under-dennies the rest,
  // the coordinator's checks the authority per 0261 D3).
  expect(catalog.distill.never.paths).toEqual(catalog.verify.never.paths)
  for (const path of PATHS) {
    if (neverMatch(path)) expect(permitted(grant, path), path).toBe(false)
    if (path !== handover) expect(permitted(grant, path), path).toBe(false)
  }
  // No other kind ever carries the arm: an execute grant over the same unit
  // never admits the handover document.
  expect(permitted({ grant: { kind: "execute", unit: "R-01.P01" } }, handover)).toBe(false)
})

// plans/0278 (0256 stage 2's third and final convergence kind, the
// close-audit session): the audit letter — the standing close-audit unit's
// write boundary stated from the same table the fence reads. The writes
// letter carries the findings document's placeholder beside the handoff's
// (the two paths the per-kind arm admits); the never letter is the standing
// refusal whole — nothing the never-set refuses is admitted for the audit
// kind (the findings document is not in the never-set).
test("the audit letter equals the fence's per-kind arm, both sides (plans/0278)", () => {
  const findings = "docs/T-002/findings.md"
  const handoff = taskDocPaths("T-002").handoff
  const grant = { grant: { kind: "audit" as const, unit: "T-002", findings } }
  for (const path of PATHS) {
    expect(permitted(grant, path), path).toBe(path === findings || path === handoff)
  }
  expect(catalog.audit.writes.scope).toBe("none")
  expect(catalog.audit.writes.paths).toEqual(["docs/T-NNN/findings.md", taskDocPaths("T-NNN").handoff])
  expect(catalog.audit.writes.undeclared).toBeUndefined()
  // The never letter is the standing rendering (verify's own array) — sound
  // both directions: everything it denies the fence denies, and everything
  // outside the two admitted paths the fence refuses for the audit kind —
  // the close-out shapes (the unit's todo/done, the indexes, phases.md) and
  // another unit's findings document included (the honest limit 0276/0277
  // stated for their anchors: the per-unit anchor names the one admitted, a
  // deny-list provisioner reading the letter alone under-dennies the rest,
  // the coordinator's checks the authority per 0261 D3).
  expect(catalog.audit.never.paths).toEqual(catalog.verify.never.paths)
  for (const path of PATHS) {
    if (neverMatch(path)) expect(permitted(grant, path), path).toBe(false)
    if (path !== findings && path !== handoff) expect(permitted(grant, path), path).toBe(false)
  }
  // No other kind ever carries the arm: an execute or verify grant over the
  // same unit never admits the findings document.
  expect(permitted({ grant: { kind: "execute", unit: "T-002" } }, findings)).toBe(false)
  expect(permitted({ grant: { kind: "verify", unit: "T-002" } }, findings)).toBe(false)
  // A fix round over the standing close-audit unit carries the context (the
  // arm rides the grant's data, not the kind alone — the repair rewrites
  // the same document the audit share wrote); every other fix grant keeps
  // the ordinary fix letter.
  expect(permitted({ grant: { kind: "fix", unit: "T-002", findings } }, findings)).toBe(true)
  expect(permitted({ grant: { kind: "fix", unit: "T-002" } }, findings)).toBe(false)
})

// 0282: the ask channel is gone — the catalog carries the work kinds alone
// (the person entries died with the wire's person arms; the spec's
// tombstone section is the record).
test("the catalog carries the work kinds alone (plans/0282)", () => {
  for (const key of Object.keys(catalog)) expect(["execute", "verify", "fix", "formulate", "synthesize", "distill", "audit"]).toContain(key)
})

test("the absent-block floor: a consumer that ignores the block reads the pre-change menu", async () => {
  const dir = project()
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, "docs/R-01/P01-implement/tasks.md", "# Tasks\n\n- [ ] T-001 Ready\n")
  write(dir, "docs/T-001/todo.md", "# Ready\n\nDepends: none\nTouches: src/widget.ts\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  const coordinator = await openExecutorCoordinator(dir)
  const holder = { token: "worker", channel: "" }
  try {
    const menu = await coordinator.ready(holder)
    const { types, pending, waiting, ...before } = menu
    expect(Object.keys(before).sort()).toEqual(["claimable", "leases"])
    expect(before.claimable).toMatchObject([{ unit: "T-001", title: "Ready", kinds: ["execute"] }])
    expect(before.leases).toEqual([])
    expect(types).toEqual(catalog)
    // 0271's floor half: no pending person items and the list renders the
    // empty shape (a consumer that ignores it unperturbed, P10).
    expect(pending).toEqual([])
    // 0308's floor half: no parked units, the waiting list renders the
    // empty shape the same way.
    expect(waiting).toEqual([])
    // The menu's claimable kinds are always catalog members (never an id the
    // coordinator cannot grant).
    for (const kinds of menu.claimable.flatMap(({ kinds }) => [...kinds])) {
      expect(["execute", "verify", "fix", "formulate", "synthesize", "distill", "audit"]).toContain(kinds)
    }
    // The block rides both menu arms identically (the leases-held arm too).
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    const held = await coordinator.ready(holder)
    const { types: heldTypes, pending: heldPending, waiting: heldWaiting, ...heldBefore } = held
    expect(Object.keys(heldBefore).sort()).toEqual(["claimable", "leases"])
    expect(held.claimable).toEqual([])
    expect(held.leases).toMatchObject([{ step: grant.id, lease: grant.lease }])
    expect(heldTypes).toEqual(catalog)
    expect(heldPending).toEqual([])
    expect(heldWaiting).toEqual([])
  } finally {
    await coordinator.close()
  }
  // The measured block (0269's ruling records the exact figure): the menu
  // carries no byte bound today — 0246 D4 a's 256 KiB figure governs rendered
  // briefs — and the block stays a small fraction of even that envelope.
  expect(Buffer.byteLength(JSON.stringify(catalog))).toBeLessThan(4096)
})
