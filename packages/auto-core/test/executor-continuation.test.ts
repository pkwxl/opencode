// The continuation re-derivation suite (0289, 0286 F2's re-measured fix). A
// landed receipt carrying the continuation flag — the holder's own
// `Status: continue` handoff statement — routes every follow-up arm as "more
// work remains": measured on the pre-fix tree, a targeted verify claim
// answered `wait/not-ready "T-064 is available for a new claim."` (the
// field's own bytes), an untargeted claim granted a fresh execute ordinal
// (`"id":"T-064 exec 2"` — the literal id the site's console carried; the
// site surrendered one such grant, a less careful holder burning the
// attempt budget), the menu lettered the unit `execute`, and the person's
// completion of the unit changed nothing (`wait/in-flight "The current
// workspace tier must settle before other work starts."`, the fence held).
// The re-measure also amended the record's mechanism: a plain landed scoped
// share routes its verify in BOTH tiers (probes over doc- and worktree-tier
// fixtures granted the share; the standing suite pins the menu letter) —
// the flag alone is the discriminator, never the tier. The flag is derived
// state over the handoff's committed bytes: the person's two document
// channels correct it, and the sweep re-derives at the head of every wire
// act (0287's sweep beside it).
import { afterEach, expect, spyOn, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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
const verifier = { token: "verifier", channel: "verify" }
const person = ["-c", "user.name=Person", "-c", "user.email=person@example.invalid"]
const pass = "# Verification\n\nThe changed source implements the task and leaves the other declared scopes intact.\n\nResult: PASS\n\n<!-- auto: eof -->\n"

// The field's shape (0286 F2): a doc-tier scoped unit whose execute share
// landed carrying the continuation flag, a sibling unit sharing its scope
// behind it.
function project() {
  const dir = mkdtempSync(join(tmpdir(), "executor-continuation-"))
  roots.push(dir)
  git(dir, "init")
  git(dir, "config", "user.name", "Executor test")
  git(dir, "config", "user.email", "executor@example.invalid")
  write(dir, ".gitignore", "/.auto/\n")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, "docs/T-064/todo.md", "# Task 64\n\nDepends: none\nTouches: docs/T-064/notes.md\n\n## Scope\n\nDo it.\n")
  write(dir, "docs/T-065/todo.md", "# Task 65\n\nDepends: none\nTouches: docs/T-064/notes.md\n\n## Scope\n\nShare the scope.\n")
  write(dir, index, "# Tasks\n\n- [ ] T-064 Task 64\n- [ ] T-065 Task 65\n")
  git(dir, "add", ".")
  git(dir, "commit", "-m", "Fixture")
  return dir
}

type Coordinator = Awaited<ReturnType<typeof openExecutorCoordinator>>
type Grant = Extract<Awaited<ReturnType<Coordinator["claim"]>>, { lease: string }>
type ExecuteGrant = Extract<Grant, { kind: "execute" }>

function ledger(dir: string) {
  return JSON.parse(readFileSync(join(dir, ".auto/executor-progress.json"), "utf8")) as { grant: { id: string; unit: string }; booking?: { outcome?: string; receipt?: { kind: string; continuation?: true; closed?: string } } }[]
}

test("the person's handoff amendment strips the flag at the next wire act and the verification follows", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nThe implementation stands whole.\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    await coordinator.close()
    // The person's channel: the handoff's Status line amended (the flag's
    // own evidence), committed — 0274's amendment class.
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nThe implementation stands whole.\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    coordinator = await openExecutorCoordinator(dir, { now: () => 10_000 })
    // The menu read — the first wire act — re-derives: the flag strips, the
    // menu letters verify (the pre-fix letter was execute).
    const menu = await coordinator.ready(verifier)
    expect(menu.claimable).toEqual([{ unit: "T-064", title: "Task 64", kinds: ["verify"] }])
    expect(printed.join("\n")).toContain("re-derived T-064 exec 1 on T-064")
    expect(printed.join("\n")).toContain("the amended handoff no longer reads a continue status")
    expect(ledger(dir)[0]!.booking?.receipt).not.toHaveProperty("continuation")
    // The targeted verify claim grants (the pre-fix answer was the
    // not-ready wait "T-064 is available for a new claim.").
    const verify = await coordinator.claim(verifier, "T-064", "verify")
    if (!("lease" in verify) || verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    // The lane completes: the PASS verdict closes the unit out.
    write(dir, "docs/T-064/report.md", pass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, index), "utf8")).toContain("- [x] T-064")
    // Idempotent: a further act re-derives nothing more.
    const before = printed.length
    await coordinator.ready(verifier)
    expect(printed.length).toBe(before)
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})

