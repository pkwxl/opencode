// 0123 D3 family-consistency check (mechanical half): for each plan 0124–0163 carrying a
// Category scope table, every home marked "changed" must appear in the files touched by the
// plan's landing commit or a later commit whose subject starts with "<id> (enacted)" / "<id>:".
// Read-only. Usage: bun plans/0165-review/tools/family-check.ts (from packages/auto-core)
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { $ } from "bun"

const REPO = "/workspace/aseo/opencode"
const PLANS = join(REPO, "packages/auto-core/plans")
const files = readdirSync(PLANS).filter((f) => /^01(2[4-9]|[3-6]\d)-.*\.md$/.test(f)).sort()

const expand = (p: string): string[] => {
  const m = p.match(/^(.*)\{([^}]+)\}(.*)$/)
  return m ? m[2].split(",").flatMap((alt) => expand(m[1] + alt.trim() + m[3])) : [p]
}

for (const f of files) {
  const id = f.slice(0, 4)
  const text = readFileSync(join(PLANS, f), "utf8")
  const sec = text.match(/^#+ [^\n]*Category scope[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)
  if (!sec) {
    console.log(`${id}: no Category scope section — family reconstruction needed (manual)`)
    continue
  }
  const rel = `packages/auto-core/plans/${f}`
  const add = (await $`git -C ${REPO} log --diff-filter=A --format=%H -- ${rel}`.text()).trim().split("\n").pop()!
  const follow = (await $`git -C ${REPO} log --format=%H ${add}..HEAD --grep=^${id}`.text()).trim().split("\n").filter(Boolean)
  const touched = new Set<string>()
  for (const c of [add, ...follow]) for (const p of (await $`git -C ${REPO} show --name-only --format= ${c}`.text()).trim().split("\n")) touched.add(p)
  const rows = sec[1].split("\n").filter((l) => l.startsWith("|") && !/^\|\s*-+/.test(l) && !/^\|\s*home\s*\|/i.test(l))
  const misses: string[] = []
  let changed = 0
  for (const row of rows) {
    const cells = row.split("|").slice(1, -1)
    const disp = (cells.at(-1) ?? "").toLowerCase()
    if (!/\bchanged\b/.test(disp) || /\bunchanged\b/.test(disp) || /^\s*held\b/.test(disp)) continue
    const paths = [...(cells[0] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1].split(" ")[0]).filter((p) => /[./]/.test(p) && /\.(ts|md|json)$|\/$/.test(p))
    for (const p of paths.flatMap(expand)) {
      changed++
      const g = new RegExp("(^|/)" + p.replace(/^\//, "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$")
      const hit = [...touched].some((t) => g.test(t) || (p.endsWith("/") && t.includes(p)))
      if (!hit) misses.push(p)
    }
  }
  console.log(`${id}: ${rows.length} rows, ${changed} changed-paths, commits ${1 + follow.length}${misses.length ? ` — NOT TOUCHED: ${misses.join(", ")}` : " — ok"}`)
}
