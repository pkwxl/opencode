// The sealed reference wall (plans/0132): the cleanroom wall closes as a
// machine boundary at the person's transfer. The 2026-10-26 aster-mig audit
// measured the wall advisory — the reference door (a git-tracked root
// symlink) present and resolving past the seal, the admitting surface the
// person's own external_directory allow on the corpus realpath, the
// enforcement primitive 0122 already measured (a read of an out-of-tree path
// without an allow denies in unattended runs) — and this module is the close:
//
//   D1  the `Wall:` field on a phase type document declares the wall (the
//       sealing semantics in the bundle, the door names a person-owned fill
//       at materialization — src/phases/custom.ts); absent field, none of
//       this exists anywhere (the P10 floor, tested as behavior);
//   D2  the close, at any transfer whose source phase is at or after the
//       sealing phase while the wall derives open: the admission scan
//       (read-only) → one wall commit (the door removal and, since
//       plans/0138 made opencode.json a committed surface, the retirement
//       write whenever git tracks the file — the atomic seal; the record
//       lines below remain the door→target ledger, the standing deny's
//       tracked twin when the file is a person-kept local one) → the
//       transition commit. The closed predicate is re-derived from disk
//       and git at every boundary: the wall is closed iff the door is
//       absent and no live external_directory entry covers the recorded
//       target — the allow is the wall, the door a convenience. The driver
//       retires only the allows it stamped itself (0122's exact bytes); a
//       person-authored covering entry is a blocking finding that names
//       the entry, and the close stamps a standing deny on the recorded
//       target. Plans/0190 D1 adds the close's one agent gate: the deny
//       reaches sessions only through an agent that carries the
//       external_directory posture into them, so a fleet that carries it
//       nowhere refuses the close ahead of every mutating step.
//       Plans/0189 amends the enactment shape on four points: the close
//       still rides the person's advance path alone, and every OTHER
//       handover path whose phase meets the seal threshold HOLDS there,
//       naming transfer (D1 — the 0132×0101 meeting: flow and the plain-run
//       re-entry once closed the phase with the door open, silently); the
//       interrupted-close recovery adopts only targets git can prove were
//       doors, never a live allow's base (D2); the predicate reads every
//       re-admission channel — any in-tree symlink resolving (or, dangling,
//       pointing) under or over a recorded target, and the coverage
//       evaluated with opencode's own semantics (D3); a sealing phase's
//       gates are checked read-only ahead of the wall (D4, loop-phase).
//   D3  the admission instrument is 0121's divergence lane (a regression-cost
//       row), run fresh over the tree about to go clean — private
//       identifiers are hard findings and block; post-wall the same class
//       blocks at every phase close (0121 D5's verdict contract inherited
//       verbatim: a scan failure is a red lane, exclusions are
//       person-declared, no agent approves its own exception);
//   D4  the vetted channel (the sealing phase's artifacts, recorded in the
//       wall commit) joins protect's declared read-only set; violation
//       detection is one assertion — a driver commit touching a sealed path
//       since the wall commit — covering the edit, the direct write, the
//       rename and git surgery identically. A person commit is the one
//       recorded exception: the monitor-mediated amendment, visible in the
//       diff against the wall commit;
//   D6  no registry, no flag: every input is disk (the door, the live
//       allows) or git (the wall commit's record) — a 0128 fork derives its
//   wall state for free from its own history.
//
// What this does not claim: the weights channel (pretrained recall) is
// asserted, not measured — the sealed-fork rerun is its named measurement;
// `git show` of pre-wall history is one routine command (zero for projects
// that start under the wall); and protect's own words bound the tamper
// claim — workflow enforcement and detection, never resistance. "Enforced /
// found / disposed, never the proven absence of transliteration" (0121's
// phrasing, inherited).
import { readdir, realpath, readlink, rm, stat } from "node:fs/promises"
import { dirname, join, relative, resolve, sep } from "node:path"
import { taskDir } from "./docpaths"
import { admittingCoverage, boundaryAllowedTargets, externalDirectoryLive, isBoundaryKey, OPENCODE_CONFIG_FILE, pathsOverlap, rootSymlinkDoors, stampKey, stampWallClosure } from "./external-dirs"
import { firstLine, git, scriptGuardSnapshot, type GitOps, driverStage } from "./git"
import { allowWrite, protectAdditional, reprotect } from "./protect"
import { loadPhaseTypes } from "./phases/custom"
import { phaseArtifacts, phaseTitle, readPhases, type PhaseUnit } from "./phases"
import { unitArtifactSpecs } from "./phases/registry"
import { parseTestLanes } from "./intent/test-lanes"
import { log } from "./log"
import { promptFacts } from "./prompt-facts"
import { shellProfile } from "./shell"
import {
  commitPendingReceipts,
  newestGreenReceipt,
  regressionInFlight,
  regressionLanes,
  roundNumberOf,
  runRegressionLane,
} from "./regression"
import { loadPlan } from "./tasks"

