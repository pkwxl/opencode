import { afterEach, expect, test } from "bun:test"
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
const peer = { token: "peer", channel: "other-work" }
const verifier = { token: "verifier", channel: "verify" }
const pass = "# Verification\n\nThe changed source implements the task and leaves the other declared scopes intact.\n\nResult: PASS\n\n<!-- auto: eof -->\n"
const fail = "# Verification\n\n## Gaps\n\n### Gap 1 — Fix the value\n\nResult: FAIL expected value 2\n"

function project(scopes = ["src/one.ts"]) {
  const dir = mkdtempSync(join(tmpdir(), "executor-worktree-"))
  roots.push(dir)
  git(dir, "init")
  git(dir, "config", "user.name", "Executor test")
  git(dir, "config", "user.email", "executor@example.invalid")
  write(dir, ".gitignore", "/.auto/\n")
  write(dir, CONFIG_FILE, JSON.stringify({ subtask: "off", treeLanes: "on" }))
  write(dir, "docs/R-01/phases.md", "# Phases\n\n- [ ] P01 implement\n")
  write(dir, "docs/R-01/P01-implement/todo.md", "# Phase\n")
  const lines: string[] = []
  for (const [i, scope] of scopes.entries()) {
    const id = `T-${String(i + 1).padStart(3, "0")}`
    const title = `Implement part ${i + 1}`
    lines.push(`- [ ] ${id} ${title}`)
    write(dir, `docs/${id}/todo.md`, `# ${title}\n\nDepends: none\nTouches: ${scope}\n\n## Scope\n\nImplement the declared file.\n`)
  }
  write(dir, index, `# Tasks\n\n${lines.join("\n")}\n`)
  git(dir, "add", ".")
  git(dir, "commit", "-m", "Fixture")
  return dir
}

type Coordinator = Awaited<ReturnType<typeof openExecutorCoordinator>>

async function claim(coordinator: Coordinator, actor: typeof worker, unit: string, kind: "execute" | "verify" | "fix") {
  const result = await coordinator.claim(actor, unit, kind)
  if (!("lease" in result) || result.kind !== kind) throw new Error(JSON.stringify(result))
  return result
}

test("disjoint code tasks lease independent worktrees and land through the coordinator", async () => {
  const dir = project(["src/one.ts", "src/two.ts", "src/one.ts"])
  const base = git(dir, "rev-parse", "HEAD")
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const first = await claim(coordinator, worker, "T-001", "execute")
    const second = await claim(coordinator, peer, "T-002", "execute")
    expect(first.workspace).not.toBe(dir)
    expect(first.workspace).not.toBe(second.workspace)
    expect(await coordinator.claim(verifier, "T-003", "execute")).toMatchObject({
      kind: "wait", reason: "lease-held", detail: expect.stringContaining(`channel ${worker.channel} until`),
    })
    write(first.workspace, "src/one.ts", "export const one = 1\n")
    write(second.workspace, "src/two.ts", "export const two = 2\n")
    expect(await coordinator.report(worker, first.id, first.lease, "ended")).toMatchObject({ kind: "landed" })
    expect(git(dir, "rev-parse", "HEAD")).toBe(base)
    expect(existsSync(join(dir, "src/one.ts"))).toBe(false)
    expect(await coordinator.claim(worker, first.unit, "verify")).toMatchObject({ kind: "wait" })
    const verify = await claim(coordinator, verifier, first.unit, "verify")
    expect(verify.workspace).toBe(first.workspace)
    write(verify.workspace, "docs/T-001/report.md", pass)
    const receipt = await coordinator.report(verifier, verify.id, verify.lease, "ended")
    expect(receipt).toMatchObject({ kind: "landed", verdict: "pass", closeCommit: git(dir, "rev-parse", "HEAD") })
    expect(readFileSync(join(dir, "src/one.ts"), "utf8")).toBe("export const one = 1\n")
    expect(existsSync(join(dir, "src/two.ts"))).toBe(false)
    expect(existsSync(first.workspace)).toBe(false)
    expect(readFileSync(join(dir, index), "utf8")).toContain("- [x] T-001")
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toEqual(receipt)
    expect(await coordinator.report(peer, second.id, second.lease, "ended")).toMatchObject({ kind: "landed" })
    const verifySecond = await claim(coordinator, verifier, second.unit, "verify")
    write(verifySecond.workspace, "docs/T-002/report.md", pass)
    expect(await coordinator.report(verifier, verifySecond.id, verifySecond.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, "src/two.ts"), "utf8")).toBe("export const two = 2\n")
    expect(git(dir, "log", "--merges", "--format=%s")).toContain("T-002 landing")
    expect(git(dir, "for-each-ref", "--format=%(refname)", "refs/heads/auto-executor")).toBe("")
    expect(git(dir, "status", "--porcelain")).toBe("")
  } finally {
    await coordinator.close()
  }
})

