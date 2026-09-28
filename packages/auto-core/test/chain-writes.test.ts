// The chain-write ratchet (plans/0061 §4.8): SessionChain is mutable state
// with one home — src/chain-transitions.ts — and this suite holds every
// other src file to a per-file budget of direct field writes. The table
// below is seeded with the counts of the day the ratchet landed; a unit that
// converts its callers to the named transitions lowers its files' entries in
// the same change, so the numbers only ever go down, to zero once every
// writer goes through the transitions.
//
// What counts as a write: an assignment (=, compound assignment, ++/--) to,
// or a `delete` of, a SessionChain field through a binding annotated
// `: SessionChain` (the chain parameters and chain-typed locals of the
// session-driving files). Object-literal construction of a chain is not a
// write, and neither are reads. Detection is name-based per file: a binding
// of the same name typed as something else (a fork-base record, say) can in
// principle trip it — such a failure names its site and is settled by a
// conscious table edit, never by weakening the scanner. Writes through
// structurally-typed stand-ins of the chain (failback.ts's consumeFailback
// parameter) are outside this scan by the same boundary; they disappear when
// their clear becomes one of the named transitions.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const SRC = resolve(import.meta.dir, "..", "src")
const TRANSITIONS = "chain-transitions.ts"

// ---------------------------------------------------------------------------
// The budget table — seeded with the counts of the landing day; edits only
// lower a number, and a file's entry stays (at 0) once it is done.
// ---------------------------------------------------------------------------

const CHAIN_WRITE_BUDGET: Record<string, number> = {
  "attempt.ts": 0,
  "artifact.ts": 5,
  "exec-session.ts": 13,
  "execute.ts": 25,
  "runner.ts": 18,
  "session-api.ts": 16,
  "session.ts": 0,
  "wrapup.ts": 1,
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

// The SessionChain fields, read from the type's own definition so the list
// cannot drift from src/chain.ts. A new field extends detection at once
// (raising the affected budgets is then part of the change that adds it).
function chainFields(): string[] {
  const text = readFileSync(join(SRC, "chain.ts"), "utf8")
  const at = text.indexOf("export type SessionChain = {")
  if (at < 0) throw new Error("src/chain.ts: `export type SessionChain = {` not found — the ratchet's field source moved; update the reader")
  const open = text.indexOf("{", at)
  let depth = 0
  let end = -1
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++
    else if (text[i] === "}") {
      depth--
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end < 0) throw new Error("src/chain.ts: SessionChain's braces do not balance — cannot read the field list")
  const body = text.slice(open + 1, end)
  const fields: string[] = []
  for (const part of body.split(";")) {
    const m = /^\s*([A-Za-z_$][\w$]*)\??\s*:/.exec(part)
    if (m) fields.push(m[1]!)
  }
  if (fields.length < 20) throw new Error(`src/chain.ts: only ${fields.length} SessionChain fields parsed (expected at least 20) — the type's shape changed; update the reader`)
  return fields
}

// Blank comment and string/template prose (newlines and positions preserved)
// so a match never comes from non-code text. Template ${…} regions stay code;
// a regex literal is recognized only when a closing slash follows on the same
// line (a regex never spans lines, and a division always has its operand
// before it, which the previous significant character tells apart).
function stripProse(text: string): string {
  const out = text.split("")
  const n = text.length
  const blank = (from: number, to: number): void => {
    for (let k = Math.max(0, from); k <= Math.min(to, n - 1); k++) if (out[k] !== "\n") out[k] = " "
  }
  let i = 0
  let prev = "" // last significant character seen in code
  const regexAllowed = (): boolean => prev === "" || "(,=:[!&|?{};+-*%^~<>".includes(prev)
  // Brace depth of each open template interpolation; inTemplateText tracks
  // whether the scanner is inside template prose.
  const stack: number[] = []
  let inTemplateText = false
  while (i < n) {
    const c = text[i]!
    if (inTemplateText) {
      if (c === "`") {
        blank(i, i)
        inTemplateText = false // this template closes; code resumes
        prev = "`"
        i++
      } else if (c === "$" && text[i + 1] === "{") {
        blank(i, i + 1)
        stack.push(1)
        inTemplateText = false
        prev = "{"
        i += 2
      } else {
        blank(i, i)
        i++
      }
      continue
    }
    if (c === "/" && text[i + 1] === "/") {
      let j = i
      while (j < n && text[j] !== "\n") j++
      blank(i, j - 1)
      i = j
      continue
    }
    if (c === "/" && text[i + 1] === "*") {
      let j = i + 2
      while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++
      blank(i, Math.min(j + 1, n - 1))
      i = Math.min(j + 2, n)
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && text[j] !== c) {
        if (text[j] === "\\") j++
        j++
      }
      blank(i, Math.min(j, n - 1))
      i = Math.min(j + 1, n)
      prev = "s"
      continue
    }
    if (c === "`") {
      blank(i, i)
      inTemplateText = true
      i++
      continue
    }
    if (c === "{" && stack.length > 0) {
      stack[stack.length - 1]!++
      prev = c
      i++
      continue
    }
    if (c === "}" && stack.length > 0) {
      const top = stack[stack.length - 1]! - 1
      if (top === 0) {
        stack.pop()
        blank(i, i)
        inTemplateText = true // back inside the template's prose
        i++
        continue
      }
      stack[stack.length - 1] = top
      prev = c
      i++
      continue
    }
    if (c === "/" && regexAllowed()) {
      let j = i + 1
      let inClass = false
      let closed = false
      while (j < n && text[j] !== "\n") {
        const ch = text[j]!
        if (ch === "\\") j++
        else if (ch === "[") inClass = true
        else if (ch === "]") inClass = false
        else if (ch === "/" && !inClass) {
          closed = true
          break
        }
        j++
      }
      if (closed) {
        let k = j + 1
        while (k < n && /[a-z]/i.test(text[k]!)) k++
        blank(i, k - 1)
        i = k
        prev = "r"
        continue
      }
    }
    if (!/\s/.test(c)) prev = c
    i++
  }
  return out.join("")
}

