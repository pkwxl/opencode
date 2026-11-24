import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { liveRunLock } from "@opencode-ai/auto-core/lock"
import { executorTypeCatalog } from "@opencode-ai/auto-core/executor-coordinator"
import { buildFingerprint, VERSION } from "../src/version"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fixtureProject, gitOf, TASK, TASK_2, TASK_2_DOC } from "./fixtures/project"

test("the daemon routes authenticated executor requests to one launcher-confined coordinator and recovers across restarts", async () => {
  const directory = await fixtureProject("auto-executor-e2e-", { subtask: "off" })
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const verifier = store.issueToken("executor", "verifier").token
  const control = store.issueToken("control", "control").token
  const git = gitOf(directory)
  let daemon: DaemonHandle | undefined
  async function call(operation: string, body: unknown, token?: string, expected = 200) {
    const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${operation}`, {
      method: "POST",
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    })
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(expected)
    return result
  }
  const start = () => startDaemon({ dataDir, port: 0 })
  try {
    await Bun.write(join(directory, "docs", TASK, "todo.md"), `# ${TASK}: the widget\n\nTouches: src/widget.ts\n\n## Scope\n\nBuild the widget.\n`)
    // 0277: a valid phase handover committed ahead — the fixture models the
    // post-distillation boundary (the push skip condition holding), so the
    // close-out's next step reads the boundary, not the claimable
    // distillation.
    await Bun.write(join(directory, "docs/R-01/P01-implement/handover.md"), [
      "# Handover", "",
      ...["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]
        .map((section) => `${section}\n\nDistilled content.\n`),
    ].join("\n"))
    await git("add", "-A")
    await git("commit", "-qm", "declare write scope")
    daemon = await start()

    await call("ready", {}, undefined, 401)
    await call("ready", {}, control, 403)
    await call("heartbeat", {}, worker, 400)
    await call("claim", { role: "person" }, worker, 400)

    await call("ready", { extraField: true }, worker)
    const [ready, claimed] = await Promise.all([
      call("ready", {}, worker),
      call("claim", {}, worker),
    ])
    expect(ready.protocol).toBe(0.1)
    expect(Object.keys(ready).sort()).toEqual(["build", "menu", "protocol"])
    // 0270's additive carrier: the build fingerprint rides the ready
    // envelope beside protocol — the handshake every session starts with,
    // the one place identity needs carrying. This suite runs the bridge from
    // source, so the commit is the resolved line (plans/0293): the tool
    // tree's own commit at the worker's spawn, plus dirt when the checkout
    // is dirty — `dev` alone only when git cannot name the tree, never a
    // fabricated sha; a client that ignores the field reads the pre-change
    // envelope.
    expect(ready.build).toEqual(buildFingerprint(ready.build.commit))
    expect(ready.build.version).toBe(VERSION)
    expect(ready.build.commit).toMatch(/^[0-9a-f]{7,40}(\+dirty)?$/)
    const { build, ...envelopeBefore } = ready
    expect(build).toEqual(ready.build)
    expect(Object.keys(envelopeBefore).sort()).toEqual(["menu", "protocol"])
    // 0269's additive carrier: the restriction catalog rides the menu itself
    // (0246 D4 b's menu letter — the single dispatch-time payload), the
    // worker passing the coordinator's rendering through with no second
    // author; a client that ignores the block reads the pre-change menu.
    // 0271's additive half rides the same menu: the pending person items,
    // the empty floor here (nothing pending on a bare project).
    expect(Object.keys(ready.menu).sort()).toEqual(["claimable", "leases", "pending", "types", "waiting"])
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "synthesize", "verify"])
    // 0281's wire pin: the synthesize kind joins the claim vocabulary — a
    // targeted ask parses (never the pre-change 400 of an unknown word) and
    // answers the honest wait over this fixture (no formulation unit
    // stands, so no synthesize step derives); an unknown word still 400s.
    expect(await call("claim", { kind: "synthesize" }, verifier)).toMatchObject({ protocol: 0.1, step: { kind: "wait" } })
    expect((await call("claim", { kind: "telepath" }, verifier, 400)).error).toContain("synthesize")
    const { types, pending, waiting, ...menuBefore } = ready.menu
    expect(Object.keys(menuBefore).sort()).toEqual(["claimable", "leases"])
    expect(pending).toEqual([])
    expect(waiting).toEqual([])
    expect(claimed).toMatchObject({ protocol: 0.1, step: { kind: "execute", unit: TASK, workspace: directory } })
    expect(liveRunLock(directory)).toBeDefined()
    const lease = { step: claimed.step.id, lease: claimed.step.lease }
    // A client that loses an untargeted claim response can recover its lease through ready.
    expect((await call("ready", {}, worker)).menu.leases).toMatchObject([{ lease: lease.lease }])
    expect((await call("ready", { channel: "another-channel" }, worker)).menu.leases).toEqual([])
    expect((await call("ready", {}, verifier)).menu.leases).toEqual([])
    expect(await call("brief", { task: TASK, kind: "execute" }, worker)).toEqual(claimed)
    expect((await call("brief", { task: TASK, kind: "fix" }, worker)).step.kind).toBe("wait")
    await call("heartbeat", { leases: [lease, { ...lease, lease: "never-issued" }] }, worker, 400)
    expect((await call("ready", {}, worker)).menu.leases[0].deadline).toBe(claimed.step.deadline)
    expect((await call("heartbeat", { leases: [lease] }, worker)).menu.leases[0].lease).toBe(lease.lease)
    expect((await call("claim", {}, verifier)).step.reason).toBe("lease-held")
    expect((await call("claim", { channel: "solo" }, worker)).step.reason).toBe("lease-held")
    // 0282: the ask channel is gone — the question/answer routes are
    // tombstoned (the 400/404 pins below) and no person grant exists; a
    // control token never reaches the executor routes.
    await call("question", { text: "Which implementation?" }, worker, 404)
    await call("ready", {}, control, 403)
    await call("claim", { role: "person" }, worker, 400)
    await call("release", lease, worker)
    const replacement = (await call("claim", { task: TASK }, worker)).step
    expect(replacement.lease).not.toBe(lease.lease)
    const replacementKey = { step: replacement.id, lease: replacement.lease }
    await call("release", lease, worker)
    expect((await call("heartbeat", { leases: [lease] }, worker)).menu.leases[0].deadline).toBe(replacement.deadline)

    await Bun.write(join(directory, "src/widget.ts"), "export const widget = true\n")
    const report = { ...replacementKey, outcome: "ended", note: "Widget implemented." }
    const forbidden = join(directory, "src/outside.ts")
    await Bun.write(forbidden, "export const outside = true\n")
    const beforeReport = await git("rev-parse", "HEAD")
    expect((await call("report", report, worker)).step).toMatchObject({ kind: "blocked", code: "isolation" })
    expect(await git("rev-parse", "HEAD")).toBe(beforeReport)
    expect((await call("claim", {}, verifier)).step).toMatchObject({ kind: "blocked", code: "isolation" })
    await rm(forbidden)
    await daemon.stop()
    expect(liveRunLock(directory)).toBeUndefined()

    daemon = await start()
    expect((await call("ready", {}, verifier)).menu).toEqual({
      claimable: [], leases: [], types: executorTypeCatalog(), waiting: [],
      pending: [{ kind: "wait", reason: "in-flight", actor: "workflow", detail: "A previous share requires settlement." }],
    })
    expect(await git("rev-parse", "HEAD")).toBe(beforeReport)
    // 0273 on the wire: the same-token verify claim over the booked report
    // (the claim itself settling the replayed share above) renders the
    // settled terminal — the additive step kind naming the booked commit,
    // distinct from done and carrying no retryAfter.
    const settled = await call("claim", { task: TASK, kind: "verify", channel: "another-channel" }, worker)
    const share = await git("rev-parse", "HEAD")
    expect(settled.step).toEqual({
      kind: "settled", unit: TASK, commit: share.trim(),
      remedy: `The report for ${TASK} exec 1 was accepted; its evidence is booked at ${share.trim()}. This token's claim on ${TASK} has ended — a different token performs the verification.`,
    })
    expect(await git("show", "HEAD:src/widget.ts")).toContain("widget")
    await call("report", { ...report, note: "A different retry note." }, worker)
    expect(await git("rev-parse", "HEAD")).toBe(share)
    const verify = (await call("claim", { task: TASK, kind: "verify" }, verifier)).step
    expect(verify).toMatchObject({ kind: "verify", unit: TASK, head: share.trim() })
    expect(verify).not.toHaveProperty("index")
    const progress = await Bun.file(join(directory, ".auto/executor-progress.json")).text()
    expect(progress).not.toContain(worker)
    expect(progress).toContain("Widget implemented.")
    expect(progress).not.toContain("A different retry note.")
    await Bun.write(join(directory, "docs", TASK, "gaps.md"), "# Verification\n\n## Gaps\n\n### Gap 1 — Widget value\n\nUse the numeric widget value.\n\nResult: FAIL widget value\n")
    await call("report", { step: verify.id, lease: verify.lease, outcome: "ended" }, verifier)
    const fix = (await call("claim", { task: TASK, kind: "fix" }, worker)).step
    expect(fix).toMatchObject({ kind: "fix", round: "1.1" })
    await Bun.write(join(directory, "src/widget.ts"), "export const widget = 2\n")
    await call("report", { step: fix.id, lease: fix.lease, outcome: "ended" }, worker)
    const fixShare = await git("rev-parse", "HEAD")
    expect((await call("claim", { task: TASK, kind: "verify" }, worker)).step).toMatchObject({ kind: "settled", commit: fixShare.trim() })
    const reverify = (await call("claim", { task: TASK, kind: "verify" }, verifier)).step
    expect(reverify).toMatchObject({ kind: "verify", baseline: verify.baseline })
    expect(reverify.head).not.toBe(verify.head)
    await Bun.write(join(directory, "docs", TASK, "report.md"), "# Verification\n\nThe widget is exported with the expected value, and the source changes are limited to the approved path. The implementation satisfies the task acceptance criteria.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
    expect((await call("report", { step: reverify.id, lease: reverify.lease, outcome: "ended" }, verifier)).step).toMatchObject({ kind: "phase-boundary" })
    expect(await Bun.file(join(directory, "docs", TASK, "done.md")).exists()).toBe(true)
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

test("the daemon grants and settles concurrent worktree leases through protocol 1", async () => {
  const directory = await fixtureProject("auto-executor-lanes-e2e-", { subtask: "off", treeLanes: "on" }, 2)
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-lanes-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const verifier = store.issueToken("executor", "verifier").token
  const git = gitOf(directory)
  let daemon: DaemonHandle | undefined
  const tasks = [TASK, TASK_2]
  async function call(operation: string, body: Record<string, unknown>, token = worker) {
    const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${operation}`, {
      method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(body),
    })
    const result = await response.json()
    expect(response.status, JSON.stringify(result)).toBe(200)
    expect(result.protocol).toBe(0.1)
    return result
  }
  try {
    for (const unit of tasks) {
      await Bun.write(join(directory, "docs", unit, "todo.md"), `# ${unit}: a widget\n\nDepends: none\nTouches: src/${unit}.ts\n\n## Scope\n\nExport the widget.\n`)
    }
    // 0277: the post-distillation boundary modeled ahead (the valid handover
    // committed — the push skip condition), the lanes' close reading the
    // boundary step as before.
    await Bun.write(join(directory, "docs/R-01/P01-implement/handover.md"), [
      "# Handover", "",
      ...["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]
        .map((section) => `${section}\n\nDistilled content.\n`),
    ].join("\n"))
    await git("add", "-A")
    await git("commit", "-qm", "Declare independent scopes")
    daemon = await startDaemon({ dataDir, port: 0 })

    const { menu } = await call("ready", {})
    expect(menu.claimable.map(({ unit }: { unit: string }) => unit)).toEqual(tasks)
    const claims = await Promise.all(tasks.map(async (unit) => {
      const { step } = await call("claim", { channel: unit, task: unit, kind: "execute" })
      expect(step).toMatchObject({ kind: "execute", unit })
      expect(step.workspace).not.toBe(directory)
      await Bun.write(join(step.workspace, "src", `${unit}.ts`), "export const widget = true\n")
      return step
    }))
    expect(claims[0].workspace).not.toBe(claims[1].workspace)
    for (const { unit, id, lease, workspace } of claims) {
      await call("report", { channel: unit, step: id, lease, outcome: "ended" })
      expect(await Bun.file(join(directory, "src", `${unit}.ts`)).exists()).toBe(false)
      const { step } = await call("claim", { task: unit, kind: "verify" }, verifier)
      expect(step).toMatchObject({ kind: "verify", unit, workspace })
      await Bun.write(join(workspace, "docs", unit, "report.md"), "# Verification\n\nThe declared source exports the widget with the expected value. The implementation satisfies the task acceptance criteria and changes no paths outside the declared scope.\n\nResult: PASS\n\n<!-- auto: eof -->\n")
      const settled = await call("report", { step: step.id, lease: step.lease, outcome: "ended" }, verifier)
      expect(await Bun.file(join(directory, "docs", unit, "done.md")).exists(), JSON.stringify(settled.step)).toBe(true)
      expect(await Bun.file(join(directory, "src", `${unit}.ts`)).text()).toBe("export const widget = true\n")
    }
    expect((await call("claim", {})).step).toMatchObject({ kind: "phase-boundary" })
    expect((await git("status", "--porcelain")).trim()).toBe("")
    expect((await git("rev-list", "--count", "--merges", "HEAD")).trim()).toBe("2")
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

// 0276 (0256 stage 2's first convergence kind): the formulate grant kind's
// wire pins — the menu's row and catalog entry, the claim's leased brief
// carrying the phase identity (the qualified id and the task-index path)
// beside the standing execute-shaped fields, and the kind vocabulary the
// request layer admits (the unknown word still stops and asks).
test("formulation can stop before output and a successor can recover a pending settlement through the wire", async () => {
  const directory = await fixtureProject("auto-executor-formulate-", { subtask: "off" })
  const git = gitOf(directory)
  // The phase's standing formulation unit (the driver-written Formulate:
  // field carrying the owning phase's qualified id) over the fixture's
  // implicit implement phase.
  await Bun.write(join(directory, "docs", TASK, "todo.md"), [
    `# ${TASK}: Formulate the Implement tasks`,
    "Phase: R-01.P01",
    "Formulate: R-01.P01",
    "",
    "## Goal",
    "",
    "Formulate the implementation phase's complete task plan from the named sources.",
    "",
    "## Scope",
    "",
    "The planning input, the project brief and the round brief.",
    "",
    "## Obligations ledger",
    "",
    '- O-01 | phase duties | "widget" | plan the second widget',
    "",
    "## Acceptance",
    "",
    "Every obligation the Scope's inputs name is covered by a planned task.",
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n"))
  await Bun.write(join(directory, "docs/R-01/P01-implement/tasks.md"), `# Tasks\n\n- [ ] ${TASK} Formulate the Implement tasks\n`)
  await git("add", "-A")
  await git("commit", "-qm", "formulation unit stands")
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const launcher = join(dataDir, "launch.sh")
  await Bun.write(launcher, `#!/bin/bash\nshift 2\nexec "$@"\n`)
  await chmod(launcher, 0o755)
  let daemon: DaemonHandle | undefined
  try {
    daemon = await startDaemon({ dataDir, port: 0 })
    async function call(operation: string, body: unknown, token = worker, expected = 200) {
      const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(expected)
      return result
    }
    const ready = await call("ready", { channel: "solo" })
    expect(ready.menu.claimable).toMatchObject([{ unit: TASK, title: "Formulate the Implement tasks", kinds: ["formulate"] }])
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "synthesize", "verify"])
    expect(ready.menu.types.formulate).toMatchObject({ id: "formulate", writes: { scope: "none" } })
    const claimed = await call("claim", { channel: "solo", task: TASK, kind: "formulate" })
    expect({ ...claimed.step }).toMatchObject({
      kind: "formulate", unit: TASK, title: "Formulate the Implement tasks",
      phase: "R-01.P01", index: "docs/R-01/P01-implement/tasks.md",
      workspace: directory, attempt: 1, budget: expect.any(Number),
      lease: expect.any(String), id: expect.any(String), deadline: expect.any(Number),
    })
    expect(claimed.step.prompt).toContain("Formulate the implementation phase's complete task plan")
    // The brief refresh replays the leased formulate grant; the request
    // layer's kind vocabulary admits the word and still stops and asks on
    // an unknown one.
    expect(await call("brief", { channel: "solo", task: TASK, kind: "formulate" })).toMatchObject({ step: claimed.step })
    await call("claim", { channel: "solo", kind: "inaugurate" }, worker, 400)

    const query = { channel: "solo", task: TASK, kind: "formulate" }
    const handoff = join(directory, "docs", TASK, "handoff.md")
    await Bun.write(handoff, "# Handoff\n\nResume the survey before writing task documents.\n\nStatus: continue\n")
    const report = (step: { id: string; lease: string }) => call("report", {
      channel: "solo", step: step.id, lease: step.lease, outcome: "ended",
    })
    await report(claimed.step)
    const checkpoint = (await git("rev-parse", "HEAD")).trim()
    const resumed = (await call("claim", query)).step
    expect(resumed).toMatchObject({ kind: "formulate", id: `${TASK} formulate 2` })
    expect(resumed.prompt).toContain(`docs/${TASK}/handoff.md`)

    const index = join(directory, resumed.index)
    await Bun.write(index, (await Bun.file(index).text()) + `- [ ] ${TASK_2} the second widget\n`)
    await Bun.write(join(directory, "docs", TASK_2, "todo.md"), TASK_2_DOC)
    await Bun.write(handoff, "# Handoff\n\nStatus: done\n")
    expect((await report(resumed)).step).toMatchObject({ kind: "blocked", code: "commitFailed", remedy: expect.stringContaining("coverage map is missing") })

    // Follow the operator's remedy while the report is pending. Stopping
    // the worker releases the run lock; the booked report survives it.
    const control = store.issueToken("control", "operator").token
    const reader = store.issueToken("read", "reader").token
    const reconcile = () => fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/reconcile`, {
      method: "POST", headers: { authorization: `Bearer ${control}` }, body: "{}",
    })
    const refused = await reconcile()
    expect(refused.status).toBe(409)
    const { run, retry } = await refused.json()
    expect(retry).toContain(`DELETE /runs/${run.id}`)
    const url = `${daemon.url}/runs/${run.id}`
    expect((await fetch(url, { method: "DELETE", headers: { authorization: `Bearer ${control}` } })).status).toBe(202)
    const deadline = Date.now() + 5_000
    while ((await (await fetch(url, { headers: { authorization: `Bearer ${reader}` } })).json()).live) {
      if (Date.now() > deadline) throw new Error("The stopped coordinator is still live")
      await Bun.sleep(50)
    }
    expect((await reconcile()).status).toBe(200)

    const other = store.issueToken("executor", "other worker").token
    for (const response of [
      await call("brief", query, other),
      await call("brief", { ...query, channel: "another" }),
      await call("brief", { ...query, kind: "verify" }),
    ]) expect(response.step).toMatchObject({ kind: "wait", reason: "not-ready" })
    const recovered = (await call("brief", query)).step
    expect(recovered).toEqual(resumed)
    expect((await call("ready", { channel: "solo" })).menu.leases).toEqual([])
    expect((await git("rev-parse", "HEAD")).trim()).toBe(checkpoint)

    await Bun.write(join(directory, "docs", TASK, "coverage.md"), `- O-01 -> ${TASK_2}\n`)
    expect((await report(recovered)).step.kind).toBe("settled")
    expect((await report(recovered)).step.kind).toBe("settled")
    expect((await git("rev-list", "--count", `${checkpoint}..HEAD`)).trim()).toBe("1")
    expect((await call("brief", query)).step.kind).toBe("wait")
    expect((await call("claim", { task: TASK, kind: "verify" }, other)).step.kind).toBe("verify")
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

// 0277 (0256 stage 2's second convergence kind, the transfer advance's
// session work): the distill grant kind's wire pins — the menu's row and
// catalog entry, the claim's leased brief carrying the handover document
// path (the one write surface) beside the standing execute-shaped fields,
// the settlement's landed share terminal on the wire (the boundary step
// teaching the person's transfer, never a verify row), and the kind
// vocabulary the request layer admits.
test("the distill grant kind rides the wire beside the standing kinds", async () => {
  const directory = await fixtureProject("auto-executor-distill-", { subtask: "off" })
  const git = gitOf(directory)
  // The handover route over the fixture's implicit implement phase: the
  // task done (its done.md and the index tick), the phase itself still
  // incomplete — exactly the durable records the advance's distillation
  // keys on.
  await rm(join(directory, "docs", TASK, "todo.md"))
  await Bun.write(join(directory, "docs", TASK, "done.md"), `# ${TASK}: the widget\n`)
  await Bun.write(join(directory, "docs/R-01/P01-implement/tasks.md"), `# Tasks\n\n- [x] ${TASK} the widget\n`)
  await git("add", "-A")
  await git("commit", "-qm", "task done, boundary awaits")
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  let daemon: DaemonHandle | undefined
  try {
    daemon = await startDaemon({ dataDir, port: 0 })
    async function call(operation: string, body: unknown, token = worker, expected = 200) {
      const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${operation}`, {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(expected)
      return result
    }
    const ready = await call("ready", { channel: "solo" })
    expect(ready.menu.claimable).toMatchObject([{ unit: "R-01.P01", title: "P01-implement Implementation", kinds: ["distill"] }])
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "synthesize", "verify"])
    expect(ready.menu.types.distill).toMatchObject({ id: "distill", writes: { scope: "none" } })
    const claimed = await call("claim", { channel: "solo", task: "R-01.P01", kind: "distill" })
    // The pair captured ahead of the assertion: Bun's toMatchObject with
    // expect.any() replaces the received fields it matches, so the grant's
    // own strings are read before any asymmetric matcher touches them.
    const pair = { step: claimed.step.id as string, lease: claimed.step.lease as string }
    expect(claimed.step).toMatchObject({
      kind: "distill", unit: "R-01.P01", title: "P01-implement Implementation",
      handover: "docs/R-01/P01-implement/handover.md",
      workspace: directory, attempt: 1, budget: expect.any(Number),
      lease: expect.any(String), id: expect.any(String), deadline: expect.any(Number),
    })
    expect(claimed.step.prompt).toContain("docs/R-01/P01-implement/handover.md")
    // The session writes the handover document; the settlement lands the
    // share under the push distillation's own stage word and the wire's
    // next step is the boundary — the person's transfer, never a verify
    // row (0277 D6's ruling).
    await Bun.write(join(directory, "docs/R-01/P01-implement/handover.md"), [
      "# Handover", "",
      ...["## Key decisions", "## Constraints and pitfalls", "## Required reading for the next phase", "## Artifact index"]
        .map((section) => `${section}\n\nDistilled content.\n`),
    ].join("\n"))
    const settled = await call("report", { channel: "solo", step: pair.step, lease: pair.lease, outcome: "ended" })
    expect(settled.step).toEqual({
      kind: "phase-boundary", phase: "R-01.P01",
      remedy: "Advance it with POST /projects/<project>/transfer.",
    })
    expect(await git("show", "-s", "--format=%B", "HEAD")).toContain("Auto-Stage: phase-handover")
    // The apply never happened coordinator-side: the phase's todo.md still
    // stands and the phases index is unticked — the completion shapes the
    // person's transfer act.
    expect(await Bun.file(join(directory, "docs/R-01/P01-implement/todo.md")).exists()).toBe(true)
    expect(await Bun.file(join(directory, "docs/R-01/phases.md")).text()).toContain("- [ ] P01 implement")
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

// 0278 (0256 stage 2's third and final convergence kind): the audit grant
// kind's wire pins — the menu's row and catalog entry, the claim's leased
// brief carrying the findings document path and the round's number beside
// the standing execute-shaped fields, the settlement's landed share under
// the push family's own stage word with the next claim the standing verify
// share (a FAIL landing identically — the no-fix rule: no fix grant ever
// spins off the audit), and the kind vocabulary the request layer admits.
test("the audit grant kind rides the wire beside the standing kinds", async () => {
  const directory = await fixtureProject("auto-executor-audit-", { subtask: "off" })
  const git = gitOf(directory)
  // The round's standing close-audit unit (the marker field the close
  // arms' constructor writes) over the fixture's implicit implement phase:
  // the done first task, the pending audit unit carrying
  // `Close-audit: R-01` — exactly the durable record the derivation keys
  // on.
  await rm(join(directory, "docs", TASK, "todo.md"))
  await Bun.write(join(directory, "docs", TASK, "done.md"), `# ${TASK}: the widget\n`)
  await Bun.write(join(directory, "docs", TASK_2, "todo.md"), [
    `# ${TASK_2}: Adjudicate the due assurance rows (R-01)`,
    "Phase: R-01.P01",
    "Close-audit: R-01",
    "Decompose: whole",
    "Depends: none",
    "",
    "## Goal",
    "",
    "Adjudicate round R-01's close-due assurance rows.",
    "",
    "## Scope",
    "",
    "This document is the single input of this close-audit task.",
    "",
    "## Acceptance",
    "",
    `docs/${TASK_2}/findings.md exists and carries one section per due row, the document ending with its Result: line.`,
    "",
    "<!-- auto: eof -->",
    "",
  ].join("\n"))
  await Bun.write(join(directory, "docs/R-01/P01-implement/tasks.md"), `# Tasks\n\n- [x] ${TASK} the widget\n- [ ] ${TASK_2} Adjudicate the due assurance rows (R-01)\n`)
  await git("add", "-A")
  await git("commit", "-qm", "the standing close-audit unit")
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const verifier = store.issueToken("executor", "verifier").token
  let daemon: DaemonHandle | undefined
  try {
    daemon = await startDaemon({ dataDir, port: 0 })
    async function call(operation: string, body: unknown, token = worker, expected = 200) {
      const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${operation}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(expected)
      return result
    }
    const ready = await call("ready", { channel: "solo" })
    expect(ready.menu.claimable).toMatchObject([{ unit: TASK_2, title: "Adjudicate the due assurance rows (R-01)", kinds: ["audit"] }])
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "synthesize", "verify"])
    expect(ready.menu.types.audit).toMatchObject({ id: "audit", writes: { scope: "none" } })
    const claimed = await call("claim", { channel: "solo", task: TASK_2, kind: "audit" })
    const pair = { step: claimed.step.id as string, lease: claimed.step.lease as string }
    expect(claimed.step).toMatchObject({
      kind: "audit", unit: TASK_2, title: "Adjudicate the due assurance rows (R-01)",
      findings: `docs/${TASK_2}/findings.md`, round: 1,
      workspace: directory, attempt: 1, budget: expect.any(Number),
      lease: expect.any(String), id: expect.any(String), deadline: expect.any(Number),
    })
    expect(claimed.step.prompt).toContain("Adjudicate round R-01's close-due assurance rows")
    // The brief refresh replays the leased audit grant; the request layer's
    // kind vocabulary admits the word and still stops and asks on an
    // unknown one.
    expect(await call("brief", { channel: "solo", task: TASK_2, kind: "audit" })).toMatchObject({ step: claimed.step })
    await call("claim", { channel: "solo", kind: "inaugurate" }, worker, 400)
    // The session writes the findings document — a FAIL adjudication, the
    // hardest case: the settlement lands it under the family's own stage
    // word (the no-fix rule — a FAIL is a finding for the person, the
    // share landing whatever the verdict), and the next claim is the
    // standing verify share, never a fix grant.
    await Bun.write(join(directory, "docs", TASK_2, "findings.md"), [
      `# Findings (${TASK_2})`, "",
      "## S-20 — the adjudicated row", "",
      "The round's delta raises nothing on this surface; the invariant holds first-hand.",
      "",
      "Result: FAIL the row does not hold at the closing tree",
      "",
    ].join("\n"))
    const settled = await call("report", { channel: "solo", step: pair.step, lease: pair.lease, outcome: "ended" })
    // The same-token report reads 0273's settled terminal (composed): the
    // share's evidence booked, this token's work on the unit ended, a
    // different token performing the verification.
    expect(settled.step).toMatchObject({ kind: "settled", unit: TASK_2 })
    expect(settled.step.remedy).toContain("a different token performs the verification")
    expect(await git("show", "-s", "--format=%B", "HEAD")).toContain("Auto-Stage: close-audit")
    const menu = await call("ready", { channel: "verify" }, verifier)
    expect(menu.menu.claimable).toMatchObject([{ unit: TASK_2, kinds: ["verify"] }])
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
}, 20_000)

// The lifecycle's removal over REST (plans/0284): DELETE /projects/<project>
// is the projects scope's act; beside the live coordinator this daemon
// spawned it refuses 409 teaching the stop (DELETE /runs/<id>, the run id
// named); the stop landed, the entry goes and GET /projects reflects it.
test("the project lifecycle's removal: 409 beside a live coordinator with the stop taught, then the delete lands", async () => {
  const directory = await fixtureProject("auto-executor-lifecycle-", { subtask: "off" })
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const reader = store.issueToken("read", "reader").token
  const control = store.issueToken("control", "control").token
  const projects = store.issueToken("projects", "lifecycle").token
  const listRuns = async () =>
    (await (await fetch(`${daemon!.url}/runs`, { headers: { authorization: `Bearer ${reader}` } })).json()) as { runs: Array<{ id: string; state: string; live: boolean }> }
  let daemon: DaemonHandle | undefined
  try {
    daemon = await startDaemon({ dataDir, port: 0 })
    // No coordinator yet: the spawn is the executor route's own demand.
    const before = await listRuns()
    expect(before.runs).toEqual([])
    await fetch(`${daemon.url}/projects/${encodeURIComponent(project.name)}/executor/ready`, {
      method: "POST",
      headers: { authorization: `Bearer ${worker}` },
      body: "{}",
    })
    const after = await listRuns()
    expect(after.runs).toHaveLength(1)
    const runId = after.runs[0]!.id
    const remove = (token?: string) => fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}`, {
      method: "DELETE",
      headers: token ? { authorization: `Bearer ${token}` } : {},
    })
    expect((await remove()).status).toBe(401)
    expect((await remove(control)).status).toBe(403)
    const refused = await remove(projects)
    expect(refused.status).toBe(409)
    const refusedBody = (await refused.json()) as { error: string; run: string }
    expect(refusedBody.run).toBe(runId)
    expect(refusedBody.error).toContain(`live run (${runId}`)
    expect(refusedBody.error).toContain(`DELETE /runs/${runId}`)
    // The stop taught: the kill ladder settles the coordinator, the retry
    // deletes the entry, and the whitelist reflects it.
    const kill = await fetch(`${daemon.url}/runs/${runId}`, { method: "DELETE", headers: { authorization: `Bearer ${control}` } })
    expect(kill.status).toBe(202)
    const deadline = Date.now() + 30_000
    for (;;) {
      const listed = await listRuns()
      if (!listed.runs[0]!.live) break
      if (Date.now() > deadline) throw new Error("the killed coordinator never settled")
      await Bun.sleep(200)
    }
    const deleted = await remove(projects)
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toMatchObject({ removed: { name: project.name, directory } })
    const whitelist = (await (await fetch(`${daemon.url}/projects`, { headers: { authorization: `Bearer ${reader}` } })).json()) as { projects: Array<{ name: string }> }
    expect(whitelist.projects.map((entry) => entry.name)).toEqual([])
  } finally {
    await daemon?.stop()
    await rm(dataDir, { recursive: true, force: true })
    await rm(directory, { recursive: true, force: true })
  }
})