test("expired work stays in its worktree across restart and stale reports cannot land", async () => {
  const dir = project()
  let clock = 1
  let coordinator = await openExecutorCoordinator(dir, { now: () => clock })
  try {
    const first = await claim(coordinator, worker, "T-001", "execute")
    write(first.workspace, "src/one.ts", "export const one = 1\n")
    await coordinator.close()
    clock = first.deadline + 1
    coordinator = await openExecutorCoordinator(dir, { now: () => clock })
    const retry = await claim(coordinator, peer, first.unit, "execute")
    expect(retry.lease).not.toBe(first.lease)
    expect(retry.workspace).toBe(first.workspace)
    expect(readFileSync(join(retry.workspace, "src/one.ts"), "utf8")).toBe("export const one = 1\n")
    expect(await coordinator.report(worker, first.id, first.lease, "ended")).toMatchObject({ kind: "wait", reason: "lease-held" })
    expect(await coordinator.report(peer, retry.id, retry.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await claim(coordinator, verifier, first.unit, "verify")
    write(verify.workspace, "docs/T-001/gaps.md", fail)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "fail" })
    const fix = await claim(coordinator, peer, first.unit, "fix")
    write(fix.workspace, "src/one.ts", "export const one = 2\n")
    expect(await coordinator.report(peer, fix.id, fix.lease, "ended")).toMatchObject({ kind: "landed" })
    const reverify = await claim(coordinator, verifier, first.unit, "verify")
    expect(reverify.workspace).toBe(retry.workspace)
    write(reverify.workspace, "docs/T-001/report.md", pass)
    expect(await coordinator.report(verifier, reverify.id, reverify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    expect(readFileSync(join(dir, "src/one.ts"), "utf8")).toBe("export const one = 2\n")
    expect(existsSync(join(dir, "docs/T-001/gaps.md"))).toBe(false)
  } finally {
    await coordinator.close()
  }
})

test("a claim retries the same checkout when materialization was interrupted", async () => {
  const dir = project()
  let coordinator = await openExecutorCoordinator(dir, { checkpoint: (point) => {
    if (point === "workspace-created") throw new Error("interrupted checkout")
  } })
  try {
    await expect(coordinator.claim(worker, "T-001", "execute")).rejects.toThrow("interrupted checkout")
    const registered = git(dir, "worktree", "list", "--porcelain")
    expect(registered).toContain("auto-executor/")
    await coordinator.close()
    coordinator = await openExecutorCoordinator(dir)
    const grant = await claim(coordinator, worker, "T-001", "execute")
    expect(registered).toContain(`worktree ${grant.workspace}`)
    expect(git(dir, "worktree", "list", "--porcelain")).toBe(registered)
    expect(grant.attempt).toBe(1)
  } finally {
    await coordinator.close()
  }
})

test("a lane refuses out-of-scope changes and preserves its uncommitted workspace", async () => {
  const dir = project()
  const coordinator = await openExecutorCoordinator(dir)
  try {
    const grant = await claim(coordinator, worker, "T-001", "execute")
    write(grant.workspace, "src/one.ts", "export const one = 1\n")
    write(grant.workspace, "src/extra.ts", "unrelated edit\n")
    expect(await coordinator.report(worker, grant.id, grant.lease, "ended")).toMatchObject({ kind: "blocked", reason: "isolation" })
    expect(git(grant.workspace, "diff", "--cached", "--name-only")).toBe("")
    expect(readFileSync(join(grant.workspace, "src/extra.ts"), "utf8")).toBe("unrelated edit\n")
    expect(git(dir, "status", "--porcelain")).toBe("")
  } finally {
    await coordinator.close()
  }
})

test("a worktree park lands and replays before the dependency unblocks the task", async () => {
  const dir = project(["src/one.ts", "src/two.ts"])
  write(dir, "docs/T-002/todo.md", "# Implement part 2\n\nDepends: T-001\nTouches: src/two.ts\n")
  git(dir, "add", "docs/T-002/todo.md")
  git(dir, "commit", "-m", "Declare blocker prerequisite")
  let coordinator = await openExecutorCoordinator(dir, { checkpoint: (point) => {
    if (point === "park-recorded") throw new Error("interrupted park")
  } })
  try {
    const first = await claim(coordinator, worker, "T-001", "execute")
    write(first.workspace, "src/one.ts", "export const one = 1\n")
    write(first.workspace, "docs/T-001/handoff.md", "# Handoff\n\nResume after the dependency is available.\n\nStatus: park T-002\n")
    await expect(coordinator.report(worker, first.id, first.lease, "ended")).rejects.toThrow("interrupted park")
    await coordinator.close()
    coordinator = await openExecutorCoordinator(dir)
    const blocker = await claim(coordinator, worker, "T-002", "execute")
    expect(existsSync(first.workspace)).toBe(false)
    expect(await coordinator.report(worker, first.id, first.lease, "ended")).toMatchObject({ kind: "landed", parked: "T-002" })
    expect(readFileSync(join(blocker.workspace, "src/one.ts"), "utf8")).toBe("export const one = 1\n")
    write(blocker.workspace, "src/two.ts", "export const two = 2\n")
    expect(await coordinator.report(worker, blocker.id, blocker.lease, "ended")).toMatchObject({ kind: "landed" })
    const verify = await claim(coordinator, verifier, blocker.unit, "verify")
    write(verify.workspace, "docs/T-002/report.md", pass)
    expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
    const resumed = await claim(coordinator, worker, first.unit, "execute")
    expect(resumed.workspace).not.toBe(first.workspace)
    expect(resumed.prompt).toContain("docs/T-001/handoff.md")
    expect(readFileSync(join(resumed.workspace, "src/two.ts"), "utf8")).toBe("export const two = 2\n")
  } finally {
    await coordinator.close()
  }
})

for (const interrupted of ["landing-booked", "lane-landed"] as const) {
  test(`recovers a booked worktree landing interrupted at ${interrupted}`, async () => {
    const dir = project()
    let coordinator = await openExecutorCoordinator(dir, { checkpoint: (point) => {
      if (point === interrupted) throw new Error("interrupted landing")
    } })
    try {
      const execute = await claim(coordinator, worker, "T-001", "execute")
      write(execute.workspace, "src/one.ts", "export const one = 1\n")
      expect(await coordinator.report(worker, execute.id, execute.lease, "ended")).toMatchObject({ kind: "landed" })
      const verify = await claim(coordinator, verifier, execute.unit, "verify")
      write(verify.workspace, "docs/T-001/report.md", pass)
      await expect(coordinator.report(verifier, verify.id, verify.lease, "ended")).rejects.toThrow("interrupted landing")
      await coordinator.close()
      if (interrupted === "landing-booked") {
        git(dir, "merge", "--no-ff", "--no-commit", git(verify.workspace, "rev-parse", "HEAD"))
      }
      coordinator = await openExecutorCoordinator(dir)
      expect(await coordinator.report(verifier, verify.id, verify.lease, "ended")).toMatchObject({ kind: "landed", verdict: "pass" })
      expect(git(dir, "rev-list", "--count", "--merges", "HEAD")).toBe("1")
      expect(existsSync(verify.workspace)).toBe(false)
      expect(git(dir, "status", "--porcelain")).toBe("")
    } finally {
      await coordinator.close()
    }
  })
}
