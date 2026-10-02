// Unit tests for the automatic-session artifact shape check (D5,
// session-boundary-hardening design §4.5/S3b): the merged understand+decompose
// session (M1.0, plans/0030) has four artifact groups validated on
// "existence + retry loop" (context.md/shared.md/subtasks.md/each subtask's
// todo.md non-trivial + last-line terminator); wrapup (src/wrapup.ts
// runWrapup, shared by the runner's main close-out and the review repair
// round) gains the existence + shape gate. Failing → one re-prompt with
// feedback → still failing → blocked; the "already exists → skip / inject
// directly" paths are unaffected (only this session's output is checked,
// nothing retroactive). Runs the full runSession chain (fake client + a real
// git repository); the scripts that write on the AI's behalf live in the
// event-stream generator (the same wiring as subtask-shape.test.ts).

import { rm } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { SessionChain } from "../src/chain"
import { EOF_MARK } from "../src/doccheck"
import { ensureDecomposed } from "../src/execute"
import type { Opts } from "../src/opts"
import { reloadUnits, seedUnits } from "./fixtures/units"
import { runWrapup } from "../src/wrapup"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

// A clean git repo + a committed task unit (a plain body with no checklist
// items) and a README; .auto/ is ignored so stats/progress writes never
// pollute the commits.
async function docRepo(): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "README.md"), "# Sample\n\nBackground notes.\n")
  await seedUnits(dir, "## T-001: sample task [in_progress]\n\nBody.\n")
  await git(dir, "add", "-A")
  await git(dir, "commit", "-q", "-m", "init")
  return dir
}

const makeChain = (): SessionChain => ({ pct: 10, used: 0, at: 0 })

// The stand-in script for each round's session: runs once when the event
// stream is built (round n consumes scripts[n-1]; after the list runs out the
// last entry repeats — the "still not fixed" shape), then immediately idles
// to end the round.
function scriptedClient(scripts: Array<() => Promise<unknown>>) {
  let round = 0
  return fakeClient({
    events: (sid) =>
      (async function* () {
        const script = scripts[Math.min(round++, scripts.length - 1)]
        if (script) await script()
        yield { type: "session.idle", properties: { sessionID: sid } }
      })(),
  })
}

const promptText = (call: { parts: unknown[] }): string => String((call.parts[0] as { text?: string } | undefined)?.text ?? "")

// Document-body filler material that is non-trivial and ends with the
// last-line terminator properly.
const filler = "Placeholder filler material. ".repeat(30)
const contextProper = `# Understanding\n\n## Relevant files and key symbols\n\n${filler}\n\n## Constraints and premises\n\nNone.\n\n## Existing decisions and current state\n\nNone.\n\n## Risks and unknowns\n\nNone.\n\n${EOF_MARK}\n`
const sharedProper = `# Shared context index\n\n- src/x.ts: the data-model entry.\n\n${filler}\n\n${EOF_MARK}\n`
const subtasksProper = `# Decomposition\n\n- [ ] subtask one Artifacts: docs/T-001/S01/index.md\n\n${filler}\n\n${EOF_MARK}\n`
const todoProper = `# S01: subtask one\n\n## Scope\n\n${filler}\n\n## Artifacts\n\n- docs/T-001/S01/index.md\n\n${EOF_MARK}\n`
const reportProper = `# Report\n\n${filler}\n\n${EOF_MARK}\n`

// Every compliant artifact of the merged understand+decompose session (M1.0).
async function writeMergedArtifacts(dir: string) {
  await Bun.write(join(dir, "docs/T-001/context.md"), contextProper)
  await Bun.write(join(dir, "docs/T-001/shared.md"), sharedProper)
  await Bun.write(join(dir, "docs/T-001/subtasks.md"), subtasksProper)
  await Bun.write(join(dir, "docs/T-001/S01/todo.md"), todoProper)
}

