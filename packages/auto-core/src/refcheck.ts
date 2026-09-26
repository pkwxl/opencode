// Reference-consistency layer (stable-refs design §4.5, the three layers in
// D6): extractRefs extracts the path references a document makes to documents
// and code (backtick spans and md links), rewriteRefs does the mechanical
// old→new path rewrite (the pre-commit auto-correct and the fix-refs manual
// script share this primitive); P4 added validateRefs (existence +
// segment-boundary suffix unique-match resolution + the line-number cap),
// renamePairs (git rename pairing), live-document enumeration and the
// scanRefs full scan, consumed by the check subcommand; autoCorrectRefs also
// maintains the .auto/invalid-refs.md stale list, logging ⚠ only for newly
// appearing stale references; refcheck-scope P2 added renameHistory (the
// git-history rename map) and missing recovery (confirm stale first, recover
// after: a missing finding whose target once existed in history and whose
// chain-resolved landing currently exists → recovered by an in-place rewrite;
// a deleted landing keeps the finding for manual correction); P3 added range
// reconfirmation (reconfirmAnchors): when a reference with a line anchor has
// a target file with uncommitted differences in its owning (possibly nested)
// git repository, the HEAD version's and the current worktree version's line
// slices of the same range are compared, and on mismatch the original range
// stays with an @<sha> version marker appended in place (semantics: the range
// holds only for that historical version). The three layer hook points are
// governed by OPENCODE_AUTO_REF_CHECK (refcheck-scope-design D3, off by
// default = idle; the control points are in runner.ts/check.ts, and this
// layer's functions never see the switch).
import { mkdir, readdir, realpath, rm, stat } from "node:fs/promises"
import type { Stats } from "node:fs"
import { join, relative, sep, dirname } from "node:path"
import { physicalDir, repoRoots } from "./git"
import { log } from "./log"

// path = the referenced path after stripping the optional `@<sha>` version
// marker and the `:N` tail anchor; line = the tail anchor's line number (when
// present); ver = the `@<sha>` version marker (when present — a historical
// snapshot reference, exempt from the line-number cap check); at = the line
// number the reference sits on (1-based).
export type Ref = { path: string; line?: number; at: number; ver?: string }

// Candidate-line mask (single-pass state machine): lines inside ``` / ~~~
// fences are exempt, and so are lines carrying an inline exemption marker
// (REFCHECK_EXEMPT: deleted / archived / historical, whole words, any case) —
// references in code blocks and references declared stale take no part in
// extraction or rewriting; the fence lines themselves are exempt too.
// The markers are a protocol string (0035 §4 phase face), flipped from
// `已删除|已归档|历史` in M3.8 with no dual-read.
export const REFCHECK_EXEMPT = /\b(?:deleted|archived|historical)\b/i

function candidateMask(text: string): boolean[] {
  let fenced = false
  return text.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced
      return false
    }
    return !fenced && !REFCHECK_EXEMPT.test(line)
  })
}

