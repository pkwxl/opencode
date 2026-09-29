// The questions concern's suite (plans/0061 §4.6: a concern suite over a
// fake TurnFx): every question and permission path of the turn — the
// plan-session human policy (the no-timeout wait, the closed-input and repeat
// blocks), the --wait-answer window and its fallback auto-answer (the ⚑
// report, the resolves the snapshot carries out, the answer-wording switch),
// the default permission-question block, the dryrun preflight, and the
// permission modes (auto-allow, the ask-* triad over human answers and
// timeouts, ask-fail's blocked halt). The cases marked "re-homed" carry the
// mechanism assertions of the matching watch.test.ts cases, deleted there in
// the same unit; the end-to-end question and permission coverage stays with
// the frozen turn-trace oracle and agent-fake.
import { describe, expect, test } from "bun:test"
import type { AgentEvent } from "../src/agent/types"
import type { Advice, TurnState } from "../src/engine/contract"
import { questionsConcern } from "../src/engine/concerns/questions"
import type { Opts } from "../src/opts"
import { autoAnswer } from "../src/unit-commit"
import { parseSwitches, SWITCH_ENV, type Switches } from "../src/switches"
import { fakeTurnFx, turnContext, viewOver } from "./fixtures/turn"
import { ev } from "./fixtures/agent"

const SESSION = "ses_1"
// The re-homed watch.test.ts cases' question texts (compactText leaves both
// unchanged, so the ⚑ lines carry them verbatim).
const Q1 = "Should the third copy of formatTokens in prompt.ts be cleaned up as well?"
const Q2 = "Should depreciation booking also go through the MAX_TICK clamp?"
const PERMISSION_Q = "May I have permission to wipe the build directory?"

type Own = TurnState["questions"]
type Fx = ReturnType<typeof fakeTurnFx>

// One concern instance per case, driven over one event at a time. The human
// answer the fake fx returns is per-setup (undefined = the timeout /
// closed-channel resolution).
const setup = (over: { opts?: Opts; switches?: Switches; human?: string } = {}): { own: Own; drive: (event: AgentEvent) => Promise<Advice>; fx: Fx } => {
  const ctx = turnContext({ opts: over.opts, switches: over.switches })
  const own = questionsConcern.initial(ctx)
  const fx = fakeTurnFx({ human: over.human })
  const drive = (event: AgentEvent): Promise<Advice> => questionsConcern.handle({ kind: "event", event }, own, viewOver({}), fx, ctx)
  return { own, drive, fx }
}

describe("the questions concern (question: the plan-session human policy)", () => {
  test("a non-permission question waits for the human with no timeout; the answer is echoed and replied, nothing proxied", async () => {
    const { own, drive, fx } = setup({ opts: { humanQuestions: true }, human: "use postgres" })
    await expect(drive(ev.question(SESSION, "q1", "which db?"))).resolves.toBe("consumed")
    expect(fx.humanAsks).toEqual([{ timeoutMin: undefined, hint: "no timeout and no automatic answer under plan" }])
    expect(fx.lines).toEqual([`❓ received a non-permission question (waiting for your answer; plan never proxy-answers):\nwhich db?`, "→ human answer: use postgres"])
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [["use postgres"]] }])
    expect(own.autoAnswered).toEqual(["which db?"])
    expect(own.resolves).toEqual([])
  })

  test("every question of one request gets the human's answer (one answer slot per question)", async () => {
    const { drive, fx } = setup({ opts: { humanQuestions: true }, human: "use postgres" })
    await expect(drive(ev.question(SESSION, "q1", "which db?", "which cache?"))).resolves.toBe("consumed")
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [["use postgres"], ["use postgres"]] }])
  })

  test("the closed input channel (no human answer): reject, abort and the blocked settle naming the closed input", async () => {
    const { own, drive, fx } = setup({ opts: { humanQuestions: true } })
    await expect(drive(ev.question(SESSION, "q1", "which db?"))).resolves.toEqual({
      settle: {
        kind: "blocked",
        question: "the session asked for a human decision, but no answer could be received (the input channel is closed); answer it outside the session, then re-run:\nwhich db?",
      },
    })
    expect(fx.calls).toEqual(["log", "askHuman", "rejectQuestion", "abort"])
    expect(fx.questionRejects).toEqual(["q1"])
    expect(own.resolves).toEqual([])
  })

  test("a repeat of the answered question never waits again: reject, abort, the blocked settle naming the repeat", async () => {
    const { own, drive, fx } = setup({ opts: { humanQuestions: true }, human: "use postgres" })
    await drive(ev.question(SESSION, "q1", "which db?"))
    await expect(drive(ev.question(SESSION, "q2", "which db?"))).resolves.toEqual({
      settle: {
        kind: "blocked",
        question: "asked again about the same question after the human's answer; handle it manually outside the session, then re-run:\nwhich db?",
      },
    })
    expect(fx.humanAsks).toHaveLength(1)
    expect(fx.questionRejects).toEqual(["q2"])
    expect(fx.calls).toContain("abort")
    expect(own.resolves).toEqual([])
  })

  test("a permission-worded question is not the plan policy's to wait for: no askHuman, the general paths decide", async () => {
    const { drive, fx } = setup({ opts: { humanQuestions: true } })
    await expect(drive(ev.question(SESSION, "q1", PERMISSION_Q))).resolves.toEqual({ settle: { kind: "blocked", question: PERMISSION_Q } })
    expect(fx.humanAsks).toEqual([])
    expect(fx.calls).toEqual(["rejectQuestion", "abort"])
  })
})

