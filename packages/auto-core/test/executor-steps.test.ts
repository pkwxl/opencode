import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
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

function project(subtask = "off") {
  const dir = mkdtempSync(join(tmpdir(), "executor-preview-"))
  projects.push(dir)
  git(dir, "init")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask }))
  return dir
}

function commitFixture(dir: string) {
  git(dir, "add", ".")
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Fixture")
}

function phase(dir: string, type: string) {
  const path = `docs/R-01/P01-${type}`
  write(dir, "docs/R-01/phases.md", `# Phases\n\n- [ ] P01 ${type}\n`)
  write(dir, `${path}/todo.md`, "# Phase\n")
  return path
}

test("previews the serial loop's ready task and renders its brief without writing", async () => {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Dependent\n- [ ] T-002 Ready\n")
  write(dir, "docs/T-001/todo.md", "# Dependent\n\nDepends: T-002\n\n## Scope\n\nLater work.\n")
  write(dir, "docs/T-002/todo.md", "# Ready\n\nDepends: none\nDecompose: pipeline\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  const head = git(dir, "rev-parse", "HEAD")
  const index = readFileSync(join(dir, ".git/index"))
  const preview = await readExecutorPreview(dir)
  expect(preview).toMatchObject({ kind: "execute", unit: "T-002" })
  if (preview.kind !== "execute") throw new Error(JSON.stringify(preview))
  expect(preview.prompt).toContain("Implement the widget.")
  expect(await readExecutorPreview(dir)).toEqual(preview)
  expect(git(dir, "rev-parse", "HEAD")).toBe(head)
  expect(git(dir, "status", "--porcelain", "--ignored")).toBe("")
  expect(readFileSync(join(dir, ".git/index"))).toEqual(index)

  write(dir, "extra.txt", "uncommitted\n")
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "blocked", reason: "cleanTree" })
  expect(git(dir, "status", "--porcelain")).toBe("?? extra.txt\n")
  expect(git(dir, "rev-parse", "HEAD")).toBe(head)
})

test("previews project-start and refuses subtask mode before that gate", async () => {
  expect(await readExecutorPreview(project())).toMatchObject({ kind: "human", gate: "project-start" })
  expect(await readExecutorPreview(project("auto"))).toMatchObject({ kind: "blocked", reason: "subtask" })
})

// 0290 F4c's fix 0294: the not-ready detail names its cause class, never
// the bare unit name — the held row and the targeted answer diagnosable
// apart (the ledger's pin against the plan's edge, the field's measured
// indistinguishability closed). Four mechanical classes, pinned at the
// derivation the menu's held row copies verbatim.
test("the not-ready wait names its cause class: the plan's edge, the ledger's pin, the plan's absence, the index's status", async () => {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Ready\n- [ ] T-002 Dependent\n")
  write(dir, "docs/T-001/todo.md", "# Ready\n\nDepends: none\nDecompose: pipeline\n\n## Scope\n\nImplement the widget.\n")
  write(dir, "docs/T-002/todo.md", "# Dependent\n\nDepends: T-001\n\n## Scope\n\nLater work.\n")
  commitFixture(dir)
  // The plan's edge: a targeted claim at the dependent unit names the unmet
  // dependency (the pre-fix letter named the unit alone).
  expect(await readExecutorPreview(dir, undefined, { task: "T-002" })).toEqual({
    kind: "wait", reason: "not-ready", actor: "workflow", detail: "T-002 is not ready — waiting on T-001.",
  })
  // The ledger's class: the same target routed by the coordinator's
  // continuation arm (the route equal to the ledger's continuation unit)
  // names the pin and teaches its releases — the field's held-row shape.
  expect(await readExecutorPreview(dir, "T-002", { task: "T-002" })).toEqual({
    kind: "wait", reason: "not-ready", actor: "person",
    detail: "T-002 is held by the ledger's continuation claim — the person's handoff Status amendment or the unit's completion releases it, or a takeover share lands over the unit.",
  })
  // A task the plan does not carry names its absence.
  expect(await readExecutorPreview(dir, undefined, { task: "T-999" })).toEqual({
    kind: "wait", reason: "not-ready", actor: "person", detail: "T-999 is not a task in this phase's index.",
  })
  // The index's own status: a completed unit targeted fresh (the person's
  // completion, no continuation routing) names its status.
  git(dir, "mv", "docs/T-001/todo.md", "docs/T-001/done.md")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [x] T-001 Ready\n- [ ] T-002 Dependent\n")
  commitFixture(dir)
  expect(await readExecutorPreview(dir, undefined, { task: "T-001" })).toEqual({
    kind: "wait", reason: "not-ready", actor: "workflow", detail: "T-001 is not ready (its status in this phase's index: done).",
  })
})

test("previews the pending survey release before checking unowned dirt", async () => {
  const dir = project()
  write(dir, ".opencode/auto/phases/survey.md", "# Survey\n\nGate: human\n\n## plan duties\n\nRead the sources.\n\n<!-- auto: eof -->\n")
  const path = phase(dir, "survey")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [x] T-001 Survey sources\n")
  write(dir, `${path}/handover.md`, PHASE_HANDOVER)
  write(dir, "docs/T-001/done.md", "# Survey sources\n")
  const document = `${path}/survey.md`
  const survey = "# Survey\n\nFork: scope — widen coverage? Recommend: keep it narrow.\n"
  write(dir, document, survey)
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "human", gate: "survey-release", document })

  write(dir, document, survey + "\nClarified: yes\n")
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "blocked", reason: "cleanTree" })
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "phase-boundary", problems: [] })
})

test("refuses an unreadable Git index before offering project-start work", async () => {
  const dir = project()
  commitFixture(dir)
  write(dir, ".git/index", "corrupt index\n")
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "blocked", reason: "unreadable" })
  expect(readFileSync(join(dir, ".git/index"), "utf8")).toBe("corrupt index\n")
})

test("an open round with completed tasks has no phase boundary to cross", async () => {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, "docs/R-01/phases.md", "# Phases\n\nKind: open\n\n- [ ] P01 implement\n")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [x] T-001 Implement the widget\n")
  write(dir, "docs/T-001/done.md", "# Implement the widget\n")
  commitFixture(dir)
  expect(await readExecutorPreview(dir)).toMatchObject({ kind: "wait", reason: "not-ready" })
})

const holder = { token: "worker-1", channel: "solo" }

// A valid phase handover document (0277's push skip condition): a fixture
// writing it models the post-distillation boundary — the distillation landed,
// the apply (the completion rename, the transition commit) still the person's
// transfer — so the executor's boundary step reads phase-boundary there.
const PHASE_HANDOVER = [
  "# Handover",
  "",
  ...HANDOVER_SECTIONS.map((section) => `${section}\n\nDistilled content.\n`),
].join("\n")

function executableProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Implement widget\n")
  write(dir, `${path}/handover.md`, PHASE_HANDOVER)
  write(dir, "docs/T-001/todo.md", "# Implement widget\n\nTouches: src/widget.ts\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  return dir
}

// The 0257-01 reproduction shape: a target that is its own repository whose
// deliverable includes a nested repository (its own .git, listed in the outer
// .gitignore, named by config isolate), the task's declared deliverable under
// it (0258 serves the shape the push path always has).
function nestedProject() {
  const dir = project()
  write(dir, ".gitignore", "/vendor/\n")
  write(dir, "vendor/src/lib.ts", "export const lib = 0\n")
  git(join(dir, "vendor"), "init")
  git(join(dir, "vendor"), "add", ".")
  git(join(dir, "vendor"), "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Nested fixture")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", isolate: ["vendor"] }))
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Ship the nested change\n")
  write(dir, `${path}/handover.md`, PHASE_HANDOVER)
  write(dir, "docs/T-001/todo.md", "# Ship the nested change\n\nTouches: vendor/src/lib.ts\n\n## Scope\n\nUpdate the nested library.\n")
  commitFixture(dir)
  return dir
}

