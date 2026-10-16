// Prompt guarantees (plans/0080 §2): the `## guarantees` section of an intent
// pack — the declared consistency contract of the intent. Three subsections,
// all consumed as data:
//   ### precedence   the authority-order text injected into the prompt
//                   templates' precedence block (prompt.ts baseCtx);
//   ### asserts      machine-checked lines the render gate evaluates against
//                   every composed prompt (renderPrompt, the single render
//                   exit);
//   ### verify-plan  the charter paragraph the plan-step verifier session
//                   judges the composed planning prompt against; its presence
//                   is what activates the verifier (src/prompt-verify.ts);
//   ### verify-plan-<phaseKey>
//                   the per-phase refinement (plans/0097 D1) — the resolved
//                   charter (global + phase) is what activates the verifier
//                   and the formulation synthesis for that phase. The key is
//                   the phase type id (plans/0100 D8: `verify-plan-test`);
//                   a builtin's preset letter is an accepted legacy spelling.
// This module is the pure half: parse the assert lines, evaluate them against
// a rendered prompt, and name the violation. The throwing/catching halves
// live at the render exit (prompt.ts) and the run boundary (loop.ts).
//
// Authoring rule (plans/0082 D11): every term the verifier will enforce is
// defined by the charter itself — walls, permissions and carve-outs are
// charter text (`### verify-plan`), never constraints carried in lower
// documents; a lower document (playbook, handover, planning input) may narrow
// a charter wall, never widen it, and a widening anyone wants becomes an open
// question for the person, not a granted exception. Pack authors state the
// boundary where the authority lives so no downstream session has to
// reconcile two walls for itself.
//
// The assert line grammar (one assertion per line, blanks allowed between):
//   <template>[ (<phase>) ] : must "literal"[, "literal"]...
//   <template>[ (<phase>) ] : must-not "literal"[, "literal"]...
// <template> is a prompt template name (`phase-plan`, `whole`, …); the
// optional (<phase>) qualifier restricts the line to renders whose ctx carries
// that `phase` var — a builtin type's preset letter (`m`) or a custom type's
// id (`spec-read`). Unqualified lines apply to every render of the template.
// `must` literals must appear in the composed prompt; `must-not` literals
// must not. Literals are short stable anchors pinned to the intent's own
// pack/mode/duty text on purpose: editing that text without updating the
// asserts is exactly the drift the gate exists to catch (ratchet semantics —
// the shipped bundles' self-ratchet test renders their prompts through their
// own asserts).
import { BUILTIN_PHASE_TYPES, PHASE_LETTERS, type PhaseTypeEntry } from "../phases/registry"
import type { IntentPack } from "./types"
import { packSubsection } from "./load"

// One parsed assert line. kind "must": every literal must occur in the output;
// kind "must-not": no literal may.
export type GuaranteeAssert = {
  template: string
  phase?: string
  kind: "must" | "must-not"
  literals: string[]
}

// Thrown by the render gate (prompt.ts) when a composed prompt violates the
// active pack's asserts; the run boundary (loop.ts) maps it to a blocked exit
// (exit 2) with the violation text — a guarantee violation is a human problem
// (the intent's content and the prompt sources disagree), never a retry.
export class PromptGuaranteeError extends Error {
  constructor(violation: string) {
    super(violation)
    this.name = "PromptGuaranteeError"
  }
}

const ASSERT_LINE = /^([a-z0-9-]+)(?:\s*\(\s*([a-z0-9-]+)\s*\))?\s*:\s*(must-not|must)\s+(.+)$/

