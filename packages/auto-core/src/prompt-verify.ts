// The charter-check family's mechanical halves (plans/0080's verifier, the
// 0082 clamp): the strict reply parser, the default-check call over a text
// (the run-start charter clamp's engine), and the round's prompt-audit
// append every composition record commits through. The verifier session
// itself (the composed planning prompt's semantic check) is retired
// (plans/0283): the plan and append steps are deterministic — no verifier
// session runs ahead of them, and OPENCODE_AUTO_PLAN_VERIFY is a tombstone.
// checkTextAgainstCharter stays (the run-start clamp and the executor-side
// consumers): the classifier's sibling — a fresh bare one-shot session
// (tools denied, questions refused), a strict protocol-line parser, and no
// dependency on the session-driving machinery.
import { join } from "node:path"
import { classifierEntry, oneShot } from "./classify"
import type { GitOps } from "./git"
import { log } from "./log"
import { packSubsection } from "./intent/load"
import type { PromptFacts } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { renderPrompt } from "./prompt"
import type { RoutingFacts } from "./routing"
import { SWITCH_ENV, autoSwitches } from "./switches"
import type { ClientSource } from "./opts"

// The strict reply parser (the parseClassifierReply discipline): the last
// line that parses wins, nothing else counts. `Consistent: yes` | 
// `Consistent: no — <evidence>`, case-insensitive on the keyword; an
// unparsable text yields undefined.
export function parseVerifyReply(text: string): { consistent: boolean; evidence?: string } | undefined {
  for (const raw of text.split("\n").reverse()) {
    const line = raw.trim().replace(/^`+|`+$/g, "")
    const match = /^Consistent:\s*(yes|no)\b\s*(.*)$/i.exec(line)
    if (!match) continue
    const consistent = match[1]!.toLowerCase() === "yes"
    const rest = match[2]!.replace(/^[—–-]\s*/, "").trim()
    return { consistent, ...(!consistent && rest ? { evidence: rest } : {}) }
  }
  return undefined
}




