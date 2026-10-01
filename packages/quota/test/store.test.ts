import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { clearToken, isValidLabel, listStoredAccounts, quotaHome, readMeta, readToken, saveToken } from "../src/store.js"

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "quota-store-test-"))
})

afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

const tokenPath = (provider: string, label: string) => join(quotaHome(home), provider, `${label}.token`)
const metaPath = (provider: string, label: string) => join(quotaHome(home), provider, `${label}.json`)

describe("store", () => {
  test("save/read roundtrip, 0600 on both files", async () => {
    await saveToken("kimi", "default", "tok-123", { note: "main" }, home)
    expect(await readToken("kimi", "default", home)).toBe("tok-123")
    expect(await readMeta("kimi", "default", home)).toEqual({ note: "main" })
    for (const p of [tokenPath("kimi", "default"), metaPath("kimi", "default")]) {
      expect((await stat(p)).mode & 0o777).toBe(0o600)
    }
    // Directory keeps credentials to the owner too.
    expect((await stat(join(quotaHome(home), "kimi"))).mode & 0o777).toBe(0o700)
  })

  test("save trims whitespace; empty token rejected", async () => {
    await saveToken("kimi", "default", "  tok-123 \n", undefined, home)
    expect(await readToken("kimi", "default", home)).toBe("tok-123")
    await expect(saveToken("kimi", "default", "   \n", undefined, home)).rejects.toThrow("empty token")
  })

  test("overwrite updates token; unreadable-but-adjacent label rejected", async () => {
    await saveToken("zhipu", "a", "one", undefined, home)
    await saveToken("zhipu", "a", "two", undefined, home)
    expect(await readToken("zhipu", "a", home)).toBe("two")
    await expect(saveToken("zhipu", "../evil", "x", undefined, home)).rejects.toThrow("invalid label")
    await expect(readToken("zhipu", "../evil", home)).rejects.toThrow("invalid label")
  })

  test("clear removes token and metadata; idempotent", async () => {
    await saveToken("kimi", "tmp", "t", { org: "o" }, home)
    await clearToken("kimi", "tmp", home)
    expect(await readToken("kimi", "tmp", home)).toBeUndefined()
    expect(await readMeta("kimi", "tmp", home)).toBeUndefined()
    await clearToken("kimi", "tmp", home) // no throw
  })

  test("corrupt metadata tolerated; token still readable", async () => {
    await saveToken("zhipu", "c", "tok", undefined, home)
    await writeFile(metaPath("zhipu", "c"), "{ not json", { mode: 0o600 })
    expect(await readMeta("zhipu", "c", home)).toBeUndefined()
    expect(await readToken("zhipu", "c", home)).toBe("tok")
  })

  test("listStoredAccounts: sorted, skips stray files and invalid labels", async () => {
    await saveToken("kimi", "b", "tok-b", undefined, home)
    await saveToken("kimi", "a", "tok-a", { org: "o" }, home)
    await writeFile(join(quotaHome(home), "kimi", "notes.txt"), "hi", { mode: 0o600 })
    await writeFile(join(quotaHome(home), "kimi", "bad label.token"), "tok-x", { mode: 0o600 })
    await writeFile(join(quotaHome(home), "kimi", "empty.token"), "\n", { mode: 0o600 })
    const accounts = await listStoredAccounts("kimi", home)
    expect(accounts.map((a) => a.label)).toEqual(["a", "b"])
    expect(accounts[0].meta).toEqual({ org: "o" })
    expect(accounts[1].meta).toBeUndefined()
  })

  test("listStoredAccounts on a missing provider directory is empty", async () => {
    expect(await listStoredAccounts("kimi", home)).toEqual([])
  })

  test("label rules", () => {
    for (const ok of ["default", "main", "a1", "work.account", "A-b_2"]) expect(isValidLabel(ok)).toBe(true)
    for (const bad of ["", ".hidden", "../evil", "a/b", "a b", "a\tb"]) expect(isValidLabel(bad)).toBe(false)
  })
})
