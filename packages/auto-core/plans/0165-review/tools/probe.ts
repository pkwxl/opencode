// Phase 1 mechanical probes — read-only over the repository; prints a report to stdout.
// Usage: bun plans/0165-review/tools/probe.ts [<packages-dir>] (from packages/auto-core)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const PKGS = process.argv[2] ?? "/workspace/aseo/opencode/packages"
const CORE = join(PKGS, "auto-core")
const read = (p: string) => readFileSync(p, "utf8")
const out: string[] = []
const say = (s = "") => out.push(s)

// ---------- P1: INDEX grammar ----------
say("## P1 INDEX.md grammar")
const index = read(join(CORE, "plans/INDEX.md"))
const rows = index.split("\n").map((l, i) => ({ l, n: i + 1 })).filter((r) => /^\| \d{4}-/.test(r.l))
const cells = (l: string) => l.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim())
const statusOk = /^(active-authority|historical-only|superseded-by \d{4}.*)$/
let prev = 0
const planFiles = readdirSync(join(CORE, "plans")).filter((f) => /^\d{4}-.*\.md$/.test(f)).map((f) => f.replace(/\.md$/, ""))
const indexed = new Set<string>()
for (const r of rows) {
  const c = cells(r.l)
  const id = c[0]
  indexed.add(id)
  const num = Number(id.slice(0, 4))
  if (c.length !== 6) say(`- l.${r.n} ${id}: ${c.length} cells (header has 6)`)
  if (!statusOk.test(c[2] ?? "")) say(`- l.${r.n} ${id}: status cell not in vocabulary: "${(c[2] ?? "").slice(0, 60)}"`)
  if (num < prev && r.n > 130 && r.n < 192) say(`- l.${r.n} ${id}: out of numeric order (after ${String(prev).padStart(4, "0")})`)
  if (r.n < 192) prev = num
}
for (const f of planFiles) if (!indexed.has(f)) say(`- plan file without INDEX row: ${f}`)
for (const id of indexed) if (!planFiles.includes(id) && !/0028|AUTO_NEXT/.test(id)) say(`- INDEX row without plan file: ${id}`)

// ---------- P2: INDEX code homes exist ----------
say("\n## P2 INDEX code homes that do not exist (by row status)")
const missingByPath = new Map<string, string[]>()
for (const r of rows) {
  const c = cells(r.l)
  const homes = (c[4] ?? "").match(/[\w./-]+\.(ts|md|json)/g) ?? []
  for (const h of homes) {
    const p = h.startsWith("packages/") ? join(PKGS, "..", h) : h.startsWith("src/") || h.startsWith("test/") || h.startsWith("templates/") || h.startsWith("docs/") || h.startsWith("prompts/") ? join(CORE, h) : undefined
    if (!p) continue
    if (!existsSync(p)) {
      const k = h
      missingByPath.set(k, [...(missingByPath.get(k) ?? []), `${c[0].slice(0, 4)}(${(c[2] ?? "").split(" ")[0]})`])
    }
  }
}
for (const [k, v] of [...missingByPath].sort()) say(`- ${k}: ${v.join(", ")}`)

