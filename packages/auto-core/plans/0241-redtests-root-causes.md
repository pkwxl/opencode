# 0241 — The red-tests wave: the seven standing failures root-caused, every coverage item dispositioned

Status: **active**. Ruled 2026-11-10 by 0240 step 002 (wave red-tests). The
ruling is the investigation's product: every standing failure reproduced at
HEAD `857ce0b18`, every root cause measured — three of them proven at
mechanism level by one-line probes on HEAD's own source, each probe restored
and cmp-verified byte-identical — and every coverage item of the 0240
program's list dispositioned (fix or consciously ruled retirement, each with
its reason and its enactment step). The enactment steps are 0240's table rows
005–008; this document's decisions are their authority. No code, test or
runtime-documentation home changes in the ruling's own step.

## Derivation

Derives: **P19** (measured evidence — every root cause below is a measurement
at HEAD: the reproductions by name, the fixture commit bodies read back from
git, the 409 body of the server drift, the timing census re-measured on this
host, and the three mechanism probes whose one-line reverts turned each
failure set green, restored byte-identical after), **P13** (frozen additive-
only vocabularies — the trailer-block witness is 0173 D2's consciously ruled
grammar and it stands; the fixtures that speak a shape the driver's own
writer never produces are the defect, and they lockstep to the writer's
grammar rather than the reader widening — a whole-body match is exactly the
accidental shape 0173 D2 retired), **P10** (the byte-identical floor — every
disposition is test-home-only; the product's ruled behavior at HEAD
(0173 D2's read, 0206 D2's refusal, 0207 D1's pathspecs) is untouched, and
the probes that reverted each behavior locally were the proof method, never
the change), **P12** (fail loud — the seven failures stood surfaced across
the 0166 baselines and the v0.4.0 cut without being swallowed into a clean
verdict; this wave closes each one through its own fix or a named
retirement, the failures' honest life recorded), **P18** (the record
outlives the tool — the root causes, datings and dispositions live in this
document, the step record and the program table, not in any session's
memory). It Amends none — the constitution is complete for every decision
here. Tier: **tests** (the three fix families' homes are test files in
`packages/auto` and `packages/auto-server`; no runtime or documentation home
changes).

## The measured findings

Reproductions at HEAD `857ce0b18` (the step record carries the exact
commands and outputs): `packages/auto` **173 pass / 8 skip / 6 fail** — the
exact recorded v0.4.0-cut baseline, the six failures by name (the phased-P1
e2e, fork ×2, remove-fork ×3); `packages/auto-server` **176 pass / 2 fail**
on this host — the known planPrelude drift by name, plus one environment-
shaped failure this ruling dispositions as an observation, not a coverage
item (below). The frozen-key timing case re-measured **3056–3060 ms** on
this host (two consecutive runs; 0166 step 073 measured 4143.79 ms on its
host).

### Finding 1 — the five fork-family e2e failures (coverage items 2 and 3)

The five failing tests (fork: "fork runs beside a live run lock", "the task
form's happy path"; remove-fork: the teardown happy path, uncommitted-work
blocks, a live run inside the fork refuses) all fail at their first
`runCli(["fork", "T-00N", ...])`: fork exits 1 with "no commit of this
repository carries the trailer Auto-Task: T-00N".

**Root cause (measured)**: ruling 0173 D2 (0166 step 013, commit
`6d643b0ac`, 2026-11-06) changed `taskFirstCommit` (`src/git.ts`) from a
whole-line trailer match anywhere in the body to the trailer-block read —
the Auto-Task key from the body's **last paragraph** only, the one grammar
of `message()`'s writer. The two e2e fixture helpers (`packages/auto/test/
e2e.test.ts:3875` and `:4000`, the fork and remove-fork `taskProject`s)
author their "driver-style task commits" with three separate `-m` flags;
git joins `-m` paragraphs with blank lines, putting `Auto-Task` in **its
own paragraph**, never the last — a body shape the driver's own `message()`
never produces (it writes subject, optional body, then ONE trailer paragraph
holding Auto-Task, Auto-Stage and the Auto-Nested lines together,
`src/git.ts:52-61`). `trailerBlock()` therefore returns a block whose only
key is `Auto-Stage`, the scan misses every fixture commit, and fork refuses.

**Proof**: reverting only 0173's read line in HEAD's `src/git.ts` (the
whole-line match restored, nothing else) turns all five tests green — "fork
runs beside a live run lock" 1/1, the remove-fork describe 5/5 — with the
file restored and cmp-verified byte-identical after. The dating agrees: no
`packages/auto` suite run is recorded between 0166 steps 013 and 029; step
029 (2026-11-07) first records "149/8/5 — the 5 pre-existing fork
failures", and every later step through the v0.4.0 cut carries them as the
standing baseline, never dated to their cause until this step.

**Disposition — fixed by enactment step 005** (test home only): the two
`taskProject` helpers author the driver's real shape — the trailers as ONE
`-m` paragraph (`Auto-Task: <id>\nAuto-Stage: execute`), the shape
`auto-core/test/fork.test.ts` already produces through the real `commitTree`
writer — and the helpers' stale belief comment ("the trailer block git's
-m paragraphs produce matches the scan's line grammar", false since 0173)
is restated. The reader's grammar stands (P13): widening it to a whole-body
match would reopen exactly the accidental shape (a quoted message above the
block) that 0173 D2 retired. Fail-before is the standing red at HEAD; the
five tests green at the fix.

### Finding 2 — the phased-P1 e2e failure (coverage item 1)

The walkthrough ("roadmap-driven establishment, the round-brief proposal
channel, and the amend --phases coverage refusal") fails at its second
transfer: exit 2 where 0 is expected.

**Root cause (measured)**: the walkthrough never commits init's config
layer (`.gitignore`, `.opencode/agent/auto.md`, `.opencode/auto/config.json`,
`opencode.json` — no `commitFixture` anywhere in the test). It passed before
ruling 0207 D1 (0166 step 047, commit `030b0bb94`, 2026-11-07) only because
the pre-0207 brief-install commit was pathspec-less: it folded ALL dirt —
including the person's never-committed config layer — into the driver's
`PLAN brief install` commit, unlisted (the exact defect 0165-013/S07-06
ruled). 0207 D1 scoped the three release consumptions to their own write
surface (`src/brief.ts:170` commits exactly `[BRIEF_FILE, source]`), the
person's dirt left to the one gate that owns judging it. The config layer
now survives to the review stop's start-clean gate
(`src/loop-preflight.ts:725`), which correctly blocks exit 2 naming the
files — the CLI reproduction shows the whole sequence: the establishment,
the brief install, the round-start commit and the verbatim round-brief
install all succeed, then the gate lists exactly the four config-layer
files.

**Proof**: dropping only the brief-install pathspec in HEAD's `src/brief.ts`
(the pre-0207 absorbing shape, nothing else) turns the walkthrough green
(1/1, 20 expects), restored and cmp-verified byte-identical after. The
converse holds at the CLI level: with the config layer committed at the
taught channel, transfer exits 0 and prints every line the test expects
(the sourced establishment line, the round-brief install, "review stop: the
formulation todo"). The dating agrees: step 046's close recorded auto
160/8/5 (this test green); no auto suite run is recorded for steps 047–049;
step 050 first records 159/8/6 — the flip is step 047's consciously ruled
change, undetected because step 047's verification ran core only.

**Disposition — fixed by enactment step 006** (test home only): the
walkthrough gains the person's commit at the taught channel — a
`commitFixture(dir)` after the stub transfer and before the released
analysis's re-run (both placements proven at the CLI level; the
recommended one also pins 0207 D1's own uncommitted-hand-release arm — the
released analysis riding the brief install as its evidence). The product's
behavior stands (0207 D2's scoped commits, the gate's exit 2): the test
was riding the defect 0207 fixed. Fail-before is the standing red at HEAD.

### Finding 3 — the auto-server planPrelude boundary matrix (coverage item 4)

The matrix test fails at its row 3 (the drift re-sync): after committing a
released analysis whose `R-01 adm` roadmap line widens the round, `POST
/projects/<name>/plan` returns **409** where the test expects 200 with
"phase index of round R-01 re-synced".

**Root cause (measured)**: ruling 0206 D2 (0166 step 046, commit
`2b38d4bbe`, 2026-11-07) retired plan's re-sync apply — plan's row 3,
phased, refuses before any write naming transfer as the reshape's one
apply, "the retired 'run plan to re-sync' spellings dying with the apply
they taught". The change lockstepped `packages/auto/test/e2e.test.ts`'s
drift describe (its diff is the form) but `packages/auto-server/test/
ops.test.ts`'s boundary matrix carries its own mirror of the drift row
(line 628's comment and the assertions at 639–644) and was not in the
change's touched set — the server mirror went stale, still expecting the
apply 0206 retired. At HEAD the server's plan operation correctly refuses
(409, code 1, "the phase index of round R-01 differs from the roadmap of
docs/analysis.md: transfer re-derives the unstarted tail on its own commit
— run: opencode-auto-server transfer <dir>", measured verbatim).

**Disposition — fixed by enactment step 007** (test home only): the
server's row 3 locksteps to 0206 D2's refusal shape — 409, code 1, the
differs/transfer fragments, nothing written (the index unchanged, no
P03-implement seed) — and the row's comment (and the file header's
"drift re-sync" phrase) restate the 0206 channel. This is 0206's own
category completeness completed late: the family's home-set had a member
the change missed. Fail-before is the standing red at HEAD.

### Finding 4 — the D3 timing observation (coverage item 5)

The frozen-key e2e ("run refuses options frozen by init", `packages/auto/
test/e2e.test.ts:710`) is one test over ~25 CLI spawns (16 in the frozen
loop, 9 individual arms): **3056–3060 ms** at HEAD on this host
(~0.12 s/spawn), **4143.79 ms** on 0166 step 073's host (its measurement,
0233 D3's deferral) — 61–83% of bun's 5 s per-test default, past the
deterministic-tests family's guideline (each test under roughly half the
default, the census's largest family ~2 s; S00-01's breach class, 0233's
How-to-rule discipline). No register row names the case (0233 D3's own
finding); the deferral's named home is this wave.

**Disposition — fixed by enactment step 008** (test home only): the case
splits per family, 0224 D4's standing form (the server's own frozen-key
case was split into five family tests by that ruling, rows verbatim,
coverage identical): the frozen-constitutional loop, the --phases remedy
arm, the paired revision hints, the short-form arm, the retirement arms,
the rename arms, the loneliness arm — each family its own test, the spawn
count per test bounded so none rides past the guideline on either measured
host. This discharges 0233 D3's deferral at its named home. Fail-before is
the timing measurement itself (the census the step records before and
after).

### The environment-shaped failure this ruling does NOT adopt (recorded as an observation)

`packages/auto-server`'s "an IPv6 bind writes a bracketed transport URL the
worker's own validator accepts (0165-169)" fails on this host —
`EADDRNOTAVAIL` on `::1`: this host's loopback carries no IPv6 address at
all (`ip -6 addr show lo` empty; a minimal `Bun.serve({hostname: "::1"})`
reproduces the same errno). The recorded v0.4.0-cut baseline (177/1) was
measured on an IPv6-capable host. This is a host-environment limitation,
not a code defect and not one of the program's seven: recorded in the
program's observations list; no step of this program fixes it (a skip-gate
ruling would need its own measured basis — none exists).

## Category scope

The requirement family (one per decision): **the e2e truth surfaces that
mirror ruled product behavior** — the shell packages' e2e tests are pinned
mirrors of the core's ruled grammars and boundaries; a conscious product
change locksteps every mirror in its own change. The family's home-set at
ruling time:

| home | carries | this ruling |
| --- | --- | --- |
| `packages/auto/test/e2e.test.ts` — the two `taskProject` helpers (:3875, :4000) | the driver-style trailer commits the fork family derives from | **changed** (step 005) |
| `packages/auto/test/e2e.test.ts` — the phased-P1 walkthrough (:1894) | the person-commit step the analysis flow's gates own | **changed** (step 006) |
| `packages/auto/test/e2e.test.ts` — the frozen-key case (:710) | the spawn-matrix timing bound (S00-01's family) | **changed** (step 008) |
| `packages/auto-server/test/ops.test.ts` — the planPrelude matrix row 3 + its comments (:22, :628–644) | the 0206 D2 refusal mirror | **changed** (step 007) |
| `auto-core/test/fork.test.ts` | the trailer grammar's own pins (through the real `commitTree` writer) | untouched — already the writer's shape; the reader's floor |
| `packages/auto/test/e2e.test.ts` — the phase-index-drift describe | 0206 D2's lockstepped CLI mirror | untouched — the form step 007 mirrors |
| `packages/auto-server/test/worker.test.ts` — the five frozen-key families | 0224 D4's split form | untouched — the standing form step 008 applies |
| `packages/auto-server/test/` — Auto-Task fixtures | (none exist — measured, no `-m`-paragraphed Auto-Task commit in any server test) | untouched — nothing to change |
| `packages/auto/README.md`, `packages/auto-server/docs/daemon.md` | the person-facing drift/frozen teachings | untouched — no re-sync spellings survive outside the stale test row (measured) |
| `AGENTS.md`, `docs/structure.md` navigation | module → responsibility mapping | untouched — no mapping changes (test homes in the shells; the hold recorded per the 0229 precedent) |

## Decisions

- **D1 (step 005)** — the fork-family fixtures lockstep to the writer's
  trailer grammar; the reader (0173 D2) stands. The five tests' red at HEAD
  is the fail-before proof.
- **D2 (step 006)** — the phased-P1 walkthrough gains the person's commit
  at the taught channel; the product's scoped commits (0207 D1) and the
  start-clean gate stand. The test's red at HEAD is the fail-before proof.
- **D3 (step 007)** — the server's planPrelude row 3 locksteps to 0206
  D2's refusal (0206's category completeness completed late); the product's
  refusal stands. The test's red at HEAD is the fail-before proof.
- **D4 (step 008)** — the frozen-key case splits per family (0224 D4's
  form), the spawn count per test bounded under the guideline on both
  measured hosts; 0233 D3's deferral discharged.
- **D5 (no step)** — coverage item 6 (the shell-snapshot refresh) stays
  dispositioned as **scheduled**: the program's own rows 003 (the survey)
  and the merge steps it appends are its enactment; this wave's fixes
  landing first is step 001's recorded design (each shell merge lands
  green at 0 fail).
- **D6 (retirement, conscious)** — the "seven standing failures" count
  itself is retired as a baseline: after steps 005–008 land, `packages/auto`
  and `packages/auto-server` have **no** standing failures at their
  baselines (0 fail), and the program's final audit (row 004) verifies
  exactly that. The environment-shaped IPv6 failure is recorded as an
  observation, never a baseline member.

## Premise guard

Premises this ruling changes: **none**. Re-read in this change: 0173 D2
(the trailer-block witness — its grammar restated here as the standing
side; the fixtures were the drift), 0206 D2 (the drift apply's retirement —
its lockstep obligation extends to the server mirror it missed, this ruling
completes it), 0207 D1 (the scoped release consumptions — the walkthrough
rode the pre-rule absorption; the rule stands), 0224 D4 and 0233 D3 (the
split form and the deferral this wave discharges). Standing re-reads: 0101
D5 / 0114 D3 / 0115 (the walkthrough's own subject — unchanged by D2's
fixture-side fix), 0128/0129/0139/0191 (the fork family's contract — the
fixtures change, the contract stands), 0169 D4 (the provenance guard's
imitation door — untouched by D1's reader-stands disposition).

## Named residuals

- The process finding behind findings 1 and 2, recorded for the
  maintainer: the 0166 program's steps 013 and 047 changed core behavior
  that shell e2e suites pin, and each step's verification ran the core
  suite only — the shell flips went undetected for 16 and 3 steps
  respectively, then lived as "the known baseline" through a release cut.
  The verification protocol's "affected package checks" now reads, for any
  core change the shell e2e suites pin: run the touched shells' suites in
  the same change (this program's steps already do; the 0166 gap is
  historical, no rule change made — the protocol text already says it).
- The IPv6 bind test's host dependence (this host: no `::1`) — an
  observation, not a coverage item; a skip-gate would need its own measured
  basis and ruling.
- The frozen-key split's bound is stated against two measured hosts
  (0.12–0.17 s/spawn); a slower host re-measures the census at step 008's
  verification, the split shape unchanged.