// The 0262-01 reproduction shape: an ignore entry holding a per-kind
// artifact's path grammar — the manual suite's standing housekeeping entry
// (0245; squashfs line 7 from the tool's own housekeeping commit, erofs line 9
// landed inside an executor settle, in the field record) — the settlement
// serving the shadowed artifact anyway (0263) while every other ignored
// surface stays invisible exactly as 0249 words it.
function ignoredArtifactProject(entry: string) {
  const dir = project()
  write(dir, ".gitignore", entry)
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Implement widget\n")
  write(dir, "docs/T-001/todo.md", "# Implement widget\n\nTouches: src/widget.ts\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  return dir
}

async function crashReport(dir: string, actor: typeof holder, step: string, lease: string, point: string) {
  const source = new URL("../src/executor-coordinator.ts", import.meta.url).href
  const child = Bun.spawn([process.execPath, "-e", `
    import { openExecutorCoordinator } from ${JSON.stringify(source)};
    const [dir, step, lease, point] = process.argv.slice(1);
    const coordinator = await openExecutorCoordinator(dir, { checkpoint: (current) => {
      if (current === point) process.kill(process.pid, "SIGKILL");
    } });
    await coordinator.report(${JSON.stringify(actor)}, step, lease, "ended");
    await coordinator.close();
  `, dir, step, lease, point], { stderr: "pipe", stdout: "ignore" })
  await child.exited
  expect({ signal: child.signalCode, stderr: await new Response(child.stderr).text() }).toEqual({
    signal: "SIGKILL", stderr: "",
  })
}

for (const point of ["booked", "committed"] as const) {
  test(`replays one attempt and one share after a process dies at ${point}`, async () => {
    const dir = executableProject()
    const base = git(dir, "rev-parse", "HEAD").trim()
    const coordinator = await openExecutorCoordinator(dir)
    const grant = await coordinator.claim(holder)
    await coordinator.close()
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "src/widget.ts", "export const widget = 1\n")

    await crashReport(dir, holder, grant.id, grant.lease, point)
    const crashHead = git(dir, "rev-parse", "HEAD").trim()
    if (point === "booked") expect(crashHead).toBe(base)
    else expect(crashHead).not.toBe(base)

    const recovered = await openExecutorCoordinator(dir)
    try {
      const replacement = { token: "worker-2", channel: "solo" }
      // The recovered menu (a plain worker reader; the ask channel is gone,
      // the pending list carries document-derived gates alone — none here —
      // beside 0287's held row: the crashed settlement is the lane's own
      // answer for why nothing is claimable, surfaced instead of a silent
      // empty list).
      expect(await recovered.ready(replacement)).toEqual({
        claimable: [], leases: [], types: executorTypeCatalog(), waiting: [],
        pending: [{ kind: "wait", reason: "in-flight", actor: "workflow", detail: "A previous share requires settlement." }],
      })
      expect(git(dir, "rev-parse", "HEAD").trim()).toBe(crashHead)
      expect(await recovered.claim(replacement)).toMatchObject({ kind: "verify", unit: grant.unit })
      expect(git(dir, "rev-list", "--count", `${base}..HEAD`).trim()).toBe("1")
      const receipt = await recovered.report(holder, grant.id, grant.lease, "ended")
      expect(receipt).toMatchObject({ kind: "landed" })
      expect(await recovered.report(holder, grant.id, grant.lease, "ended")).toEqual(receipt)
      await expect(recovered.report(holder, grant.id, grant.lease, "failed")).rejects.toThrow("conflicts")
      expect(await recovered.claim(holder)).toMatchObject({ kind: "wait" })
      expect(git(dir, "rev-list", "--count", `${base}..HEAD`).trim()).toBe("1")
      expect(git(dir, "status", "--porcelain", "--", "src", "docs")).toBe("")
      const entries = JSON.parse(readFileSync(join(dir, ".auto/executor-progress.json"), "utf8"))
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({ grant: { attempt: 1, lease: grant.lease }, booking: { outcome: "ended", receipt } })
    } finally {
      await recovered.close()
    }
  })
}

test("a nested destination repository is servable: claim, nested-first settle, and close-out", async () => {
  const dir = nestedProject()
  const top0 = git(dir, "rev-parse", "HEAD").trim()
  const nested0 = git(join(dir, "vendor"), "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "vendor/src/lib.ts", "export const lib = 1\n")
    write(dir, "vendor/src/other.ts", "export const other = 1\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "isolation", detail: expect.stringContaining("vendor/src/other.ts"),
    })
    rmSync(join(dir, "vendor/src/other.ts"))
    // Nested-only changes cannot witness the share's top-repository landing.
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "isolation", detail: expect.stringContaining("only nested repositories"),
    })
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(top0)
    expect(git(join(dir, "vendor"), "rev-parse", "HEAD").trim()).toBe(nested0)
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe nested change landed.\n\nStatus: continue\n")
    const landed = await coordinator.report(holder, grant.id, grant.lease, "ended")
    expect(landed).toMatchObject({ kind: "landed", continuation: true })
    expect(git(dir, "rev-list", "--count", `${top0}..HEAD`).trim()).toBe("1")
    expect(git(join(dir, "vendor"), "rev-list", "--count", `${nested0}..HEAD`).trim()).toBe("1")
    expect(git(join(dir, "vendor"), "log", "-1", "--format=%s").trim()).toBe(grant.id)
    expect(readFileSync(join(dir, "vendor/src/lib.ts"), "utf8")).toBe("export const lib = 1\n")

    const worker = { ...holder, token: "worker-2" }
    const resume = await coordinator.claim(worker)
    if (resume.kind !== "execute") throw new Error(JSON.stringify(resume))
    expect(resume.prompt).toContain("docs/T-001/handoff.md")
    write(dir, "vendor/src/lib.ts", "export const lib = 2\n")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nDone.\n\nStatus: done\n")
    expect(await coordinator.report(worker, resume.id, resume.lease, "ended")).toMatchObject({ kind: "landed" })

    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md",
      "# Verification\n\nThe nested library carries the declared change and nothing else landed beside it.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    const closed = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(closed).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD").trim() })
    expect(readFileSync(join(dir, "docs/R-01/P01-implement/tasks.md"), "utf8")).toContain("- [x] T-001")
    expect(git(dir, "ls-files", "--", "docs/T-001/done.md").trim()).toBe("docs/T-001/done.md")
    expect(git(join(dir, "vendor"), "rev-list", "--count", `${nested0}..HEAD`).trim()).toBe("2")
    expect(git(join(dir, "vendor"), "status", "--porcelain")).toBe("")
    expect(git(dir, "status", "--porcelain", "--", "docs")).toBe("")
    expect(await coordinator.claim(holder)).toMatchObject({ kind: "phase-boundary" })
  } finally {
    await coordinator.close()
  }
})

test("a multi-root settlement replays after a death between its nested and top commits", async () => {
  const dir = nestedProject()
  const top0 = git(dir, "rev-parse", "HEAD").trim()
  const nested0 = git(join(dir, "vendor"), "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  const grant = await coordinator.claim(holder)
  await coordinator.close()
  if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
  write(dir, "vendor/src/lib.ts", "export const lib = 1\n")
  write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe nested change landed.\n\nStatus: done\n")
  await crashReport(dir, holder, grant.id, grant.lease, "nested-committed")
  // Nested-first: the nested root committed, the top repository's share did not.
  expect(git(join(dir, "vendor"), "rev-list", "--count", `${nested0}..HEAD`).trim()).toBe("1")
  expect(git(dir, "rev-parse", "HEAD").trim()).toBe(top0)
  const recovered = await openExecutorCoordinator(dir)
  try {
    const receipt = await recovered.report(holder, grant.id, grant.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    expect(await recovered.report(holder, grant.id, grant.lease, "ended")).toEqual(receipt)
    // The replay proved the booked nested witness instead of committing twice.
    expect(git(join(dir, "vendor"), "rev-list", "--count", `${nested0}..HEAD`).trim()).toBe("1")
    expect(git(dir, "rev-list", "--count", `${top0}..HEAD`).trim()).toBe("1")
    expect(git(join(dir, "vendor"), "log", "-1", "--format=%s").trim()).toBe(grant.id)
    expect(git(join(dir, "vendor"), "status", "--porcelain")).toBe("")
    expect(git(dir, "status", "--porcelain", "--", "docs")).toBe("")
  } finally {
    await recovered.close()
  }
})

test("the serial coordinator refuses an unconflicting out-of-scope edit and fences reports", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    expect(await coordinator.claim(holder)).toEqual(grant)
    await expect(openExecutorCoordinator(dir)).rejects.toThrow("active driver")
    expect(await coordinator.report({ ...holder, token: "another" }, grant.id, grant.lease, "ended")).toMatchObject({ kind: "wait", reason: "lease-held" })
    const base = git(dir, "rev-parse", "HEAD")
    write(dir, "src/widget.ts", "export const widget = 1\n")
    write(dir, "src/other.ts", "export const other = 1\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "isolation", detail: expect.stringContaining("src/other.ts"),
    })
    expect(git(dir, "rev-parse", "HEAD")).toBe(base)
    expect(git(dir, "diff", "--cached", "--name-only")).toBe("")
    expect(await coordinator.claim({ ...holder, token: "another" })).toMatchObject({
      kind: "blocked", reason: "isolation", detail: expect.stringContaining("src/other.ts"),
    })
    rmSync(join(dir, "src/other.ts"))
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
  } finally {
    await coordinator.close()
  }
})

test("a failed report is terminal without committing the workspace", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "src/widget.ts", "unfinished\n")
    const base = git(dir, "rev-parse", "HEAD")
    const receipt = { kind: "without-landing", reason: "failed" } as const
    expect(await coordinator.report(holder, grant.id, grant.lease, "failed")).toEqual(receipt)
    expect(await coordinator.report(holder, grant.id, grant.lease, "failed")).toEqual(receipt)
    expect(git(dir, "rev-parse", "HEAD")).toBe(base)
    expect(readFileSync(join(dir, "src/widget.ts"), "utf8")).toBe("unfinished\n")
  } finally {
    await coordinator.close()
  }
})