describe("ensureDecomposed merged understand+decompose artifact shape check (D5, M1.0)", () => {
  test("decomposition already exists (legacy output, no terminator): checklist injected directly, no session", async () => {
    const dir = await docRepo()
    try {
      await Bun.write(join(dir, "docs/T-001/subtasks.md"), "# Decomposition\n\n- [ ] subtask one\n")
      const { client, calls } = scriptedClient([])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(0)
      const reloaded = await reloadUnits(dir)
      expect((reloaded.tasks[0]!.checklist ?? []).map((item) => item.text)).toEqual(["subtask one"])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("context.md already exists but no decomposition: the merged session still runs (an existing digest is no longer an idempotent skip)", async () => {
    const dir = await docRepo()
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), contextProper)
      const { client, calls } = scriptedClient([async () => writeMergedArtifacts(dir)])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(1)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? []).map((item) => item.text)).toEqual([
        "subtask one Artifacts: docs/T-001/S01/index.md",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("all artifacts present but subtasks.md missing the last-line terminator: one retry with feedback, injected once fixed and committed as decompose", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), `# Decomposition\n\n- [ ] subtask one\n\n${filler}\n`)
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      // The re-prompt is dispatched on a fork of the just-ended session, carrying only the feedback (revised 2026-09-18).
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("did not pass checks")
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).toContain(EOF_MARK)
      expect(feedback).not.toContain("Relevant files and key symbols") // the whole merged prompt is not resent
      const reloaded = await reloadUnits(dir)
      expect((reloaded.tasks[0]!.checklist ?? []).map((item) => item.text)).toEqual(["subtask one Artifacts: docs/T-001/S01/index.md"])
      // A successful merged session records the session-mode fork base (plans/0030 D4)
      expect(reloaded.tasks[0]!.forkBase).toEqual({ opencode: "ses_fork_1" })
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: decompose")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a subtask todo.md missing: the feedback names that state file, injected once fixed", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await rm(join(dir, "docs/T-001/S01/todo.md"))
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/T-001/S01/todo.md")
      expect(feedback).toContain("missing or empty")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("todo.md missing a protocol section anchor (M1.4 spec-driven): the feedback names the missing section, injected once fixed", async () => {
    const dir = await docRepo()
    try {
      const todoNoList = `# S01: subtask one\n\n## Scope\n\n${filler}\n\n${EOF_MARK}\n`
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          await Bun.write(join(dir, "docs/T-001/S01/todo.md"), todoNoList)
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain('docs/T-001/S01/todo.md is missing section "## Artifacts"')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a checklist item declaring a directory artifact (trailing slash, plans/0065 F2): rejected with a problem line naming it, injected once declared as concrete files", async () => {
    const dir = await docRepo()
    try {
      const subtasksDir = `# Decomposition\n\n- [ ] subtask one Artifacts: docs/T-001/S01/golden/\n\n${filler}\n\n${EOF_MARK}\n`
      const { client, calls } = scriptedClient([
        async () => {
          await writeMergedArtifacts(dir)
          // Even a present, non-empty golden directory does not satisfy the
          // declaration — the artifact existence check is a file check, so the
          // declaration is unsatisfiable as written. It must be rejected here,
          // in the planning session, not at a subtask's close-out (the T-066
          // S01 hidden blockage).
          await Bun.write(join(dir, "docs/T-001/S01/golden/trace.txt"), "golden trace\n")
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), subtasksDir)
        },
        async () => writeMergedArtifacts(dir),
      ])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("ok")
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/T-001/S01/golden/")
      expect(feedback).toContain("declare the concrete files")
      const reloaded = await reloadUnits(dir)
      expect((reloaded.tasks[0]!.checklist ?? []).map((item) => item.text)).toEqual([
        "subtask one Artifacts: docs/T-001/S01/index.md",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("still not fixed → blocked naming the failed item, nothing committed", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/subtasks.md"), `# Decomposition\n\n- [ ] subtask one\n\n${filler}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await ensureDecomposed(client, plan, plan.tasks[0]!, { dir }, makeChain())
      expect(result.type).toBe("blocked")
      expect((result as { question: string }).question).toContain("context.md")
      expect(calls.prompts.length).toBe(2)
      // subtasks.md is the checklist itself (M3.4): the failed session output stays in the worktree, out of the decompose commit
      expect(await git(dir, "log", "--format=%B")).not.toContain("Auto-Stage: decompose")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runWrapup wrap-up report gate (D5, shared by the runner's main close-out and the review repair round)", () => {
  const wrapOpts = (dir: string): Opts => ({ dir })

  test("report missing: one retry with feedback, still missing → blocked, nothing committed", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await reloadUnits(dir)
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: false, label: "wrap-up session" })
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("docs/T-001/report.md missing or empty")
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("did not pass checks")
      // No close-out commit: HEAD is still init
      expect((await git(dir, "log", "-1", "--format=%s")).trim()).toBe("init")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("report missing the last-line terminator: one retry with feedback, passes once fixed and commits as wrapup", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), `# Report\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), reportProper)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: false, label: "wrap-up session" })
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // The re-prompt is dispatched on a fork of the just-ended wrap-up session (revised 2026-09-18).
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).toContain(EOF_MARK)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: wrapup")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("report compliant: one session passes and the close-out commits", async () => {
    const dir = await docRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/report.md"), reportProper)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runWrapup(client, plan, plan.tasks[0]!, wrapOpts(dir), makeChain(), { solo: true, label: "post-fix wrap-up session" })
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: wrapup")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
