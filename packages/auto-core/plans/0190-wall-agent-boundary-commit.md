# 0190 — the wall's agent boundary declared, and the wall commit carrying its own deny

Status: active-authority (0166 remediation step 030, wave W4-wall-perms; findings 0165-040 = S20-04
and 0165-147 = S20-10, both CONFIRMED — S20-04 by trace over the adapter's contract translation and
the 0165 claudeperm repro, S20-10 by the wallstatus repro over a template-shaped opencode.json
tracked per 0138).

Two lies the wall family was telling, one per finding:

- **Under `agent: claude` the seal is a record with no enforcement** (0165-040): the close logs
  "a standing deny recorded" in `opencode.json` — but the claude adapter's translation (0041 D6's key
  map, ruled before 0122 existed) has no `external_directory` row (`contract.ts`'s `TOOLS`), so the
  boundary's `/**` deny, the 0122 allows and the wall's standing deny reach no claude session: under
  `--permission-prompts none` whatever Claude Code's own version-dependent read-outside-cwd default
  does is the whole truth, and under the allow preset (`bypassPermissions`) nothing remains. No
  ruling stated the limit.
- **Every wall commit's message records a false claim, and the wall's tracked retirement write is left
  out of its own commit** (0165-147): 0138 made `opencode.json` a committed project surface, but
  `closeWall`'s body still says "(${OPENCODE_CONFIG_FILE} is untracked machine state)", the
  retirement write (the standing deny in the now-tracked file) is excluded from the commit's pathspec
  (the door names alone), so the deny lands in the *next* phase-transition commit or stays dirty when
  completePhase's re-check holds after a successful close — and `external-dirs.ts`'s header still
  teaches "the machine-specific real path lives only in the gitignored opencode.json, never in git".
  0138's Category scope never enumerated the wall family's homes.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P12** — fail loud, conservative under uncertainty, degrade visibly: a close that logs "a standing
  deny recorded" while the run's sessions cannot receive it is a silent lie; the conservative reading
  of "can this fleet enforce the seal?" is no, and the refusal is the loud form. A commit message
  that states a falsehood in every wall record is the same class on the record side (P18's
  machine-addressable history carrying a permanent false claim).
- **P14** — one-way dependencies through declared seams: the wall is core and must not know adapters;
  *what an adapter can carry into its sessions* is exactly what `AgentCapabilities` declares — the
  seam 0040 built and 0055 §8.5 intersects over fleets. The wall consumes the declared fact threaded
  from the run start; it never names claude.
- **P19** — measured evidence: the finding's translation claims (claude reads outside its working
  directory by default; `Edit(/abs/**)` is settings-relative in Claude Code's grammar; `//`-prefixed
  absolute rules; `additionalDirectories`) are each marked PLAUSIBLE — not run. 0041's own doctrine
  is "adapter facts observed, not documented". Ruling the translation now would trade a measured lie
  for an unmeasured one; the declared-capability arm needs no unverified grammar fact, and the
  translation question keeps its probe-verified home in the adapter wave (0166 step 058, finding
  0165-033).
- **P2** — the person brackets every boundary: the close already rides the person's advance
  (transfer, 0189 D1); the refusal surfaces the agent question *at* that bracket with its remedy,
  instead of consuming the seal as done under an agent that cannot hold it.
