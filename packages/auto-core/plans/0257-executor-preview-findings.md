# 0257 — the executor preview's first field findings (adoption-site bring-up)

Status: **findings record, 2026-11-19.** The executor coordinator (the
0246–0254 preview, its code homes landed this same day) driven against
adoption-site target directories refused work the tool's own target shape
demands. Three findings, each reproduced, each adjudicated against the corpus
below: **all three implementation-side, none `by-design`** (0166's
disposition vocabulary — no ruling of 0246–0256 carries any observed
behavior). This document rules nothing (0165's neutrality: findings carry
`measures`, never dispositions) and lands no code, no template, no test. It
is the first executor-protocol incident record under 0255's incident
instrument, the exposure denominator named per that review's own honesty
rule: one adoption site, bring-up day, zero days of release exposure — the
findings are evidence of incompleteness against explicit letters and
inherited boundaries, never a verdict on the direction.

Derives P19 (a measured field record — three refusals reproduced at an
adoption site, every locus and ruling citation carried, the classification
itself a measurement: the corpus grepped for any ruling carrying each
behavior), P18 (the record is a plain corpus document — the no-telemetry
instrument 0255 pinned, recorded findings the only evidence channel), P8
(every finding names its remedy family, its classification, and the design
residual the eventual fix ruling must settle — detection recorded, nothing
enacted, every line teaching its remedy). Amends none — 0246–0256 are cited
as measures, not challenged, except where a residual names an under-ruled
corner the fix ruling must word.

## Category scope

Tier: record — no code, no template, no vocabulary act; the fixes, when
directed, each land as their own ruling per 0123/0110 D13 (code home and
test home named in the same change).

