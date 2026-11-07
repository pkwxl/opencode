// The plan-step consistency verifier (plans/0080 §5): before a planning
// session runs, one small verifier session judges the composed planning
// prompt against the active intent pack's `## guarantees` / `### verify-plan`
// charter — the semantic layer the render gate's literals cannot reach (a
// plan input can contradict the charter without matching any pattern). The
// verifier is the classifier's sibling, mechanically: a fresh bare one-shot
// session (tools denied, questions refused), a strict protocol-line parser,
// and no dependency on the session-driving machinery (the classify.ts
// precedent's import discipline holds here too).
//
// Activation: the pack's `### verify-plan` charter plus the switch — a pack
// without a charter never verifies (the zero-intent floor), and the switch
// (OPENCODE_AUTO_PLAN_VERIFY, default off since plans/0113) enables the
// check for a pack that declares one, never adds a charter. The model comes
// from the registry's planning route — the `phase-plan` candidate list (the
// deep tier), the same selection discipline the synthesis constructor's
// planRouteEntry applies (plans/0097); plans/0113 moved it off the
// `classifier` route (charter conformance over a large composed prompt is
// deep work, and a flaky cheap endpoint fail-closing every planning step
// was the fleet's recurring block). A run with no usable planning-route
// entry skips the verifier with a log line — the mechanical layers (render
// gate, precedence blocks) still hold, only the semantic check is absent.
//
// Fail-closed (the person's ruling, 0080; the time arm retired by plans/0113
// D3): a verifier that cannot produce a parsable verdict — a session error,
// a garbage reply — is retried once and then blocks the planning step
// (exit 2) with the last reply text. The verdict itself is waited for with
// no wall: a deep session is not a classification call on a timer, and the
// fleet's fail-closed blocks were walls, never content. A guarantee that
// can be slept through is not a guarantee; flakiness surfaces loudly.
// The token cost of the two calls is not booked to a stats bucket in v1 (one
// deep-route call per planning step; noted in plans/0080 §5's explicitly-not).
import { join } from "node:path"
import { classifierEntry, oneShot } from "./classify"
import type { GitOps } from "./git"
import { log } from "./log"
import { resolvedVerifyPlan, verifyPlanCharterText } from "./intent/guarantees"
import { packSubsection } from "./intent/load"
import { candidateList } from "./model-route"
import { usableAt } from "./model-window"
import type { ModelEntry } from "./models-schema"
import type { PhaseTypeEntry } from "./phases/registry"
import type { PromptFacts } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { renderPrompt } from "./prompt"
import type { RoutingFacts } from "./routing"
import { entryPassesAgentFilter } from "./select"
import { SWITCH_ENV, autoSwitches } from "./switches"
import type { AgentPool } from "./agent-pool"
import type { ClientSource } from "./opts"

const VERIFY_TITLE = "auto: plan consistency check"

type PlanVerifyOutcome =
  // The pack declares no charter: the check does not exist for this project —
  // the caller neither logs nor records anything (the zero-intent floor).
  | { kind: "inactive" }
  // The charter is declared but the check cannot run (switch off, no routing,
  // no usable entry): the caller logs one ℹ line and records the skip.
  | { kind: "skipped"; reason: string }
  | { kind: "consistent"; reply: string }
  | { kind: "inconsistent"; evidence: string }
  | { kind: "failed"; reason: string }

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

// The first usable entry of the planning route (plans/0113): the `phase-plan`
// candidate list — the deep tier the planning sessions and the synthesis
// constructor dispatch on — walked with the classifierEntry discipline (the
// agent filter, the windows, the down marks, the key rings; the context cap
// does not — the entry list already encodes fitness, the formulate-synthesis
// planRouteEntry precedent). The verifier judges the prompt the planning
// sessions run under; it rides their route, not the classifier's.
export function planningRouteEntry(
  routing: RoutingFacts,
  entry: PhaseTypeEntry | undefined,
  now: number,
): { name: string; entry: ModelEntry } | undefined {
  const list = candidateList(routing.registry, entry, "phase-plan")
  for (const name of list.names) {
    const model = routing.registry.models.get(name)
    if (model === undefined) continue
    if (!entryPassesAgentFilter(routing.registry, routing.agentFilter, model)) continue
    if (!usableAt(model, routing.registry.tz, now)) continue
    if (routing.router.isModelDown(name, now)) continue
    if (model.provider !== undefined && !routing.router.ringHasUsableKey(model.provider, now)) continue
    return { name, entry: model }
  }
  return undefined
}