// Parse a pack's `### asserts` subsection; undefined when the pack declares
// none (the zero-intent floor: no checks, byte-identical renders). Throws
// naming the pack and the offending line — load-style strictness, so a
// malformed contract fails loudly wherever it is first read (preflight calls
// guaranteesProblem for exactly this).
export function parseGuaranteeAsserts(pack: IntentPack): GuaranteeAssert[] | undefined {
  const text = packSubsection(pack, "guarantees", "asserts")
  if (text === undefined) return undefined
  const asserts: GuaranteeAssert[] = []
  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const match = ASSERT_LINE.exec(line)
    if (!match) throw new Error(`intent pack "${pack.name}" has a malformed asserts line: ${line} (grammar: <template>[(<phase>)]: must "literal"[, "literal"]… / must-not …)`)
    const literals = parseLiterals(pack.name, match[4]!)
    if (!literals.length) throw new Error(`intent pack "${pack.name}" asserts line carries no quoted literal: ${line}`)
    asserts.push({
      template: match[1]!,
      ...(match[2] ? { phase: match[2] } : {}),
      kind: match[3] as "must" | "must-not",
      literals,
    })
  }
  return asserts.length ? asserts : undefined
}

function parseLiterals(packName: string, body: string): string[] {
  const literals: string[] = []
  for (const token of body.split(",")) {
    const quoted = /^\s*"([^"]+)"\s*$/.exec(token)
    if (!quoted) throw new Error(`intent pack "${packName}" asserts literals must be double-quoted and comma-separated; got: ${body.trim()}`)
    literals.push(quoted[1]!)
  }
  return literals
}

// —— the per-phase charter channel (plans/0097 D1; keys canonicalized to
// phase type ids by plans/0100 D8/D9) ——
//
// `## guarantees` keeps its three pack-global subsections and gains an
// optional per-phase family: `### verify-plan-<phase type id>`, uniform with
// `P<nn>-<type>`, `--phases` and the registry (`verify-plan-test`,
// `verify-plan-survey` — a custom type keys by its id, as always). A builtin
// type's preset letter (`verify-plan-t`) is an accepted legacy spelling in
// resolution, never canonical in the shipped bundles. The pack-global
// charter binds every phase; a phase key refines it for that phase's
// formulations. The activation rule: the plan verifier (and the synthesis
// path, D3) activate iff the *resolved* charter for that formulation is
// non-empty — a pack declaring only `verify-plan-test` gets charter
// semantics for test phases and the pure Stage-1 floor everywhere else.

// The resolved charters of one formulation. phaseKey rides along so the
// composer can name the key the phase charter actually came from (plans/0100
// D11): the id when the pack keys canonically, the letter when a legacy
// pack keys by preset letter — audit lines show which spelling was in force.
export type ResolvedVerifyPlan = { global?: string; phase?: string; phaseKey?: string }

// Resolution (plans/0100 D9): id-first, letter-fallback — and only for
// builtins with a preset letter; custom types resolve their id alone, as
// always. The caller threads the resolved PhaseTypeEntry (Opts.phase already
// holds it), so at most two candidate keys exist and both derive from that
// entry — no global alias table.
export function resolvedVerifyPlan(pack: IntentPack, entry?: PhaseTypeEntry): ResolvedVerifyPlan {
  const global = packSubsection(pack, "guarantees", "verify-plan")
  let phase: string | undefined
  let phaseKey: string | undefined
  if (entry !== undefined) {
    const byId = packSubsection(pack, "guarantees", `verify-plan-${entry.type}`)
    if (byId !== undefined) {
      phase = byId
      phaseKey = entry.type
    } else if (entry.letter !== undefined) {
      const byLetter = packSubsection(pack, "guarantees", `verify-plan-${entry.letter}`)
      if (byLetter !== undefined) {
        phase = byLetter
        phaseKey = entry.letter
      }
    }
  }
  return {
    ...(global !== undefined ? { global } : {}),
    ...(phase !== undefined ? { phase, phaseKey: phaseKey! } : {}),
  }
}

// The composed charter text of a resolution: the global charter, then — when
// present — the phase charter under a lead-in naming its key. undefined when
// neither is declared (the zero-intent floor: no verifier, no synthesis).
export function verifyPlanCharterText(resolved: ResolvedVerifyPlan): string | undefined {
  if (resolved.global === undefined && resolved.phase === undefined) return undefined
  const parts: string[] = []
  if (resolved.global !== undefined) parts.push(resolved.global.trim())
  if (resolved.phase !== undefined) {
    parts.push(`The phase's own plan charter (verify-plan-${resolved.phaseKey}), refining the above for this phase's plans:\n\n${resolved.phase.trim()}`)
  }
  return parts.join("\n\n")
}

