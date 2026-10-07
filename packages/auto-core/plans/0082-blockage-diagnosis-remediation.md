# 0082 — Blockage prevention and consented remediation

Status: **proposal** (2026-10-07), awaiting review; Part II (root cause and prevention) added the same
day after review — prevention outranks resolution, and the re-ranked stages in §14 put it first. The
triggering record: the 2026-10-07 plan-verify blockage of the cleanroom run (`~/workspace/cleanroom`,
R-01.P03), the out-of-tool analysis session that diagnosed it, and the artifact trail showing the
pipeline had manufactured the conflict two phases earlier.

The problem, in two paragraphs. **The conflict was manufactured, not imported**: the design phase
resolved a genuine charter ambiguity (is the reference subsystem's published uapi header "the reference
implementation" or published contract?) through the AUTO-RESOLVE provisional-default protocol — the
correct move — but the protocol defers the person's answer to the round report, written at round end,
while the very next artifact (the phase handover) distilled the provisional default into a binding
constraint with its status laundered away; the only semantic checkpoint (the 0080 plan verifier) fired
at the next planning composition, two phases after the cause, mislabeling the span's location because
its own verdict template enumerates four prompt blocks and handovers are not among them.

**And when a gate does block, the person faces the resolution alone**: a one-line verdict plus static
advice that names surfaces by assumption — in the incident "rewrite the conflicting input" pointed at a
file that did not exist (P03 has no planning input) while the real span sat in the P02 handover, a
driver-distilled document the message never named. Remediating any such blockage demands
operating-model knowledge (which surface owns which words, which channel edits it, what the driver may
write), file surgery across process documents, packs and inputs, manual commits, and a re-run — all by
hand, re-derived at every blockage, because the target directory carries the work context but nothing
teaches the tool's own working mode, and no channel lets the person sanction an edit without performing
it.

> **The fix, in two parts — prevention first. Part II: define the wall in the authority itself (the
> shipped charter names its boundary: the brief-named location, published headers included; lower
> documents may narrow a wall, never widen it) — charter-touching provisional defaults surface at the
> phase boundary where they are recorded, not at round end, and travel forward as OPEN — the handover
> distiller keeps normative status (AUTO-RESOLVE items are open decisions, never constraints; the
> collect lint enforces it) — and prompt-destined text is charter-checked when written (the handover
> before its close commit, the planning input at admission, warn-and-record), with the verifier taught
> that an OPEN default is a deference, not an override. Part I: every covered block site mechanically
> assembles a blockage dossier whose span locator names the true source files — a core-owned
> operating-mode brief teaches a read-only diagnosis session the surfaces, their ownership and the
> remediation channels — its strictly parsed options land in a committed remediation document the
> person answers with one `Choice:` line (ratification: the marked text becomes the person's words, the
> survey-brief precedent) — and the next prelude executes the approved edits mechanically (one
> `Auto-Stage: remediation` commit per edit, old-span literal match, nothing skips a gate). Prevention
> makes blockages rare; remediation makes the residual cheap.**

## Part I — Consented remediation (making the residual cheap)

## §0 The record analyzed

- The blockage: `phase-plan R-01.P03: INCONSISTENT — the charter's "its sessions never access, search
  for, reconstruct, infer or request the reference implementation" contradicts the prompt's
  "`include/uapi/linux/ext4.h` may be read by grep/extract for constants only" (in the planning input)`
  (`docs/R-01/prompt-audit.md`, committed `PLAN prompt-audit phase-plan R-01.P03`, exit 2, clean tree,
  open P03 planning step).
- The out-of-tool remediation (an interactive agent session over the target): traced the evidence span
  to `docs/R-01/P02-design/handover.md:139` (the prompt renders it through the earlier-handovers block —
  the verdict's "(in the planning input)" was the verifier model's guess, P03 has no `plan-input.md`);
  read the charter (`.opencode/auto/intents/cleanroom.md` `### verify-plan`); traced the carve-out to its
  origin as an AUTO-RESOLVE provisional default (T-011 design §6.3); verified the charter-legal
  alternative source exists (spec-notes Part 0 item 3 restates the public uapi ABI inline, ~54 constant
  occurrences); weighed rewrite-handover vs amend-pack; proposed exact replacement text, a manual commit,
  an optional `plan -p` ruling, and a re-run.
- Every input of that analysis was either on disk in the target (brief, pack, handovers, task documents,
  audit, spec notes) or in the driver's own composition state (which file fed which prompt block) — the
  analysis is reproducible by the tool itself; nothing about it required an outside agent.
- The precedents already in the code base: the 0080 verifier proves the driver runs judgment sessions
  (bare one-shot, strict parse, fail-closed); `requireArtifact` proves side-channel sessions (knowledge,
  prior-knowledge); the 0081 D15.2 survey gate proves ratification-writes (the approved brief proposal
  installed verbatim through one protect-passing write); 0079 `--repair` proves budgeted autonomous
  rework; `Interactive` (the `--interactive` sideband) proves in-run person prompts.

## §1 Findings

- **F1 — blockage advice guesses what the driver knows.** The block sites print static lines naming
  assumed surfaces ("the conflicting input"). The driver composed the prompt and therefore knows the
  block map (input / brief / handover P02 / pack guarantees / template) mechanically; the evidence
  string's own attribution is free-form model text. Result: advice that names a file that does not exist
  and misses the file that does.
- **F2 — the target carries work context, not operating-model context.** A person (or a session) staring
  at a blockage cannot discover from the target alone: the surface/ownership table (person words vs
  driver-distilled vs driver-exclusive), the channel for each surface, the exit-code semantics, or what
  an unblock may legitimately do. The AGENTS.md block teaches sessions the run protocol, not the person
  the remediation map; MANUAL.md teaches commands, not this diagnosis.
- **F3 — no channel accepts a sanctioned diff.** The person channels are person-typed (`plan -p`,
  `amend --brief`, hand edits between runs); the driver channels are autonomous within budget
  (`--repair`) or mechanical (close). The middle ground — the person approves exact text, the driver
  performs the edit and the commit — exists exactly once (the survey brief install) and is not
  general.
- **F4 — the remediation pattern is mechanical at both ends.** Dossier assembly and edit execution are
  deterministic driver work; only the middle step (interpretation: root cause, options, consequences,
  recommendation) is judgment — and the verifier already shows how the driver buys judgment
  (a session, a strict protocol, fail-closed). The incident's four-hour human loop is the same shape as
  a --repair round: diagnose → propose → consent → execute → re-verify.

## §2 Direction 1 — the blockage dossier (D1, D2)

**D1 — every covered block site assembles a dossier before printing anything.** A data object (not a
file), assembled by the driver at the moment of blocking:

- the gate, the step, the verdict text and evidence (for the render gate: the violated assert and the
  offending literals);
- the **block map** of the composed prompt: each block → its role and source path (`input →
  P03-implement/plan-input.md (absent)`, `handover → P02-design/handover.md`, `brief`, `pack →
  intents/cleanroom.md §guarantees`, template id);
- the **span locator's** results (D2): the evidence's quoted fragments (backtick spans, plus the
  violating literals for the render gate) searched literally over the block-map sources first, then the
  round's process documents — each hit reported as file:line-range; a fragment that locates nowhere is
  reported as unlocated;
- the state snapshot: the open step, phase index position, `git status --short`, the last commits, the
  audit tail, the active guarantees section verbatim.

**D2 — the block line states located files, not assumed roles.** With the dossier, the incident's
message becomes: `⏸ plan verification found the phase-plan R-01.P03 prompt inconsistent … the
conflicting span is docs/R-01/P02-design/handover.md:139 (an earlier phase's handover). Rewrite it, or
amend the intent — the driver never rewrites your words`. This lands D1/D2 alone as the ship-first fix:
even with nothing else built, the advice stops misattributing. The locator is honest about limits —
model-written evidence may paraphrase; unlocated spans simply drop the file claim.

## §3 Direction 2 — the operating-mode brief (D3)

**D3 — a core-owned template, injected at diagnosis time; no persistent copy in the target.** The brief
(`templates/prompts/_mode-brief.md`, registered in `src/template.ts`, rendered as pre-built data the way
intent-pack sections are) states, in a few hundred words:

- the surface/ownership table: person words (brief, planning input, pack, survey answers) /
  driver-distilled process documents (handovers, reports, audits) / driver-exclusive state (index
  ticks, todo→done renames, `.auto/units.json`);
- the gates and their verdict semantics (render gate, plan-verify, survey clarification, round close,
  the SHA baseline) and the exit codes;
- the remediation channels per surface (who writes, through what command or mechanism);
- the executor's capability statement for this design: what an approved remediation may do, and the
  invariants that hold regardless (every gate re-runs; driver-exclusive state untouched; P1).

The decision: the target directory gains this context **at diagnosis time, always current** — the brief
versions with the code and is never a second copy to drift. The person-facing copies remain MANUAL.md
(commands) and the remediation records themselves (§5), which persist the relevant excerpts as they
become true; a persisted in-target manual page was rejected as a drift surface with no reader that
prefers it (F2's readers are the diagnosis session, which gets injection, and the person, who gets the
records and MANUAL.md).

## §4 Direction 3 — the diagnosis session (D4, D5)

**D4 — a read-only side-channel session on the `requireArtifact` skeleton.** Dispatch like knowledge
extraction: input = the mode brief + the dossier + pointers into the target (brief, pack, handovers,
task documents, audit — on disk, read through tools); output = one artifact, the remediation plan. The
session's toolset is read-only where the adapter can enforce it (permission preset); where an adapter
cannot restrict tools, the charter line ("propose only — you never edit; the executor ignores anything
outside the format") carries the discipline and the strict parse is the backstop. The session never
writes, never runs the work, never judges completion — it proposes. A new `diagnose` role in the roles
registry (tier with the analysis roles, routed through the ordinary model-route machinery) names its
model; the cost is one session per blockage, bounded by consent (§5).

**D5 — a strict plan format, parsed like RESOLVE_FORMAT; Escalation is a first-class outcome.**

```
## Analysis
<root cause: which span, which authority it conflicts with, why>
## Options
### A <title>
Channel: handover-edit | planning-input | brief-amend | pack-amend | task-doc-note | advice
Edits:
1. <path> — replace lines <first>–<last> (<old first line>) with:
<new text, verbatim>
Consequences: <what changes, what the next verify run will see>
### B …
Recommendation: A
## Escalation        (mutually exclusive with Options)
<this is a tool defect / a substantive decision only the person can make — no safe edit exists>
```

Parse rules: at least one option with at least one edit each, or an Escalation section; edits name
existing files only. Unparsable or errored → fail-closed to today's static message, the raw reply
appended to the round's audit trail — the verifier's discipline (a guarantee that can be slept through
is not a guarantee). An Escalation outcome still writes the remediation document (§5): the analysis the
person would otherwise re-derive by hand, on disk, with the run staying blocked — half the value of
this design arrives even when no edit is safe.

## §5 Direction 4 — the remediation document, the mark, the executor (D6–D8)

**D6 — `docs/R-NN/blockage-<seq>.md`, committed on its own, answered with one line.** The driver parses
the session's plan into a document (header: the gate, step, verdict, the dossier's located spans, the
execution protocol; then Analysis, Options verbatim, the session's recommendation) and commits it
(`Auto-Stage: blockage`, the prompt-audit pattern: written before anything it might change, surviving a
run that goes no further). The person's whole obligation is one line — `Choice: A` — written into the
document's mark section, optionally after editing an option's text. **Ratification semantics (the
0081 D15.2 precedent): the marked text becomes the person's words; the driver writes only words the
person just sanctioned, through a channel that records the sanction.** "The driver never rewrites your
words" holds — the driver never *chooses* them. A `Notes:` line may accompany the choice; free-text
rulings ride in as planning-input channels or notes on the next diagnosis, not as interpreted prose.

**D7 — the executor is mechanical over the enumerated edits.** A new early prelude row (before the
drift re-sync row) finds the round's unexecuted `Choice:` marks and executes them:

- each edit applies only on **old-span literal match** (the first and last lines of the replaced span
  must still match the file) — a stale document re-blocks with "the file changed since diagnosis",
  never a blind overwrite;
- each edit lands as its own commit, `Auto-Stage: remediation`, subject naming the blockage seq and
  option id; a mid-sequence commit failure stops the sequence and re-blocks naming the partial state
  (the unified-commit discipline);
- the channels map to existing write paths where they exist: `planning-input` goes through
  `savePlanInput` (its own commit), `brief-amend` through the brief write path (protect-passing if
  mid-run, the survey install's mechanism), `pack-amend` edits the materialized pack between runs and
  the very next preflight re-validates the guarantees grammar (a remediation that breaks the grammar
  fails there, by design); `handover-edit` and `task-doc-note` are plain process-document writes;
  `advice` executes nothing (a recommended person command — e.g. `plan --force-close`, a kill-switch
  re-run — is printed and recorded);
- after execution the driver appends one `Executed: A (<shas>)` line to the document and **the blocked
  step re-composes and re-verifies from scratch** — remediation never clears a verdict; only the gate
  re-running clears it.

**D8 — consent is the budget; two caps and one switch.** Every remediation round needs a fresh mark —
there is no pre-authorized budget (that model stays unique to `--repair`, whose subject is work rework,
not state/text alignment). Two consecutive remediated re-blocks of the same step suspend diagnosis for
that step (static message + full audit pointer: repeated disagreement signals a diagnosis quality
problem or a person who keeps approving the wrong option — either way the human reads). The kill switch
`OPENCODE_AUTO_REMEDIATE` (default on, only removes — the 0080 switch pattern) returns today's behavior
exactly; the dossier's corrected block line (D2) survives the switch, being mechanical truth.

## §6 The interactive fast path (D9)

**D9 — `--interactive` presents the options through the sideband; the artifacts are identical.** The
document is still written and committed first; the sideband then offers the options (pick / escalate /
edit-then-pick / decline); the pick writes the same `Choice:` line and the executor runs inline, the
loop resuming without a process exit. Declining or quitting leaves exactly the detached state — the
mark can be added later by hand. The detached mark remains the canonical protocol (it works over nohup
and SSH, which is how the cleanroom run actually attended its gates); interactive is sugar over it, not
a second mechanism.

## §7 Coverage, staged (D10)

**D10 — v1 covers the two judgment gates; the mechanical classes adopt the dossier as they hurt.**

- v1: plan-verify `INCONSISTENT` and `FAILED` (loop-plan's two block branches), and the render-gate
  `PromptGuaranteeError` (same dossier shape: violated assert, offending literals, block map).
- v2 candidates, each appended by a real incident rather than speculation: dirty-tree blockages at unit
  start (diagnosis: what is dirty, driver-state leftovers vs person edits, the split action), the
  round-close gate's report problems, `phaseTailDrift` (exit 1 today).
- Explicitly separate: FAIL verdicts stay with `--repair` (work rework, budgeted, no per-round consent
  needed); the survey clarification gate stays its own human gate (its fork questions ARE the decision —
  though its round-report listing may grow a pointer to open blockage documents); usage/environment
  exit-1 errors keep static messages (mechanical causes, mechanical fixes); stuck/session-failure
  recovery keeps its existing machinery.

The round user report's needs-attention section (0081 D16) lists un-Choice'd blockage documents
alongside provisional answers — the person's decision inbox, one place.

## §8 The incident replayed under Part I

The P03 blockage fires → the dossier locates the span in `P02-design/handover.md:139` and the block map
shows no planning input exists → the block line names the handover (D2). The diagnosis session reads
the charter, T-011 §6.3's AUTO-RESOLVE origin, and spec-notes Part 0 item 3's restated ABI, and returns
two options: **A** handover-edit — replace the carve-out bullet with constants-from-restated-ABI text
(consequences: strict wall, nothing else changes); **B** pack-amend — write the uapi carve-out into
`### verify-plan` (consequences: the exception becomes charter, the audit phase must police recorded
reads). The document commits; the person writes `Choice: A`; the next `run` executes one edit, one
`Auto-Stage: remediation` commit, re-composes, re-verifies — `consistent` — planning proceeds. Total
person effort: reading ~40 lines and writing one line. The identical loop answers the next stranger
blockage (a dirty tree of unknown provenance, a report gate refusing a malformed document) with the
same shape: analysis on disk, decision by mark, execution by driver, verdict re-earned.

## Part II — Prevention (stopping the manufacturing)

## §9 The causal chain, with evidence

Four causes stacked; the incident is fully explained by their composition, and each link is verified in
the artifacts (no link is speculative):

- **RC1 — the authority layer: the charter's central term has an undefined boundary, and a second
  authority in the target draws a different wall.** The shipped charter forbids access to "the
  reference implementation … at the location the brief names" — is that the whole of `./linux`, or the
  reimplemented subsystem within it? Are the reference's *published interface headers* reference
  (walled) or contract (readable)? The charter does not say. Meanwhile the person's own methodology
  document in the target (`CLEANROOM-PLAYBOOK.md`) draws a narrower wall with an explicit platform
  carve-out ("the rest of the platform tree (core headers, core docs, unrelated drivers) is ALLOWED and
  encouraged") and was bound over every later session as required reading through the P01 handover
  ("binds all phases"). Two authorities, two walls, no defined ranking between them — every
  post-spec-read session had to reconcile them for itself.
- **RC2 — the timing layer: the provisional-default protocol defers the person's answer past the point
  where the pipeline consumes it.** The design session did exactly what the question rule asks: T-011
  design §6.3 records "AUTO-RESOLVE: may implementers read `include/uapi/linux/ext4.h` … → Yes, but
  only for constant extraction … this resolves the ambiguity narrowly, in the direction the spec's own
  text points". The rule's contract is "a decision is never closed in real time" — true for the person
  (the answer waits in the round report's needs-attention section, written at round end, and R-01 was
  at phase 3 of 5) and false for the pipeline: the very next artifact treated the default as settled.
  The surfacing surface already existed with exactly the right charter — 0081 D3's needs-attention
  section exists "for leisure analysis" and names "the round's AUTO-RESOLVE proxy decisions with
  enough context to confirm or overturn each" — but 0081 D1/D2 pin it to **one report per round,
  written by a wrap-up task of the round's final task-bearing phase** (P05-audit here, three phases
  after the consumption point; P02's close wrote no person-facing artifact at all — the only
  report-for-user.md of the run, P01's, predates the landed per-round design and closed before the
  default existed). And the report task is a distiller, not a checker: it runs as an ordinary
  whole-task session over the round's documents; no gate runs over recorded defaults at any phase
  close. The surface was right; the cadence was the hole, and no amount of report-writing checks a
  default — checking is the driver's move (D12).
- **RC3 — the handover layer: the distiller has a status protocol for settled decisions but none for
  provisional ones.** `templates/prompts/phase-handover.md` instructs "Key decisions" that
  "decisions annotated AUTO-DECISION in the body take priority" — and instructs "Constraints and
  pitfalls" to carry "environment constraints, dependency traps, easy mistakes and workarounds … only
  write pitfalls the next phase would step in". AUTO-RESOLVE appears nowhere. The distiller honestly
  kept the marker ("uapi ABI-constant carve-out (AUTO-RESOLVE, T-011 §6.3): … may be read by
  grep/extract for constants only") but the section made it a *constraint* — the next phase (and the
  verifier) read "may be read" as granted permission. The status laundering happened exactly where the
  template gave it no other home. (Review's hypothesis, confirmed and made precise: the handover prompt
  did fail to strike the balance — not in general, but by having vocabulary for settled decisions only.)
- **RC4 — the verification layer: the only semantic checkpoint sits at the end of the chain, with a
  narrowed field of view.** The 0080 verifier runs solely on composed planning prompts: the handover —
  text destined to become prompt surface — was committed at P02 close (`PLAN handover P02-design`)
  under no charter check, and the conflict surfaced only when P03's prompt was composed. And the
  verifier's own verdict template enumerates the conflict's location as "<planning input / brief /
  phase duties / mode notes>" — handovers are not in the list, so the model was made to label the span
  with one of four names, none correct: hence "(in the planning input)".

The chain in one line: an undefined boundary (RC1) let a design session mint a provisional permission
(RC2's protocol working as designed, at the wrong urgency), the distiller promoted it to constraint
(RC3), and the gate caught it two phases later with a mislabeled location (RC4). Prevention is four
moves, one per link, each closing its cause at the earliest possible moment.

## §10 The prevention moves (D11–D14)

- **D11 — the wall is defined in the authority itself (closes RC1).** The shipped cleanroom charter's
  `### verify-plan` gains its boundary sentence: *the reference implementation is everything under the
  location the brief names, its published interface headers included — their content reaches
  clean-room sessions only through the specification notes' restatement; walls and permissions live in
  this charter alone, and a lower document may narrow them, never widen them — widening is the
  person's ruling, carried as an open question until given.* The monotonic clause is the load-bearing
  half: a target playbook may tighten the wall, but a session may never reconcile a playbook's wider
  grant into policy by itself — that reconciliation becomes an OPEN question the moment it is noticed.
  (A bundle-authoring decision flagged for review: if the family wants the published-header carve-out,
  it is written *into the charter* — permissions are charter text, never phase-level constraint text.
  The default here is strict, matching the derivation axis the bundle ships.) The guarantees-authoring
  guidance gains the matching rule: every term the verifier will enforce is defined by the charter;
  carve-outs are charter text. Existing targets get the sentence through the ordinary pack-amend
  channel (Part I's `pack-amend`, or by hand between runs).
- **D12 — charter-clamped defaults: check at record time, clamp to the charter, then surface without
  correctness depending on the person seeing it (closes RC2).** Every AUTO-RESOLVE default a session
  records gets one cheap one-shot charter check at record time (the 0080 verifier call reused:
  charter vs the recorded default's text — defaults are rare, a handful per round, one classifier-tier
  call each). A default the check flags is **clamped**: the recording session re-records it so the
  default *in force* is the charter-consistent reading, and the wider grant it wanted becomes the OPEN
  question's option — a person may widen a wall by answering or through the charter channel
  (pack-amend), but the pipeline never proceeds under a default that contradicts the charter. The
  clamp is what dissolves the cadence problem: whether the person reads the flag at phase close, at
  round end, or never, correctness does not depend on it. The flagged item is still surfaced — one
  phase-close log line naming the OPEN question — and the round report's needs-attention section
  (whose charter already names exactly this listing, 0081 D3) remains the decision inbox. **One
  report per round stands** (0081 D1): no per-phase full user reports; with the clamp, an earlier
  cadence would be a courtesy, not a correctness need. The question rule's contract gains its missing
  half: a decision is never closed in real time — *and the pipeline never consumes it as closed*.
- **D13 — the distiller preserves normative status (closes RC3).** `phase-handover.md` gains the
  missing protocol: AUTO-RESOLVE items are recorded in "Key decisions" as `<decision> — OPEN
  (AUTO-RESOLVE <path>: the default in force, the question, how to override)` and never enter
  "Constraints and pitfalls", whose admission bar gains "settled policy and environment facts only —
  anything awaiting the person's ruling is an open decision, not a constraint". The mechanical
  backstop: the handover collect lint rejects an AUTO-RESOLVE marker under "Constraints and pitfalls"
  (the shape-check re-prompt pattern — the distill session re-dists once with the finding named).
- **D14 — prompt-destined text is charter-checked when written, and the verifier sees the whole board
  (closes RC4).**
  (a) The handover: before the phase-close handover commit, one verifier call over the charter and the
  handover rendered as the next planning prompt will render it; INCONSISTENT or FAILED → one re-distill
  with the verdict (the requireArtifact retry pattern), then fail-closed to the person — where Part I's
  remediation owns the decision instead of a raw blockage. Cost: one call per phase close.
  (b) The planning input at admission (`plan -p` / `--file`): the same call, warn-and-record, never
  refuse — the person's words are theirs; the composition-time gate still judges the composed whole.
  (c) The verifier template's verdict line enumerates its location as "<planning input / brief / phase
  duties / mode notes / handovers>" — the mislabel's mechanical half; the dossier's span locator
  (Part I D2) is the driver-side half.
  (d) The verifier's judging rule gains: *a grant presented as an open question awaiting the person's
  ruling (OPEN / AUTO-RESOLVE, carried as a decision not a constraint) is a deference, not an override
  — judge it consistent; the same grant presented as settled instruction is not.* D13 and D14d are a
  pair and land together: without the judging rule, the write-time check would pressure distillers to
  drop open questions; without the distiller rule, the judging rule would bless markers kept as
  decoration on laundered constraints.

## §11 The two parts compose; the incident replayed under Part II alone

Prevention shrinks the arrivals; remediation prices the residual — and the residual is real: charter
ambiguities no authoring rule removes, person-written inputs that conflict, dirty trees, gates
refusing malformed documents. Part I's diagnosis session is also prevention's graceful failure mode:
when D14's write-time check fails closed, the remediation document turns the person's next decision
into one line instead of one evening.

Under Part II alone the incident never reaches P03: the charter defines its boundary (D11), so T-011's
question answers itself from the text — `ext4.h` is reference, the restated ABI in spec-notes is the
channel; if the ambiguity still arises anyway, the recorded default is checked and **clamped** (D12)
— the default in force is "no reference-header reads; constants from the restated ABI", the carve-out
travels as the OPEN option — the handover carries that constraint plus the OPEN decision (D13), passes
the write-time check precisely because OPEN is consistent (D14d), and P03 plans against the clamped
wall *even if the person never looks*. When the person does answer — at P02's close in the log, or at
leisure in the round report — a "yes, allow header reads" lands as pack-amend plus re-plan, a "no"
closes the question. The verdict line, had anything still blocked, would have named the handover
(D14c) — and Part I would have made the fix one `Choice:` line.

## §12 Explicitly not

- No persistent in-target copy of the mode brief (D3): injection is always current; a copy is a drift
  surface. MANUAL.md and the remediation records are the person-facing artifacts.
- No remediation may touch driver-exclusive state (index ticks, todo→done renames, `.auto/units.json`)
  — those flow only through the existing transitions.
- No autonomous remediation without a per-round mark; no budget carry-over between blockages.
- No pack-grammar accommodation: a `pack-amend` that breaks the guarantees grammar fails the next
  preflight and blocks with the grammar problem — the charter's validation is not relaxed for
  remediation.
- No widening of the diagnosis session into an actor: read-only tools, strict parse, the executor
  ignores everything outside the format; no verdict is ever taken from the diagnosis session's
  self-report (completion stays gate-earned, plans/0044 §3).
- Not a general "fix anything" agent: the executor's move set is the channel table (§5); anything else
  is `advice` text for the person.
- No prevention check ever *replaces* the composition-time gate: D12/D14 add earlier checkpoints, and
  the 0080 verifier at planning composition keeps running unchanged — prevention narrows the funnel,
  it does not shorten it.
- No relaxation of the provisional-default protocol: D12/D13 change *which* reading is in force (the
  charter-consistent one) and *how* the question travels (OPEN, never consumed as closed), never the
  question's provisional standing — the person's answer is still the only thing that settles it.
- No per-phase full user reports: 0081 D1's one-per-round stands — the clamp removes the correctness
  need for an earlier cadence; the phase-close log line and the round report's needs-attention section
  carry the flagged questions. (Nor does the report task gain checking duties: checks are the
  driver's, mechanically; the report remains a distiller with the person as its reader.)
- No charter rewrites by the driver: D11's boundary sentence lands in the shipped bundle's template
  (a core change, reviewed like any code) and in existing targets only through the person's pack-amend
  — remediation never edits a charter silently, even a flawed one.

## §13 Test surface

- The span locator: located / unlocated / paraphrased-evidence cases; the corrected block line's file
  naming (a golden for the incident).
- The diagnosis session through the agent-fake double (MA.6): parsable plan, unparsable → fail-closed
  static message, Escalation outcome, read-only charter; the 13-call coverage rule extended if the
  session uses a client call the suite has not exercised.
- The remediation plan parser: option/edit grammar, mutually exclusive sections.
- The executor's write ratchet (the `chain-writes` pattern): zero target writes outside the enumerated
  edit spec + the documented commit stages; old-span mismatch → re-block; mid-sequence commit failure →
  partial-state block.
- Prelude row routing: mark present/absent/executed; the two-consecutive-reblocks suspension; the kill
  switch returning today's exact behavior.
- Prompt-template tests for `_mode-brief` and the diagnosis template; import-direction table entries
  for the new module(s).
- Part II: the shipped charter's boundary sentence (a golden for the cleanroom bundle's `verify-plan`
  text); the record-time default check (agent-fake: charter-consistent default passes silently,
  charter-touching default flagged) and the clamp (the flagged default is re-recorded with the
  charter-consistent reading in force and the wider grant as the OPEN option, then carried OPEN); the
  handover collect lint (an AUTO-RESOLVE marker under "Constraints and pitfalls" is a collect
  problem); the write-time handover check (fail-closed after one re-distill); the verifier template's
  judging rule (an OPEN default judged consistent, the same grant as settled constraint judged
  inconsistent — both directions pinned by goldens); the verdict line's location enumeration naming
  handovers.

## §14 Stages

Prevention first (review's ruling): the stages below are ordered by prevention value per unit of
machinery, not by the order the parts were designed in.

- **M1 — prevention (D11–D14)**: the charter boundary sentence in the shipped bundle, the authoring
  rules, the record-time default check with phase-boundary surfacing, the distiller status protocol
  with its collect lint, the write-time handover check, the admission warn for planning inputs, and
  the verifier template's two fixes (location enumeration, OPEN-judging rule). Small, mostly template
  and prompt surface; each piece independently shippable, D13+D14d landing as a pair.
- **M2 — the dossier and the honest block line** (D1/D2): mechanical, no sessions, no new surfaces;
  ships the incident's UX fix alone and feeds every later stage.
- **M3 — the full detached remediation loop** (D3–D8, D10 v1): mode brief, diagnosis session,
  remediation document, mark, prelude executor, caps and switch.
- **M4 — the interactive fast path** (D9).
- **M5 — coverage extensions** (D10 v2): per class, each justified by a real incident record.
