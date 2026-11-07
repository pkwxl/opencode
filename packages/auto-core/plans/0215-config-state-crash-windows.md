# 0215 — the config layer's crash windows: the brief-move's idempotence, sync's verdict over a broken config, the committed-state writes' atomicity

Status: active (ruled by 0166 step 055, 2026-11-08). Three findings of the
0165 register out of the S22 config/materialization review: **0165-155**
(S22-03, S3 — fix's source/destDir→brief move is not idempotent across the
brief→config write gap), **0165-156** (S22-04, S3 — sync answers a broken
config.json with ✓ exit 0, `bundleNameOfConfig` swallowing the load
failure) and **0165-157** (S22-05, S3, PLAUSIBLE — the config layer's
committed-state writes are plain `Bun.write`, not write-then-rename). One
family, the S22 review's own diagnosis: "every apply is a plain
sequential await over committed files with no atomic rename and no
idempotent re-derivation for the in-between states — P6's 'every step
idempotent' holds for the happy path but not for the kill points."

The boundary answers first (the requirement-intake rule): the family is
*the config layer's durable state and its kill points*. Home-set: the
move rule (`src/config-fix.ts` planKeys/planFix, the brief write among
the plan's writes), the bootstrap's bundle resolution and the sync apply
(`src/sync.ts`), the config write seam (`src/config.ts`
saveConfigRecord — init, amend and fix all write through it), the
brief's whole-file writers (`src/brief.ts` installBriefProposal,
config-fix's move write, config-op's `amend --brief`), init-time
materialization (`src/bundle.ts` materializeIntentBundle — the writer of
the very files applySync writes, its interrupted shape 0214 D2's own
named window), the consuming sync row (`packages/auto/src/index.ts`),
the test homes (`test/config-fix.test.ts`, `test/sync.test.ts`,
`test/config.test.ts`, `test/config-op.test.ts`, `test/bundle.test.ts`,
`test/brief.test.ts` — new, the brief module's first direct home) and
the documentation homes (plans/INDEX.md, AGENTS.md navigation,
docs/structure.md). 0165 is the evidence, not the authorization: every
decision below is ruled here.

## Derivation and Category scope

Derives: P6 (recovery is re-derivation from disk — D1's re-run must
recognize the block it itself landed, not append it again; D3's killed
write must leave the old complete file so the healing commands can heal
— the defect's own impact statement is "the healing command refuses to
heal"), P12 (fail loud — D2's load failure surfaces as sync's exit-1
verdict, never swallowed into a green nothing; D1's recognition is
byte-exact so an uncertain reading resolves toward today's append;
D3's replacement never guesses content), P20 (in-flight work is never
destroyed — a kill inside a write leaves the previous complete state,
never a truncated one), P10 (every untouched shape byte-identical: the
honest nothing-path message, the append for a genuinely absent block,
every file's bytes, the stamped project's sync that never reads the
config), P5 (one home per mechanism — D1's guard sits where the move is
derived, never per consumer; D2's verdict derives where the config is
loaded; D3's discipline lands at each writer, no mirror state), P7 (D1
recognizes a byte-exact line-run the tool itself renders — a grammar of
its own making, never content judgment), P8 (the re-run's change line
teaches what fix will actually do), P13 (no vocabulary word moves: sync
joins the config-command family's existing exit-1 over a broken config
— the frozen code's environment-error arm, extended to the one command
that missed it), P18 (plain files and rename — the durable record
survives kills with no special tooling).

premises this ruling changes: **0100 D5** — the bootstrap's nothing-path
letter ("No stamp: for each file the running bundle would write…", with
`nothing` reading "no provenance stamp and the config's intent names no
bundle") carried the premise that the config's intent answer is always
knowable. Measured false: `bundleNameOfConfig`'s catch folded *the
config cannot load* into *the intent names no bundle*. The nothing
verdict now requires a config that loads; a broken one is sync's
failure (exit 1 naming the file, fixHint where a rule applies) — the
0100 INDEX row is annotated in this change. 0052 D10's move letter
("moving the retired source/destDir into brief.md (appends to its
sections)") is completed, not invalidated — the append still fires for
a genuinely absent block; no consumer rests on duplication (re-read,
standing, unannotated). 0209 D2's write-then-commit idempotence is
re-read: D3 changes the mechanism inside the write, the compare/write/
always-commit premise stands unannotated.

Tier: mechanism (the rule table's move rule, the sync plan's failure
direction, the write discipline — no constitutional principle moved).

### Category scope

- Code homes: `src/config-fix.ts` (D1 the move's recognition; D3 the
  brief write's discipline), `src/sync.ts` (D2 the catch removed; D3
  applySync's discipline), `src/config.ts` (D3 saveConfigRecord),
  `src/brief.ts` (D3 installBriefProposal), `src/config-op.ts` (D3 the
  `amend --brief` write), `src/bundle.ts` (D3 materializeIntentBundle),
  `packages/auto/src/index.ts` (D2 the sync row's catch — the family's
  land/status/amend shape). Test homes: the six files named above.
  Documentation homes: this document, plans/INDEX.md (the 0215 row +
  the 0100 annotation), AGENTS.md (the config-fix and sync navigation
  lines), docs/structure.md (the Project config and Bundle sync rows).
- auto-server (the register's S30 twin note): checked, negative —
  OP_DEFINITIONS serves init/amend/fix/reset/close/tasks/plan/transfer/
  models and no sync segment exists; its `runFix` delegates to core
  `planFix`, which answers an unparsable config with the honest manual
  finding. The core fix reaches every consumer through the one module;
  no auto-server source touched, its baselines stand.

## D1 — the move recognizes its own landed block (0165-155)

The defect: applyFix orders the brief write before the config write
(correct — the value is never lost), but planKeys re-derives the brief
from the config record on every run and `appendToSection` appends
unconditionally, so the re-run after a kill between the two writes
appends the same block again — the committed brief grows the duplicate
the review measured ("moved line occurrences after re-run: 2"), and
nothing flags it as the tool's own.

The ruling (P6): the re-derivation reads the disk it wrote. For each
retired key, the move renders its block (`sourceLines`/`targetLines` —
bytes the tool itself deterministically derives from the record) and
checks whether that exact block — whole lines, in order, byte-exact —
already sits in the target section:

- present → the append is skipped and the finding's change line states
  the truth: "its value already sits in brief.md under ## Source (or ##
  Target); drop the key" (P8 — the surfaced remedy is what fix will do).
  `planKeys` returns a brief text only when some append actually changed
  it, so the re-run's plan carries **no brief write at all**: the
  writes list is the config write alone, and after it lands the next
  run is the ordinary clean no-op.
- absent → `appendToSection` exactly as today (P10 — byte-identical;
  the section is created when missing, the heading and block land whole).

The recognition is a byte-exact line-run over the section's bounds
(the same heading/next-heading grammar `appendToSection` itself walks) —
P7's fence: the tool matches a rendering of its own making, never a
judgment about a person's wording. A person's differently-worded value
never matches and keeps today's append (P12's conservative direction);
the retired-key message's own hand remedy ("copy its value … into
brief.md, then remove the key") produces the exact bytes when followed
literally, and fix recognizes that hand move the same way — the
idempotence covers the taught channel, not only the crash window.
`appendToSection`'s own contract is unchanged (the guard is the move's,
at its one derivation home — P5).

## D2 — sync's verdict over a broken config: the failure surfaces, exit 1 (0165-156)

The defect: `bundleNameOfConfig`'s `catch { return undefined }` folds
*the config does not load* (invalid JSON, a strict retired-key failure)
into *the intent names no bundle*, so the unstamped bootstrap answers
"✓ nothing to sync: no provenance stamp and the config's intent names
no bundle" with exit 0 — while run, status, amend and land exit 1 over
the same file. An operator scripting sync as a health gate reads clean
on the one project whose config is broken.

The ruling (P12): the load failure propagates. The catch is removed —
`planSync` rejects with the loader's own message (".opencode/auto/
config.json is not valid JSON: …", or the retired-key message that
teaches its remedy), and the shell's sync row catches it with the
config-command family's established shape (land's own: the error, the
`fixHint` line when a fix rule applies, exit 1 — P13's frozen
environment-error arm, no new word). The honest nothing-path is
untouched (P10): an unstamped project whose config loads and names a
plain pack (or names no intent) still prints the byte-identical
nothing message and exits 0; a stamped project never reads the config
at all (the stamp names the bundle) and syncs exactly as before.