// In-line reference tokens: the targets of backtick spans (`…`) and md links
// ([x](…)); a token appearing multiple times is taken once (the extraction's
// purpose is a path list, not an occurrence list).
function tokensOf(line: string): string[] {
  const tokens = new Set<string>()
  for (const span of line.matchAll(/`([^`]+)`/g)) tokens.add(span[1]!)
  for (const link of line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) tokens.add(link[1]!)
  return [...tokens]
}

// Tail-anchor parsing (refcheck-scope P3 §6, the order is not negotiable):
// strip the optional `@<sha>` version marker first (7-40 hex digits, a
// historical snapshot reference), then the `:N` / `:N-M` line anchor;
// anchorRaw keeps the original anchor text (the range-reconfirmation rewrite
// must keep the original range, it cannot be rebuilt from start/end).
function parseTail(token: string): { path: string; start?: number; end?: number; ver?: string; anchorRaw?: string } {
  let rest = token
  let ver: string | undefined
  const verMatch = /@([0-9a-f]{7,40})$/.exec(rest)
  if (verMatch) {
    ver = verMatch[1]!
    rest = rest.slice(0, -verMatch[0].length)
  }
  const anchor = /:(\d+(?:-\d+)*)$/.exec(rest)
  const path = anchor ? rest.slice(0, -anchor[0].length) : rest
  if (!anchor) return ver ? { path, ver } : { path }
  const nums = anchor[1]!.split("-").map(Number)
  return { path, start: nums[0]!, end: nums[nums.length - 1]!, ver, anchorRaw: anchor[1]! }
}

// Extraction rules (P1 plan §4.2): a candidate line's token, after stripping
// the optional tail anchor, must contain no whitespace and "contain / or
// contain ." (path-shaped) to count as a reference; tail anchors see parseTail
// (a line range's line takes the upper bound — existence checks need no line
// number, the line-number cap check judges overflow by the largest line
// number).
export function extractRefs(text: string): Ref[] {
  const refs: Ref[] = []
  const mask = candidateMask(text)
  text.split("\n").forEach((line, i) => {
    if (!mask[i]) return
    for (const token of tokensOf(line)) {
      const parsed = parseTail(token)
      if (/\s/.test(parsed.path) || (!parsed.path.includes("/") && !parsed.path.includes("."))) continue
      const ref: Ref = { path: parsed.path, at: i + 1 }
      if (parsed.end !== undefined) ref.line = parsed.end
      if (parsed.ver !== undefined) ref.ver = parsed.ver
      refs.push(ref)
    }
  })
  return refs
}

// Mechanical rewrite: each pair is replaced via a whole-path word-boundary
// regex and counted (prevents docs/T-1.md matching docs/T-11.md, prevents
// truncated half-paths); likewise acts only on candidate lines (fence and
// marker lines exempt). Typographic invariant (2026-09-08 requirement
// addendum): a rewrite never touches document typography — only the matched
// token itself is replaced in place, and line structure/whitespace/table
// alignment/trailing newline are all preserved as-is; with no hits (count=0)
// the output is byte-identical to the input (the caller does not write back,
// the file stays as it was).
export function rewriteRefs(text: string, pairs: Array<{ old: string; new: string }>): { text: string; count: number } {
  const lines = text.split("\n")
  const mask = candidateMask(text)
  let count = 0
  for (const pair of pairs) {
    const pattern = new RegExp(`(?<![-\\w./\\\\])${escapeRegexp(pair.old)}(?![\\w./\\\\-])`, "g")
    lines.forEach((line, i) => {
      if (!mask[i]) return
      lines[i] = line.replace(pattern, () => {
        count++
        return pair.new
      })
    })
  }
  return { text: lines.join("\n"), count }
}

function escapeRegexp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// —— P4: live-document enumeration and validation ——
// Live-document scope (stable-refs §3.3): docs/**/*.md — the phase
// directories' handovers, artifacts, task index tasks.md and todo.md/done.md,
// task units, plus the round's phase index phases.md; the sort keeps scans
// and log output deterministic.
export async function activeDocs(dir: string): Promise<string[]> {
  const files: string[] = []
  for await (const file of new Bun.Glob(join("docs", "**", "*.md")).scan({ cwd: dir, onlyFiles: true })) {
    files.push(file.split(/[\\/]/).join("/"))
  }
  return files.sort()
}

// Whether a reference has a checkable shape: §3.2's only legal shape is a
// path relative to the target directory root — references outside it (URL
// scheme: form, Windows drive letters included; absolute and ~/ prefixed;
// ./ and ../ relative shapes) are neither checked nor reported;
// path-shaped is also required — containing / or a letter-led extension
// (guards against false positives on version numbers like `v1.2`, `3.10`).
function checkable(path: string): boolean {
  if (path.startsWith("/") || path.startsWith("\\") || path.startsWith("~")) return false
  if (path.startsWith("./") || path.startsWith("../")) return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false
  if (path.includes("/")) return true
  return /\.[A-Za-z][A-Za-z0-9]*$/.test(path)
}

// One stale reference: file/line/text = the referencing document and line
// (the original text), path = the referenced path, problem = the path does
// not exist (missing) or the line number exceeds the file's total line count
// (beyond-eof).
export type RefFinding = { file: string; line: number; text: string; path: string; problem: "missing" | "beyond-eof" }

// Directory file index (built lazily, reused for a whole scan): the full
// list of files and directories of the target directory tree; node_modules
// and .git are pruned without descending (huge, and duplicate paths would
// break the uniqueness decision). Symlinked directories are descended as
// usual (migration projects often mount reference source trees via symlinks,
// e.g. linux → …), with a realpath set guarding against symlink cycles and
// repeated descents. Used to resolve contextual relative references — a
// reference is often written relative to the referencing document's
// directory or the reference tree's root, and resolving it directly against
// the target directory root would misjudge it missing; directory references
// (trailing /) match only among directory entries, file references are not
// shape-restricted (a file and a directory of the same name never coexist
// at one path; cross-shape ambiguity is treated as missing via multi-match).
type IndexEntry = { path: string; dir: boolean }

class FileIndex {
  private files: Promise<IndexEntry[]> | undefined

  constructor(private dir: string) {}

  list(): Promise<IndexEntry[]> {
    this.files ??= walkTree(this.dir).then((entries) => entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)))
    return this.files
  }

  // Batch resolution: one pass over the index, intersecting the target set
  // with each entry's segment-boundary suffixes enumerated from the last
  // segment backwards — total cost O(index entries × average segments), far
  // better than a per-target full-table filter when the reference count is
  // large (O(references × files)). Only uniquely hit targets are kept
  // (multi-match is contextual ambiguity, left to the caller to treat as
  // missing); a target with a trailing `/` matches only among directory
  // entries. The same target with and without the trailing slash lands under
  // one key (value array), avoiding mutual overwrite.
  async resolveAll(targets: string[]): Promise<Map<string, IndexEntry>> {
    const lookup = new Map<string, Array<{ target: string; dirOnly: boolean }>>()
    for (const target of targets) {
      const key = `/${target.replace(/\/$/, "")}`
      const item = { target, dirOnly: target.endsWith("/") }
      const bucket = lookup.get(key)
      if (bucket) bucket.push(item)
      else lookup.set(key, [item])
    }
    const found = new Map<string, IndexEntry[]>()
    for (const entry of await this.list()) {
      const segs = entry.path.split("/")
      let suffix = ""
      for (let i = segs.length - 1; i >= 0; i--) {
        suffix = `/${segs[i]!}${suffix}`
        const items = lookup.get(suffix)
        if (!items) continue
        for (const { target, dirOnly } of items) {
          if (dirOnly && !entry.dir) continue
          const bucket = found.get(target)
          if (bucket) bucket.push(entry)
          else found.set(target, [entry])
        }
      }
    }
    const resolved = new Map<string, IndexEntry>()
    for (const [target, hits] of found) if (hits.length === 1) resolved.set(target, hits[0]!)
    return resolved
  }
}

async function walkTree(dir: string, base = "", visited?: Set<string>): Promise<IndexEntry[]> {
  const seen = visited ?? new Set<string>()
  const out: IndexEntry[] = []
  for (const entry of await readdir(join(dir, base), { withFileTypes: true }).catch(() => [])) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    if (entry.name === "node_modules" || entry.name === ".git") continue
    // Regular directories/files are taken straight from the Dirent; a symlink
    // needs a following stat to decide the target's shape (Dirent always
    // reports isSymbolicLink for symlinks), and before descending into a
    // directory its realpath is checked against visited to prevent cycles
    // and repeats.
    if (entry.isDirectory()) {
      await descend(dir, rel, seen, out)
    } else if (entry.isFile()) {
      out.push({ path: rel, dir: false })
    } else if (entry.isSymbolicLink()) {
      const info = await stat(join(dir, rel)).catch(() => undefined)
      if (info?.isDirectory()) await descend(dir, rel, seen, out)
      else if (info?.isFile()) out.push({ path: rel, dir: false })
    }
  }
  return out
}

async function descend(dir: string, rel: string, seen: Set<string>, out: IndexEntry[]): Promise<void> {
  const real = await realpath(join(dir, rel)).catch(() => undefined)
  if (!real || seen.has(real)) return
  seen.add(real)
  out.push({ path: rel, dir: true })
  out.push(...(await walkTree(dir, rel, seen)))
}

// Validate a set of references (§3.2 validation semantics: the path exists;
// the line number ≤ the file's total line count). Path resolution is two
// steps: a target-directory-root-relative direct hit is valid; otherwise find
// the unique file match in the directory tree having the path as a
// segment-boundary suffix — a unique hit counts as valid and resolves to the
// matched file for the line-number check (contextual relative references,
// especially non-docs ones; multi-match is contextual ambiguity, treated as
// missing). Duplicate paths within one document are validated once; an md
// link's #fragment tail anchor is stripped before validating; directory
// references get only an existence check (a line anchor is meaningless for a
// directory, ignored). index lets the scan entry point reuse it across
// documents (built by default, lazily).
// Validate a set of references (§3.2 validation semantics: the path exists;
// the line number ≤ the file's total line count). Path resolution is two
// steps: a target-directory-root-relative direct hit is valid; otherwise find
// the unique file match in the directory tree having the path as a
// segment-boundary suffix — a unique hit counts as valid and resolves to the
// matched file for the line-number check (contextual relative references,
// especially non-docs ones; multi-match is contextual ambiguity, treated as
// missing). resolved is the resolution-result table shared across documents
// (target → resolved path or undefined, direct hits included; precomputed in
// one batch pass by scanRefs, avoiding a per-document repeat of the
// full-index resolution — when the table lacks an entry it falls back to
// resolving here). Duplicate paths within one document are validated once; an
// md link's #fragment tail anchor is stripped before validating; directory
// references get only an existence check (a line anchor is meaningless for a
// directory, ignored). A reference with ver (an `@<sha>` version marker)
// counts as a historical snapshot reference — only the path's existence is
// checked, the line-number cap check is exempt (a historical version cannot
// be mechanically checked, refcheck-scope P3 §6). index is reused for the
// no-table fallback resolution (built by default, lazily).
export async function validateRefs(
  dir: string,
  refs: Ref[],
  index = new FileIndex(dir),
  resolved?: Map<string, string | undefined>,
): Promise<Map<string, "missing" | "beyond-eof">> {
  const problems = new Map<string, "missing" | "beyond-eof">()
  const paths = [...new Set(refs.filter((ref) => checkable(ref.path)).map((ref) => ref.path))]
  // Step one: locate each target's landing (direct hit / unique resolution / missing).
  const where = new Map<string, string>()
  const missing = new Set<string>()
  for (const path of paths) {
    const target = path.split("#")[0]!
    if (resolved?.has(target)) {
      const hit = resolved.get(target)
      if (hit) where.set(target, hit)
      else missing.add(target)
      continue
    }
    const direct = await stat(join(dir, target)).catch(() => undefined)
    if (direct) {
      where.set(target, target)
      continue
    }
    const hit = (await index.resolveAll([target])).get(target)
    if (hit) where.set(target, hit.path)
    else missing.add(target)
  }
  // Step two: classify each target — landing existence and the line-number
  // cap (directory references get only the existence check).
  for (const path of paths) {
    const target = path.split("#")[0]!
    const at = where.get(target)
    if (!at) {
      if (missing.has(target)) problems.set(path, "missing")
      continue
    }
    const info = await stat(join(dir, at)).catch(() => undefined)
    if (!info) {
      problems.set(path, "missing")
      continue
    }
    if (!info.isFile()) continue
    const anchors = refs.filter((item) => item.path === path && item.line !== undefined && item.ver === undefined)
    if (!anchors.length) continue
    const text = await Bun.file(join(dir, at)).text().catch(() => "")
    const lines = text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0)
    if (anchors.some((anchor) => anchor.line! > lines)) problems.set(path, "beyond-eof")
  }
  return problems
}

// Scan a set of documents (docs defaults to all live documents): first pool
// every document's checkable targets, then after the direct-hit decision run
// one resolveAll batch resolution (the result table is shared across
// documents, the index is traversed exactly once for the whole scan), then
// validate each document's references and produce the findings.
export async function scanRefs(dir: string, docs?: string[]): Promise<RefFinding[]> {
  const files = docs ?? (await activeDocs(dir))
  const index = new FileIndex(dir)
  const scanned: Array<{ file: string; text: string; refs: Ref[] }> = []
  const targets = new Set<string>()
  for (const file of files) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const refs = extractRefs(text)
    if (!refs.length) continue
    scanned.push({ file, text, refs })
    for (const ref of refs) {
      if (checkable(ref.path)) targets.add(ref.path.split("#")[0]!)
    }
  }
  const resolved = new Map<string, string | undefined>()
  const unresolved: string[] = []
  for (const target of targets) {
    if (await stat(join(dir, target)).catch(() => undefined)) resolved.set(target, target)
    else unresolved.push(target)
  }
  const hits = await index.resolveAll(unresolved)
  // Unhit targets (multi-match ambiguity included) are explicitly recorded
  // as undefined = classified missing, preventing a consumer's fallback
  // self-check from re-triggering a full-index traversal.
  for (const target of unresolved) resolved.set(target, hits.get(target)?.path)
  const findings: RefFinding[] = []
  for (const { file, text, refs } of scanned) {
    const problems = await validateRefs(dir, refs, index, resolved)
    if (!problems.size) continue
    const lines = text.split("\n")
    for (const ref of refs) {
      const problem = problems.get(ref.path)
      if (problem) findings.push({ file, line: ref.at, text: lines[ref.at - 1]!.trim(), path: ref.path, problem })
    }
  }
  return findings
}

// —— P4: git rename pairing and pre-commit auto-correct ——
// Whether the target directory is inside a git repository (check reports a
// note for non-git directories: auto-correct unavailable).
export async function gitAvailable(dir: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(["git", "-C", dir, "rev-parse", "--is-inside-work-tree"], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    return (await proc.exited) === 0 && out.trim() === "true"
  } catch {
    return false
  }
}

// git rename pairing (§4.5): index vs HEAD — worktree changes are staged
// through git add -A first so untracked new paths take part in rename
// pairing (the driver's next unified commit adds everything anyway, staging
// changes nothing about its result); the output is converted to
// target-directory-relative paths. A non-git directory / no HEAD (an empty
// repository) / git unavailable returns [].
export async function renamePairs(dir: string): Promise<Array<{ old: string; new: string }>> {
  const top = (await gitOut(dir, ["rev-parse", "--show-toplevel"]))?.trim()
  if (!top) return []
  const phys = await physicalDir(dir)
  if ((await gitRun(dir, ["add", "-A", "--", "."])).code !== 0) return []
  const out = await gitOut(dir, ["diff", "--cached", "--find-renames", "--diff-filter=R", "--name-status", "-z", "HEAD"])
  if (!out) return []
  const parts = out.split("\0")
  const pairs: Array<{ old: string; new: string }> = []
  for (let i = 0; i < parts.length - 2; i++) {
    if (!parts[i]!.startsWith("R")) continue
    const oldRel = relative(phys, join(top, parts[i + 1]!))
    const newRel = relative(phys, join(top, parts[i + 2]!))
    if (oldRel.startsWith("..") || newRel.startsWith("..")) continue
    pairs.push({ old: oldRel.split(sep).join("/"), new: newRel.split(sep).join("/") })
  }
  return pairs
}

// —— refcheck-scope P2: the rename history map and missing-reference recovery (§4) ——
// The rename history map (D5's deterministic criterion: "once appeared" =
// the path once existed in the owning git repository's history): the target
// repository and each nested sub-repository run git log --find-renames
// --diff-filter=R --name-status --format= -z; traversed newest→oldest with
// first-appearance priority, the old→new direct edges fall out, then chain
// resolution reaches the final landing (visited guards against cycles; if a
// landing reached through cyclic or other pathological history no longer
// exists, the caller's existence check keeps the finding as a backstop);
// paths are converted to target-directory-relative, paths outside the
// directory tree are dropped. Keys and values are both
// target-directory-relative paths (old → final landing).
export async function renameHistory(dir: string): Promise<Map<string, string>> {
  const edges = new Map<string, string>()
  const phys = await physicalDir(dir)
  for (const root of await repoRoots(dir)) {
    const top = (await gitOut(root, ["rev-parse", "--show-toplevel"]))?.trim()
    if (!top) continue
    const out = await gitOut(root, ["log", "--find-renames", "--diff-filter=R", "--name-status", "--format=", "-z"])
    if (!out) continue
    const parts = out.split("\0")
    for (let i = 0; i < parts.length - 2; i++) {
      if (!parts[i]!.startsWith("R")) continue
      const oldRel = relative(phys, join(top, parts[i + 1]!)).split(sep).join("/")
      const newRel = relative(phys, join(top, parts[i + 2]!)).split(sep).join("/")
      if (oldRel.startsWith("..") || newRel.startsWith("..")) continue
      if (!edges.has(oldRel)) edges.set(oldRel, newRel)
    }
  }
  const history = new Map<string, string>()
  for (const old of edges.keys()) {
    const visited = new Set<string>([old])
    let current = old
    while (true) {
      const next = edges.get(current)
      if (!next || visited.has(next)) break
      visited.add(next)
      current = next
    }
    if (current !== old) history.set(old, current)
  }
  return history
}

// Missing-reference recovery (§4, confirm stale first, recover after — the
// order is not negotiable): each finding with problem: "missing" is
// classified — the rename history map holds the target as an old and the
// chain landing currently exists → rewriteRefs recovers it by an in-place
// rewrite (typographic invariant); the landing is deleted (or never existed
// in history) → the finding stays, entering the stale list for manual
// correction. Only staleness caused by "move/rename" is recovered; deletion
// and semantic change are not auto-recovered (§8 boundary). Minimal scope:
// only that path token in the document holding the confirmed-stale reference
// is rewritten, other documents are untouched. Returns the number of
// rewrites (0 = no recovery this round).
async function recoverMissingRefs(dir: string, findings: RefFinding[]): Promise<number> {
  const missing = findings.filter((finding) => finding.problem === "missing")
  if (!missing.length) return 0
  const history = await renameHistory(dir)
  if (!history.size) return 0
  const byFile = new Map<string, Array<{ old: string; new: string }>>()
  for (const finding of missing) {
    const target = finding.path.split("#")[0]!
    const landing = history.get(target)
    if (!landing) continue
    if (!(await stat(join(dir, landing)).catch(() => undefined))) continue
    const pairs = byFile.get(finding.file) ?? []
    if (!pairs.some((pair) => pair.old === target)) pairs.push({ old: target, new: landing })
    byFile.set(finding.file, pairs)
  }
  let rewritten = 0
  for (const [file, pairs] of byFile) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    const { text: out, count } = rewriteRefs(text, pairs)
    if (count > 0) {
      await Bun.write(join(dir, file), out)
      rewritten += count
    }
  }
  return rewritten
}

// —— refcheck-scope P3: reference range reconfirmation (§6, line anchors + @sha version markers) ——
// Subject: references in live documents carrying a line anchor (`:N` /
// `:N-M`) and no version marker, whose target file "has been edited" —
// criterion = the target file has uncommitted content differences in its
// owning (possibly nested) git repository (`git diff HEAD --name-only`;
// renamePairs already staged with `git add -A`, so the index is the full
// change set; nested sub-repositories are judged one by one, mirroring
// git.ts's nested-first traversal for the unified commit). Target resolution
// is the same two steps as validateRefs (direct hit / segment-boundary
// suffix unique match).
// Consistency decision = the target file's HEAD-version line slice of the
// range vs the current worktree version's slice of the same range (the
// current file having too few lines already counts as inconsistent):
//   consistent → the reference stays untouched;
//   inconsistent → the original reference range stays unchanged and the
//   anchor is rewritten in place to `path:N-M@<sha>` (sha = the owning
//   repository's current HEAD short hash, 7 digits) — semantics: the range
//   holds only for that historical version, whose later content has changed.
// Idempotent: a reference already carrying `@sha` gets no marker appended or
// updated, left for manual correction; HEAD holding no version of the file
// (a file added this round) has no historical version to pin and is skipped.
// Typographic invariant as in rewriteRefs (no hits, no write-back). Returns
// the number of rewrites (0 = no reconfirmation this round).
export async function reconfirmAnchors(dir: string): Promise<number> {
  // Per repository: the changed-file set (target-directory-relative) and the
  // HEAD short hash; no git / no HEAD / no changes → skipped
  const repos: Array<{ top: string; sha: string; changed: Set<string> }> = []
  const phys = await physicalDir(dir)
  for (const root of await repoRoots(dir)) {
    const top = (await gitOut(root, ["rev-parse", "--show-toplevel"]))?.trim()
    if (!top) continue
    const out = await gitOut(root, ["diff", "HEAD", "--name-only", "-z"])
    const sha = (await gitOut(root, ["rev-parse", "--short=7", "HEAD"]))?.trim()
    if (!out || !sha) continue
    const changed = new Set<string>()
    for (const part of out.split("\0")) {
      if (!part) continue
      const rel = relative(phys, join(top, part)).split(sep).join("/")
      if (!rel.startsWith("..")) changed.add(rel)
    }
    if (changed.size) repos.push({ top, sha, changed })
  }
  if (!repos.length) return 0
  const index = new FileIndex(dir)
  let rewritten = 0
  for (const file of await activeDocs(dir)) {
    const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
    if (text === undefined) continue
    // Candidates: checkable references carrying a line anchor and no version
    // marker (anchorRaw keeps the original range text for the rewrite)
    const candidates: Array<{ path: string; start: number; end: number; anchorRaw: string }> = []
    const mask = candidateMask(text)
    text.split("\n").forEach((line, i) => {
      if (!mask[i]) return
      for (const token of tokensOf(line)) {
        const parsed = parseTail(token)
        if (parsed.start === undefined || parsed.end === undefined || parsed.ver !== undefined) continue
        if (!checkable(parsed.path)) continue
        candidates.push({ path: parsed.path, start: parsed.start, end: parsed.end, anchorRaw: parsed.anchorRaw! })
      }
    })
    if (!candidates.length) continue
    const pairs: Array<{ old: string; new: string }> = []
    const seen = new Set<string>()
    for (const ref of candidates) {
      const target = ref.path.split("#")[0]!
      let at: string | undefined
      const direct = await stat(join(dir, target)).catch(() => undefined)
      if (direct) {
        if (!direct.isFile()) continue // a directory reference has no line semantics
        at = target
      } else {
        const hit = (await index.resolveAll([target])).get(target)
        if (!hit || hit.dir) continue
        at = hit.path
      }
      const repo = repos.find((item) => item.changed.has(at))
      if (!repo) continue
      const work = await Bun.file(join(dir, at)).text().catch(() => undefined)
      if (work === undefined) continue
      // repo.top is physical (git output) while dir may reach it through a
      // symlink — join the canonicalized dir so the HEAD: pathspec names the
      // same file git itself would (physicalDir, same reasoning as above).
      const head = await gitOut(repo.top, ["show", `HEAD:${relative(repo.top, join(phys, at)).split(sep).join("/")}`])
      if (head === undefined) continue // HEAD lacks the file (added this round) → no version to pin
      const workLines = work.split("\n")
      const headLines = head.split("\n")
      // The current file having too few lines already counts as
      // inconsistent; consistent (the same-range line slices match line by
      // line) → the reference stays untouched
      const consistent =
        workLines.length >= ref.end &&
        headLines.length >= ref.end &&
        workLines.slice(ref.start - 1, ref.end).join("\n") === headLines.slice(ref.start - 1, ref.end).join("\n")
      if (consistent) continue
      const token = `${ref.path}:${ref.anchorRaw}`
      if (seen.has(token)) continue
      seen.add(token)
      pairs.push({ old: token, new: `${token}@${repo.sha}` })
    }
    if (!pairs.length) continue
    const { text: out, count } = rewriteRefs(text, pairs)
    if (count > 0) {
      await Bun.write(join(dir, file), out)
      rewritten += count
    }
  }
  return rewritten
}

async function gitRun(dir: string, args: string[]): Promise<{ code: number; out: string }> {
  try {
    const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    return { code: await proc.exited, out }
  } catch {
    return { code: 1, out: "" }
  }
}

async function gitOut(dir: string, args: string[]): Promise<string | undefined> {
  const run = await gitRun(dir, args)
  return run.code === 0 ? run.out : undefined
}

// —— One-shot warning registry (list-style dedup, shared by the
// stale-reference list and the migration skip list) ——
// Key = stable identity (nothing that drifts with edits, like line numbers
// or original text). Each round rewrites the list file wholesale from
// entries — fixed entries drop out automatically, a recurrence counts as
// newly appearing; newly appearing keys log ⚠ (silently registered when warn
// is absent), already-recorded keys are not warned twice. Empty entries
// deletes the list file.
export async function recordOnce(
  dir: string,
  file: string,
  header: string,
  entries: Array<{ key: string; warn?: string }>,
): Promise<void> {
  const text = await Bun.file(join(dir, file)).text().catch(() => "")
  const known = new Set(text.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2)))
  for (const entry of entries) {
    if (entry.warn && !known.has(entry.key)) log(`  ⚠ ${entry.warn}`)
  }
  if (entries.length) {
    await mkdir(join(dir, dirname(file)), { recursive: true })
    const body = [...new Set(entries.map((entry) => entry.key))].sort().map((key) => `- ${key}`).join("\n")
    await Bun.write(join(dir, file), `${header}${body}\n`)
  } else {
    await rm(join(dir, file), { force: true })
  }
}

// —— The stale-reference list (.auto/invalid-refs.md) ——
// Key = `file → path(problem)`: no line number or original text (they drift
// with edits, unusable as identity). The list is rewritten wholesale each
// round from the current findings — fixed entries drop out automatically, a
// recurrence counts as newly appearing; already-recorded keys get no more ⚠,
// and the warning log goes only to newly appearing stale references (no
// endless re-reporting; human verification and correction enter through this
// list).
const INVALID_REFS_FILE = join(".auto", "invalid-refs.md")

function invalidRefKey(finding: RefFinding): string {
  return `${finding.file} → ${finding.path}(${finding.problem})`
}

function problemLabel(problem: "missing" | "beyond-eof"): string {
  return problem === "beyond-eof" ? "line beyond end of file" : "path not found"
}

async function recordInvalidRefs(dir: string, findings: RefFinding[]): Promise<void> {
  await recordOnce(
    dir,
    INVALID_REFS_FILE,
    "# Stale references (maintained by auto for manual review and correction; listed entries are not warned again and drop out once fixed)\n",
    findings.map((finding) => ({
      key: invalidRefKey(finding),
      warn: `stale reference ${finding.file}:${finding.line} → ${finding.path} (${problemLabel(finding.problem)}): ${finding.text}`,
    })),
  )
}

// Pre-commit auto-correct (D6's first layer, hooked at runner's
// afterSession — covering every unified commit): renamePairs → mechanical
// rewrite of live documents (rename pairs only; deletion/semantic change is
// not auto-corrected, see the §8 boundary) → re-scan findings →
// missing-reference recovery (refcheck-scope P2: missing entries trace the
// landing through the git-history rename map and are recovered by an
// in-place rewrite; after recovery, another re-scan) → range reconfirmation
// (refcheck-scope P3: an inconsistent line anchor on a changed file gets an
// @<sha> version marker appended, and after the rewrite another re-scan — a
// marked historical snapshot reference is exempt from the line-number cap
// check and no longer enters the stale list) → record the stale list
// .auto/invalid-refs.md (only unrecovered stale references are registered;
// already-recorded keys get no more ⚠, the warning log goes only to newly
// appearing stale references), ending at this log (a lenient contract).
// Returns the re-scanned findings (after recovery and reconfirmation).
export async function autoCorrectRefs(dir: string): Promise<RefFinding[]> {
  const pairs = await renamePairs(dir)
  if (pairs.length) {
    let rewritten = 0
    for (const file of await activeDocs(dir)) {
      const text = await Bun.file(join(dir, file)).text().catch(() => undefined)
      if (text === undefined) continue
      const { text: out, count } = rewriteRefs(text, pairs)
      if (count > 0) {
        await Bun.write(join(dir, file), out)
        rewritten += count
      }
    }
    if (rewritten) log(`  ↻ reference auto-correct: ${pairs.length} rename pair(s), rewrote ${rewritten} reference(s) in live documents`)
  }
  let findings = await scanRefs(dir)
  const recovered = await recoverMissingRefs(dir, findings)
  if (recovered) {
    log(`  ↻ missing-reference recovery: rewrote ${recovered} reference(s) by tracing git history`)
    findings = await scanRefs(dir)
  }
  const reconfirmed = await reconfirmAnchors(dir)
  if (reconfirmed) {
    log(`  ↻ reference range reconfirmation: appended an @sha version marker to ${reconfirmed} line anchor(s) (the range holds only for the marked historical version)`)
    findings = await scanRefs(dir)
  }
  await recordInvalidRefs(dir, findings)
  return findings
}
