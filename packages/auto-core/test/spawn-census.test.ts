// The spawn census (plans/0180 D3, 0165-133 / S17-07): X1's letter — the
// driver's OPENCODE_AUTO_* variables never reach a child the driver runs —
// holds only while every Bun.spawn site states its environment. A site that
// spawns without an `env` key inherits process.env whole (the measured W1
// incident's mechanism, replayed through --test-by-driver, a test lane, the
// regression slot or the round-close build); the census makes each naked
// spawn a conscious, documented allowlist entry instead of an accident.
import { describe, expect, test } from "bun:test"
import { readdir } from "node:fs/promises"
import { join } from "node:path"

// The deliberate naked spawns, each with its reason: file-copy helpers (cp
// over the tree, no project code, no switch reads), the worktree probes of
// git itself (git reads no OPENCODE_AUTO_*), and the shell's lane launcher —
// the driver's OWN _lane child, which legitimately needs the switches.
const ALLOWED: { pattern: RegExp; because: string }[] = [
  { pattern: /"cp",|cp -a/, because: "a file-copy helper (cp over the tree — no project code runs)" },
  { pattern: /"git",|is-inside-work-tree/, because: "a git child (git reads no OPENCODE_AUTO_*; the git() helper scrubs regardless)" },
  { pattern: /process\.execPath/, because: "the shell's lane launcher — the driver's own _lane child, which legitimately needs the switches" },
]

async function srcFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await srcFiles(path)))
    else if (entry.name.endsWith(".ts")) out.push(path)
  }
  return out
}

describe("the spawn census (plans/0180 D3 — every Bun.spawn site states its env)", () => {
  test("each spawn carries an env key or is a documented allowlist entry", async () => {
    const naked: string[] = []
    for (const file of await srcFiles(join(import.meta.dir, "..", "src"))) {
      const text = await Bun.file(file).text()
      let at = text.indexOf("Bun.spawn(")
      while (at !== -1) {
        const window = text.slice(at, at + 700)
        if (!/(^|[^a-zA-Z0-9_])env\s*:/.test(window) && !ALLOWED.some((entry) => entry.pattern.test(window))) {
          naked.push(`${file.replace(/^.*\/src\//, "src/")}@${text.slice(0, at).split("\n").length}`)
        }
        at = text.indexOf("Bun.spawn(", at + 1)
      }
    }
    expect(naked.join("\n")).toBe("")
  })
})