- **P10** — the byte-identical floor: an undeclared wall touches nothing (0132's floor); a
  wall-declared project under opencode is byte-identical (the capability is true); a pre-0138 or
  deliberately local-only `opencode.json` (the person's own ignore line, 0138 D3) keeps today's
  commit shape exactly (an ignored file would fail the pathspec's `git add` — tracked-ness is the
  gate).
- **P8** — every surfaced line teaches its remedy: the refusal names the opencode advance and the
  config key; status renders the limit before the seal moment; the restated record teaches the
  file's real posture.
- **P4/P18** — the wall commit is the wall's own completion condition: one wall commit that carries
  the door removal *and* its own deny is the atomic seal 0132 D2 drew ("one wall commit"); the
  message restated tells the truth a fresh clone reads from git.
- **P5** — single ownership: the fleet's carried-posture fact has one home (the capability
  intersection at the run start, the `leadSplit` pattern), the commit's pathspec derives tracked-ness
  from git itself (never a second source).

## D1 — the carried external_directory posture is a declared capability; the close refuses without it (0165-040)

**The capability.** `AgentCapabilities` gains `externalDirectory?: boolean` — *the adapter carries
`opencode.json`'s `permission.external_directory` posture (0147's knowledge boundary, 0122's allows,
the wall's standing deny) into its sessions*; absent = it does not. The ninth conscious amendment of
the frozen agent domain file (the `heartbeat` amendment's shape: optional, additive, no existing
declaration breaks — P13/P14). The builtin records state it explicitly, as teaching: opencode
`true`, claude **`false`** (the adapter's own declaration of the limit 0041 D6's key map implies —
the map predates 0122 and was never extended; its translation question is the adapter wave's, below).
A shell-registered adapter's record carries it the same way (`registerAgentAdapter`); the fallback
record of an unregistered name stays false (P12: unproven = not carried).

**The refusal.** The fleet intersection (0055 §8.5, `degradeAgents` — one home) computes the fact at
run start — the fleet carries the posture iff every dispatch agent does — and threads it to the loops
beside `leadSplit` (`Degradation.externalDirectory?: false` → `StartedPool` → `LoopCtx` →
`WallCtx.externalDirectory?: false`; absent = carried, so every existing ctx literal and test floor
is byte-identical). `closeWall` — the person's advance path alone, ahead of the admission scan, so a
refused close mutates nothing — returns one blocking line when the fact is false: the standing deny
the close would record reaches sessions only through an agent that carries `external_directory`, the
seal would be a record with no session-side enforcement, and the remedy is the opencode advance
(`OPENCODE_AUTO_AGENT=opencode <bin> transfer <dir>`) or the config's `agent` key. Exit 2 through the
handover's existing block shape; the phase stays on its handover route, the door standing (P20:
nothing destroyed; a re-run under a carrying agent seals lawfully).

Deliberately **not** refusal moments: the post-wall boundary (the closed predicate re-derives and the
seal stands — a person who switches a sealed project to claude holds a named exposure, rendered by
status, not a permanently blocked project) and the seal-due hold paths (0189 D1 already hold them;
the close's refusal composes). And deliberately **no run-start degrade note** of its own: the
heartbeat amendment's precedent (a capability whose absence needs no clamp), because the
wall-undeclared floor must stay byte-identical and the boundary's *general* run-start note is
finding 033's question (step 058) — the wall-declared project learns the limit from status and, if
it reaches the moment, from the refusal.

**The rendering.** `status` (read-only, between runs, no host started) gains one ⚠ row when the
project declares a wall and the statically chosen adapter's record lacks the flag: the shell
profile's injected agent is the shell's own declaration (out of this read's reach, the named
residual); otherwise the choice is `OPENCODE_AUTO_AGENT` > the config's `agent` key > opencode
(`chooseAgent`'s tail, read name-only), and the record is the builtin constants or the
shell-registered adapter's. The row names the limit and the close's refusal — detection, not a gate
(P8), present pre- and post-seal alike (the deny is inert either way under such an agent).

**The declined arm, recorded.** Translating `external_directory` (claude `Read`/`Glob`/`Grep` denies
on `//<abs>/**` forms, `additionalDirectories` for the allows) is the finding's other remedy and the
better end state — but on today's evidence it would rest on three unverified grammar claims. It
stays the adapter wave's ruling (0166 step 058, finding 0165-033, whose remedy already names the
probe); the capability seam is built so that ruling's enactment flips one declared value and the
wall's refusal lifts with it. `contract.ts`'s header table gains the boundary row teaching the limit
(honest now, and the seam 058 edits); the pinned translation table in `test/agent-claude.test.ts`
gains the `external_directory` case asserting it emits no rule today — a ratchet 058 updates
consciously, not a silent drift.

## D2 — the wall commit carries its own deny; the record's words tell the file's real posture (0165-147)

**The pathspec.** `closeWall`'s commit pathspec grows `opencode.json` **iff git tracks it** (one
`git ls-files --` read): tracked (0138's posture — by the first run the person has committed the
config layer, else the clean gate would have blocked) the retirement write lands in the wall commit
itself — the atomic seal, and a gate hold after a successful close no longer leaves a dirty tracked
`opencode.json` for the next run's clean gate to read as dirt; untracked or ignored (a pre-0138
project, or the person's own local-only line — 0138 D3's manual posture) the pathspec stays the door
names alone, byte-identical, because `git add` refuses an explicitly-named ignored file and the close
must not start failing there (P10). The recovered-only close (no present doors) keeps its existing
whole-tree record commit — the write already rides it. A tracked-but-otherwise-dirty `opencode.json`
at the close cannot happen inside a run (protect holds it read-only; the preceding phase's close
committed everything), so the pathspec absorbs exactly the driver's own retirement write.

