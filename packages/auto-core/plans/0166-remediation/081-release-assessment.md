# Step 081 — release-assessment (the program's last step)

Wave program (no register bucket; no 0165 finding ids of its own — this record and the
assessment it carries are the step's product) · status: **done** 2026-11-09 (started from
HEAD `49cd7ba3b` — step 080's commit; worked, verified and committed in one session).

## The absolute boundary

Program-level step, the last: the release assessment **prepares**, it never cuts. The
executable prompt's FINAL COMPLETION ("Prepare the release assessment last, respecting the
W1/W6 release gate and requiring explicit instruction before tagging or publication"), the
table's convention line ("the release assessment performs no act of the cut itself — explicit
instruction only, after the W1/W6 gate"), 0230's not-cut boundary law and releases.md's own
frame (**the maintainer cuts it**) all govern. This step performs **none** of: push, tag,
version bump, principles.md stamp change, release-section write, register clear, publication.
Its product is this record's assessment (0230 D3's material completed against the program's
final state), the program's closure, and the commit of both.

## Plan (before editing)

1. Mark 081 `doing` (date 2026-11-09, start HEAD `49cd7ba3b`); this record created first.
2. **The W1/W6 release gate check** — the executable prompt's "Do not cut a release before
   W1 and W6 have landed": verify from the status table and git history that W1 (steps
   009–012) and W6 (steps 013–015) are done, recording each step's commit SHA recovered
   from git history. Cite 0230 D1's recorded gate state and re-check at this step's own
   moment (the releases.md section's own law).
3. **The assessment** (this record, following 0230 D3's framing — a step-record-only
   assessment needs no INDEX row of its own; 0230's INDEX row already names step 081 the
   consuming step):
   - traceability both directions — cite step 080's completed census (238/238 ledger rows,
     INDEX 0169–0239 complete, probe P1/P2/P4 empty) and spot-verify at this HEAD, never
     re-running the whole census;
   - the falsification replay status — 0225 D7's stated method named, the replay itself a
     cut-time audit act stated as pending; no fabricated replay result;
   - family-consistency — S02-01's lapse (the 22 rulings, closed by step 003) and the
     current family-check state (step 080: 45 ok, the 0138 flag the recorded artifact);
   - the breaking-change candidate list — re-derived from the rulings 0169–0239 and the
     INDEX rows' own claims (frozen-vocabulary changes under P13 lockstep, grammar
     changes, retired tombstones, changed refusals), complete but honest about
     uncertainty;
   - the due-cut census updated — 0230 D1's snapshot (105 rows, 0125–0229, at step 070's
     HEAD `6f2cf849c`) re-measured at this HEAD and recorded here as this assessment's own
     dated numbers; docs/releases.md's 0230 section stays its dated snapshot (its own law
     and D4's pin hold it — the census is never a live oracle);
   - the maintainer's acts at the cut, named (the v0.3.0 tag riding the cut, the version
     spine determination, the stamp move, the register consumption/clear, the release
     section written from the prepared parts, the cut's tags, publication) — each the
     maintainer's explicit-instruction act, none performed here;
   - suites state — step 080's exact numbers cited; the three typechecks + the core full
     suite re-run at this HEAD to confirm nothing moved.
4. **Close the program** — row 081 done with verification; the Current position's final
   state (active step none, the program COMPLETE, later invocations terminate at Part A).
5. Commit (this record + the program doc only). No push, no tag, no publication, no
   version bump, no release section, no register clear.

## Execution log

- 2026-11-09 (delegated worker): step opened from HEAD `49cd7ba3b` (verified clean tree,
  `git log -1 --format=%h`). Inputs read: the program (executable prompt, status table,
  ledger, Current position), ruling 0230 whole, releases.md's due-cut section + register,
  step records 008/070/080, 0165 §0/§3/§9/§10, the pin `test/release-due-reconciliation.test.ts`,
  docs/principles.md's stamp line, docs/releases.md's spine.