describe("the questions concern (question: --wait-answer and the fallback auto-answer)", () => {
  test("a human reply inside the window is echoed and replied; a real person's decision is no proxy answer", async () => {
    // Re-homed from test/watch.test.ts ("a human really answered within
    // --wait-answer: not counted as a proxy answer") — the mechanism half;
    // the ledger and interactive-channel wiring stays there.
    const { own, drive, fx } = setup({ opts: { waitAnswer: 5 }, human: "backfill the old rows" })
    await expect(drive(ev.question(SESSION, "q1", Q1))).resolves.toBe("consumed")
    expect(fx.humanAsks).toEqual([{ timeoutMin: 5, hint: "auto-answered on timeout" }])
    expect(fx.lines).toEqual([`❓ received a non-permission question:\n${Q1}`, "→ human answer: backfill the old rows"])
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [["backfill the old rows"]] }])
    expect(own.resolves).toEqual([])
  })

  test("the timeout falls back to the driver's auto-answer: the ⚑ two-line report, the resolve recorded, the fallback replied, the full text demoted to vlog", async () => {
    // Re-homed from test/watch.test.ts ("fallback auto-answer … with the ⚑
    // two lines; the full answer text is demoted to detail logging") — the
    // mechanism half; the ledger booking stays there.
    const { own, drive, fx } = setup({ opts: { waitAnswer: 5 } })
    const fallback = autoAnswer(false)
    await expect(drive(ev.question(SESSION, "q1", Q1))).resolves.toBe("consumed")
    expect(fx.lines).toEqual([`❓ received a non-permission question:\n${Q1}`, `⚑ auto-answer (AUTO-RESOLVE) #1: ${Q1}`, "  → answered; asking the session to label the decision with AUTO-RESOLVE"])
    expect(fx.vlogs).toEqual([`  answer content: ${fallback}`])
    expect(fx.lines.some((line) => line.startsWith("→ auto answer"))).toBe(false)
    expect(own.resolves).toEqual([{ at: 0, question: Q1, session: SESSION }])
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [[fallback]] }])
    expect(fallback).toContain("AUTO-RESOLVE")
  })

  test("the answer wording follows the run's switches, not the process memo: ask=on records in full and the fallback asks for no marking", async () => {
    // The switches snapshot is frozen in the turn's context when the turn
    // starts; the injected set decides the wording with no process-memo read
    // involved.
    const { own, drive, fx } = setup({ opts: { waitAnswer: 5 }, switches: parseSwitches({ [SWITCH_ENV.ask]: "on" }) })
    const fallback = autoAnswer(true)
    await expect(drive(ev.question(SESSION, "q1", Q1))).resolves.toBe("consumed")
    expect(fx.lines).toEqual([`❓ received a non-permission question:\n${Q1}`, `⚑ auto-answer (AUTO-RESOLVE) #1: ${Q1}`, "  → answered; the driver recorded it in full; this mode does not require the session to label it separately"])
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [[fallback]] }])
    expect(fallback).not.toContain("AUTO-RESOLVE")
    expect(own.resolves).toHaveLength(1)
  })

  test("two different questions in one turn: the ⚑ counter increments and both resolves are recorded", async () => {
    // Re-homed from test/watch.test.ts ("two different questions in one
    // turn: the count increments …") — the counter mechanism; the ledger
    // bucketing stays there.
    const { own, drive, fx } = setup({})
    await drive(ev.question(SESSION, "q1", Q1))
    await drive(ev.question(SESSION, "q2", Q2))
    expect(fx.lines.filter((line) => line.startsWith("⚑"))).toEqual([`⚑ auto-answer (AUTO-RESOLVE) #1: ${Q1}`, `⚑ auto-answer (AUTO-RESOLVE) #2: ${Q2}`])
    expect(own.resolves.map((item) => item.question)).toEqual([Q1, Q2])
    // No --wait-answer: the default mode answers at once, no human is asked.
    expect(fx.humanAsks).toEqual([])
  })

  test("a permission-worded question under --wait-answer is waitable: the wait path applies to it too", async () => {
    const { own, drive, fx } = setup({ opts: { waitAnswer: 5 }, human: "go ahead" })
    await expect(drive(ev.question(SESSION, "q1", PERMISSION_Q))).resolves.toBe("consumed")
    expect(fx.lines[0]).toBe(`❓ received a permission question:\n${PERMISSION_Q}`)
    expect(fx.lines[1]).toBe("→ human answer: go ahead")
    expect(own.resolves).toEqual([])
  })

  test("a repeat after the fallback blocks: reject, abort, the settle naming the repeat", async () => {
    // Re-homed from test/watch.test.ts ("a repeated question blocks … the
    // second is not booked again") — the repeat-block mechanism; the ledger
    // stays there.
    const { own, drive, fx } = setup({})
    await drive(ev.question(SESSION, "q1", Q1))
    await expect(drive(ev.question(SESSION, "q2", Q1))).resolves.toEqual({
      settle: { kind: "blocked", question: `asked again about the same question after auto-answer; handle it manually outside the session, then re-run:\n${Q1}` },
    })
    expect(fx.questionRejects).toEqual(["q2"])
    expect(fx.calls).toContain("abort")
    expect(own.resolves).toHaveLength(1)
  })
})

