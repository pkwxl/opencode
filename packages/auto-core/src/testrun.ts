// File operations for --test-by-driver test execution and --handover-test
// handover documents: consuming the test request marker, script execution and
// output archiving, the handover document's fill-in status line / archive /
// chain cleanup and restoration. **This module depends on no session-driving
// code** (must not import session / watch / exec-session / runner) — it is
// where the plans/0024-module-split-plan.md §D.2 import cycle is dissolved:
// watch → testrun one-way, while the handover timing state machine lives in
// exec-session.
// Split out of src/runner.ts (plans/0024-module-split-plan.md S6, pure move).

import { chmod, mkdir, readdir, realpath, rename, rm } from "node:fs/promises"
import { dirname, join, resolve, sep } from "node:path"
import { archivedTestHandoff, handoffFile, latestHandoffSeq, taskDoc, taskDocPaths } from "./docpaths"
import { handoffStatus } from "./document/roles"
import { deletedFiles, removeIfUntracked, restoreFile } from "./git"
import { peekHandover } from "./handover"
import { formatTokens, log } from "./log"
import type { Opts } from "./opts"
import { codeWork } from "./phases/registry"
import type { Task } from "./tasks"
import { renderHandoffSteer, renderUsageNoteInfo, renderUsageNoteWinddown, type TestRunInfo } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { runScript, scriptTmpDir } from "./script"

// Ondemand context management (OPENCODE_AUTO_STEER, plans/0056): the driver
// watches a running session's context usage, steers milestone usage notices
// into it (the `notes` bands, fractions of the effective wall), and the session
// itself decides when to hand over at a natural boundary; the hard-wall steer
// (`text`, fired at the wall) is the last resort. The wall itself is
// steerWall(limit, window), computed at the watch measurement point where the
// window is known — `limit` stays the raw 2×cap budget, and the post-session
// check (usage.ts sessionHandoverDue) takes the larger of it and the wall the
// session was last measured against.
export type Steer = {
  limit: number
  text: string
  // Milestone notices, ascending by `at` (a fraction of the effective wall):
  // crossed once, steered once. The text carries literal {{used}}/{{pct}}/
  // {{wall}} slots filled at send time (fillUsageNote).
  notes: { at: number; text: string }[]
}

// Handover steer construction (every whole-task session since plans/0130 D1
// — the mode that once gated it, ondemand, merged into off — auto's lead and
// the streams of its split since plans/0059 D5, the fix rounds since
// plans/0130 D2; exported as a pure function
// for unit tests): not constructed while the experiment switch
// OPENCODE_AUTO_STEER is off (on = autoSwitches().steer) — no usage notices,
// no hard-wall hint, and the post-session handover check is disabled with it.
// A subtask names its per-stream document docs/T-NNN/S<nn>/handoff.md
// (plans/0068 S5: side-by-side stream lanes hand over through one document
// each); without one the steer names the task-level file.
export function handoffSteer(on: boolean, cap: number, task: Task, subtask?: number): Steer | undefined {
  return on
    ? {
        limit: cap * 2,
        // The steer texts and usage notes render no intent sections and no
        // question rule, so their facts carry the built-in pack (the render
        // exit takes facts uniformly; the values never reach these bytes).
        text: renderHandoffSteer(promptFacts(), { ...taskDocPaths(task.id), handoff: handoffFile(task, subtask) }),
        notes: [
          { at: 0.5, text: renderUsageNoteInfo(promptFacts(), { ...taskDocPaths(task.id), handoff: handoffFile(task, subtask) }) },
          { at: 0.85, text: renderUsageNoteWinddown(promptFacts(), { ...taskDocPaths(task.id), handoff: handoffFile(task, subtask) }) },
        ],
      }
    : undefined
}

// Fill a usage note's figure slots at send time (the figures do not exist at
// render time): tokens formatted like the watch log lines, pct rounded. The
// remaining figure (plans/0130 D4) floors at zero — a jump past the wall
// names an empty headroom, never a negative one.
export function fillUsageNote(text: string, used: number, wall: number): string {
  return text
    .replaceAll("{{used}}", formatTokens(used))
    .replaceAll("{{pct}}", String(Math.round((used / wall) * 100)))
    .replaceAll("{{wall}}", formatTokens(wall))
    .replaceAll("{{remaining}}", formatTokens(Math.max(0, wall - used)))
}

