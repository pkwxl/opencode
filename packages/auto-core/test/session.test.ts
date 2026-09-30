// Unit tests for src/session.ts (driven through runSession): the resumed
// takeover of the chain's recorded session, the error retry ladder, the
// wait-and-probe loop (non-retryable / ladder exhausted / candidates
// exhausted never exit), attempt's model-injection wiring, quota failover,
// failback scopes and the /failback override.
// Split out of test/runner.test.ts (plans/0024-module-split-plan.md S18, pure move).

import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import type { SessionChain } from "../src/chain"
import { recallHandover, saveHandover } from "../src/handover"
import type { Interactive } from "../src/interactive"
import { recallProgress, saveProgress } from "../src/resume"
import { attempt } from "../src/attempt"
import { noCommitGit } from "../src/git-ops"
import { runSession } from "../src/session"
import { services } from "../src/services"
import { parseSwitches, SWITCH_ENV } from "../src/switches"
import type { TestRun } from "../src/testrun"
import { task, fakeClient, modelThenIdle, retryClient, type Outcome } from "./fixtures/runner"
import { phaseTypeOfLetter, type PhaseLetter } from "../src/phases/registry"

const key = (letter: PhaseLetter) => ({ id: "R-01.P01", entry: phaseTypeOfLetter(letter) })

// ---- In-chain session takeover (interruption recovery's resumed; the reuse switch is retired) ----

describe("interruption-recovery takeover: the chain's recorded session takes the prompt (resumed)", () => {
  const NONE = parseSwitches({})

  test("◈ model announcement: not repeated when the recorded session is taken over (resumed) with the same model; announced for every new session", async () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      // No route set: the announcement comes from the model the server actually resolved, carried by a user message in the event stream.
      const fake = fakeClient({ current: "ses_new_1", events: (id) => modelThenIdle(id, "prov/default") })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(fake.client, task, "prompt text", {}, chain, undefined, undefined, NONE)
      // A takeover (the chain holds the session and a recovery note) continues the same session: no second announcement.
      chain.note = "[driver] continuation after interruption"
      await runSession(fake.client, task, "prompt text 2", {}, chain, undefined, undefined, NONE)
      // The note consumed, the next prompt falls back to the normal rule and opens a new session: announced once more (same model).
      await runSession(fake.client, task, "prompt text 3", {}, chain, undefined, undefined, NONE)
    } finally {
      console.log = orig
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("using model"))
    // Taking over the same session announces once; the new session after the note is consumed announces once more (same model).
    expect(shown.length).toBe(2)
    expect(shown[0]).toContain("prov/default")
    expect(shown[0]).toContain("server resolved")
  })

  test("chain holds a session and a note pending injection: re-enters the original session whatever the chain's figures; the note clears after use, the next prompt opens a new session", async () => {
    const { client, calls } = fakeClient({ current: "ses_interrupted" })
    const chain: SessionChain = {
      id: "ses_interrupted",
      pct: 80,
      used: 90_000,
      at: Date.now() - 10 * 60_000,
      note: "[driver] continuation after interruption",
    }
    expect((await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NONE)).type).toBe("idle")
    expect(calls.creates).toBe(0)
    expect(chain.id).toBe("ses_interrupted")
    expect(chain.note).toBeUndefined()
    // The recovery note is consumed: the next prompt falls back to the normal rule (a fresh session)
    expect((await runSession(client, task, "the next prompt", {}, chain, undefined, undefined, NONE)).type).toBe("idle")
    expect(calls.creates).toBe(1)
  })
})

// ---- Session error retry (plans/0015-session-error-retry-plan.md; since 2026-09-16 exhaustion no longer blocks) ----