// One recorded door of the wall commit: the symlink's name and the resolved
// real path it admitted. The name "(removed)" marks a target recovered from
// a driver-stamped allow by pre-0189 closes (which knew no door name to
// re-create); since plans/0189 D2 the recovery derives the name from git and
// new records carry the real one — the door half of the closed predicate
// reads resolutions against the recorded targets, so both spellings guard
// identically.
export type WallDoor = { name: string; target: string }

// The wall commit's record (plans/0132 D2/D4): the newest commit carrying
// `Auto-Stage: wall`, its message parsed back — the doors with their
// resolved targets (what the retiring allows admitted; the door→target
// ledger, redundant with the tracked standing deny since plans/0190 lands
// the file in the same commit, the only tracked copy when the person keeps
// the file local) and the sealed channel frozen at the wall (protect's
// declared set, the one diff-check's scope).
export type WallRecord = { sha: string; doors: WallDoor[]; sealed: string[] }

const WALL_STAGE_LINE = "Auto-Stage: wall"

// What the boundary and the close need from the run's context — LoopCtx
// satisfies it structurally (RunAllOpts carries the lane timings and the
// stop condition; the wall's own gate is the stopBefore "formulate" that
// names the person's advance path). pollMs rides for the watchdog's poll
// cadence like the regression lane's own opts.
export type WallCtx = {
  directory: string
  git: Pick<GitOps, "commitTree">
  opts: { stopBefore?: string; dryrun?: boolean; intent?: string; idleMs?: number; maxMs?: number; pollMs?: number }
  // false = no agent of the run's fleet carries opencode.json's
  // external_directory posture into its sessions (plans/0190 D1): the
  // standing deny the close records would reach no session, so the close
  // refuses. Absent = the fleet carries it (LoopCtx's own floor).
  externalDirectory?: false
}

// The newest wall commit, read as a stream and stopped at the first hit
// (driverBaseline's shape): each NUL-terminated record is "<sha> <body>".
// undefined when the history holds none (the wall never closed — a pre-seal
// or never-closed project) or the directory is not a repository (the commit
// side idles there, and so does the predicate).
export async function findWallCommit(dir: string): Promise<WallRecord | undefined> {
  const proc = Bun.spawn(["git", "-C", dir, "log", "-z", "--format=%H %B", "HEAD"], {
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  })
  let found: WallRecord | undefined
  const inspect = (entry: string): boolean => {
    const sha = entry.slice(0, entry.indexOf(" ")).trim()
    if (!sha) return true
    const body = entry.slice(entry.indexOf(" ") + 1)
    if (!body.split("\n").some((line) => line.trim() === WALL_STAGE_LINE)) return true
    const doors = [...body.matchAll(/^Wall-door: (.+?) -> (.+)$/gm)].map((m) => ({ name: m[1]!, target: m[2]! }))
    const sealed = [...body.matchAll(/^Wall-sealed: (.+)$/gm)].map((m) => m[1]!)
    found = { sha, doors, sealed }
    return false
  }
  const reader = proc.stdout.getReader()
  const decode = new TextDecoder()
  let carry = ""
  try {
    while (found === undefined) {
      const { done, value } = await reader.read()
      if (done) break
      carry += decode.decode(value, { stream: true })
      const entries = carry.split("\0")
      carry = entries.pop() ?? ""
      if (!entries.every(inspect)) break
    }
    if (found === undefined && carry.trim()) inspect(carry)
  } finally {
    await reader.cancel().catch(() => {})
    proc.kill()
    await proc.exited
  }
  return found
}

// Whether the project declares a wall at all — any phase type carrying the
// `Wall:` field (D1). The one cheap floor gate every wall entry passes
// first: an undeclared project never reads git for the wall, never scans a
// lane, never writes an entry.
export function wallDeclared(dir: string): boolean {
  return loadPhaseTypes(dir).some((entry) => entry.wall !== undefined)
}

// The sealing phase of the round sequence (D2's trigger): the first
// wall-carrying phase at-or-before the source phase in the round order —
// in the source's own round, the occurrence must sit at or before it (a
// later occurrence means the seal has not happened yet: pre-wall, the spec
// room reads lawfully); in an earlier round, any occurrence (the wall is
// already past its seal — the retrofit's rule). undefined = the source
// phase is pre-seal. Lenient on unreadable indexes: the handover routing
// owns the strict reads.
export async function wallSealingPhase(dir: string, phase: PhaseUnit): Promise<PhaseUnit | undefined> {
  const carries = (unit: PhaseUnit) => unit.entry.wall !== undefined
  const round = roundNumberOf(phase)
  const state = await readPhases(dir, round).catch(() => undefined)
  const own = state?.phases.findIndex((unit) => unit.id === phase.id) ?? -1
  if (state && own >= 0) {
    const atOrBefore = state.phases.slice(0, own + 1).find(carries)
    if (atOrBefore) return atOrBefore
  }
  for (let r = round - 1; r >= 1; r--) {
    const earlier = await readPhases(dir, r).catch(() => undefined)
    const found = earlier?.phases.find(carries)
    if (found) return found
  }
  return undefined
}

