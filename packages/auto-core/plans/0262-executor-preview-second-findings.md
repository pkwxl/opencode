# 0262 — the executor preview's second field findings (the four-lane adoption run)

Status: **findings record, 2026-11-19.** The executor coordinator run in
anger at the adoption site — four projects registered (erofs, igb, squashfs,
baseline; `projects.json`, all 2026-11-19T05:47Z), roughly twenty shares
across three lanes through the evening, every recovery path the protocol has
exercised at least once and every one of them working. Under that load the
run surfaced five findings, each adjudicated against the corpus below: one
**premise drift between standing rulings** (the first design-class finding
this family has produced — the code faithful to every letter, the letters
colliding with each other), two **design silences** (ruled envelopes with an
unruled seam beside them), one **by-design residual with live evidence for
an already-ruled direction**, one **by-design target-side**. This document
rules nothing (0165's neutrality: findings carry `measures`, never
dispositions) and lands no code, no template, no test. It is the second
executor-protocol incident record under 0255's incident instrument, the
exposure denominator named per that review's honesty rule: one adoption
site, one day of bring-up follow-on (0257's bring-up day plus this run),
zero days of release exposure — evidence of incompleteness at the seams
between architectures and rulings, never a verdict on the direction.

Derives P19 (a measured field record — every locus cited from the lane
trees, the state files and the code; the classification itself a
measurement, the corpus grepped for any ruling carrying each behavior), P18
(the record a plain corpus document — the no-telemetry instrument 0255
pinned, recorded findings the only evidence channel), P8 (every finding
names its remedy family, its classification, and the design residual the
eventual fix ruling must settle — detection recorded, nothing enacted,
every line teaching its remedy). Amends none — 0245, 0248 D5, 0249, 0250
are cited as measures, not challenged; 0262-01 names a collision *between*
them, which is 0167's register, not a fault in any one letter.

## Category scope

Tier: record — no code, no template, no vocabulary act; the fixes, when
directed, each land as their own ruling per 0123/0110 D13 (code home and
test home named in the same change).

Premises this ruling changes: none — a record premises nothing. Re-read in
this change: 0245 (the ignore set's grammar and writer), 0248 D5/D1, 0249
(both fence letters), 0250 (the person-item letters), 0260, 0261 — all
stand; 0262-01 records that 0248 D5's artifact-path premise and 0245's
ignore-set premise occupy one path grammar without reconciliation, the fix
ruling's own premise-guard line to state.

## The run shape (measured)

Three lanes worked (igb, squashfs, erofs; baseline registered and idle).
The protocol's whole recovery family ran live and held: the per-root
settlement over the nested `asterinas` repository (`Auto-Nested` trailers
on the settle commits, 0258), the restored fence admitting declared
artifact-role writes (0259 — evidence.md and testhands/ landed as ordinary
task work all day), token-distinct verify gating every unit, the
FAIL→fix→re-verify loop closing igb T-004 in one bounded hunk, a
lost-claim re-claim on erofs, gate waits delivered rather than discovered
on igb, and one question raised through the person channel. Zero write-
perimeter violations across all shares. The reporting channel is the
supervisor's session record
(`/workspace/aster-mig-root/supervisor/sess_672cb8a1-…zcode-session`);
every finding below is reconstructed from the lane trees, the coordinator
state files and the code, independently of that narrative.

## The classification method

The corpus's own test, applied per finding: 0165-review/CONTRACT — grep
the corpus for the behavior; a deliberate ruling is not a defect. Greps
over 0246–0261: `gitignore|ignore set|ignored` → 0249's two fence letters
(the perimeter inspects "non-ignored untracked paths"; "porcelain alone
cannot attest to ignored files… those surfaces remain forbidden by the
write contract"), 0255's dating of 0245 (2026-11-18), 0247's release-table
row (incidental) — nothing reconciling an ignored path with a per-kind
artifact path; `eof|terminator` → zero hits in the executor family;
question wiring → 0249's `wait question` (the pending-item arm, 0249 §D)
and 0250's raise letters (the holder's own act) — nothing wiring a blocked
settlement to the channel. 0166's vocabulary throughout; 0167's premise
guard where a finding's root is cross-ruling drift.

## 0262-01 — the FAIL verdict unlandable where the gap list's path is ignored (the settlement × ignore-set collision)

- **sev** S2 · **conf** CONFIRMED (reproduced on the target and measured in
  a scratch repository) · **cat** BOUND
- **measures** 0248 D5, 0249 (both fence letters), 0245, P3, P4
- **loc** `src/executor-coordinator.ts:749-766` (the verify verdict keys on
  `paths` from plain `git status` — an ignored gaps.md never appears, so a
  FAIL answers the format error at `:765`), `:789` (`git add -A` staging —
  refuses an ignored pathspec), `:733-734` (the fix branch's `ls-tree`
  guard — "The landed fix input is missing from Git."), `workspaceStatus`
  feeding all three
- **evidence** the four `.gitignore` states: squashfs line 7
  `/docs/T-*/gaps.md` (from `57395dc` "PLAN housekeeping ignore set",
  `Auto-Stage: housekeeping` — 0245's own write); erofs line 9 (the same
  entry with 0245's comment verbatim, landed *inside an executor settle
  commit* — `072978c` "T-057 exec", `Auto-Stage: execute`, beside the
  share's evidence.md and testhands/); igb and baseline carry no such rule.
  On squashfs the parked FAIL sits on disk right now: `docs/T-004/gaps.md`
  (a format-valid three-gap list, `Result: FAIL`) answers `!!` under
  `git status --porcelain --ignored` and nothing under plain status — the
  tree the settlement reads is clean. The scratch-repo measurement:
  `git add -A -- <ignored path>` refuses ("The following paths are ignored
  by one of your .gitignore files… Use -f", exit 1). The escalation is the
  verify child's own raise, question `d17366a8` in squashfs
  `.auto/executor-questions.json`, quoting the blocked detail verbatim and
  naming both remedy arms — the person's decision still pending there.
- **repro** observed at the adoption site, squashfs T-004 (parked
  `blocked / commitFailed`); erofs carried the same exposure silently (its
  FAIL moments preceded the entry or went idle first).
- **impact** on a target whose `.gitignore` holds the path, no FAIL verdict
  can land — the verdict's single git-status change never exists — and no
  fix round can derive (the landed input's `ls-tree` is empty). A whole
  verdict class unlandable, discoverable only by a verifier reasoning
  outside its perimeter.
- **classification — premise drift between standing rulings (0167's
  register).** Not implementation drift: the code follows each letter. 0249
  rules the perimeter's porcelain blind to ignored paths and those surfaces
  forbidden; 0248 D5 rules `gaps.md` the verify FAIL artifact that
  settlement lands as durable evidence (the code's own comment beside it:
  "The old gap list is already durable in the verification commit"); 0245
  (a day older) holds exactly that path grammar ignored in any target the
  manual suite has run a fix round in — and 0255 kept the suite standing as
  the no-server floor beside the executor path. One path grammar, two
  lifecycles (transient-never-committed vs landed verdict evidence), no
  ruling reconciling them; the entry's presence is incidental to target
  history (two distinct writer families measured landing it), so the
  executor path must tolerate it wherever it finds it.
- **remedy family** (the finding's, for the fix ruling to cut): the
  settlement stages the protocol's own per-kind artifact names
  force-added, or reads them `--ignored`-aware — the concession confined
  to the per-kind artifact paths, 0249's forbidden-ignored-surface letter
  standing untouched for everything else; or the executor era owns the
  entry (0245's write is driver state — the tool may manage it where the
  executor path lands gap lists); beside either, registration/serve lints
  `.gitignore` for rules shadowing protocol-landed artifact paths, a
  pending item teaching the one-line person remedy (the question's own
  first arm).
- **family** the PASS arm is unaffected (report.md is not ignored anywhere
  measured); the fence itself (0259's restored set) is not implicated —
  the collision is upstream of it, in what the settlement can observe.
- **prior** NEW (0257's three were code inventing constraints in design
  silence; this is the design colliding with itself).
- **design residual** the fix ruling states `premises this ruling changes:
  0245` (re-reading 0249's second letter in the same change) and words the
  gap list's lifecycle per architecture on the one path grammar — the
  reconciliation letter, whichever arm is cut.

## 0262-02 — the child-held heartbeat reaped mid-run; the lease rollover benign same-channel

- **sev** S3 · **conf** CONFIRMED (the child's own handoff record, the
  coordinator's progress entry) · **cat** GEN
- **measures** 0248 D1, 0249 (recovery), 0260, 0261, P20
- **loc** the heartbeat's holder side (`src/executor-coordinator.ts`
  renewal — `holder`-bound per 0261's confirmed model); the grant record in
  erofs `.auto/executor-progress.json` (grant "T-061 exec 4", `attempt: 2`,
  `budget: 60`, `deadline = issued + 65 min` — the 0260 relations at their
  defaults, live)
- **evidence** erofs `docs/T-061/handoff.md`, "Notes for the successor":
  "the first heartbeat loop died ~20:50 with its grant; the re-claim on the
  same channel took attempt 2 of the same step — the writes between the
  expiry and the re-claim are the E-X-07 tombstone, the c7b chain, the
  attempt-7 receipt and the attempt-8 launch, all inside this step's own
  scope and continued under attempt 2's grant." The environment reaped the
  child's in-session `sleep`-loop heartbeat roughly two hours into a step
  against the 60-minute default budget; the recovery worked exactly as
  designed (re-claim, same channel, the successor continuing the
  predecessor's in-scope writes).
- **impact** none this run — but only because successor and predecessor
  were the same session. The writes between expiry and re-claim are
  precisely the zombie-writer residual class (0248 D1), benign by
  coincidence of channel, not by mechanism.
- **classification — by-design residual, evidence for an already-ruled
  direction.** The recovery letters held (0249); no ruling carries a
  durable heartbeat today — a session-internal background loop is not one,
  and this run measured it failing. The hub-held shape is ruled as the
  confirmed interaction model (0261: long-turn children ride hub-held
  grants or the configured budget); Program W owning the heartbeat is 0256
  stage 3's letter.
- **remedy family** available today, no code: the `executorLease`
  declaration (0260) fitting the budget to the lane's real runway.
  Structural, ruled not yet enacted: the hub-held heartbeat (0261/0256).
  Per-lane budgets (the estate's Program W design §3.3) would amend 0260's
  single per-project key — a consumer-named amendment, not yet ruled.
- **prior** 0257-03 (the clock's configurability — its fix 0260 live in
  this run at its defaults, the declaration the site has not yet made).
- **design residual** none for the fix docket beyond the per-lane question
  — the finding is the field evidence the daemon slice cites.

## 0262-03 — a blocked settlement answer carries no escalation path

- **sev** S3 · **conf** CONFIRMED (the wire shape in code; the raise's
  provenance in the state file) · **cat** P8
- **measures** P2, P8, 0248 (the response envelope), 0249 §D, 0250
- **loc** `src/executor-coordinator.ts:64` (`BlockedReport` — `kind`,
  `reason`, `detail`, nothing else), `:765` (the verify branch's detail)
- **evidence** when T-004's settlement failed (0262-01), the coordinator's
  whole answer was `blocked / commitFailed / "Verification must write one
  valid PASS report or one countable FAIL gap list."` — a remedy for the
  wrong diagnosis (format), while the actual cause sat outside the child's
  write perimeter (`.gitignore`, fenced from it by the same contract). The
  person channel was reached only because the verify child raised
  `d17366a8` on its own judgment; nothing in the response named a ladder,
  and no replay could ever succeed.
- **impact** an unbounded blocked loop for causes outside the holder's
  perimeter, terminating at the person only by executor initiative — P2's
  "every automatic escalation is bounded and terminates at the person"
  met by accident, not by mechanism.
- **classification — design silence with a P2/P8 tension.** The envelope
  and its detail letters are ruled (0248) and the details do teach replay
  remedies; the greps find no ruling wiring a *non-replayable* blocked
  settlement to the question channel — 0249 §D's `wait question` is the
  pending-item arm, 0250's raise the holder's own act. The seam between
  them is unruled.
- **remedy family** a blocked settlement whose cause is outside the
  holder's permitted set auto-raises the question item (the channel, the
  dedup and the task-scoped guards already exist — 0250), or at minimum
  the detail names the escalation ladder.
- **prior** NEW
- **design residual** the fix ruling words the split: which blocked causes
  are replayable-by-holder (keep teaching the replay) vs person-necessary
  (auto-raise) — a small classification letter, not new machinery.

## 0262-04 — pending person items invisible to delegated reads

- **sev** S4 · **conf** CONFIRMED (the derivation and the claim path in
  code; the gate wait observed) · **cat** P8
- **measures** 0250 (items, scopes, content eligibility), P2
- **loc** `src/executor-coordinator.ts:421` (gate items derived with ids,
  documents, digests), `:431-432` (a questions-scoped claim finding no
  question answers `"No pending questions."` — correct per the scope
  letter), `:96` (the menu's `claimable` — the worker surface), the read
  surface generally
- **evidence** igb's survey release is real and waiting (the phase closed
  and verified through the whole autonomous chain; the survey document
  carries "the project brief proposal" its gate keys on —
  `docs/R-01/P01-survey/survey.md`; the executor-side gate wait names it),
  yet a `person-questions`-scoped read sees "No pending questions" and
  nothing else: correct per 0250's delegation letter (content disclosure
  gated to eligible channels), but no surface lists item *existence* —
  kind and id alone. The delegated attendant inferred the gate from
  gate-wait strings.
- **impact** delegated attendance (the run's own supervisor shape) cannot
  see what it is attending to; routing precision exists (the scopes) with
  no read surface to route by.
- **classification — design silence.** Item content scoping is ruled
  (0250), item enumeration is not — the greps find no ruling for a pending
  listing on any read surface. The consumer is named from the field (this
  run's delegated attendant), so this is not a consumerless surface (P21
  cuts the other way).
- **remedy family** expose pending items — kind, id, and for eligible
  channels the proposal — on the read surface; answering unchanged (P2:
  routing precision, never authority widening).
- **prior** NEW (0261's open consumer note named further consumed surfaces
  joining by their own consumers — this is one naming itself).
- **design residual** the surface's shape only (which fields, which
  scopes) — the fix ruling's letter, no mechanism beyond the derivation
  that already exists at `:421`.

## 0262-05 — the eof terminator's drift on producer deliverables

- **sev** S4 · **conf** CONFIRMED (the artifact tails measured) · **cat**
  target-side
- **measures** P7, `src/doccheck.ts:22-35`
- **loc** `src/doccheck.ts` (`endsWithEof`, `docShapeProblems` — the
  settlement's report check at `src/executor-coordinator.ts:756` requires
  the terminator on the verify PASS report); the deliverable documents
  themselves
- **evidence** the driver-grammar documents carry the marker and always
  did (igb T-002/T-005 and squashfs T-002 `report.md`/`done.md` all end
  `<!-- auto: eof -->`; the settlement checks it, `docShapeProblems`
  pushing "missing last-line terminator" as a shape problem); the
  producer-written freeform deliverables drift (igb and squashfs
  `enumeration.md`, `decisions.md` — no marker), and five of six verify
  shares burned verifier attention flagging it forward before adjudication.
  The verifiers judged rightly per their acceptance texts every time.
- **impact** recurring noise, no protocol loss — the acceptance system
  caught each instance.
- **classification — by-design (P7), target-side.** The terminator is the
  driver's mechanical grammar for the driver's own documents (checked
  exactly there, including at the executor settlement); freeform
  deliverables are the target's acceptance text's business, and no
  executor-family ruling carries a terminator expectation (the grep is
  zero). The drift is the site's generator discipline, not the tool's.
- **remedy family** target-side first (the acceptance text, the site's
  artifact generator). A tool-side mechanical append at settlement would
  have the driver writing into documents whose grammar it does not own —
  an amendment to P7's write boundary a fix ruling would have to word,
  recorded here as the option, not the default.
- **prior** NEW
- **design residual** only the P7 question above, if the tool-side arm is
  ever directed.

## Field evidence for standing rulings (no findings)

- **Round boundaries person-gated everywhere (the run's dominant
  friction).** Three of four lanes ended at the person: igb's whole survey
  phase ran, verified and closed in one autonomous chain, then parked at
  the release; squashfs's forks wait; erofs stopped at the person's own
  order (the booking note verbatim: "person-directed stop at the
  attempt-8 PASS boundary"), its formal close-out remaining. The
  intra-round loop is solid; every round boundary forces the person back —
  P2 working as ruled, at its known cost. This run is the measured
  proof-of-pain behind the estate's recommendation to pull 0256 stage 2
  forward (releases and fork rulings as step kinds + person items); the
  priority call is the maintainer's, this record the evidence.
- **The two-arm + verify architecture earning its keep.** igb T-004's
  verify FAIL (one omitted one-sided anchor id — a producer's self-check
  miss) closed in one bounded fix hunk with a clean re-verify; squashfs
  T-004's FAIL (unlanded per 0262-01, but real) caught 30 silently
  resolved dependency-set divergences and self-contradictory ledger
  sub-counts. Both are fresh-context, token-distinct verifiers catching
  what the producer's own self-check missed — P3's letter measured.
- **The settlement-side perimeter is ruled machinery, held unexercised.**
  The observation "discipline held everywhere it wasn't enforced"
  measures the executors' prompt quality, not the tool: the fence letters
  (0249), the restored permitted set (0259) and the per-root proofs
  (0258) were in force the whole run and would have held any violation —
  zero violations means they went untested, not that they are missing
  (P21: no new machinery indicated).

## Estate-side context (recorded for completeness, not tool findings)

The supervisor's own records lagged coordinator state at the last pass
(19:02 holding person-gated rows the coordinators had already moved past) —
the estate's E0 amendment (the daily report reading coordinator state and
pending items as first-class rows) is the fix, estate-side. The external
executor sessions run prompt-bound only (`agent-sandbox.sh` confinement
wraps daemon-spawned runs, not them) — the site's own posture, named here
for the denominator's honesty.

## Disposition

No `by-design` disposition applies to 0262-01 (the collision is real and
unreconciled), 0262-03 or 0262-04 (silences, not rulings); 0262-02 and
0262-05 are `by-design` (0249/0261 and P7 respectively) with their
evidence recorded. The pattern across this run differs from 0257's: the
first day's findings were the preview's fixtures promoted into rules the
rulings never carry; this run's are the seams — the executor path meeting
the manual suite's standing state on one path grammar, and ruled envelopes
whose failure arms nobody wired. The first finding is also the family's
first design-class one: the code faithful, the letters colliding — 0167's
premise drift measured live. Fixes land only when directed — each its own
small ruling per 0123/0110 D13, code home and test home in the same
change, 0262-01's carrying the premise guard.

## Tests

None land — the record changes no code. Form checks at the landing tree,
0257's pattern: auto-core `bun typecheck` exit 0; the four reconciliation
suites green over the new INDEX row (docs-registers, constitution,
docs-truth, release-due). The INDEX row is this document's only companion
change.
