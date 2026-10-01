// Unit tests for src/execute.ts runSubtask's artifact shape check
// (D2/D4/D6) and src/doccheck.ts (session-boundary-hardening design
// §4.3/§4.6, S3/S3c): zero-write → re-prompt → still zero → blocked; checklist
// missing/truncated → the same loop; the whole-unit document terminator scan
// (eof no longer on the last line after an edit → intercepted, the exemption
// list, undeclared side documents); every shape check passes → the normal
// tick; dryrun/testHandover exempt. Runs the full runSubtask chain (fake
// client + a real git repository); the scripts that write on the AI's behalf
// live in the event-stream generator (the same wiring as session.test.ts's
// handoverStream).

import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { opencodeAgent } from "../src/agent/opencode/client"
import type { SessionChain } from "../src/chain"
import { docShapeProblems, endsWithEof, EOF_MARK, MIN_DOC_CHARS, shapeCheckOn } from "../src/doccheck"
import { eofScanExempt } from "../src/document/roles"
import { runSubtask } from "../src/execute"
import { unitBaseline, unitChangedFiles } from "../src/git"
import type { Opts } from "../src/opts"
import { reloadUnits, seedUnits } from "./fixtures/units"
import { fakeClient, freshRepo, git } from "./fixtures/runner"

const BODY = "investigate and write the record Artifacts: docs/T-001/S01/record.md"

