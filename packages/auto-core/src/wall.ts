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
//       (read-only) → one wall commit (the door removal, its message
//       recording the resolved targets — the tracked record of what the
//       untracked opencode.json's allows admitted) → the transition commit.
//       The closed predicate is re-derived from disk and git at every
//       boundary: the wall is closed iff the door is absent and no live
//       external_directory entry covers the recorded target — the allow is
//       the wall, the door a convenience. The driver retires only the
//       allows it stamped itself (0122's exact bytes); a person-authored
//       covering entry is a blocking finding that names the entry, and the
//       close stamps a standing deny on the recorded target;
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
import { rm, stat } from "node:fs/promises"
import { join, relative } from "node:path"
import { taskDir } from "./docpaths"
import { allowBase, coveringAllowKeys, externalDirectoryLive, OPENCODE_CONFIG_FILE, rootSymlinkDoors, stampKey, stampWallClosure } from "./external-dirs"
import { git, scriptGuardSnapshot, type GitOps } from "./git"
import { allowWrite, protectAdditional, reprotect } from "./protect"
import { loadPhaseTypes } from "./phases/custom"
import { phaseArtifacts, phaseTitle, readPhases, type PhaseUnit } from "./phases"
import { unitArtifactSpecs } from "./phases/registry"
import { parseTestLanes } from "./intent/test-lanes"
import { log } from "./log"
import { promptFacts } from "./prompt-facts"
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
// a driver-stamped allow after the door itself was gone (the person's
// hand-removal, an interrupted close) — no door name exists to re-create, so
// the door-presence half of the predicate skips it; the allow half does not.
export type WallDoor = { name: string; target: string }

// The wall commit's record (plans/0132 D2/D4): the newest commit carrying
// `Auto-Stage: wall`, its message parsed back — the doors with their
// resolved targets (what the retiring allows admitted; opencode.json is
// untracked machine state, so the tracked record must carry it) and the
// sealed channel frozen at the wall (protect's declared set, the one
// diff-check's scope).
export type WallRecord = { sha: string; doors: WallDoor[]; sealed: string[] }

const WALL_STAGE_LINE = "Auto-Stage: wall"
const RECOVERED_DOOR = "(removed)"