Premises this ruling changes: none — a record premises nothing. Re-read in
this change: 0246 §C, D2, D4 b/c/i/l; 0248 D5, D8; 0249 D2, D3; 0253 — all
stand (their letters are the measures below; the code undershoots them; the
one genuinely under-ruled corner — the fence's tier-0 doc surface — is named
as 0257-02's residual, for the fix ruling to settle, not this record).

## The reproduction shape (the tool's own target model)

Stated structurally: a target directory that is its own git repository, whose
deliverable includes a nested repository (a directory holding its own `.git`,
listed in the outer `.gitignore`, named by config `isolate`), whose in-flight
task's declared deliverables are process documents under `docs/T-NNN/`. This
is the target shape the tool itself defines — P1's letter: "the shipped
artifact is exactly what a nested destination repository's git manages"
(0108; containment 0103) — and the push path serves it today (the unified
commit's nested-first ordering, `repoRoots` `src/git.ts:1643`, exists
precisely for it).

## The classification method

The corpus's own test, applied per finding: 0165-review/CONTRACT.md — "grep
the corpus for the behavior: a deliberate ruling is not a defect — drop it,
or report a design challenge naming the ruling and why"; 0166's disposition
vocabulary (`fixed` / `by-design: <ruling doc>`). Greps over 0246–0256:
`standalone|single repo|nested|multi-root|submodule` → zero target-shape
rulings (the only "standalone" is 0248 D4's init op; the only shape-adjacent
scoping is 0251's "direct children of declared Linux roots", a
creation-placement rule); `freeform` and `Artifacts:` → zero hits in the
executor family (the fence's role vocabulary and the artifact declaration are
never ruled there); `\b65\b|\b130\b` → zero clock numbers (the sole ruled
figure is the advisory default 60, 0246 D4 c). The graded verdict: 0257-03
contradicts an explicit letter; 0257-02 contradicts two; 0257-01 invents a
constraint in design silence against an inherited boundary.

## 0257-01 — the coordinator refuses the nested destination repository outright

- **sev** S2 · **conf** CONFIRMED (reproduced: the refusal observed, text
  recorded) · **cat** BOUND
- **measures** P1 (0108's nested-destination model), P16, 0246 D2, 0073
- **loc** `src/executor-coordinator.ts:895-899` (claim/preview — the exact
  refusal below), `:606-607` (settle, "a single repository"), `:763`
  (close-out), `:1040-1047` (fix continuation, folded into a compound check),
  `gateWorkspace` `:270-275`; `src/executor-steps.ts:120-129`
  (`readExecutorTree`, for contrast)
- **evidence** the claim-time gate, `src/executor-coordinator.ts:895-899`:

  ```ts
  const roots = await repoRoots(dir)
  const top = await gitRead(dir, "rev-parse", "--show-toplevel")
  if (top !== dir || roots.length !== 1 || roots[0] !== dir) {
    return { kind: "blocked", reason: "isolation", detail: "The executor requires a standalone Git repository." }
  }
  ```

  Every claim on such a target answers `blocked, code "isolation", remedy
  "The executor requires a standalone Git repository."` — the unit never
  starts. `repoRoots` — the very enumeration the unified commit orders
  nested-first by (0073: "nested repositories are untouched (recursively
  committed first, as today)") — is imported by the coordinator and used only
  as this refusal predicate, while `readExecutorTree`
  (`src/executor-steps.ts:123`) already aggregates every root's dirt as
  workspace dirt and `statusEntriesRead` (`src/git.ts:1838`) already remaps
  nested roots' output to target-relative paths.
- **repro** observed at the adoption site, every lane of this shape.
- **impact** a target of the tool's own P1 shape is unservable by the
  executor at every tier; the push path serves the same target today.
- **classification — implementation (drift into design silence).** The
  admission contract (0246 D4 b: "granted only if admission passes (ready, no
  live lease, scope-disjoint from every in-flight lease at the tier in
  force)"; D5's enumeration of the admission authority) carries no repository
  count or shape criterion; no P21 deferral covers one; and 0246 D2 rules the
  driver acts "happen inside the coordinator process, through the core's
  existing boundaries" — boundaries that are nested-repo-aware by standing
  rulings (0073, 0013's nested-first mirroring, `Auto-Nested` 0021). The
  refusal is an unruled constraint the code invented; the remedy string is
  the implementer's words, ruling-free.
- **remedy family** honor the inherited multi-root posture at claim/settle/
  close-out on the main tree (the machinery already exists: `repoRoots`,
  `commitTree`, per-root status); distinguish the legitimate settle-time root
  check on a *worktree checkout* (`:606` — a session creating a new nested
  repo inside a lane), which stands.
- **family** `gateWorkspace`'s single-root conditionality rides with the
  claim gate; `readExecutorTree`'s nested-dirt-as-dirty is consistent with
  the push path's clean gate and stands.
- **prior** NEW
- **design residual** the fix ruling words the admission shape in one line
  (the admission contract enumerates readiness/lease/scope; repository shape
  was never ruled — close that silence explicitly rather than by code
  deletion alone).

## 0257-02 — the landing fence's role gate excludes the task grammar's own documents

- **sev** S2 · **conf** CONFIRMED (reproduced: the settle rejection observed)
  · **cat** BOUND
- **measures** 0248 D5, 0253, P1
- **loc** `src/executor-coordinator.ts:120-127` (`permitted()`), feeding
  `:612-615` (settle reject), `:694-699` (staged-set proof), `:914-920`
  (continuation), `:1044-1047` (fix), `:1117-1121` (scoped reservation);
  `src/document/roles.ts:218` (`PROCESS_DOCS`), `:242-245` (the artifact
  branch); `src/document/spec.ts:44-64` (`declaredArtifacts`, for the
  residual)
- **evidence** the fence, `src/executor-coordinator.ts:120-127`:

  ```ts
  function permitted(entry: Entry, path: string): boolean {
    if (workdirEntry(path) || path === ".opencode" || path.startsWith(".opencode/") || path.split("/").includes("AGENTS.md")) return false
    const docs = taskDocPaths(entry.grant.unit)
    if (entry.grant.kind === "verify") return path === docs.report || path === docs.gaps
    if (path === docs.handoff) return true
    const scope = entry.scope ?? entry.touches
    return roleOf(path) === "freeform" && (scope === undefined || withinScopes(path, scope))
  }
  ```

  Since `PROCESS_DOCS = /^docs\/(?:T-\d+|R-\d+)(?:\/|$)/` makes every
  `docs/T-*`/`docs/R-*` path classify non-freeform (`roles.ts:244`), a task
  whose `Touches:` declares its own document surfaces (its register under
  `docs/T-NNN/`, receipts under `docs/T-NNN/testhands/`, an evidence doc
  under another task's dir) cannot complete: a report whose changed set
  includes those files answers `blocked, reason "isolation", remedy
  "Resolve out-of-scope edits before replaying: …"`.
- **repro** observed at the adoption site on a cleanroom-intent target whose
  deliverable is documents.
- **impact** document-deliverable tasks are unservable at every tier — the
  fence admits code-plus-handoff only, where the push path writes these same
  artifact-role documents as ordinary task work (post-hoc checked, never
  pre-fenced: `src/execute.ts:1424`).
- **classification — implementation (contradicts two explicit letters).**
  0248 D5 rules the permitted set as "the write contract's permitted set: the
  unit's effective scope (its `Touches:` declaration resolved) plus the
  artifact paths per kind (`docs/T-NNN/handoff.md`, `gaps.md` on a verify's
  INCOMPLETE, `report.md` on a verify's PASS)" — scope-based, no role test;
  the words "freeform" and the role vocabulary appear nowhere in the executor
  family. 0253 rules "A reservation includes the declarations and the unit's
  own task directory" — yet the role gate refuses writes anywhere under the
  unit's own `docs/T-NNN/` except `handoff.md`, at every tier including the
  same-tree tier that ruling describes. The gate is an unruled narrowing on
  top of a ruled permitted set; 0246 D4 i's never-list (`todo.md`/`done.md`,
  the phase index, `subtasks.md`, the config, `AGENTS.md`, `.auto/`) is
  honored by the first line and stands.
- **remedy family** honor in-scope artifact-role paths (the ruled permitted
  set is `Touches:`-resolved scope plus the three per-kind artifacts — the
  role test drops or yields inside scope); no new grammar.
- **family** the verify branch (report/gaps) and the never-list are
  consistent with 0246 D4 i and stand; `grant.budget`'s advisory carriage is
  unrelated.
- **prior** NEW
- **design residual** the under-ruled corner the fix ruling must word:
  whether docs-declared units are servable at tier 0 (the sole doc-deliverable
  letter is 0253's tier-1 reservation importing 0099's doc-lane scope —
  "the unit's own `Touches` ∪ `docs/T-NNN/`"), and the fence's relation to
  the `Artifacts:` declaration (the planning side already derives `touches`
  from it — `src/split.ts:169`'s AUTO-DECISION — so the fence need not read
  it; say so, closing the finding's implied remedy rather than leaving it
  inferred).

## 0257-03 — the lease clock is hardcoded where its own ruling says configured

- **sev** S3 · **conf** CONFIRMED (deterministic trace: the constants, and
  every potential threading surface enumerated — config keys
  (`src/config.ts`), switches (`src/switches.ts`), the wire payload
  (`grant.budget` emitted at `src/executor-coordinator.ts:1224`, read by
  nothing in src/) all carry nothing into them) · **cat** GEN
- **measures** 0246 §C, 0248 D8, 0249 D2, P16
- **loc** `src/executor-coordinator.ts:97-99` (the constants), `:1224`
  (grant issuance — window and budget applied server-side), `:1272`
  (heartbeat renewal, `Math.min(at + LEASE_WINDOW_MS, entry.issued + MAX_LEASE_AGE_MS)`)
- **evidence**

  ```ts
  const EXECUTE_BUDGET_MINUTES = 60
  const LEASE_WINDOW_MS = (EXECUTE_BUDGET_MINUTES + 5) * 60_000
  const MAX_LEASE_AGE_MS = 2 * LEASE_WINDOW_MS
  ```

  One lease lives at most 65 minutes, total lifespan capped at 130 from first
  issue; nothing configures them. The adoption site's long instrument arcs
  (measured ~45 min runway, 3600 s sweep bounds) fit one window barely;
  longer arcs cannot be served.
- **repro** the constants are the reproduction; the arc measurement recorded
  at the adoption site.
- **impact** targets with long arcs are unservable past the wall (the work
  itself judged on disk regardless — P20, 0246 D4 c — so no loss, but the
  lease grammar cannot serve its holder).
- **classification — implementation (contradicts an explicit letter).**
  0246 §C: "Lease-expiry tuning — deferred to D10 slice 4; the window, the
  refresh and the hard cap are **configured, never hardcoded per project
  (P16)**." Reinforced: 0248 D8 (the idle window "configured at slice 2,
  never hardcoded per project"), 0249 D2 ("configured lease duration"). No
  later ruling authorized constants — 0253/0254 are silent on values; 65 and
  130 appear nowhere in the corpus; the sole ruled figure is the advisory
  default 60 (0246 D4 c, inherited from 0117).
- **remedy family** thread the three values from a target-declared surface;
  the defaults stand as defaults.
- **family** `MAX_ATTEMPTS`, `MAX_RESPONSE_BYTES` beside them are unruled by
  §C's letter and not findings.
- **prior** NEW
- **design residual** the deferral was never discharged: "values ruled at the
  lease slice" (0246 D4 l) never named the configuration home — target config
  key, wire field, or per-claim parameter. The fix ruling completes the
  design (names the home), not amends it; the adoption site's measured arcs
  are the P19/P21 consumer that locks the shape.

## Estate-side context (recorded for completeness, not tool findings)

The bring-up surfaced two target-side items, both already fixed and recorded
at the adoption site: its confinement launcher predating the executor bridge
(the bridge secret never reached the worker — fixed by the launcher's own
env-passthrough pattern), and one stale driver-owned recovery record
(`.auto/progress.json` naming a unit closed long after) that blocked all
claims until settled. Neither involves tool changes.

## Disposition

No `by-design` disposition applies to any finding; no premise-guard re-reads
triggered. The pattern across all three is one failure shape: the preview's
single-repo, code-plus-handoff, fixed-clock fixtures were promoted into
admission, fence, and clock rules the rulings never carry. Fixes land only
when directed — each its own small ruling per 0123/0110 D13, code home and
test home in the same change, each settling its named residual.

## Tests

None land — the record changes no code. Form checks at the landing tree,
0255/0256's pattern: auto-core `bun typecheck` exit 0; the four
reconciliation suites green over the new INDEX row (docs-registers,
constitution, docs-truth, release-due). The INDEX row is this document's
only companion change.
