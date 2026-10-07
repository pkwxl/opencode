// Incident regression scenario set (M0.2, plans/AUTO_NEXT_REFACTOR_PLAN.md F7):
// driver-level fake-client scenarios distilled from the field-incident
// library, run for every milestone exit criterion from then on (§7-3). Unlike
// the unit cases in watch.test.ts / subtask-shape.test.ts, this file is
// organized by incident narrative and covers the end-to-end chain of the
// "field hardening behavior". Scenario origins:
//   I1 half-open connection hang — kernel-dm T-068 (transport-layer half-open for 44 minutes with no timeout, session-boundary-hardening D3)
//   I2 truncated-output resume — kernel-spi-nor T-030 S13 (session-boundary-hardening §8, S9)
//   I3 misjudged-complete zero-write — kernel-dm T-068 S01 (misjudged by the pre-read task wrap-up narrative, session-boundary-hardening D2)
//   I4 test script rewriting sources in place — kernel-spi-nor T-028 (rustfmt apply, test-handover-early §H: hand over first, run after; no stash)
//   I5 handover chain close-out — test-handover-early §N F4 (unit completion must clear the chain, leaving no surface for recovery misjudgment)
//   I6 acceptance verdict FAIL — plans/0044 §3.3 (the only completion-side verdict after D13 retired verify/review/final-review:
//                               a report verdict line Result: FAIL blocks and halts the run; the report is committed, not marked done)

import { describe, expect, test } from "bun:test"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { attempt } from "../src/attempt"
import type { SessionChain } from "../src/chain"
import { EOF_MARK } from "../src/doccheck"
import { runExecSession } from "../src/exec-session"
import { runSubtask } from "../src/execute"
import { recallProgress } from "../src/resume"
import { runTask } from "../src/runner"
import { recallHandover } from "../src/handover"
import { planOf, reloadUnits, seedUnits } from "./fixtures/units"
import { runSession } from "../src/session"
import { parseSwitches } from "../src/switches"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

const NO_WAIT = parseSwitches({ OPENCODE_AUTO_RETRY_WAITS: "0,0", OPENCODE_AUTO_RECOVERY_WAIT: "0" })
const makeChain = (): SessionChain => ({ pct: 100, used: 0, at: 0 })

// Per-round session stand-in script (same shape as subtask-shape.test.ts):
// round n consumes scripts[n-1], repeating the last one once the list is
// exhausted; then an idle ends the round.
function scriptedClient(scripts: Array<(sid: string) => Promise<unknown>>) {
  let round = 0
  return fakeClient({
    events: (sid) =>
      (async function* () {
        const script = scripts[Math.min(round++, scripts.length - 1)]
        if (script) await script(sid)
        yield { type: "session.idle", properties: { sessionID: sid } }
      })(),
  })
}

// A temp repository with git: .gitignore ignores tmp/ and .auto/ per the loop-preflight criteria.
async function incidentRepo(planText: string): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "src.ts"), "// source baseline\n")
  await seedUnits(dir, planText)
  await git(dir, "add", "-A")
  await git(dir, "commit", "-q", "-m", "init")
  return dir
}