test("the person's completion ends the chain over a booked continuation and releases the fence", async () => {
  const dir = project()
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    // The person completes the unit (the 0274 marks) over the standing
    // continuation — the pre-fix shape held every claim behind the fence.
    write(dir, index, "# Tasks\n\n- [x] T-064 Task 64\n- [ ] T-065 Task 65\n")
    git(dir, "mv", "docs/T-064/todo.md", "docs/T-064/done.md")
    git(dir, "add", "--", index)
    git(dir, ...person, "commit", "-m", "person: complete T-064 over its landed continuation")
    // The menu read re-derives: the receipt carries the person-closed facet,
    // the fence releases, the sibling behind is claimable (the pre-fix menu
    // answered the held row over an empty claimable).
    const menu = await coordinator.ready(verifier)
    expect(menu.claimable.map(({ unit }) => unit)).toEqual(["T-065"])
    expect(ledger(dir)[0]!.booking?.receipt).toMatchObject({ kind: "landed", closed: "person" })
    expect(ledger(dir)[0]!.booking?.receipt).not.toHaveProperty("continuation")
    // The sibling's claim grants — the scope is free.
    const sibling = await coordinator.claim({ token: "peer", channel: "other" }, "T-065", "execute") as Grant
    expect(sibling.unit).toBe("T-065")
    // No verify share over the person-closed unit (P3: a person-closed unit
    // is done — the pre-fix strand is gone, and no new arm opens).
    const denied = await coordinator.claim(verifier, "T-064", "verify")
    expect("lease" in denied).toBe(false)
  } finally {
    await coordinator.close()
  }
})

test("the floor: a handoff that still reads continue over an open unit holds the designed continuation", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    await coordinator.close()
    // The handoff at HEAD still reads continue and the unit stands open: the
    // sweep declines (P12 — the flag's evidence stands), nothing is written,
    // no line prints, and the next claim re-grants the designed continuation
    // (the standing suite's own shape, the field's hazard named by 0286).
    coordinator = await openExecutorCoordinator(dir, { now: () => 10_000 })
    const menu = await coordinator.ready(verifier)
    expect(menu.claimable).toMatchObject([{ unit: "T-064", kinds: ["execute"] }])
    expect(ledger(dir)[0]!.booking?.receipt).toMatchObject({ kind: "landed", continuation: true })
    expect(printed.join("\n")).not.toContain("re-derived")
    const retry = await coordinator.claim({ token: "peer", channel: "other" }, "T-064", "execute") as Grant
    expect(retry.id).toBe("T-064 exec 2")
    expect(retry.attempt).toBe(1)
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})

test("the op's honest answers: a standing continuation teaches the channels; the amendment books through the sweep", async () => {
  const dir = project()
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    await coordinator.report(worker, grant.id, grant.lease, "ended")
    // The standing continuation: the op names the unit and the answer
    // teaches the two person channels (evidence-gated alone, no forced arm).
    const standing = await coordinator.reconcile("T-064")
    expect(standing.lines).toEqual([expect.stringContaining("'s landed share still continues")])
    expect(standing.lines[0]).toContain("amend the handoff's Status line")
    // The person amends; the op's own head sweep books the re-derivation.
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    const swept = await coordinator.reconcile("T-064")
    expect(swept.lines).toEqual([expect.stringContaining("re-derived T-064 exec 1 on T-064")])
    // Idempotent: the second call finds the corrected receipt.
    expect(await coordinator.reconcile("T-064")).toEqual({ lines: [expect.stringContaining("nothing to reconcile")] })
    // The no-lease answer stands.
    expect(await coordinator.reconcile("T-016")).toEqual({ lines: [expect.stringContaining("no lease stands on T-016")] })
  } finally {
    await coordinator.close()
  }
})