test("release replays after restart without consuming the replacement lease", async () => {
  const dir = executableProject()
  const first = await openExecutorCoordinator(dir)
  let old
  try {
    const grant = await first.claim(holder, "T-001")
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    old = grant
    write(dir, "src/widget.ts", "retained draft\n")
    await first.release(holder, grant.id, grant.lease)
  } finally {
    await first.close()
  }
  const recovered = await openExecutorCoordinator(dir)
  try {
    const successor = await recovered.claim(holder, "T-001")
    if (successor.kind !== "execute") throw new Error(JSON.stringify(successor))
    expect(successor.lease).not.toBe(old.lease)
    expect(readFileSync(join(dir, "src/widget.ts"), "utf8")).toBe("retained draft\n")
    expect(successor.attempt).toBe(1)
    expect(await recovered.release(holder, old.id, old.lease)).toMatchObject({ kind: "wait", reason: "lease-held" })
    expect(await recovered.brief(holder, "T-001")).toEqual(successor)
    await expect(recovered.release(holder, successor.id, "never-issued")).rejects.toThrow("never issued")
  } finally {
    await recovered.close()
  }
})

test("a same-channel zombie cannot renew or settle its successor's lease", async () => {
  const dir = executableProject()
  let at = 10
  const now = () => at
  const first = await openExecutorCoordinator(dir, { now })
  let old
  try {
    const grant = await first.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    old = grant
    at = grant.deadline
    const path = "src/widget.ts"
    write(dir, path, "unfinished\n")
    expect(await first.release(holder, grant.id, grant.lease)).toMatchObject({ kind: "wait", reason: "not-ready" })
    expect(await first.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "wait", reason: "not-ready" })
    expect(readFileSync(join(dir, path), "utf8")).toBe("unfinished\n")
  } finally {
    await first.close()
  }
  const recovered = await openExecutorCoordinator(dir, { now })
  try {
    const successor = await recovered.claim(holder, "T-001")
    if (successor.kind !== "execute") throw new Error(JSON.stringify(successor))
    expect(successor).toMatchObject({ id: old.id, attempt: 2 })
    expect(successor.lease).not.toBe(old.lease)
    at += 100
    const one = { step: old.id, lease: old.lease }
    const two = { step: successor.id, lease: successor.lease }
    expect(await recovered.heartbeat(holder, [one])).toMatchObject({ leases: [{ ...two, deadline: successor.deadline }] })
    expect(await recovered.release(holder, one.step, one.lease)).toMatchObject({ kind: "wait", reason: "lease-held" })
    expect(await recovered.report(holder, one.step, one.lease, "ended")).toMatchObject({ kind: "wait", reason: "lease-held" })
    await expect(recovered.heartbeat(holder, [two, { ...one, lease: "never-issued" }])).rejects.toThrow("never issued")
    expect(await recovered.ready(holder)).toMatchObject({ leases: [{ ...two, deadline: successor.deadline }] })
    expect(await recovered.heartbeat(holder, [two])).toMatchObject({ leases: [{ ...two, deadline: successor.deadline + 100 }] })

    at = successor.deadline + 99
    const renewed = await recovered.heartbeat(holder, [two])
    const cap = successor.deadline + (successor.deadline - old.deadline)
    expect(renewed.leases[0]!.deadline).toBe(cap)
    at = cap - 1
    const capped = await recovered.heartbeat(holder, [two])
    expect(capped.leases[0]!.deadline).toBe(cap)
    at = cap
    expect((await recovered.heartbeat(holder, [two])).leases).toEqual([])
  } finally {
    await recovered.close()
  }
})

// The lease clock (plans/0260, discharging 0246 §C's deferral): the config key
// executorLease tunes the grant's budget, the window and cap deriving from it;
// absent, the exact 60/65/130 defaults stand (P10 — every emitted value
// byte-identical to the pre-key clock).
function leaseProject(executorLease: number) {
  const dir = project()
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", executorLease }))
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Implement widget\n")
  write(dir, "docs/T-001/todo.md", "# Implement widget\n\nTouches: src/widget.ts\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  return dir
}

test("the lease clock defaults: no executorLease key — budget 60, window 65 minutes, hard cap 130 from issue", async () => {
  const dir = executableProject()
  let at = 10
  const coordinator = await openExecutorCoordinator(dir, { now: () => at })
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    expect(grant.budget).toBe(60)
    expect(grant.deadline).toBe(10 + 65 * 60_000)
    const key = { step: grant.id, lease: grant.lease }
    at += 100
    const renewed = await coordinator.heartbeat(holder, [key])
    expect(renewed.leases[0]!.deadline).toBe(110 + 65 * 60_000)
    at = 10 + 65 * 60_000 + 90
    const capped = await coordinator.heartbeat(holder, [key])
    expect(capped.leases[0]!.deadline).toBe(10 + 130 * 60_000)
    at = 10 + 130 * 60_000
    expect((await coordinator.heartbeat(holder, [key])).leases).toEqual([])
  } finally {
    await coordinator.close()
  }
})

test("an executorLease declaration carries on the grant and scales the renewal window and the hard cap", async () => {
  const dir = leaseProject(240)
  let at = 10
  const coordinator = await openExecutorCoordinator(dir, { now: () => at })
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    expect(grant.budget).toBe(240)
    expect(grant.deadline).toBe(10 + 245 * 60_000)
    const key = { step: grant.id, lease: grant.lease }
    at += 100
    const renewed = await coordinator.heartbeat(holder, [key])
    expect(renewed.leases[0]!.deadline).toBe(110 + 245 * 60_000)
    at = 10 + 245 * 60_000 + 90
    const capped = await coordinator.heartbeat(holder, [key])
    expect(capped.leases[0]!.deadline).toBe(10 + 2 * 245 * 60_000)
  } finally {
    await coordinator.close()
  }
})

test("an invalid executorLease value answers the blocked config step naming the key and its range", async () => {
  const dir = executableProject()
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", executorLease: 0 }))
  const coordinator = await openExecutorCoordinator(dir)
  try {
    expect(await coordinator.claim(holder)).toMatchObject({
      kind: "blocked", reason: "config",
      detail: expect.stringContaining("executorLease must be an integer in 1..1440"),
    })
  } finally {
    await coordinator.close()
  }
})

test("the attempt cap includes expired claims and leaves their workspace intact", async () => {
  const dir = executableProject()
  let at = 10
  const coordinator = await openExecutorCoordinator(dir, { now: () => at })
  try {
    for (const attempt of [1, 2, 3]) {
      const grant = await coordinator.claim(holder)
      if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
      expect(grant.attempt).toBe(attempt)
      at = grant.deadline
    }
    write(dir, "src/widget.ts", "unfinished\n")
    expect(await coordinator.claim(holder)).toMatchObject({ kind: "blocked", reason: "attemptsExhausted" })
    expect(readFileSync(join(dir, "src/widget.ts"), "utf8")).toBe("unfinished\n")
  } finally {
    await coordinator.close()
  }
})

test("verification uses the durable producer token across coordinator restart", async () => {
  const dir = executableProject()
  const first = await openExecutorCoordinator(dir)
  let landed
  let execId: string | undefined
  const baseline = git(dir, "rev-parse", "HEAD").trim()
  try {
    const grant = await first.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    execId = grant.id
    write(dir, "src/widget.ts", "export const widget = 1\n")
    landed = await first.report(holder, grant.id, grant.lease, "ended")
    if (landed.kind !== "landed") throw new Error(JSON.stringify(landed))
  } finally {
    await first.close()
  }
  const recovered = await openExecutorCoordinator(dir)
  try {
    // 0273: the same-token claim over the booked report reads the settled
    // terminal naming the booked evidence, not the retired wait.
    const settled = await recovered.verification({ ...holder, channel: "new-channel" })
    if (settled.kind !== "settled") throw new Error(JSON.stringify(settled))
    expect(settled.unit).toBe("T-001")
    expect(settled.commit).toBe(landed.commit)
    expect(settled.detail).toContain(execId)
    const verify = await recovered.verification({ ...holder, token: "worker-2" })
    expect(verify).toMatchObject({ kind: "verify", unit: "T-001", baseline, head: landed.commit })
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    expect(verify.prompt).toContain(`${baseline}..${landed.commit}`)
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(landed.commit)
    // 0274 (0264-03's fix): an untrailered direct commit is the bounded
    // person-amendment class — logged and passed, the witness re-based past
    // it, verification proceeding over the person's act.
    git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Foreign HEAD")
    expect(await recovered.verification({ ...holder, token: "worker-2" })).toMatchObject({ kind: "verify", unit: "T-001" })
    git(dir, "reset", "-q", "--hard", landed.commit!)
    // A commit in the driver's stage grammar outside the ledger stays
    // terminal divergence (P12).
    git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-m", "Foreign share", "-m", "Auto-Task: T-001", "-m", "Auto-Stage: exec")
    expect(await recovered.verification({ ...holder, token: "worker-2" })).toMatchObject({ kind: "blocked", reason: "isolation" })
  } finally {
    await recovered.close()
  }
})

