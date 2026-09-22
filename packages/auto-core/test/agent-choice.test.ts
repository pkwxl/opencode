// Coding agent selection (M6.1, src/agent-choice.ts): shell profile >
// OPENCODE_AUTO_AGENT > project config `agent` > opencode.
import { afterEach, describe, expect, test } from "bun:test"
import { chooseAgent } from "../src/agent-choice"
import { claudeHost } from "../src/agent/claude/host"
import type { AgentHostFactory } from "../src/agent/types"
import { setShellProfile } from "../src/shell"
import { autoSwitches, clampSwitches } from "../src/switches"

const envAgent = autoSwitches().agent

afterEach(() => {
  setShellProfile({ agent: undefined })
  clampSwitches({ agent: envAgent })
})

describe("chooseAgent", () => {
  test("nothing set = the built-in opencode adapter; config claude picks the claude host", () => {
    clampSwitches({ agent: undefined })
    expect(chooseAgent(undefined)).toBeUndefined()
    expect(chooseAgent("opencode")).toBeUndefined()
    expect(chooseAgent("claude")).toEqual({ name: "claude", host: claudeHost })
  })

  test("OPENCODE_AUTO_AGENT overrides the config either way", () => {
    clampSwitches({ agent: "opencode" })
    expect(chooseAgent("claude")).toBeUndefined()
    clampSwitches({ agent: "claude" })
    expect(chooseAgent(undefined)).toEqual({ name: "claude", host: claudeHost })
  })

  test("a shell profile's agent overrides both", () => {
    const host: AgentHostFactory = async () => {
      throw new Error("not started in this test")
    }
    setShellProfile({ agent: { name: "custom", host } })
    clampSwitches({ agent: "claude" })
    expect(chooseAgent("claude")).toEqual({ name: "custom", host })
  })
})
