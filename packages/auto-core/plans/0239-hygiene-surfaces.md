# 0239 — Hygiene C: the person-file rewrite scope, the template's host grant, the red receipt's doubled Log field, the never-init run teaching, the README key-ring claim, the switch census consumed

Status: active-authority (0166 remediation step 079, wave WC-hygiene; findings
0165-062 = S01-04 S3, 0165-208 = S22-07, 0165-209 = S24-06, 0165-210 =
S25-10, 0165-214 = S27-02, 0165-218 = S28-04, the last five S4 CONFIRMED).

One family — **the surface hygiene the 0165 review's per-scope sweeps named**:
a de-initialization that rewrites the person's prose beyond the lines it
removes (a whole-file blank-line collapse and trim in AGENTS.md, a trailing
-blank-line collapse in every .gitignore append and strip, a stale nested
-repo line nobody owns surviving the inverse of the write that created it), a
shipped permission template carrying a host-specific bash grant no ruling
backs, a red lane receipt emitting its Log field twice, a run on a
never-initialized directory two misdirected refusals away from the true
remedy (a defaults banner over a config that does not exist, then a
contract-missing stop teaching `fix`, which itself teaches `init`), and a
README paragraph asserting a key-ring invariant the code does not have —
beside one finding (the six undocumented switches) that an earlier step's
ruling already landed whole. 0165 is the evidence, not the authorization:
every locus below was re-measured at this step's HEAD `a967e8e59` before the
remedy was chosen, one finding consumed as landed with its census, and two
remedy arms declined on measurement (the core-side never-init refusal, and
any migration of standing projects' opencode.json).

## The measured ground (this step's own, at HEAD `a967e8e59`)

- **062 (S01-04)**: consumed as landed — 0229 (step 069) already added the
  person-facing switch home. All six names measured present in
  packages/auto/README.md at HEAD: `OPENCODE_AUTO_FORK` (the table's fork
  row) and `OPENCODE_AUTO_SYNTHESIS_TIMEOUT` (its row); the retired
  `OPENCODE_AUTO_HANDOVER_CONCURRENT` and `OPENCODE_AUTO_TASK_CONTEXT` (the
  tombstones paragraph, SWITCH_ENV's retired notices at switches.ts:140/:145
  — parsed, tombstoned, documented); `OPENCODE_AUTO_SHARE` and
  `OPENCODE_AUTO_HEAP_SNAPSHOT` (the "not the driver's" paragraph — opencode's
  own, the X1 scrub passing them through). The census ratchet
  (packages/auto/test/docs-truth.test.ts, 0229 D2) holds every parsed name,
  every retired name and the declared non-driver names against the section —
  a name leaving the registry or the table goes red. Nothing of S01-04
  remains; the disposition records the measurement, no code changes.
- **208 (S22-07)**: all four arms live. agents-block.ts:331 — removePointer
  ends `text = text.replace(/\n{3,}/g, "\n\n").trim()` then writes
  `${text}\n`: when the driver removes its block, the collapse runs over the
  whole file (the person's deliberate 3+ blank lines anywhere collapse) and
  the trim eats their leading whitespace and trailing blank lines;
  ensurePointer's own collapse (0158 D2) is gated on legacy removal and its
  tail rule `/\n{2,}$/ → \n` never trims the head. gitignore.ts:97 —
  appendEntries writes `${existing.trimEnd()}\n…`: the person's trailing
  blank lines collapse at every driver append. gitignore.ts:166-170 —
  stripEntries `kept.join("\n").trim()` then `${text}\n`: their leading and
  trailing blank lines go at every strip. gitignore.ts:185 —
  removeGitignoreEntries strips `nestedRepoEntries(directory)` — the LIVE
  tree's repos — so a nested repo deleted after init keeps its `/<path>/`
  line through reset; no durable init-time record exists to distinguish
  init's stale line from the person's own (the .gitignore lines themselves
  are the only stamp).
- **209 (S24-06)**: templates/opencode.json:19 carries `"/home/*": "allow"`
  in permission.bash, redundant under the preceding `"*": "allow"` and
  unexplained by any ruling (the scoped P16 scan found no backing; /tmp is
  the separately ruled receipts convention). The template rides
  `with { type: "file" }` path imports (config-op.ts:30, config-fix.ts:68,
  reset.ts:35, driver-helper's test) — not the template registry in
  src/template.ts — so no registration changes. No genericity scan over
  templates/ exists (grep over test/ empty — the review's P16 grep was a
  one-off).
- **210 (S25-10)**: script.ts:644/:650 — the common field array emits
  `Log: <path>` whenever a run has a log and is not carried, and the red
  branch pushes `Log: <path>` again before the fence: every red lane
  receipt carries two identical Log lines. No src reader parses `Log:`
  (the receipt readers parse Lane/Heads/Verdict — grep empty); the manual
  copy (prompts/run.md) teaches one Log line.
- **214 (S27-02)**: reproduced at HEAD — `run` on a never-initialized
  directory prints `⚙ project config (.opencode/auto/config.json): mode
  migrate · …` (loadRunConfig's missing-file→defaults floor, config.ts:147),
  then preflight's `⏸ agent contract file missing` teaches
  `recovery: run opencode-auto fix <dir>`, and fix on that dir refuses
  `nothing to fix … run opencode-auto init` — the person is two hops from
  the root cause. The shell already owns the honest shape: plan calls
  `requireConfigFile("plan", true)` before its config load (index.ts:1598,
  "a directory init never configured is refused rather than planned with the
  defaults"), and `requireConfigFile` (index.ts:2005) prints the one-hop
  teaching (naming init, and fix for the legacy-mode fallback where fix CAN
  act). Measured and declined: a core-side hard refusal in preflight — the
  core's own suite drives preflight/runAll over bare temp dirs through 13
  direct call sites (loop-preflight.test.ts's project() fixtures write the
  contract and the pointer, never config.json) and config.ts's floor is the
  documented contract ("Both run and init go through this entry"); the
  person-facing shell entry is where the root cause is nameable without
  breaking the core's runAll floor.
- **218 (S28-04)**: README:1349 — "The walk never oscillates (the fork a
  rotation just seeded rides the held key it landed on)" — the reason was
  never true: 0163 D2 has every consumed fork walk at its own session start,
  and 0178 corrected 0163's measurement claim outright (the short-stated
  -reset oscillation measured at 80 restarts over 40 failures, the second
  key never serving). The paragraph is 0178's missed README lockstep half
  (0178's Category scope named packages/auto/README.md's key-ring paragraph —
  only the walk-bound wording landed, in 0231's step). The three gates the
  code now has (0178 D1 the earlier-keys-only bound, D2 the fork skip, D3
  the doc-lane deferral) appear nowhere in the paragraph.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P7** (grammars, never content): showings for D2a (removePointer's
  cleanup becomes a seam grammar — each removal collapses the blank-line run
  it alone created, at most one blank line, an end-of-file seam normalizing
  to one newline; the person's bytes elsewhere are not the driver's
  grammar to rewrite), D2d (the stale-nested report judges the line's
  shape — slash-led, slash-closed, its directory gone — never the person's
  intent) and D3 (the genericity scan's home-directory path families are a
  mechanical shape rule over shipped files).
- **P10** (the byte-identical floor): showings for every arm — no block
  removed (removePointer writes nothing, bytes untouched), no driver append
  or strip (the .gitignore untouched), a green or carried lane receipt (the
  red branch alone changes), a bash permission outcome under `"*": "allow"`
  (removing the redundant row changes no verdict), a configured directory's
  run (requireConfigFile passes through), a project with its own
  opencode.json edits (untouched — fix never rewrote the bash section and
  starts none now).
- **P8** (every surfaced line teaches its remedy): showings for D5 (the
  never-init run refusal names the root cause — the missing config — and
  the one-hop remedy init, ending the fix→init chain), D2d (the stale-entry
  report teaches the hand deletion) and D4 (the receipt's Log line is the
  one line an operator reading a red receipt follows — stated once, in the
  common fields where every receipt's reader already looks).
- **P12** (conservative under uncertainty): showings for D2d (no durable
  init-time record distinguishes init's stale nested line from the person's
  own — uncertain ownership resolves toward no-consume: reported, never
  stripped) and D5's declined core-side arm (the measured test floor and
  the documented runAll contract outweigh the symmetry of a preflight
  check).
- **P5** (single ownership): showings for D5 (requireConfigFile is the one
  home plan already owns — run joins it rather than growing a second
  spelling), D4 (the Log field emitted at one site — the common field
  array; the red branch duplicates nothing), D2b/D2c (the append and strip
  write shapes each have one home in gitignore.ts) and D2d (the nested
  grammar's one home — nestedRepoEntries beside the stale reader).
- **P13** (frozen additive-only vocabularies; lockstep in one change):
  showings for D6 (the README paragraph is 0178's lockstep half — the
  paragraph changes in the same change family as the code ruling that made
  its claim false; the retirement is the false invariant and its false
  reason, replaced by the three gates' names), D4 (the receipt grammar's
  field sequence pinned as part of the change — Log moves from "present
  twice in red receipts" to "present at most once", no reader consumed the
  second occurrence) and D1 (the census ratchet holds the consumed finding
  — a switch leaving the table or the registry goes red, so the
  documentation home cannot silently rot again).
- **P16** (genericity; no real host's facts in shipped material): showing
  for D3 (the /home/* grant is a host-layout convention in generic
  materialization for no behavioral gain — removed; the scan holds the
  path family so the next host-specific literal goes red, not unnoticed).
- **P18** (the record outlives the tool — plain truth in durable
  documents): showings for D6 (the operator's key-ring mental model must
  match the code — the paragraph documented an invariant the code does not
  have in exactly the field case it exists for) and D1 (the switch table is
  the durable person-facing reference; its census is the record's guard).
- **P19** (measured evidence): showing for the ruling's method — every
  locus re-measured at HEAD before the remedy was chosen, one finding
  consumed as landed with its census measured name by name, the core-side
  never-init arm declined on the measured 13-site test floor, and the
  oscillation claim retired on 0178's recorded reproduction (80 restarts
  over 40 failures), never on assertion.
- **P2** (the person brackets every boundary): showings for D2d (the stale
  line's ownership is surfaced to the person as theirs to judge — reported
  with the hand remedy, never consumed as closed) and D3 (standing
  projects' opencode.json are the person's once written — the template
  change touches new materializations only; reset's keep rule stays the
  conservative comparison it always was).

## Decisions

**D1 — 062: consumed as landed (0229).** The six S01-04 names are measured
present in the README's one person-facing switch home at HEAD, each in the
row its parser status dictates (two live table rows, two retired tombstone
notices, two agent-owned names in the not-the-driver's paragraph), and the
census ratchet holds the section against the registry (every parsed name,
every retired name, no registry-unowned token, the stated defaults the
registry's own live render). The finding's remedy — "document or retire
each" — was answered by 0229 D1's single-home table; a second copy in any
other doc would be the mirror P5 forbids. No change; the ledger row records
the consumption and the measurement.

**D2 — 208: the person's bytes stand; the driver cleans only its own
seams; the stale nested line is reported, never stripped.**
(a) removePointer's cleanup becomes seam-local: each removed block
(legacy or canonical) is cut out with the blank-line run the cut creates
collapsed to at most one blank line, and when a seam ends the file the
tail normalizes to one newline (ensurePointer's own gated tail rule) —
0158 D2's law ("the collapse is a removal cleanup, never a normalization
pass") extended from the unchanged-block case to the removal path. The
person's leading whitespace, their deliberate blank-line runs away from
every seam, and trailing blank lines no seam touched keep their bytes; the
write is the cleaned text verbatim (no whole-file trim, no appended
newline); the emptied comparison trims for detection only, its rule
unchanged (a file the strip leaves as the bare `# AGENTS.md` shell — or
nothing — was ensurePointer's creation and goes whole). The chmod/reprotect
dance and the dryRun contract stand.
(b) appendEntries preserves the person's trailing blank lines: the base is
the existing text verbatim when it ends in a newline, one newline added
only when their last line lacks it (the driver's entries need a fresh
line); the equivalence check and the missing computation stand.
(c) stripEntries writes the kept lines verbatim — `kept.join("\n")`, no
trim, no appended newline: the split/join round-trip carries the file's own
trailing shape; emptied is every kept line blank (the init-created file
still deletes whole; a person file's trailing blank lines survive the
strip).
(d) The stale nested entry: gitignore.ts gains `staleNestedEntryLines(dir)`
beside the grammar's one home — the .gitignore lines shaped like a nested
-repository entry (`/`-led, `/`-closed) whose directory no longer exists on
disk. reset's plan reports them: the .gitignore entry's reason carries the
teaching when init entries strip, and a keep entry reports them alone when
nothing else would (nothing on disk proves the line the person's own —
delete by hand if it is init's stale entry). Never stripped: P12's
no-consume under uncertain ownership, P2's surfacing.
Regression pins: the person's 3+ blank-line run away from the block, their
leading blank lines and their trailing blank lines all byte-identical
through a reset strip (each red at HEAD — the old shapes collapse or trim
them); the seam collapsing to one blank line mid-file; the emptied rule
over the ensurePointer-created shell (unchanged); the append over trailing
blank lines preserving them (red at HEAD); the strip preserving leading and
trailing blank lines (red at HEAD); the stale-nested report (red at HEAD —
silent).

**D3 — 209: the host grant removed; the genericity scan holds the path
family.** templates/opencode.json's bash section loses `"/home/*": "allow"`
alone — redundant under `"*": "allow"` (no permission outcome changes), host
-specific (a /home layout convention), and unruled where the kept rows are
ruled (`/tmp/*` the receipts convention — 0147's boundary keeps /tmp
readable; the bun/npm/git rows the shipped contract's own documentation).
The scan: a new pin family over templates/ (every shipped template file)
refusing the home-directory path literals (`/home/`, `/Users/`, `/root/`,
`C:\Users\`) — the families of the finding's own scoped P16 grep; a
violation names the file and the literal. Standing projects are untouched
(init writes the template only where no opencode.json exists; fix's rules
never touched the bash section and start none now); reset's byte-comparison
keep rule is unchanged in code, with one recorded consequence: a
pre-0239-init project whose opencode.json still equals the old template now
compares unequal and reset keeps it as "content modified" — the honest
conservative direction (the file stays the person's to delete), named here
as the template-evolution cost the byte-comparison rule always carried.

**D4 — 210: the Log field emitted once; the red receipt's field sequence
pinned.** writeLaneReceipt keeps `Log:` in the common field array (where
the carried/absent arms already put it) and the red branch stops
duplicating it — the red block is the timed-out kill line (with its blank
separator) and the fence; the field sequence `# Lane / Lane / Heads /
Start / End / Verdict / (Carried | Log) / fence` pinned exactly, the red
receipt asserting one Log occurrence (red at HEAD: two). Green and carried
receipts byte-identical. No reader consumed the duplicate (measured); the
manual copy already teaches one Log line.

**D5 — 214: run's row joins requireConfigFile — the home plan already
owns.** The run command block calls `await requireConfigFile("run", true,
true)` after its flag parsing and before startRunLog — the
never-initialized directory refuses with the one-hop teaching (`nothing to
run: <dir> has no .opencode/auto/config.json; run opencode-auto init <dir>
first`), no defaults banner over a config that does not exist, no run log
spent, and --dryrun's precheck session never starts (the check precedes
it). The third parameter is the legacy floor: a legacy project (only
.auto/config.json holds its mode) is initialized by an older release and
runs on the documented legacy fallback — its banner note already teaches
fix — so run lets it through while plan keeps refusing it (the round setup
needs the full config, and fix writes it from the legacy mode); plan's and
amend's calls are byte-identical (the parameter defaults off). fix's own
init-teaching refusal is the family's third member — with run joining them
the two-hop chain is dead at every run entry. The core's
missing-file→defaults floor STANDS: it is init's own entry path and the
documented runAll contract; a core-side preflight refusal is declined on
the measured 13-site test floor (the core's suite drives
preflight/runAll over bare temp dirs by design). The service shell's ops
already refuse honestly (its own lifecycle ops teach the init operation by
route). Recorded observation, out of this step's scope: `transfer` on a
never-initialized directory still prints the defaults banner and stops on
the m-mode refusal teaching `plan` — a cousin shape one hop shorter (plan
then teaches init); no 0165 row names it.

**D6 — 218: the key-ring paragraph states the code's three gates.** The
README's walk sentences restate 0178's landed truth: the walk only ever
re-preferences an earlier key (a later key's passed hold never disturbs a
working current key), a consumed fork skips it (the fork rides the key path
its seeding act chose — a rotation's fork would otherwise undo the rotation
under a short stated reset), and a doc-lane session defers it whole (a
restart would kill the sibling lanes' open sessions; the recovered key
re-preferences at the next serial moment). The false invariant and its
false reason ("The walk never oscillates (the fork a rotation just seeded
rides the held key it landed on)") retire; the no-mark sentence stays (true
since 0163 D2, structural since 0178 D1). Pins in packages/auto's
docs-truth suite: the false claim's wording absent from the README, the
three gates' needles present — the paragraph can no longer outrun the code
silently.

Derives: P7, P10, P8, P12, P5, P13, P16, P18, P19, P2 (the showings
above). Amends: none — 0158 D2 STANDS and is extended (its law's letter
"deliberate 3+ blank lines in the person's prose are theirs to keep"
reaches the removal path it postulated); 0229 STANDS (consumed with its
census measured); 0178 STANDS (its Category scope named the README
paragraph — the lockstep half completed here, D1/D2/D3's gates stated);
0147 STANDS (the /tmp exception kept, the reason it survives named);
0138 STANDS (the nested entries' append rule untouched; the stale line
reported beside it); 0163 STANDS (its INDEX annotation already carries
0178's correction; the README now follows).

Tier: **code** (removePointer's seam cleanup, the append/strip byte
preservation, the stale-nested reader and reset's report,
writeLaneReceipt's single Log field, the shell's requireConfigFile call —
each with its regression pin) beside **documentation** (the README
paragraph, the template row — a shipped artifact — and the ruling itself).

premises this ruling changes: none — re-read standing: 0158 D2 (the
collapse gate — the removal path joins the law its comment states),
0229 D1/D2 (the switch table and its census — consumed, the ratchet the
guard), 0178 D1/D2/D3 (the walk's gates — the README half of their own
Category scope), 0147 (the /tmp allow — kept as the ruled exception),
0138 (the nested-entry stamp — the report arm beside the append rule),
0052 D4 (init's overwrite baseline — the template bytes change, the
mechanism untouched), 0096 D1's receipt grammar (the field set unchanged —
one duplicate occurrence retired, the sequence pinned), 0053 D14 (the
shared run-options seam — run's check precedes it, plan's shape copied),
and the shell contract's §D11 (requireConfigFile — run joins the family
the checklist names fix for; no new shell obligation: the check is
shell-local, the core learns nothing).

## Category scope (0123 D1 — the family: the surface hygiene above, measured at ruling time)

| home | kind | what |
| --- | --- | --- |
| src/agents-block.ts | code+doc | removePointer's seam-local cleanup; the 0158 D2 extension comment (D2a) |
| src/gitignore.ts | code+doc | appendEntries preserves trailing blank lines (D2b); stripEntries verbatim (D2c); staleNestedEntryLines (D2d) |
| src/reset.ts | code | the stale-nested report in planReset's .gitignore entries (D2d) |
| templates/opencode.json | shipped artifact | the /home/* row removed (D3) |
| test/template-genericity.test.ts | test | the home-path scan over every shipped template (D3) |
| src/script.ts | code | writeLaneReceipt's single Log field (D4) |
| test/script.test.ts | test | the receipt describe: the red receipt's exact field sequence with one Log, the timed-out shape, the green and carried floors (D4) |
| packages/auto/src/index.ts | code+doc | run's requireConfigFile call before startRunLog, the legacyRuns bypass (D5) |
| packages/auto/test/e2e.test.ts | test | the never-init run refusal (one-hop init teaching, no banner) (D5) |
| packages/auto/README.md | doc | the key-ring walk paragraph's three gates (D6) |
| packages/auto/test/docs-truth.test.ts | test | the false claim absent, the gates' needles present (D6) |
| test/reset.test.ts | test | the person-bytes pins through a strip: blank runs, leading/trailing lines, the seam, emptied (D2a/D2c/D2d) |
| test/gitignore.test.ts | test | the append/strip byte preservation; the stale reader (D2b/D2c/D2d) |
| plans/0239-hygiene-surfaces.md + plans/INDEX.md | doc | this ruling and its row |
| plans/0166-remediation/079-wc-hygiene-surfaces.md + plans/0166-three-package-remediation.md | doc | the step record, the ledger dispositions, the program row |

AGENTS.md and docs/structure.md: no key-file attribution changes — every
mechanism keeps its home (agents-block/reset/gitignore rows already name
these files; the receipt row names script.ts) — held, with the
template-genericity scan recorded in this ruling alone (a test home, not a
navigation surface).

Consumed and declined (recorded, not enacted): 062 whole (0229's landing,
census-verified); the core-side never-init preflight refusal (the measured
runAll floor); any migration or fix rule for standing projects'
opencode.json (P10/P2 — the person's once-written file).