// 0273 (0264-05's fix): the same-token verification wait split on the booking
// state — the wait's own site is by construction reached only over a booked
// report (the findLast filter pins the producer landed), so the settled
// holder now reads a distinct terminal naming the booked commit, every
// neighboring answer byte-identical (P10).
test("a booked report answers a same-token verify claim with the settled terminal naming the booked commit", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    // The live-share floor: while the share is live (the report not booked),
    // a same-token verify claim reads today's lease-held wait byte-identical,
    // whatever channel it arrives on — nothing raised, nothing changed.
    const held = {
      kind: "wait", reason: "lease-held", actor: "workflow", deadline: grant.deadline,
      detail: `Lease held by channel ${holder.channel} until ${new Date(grant.deadline).toISOString()}.`,
    } as const
    expect(await coordinator.claim(holder, "T-001", "verify")).toEqual(held)
    expect(await coordinator.claim({ ...holder, channel: "other" }, "T-001", "verify")).toEqual(held)
    write(dir, "src/widget.ts", "export const widget = 1\n")
    // The report lands; its response is lost — the holder never reads it.
    const landed = await coordinator.report(holder, grant.id, grant.lease, "ended")
    if (landed.kind !== "landed") throw new Error(JSON.stringify(landed))
    const progress = readFileSync(join(dir, ".auto/executor-progress.json"), "utf8")
    // The reconciliation: the holder that retries its claim, and a rotated
    // successor on the same token, read the booked evidence from the
    // terminal — accepted, not wrong-token; no lease granted, no state
    // written, the claim ended (the same terminal on every re-read).
    const settled = {
      kind: "settled", unit: "T-001", commit: landed.commit,
      detail: `The report for ${grant.id} was accepted; its evidence is booked at ${landed.commit}. This token's claim on T-001 has ended — a different token performs the verification.`,
    } as const
    expect(await coordinator.claim(holder, "T-001", "verify")).toEqual(settled)
    expect(await coordinator.claim({ ...holder, channel: "successor" }, "T-001", "verify")).toEqual(settled)
    expect(await coordinator.verification(holder)).toEqual(settled)
    expect(await coordinator.next(holder)).toEqual(settled)
    // The standing lost-report retry letter rides beside it unchanged.
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toEqual(landed)
    expect(readFileSync(join(dir, ".auto/executor-progress.json"), "utf8")).toBe(progress)
    expect((await coordinator.ready(holder)).leases).toEqual([])
    // A different token still reads the verify grant — the standing
    // independence behavior unchanged (0248 D6).
    expect(await coordinator.claim({ ...holder, token: "worker-2" }, "T-001", "verify")).toMatchObject({
      kind: "verify", unit: "T-001", head: landed.commit,
    })
  } finally {
    await coordinator.close()
  }
})

for (const verdict of ["pass", "fail"] as const) {
  test(`an independent verifier lands a ${verdict} artifact exactly once`, async () => {
    const dir = executableProject()
    const coordinator = await openExecutorCoordinator(dir)
    try {
      const execute = await coordinator.claim(holder)
      if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
      write(dir, "src/widget.ts", "export const widget = 1\n")
      const landed = await coordinator.report(holder, execute.id, execute.lease, "ended")
      if (landed.kind !== "landed") throw new Error(JSON.stringify(landed))

      const verifier = { ...holder, token: "verifier" }
      expect((await coordinator.ready(holder)).claimable).toEqual([])
      expect((await coordinator.ready(verifier)).claimable).toMatchObject([{ unit: "T-001", kinds: ["verify"] }])
      expect(await coordinator.claim({ ...holder, channel: "different" }, "T-001", "verify")).toMatchObject({
        kind: "settled", unit: "T-001", commit: landed.commit,
      })
      const verify = await coordinator.claim(verifier, "T-001", "verify")
      if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
      expect(await coordinator.claim(verifier, "T-001", "verify")).toEqual(verify)
      const artifact = verdict === "pass" ? "report.md" : "gaps.md"
      const evidence = verdict === "pass"
        ? "# Verification\n\nThe widget is exported with the expected value. Its implementation matches the declared acceptance criteria and introduces no additional changes.\n\nResult: PASS\n\n<!-- auto: eof -->\n"
        : "# Verification\n\n## Gaps\n\n### Gap 1 — Cover the widget\n\nAdd a test for the exported value.\n\nResult: FAIL coverage is missing\n"
      write(dir, `docs/T-001/${artifact}`, evidence)
      const result = await coordinator.report(verifier, verify.id, verify.lease, "ended")
      expect(result).toMatchObject({ kind: "landed", verdict })
      expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toEqual(result)
      expect(git(dir, "rev-list", "--count", `${landed.commit}..HEAD`).trim()).toBe(verdict === "pass" ? "2" : "1")
      if (verdict === "pass") {
        expect(result).toMatchObject({ closeCommit: git(dir, "rev-parse", "HEAD").trim() })
        expect(readFileSync(join(dir, "docs/R-01/P01-implement/tasks.md"), "utf8")).toContain("- [x] T-001")
        expect(git(dir, "ls-files", "--", "docs/T-001/done.md").trim()).toBe("docs/T-001/done.md")
      }
      expect(await coordinator.claim(verifier, "T-001", "verify")).toMatchObject(
        verdict === "pass" ? { kind: "phase-boundary" } : { kind: "wait", reason: "in-flight" },
      )
    } finally {
      await coordinator.close()
    }
  })
}

for (const point of ["close-index-written", "closed-files", "closed-commit"] as const) {
  test(`replays PASS close-out after a process dies at ${point}`, async () => {
    const dir = executableProject()
    const coordinator = await openExecutorCoordinator(dir)
    const verifier = { ...holder, token: "independent-verifier" }
    let grant
    let executeCommit
    try {
      const execute = await coordinator.claim(holder)
      if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
      write(dir, "src/widget.ts", "export const widget = 1\n")
      const landed = await coordinator.report(holder, execute.id, execute.lease, "ended")
      if (landed.kind !== "landed") throw new Error(JSON.stringify(landed))
      executeCommit = landed.commit
      grant = await coordinator.claim(verifier, "T-001", "verify")
      if (grant.kind !== "verify") throw new Error(JSON.stringify(grant))
      write(dir, "docs/T-001/report.md",
        "# Verification\n\nThe widget exports the expected value. The single changed source file and its output implement the contract recorded in the task.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    } finally {
      await coordinator.close()
    }

    await crashReport(dir, verifier, grant.id, grant.lease, point)
    expect(git(dir, "rev-list", "--count", `${executeCommit}..HEAD`).trim()).toBe(point === "closed-commit" ? "2" : "1")
    const recovered = await openExecutorCoordinator(dir)
    try {
      expect(await recovered.claim(holder)).toMatchObject({ kind: "phase-boundary" })
      const receipt = await recovered.report(verifier, grant.id, grant.lease, "ended")
      expect(receipt).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD").trim() })
      expect(await recovered.report(verifier, grant.id, grant.lease, "ended")).toEqual(receipt)
      expect(git(dir, "rev-list", "--count", `${executeCommit}..HEAD`).trim()).toBe("2")
      expect(git(dir, "status", "--porcelain", "--", "docs", "src")).toBe("")
      expect(await recovered.claim(holder)).toMatchObject({ kind: "phase-boundary" })
    } finally {
      await recovered.close()
    }
  })
}

test("FAIL routes to fix and fresh verification keeps the task's original baseline", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  const worker = { ...holder, token: "worker-2" }
  const verifier = { ...holder, token: "worker-3" }
  try {
    const baseline = git(dir, "rev-parse", "HEAD").trim()
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    write(dir, CONFIG_FILE, JSON.stringify({ subtask: "auto" }))
    expect(await coordinator.claim(holder, "T-001", "verify")).toMatchObject({ kind: "blocked", reason: "subtask" })
    expect(await coordinator.claim(worker, "T-001", "execute")).toMatchObject({ kind: "blocked", reason: "subtask" })
    write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
    const first = await coordinator.claim(worker, "T-001", "verify")
    if (first.kind !== "verify") throw new Error(JSON.stringify(first))
    write(dir, "docs/T-001/gaps.md", "# Verification\n\n## Gaps\n\n### Gap 1 — Fix the value\n\nResult: FAIL expected value 2\n")
    expect(await coordinator.report(worker, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", verdict: "fail", gapCount: 1 })

    write(dir, CONFIG_FILE, JSON.stringify({ subtask: "auto" }))
    expect(await coordinator.claim(worker, "T-001", "fix")).toMatchObject({ kind: "blocked", reason: "subtask" })
    write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off" }))
    expect((await coordinator.ready(worker)).claimable).toMatchObject([{ unit: "T-001", kinds: ["fix"] }])
    const fix = await coordinator.claim(worker, "T-001", "fix")
    if (fix.kind !== "fix") throw new Error(JSON.stringify(fix))
    expect(fix).toMatchObject({ id: "T-001 fix 1.1", round: 1 })
    expect(fix.prompt).toContain("gaps.md")
    write(dir, "src/widget.ts", "export const widget = 2\n")
    const fixed = await coordinator.report(worker, fix.id, fix.lease, "ended")
    if (fixed.kind !== "landed") throw new Error(JSON.stringify(fixed))
    expect(await coordinator.claim({ ...worker, channel: "another" }, "T-001", "verify")).toMatchObject({ kind: "settled", commit: fixed.commit })

    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    expect(verify).toMatchObject({ id: "T-001 verify 2", baseline, head: fixed.commit, attempt: 1 })
    write(dir, "docs/T-001/report.md",
      "# Verification\n\nThe widget exports the corrected value, and the earlier gap is resolved. The diff contains the agreed source changes and no other functional changes.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(git(dir, "ls-files", "--", "docs/T-001/gaps.md")).toBe("")
    expect(await coordinator.claim(holder)).toMatchObject({ kind: "phase-boundary" })
  } finally {
    await coordinator.close()
  }
})

test("the verify FAIL lands where the ignore entry holds the gap list ignored, and the fix round derives (0262-01)", async () => {
  const dir = ignoredArtifactProject("docs/T-*/gaps.md\n")
  const coordinator = await openExecutorCoordinator(dir)
  const worker = { ...holder, token: "worker-2" }
  const verifier = { ...holder, token: "verifier" }
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })

    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/gaps.md", "# Verification\n\n## Gaps\n\n### Gap 1 — Fix the value\n\nResult: FAIL expected value 2\n")
    // The shadow itself, pinned: plain porcelain never sees the artifact.
    expect(git(dir, "status", "--porcelain", "--", "docs/T-001/gaps.md")).toBe("")
    const failed = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(failed).toMatchObject({ kind: "landed", verdict: "fail", gapCount: 1 })
    expect(git(dir, "ls-files", "--", "docs/T-001/gaps.md").trim()).toBe("docs/T-001/gaps.md")
    expect(git(dir, "show", "HEAD:docs/T-001/gaps.md")).toContain("Result: FAIL")

    const fix = await coordinator.claim(worker, "T-001", "fix")
    if (fix.kind !== "fix") throw new Error(JSON.stringify(fix))
    expect(fix.prompt).toContain("gaps.md")
    write(dir, "src/widget.ts", "export const widget = 2\n")
    expect(await coordinator.report(worker, fix.id, fix.lease, "ended")).toMatchObject({ kind: "landed" })

    const reverify = await coordinator.claim(verifier, "T-001", "verify")
    if (reverify.kind !== "verify") throw new Error(JSON.stringify(reverify))
    write(dir, "docs/T-001/report.md",
      "# Verification\n\nThe widget exports the corrected value, and the earlier gap is resolved. The diff contains the agreed source change and no other functional changes.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(verifier, reverify.id, reverify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(git(dir, "ls-files", "--", "docs/T-001/gaps.md")).toBe("")
    expect(git(dir, "status", "--porcelain", "--", "docs", "src")).toBe("")
  } finally {
    await coordinator.close()
  }
})

test("a shadowed gap list of bad grammar blocks visibly, never a wrong verdict (P12)", async () => {
  const dir = ignoredArtifactProject("docs/T-*/gaps.md\n")
  const coordinator = await openExecutorCoordinator(dir)
  const verifier = { ...holder, token: "verifier" }
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/gaps.md", "# Verification\n\nNo countable gap headings here.\n\nResult: FAIL expected value 2\n")
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "commitFailed",
      detail: "the verification output is invalid: docs/T-001/gaps.md carries no `### Gap` heading — each countable gap is one `### Gap` heading",
    })
    expect(git(dir, "ls-files", "--", "docs/T-001/gaps.md")).toBe("")
  } finally {
    await coordinator.close()
  }
})