// Bindings annotated `: SessionChain` in a file (parameters and typed
// locals — every chain of the driver is bound through one of the two).
function chainBindingsOf(text: string): Set<string> {
  const names = new Set<string>()
  for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\s*:\s*SessionChain\b/g)) names.add(m[1]!)
  return names
}

type Write = { file: string; line: number; text: string }

function scan(fields: string[]): Write[] {
  const fieldAlt = fields.join("|")
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.ts$/.test(name)) files.push(relative(SRC, p).replaceAll("\\", "/"))
    }
  }
  walk(SRC)
  const writes: Write[] = []
  for (const file of files) {
    if (file === TRANSITIONS) continue // the one sanctioned writer
    const raw = readFileSync(join(SRC, file), "utf8")
    const code = stripProse(raw)
    const names = chainBindingsOf(code)
    if (names.size === 0) continue
    const nameAlt = [...names].join("|")
    const starts: number[] = [0]
    for (let k = 0; k < raw.length; k++) if (raw[k] === "\n") starts.push(k + 1)
    const lineOf = (idx: number): number => {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid]! <= idx) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    }
    const lineText = (line: number): string => {
      const start = starts[line - 1]!
      const end = line < starts.length ? starts[line]! - 1 : raw.length
      return raw.slice(start, end).trim()
    }
    const patterns = [
      new RegExp(`\\b(?:${nameAlt})\\.(?:${fieldAlt})\\s*(?:=(?!=)|\\+=|-=|\\*=|/=|%=|\\?\\?=|\\|=|&&=|\\+\\+|--)`, "g"),
      new RegExp(`(?:\\+\\+|--)\\s*(?:${nameAlt})\\.(?:${fieldAlt})\\b`, "g"),
      new RegExp(`\\bdelete\\s+(?:${nameAlt})\\.(?:${fieldAlt})\\b`, "g"),
    ]
    const seen = new Set<number>()
    for (const re of patterns) {
      for (const m of code.matchAll(re)) {
        if (seen.has(m.index)) continue
        seen.add(m.index)
        writes.push({ file, line: lineOf(m.index!), text: lineText(lineOf(m.index!)) })
      }
    }
  }
  return writes.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("chain-write ratchet", () => {
  const fields = chainFields()
  const writes = scan(fields)
  const actual = new Map<string, { count: number; sites: string[] }>()
  for (const w of writes) {
    const entry = actual.get(w.file) ?? { count: 0, sites: [] }
    entry.count++
    entry.sites.push(`${w.line}: ${w.text}`)
    actual.set(w.file, entry)
  }

  test("every file's direct chain writes equal its budget (the table only goes down)", () => {
    const problems: string[] = []
    for (const file of [...new Set([...Object.keys(CHAIN_WRITE_BUDGET), ...actual.keys()])].sort()) {
      const budget = CHAIN_WRITE_BUDGET[file] ?? 0
      const got = actual.get(file)?.count ?? 0
      if (got === budget) continue
      const sites = (actual.get(file)?.sites ?? []).join("\n    ")
      if (got > budget) problems.push(`src/${file}: ${got} chain writes > budget ${budget} — convert the sites to the named transitions of src/chain-transitions.ts (or raise nothing: a new write belongs there)\n    ${sites}`)
      else problems.push(`src/${file}: ${got} chain writes < budget ${budget} — lower the table entry to ${got} in this change (the ratchet only goes down)`)
    }
    expect(problems.join("\n")).toBe("")
  })

  test("the budget table names files that exist", () => {
    const problems: string[] = []
    for (const file of Object.keys(CHAIN_WRITE_BUDGET)) {
      try {
        statSync(join(SRC, file))
      } catch {
        problems.push(`src/${file} is listed in the budget table but does not exist — remove the stale entry`)
      }
    }
    expect(problems.join("\n")).toBe("")
  })

  test("the field reader still sees the SessionChain shape", () => {
    // Guards the ratchet against vacuously passing: the reader must find the
    // type and a sane number of fields (the floor moves only consciously).
    expect(fields.length).toBeGreaterThanOrEqual(20)
    expect(fields).toContain("model")
    expect(fields).toContain("pending")
  })

  test("the scanner counts writes and only writes", () => {
    // A synthetic file's worth of source pins the scanner's behavior: prose
    // (comments, strings, template prose) never counts, reads and object-
    // literal construction never count, every write form does.
    const code = [
      "const chain: SessionChain = { pct: 100, used: 0, at: 0 }", // construction, not a write
      "if (chain.pending === undefined) return", // a read
      "chain.note !== undefined ? 1 : 0", // a read
      "// chain.model = commented out", // prose
      "const s = 'chain.model = inside a string'", // prose
      "const t = `chain.model = ${1 + 1} template prose`", // prose
      "chain.model = 'x'", // write
      "chain.pct += 10", // write
      "chain.used ??= 5", // write
      "chain.at++", // write
      "--chain.hinted", // never valid for boolean, but the form must count
      "delete chain.failed", // write
      "chain.wall === undefined || chain.agent !== 'a'", // reads
    ].join("\n")
    const stripped = stripProse(code)
    const names = chainBindingsOf(stripped)
    expect([...names]).toEqual(["chain"])
    const fieldAlt = fields.join("|")
    const nameAlt = [...names].join("|")
    const patterns = [
      new RegExp(`\\b(?:${nameAlt})\\.(?:${fieldAlt})\\s*(?:=(?!=)|\\+=|-=|\\*=|/=|%=|\\?\\?=|\\|=|&&=|\\+\\+|--)`, "g"),
      new RegExp(`(?:\\+\\+|--)\\s*(?:${nameAlt})\\.(?:${fieldAlt})\\b`, "g"),
      new RegExp(`\\bdelete\\s+(?:${nameAlt})\\.(?:${fieldAlt})\\b`, "g"),
    ]
    const hits: string[] = []
    for (const re of patterns) for (const m of stripped.matchAll(re)) hits.push(m[0])
    expect(hits.sort()).toEqual(["--chain.hinted", "chain.at++", "chain.model =", "chain.pct +=", "chain.used ??=", "delete chain.failed"].sort())
  })
})
