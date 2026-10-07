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
// else). A bounded fix loop follows: at most FIX_ROUNDS fix sessions, each
// closing exactly the listed gaps under the pack's repair discipline and
// committed with stage `execute` (subject `<id> fix <round> <title>`), each
// followed by a re-verification from scratch; past the budget today's ladder
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
import { taskDoc, taskDocPaths } from "./docpaths"
import { parseResult, type ReportResult } from "./document/roles"
import type { UnitBaseline } from "./git"
import { gitOf } from "./git-ops"
import { autobanner, log } from "./log"
import type { ClientSource, Opts, Outcome, UnitStop } from "./opts"
import { promptViews, bookAttempt, type Plan, type Task } from "./tasks"
import { renderFix, renderWrapup } from "./prompt"
import { promptFacts } from "./prompt-facts"
import type { Phase } from "./resume"
import { runExecSession } from "./exec-session"
import { runSession } from "./session"
import { forkEndedSession } from "./session-api"
import { shellProfile } from "./shell"
import { statsModelEvent } from "./stats"
import { commitBlocked, wrapupResolves } from "./unit-commit"

// The constant budget of fix rounds per task (plans/0083 D5): the FIX_ROUNDS
// name plans/0044 deleted returns with one clear meaning — at most two fix
// rounds, then the escalation ladder of plans/0079 §4 unchanged (block with
// the repair fact → `--repair` → the human). No CLI flag, no config key;
// width, if ever needed, arrives run-side the way `--repair`'s did.
export const FIX_ROUNDS = 2

// report.md shape problems (empty = pass): the path is fixed and known to the
// driver (the wrap-up template pins docs/<id>/report.md), so no declaration is
// needed; missing/empty is its own case, otherwise non-trivial + terminator.
async function reportProblems(dir: string, task: Task): Promise<string[]> {
  const rel = taskDoc(task.id, "report")
  const text = await Bun.file(join(dir, rel)).text().catch(() => "")
  if (!text.trim()) return [`${rel} missing or empty`]
  return docShapeProblems(text, rel)
}