// message.updated events (usage progress; input beyond contextLimit reaches the test-handover criterion).
const usageMsg = (sid: string, id: string, input: number) => ({
  type: "message.updated",
  properties: {
    info: {
      id,
      sessionID: sid,
      role: "assistant",
      time: { completed: Date.now() },
      tokens: { input, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      providerID: "zai",
      modelID: "glm",
    },
  },
})

describe("I1 half-open connection hang (kernel-dm T-068)", () => {
  test("two consecutive probe failures → abort the session + a retryable session error, no infinite hang", async () => {
    const { client, calls } = fakeClient({
      get: () => ({ error: { name: "UnknownError", data: {} } }),
      // Half-open shape: the event stream never produces an event (no FIN/RST; the client never receives the end signal).
      events: () =>
        (async function* () {
          await new Promise(() => {})
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await attempt(client, task, "prompt", { idleMs: 20 }, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("blocked")
    expect((result as { errorClass?: string }).errorClass).toBe("transient")
    expect(calls.aborts).toContain("ses_new_1")
  })
})

// attempt only needs a Task; writing to disk is too heavy, so use an in-memory plan.
async function loadFromText() {
  return planOf("## T-001: sample task [pending]\nBody.\n")
}

describe("I2 truncated-output resume (kernel-spi-nor T-030 S13)", () => {
  const stepFinish = (sid: string, id: string, reason: string) => ({
    type: "message.part.updated",
    properties: {
      part: {
        id,
        sessionID: sid,
        messageID: "msg_1",
        type: "step-finish",
        reason,
        cost: 0,
        tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: 1 },
      },
    },
  })
  const idle = (sid: string) => ({ type: "session.idle", properties: { sessionID: sid } })

  test("a length finish is not a natural finish: the steer \"continue from the truncation point\" keeps the original session going", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          yield stepFinish(sid, "pt_1", "length")
          yield idle(sid)
          yield stepFinish(sid, "pt_2", "stop")
          yield idle(sid)
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await runSession(client, task, "prompt", {}, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // The continuation goes into the original session via steer: no new session, no re-dispatched prompt.
    expect(calls.steers.length).toBe(1)
    expect(calls.steers[0]).toContain("cut off by the output length limit")
    expect(calls.steers[0]).toContain("continue the unfinished work")
    expect(calls.creates).toBe(1)
    expect(calls.prompts.length).toBe(1)
  })

  test("consecutive truncations are capped at 3: the 4th settles as a natural finish (handed to the shape-check loop)", async () => {
    const { client, calls } = fakeClient({
      events: (sid) =>
        (async function* () {
          for (let i = 0; i < 4; i++) {
            yield stepFinish(sid, `pt_${i}`, "length")
            yield idle(sid)
          }
        })(),
    })
    const task = (await loadFromText()).tasks[0]!
    const result = await runSession(client, task, "prompt", {}, makeChain(), undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.steers.length).toBe(3)
  })
})

describe("I3 misjudged-complete zero-write (kernel-dm T-068 S01)", () => {
  const BODY = "Investigate and write the record to disk Artifacts: docs/T-001/S01/record.md"

  test("the session ends with zero artifacts: one re-prompt with feedback (restating the ground state) → still zero → blocked, not ticked", async () => {
    const dir = await incidentRepo(`## T-001: sample task [in_progress]\n\n- [ ] ${BODY}\n`)
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("zero disk writes")
      // Initial dispatch + one re-prompt with feedback; the feedback restates
      // the ground state (L1) to prevent the narrative misjudgment.
      expect(calls.prompts.length).toBe(2)
      const feedback = String((calls.prompts[1]!.parts[0] as { text?: string })?.text ?? "")
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("T-001.S01")
      expect(feedback).toContain("do not judge this subtask complete on that basis")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("I4 the test script rewriting sources in place (kernel-spi-nor T-028; the side-effect guard plans/0083 D11 since restored the rewrite)", () => {
  const HANDOFF = "docs/T-001/S01/testhandoff.md"

  test("sequential state: freeze commit → archive + commit #2 → the script runs after that; its tracked rewrite is restored from the pre-run snapshot and named back, no stash at any point", async () => {
    const dir = await incidentRepo(`## T-001: sample task [in_progress]\n\n- [ ] implement the logic\n`)
    try {
      // Round 1: usage over the limit → initiates a test (the script rewrites
      // src.ts in place, rustfmt-apply shape) → freeze; the wrap-up writes the
      // handover document (Status: continue) → testHandover settle. Round 2
      // (continuation): natural finish.
      // Per-event orchestration, same shape as session.test.ts handoverStream.
      let round = 0
      const { client: driver, calls } = fakeClient({
        events: (sid) =>
          (async function* () {
            if (round++ === 0) {
              yield usageMsg(sid, "m_limit", 2000)
              await Bun.write(join(dir, "tmp", "test.sh"), "echo '// formatted rewrite' >> src.ts")
              yield { type: "session.idle", properties: { sessionID: sid } }
              await Bun.write(join(dir, HANDOFF), "# Handover\n\nProgress and next steps.\n\nStatus: continue\n")
              yield usageMsg(sid, "m_wrapup", 2100)
              yield { type: "session.idle", properties: { sessionID: sid } }
            } else {
              yield { type: "session.idle", properties: { sessionID: sid } }
            }
          })(),
      })
      const plan = await reloadUnits(dir)
      const chain: SessionChain = { pct: 100, used: 0, at: 0, subject: "T-001 S1 implement the logic", phase: { kind: "subtasks", index: 1 } }
      const result = await runExecSession(
        driver,
        plan,
        plan.tasks[0]!,
        "prompt",
        { dir, testByDriver: true, handoverTest: true, contextLimit: 1000 },
        chain,
        undefined,
        1,
      )
      expect(result.type).toBe("idle")
      // The handover document is archived and recorded (testhandoff-1.md is in
      // git; after the continuation's natural finish the current copy is
      // chain-cleared and the in-flight record voided with it — the closure
      // semantics are asserted by I5; here we only verify the archived copy is
      // on the books).
      const tracked = await git(dir, "ls-files")
      expect(tracked).toContain("docs/T-001/S01/testhandoff-1.md")
      // The key ordering (T-028): the script runs after the close-out commit —
      // src.ts in HEAD is the baseline. The side-effect guard (plans/0083
      // D11): the tracked rewrite is a violation — the driver restored the
      // pre-run content (the tree of commit #2 back), and the continuation
      // prompt names the violation; `git stash create` touched nothing on
      // disk and left the stash list empty.
      expect(await git(dir, "show", "HEAD:src.ts")).not.toContain("formatted rewrite")
      expect(await Bun.file(join(dir, "src.ts")).text()).not.toContain("formatted rewrite")
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect((await git(dir, "stash", "list")).trim()).toBe("")
      expect(calls.prompts.some((prompt) => JSON.stringify(prompt).includes("side-effect violation: the script modified or deleted tracked files") && JSON.stringify(prompt).includes("restored them from the pre-run snapshot: src.ts"))).toBe(true)
      // The continuation round only adds one continuation message, no
      // re-dispatch from scratch: two prompts (initial + continuation).
      expect(calls.prompts.length).toBe(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("I5 handover chain close-out (test-handover-early §N F4)", () => {
  const BODY = "Investigate and write the record to disk Artifacts: docs/T-001/S01/record.md"
  const filler = "Placeholder material alpha beta gamma. ".repeat(30)

  test("unit completion must clear the chain: the handover happened, the continuation completed → the whole testhandoff chain is deleted and recorded with the unit commit; the worktree is clean", async () => {
    const dir = await incidentRepo(`## T-001: sample task [in_progress]\n\n- [ ] ${BODY}\n`)
    try {
      let round = 0
      const { client } = fakeClient({
        events: (sid) =>
          (async function* () {
            if (round++ === 0) {
              yield usageMsg(sid, "m_limit", 2000)
              await Bun.write(join(dir, "tmp", "test.sh"), "echo ok")
              yield { type: "session.idle", properties: { sessionID: sid } }
              await Bun.write(join(dir, "docs/T-001/S01/testhandoff.md"), "# Handover\n\nProgress.\n\nStatus: continue\n")
              yield usageMsg(sid, "m_wrapup", 2100)
              yield { type: "session.idle", properties: { sessionID: sid } }
            } else {
              // Continuation round: adds the declared artifact (non-trivial + last-line terminator), natural finish.
              await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\n${filler}\n\n${EOF_MARK}\n`)
              yield { type: "session.idle", properties: { sessionID: sid } }
            }
          })(),
      })
      const plan = await reloadUnits(dir)
      const result = await runSubtask(
        client,
        plan,
        plan.tasks[0]!,
        BODY,
        1,
        { dir, testByDriver: true, handoverTest: true, contextLimit: 1000 },
        makeChain(),
      )
      expect(result).toBeUndefined()
      // The handover really happened (archived then deleted; history lives in
      // git); the current disk state has no testhandoff file at all.
      const tracked = await git(dir, "ls-files")
      expect(tracked).not.toContain("testhandoff")
      expect(await Bun.file(join(dir, "docs/T-001/S01/testhandoff.md")).exists()).toBe(false)
      // The subtask is ticked, the unit commit recorded, the worktree clean
      // (the deletion is recorded with the commit, leaving no dirty area to
      // slam the next unit's gate).
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      expect(await git(dir, "log", "--format=%s")).toContain("test handover #1")
      // The in-flight record is voided (cleared on closure).
      expect(await recallHandover(dir, "T-001", "docs/T-001/S01/testhandoff.md")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("I6 acceptance verdict FAIL halts the run (plans/0044 §3.3; the verify → fix loop plans/0083 in front since)", () => {
  const filler = "Acceptance evidence line. ".repeat(20)
  // Round 1 = whole-task session (off mode): a source change. Round 2 = the
  // verify session: a passing report (the given PASS form). The FAIL variant
  // below scripts the loop's rounds by hand.
  const scenario = (dir: string, resultLine: string) =>
    scriptedClient([
      async () => {
        await Bun.write(join(dir, "src.ts"), "// source baseline\nexport const x = 1\n")
      },
      async () => {
        await Bun.write(join(dir, "docs/T-001/report.md"), `# T-001 report\n\n${filler}\n\n${resultLine}\n\n${EOF_MARK}\n`)
      },
    ])

  test("Result: FAIL → the fix loop runs its two rounds, then blocked with the reason and the spent rounds, task not done, gap list committed, phase rewound to wrapup", async () => {
    const dir = await incidentRepo(`## T-001: acceptance [pending]\n\nCheck x.\n\n## T-002: follow-up [pending]\n\nFollow-up work.\n`)
    // The verify loop's FAIL protocol (0083 D2/D3): no report at all — the gap
    // list with its closing FAIL result line instead; fix rounds write source
    // (so each posts its own `T-001 fix <n>` commit); the gap list is
    // rewritten by every re-verification.
    const gapList = () =>
      Bun.write(
        join(dir, "docs/T-001/gaps.md"),
        ["# Gaps (T-001)", "", "## Verified OK", "", `- ${filler}`, "", "## Gaps", "", "- x is not exported under the expected name (src.ts).", "", "Result: FAIL x is not exported under the expected name", ""].join("\n"),
      )
    try {
      const { client } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "src.ts"), "// source baseline\nexport const x = 1\n")
        },
        gapList,
        async () => {
          await Bun.write(join(dir, "src.ts"), "// fix round 1\nexport const x = 1\n")
        },
        gapList,
        async () => {
          await Bun.write(join(dir, "src.ts"), "// fix round 2\nexport const x = 1\n")
        },
        gapList,
      ])
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off" })
      expect(outcome).toMatchObject({ type: "blocked" })
      expect((outcome as { question: string }).question).toContain("the verification of T-001 concluded Result: FAIL (x is not exported under the expected name)")
      expect((outcome as { question: string }).question).toContain("2 fix rounds already ran (the budget is 2)")
      const after = await reloadUnits(dir)
      expect(after.tasks[0]!.status).not.toBe("done")
      expect(after.tasks[1]!.status).toBe("pending")
      // The loop's commits: each fix round posts its own execute-stage
      // commit; the gap list lands through the wrap-up session's commit and
      // no report was written at all.
      const subjects = await git(dir, "log", "--format=%s")
      expect(subjects.split("\n").filter((line) => line.startsWith("T-001 fix "))).toHaveLength(2)
      expect(await git(dir, "ls-files")).toContain("docs/T-001/gaps.md")
      expect(await git(dir, "ls-files")).not.toContain("docs/T-001/report.md")
      expect(await git(dir, "show", "HEAD:docs/T-001/gaps.md")).toContain("Result: FAIL")
      expect((await git(dir, "status", "--porcelain")).trim()).toBe("")
      // The rounds spent persist with the rewound phase (0083 D7).
      expect((await recallProgress(dir, "T-001"))?.phase).toEqual({ kind: "wrapup", round: 2 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("Result: PASS → completed and marked done", async () => {
    const dir = await incidentRepo(`## T-001: acceptance [pending]\n\nCheck x.\n`)
    try {
      const { client } = scenario(dir, "Result: PASS")
      const plan = await reloadUnits(dir)
      const outcome = await runTask(client, plan, plan.tasks[0]!, { dir, subtask: "off" })
      expect(outcome).toEqual({ type: "completed" })
      expect((await reloadUnits(dir)).tasks[0]!.status).toBe("done")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
