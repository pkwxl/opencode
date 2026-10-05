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
//                   is what activates the verifier (src/prompt-verify.ts).
// This module is the pure half: parse the assert lines, evaluate them against
// a rendered prompt, and name the violation. The throwing/catching halves
// live at the render exit (prompt.ts) and the run boundary (loop.ts).
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

// Preflight-side validation (loop-preflight.ts): the first problem with a
// pack's declared guarantees, undefined when clean. Parsing the asserts is
// the whole check — precedence/verify-plan are prose, nothing to validate.
export function guaranteesProblem(pack: IntentPack): string | undefined {
  try {
    parseGuaranteeAsserts(pack)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
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