// The effective wall (plans/0056, raised on large windows by plans/0059 D6):
// min(max(2×cap, window/4), 80% of the window) when the model's context window
// is known, the 2×cap budget otherwise.
// - The 80% ceiling: a hard-wall hint at the budget would leave no room to
//   write the handover document on a narrow-window model.
// - The window/4 floor: on a large window a wall at the budget forces the
//   handover right after the session has paid for its understanding, the
//   worst boundary, where everything it read is lost. Handing over from a
//   quarter of a 1M window pays after a few turns; below it, carrying on in
//   the same session is cheaper.
// At the default 64k cap the floor changes nothing up to a 512k window
// (128k → 102k, 200k → 128k, 512k → 128k); a 1M window rises from 128k to 250k.
export function steerWall(limit: number, windowTokens: number | undefined): number {
  if (windowTokens === undefined) return limit
  return Math.min(Math.max(limit, Math.floor(windowTokens / 4)), Math.floor(windowTokens * 0.8))
}

// The two handover predicates — the post-session check (was handoverDue) and
// the test-handover check at the test request (was testHandoverDue) — moved to
// src/usage.ts in MA.3 (plans/0039) as sessionHandoverDue / testHandoverDue:
// they read the usage figure, and the usage tier decides them (plans/0038).

// --test-by-driver's test execution protocol state (shared by watch and
// runExecSession, persistent across sessions and runs): tmp is the driver
// working directory under the target directory (tmp/); seq is the sequential
// archive number (initialization scans existing tmp/test.<n>.out files for
// the maximum — every execution produces an .out, so it is the numbering
// basis; the test/ script-path form produces no extra .sh, the inline form
// produces tmp/test.<n>.sh); handoffFile is the --handover-test handover
// document's absolute path (named by execution scope: a subtask gets
// docs/<id>/S<two-digit seq>/testhandoff.md, a whole task / fix round gets
// docs/<id>/testhandoff.md); handover is the switch; limit is the cap on
// context already used (the raw config.contextLimit; the handover
// steer uses twice that); last is the most recent execution's info (the
// continuation prompt cites its output path).
// task/unit/handovers feed the handover freeze commit (#1) its commit
// message — watch holds neither the task nor the execution-scope label, they
// travel down through this structure; startUsed is the criterion's fallback
// value (see testHandoverDue).
export type TestRun = {
  dir: string
  tmp: string
  handoffFile: string
  handover: boolean
  limit: number
  seq: number
  task: Task
  unit: string
  // The body of the handover commit's subject: this execution unit's commit
  // title (a subtask gets `T-NNN S<n> <subtask title>`, a whole task gets
  // `T-NNN exec <title>`, a fix round gets `T-NNN fix<n> <title>`); the
  // handover commit appends `test handover #<n>[ freeze]` after it — same
  // subject as the commit that completes the unit, so in git history one look
  // shows which subtask these intermediate commits belong to.
  subject: string
  // Short label for logs and the terminal (`T-NNN S<n>` / `T-NNN`): most
  // handover-related log lines happen outside the session banner (freeze,
  // close-out, recovery decisions and sequential-mode script execution all
  // happen after the session ends) — a bare task number would not show which
  // subtask it is.
  label: string
  handovers: number
  startUsed: number
  last?: TestRunInfo
  // The script already frozen, waiting to execute after the handover
  // close-out. The marker tmp/test.sh is consumed at the very moment of the
  // freeze — the session still has wrap-up ahead of it, and a leftover
  // marker would be misread by the next round; execution is postponed until
  // after commit #2 and closed out by runExecSession. Cleared once executed.
  // A refused request (plans/0171 D1: the marker named an existing path
  // outside the project root) carries its reason — the deferred execution
  // renders the refusal instead of running the snapshot.
  pending?: { script: string; seq: number; refused?: string }
  // One-shot flag of the "wrap-up check" state: seeded in two places — the
  // H1 branch of interruption recovery (§I; this round's session was forked
  // from the freeze point to redo the handover wrap-up, and the wrap-up
  // instruction already went out with the first prompt), and the spot in
  // watch where the freeze steer is delivered successfully (when the session
  // errors mid wrap-up and the retry loop forks it to continue, the new watch
  // instance goes straight into the wrap-up check on this flag instead of
  // misjudging the completed wrap-up as a natural finish and losing the whole
  // handover). In both cases, when the session goes idle the handover
  // document is checked directly instead of treating it as an ordinary
  // finish. Cleared after use (runExecSession resets it after every
  // runSession return).
  resumeWrapup?: boolean
}