// 0297's fix 0298, the incident's own shape pinned (erofs T-075 verify 1): a
// report closing on prose `Verdict: PASS` plus the terminator — assembled
// from the manual's own vocabulary — refuses naming the missing machine-read
// line (the formulate collect's naming standard, 0297's remedy family 2),
// never the arm-less refusal that sent the site diffing a settled report.
test("a report without its machine-read Result line refuses naming the line (0298)", async () => {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Implement widget\n")
  write(dir, "docs/T-001/todo.md", "# Implement widget\n\nTouches: src/widget.ts\n\n## Scope\n\nImplement the widget.\n")
  commitFixture(dir)
  const coordinator = await openExecutorCoordinator(dir)
  const verifier = { ...holder, token: "verifier" }
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md",
      "# Verification\n\nThe widget exports the expected value, matching the recorded contract exactly; the diff contains the single agreed source change and nothing else.\n\nVerdict: PASS\n\n<!-- auto: eof -->\n")
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "commitFailed",
      detail: "the verification output is invalid: docs/T-001/report.md carries no `Result: PASS` line — the machine-read verdict is a line `Result: PASS`, the last `Result:` line governing",
    })
  } finally {
    await coordinator.close()
  }
})

test("the verify PASS lands and closes where the report path is shadowed (the concession's other arm)", async () => {
  const dir = ignoredArtifactProject("docs/T-*/report.md\n")
  const coordinator = await openExecutorCoordinator(dir)
  const verifier = { ...holder, token: "independent-verifier" }
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md",
      "# Verification\n\nThe widget exports the expected value. The single changed source file implements the recorded contract.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    const result = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(result).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD").trim() })
    expect(git(dir, "ls-files", "--", "docs/T-001/report.md").trim()).toBe("docs/T-001/report.md")
    expect(git(dir, "ls-files", "--", "docs/T-001/done.md").trim()).toBe("docs/T-001/done.md")
  } finally {
    await coordinator.close()
  }
})

test("an ignored handoff still lands as the execute share's artifact", async () => {
  const dir = ignoredArtifactProject("docs/T-*/handoff.md\n")
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe widget landed.\n\nStatus: done\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "ls-files", "--", "docs/T-001/handoff.md").trim()).toBe("docs/T-001/handoff.md")
  } finally {
    await coordinator.close()
  }
})

test("an ignored non-artifact write stays invisible — the 0249 floor unchanged (P10)", async () => {
  const dir = ignoredArtifactProject("notes.md\n")
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const before = git(dir, "rev-parse", "HEAD").trim()
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "notes.md", "session scribble outside every permitted set\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "without-landing", reason: "zero-write" })
    expect(git(dir, "ls-files", "--", "notes.md")).toBe("")
    expect(git(dir, "rev-parse", "HEAD").trim()).toBe(before)
  } finally {
    await coordinator.close()
  }
})

test("two re-verifications with identical FAIL evidence exhaust the progress budget", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  const verifier = { ...holder, token: "verifier" }
  const evidence = "# Verification\n\n## Gaps\n\n### Gap 1 — Fix the value\n\nResult: FAIL expected value 2\n"
  try {
    const execute = await coordinator.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    expect(await coordinator.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
    for (const round of [1, 2, 3]) {
      const verify = await coordinator.claim(verifier)
      if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
      write(dir, "docs/T-001/gaps.md", evidence)
      expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "fail", gapCount: 1 })
      if (round === 3) break
      const fix = await coordinator.claim(holder)
      if (fix.kind !== "fix") throw new Error(JSON.stringify(fix))
      write(dir, "src/widget.ts", `export const widget = ${round + 2}\n`)
      expect(await coordinator.report(holder, fix.id, fix.lease, "ended")).toMatchObject({ kind: "landed" })
      expect(git(dir, "ls-files", "--", "docs/T-001/gaps.md")).toBe("")
    }
    expect(await coordinator.claim(holder)).toMatchObject({ kind: "blocked", reason: "fixBudget" })
    expect((await coordinator.ready(verifier)).claimable).toEqual([])
    expect(readFileSync(join(dir, "docs/T-001/gaps.md"), "utf8")).toBe(evidence)
  } finally {
    await coordinator.close()
  }
})

