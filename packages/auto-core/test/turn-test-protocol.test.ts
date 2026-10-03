// The test concern's suite (plans/0061 §4.6: a concern suite over a fake
// TurnFx): the idle row's test cell — the --test-by-driver protocol. The
// run-and-feedback path (the marker found, the script run, the rendered
// result steered back), the due-handover path (the ⚠ cap line, the freeze
// commit through the kernel fx, the pending script pinned, the in-flight
// handover record, the wrap-up steer, the resumeWrapup seeding) and the
// asked verification (the document's status-line criterion, the one
// backfill steer, the strict-resume invalid settle, the twice-failed
// block). The cases re-homed from the watch suite's handover describe
// (the freeze steer seeding resumeWrapup, the forked instance verifying
// the document on the strength of the flag) are the ones here that drive
// the real TestRun record; the end-to-end protocol exits (the marker
// consumed by a real script run, the real freeze commit on git, the
// natural settle after a complete handover) are the trace oracle's
// (test/turn-trace.test.ts's test-protocol repo family, byte-pinned
// through watch's real install).
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdir, rm, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentEvent } from "../src/agent/types"
import type { Advice, PendingTest, TurnInput, TurnState } from "../src/engine/contract"
import { makeTestConcern } from "../src/engine/concerns/test"
import type { Watch } from "../src/chain"
import { testHandoffFile } from "../src/docpaths"
import type { TestRunInfo } from "../src/prompt"
import type { SessionCommit } from "../src/opts"
import { scriptTmpDir } from "../src/script"
import { parseSwitches, SWITCH_ENV, type Switches } from "../src/switches"
import type { TestRun } from "../src/testrun"
import { usageSource } from "../src/usage"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev } from "./fixtures/agent"
import { freshRepo, task } from "./fixtures/runner"

const SESSION = "ses_1"

// The temporary repository the protocol's paths live in (a fresh git
// repository per test, the same shape the trace oracle's repo family and
// the re-homed watch cases used): the fx double's file reads are the real
// Bun.file reads over it, so the marker check and the handover-document
// verification see exactly what the driver would see. The kernel calls
// themselves (the freeze commit, the script run, the marker consumption)
// are the double's — what they answer, and the arguments the concern hands
// them, is what these cases pin.
let dir = ""