test("the unscoped flavor: the same re-derivation over the serial floor", async () => {
  const dir = mkdtempSync(join(tmpdir(), "executor-continuation-"))
  roots.push(dir)
  git(dir, "init")
  git(dir, "config", "user.name", "Executor test")
  git(dir, "config", "user.email", "executor@example.invalid")
  write(dir, ".gitignore", "/.auto/\n")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  write(dir, "docs/T-064/todo.md", "# Task 64\n\nDepends: none\n\n## Scope\n\nDo it.\n")
  write(dir, index, "# Tasks\n\n- [ ] T-064 Task 64\n")
  git(dir, "add", ".")
  git(dir, "commit", "-m", "Fixture")
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    const verify = await coordinator.claim(verifier, "T-064", "verify")
    if (!("lease" in verify) || verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    expect(ledger(dir)[0]!.booking?.receipt).not.toHaveProperty("continuation")
  } finally {
    await coordinator.close()
  }
})

// 0290 F1's fix 0291: the shadowed continuation. The field's entry sequence
// (erofs T-064) — a landed flagged share followed by a dead lease the
// continuation itself routed — held the person's amendment out forever under
// 0289's guard (the flagged entry was never the unit's latest entry again),
// while the routing's priorHandoff read kept following the flag wherever it
// sat. The guard is re-keyed to the flag's own routing position: the unit's
// latest *landed* entry — dead tails shadow nothing.
test("the shadow: a released dead tail no longer hides the flag from the person's amendment", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  const peer = { token: "peer", channel: "other" }
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as ExecuteGrant
    // The fresh unit's floor (0294): no landed share exists, the grant
    // carries no landed context.
    expect(grant.landed).toBeUndefined()
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nThe implementation stands whole.\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    // The probing claim the stranded continuation invites, released without
    // a report — the dead tail that shadowed the flag in the field. The
    // probe is itself a re-grant over the landed share: the context rides.
    const probe = (await coordinator.claim(peer, "T-064", "execute")) as ExecuteGrant
    expect(probe.landed).toMatchObject({ id: "T-064 exec 1" })
    await coordinator.release(peer, probe.id, probe.lease)
    // The person's channel: the Status line amended and committed.
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nThe implementation stands whole.\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    // The menu read — the first wire act — reaches the shadowed flag (the
    // pre-fix guard skipped the flagged entry forever: latest(unit) was the
    // dead tail, never the landing again).
    const menu = await coordinator.ready(verifier)
    expect(printed.join("\n")).toContain("re-derived T-064 exec 1 on T-064")
    expect(printed.join("\n")).toContain("the amended handoff no longer reads a continue status")
    expect(ledger(dir)[0]!.booking?.receipt).not.toHaveProperty("continuation")
    // The dead tail still routes the designed takeover — the site's measured
    // move, now over a corrected flag: one bounded share drains the tail.
    expect(menu.claimable).toMatchObject([{ unit: "T-064", kinds: ["execute"] }])
    const takeover = (await coordinator.claim(peer, "T-064", "execute")) as ExecuteGrant
    expect(takeover.id).toBe("T-064 exec 2")
    expect(takeover.attempt).toBe(1)
    // 0294 (0290 F4d): the landed context rides the re-grant — the prior
    // share's id and its landing commit (0276's per-unit context
    // discipline), the holder reading its unit's already-landed state from
    // the grant, not the tree.
    expect(takeover.landed).toMatchObject({ id: "T-064 exec 1" })
    expect(takeover.landed!.commit).toMatch(/^[0-9a-f]{7,40}$/)
    // The takeover share is truthful bounded work (a real write in scope),
    // and it lands clean — the handoff reads done, no flag is derived.
    write(dir, "docs/T-064/notes.md", "# Notes\n\nRevisited over the already-whole unit.\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(peer, takeover.id, takeover.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(ledger(dir)[1]!.booking?.receipt).not.toHaveProperty("continuation")
    // The verify share follows at the next wire act — the field's stranded
    // share, reachable through the corrected chain.
    const after = await coordinator.ready(verifier)
    expect(after.claimable).toEqual([{ unit: "T-064", title: "Task 64", kinds: ["verify"] }])
    const verify = await coordinator.claim(verifier, "T-064", "verify")
    if (!("lease" in verify) || verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-064/report.md", pass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, index), "utf8")).toContain("- [x] T-064")
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})

test("the shadow's expired flavor: the same re-derivation over a dead tail that outlived its lease", async () => {
  const dir = project()
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const grant = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    const probe = (await coordinator.claim({ token: "peer", channel: "other" }, "T-064", "execute")) as Grant
    await coordinator.close()
    clock = probe.deadline + 1
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    // The unit stands open, so the dead-letter sweep leaves the expired tail
    // to the takeover — but the flag correction no longer needs the tail to
    // be the unit's latest entry of any kind.
    const menu = await coordinator.ready(verifier)
    expect(ledger(dir)[0]!.booking?.receipt).not.toHaveProperty("continuation")
    expect(menu.claimable).toMatchObject([{ unit: "T-064", kinds: ["execute"] }])
  } finally {
    await coordinator.close()
  }
})