// —— The allow half of the predicate (D2) ——

async function opencodeText(dir: string): Promise<string | undefined> {
  return await Bun.file(join(dir, OPENCODE_CONFIG_FILE)).text().catch(() => undefined)
}

// —— The door half of the closed predicate (plans/0189 D3) ——
//
// The wall is open when any symlink in the tree re-admits a recorded
// target: tracked at any depth (git ls-files' mode-120000 set — the
// deliverable's own trees, P1: a session's `ln -s` reaches it through the
// unified commit) plus every top-level entry on disk (tracked or not — a
// hand re-create at the door's canonical place). A link counts by what it
// POINTS AT: its resolution when it resolves, or its text resolved
// lexically when it dangles (plans/0189 D5 — a door re-created toward a
// corpus mounted later reads open now, not when the mount arrives), under
// or over a recorded target (an ancestor symlink re-admits as surely as a
// door inside it: reads through `<ancestor>/<tail>/…` stay lexically
// in-tree). Deeper untracked symlinks stay the clean gates' and the
// admission scan's (dirt at every unit start, tracked through any commit).
async function trackedSymlinkPaths(dir: string): Promise<string[]> {
  const got = await git(dir, ["ls-files", "-s"])
  if (got.code !== 0) return []
  const out: string[] = []
  for (const line of got.out.split("\n")) {
    const tab = line.indexOf("\t")
    if (tab < 0 || !line.startsWith("120000 ")) continue
    out.push(line.slice(tab + 1))
  }
  return out
}

// What one symlink points at: its resolution when the target exists, else
// the link text resolved against the link's directory — the dangling door's
// named destination, read now instead of when the mount arrives.
async function symlinkResolution(full: string): Promise<string | undefined> {
  const real = await realpath(full).catch(() => undefined)
  if (real !== undefined) return real
  const text = await readlink(full).catch(() => undefined)
  return text === undefined ? undefined : resolve(dirname(full), text)
}

async function reachableDoors(dir: string, record: WallRecord): Promise<{ path: string; resolved: string; target: string }[]> {
  if (!record.doors.length) return []
  const paths = new Set(await trackedSymlinkPaths(dir))
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.isSymbolicLink()) paths.add(entry.name)
  }
  const open: { path: string; resolved: string; target: string }[] = []
  for (const path of paths) {
    const resolved = await symlinkResolution(join(dir, path))
    if (resolved === undefined) continue
    const door = record.doors.find((named) => pathsOverlap(resolved, named.target))
    if (door !== undefined) open.push({ path, resolved, target: door.target })
  }
  return open
}

// —— The allow half of the closed predicate (D2, evaluated since 0189 D3) ——
//
// The lexical `<path>/**` prefix scan is retired: coverage is judged with
// opencode's own semantics (admittingCoverage, oracle-pinned), and the
// winners split by hand — the exact stamp key is the driver's own slot
// (0122's bytes, re-derivable — the interrupted retirement to finish; an
// `ask` there is re-denied per 0155 D3), the knowledge boundary's canonical
// keys are never the person's (plans/0147), and every other winning entry is
// a person's (the driver never removes the person's words).
function openFindingsOf(text: string, targets: readonly string[]): { stamps: { target: string; key: string }[]; person: { target: string; key: string; action: string }[]; gone: string[] } {
  const live = externalDirectoryLive(text)
  const open = live === undefined ? [] : admittingCoverage(text, targets)
  const stamps: { target: string; key: string }[] = []
  const person: { target: string; key: string; action: string }[] = []
  const gone = new Set<string>()
  for (const finding of open) {
    if (finding.key === undefined) gone.add(finding.target)
    else if (finding.key === stampKey(finding.target)) stamps.push({ target: finding.target, key: finding.key })
    else if (!isBoundaryKey(live!, finding.key)) person.push({ target: finding.target, key: finding.key, action: finding.action })
  }
  return { stamps, person, gone: [...gone].sort() }
}

// The retirement write (D2): retire the driver-stamped allows and stamp the
// standing deny on every target — one idempotent write to opencode.json
// (chmod'd through protect's allowWrite while a run holds the file
// read-only). "" = clean; anything else is the blocking failure line.
async function retireAndDeny(dir: string, targets: readonly string[]): Promise<string> {
  const file = join(dir, OPENCODE_CONFIG_FILE)
  const text = await opencodeText(dir)
  if (text === undefined) return "" // no file: nothing to retire, the deny has nowhere to stand — the door removal is the wall
  const next = stampWallClosure(text, targets)
  if (next === undefined) {
    return `the wall cannot write ${OPENCODE_CONFIG_FILE}: the file is malformed or its permission shape cannot hold per-pattern entries — settle it by hand (retire the stamp allow(s), add the deny) and re-run`
  }
  if (next === text) return ""
  await allowWrite(file)
  await Bun.write(file, next)
  await reprotect(file)
  return ""
}