## D3 — the config layer's committed-state writes become write-tmp-then-rename (0165-157)

The finding is PLAUSIBLE (reproduction infeasible — the window is one
write syscall truncated by a kill); the reachability is verified from
the read paths before ruling, per the protocol: a truncated config.json
makes `readConfigRecord` throw "not valid JSON", so **init** refuses at
`loadOverwriteBaseline` (the full-overwrite that would clear it cannot
read its baseline), **amend** refuses at `loadProjectConfig`, **fix**
reports "not valid JSON" as a *manual* finding (the rule table never
rewrites what it cannot parse — 0052's own contract), and run/status
exit 1 — every healing command refuses to heal until the person
hand-repairs the JSON. The same shape holds for the brief's writers
and sync's managed files. CONFIRMED as a mechanism with infeasible
direct reproduction; the pin uses the deterministic stand-in below.

The ruling (P6/P12/P20): every whole-file write to the config layer's
**committed** state goes through write-tmp-then-rename — the discipline
the corpus already holds for `.auto/` state (`resume.ts` 0183 D2,
`tasks.ts`, `stats.ts`, `handover.ts`, `resolve.ts`), extended to the
committed plane:

- The tmp lives in `<dir>/.auto/` — the driver workdir whose untracked
  strays the ignore law already declares never-dirt (0141) — so a kill
  in the microsecond window between tmp write and rename leaves a
  never-blocking stray, never a blocking untracked file beside the
  target and never a truncated tracked one. The name is
  `.<basename>.<pid>.<seq>.tmp` (the concurrent-writers discipline of
  resume/handover: each write its own ordinal).
- The tmp is chmod 0644 before the rename — the exact mode the old
  paths guaranteed — and the target's parent (and `.auto/`) are mkdir'd
  recursive (Bun.write's own parent-creation, kept).
- Rename replaces the entry: a stale 0444 left by a killed run (the
  protect bit) no longer blocks the healing write — rename needs the
  directory's write, not the file's. saveConfigRecord's pre-chmod,
  whose comment told exactly that EACCES story for the in-place write,
  is retired with it (the tmp's chmod keeps the mode contract);
  installBriefProposal keeps `allowWrite`/`reprotect` around the whole
  mutation (the protect contract's shape; reprotect runs after the
  rename, on the new inode).

The homes (the family's whole-file writers, enumerated): `saveConfigRecord`
(config.json — init, amend and fix through the one seam), the brief's
three whole-file writers through the file's one write home (brief.ts's
`writeBrief`: installBriefProposal, the fix move's write, `amend
--brief` — P5's single-writer letter held at the file level, the two
driver-plane consumers importing the document entry they already
imported), `applySync`'s `writeManaged` (the managed files and the
sidecar — the sidecar still last), and `materializeIntentBundle` (the
init-time writer of the same managed files — 0214 D2's own "killed
materialization" window's file half; the stamp half converged there, the
truncated-file half dies here). Each writer ends with a best-effort
`rmdir` over an *empty* `.auto` — the person commands never leave the
driver workdir's directory behind (the lock's own createdDir discipline:
a fresh project keeps no `.auto` until a driver runs; a live run's lock
or a sibling's in-flight tmp keeps it standing, and only a provably
empty directory is ever removed — P20). Out of category, named: the
append-only `.gitignore` writes (the finding's own "lower risk" family —
a truncated append line no longer matches and the next ensure re-adds
it), the agent contract and opencode.json template/stamp writes
(unmeasured by 0165 — a truncated contract is fix-healed by the
differs-from-the-template rule; a truncated opencode.json degrades to
fix's manual finding), AGENTS.md (local-only by 0138, re-derived at
every run start), and every process document outside the config layer
(their crash windows are the resume family's, step 076's). No shared
helper *module* is built (P21/P5 read: a new leaf would drag
CLASSIFIED/DOMAIN_ENTRIES table edits for a four-line idiom; the brief's
one-home consolidation rides the module that already owns the file).

### Residuals (named, not enacted)

- The pre-0215 atomic writers (tasks, stats, resume, handover, resolve,
  knowledge) keep their per-home forms — migration on their own next
  touch; their targets already live in `.auto/`, where the stray
  question is moot.
- A kill between the tmp write and the rename leaves the stray in
  `.auto/` (never dirt by law; the next write of the same home does not
  clean foreign ordinals — a `fix`-side sweep was declined on P21
  grounds, no measured accumulation).
- An exotic mount putting `.opencode/auto` on another filesystem than
  `.auto` makes the rename EXDEV — the write fails loudly (P12), the
  person sees it; no fallback to the corruptible in-place write is
  built.
- D1's recognition covers the block, not the section's whole history: a
  person holding BOTH their own wording and the crash-landed canonical
  block keeps both (the tool's block is present; the append correctly
  skips; the person's line is theirs to remove).
- The oracle for saveConfigRecord is the inode replacement (the
  pre-write chmod defeats the read-only stand-in); the crash window
  itself remains unpinnable, as the finding itself states.

## Enactment lockstep

Code and tests in one change; the pins are red on pre-fix source (the
D1 re-run's duplicated block and present brief write; D2's resolving
nothing-verdict over a broken config; D3's EACCES refusals and the
in-place inode). The shells: packages/auto's sync row re-measured
against its recorded baseline; auto-server untouched (the twin check
negative), its baselines standing.