describe("session error retry: isRetryable-driven fork-retry / wait-and-probe loop", () => {
  // Ladder fixture: two retries, zero waits, and the probe interval squeezed to zero as well (the wait-and-probe loop's rounds are instant in unit tests).
  const NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
  test("isRetryable:false: no longer blocks outright — waits, probes with a fresh temporary session, and after recovery forks the interrupted session and re-dispatches the task", async () => {
    // In order: the dispatch hits a fatal quota error → the probe is still fatal → the probe succeeds → the recovery re-dispatch succeeds.
    const { client, calls } = retryClient(["error-fatal", "error-fatal", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // Probes go through fresh temporary sessions (ses_new_2/3), never pushing probe rounds into the interrupted session (ses_new_1);
    // after recovery the task is re-dispatched from a forked copy of the interrupted session.
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(3)
    expect(calls.prompts.map((p) => p.sessionID)).toEqual(["ses_new_1", "ses_new_2", "ses_new_3", "ses_fork_1"])
    // The probe prompt is a minimal probe text, not the task prompt.
    for (const probe of [calls.prompts[1]!, calls.prompts[2]!]) {
      expect((probe.parts[0] as { text: string }).text).toContain("Service availability probe")
    }
    // The recovery re-dispatch lands on the forked copy, carrying a one-time recovery note.
    const text = (calls.prompts[3]!.parts[0] as { text: string }).text
    expect(text).toContain("prompt text")
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("service has recovered")
    expect(chain.note).toBeUndefined()
    expect(chain.id).toBe("ses_fork_1")
  })

  test("while probes keep failing: no fork, no task re-dispatch (every round is a fresh temporary session)", async () => {
    // Fatal → probe fatal ×2 → probe succeeds → recovery re-dispatch succeeds; the probe-failure rounds contain no fork or task re-dispatch at all.
    const { client, calls } = retryClient(["error-fatal", "error-fatal", "error-fatal", "ok", "ok"])
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts.length).toBe(5)
  })

  test("retryable error + chain.id already holds real accumulated context: retries by forking the original session, promoted to chain.id on success", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("forked-copy retry fails again: discards the copy and re-forks the same original session (not a fork of the failed copy)", async () => {
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real", "ses_real"])
    expect(chain.id).toBe("ses_fork_2")
  })

  test("chain.id empty from the start (the first message fails): nothing worth protecting, keeps the current behavior of opening a blank new session", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual([])
    expect(calls.creates).toBe(2)
  })

  // ---- Keep the most valuable session (provider-timeout-analysis-20260912.md §8.4) ----

  test("chain.id empty but the failed session has accumulated context (the subtask shape): forks the failed session itself, no blank session", async () => {
    // A subtask has a single prompt round, so at the moment of failure the chain necessarily holds no session — the old
    // strategy opened a blank new session here, throwing away the session's verified research wholesale and hitting the
    // same wall again at the same point after the restart.
    const { client, calls } = retryClient(["error-retryable", "ok"], [168_000], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.creates).toBe(1)
    expect(chain.id).toBe("ses_fork_1")
  })

  test("failed session's usage above the chain's original session: takes the failed session (value = accumulated context)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [50_000], "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1"])
  })

  test("wait-and-probe recovery carries over the failed session's prefix usage (recovered via probe after ladder exhaustion)", async () => {
    // Three failures in a row (50k usage per session) → ladder exhausted, enters wait-and-probe → probe succeeds → forks
    // the most valuable failed session (ses_fork_2, 50k) → the copy carries the prefix usage, and the 2×cap handover
    // threshold counts prefix + new work.
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok", "ok"], 50_000, "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(chain.used).toBe(50_000)
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(calls.creates).toBe(2)
  })

  test("failed session's usage below the chain's original session: still takes the original session (having just failed does not mean more valuable)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [800], "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
  })

  test("no session on the chain to fork but the fork base is alive: re-seeds from the base, regaining the warm prefix instead of a pure cold start", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0, forkBase: "ses_base" }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_base"])
    expect(calls.creates).toBe(1)
    expect(chain.forkBase).toBe("ses_base")
  })

  // The stub's contrast case (a 0-usage failed session never enters the fork
  // candidates, so the retry opens a blank new session) is the ladder
  // section's "chain.id empty from the start" case below — identical fixture
  // and inputs, asserting the same no-fork fact plus the blank session's
  // creates; it is not repeated here (one case per fact).

  test("chain.failed clears after a successful retry, leaving no residue into the next round", async () => {
    const { client } = retryClient(["error-retryable", "ok"], [9000], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(chain.failed).toBeUndefined()
  })

  test("forked copy dies at 0 tokens (repeated quota failures): does not displace the contentful failed session; every later round re-forks it instead", async () => {
    // 2026-09-17 virtio T-005 field incident: the post-handover continuation session reached 41.3k and hit repeated quota
    // failures — retry 1 forked the failed session (41.3k) and the copy died on dispatch (0 tokens); the old bookkeeping
    // displaced chain.failed with that 0-token copy, so from retry 2 on the failed-session reference was lost and it
    // degraded to base/blank cold seeding. After the fix: a 0-token error stub neither enters the candidates nor
    // displaces the record, and every retry round re-forks that 41.3k session.
    const LADDER3 = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], [41_300], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, LADDER3)
    expect(result.type).toBe("idle")
    // All three retries re-fork the original 41.3k failed session; no blank new session is opened.
    expect(calls.forks).toEqual(["ses_new_1", "ses_new_1", "ses_new_1"])
    expect(calls.creates).toBe(1)
    // Re-dispatches 2/3 are still judged "context complete": they only explain the re-dispatch, without the worktree-check note.
    for (const p of [calls.prompts[2]!, calls.prompts[3]!]) {
      const text = (p.parts[0] as { text: string }).text
      expect(text).toContain("being retried now")
      expect(text).not.toContain("git status")
    }
    expect(chain.failed).toBeUndefined()
  })

  test("forked copy produces content before failing again (used > 0): displaces the record normally (the copy is a strict superset of the old record)", async () => {
    // The copy carried the old prefix and produced new content on top, so its usage is larger at failure — the record
    // should move to the copy, and the next round forks the copy instead of going back to the old session.
    const LADDER3 = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "ok"], [41_300, 52_000], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, LADDER3)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1"])
    expect(calls.creates).toBe(1)
  })

  // ---- Retry notes: re-dispatching the same prompt must carry a one-time note ----
  // The two tiers are distinguished by "whether the session being taken over carries this attempt's context": forking the
  // failed session itself (context complete) only explains "the re-dispatch is not a repeated request"; falling back to a
  // blank new session / forking the original session (this attempt's already-written partial output is not in the new
  // session's context) must additionally guide checking the worktree, so the new session does not redo the half-finished
  // work from scratch — the same basis as the cross-run recovery resumeNote's worktree check.

  test("retry by forking the failed session itself: the re-dispatch carries a one-time note; with note and pending coexisting, what is taken over is the copy, not a reuse of the original session", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], 50_000, "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    // The failed session (50k) is worth more than the chain's original session (5k), so the fork comes from ses_new_1;
    // chain.id (the original session) is deliberately kept for the next retry's re-fork, hence note+id+pending all
    // coexist — what must be taken over is the pending copy.
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("prompt text")
    expect(text).toContain("being retried now")
    expect(text).not.toContain("git status")
    expect(chain.note).toBeUndefined()
  })

  test("failed session is a pure error stub, retry forks the original session: the original session lacks this attempt's context, so the worktree-check note is attached", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { id: "ses_real", pct: 10, used: 5000, at: Date.now() }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual(["ses_real"])
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
  })

  test("nothing forkmable on the chain, falls back to a blank new session: the re-dispatch carries the worktree-check note (the worktree may hold partial output)", async () => {
    const { client, calls } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.forks).toEqual([])
    expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
    expect(chain.note).toBeUndefined()
  })

  // ---- Retry ladder and wait-and-probe loop (provider-timeout-analysis-20260912.md §8.4) ----

  test("ladder count is decided by the number of elements in waits, no longer a hardcoded RETRIES", async () => {
    // 0,0,0 = three retries → four attempts including the first; only a fourth failure enters the wait-and-probe loop;
    // here the fourth succeeds, so probing never happens.
    const three = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, three)
    expect(result.type).toBe("idle")
    expect(calls.creates).toBe(4)
  })

  test("backoff truly waits: waits' minutes land on actual sleep", async () => {
    // 0.002 minutes = 120ms, enough to tell apart from a zero wait without slowing the test.
    const slow = parseSwitches({ [SWITCH_ENV.retryWaits]: "0.002", [SWITCH_ENV.recoveryWait]: "0" })
    const { client } = retryClient(["error-retryable", "ok"], [], "stream disconnected")
    const began = Date.now()
    const result = await runSession(client, task, "prompt text", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, slow)
    expect(result.type).toBe("idle")
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
  })

  test("the wait-and-probe loop's interval truly sleeps: recoveryWait's minutes land on actual sleep", async () => {
    // 0.002 minutes = 120ms; a fatal error goes straight to the wait-and-probe loop, and a successful probe recovers.
    const slow = parseSwitches({ [SWITCH_ENV.recoveryWait]: "0.002" })
    const { client } = retryClient(["error-fatal", "ok", "ok"])
    const began = Date.now()
    const result = await runSession(client, task, "prompt text", {}, { pct: 100, used: 0, at: 0 }, undefined, undefined, slow)
    expect(result.type).toBe("idle")
    expect(Date.now() - began).toBeGreaterThanOrEqual(100)
  })

  test("ladder exhausted: no longer waits for a human verdict, goes straight into the wait-and-probe loop (interactive is never asked)", async () => {
    // Three attempts exhaust the ladder → wait-and-probe (probe 1 still fails, probe 2 succeeds) → recovery re-dispatch succeeds.
    let asked = 0
    const silent: Interactive = {
      attach() {},
      question: async () => {
        asked++
        return undefined
      },
      close() {},
    }
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "error-fatal", "ok", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", { interactive: silent }, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(asked).toBe(0)
    // Three ladder attempts (all full task prompts) + two probes + one recovery re-dispatch = 6 dispatches.
    expect(calls.prompts.length).toBe(6)
    expect(calls.prompts.filter((p) => (p.parts[0] as { text: string }).text.includes("Service availability probe")).length).toBe(2)
  })

  test("waits=off: the first failure goes straight to the wait-and-probe loop, no ladder retries", async () => {
    const none = parseSwitches({ [SWITCH_ENV.retryWaits]: "off", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient(["error-retryable", "ok", "ok"], [], "stream disconnected")
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, none)
    expect(result.type).toBe("idle")
    // First failure → probe succeeds → blank new session re-dispatch (nothing forkmable on the chain), 3 dispatches total.
    expect(calls.prompts.length).toBe(3)
    expect(calls.forks).toEqual([])
  })

  test("session failures do not exit: create/dispatch failures and SDK-thrown exceptions enter the retry mechanism alike", async () => {
    // prompt throws on the first call (SDK layer), returns an error body on the second, succeeds on the third — all three
    // are "session failure" faces, retried uniformly, never escalating to blocked.
    let n = 0
    const { client, calls, sdk } = fakeClient()
    const raw = sdk as unknown as { session: { prompt: (p: unknown) => Promise<unknown> } }
    raw.session.prompt = async (p: unknown) => {
      calls.prompts.push(p as { sessionID: string; parts: unknown[] })
      n++
      if (n === 1) throw new Error("fetch failed: connection refused")
      if (n === 2) return { error: { name: "UnknownError" } }
      return {}
    }
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_WAIT)
    expect(result.type).toBe("idle")
    expect(calls.prompts.length).toBe(3)
    expect(calls.creates).toBe(3)
  })

  test("retryable intermediate failure states do not write progress.json and do not displace the earlier real record (during the wait likewise)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-"))
    try {
      const real: Awaited<ReturnType<typeof recallProgress>> = { task: "T-001", session: "ses_real_old", at: 1, active: true, phase: { kind: "decompose" } }
      await saveProgress(dir, real!)
      // Ladder 0,0: the first three attempts all fail retryably → enter wait-and-probe (probe 1 still fails).
      // Peek at progress.json the instant a probe session is established: it must still be the prior real record, not
      // displaced by any failed session's claim (the probe itself included).
      const seen: (string | undefined)[] = []
      const { client, sdk } = retryClient(["error-retryable", "error-retryable", "error-retryable", "error-fatal", "ok", "ok"], [], "stream disconnected")
      const raw = sdk as unknown as { session: { create: () => Promise<unknown> } }
      const origCreate = raw.session.create.bind(raw.session)
      raw.session.create = async () => {
        const made = await origCreate()
        seen.push((await recallProgress(dir, "T-001"))?.session)
        return made
      }
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "decompose" } }
      const result = await runSession(client, task, "prompt text", { dir }, chain, undefined, undefined, NO_WAIT)
      expect(result.type).toBe("idle")
      // When the probe sessions (create #4/#5) are established, the record is still the prior ses_real_old.
      expect(seen[3]).toBe("ses_real_old")
      expect(seen[4]).toBe("ses_real_old")
      // After the whole run: the record claims the session whose recovery re-dispatch succeeded (the probe-failure
      // round's blank new session, since nothing on the chain is forkmable), not any failed or probe session.
      expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_new_6")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("non-retryable failure: during the wait progress.json claims the interrupted session normally (it is the recovery point)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-remember-fatal-"))
    try {
      const seen: (string | undefined)[] = []
      const { client, sdk } = retryClient(["error-fatal", "error-fatal", "ok", "ok"])
      const raw = sdk as unknown as { session: { create: () => Promise<unknown> } }
      const origCreate = raw.session.create.bind(raw.session)
      raw.session.create = async () => {
        const made = await origCreate()
        seen.push((await recallProgress(dir, "T-001"))?.session)
        return made
      }
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "decompose" } }
      const result = await runSession(client, task, "prompt text", { dir }, chain, undefined, undefined, NO_WAIT)
      expect(result.type).toBe("idle")
      // After the first fatal failure, when the probe session is established: the record claims the interrupted session ses_new_1 (active).
      expect(seen[1]).toBe("ses_new_1")
      // After the recovery re-dispatch succeeds it claims the forked copy.
      expect((await recallProgress(dir, "T-001"))?.session).toBe("ses_fork_1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- Test-handover ending (fixed 2026-09-16): only sessions after the handover are reuse/retry-fork targets ----

describe("test-handover ending: the frozen session's task is complete, dropped as a reuse/fork anchor", () => {
  const NO_WAIT = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })

  // Drives one full test handover (--handover-test sequential state): context over limit + the AI requests a test (tmp/
  // test.sh) → freeze + wrap-up steer → the AI writes the handover document (Status: continue) → the session ends as
  // testHandover. The two steps that write files on the AI's behalf live in the event-stream generator, driving watch
  // with the same batch of events as the real chain.
  const handoverStream =
    (tmp: string, handoffFile: string) =>
    (sid: string): AsyncIterable<unknown> =>
      (async function* () {
        const msg = (id: string, input: number) => ({
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
        yield msg("m_limit", 2000)
        await Bun.write(join(tmp, "test.sh"), "echo ok")
        yield { type: "session.idle", properties: { sessionID: sid } }
        await Bun.write(handoffFile, "# Handover\n\nStatus: continue\n")
        yield msg("m_wrapup", 2100)
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()

  const makeDir = async (prefix: string) => {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    const tmp = join(dir, "tmp")
    const handoffFile = join(dir, "docs", "T-001", "S01", "testhandoff.md")
    return { dir, tmp, handoffFile }
  }

  const makeTest = (dir: string, tmp: string, handoffFile: string): TestRun => ({
    dir,
    tmp,
    handoffFile,
    handover: true,
    limit: 1000,
    seq: 0,
    task,
    unit: "subtask 1",
    subject: "T-001 S1 sample task",
    label: "T-001 S1",
    handovers: 0,
    startUsed: 0,
  })

  test("the handover ending does not claim the frozen session: progress moves to the no-session in-flight state, chain.id cleared", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-end-")
    try {
      const { client } = fakeClient({ events: handoverStream(tmp, handoffFile) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "subtasks", index: 1 } }
      const result = await runSession(client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("idle")
      expect((result as { testHandover?: boolean }).testHandover).toBe(true)
      // The frozen session's (here ses_new_1) task is complete: neither the chain nor the record claims it any more.
      // active stays (the unit is in flight: the recovery resume's clean exemption and the handover document's retention
      // depend on it); a missing session = no session to reuse, and recovery can only reconnect to the post-handover
      // session through handover.json's nextSession/frozen anchor.
      expect(chain.id).toBeUndefined()
      expect(await recallProgress(dir, "T-001")).toMatchObject({ task: "T-001", session: undefined, active: true, phase: { kind: "subtasks", index: 1 } })
      // The frozen anchor stays on record as usual (an interruption recovery with the wrap-up unfinished forks from it).
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ pinSession: "ses_new_1", pinMessage: "m_limit" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the continuation session hits a retryable error: ladder exhausted into wait-and-probe, the record still does not claim the old session, the restart-reuse target = the later session", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-retry-")
    try {
      // Part one: run one full test handover; the ending drops the frozen session (same as the previous case).
      const pin = fakeClient({ events: handoverStream(tmp, handoffFile) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0, phase: { kind: "subtasks", index: 1 } }
      const handedOver = await runSession(pin.client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect((handedOver as { testHandover?: boolean }).testHandover).toBe(true)
      // Simulates runExecSession's handover close-out (after archiving + commit #2 + running the script, the in-flight
      // record moves to the closed-out state: the script and the frozen anchor are voided, waiting for attempt to
      // backfill nextSession).
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1 })
      // Part two: the continuation session fails retryably in all three rounds (pure error stub, no context) → ladder
      // exhausted into wait-and-probe → probe succeeds → blank new session re-dispatch succeeds.
      const retry = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok", "ok"], [], "stream disconnected")
      const outcome = await runSession(retry.client, task, "continuation prompt", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(outcome.type).toBe("idle")
      // The retry/recovery fork sources exclude the frozen session (before the fix: chain.id was restored to the frozen
      // session, which by its full context became the preferred fork source, forking the continuation prompt back into
      // the pre-handover session).
      expect(retry.calls.forks).toEqual([])
      // Afterwards progress claims the continuation session whose recovery re-dispatch succeeded (ses_new_5), not any
      // pre-handover session.
      expect(await recallProgress(dir, "T-001")).toMatchObject({ session: "ses_new_5", active: true })
      // The in-flight handover record likewise claims the recovered continuation session: restart reuse forks back
      // through it, the target being the post-handover session.
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_new_5" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  // ---- nextSession's claim: "write on dispatch + revert on failure" (2026-09-17, virtio T-005 field incident) ----

  test("the continuation session dies at 0 tokens (pure error stub): withdraws the nextSession claim, the recovery anchor stays on the last contentful session", async () => {
    // Field incident: a 41.3k continuation session hit repeated quota failures; the retries' 0-token stubs overwrote
    // nextSession one by one, so a restart could only fork an empty shell. After the fix the stub's claim is reverted
    // and the anchor stays on the 41.3k session.
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-stub-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = retryClient(["error-retryable"], [], "stream disconnected")
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the continuation session fails with content (used > 0): keeps the claim, it becomes the new recovery anchor", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-content-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_old" })
      const { client } = retryClient(["error-retryable"], [41_300], "stream disconnected")
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      // The failed session with 41.3k of content is worth more than the old anchor (a strict superset); the claim is not reverted.
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_new_1" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the continuation session dies at 0 tokens and is non-retryable (isRetryable:false): the claim is withdrawn likewise (§J.3 completion)", async () => {
    // §J.3's revert initially covered only the retryable branch; a non-retryable 0-token error stub (e.g.
    // insufficient_quota on the very first dispatch) is equally unqualified as a recovery anchor — after the process is
    // force-quit inside the wait-and-probe loop, restart recovery can only fork from the previous anchor.
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-fatal-stub-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = retryClient(["error-fatal"])
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect((result as { retryable?: boolean }).retryable).toBe(false)
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the continuation session fails on dispatch (prompt.error): withdraws the claim — an empty session is unqualified as a recovery anchor", async () => {
    const { dir, tmp, handoffFile } = await makeDir("auto-handover-prompt-fail-")
    try {
      await saveHandover(dir, { task: "T-001", scope: relative(dir, handoffFile), unit: "subtask 1", n: 1, nextSession: "ses_contentful" })
      const { client } = fakeClient({ prompt: () => ({ error: { name: "UnknownError", data: { message: "boom" } } }) })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      const result = await attempt(client, task, "prompt text", { dir, git: noCommitGit() }, chain, undefined, makeTest(dir, tmp, handoffFile), NO_WAIT)
      expect(result.type).toBe("blocked")
      expect((result as { question: string }).question).toContain("task dispatch failed")
      expect(await recallHandover(dir, "T-001", relative(dir, handoffFile))).toMatchObject({ nextSession: "ses_contentful" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("attempt wiring: runSession includes/omits model per the injected policy (no dependency on the autoSwitches memo)", () => {
  test("letter match: opts.phase=m → anthropic/c-4 goes into prompt.model", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 } // No role/phase → bypass; letter m matches
    await runSession(client, task, "prompt text", { phase: key("m") }, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "m=anthropic/c-4,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "anthropic", modelID: "c-4" })
  })

  test("bypass role: chain.role=knowledge → role overrides the wildcard", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0, role: "knowledge" }
    await runSession(client, task, "prompt text", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.model]: "knowledge=kimi/k2-lite,*=kimi/k2" }))
    expect(calls.prompts[0]!.model).toEqual({ providerID: "kimi", modelID: "k2-lite" })
  })

  test("no policy set: no model key in the prompt parameters (byte-for-byte equivalent to the status quo)", async () => {
    const { client, calls } = fakeClient()
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text", { phase: key("m") }, chain, undefined, undefined, parseSwitches({}))
    expect("model" in calls.prompts[0]!).toBe(false)
  })
})

// ---- Quota failover (D.3/D.4, P4): runSession's failover branch + candidate clamping and exhaustion + the failover note ----
// Reuses fakeClient (over.events builds a targeted event stream by current session id, over.fork builds fork results),
// injecting only switches.model.fallback to drive the failover; candidate window clamping is asserted through an
// extended provider.list surface.
describe("quota failover (D.3/D.4): candidate switch keeps context / clamping skips / exhaustion enters the wait-and-probe loop", () => {
  const FAILOVER = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov/c", [SWITCH_ENV.recoveryWait]: "0" })
  // The n-th subscription (n from 1) emits a non-retryable quota session.error, then still emits idle so watch settles
  // normally; from the 2nd on, only idle. For "quota failure on the first round, success on the second".
  const quotaThenIdleEvents = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }
  // The first k subscriptions emit a non-retryable quota session.error (the candidates-exhausted scenario); afterwards
  // only idle (the service recovered, the probes will succeed).
  const quotaTimesThenIdleEvents = (k: number) => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n <= k) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("quota + two candidates: switches to the first candidate (prov/b), forks the first failed session to keep context, the failover note rides the second round's prompt to the AI", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // The first round carries no model (no routed primary set); the second carries the first failover candidate prov/b.
    expect("model" in calls.prompts[0]!).toBe(false)
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // Context migrates along: one fork was made of the first failed session (ses_new_1).
    expect(calls.forks).toContain("ses_new_1")
    // The failover note (one-time) was dispatched with the second round's prompt and cleared automatically.
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("Switched model")
    expect(chain.note).toBeUndefined()
    // The model-switched continuation lands on the forked session (ses_fork_1), not a blank new one.
    expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
  })

  test("failover fork fails and falls back to a blank new session: the failover note switches to the worktree-check version (a blank session has no preceding context to carry on)", async () => {
    const { client, calls } = fakeClient({
      events: quotaThenIdleEvents(),
      fork: () => ({ error: { name: "NotFound" } }),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // Fork fails → the second round lands on a newly created blank session (not a forked copy); the model switch still takes effect.
    expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    const text = (calls.prompts[1]!.parts[0] as { text: string }).text
    expect(text).toContain("Switched model")
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
    expect(chain.note).toBeUndefined()
  })

  test("no candidate list + recovery-period fork fails back to a blank new session: the recovery re-dispatch carries the worktree-check note likewise", async () => {
    const { client, calls } = fakeClient({
      events: quotaThenIdleEvents(),
      fork: () => ({ error: { name: "NotFound" } }),
    })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }))
    expect(result.type).toBe("idle")
    // Fatal error → wait-and-probe (probe succeeds) → forking the interrupted session fails → blank new session re-dispatch.
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts[2]!.sessionID).toBe("ses_new_3")
    const text = (calls.prompts[2]!.parts[0] as { text: string }).text
    expect(text).toContain("git status")
    expect(text).toContain("without redoing")
  })

  test("candidates exhausted (primary and both candidates all quota-limited): no longer blocks — the wait-and-probe loop waits for recovery, the probe keeps the last candidate, and after recovery it continues from a fork of the interrupted session", async () => {
    // The first 3 subscriptions hit quota (primary + prov/b + prov/c, one round each) → candidates exhausted →
    // wait-and-probe (the probe session runs prov/c) → probe succeeds → forks the last failed session (ses_fork_2) and
    // re-dispatches the task.
    const { client, calls } = fakeClient({ events: quotaTimesThenIdleEvents(3) })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, FAILOVER)
    expect(result.type).toBe("idle")
    // Model order: first round no model → prov/b → prov/c → (probe) no model →
    // (recovery re-dispatch) no model — the wait-and-probe loop takes the
    // registry form: the probe clears the list's first candidate (the
    // implicit registry's `default` entry, the agent's own model) and the
    // recovery re-dispatch continues on it.
    expect("model" in calls.prompts[0]!).toBe(false)
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect("model" in calls.prompts[3]!).toBe(false)
    expect("model" in calls.prompts[4]!).toBe(false)
    // The 4th dispatch is the probe (minimal prompt, fresh session); the 5th is the recovery re-dispatch (task prompt + recovery note).
    expect((calls.prompts[3]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    const text = (calls.prompts[4]!.parts[0] as { text: string }).text
    expect(text).toContain("prompt text")
    expect(text).toContain("service has recovered")
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(chain.model).toBeUndefined()
  })

  test("candidate window clamping: prov/b's context window < cap is skipped, the first effective switch is prov2/c with a sufficient window", async () => {
    const { sdk, calls } = fakeClient({ events: quotaThenIdleEvents() })
    // Extended provider surface: prov/b's window 1000 < the explicit cap 5000 (skipped), prov2/c's window 1_000_000 (usable).
    const clamped = opencodeAgent({
      ...sdk,
      provider: {
        list: async () => ({
          data: {
            all: [
              { id: "prov", models: { b: { limit: { context: 1000 } } } },
              { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } },
            ],
          },
        }),
      },
    } as unknown as OpencodeClient)
    const CLAMP = parseSwitches({ [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(clamped, task, "prompt text", { contextLimit: 5000 }, chain, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    // The selected failover candidate skipped prov/b (insufficient window) and took prov2/c directly.
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    // prov/b never appears as a dispatched model (proof it was skipped, not selected and then failed).
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("no candidate list: quota goes straight into the wait-and-probe loop (no model switch, prompt carries no model), continues from a fork of the interrupted session after recovery", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdleEvents() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, parseSwitches({ [SWITCH_ENV.recoveryWait]: "0" }))
    expect(result.type).toBe("idle")
    // No failover: no model key throughout; the single fork after the first round's failure is the recovery-period fork of the interrupted session.
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(calls.forks).toEqual(["ses_new_1"])
    expect(calls.prompts.length).toBe(3)
    expect((calls.prompts[1]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect((calls.prompts[2]!.parts[0] as { text: string }).text).toContain("prompt text")
  })
})

// ---- Failover failback scope (OPENCODE_AUTO_MODEL_FAILBACK_SCOPE) and the /failback override ----
// The scope decides when the primary is retried after a failover: task (default) = sticky within the chain (status quo);
// session = retry at every new session; phase = sticky across chains (across tasks) via the failback module's sticky
// holder, cleared at phase boundaries. /failback with arguments, once consumed, redefines the model order wholesale
// (primary wildcard + candidate ring) and, through the override layer, takes precedence over switches.model.
describe("failback scope and the /failback override: failback timing / cross-task stickiness / model-order redefinition / in-use model announcement", () => {
  const SCOPED = (scope: "task" | "session" | "phase") =>
    parseSwitches({ [SWITCH_ENV.model]: "prov/a", [SWITCH_ENV.modelFallback]: "prov/b", [SWITCH_ENV.modelFailbackScope]: scope })
  // The first subscription emits a non-retryable quota error, then idle (isomorphic to the previous group's
  // quotaThenIdleEvents, with its own counter to support the subscription numbering across multiple runSession calls on
  // the same client).
  const quotaThenIdle = () => {
    let n = 0
    return (sid: string) =>
      (async function* () {
        n++
        if (n === 1) yield { type: "session.error", properties: { sessionID: sid, error: { name: "APIError", data: { message: "insufficient_quota", isRetryable: false } } } }
        yield { type: "session.idle", properties: { sessionID: sid } }
      })()
  }

  test("default task scope: the failover stays sticky within the same chain — the second runSession (same chain) still uses candidate prov/b (status quo unchanged)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text", {}, chain, undefined, undefined, SCOPED("task"))
    expect(chain.model).toBe("prov/b")
    await runSession(client, task, "prompt text 2", {}, chain, undefined, undefined, SCOPED("task"))
    // The third prompt (the second runSession's first round) still carries the failover candidate.
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
  })

  test("session scope: retries the primary prov/a at the start of a new session (the failover fork's migrated session is not undone)", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text", {}, chain, undefined, undefined, SCOPED("session"))
    // The migrated session forked out by the failover still uses candidate prov/b (not zeroed at the fork consumption point, to prevent oscillation).
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(chain.model).toBe("prov/b")
    // Second runSession: reuse off → a brand-new create; at the start the
    // marks clear and the route resets back to primary prov/a (the new pick
    // writes the entry's model onto the chain).
    await runSession(client, task, "prompt text 2", {}, chain, undefined, undefined, SCOPED("session"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "a" })
    expect(chain.model).toBe("prov/a")
    expect(chain.modelEntry).toBe("prov/a")
  })

  test("phase scope: the failover stays sticky across chains via the down marks (simulating the next task's new chain); after the phase boundary's mark clear it returns to the primary", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text", {}, chain, undefined, undefined, SCOPED("phase"))
    // The primary's mark is what the phase scope keeps across tasks (the
    // down marks subsume the retired sticky holder, plans/0055 §6.4).
    expect(services().router.isModelDown("prov/a", Date.now())).toBe(true)
    // New chain (next task): no chain.model on it; the marked-down primary is skipped, prov/b still picks.
    const next: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text 2", {}, next, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[2]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // Phase-boundary clear (every scope covers it): the chain after that returns to primary prov/a.
    services().router.clearDownMarks("phase", "phase")
    const third: SessionChain = { pct: 100, used: 0, at: 0 }
    await runSession(client, task, "prompt text 3", {}, third, undefined, undefined, SCOPED("phase"))
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "a" })
  })

  test("/failback override with arguments: primary prov/x + candidate ring prov/y; with no env fallback set, failover still happens through the override ring", async () => {
    const { client, calls } = fakeClient({ events: quotaThenIdle() })
    services().router.requestFailback(["prov/x", "prov/y"])
    expect(services().router.consumeFailback()).toBe(true)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, parseSwitches({}))
    expect(result.type).toBe("idle")
    // The primary takes the override's wildcard (no route table set); after quota it fails over through the override ring to prov/y.
    expect(calls.prompts[0]!.model).toEqual({ providerID: "prov", modelID: "x" })
    expect(calls.prompts[1]!.model).toEqual({ providerID: "prov", modelID: "y" })
  })

  test("in-use model announcement: the ◈ line carries model and source, announced for every new session (same model included), not repeated on the same session", async () => {
    const lines: string[] = []
    const orig = console.log
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "))
    try {
      const { client } = fakeClient({ events: quotaThenIdle() })
      const chain: SessionChain = { pct: 100, used: 0, at: 0 }
      await runSession(client, task, "prompt text", {}, chain, undefined, undefined, SCOPED("task"))
      await runSession(client, task, "prompt text 2", {}, chain, undefined, undefined, SCOPED("task"))
    } finally {
      console.log = orig
    }
    const shown = lines.filter((line) => line.includes("◈") && line.includes("using model"))
    // The registry ◈ form (the implicit registry's entries carry the model
    // strings as their names): primary prov/a once + failover prov/b once;
    // the second runSession's model is unchanged (prov/b sticky) but reuse is
    // off and a new session opens — a new session always announces, so the
    // same model gets another line.
    expect(shown.length).toBe(3)
    expect(shown[0]).toContain("prov/a")
    expect(shown[0]).toContain("route bypass")
    expect(shown[1]).toContain("prov/b")
    expect(shown[2]).toContain("prov/b")
  })

  // The no-route ◈ form (the model the server actually resolved, observed
  // from the event stream, announced per new session and not repeated on a
  // takeover) is the takeover describe's first case — the same fake, the same
  // no-route switches; and a no-route dispatch carrying no model key is
  // pinned by the model-injection describe's "no policy set" case and the
  // no-candidate failover case. Neither fact is repeated here.
})

// ---- The post-ladder-exhaustion fallback joins the quota failover ring (T1): transient/unknown exhausts the ladder → switch candidate and continue ----
// Difference from the previous group: the trigger surface is not quota/auth/rate (those three switch models before the
// ladder) but the fallback branch after the retry ladder finishes (since 2026-09-16 it no longer waits for a human
// verdict). Uses retryClient: it queues events per session in create/fork order, faithfully simulating "every retry
// fails" while giving the failed sessions real usage.
describe("ladder-exhaustion fallback → candidate failover: switch models and restart a ladder round / candidates exhausted into the wait-and-probe loop", () => {
  // Zero-wait two-step ladder (first + two retries = three attempts) + zero-interval wait-and-probe + two candidates.
  const LADDER_FAILOVER = parseSwitches({
    [SWITCH_ENV.retryWaits]: "0,0",
    [SWITCH_ENV.recoveryWait]: "0",
    [SWITCH_ENV.modelFallback]: "prov/b,prov/c",
  })
  // Retryable (not marked isRetryable:false) ⇒ classified transient/unknown ⇒ not the quota branch, only the ladder.
  // Every session carries 50k usage: only a failed session with real context enters the fork candidates (0 usage is a
  // pure error stub, deliberately not kept), and that is exactly the asset this case protects.
  const TRANSIENT = "stream disconnected"
  const allFail = (n = 12) => Array<Outcome>(n).fill("error-retryable")

  test("ladder exhausted + fallback: switches to the first candidate (prov/b), forks the most valuable session with the failover note and continues, a fresh ladder round starts", async () => {
    // Three attempts all fail → fallback failover → the fourth succeeds with prov/b.
    const { client, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("idle")
    expect(calls.prompts.length).toBe(4)
    // The three in-ladder attempts carry no model (no routed primary set); after the failover the fourth carries the first candidate.
    for (const p of calls.prompts.slice(0, 3)) expect("model" in p).toBe(false)
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    // Context migrates along: the failover forks the previous round's failed session (50k usage; chain.id on the chain
    // was already restored to empty by attempt), rather than opening a blank new session.
    expect(calls.forks).toEqual(["ses_new_1", "ses_fork_1", "ses_fork_2"])
    expect(calls.creates).toBe(1)
    expect(calls.prompts[3]!.sessionID).toBe("ses_fork_3")
    // The one-time failover note was dispatched with that prompt and cleared; the text names the trigger.
    const text = (calls.prompts[3]!.parts[0] as { text: string }).text
    expect(text).toContain("[DRIVER]")
    expect(text).toContain("retry ladder exhausted")
    expect(text).toContain("Switched model")
    expect(chain.note).toBeUndefined()
    // chain.model rests on the effective candidate (scope: runTask creates a chain per task, so the next task
    // automatically returns to the primary model; no rollback logic needed).
    expect(chain.model).toBe("prov/b")
  })

  test("candidates exhausted (each candidate runs a full ladder round and still fails): no longer blocks — the wait-and-probe loop waits for recovery, then continues from a fork of the interrupted session", async () => {
    // Primary + two candidates each run a three-step ladder round (9 failures) → candidates exhausted → wait-and-probe
    // (probe succeeds) → forks the last failed session and the re-dispatch succeeds.
    const outcomes: Outcome[] = [...allFail(9), "ok", "ok"]
    const { client, calls } = retryClient(outcomes, 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, LADDER_FAILOVER)
    expect(result.type).toBe("idle")
    // 9 ladder attempts + 1 probe + 1 recovery re-dispatch = 11 dispatches.
    expect(calls.prompts.length).toBe(11)
    // The three ladder rounds' model order: no model → prov/b → prov/c; the
    // probe and the recovery re-dispatch take the registry form (the list's
    // first candidate, the implicit registry's `default` entry).
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov", modelID: "b" })
    expect(calls.prompts[6]!.model).toEqual({ providerID: "prov", modelID: "c" })
    expect("model" in calls.prompts[9]!).toBe(false)
    expect((calls.prompts[9]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect((calls.prompts[10]!.parts[0] as { text: string }).text).toContain("prompt text")
    expect("model" in calls.prompts[10]!).toBe(false)
    // The recovery re-dispatch lands on a forked copy of the interrupted session (the last failed session ses_fork_8,
    // 50k prefix); the probe goes through a fresh temporary session (the 2nd create).
    expect(calls.prompts[9]!.sessionID).toBe("ses_new_2")
    expect(calls.prompts[10]!.sessionID).toBe("ses_fork_9")
    expect(chain.model).toBeUndefined()
  })

  test("candidate window clamping applies here too: a candidate with an insufficient window is skipped, never dispatched as the fallback target", async () => {
    const { sdk: base, calls } = retryClient(["error-retryable", "error-retryable", "error-retryable", "ok"], 50_000, TRANSIENT)
    const clamped = opencodeAgent({
      ...base,
      provider: {
        list: async () => ({
          data: { all: [{ id: "prov", models: { b: { limit: { context: 1000 } } } }, { id: "prov2", models: { c: { limit: { context: 1_000_000 } } } }] },
        }),
      },
    } as unknown as OpencodeClient)
    const CLAMP = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0", [SWITCH_ENV.modelFallback]: "prov/b,prov2/c" })
    const result = await runSession(clamped, task, "prompt text", { contextLimit: 5000 }, { pct: 100, used: 0, at: 0 }, undefined, undefined, CLAMP)
    expect(result.type).toBe("idle")
    expect(calls.prompts[3]!.model).toEqual({ providerID: "prov2", modelID: "c" })
    expect(calls.prompts.some((p) => p.model?.providerID === "prov" && p.model?.modelID === "b")).toBe(false)
  })

  test("no candidate list: ladder exhaustion goes straight into the wait-and-probe loop (no model switch throughout), continues from a fork of the interrupted session after recovery", async () => {
    const NO_FAILOVER = parseSwitches({ [SWITCH_ENV.retryWaits]: "0,0", [SWITCH_ENV.recoveryWait]: "0" })
    const { client, calls } = retryClient([...allFail(3), "ok", "ok"], 50_000, TRANSIENT)
    const chain: SessionChain = { pct: 100, used: 0, at: 0 }
    const result = await runSession(client, task, "prompt text", {}, chain, undefined, undefined, NO_FAILOVER)
    expect(result.type).toBe("idle")
    // Three ladder attempts (no model) → probe → recovery re-dispatch; no model switch throughout.
    expect(calls.prompts.length).toBe(5)
    expect(calls.prompts.every((p) => !("model" in p))).toBe(true)
    expect(chain.model).toBeUndefined()
    expect((calls.prompts[3]!.parts[0] as { text: string }).text).toContain("Service availability probe")
    expect(calls.prompts[4]!.sessionID).toBe("ses_fork_3")
  })
})
