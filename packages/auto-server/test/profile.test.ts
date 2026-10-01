// The shell profile of the server shell (shell-contract §C.1): applied at
// entry startup, read back from the core — the profile is the shell's whole
// injection surface in this skeleton.
import { describe, expect, test } from "bun:test"
import { shellProfile } from "@opencode-ai/auto-core/shell"
import { applyServerProfile } from "../src/profile"

describe("server shell profile", () => {
  test("entry startup sets the server profile (startup recovery, full audit log)", () => {
    applyServerProfile()
    const profile = shellProfile()
    expect(profile.program).toBe("opencode-auto-server")
    expect(profile.bin).toBe("opencode-auto-server")
    // "startup", not "init": the server ships no interactive fix command, so
    // the core's recovery hints must not name one.
    expect(profile.agentRecovery).toBe("startup")
    // The service is unattended: the run log always records in full.
    expect(profile.auditLog).toBe(true)
  })
})
