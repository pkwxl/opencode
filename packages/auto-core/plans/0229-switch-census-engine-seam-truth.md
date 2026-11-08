# 0229 — the switch census and the engine seam's stated truth

Status: active-authority (0166 remediation step 069, wave WA-docs; findings 0165-200 =
S17-09 (S4, CONFIRMED, DOC — the switch census: of S01-04's six "undocumented" names two
are tombstones, two are opencode's own flags the X1 scrub passes, two were live switches
documented nowhere; beyond the six, most parsed switches lived only in core design docs,
the operator's emergency exits among them) and 0165-197 = S14-07 (S4, CONFIRMED, DOC —
the engine contract's "All I/O goes through the TurnFx" is false four measured ways, and
fx.ts/sources.ts carry no direct suite, two invariants uncovered)).

Two families, one step because both are documentation-truth rulings of 0227 D1's standing
docs-accuracy rule with a test-home obligation each: **the person-facing switch
reference** (the frozen OPENCODE_AUTO_* layer — P13's own named surface — has a registry
and a run-start line but no one reference a person can read) and **the engine's I/O seam
statement** (a contract header claiming an exclusivity the code measured false four
ways). Neither finding reports a runtime defect: P21 is clean on the switch side (the
finding's own verdict — no dead switch, every SWITCH_ENV entry has a consumer), and the
engine's audit holds for everything the arbitration orders. Both findings are about what
a reader is told. 0165 is the evidence, not the authorization.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P13** (frozen additive-only vocabularies): the OPENCODE_AUTO_* layer is the
  principle's named surface (AGENTS.md's operational line: "experiment switches read the
  environment only, never persist to disk (P13)"). A census of that vocabulary changes
  nothing the parser reads — the ruling is additive-only documentation *of* the frozen
  layer, never a lockstep change to it; every name the table states is exactly a name
  `SWITCH_ENV` (the parsed half) or `RETIRED_SWITCHES` already owns. P13 is also why the
  retired names are documented as what they are — permanent tombstones whose notice is
  the contract (switches.ts's own registry comment), a set variable printing one line
  and changing nothing.
- **P8** (a check's enforcement moment is deliberate; every surfaced line teaches its
  remedy): the census's gap is a teaching gap — the switches whose `off` is an
  operator's emergency exit (REGRESSION, DOC_LANES, PARK, SYNTHESIS, REMEDIATE) and the
  run-shape knobs a person sets deliberately (STEP, HIBERNATE, STRICT_RESUME=off,
  RECOVERY_WAIT, RETRY_WAITS, PLAN_VERIFY) were discoverable only by reading core design
  documents. The remedy is the surfaced reference, not a new mechanism; and the teaching
  line runs both ways — the registry's comment names the person-facing table and its
  census so the next switch lands its row in the same change.
- **P19** (measured evidence): the census is re-measured at the landing moment, never
  the finding's snapshot (0227 D1's own rule) — at HEAD: 24 parsed switches, 13 present
  in README prose, 11 nowhere person-facing (the finding's "STEP absent" and
  "FORK/SYNTHESIS_TIMEOUT live nowhere" had already drifted: STEP, FORK, FORK_BASE and
  DECOMPOSE_FINE gained prose mentions since the review; the finding's shape — prose
  mentions scattered, no one table — stands). The seam statement's four out-of-seam
  effects are the S14-07 record's measured sites, re-read at HEAD (recovery.ts's
  `askClassifier`, questions.ts's `emitStatus`, windows.ts's `noteWindows`, step-up.ts's
  `awaitCacheClaim`).
- **P12** (fail loud; under uncertainty take the conservative direction): the false
  contract claim is the documentation twin of a swallowed error — a reader trusting "All
  I/O goes through the TurnFx" assumes the fx audit and the replay journal cover effects
  they never see (the classifier call's cost, the question-status journal writes, the
  windows log line, the cache-claim arming). The remedy is the conservative statement:
  the seam's exact boundary named, effect by effect, each with why it stays out and
  what still sees it. The census ratchet is P12's pin side: drift goes red
  (docs-truth), never silently outruns.
- **P5** (single ownership): `SWITCH_ENV`/`RETIRED_SWITCHES` remain the one source of
  switch truth. The README table is a pinned mirror, never a second registry — the
  census test derives every expected name (and every default, through
  `formatSwitches(parseSwitches({}))`) from the registries at run time, so the table
  cannot disagree with the code without the pin going red, and the table can never grow
  a name the registry does not own (the R6 dead-literal half: every OPENCODE_AUTO_*
  token in the section must be parsed, retired, or one of the four stated non-driver
  names).
