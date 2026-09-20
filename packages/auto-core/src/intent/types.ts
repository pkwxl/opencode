// Intent domain — frozen interface (D8; root plans/AUTO_NEXT_REFACTOR_PLAN.md
// M1.1, design plans/0031). The intent layer carries the (b)-class prompt
// content — quality bars, phase duties, acceptance semantics, decision
// governance, artifact conventions — that the driver core must not hardcode.
// Flow-driving (a)-class content stays in the core templates; intent text is
// injected as data at the assembly point, never as driver instructions.
//
// First ship is degenerate composition only (F8): a single active pack, with
// a project file of the same name overriding the built-in preset wholesale.
// Composition algebra (multi-pack merge, richer precedence) is deliberately
// not modeled here; it generalizes when a second real consumer appears
// (open questions 1/2 of the plan).

// Section keys of an intent pack, in canonical document order. The parser
// (load.ts) and future rendering iterate this list; the pack file protocol
// uses the human-readable headings mapped in load.ts.
export const INTENT_SECTIONS = ["quality", "phaseDuties", "acceptance", "governance", "artifactSpec"] as const

export type IntentSection = (typeof INTENT_SECTIONS)[number]

// A sectioned bundle of intent text. Every section is optional; an absent
// section injects nothing (current behavior is the zero-intent baseline).
export type IntentPack = {
  name: string
  // Quality bars: split rules, review dimensions, self-check demands.
  quality?: string
  // Per-phase duties and artifact conventions (dutiesRef target, M3).
  phaseDuties?: string
  // Acceptance semantics: what "done" means, independent-judgment stance.
  acceptance?: string
  // Decision governance (AUTO-DECISION discipline, proxy-answer audit).
  governance?: string
  // Artifact declaration conventions; feeds the document domain (M1.4).
  artifactSpec?: string
}

// Provenance of a loaded pack. Materializes in selection/diagnostics once
// composition grows beyond the degenerate form; frozen here so the loader
// contract does not churn when it does.
export type IntentSource = { kind: "builtin" | "project"; name: string }

// The degenerate-composition constant: the one active pack a project gets
// without any selection surface. A project overrides it by providing
// .opencode/auto/intents/default.md.
export const DEFAULT_INTENT = "default"