// The round's prompt-audit append (plans/0080 §5, the 0102 complexity-17
// dedup): the one write+commit behind every audit entry — the verifier
// verdicts (plan-gate's verifyPlanStep, loop-phase's handover write-time
// gate), the admission warns, the synthesis records and the diagnosis
// fail-closeds all append through here. The previous text decides the
// preamble: an empty audit opens with the record's header line, anything
// else appends after the trimmed tail. The entry commits on its own ahead
// of whatever it documents (stage prompt-audit, the savePlanInput pattern):
// the wall discipline — the record survives a session that never runs, and
// the next unit's entry clean gate finds a committed tree. The caller
// composes the entry text, passes the commit's task title, the subject's
// tail after the shared `PLAN prompt-audit` prefix, and its exact failure
// line over the joined failure detail (the sites' wordings are pinned);
// false = the commit failed, the failure logged. audit is the audit file's
// repository-relative path — the phase sites derive it beside the phase
// directory (dirname(phase.dir)/prompt-audit.md), the blockage fail-closed
// from its round.
export async function appendAudit(
  dir: string,
  audit: string,
  entry: string,
  commit: GitOps["commitTree"],
  title: string,
  tail: string,
  failLine: (failures: string) => string,
): Promise<boolean> {
  const previous = await Bun.file(join(dir, audit)).text().catch(() => "")
  await Bun.write(
    join(dir, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}${entry}\n`,
  )
  const settled = await commit(dir, { id: "PLAN", title }, { stage: "prompt-audit", subject: `PLAN prompt-audit ${tail}` })
  if (settled.ok) return true
  log(failLine(settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")))
  return false
}

// —— the record-time charter check (plans/0082 §10 D12, closing RC2) ——//

// The check's wall clock and session title (the verifier's shape, cheap).
const CHECK_TIMEOUT_MS = 60_000
const CHECK_TITLE = "auto: charter check"

// The strict reply parser (the parseVerifyReply discipline: the last line
// that parses wins). `Clamp: none` — consistent, nothing to do; `Clamp:
// <reading>` — flagged, clamp to the reading. Unparsable ⇒ undefined.
export function parseDefaultCheckReply(text: string): { clamp: false } | { clamp: true; reading: string } | undefined {
  for (const raw of text.split("\n").reverse()) {
    const line = raw.trim().replace(/^`+|`+$/g, "")
    const match = /^Clamp:\s*(.*)$/i.exec(line)
    if (!match) continue
    const body = match[1]!.trim()
    if (/^none$/i.test(body)) return { clamp: false }
    if (body) return { clamp: true, reading: body }
    return undefined
  }
  return undefined
}

// The check's outcome for one text against the active charter.
type CharterCheck =
  // No charter declared (the zero-intent floor), no routing, or no usable
  // classifier entry: the check does not run — like the plan verifier's
  // inactive/skipped arms.
  | { kind: "skipped"; reason: string }
  | { kind: "consistent" }
  | { kind: "flagged"; reading: string }
  // The check ran and could not judge (a timeout, a session error, an
  // unparsable reply — the fail-closed arm, plans/0082 §10 D12): the strictest
  // reading rides in the arm as the one in force (the ruled direction — the
  // wider grant never stays in force unjudged), but nobody judged, so the
  // callers surface the failure, never a flag (plans/0208 D1: the arm was
  // formerly a `flagged` with a reason the type dropped — a flaky endpoint
  // rendered as a charter conflict against the person's own words).
  | { kind: "failed"; reading: string; reason: string }

// The strictest reading — the fail-closed fallback when the check cannot
// judge (a guarantee that can be slept through is not a guarantee; the
// charter's own default is strict).
export const OPEN_FALLBACK_READING = "no default in force — the question is OPEN until the person rules"

// One charter check over one text (the 0080 verifier's call reused: a bare
// one-shot on the registry's classifier entry, tools denied, strict parse).
// server takes the ClientSource the run holds (the pool or one client);
// routing undefined = no registry, the check does not run.
export async function checkTextAgainstCharter(input: {
  server?: ClientSource
  routing?: RoutingFacts
  dir?: string
  intent?: string
  label: string
  text: string
}): Promise<CharterCheck> {
  const facts = promptFacts({ dir: input.dir, intent: input.intent })
  // The record-time check judges AUTO-RESOLVE defaults against the standing
  // bar — the pack-global charter alone, never the per-phase refinements
  // (plans/0097 D1: those bind a phase's plans, not every recorded default).
  const charter = packSubsection(facts.pack, "guarantees", "verify-plan")
  if (charter === undefined) return { kind: "skipped", reason: "the active pack declares no verify-plan charter" }
  if (input.routing === undefined || input.server === undefined) return { kind: "skipped", reason: "no model registry routing — no classifier entry to run the check on" }
  const now = input.routing.clock.now()
  const pick = classifierEntry(input.routing.router, input.routing.registry, input.routing.agentFilter, now)
  if (pick === undefined) return { kind: "skipped", reason: "no usable classifier entry — the check cannot run" }
  // ClientSource resolved inline (the agent-pool clientOf shape): a plain
  // client is taken as is, a server control resolves the entry's agent \u2014
  // reaching session-api here would re-open the policies \u2192 engine edge
  // the sub-domain allowlist retired.
  const source = input.server
  const client = "client" in source ? await source.client(pick.entry.agent) : source
  const prompt = renderPrompt(facts, "default-check", { charter, label: input.label, text: input.text })
  let lastReason = "the check session produced no answer"
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await oneShot(client, pick.entry, prompt, CHECK_TIMEOUT_MS, CHECK_TITLE)
    if (outcome.kind === "timeout") {
      lastReason = `the check gave no answer within ${Math.round(CHECK_TIMEOUT_MS / 1000)} s`
      continue
    }
    if (outcome.kind === "failed") {
      lastReason = `the check failed: ${outcome.error.message ?? "session error"}`
      continue
    }
    const verdict = parseDefaultCheckReply(outcome.text)
    if (verdict === undefined) {
      lastReason = `the check replied without a parsable Clamp line; its last words: ${outcome.text.trim().split("\n").slice(-3).join(" ⏎ ").slice(0, 400)}`
      continue
    }
    if (!verdict.clamp) return { kind: "consistent" }
    return { kind: "flagged", reading: verdict.reading }
  }
  // Fail-closed (plans/0082 §10 D12, rendered per plans/0208 D1): the strictest
  // reading is the one in force, but the arm says what happened — nobody
  // judged. The callers render the failure, never a flag.
  return { kind: "failed", reading: OPEN_FALLBACK_READING, reason: lastReason }
}