**The message.** The body's false clause is restated. The record lines stay the record (`Wall-door:`
name → target, `Wall-sealed:`; the parser unchanged, old records in history still parse — P13); the
prose now says what the file is: the targets are the door→target ledger, and the standing deny on
each target lives in `opencode.json` — carried by this same commit when the file is tracked (0138's
committed-surface posture), the person's local-only file keeping this record the only tracked copy.
The same restatement lands in the stale comments: `wall.ts`'s header (D2's close step), the
`WallRecord` doc ("untracked machine state, so the tracked record must carry it" → the ledger
wording), `retireAndDeny`'s ("one idempotent write to the untracked opencode.json" → the
permission-file half, its tracked-ness named), the close-site comment ("the untracked half of the
wall"), and `external-dirs.ts`'s header (the P6 parenthetical "the machine-specific real path lives
only in the gitignored opencode.json, never in git" → the file is a committed project surface since
0138, the person's local-only line theirs, the real path reaching git with the file when tracked).

**The annotation.** 0138's INDEX row gains the premise note naming the homes its Category scope
missed (wall.ts's record and retirement, external-dirs.ts's header) and this ruling's restatement —
the premise guard's advisory grammar doing its work at audit time.

## The floors

- No `Wall:` declaration: no wall machinery, no refusal, no status row — byte-identical (0132's
  floor; the capability flag itself changes nothing any run reads).
- A wall-declared project under opencode (or any fleet whose every agent declares the posture): the
  fact is absent-from-`Degradation`, the close runs exactly as at HEAD — byte-identical.
- A claude (or non-carrying) run on a wall-**undeclared** project: no refusal, no note, no row — the
  boundary's general translation gap is finding 033's, untouched here.
- `opencode.json` untracked or ignored at the close: the pathspec and the commit shape are exactly
  HEAD's (only the message's stale clause is gone — the ruled defect fix, P10's exemption).
- Post-wall boundaries and the seal-due holds: unchanged.
- Every existing `WallCtx`/`LoopCtx` literal, test double and shell call: unchanged (the new fields
  are optional).

premises this ruling changes: **0041** (D6's key-map completeness premise — the map predates 0122's
`external_directory` section and silently skipped it; re-read in the same change: D6's
translate-don't-duplicate shape and D7's presets stand; the missing row becomes the declared
`externalDirectory: false` capability and the adapter wave's probe-verified translation question,
0166 step 058), **0138** (its Category scope missed the wall family's homes — `wall.ts`'s commit
message/retirement and `external-dirs.ts`'s header kept teaching "untracked machine state" after the
file became a committed surface; re-read in the same change: D1–D5 stand unchanged; the missed homes
restated here and the row annotated in INDEX). 0132 re-read and stands with one restatement: D2's
"one wall commit carrying the door removal" gains its own deny in the same commit when the file is
tracked — the atomic reading D2's own words drew; 0147/0155/0188/0189 re-read and stand (the
boundary's keys, the recovery, the matcher mirror and the close's shape are untouched; 0188's
README residual — the contract paragraph's translation claim — disposes with the limit stated).

Derives: **P12** (the showing: the seal's false "standing deny recorded" log and the record's false
"untracked" clause are silent lies made loud — the one by refusal, the other by restatement and
atomicity), **P14** (the declared seam — the wall consumes a capability the adapters declare, never
an adapter's name), **P19** (the declined translation arm: unverified grammar claims are not a
ruling's ground; the capability arm needs none), **P2** (the refusal lands at the person's bracket
with its remedy, the seal never consumed as done), **P10** (the floors above; the tracked-ness gate
keeps the pre-0138 commit shape), **P8** (the refusal, the status row and the restated record each
teach), **P4/P18** (the wall commit atomic with its own deny; history's record true), **P5** (one
home for the fleet fact; tracked-ness derived from git), **P13** (the capability grows additively
and optionally; the record's grammar untouched; old records still parse). Tier touched:
**mechanism** — `src/agent/types.ts`, `src/capability.ts`, `src/agent-pool.ts`, `src/wall.ts`,
`src/status.ts`, the adapter constants, the loop threading, the test homes; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the wall's session-side enforcement — which agent carries `opencode.json`'s
external-directory posture into sessions — and the wall record's truth against 0138's
committed-surface posture* (0132's enforcement family meeting 0041's adapter contract and 0138's
committed surfaces). Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/agent/types.ts` (`AgentCapabilities.externalDirectory`, the ninth amendment note) | changed — D1 |
| `src/agent/opencode/client.ts` (`OPENCODE_CAPABILITIES.externalDirectory: true`) | changed — D1 |
| `src/agent/claude/client.ts` (`CLAUDE_CAPABILITIES.externalDirectory: false`, stated) | changed — D1 |
| `src/agent/claude/contract.ts` (the header table's boundary row, teaching the limit) | comment — D1 |
| `src/capability.ts` (the intersection's field; `Degradation.externalDirectory?: false`; the table row) | changed — D1 |
| `src/agent-pool.ts` (`StartedPool.externalDirectory?: false`, threaded at both start sites; the fallback record gains the flag) | changed — D1 |
| `src/loop-task.ts` (`LoopCtx.externalDirectory?: false`, beside `leadSplit`) | changed — D1 |
| `src/loop.ts` (the ctx literal threading) | changed — D1 |
| `src/wall.ts` (`WallCtx.externalDirectory?: false`; the close's refusal ahead of the admission scan; the pathspec's tracked-`opencode.json` half; the message restated; the stale comments restated) | changed — D1/D2 |
| `src/external-dirs.ts` (the header's P6 parenthetical restated) | comment — D2 |
| `src/status.ts` (the ⚠ row over the static agent choice) | changed — D1 |
| `packages/auto/README.md` (the agent table's claude row names the boundary/wall limit; the contract paragraph's translation claim gains the limit — 0188's README residual) | restated — D1 |
| `plans/INDEX.md` (the 0190 row; 0138's row annotated with the missed homes) | changed — D2 |
| `AGENTS.md` (the navigation line gains 0190) | restated |
| Test homes: `test/wall.test.ts` (the refusal; the atomic commit; the clean tree; the message; the untracked floor), `test/capability.test.ts` (the intersection and the threading), `test/agent-claude.test.ts` (the capability record; the `external_directory` no-translation ratchet) | changed |
| The wall's closed predicate, recovery, sealed-channel check (`stampWallClosure`, `admittingCoverage`, the D2/D3 machinery of 0189) | held, untouched — the findings measure the close's reach and record, not the predicate |
| `src/agent/claude/host.ts`, `stream.ts`, `client.ts`'s process machinery | held, untouched — step 058's findings (033/136/202/203) own them |
| The run-start degrade notes for the *general* boundary gap | deferred to step 058 (finding 033) — with reason: one question, one ruling, its own probe |

## Residuals

- **The shell profile's injected agent** cannot be resolved statically in `status` (the profile
  carries a host factory, not an adapter record): the row skips it — the shell's own declaration is
  its own teaching; a shell that wants the row registers its adapter's record.
- **No run-start note** for a wall-declared project running a non-carrying agent (the refusal and the
  status row carry the wall's half): the general boundary note is finding 033's, step 058.
- **The translation itself** (claude carrying the posture for real) is step 058's probe-verified
  ruling; until it lands, a claude project can seal only by advancing under a carrying agent — the
  honest state, not a workaround.
- **A registry fleet with claude candidates**: the refusal names the fleet and the built-in opencode
  escape; narrowing a registry's agent filter to drop claude candidates is the operator's registry
  edit, not taught line-by-line by the refusal (the wall does not know the registry's shape).
- 0189's residuals stand unchanged (agent-level permission sections, interior-wildcard ancestors,
  deeper untracked symlinks, the persistent-reopen register).

## Tests

- `test/wall.test.ts`:
  - the refusal (D1): a seal-due close under `externalDirectory: false` blocks with the refusal line,
    the admission scan never run, the door standing, nothing written — fail-before red on the
    pre-fix source (the close proceeded into the admission block);
  - the atomic commit (D2): over a tracked `opencode.json`, the wall commit's diff carries the file
    beside the door removal, `git status` after the close shows no modified `opencode.json`, and the
    message carries the restated ledger wording with no "untracked machine state" clause — all three
    fail-before red (the write excluded, the tree dirty, the false clause present);
  - the untracked floor (D2): a gitignored `opencode.json` closes exactly as at HEAD — no config
    path in the commit, the deny in the local file, the message restated (the defect fix's own
    bytes).
- `test/capability.test.ts`: the intersection — an opencode fleet carries the posture (absent from
  `Degradation`), a fleet with claude does not (`externalDirectory: false`) — fail-before red (the
  field did not exist).
- `test/agent-claude.test.ts`: `CLAUDE_CAPABILITIES.externalDirectory === false` beside
  `OPENCODE_CAPABILITIES.externalDirectory === true`, and `claudePermissions` emits no rule for the
  boundary-carrying `external_directory` section (the ratchet 058 updates when it translates) —
  fail-before red on the capability pin (the field did not exist); the no-translation pin passes
  before and after (it pins the current truth, named).
- `src/status.ts`'s row: pinned through the wall suite's declared-project fixtures where cheap (the
  row over a claude-configured declared project); the shell-injected and undeclared floors stay
  covered by the existing status suites' byte-identical pins.