test("the shield: a later landed entry holds the floor and the older flag stays routing-dead", async () => {
  const dir = project()
  const printed: string[] = []
  const seen = spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.join(" ")) })
  let coordinator = await openExecutorCoordinator(dir, { now: () => 1 })
  try {
    // Two flagged landings in a row: the continuation re-grant landed
    // carrying its own flag — the routing now follows the second flag alone.
    const first = (await coordinator.claim(worker, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: continue\n")
    expect(await coordinator.report(worker, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    const second = (await coordinator.claim({ token: "peer", channel: "other" }, "T-064", "execute")) as Grant
    write(dir, "docs/T-064/notes.md", "# Notes\n\nCarried further.\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nThe carry stands whole.\n\nStatus: continue\n")
    expect(await coordinator.report({ token: "peer", channel: "other" }, second.id, second.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
    // The handoff still reads continue over an open unit: the floor holds the
    // routing flag (the second landing), and the older flag is shielded —
    // routing-dead, never re-derived on its own.
    let menu = await coordinator.ready(verifier)
    expect(printed.join("\n")).not.toContain("re-derived")
    expect(ledger(dir)[0]!.booking?.receipt).toMatchObject({ kind: "landed", continuation: true })
    expect(ledger(dir)[1]!.booking?.receipt).toMatchObject({ kind: "landed", continuation: true })
    expect(menu.claimable).toMatchObject([{ unit: "T-064", kinds: ["execute"] }])
    // The person's amendment corrects the routing flag alone; the shielded
    // one keeps its flag (harmless — priorHandoff reads only the latest
    // landed entry) and the verify share follows the corrected receipt.
    write(dir, "docs/T-064/handoff.md", "# Handoff\n\nStatus: done\n")
    git(dir, "add", "--", "docs/T-064/handoff.md")
    git(dir, ...person, "commit", "-m", "person: the handoff's status amended to done")
    menu = await coordinator.ready(verifier)
    expect(printed.join("\n")).toContain("re-derived T-064 exec 2 on T-064")
    expect(printed.join("\n")).not.toContain("re-derived T-064 exec 1 on T-064")
    expect(ledger(dir)[0]!.booking?.receipt).toHaveProperty("continuation")
    expect(ledger(dir)[1]!.booking?.receipt).not.toHaveProperty("continuation")
    expect(menu.claimable).toEqual([{ unit: "T-064", title: "Task 64", kinds: ["verify"] }])
  } finally {
    seen.mockRestore()
    await coordinator.close()
  }
})