describe("the questions concern (question: the default block)", () => {
  test("a permission-worded question with no --wait-answer blocks outright with the raw question text", async () => {
    const { drive, fx } = setup({})
    await expect(drive(ev.question(SESSION, "q1", PERMISSION_Q))).resolves.toEqual({ settle: { kind: "blocked", question: PERMISSION_Q } })
    expect(fx.calls).toEqual(["rejectQuestion", "abort"])
    expect(fx.humanAsks).toEqual([])
  })
})

describe("the questions concern (question: the dryrun preflight)", () => {
  test("the preflight auto-answers every question, never blocking and never proxy-answering", async () => {
    // Re-homed from test/watch.test.ts ("dryrun preflight session: the
    // auto-answer happens as usual but is not counted") — the mechanism
    // half; the ledger stays there.
    const { own, drive, fx } = setup({ opts: { dryrun: true } })
    const fallback = autoAnswer(false)
    await expect(drive(ev.question(SESSION, "q1", Q1))).resolves.toBe("consumed")
    expect(fx.lines).toEqual([`❓ received a non-permission question:\n${Q1}`, `→ auto answer: ${fallback}`])
    expect(fx.humanAsks).toEqual([])
    expect(own.resolves).toEqual([])
    expect(fx.questionReplies).toEqual([{ request: "q1", answers: [[fallback]] }])
  })

  test("a permission-worded question is auto-answered too under the preflight (the dryrun forces the permission reading off)", async () => {
    const { own, drive, fx } = setup({ opts: { dryrun: true } })
    await expect(drive(ev.question(SESSION, "q1", PERMISSION_Q))).resolves.toBe("consumed")
    expect(fx.questionReplies).toHaveLength(1)
    expect(fx.questionRejects).toEqual([])
    expect(fx.calls).not.toContain("abort")
    expect(own.resolves).toEqual([])
  })
})