// —— The admission scan (D3) ——

const sameHeads = (a: readonly { root: string; sha: string }[], b: readonly { root: string; sha: string }[]): boolean =>
  a.length === b.length && a.every((head, i) => head.root === b[i]!.root && head.sha === b[i]!.sha)

// 0121's instrument at the wall's moments: every declared regression-cost
// lane green at exactly the current tree (a green receipt at the current
// HEADs is the scan of this tree; anything older re-runs — the carry-forward
// rule does not apply to admission, the room is about to go clean). Red
// blocks (0121 D5's contract inherited verbatim: private identifiers are
// hard findings, a scan failure is a red lane, fail closed). The receipts
// land and commit through the regression machinery's own janitor, so the
// wall commit below carries the door removal alone.
async function wallAdmission(ctx: WallCtx, phase: PhaseUnit): Promise<string[]> {
  const dir = ctx.directory
  const rows = regressionLanes(parseTestLanes(promptFacts({ dir, intent: ctx.opts.intent }).pack))
  if (!rows) {
    return [
      `⏸ the wall's admission scan has no instrument: the intent pack declares no regression-cost lane row (the divergence scan behind its bare target name) — a clean room cannot go clean on unscanned ground; ` +
        `declare the row in the materialized pack (the lane table's divergence row), commit, and re-run`,
    ]
  }
  const round = roundNumberOf(phase)
  const guard = await scriptGuardSnapshot(dir)
  const heads = guard.map((shot) => ({ root: relative(dir, shot.root) || ".", sha: shot.head }))
  const problems: string[] = []
  for (const lane of rows) {
    const greenAt = async () => {
      const receipt = await newestGreenReceipt(dir, round, lane.name)
      return receipt !== undefined && sameHeads(receipt.heads, heads) ? receipt : undefined
    }
    if (await greenAt()) continue
    const inFlight = regressionInFlight(dir)
    if (inFlight) {
      log(`↻ the wall's admission scan waits for the in-flight background regression run of ${lane.name}`)
      await inFlight
      if (await greenAt()) continue
    }
    const run = await runRegressionLane(dir, round, lane, { isolate: false, idleMs: ctx.opts.idleMs, maxMs: ctx.opts.maxMs, ...(ctx.opts.pollMs !== undefined ? { pollMs: ctx.opts.pollMs } : {}) })
    if (run.violation?.kind === "head") {
      problems.push(
        `⏸ the wall's admission scan corrupted the baseline (${run.violation.moved.map((move) => `${move.root}: ${move.from} → ${move.to}`).join("; ")}); ` +
          `no auto-undo ran — investigate the repository state manually and re-run`,
      )
      break
    }
    if (run.verdict === "green") continue
    problems.push(
      `⏸ the wall's admission scan is red at the tree about to go clean — lane \`${lane.name}\`: receipt ${run.receipt}, log ${run.log}`,
      `  the hard-identifier findings block (0121 D5's contract); the itemized detail is the person's and the dirty side's alone — the committed receipt carries counts and ids`,
      ...(run.evidence?.length ? ["  the receipt's bounded evidence:", "", ...run.evidence.map((line) => `  ${line}`)] : []),
      `  rework the finding(s), commit, and re-run — the scan re-runs at the close`,
    )
  }
  await commitPendingReceipts(dir, round, ctx.git)
  return problems
}

// —— The sealed channel (D4) ——
//
// The vetted channel the sealing phase produced, derived from the field:
// the phase directory's standard artifacts and each task's standard
// artifacts, the paths that exist on disk at the close. Recorded in the
// wall commit (the diff check's scope), joined to protect's declared set.
async function sealedPathsOf(dir: string, sealing: PhaseUnit): Promise<string[]> {
  const paths = new Set<string>()
  const exists = async (rel: string) => await stat(join(dir, rel)).then(() => true, () => false)
  for (const spec of phaseArtifacts(sealing)) if (await exists(spec.path)) paths.add(spec.path)
  const plan = await loadPlan(dir, sealing).catch(() => undefined)
  if (plan) {
    for (const task of plan.tasks) {
      for (const spec of unitArtifactSpecs(sealing.entry.taskArtifacts, taskDir(task.id))) {
        if (await exists(spec.path)) paths.add(spec.path)
      }
    }
  }
  return [...paths].sort()
}