- **P21** (machinery waits for its consumer): the finding's own impact line — "no dead
  switch (P21 clean)" — is re-verified, not re-litigated; nothing retires and nothing
  speculative is built. The two sources test cases cover invariants whose consumers
  exist today (the spine's own wiring — S14-07's remedy names exactly these two).
- **0227 D1 (docs accuracy, standing case law)**: every surface that names the code owes
  the code's current truth, verified at HEAD; a boundary claim becomes a boundary
  statement, never a softer claim; and a corrected boundary moves every surface of the
  same wrong family in the same change — here contract.ts's header, fx.ts's twin "the
  one I/O path of a turn" line, TurnContext's "immutable per-turn facts" comment (the
  `test` field carries the mutable cross-turn protocol record) and structure.md's "Turn
  fx and sources" row all state the same seam and move together.
- **How to rule ("a requirement names its test home")**: S14-07's own measures name it —
  the two uncovered sources invariants (answerWith-before-attach, a late probe verdict
  after detach) get their suite in this change; the census gets its ratchet in this
  change. A documentation ruling whose truth is pinned is the 0221/0225/0226/0227
  docs-pin line this corpus already practices.

Tier: documentation and tests (comment and doc text only in src; zero runtime behavior
change; two new test homes). No `Amends:` — nothing restated in the constitution; P13's
layer is untouched, P8's teaching arrives as the standing rule applied.

## Decisions

### D1 (0165-200) — the person-facing switch reference

One section in the CLI README (`packages/auto/README.md`, the shell's own person-facing
home — the core keeps no README and knows no shell): `### Experiment switches
(OPENCODE_AUTO_*)`, placed directly after the registry chapter's environment-variables
table (the neighborhood a reader already searches). It carries:

- the complete parsed-switch table — every `SWITCH_ENV` entry except `models`/`server`
  (24 rows), columns variable / default / governs, defaults exactly as
  `formatSwitches` renders them (`on`/`off`, `digest`, `off` for step, `task` for
  failback scope, `0,1,2,4,8` for the retry ladder, `30` for recovery-wait, `15` for
  the synthesis wall, `unset` for the empty render);
- the retired names — all four `RETIRED_SWITCHES` keys stated as what they are: set to
  any value they print one notice line at run start and change nothing (a notice, never
  a usage error — a stale shell profile must not cost an unattended run);
- the two env-only names — `OPENCODE_AUTO_MODELS` (the registry's operator layer, a
  file path) and `OPENCODE_AUTO_SERVER` (`--server`'s env form), registered in
  `SWITCH_ENV` but parsed by their own readers, never switch lines;
- opencode's own two flags — `OPENCODE_AUTO_SHARE` and
  `OPENCODE_AUTO_HEAP_SNAPSHOT`, agent-side variables the X1 scrub deliberately passes
  through (src/agent/env.ts's AGENT_FLAGS); the driver never parses them.

One teaching line in `src/switches.ts`'s registry comment, worded generically (the core
names no shell): the person-facing switch table and its census follow this registry — a
new switch lands its row in the same change.

### D2 (0165-200) — the census ratchet

The census test lives in `packages/auto/test/docs-truth.test.ts` (the 0227 docs-truth
pattern: a shell-side pin over that package's own README, the registries imported
through the declared `@opencode-ai/auto-core/switches` subpath — the one-way dependency
direction holds; the core never reaches the shell). Four checks, all derived from the
registries at run time:

1. every parsed switch name (SWITCH_ENV minus models/server) appears in the section;
2. every retired name appears in the section;
3. every OPENCODE_AUTO_* token in the section is parsed, retired, or one of the four
   stated non-driver names (MODELS, SERVER, SHARE, HEAP_SNAPSHOT) — no dead row, the R6
   dead-literal audit half;
4. every default the table states equals the registry's own render —
   `formatSwitches(parseSwitches({}))` parsed into a name→value map, the empty render
   read as `unset` — so a default that moves in code moves the table in the same change
   or goes red.

### D3 (0165-197) — the engine seam's boundary statement

`src/engine/contract.ts`'s header: the claim "All I/O goes through the TurnFx" is
replaced by the boundary statement — the fx is the audited seam for the effects the
arbitration orders (the spine's audit enforcing the queue discipline's invariants over
exactly these calls); four effects stay outside it, each named with its reason:

- the classifier ask (recovery.ts) — the model call itself bypasses the fx, but its
  answer re-enters as the synthetic `answer` input, so the arbitration, the audit and
  the replay still see it;
- the question lifecycle's journal writes (questions.ts's `emitStatus`) — run-status
  events, best-effort beside the committed trail, silenced like the journal so a
  journal failure never touches a turn;
