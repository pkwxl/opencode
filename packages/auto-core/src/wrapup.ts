// Task verification loop and parsing of the task report's result line
// (Result: PASS|FAIL). Since plans/0083 (D1–D5) the wrap-up session is the
// verification session — one fresh session does verify + report, judging
// every `## Acceptance` criterion by inspection of the work (the unit's
// commit range), never from the work sessions' claims and without re-running
// the acceptance's executable checks; a PASS writes the evidence-form report
// (the shape gates below), a FAIL writes no report at all and lands as the
// gap list docs/T-NNN/gaps.md (the `gaps` document role — transient like
// handoff.md, deleted at closeout and by closeUnit, overwritten wholesale by
// every re-verification: the earlier gaps being closed exempts nothing
// else). Since plans/0096 D5 every round opens with the driver-run lane gate
// (below): the pack's lane table runs as parallel driver processes and the
// anchor pre-gate decides whether the verify session dispatches at all. A
// bounded fix loop follows (plans/0083 D1–D5, the budget re-ruled by plans/
// 0146): fix rounds run while progress holds — each round closes gaps under
// the pack's repair discipline and is committed with stage `execute`
// (per-session commits, subject `<id> fix <round>.<session> <short title>`),
// each followed by a re-verification
// from scratch; the task blocks only once two consecutive rounds closed no
// gap (the countable gap list stopped shrinking), never on a round count
// alone. The round is session-unbounded (plans/0146 D5): gaps are the
// natural handover boundaries, and a context-wall handover may land mid-gap
// with no gap closed — progress is measured per round, so such sessions
// cost nothing against it. Past the block today's ladder
// continues verbatim — block with the repair fact (--repair: closeUnit +
// append) or exit 2 for the person.
// Before 0083 the wrap-up session narrated: the only verdict (plans/0044
// §3) was written by that narrative session with no verification charter,
// and the first FAIL jumped straight to the heavyweight path. The verdict
// protocol itself is unchanged (D6): `Result: PASS|FAIL`, the parser, the
// closeout consequence — a pack without `### result-line` writes no verdict,
// no FAIL ever fires and the loop is dead weight that never runs (the
// zero-intent floor is byte-identical today-behavior); `--no-wrapup` keeps
// its meaning (no verify session; a task-written report is still read at
// closeout).
// report.md's shape gates predate 0083 (session-boundary-hardening §4.5
// D5, S3b): existence / non-trivial / last-line terminator → one re-prompt
// with feedback (the fork path) → still failing → blocked (hidden blockage).
// 0083 D3 adds the FAIL-side gate: a FAIL verdict requires the gap list
// present and non-empty, same one-re-prompt shape. Only this session's
// output is checked, never existing material.
// Dependency direction: above session/unit-commit/exec-session, below runner
// (module-split-plan §D.2).

import { rm } from "node:fs/promises"
import { join, relative } from "node:path"
import type { SessionChain } from "./chain"
import { nameSubject } from "./chain-transitions"
import { docShapeProblems, EOF_MARK } from "./doccheck"
import { handoffFile, taskDoc, taskDocPaths } from "./docpaths"
import { handoffStatus, parseResult, type ReportResult } from "./document/roles"
import { nextFixSession, shortTitle, type UnitBaseline } from "./git"
import { gitOf } from "./git-ops"
import { acceptanceSection, anchorLaneOf, parseTestLanes } from "./intent/test-lanes"
import { ledgerSection } from "./formulate-synthesis"
import { roundOfPhaseId, strictRegressionWait } from "./regression"
import { autobanner, log } from "./log"
import { handoverVerdict, STEER_CHAIN_ADVISORY, STEER_CHAIN_BOUND, type HandoverState } from "./execute"
import { DEFAULT_CONTEXT_LIMIT, type ClientSource, type Opts, type Outcome, type UnitStop } from "./opts"
import { codeWork } from "./phases/registry"
import { promptViews, bookAttempt, type Plan, type Task } from "./tasks"
import { renderFix, renderWrapup } from "./prompt"
import { promptFacts } from "./prompt-facts"
import type { Phase } from "./resume"
import { sessionRole } from "./roles/registry"
import { runExecSession } from "./exec-session"
import { runTestLanes, type LaneRun } from "./script"
import { runSession } from "./session"
import { forkEndedSession } from "./session-api"
import { shellProfile } from "./shell"
import { statsModelEvent } from "./stats"
import { consumeDeadTestMarker, handoffSteer } from "./testrun"
import { autoSwitches } from "./switches"
import { commitBlocked, wrapupResolves } from "./unit-commit"

// The fix loop's two named constants in one (plans/0083 D5, re-ruled by
// plans/0146 D3): the minimum rounds before a block may fire, and the
// consecutive-no-progress threshold — the task blocks only once FIX_ROUNDS
// rounds have run AND the last FIX_ROUNDS rounds each closed no gap (the
// gap count did not shrink). Rounds above the minimum are bounded by
// progress itself: between two no-progress rounds a progress round must
// strictly shrink the count, so a loop starting from N gaps runs at most
// 2 + N rounds. Then the escalation ladder of plans/0079 §4 unchanged
// (block with the repair fact → `--repair` → the human). No CLI flag, no
// config key; width, if ever needed, arrives run-side the way `--repair`'s
// did.
const FIX_ROUNDS = 2

