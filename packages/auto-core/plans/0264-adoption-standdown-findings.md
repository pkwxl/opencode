# 0264 — The adoption site's stand-down findings (the estate's second day)

Status: **findings record, 2026-11-19 (evening).** The stand-down session at
the adoption site — the igb transfer advance driven through the person
brackets to the P02 formulation review seam (T-006's todo awaiting review),
the squashfs 0263 replay completing end-to-end, three daemon restarts, and
the T-005 recall landing a proper failed report. Under that load the evening
surfaced six tool-branch findings, each adjudicated against the corpus
below: two **design silences at seams the day's own machinery exposed** (the
daemon's environment — the load-bearing carrier nothing pins; the advance's
own writes orphaned at the next run's gate), one **design silence with a
named standing precedent** (person remedies the executor isolation walk
refuses — the wall's own person-amendment class the mirror), and three
smaller silences/polish (the version fingerprint, the rotation-during-report
ambiguity, the token CLI's stdout mixing). The supervisor's report also
carried one item whose every tool-side surface **held as ruled** (the
refresh × the wall door — site-side, recorded below) and the operator
runbook items. This document rules nothing (0165's neutrality: findings
carry `measures`, never dispositions) and lands no code, no template, no
test. It is the third field record under 0255's incident instrument, the
exposure denominator named per that review's honesty rule: one adoption
site, bring-up day 2 (0257's bring-up day, 0262's run, this evening), zero
days of release exposure.

Derives P19 (a measured field record — every locus cited from the run logs,
the lane trees, the coordinator state files and the code; the classification
itself a measurement, the corpus grepped for any ruling carrying each
behavior), P18 (the record a plain corpus document, recorded findings the
only evidence channel), P8 (every finding names its remedy family, its
classification, and the residual the eventual fix ruling must settle —
detection recorded, nothing enacted, every line teaching its remedy). Amends
none — 0162 D4, 0189, 0149, 0132 D2, 0248, 0261 and 0263 are cited as
measures, not challenged.

## Category scope

Tier: record — no code, no template, no vocabulary act; the fixes, when
directed, each land as their own ruling per 0123/0110 D13 (code home and
test home named in the same change). The findings span two packages of the
one branch (auto-core and auto-server — 0067/0160/0162's rows the precedent
for auto-server homes in this corpus).

Premises this ruling changes: none — a record premises nothing. Re-read in
this change: 0162 D4 (the confinement launcher's env letters — the launcher
owns the overlay, the daemon's environment the carrier read by name),
0189 (the interrupted wall retirement's finisher letters — "the advance
itself finishes"), 0149 (the resumed run's active-progress exemption),
0132 D2 (the sealed channel's person-amendment exception), 0248 (the
executor response envelope and the report vocabulary), 0261 (the `protocol:
1` ruling, ahead of its enactment), 0263 (yesterday's fix, its production
arc this run's first field-evidence row) — all stand.

## The run shape (measured)

The evening's igb chain, from the run logs and the tree: the wall-door
refusal (`run-2026-11-19_14-56-21.log` — the door `linux` present again
over the sealed wall `88b4d63`), the clean-gate refusal naming the
uncommitted door (`15-01-13`), the person's recorded removal (`d66197f`),
the handover advance (`15-02-36`: the session, then `✓ git commit (.):
PLAN handover P01-survey Survey` = `7def06f`, then the interrupted
retirement finished, then the divergence lane and the admission-scan
block), the orphaned-write refusal (`15-08-01`, run-000004), the person's
hand-completion (`5306a21`), and the green re-run (`15-10-18`, run-000007:
divergence green, brief install `8e17cfd`, transition `e1bb5f9`, formulate
`9418038`) parking exactly at the review seam. On squashfs the 0263 replay
ran to completion (below). Three daemon restarts rode the evening, each
surfacing a new lost environment carrier. The T-005 child was recalled with
a `failed` report landing. The reporting channel is the supervisor's
stand-down summary; every finding below is reconstructed from the run logs,
the lane trees, the state files and the code, independently of that
narrative. The supervisor's item numbering maps: 1→0264-01, 4→0264-02,
2→0264-03, 5→0264-04, 7→0264-05, 6→0264-06; item 3 (the refresh × the
wall) and item 8 (the runbook) adjudicate site-side — the estate-side
section.

## The classification method

The corpus's own test, applied per finding: 0165-review/CONTRACT — grep
the corpus for the behavior; a deliberate ruling is not a defect. Greps
over the daemon family (0067, 0160, 0162) for `environ|env manifest|env
file|carrier` → 0162 D4's launcher letters and the README's hosting line,
nothing pinning or checking the daemon's own environment across restarts;
over the wall family (0132, 0155 D2, 0189, 0190) for `retire|interrupted
retirement|finish` → 0189's finisher letters (the advance the finisher's
one home) and the failed-close remedy's "re-run the same command", nothing
recognizing the orphaned write at the next run's gate; over the executor
family (0246–0263) for `person commit|person amendment|amendment` → zero
hits (the wall's 0132 D2 exception the only person-amendment class in the
corpus); `protocol|version|fingerprint` → 0261's ruled-not-enacted menu
block alone, `version.ts` carrying no build identity; `rotat|settled
holder|terminal` → 0248's envelope and executor.md's lost-response letters,
nothing for the settled holder's shape; `token issue|--out` → the CLI's
shown-once letter alone. 0166's vocabulary throughout.

## 0264-01 — the daemon's environment, the load-bearing carrier nothing pins

- **sev** S2 · **conf** CONFIRMED (three restarts, each surfacing a new
  lost carrier; the losses in the run logs) · **cat** P12
- **measures** 0162 D4, P8, P12, P19
- **loc** `packages/auto-server/src/daemon.ts:538-541` (the spawn
  environment — `process.env` minus the switch layer, the whole carrier
  passed by inheritance), `packages/auto-server/src/index.ts:470` (the
  serve banner's own line: "the daemon's environment is the carrier the
  launcher reads"), the `serve` usage surface (`--port/--host/--data-dir/
  --launch/--open/--root` — no environment input), the model registry's
  reference resolution (`{env:NAME}` keys, the security family's own
  grammar) surfacing in the worker children only
- **evidence** restart 1 lost the model keys — `transfer-igb-3.log`
  (`run-2026-11-19_14-59-02`) carries four registry warnings
  (`models.k3.keys[0]: env K_KEY_1101 is not set`, and k3[1], glm[0],
  glm[1] — every key of two registry profiles unreachable); restart 2 lost
  the seat carrier — the divergence admission scan's block
  (`15-02-36.log`): "divergence-scan: no scan entry provisioned: export
  the seat variable ASTER_CR_DIVERGENCE_SCAN … or write the entry path
  into the seat file .config/aster-cr/divergence-scan.seat … or provide
  divergence-scan on PATH" — `compliance/bin` gone from PATH, a blocked
  person-bracketed advance the direct cost (and the trigger of 0264-02's
  orphaned write in the same run). Each gap surfaced one run at a time,
  never at boot.
- **impact** the daemon is the estate's resident host by design (0162's
  own hosting letter: it lives where nothing reaps it), and every restart
  re-derives its environment from the launching shell's memory — the
  day's dominant operational cost, and unrecoverable-by-construction: no
  surface records what the carrier held.
- **classification — design silence.** 0162 D4 ruled the launcher's
  ownership ("key env forwarded by name from the daemon's environment")
  and the README the hosting posture, but no ruling manifests, pins or
  checks the carrier itself; the boot is silent about its own inputs.
- **remedy family** a startup environment manifest (names and presence
  only, never values — the security family's display rule) with a boot
  self-check over the tool's own references (the registry's `env:`/`file:`
  keys resolvable at boot, the gaps surfaced as startup warnings naming
  the reference, P8), plus `serve --env-file` so a restart re-derives the
  carrier from a durable file rather than the launching shell; the seat
  preference (the persistent seat file over env) already taught by the
  block's own text — the site's contract, the record noting the alignment.
- **prior** NEW
- **design residual** the check's boundary (P16: the tool checks the
  references it owns; the site's seat names ride the site's own declared
  surfaces) and the manifest's shape — the fix ruling's letters.

## 0264-02 — the advance's own writes orphaned at the next run's gate

- **sev** S2 · **conf** CONFIRMED (the full chain in the run logs and the
  tree) · **cat** P20
- **measures** 0189, 0149, P6, P8, P20
- **loc** `src/wall.ts:487-491` (the interrupted-retirement finisher —
  `retireAndDeny` writing the tracked `opencode.json`), `:727` (its only
  `finishStamps` caller, `wallBoundary` — the advance's handover path),
  `:691-698` (the failed-wall-commit arm teaching "re-run the same
  command"), `src/loop-preflight.ts:725` (the run-start clean gate's
  refusal — "handle them manually (commit or clean) and re-run"),
  `src/transfer.ts:48` ("the advance runs only on a committed" tree)
- **evidence** the measured chain: `15-02-36` (run-000003) ran the
  handover — `✓ git commit (.): PLAN handover P01-survey Survey`
  (`7def06f`), then `↻ finishing the interrupted wall retirement: the
  driver-stamped allow(s) /workspace/aster-mig-root/cleanroom/compliance/
  corpus/v6.12.103-25c09b42358e/** retired, the standing deny re-asserted`
  (the retirement write into the tracked `opencode.json`) — then blocked
  at the wall admission scan (the divergence seat, 0264-01's carrier loss)
  and exited with the write uncommitted; `15-08-01` (run-000004) refused:
  "the worktree has uncommitted changes; to ensure execution units start
  on a clean baseline, handle them manually (commit or clean) and re-run:"
  → `opencode.json`; the person completed it by hand (`5306a21` "person:
  complete the interrupted wall retirement write — the corpus
  external_directory entry re-asserted deny (allow retired), the standing
  wall posture 88b4d63 keeps"); `15-10-18` then ran green to the review
  seam.
- **impact** the tool's own write, orphaned by the tool's own blocked
  advance, escalates to a person hand-commit — and the two remedies the
  corpus does rule for this shape both sit behind the gate doing the
  refusing: the finisher lives in `wallBoundary` (reached only by an
  advance), and the failed-close arm's "re-run the same command" is
  refused by the same clean gate (a transfer re-run is a run start).
  0149's resumed-run exemption keys on an active unit progress record —
  a blocked advance carries none; the driver-state self-heal family covers
  untracked workdir files only, and `opencode.json` is a tracked project
  surface.
- **classification — design seam (a ruled mechanism unreachable for its
  own shape).** 0189's letters are faithful — the precheck deliberately
  passes `finishStamps: false` ("the advance itself finishes") — but the
  advance's own blocked exit is the one interruption shape that orphans
  the write ahead of the gate the finisher needs to pass. The letters
  never met the ordering.
- **remedy family** preflight (or the transfer re-entry) recognizing and
  finishing the tool's own interrupted advance writes — the retirement
  re-derivable and the finisher idempotent (P6, the same
  `wallPrecheckFindings` classifier already deriving the stamp shape), or
  at minimum the gate's refusal naming the tool's own write and its
  one-command recovery where the classifier recognizes it, in place of
  the generic manual line.
- **prior** NEW (0189's finisher the standing design; 0149 the exemption
  family it never joined)
- **design residual** the recognition letter — which writes the gate may
  finish (the retirement's stamp shape the derivable one), and the
  composition with 0149's unit-progress exemption.

## 0264-03 — person remedies the executor isolation walk refuses

- **sev** S3 · **conf** CONFIRMED (the wire shape in code; the field
  incident reported and reverted) · **cat** P2
- **measures** 0248, 0249, 0250, 0132 D2, P2, P7
- **loc** `src/executor-coordinator.ts:1152-1159` (the isolation blocks —
  "The landed share lacks durable producer provenance" /
  "The recorded execute share no longer matches Git history", the
  `knownHead` booking witness), the settle per-root proofs behind them;
  the named precedent `src/wall.ts:403-428` (`sealedChannelCheck`: a
  driver commit on a sealed path the violation, a person commit the
  recorded amendment class, `driverStage(body)` the classifier)
- **evidence** the person decision on question `d17366a8` (squashfs
  `.auto/executor-questions.json`): "The operator applies the one-line
  removal as a housekeeping commit, then T-004 verify settlement resumes
  on a successor claim" — an operator commit outside any settled share,
  the channel's own recorded remedy; and the supervisor's own direct
  `.gitignore` commits in the lane repos wedging both lanes at the
  isolation gate until reverted (the stand-down report's item 8, the
  runbook record below). The state machine accepts person acts on a lane
  only as answers and releases (0250's vocabulary); every other commit is
  divergence the witness checks refuse terminally — HEAD never goes back.
- **impact** the question channel can teach the person an act the machine
  will refuse — P2's escalation ladder pointing off the cliff. The
  remedies are child-authored freeform (P7: the tool never polices their
  content), which is exactly why the machine's acceptance vocabulary and
  the channel's teaching must agree somewhere.
- **classification — design silence with a named standing precedent.**
  0248/0249's isolation letters assume every write rides a settled share;
  the executor-family grep for a person-amendment class is zero, while
  0132 D2's sealedChannelCheck established exactly that class for the
  wall's frozen channel — bounded, recorded, visible in the diff against
  the wall commit.
- **remedy family** either arm, composable: the isolation walk
  recognizing a person-amendment commit class (mirroring
  `sealedChannelCheck` — the same `driverStage` classifier separates a
  person commit from a session's, the amendment logged and the witness
  re-based past it), or the executor-side teaching naming the accepted
  act vocabulary (executor.md's question letter: answers and releases the
  person's lane acts, a direct commit never one) so the channel stops
  offering what the machine refuses.
- **prior** NEW (0262-03's escalation seam adjacent — that finding the
  blocked settlement's ladder, this one the ladder's top rung)
- **design residual** the amendment class's recognition grammar (the
  executor lane's commit stream has no person signature today; the wall's
  `driverStage` classifier is the fit) and the bounded-ness letter (which
  acts qualify, how they are surfaced to the next holder).

## 0264-04 — no tool identity on the wire (the stale-daemon skew invisible)

- **sev** S4 · **conf** CONFIRMED (the misdiagnosis reported; the wire
  carrying nothing — grep zero) · **cat** P12
- **measures** 0248, 0261, P12, P13
- **loc** `packages/auto-server/src/version.ts` (`VERSION = "0.0.0"` the
  binary's whole identity — no build commit anywhere), the executor
  response envelope (0248 — kind/reason/detail, no identity field), the
  wire today (0261's `protocol: 1` ruled ahead of its enactment; nothing
  carries a version)
- **evidence** the stale-daemon diagnosis: squashfs T-004's first
  `commitFailed` block taught a producer formatting fault (the remedy
  family 0262-01 records) while the cause was the daemon running pre-0263
  code — the skew discovered by the operator reading the tool's git logs,
  not by any surface the protocol owns.
- **impact** daemon-vs-repo skew is the adoption site's standing shape
  (a resident daemon across tool rebuilds, by 0162's own hosting letter);
  today it is invisible at every blocked step and diagnosed by archaeology.
- **classification — design silence.** No ruling carries a build identity
  on any wire surface; 0261's protocol field is the ruled-but-unenacted
  neighbor.
- **remedy family** a version fingerprint (the protocol number plus the
  tool build identity) on executor responses — additive (P13), the
  `VERSION` constant's build-stamp mechanism the carrier pattern (a
  compiled binary cannot read the manifest; the constant is what ships),
  the consumer named from the field: the operator's skew diagnosis at the
  first blocked step.
- **prior** NEW
- **design residual** the carrier letter — which responses carry it
  (0261's ready-menu protocol block the natural home; per-response
  carriage the extension to word against P13's frozen-envelope letter).

## 0264-05 — rotation-during-report: the settled holder cannot tell acceptance from rejection

- **sev** S4 · **conf** CONFIRMED (both children's reports in the run;
  the wire shape in code) · **cat** P13
- **measures** 0248 (the envelope, the report vocabulary), 0261
  (holder fungibility), P2, P13
- **loc** `src/executor-coordinator.ts:1161-1162` (the same-token
  verification wait — "Verification requires a different token from the
  execute share's producer." — the only line a settled producer's channel
  sees), `prompts/executor.md:31` (the lost-response letters: a lost
  claim recovered through `menu.leases`, a lost report retried with its
  original pair — the settled holder's terminal shape unruled)
- **evidence** both reporting children saw the verification-gating line
  at share rotation, unable to distinguish "accepted; the share rotated —
  this token's work on the unit is done" from "wrong token, cannot
  report" — executor.md's lost-response letters do not cover it: a lost
  report is retriable, a rotated share is terminal for the holder, and
  the one wait line answers both.
- **impact** a well-behaved holder's clean exit depends on reading intent
  into a wait — the wrong reading (retry the report, poll forever, mint a
  successor itself) is exactly what the ambiguity invites.
- **classification — design silence.** The envelope, the gating rule
  (token-distinct verify) and the lost-response letters are all ruled;
  the settled holder's shape is not.
- **remedy family** a distinct terminal shape for the settled holder (the
  booked evidence named — the report landed at its commit; this token has
  no further claim on this unit), or the menu carrying the settled
  lease's booking for the stale holder — vocabulary additive, the wait
  line unchanged for every live holder.
- **prior** NEW
- **design residual** the shape's wording only (0261's fungibility
  letters already make rotation the operator's act; the surface states
  what already happened).

## 0264-06 — the token CLI's stdout mixing

- **sev** S4 · **conf** CONFIRMED (the output shape in code; the wrong-
  line grab reported) · **cat** defect (plain)
- **measures** P8, the security family's display discipline
- **loc** `packages/auto-server/src/index.ts:358-363` — three stdout
  lines: the ✓ status line, then the credential, then the shown-once note
- **evidence** the first mint grabbed the status line for the credential
  (revocation made it recoverable — the store keeping only the digest
  worked as designed).
- **impact** one clipboard error per incautious mint; small, but the
  credential is the one line of the three a script cannot re-derive.
- **classification — plain defect** (no ruling prefers the mixing).
- **remedy family** `token issue --out <file>` — the credential written
  0600 direct to the file, the status and shown-once lines unchanged on
  stdout; the shown-once letter untouched.
- **prior** NEW · **design residual** none.

## Field evidence for standing rulings (no findings)

- **0263 held end-to-end in production.** squashfs T-004's full arc in
  the tree: `cab961f` exec 1 → `8d48782` verify 1 force-landing the
  shadowed `docs/T-004/gaps.md` (173 lines, the `.gitignore` entry still
  in force at line 7) → `e38a13b` fix 1.1 (the fix round deriving from
  the landed input exactly as 0248 D5 words) → `b84790b` verify 2 PASS →
  `2980649` done with the gap list retired through the ordinary tracked
  deletion (`ls-files` clean of it). The parked verdict class of 0262-01
  unblocked exactly as the ruling words — the ruling's test arc and the
  field arc the same shape. P3/P4/P19 measured.
- **The advance surface earned its keep.** The whole igb chain — the
  door's recorded removal, the handover, the divergence lane, the brief
  install, the transition, the formulate stop at the review seam — rode
  the daemon-side transfer op with the interactive transport, each
  person bracket a clean park point (T-006's todo the standing one).
  The `d17366a8` answer arrived through the daemon-person questions
  delegation; scoped `person-releases` tokens minted per need and
  hot-reloaded — 0250's delegation letters working at the site.
- **The recall landed as designed.** squashfs T-005's booking:
  `{"outcome": "failed", "note": "operator stop order — T-005
  consolidation halted mid-work by the daemon; partial state on disk for
  the successor", "receipt": {"kind": "without-landing", "reason":
  "failed"}}` — the failed-report vocabulary (0248) recording the recall,
  a successor free to re-claim or the lease expiring harmlessly.
- **The bridge reconnected through every restart.** Three daemon
  restarts, zero child-visible impact on the live executor sessions —
  the worker auto-reconnect holding.

## Estate-side context (recorded for completeness, not tool findings)

- **The refresh × the wall door (the supervisor's item 3 — every
  tool-side surface held).** The site's project skeleton/refresh flow
  (`cleanroom/bin/mkproject.sh` — the `linux` symlink in the skeleton,
  the `Wall: seal linux` door fill at `:78`) reinstalled the door
  **uncommitted** over the sealed wall `88b4d63`; the tool caught it
  twice, correctly, with its remedies taught — `wallOpenFindings`'s
  reachable-door finding (`14-56-21.log`: "the door linux that wall
  commit 88b4d63 removed is present again — a reopen is a person's
  recorded act") and the clean gate's refusal of the uncommitted door
  (`15-01-13.log`) — and the person's removal (`d66197f`) is exactly the
  recorded act the wall's letters name. The defect is the site's flow
  reinstalling over a wall record it never consults; the fix (refuse or
  record the reopen) is the site's, recorded here for the denominator.
- **The operator runbook rule (the supervisor's item 8).** Never commit
  directly in a cleanroom lane repo — every change routes through a
  settled share or a person act the machine records. The incident behind
  it (direct `.gitignore` commits wedging both lanes at the isolation
  gate until reverted) is 0264-03's field evidence; the rule is the
  site's runbook, the machine-side half the finding above.
- **The `d17366a8` journal reconciliation.** The recorded decision
  ("Drop the /docs/T-*/gaps.md ignore rule; the driver's FAIL landing
  stays as-is") holds a mechanism that never happened — the entry is
  still in force (`.gitignore` line 7 unchanged), the actual unblock was
  0263 plus the daemon restart, and 0263's ruling makes the rule-drop
  optional either way. The person's one-line reconciliation note at the
  next journal review closes it; no tool surface tracks decisions-acted
  versus decisions-recorded (correctly — the journal is the person's).
- **The prompt-audit floor fallback.** igb `docs/R-01/prompt-audit.md`:
  "formulation R-01.P02 synthesis: FALLBACK — the reply carries no
  ledger block … the floor carries the charter on the Acceptance" — the
  deterministic floor working as designed, the record already on disk
  (the E0 records family: state readable from the tree, the report's
  rows catching up).

## Disposition

No `by-design` disposition applies to 0264-01, 0264-02 or 0264-03
(seams and silences, never rulings); 0264-04 and 0264-05 are design
silences on ruled envelopes' edges; 0264-06 is a plain defect. The
pattern this evening differs from both prior records: 0257's findings
were code inventing constraints in design silence, 0262's the seams
between standing rulings — this run's are the **operational carriers**
(the environment, the advance's own writes, the person's lane acts)
that the ruled machinery presumes without pinning. The two S2s are
causally linked in the evening's own chain (the carrier loss triggered
the blocked advance that orphaned the write); a fix program would
naturally take them together. The site's suggested order (env → wall/
orphans → remedies → fingerprint → polish) matches this record's
severity reading once its item 3 is read site-side. Fixes land only
when directed — each its own small ruling per 0123/0110 D13, code home
and test home in the same change.

## Tests

None land — the record changes no code. Form checks at the landing tree,
0262's pattern: auto-core `bun typecheck` exit 0; the four reconciliation
suites green over the new INDEX row (docs-registers, constitution,
constitution-ratchet, docs-truth, release-due). The INDEX row is this
document's only companion change.
