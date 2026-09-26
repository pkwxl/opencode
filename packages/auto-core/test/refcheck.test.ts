import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeDocs,
  autoCorrectRefs,
  extractRefs,
  gitAvailable,
  renamePairs,
  rewriteRefs,
  scanRefs,
  validateRefs,
  recordOnce,
  renameHistory,
  reconfirmAnchors,
} from "../src/refcheck"

describe("extractRefs", () => {
  test("backtick spans and md links are both extracted; non-path tokens are ignored", () => {
    const text = ["See `docs/T-001/subtasks.md` and the [wrap-up report](docs/T-001/report.md).", "Plain words `hello` and `word` are not references."].join("\n")
    expect(extractRefs(text)).toEqual([
      { path: "docs/T-001/subtasks.md", at: 1 },
      { path: "docs/T-001/report.md", at: 1 },
    ])
  })

  test("a :line-number trailing anchor is stripped into line", () => {
    const text = "See `docs/T-001/context.md:42`."
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", line: 42, at: 1 }])
  })

  test("a :N-M range trailing anchor is stripped, line takes the range's upper bound", () => {
    const text = "See `kernel/comps/block/src/lib.rs:64-159`."
    expect(extractRefs(text)).toEqual([{ path: "kernel/comps/block/src/lib.rs", line: 159, at: 1 }])
  })

  test("an @<sha> version marker is stripped into ver (the @sha is stripped before the :N-M line anchor)", () => {
    const text = "See `src/x.ts:64-159@abc1234`, `docs/a.md@deadbeef` and `src/y.ts:3@0123456789abcdef`."
    expect(extractRefs(text)).toEqual([
      { path: "src/x.ts", line: 159, at: 1, ver: "abc1234" },
      { path: "docs/a.md", at: 1, ver: "deadbeef" },
      { path: "src/y.ts", line: 3, at: 1, ver: "0123456789abcdef" },
    ])
  })

  test("tokens containing whitespace are ignored", () => {
    expect(extractRefs("See `docs / T-001.md`")).toEqual([])
  })

  test("lines inside a fence are exempt", () => {
    const text = ["```", "cat docs/T-001.context.md", "```", "See `docs/T-001/context.md`."].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", at: 4 }])
  })

  test("marker lines are exempt (deleted|archived|historical)", () => {
    const text = ["Old path `docs/T-001.context.md` deleted.", "`docs/T-002.audit.md` is a historical artifact.", "Live `docs/T-002/audit.md`."].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-002/audit.md", at: 3 }])
  })

  test("the same token appearing several times on a line is taken once; at is the 1-based line number", () => {
    const text = ["x", "`docs/T-001.md` and `docs/T-001.md`"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001.md", at: 2 }])
  })
})

describe("rewriteRefs", () => {
  const pair = { old: "docs/T-1.md", new: "docs/T-1/report.md" }

  test("word-boundary hits and the count", () => {
    const { text, count } = rewriteRefs("Read `docs/T-1.md` first, then [x](docs/T-1.md).", [pair])
    expect(text).toBe("Read `docs/T-1/report.md` first, then [x](docs/T-1/report.md).")
    expect(count).toBe(2)
  })

  test("prefixes are not mismatched (docs/T-1.md ≠ docs/T-11.md / docs/T-1.md.bak)", () => {
    const { text, count } = rewriteRefs("`docs/T-11.md` and `docs/T-1.md.bak`", [pair])
    expect(text).toBe("`docs/T-11.md` and `docs/T-1.md.bak`")
    expect(count).toBe(0)
  })

  test("fences and marker lines are exempt", () => {
    const text = ["```", "docs/T-1.md", "```", "`docs/T-1.md` archived.", "`docs/T-1.md`"].join("\n")
    const result = rewriteRefs(text, [pair])
    expect(result.text).toBe(["```", "docs/T-1.md", "```", "`docs/T-1.md` archived.", "`docs/T-1/report.md`"].join("\n"))
    expect(result.count).toBe(1)
  })

  test("multiple pairs apply in order", () => {
    const { text, count } = rewriteRefs("`docs/final/audit-r1.md` and `docs/final-audit.md`", [
      { old: "docs/final/audit-r1.md", new: "docs/T-F1/audit-r1.md" },
      { old: "docs/final-audit.md", new: "docs/T-F1/final-audit.md" },
    ])
    expect(text).toBe("`docs/T-F1/audit-r1.md` and `docs/T-F1/final-audit.md`")
    expect(count).toBe(2)
  })

  test("regex metacharacters in paths are safely escaped", () => {
    const { text, count } = rewriteRefs("`docs/a+b.md`", [{ old: "docs/a+b.md", new: "docs/a+b/x.md" }])
    expect(text).toBe("`docs/a+b/x.md`")
    expect(count).toBe(1)
  })

  test("the rewrite leaves layout untouched: only the hit token is replaced in place, line structure/whitespace/alignment/trailing newline preserved verbatim", () => {
    const text = [
      "| Document | Notes |",
      "| `docs/T-1.md` | Report |  ",
      "",
      "See `docs/T-1.md`.",
      "```",
      "docs/T-1.md",
      "```",
      "last line without a newline `docs/T-1.md`",
    ].join("\n")
    const { text: out, count } = rewriteRefs(text, [pair])
    expect(count).toBe(3)
    // Line-by-line comparison: byte-identical apart from the in-place replacement of hit
    // tokens (line count unchanged, exempt lines/blank lines/trailing whitespace kept
    // as is; the last line stays without a newline — split/join is symmetric, no
    // trailing newline added)
    const before = text.split("\n")
    const after = out.split("\n")
    expect(after).toHaveLength(before.length)
    after.forEach((line, i) => {
      if (i === 1 || i === 3 || i === 7) expect(line).toBe(before[i]!.replaceAll(pair.old, pair.new))
      else expect(line).toBe(before[i])
    })
    // No hits → the output is byte-identical to the input (the caller does not write
    // back, the file stays as is)
    expect(rewriteRefs(text, [{ old: "docs/gone.md", new: "docs/x.md" }]).text).toBe(text)
  })
})

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} exit code ${code}: ${err || out}`)
  return out
}

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  return dir
}

describe("activeDocs / validateRefs / scanRefs", () => {
  test("live-document enumeration: all of docs/**/*.md (no old-layout exclusion since M3.7), sorted output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/T-002/S01/index.md"), "x")
      await Bun.write(join(dir, "docs/T-002/report.md"), "x")
      await Bun.write(join(dir, "docs/phases/notes.md"), "x")
      expect(await activeDocs(dir)).toEqual(["docs/T-002/S01/index.md", "docs/T-002/report.md", "docs/phases/notes.md"])
      expect(await activeDocs(dir)).toEqual((await activeDocs(dir)).slice().sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("live-document enumeration: the phase index / task index / handover / artifacts / state files and knowledge documents are live documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await mkdir(join(dir, "docs/R-01/P01-analysis/sub"), { recursive: true })
      await Bun.write(join(dir, "docs/R-01/P01-analysis/tasks.md"), "x") // task index
      await Bun.write(join(dir, "docs/R-01/P01-analysis/sub/PLAN.md"), "x")
      await Bun.write(join(dir, "docs/R-01/P01-analysis/done.md"), "x")
      await Bun.write(join(dir, "docs/R-01/P01-analysis/handover.md"), "x")
      await Bun.write(join(dir, "docs/R-01/P01-analysis/findings.md"), "x")
      await Bun.write(join(dir, "docs/R-01/phases.md"), "x") // phase index (a live document)
      await Bun.write(join(dir, "docs/R-01/PLAN.md"), "x")
      await Bun.write(join(dir, "docs/R-01/prior-kb.md"), "x")
      await mkdir(join(dir, "docs/R-01/P02-knowledge"), { recursive: true })
      await Bun.write(join(dir, "docs/R-01/P02-knowledge/kb.md"), "x")
      expect(await activeDocs(dir)).toEqual([
        "docs/R-01/P01-analysis/done.md",
        "docs/R-01/P01-analysis/findings.md",
        "docs/R-01/P01-analysis/handover.md",
        "docs/R-01/P01-analysis/sub/PLAN.md",
        "docs/R-01/P01-analysis/tasks.md",
        "docs/R-01/P02-knowledge/kb.md",
        "docs/R-01/PLAN.md",
        "docs/R-01/phases.md",
        "docs/R-01/prior-kb.md",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: existence + line number ≤ total lines; a directory reference checks existence only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), "a\nb\n")
      const refs = extractRefs("`docs/T-001/context.md`, `docs/T-001/context.md:2`, `docs/T-001/context.md:9`, `docs/T-001`, `docs/T-999/x.md`")
      expect(await validateRefs(dir, refs)).toEqual(
        new Map([
          ["docs/T-001/context.md", "beyond-eof"],
          ["docs/T-999/x.md", "missing"],
        ]),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: references carrying an @sha version marker are exempt from the line-cap check (historical-snapshot references, path existence only)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "src/mod.ts"), "a\nb\n")
      const refs = extractRefs("`src/mod.ts:99@abc1234`, `src/mod.ts:99`, `src/gone.ts:3@abc1234`")
      // :99@abc1234 is exempt from the line check; bare :99 is still beyond-eof; a
      // missing path carrying the marker is still missing
      expect(await validateRefs(dir, refs)).toEqual(
        new Map([
          ["src/mod.ts", "beyond-eof"],
          ["src/gone.ts", "missing"],
        ]),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scanRefs: broken references produce findings (with location and source line); exempt forms are not reported", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "src/mod.ts"), "code\n")
      await Bun.write(
        join(dir, "docs/T-001/report.md"),
        [
          "A normal reference `docs/T-001/context.md` (missing).",
          "Line number beyond eof `src/mod.ts:99`.",
          "Exempt: `docs/gone.md` deleted, `docs/old.md` is a historical path.",
          "```",
          "Inside a fence `docs/gone-fenced.md` is not checked.",
          "```",
          "Outside the shape: `https://example.com/x`, `/abs/path`, `v1.2`, `./rel.md` are not validated.",
        ].join("\n"),
      )
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "A normal reference `docs/T-001/context.md` (missing).", path: "docs/T-001/context.md", problem: "missing" },
        { file: "docs/T-001/report.md", line: 2, text: "Line number beyond eof `src/mod.ts:99`.", path: "src/mod.ts", problem: "beyond-eof" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("an md link's #fragment is stripped and the path validated", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/target.md"), "x\n")
      await Bun.write(join(dir, "docs/live.md"), "See [target](docs/target.md#section). See [dead link](docs/dead.md#section).")
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/live.md", line: 1, text: "See [target](docs/target.md#section). See [dead link](docs/dead.md#section).", path: "docs/dead.md#section", problem: "missing" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: a unique suffix match at a segment boundary counts as valid and resolves (line numbers checked against the matched file); multiple matches count as missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "pkg/src/mod.ts"), "a\nb\n")
      const refs = extractRefs("`src/mod.ts`, `src/mod.ts:2`, `src/mod.ts:9`, `src/gone.ts`")
      // Unique hit pkg/src/mod.ts → valid; line 9 exceeds its 2 lines → beyond-eof
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "beyond-eof"], ["src/gone.ts", "missing"]]))
      // A second same-suffix copy added → context ambiguity, counts as missing
      await Bun.write(join(dir, "other/src/mod.ts"), "z")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "missing"], ["src/gone.ts", "missing"]]))
      // A direct hit outranks ambiguity: a root-relative path that exists is valid
      // (no longer missing); the line check proceeds as usual
      await Bun.write(join(dir, "src/mod.ts"), "a\nb\n")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "beyond-eof"], ["src/gone.ts", "missing"]]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: a directory reference (trailing /) resolves through unique suffix matching to the directory; a range trailing anchor checks the line number against its upper bound", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "asterinas/kernel/comps/dm/lib.rs"), "a\nb\nc\n")
      const refs = extractRefs("`kernel/comps/dm/`, `kernel/comps/dm/lib.rs:1-2`, `kernel/comps/dm/lib.rs:1-9`")
      // The trailing / resolves to asterinas/kernel/comps/dm → valid; the range upper
      // bound 9 exceeds 3 lines → beyond-eof
      expect(await validateRefs(dir, refs)).toEqual(new Map([["kernel/comps/dm/lib.rs", "beyond-eof"]]))
      // A second same-suffix directory copy added → directory resolution is ambiguous,
      // counts as missing (the file reference still resolves uniquely)
      await Bun.write(join(dir, "linux/kernel/comps/dm/x.rs"), "z")
      expect(await validateRefs(dir, refs)).toEqual(
        new Map([["kernel/comps/dm/", "missing"], ["kernel/comps/dm/lib.rs", "beyond-eof"]]),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: symlinked directories are descended for suffix resolution (source-tree style); cyclic symlinks do not loop forever", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "real/include/uapi/linux/dm.h"), "a\nb\n")
      await Bun.write(join(dir, "real/include/linux/kdev_t.h"), "x\n")
      await symlink(join(dir, "real"), join(dir, "linux"))
      // linux/include/linux/kdev_t.h is hit uniquely by the in-tree-relative spelling `include/linux/kdev_t.h`
      const refs = extractRefs("`include/linux/kdev_t.h`, `linux/dm.h:9`")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["linux/dm.h", "beyond-eof"]]))
      // The cyclic symlink (real/loop → linux → real) descends bounded, resolution unaffected
      await symlink(join(dir, "linux"), join(dir, "real/loop"))
      expect(await validateRefs(dir, refs)).toEqual(new Map([["linux/dm.h", "beyond-eof"]]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: both spellings of one target, with and without the trailing slash, resolve together (normalized lookup keys do not collide)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "asterinas/kernel/core/comps/dm/lib.rs"), "x\n")
      const refs = extractRefs("`kernel/core/comps/dm/`, `kernel/core/comps/dm`")
      expect(await validateRefs(dir, refs)).toEqual(new Map())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scanRefs: context-relative references resolve through unique suffix matching (same-directory paths within the document)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), "x\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "A sibling reference `context.md` and a code reference `pkg/util.ts`.\n")
      await Bun.write(join(dir, "pkg/util.ts"), "code\n")
      expect(await scanRefs(dir)).toEqual([])
      // Uniqueness broken (another task also has a context.md) → back to missing
      await Bun.write(join(dir, "docs/T-002/context.md"), "x\n")
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "A sibling reference `context.md` and a code reference `pkg/util.ts`.", path: "context.md", problem: "missing" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("recordOnce: a new key warns once, recorded keys stay silent; the list is rewritten wholesale in stable sort, empty entries delete the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    const warns: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => warns.push(args.map(String).join(" "))
    try {
      await recordOnce(dir, ".auto/reg.md", "# List\n", [
        { key: "b", warn: "B" },
        { key: "a", warn: "A" },
      ])
      expect(warns).toEqual(["  ⚠ B", "  ⚠ A"])
      expect(await Bun.file(join(dir, ".auto/reg.md")).text()).toBe("# List\n- a\n- b\n")
      // Called again: recorded key a stays silent, new key c still warns; the list is
      // rewritten wholesale with three keys
      warns.length = 0
      await recordOnce(dir, ".auto/reg.md", "# List\n", [
        { key: "a", warn: "A" },
        { key: "c", warn: "C" },
      ])
      expect(warns).toEqual(["  ⚠ C"])
      // Wholesale rewrite: b, unreported this round, counts as fixed and is removed automatically
      expect(await Bun.file(join(dir, ".auto/reg.md")).text()).toBe("# List\n- a\n- c\n")
      // Empty entries → the list is deleted (removed automatically once fixed)
      await recordOnce(dir, ".auto/reg.md", "# List\n", [])
      expect(await Bun.file(join(dir, ".auto/reg.md")).exists()).toBe(false)
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("gitAvailable: false in a non-git directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      expect(await gitAvailable(dir)).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("renamePairs / autoCorrectRefs", () => {
  test("renamePairs: an untracked new path joins the pairing once staged, output is target-directory-relative", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // After a bare mv (nothing staged) the pairing still holds: renamePairs runs git add -A itself
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      expect(await renamePairs(dir)).toEqual([{ old: "src/old.ts", new: "src/new.ts" }])
      // No rename changes → empty pairing
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "rename")
      expect(await renamePairs(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("autoCorrectRefs: rename pairs mechanically rewrite live-document references; deletions produce findings (no automatic rewrite)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "l1\nl2\nl3\n")
      await Bun.write(join(dir, "docs/dead.ts"), "gone")
      await Bun.write(join(dir, "docs/T-001/report.md"), "See `src/old.ts:3` and `docs/dead.ts`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      await rm(join(dir, "docs/dead.ts"))
      const findings = await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("See `src/new.ts:3` and `docs/dead.ts`.")
      expect(findings).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "See `src/new.ts:3` and `docs/dead.ts`.", path: "docs/dead.ts", problem: "missing" },
      ])
      // Idempotent: a second run has no rename, findings unchanged, the document no longer changes
      await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("See `src/new.ts:3` and `docs/dead.ts`.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("non-git directory: renamePairs/autoCorrectRefs no-op without error (validate still runs)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/live.md"), "Reference `docs/gone.md`.")
      expect(await renamePairs(dir)).toEqual([])
      const findings = await autoCorrectRefs(dir)
      expect(findings).toHaveLength(1)
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe("Reference `docs/gone.md`.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("autoCorrectRefs: the broken-reference list .auto/invalid-refs.md warns only on newly seen references; removed once fixed, warns again on recurrence", async () => {
    const dir = await freshRepo()
    const seen: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => seen.push(args.join(" "))
    try {
      await Bun.write(join(dir, "docs/live.md"), "References `docs/gone.md` and `docs/lost.md`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // First round: each of the two new broken references warns once, the list lands
      // on disk (keys sorted, no line numbers or source text)
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ stale reference"))).toHaveLength(2)
      const list = await Bun.file(join(dir, ".auto/invalid-refs.md")).text()
      expect(list.split("\n").slice(1)).toEqual([
        "- docs/live.md → docs/gone.md(missing)",
        "- docs/live.md → docs/lost.md(missing)",
        "",
      ])
      // Second round: already recorded in the list, no repeated warning
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ stale reference"))).toHaveLength(0)
      // A third one added → only the newly seen one warns
      await Bun.write(join(dir, "docs/live.md"), "References `docs/gone.md`, `docs/lost.md` and `docs/vanished.md`.")
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ stale reference"))).toHaveLength(1)
      expect(seen.find((line) => line.includes("⚠ stale reference"))).toContain("docs/vanished.md")
      // All fixed → the list is removed
      await Bun.write(join(dir, "docs/gone.md"), "x")
      await Bun.write(join(dir, "docs/lost.md"), "x")
      await Bun.write(join(dir, "docs/vanished.md"), "x")
      await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
      // Recurrence → treated as newly seen, warns again
      await rm(join(dir, "docs/gone.md"))
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ stale reference"))).toHaveLength(1)
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("missing-reference recovery (refcheck-scope P2, git history tracking)", () => {
  test("historical moves resolve through the rename map's chains and recover in place; a deleted destination and pure deletions stay on the broken-reference list", async () => {
    const dir = await freshRepo()
    const seen: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => seen.push(args.join(" "))
    try {
      await Bun.write(join(dir, "src/chain-a.ts"), "c1\nc2\n")
      await Bun.write(join(dir, "src/victim.ts"), "v\n")
      await Bun.write(join(dir, "src/gone.ts"), "g\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "See `src/chain-a.ts:2`, `src/victim.ts` and `src/gone.ts`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // Historical moves (committed into history): chain-a → chain-b → chain-c (chained);
      // victim → renamed then the destination deleted; gone purely deleted
      await git(dir, "mv", "src/chain-a.ts", "src/chain-b.ts")
      await git(dir, "commit", "-qm", "mv a->b")
      await git(dir, "mv", "src/chain-b.ts", "src/chain-c.ts")
      await git(dir, "mv", "src/victim.ts", "src/renamed.ts")
      await git(dir, "commit", "-qm", "mv b->c, victim->renamed")
      await rm(join(dir, "src/renamed.ts"))
      await rm(join(dir, "src/gone.ts"))
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "del renamed/gone")
      // The rename history map: new→old first occurrence wins + chained resolution to the final destination
      expect(await renameHistory(dir)).toEqual(
        new Map([
          ["src/chain-b.ts", "src/chain-c.ts"],
          ["src/victim.ts", "src/renamed.ts"],
          ["src/chain-a.ts", "src/chain-c.ts"],
        ]),
      )
      const findings = await autoCorrectRefs(dir)
      // chain-a recovers to the final destination chain-c (the :2 line anchor kept);
      // victim's destination is deleted and gone purely deleted → no automatic
      // recovery, the finding stays
      const report = "See `src/chain-c.ts:2`, `src/victim.ts` and `src/gone.ts`."
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("missing-reference recovery"))).toHaveLength(1)
      expect(findings).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: report, path: "src/victim.ts", problem: "missing" },
        { file: "docs/T-001/report.md", line: 1, text: report, path: "src/gone.ts", problem: "missing" },
      ])
      // After the re-scan the broken-reference list records only the unrecovered items
      const list = await Bun.file(join(dir, ".auto/invalid-refs.md")).text()
      expect(list).toContain("- docs/T-001/report.md → src/victim.ts(missing)")
      expect(list).toContain("- docs/T-001/report.md → src/gone.ts(missing)")
      expect(list).not.toContain("chain-a")
      // Idempotent: a second run writes no recovery rewrites, the document is
      // unchanged, findings and list unchanged (unrecovered items do not warn again)
      seen.length = 0
      expect(await autoCorrectRefs(dir)).toEqual(findings)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("missing-reference recovery"))).toHaveLength(0)
      expect(seen.filter((line) => line.includes("⚠ stale reference"))).toHaveLength(0)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).text()).toBe(list)
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("historical moves in a nested repository also join recovery (paths converted to target-directory-relative)", async () => {
    const dir = await freshRepo()
    const sub = join(dir, "sub")
    try {
      await mkdir(sub, { recursive: true })
      await git(sub, "init", "-q")
      await git(sub, "config", "user.email", "t@t")
      await git(sub, "config", "user.name", "t")
      await Bun.write(join(sub, "lib/util.ts"), "u\n")
      await git(sub, "add", "-A")
      await git(sub, "commit", "-qm", "sub init")
      await Bun.write(join(dir, "docs/T-001/report.md"), "Nested reference `sub/lib/util.ts`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "outer init")
      // A historical move inside the sub-repository util → helpers (the outer reference goes stale with it)
      await git(sub, "mv", "lib/util.ts", "lib/helpers.ts")
      await git(sub, "commit", "-qm", "sub mv")
      const findings = await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("Nested reference `sub/lib/helpers.ts`.")
      expect(findings).toEqual([])
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("a path that never existed in history is not recovered (the 'once existed' criterion = git history); non-git directories no-op", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "docs/live.md"), "Reference `docs/never-existed.md`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const findings = await autoCorrectRefs(dir)
      expect(findings).toHaveLength(1)
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe("Reference `docs/never-existed.md`.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("reference range reconfirmation (refcheck-scope P3, @sha version markers)", () => {
  test("changed files: an unchanged range stays put, a changed one gains @<sha> (the HEAD short hash), insufficient line count counts as changed; a re-scan exempts the line check; idempotent — already-marked references are not updated", async () => {
    const dir = await freshRepo()
    const seen: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => seen.push(args.join(" "))
    try {
      await Bun.write(join(dir, "src/mod.ts"), "l1\nl2\nl3\nl4\n")
      await Bun.write(
        join(dir, "docs/T-001/report.md"),
        "See `src/mod.ts:3-4`, `src/mod.ts:1-2`, `src/mod.ts:1-9`, `src/new.ts:1` and `src/mod.ts:2@deadbeef`.",
      )
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const sha1 = (await git(dir, "rev-parse", "--short=7", "HEAD")).trim()
      // Changes this round: mod.ts line 1 edited (l1→L1); new.ts added this round
      // (no version at HEAD)
      await Bun.write(join(dir, "src/mod.ts"), "L1\nl2\nl3\nl4\n")
      await Bun.write(join(dir, "src/new.ts"), "n1\nn2\n")
      const findings = await autoCorrectRefs(dir)
      // :3-4 range unchanged, stays put; :1-2 changed, gains @sha1; :1-9 insufficient
      // lines, also changed, gains @sha1;
      // :1 (a newly added file) has no version to pin, skipped; :2@deadbeef already
      // marked, not updated
      const report = `See \`src/mod.ts:3-4\`, \`src/mod.ts:1-2@${sha1}\`, \`src/mod.ts:1-9@${sha1}\`, \`src/new.ts:1\` and \`src/mod.ts:2@deadbeef\`.`
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("reference range reconfirmation"))).toHaveLength(1)
      // Re-scan: marked historical-snapshot references are exempt from the line-cap
      // check → no findings, no broken-reference list
      expect(findings).toEqual([])
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
      // Idempotent: with no new changes a second run reconfirms nothing, the
      // document is byte-identical
      seen.length = 0
      expect(await autoCorrectRefs(dir)).toEqual([])
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("reference range reconfirmation"))).toHaveLength(0)
      // A new round: after the commit mod.ts line 3 changes again → :3-4 gains the
      // new HEAD marker; already-marked references are not updated
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "round-1")
      const sha2 = (await git(dir, "rev-parse", "--short=7", "HEAD")).trim()
      await Bun.write(join(dir, "src/mod.ts"), "L1\nl2\nL3\nl4\n")
      expect(await autoCorrectRefs(dir)).toEqual([])
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(
        `See \`src/mod.ts:3-4@${sha2}\`, \`src/mod.ts:1-2@${sha1}\`, \`src/mod.ts:1-9@${sha1}\`, \`src/new.ts:1\` and \`src/mod.ts:2@deadbeef\`.`,
      )
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("changed files in a nested repository: the sub-repository's HEAD short hash is appended (decided per repository)", async () => {
    const dir = await freshRepo()
    const sub = join(dir, "sub")
    try {
      await mkdir(sub, { recursive: true })
      await git(sub, "init", "-q")
      await git(sub, "config", "user.email", "t@t")
      await git(sub, "config", "user.name", "t")
      await Bun.write(join(sub, "lib/util.ts"), "u1\nu2\n")
      await git(sub, "add", "-A")
      await git(sub, "commit", "-qm", "sub init")
      await Bun.write(join(dir, "docs/T-001/report.md"), "Nested reference `sub/lib/util.ts:1-2`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "outer init")
      const subSha = (await git(sub, "rev-parse", "--short=7", "HEAD")).trim()
      // Changed inside the sub-repository (uncommitted) → the reference gains the
      // sub-repository's HEAD marker
      await Bun.write(join(sub, "lib/util.ts"), "U1\nu2\n")
      expect(await reconfirmAnchors(dir)).toBe(1)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(`Nested reference \`sub/lib/util.ts:1-2@${subSha}\`.`)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("no changes / non-git directory no-op (returns 0, document unchanged)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/mod.ts"), "l1\n")
      await Bun.write(join(dir, "docs/live.md"), "Reference `src/mod.ts:1`.")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      expect(await reconfirmAnchors(dir)).toBe(0)
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe("Reference `src/mod.ts:1`.")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
    const plain = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(plain, "docs/live.md"), "Reference `src/mod.ts:1`.")
      expect(await reconfirmAnchors(plain)).toBe(0)
      expect(await Bun.file(join(plain, "docs/live.md")).text()).toBe("Reference `src/mod.ts:1`.")
    } finally {
      await rm(plain, { recursive: true, force: true })
    }
  })
})