// The one diff assertion: every commit since the wall commit that touched a
// sealed path, split by hand the same way the freeze's exception reads — a
// driver commit (the Auto-Stage trailer, which no session escapes: the
// unified commit is the only road into the tree) is a sealed-channel
// invariant violation, however the write was performed (the edit, the
// direct write, rename-and-replace, git surgery — the diff sees them all);
// a person commit is the monitor-mediated amendment, the one recorded
// exception, noted for review and never blocked here.
// Exported for the boundary family's tests beside the other readers.
export async function sealedChannelCheck(dir: string, record: WallRecord): Promise<string[]> {
  if (!record.sealed.length) return []
  const got = await git(dir, ["log", "--format=%H%x1f%B%x1e", `${record.sha}..HEAD`, "--", ...record.sealed])
  if (got.code !== 0) {
    // The freeze assertion never reads as green on an unreadable history
    // (plans/0155 D1): the module's own rule — a scan failure is a red lane
    // (0121 D5 inherited) — a failed `git log` is a blocking finding, never
    // an empty answer.
    return [
      `⏸ sealed-channel check failed: git log over ${record.sha.slice(0, 7)}..HEAD could not be read (${firstLine(got.err || got.out) || `exit code ${got.code}`}) — the frozen channel cannot be asserted on an unreadable history; investigate the repository state and re-run`,
    ]
  }
  const problems: string[] = []
  const amendments: string[] = []
  for (const entry of got.out.split("\x1e")) {
    const sep = entry.indexOf("\x1f")
    if (sep < 0) continue
    const sha = entry.slice(0, sep).trim()
    if (!sha) continue
    const body = entry.slice(sep + 1)
    if (driverStage(body) !== undefined) {
      const touched = await git(dir, ["show", "--name-only", "--format=", sha, "--", ...record.sealed])
      const files = touched.out.split("\n").map((line) => line.trim()).filter(Boolean)
      problems.push(
        `⏸ sealed-channel invariant violation: driver commit ${sha.slice(0, 7)} wrote the sealed path(s) ${files.join(", ")} since wall commit ${record.sha.slice(0, 7)} — ` +
          `the vetted channel is frozen at the wall; the one recorded exception is the person-committed amendment (visible in the diff against the wall commit), and a session's write is never it; ` +
          `restate the change through the monitor-mediated clarification path and revert the write`,
      )
    } else {
      amendments.push(sha.slice(0, 7))
    }
  }
  if (amendments.length) {
    log(
      `ℹ the sealed channel carries ${amendments.length} person-committed amendment(s) since wall commit ${record.sha.slice(0, 7)} (${amendments.join(", ")}) — ` +
        `the monitor-mediated clarification path; review them in the diff: git diff ${record.sha} -- ${record.sealed.join(" ")}`,
    )
  }
  return problems
}

// —— The boundary block (D2) ——

// The read-only findings of an open wall — the person-facing half transfer
// prints ahead of any session (the same re-derivation the handover blocks
// on; the stamp-shaped covering allows are the interrupted retirement the
// advance itself finishes, so they are not the person's finding here).
export async function wallPrecheckFindings(dir: string): Promise<string[]> {
  if (!wallDeclared(dir)) return []
  const record = await findWallCommit(dir)
  if (record === undefined) return []
  return await wallOpenFindings(dir, record, false)
}

// The open-wall findings of a record: reachable doors (a reopen, however
// named or placed), person-authored winning entries and a gone deny (the
// allow half, evaluated), each naming its remedy. finishStamps adds the
// retirement write for the driver's own stamp slots — the interrupted
// close's "finish the retirement", the handover's own act.
async function wallOpenFindings(dir: string, record: WallRecord, finishStamps: boolean): Promise<string[]> {
  const problems: string[] = []
  for (const door of await reachableDoors(dir, record)) {
    // A re-create at a recorded door's own top-level name keeps the
    // finding's established shape (0132 D2's words); every other reachable
    // link names the path, its resolution and its relation to the target.
    if (!door.path.includes("/") && record.doors.some((named) => named.name === door.path)) {
      problems.push(
        `⏸ the sealed wall derives open: the door ${door.path} that wall commit ${record.sha.slice(0, 7)} removed is present again — a reopen is a person's recorded act, never a normal post-wall state; ` +
          `remove the door and re-run`,
      )
    } else {
      problems.push(
        `⏸ the sealed wall derives open: the symlink ${door.path} resolves to ${door.resolved}, ` +
          `${door.resolved === door.target ? "at" : door.resolved.startsWith(door.target + sep) ? "inside" : "over"} the recorded target ${door.target} of wall commit ${record.sha.slice(0, 7)} — a reopen is a person's recorded act, never a normal post-wall state; ` +
          `remove the symlink and re-run`,
      )
    }
  }
  const text = await opencodeText(dir)
  if (text !== undefined && record.doors.length) {
    const targets = [...new Set(record.doors.map((door) => door.target))]
    const { stamps, person, gone } = openFindingsOf(text, targets)
    if (person.length) {
      const keys = [...new Set(person.map((finding) => finding.key))].sort()
      const named = [...new Set(person.map((finding) => finding.target))].sort()
      problems.push(
        `⏸ the sealed wall derives open: ${OPENCODE_CONFIG_FILE} carries person-authored external_directory entr${keys.length === 1 ? "y" : "ies"} ${keys.join(", ")} covering the recorded target(s) ${named.join(", ")} — ` +
          `the driver never removes the person's own lines; remove the entr${keys.length === 1 ? "y" : "ies"} and re-run`,
      )
    }
    if (gone.length) {
      problems.push(
        `⏸ the sealed wall derives open: no live external_directory entry answers for the recorded target(s) ${gone.join(", ")} — the wall's standing deny is gone from ${OPENCODE_CONFIG_FILE}; ` +
          `re-add the deny on the recorded target(s) and re-run`,
      )
    }
    if (finishStamps && stamps.length) {
      const write = await retireAndDeny(dir, targets)
      if (write) problems.push(`⏸ ${write}`)
      else log(`↻ finishing the interrupted wall retirement: the driver-stamped allow(s) ${[...new Set(stamps.map((finding) => finding.key))].sort().join(", ")} retired, the standing deny re-asserted`)
    }
  }
  return problems
}

