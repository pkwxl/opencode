import { expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { liveRunLock } from "@opencode-ai/auto-core/lock"
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
    expect(Object.keys(ready).sort()).toEqual(["menu", "protocol"])
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
    expect((await call("ready", {}, verifier)).menu).toEqual({ claimable: [], leases: [] })
    expect(await git("rev-parse", "HEAD")).toBe(beforeReport)
    const blocked = await call("claim", { task: TASK, kind: "verify", channel: "another-channel" }, worker)
    expect(blocked.step).toMatchObject({ kind: "wait", reason: "not-ready" })
    const share = await git("rev-parse", "HEAD")
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
    expect((await call("claim", { task: TASK, kind: "verify" }, worker)).step.kind).toBe("wait")
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
