// Task wrap-up session and parsing of the task report's result line
// (Result: PASS|FAIL). After the session, report.md goes through an existence +
// shape gate (session-boundary-hardening design §4.5 D5, S3b) — before that the
// wrap-up had no artifact check at all (runSession went straight to the
// afterSession commit), so an empty or truncated report passed silently;
// report.md carries the cross-task wrap-up narrative (the L2 suppression
// target), so truncation or an empty shell there widens the incident surface
// directly. Failing any of existence / non-trivial / last-line terminator →
// one re-prompt with feedback → still failing → blocked (hidden blockage).
// Only this session's output is checked, never existing material.
// Dependency direction: above session/unit-commit, below runner
// (module-split-plan §D.2).

import { dirname, join } from "node:path"
import type { SessionChain } from "./chain"
import { docShapeProblems, EOF_MARK } from "./doccheck"
import { taskDoc } from "./docpaths"
import { parseResult, type ReportResult } from "./document/roles"
import { autobanner, log } from "./log"
import type { ClientSource, Opts, UnitStop } from "./opts"
import type { Plan, Task } from "./tasks"
import { renderWrapup } from "./prompt"
import { runSession } from "./session"
import { forkEndedSession } from "./session-api"
import { statsModelEvent } from "./stats"
import { afterSession, commitBlocked, wrapupResolves } from "./unit-commit"

// report.md shape problems (empty = pass): the path is fixed and known to the
// driver (the wrap-up template pins docs/<id>/report.md), so no declaration is
// needed; missing/empty is its own case, otherwise non-trivial + terminator.
async function reportProblems(dir: string, task: Task): Promise<string[]> {
  const rel = taskDoc(task.id, "report")
  const text = await Bun.file(join(dir, rel)).text().catch(() => "")
  if (!text.trim()) return [`${rel} missing or empty`]
  return docShapeProblems(text, rel)
}

// Runs one task wrap-up session and closes it out: banner/subject/resolves
// assembly + runSession + report.md gate + unified commit. label is the unit
// name used when the commit fails; solo is the off/auto/ondemand whole-task
// mode, every mode but the true pipeline (the report is an output summary
// rather than an index). undefined = wrap-up done.
export async function runWrapup(
  client: ClientSource,
  plan: Plan,
  task: Task,
  opts: Opts,
  chain: SessionChain,
  input: { solo: boolean; label: string },
): Promise<UnitStop | undefined> {
  const dir = opts.dir ?? plan.dir
  autobanner(`${task.id} ${task.title}: wrap-up`)
  const subject = `${task.id} wrapup ${task.title}`
  chain.subject = subject
  const resolves = await wrapupResolves(dir, task.id)
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
      brief ? feedback.trimStart() : renderWrapup(plan, task, { mode: opts.mode, solo: input.solo, resolves }) + feedback,
      opts,
      chain,
    )
    if (result.type === "blocked") return result
    const problems = await reportProblems(dir, task)
    if (!problems.length) {
      const committed = await afterSession(dir, opts, task, { stage: "wrapup", subject })
      if (committed.type === "failed") return commitBlocked(`${task.id} ${input.label}`, committed)
      return undefined
    }
    const rel = taskDoc(task.id, "report")
    if (i === 1) {
      return {
        type: "blocked",
        question:
          `wrap-up session ended twice but ${rel} did not pass checks (${problems.join("; ")}; hidden blockage). ` +
          `Check the file and re-run. Last agent output:\n${result.lastText.trim().slice(-2000) || "(no output)"}`,
      }
    }
    feedback =
      `\n\nThe last time you ended the session, ${rel} did not pass checks: ${problems.join("; ")}. This is a hard requirement: ` +
      `write the task report into that file, complete, with \`${EOF_MARK}\` alone on the last line of body text, before ending the session.`
    // The re-prompt continues on a fork of the session that just ended (with
    // all wrap-up context); if forking is unavailable, fall back to a fresh
    // session + the full prompt.
    shapeForked = await forkEndedSession(client, chain, subject)
    // Per-model protocol-drift counter (plans/0055 §10 item 3): booked on the
    // model of the wrap-up session that failed the report shape check;
    // undefined without a registry (C2).
    await statsModelEvent(dir, chain.modelEntry, "reprompt")
    log(`↻ ${task.id} wrap-up session's ${rel} failed checks; ${shapeForked ? "forked from the original session, " : ""}retrying once with feedback`)
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