// The provable recovery (plans/0189 D2 over 0155 D2): a target is
// recoverable only where git names the door that admitted it — never from a
// live allow's shape (the sweep once adopted the template's /tmp allowance
// as the reference and flipped person allows into recorded doors). The
// door's last add/modify content is the proof; the live stamp slot then
// classifies the state: the driver's stamp standing (allow — the
// hand-removed door; recover and retire), the retirement already run with
// no record (deny — the failed wall commit; recover for the record alone,
// D5), absent (nothing to recover — 0155's by-design residual, the seal
// complete by absence).
async function lastTrackedDoorTarget(dir: string, name: string): Promise<string | undefined> {
  const linkTextAt = async (rev: string): Promise<string | undefined> => {
    const tree = await git(dir, ["ls-tree", rev, "--", name])
    if (tree.code !== 0 || !tree.out.startsWith("120000")) return undefined
    const blob = await git(dir, ["show", `${rev}:${name}`])
    return blob.code === 0 ? blob.out.trimEnd() : undefined
  }
  const head = await linkTextAt("HEAD")
  const text =
    head ??
    (await (async () => {
      // HEAD's tree no longer carries the name (the removal was committed):
      // its last add/modify commit does — that tree holds the final symlink
      // bytes the stamp was derived from.
      const last = await git(dir, ["log", "--format=%H", "-n", "1", "--diff-filter=AM", "--", name])
      if (last.code !== 0 || !last.out.trim()) return undefined
      return await linkTextAt(last.out.trim())
    })())
  if (text === undefined) return undefined
  return await realpath(resolve(dir, text)).catch(() => resolve(dir, text))
}

// The no-fill shape's candidate names: every top-level entry git ever
// recorded as a symlink (the add/modify summary lines) — with no declared
// fill, git's own history is the only place the removed doors are named.
async function topLevelSymlinkNames(dir: string): Promise<string[]> {
  const got = await git(dir, ["log", "--format=%H", "--diff-filter=AM", "--summary"])
  if (got.code !== 0) return []
  const names = new Set<string>()
  for (const line of got.out.split("\n")) {
    const hit = /(?:create mode|=>) 120000 (.+)$/.exec(line.trim())
    if (hit && hit[1] && !hit[1].includes("/")) names.add(hit[1])
  }
  return [...names]
}

async function recoveredDoors(
  dir: string,
  declared: readonly string[],
  present: readonly { name: string; target: string }[],
  text: string | undefined,
): Promise<WallDoor[]> {
  if (text === undefined) return []
  const live = externalDirectoryLive(text)
  if (live === undefined) return []
  const standing = new Set(present.map((door) => door.target))
  const names = declared.length
    ? declared.filter((name) => !present.some((door) => door.name === name))
    : await topLevelSymlinkNames(dir)
  const recovered: WallDoor[] = []
  for (const name of names) {
    const target = await lastTrackedDoorTarget(dir, name)
    if (target === undefined || standing.has(target) || recovered.some((door) => door.target === target)) continue
    const action = live[stampKey(target)]
    if (action !== "allow" && action !== "deny") continue
    recovered.push({ name, target })
  }
  return recovered
}