// When test handovers exceed this count in a row, the continuation prompt
// carries an assessment of "are we stuck in an unsolvable problem" (mark the
// leftover with AUTO-FIXME and continue); no hard cap, no blocking.
export const TEST_HANDOVER_ADVISORY = 10

// Handover document fill-in status line (F2): reached only when the content
// is already posted to git or already carries a status line — a missing line
// just means the content was written before the status-line convention. Fills
// in `Status: continue` — the test result has not been read yet, this
// execution scope is definitely not finished.
export async function fillHandoffStatus(path: string): Promise<void> {
  const text = await Bun.file(path).text().catch(() => "")
  if (!text.trim() || handoffStatus(text)) return
  await Bun.write(path, `${text.trimEnd()}\n\nStatus: continue\n`)
}

// The newest execution snapshot under tmp/, tmp/test.<n>.sh: the fallback
// when the in-flight record is missing (field leftovers from before this
// mechanism went live) — the script consumed at the freeze was materialized
// right there. Returns undefined when the directory is missing or there is no
// snapshot.
export async function latestTestScript(tmp: string): Promise<string | undefined> {
  let max = 0
  for (const file of await readdir(tmp).catch(() => [] as string[])) {
    max = Math.max(max, Number(/^test\.(\d+)\.sh$/.exec(file)?.[1] ?? 0))
  }
  return max > 0 ? join(tmp, `test.${max}.sh`) : undefined
}

// Field restoration of handover documents (F3): brings back handover
// documents that are tracked by a commit yet deleted in the worktree. A
// previous run's stale cleanup deletes the whole in-flight document chain,
// even though it is already posted in the freeze/close-out commits — the
// deletion itself is a dirty area, blocking the next execution unit's clean
// gate on the spot. git is the restoration authority: the dirty area
// disappears with it, and the recovery state machine gets back the files its
// decisions need.
// Omitting task restores every task's handover documents (used at run start:
// which task will run is not known at that moment, and before a run starts
// there is no legitimate explanation whatsoever for a deleted, already-posted
// handover document).
export async function restoreTestHandoffs(dir: string, task?: Task): Promise<void> {
  const deleted = await deletedFiles(dir, "docs")
  for (const rel of deleted) {
    if (!/testhandoff(-\d+)?\.md$/.test(rel)) continue
    if (task && !rel.includes(task.id)) continue
    if (await restoreFile(dir, rel)) log(`↻ handover document ${rel} was previously cleaned up; restored from the commit`)
  }
}

// Handover document archive: the current copy is renamed to
// testhandoff-<n>.md in the same directory, so numbering continuation only
// needs to scan that directory.
export async function archiveHandoff(dir: string, handoff: string, n: number): Promise<void> {
  const target = join(dir, archivedTestHandoff(handoff, n))
  await mkdir(dirname(target), { recursive: true })
  await rename(join(dir, handoff), target)
}

// Whether a handover document and all its archived copies (testhandoff.md +
// testhandoff-<n>.md) are on disk.
async function handoffChainExists(dir: string, handoff: string): Promise<boolean> {
  if (await Bun.file(join(dir, handoff)).exists()) return true
  return (await latestHandoffSeq(dir, handoff)) > 0
}

// Remove a handover document and all its archived copies: the handover chain
// closes within one runTask call; when the unit completes (or the stale
// cleanup runs on a non-recovery path) the whole chain is cleared — left for
// the next execution scope it would be misread as a continuation basis and
// would veto session reuse forever. Historical handover content is carried by
// git commits, not kept around in worktree files.
export async function removeHandoffChain(dir: string, handoff: string, untrackedOnly = false): Promise<void> {
  for (let n = await latestHandoffSeq(dir, handoff); n > 0; n--) {
    const rel = archivedTestHandoff(handoff, n)
    if (untrackedOnly) await removeIfUntracked(dir, rel)
    else await rm(join(dir, rel), { force: true })
  }
  if (untrackedOnly) await removeIfUntracked(dir, handoff)
  else await rm(join(dir, handoff), { force: true })
}

