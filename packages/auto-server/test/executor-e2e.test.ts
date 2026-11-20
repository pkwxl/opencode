import { expect, test } from "bun:test"
import { chmod, mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { liveRunLock } from "@opencode-ai/auto-core/lock"
import { executorTypeCatalog } from "@opencode-ai/auto-core/executor-coordinator"
import { buildFingerprint, VERSION } from "../src/version"
import { startDaemon, type DaemonHandle } from "../src/daemon"
import { DaemonStore } from "../src/store"
import { fixtureProject, gitOf, TASK, TASK_2 } from "./fixtures/project"

test("the daemon routes authenticated executor requests to one launcher-confined coordinator and recovers across restarts", async () => {
  const directory = await fixtureProject("auto-executor-e2e-", { subtask: "off" })
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const store = new DaemonStore(dataDir)
  const project = store.register(directory)
  const worker = store.issueToken("executor", "worker").token
  const verifier = store.issueToken("executor", "verifier").token
  const control = store.issueToken("control", "control").token
  const person = store.issueToken("person-questions", "reviewer").token
  const dual = store.issueToken("executor,person-questions", "dual").token
  const releaseOnly = store.issueToken("person-releases", "release-only").token
  const launcher = join(dataDir, "launch.sh")
  const launches = join(dataDir, "launches")
  await Bun.write(launcher, `#!/bin/bash
printf '%s\n' "$1" >> "${launches}"
shift 2
exec "$@"
`)
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
  const start = () => startDaemon({ dataDir, port: 0, launch: launcher })
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
    expect(await Bun.file(launches).exists()).toBe(false)

    await call("ready", { extraField: true }, worker)
    const [ready, claimed] = await Promise.all([
      call("ready", {}, worker),
      call("claim", {}, worker),
    ])
    expect(ready.protocol).toBe(1)
    expect(Object.keys(ready).sort()).toEqual(["build", "menu", "protocol"])
    // 0270's additive carrier: the build fingerprint rides the ready
    // envelope beside protocol — the handshake every session starts with,
    // the one place identity needs carrying. This suite runs the daemon from
    // source, so the commit is the honest dev fallback, never a fabricated
    // sha; a client that ignores the field reads the pre-change envelope.
    expect(ready.build).toEqual(buildFingerprint())
    expect(ready.build).toEqual({ version: VERSION, commit: "dev" })
    const { build, ...envelopeBefore } = ready
    expect(build).toEqual({ version: "0.0.0", commit: "dev" })
    expect(Object.keys(envelopeBefore).sort()).toEqual(["menu", "protocol"])
    // 0269's additive carrier: the restriction catalog rides the menu itself
    // (0246 D4 b's menu letter — the single dispatch-time payload), the
    // worker passing the coordinator's rendering through with no second
    // author; a client that ignores the block reads the pre-change menu.
    // 0271's additive half rides the same menu: the pending person items,
    // the empty floor here (nothing pending on a bare project).
    expect(Object.keys(ready.menu).sort()).toEqual(["claimable", "leases", "pending", "types"])
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "human", "question", "verify"])
    const { types, pending, ...menuBefore } = ready.menu
    expect(Object.keys(menuBefore).sort()).toEqual(["claimable", "leases"])
    expect(pending).toEqual([])
    expect(claimed).toMatchObject({ protocol: 1, step: { kind: "execute", unit: TASK, workspace: directory } })
    expect(await Bun.file(launches).text()).toBe(`${directory}\n`)
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
    await call("ready", {}, person, 403)
    await call("claim", { role: "worker" }, person, 403)
    expect((await call("claim", {}, dual)).step.reason).toBe("lease-held")
    await call("question", { task: TASK, text: "Incomplete task tuple" }, worker, 400)
    const question = { ...lease, task: TASK, text: "Which implementation?" }
    const raised = (await call("question", question, worker)).question
    expect((await call("question", question, worker)).question).toEqual(raised)
    // 0271 on the wire: the pending listing rides both menu arms (this is
    // the leases-held arm) — a plain worker channel reads existence alone,
    // the dual token's person-questions grant carries the question's text
    // beside the id (the authority split the coordinator checks), no other
    // byte of the menu moving.
    expect((await call("ready", {}, worker)).menu.pending).toEqual([{ kind: "question", id: raised.id }])
    expect((await call("ready", {}, dual)).menu.pending).toEqual([
      { kind: "question", id: raised.id, text: question.text, task: TASK },
    ])
    expect((await call("claim", {}, person)).step).toMatchObject({ kind: "question", id: raised.id, text: question.text })
    expect((await call("claim", { role: "person" }, dual)).step.id).toBe(raised.id)
    expect((await call("claim", { delegation: "unrestricted" }, releaseOnly)).step.kind).toBe("wait")
    await call("answer", { item: raised.id, decision: "Forged", delegation: "unrestricted" }, releaseOnly, 400)
    await call("answer", { item: raised.id, decision: "Forged" }, worker, 403)
    await Promise.all([
      call("answer", { item: raised.id, decision: "First candidate" }, person),
      call("answer", { item: raised.id, decision: "Second candidate" }, dual),
    ])
    const pageRequest = { task: TASK, kind: "execute", cursor: null }
    const page = (await call("brief", pageRequest, worker)).step
    expect(page).toMatchObject({ kind: "answers", answers: [{ id: raised.id, question: question.text }] })
    expect(page.answers).toHaveLength(1)
    await call("brief", pageRequest, verifier, 400)
    await call("brief", { ...pageRequest, channel: "solo" }, worker, 400)

    const runResponse = await fetch(`${daemon.url}/runs`, {
      method: "POST", headers: { authorization: `Bearer ${control}` }, body: JSON.stringify({ project: project.name }),
    })
    expect(runResponse.status).toBe(409)

    const coordinator = daemon.runs().find((run) => run.live)
    expect(coordinator?.pid).toBeNumber()
    process.kill(coordinator!.pid!, "SIGKILL")
    const crashDeadline = Date.now() + 3000
    while (daemon.runs().some((run) => run.live) && Date.now() < crashDeadline) await Bun.sleep(10)
    expect(daemon.runs().some((run) => run.live)).toBe(false)
    expect((await call("claim", { task: TASK }, worker)).step.lease).toBe(lease.lease)
    await call("answer", { item: raised.id, decision: "Replay must preserve the answer" }, person)
    expect((await call("brief", pageRequest, worker)).step).toEqual(page)
    const answerIds = [raised.id]
    for (let n = 0; n < 20; n++) {
      const item = (await call("question", { text: `${n}: ${"q".repeat(8000)}` }, worker)).question
      await call("answer", { item: item.id, decision: "a".repeat(8000), rationale: "r".repeat(8000) }, person)
      answerIds.push(item.id)
    }
    const refreshed = (await call("brief", { task: TASK, kind: "execute" }, worker)).step
    expect(typeof refreshed.answerCursor).toBe("string")
    const paged: string[] = []
    let cursor: string | null | undefined = null
    do {
      const nextPage: { kind: string; answers: { id: string }[]; next?: string } = (await call("brief", { ...pageRequest, cursor }, worker)).step
      expect(nextPage.kind).toBe("answers")
      paged.push(...nextPage.answers.map(({ id }: { id: string }) => id))
      cursor = nextPage.next
    } while (cursor !== undefined)
    expect(paged).toEqual(answerIds)
    const remainder = (await call("brief", { ...pageRequest, cursor: refreshed.answerCursor }, worker)).step
    expect(remainder.answers[0].id).toBe(answerIds[answerIds.indexOf(refreshed.answerCursor) + 1])
    expect(await Bun.file(launches).text()).toBe(`${directory}\n${directory}\n`)
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
    expect((await call("ready", {}, verifier)).menu).toEqual({ claimable: [], leases: [], pending: [], types: executorTypeCatalog() })
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
    expect(result.protocol).toBe(1)
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

test("release grants bind HTTP approvals to the reviewed proposal and replay safely after daemon restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "auto-executor-gate-"))
  const dataDir = await mkdtemp(join(tmpdir(), "auto-executor-data-"))
  const git = gitOf(directory)
  let daemon: DaemonHandle | undefined
  try {
    await git("init")
    await git("config", "user.name", "Executor tests")
    await git("config", "user.email", "executor@example.test")
    await mkdir(join(directory, ".opencode/auto"), { recursive: true })
    await Bun.write(join(directory, ".opencode/auto/config.json"), JSON.stringify({ subtask: "off", phases: "mt" }))
    await Bun.write(join(directory, ".gitignore"), ".auto/\n")
    await git("add", "-A")
    await git("commit", "-qm", "Fixture")
    const document = "docs/analysis.md"
    await mkdir(join(directory, "docs"))
    const proposal = "# Project analysis\n\n## Analysis\n\nTwo modules, one risk area.\n\n## Goals\n\nPort the core.\n\n## Project brief\n\nA faithful port.\n\n## Roadmap\n\n- R-01 mt — port the core\n"
    await Bun.write(join(directory, document), proposal)
    const store = new DaemonStore(dataDir)
    const project = store.register(directory)
    const releases = store.issueToken("person-releases").token
    const questions = store.issueToken("person-questions").token
    async function call(route: string, token: string, body: object = {}, status = 200) {
      const response = await fetch(`${daemon!.url}/projects/${encodeURIComponent(project.name)}/executor/${route}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const result = await response.json()
      expect(response.status, JSON.stringify(result)).toBe(status)
      return result.step
    }
    daemon = await startDaemon({ dataDir, port: 0 })
    expect(await call("claim", questions)).toMatchObject({ kind: "wait" })
    const first = await call("claim", releases)
    expect(first).toMatchObject({ kind: "human", gate: "project-start", document, proposal })
    // 0262-04's blind spot on the wire: with the gate occurrence recorded
    // and no question pending, the questions-scope claim names the pending
    // gate instead of reading as nothing to attend to.
    expect(await call("claim", questions)).toEqual({
      kind: "wait", reason: "not-ready", detail: "No pending questions. A gate item is pending.", retryAfter: 2,
    })
    await call("answer", questions, { item: first.id, decision: "approve" }, 400)
    const revised = proposal.replace("A faithful port.", "An incremental port.")
    await Bun.write(join(directory, document), revised)
    const current = await call("answer", releases, { item: first.id, decision: "approve" })
    expect(current).toMatchObject({ kind: "human", proposal: revised })
    expect(current.id).not.toBe(first.id)
    expect(await Bun.file(join(directory, document)).text()).toBe(revised)
    const approve = { item: current.id, decision: "approve" }
    expect(await call("answer", releases, approve)).toMatchObject({ kind: "wait" })
    const landed = await git("rev-parse", "HEAD")
    expect((await git("show", "--format=", "--name-only", "HEAD")).trim()).toBe(document)
    expect(await git("show", `HEAD:${document}`)).toContain("Clarified: yes")
    await daemon.stop()
    daemon = await startDaemon({ dataDir, port: 0 })
    await call("answer", questions, approve, 400)
    expect(await call("answer", releases, approve)).toMatchObject({ kind: "wait" })
    expect(await git("rev-parse", "HEAD")).toBe(landed)
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
test("the formulate grant kind rides the wire beside the standing kinds", async () => {
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
    daemon = await startDaemon({ dataDir, port: 0, launch: launcher })
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
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "human", "question", "verify"])
    expect(ready.menu.types.formulate).toMatchObject({ id: "formulate", writes: { scope: "none" } })
    const claimed = await call("claim", { channel: "solo", task: TASK, kind: "formulate" })
    expect(claimed.step).toMatchObject({
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
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "human", "question", "verify"])
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
      remedy: "Run transfer to advance the phase.",
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
    expect(Object.keys(ready.menu.types).sort()).toEqual(["audit", "distill", "execute", "fix", "formulate", "human", "question", "verify"])
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