// What the boundary and the close need from the run's context — LoopCtx
// satisfies it structurally (RunAllOpts carries the lane timings and the
// stop condition; the wall's own gate is the stopBefore "formulate" that
// names the person's advance path). pollMs rides for the watchdog's poll
// cadence like the regression lane's own opts.
export type WallCtx = {
  directory: string
  git: Pick<GitOps, "commitTree">
  opts: { stopBefore?: string; dryrun?: boolean; intent?: string; idleMs?: number; maxMs?: number; pollMs?: number }
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

// The re-created doors of a record: a recorded door name present on disk
// again (any entry — the symlink need not resolve anywhere for the door to
// read as back). A reopen, never a normal post-wall state: the wall commit's
// deletion is in history, so the person (or whatever wrote it) re-created
// it deliberately.
async function recreatedDoors(dir: string, record: WallRecord): Promise<WallDoor[]> {
  const back: WallDoor[] = []
  for (const door of record.doors) {
    if (door.name === RECOVERED_DOOR) continue
    if (await stat(join(dir, door.name)).then(() => true, () => false)) back.push(door)
  }
  return back
}

// The live allow entries covering the recorded targets, split by hand: the
// exact stamp keys (0122's bytes, re-derivable — the driver's own, to
// retire) and everything else (a person-authored entry — the driver never
// removes the person's words; the person removes their own line).
function coveringEntries(text: string, targets: readonly string[]): { stamps: string[]; person: string[] } {
  const keys = coveringAllowKeys(text, targets)
  const stamps = new Set(targets.map(stampKey))
  return {
    stamps: keys.filter((key) => stamps.has(key)),
    person: keys.filter((key) => !stamps.has(key)),
  }
}

// The retirement write (D2): retire the driver-stamped allows and stamp the
// standing deny on every target — one idempotent write to the untracked
// opencode.json (chmod'd through protect's allowWrite while a run holds the
// file read-only). "" = clean; anything else is the blocking failure line.
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
async function sealedChannelCheck(dir: string, record: WallRecord): Promise<string[]> {
  if (!record.sealed.length) return []
  const got = await git(dir, ["log", "--format=%H%x1f%B%x1e", `${record.sha}..HEAD`, "--", ...record.sealed])
  if (got.code !== 0) return []
  const problems: string[] = []
  const amendments: string[] = []
  for (const entry of got.out.split("\x1e")) {
    const sep = entry.indexOf("\x1f")
    if (sep < 0) continue
    const sha = entry.slice(0, sep).trim()
    if (!sha) continue
    const body = entry.slice(sep + 1)
    if (body.includes("Auto-Stage:")) {
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

// The open-wall findings of a record: re-created doors (a reopen) and
// person-authored covering entries, each naming its remedy. finishStamps
// adds the retirement write for the driver's own stamp keys — the
// interrupted close's "finish the retirement", the handover's own act.
async function wallOpenFindings(dir: string, record: WallRecord, finishStamps: boolean): Promise<string[]> {
  const problems: string[] = []
  for (const door of await recreatedDoors(dir, record)) {
    problems.push(
      `⏸ the sealed wall derives open: the door ${door.name} that wall commit ${record.sha.slice(0, 7)} removed is present again — a reopen is a person's recorded act, never a normal post-wall state; ` +
        `remove the door and re-run`,
    )
  }
  const text = await opencodeText(dir)
  if (text !== undefined) {
    const targets = [...new Set(record.doors.map((door) => door.target))]
    const { stamps, person } = coveringEntries(text, targets)
    if (person.length) {
      problems.push(
        `⏸ the sealed wall derives open: ${OPENCODE_CONFIG_FILE} carries person-authored external_directory allow(s) ${person.join(", ")} covering the recorded target(s) — ` +
          `the driver never removes the person's own lines; remove the entr${person.length === 1 ? "y" : "ies"} and re-run`,
      )
    }
    if (finishStamps && stamps.length) {
      const write = await retireAndDeny(dir, targets)
      if (write) problems.push(`⏸ ${write}`)
      else log(`↻ finishing the interrupted wall retirement: the driver-stamped allow(s) ${stamps.join(", ")} retired, the standing deny re-asserted`)
    }
  }
  return problems
}

// The close itself (D2's steps 1–2; the transition commit is the handover
// path's own, right after). Only called under the person's advance path
// (stopBefore "formulate") with the threshold met and the wall open.
async function closeWall(ctx: WallCtx, phase: PhaseUnit, sealing: PhaseUnit): Promise<string[]> {
  const dir = ctx.directory
  // (1) The admission scan — read-only, so a block mutates nothing and the
  // remediation session is still pre-close and lawfully dirty.
  const admission = await wallAdmission(ctx, phase)
  if (admission.length) return admission
  // (2) The doors and targets. Present doors resolve their own targets —
  // the declared names among the external root symlinks, or (no fill) every
  // root symlink resolving outside the project root, 0122's own derivation.
  // A doorless driver-stamped allow (its base exists on disk but no current
  // root symlink resolves there — the person's hand-removal, or an
  // interrupted close after the removal) carries the target alone: "door
  // absent with a covering allow means finish the retirement".
  const declared = sealing.entry.wall!.doors
  const external = await rootSymlinkDoors(dir)
  const present = declared.length ? external.filter((door) => declared.includes(door.name)) : external
  const text = await opencodeText(dir)
  const recovered: WallDoor[] = []
  if (!present.length && text !== undefined) {
    const current = new Set(external.map((door) => door.target))
    const live = externalDirectoryLive(text)
    if (live !== undefined) {
      for (const [key, action] of Object.entries(live)) {
        if (action !== "allow") continue
        const base = allowBase(key)
        if (base === undefined || current.has(base)) continue
        if (await stat(base).then(() => true, () => false)) {
          recovered.push({ name: declared.length === 1 ? declared[0]! : RECOVERED_DOOR, target: base })
        }
      }
    }
  }
  const doors = [...present, ...recovered]
  if (!doors.length) {
    return [
      `⏸ the wall cannot close: no reference door is present${declared.length ? ` (the Wall: field names ${declared.join(", ")})` : " (the Wall: field names no door, and no root symlink resolves outside the project)"} ` +
        `and no driver-stamped external_directory allow records a target — nothing names what the wall seals against; ` +
        `create the door symlink the field names (pointing at the reference), or re-fill the field, and re-run`,
    ]
  }
  const targets = [...new Set(doors.map((door) => door.target))]
  // The person-entry split, before any mutation: a covering entry that is
  // not the driver's own stamp blocks, named.
  if (text !== undefined) {
    const person = coveringEntries(text, targets).person
    if (person.length) {
      return [
        `⏸ the wall cannot close: ${OPENCODE_CONFIG_FILE} carries person-authored external_directory allow(s) ${person.join(", ")} covering the reference target(s) — ` +
          `the driver retires only the allows it stamped itself; remove the person-authored entr${person.length === 1 ? "y" : "ies"} and re-run`,
      ]
    }
  }
  // The retirement + the standing deny (the untracked half of the wall).
  const write = await retireAndDeny(dir, targets)
  if (write) return [write]
  // The door removal (the tracked half) and the wall commit — its message
  // the record: the doors with resolved targets (what the allows admitted)
  // and the sealed channel. The pathspec covers the present doors alone;
  // a recovered-only close (nothing tracked to remove) rides the empty
  // record commit.
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
        `The sealed reference wall closed at ${phaseTitle(sealing)}. The resolved targets below are the tracked record of what the retiring external_directory allows admitted (${OPENCODE_CONFIG_FILE} is untracked machine state):`,
        ...doors.map((door) => `Wall-door: ${door.name} -> ${door.target}`),
        ...(sealed.length
          ? [`The sealed channel, frozen at this commit (a person-committed amendment is the one recorded exception, visible in the diff against this commit):`, ...sealed.map((path) => `Wall-sealed: ${path}`)]
          : []),
      ].join("\n"),
    },
    present.length ? present.map((door) => door.name) : undefined,
  )
  if (!settled.ok) {
    return [
      `⏸ the wall commit failed (${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}) — ` +
        `the retirement and the door removal are already on disk; commit the state by hand and re-run (the closed predicate reads the record from the commit)`,
    ]
  }
  log(
    `✓ sealed reference wall closed (${phaseTitle(sealing)}): door${doors.length === 1 ? "" : "s"} ${doors.map((door) => door.name).join(", ")} removed, ` +
      `the driver-stamped allow(s) retired, a standing deny recorded in ${OPENCODE_CONFIG_FILE}`,
  )
  log(`  the wall commit records the resolved target(s) ${targets.join(", ")} — the tracked record of what the allows admitted`)
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
// class run for this phase close), or — pre-wall under the person's
// advance path with the threshold met — the close itself. Returns the
// blocking lines (empty = proceed); the close's own ✓ lines log themselves.
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
  // Pre-wall: the close rides the person's advance path only — transfer's
  // stopBefore "formulate"; a plain run (or --boundary flow) never closes
  // the wall, its handover only carries the checks above (which need a
  // record; pre-wall there is nothing to check).
  if (ctx.opts.stopBefore !== "formulate") return []
  const sealing = await wallSealingPhase(dir, phase)
  if (sealing === undefined) return []
  return await closeWall(ctx, phase, sealing)
}