// Archive numbering continuation: scans existing test.<n>.out under tmp/ for
// the maximum number (every execution produces an .out, so both the test/
// script-path form and the inline form are covered); not overwritten across
// sessions or runs. A missing directory starts from 0.
export async function latestTestSeq(tmp: string): Promise<number> {
  let max = 0
  for (const file of await readdir(tmp).catch(() => [] as string[])) {
    max = Math.max(max, Number(/^test\.(\d+)\.out$/.exec(file)?.[1] ?? 0))
  }
  return max
}

// Whether this task has a leftover test handover document from any execution
// scope (task level docs/<id>/testhandoff.md or subtask level
// docs/<id>/S<kk>/testhandoff.md): used by the interruption-recovery decision
// — having the file means the pre-interruption session already wrote a
// handover, the old session's context is used up, and it must not be reused
// (a new session continues from the handover).
export async function testHandoffExists(dir: string, task: Task): Promise<boolean> {
  // The current copy and the archived copies (testhandoff-<n>.md) count the
  // same: archiving is just the driver's close-out rename, the handover has
  // already happened — the old session must not be reused before this unit
  // closes the loop (cleared together by removeHandoffChain when the unit
  // completes; a stale archive does not veto reuse forever).
  if (await handoffChainExists(dir, taskDoc(task.id, "testhandoff"))) return true
  // Subtask level: testhandoff*.md at any depth inside the task directory
  // (** matches zero segments; the task-level same-name file is already
  // covered above, this focuses on the subtask directories; scope narrowed to
  // this task).
  for await (const _ of new Bun.Glob(join("docs", task.id, "**", "testhandoff*.md")).scan({ cwd: dir, onlyFiles: true })) {
    return true
  }
  return false
}

// Stale cleanup of test handover documents (non-recovery resume): removes
// the task level and all subtask levels together — the handover loop closes
// within one runTask call; documents left over across calls are stale state
// and, left for the next execution scope, would be misread as a continuation
// basis.
//
// Two narrowings (interruption recovery F4): ① skip the whole section when
// the task has an in-flight handover record — that is not a leftover, it is
// interrupted in-flight state, and the recovery state machine owns the
// decision; ② delete only the copies **not tracked by git**. An already-posted
// handover document necessarily belongs to an in-flight handover (deleted
// inside the unit by removeHandoffChain when the unit completes normally,
// posted with the unit's commit); deleting it here would only create a dirty
// area and crash the next execution unit's clean gate — the kernel-spi-nor
// T-028 field incident was exactly this.
export async function cleanTestHandoffs(dir: string, task: Task): Promise<void> {
  if (await peekHandover(dir, task.id)) return
  await removeHandoffChain(dir, taskDoc(task.id, "testhandoff"), true)
  for await (const file of new Bun.Glob(join("docs", task.id, "S*", "testhandoff*.md")).scan({ cwd: dir, onlyFiles: true })) {
    await removeIfUntracked(dir, file)
  }
}

// The shared delete-only-if-untracked implementation is removeIfUntracked in
// src/git.ts (narrowed in F4 semantics; the stale cleanup of the steer
// handover document handoff.md reuses the same one); tracked copies are left
// to the recovery state machine — deleting one equals creating a dirty area.

// —— The unservable request (plans/0142 D1) ——
//
// The channel's derived condition (0083 D9) leaves a session whose phase is
// not code work with NO marker machinery at all — nothing watches tmp/test.sh,
// nothing executes it, nothing says so. A session there may still write the
// marker: the task's own document (formulated in the same phase) or a gap
// list instructs the driver test protocol by name, and AGENTS.md's principle
// plus the run banner teach the channel from the config flag alone. The T-058
// incident measured what 0083 D9's "a stray marker is inert" ruling missed:
// the marker is not stray — it is a deliberate request nobody will serve — and
// left on disk it reads as wiring to every later session (the incident's
// re-verification "verified" it as exactly right, twice). The drop is
// therefore consumed and surfaced at every scope's close, never silent: this
// amends D9's housekeeping ruling the way 0126 D3 amended the doc-lane case
// (an unservable request is consumed and refused, never left for the next
// session to misread).

