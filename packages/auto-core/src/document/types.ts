// Document domain — frozen interface (D8; root plans/AUTO_NEXT_REFACTOR_PLAN.md
// M1.1 freeze; design plans/0031). Amended at first-consumer time (M1.4,
// plans/0034 D2): the draft's singular sectionAnchor could not express the
// multi-section `产出:` declarations the parser actually produces, and the
// checker needs the D4 fallback-read path and the feedback label as data.
// Process documents and phase output documents are explicitly distinguished
// by role. The driver's mechanical checks (existence, non-triviality, eof
// terminator, declared section anchors) are driven by ArtifactSpec data, not
// by hardcoded document names — the machinery lives in document/spec.ts
// (M1.4); the role-model close-out (eof-exempt lists, protect policy, handoff
// shape checks derived from roles) lands in M2.3.

// The role of a document in the target directory's docs/ tree:
// - driverState:  driver-exclusive state (PLAN.md/CURRENT.md/.auto/*); AI
//                 sessions must never write these (protect.ts).
// - ledger:       append-only progress facts (phases.md ledger lines).
// - handoff:      session-boundary handoff documents (handoff/testhandoff
//                 family); protocol-shaped, eof-exempt.
// - artifact:     AI-produced deliverables consumed by later stages;
//                 shape-checked (non-trivial + eof terminator).
// - freeform:     everything else; the standardization boundary must not
//                 constrain AI freedom here (no schema beyond placement).
export type DocumentRole = "driverState" | "ledger" | "handoff" | "artifact" | "freeform"

// A declared artifact of a task/subtask (the structured form of the
// `产出:` line, M1.4). The driver derives its mechanical checks from this
// data; the intent layer's artifactSpec section declares the conventions.
export type ArtifactSpec = {
  // Repository-relative path of the artifact (the canonical permanent
  // location; the write target is always this path).
  path: string
  // Legacy flat-layout fallback read path (D4 compat read; consulted only
  // when `path` does not exist). Absent = no fallback.
  fallbackPath?: string
  // Section anchors the artifact must contain (heading strings or bare
  // words, matched as substrings of the content); absent = no anchor check.
  sectionAnchors?: string[]
  // Human-readable name used in mandatory-artifact feedback (e.g.
  // "understanding digest"); absent = messages reference the path only.
  label?: string
  // The role this artifact plays; drives which checks apply. M1.4 checks
  // role "artifact"; the other roles' policies land with the M2.3 role model.
  role: DocumentRole
}