test("a landed handoff advances the execute share ordinal and carries a continuation brief", async () => {
  const dir = executableProject()
  const first = await openExecutorCoordinator(dir)
  try {
    const execute = await first.claim(holder)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe implementation began. Finish the second part.\n\nStatus: continue\n")
    expect(await first.report(holder, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed", continuation: true })
  } finally {
    await first.close()
  }
  const second = await openExecutorCoordinator(dir)
  try {
    const worker = { ...holder, token: "worker-2" }
    const execute = await second.claim(worker)
    if (execute.kind !== "execute") throw new Error(JSON.stringify(execute))
    expect(execute).toMatchObject({ id: "T-001 exec 2", attempt: 1 })
    expect(execute.prompt).toContain("First read docs/T-001/handoff.md")
    await second.release(worker, execute.id, execute.lease)
    const replacement = await second.claim(worker)
    if (replacement.kind !== "execute") throw new Error(JSON.stringify(replacement))
    expect(replacement).toMatchObject({ id: execute.id, attempt: 1 })
    expect(replacement.prompt).toContain("First read docs/T-001/handoff.md")
    write(dir, "src/widget.ts", "export const widget = 2\n")
    expect(await second.report(worker, replacement.id, replacement.lease, "ended")).toMatchObject({ kind: "landed" })
    expect((await second.ready(holder)).claimable).toMatchObject([{ unit: "T-001", kinds: ["verify"] }])
  } finally {
    await second.close()
  }
})

function surveyReleaseProject() {
  const dir = project()
  write(dir, ".opencode/auto/phases/survey.md", "# Survey\n\nGate: human\n\n## plan duties\n\nRead the sources.\n\n<!-- auto: eof -->\n")
  const path = phase(dir, "survey")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [x] T-001 Survey sources\n")
  write(dir, `${path}/handover.md`, PHASE_HANDOVER)
  write(dir, "docs/T-001/done.md", "# Survey sources\n")
  commitFixture(dir)
  const document = `${path}/survey.md`
  const proposal = "# Survey\n\nFork: scope — widen coverage? Recommend: keep it narrow.\n"
  write(dir, document, proposal)
  return { dir, document, proposal }
}

const releaser = { token: "person", channel: "review", delegation: ["releases"] as const }

// 0271 (0262-04's fix): the pending person items on the read surface —
// existence for every reader, question content only for question authority,
// the no-questions wait arm naming pending gate existence, answering
// unchanged.
test("ready lists the document-derived gate items alone (plans/0282)", async () => {
  const { dir } = surveyReleaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    // The ask channel is gone: the pending list carries the awaiting gate
    // (kind, gate, document) derived from the documents — nothing else.
    expect((await coordinator.ready(holder)).pending).toEqual([
      { kind: "gate", gate: "survey-release", document: "docs/R-01/P01-survey/survey.md" },
    ])
    // The derivation is authority-blind (the documents are the source):
    // every reader sees the same row.
    expect((await coordinator.ready({ token: "other", channel: "other" })).pending).toEqual([
      { kind: "gate", gate: "survey-release", document: "docs/R-01/P01-survey/survey.md" },
    ])
  } finally {
    await coordinator.close()
  }
})

// 0272 (0262-03's fix): the blocked settlement escalation letter — a cause
// outside the holder's permitted set auto-raises one question item through
// the standing channel (the dedup-while-pending holding across retries and
// both settlement entries), the blocked answer naming the ladder, the item
// visible on 0271's read surface for every reader with its text for
// question authority.
test("a blocked settlement outside the holder's permitted set names the person-necessary cause plainly (plans/0282)", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    // A foreign commit moves HEAD — a cause no permitted write of the
    // holder can remedy (git ground truth, the coordinator's alone).
    write(dir, "foreign.txt", "person edit\n")
    git(dir, "add", "foreign.txt")
    git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Foreign")
    const blocked = await coordinator.report(holder, grant.id, grant.lease, "ended")
    // The ask channel is gone: no question item is raised, no store is
    // written — the plain blocked answer naming the person-necessary cause
    // is the whole surface, the round waiting until a person looks.
    expect(blocked).toEqual({
      kind: "blocked", reason: "isolation", actor: "person",
      detail: "HEAD moved outside the booked share. Inspect the commit and executor progress before resuming. The cause is outside this lease's permitted writes — a person must inspect the state; retrying cannot fix it.",
    })
    expect(await Bun.file(join(dir, ".auto/executor-questions.json")).exists()).toBe(false)
    // 0287's held row: the booked-but-blocked settlement is the lane's own
    // answer, surfaced on the menu beside the empty claimable set.
    expect((await coordinator.ready({ ...holder, token: "worker-2" })).pending).toEqual([
      { kind: "wait", reason: "in-flight", actor: "workflow", detail: "A previous share requires settlement." },
    ])
    // The retry's replay is byte-identical (P10), through both settlement
    // entries — the report replay and a successor claim's settle.
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toEqual(blocked)
    const reclaimed = await coordinator.claim({ ...holder, token: "worker-2" })
    if (reclaimed.kind !== "blocked" || blocked.kind !== "blocked") throw new Error(JSON.stringify(reclaimed))
    expect(reclaimed).toEqual(blocked)
  } finally {
    await coordinator.close()
  }
})

// 0272's floor (P10) and classification boundary (P12): a cause the holder
// can remedy itself answers byte-identically — no raise, no new shape — at
// the boundary too (an out-of-scope edit outside the never-set, alone or
// mixed with a never-set path, reads replay-side; the escalation emerges
// only when the never-set is the whole residual — 0248 D5's person-resolves
// letter).
test("replayable causes keep today's blocked answer byte-identical and raise nothing", async () => {
  const dir = executableProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "src/widget.ts", "export const widget = 1\n")
    write(dir, "src/other.ts", "export const other = 1\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toEqual({
      kind: "blocked", reason: "isolation", actor: "executor", detail: "Resolve out-of-scope edits before replaying: src/other.ts.",
    })
    // The mixed boundary: the holder's own out-of-scope edit beside a
    // never-set path — conservative, replay-side.
    write(dir, "AGENTS.md", "person edit\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toEqual({
      kind: "blocked", reason: "isolation", actor: "executor", detail: "Resolve out-of-scope edits before replaying: AGENTS.md, src/other.ts.",
    })
    expect(existsSync(join(dir, ".auto/executor-questions.json"))).toBe(false)
    // 0287's held row (the booked report awaiting settlement); no question
    // item is raised beside it.
    expect((await coordinator.ready(holder)).pending).toEqual([
      { kind: "wait", reason: "in-flight", actor: "workflow", detail: "A previous share requires settlement." },
    ])
    // The never-set alone is the person's remedy (0248 D5): the same cause
    // site escalates once the holder's own edit is gone.
    rmSync(join(dir, "src/other.ts"))
    // The never-set alone names the person-necessary cause — the plain
    // blocked answer (plans/0282: no raise, no store, the round waiting).
    const escalated = await coordinator.report(holder, grant.id, grant.lease, "ended")
    expect(escalated).toEqual({
      kind: "blocked", reason: "isolation", actor: "person",
      detail: "Resolve out-of-scope edits before replaying: AGENTS.md. The cause is outside this lease's permitted writes — a person must inspect the state; retrying cannot fix it.",
    })
    expect(existsSync(join(dir, ".auto/executor-questions.json"))).toBe(false)
  } finally {
    await coordinator.close()
  }
})

// 0272's closed loop at the coordinator level: blocked holder → the raised
// item → the person's answer → the world repaired by the person (the remedy
// the holder could never make) → the retry lands → the holder's next brief
// for the task carries the answer (the standing answerCursor machinery,
// 0250 — the continuation grant renders it as data).


function parkProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Parked task\n- [ ] T-002 Blocker\n")
  write(dir, "docs/T-001/todo.md", "# Parked task\n\nDepends: none\nTouches: src/first.ts\n")
  write(dir, "docs/T-002/todo.md", "# Blocker\n\nDepends: T-001\nTouches: src/second.ts\n")
  commitFixture(dir)
  return dir
}

for (const point of ["booked", "committed", "park-recorded"]) {
  test(`recovers a dependency park after ${point} and resumes after the blocker closes`, async () => {
    const dir = parkProject()
    const coordinator = await openExecutorCoordinator(dir)
    const first = await coordinator.claim(holder)
    await coordinator.close()
    if (first.kind !== "execute") throw new Error(JSON.stringify(first))
    write(dir, "src/first.ts", "export const first = 1\n")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nResume after the dependency is available.\n\nStatus: park T-002\n")
    await crashReport(dir, holder, first.id, first.lease, point)

    const recovered = await openExecutorCoordinator(dir)
    try {
      const second = await recovered.claim(holder)
      if (second.kind !== "execute") throw new Error(JSON.stringify(second))
      expect(second.unit).toBe("T-002")
      expect(await recovered.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", parked: "T-002" })
      expect(git(dir, "log", "--format=%s").split("\n").filter((subject) => subject.startsWith("T-001 park "))).toHaveLength(1)
      write(dir, "src/second.ts", "export const second = 2\n")
      expect(await recovered.report(holder, second.id, second.lease, "ended")).toMatchObject({ kind: "landed" })
      const verifier = { ...holder, token: "verifier" }
      const verify = await recovered.claim(verifier)
      if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
      write(dir, "docs/T-002/report.md", "# Verification\n\nThe blocker now exports the dependency required by the first task. The implementation is confined to its declared source file.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
      expect(await recovered.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
      const resumed = await recovered.claim(holder)
      if (resumed.kind !== "execute") throw new Error(JSON.stringify(resumed))
      expect(resumed.unit).toBe("T-001")
      expect(resumed.prompt).toContain("docs/T-001/handoff.md")
      expect(resumed.prompt).toContain("T-002")
      expect(resumed.id).not.toBe(first.id)
    } finally {
      await recovered.close()
    }
  })
}

test("mutual dependency parks block further dispatch", async () => {
  const dir = parkProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    for (const [unit, blocker] of [["T-001", "T-002"], ["T-002", "T-001"]]) {
      const grant = await coordinator.claim(holder)
      if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
      expect(grant.unit).toBe(unit!)
      write(dir, `docs/${unit}/handoff.md`, `# Handoff\n\nStatus: park ${blocker}\n`)
      expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed", parked: blocker })
    }
    expect(await coordinator.claim(holder)).toMatchObject({ kind: "blocked", reason: "mutualPark", actor: "person" })
  } finally {
    await coordinator.close()
  }
})

// 0308: the parked unit reads as a workflow wait on the menu — the row
// naming its blocker beside the blocker's own claimable work, so a
// non-claimable unit is waiting rather than absent; the person's mutual
// park stays the blocked answer, never a waiting row's meaning.
test("the menu names parked units as workflow waits (plans/0308)", async () => {
  const dir = parkProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const first = await coordinator.claim(holder)
    if (first.kind !== "execute") throw new Error(JSON.stringify(first))
    write(dir, "src/first.ts", "export const first = 1\n")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nStatus: park T-002\n")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", parked: "T-002" })
    const menu = await coordinator.ready(holder)
    expect(menu.waiting).toEqual([{ unit: "T-001", title: "Parked task", blocker: "T-002" }])
    expect(menu.claimable).toMatchObject([{ unit: "T-002", title: "Blocker", kinds: ["execute"] }])
    expect(menu.pending).toEqual([])
  } finally {
    await coordinator.close()
  }
})