// Whether the driver test channel serves the session at all: the derived
// condition negated, dryrun excluded (the floor — nothing runs, nothing
// consumes). Covers both dead worlds: the config flag off outright, and the
// flag on over a phase whose type is not code work.
function testChannelOffFor(opts: Pick<Opts, "testByDriver" | "dryrun" | "phase">): boolean {
  if (opts.dryrun) return false
  return !(opts.testByDriver && codeWork(opts.phase?.entry))
}

// The unservable marker's consume and its one wording (plans/0142 D1; the
// split for the adopt step, plans/0206 D1): the run flows log the line and
// keep the reason (consumeDeadTestMarker below); the adopt step carries the
// line in its own outcome lines — the command's result output, not the run's
// log stream, is its canonical surface. One wording, two presentations, no
// double print. Returns undefined when there is nothing to drop.
export async function dropDeadTestMarker(
  dir: string,
  opts: Pick<Opts, "testByDriver" | "dryrun" | "phase">,
  label: string,
): Promise<{ why: string; line: string } | undefined> {
  if (!testChannelOffFor(opts)) return undefined
  const marker = join(scriptTmpDir(dir), "test.sh")
  if (!(await Bun.file(marker).exists())) return undefined
  await rm(marker, { force: true })
  const why = opts.testByDriver ? `the phase (${opts.phase?.entry.type ?? "implement"}) is not a code-work phase` : "--test-by-driver is off"
  return {
    why,
    line: `⚠ ${label} left tmp/test.sh — a driver-test request — but ${why}, so the channel will never serve it; the request was not executed and the marker was consumed (a leftover would read as wiring for later sessions)`,
  }
}

// Consume a test-request marker no machinery will serve. Returns the reason
// the channel is off (for the caller's own surfaces — the fix round blocks on
// it, 0142 D2), undefined when there is nothing to drop.
export async function consumeDeadTestMarker(dir: string, opts: Pick<Opts, "testByDriver" | "dryrun" | "phase">, label: string): Promise<string | undefined> {
  const dropped = await dropDeadTestMarker(dir, opts, label)
  if (dropped === undefined) return undefined
  log(dropped.line)
  return dropped.why
}

// --test-by-driver's single test execution = consume the request marker +
// execute. Split into two steps because a test handover must consume the
// marker and pin the script down at the very moment of the freeze; execution
// is postponed until after the handover close-out.
// stdout+stderr are merged and written whole to tmp/test.<n>.out (sharing the
// idleTime/idleMax watchdog); a non-zero exit code is not judged here — the
// verdict belongs to the AI.
export async function executeTest(test: TestRun, opts: Opts): Promise<TestRunInfo> {
  const pending = await resolveTestScript(test)
  return runTestScript(test, opts, pending.script, pending.seq, pending.refused)
}

// Consumption of the request marker (pins down the script to run this time,
// takes one archive sequence number): tmp/test.sh existing is the request;
// deleted right after reading so it can be requested again. The content has
// two forms —
// (1) a path pointing at a script under test/ (relative to the working
// directory, e.g. test/build.sh): run that script directly (the script itself
// is already in git under test/, no separate archiving needed); the criterion
// is **a single line with no newline after trim** — printf/echo writes often
// carry a trailing newline and must not fall into the inline fallback because
// of it: the inline snapshot would have bash execute that path as a command,
// a script missing +x yields exit code 126 and the AI debugs it for nothing.
// The path form also best-effort adds +x — the AI forgetting chmod is the
// norm, the driver adds it itself, no session debugging needed. The path form
// is accepted only when the candidate's realpath stays inside the project
// root (plans/0171 D1): a session confined by the external-directory deny
// writing an absolute or ../ path must not steer the driver — outside the
// agent's own permission system — into chmod 0755 and executing an arbitrary
// file (a private key, a sealed reference repository's script through a root
// symlink; chmod follows symlinks, so the containment is judged on the
// resolved path, not the spelling). A single-line request naming an existing
// file outside the root is refused: the marker is consumed, the request is
// snapshotted for audit, and the execution renders the refusal instead of
// running anything (falling back to the inline form would have bash execute
// the named path as a command line — the outside script would still run);
// (2) an inline script (the fallback for when the AI did not pin the script
// into test/ per the protocol): write the content whole to tmp/test.<n>.sh,
// keeping the execution snapshot for audit.
// A test handover calls this first at the very moment of the freeze — the
// marker must be taken away before the session continues its wrap-up
// (otherwise a marker rewritten during wrap-up makes the driver run the wrong
// script), and the inline form must also be materialized at the same moment
// as the freeze commit.
// The consumed request marker's resolution (the shape TestRun.pending holds,
// named for the engine's PendingTest): the pinned script, its archive
// sequence number, and — for a request the confinement rule refused
// (plans/0171 D1) — the refusal the execution renders instead of running.
export type PendingTestResolution = { script: string; seq: number; refused?: string }