// The close itself (D2's steps 1–2; the transition commit is the handover
// path's own, right after). Only called under the person's advance path
// (stopBefore "formulate") with the threshold met and the wall open.
async function closeWall(ctx: WallCtx, phase: PhaseUnit, sealing: PhaseUnit): Promise<string[]> {
  const dir = ctx.directory
  // (0) The agent gate (plans/0190 D1), first and read-only: the standing
  // deny this close records reaches sessions only through an agent that
  // carries the external_directory posture into them, so a fleet that
  // carries it nowhere cannot seal — the record would claim an enforcement
  // no session sees. Ahead of the admission scan, so a refused close
  // mutates nothing and the door stands for a re-run under a carrying
  // agent.
  if (ctx.externalDirectory === false) {
    const { bin } = shellProfile()
    return [
      `⏸ the wall cannot close under this run's agent fleet: the standing deny the close records in ${OPENCODE_CONFIG_FILE} reaches sessions only through an agent that carries permission.external_directory into them, ` +
        `and this run's fleet carries it nowhere (plans/0190 — the claude adapter translates no external_directory rule today) — the seal would be a record with no session-side enforcement. ` +
        `Run the sealing advance under an agent that carries it (the built-in opencode adapter does): OPENCODE_AUTO_AGENT=opencode ${bin} transfer ${dir}, or amend the config's agent key; nothing was mutated`,
    ]
  }
  // (1) The admission scan — read-only, so a block mutates nothing and the
  // remediation session is still pre-close and lawfully dirty.
  const admission = await wallAdmission(ctx, phase)
  if (admission.length) return admission
  // (2) The doors and targets. Present doors resolve their own targets —
  // the declared names among the external root symlinks, or (no fill) every
  // root symlink resolving outside the project root, 0122's own derivation.
  // A missing door's target comes from the provable recovery alone (the
  // driver-stamped allow it retired — "door absent with a covering stamp
  // means finish the retirement"; with several declared doors the recovery
  // derivation runs whenever ANY of them is missing, plans/0155 D2's scope
  // kept: the one retirement path reaches every stamped allow).
  const declared = sealing.entry.wall!.doors
  const external = await rootSymlinkDoors(dir)
  const present = declared.length ? external.filter((door) => declared.includes(door.name)) : external
  const text = await opencodeText(dir)
  const anyMissing = declared.length ? present.length < declared.length : !present.length
  const recovered = anyMissing ? await recoveredDoors(dir, declared, present, text) : []
  const doors = [...present, ...recovered]
  if (!doors.length) {
    return [
      `⏸ the wall cannot close: no reference door is present${declared.length ? ` (the Wall: field names ${declared.join(", ")})` : " (the Wall: field names no door, and no root symlink resolves outside the project)"} ` +
        `and no provable driver-stamped external_directory allow records a target (git history names no removed door resolving at one) — nothing names what the wall seals against; ` +
        `create the door symlink the field names (pointing at the reference), or re-fill the field, and re-run`,
    ]
  }
  const targets = [...new Set(doors.map((door) => door.target))]
  // The person-entry split, before any mutation: a winning entry that is
  // not the driver's own stamp slot blocks, named (the evaluation and the
  // split are plans/0189 D3's — a wildcard, `~`-expanded or subtree entry
  // that admits the reference is as much a person's words as the literal
  // parent glob).
  if (text !== undefined) {
    const person = openFindingsOf(text, targets).person
    if (person.length) {
      const keys = [...new Set(person.map((finding) => finding.key))].sort()
      return [
        `⏸ the wall cannot close: ${OPENCODE_CONFIG_FILE} carries person-authored external_directory entr${keys.length === 1 ? "y" : "ies"} ${keys.join(", ")} covering the reference target(s) — ` +
          `the driver retires only the allows it stamped itself; remove the person-authored entr${keys.length === 1 ? "y" : "ies"} and re-run`,
      ]
    }
    // The knowledge-boundary interplay (plans/0147 D3): a reference inside
    // the boundary's allowed /tmp subtree cannot seal — the receipts
    // convention's standing allowance beats the wall's per-target deny
    // under last-match-wins, so the close refuses, teaching the move.
    const unsealable = boundaryAllowedTargets(externalDirectoryLive(text), targets)
    if (unsealable.length) {
      return [
        `⏸ the wall cannot close: the reference target(s) ${unsealable.join(", ")} sit inside the knowledge boundary's allowed /tmp subtree — ` +
          `that allowance is the receipts convention's standing exception and it beats the wall's per-target deny, so the seal cannot hold; ` +
          `move the reference out of /tmp (or narrow the allowance by hand) and re-run`,
      ]
    }
  }
  // The retirement + the standing deny (the permission-file half of the
  // wall).
  const write = await retireAndDeny(dir, targets)
  if (write) return [write]
  // The door removal (the tracked half) and the wall commit — its message
  // the record: the doors with resolved targets (the door→target ledger)
  // and the sealed channel. The pathspec covers the present doors and,
  // since plans/0138 made opencode.json a committed surface, the file
  // itself whenever git tracks it (plans/0190 D2 — the retirement write
  // lands in the wall commit, the seal atomic with its own deny; a
  // person-kept local or pre-0138 ignored file stays out: `git add` would
  // refuse an explicitly named ignored file, and the close must not start
  // failing there — the record lines remain the only tracked copy). A
  // recovered-only close (nothing tracked to remove) rides the whole-tree
  // record commit, which carries the write the same way.
  const trackedConfig = await git(dir, ["ls-files", "--", OPENCODE_CONFIG_FILE]).then(
    (got) => got.code === 0 && got.out.trim() === OPENCODE_CONFIG_FILE,
    () => false,
  )
  const pathspec =
    present.length && trackedConfig
      ? [...present.map((door) => door.name), OPENCODE_CONFIG_FILE]
      : present.length
        ? present.map((door) => door.name)
        : undefined
  for (const door of present) await rm(join(dir, door.name), { force: true })
  const sealed = await sealedPathsOf(dir, sealing)
  const settled = await ctx.git.commitTree(
    dir,
    { id: "PLAN", title: `wall close (${phaseTitle(sealing)})` },
    {
      stage: "wall",
      subject: `PLAN wall close ${phaseTitle(sealing)}`,
      allowEmpty: true,
      body: [
        `The sealed reference wall closed at ${phaseTitle(sealing)}. The resolved targets below are the wall's door→target ledger (what the retiring external_directory allows admitted); the standing deny on each target lives in ${OPENCODE_CONFIG_FILE}, carried by this same commit when the file is tracked (plans/0138's committed-surface posture — a person-kept local file leaves these lines the only tracked copy):`,
        ...doors.map((door) => `Wall-door: ${door.name} -> ${door.target}`),
        ...(sealed.length
          ? [`The sealed channel, frozen at this commit (a person-committed amendment is the one recorded exception, visible in the diff against this commit):`, ...sealed.map((path) => `Wall-sealed: ${path}`)]
          : []),
      ].join("\n"),
    },
    pathspec,
  )
  if (!settled.ok) {
    // Plans/0189 D5: the re-run IS the remedy — the recovery recognizes the
    // stamp-slot deny as the retirement already run (D2) and this same
    // close lands the record commit (empty when nothing tracked remains).
    // The hand alternative must carry the record lines verbatim, or the
    // closed predicate never reads it (a bare hand commit has no
    // `Auto-Stage: wall` line to find).
    return [
      `⏸ the wall commit failed (${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}) — ` +
        `the retirement and the door removal are already on disk; re-run the same command: the close re-derives the interrupted state and lands the record commit (empty when nothing tracked remains). ` +
        `A hand commit must carry the record lines verbatim for the closed predicate to read it:`,
      `  git add -A && git commit -m "PLAN wall close ${phaseTitle(sealing)}" -m "Auto-Stage: wall" -m "The sealed reference wall closed at ${phaseTitle(sealing)}."`,
      ...doors.map((door) => `  Wall-door: ${door.name} -> ${door.target}`),
      ...sealed.map((path) => `  Wall-sealed: ${path}`),
    ]
  }
  log(
    `✓ sealed reference wall closed (${phaseTitle(sealing)}): door${doors.length === 1 ? "" : "s"} ${doors.map((door) => door.name).join(", ")} removed, ` +
      `the driver-stamped allow(s) retired, a standing deny recorded in ${OPENCODE_CONFIG_FILE}`,
  )
  log(`  the wall commit records the resolved target(s) ${targets.join(", ")} — the door→target ledger; the standing deny rides the same commit when ${OPENCODE_CONFIG_FILE} is tracked`)
  if (sealed.length) {
    log(`  sealed channel (frozen at the wall, the person-committed amendment the one exception): ${sealed.join(", ")}`)
    await protectAdditional(dir, sealed)
  }
  return []
}