test("a dependency park cannot land before its declared artifacts exist", async () => {
  const dir = parkProject()
  const path = "docs/T-001/todo.md"
  write(dir, path, readFileSync(join(dir, path), "utf8") + "Artifacts: src/first.ts\n")
  commitFixture(dir)
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const first = await coordinator.claim(holder)
    if (first.kind !== "execute") throw new Error(JSON.stringify(first))
    const base = git(dir, "rev-parse", "HEAD")
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nStatus: park T-002\n")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "blocked", reason: "commitFailed", actor: "executor" })
    expect(git(dir, "rev-parse", "HEAD")).toBe(base)
    write(dir, "src/first.ts", "export const first = 1\n")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", parked: "T-002" })
  } finally {
    await coordinator.close()
  }
})

test("parallel projects keep simultaneous leases, renewal and settled replay isolated", async () => {
  const firstDir = executableProject()
  const secondDir = executableProject()
  let clock = Date.now()
  const first = await openExecutorCoordinator(firstDir, { now: () => clock })
  const second = await openExecutorCoordinator(secondDir, { now: () => clock })
  try {
    const [left, right, overlap] = await Promise.all([
      first.claim(holder), second.claim(holder), first.claim({ ...holder, channel: "other" }),
    ])
    if (left.kind !== "execute" || right.kind !== "execute") throw new Error(JSON.stringify({ left, right, overlap }))
    expect(overlap).toMatchObject({ kind: "wait", reason: "lease-held" })
    const leftKey = { step: left.id, lease: left.lease }
    const rightKey = { step: right.id, lease: right.lease }
    clock += 5_000
    await expect(second.heartbeat(holder, [leftKey, rightKey])).rejects.toThrow()
    expect((await second.ready(holder)).leases).toMatchObject([{ ...rightKey, deadline: right.deadline }])
    write(firstDir, "src/widget.ts", "export const widget = 1\n")
    write(secondDir, "src/widget.ts", "export const widget = 2\n")
    const receipt = await first.report(holder, left.id, left.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed" })
    expect(await first.report(holder, left.id, left.lease, "ended")).toEqual(receipt)
    expect((await second.heartbeat(holder, [rightKey])).leases).toMatchObject([{ ...rightKey, deadline: right.deadline + 5_000 }])
    expect(git(secondDir, "status", "--porcelain", "--", "src/widget.ts")).toBe("?? src/widget.ts\n")
    expect(git(firstDir, "show", "HEAD:src/widget.ts")).toBe("export const widget = 1\n")
  } finally {
    await Promise.all([first.close(), second.close()])
  }
})

function docLeaseProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 First\n- [ ] T-002 Second\n- [ ] T-003 Overlap\n- [ ] T-004 Dependent\n- [ ] T-005 Code\n")
  write(dir, "docs/T-001/todo.md", "# First\n\nTouches: docs/first.md\n")
  write(dir, "docs/T-002/todo.md", "# Second\n\nDepends: none\nTouches: docs/second.md\n")
  write(dir, "docs/T-003/todo.md", "# Overlap\n\nDepends: none\nTouches: docs/T-001/notes.md\n")
  write(dir, "docs/T-004/todo.md", "# Dependent\n\nDepends: T-001\nTouches: docs/dependent.md\n")
  write(dir, "docs/T-005/todo.md", "# Code\n\nDepends: none\nTouches: src/code.ts\n")
  commitFixture(dir)
  return dir
}

const secondWorker = { token: "worker-2", channel: "child-2" }
const verifier = { token: "verifier", channel: "verify-doc" }
const docPass = "# Verification\n\nInspected the documentation changes and confirmed they match the task.\n\nResult: PASS\n\n<!-- auto: eof -->\n"

test("same-tree documentation leases reserve effective scopes and land only their own changes", async () => {
  const dir = docLeaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    expect((await coordinator.ready(holder)).claimable.map(({ unit }) => unit)).toEqual(["T-001", "T-002", "T-003"])
    const first = await coordinator.claim(holder, "T-001", "execute")
    if (first.kind !== "execute") throw new Error(JSON.stringify(first))
    write(dir, "docs/first.md", "# First\n")
    expect(await coordinator.claim(secondWorker, "T-003", "execute")).toMatchObject({ kind: "wait", reason: "lease-held" })
    expect(await coordinator.claim(secondWorker, "T-004", "execute")).toMatchObject({ kind: "wait" })
    expect(await coordinator.claim(secondWorker, "T-005", "execute")).toMatchObject({ kind: "wait" })
    const second = await coordinator.claim(secondWorker, "T-002", "execute")
    if (second.kind !== "execute") throw new Error(JSON.stringify(second))
    expect(second.workspace).toBe(first.workspace)
    expect(await coordinator.brief(holder, "T-001")).toEqual(first)
    write(dir, "docs/second.md", "# Second\n")
    const share = await coordinator.report(holder, first.id, first.lease, "ended")
    expect(share).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("docs/first.md\n")
    expect(git(dir, "status", "--porcelain", "--", "docs/second.md")).toBe("?? docs/second.md\n")
    const settledShare = await coordinator.claim(holder, "T-001", "verify")
    if (settledShare.kind !== "settled" || share.kind !== "landed") throw new Error(JSON.stringify(settledShare))
    expect(settledShare.commit).toBe(share.commit)
    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md", docPass)
    const closed = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(closed).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(closed.kind === "landed" && typeof closed.closeCommit).toBe("string")
    expect(git(dir, "status", "--porcelain", "--", "docs/second.md")).toBe("?? docs/second.md\n")
    const other = await coordinator.report(secondWorker, second.id, second.lease, "ended")
    expect(other).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("docs/second.md\n")
    expect(await coordinator.report(secondWorker, second.id, second.lease, "ended")).toEqual(other)
    expect((await coordinator.ready(holder)).claimable.map(({ unit }) => unit)).toContain("T-004")
  } finally {
    await coordinator.close()
  }
})

test("same-tree takeover fences stale reports across restart and preserves sibling dirt", async () => {
  const dir = docLeaseProject()
  let at = 1000
  const now = () => at
  let coordinator = await openExecutorCoordinator(dir, { now })
  try {
    const first = await coordinator.claim(holder, "T-001", "execute")
    if (first.kind !== "execute") throw new Error(JSON.stringify(first))
    at += 10_000
    const second = await coordinator.claim(secondWorker, "T-002", "execute")
    if (second.kind !== "execute") throw new Error(JSON.stringify(second))
    write(dir, "docs/first.md", "# First before takeover\n")
    write(dir, "docs/second.md", "# Second\n")
    at = first.deadline
    await coordinator.close()
    coordinator = await openExecutorCoordinator(dir, { now })
    const replacement = await coordinator.claim(verifier, "T-001", "execute")
    if (replacement.kind !== "execute") throw new Error(JSON.stringify(replacement))
    expect(replacement.attempt).toBe(2)
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "wait", reason: "lease-held" })
    expect(git(dir, "status", "--porcelain", "--", "docs/first.md", "docs/second.md")).toBe("?? docs/first.md\n?? docs/second.md\n")
    expect(await coordinator.report(secondWorker, second.id, second.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(await coordinator.report(verifier, replacement.id, replacement.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD")).toBe("docs/first.md\n")
  } finally {
    await coordinator.close()
  }
})

test("same-tree reports refuse unreserved dirt and staged sibling paths", async () => {
  const dir = docLeaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const first = await coordinator.claim(holder, "T-001")
    const second = await coordinator.claim(secondWorker, "T-002")
    if (first.kind !== "execute" || second.kind !== "execute") throw new Error(JSON.stringify({ first, second }))
    write(dir, "docs/first.md", "# First\n")
    write(dir, "docs/second.md", "# Second\n")
    write(dir, "docs/unowned.md", "# Unowned\n")
    const before = git(dir, "rev-parse", "HEAD")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "blocked", detail: expect.stringContaining("docs/unowned.md") })
    rmSync(join(dir, "docs/unowned.md"))
    git(dir, "add", "--", "docs/second.md")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "blocked", detail: expect.stringContaining("docs/second.md") })
    expect(git(dir, "rev-parse", "HEAD")).toBe(before)
    git(dir, "restore", "--staged", "--", "docs/second.md")
    expect(await coordinator.report(holder, first.id, first.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "status", "--porcelain", "--", "docs/second.md")).toBe("?? docs/second.md\n")
  } finally {
    await coordinator.close()
  }
})

test("same-tree settlement replay proves the booked parent after a sibling share", async () => {
  const dir = docLeaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  const first = await coordinator.claim(holder, "T-001")
  const second = await coordinator.claim(secondWorker, "T-002")
  if (first.kind !== "execute" || second.kind !== "execute") throw new Error(JSON.stringify({ first, second }))
  write(dir, "docs/first.md", "# First\n")
  write(dir, "docs/second.md", "# Second\n")
  const firstShare = await coordinator.report(holder, first.id, first.lease, "ended")
  if (firstShare.kind !== "landed") throw new Error(JSON.stringify(firstShare))
  await coordinator.close()
  await crashReport(dir, secondWorker, second.id, second.lease, "committed")
  const recovered = await openExecutorCoordinator(dir)
  try {
    const secondShare = await recovered.report(secondWorker, second.id, second.lease, "ended")
    expect(secondShare).toMatchObject({ kind: "landed" })
    expect(await recovered.report(secondWorker, second.id, second.lease, "ended")).toEqual(secondShare)
    expect(git(dir, "rev-parse", "HEAD^").trim()).toBe(firstShare.commit)
    expect(git(dir, "log", "-1", "--format=%s", "HEAD").trim()).toBe(second.id)
  } finally {
    await recovered.close()
  }
})

