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
//
// Interface amendments (0031 D4: each driven by a real consumer):
// - `parallelism` (MP.1, plans/0046 D10): planning guidance for the
//   init-frozen `parallel` level, `### low|medium|high` subsections injected
//   into the planning templates. No `### none`: at none nothing is injected.

// Section keys of an intent pack, in canonical document order. The parser
// (load.ts) and future rendering iterate this list; the pack file protocol
// uses the human-readable headings mapped in load.ts.
export const INTENT_SECTIONS = ["quality", "phaseDuties", "acceptance", "governance", "artifactSpec", "parallelism", "guarantees", "planningInput"] as const

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
  // How hard planning sessions work to make tasks independent, keyed by the
  // config's `parallel` level (MP.1).
  parallelism?: string
  // Prompt guarantees (plans/0080 §2): the pack's declared consistency
  // contract — `### precedence` (the block injected into prompts), `### asserts`
  // (machine-checked lines the render gate evaluates), `### verify-plan` (the
  // charter the plan-step verifier session judges against; its presence
  // activates the verifier). Parsed structurally by intent/guarantees.ts.
  guarantees?: string
  // The planning-input scaffold (plans/0081 D12): the template text the
  // person completes into a planning input. Read by the shell's
  // `plan --scaffold` alone — it never lands in plan-input.md or in a session
  // prompt. Not subsectioned: the whole section body is the scaffold.
  planningInput?: string
}

// The `### <level>` keys of `## parallelism`, i.e. the values of the config's
// `parallel` (plans/0046 D8). `none` is the absence of the key: accepted on
// input, never stored, never a subsection.
export const PARALLEL_LEVELS = ["low", "medium", "high"] as const
export type ParallelLevel = (typeof PARALLEL_LEVELS)[number]

// The execution-tier setting of the config's `treeLanes` key (plans/0096 D10,
// the 0068 amendment): `off` is the absence of the key — accepted on input,
// never stored, never a tier — so `auto` and `on` are the two stored values.
// The tier machinery that reads it lives in src/lanes.ts; the vocabulary is
// frozen here beside ParallelLevel because the config layer (src/config.ts)
// validates it the way it validates `parallel` and must not import the lane
// scheduler's module.
export const TREE_LANES_SETTINGS = ["auto", "on"] as const
export type TreeLanesSetting = (typeof TREE_LANES_SETTINGS)[number]

// The `lanes` config object (plans/0096 D9/D10): the tier-1 lane knobs a
// project declares — the well-known cache homes injected into lane workers,
// the working-tree budget the `auto` probe weighs, and the sparse floor
// (directories materialized in every tier-1 lane whatever the unit's
// `Touches:` say). Hand-edited like acceptanceGate/build (no init flag); every
// sub-key is strictly validated at load (src/config.ts lanesOf).
export type LaneCacheRule = {
  // The environment variable the tool reads its cache home from (CCACHE_DIR,
  // SCCACHE_DIR, GOCACHE, …).
  env: string
  // true = shared-safe: one path under the main tree's .auto/cache/ for all
  // lanes; false = serializing (the tool locks its directory, cargo's target
  // dir): a per-lane path inside the lane's own worktree. The driver never
  // guesses a tool's safety — the project declares it (D11).
  shared: boolean
}

export type LanesConfig = {
  caches?: LaneCacheRule[]
  // The budget the `auto` probe weighs the working tree against (MB); the
  // working tree beyond it refuses tier 1 — N lanes ≈ N × the tree (D8).
  treeBudgetMB?: number
  // Directories materialized in every tier-1 lane on top of the unit's
  // `Touches:` set (D9's "project-declared floor").
  sparseFloor?: string[]
}

// Provenance of a loaded pack. Materializes in selection/diagnostics once
// composition grows beyond the degenerate form; frozen here so the loader
// contract does not churn when it does.
export type IntentSource = { kind: "builtin" | "project"; name: string }

// The degenerate-composition constant: the one active pack a project gets
// without any selection surface. A project overrides it by providing
// .opencode/auto/intents/default.md.
export const DEFAULT_INTENT = "default"