// The verification verdict of one ended verify session (0083 D2/D3): PASS is
// the report's own result line; FAIL is either an explicit `Result: FAIL`
// line (wherever the session wrote one — a report it should not have written
// on FAIL, or the gap list's own closing line) or, with the report carrying
// no verdict, a non-empty gap list. A passing report wins over a stale gap
// list of an earlier round — the PASS close-out deletes the file right after.
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
function commitRangeText(dir: string, baseline: UnitBaseline): string | undefined {
  if (!baseline.length) return undefined
  return baseline
    .map(({ root, sha }) => {
      const range = sha ? `${sha}..HEAD` : "HEAD (the unit's whole history)"
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
  input: { solo: boolean; label: string; commitRange?: string },
): Promise<VerifyOutcome> {
  const dir = opts.dir ?? plan.dir
  const git = gitOf(opts)
  const subject = `${task.id} wrapup ${task.title}`
  nameSubject(chain, subject)
  const resolves = await wrapupResolves(dir, task.id)
  const views = promptViews(plan, task)
  let feedback = ""
  // When the shape re-prompt goes out through a fork of the session that just
  // ended (2026-09-18 revision), the next turn carries only the feedback — the
  // copy already holds the full prompt and all wrap-up context, and resending
  // the whole prompt only invites a redo from scratch.
  let shapeForked = false
  for (let i = 0; ; i++) {
    const brief = shapeForked
    shapeForked = false
    const result = await runSession(
      client,
      task,
      brief
        ? feedback.trimStart()
        : renderWrapup(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { mode: opts.mode, solo: input.solo, resolves, commitRange: input.commitRange }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return { kind: "stop", stop: result }
    const verdict = await verifyVerdict(dir, task)
    // The verdict-side shape gate (0083 D3): a FAIL verdict requires the gap
    // list present and non-empty; a PASS or no verdict requires the report
    // shape (existence / non-trivial / terminator — unchanged).
    const gapsRel = taskDoc(task.id, "gaps")
    const problems =
      verdict.kind === "fail"
        ? (await Bun.file(join(dir, gapsRel)).text().catch(() => "")).trim()
          ? []
          : [`${gapsRel} missing or empty (a FAIL verdict's gap list; write no report, write that file)`]
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
          `write no report; write the task's gap list into ${gapsRel} — the compact summary of what you verified as OK, then one entry per gap — ` +
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

// One fix round (0083 D4): a fresh fix session reads the gap list + the task
// document, closes exactly the listed gaps under the pack's repair discipline
// (renderFix) and re-runs the checks covering its own changes; the driver
// commits its output after the session with stage `execute` (it is execution;
// the close-out trailer validation is untouched), subject `<id> fix <round>
// <title>`. The round books into the task's `attempts` (D7).
async function runFixRound(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  round: number,
): Promise<UnitStop | undefined> {
  const dir = opts.dir ?? plan.dir
  const git = gitOf(opts)
  const subject = `${task.id} fix ${round} ${task.title}`
  nameSubject(chain, subject)
  const views = promptViews(plan, task)
  log(`↻ ${task.id} verification found gaps; fix round ${round} of ${FIX_ROUNDS} closes exactly ${taskDoc(task.id, "gaps")}`)
  const result = await runExecSession(
    client,
    plan,
    task,
    renderFix(promptFacts(opts), views.plan, views.task, taskDocPaths(task.id), { mode: opts.mode }),
    opts,
    chain,
    undefined,
    undefined,
    `fix ${round}`,
  )
  if (result.type === "blocked") return result
  const committed = await git.afterSession(dir, opts, task, { stage: "execute", subject })
  if (committed.type === "failed") return commitBlocked(`${task.id} fix ${round}`, committed)
  await bookAttempt(dir, task.id)
  return undefined
}

// Runs the task's verification loop (0083 D1–D5) and closes it out: verify
// session → PASS → wrapup commit → done; FAIL → gap list → fix round →
// re-verify from scratch → …; FIX_ROUNDS spent and still FAIL → today's
// blocked path with the repair fact, the message naming the rounds spent.
// round is the fix rounds this task has already spent (resume, D7: a round
// counts once it opens, so a resumed run never re-runs a spent round);
// persist advances the progress record's wrapup stage; baseline is the unit's
// start SHA baseline (the charter's commit range). label is the unit name
// used when a commit fails; solo is the off/auto/ondemand whole-task mode,
// every mode but the true pipeline (the report is an output summary rather
// than an index). undefined = verification passed; the only non-blocked
// other exit never happens (the loop's blocked carries the repair fact for
// the --repair ladder, an Outcome field).
export async function runWrapup(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  input: { solo: boolean; label: string; round?: number; persist?: (phase: Phase) => Promise<void>; baseline?: UnitBaseline },
): Promise<Outcome | undefined> {
  const dir = opts.dir ?? plan.dir
  const commitRange = commitRangeText(dir, input.baseline ?? [])
  for (let round = input.round ?? 0; ; ) {
    autobanner(`${task.id} ${task.title}: wrap-up${round > 0 ? ` (re-verification after fix round ${round} of ${FIX_ROUNDS})` : ""}`)
    await input.persist?.({ kind: "wrapup", ...(round > 0 ? { round } : {}) })
    const outcome = await verifySession(client, plan, task, opts, chain, { solo: input.solo, label: input.label, commitRange })
    if (outcome.kind === "pass") return undefined
    if (outcome.kind === "stop") return outcome.stop
    if (round >= FIX_ROUNDS) {
      // The budget is spent: today's ladder verbatim (plans/0079 §4) — the
      // repair fact carries the verdict to a `--repair` round, else the block
      // waits for the person; the message names the rounds spent (D5).
      const { bin } = shellProfile()
      return {
        type: "blocked",
        repair: { reason: outcome.reason },
        question:
          `the verification of ${task.id} concluded Result: FAIL${outcome.reason ? ` (${outcome.reason})` : ""} and ${round} fix round${round === 1 ? "" : "s"} already ran (the budget is ${FIX_ROUNDS}); the remaining gaps are listed in ${taskDoc(task.id, "gaps")}. ` +
          `The work and the gap list are committed; accept the result with ${bin} close ${task.id} --reason <text>; ` +
          `or replace the task with ${bin} plan --force-close ${task.id} --reason <text> --append -p <what to do instead>; ` +
          `or list fix tasks before it in ${plan.index} by hand; then re-run.`,
      }
    }
    round += 1
    await input.persist?.({ kind: "wrapup", round })
    const stopped = await runFixRound(client, plan, task, opts, chain, round)
    if (stopped) return stopped
    // Re-verification runs from scratch (D3/D4): the next loop iteration
    // re-reads everything and overwrites the gap list wholesale.
  }
}

// Result line of the task report (FAIL stops the run): the parser lives in the
// document domain (roles.ts parseResult) since the phase verdict gate reads the
// same line (M4.2, plans/0049 G7).
export { parseResult, type ReportResult }

// Reads docs/<id>/report.md; a missing report is no verdict.
export async function reportResult(dir: string, task: Task): Promise<ReportResult | undefined> {
  return parseResult(await Bun.file(join(dir, taskDoc(task.id, "report"))).text().catch(() => ""))
}