- 2026-11-09: measurements taken at HEAD (the assessment's §2): the INDEX census, the
  constitution-edit census, the tag state, the stamp, the W1/W6 commit SHAs — all recorded
  below with their commands.
- 2026-11-09: spot-verification run (the assessment's §2/§3/§4): probe P1/P2/P4 empty,
  P3/P5/P6 the standing sets; family-check 45 ok + the one recorded 0138 artifact; INDEX
  rows 0169–0239 counted 71; ledger rows counted 238.
- 2026-11-09: suites re-run at this HEAD (the assessment's §9): typechecks ×3 exit 0; core
  full suite 3318/0 (166 files, 21665 expects); auto 173/8/6 (the failure families verified
  the known set); server 177/1 ("planPrelude boundary matrix" by name).

---

## The release assessment (the step's product — 0230 D3's material completed against the program's final state)

The cut's draft input is the 0165 review's §release-audit (§3 + §0's release-readiness line +
§9 item 7 + §10), as 0230 D3 names it. This assessment completes 0230's marshaled material
against the program's **final** state (0230's census was the dated snapshot of step 070;
every number below is re-measured at this step's HEAD `49cd7ba3b` on 2026-11-09 unless cited
to another moment). It lives in this step record — a step-record-only assessment needs no
INDEX row of its own (0230's INDEX row already names step 081 the consuming step).

### 1. The W1/W6 release gate — checked at this step's own moment, GREEN

The executable prompt's rule: "Do not cut a release before W1 and W6 have landed." The 0165
review's release-readiness condition (§0: "should not ship before W1 and W6 land — the
person-mark and release-gate defects are reachable on every shipped bundle's default flow";
§9 item 7: "The release cut itself (F13/F14): due; W1 and W6 should land first"). Both waves
landed early in the program and are `done` in the status table; commit SHAs recovered from
git history (`git log --grep="step 0NN done"`), each verified present:

- **W1 person-marks (steps 009–012)** — 009 `3bca0a2db` (ruling 0169, the S1 pair
  0165-001/002: mark-gated brief install, zero-fork hold, near-miss forks, section-scoped
  release mark); 010 `e28761943` (ruling 0170, verdict-document provenance part 1); 011
  `96b4b6c71` (ruling 0171, verdict-surface provenance part 2 — the ∪15 union fully
  dispositioned); 012 `8dc8e42c8` (ruling 0172, Choice execution + the analysis boundary).
- **W6 git boundary (steps 013–015)** — 013 `6d643b0ac` (ruling 0173, the release baseline
  walk past trailer-less commits, the trailer-block witness — the S1 0165-004); 014
  `e649c169b` (ruling 0174, the git failure-direction stragglers); 015 `099dd4482` (ruling
  0175, the script family's control and memory).

(The table's start-HEAD cells chain through intermediate protocol-amendment commits —
verified: `d2ebaf20c` a session close-out, `4992d423c` the last-hour protocol amendment —
the step commits above are each wave's own landings.) The ledger rows for both waves read
`fixed`. **The gate is green** — the same verdict 0230 D1 recorded at step 070, re-checked
here as the releases.md section's own law requires ("step 081 re-checks the gate at its own
moment").

### 2. Traceability both directions — step 080's completed census cited; spot-verified at this HEAD

Step 080 (the final audit, commit `49cd7ba3b`'s parent work — its own commit is this step's
start HEAD) completed the census; this assessment cites it and spot-verifies, it does not
re-run it:

- **Ledger**: 238/238 rows (0165-001…0165-224 + F9–F22), zero missing/duped; dispositions
  **fixed 235 / deferred 2 (0165-178 + F13 — the maintainer's v0.3.0 tag act, §8 below) /
  by-design 1 (0165-047, ruling 0221 D2)**. Spot-check at this HEAD: ledger row count 238
  (mechanical count of the program's ledger table).
- **Rulings ↔ INDEX**: every ruling 0169–0239 has its INDEX row (step 080: 71/71, probe P1
  empty). Spot-check: 71 rows counted in the 0169–0239 range at this HEAD; probe P1 still
  empty.
- **Rulings ↔ step records**: 81 table rows, 001–079 done + 080 done + 081 this step; the
  prescribed mainline order W0→…→WB/WC monotone; 19 standalone buckets (step 080 §4).
- **Probe state at this HEAD** (the 0165 scripts, re-run read-only 2026-11-09):
  **P1 empty, P2 empty, P4 empty** (INDEX grammar, code homes, Derives/Category scope);
  P3/P5/P6 the recorded standing sets (P3: the retired `docs/behavior.md` reference, the
  `docs/R-NN`/`T-NNN` grammar placeholders, shell-contract's cross-package references; P5:
  `OPENCODE_AUTO_E2E_KEYS`, S01-triaged documented-and-test-only; P6: the four post-split
  modules agent/urls, plan-gate, loop-plan, formulate-parts, tested through their family
  suites) — none a defect; every standing set named in its owning record (steps 065–080).

The reverse direction (principle→code) is the per-release audit duty's own item, run at the
cut over the cut-moment corpus (§3 of releases.md's audit duty); the program's contribution
— every ruling traced to its principle keys and Category scope, P4 empty — is complete.

### 3. The falsification replay — method stated, PENDING at the cut (no result fabricated)

The replay is a **cut-time audit act** under the per-release audit duty, never performed by
this program. The method (0225 D7, from S03 run 1's measured breach — 0165-183/F21): the
replay **never runs inside the repository** (any agent session there auto-loads AGENTS.md,
whose navigation names the rulings); the blind child starts in an isolated directory holding
the amended `docs/principles.md` **alone**, questions neutrally phrased (no plan numbers, no
mechanism names), plans closed. The constitution must answer real, already-ruled questions;
answers that differ return the principle set to synthesis — never to the ruling.

- **Status**: pending at the cut. The v0.3.0 replay's recorded confirmation stands as
  recorded (releases.md v0.3.0 section). Since v0.3.0 the constitution gained the register's
  five mid-cycle edits (§6 below) — the replay at the cut runs over the principles.md of the
  cut moment, with the questions phrased over rulings the corpus then carries.
- **Cheap read-only probe state at this HEAD**: the corpus probes (P1–P7, §2 above) are the
  0165 scripts this program re-ran at every docs step; their state at HEAD is recorded in §2.
  No replay session was started by this step (the method itself forbids running it here).

### 4. Family-consistency — S02-01's lapse closed by step 003; the current state

- **The lapse, for the cut's audit to record**: 22 requirement-bearing rulings (0142–0161,
  0163, 0164) originally carried no `## Category scope` (F9/S02-01) — the family-consistency
  check could not run on them. **Closed by step 003** (ruling none — the sections resumed,
  family-check 22/22 ok at that step); the 0166 program's rulings (0169–0239) all carry the
  section (probe P4 empty, §2). The historical fact stands recorded; the release section's
  family-check item states the lapse and its closure.
- **Current state at this HEAD**: `bun plans/0165-review/tools/family-check.ts` → **45 ok**,
  exactly one flag — **0138** (descriptive ignore-entry spellings inside mechanism
  parentheticals collected as if repo home paths; the substance fixed at 0165-147/step 030;
  the spellings reconciliation consciously not enacted) — the named standing observation
  owned by step 080's record §5.

### 5. The breaking-change candidate list (the determination's input — pre-1.0, said in words at the cut)

Re-derived from the rulings' own claims (INDEX rows and rulings 0169–0239), organized by
class. **Honesty about method**: this list is derived from the rulings' and INDEX rows' own
statements, not a fresh line-by-line diff of every refusal message; every ruling below is
already ruled a defect fix in its own document (the floor never masks one — the spine's
patch class), and the cut's determination is the maintainer's act of saying so in words.

**A. Vocabulary tombstones and frozen-vocabulary locksteps (P13)** — surfaces that now
refuse where v0.3.0 accepted:

- **0231** — the ten retired model-route words (`understand` 0030 D12; the eight
  verify-/review- words 0044 D1; `number-recovery` 0150 D2) become permanent tombstones at
  every parse surface (`RETIRED_MODEL_ROLES` beside `MODEL_ROLES`): a v0.3.0-valid registry
  routes map naming one now reads the tombstone refusal naming the ruling; a project phase
  type named `understand`/`number-recovery` now refused (the resurrection door closed);
  `OPENCODE_AUTO_MODEL` entry lists and `phaseTypeRoleProblems` refuse retired words with
  their own line.
- **0179** — the retired skip-flag vocabulary lockstep: select's unused import dropped
  (0163's own P13 clause); the router's three skip-flag-era comments restated to the
  one-mark shape; the recoveryAt seam corrected (a ring-exhausted provider's first wait
  round sleeps to the stated reset instead of polling).
- **0195** — the CLI parser's refusal grammar completed: positional overflow a usage error
  on every command (v0.3.0 swallowed extra words — `run dir1 dir2` ran dir1); the
  `--flag=value` form validated (`--verbose=flase` no longer silently means true); the
  `_lane` machine entry a strict allowlist (twelve silently-ignored flags now refused); the
  retired watchdog extras' values no longer leak as stray positionals.
- The **pre-program practiced tombstones** the determination already names (S02-03/F11's
  impact note): 0137's retired flag, 0138's ignore-set members, 0133's retired forms,
  0150 D2's registry routes refusal — each breaking a v0.3.0-valid surface by design.

**B. Additive verdict/exit vocabularies** (backward-compatible additions; the note names
them so consumers of the vocabularies learn the new words):

- **0236** — `unreadable` added to `UnitGate`/`UnitStop`/`Outcome`/`TASK_OUTCOMES` in one
  lockstep (beginUnit's strict arms carry the distinct verdict no exemption consumes).
- **0224** — observe's additive `unknown` field carrying git's own stderr line beside the
  verdict (an exit-128 scene reports `clean: false, changed: []` plus the line).
- **0182** — exit code `129` (SIGHUP) added beside 130/143 — the supervisor's stop through
  the same force-terminate cleanup; the exit-code line in the shell README lockstepped.
- **0212** — the task-usage ledger's identity fields (the stint's own phase/round stamp and
  time bracket; the lanes section round-scoped) — additive schema for ledger readers.

**C. Document/protocol grammar changes** (surfaces standing projects or prompt users may
carry — the release note's migration-relevant class):

- **0209** — the round-brief proposal-body grammar: the terminator restated (a round-shaped
  head `#{3,6}` naming a round id, not exact `### R-NN` — a sectioned proposal now installs
  whole where v0.3.0 truncated it); near-miss forks held; a `##`-stranded proposal a named
  problem and a round's-open note.
- **0205** — the formulation todo's `Prefix:` field and the fixed-prefix floor grammar; the
  `Formulate:`/`Closed:` guards extended to the two new fields.
- **0201/0202** — the manual fix subject's log-derived ordinal + the countable gap grammar
  (`### Gap N — <title>` headings the master counts); every task-title-bearing subject the
  short title — the manual suite's protocol copy re-pinned across the companions.
- **0200** — the manual subtask companions' Stage 3 rewritten to the task-level
  verification loop (a fresh verification child judging Scope/Acceptance; the narrative
  wrap-up channel retired) — a protocol change for users of the manual prompts.
- **0228** — document-grammar near-misses now refused: custom-phase field blocks, unit
  field-block near-misses, the Depends two-homes rule (the document/roles docs gate).
- **0216** — template copy changes: fix.md's commit cadence, the acceptance-duty fix loop,
  the mode-brief exit vocabulary — shipped prompt-template bytes changed.
- **0239** — `templates/opencode.json`'s unruled `"/home/*"` bash grant removed (no
  permission outcome changes — redundant under `"*": "allow"` — but a shipped-template byte
  change with the recorded consequence: a pre-0239 template-equal opencode.json compares
  unequal at reset, kept as "content modified"); the red lane receipt's Log field stated
  once (the duplicate retired — receipt readers see one field where v0.3.0 wrote two).
- **0203** — the manual ratchet pins ruled relationships, not vocabulary presence (a
  producer drift now red that v0.3.0's ratchet passed — governance tooling for the suite).

**D. Changed refusals and behavior flips** (each its ruling's own defect fix — the patch
class; a release note's "behavior changes" section names the user-visible ones):

- **0169** — the survey's person marks: mark-gated brief install, zero-fork surveys
  carrying a proposal held, near-miss fork shapes counted (flows that auto-installed in
  v0.3.0 now hold for the person's `Clarified: yes`).
- **0170/0171** — verdict provenance: report.md no longer outranks the verifier's FAIL;
  receipts and the test marker judged by location **and** provenance; the running unit's
  todo.md content restored before the commit; the agent-written `Choice:` no longer the
  person's.
- **0172** — `run` now executes a Choice (v0.3.0 dead-ended it); the analysis read-only
  during run.
- **0173** — the release baseline walks past trailer-less commits (release audits ranges
  v0.3.0 certified without provenance); the trailer-block witness; git hooks honored under
  a scrubbed env.
- **0176** — the release clean-tree check fails loud on unreadable git (v0.3.0 quiet).
- **0181/0185/0186** — the sideband's lifetime the dispatch's watch; driver faults stop the
  run (v0.3.0 reclassified them transient); the ask channel's closed-stdin truth.
- **0188/0189/0190** — the wall's edit-denies widened (the stamp-placement catch-all
  spellings); the outside-transfer skip and recovery sweep; the close-before-gates
  ordering; the wall commit message staleness vs 0138.
- **0196** — the exports ruling: the shell's boundary scan + the reach-around guard
  (crafted cross-module imports now refused).
- **0198** — oscillating gap counts now block (the progress rule keys on the loop's best;
  the bound 2N+2 stated where 0146's 2+N stood).
- **0199** — the proxy-answer scan scoped to the session's added lines; the dead marker
  consumed on the verify FAIL path.
- **0204** — clarify resolves the analysis only at the project-start condition;
  past-establishment an unreleased analysis is a teaching note, never auto-released.
- **0207** — the three release consumptions commit their own pathspecs (the person's dirt
  left to the clean gate that owns judging it).
- **0210/0211** — the doc-loop flatten owns every leftover (the dead-end retired); a
  killed decompose's artifacts re-committed on the existing path; a session-written
  checklist outside any split clause removed, never the person's.
- **0213** — the lane launcher's self-invoke derived per process shape (the compiled
  binary re-invokes itself); the commit rider admitting driver state only outside every
  live scope; the repair budget consumed only by a round that opened.
- **0215** — every whole-file write of config.json/brief.md/bundle-managed files
  write-tmp-then-rename (the tmp riding `.auto/`).
- **0217** — the formulation tier route (the deep tier reaching the session that writes
  every task document); the probe reading its own `until` evidence.
- **0218** — the claude adapter: the external_directory translation declined on P19
  grounds with the run-start degradation note; the closing wait bounded; the busy-process
  model change refused.
- **0219** — the capability clamp's blocking error teaching the per-key pair amend; the
  strict-resume eligibility verdicts split by curability (a window-blocked recorded model
  eligible-with-wait).
- **0222** — the server bridge secret off argv (tokens never on the command line — X1's
  letter extended).
- **0223** — spawn payload robustness (E2BIG/ENOENT), the IPv6 transport URL, `--launch`
  path resolution.
- **0224** — the daemon registry's end of life: the restored stub's lock-derived retire,
  the hub dying with its run, observe's honest verdicts.
- **0236** — `units.json` sanitized at its one read home; corrupt bytes moved aside at the
  next write (named once); preflight's post-protect exits unprotect; the clean gate's
  per-family teaching.
- **0237** — the rollback guard: `siblingScopes` present-non-empty refuses before any git
  call (a new blocked verdict where v0.3.0 swept the sibling's work); the park's honest
  verdicts (the thrown exit 1 retired); formatDurationCompact's whole-second rounding
  (output text: "1m" where "60.0s" once printed).
- **0238** — an absolute or `..`-bearing `Artifacts:` declaration refused; taskBody's CRLF
  normalization; the corpus-bounded fix-session ordinal.
- **0239** — run's `requireConfigFile` before the run log (a never-init directory now
  refuses teaching init — new refusal); the `.gitignore` writes verbatim (the stale nested
  line reported, never stripped).

**E. Source-layout re-keying (behavior byte-identical, proven)** — name in the note's
re-keyed surfaces, not its breaking class:

- **0235** — loop-plan split to loop-append/plan-gate/formulate-parts (whole-function
  verbatim moves, line-multiset-proven; the exports re-keyed, importers byte-identical).
- **0193** — the core/shell seam consolidation (one init/amend sequence, one option/banner
  emitter family, the shared fake fixture) — the shells' surfaces re-keyed to the core's
  one home.

**Not candidates** (stated for completeness): 0225/0226/0227/0229/0230 (documentation and
censuses — zero code behavior ruled); 0232/0233/0234 (test homes — preload hermeticity,
deterministic timing, the chain-writes ratchet); 0168 and earlier rulings (pre-program,
already v0.3.0-dated or carried by the pre-program open rows 0125–0168 the same cut ships).

### 6. The due-cut census — updated at this step's HEAD (the assessment's own dated numbers)

Measured 2026-11-09 at HEAD `49cd7ba3b` (this step's start; the tree's docs edits are this
step's own record only):

- **INDEX census**: `grep -c "ships with the next release" plans/INDEX.md` → **115** open
  rows, spanning **0125–0239** (first open row 0125 at INDEX line 152, last 0239 at line
  291; 0125…0239 = exactly 115). **v0.3.0 closed 0112–0124** (first v0.3.0 row 0112 at
  line 139, last 0124 at line 151). Against 0230 D1's snapshot (105 rows, 0125–0229, at
  step 070's HEAD `6f2cf849c`): **+10 rows — the program's steps 071–079 landed rulings
  0230–0239** (0230 itself + 0231–0239). The count is arithmetic-consistent: the span grew
  by exactly the ten rulings the final steps landed.
- **Constitution-edit census**: `git log --oneline 07036c2b5..HEAD --
  packages/auto-core/docs/principles.md` → the **same five commits** as 0230's census
  (`7401fe7b5` 0146, `c4fb131f7` step 006, `be3daccb1` 0221, `39095aee6` 0225, `696966685`
  0226) — **steps 071–079 edited no constitution text**; the register remains complete at
  its **five rows** (0146, 0166 step 006, 0221 retroactive, 0225, 0226), and this step adds
  none (no principles.md text moves here either).
- **The register as the principle-delta draft**: the five rows above, restated as the draft
  the next release section absorbs at the cut (0230 D2) — no row rewritten, none cleared.
- **docs/releases.md's 0230 section stays its dated snapshot** — its own law ("A dated
  snapshot, never a live count… the cut re-measures at its own moment") and D4's pin hold
  it; the updated numbers live **here** (this record), which is the section's own named
  consumer ("step 081 (release-assessment) hands the material over"). The pin
  `test/release-due-reconciliation.test.ts` verified green in this step's suite run — no
  needle moved, none needed.
- **The programs**: the 0155–0160 ruled program completed 2026-10-30 (the trigger's first
  firing); **the 0166 remediation program completes with this step** (001–081 done; §10
  below) — the trigger's second firing, both shipping in the same cut.
- **The tag state**: `git tag -l` → v0.1.0, v0.2.0 — **the v0.3.0 tag still absent** (the
  maintainer's act, §8). The principles.md stamp reads "Current as of release v0.3.0" —
  unchanged, as the not-cut law requires.

### 7. The release-section parts' sources (v0.3.0's own shape)

- **Principles deltas**: the register's five rows (§6), plus any Tier amendments the open
  corpus carries — measured at the cut; the rulings' tiers are in their INDEX rows and
  documents (0169–0239 overwhelmingly "code beside documentation/tests"; none self-describes
  a Tier I amendment — the constitution edits are the register's reconciliation/mid-cycle
  classes, each row naming its class).
- **Tier II default changes**: none identified in the 0166 program's rulings by their own
  claims; measured at the cut (0230 D3's own rule).
- **Mechanisms added**: the mid-cycle amendment register + the two-track deprecation
  lifecycle + the replay method (0225); the due-cut reconciliation section (0230); the
  tombstone table (0231); `selfInvoke` (0213); the shell boundary scan (0196);
  `staleNestedEntryLines` (0239); the lane-manifest/test ratchets (0232/0234 — test homes).
  **Mechanisms retired**: the manual companions' narrative wrap-up channel (0200);
  `resumeModelNow` (0238); the skip-flag vocabulary (0179); the template's `"/home/*"`
  grant (0239); runTask's input-level siblingScopes carrier (0237); the per-invocation
  `landings` local (0213).
- **Ruled defect fixes**: the 235 fixed ledger rows, each naming its step and ruling (the
  ledger is the source; §2).
- **Tombstones**: §5A's list (the ten route words; the pre-program practiced set).
- **Re-keyed surfaces**: §5E; the split modules' exports (0235), the seam consolidation
  (0193).
- **Findings disposition**: the ledger at the program's final state — 238/238 accounted
  (fixed 235 / deferred 2 / by-design 1), F9–F22 with their register twins (§2).
- **Version practice**: pre-1.0 minor may carry breaking changes, said so in words; the
  spine's classes (major = Tier I amendment or breaking contract change; minor = new opt-in
  mechanism or Tier II default change; patch = ruled defect fixes). The version
  determination itself is the maintainer's at the cut (§8).

### 8. The maintainer's acts at the cut — named, NONE performed by this step

Each is the maintainer's explicit-instruction act (releases.md l.5 "the maintainer cuts it";
0110 D14; the program's hard constraint; 0230's not-cut boundary):

1. **The v0.3.0 tag decision riding the cut** — tag `07036c2b5` as v0.3.0, or the tag
   rides the next explicitly instructed cut alongside it (0165-178/F13's disposition, step
   008's record, releases.md's v0.3.0 "Tag anchor — recorded missing" block; the two
   deferred ledger rows name exactly this act).
2. **The version determination on the spine** — the next release's number read from the
   spine's classes over §7's parts (the maintainer's judgment; this assessment supplies the
   inputs, never the number).
3. **The principles.md stamp move** — "Current as of release vX.Y" advances to the cut's
   version (the register's rows consumed into the release section's principle deltas in the
   same act).
4. **The register's consumption and clear** — the five rows absorbed into the release
   section's principle deltas, the register cleared (0225 D6's rule, prepared by 0230 D2,
   never enacted).
5. **The release section written** — from §7's prepared parts, in v0.3.0's own shape,
   including the per-release audit duty's two recorded audits (traceability both
   directions; the falsification replay under 0225 D7's method — §2/§3 above) and the
   family-check item with S02-01's lapse recorded (§4).
6. **The cut's own tags** — the next release's tag at its cut commit.
7. **Publication** — push, publish, whatever distribution act the maintainer chooses.

**This step performed none of them**: no push (the branch stays ahead of origin by the
program's commits, the maintainer's to push), no tag (`git tag -l` still v0.1.0/v0.2.0), no
version bump (package.json `version: 0.0.0` per 0110 D14, untouched), no stamp change
(v0.3.0 stands), no release section (releases.md gains nothing from this step), no register
clear (five rows stand).

### 9. Suites state — step 080's baselines cited; re-run at this HEAD

Step 080's exact numbers, re-verified at this step's HEAD (2026-11-09, this step changed no
src/test/template/shell file — docs and program bookkeeping only):

- **auto-core**: `bun typecheck` exit 0; full suite **3318 pass / 0 fail** (166 files,
  21665 expects) — the exact baseline, including the due-cut pin green.
- **packages/auto**: `bun x tsgo --noEmit` exit 0; full suite **173 pass / 8 skip /
  6 fail** (187 tests, 4 files) — the exact baseline; the six failures the known
  pre-existing families verified by name (phased-P1 "roadmap-driven establishment…", fork
  "fork runs beside a live run lock" + "the task form's happy path", remove-fork "a run
  live inside the fork refuses" + its two siblings — steps 067/069/073/077/079's records).
- **packages/auto-server**: `bun x tsgo --noEmit` exit 0; full suite **177 pass / 1 fail**
  (178 tests, 26 files) — the exact baseline; the one failure "planPrelude boundary matrix"
  by name (the known drift); no observe/status-events flakes this run.

## The program closed

With this step the 0166 remediation program's completion law is fully satisfied: every
0165 finding and F9–F22 accounted (238/238, §2), every wave dispositioned (001–079 done +
the final audit 080 done, the prescribed order monotone — step 080 §4), documentation and
INDEX complete (0169–0239 all present, P1/P2/P4 empty — §2), suites and typechecks green
at exact baselines (§9), the final audit committed (`49cd7ba3b`), and **the release
assessment prepared (this record) with the W1/W6 gate checked green** (§1). Tagging, cut
and publication remain the maintainer's explicit-instruction acts (§8). **No subsequent
work exists: later invocations of the executable prompt terminate immediately at the Part A
gate** (the program's status table has no `doing`, `todo` or recoverable incomplete step
after this step's commit).

## Verification (the step's close)

- The three typechecks exit 0 (auto-core, auto, auto-server).
- Core full suite **3318 pass / 0 fail**; auto **173/8/6** (the known six by name); server
  **177/1** ("planPrelude boundary matrix") — all exact baselines (§9).
- Probe P1/P2/P4 empty, P3/P5/P6 the standing sets; family-check 45 ok + the recorded 0138
  artifact; INDEX 0169–0239 = 71 rows; ledger = 238 rows (§2/§4).
- The census re-measured and internally consistent (115 = 0125…0239; §6); the
  constitution-edit census unchanged (five commits; register complete at five rows).
- The W1/W6 gate green with each wave's step commits verified in git history (§1).
- No release act performed (§8's closing check): `git tag -l` v0.1.0/v0.2.0; the stamp
  v0.3.0; releases.md untouched by this step; package versions untouched.

## Result

Committed as a proper step (subject `0166: step 081 done — release assessment prepared …`).
The program's status table row 081 → done; the Current position records the program
COMPLETE with active step none. The commit stages only this record and the program doc.