describe("the questions concern (permission: the dryrun deny and the modes)", () => {
  test("the dryrun preflight denies without interrupting: the 🔐 line, reject, consumed", async () => {
    const { drive, fx } = setup({ opts: { dryrun: true } })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.lines).toEqual(["🔐 preflight probe denied (recorded in the report): bash (rm -rf build)"])
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "reject" }])
    expect(fx.calls).not.toContain("abort")
  })

  test("auto-allow approves immediately, no human waited for", async () => {
    const { drive, fx } = setup({ opts: { permission: "auto-allow" } })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.lines).toEqual(["🔐 permission request received; auto-allowed via --permission auto-allow: bash (rm -rf build)"])
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "always" }])
    expect(fx.humanAsks).toEqual([])
  })

  test("the default mode is ask-deny: with --wait-answer unset the not-waiting line names it and the timeout fallback denies, the session continues", async () => {
    const { drive, fx } = setup({})
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.lines).toEqual([
      "🔐 permission request received (--wait-answer unset, not waiting for a human; handled as --permission ask-deny): bash (rm -rf build)",
      "→ wait timed out; --permission ask-deny auto-denied (the AI continues without it): bash (rm -rf build)",
    ])
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "reject" }])
    expect(fx.humanAsks).toEqual([])
    expect(fx.calls).not.toContain("abort")
  })

  test("ask-allow's timeout fallback auto-allows", async () => {
    const { drive, fx } = setup({ opts: { permission: "ask-allow" } })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.lines[0]).toContain("handled as --permission ask-allow")
    expect(fx.lines[1]).toBe("→ wait timed out; --permission ask-allow auto-allowed: bash (rm -rf build)")
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "always" }])
  })

  test("ask-fail denies, aborts and blocks with the opencode.json guidance", async () => {
    const { drive, fx } = setup({ opts: { permission: "ask-fail" } })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toEqual({
      settle: {
        kind: "blocked",
        question: "permission request unanswered (--permission ask-fail): bash (rm -rf build). Allow it in the permission rules of the target directory's opencode.json, then re-run.",
      },
    })
    expect(fx.calls).toEqual(["log", "replyPermission", "abort"])
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "reject" }])
  })

  test("a human allow under ask-*: the approval wording grants (always)", async () => {
    const { drive, fx } = setup({ opts: { permission: "ask-deny", waitAnswer: 5 }, human: "allow" })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.humanAsks).toEqual([
      { timeoutMin: 5, hint: "enter allow/yes/y to approve; any other answer denies the permission and continues; on timeout handled as --permission ask-deny" },
    ])
    expect(fx.lines).toEqual(["🔐 permission request received: bash (rm -rf build)", "→ human allowed: allow (always)"])
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "always" }])
  })

  test("a human deny under ask-*: any non-approval answer denies without interrupting", async () => {
    const { drive, fx } = setup({ opts: { permission: "ask-allow", waitAnswer: 5 }, human: "not this one" })
    await expect(drive(ev.permission(SESSION, "p1", "bash", "rm -rf build"))).resolves.toBe("consumed")
    expect(fx.lines[1]).toBe("→ human denied: not this one (permission denied; the AI continues without it)")
    expect(fx.permissionReplies).toEqual([{ request: "p1", reply: "reject" }])
    expect(fx.calls).not.toContain("abort")
  })
})

describe("the questions concern (its cells are the question and permission rows alone)", () => {
  test("any other input passes untouched", async () => {
    const { drive, fx } = setup({})
    await expect(drive(ev.idle(SESSION))).resolves.toBe("pass")
    await expect(drive(ev.text(SESSION, "pt_1", "working"))).resolves.toBe("pass")
    expect(fx.calls).toEqual([])
  })
})
