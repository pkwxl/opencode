// 0290 F4's wire pins (plans/0294): the per-kind serializer alone, detached
// from the coordinator — (b) the verify grant's budgetless wire (the share's
// clock rides `deadline`, the coordinator's ledger holding the budget the
// 0260 renewal reads — the site measured null against the heartbeat letter's
// documented derivation), and (d) the execute grant's landed context riding
// the re-grant over a unit with a landed share, the key itself absent on a
// fresh unit (never a null).
import { expect, test } from "bun:test"
import { wireStep } from "../src/executor-worker"

type Step = Parameters<typeof wireStep>[0]

test("the execute grant's landed context: carried over a landed share, the key absent on a fresh unit", () => {
  const execute = {
    kind: "execute" as const, id: "T-064 exec 2", unit: "T-064", title: "Task 64", prompt: "the whole-task brief",
    budget: 60, lease: "lease", deadline: 1, attempt: 1, workspace: "/w", answerCursor: null,
  }
  // A fresh unit: no landed share exists, the grant carries no context —
  // the byte-identical floor (the pre-change wire).
  expect(wireStep(execute)).not.toHaveProperty("landed")
  // The re-grant over a landed share: the prior share's id and its landing
  // commit ride the grant (0276's per-unit context discipline).
  const regrant = wireStep({ ...execute, landed: { id: "T-064 exec 1", commit: "07d4a27" } })
  expect(regrant.landed).toEqual({ id: "T-064 exec 1", commit: "07d4a27" })
  expect(regrant.budget).toBe(60)
})

test("the verify grant carries no budget — the clock rides deadline (the heartbeat letter's derivation)", () => {
  const verify = {
    kind: "verify" as const, id: "T-064 verify 1", unit: "T-064", title: "Task 64", prompt: "the wrap-up brief",
    budget: 60, lease: "lease", deadline: 1, attempt: 1, workspace: "/w", answerCursor: null,
    baseline: "base", head: "head", index: "docs/R-01/P01-implement/tasks.md",
  }
  const wire = wireStep(verify)
  // The coordinator stamps a budget on every grant (the ledger's own
  // renewal clock, 0260); the wire's follow-up arm omits it — the share
  // lives on `deadline` and the menu's renewed lease rows.
  expect(wire).not.toHaveProperty("budget")
  expect(wire.baseline).toBe("base")
  expect(wire.head).toBe("head")
  expect(wire.deadline).toBe(1)
})