// report.md shape problems (empty = pass): the path is fixed and known to the
// driver (the wrap-up template pins docs/<id>/report.md), so no declaration is
// needed; missing/empty is its own case, otherwise non-trivial + terminator.
async function reportProblems(dir: string, task: Task): Promise<string[]> {
  const rel = taskDoc(task.id, "report")
  const text = await Bun.file(join(dir, rel)).text().catch(() => "")
  if (!text.trim()) return [`${rel} missing or empty`]
  return docShapeProblems(text, rel)
}

// The mechanical gap count of a gap list (plans/0146 D1): one `### Gap N —`
// heading per gap — the countable grammar the wrap-up template teaches, the
// fix session reads, and the driver's own lane-gap writer emits. The
// progress rule keys on this count alone, never on the entries' content.
function countGaps(text: string): number {
  let n = 0
  for (const line of text.split("\n")) if (/^### Gap\b/.test(line)) n += 1
  return n
}

// The FAIL-side shape gate (0083 D3, the grammar extended by plans/0146 D1):
// the gap list must be present, non-empty, and carry at least one
// `### Gap N —` heading — the countable form the progress rule measures. A
// freeform list without the headings is a malformed FAIL for the
// one-re-prompt rule, exactly like a missing one.
function gapsShapeProblems(text: string, rel: string): string[] {
  if (!text.trim()) return [`${rel} missing or empty (a FAIL verdict's gap list; write no report, write that file)`]
  if (countGaps(text) === 0) return [`${rel} carries no \`### Gap N — <title>\` heading under \`## Gaps\` (one heading per gap — the form the DRIVER counts for the fix budget)`]
  return []
}

// The verification verdict of one ended verify session (0083 D2/D3): PASS is
// the report's own result line; FAIL is either an explicit `Result: FAIL`
// line (wherever the session wrote one — a report it should not have written
// on FAIL, or the gap list's own closing line) or, with the report carrying
// no verdict, a non-empty gap list. Since plans/0170 D1 both files are this
// session's writes alone — the round's dispatch removed them (see
// verifySession) — so no file of an earlier round or of a work/fix session
// can participate in the order below; the order is intra-round only.
// "none" keeps today's behavior: no verdict, no stop (the pack's own rule
// lets a non-acceptance task that met its goal omit the line).
async function verifyVerdict(dir: string, task: Task): Promise<{ kind: "pass" } | { kind: "fail"; reason: string } | { kind: "none" }> {
  const report = parseResult(await Bun.file(join(dir, taskDoc(task.id, "report"))).text().catch(() => ""))
  if (report?.type === "pass") return { kind: "pass" }
  const gapsText = await Bun.file(join(dir, taskDoc(task.id, "gaps"))).text().catch(() => "")
  const gaps = parseResult(gapsText)
  if (report?.type === "fail") return { kind: "fail", reason: report.reason || (gaps?.type === "fail" ? gaps.reason : "") }
  if (gapsText.trim()) return { kind: "fail", reason: gaps?.type === "fail" ? gaps.reason : "" }
  return { kind: "none" }
}

// The unit's commit range for the verification charter (0083 D1): the SHA
// baseline at unit start through HEAD — everything the task's sessions
// changed. undefined outside git / under the no-commit double (the charter
// words the inspection without a range then).
// scope (plans/0099 D7): a doc unit's rendered range becomes path-limited —
// `<sha>..HEAD -- <scope>` — because under doc-lane concurrency the plain
// range contains the siblings' commits; the pathspec (the unit's effective
// scope, exclusive to the unit by disjointness) makes the range exactly the
// unit's own commits. The template sentence stays generic; the injected
// string carries the pathspec. Absent = today's range, byte-identical.
// Exported for the doc-lanes suite's pure-half tests.
export function commitRangeText(dir: string, baseline: UnitBaseline, scope?: readonly string[]): string | undefined {
  if (!baseline.length) return undefined
  const spec = scope?.length ? ` -- ${scope.join(" ")}` : ""
  return baseline
    .map(({ root, sha }) => {
      const range = sha ? `${sha}..HEAD${spec}` : "HEAD (the unit's whole history)"
      const rel = relative(dir, root) || "."
      return baseline.length === 1 ? range : `${rel}: ${range}`
    })
    .join("; ")
}

// One verify session + its shape gates. Returns pass = the report is
// committed and the task may close out; fail = the gap list is committed and
// a fix round is due (reason rides along for the block message); stop = a
// blocked exit or commit failure. i counts this round's session attempts for
// the one-re-prompt rule.
type VerifyOutcome = { kind: "pass" } | { kind: "fail"; reason: string } | { kind: "stop"; stop: UnitStop }

async function verifySession(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  input: { solo: boolean; label: string; commitRange?: string; docLane?: boolean },
): Promise<VerifyOutcome> {
  const dir = opts.dir ?? plan.dir
  const git = gitOf(opts)
  const subject = `${task.id} wrapup ${shortTitle(task.title)}`
  nameSubject(chain, subject)
  const resolves = await wrapupResolves(dir, task.id)
  const views = promptViews(plan, task)
  // The per-row framing's input (plans/0097 D8): a formulation task whose
  // Scope carries an obligations ledger is judged row by row; every other
  // task (and a floor formulation) keeps the holistic charter word-for-word.
  const ledger = task.formulate !== undefined ? ledgerSection(task.body) : undefined
  let feedback = ""
  // When the shape re-prompt goes out through a fork of the session that just
  // ended (2026-09-18 revision), the next turn carries only the feedback — the
  // copy already holds the full prompt and all wrap-up context, and resending
  // the whole prompt only invites a redo from scratch.
  let shapeForked = false
  // The verifier's documents are the round's alone (plans/0170 D1, enacting
  // 0165-006 / S11-01): both reserved files are removed before the round's
  // first dispatch, so the verdict below keys on this session's writes
  // exactly — a report.md a work or fix session left behind can never
  // outrank a FAIL, and a stale gaps.md of an earlier round never feeds one.
  // The removal lands in this round's wrap-up commit (the PASS close-out or
  // the FAIL's gap commit); the shape re-prompt's fork stays inside the loop
  // and never re-runs this.
  await rm(join(dir, taskDoc(task.id, "report")), { force: true })
  await rm(join(dir, taskDoc(task.id, "gaps")), { force: true })
  for (let i = 0; ; i++) {
    const brief = shapeForked
    shapeForked = false
    const result = await runSession(
      client,
      task,
      brief
        ? feedback.trimStart()
        : renderWrapup(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { mode: opts.mode, solo: input.solo, resolves, commitRange: input.commitRange, ...(input.docLane ? { docLane: true } : {}), ...(ledger !== undefined ? { ledger } : {}) }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return { kind: "stop", stop: result }
    const verdict = await verifyVerdict(dir, task)
    // The verdict-side shape gate (0083 D3, the grammar extended by plans/
    // 0146 D1): a FAIL verdict requires the gap list present, non-empty and
    // countable (at least one `### Gap N —` heading); a PASS or no verdict
    // requires the report shape (existence / non-trivial / terminator —
    // unchanged).
    const gapsRel = taskDoc(task.id, "gaps")
    const problems =
      verdict.kind === "fail"
        ? gapsShapeProblems(await Bun.file(join(dir, gapsRel)).text().catch(() => ""), gapsRel)
        : await reportProblems(dir, task)
    if (!problems.length) {
      if (verdict.kind === "fail") {
        // Per-model protocol-drift counter (plans/0055 §10 item 3): the FAIL
        // verdict was written by the verify session, whose selected entry the
        // chain still holds.
        await statsModelEvent(dir, chain.modelEntry, "fail")
        // The gap list lands through the wrap-up session's own commit boundary
        // (stage wrapup, like the PASS report): a committed gap list is what
        // an interrupted round leaves behind, and the next verify round
        // overwrites it wholesale (D3's lifecycle rule).
        const committed = await git.afterSession(dir, opts, task, { stage: "wrapup", subject })
        if (committed.type === "failed") return { kind: "stop", stop: commitBlocked(`${task.id} ${input.label}`, committed) }
        return { kind: "fail", reason: verdict.reason }
      }
      // PASS (or no verdict under the pack's own omission rule): the gap list
      // of any earlier round is stale state — deleted here at close-out, the
      // deletion landing in the wrap-up commit (transient like handoff.md).
      await rm(join(dir, gapsRel), { force: true })
      const committed = await git.afterSession(dir, opts, task, { stage: "wrapup", subject })
      if (committed.type === "failed") return { kind: "stop", stop: commitBlocked(`${task.id} ${input.label}`, committed) }
      // The verify session's own unservable request (plans/0142, widened by
      // plans/0156 D8): a PASS that leaves tmp/test.sh behind is consumed at
      // this task's close — the wrap-up template forbids re-running checks,
      // so the marker here is the T-058 shape (the session read the task's
      // gap list or document naming it), and without this consumption it
      // would linger until the NEXT task's wrap-up entry, whose log would
      // misattribute it to that task. The FAIL path needs nothing: its fix
      // round's close consumes and blocks on it already.
      await consumeDeadTestMarker(dir, opts, task.id)
      return { kind: "pass" }
    }
    const rel = verdict.kind === "fail" ? gapsRel : taskDoc(task.id, "report")
    if (i === 1) {
      return {
        kind: "stop",
        stop: {
          type: "blocked",
          question:
            `wrap-up session ended ${verdict.kind === "fail" ? "with a FAIL verdict" : "twice"} but ${rel} did not pass checks (${problems.join("; ")}; hidden blockage). ` +
            `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
        },
      }
    }
    feedback =
      verdict.kind === "fail"
        ? `\n\nThe last time you ended the session, the FAIL verdict reached the DRIVER but ${gapsRel} did not pass checks: ${problems.join("; ")}. This is a hard requirement: ` +
          `write no report; write the task's gap list into ${gapsRel} — the compact summary of what you verified as OK, then one entry per gap as a \`### Gap N — <one-line title>\` heading under a \`## Gaps\` heading — ` +
          `ending with the \`Result: FAIL <one-sentence reason>\` line as its last line of body text, before ending the session.`
        : `\n\nThe last time you ended the session, ${rel} did not pass checks: ${problems.join("; ")}. This is a hard requirement: ` +
          `write the task report into that file, complete, with \`${EOF_MARK}\` alone on the last line of body text, before ending the session.`
    // The re-prompt continues on a fork of the session that just ended (with
    // all wrap-up context); if forking is unavailable, fall back to a fresh
    // session + the full prompt.
    shapeForked = await forkEndedSession(client, chain, subject)
    // Per-model protocol-drift counter (plans/0055 §10 item 3): booked on the
    // model of the wrap-up session that failed the shape check.
    await statsModelEvent(dir, chain.modelEntry, "reprompt")
    log(`↻ ${task.id} wrap-up session's ${rel} failed checks; ${shapeForked ? "forked from the original session, " : ""}retrying once with feedback`)
  }
}

// One fix round (0083 D4, the commit shape re-ruled by plans/0148 D1): a
// fresh fix session reads the gap list + the task document, closes exactly
// the listed gaps under the pack's repair discipline (renderFix) and re-runs
// the checks covering its own changes; the driver commits each session's
// batch at its own boundary with stage `execute` (it is execution; the
// close-out trailer validation is untouched), subject
// `<id> fix <round>.<session> <short title>`. The round books into the task's `attempts` (D7). Since plans/
// 0130 D2 the round runs under the standing context-handover protocol: with
// OPENCODE_AUTO_STEER on the fix session gets usage notices and may hand
// itself over through docs/<id>/handoff.md (`Status: continue` — a fresh fix
// session continues from the document, each session's own batch committing
// at its boundary, plans/0148 D1); the whole role's usage policy governs (a
// fix round is a whole-scope execution dispatch). The execution stage's
// handover document never reaches a round (retired at the wrap-up tail's
// entry, plans/0171 D5) — a document present here belongs to the fix tail
// itself, and an interrupted fix session's `Status: continue` seeds the
// round's first continuation.
// There is no rollback redo inside a round (the strict-resume unit rollback
// stays the execution stage's; a handover due without a valid document takes
// the engine's single retry with feedback, then blocks).
async function runFixRound(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  round: number,
  persist?: (phase: Phase) => Promise<void>,
): Promise<UnitStop | undefined> {
  const dir = opts.dir ?? plan.dir
  const git = gitOf(opts)
  const views = promptViews(plan, task)
  log(`↻ ${task.id} verification found gaps; fix round ${round} closes exactly ${taskDoc(task.id, "gaps")}`)
  const readHandoff = async (): Promise<string> => Bun.file(join(plan.dir, handoffFile(task))).text().catch(() => "")
  const steer = sessionRole("whole").usage.handover ? handoffSteer(autoSwitches().steer, opts.contextLimit ?? DEFAULT_CONTEXT_LIMIT, task) : undefined
  // Interruption seeding: since the execution stage's document is retired at
  // the wrap-up tail's entry (plans/0171 D5), a leftover handover document at
  // a round's entry is an interrupted fix session's handover — Status:
  // continue seeds this round's first dispatch as its continuation; any
  // other shape is the consumed seed, not a signal.
  const priorText = await readHandoff()
  const handover: HandoverState = { consumed: priorText, retried: false, rolled: false, continuations: 0 }
  let continuation = handoffStatus(priorText) === "continue"
  let feedback = ""
  // Per-session commits (plans/0148 D1): every session that ends in a
  // handover-continue commits its own gap batch at the boundary (the
  // executeWhole pattern — durable work at every safe point, crash-isomorphic
  // with a kill there), and the natural end commits the last batch; the
  // subject carries the round and the session's dispatch ordinal
  // (`<id> fix <round>.<session>`), the numbering derived from the history so
  // a resumed round instance continues it. A context-wall handover with
  // nothing durable commits nothing (the unified commit skips a clean tree)
  // — the ordinal still advances, so git may skip indices. Retry/coldstart
  // re-dispatches stay uncommitted (the replaced session's partial work
  // rides the next durable boundary).
  let session = await nextFixSession(dir, task.id, round)
  let subject = ""
  for (;;) {
    const ordinal = session++
    subject = `${task.id} fix ${round}.${ordinal} ${shortTitle(task.title)}`
    nameSubject(chain, subject)
    const result = await runExecSession(
      client,
      plan,
      task,
      renderFix(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { mode: opts.mode, continuation, budget: steer !== undefined, ...(handover.continuations > STEER_CHAIN_ADVISORY ? { chainAdvisory: handover.continuations, chainBound: STEER_CHAIN_BOUND } : {}) }) + feedback,
      opts,
      chain,
      steer,
      undefined,
      `fix ${round}.${ordinal}`,
    )
    if (result.type === "blocked") return result
    feedback = ""
    const decision = await handoverVerdict(client, task, chain, steer, handover, { retry: "fresh", fix: true, subject, rollbackRedo: async () => undefined }, readHandoff, result.lastText)
    if (decision.type === "natural") break
    if (decision.type === "continue") {
      // The fix round's handovers are /exit boundaries too (plans/0143): the
      // round is neither booked nor committed past this point — the boundary
      // first, then the handing-over session's own batch commits — and the
      // re-run's round entry seeds from the handoff document — the same
      // record a kill between the round's sessions leaves.
      opts.control?.maybeExit("handover", `${task.id} fix ${round} session handover`)
      const handed = await git.afterSession(dir, opts, task, { stage: "execute", subject })
      if (handed.type === "failed") return commitBlocked(`${task.id} fix ${round}.${ordinal}`, handed)
      continuation = true
      continue
    }
    if (decision.type === "retry") {
      feedback = decision.feedback
      continue
    }
    if (decision.type === "coldstart") continue
    if (decision.type === "stop") return decision.stop
    return decision
  }
  // The round's natural end retires the handover document (plans/0171 D5):
  // a `Status: continue` a mid-round session left and the finishing session
  // did not rewrite would otherwise seed the NEXT round's first dispatch as
  // this round's continuation — the same stale-inheritance shape the
  // execution stage's leftover gave the tail (S10-01). The deletion rides
  // the round's close-out commit below.
  await rm(join(plan.dir, handoffFile(task)), { force: true })
  const committed = await git.afterSession(dir, opts, task, { stage: "execute", subject })
  if (committed.type === "failed") return commitBlocked(`${task.id} fix ${round}.${session - 1}`, committed)
  // The round never books a wait (plans/0142 D2): a fix session that ended
  // with a test request pending against a channel that will not serve it
  // (this phase is not code work, or the flag is off) waited on the driver's
  // own gap — the T-058 incident booked such a round on a 51-second wait and
  // the budget-spent block then taught three remedies none of which named
  // the dead channel. The round's work is committed above (hybrid sessions
  // strand nothing behind the next run's clean gate); the round is NOT
  // booked — the opening persist (which ran before this round's sessions)
  // is rewound to the roundless wrap-up stage, so a re-run re-opens this
  // round fresh rather than counting it spent — and the block teaches the
  // real exits. D7's rule keeps its rationale — no round is re-run; an
  // unbooked round re-opens fresh.
  const deadChannel = await consumeDeadTestMarker(dir, opts, `${task.id} fix ${round}`)
  if (deadChannel) {
    await persist?.({ kind: "wrapup" })
    return {
      type: "blocked",
      question:
        `the fix session of ${task.id} (round ${round}) ended with a driver-test request pending (tmp/test.sh), but the driver test channel does not serve this session — ${deadChannel} — so the request can never execute. ` +
        `The round is not booked (the budget is untouched; a re-run re-opens this round) and any work its sessions completed is committed. ` +
        `The driver-test instruction comes from the task's own document or the gap list (both name tmp/test.sh); in a phase without the channel a session runs such a check itself in-session (within the task's rules), ` +
        `or the task belongs in a code-work phase, or you run the command by hand. Adjust the task's step — and the gap list's entry — accordingly, then re-run.`,
    }
  }
  await bookAttempt(dir, task.id)
  return undefined
}

// —— The driver-run lane gate (plans/0096 D5) ——
//
// The 0083 channel's parallel half, run at the top of every verification
// round: after the task's execution sessions ended and their shares committed
// (the tree frozen), the pack's lane table runs as the driver's own parallel
// processes (runTestLanes — cheap lanes concurrently, the anchor once they
// green, exclusive lanes alone, the set-level stash guard, receipts as
// committed evidence). The anchor pre-gate then decides the round's entry:
// the resolved anchor row's receipt must be green at the current tree — a red
// anchor goes straight into the fix loop with synthesized gaps instead of a
// verify session that would FAIL on the same finding. The receipts are on
// disk either way; the wrap-up charter (Stage 2's clause) lets the verify
// session judge them by inspection.

// One gate verdict: off = the channel or the table is inactive (the
// byte-identical floor, no lane launched); green = the verify session may be
// dispatched; red = the fix loop opens over the driver-synthesized gap list
// (runs feeds its verified-OK summary, gaps carries the ready bullet lines,
// reason the one-sentence verdict the Result: FAIL line closes with); stop =
// a moved HEAD, the corrupted-baseline family — no verification over a
// corrupted baseline.
type LaneGate = { kind: "off" } | { kind: "green" } | { kind: "red"; reason: string; gaps: string[]; runs: LaneRun[] } | { kind: "stop"; stop: UnitStop }

// The previous task in the index (the loader's default dependency: a task
// without a `Depends:` field depends on the task listed before it) — the
// strict wait's effective dependency set mirrors the readiness rule exactly.
function previousTaskId(plan: Plan, id: string): string[] {
  const at = plan.tasks.findIndex((task) => task.id === id)
  return at > 0 ? [plan.tasks[at - 1]!.id] : []
}

async function laneGate(dir: string, task: Task, opts: Opts, plan: Plan, drain?: () => Promise<void>): Promise<LaneGate> {
  // The channel's derived condition, the same line runExecSession gates on
  // (plans/0083 D9): the config flag AND the phase type's codeWork (a
  // phase-less opts resolves onto implement, so bare runs keep the raw-flag
  // behavior); dryrun launches nothing. Without a pack table (Stage 2's
  // zero-intent floor) today's serial tmp/test.sh protocol is the whole
  // channel, byte-for-byte.
  if (!(opts.testByDriver && codeWork(opts.phase?.entry)) || opts.dryrun) return { kind: "off" }
  const lanes = parseTestLanes(promptFacts(opts).pack)
  if (!lanes) return { kind: "off" }
  // The doc-lane drain (plans/0099 D9): driver-run lanes and the strict
  // wait's in-tree run need a quiet tree — a sibling doc lane's in-flight
  // writes would cross the set-level stash guard (a tracked mutation it
  // would restore as its own). The doc loop's drain callback brings the
  // tree to "no other lane in flight" before anything launches; an absent
  // callback (every serial unit, the lane loops' workers) is today's
  // behavior. For a doc unit the gate is usually a no-op anyway — the
  // carry-forward rule skips lanes whose surfaces miss the unit's
  // docs-only changes — so the drain cost is rare; a docs-surfaced lane
  // (a docs-lint suite) still runs, correctly, on a quiet tree.
  await drain?.()
  // The strict test-readiness (plans/0098 D7): a `Strict: yes` regression
  // row makes the unit's testing wait for its dependencies' complete pass
  // — the effective dependency set is the task's `Depends:` ids or, absent
  // the field, the previous task in the index (the loader's own default).
  // The wait's red rides the anchor-red path below; its receipts ride this
  // wrap-up's commits like every lane receipt.
  {
    const deps = task.depends === "none" ? [] : task.depends ?? previousTaskId(plan, task.id)
    const wait = await strictRegressionWait(dir, roundOfPhaseId(opts.phase?.id), lanes, deps, task.id, opts, gitOf(opts))
    if (wait && "corrupted" in wait) {
      return {
        kind: "stop",
        stop: {
          type: "blocked",
          question:
            `a strict regression lane ran a git state command and moved HEAD (${wait.corrupted.join("; ")}); ` +
            `no auto-undo ran — the baseline is corrupted. Investigate the repository state manually and re-run.`,
        },
      }
    }
    if (wait) {
      const reason = `the strict regression lane ${wait.lane} is red at the dependency state (${wait.deps.join(", ")})${wait.run.timedOut ? " (watchdog timeout)" : wait.run.code ? ` (LANE_RC=${wait.run.code})` : ""}`
      const gaps = [
        laneGap(wait.run),
        `The strict regression lane \`${wait.lane}\` vouches for the dependencies ${wait.deps.join(", ")} — its round-scoped receipts live under docs/R-${String(roundOfPhaseId(opts.phase?.id)).padStart(2, "0")}/regression/.`,
      ]
      return { kind: "red", reason, gaps, runs: [wait.run] }
    }
  }
  const anchor = anchorLaneOf(acceptanceSection(task.body), lanes)
  const set = await runTestLanes(dir, task.id, lanes, { idleMs: opts.idleMs, maxMs: opts.maxMs, git: gitOf(opts) })
  if (set.violation?.kind === "head") {
    return {
      kind: "stop",
      stop: {
        type: "blocked",
        question:
          `a driver-run test lane ran a git state command and moved HEAD (${set.violation.moved.map((move) => `${move.root}: ${move.from} → ${move.to}`).join("; ")}); ` +
          `no auto-undo ran — the baseline is corrupted. Investigate the repository state manually and re-run.`,
      },
    }
  }
  if (!anchor) {
    // No resolvable anchor is no pre-gate: the set ran for evidence (the
    // committed receipts), and the verify session judges them by inspection —
    // an ambiguous anchor never gates mechanically.
    return { kind: "green" }
  }
  const own = set.runs.find((run) => run.lane === anchor.name)
  if (own?.verdict === "green") return { kind: "green" }
  // The red side: the anchor itself ran red, or it was withheld — the cheap
  // tier ran red, so it never launched and its receipt does not carry — in
  // which case the red cheap lanes' evidence stands in (the anchor produced
  // none of its own).
  const reds = set.runs.filter((run) => run.verdict === "red")
  const gaps = (own ? [own] : []).concat(reds.filter((run) => run.lane !== anchor.name)).map(laneGap)
  if (!own) gaps.push(`The anchor lane \`${anchor.name}\` never ran: the cheap tier must green first — re-green it and the anchor launches.`)
  const reason = own
    ? `the anchor lane ${anchor.name} is red${own.timedOut ? " (watchdog timeout)" : own.code ? ` (LANE_RC=${own.code})` : ""}`
    : `the anchor lane ${anchor.name} was withheld: the cheap tier ran red (${reds.map((run) => run.lane).join(", ")})`
  return { kind: "red", reason, gaps, runs: set.runs }
}

// One red lane's entry for the synthesized gap list: the finding plus its
// bounded evidence. The first line is heading-ready (plans/0146 D1 — no
// bullet): laneGapList numbers every entry as a `### Gap N — <title>`
// heading, the countable grammar the progress rule measures.
function laneGap(run: LaneRun): string {
  const head = `lane \`${run.lane}\` red${run.timedOut ? " — killed by the watchdog" : run.code ? ` — LANE_RC=${run.code}` : ""}${run.log ? `, log ${run.log}` : ""}`
  return [head, ...(run.evidence?.length ? run.evidence : ["(the log is empty)"])].map((line, i) => (i === 0 ? line : `    ${line}`)).join("\n")
}

// The driver-synthesized gap list (D5: "synthesize the gap list the fix
// session closes; reuse the existing gaps.md flow") — the 0083 D3 form: the
// verified-OK summary, one entry per gap as a `### Gap N — <title>` heading
// (plans/0146 D1 — the countable grammar, uniform with what the verify
// sessions write), the closing Result: FAIL line, no terminator (transient
// like every gap list, overwritten by each round).
function laneGapList(task: Task, runs: readonly LaneRun[], gate: { reason: string; gaps: string[] }): string {
  const green = runs.filter((run) => run.verdict === "green")
  const entries = gate.gaps.map((gap, i) => {
    const [head, ...body] = gap.split("\n")
    return [`### Gap ${i + 1} — ${head}`, ...body].join("\n")
  })
  return [
    `# Gaps (${task.id})`,
    "",
    "## Verified OK",
    "",
    green.length
      ? `- Driver-run test lanes green at this tree: ${green.map((run) => run.lane).join(", ")} (receipts under docs/${task.id}/testhands/).`
      : "- The driver-run lane set produced no green lanes at this tree.",
    "",
    "## Gaps",
    "",
    ...entries,
    "",
    `Result: FAIL ${gate.reason}`,
    "",
  ].join("\n")
}

// Runs the task's verification loop (0083 D1–D5, the budget re-ruled by
// plans/0146) and closes it out: verify
// session → PASS → wrapup commit → done; FAIL → gap list → fix round →
// re-verify from scratch → …; two consecutive no-progress rounds and still
// FAIL → today's blocked path with the repair fact, the message naming the
// rounds spent and the stalled count.
// Since plans/0096 D5 every round opens with the lane gate above: a red gate
// substitutes the driver-synthesized gap list for the verify session's
// (committed with the same wrapup stage) and enters the same fix loop;
// carry-forward makes the post-fix re-run narrow. round is the fix rounds
// this task has already spent (resume, D7: a round counts once it opens, so
// a resumed run never re-runs a spent round); noProgress and gaps carry the
// progress rule's state (plans/0146 D4 — the consecutive no-progress rounds
// and the count the last FAIL measured), persisted with the round at every
// wrapup-stage write so a kill anywhere re-enters with the loop's exact
// state; persist advances the progress
// record's wrapup stage; baseline is the unit's start SHA baseline (the
// charter's commit range); scope is D7's effective-scope pathspec of a doc
// lane's unit (absent on every serial unit — the charter's range stays
// today's); drain is D9's doc-lane quiet-tree callback, awaited by the lane
// gate and the strict wait before any driver-run lane launches (absent =
// today's behavior). label is the unit name used when a commit fails;
// solo is the off/auto/ondemand whole-task mode, every mode but the true
// pipeline (the report is an output summary rather than an index).
// undefined = verification passed; the only non-blocked other exit never
// happens (the loop's blocked carries the repair fact for the --repair
// ladder, an Outcome field).
export async function runWrapup(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  input: { solo: boolean; label: string; round?: number; noProgress?: number; gaps?: number; persist?: (phase: Phase) => Promise<void>; baseline?: UnitBaseline; scope?: readonly string[]; drain?: () => Promise<void>; docLane?: boolean },
): Promise<Outcome | undefined> {
  const dir = opts.dir ?? plan.dir
  const git = gitOf(opts)
  const commitRange = commitRangeText(dir, input.baseline ?? [], input.scope)
  // The progress rule's state (plans/0146 D2): lastGaps = the count the
  // previous FAIL measured (undefined before this loop's first FAIL — that
  // one only seeds, no round preceded it), noProgress = the consecutive
  // fix rounds that closed no gap. Both ride the resumed phase record and
  // every wrapup-stage persist below.
  let lastGaps = input.gaps
  let noProgress = input.noProgress ?? 0
  for (let round = input.round ?? 0; ; ) {
    // The wrap-up's entry consumes a stale unservable marker (plans/0142 D1):
    // a resume straight into the wrap-up (the standing-project shape) would
    // otherwise hand the verify session a dead tmp/test.sh to read as wiring —
    // the incident's re-verification "verified" it as exactly right, twice.
    await consumeDeadTestMarker(dir, opts, task.id)
    autobanner(`${task.id} ${task.title}: wrap-up${round > 0 ? ` (re-verification after fix round ${round})` : ""}`)
    await input.persist?.(wrapupStage(round, noProgress, lastGaps))
    // The wrap-up entry is an /exit boundary (plans/0143 D5): the stage's
    // persist above is what a re-run re-enters by, and nothing of this
    // round's verification has started — the pause is the scene a kill at
    // the same spot leaves. Fires at every iteration (the initial entry and
    // each re-verification), always after the persist.
    opts.control?.maybeExit("wrapup", `${task.id} wrap-up entry${round > 0 ? ` (after fix round ${round})` : ""}`)
    const gate = await laneGate(dir, task, opts, plan, input.drain)
    if (gate.kind === "stop") return gate.stop
    let reason: string
    if (gate.kind === "red") {
      // The anchor pre-gate's red side (D5): no verify session dispatches
      // over a tree whose declared gate is red — the driver writes the
      // synthesized gap list, commits it with the wrap-up stage (the receipts
      // land through the same session close-out commit, like a verify FAIL's
      // gap list) and the fix round below closes it.
      const subject = `${task.id} wrapup ${shortTitle(task.title)}`
      nameSubject(chain, subject)
      await Bun.write(join(dir, taskDoc(task.id, "gaps")), laneGapList(task, gate.runs, gate))
      const committed = await git.afterSession(dir, opts, task, { stage: "wrapup", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} ${input.label}`, committed)
      reason = gate.reason
    } else {
      const outcome = await verifySession(client, plan, task, opts, chain, { solo: input.solo, label: input.label, commitRange, ...(input.docLane ? { docLane: true } : {}) })
      if (outcome.kind === "pass") return undefined
      if (outcome.kind === "stop") return outcome.stop
      reason = outcome.reason
    }
    // The progress measurement (plans/0146 D2): count the gap list this FAIL
    // just produced (the driver-synthesized one on the red path, the verify
    // session's on the other) and judge the round that preceded it. The
    // first FAIL of a loop instance only seeds the baseline; every later one
    // compares — a strictly smaller count is progress and clears the streak,
    // anything else (same count, grown count) extends it.
    const gapsNow = countGaps(await Bun.file(join(dir, taskDoc(task.id, "gaps"))).text().catch(() => ""))
    if (lastGaps !== undefined) noProgress = gapsNow < lastGaps ? 0 : noProgress + 1
    lastGaps = gapsNow
    if (round >= FIX_ROUNDS && noProgress >= FIX_ROUNDS) {
      // No progress across the last two fix rounds (plans/0146 D3): today's
      // ladder verbatim (plans/0079 §4) — the
      // repair fact carries the verdict to a `--repair` round, else the block
      // waits for the person; the message names the rounds spent and the
      // stalled count (D5) and its source (a red lane gate or the
      // verification itself).
      const { bin } = shellProfile()
      const lead =
        gate.kind === "red"
          ? `the driver-run test lanes of ${task.id} concluded red${reason ? ` (${reason})` : ""}`
          : `the verification of ${task.id} concluded Result: FAIL${reason ? ` (${reason})` : ""}`
      return {
        type: "blocked",
        repair: { reason },
        question:
          `${lead} and the last two fix rounds closed no gap (${round} fix rounds spent, the gap list still counts ${lastGaps} gap${lastGaps === 1 ? "" : "s"}); the remaining gaps are listed in ${taskDoc(task.id, "gaps")}. ` +
          `The work and the gap list are committed; accept the result with ${bin} close ${task.id} --reason <text>; ` +
          `or replace the task with ${bin} plan --force-close ${task.id} --reason <text> --append -p <what to do instead>; ` +
          `or list fix tasks before it in ${plan.index} by hand; then re-run.`,
      }
    }
    round += 1
    await input.persist?.(wrapupStage(round, noProgress, lastGaps))
    const stopped = await runFixRound(client, plan, task, opts, chain, round, input.persist)
    if (stopped) return stopped
    // Re-verification runs from scratch (D3/D4): the next loop iteration
    // re-runs the lane gate (carry-forward keeps it narrow) and re-reads
    // everything, overwriting the gap list wholesale.
  }
}

// The wrapup stage's progress record (plans/0083 D7, the fields of plans/
// 0146 D4): round = the fix rounds already spent (a round counts once it
// opens), noProgress = the consecutive rounds that closed no gap (omitted at
// zero), gaps = the count the last FAIL measured (the progress baseline).
// All three ride every wrapup-stage persist — the loop entry's and the
// pre-fix-round's — so a kill anywhere re-enters with the loop's exact
// state; the 0142 dead-channel rewind writes the roundless form and thereby
// drops all three (the unbooked round re-opens, its verification re-seeds).
function wrapupStage(round: number, noProgress: number, gaps: number | undefined): Phase {
  return { kind: "wrapup", ...(round > 0 ? { round } : {}), ...(noProgress > 0 ? { noProgress } : {}), ...(gaps !== undefined ? { gaps } : {}) }
}

// Result line of the task report (FAIL stops the run): the parser lives in the
// document domain (roles.ts parseResult) since the phase verdict gate reads the
// same line (M4.2, plans/0049 G7).
export { parseResult }

// Reads docs/<id>/report.md; a missing report is no verdict.
export async function reportResult(dir: string, task: Task): Promise<ReportResult | undefined> {
  return parseResult(await Bun.file(join(dir, taskDoc(task.id, "report"))).text().catch(() => ""))
}
