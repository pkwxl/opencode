// The lane manifest's shape rules: every test file of the package is assigned
// to exactly one lane, and the manifest names no file that does not exist.
// The manifest itself (lanes.ts) is the ratchet that keeps later units honest:
// a new test file fails here until it is classified.
import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { REPO_LANE, UNIT_LANE, testFilesOnDisk } from "./lanes"

const listed = [...UNIT_LANE, ...REPO_LANE]

describe("the lane manifest", () => {
  test("every test file on disk is in the manifest exactly once", () => {
    const onDisk = testFilesOnDisk()
    const missing = onDisk.filter((file) => !listed.includes(file))
    expect(missing).toEqual([])
    const counts = new Map<string, number>()
    for (const file of listed) counts.set(file, (counts.get(file) ?? 0) + 1)
    const twice = listed.filter((file) => counts.get(file)! > 1)
    expect(twice).toEqual([])
    // Both lanes together are exactly the files on disk, no more.
    expect([...new Set(listed)].sort()).toEqual(onDisk)
  })

  test("no manifest entry lists a file that does not exist", () => {
    const absent = listed.filter((file) => !existsSync(file))
    expect(absent).toEqual([])
  })
})
