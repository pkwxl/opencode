// Document domain — frozen interface (D8; root plans/AUTO_NEXT_REFACTOR_PLAN.md
// M1.1 freeze; design plans/0031). Amended at first-consumer time (M1.4,
// plans/0034 D2): the draft's singular sectionAnchor could not express the
// multi-section `Artifacts:` declarations the parser actually produces, and the
// checker needs the D4 fallback-read path and the feedback label as data.
// Process documents and phase output documents are explicitly distinguished
// by role. The driver's mechanical checks (existence, non-triviality, eof
// terminator, declared section anchors) are driven by ArtifactSpec data, not
// by hardcoded document names — the machinery lives in document/spec.ts
// (M1.4). The role model itself (M2.3, plans/0045) lives in document/roles.ts:
// the path → role classifier, the per-role policies (eof scan, protect, the
// process/deliverable split) and the handoff role's protocol checks.

// The role of a path in the target directory (classified by roles.ts roleOf):
// - driverState:     driver-exclusive state (.auto/*, opencode.json,
//                    the project config); AI sessions must
//                    never write these (read-only during a run, protect.ts).
// - ledger:          the round's phase index phases.md (order and membership;
//                    driver-written, ticked on completion; M3.3 replaced the
//                    append-only ledger lines under this role).
// - handoff:         boundary handoff documents — the session handoff family
//                    (handoff/testhandoff, status line) and the phase handover
//                    distillations (four sections); protocol-shaped, eof-exempt.
// - phaseAcceptance: the per-phase acceptance record (0036 D8): drafted by the
//                    handover session, signed by a human with `Accepted: yes`,
//                    read by the acceptance gate (M4.2, plans/0049 G7).
// - roundBrief:      the human's round brief docs/R-NN/round.md (goal,
//                    acceptance and release criteria, close listing; M4.2,
//                    plans/0049 G2); stubbed at round start, read by planning
//                    and the round-close gate.
// - planningInput:   a phase's planning input docs/R-NN/P<nn>-<type>/
//                    plan-input.md (plans/0053 D9–D10): the human's `plan`
//                    text verbatim, committed by the driver before the
//                    planning unit, read by the planning session's prompt.
// - artifact:        AI-produced process documents consumed by later stages
//                    (task, round and phase documents under docs/);
//                    shape-checked (non-trivial + eof terminator).
// - userReport:      the round user report docs/R-NN/report-for-user.md
//                    (plans/0081 D6a): written by a task or the knowledge
//                    side-channel session, read by the person; a process
//                    role, eof-scan exempt like its round-level siblings
//                    (the round-close gate itself checks the terminator).
// - freeform:        everything else — the deliverable itself and the
//                    project's own documents; the standardization boundary
//                    places no schema on it beyond the P1 prohibition.
export type DocumentRole = "driverState" | "ledger" | "handoff" | "phaseAcceptance" | "roundBrief" | "planningInput" | "artifact" | "userReport" | "freeform"

// A declared artifact of a task/subtask (the structured form of the
// `Artifacts:` line, M1.4). The driver derives its mechanical checks from this
// data; the intent layer's artifactSpec section declares the conventions.
export type ArtifactSpec = {
  // Repository-relative path of the artifact (the canonical permanent
  // location; the write target is always this path).
  path: string
  // Section anchors the artifact must contain (heading strings or bare
  // words, matched as substrings of the content); absent = no anchor check.
  sectionAnchors?: string[]
  // Human-readable name used in mandatory-artifact feedback (e.g.
  // "understanding digest"); absent = messages reference the path only.
  label?: string
  // The role this artifact plays; drives which checks apply. The spec
  // checker handles role "artifact"; the other roles carry their own
  // policies in roles.ts.
  role: DocumentRole
}

// A line a unit added to a file: 1-based line number in the current file +
// the line's text. Produced by the driver from git (git.ts unitAddedLines),
// consumed by the P1 prohibition scan (process-refs.ts).
export type AddedLine = { line: number; text: string }