// The handover path's one wall entry (the transition commit follows right
// after): the floor gate first (an undeclared project touches nothing),
// then — post-wall — the boundary check (the closed predicate re-derived:
// reopen findings, the person-entry findings, the interrupted retirement
// finished, the sealed channel asserted, the admission's hard-identifier
// class run for this phase close), or — pre-wall with the seal threshold
// met — the close itself under the person's advance path, and a HOLD on
// every other handover path (plans/0189 D1). Returns the blocking lines
// (empty = proceed); the close's own ✓ lines log themselves.
export async function wallBoundary(ctx: WallCtx, phase: PhaseUnit): Promise<string[]> {
  if (ctx.opts.dryrun) return []
  const dir = ctx.directory
  if (!wallDeclared(dir)) return []
  const record = await findWallCommit(dir)
  if (record !== undefined) {
    const problems = await wallOpenFindings(dir, record, true)
    problems.push(...(await sealedChannelCheck(dir, record)))
    problems.push(...(await wallAdmission(ctx, phase)))
    return problems
  }
  // Pre-wall, the seal threshold met: the close rides the person's advance
  // path alone — transfer's stopBefore "formulate". Every other handover
  // path (a plain run's re-entry of an interrupted handover, --boundary
  // flow, a stop condition's own crossing) holds at the seal instead of
  // skipping it silently (plans/0189 D1, 0165-008): the phase stays on its
  // handover route with the distillation this crossing produced kept and
  // committed (transfer's re-entry skips straight to the wall), and one
  // line names the command that seals.
  const sealing = await wallSealingPhase(dir, phase)
  if (sealing === undefined) return []
  if (ctx.opts.stopBefore !== "formulate") {
    return [
      `⏸ the sealed reference wall is due to close at ${phaseTitle(sealing)}'s handover, and only the person's advance closes it — run: ${shellProfile().bin} transfer ${dir}; ` +
        `this handover path does not seal: the phase stays on its handover route, nothing was renamed`,
    ]
  }
  return await closeWall(ctx, phase, sealing)
}
