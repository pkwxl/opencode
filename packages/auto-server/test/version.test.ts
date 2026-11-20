// The build identity's pin (plans/0270, 0264-04's fix): the fingerprint the
// ready handshake carries and the serve banner prints comes from one home
// (src/version.ts), stamped at compile by script/build.ts over the declared
// AUTO_BUILD_COMMIT seam. This suite holds the three sides no e2e can:
// the assembly (the stamped shape and the honest dev fallback), the stamp
// computation's shape-checks (injection — no git, no build), and the define
// seam's both-sides names — the script's define key and the source's
// declared constant are two texts that must agree, so they are pinned to
// each other here (the 0203 pattern; the wire side is the e2e's).
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { BUILD_COMMIT, buildFingerprint, UNSTAMPED_COMMIT, VERSION } from "../src/version"
import { shortCommit, stampDefine } from "../script/build"

describe("build identity (plans/0270)", () => {
  test("the assembly: the version constant beside the commit — the stamped shape, and the source fallback", () => {
    // The stamped shape: whatever the build defines is carried verbatim.
    expect(buildFingerprint("abc1234")).toEqual({ version: VERSION, commit: "abc1234" })
    expect(buildFingerprint("deadbeefdead")).toEqual({ version: "0.0.0", commit: "deadbeefdead" })
    // Running from source (this suite), nothing was stamped: the fallback
    // names itself, never a fabricated commit — pinned on the wire by the e2e.
    expect(UNSTAMPED_COMMIT).toBe("dev")
    expect(BUILD_COMMIT).toBe("dev")
    expect(buildFingerprint()).toEqual({ version: VERSION, commit: "dev" })
  })

  test("the stamp computation: a sha line accepted, anything git might say otherwise refused", () => {
    expect(shortCommit("abc1234\n")).toBe("abc1234")
    expect(shortCommit("  deadbeefdeadbeefdeadbeefdeadbeefdeadbeef  \n")).toBe("deadbeefdeadbeefdeadbeefdeadbeefdeadbeef")
    // git's failure shapes — not a repository, a detached nothing — never a
    // define (the source fallback rides).
    expect(shortCommit("fatal: not a git repository (or any of the parent directories): .git\n")).toBeUndefined()
    expect(shortCommit("HEAD")).toBeUndefined()
    expect(shortCommit("")).toBeUndefined()
    expect(shortCommit(undefined)).toBeUndefined()
    expect(stampDefine("abc1234")).toEqual({ AUTO_BUILD_COMMIT: '"abc1234"' })
    expect(stampDefine(undefined)).toEqual({})
  })

  test("the define seam's both sides: the script's define over the source's declared constant", () => {
    const versionSource = readFileSync(join(import.meta.dir, "..", "src", "version.ts"), "utf8")
    const buildSource = readFileSync(join(import.meta.dir, "..", "script", "build.ts"), "utf8")
    // The source side: the declared seam, read only through the typeof guard
    // (an unstamped run never throws).
    expect(versionSource).toContain("declare const AUTO_BUILD_COMMIT")
    expect(versionSource).toContain('typeof AUTO_BUILD_COMMIT === "string"')
    // The script side: the define over that same name, JSON-encoded.
    expect(buildSource).toContain("AUTO_BUILD_COMMIT: JSON.stringify(commit)")
    // The fallback word's one home — the script names no fallback of its own.
    expect(versionSource).toContain('export const UNSTAMPED_COMMIT = "dev"')
    expect(buildSource).not.toContain('"dev"')
  })
})