export async function resolveTestScript(test: Pick<TestRun, "dir" | "tmp" | "seq">): Promise<PendingTestResolution> {
  const seq = ++test.seq
  const marker = join(test.tmp, "test.sh")
  const content = await Bun.file(marker).text()
  const line = content.trim()
  const candidate = resolve(test.dir, line)
  let script: string
  let refused: string | undefined
  // A single line after trim that points at an existing file inside the
  // project root (realpath-resolved: a symlink under the root pointing out
  // is an escape, and so is an absolute path or a ../ spelling) → run that
  // test/ script (the protocol's first choice); an existing file outside the
  // root → refused (never executed); anything else falls back to the inline
  // script.
  if (!line.includes("\n") && (await Bun.file(candidate).exists())) {
    const real = await realpath(candidate).catch(() => undefined)
    const root = await realpath(test.dir).catch(() => test.dir)
    if (real !== undefined && (real === root || real.startsWith(root + sep))) {
      // best-effort add of the execute bit: exec on a script missing +x gets
      // EACCES; failure (read-only filesystem and the like) is silent —
      // runScript still has the exec-bash fallback for non-executable scripts.
      await chmod(candidate, 0o755).catch(() => {})
      script = candidate
    } else {
      refused =
        `the request names the path \`${line}\`, which resolves ${real === undefined ? "to an unreadable path" : `to ${real}`} — outside this project's root; ` +
        `the driver-run test channel executes a script under test/ (a path inside the project) or an inline script, never a path outside the project`
      script = join(test.tmp, `test.${seq}.sh`)
      await Bun.write(script, content)
      log(`⚠ the test request ${join(test.tmp, "test.sh")} names a path outside the project root; refused and not executed (the protocol accepts a script under test/ or an inline script)`)
    }
  } else {
    script = join(test.tmp, `test.${seq}.sh`)
    await Bun.write(script, content)
  }
  await rm(marker, { force: true })
  return { script, seq, ...(refused ? { refused } : {}) }
}

// The execution kernel for a known script path (called by executeTest after
// consuming the request marker; a test handover also calls it directly to
// execute the test.pending consumed at the freeze — the marker was taken
// away long before, there is no second read). Every execution takes a new
// archive sequence number; the output is always tmp/test.<n>.out. A refused
// resolution (plans/0171 D1) renders its reason as the run's whole output
// with exit code 125 and executes nothing — the request is answered, not
// silently dropped, and nothing outside the project root ever runs.
export async function runTestScript(test: TestRun, opts: Opts, script: string, seq = ++test.seq, refused?: string): Promise<TestRunInfo> {
  const out = join(test.tmp, `test.${seq}.out`)
  await mkdir(test.tmp, { recursive: true })
  if (refused !== undefined) {
    await Bun.write(out, `${refused}\n`)
    const info: TestRunInfo = { script, code: 125, ms: 0, timedOut: false, out, seq }
    test.last = info
    return info
  }
  const run = await runScript(test.dir, script, { idleMs: opts.idleMs, maxMs: opts.maxMs, out })
  log(
    `  ⚙ ${test.label} test script exit code ${run.code}${run.timedOut ? ` (timed out: ${run.timeoutReason === "max" ? "absolute duration cap exceeded" : "no output for too long"})` : ""}, took ${run.ms}ms, script: ${script}, output: ${out}`,
  )
  const info: TestRunInfo = {
    script,
    code: run.code,
    ms: run.ms,
    timedOut: run.timedOut,
    timeoutReason: run.timeoutReason,
    out,
    seq,
    // The side-effect guard's finding rides along (plans/0083 D11): the
    // steered-back renders name it.
    ...(run.violation ? { violation: run.violation } : {}),
  }
  test.last = info
  return info
}