// A clean git repo + a committed task unit (subtasks.md with an item that
// declares its artifact) and a README; tmp/ and .auto/ are ignored per
// loop-preflight's ensureGitignore basis, so stats writes never pollute the
// clean gate.
async function shapeRepo(item: string = BODY): Promise<string> {
  const dir = await freshRepo()
  await Bun.write(join(dir, ".gitignore"), "tmp/\n.auto/\n")
  await Bun.write(join(dir, "README.md"), "# Sample\n\nBackground notes.\n")
  await seedUnits(dir, `## T-001: sample task [in_progress]\n\n- [ ] ${item}\n`)
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

// A fresh document that is non-trivial and ends with the terminator on the
// last line (the filler wording avoids the section names, keeping the
// section-anchor cases distinct).
const filler = "Placeholder filler material. ".repeat(30)
const properDoc = `# Record\n\n${filler}\n\n${EOF_MARK}\n`

describe("doccheck pure functions (non-trivial + last-line terminator)", () => {
  test("endsWithEof: the terminator alone on the last line (trailing blank lines and in-line whitespace tolerated; any body after it fails)", () => {
    expect(endsWithEof(`# Title\n\nBody\n${EOF_MARK}`)).toBe(true)
    expect(endsWithEof(`# Title\n\nBody\n${EOF_MARK}\n\n`)).toBe(true)
    expect(endsWithEof(`# Title\n\nBody\n ${EOF_MARK} \n`)).toBe(true)
    expect(endsWithEof(`# Title\n\nBody`)).toBe(false)
    expect(endsWithEof(`${EOF_MARK}\nappended after the terminator\n`)).toBe(false)
    expect(endsWithEof("")).toBe(false)
  })

  test("docShapeProblems: too short and missing terminator are separate findings; the threshold boundary just passes", () => {
    expect(docShapeProblems(properDoc, "docs/a.md")).toEqual([])
    const atThreshold = `# T\n\n${"x".repeat(MIN_DOC_CHARS)}\n${EOF_MARK}\n`
    expect(docShapeProblems(atThreshold, "docs/a.md")).toEqual([])
    const stub = `# T\n\n(omitted)\n${EOF_MARK}\n`
    expect(docShapeProblems(stub, "docs/a.md")).toEqual([`docs/a.md: content too short (${stub.trim().length} chars < threshold ${MIN_DOC_CHARS}), suspected stub or truncation`])
    const long = `# T\n\n${filler}\n`
    expect(docShapeProblems(long, "docs/a.md")).toEqual([`docs/a.md: missing last-line terminator (the last line of body text must be ${EOF_MARK})`])
  })

  test("shapeCheckOn: off under dryrun / an empty baseline (non-git, or the no-commit double) / a testHandover finish", () => {
    const baseline = [{ root: "/x", sha: "abc1234" }]
    expect(shapeCheckOn({}, baseline, false)).toBe(true)
    expect(shapeCheckOn({ dryrun: true }, baseline, false)).toBe(false)
    expect(shapeCheckOn({}, undefined, false)).toBe(false)
    expect(shapeCheckOn({}, [], false)).toBe(false)
    expect(shapeCheckOn({}, baseline, true)).toBe(false)
  })

  test("eofScanExempt: driver state files / the phase index / .auto/ / the handover document family are exempt; ordinary documents are not", () => {
    for (const rel of [
      "opencode.json",
      "docs/R-01/phases.md",
      ".auto/state.md",
      "docs/T-001/handoff.md",
      "docs/T-001/testhandoff.md",
      "docs/T-001/testhandoff-2.md",
      "docs/T-001/S01/testhandoff.md",
    ]) {
      expect(eofScanExempt(rel), rel).toBe(true)
    }
    // Retired layouts carry no exemption any more (M3.7): PLAN.md and the old flat handoff names are plain files.
    for (const rel of ["docs/T-001/report.md", "docs/T-001/S01/record.md", "README.md", "docs/notes.md", "PLAN.md", "docs/T-001.testhandoff.md"]) {
      expect(eofScanExempt(rel), rel).toBe(false)
    }
  })
})

describe("runSubtask artifact shape check (D2/D4)", () => {
  test("zero-write: one re-prompt (the feedback restates the authoritative state), still zero → blocked, not ticked", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await reloadUnits(dir)
      const opts: Opts = { dir }
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, opts, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("zero disk writes")
      expect(calls.prompts.length).toBe(2)
      // The feedback restates the authoritative state (L1) and names the misjudgment directly
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("T-001.S01")
      expect(feedback).toContain("S01 is not ticked yet")
      expect(feedback).toContain("do not judge this subtask complete on that basis")
      // Not ticked, not advanced
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("declared artifact missing (other writes exist, so not a zero-write): fixed after the re-prompt → ticked normally", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          // Side documents fall under the same D6 whole-unit scan (must be non-trivial + end with the last-line terminator).
          await Bun.write(join(dir, "docs/notes.md"), `# Side notes\n\n${filler}\n\n${EOF_MARK}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("declared artifact docs/T-001/S01/record.md does not exist")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fresh document missing the last-line terminator (content non-trivial): fixed after the re-prompt → ticked", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("missing last-line terminator")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fresh document is a stub (has the terminator but too short) and stays unfixed → blocked naming the failed item", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\n(omitted)\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain("content too short")
      expect(calls.prompts.length).toBe(2)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("declared required sections missing → the same loop; ticked once fixed", async () => {
    const body = "write the record Artifacts: docs/T-001/S01/record.md(background, conclusions)"
    const dir = await shapeRepo(body)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\nbackground: see the body.\nconclusions: as above.\n${filler}\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, body, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain('is missing section "background"')
      expect(feedback).toContain('is missing section "conclusions"')
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("all shape checks pass: one session, ticked normally, unified commit with the baseline", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
      // The unit close-out commit happened and carries the Auto-Stage trailer
      const message = await git(dir, "log", "-1", "--format=%B")
      expect(message).toContain("Auto-Stage: subtask 1")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("modify-type declared artifact (already tracked): existence always holds, but the D6 whole-unit scan still applies — rewritten without the terminator → fixed after the re-prompt → ticked", async () => {
    const body = "update the notes Artifacts: README.md"
    const dir = await shapeRepo(body)
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "README.md"), "# Sample\n\nBackground notes.\nOne added line.\n")
        },
        async () => {
          await Bun.write(join(dir, "README.md"), `# Sample\n\nBackground notes.\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, body, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // D4 existence always holds (no "declared artifact … does not exist"); D6 catches the modified document on non-trivial + last-line terminator
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).not.toContain("declared artifact README.md does not exist")
      expect(feedback).toContain("README.md")
      expect(feedback).toContain("missing last-line terminator")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("dryrun: a zero-artifact natural finish skips the shape check, ticked as usual", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([async () => {}])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, dryrun: true }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// The shape-check re-prompt forks the original session (revised 2026-09-18,
// kernel-spi-nor T-030 S13 field incident): the re-prompt is dispatched on a
// fork copy of the just-ended session and carries only the shape-check
// feedback itself (the copy already holds the full prompt and the whole
// working context); when a fork is unavailable it falls back to a fresh
// session + the full prompt + the feedback.
describe("runSubtask shape-check re-prompt continues on a fork", () => {
  test("fork succeeds: the re-prompt carries only the shape-check feedback (no full subtask prompt resent), ticked once fixed", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      // The re-prompt session = a fork copy of the original session, carrying only the feedback (no subtask body / full prompt).
      expect(calls.forks).toEqual(["ses_new_1"])
      expect(calls.prompts.length).toBe(2)
      expect(calls.prompts[1]!.sessionID).toBe("ses_fork_1")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(feedback).toContain("missing last-line terminator")
      expect(feedback).not.toContain("investigate and write the record")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("fork fails: falls back to a fresh session + the full prompt + the feedback (same behavior as before the revision)", async () => {
    const dir = await shapeRepo()
    try {
      const { sdk, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), `# Record\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
        },
      ])
      // The fork route is unavailable (old server / session gone) → forkSession falls back to undefined.
      const stubbed = opencodeAgent({
        ...sdk,
        session: { ...sdk.session, fork: async () => ({ error: { message: "no fork" } }) },
      } as unknown as OpencodeClient)
      const plan = await reloadUnits(dir)
      const result = await runSubtask(stubbed, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      // The fresh session resends the full prompt (with the subtask body) + the feedback.
      expect(calls.prompts[1]!.sessionID).toBe("ses_new_2")
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("investigate and write the record")
      expect(feedback).toContain("artifacts did not pass the shape check")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("runSubtask whole-unit document terminator scan (D6)", () => {
  test("an undeclared side document truncated (fresh, missing the terminator): intercepted, ticked once fixed", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "docs/notes.md"), `# Side analysis\n\n${filler}\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/notes.md"), `# Side analysis\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/notes.md")
      expect(feedback).toContain("missing last-line terminator")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an existing document edited so the terminator is no longer last (body appended after the terminator): intercepted, ticked once the last-line terminator is restored", async () => {
    const dir = await shapeRepo()
    try {
      // The existing document carries the terminator; the session's mid-flight rewrite appends body after it = the truncation shape
      await Bun.write(join(dir, "docs/existing.md"), `# Existing\n\n${filler}\n\n${EOF_MARK}\n`)
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "existing")
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "docs/existing.md"), `# Existing\n\n${filler}\n\n${EOF_MARK}\n\n## Addition\n\nFollow-up content.\n`)
        },
        async () => {
          await Bun.write(join(dir, "docs/existing.md"), `# Existing\n\n${filler}\n\n## Addition\n\nFollow-up content.\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain("docs/existing.md")
      expect(feedback).toContain("missing last-line terminator")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the exempt document family (handoff/testhandoff/driver state files) is unaffected: everything passes, normal close-out", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          // Files on the exemption list are short and carry no terminator — they must not trigger the shape check
          await Bun.write(join(dir, "docs/T-001/handoff.md"), "# Handover\n\nStatus: continue\n")
          await Bun.write(join(dir, "docs/T-001/testhandoff-1.md"), "# Test-handover archive\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a document already booked by a driver commit during the unit is scanned too (the baseline..worktree basis)", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          // Simulates a driver commit at a handover boundary: the document was
          // booked mid-unit (missing the terminator); the worktree's
          // changedFiles cannot see it, the baseline diff must still fish it out
          await Bun.write(join(dir, "docs/committed.md"), `# Booked doc\n\n${filler}\n`)
          await git(dir, "add", "-A")
          await git(dir, "commit", "-q", "-m", "mid-unit\n\nAuto-Stage: subtask 1")
        },
        async () => {
          await Bun.write(join(dir, "docs/committed.md"), `# Booked doc\n\n${filler}\n\n${EOF_MARK}\n`)
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      expect(promptText(calls.prompts[1]!)).toContain("docs/committed.md")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("unitChangedFiles (the D6 basis)", () => {
  test("baseline..worktree: committed changes / unstaged modifications / untracked new files all listed; deletions excluded", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "a.md"), "a\n")
      await Bun.write(join(dir, "b.md"), "b\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "init")
      const baseline = await unitBaseline(dir)
      await Bun.write(join(dir, "c.md"), "c\n")
      await git(dir, "add", "c.md")
      await git(dir, "commit", "-q", "-m", "mid")
      await Bun.write(join(dir, "a.md"), "a\nedited\n")
      await Bun.write(join(dir, "d.md"), "d\n")
      await rm(join(dir, "b.md"))
      const files = await unitChangedFiles(dir, baseline)
      expect(files).toEqual(new Set(["a.md", "c.md", "d.md"]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an empty baseline (non-git / gate off) returns the empty set", async () => {
    expect(await unitChangedFiles(join(tmpdir(), "nonexistent-dir"), [])).toEqual(new Set())
  })
})

describe("runSubtask P1 prohibition scan (M2.3)", () => {
  test("a process-document path added to a deliverable file: re-prompt, removed → ticked; a pre-existing one is not blamed", async () => {
    const dir = await shapeRepo()
    try {
      // Pre-existing reference in a tracked file: outside the unit's scope.
      await Bun.write(join(dir, "src/old.c"), "// legacy note: docs/T-000/report.md\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-q", "-m", "legacy")
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "src/a.c"), "// layout: see docs/T-001/S01/record.md\nint a;\n")
          await Bun.write(join(dir, "src/old.c"), "// legacy note: docs/T-000/report.md\nint touched;\n")
        },
        async () => {
          await Bun.write(join(dir, "src/a.c"), "// layout: a 64-entry ring, head at index 0\nint a;\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(2)
      const feedback = promptText(calls.prompts[1]!)
      expect(feedback).toContain('src/a.c:1 references "docs/T-001/S01/record.md"')
      expect(feedback).toContain("restate the needed content in place")
      expect(feedback).not.toContain("src/old.c")
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scan exemptions (config scanExempt, plans/0059 X2): an exempted fixture may hold process paths and terminator-free Markdown; one session, ticked", async () => {
    const dir = await shapeRepo()
    try {
      const { client, calls } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "test/fixtures/report.md"), "# Fixture\n\nA sample report pointing at docs/T-004/report.md and .auto/units.json.\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir, scanExempt: ["test/fixtures"] }, makeChain())
      expect(result).toBeUndefined()
      expect(calls.prompts.length).toBe(1)
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("the reference stays after the re-prompt → blocked, not ticked", async () => {
    const dir = await shapeRepo()
    try {
      const { client } = scriptedClient([
        async () => {
          await Bun.write(join(dir, "docs/T-001/S01/record.md"), properDoc)
          await Bun.write(join(dir, "README.md"), "# Sample\n\nBackground notes.\n\nStatus is tracked in .auto/units.json.\n")
        },
      ])
      const plan = await reloadUnits(dir)
      const result = await runSubtask(client, plan, plan.tasks[0]!, BODY, 1, { dir }, makeChain())
      expect(result).toMatchObject({ type: "blocked" })
      expect((result as { question: string }).question).toContain('README.md:5 references ".auto/units.json"')
      expect(((await reloadUnits(dir)).tasks[0]!.checklist ?? [])[0]!.done).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