// The `### verify-plan-<suffix>` keys a pack declares (preflight validation
// and the audit's charter list read them).
export function verifyPlanKeys(pack: IntentPack): string[] {
  const keys: string[] = []
  for (const line of (pack.guarantees ?? "").split("\n")) {
    const heading = /^###\s+(verify-plan-\S+?)(?:\s.*)?$/.exec(line.trim())
    if (heading && !keys.includes(heading[1]!)) keys.push(heading[1]!)
  }
  return keys
}

// Preflight-side validation (loop-preflight.ts): the first problem with a
// pack's declared guarantees, undefined when clean. Parsing the asserts is
// half the check; the other half is the per-phase charter family's key
// grammar — every `verify-plan-*` suffix must be a phase type id (the
// builtins' or a declared custom's) or, as a legacy spelling, a builtin's
// preset letter, so a typo'd key is a strict usage error naming the pack
// (parsed-strictly culture; other unknown `###` keys under `## guarantees`
// keep today's tolerance). A pack declaring both spellings for one builtin
// type is a duplication error, never silent precedence (plans/0100 D10).
// customTypes is the project's declared custom phase type ids; precedence and
// verify-plan bodies stay prose, nothing else to validate.
export function guaranteesProblem(pack: IntentPack, customTypes: readonly string[] = []): string | undefined {
  try {
    parseGuaranteeAsserts(pack)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  const keys = verifyPlanKeys(pack)
  for (const entry of BUILTIN_PHASE_TYPES) {
    if (keys.includes(`verify-plan-${entry.type}`) && keys.includes(`verify-plan-${entry.letter}`)) {
      return `intent pack "${pack.name}" declares both "### verify-plan-${entry.type}" and "### verify-plan-${entry.letter}" — the suffix is the phase type id ("${entry.type}"); preset letters are accepted legacy spellings, never both`
    }
  }
  const builtinIds = BUILTIN_PHASE_TYPES.map((entry) => entry.type)
  const known = [...builtinIds, ...PHASE_LETTERS, ...customTypes]
  for (const key of keys) {
    const suffix = key.slice("verify-plan-".length)
    if (!known.includes(suffix)) {
      return `intent pack "${pack.name}" declares "### ${key}" — the suffix is the phase type id (builtin: ${builtinIds.join(", ")}${customTypes.length ? `; declared custom: ${customTypes.join(", ")}` : ""}); preset letters (${PHASE_LETTERS.join("|")}) are accepted legacy spellings`
    }
  }
  return undefined
}

// The render gate (plans/0080 §3): evaluate a pack's asserts against one
// composed prompt. template is the template name the prompt was rendered
// from; phase is the render ctx's `phase` var (a builtin letter or a custom
// type id), the qualifier the assert lines match on. Returns the violation
// text, undefined when every applicable assert holds. Pure string work —
// cheap enough to run on every render.
export function guaranteeViolation(pack: IntentPack, asserts: GuaranteeAssert[], template: string, phase: string | undefined, output: string): string | undefined {
  const applicable = asserts.filter((assert) => assert.template === template && (assert.phase === undefined || assert.phase === phase))
  const problems: string[] = []
  for (const assert of applicable) {
    for (const literal of assert.literals) {
      if (assert.kind === "must" && !output.includes(literal)) {
        problems.push(`${template}${assert.phase ? ` (${assert.phase})` : ""} must contain "${literal}"`)
      } else if (assert.kind === "must-not" && output.includes(literal)) {
        problems.push(`${template}${assert.phase ? ` (${assert.phase})` : ""} must not contain "${literal}" — found in the composed prompt`)
      }
    }
  }
  return problems.length ? `the active intent pack "${pack.name}" guarantees this prompt and it failed: ${problems.join("; ")}` : undefined
}
