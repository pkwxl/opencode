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
// Activation: the pack's `### verify-plan` charter — a pack without it never
// verifies (the zero-intent floor), and the switch (OPENCODE_AUTO_PLAN_VERIFY,
// default on) can only remove the check, never add one. The model comes from
// the registry's `classifier` list (the same entry selection the failure
// classifier uses); a run without a classifier list skips the verifier with a
// log line — the mechanical layers (render gate, precedence blocks) still
// hold, only the semantic check is absent.
//
// Fail-closed (the person's ruling): a verifier that cannot produce a
// parsable verdict — error, timeout, garbage reply — is retried once and then
// blocks the planning step (exit 2) with the last reply text. A guarantee
// that can be slept through is not a guarantee; flakiness surfaces loudly.
// The token cost of the two calls is not booked to a stats bucket in v1 (one
// cheap call per planning step; noted in plans/0080 §5's explicitly-not).
import { classifierEntry, oneShot } from "./classify"
import { packSubsection } from "./intent/load"
import type { PromptFacts } from "./prompt"
import { renderPrompt } from "./prompt"
import type { RoutingFacts } from "./routing"
import { SWITCH_ENV, autoSwitches } from "./switches"
import type { AgentPool } from "./agent-pool"

// The verifier's wall clock: the composed planning prompt can be large, so
// this is the classifier's 30 s raised, not shared.
const VERIFY_TIMEOUT_MS = 120_000
const VERIFY_TITLE = "auto: plan consistency check"

export type PlanVerifyOutcome =
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

// Judge one composed planning prompt. pool is the run's server control (the
// entry's agent resolves its host through it); routing carries the registry
// and the router the entry selection reads; step names the planning step in
// the prompt and the audit record (e.g. "phase-plan R-01.P02-implement").
export async function verifyPlanPrompt(input: {
  pool: AgentPool
  routing: RoutingFacts | undefined
  facts: PromptFacts
  step: string
  prompt: string
}): Promise<PlanVerifyOutcome> {
  const charter = packSubsection(input.facts.pack, "guarantees", "verify-plan")
  if (charter === undefined) return { kind: "inactive" }
  if (!autoSwitches().planVerify) return { kind: "skipped", reason: `${SWITCH_ENV.planVerify}=off — the semantic check is switched off (the render gate and the precedence blocks still hold)` }
  if (input.routing === undefined) {
    return { kind: "skipped", reason: "no model registry routing — no classifier entry to run the verifier on (the render gate and the precedence blocks still hold)" }
  }
  const now = input.routing.clock.now()
  const pick = classifierEntry(input.routing.router, input.routing.registry, input.routing.agentFilter, now)
  if (pick === undefined) {
    return { kind: "skipped", reason: "no usable classifier entry (the registry names none, or none is up) — the render gate and the precedence blocks still hold" }
  }
  const client = await input.pool.client(pick.entry.agent)
  const text = renderPrompt(input.facts, "plan-verify", { charter, prompt: input.prompt, step: input.step })
  let lastReason = "the verifier session produced no answer"
  for (let attempt = 1; attempt <= 2; attempt++) {
    const outcome = await oneShot(client, pick.entry, text, VERIFY_TIMEOUT_MS, VERIFY_TITLE)
    if (outcome.kind === "timeout") {
      lastReason = `the verifier ${pick.name} gave no verdict within ${Math.round(VERIFY_TIMEOUT_MS / 1000)} s`
      continue
    }
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