// Judge one composed planning prompt. pool is the run's server control (the
// entry's agent resolves its host through it); routing carries the registry
// and the router the entry selection reads; step names the planning step in
// the prompt and the audit record (e.g. "phase-plan R-01.P02-implement").
// entry is the formulation's phase type entry (plans/0097 D1, keyed by type
// id since plans/0100 D9); absent in m mode, where the pack-global charter
// alone resolves. Activation: the resolved charter (global + phase) — a pack
// declaring only `verify-plan-test` verifies test phases and never the
// others.
export async function verifyPlanPrompt(input: {
  pool: AgentPool
  routing: RoutingFacts | undefined
  facts: PromptFacts
  step: string
  prompt: string
  entry?: PhaseTypeEntry
}): Promise<PlanVerifyOutcome> {
  const charter = verifyPlanCharterText(resolvedVerifyPlan(input.facts.pack, input.entry))
  if (charter === undefined) return { kind: "inactive" }
  if (!autoSwitches().planVerify) return { kind: "skipped", reason: `${SWITCH_ENV.planVerify}=off — the semantic check is off (the default since plans/0113; the render gate and the precedence blocks still hold)` }
  if (input.routing === undefined) {
    return { kind: "skipped", reason: "no model registry routing — no planning-route entry to run the verifier on (the render gate and the precedence blocks still hold)" }
  }
  const now = input.routing.clock.now()
  const pick = planningRouteEntry(input.routing, input.entry, now)
  if (pick === undefined) {
    return { kind: "skipped", reason: "no usable planning-route entry (the registry names none, or none is up) — the render gate and the precedence blocks still hold" }
  }
  const client = await input.pool.client(pick.entry.agent)
  const text = renderPrompt(input.facts, "plan-verify", { charter, prompt: input.prompt, step: input.step })
  // The wait is visible (the constructor's start-line discipline, 0097): one
  // line naming the step and the model before the session, so an operator
  // watching a long judgment knows where the run sits.
  log(`⏳ plan verification: ${input.step} — the verifier ${pick.name} is judging the composed prompt (no wall; the reply is awaited)`)
  let lastReason = "the verifier session produced no answer"
  for (let attempt = 1; attempt <= 2; attempt++) {
    // No wall (plans/0113 D3): the reply is waited for; only the session's
    // own end — idle, the stream's end, a failure event — terminates the
    // call, so no time limit ever fail-closes the step.
    const outcome = await oneShot(client, pick.entry, text, undefined, VERIFY_TITLE)
    if (outcome.kind === "failed") {
      lastReason = `the verifier ${pick.name} failed: ${outcome.error.message ?? "session error"}`
      continue
    }
    const verdict = parseVerifyReply(outcome.text)
    if (verdict === undefined) {
      lastReason = `the verifier ${pick.name} replied without a parsable Consistent line; its last words: ${outcome.text.trim().split("\n").slice(-3).join(" ⏎ ").slice(0, 400)}`
      continue
    }
    if (verdict.consistent) return { kind: "consistent", reply: outcome.text.trim() }
    return { kind: "inconsistent", evidence: verdict.evidence ?? "the charter and the prompt conflict (the verifier named no span)" }
  }
  return { kind: "failed", reason: `${lastReason} (after one retry — fail-closed, plans/0080 §5)` }
}

// The audit record line (plans/0080 §5): what the driver appends to the
// round's docs/R-NN/prompt-audit.md after each verifier run — the wall
// documentation a clean-room defense wants, written before the planning
// session so the step's own commit carries it. An inactive outcome never
// reaches here.
export function verifyAuditEntry(step: string, outcome: Exclude<PlanVerifyOutcome, { kind: "inactive" }>): string {
  const stamp = new Date().toISOString()
  const verdict =
    outcome.kind === "consistent"
      ? `consistent`
      : outcome.kind === "inconsistent"
        ? `INCONSISTENT — ${outcome.evidence}`
        : outcome.kind === "failed"
          ? `FAILED — ${outcome.reason}`
          : `skipped — ${outcome.reason}`
  return `- ${stamp} ${step}: ${verdict}`
}

// The round's prompt-audit append (plans/0080 §5, the 0102 complexity-17
// dedup): the one write+commit behind every audit entry — the verifier
// verdicts (loop-plan's verifyPlanStep, loop-phase's handover write-time
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
