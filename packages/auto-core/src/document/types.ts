// Document domain — frozen interface (D8; root plans/AUTO_NEXT_REFACTOR_PLAN.md
// M1.1 freeze; first consumers land in M1.4 artifact specs and M2.3 role
// close-out, design plans/0031).
// Process documents and phase output documents are explicitly distinguished
// by role. The driver's mechanical checks (existence, non-triviality, eof
// terminator, declared section anchors) are driven by ArtifactSpec data, not
// by hardcoded document names — today those checks live in execute.ts /
// doccheck.ts with implicit role knowledge.

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
  // Repository-relative path of the artifact.
  path: string
  // Section anchor the artifact must contain, when the convention requires
  // one (e.g. a summary section); absent = no anchor check.
  sectionAnchor?: string
  // The role this artifact plays; drives which checks apply.
  role: DocumentRole
}