// 0274 (0264-03's fix), the same-tree arm: a person amendment on main
// between sibling shares — the commit the settlement's walk and the
// verification walk both read as terminal divergence before the class.
test("a person amendment between same-tree shares passes the settlement and verification walks", async () => {
  const dir = docLeaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const first = await coordinator.claim(holder, "T-001")
    const second = await coordinator.claim(secondWorker, "T-002")
    if (first.kind !== "execute" || second.kind !== "execute") throw new Error(JSON.stringify({ first, second }))
    write(dir, "docs/first.md", "# First\n")
    write(dir, "docs/second.md", "# Second\n")
    const firstShare = await coordinator.report(holder, first.id, first.lease, "ended")
    if (firstShare.kind !== "landed") throw new Error(JSON.stringify(firstShare))
    write(dir, "housekeeping.md", "person note\n")
    git(dir, "add", "housekeeping.md")
    git(dir, "-c", "user.name=Person", "-c", "user.email=person@example.invalid", "commit", "-m", "Person housekeeping between shares")
    const amendment = git(dir, "rev-parse", "HEAD").trim()
    // The sibling settlement re-bases over the amendment (its booked parent
    // walks past it), and its share lands on top.
    const secondShare = await coordinator.report(secondWorker, second.id, second.lease, "ended")
    expect(secondShare).toMatchObject({ kind: "landed" })
    expect(git(dir, "rev-parse", "HEAD^").trim()).toBe(amendment)
    expect(git(dir, "log", "-1", "--format=%s", "HEAD").trim()).toBe(second.id)
    // Verification over the amended chain proceeds (the producer walk passes
    // the amendment and the sibling's booked share) and closes the unit.
    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md", docPass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, "housekeeping.md"), "utf8")).toBe("person note\n")
    expect(git(dir, "status", "--porcelain", "--", "docs", "housekeeping.md")).toBe("")
  } finally {
    await coordinator.close()
  }
})

test("an explicitly targeted code task keeps serial ownership until it settles", async () => {
  const dir = docLeaseProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const code = await coordinator.claim(holder, "T-005", "execute")
    if (code.kind !== "execute") throw new Error(JSON.stringify(code))
    expect(await coordinator.claim(secondWorker, "T-001", "execute")).toMatchObject({ kind: "wait", reason: "lease-held" })
    write(dir, "src/code.ts", "export const code = 1\n")
    expect(await coordinator.report(holder, code.id, code.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await coordinator.claim(verifier, "T-005", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-005/report.md", docPass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(await coordinator.claim(secondWorker, "T-001", "execute")).toMatchObject({ kind: "execute", unit: "T-001" })
  } finally {
    await coordinator.close()
  }
})

// The 0257-02 reproduction shape: a document-deliverable task — its `Touches:`
// declaring its own document surfaces (a register under docs/T-001/, receipts
// under docs/T-001/testhands/, an evidence doc under a sibling task's
// directory) — which the freeform-only role gate could never settle (0259
// serves what 0248 D5's scope-based permitted set always ruled).
function docDeliverableProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Record the register\n- [ ] T-002 Sibling\n")
  write(dir, "docs/T-001/todo.md", "# Record the register\n\nDepends: none\nTouches: docs/T-001/register.md, docs/T-001/testhands/lane.md, docs/T-002/evidence.md\n\n## Scope\n\nWrite the register and its receipts.\n")
  write(dir, "docs/T-002/todo.md", "# Sibling\n\nDepends: none\nTouches: docs/T-002/own.md\n")
  commitFixture(dir)
  return dir
}

test("a document-deliverable task settles its declared artifact-role writes and closes", async () => {
  const dir = docDeliverableProject()
  const base = git(dir, "rev-parse", "HEAD").trim()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    // The evidence declaration overlaps the sibling's own directory, so its
    // reservation waits until this unit settles (0253's disjointness).
    expect(await coordinator.claim(secondWorker, "T-002", "execute")).toMatchObject({ kind: "wait", reason: "lease-held" })
    write(dir, "docs/T-001/register.md", "# Register\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-001/testhands/lane.md", "# Receipt\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-002/evidence.md", "# Evidence\n\n<!-- auto: eof -->\n")
    // The widening is scope-bounded: an out-of-scope artifact-role path still fences.
    write(dir, "docs/T-009/stray.md", "# Stray\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({
      kind: "blocked", reason: "isolation", detail: expect.stringContaining("docs/T-009/stray.md"),
    })
    rmSync(join(dir, "docs/T-009"), { recursive: true, force: true })
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe register and its receipts are written.\n\nStatus: done\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n").sort()).toEqual([
      "docs/T-001/handoff.md", "docs/T-001/register.md", "docs/T-001/testhands/lane.md", "docs/T-002/evidence.md",
    ])
    expect(git(dir, "rev-list", "--count", `${base}..HEAD`).trim()).toBe("1")

    const verify = await coordinator.claim(verifier, "T-001", "verify")
    if (verify.kind !== "verify") throw new Error(JSON.stringify(verify))
    write(dir, "docs/T-001/report.md", docPass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(git(dir, "ls-files", "--", "docs/T-001/done.md").trim()).toBe("docs/T-001/done.md")
    expect(await coordinator.claim(secondWorker, "T-002", "execute")).toMatchObject({ kind: "execute", unit: "T-002" })
  } finally {
    await coordinator.close()
  }
})

function undeclaredProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Undeclared work\n")
  write(dir, "docs/T-001/todo.md", "# Undeclared work\n\n## Scope\n\nNo declared surfaces.\n")
  commitFixture(dir)
  return dir
}

test("an undeclared unit keeps the freeform-only serial floor over process-tree paths", async () => {
  const dir = undeclaredProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "src/anywhere.ts", "export const free = 1\n")
    write(dir, "docs/notes-free.md", "# A freeform docs path\n")
    write(dir, "docs/T-001/context.md", "# A process-tree artifact\n")
    const blocked = await coordinator.report(holder, grant.id, grant.lease, "ended")
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    expect(blocked.detail).toContain("docs/T-001/context.md")
    expect(blocked.detail).not.toContain("docs/notes-free.md")
    rmSync(join(dir, "docs/T-001/context.md"))
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n").sort()).toEqual([
      "docs/notes-free.md", "src/anywhere.ts",
    ])
  } finally {
    await coordinator.close()
  }
})

// A scope that declares all of docs/ (the widest document deliverable): the
// never-list's docs members must stay fenced even inside it (0246 D4 i).
function wideDocsProject() {
  const dir = project()
  const path = phase(dir, "implement")
  write(dir, `${path}/tasks.md`, "# Tasks\n\n- [ ] T-001 Write the corpus\n- [ ] T-002 Neighbor\n")
  write(dir, "docs/T-001/todo.md", "# Write the corpus\n\nDepends: none\nTouches: docs/\n\n## Scope\n\nEverything under docs is the deliverable.\n")
  write(dir, "docs/T-002/todo.md", "# Neighbor\n\nDepends: none\nTouches: src/neighbor.ts\n")
  commitFixture(dir)
  return dir
}

test("driver-exclusive docs surfaces stay fenced inside a scope that declares them", async () => {
  const dir = wideDocsProject()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await coordinator.claim(holder)
    if (grant.kind !== "execute") throw new Error(JSON.stringify(grant))
    write(dir, "docs/T-001/register.md", "# Register\n\n<!-- auto: eof -->\n")
    write(dir, "docs/T-002/todo.md", "# Forged unit state\n")
    write(dir, "docs/R-01/phases.md", "# Forged ledger\n")
    write(dir, "docs/R-01/P01-implement/tasks.md", "# Forged index\n")
    write(dir, "docs/T-001/subtasks.md", "# Forged checklist\n")
    const blocked = await coordinator.report(holder, grant.id, grant.lease, "ended")
    if (blocked.kind !== "blocked") throw new Error(JSON.stringify(blocked))
    for (const refused of ["docs/T-002/todo.md", "docs/R-01/phases.md", "docs/R-01/P01-implement/tasks.md", "docs/T-001/subtasks.md"]) {
      expect(blocked.detail).toContain(refused)
    }
    expect(blocked.detail).not.toContain("docs/T-001/register.md")
    git(dir, "checkout", "--", "docs/T-002/todo.md", "docs/R-01/phases.md", "docs/R-01/P01-implement/tasks.md")
    rmSync(join(dir, "docs/T-001/subtasks.md"))
    write(dir, "docs/T-001/handoff.md", "# Handoff\n\nThe corpus register is written.\n\nStatus: done\n")
    expect(await coordinator.report(holder, grant.id, grant.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").trim().split("\n").sort()).toEqual([
      "docs/T-001/handoff.md", "docs/T-001/register.md",
    ])
  } finally {
    await coordinator.close()
  }
})