beforeEach(async () => {
  dir = await freshRepo()
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

// The run record, hand-built over the repository with the product's own
// path helpers (the driver working directory scriptTmpDir, the scope-named
// handover document testHandoffFile).
const repoTestRun = (over: Partial<TestRun> = {}): TestRun => ({
  dir,
  tmp: scriptTmpDir(dir),
  handoffFile: join(dir, testHandoffFile(task)),
  handover: false,
  limit: 70_000,
  seq: 0,
  task,
  unit: "execute",
  subject: "T-001 exec sample task",
  label: "T-001",
  handovers: 0,
  startUsed: 0,
  ...over,
})

// The test script and the request marker (the protocol's path form: the
// marker names a script under test/, a single line).
const scriptRequest = async (testRun: TestRun): Promise<void> => {
  await mkdir(join(testRun.dir, "test"), { recursive: true })
  await mkdir(testRun.tmp, { recursive: true })
  await writeFile(join(testRun.dir, "test", "build.sh"), "#!/bin/sh\necho fixture-ok\n")
  await writeFile(join(testRun.tmp, "test.sh"), "test/build.sh\n")
}

// Write the handover document the session would have written (the
// `Status: continue` line on the last line is the completeness criterion).
const writeHandoff = async (testRun: TestRun, text: string): Promise<void> => {
  await mkdir(dirname(testRun.handoffFile), { recursive: true })
  await writeFile(testRun.handoffFile, text)
}

// Strict resume's default flipped to on (2026-10, ruling P-1 of
// plans/0070): the loose backfill-retry cases pin the emergency-off
// override explicitly, keeping their semantics default-independent.
const LOOSE = parseSwitches({ [SWITCH_ENV.strictResume]: "off" })

// One concern instance per case, driven one idle input at a time over a
// recording fx. The measurement events go through the source first (the
// spine observes every event of the session before the row runs), so a
// case's figure is the one the source would hold.
const setup = (over: { test?: TestRun; switches?: Switches; steerOk?: boolean; freeze?: SessionCommit; pending?: PendingTest; run?: TestRunInfo } = {}) => {
  const source = usageSource("events")
  const ctx = turnContext({
    source,
    ...(over.test !== undefined ? { test: over.test } : {}),
    ...(over.switches !== undefined ? { switches: over.switches } : {}),
  })
  const blockedExtra: { extra?: Partial<Watch> } = {}
  const concern = makeTestConcern({ blockedExtra })
  const own = concern.initial(ctx)
  const fx = fakeTurnFx({
    steerOk: over.steerOk,
    commitFreeze: over.freeze,
    resolveTest: over.pending,
    runTest: over.run,
    exists: (path) => Bun.file(path).exists(),
    readText: (path) => Bun.file(path).text(),
  })
  // The view always carries a transcript slice: the blocked exits' questions
  // quote view.transcript.lastText, and the in-flight record's session
  // anchor reads view.transcript.lastMessage at the freeze moment.
  const drive = (input: TurnInput, view: Partial<TurnState> = { transcript: transcript() }): Promise<Advice> =>
    concern.handle(input, own, viewOver(view), fx, ctx)
  const idle = (view: Partial<TurnState> = { transcript: transcript() }): Promise<Advice> => drive({ kind: "event", event: ev.idle(SESSION) }, view)
  const measure = (used: number): void => {
    source.observe(ev.message(SESSION, `m_${used}`, used))
  }
  return { ctx, own, fx, drive, idle, measure, blockedExtra }
}

const partInput = (): TurnInput => ({ kind: "event", event: ev.text(SESSION, "t1", "a part") as AgentEvent })
const messageInput = (): TurnInput => ({ kind: "event", event: ev.message(SESSION, "m1") as AgentEvent })
const errorInput = (): TurnInput => ({ kind: "event", event: ev.error(SESSION, { message: "boom" }) as AgentEvent })
const retryInput = (): TurnInput => ({ kind: "event", event: { type: "retry", session: SESSION, error: { message: "boom" } } as AgentEvent })

// A transcript slice carrying the last agent output (the blocked exits'
// questions quote it) and, at the freeze moment, the last message id (the
// in-flight record's session anchor).
const transcript = (over: { lastText?: string; lastMessage?: string } = {}): TurnState["transcript"] => ({
  lastText: over.lastText ?? "",
  ...(over.lastMessage !== undefined ? { lastMessage: over.lastMessage } : {}),
  seen: new Set<string>(),
  billed: new Set<string>(),
  usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 },
  modelReported: false,
})

describe("the test concern (idle: the protocol's gate)", () => {
  test("an idle without a test run passes the row on — no protocol, no fx call", async () => {
    const { own, fx, idle } = setup()
    await expect(idle()).resolves.toBe("pass")
    expect(own).toEqual({ handover: false, asked: false, retried: false })
    expect(fx.calls).toEqual([])
  })

  test("inputs outside the idle row pass through untouched", async () => {
    const { own, drive } = setup({ test: repoTestRun() })
    for (const input of [partInput(), messageInput(), errorInput(), retryInput(), { kind: "stream-end" } as TurnInput, { kind: "probe", ok: true, at: 0 } as TurnInput, { kind: "answer", answer: undefined } as TurnInput]) {
      await expect(drive(input)).resolves.toBe("pass")
    }
    expect(own).toEqual({ handover: false, asked: false, retried: false })
  })

  test("an idle with a test run but no pending marker and nothing asked passes the row on (the natural terminal)", async () => {
    const { own, fx, idle } = setup({ test: repoTestRun() })
    await expect(idle()).resolves.toBe("pass")
    expect(own).toEqual({ handover: false, asked: false, retried: false })
    expect(fx.calls).toEqual(["exists"])
  })

  test("the asked flag is seeded from the run record's resumeWrapup (a turn forked mid-wrap-up carries the wrap-up state)", async () => {
    // Re-homed from the watch suite: the freeze steer's successful delivery
    // seeds the flag on the run record, and the new turn the retry ring
    // builds over the same record starts asked — without the seeding it
    // would misjudge the wrap-up as a natural finish and the handover loop
    // would be lost.
    const testRun = repoTestRun({ resumeWrapup: true })
    const { own } = setup({ test: testRun })
    expect(own.asked).toBe(true)
  })
})

describe("the test concern (idle: run and feedback)", () => {
  test("a pending marker with no handover due runs the script and steers the rendered result back (consumed; the turn continues)", async () => {
    const testRun = repoTestRun()
    await scriptRequest(testRun)
    const run: TestRunInfo = { script: "test/build.sh", code: 1, ms: 12, timedOut: false, out: "fixture-fail", seq: 2 }
    const { own, fx, idle } = setup({ test: testRun, run })
    await expect(idle()).resolves.toBe("consumed")
    expect(own).toEqual({ handover: false, asked: false, retried: false })
    expect(fx.calls).toEqual(["exists", "runTest", "steer"])
    expect(fx.steers).toHaveLength(1)
    expect(fx.steers[0]).toContain("The test script has finished running (run number 2)")
    expect(fx.steers[0]).toContain("test/build.sh")
    expect(fx.steers[0]).toContain("Exit code: 1")
    expect(fx.steers[0]).toContain("fixture-fail")
  })

  test("the feedback steer's failed dispatch settles blocked with the fixed question", async () => {
    const testRun = repoTestRun()
    await scriptRequest(testRun)
    const { own, fx, idle, blockedExtra } = setup({ test: testRun, steerOk: false })
    await expect(idle()).resolves.toEqual({ settle: { kind: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." } })
    expect(own).toEqual({ handover: false, asked: false, retried: false })
    expect(blockedExtra.extra).toEqual({ blocked: { type: "blocked", question: "steer dispatch failed (test result feedback); cannot continue the session, see the log." }, testHandover: false })
  })
})

describe("the test concern (idle: the due handover)", () => {
  const pinned: PendingTest = { script: "test/build.sh", seq: 1 }

  test("a marker at the cap logs the ⚠ line, commits the freeze, pins the pending script, saves the in-flight record, steers the wrap-up and seeds resumeWrapup (consumed)", async () => {
    const testRun = repoTestRun({ handover: true })
    await scriptRequest(testRun)
    const { own, fx, idle, measure } = setup({ test: testRun, pending: pinned })
    measure(70_000)
    await expect(idle({ transcript: transcript({ lastText: "the test script is ready", lastMessage: "m_70000" }) })).resolves.toBe("consumed")
    // The kernel calls precede the single steer (the audit's idle quiet
    // point), and the run record carries the pin and the seeding.
    expect(fx.calls).toEqual(["exists", "log", "commitFreeze", "resolveTest", "saveHandover", "steer"])
    expect(fx.freezes).toEqual([1])
    expect(testRun.pending).toEqual(pinned)
    expect(testRun.resumeWrapup).toBe(true)
    expect(own).toEqual({ handover: false, asked: true, retried: false })
    expect(fx.lines).toEqual([
      "⚠ T-001 context used 70.0k tokens reached the 70.0k cap; after the frozen commit, hand over first and then run the tests; asking for a handover document before switching to a new session",
    ])
    expect(fx.handovers).toEqual([
      { task: task.id, scope: testHandoffFile(task), unit: "execute", n: 1, script: "test/build.sh", seq: 1, pinSession: SESSION, pinMessage: "m_70000" },
    ])
    expect(fx.steers).toHaveLength(1)
    expect(fx.steers[0]).toContain("A handover is needed now")
    expect(fx.steers[0]).toContain(testRun.handoffFile)
  })

  test("the handover decision falls back to the starting occupancy before any figure arrives", async () => {
    const testRun = repoTestRun({ handover: true, startUsed: 70_000 })
    await scriptRequest(testRun)
    const { fx, idle } = setup({ test: testRun, pending: pinned })
    await expect(idle()).resolves.toBe("consumed")
    expect(fx.freezes).toEqual([1])
    expect(fx.lines[0]).toContain("context used 70.0k tokens")
  })

  test("the freeze commit's failure settles blocked through the commit boundary's question", async () => {
    const testRun = repoTestRun({ handover: true, startUsed: 70_000 })
    await scriptRequest(testRun)
    const { fx, idle, blockedExtra } = setup({ test: testRun, freeze: { type: "failed", question: "git lock held" } })
    await expect(idle()).resolves.toEqual({
      settle: { kind: "blocked", question: "T-001 exec sample task test handover #1 freeze: output not committed, not considered complete — git lock held" },
    })
    expect(fx.calls).toEqual(["exists", "log", "commitFreeze"])
    expect(blockedExtra.extra).toEqual({
      blocked: { type: "blocked", question: "T-001 exec sample task test handover #1 freeze: output not committed, not considered complete — git lock held" },
      testHandover: false,
    })
  })

  test("the wrap-up steer's failed dispatch settles blocked with the fixed question, the seeding withheld", async () => {
    const testRun = repoTestRun({ handover: true, startUsed: 70_000 })
    await scriptRequest(testRun)
    const { own, fx, idle } = setup({ test: testRun, steerOk: false, pending: pinned })
    await expect(idle()).resolves.toEqual({ settle: { kind: "blocked", question: "steer dispatch failed (test-handover request); cannot continue the session, see the log." } })
    expect(fx.calls).toEqual(["exists", "log", "commitFreeze", "resolveTest", "saveHandover", "steer"])
    // The flag the forked instance would carry is seeded only on a
    // successful delivery.
    expect(testRun.resumeWrapup).toBeUndefined()
    expect(own.asked).toBe(true)
  })
})

describe("the test concern (idle: the asked verification)", () => {
  test("a complete document (status line on the last line) breaks the protocol's share of the row with the handover flag ruled", async () => {
    // Re-homed from the watch suite: the forked instance verifies the
    // document at idle on the strength of the seeded flag instead of
    // calling it a natural finish — the row passes on to the liveness
    // cell, and the handover flag rides the natural Watch result.
    const testRun = repoTestRun({ resumeWrapup: true })
    await writeHandoff(testRun, "# Handover\n\nThe progress so far.\n\nStatus: continue\n")
    const { own, fx, idle } = setup({ test: testRun })
    await expect(idle()).resolves.toBe("pass")
    expect(own).toEqual({ handover: true, asked: true, retried: false })
    expect(fx.calls).toEqual(["readText"])
    expect(fx.steers).toEqual([])
  })

  test("an incomplete document steers the backfill requirement once (retried, consumed)", async () => {
    const testRun = repoTestRun({ resumeWrapup: true })
    await writeHandoff(testRun, "# Handover\n\nhalf-written, no status line\n")
    // Strict resume's default flipped to on (2026-10, ruling P-1 of
    // plans/0070): the loose backfill-retry path pins the emergency-off.
    const { own, fx, idle } = setup({ test: testRun, switches: LOOSE })
    await expect(idle({ transcript: transcript({ lastText: "still writing" }) })).resolves.toBe("consumed")
    expect(own).toEqual({ handover: false, asked: true, retried: true })
    expect(fx.steers).toHaveLength(1)
    expect(fx.steers[0]).toContain(`You ended the session last time without writing a valid ${testRun.handoffFile}`)
    expect(fx.steers[0]).toContain("put the status line on the last line")
  })

  test("a second incomplete document settles blocked naming the file and the last agent output", async () => {
    const testRun = repoTestRun({ resumeWrapup: true })
    await writeHandoff(testRun, "# Handover\n\nstill no status line\n")
    const { own, fx, idle, blockedExtra } = setup({ test: testRun, switches: LOOSE })
    await idle()
    await expect(idle({ transcript: transcript({ lastText: "the model's last words" }) })).resolves.toEqual({
      settle: {
        kind: "blocked",
        question:
          `the test-handover session failed twice to produce a valid ${testRun.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\nthe model's last words`,
      },
    })
    expect(own).toEqual({ handover: false, asked: true, retried: true })
    expect(fx.steers).toHaveLength(1)
    expect(blockedExtra.extra).toEqual({
      blocked: {
        type: "blocked",
        question:
          `the test-handover session failed twice to produce a valid ${testRun.handoffFile} (missing, or lacking a \`Status: continue|done\` status line; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\nthe model's last words`,
      },
      testHandover: false,
    })
  })

  test("the backfill steer's failed dispatch settles blocked with the fixed question", async () => {
    const testRun = repoTestRun({ resumeWrapup: true })
    const { fx, idle } = setup({ test: testRun, steerOk: false, switches: LOOSE })
    await expect(idle()).resolves.toEqual({ settle: { kind: "blocked", question: `steer dispatch failed (asking to backfill ${testRun.handoffFile}); cannot continue the session, see the log.` } })
    expect(fx.calls).toEqual(["readText", "steer"])
  })

  test("strict resume: one invalid document settles blocked invalid at once — no backfill retry", async () => {
    const testRun = repoTestRun({ resumeWrapup: true })
    await writeHandoff(testRun, "# Handover\n\nno status line\n")
    const { own, fx, idle, blockedExtra } = setup({ test: testRun, switches: parseSwitches({ [SWITCH_ENV.strictResume]: "on" }) })
    const advice = await idle({ transcript: transcript({ lastText: "the model's last words" }) })
    expect(advice).toEqual({
      settle: {
        kind: "blocked",
        invalid: true,
        question:
          `test handover document ${testRun.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
          `this unit will roll back to its baseline and redo). Last agent output:\nthe model's last words`,
      },
    })
    expect(own).toEqual({ handover: false, asked: true, retried: false })
    expect(fx.steers).toEqual([])
    expect(blockedExtra.extra).toEqual({
      blocked: {
        type: "blocked",
        question:
          `test handover document ${testRun.handoffFile} missing or empty (strict resume: the boundary write-verify failed; no more backfill retries; ` +
          `this unit will roll back to its baseline and redo). Last agent output:\nthe model's last words`,
      },
      testHandoverInvalid: true,
    })
  })
})