// ---------- P3: path references in navigation docs ----------
say("\n## P3 path references in navigation docs that do not resolve")
const navDocs: [string, string][] = [
  [join(CORE, "AGENTS.md"), CORE],
  [join(CORE, "docs/structure.md"), CORE],
  [join(CORE, "docs/shell-contract.md"), CORE],
  [join(CORE, "docs/principles.md"), CORE],
  [join(PKGS, "auto/AGENTS.md"), join(PKGS, "auto")],
]
for (const [doc, base] of navDocs) {
  const text = read(doc)
  const refs = new Set(text.match(/(?<![\w/.-])(?:\.\.\/[\w-]+\/)?(?:src|test|templates|prompts|docs|script)\/[\w./{},*-]+\.(?:ts|md|json)/g) ?? [])
  const bad: string[] = []
  for (const ref of refs) {
    if (/[{}*]/.test(ref)) continue
    const p = ref.startsWith("../") ? join(base, ref) : join(base, ref)
    const alt = join(CORE, ref.replace(/^\.\.\/auto-core\//, ""))
    if (!existsSync(p) && !existsSync(alt)) bad.push(ref)
  }
  say(`- ${doc.replace(PKGS + "/", "")}: ${refs.size} refs, ${bad.length} unresolved${bad.length ? ": " + bad.join(", ") : ""}`)
}

// ---------- P4: derivation discipline for post-baseline plans ----------
say("\n## P4 post-baseline plans: Derives/Amends tags and Category scope (0123+)")
for (const f of planFiles.filter((f) => Number(f.slice(0, 4)) >= 110).sort()) {
  const t = read(join(CORE, "plans", f + ".md"))
  const num = Number(f.slice(0, 4))
  const derives = /\b(Derives|Amends):/.test(t)
  const scope = /^#{2,4} .*Category scope/im.test(t)
  const scopeLoose = /Category scope/i.test(t)
  const flags = [!derives && "no Derives/Amends tag", num > 123 && !scope && (scopeLoose ? "Category scope mentioned but no heading" : "no Category scope section")].filter(Boolean)
  if (flags.length) say(`- ${f}: ${flags.join("; ")}`)
}

// ---------- P5: env switch inventory ----------
say("\n## P5 OPENCODE_AUTO_* switches: code vs documentation")
const walk = (d: string, ext: RegExp): string[] =>
  readdirSync(d).flatMap((e) => {
    const p = join(d, e)
    if (e === "node_modules" || e === "dist") return []
    return statSync(p).isDirectory() ? walk(p, ext) : ext.test(e) ? [p] : []
  })
const grab = (files: string[]) => new Set(files.flatMap((f) => read(f).match(/OPENCODE_AUTO_[A-Z0-9_]+/g) ?? []))
const codeSw = grab([...walk(join(CORE, "src"), /\.ts$/), ...walk(join(PKGS, "auto/src"), /\.ts$/), ...walk(join(PKGS, "auto-server/src"), /\.ts$/)])
const docSw = grab([join(PKGS, "auto/README.md"), join(PKGS, "auto/MANUAL.md"), join(PKGS, "auto-server/README.md"), join(PKGS, "auto-server/docs/daemon.md"), ...walk(join(CORE, "docs"), /\.md$/), join(CORE, "AGENTS.md")])
const switchesTs = read(join(CORE, "src/switches.ts"))
for (const s of [...codeSw].sort()) if (!docSw.has(s)) say(`- in code, undocumented in user/design docs: ${s}${switchesTs.includes(s) ? " (parsed in switches.ts)" : ""}`)
for (const s of [...docSw].sort()) if (!codeSw.has(s)) say(`- documented, absent from code: ${s}`)

// ---------- P6: src modules with no direct test import ----------
say("\n## P6 auto-core src modules no test file imports directly")
const testText = walk(join(CORE, "test"), /\.ts$/).map(read).join("\n")
for (const f of walk(join(CORE, "src"), /\.ts$/)) {
  const rel = f.slice(join(CORE, "src").length + 1).replace(/\.ts$/, "")
  if (rel.endsWith(".d")) continue
  const re = new RegExp(`(src|auto-core)/${rel.replace(/[/.]/g, "\\$&")}["']`)
  if (!re.test(testText)) say(`- ${rel} (${read(f).split("\n").length} lines)`)
}

// ---------- P7: Auto-Stage trailer vocabulary ----------
say("\n## P7 Auto-Stage values: code literals")
const stages = new Set<string>()
for (const f of walk(join(CORE, "src"), /\.ts$/)) for (const m of read(f).matchAll(/stage:\s*"([a-z][a-z0-9-]*)"/g)) stages.add(m[1])
for (const m of read(join(CORE, "src/git.ts")).matchAll(/Auto-Stage: ([a-z][a-z0-9-]*)/g)) stages.add(m[1])
say(`- ${[...stages].sort().join(", ")}`)

console.log(out.join("\n"))