- the router's usage-window line (windows.ts's `noteWindows`) — the logged windows are
  the router's run state; only the recorder's half rides `fx.onLimit`;
- the cache-claim arming (step-up.ts's `awaitCacheClaim`) — router run state that must
  survive a watch ending before the first step-finish reads it.

TurnContext's comment: the context is built once per turn, and the `test` field carries
the mutable cross-turn protocol record (`TestRun` — `test.pending`, `resumeWrapup` and
the sequence the test concern writes mid-turn; the record is the run's, the context
merely references it). `src/engine/fx.ts`'s header line "the one I/O path of a turn" is
restated to the same boundary (the production fx — the audited seam of the effects the
arbitration orders), and `docs/structure.md`'s "Turn fx and sources" row carries the
same truth in its one clause. All comment/doc text; byte-identical behavior.

### D4 (0165-197) — the two sources invariants covered

New `test/turn-sources.test.ts` (unit lane, registered in `test/lanes.ts`) driving
`makeTurnSources` directly over the scenarioClock fixture and the fake agent — the
invariants S14-07 measured as uncovered:

- the live shape: a fired timer emits exactly one probe verdict and re-arms exactly one
  timer; the cleanup cancels it;
- `answerWith` before `attach` throws the sources' own programming-error line;
- a probe verdict resolving after the cleanup ran is dropped — no emission, no re-arm
  (the `!active` return: the detached turn never sees a stale verdict).

Byte-identical runtime behavior: the suite observes `makeTurnSources` as it is; no src
behavior change is ruled on the engine side (the four out-of-seam effects are correct as
they stand — each named reason is the design, now stated; moving them inside the fx
would be a mechanism change no finding measured a need for).

## Category scope

The requirement family: **documentation truth and census discipline for the frozen
switch vocabulary** (P13/P8/P5/R6) and **the engine I/O seam's stated boundary**
(0227 D1's docs-accuracy family; P12/P18's audit-truth half). Home-set enumerated at
ruling time:

| Home | This ruling |
| --- | --- |
| `src/switches.ts` — SWITCH_ENV registry + RETIRED_SWITCHES (the vocabulary's one source) | changed — the census teaching line in the registry comment (D1); zero parse behavior |
| `packages/auto/README.md` — the person-facing reference | changed — the new switch section (D1) |
| `packages/auto/test/docs-truth.test.ts` — the shell docs pin | changed — the census ratchet (D2) |
| `packages/auto/MANUAL.md` | untouched — the manual is the command reference; the switch section's table is the single person-facing switch home (a second copy would be a mirror P5 forbids; the MANUAL's scattered switch mentions stay as the command contexts they are) |
| `packages/auto-server/docs/daemon.md` — the daemon's switch table | untouched, deliberately deferred — S31's own cross-reference row; no 069-owned finding names it, and a daemon-side census belongs to that package's step if the program schedules one |
| `src/agent/env.ts` — AGENT_FLAGS (opencode's own two) | changed in comment terms only via the README statement; the file itself untouched (its comment already states the two flags' standing) |
| `src/engine/contract.ts` — the seam claim | changed — the boundary statement + TurnContext's cross-turn note (D3) |
| `src/engine/fx.ts` — the twin claim | changed — the header line restated (D3) |
| `src/engine/sources.ts`, `src/engine/spine.ts` | sources: covered by the new suite (D4), file itself untouched; spine: untouched — its audit claims are runtime-enforced and were verified true (S14's "verified clean") |
| the four out-of-seam sites (recovery/questions/windows/step-up concerns) | untouched — each effect is correct as it stands; the ruling states them, never moves them |
| `docs/structure.md` — the module index's seam row | changed — the "Turn fx and sources" row's clause (D3) |
| `test/turn-sources.test.ts` + `test/lanes.ts` | created/changed — the two invariants' home (D4) |
| AGENTS.md navigation | untouched — no module → responsibility mapping changes (the docs homes are named here and in INDEX; the operational P13 line already names the layer) |

## Premises this ruling changes: none

Standing rulings re-read against this change: **0061 §4.3/§4.4** (the I/O seam and the
audit — this ruling states their boundary, amends nothing; the fx's member set is
untouched), **0035** (the protocol-string registry — the census documents the frozen
layer, no flip program), **0059 X1 / 0157 D4** (the scrub — AGENT_FLAGS' standing is
stated, not changed), **0225 D3** (the deprecation lifecycle — the retired names are
documented as exactly the tombstone class 0225 rules), **0227 D1** (docs accuracy —
applied, extended to no new surface class), **0221's** docs-pin pattern (the census is
its shell-side application over registries rather than needles). The INDEX row carries
the release cell `(open — ships with the next release)`.
