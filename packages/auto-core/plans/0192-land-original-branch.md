# 0192 — land's original branch: an evidence ladder, not exclusion alone

Status: active-authority (0166 remediation step 032, wave W-land; finding 0165-148 = S20-11,
CONFIRMED — by code trace: the candidate filter is the only derivation, no flag overrides it,
0074 §2.3 says only "check out the original branch" and never ruled a multi-branch case; every
mechanism re-probed against live git at ruling time: `git reflog show HEAD --format=%gs` lists
newest-first and the establishment checkout (`git branch auto/R-NN && git checkout auto/R-01`,
isolateRound's exact sequence) writes `checkout: moving from <original> to auto/R-NN` as the
oldest matching entry; a same-branch re-checkout also writes an entry
(`moving from auto/R-01 to auto/R-01`), which is why the OLDEST match is the establishment's;
a detached-HEAD establishment records the commit's sha as the from-token, not a branch name;
a repository with `core.logAllRefUpdates=false` keeps no HEAD reflog and `git reflog show
HEAD --format=%gs` exits 0 with empty output — the absent floor, as does an expired reflog
(gc.reflogExpire prunes oldest-first, default 90 days)).

One finding, one family: **the landing identified the repository's original branch by
elimination — "the one local branch outside the driver families" — where git holds a record of
the very act that created the round branch.** A designated repository with a second ordinary
branch (`main` + `dev`, any feature branch) could never land; the refusal's teaching
("settle the branches manually") pointed at deleting the person's branches; the prefix filter
(`auto/*`) also hid a person's own `auto/…`-named branch; and when the original was deleted
mid-round, the elimination could silently crown a *different* branch (the sole survivor) and
land onto it — a wrong-branch landing, not a refusal.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P6** — derived state, re-derivation: the original branch is a fact git itself recorded —
  the isolation's own checkout wrote it into HEAD's reflog. Asking git's record instead of
  re-deriving by elimination is the re-derivation this mechanism owed; the ruling writes no
  new state (the finding's family note floated `refs/auto/original/R-NN` — declined: a ref is
  newly persisted state needing lifecycle, the reflog entry already exists, written by the
  act itself).
- **P2** — the person brackets every boundary: which branch a round's work lands onto is a
  consequential decision; the derivation may answer it from evidence, but the person's
  explicit word (`--onto`) outranks every rung, and where no rung answers, the command stops
  and asks — never a guess consumed as closed.
- **P12** — conservative under uncertainty: a record naming a branch that no longer exists
  blocks naming it (deleted or renamed — never land onto a different branch than the record
  names); several-or-no candidates without a record block; an absent, empty or unreadable
  reflog falls to the floor, never to a heuristic.
- **P8** — every surfaced line teaches its remedy: the refusals teach `--onto` — name the
  original — never branch surgery ("settle the branches manually" invited deleting the
  person's branches); a `--onto` naming a branch the repository does not hold lists what it
  does hold.
- **P10** — the byte-identical floor: a repository with exactly one ordinary branch (every
  scene before this change) derives the same branch on every rung — the landing, its output
  and every other refusal byte-identical; a repository without a usable reflog answers by
  the exclusion floor exactly as before.
- **P13** — frozen vocabularies: the branch families' grammars are unchanged; the round
  family's *filter* tightens from the `auto/` prefix to the exact `auto/R-<n>` grammar
  (leftoverIsolationLines' own regex — a person's `auto/*`-named branch outside that grammar
  is an ordinary branch like any other, the finding's second half); `--onto` joins land's
  vocabulary in this one conscious change, and the refusal lines change in the same lockstep
  (the tests' pins with them).
- **P20** — in-flight work is never destroyed: the pre-fix elimination could land a round
  onto the wrong branch (the sole survivor after the original's deletion); the record block
  turns that into a refusal naming the truth.

## D1 — the evidence ladder: the person's word, the establishment's record, the exclusion floor

Pass 1 derives each designated repository's original branch by three rungs, in order:

1. **`--onto <branch>`** (D2): the person's explicit word. Validated only as existence — a
   local branch of that repository (the person may name a driver-family branch deliberately:
   continuing a hand-salvaged round chain onto its round branch is their call, P2); a name
   the repository does not hold is a blocked problem line listing its local branches. No
   other rung runs.
2. **The establishment's own record**: the oldest `checkout: moving from <X> to <branch>`
   entry in HEAD's reflog (`reflogIsolationSource` in git-land.ts — one read, newest-first
   listing, last match taken; empty output, a non-zero exit or an absent reflog all read as
   no record). The token names a branch that still exists and is outside the driver families
   → it is the original — even when other ordinary branches exist (the record wins over
   elimination; this is the rung that un-blocks `main` + `dev`). The token names a branch
   **outside** the families that **no longer exists** → blocked naming it ("the isolation
   record names X … deleted or renamed since isolation; name the target with --onto, or land
   by hand") — never the floor, which would crown a different branch. The token is a
   driver-family branch or a bare sha (a detached-HEAD establishment, or a hand-salvaged
   round-to-round chain whose reflog move is `auto/R-01 → auto/R-02`) → no answer from this
   rung; the floor derives.
3. **The exclusion floor** — the pre-change rule, kept as the fallback: among local branches,
   the driver families (`auto/R-<n>` exact, `auto-lane/*`, `auto-fork/*`) are never the
   original; exactly one remaining candidate identifies it. Several or none → blocked naming
   them, now teaching `--onto` ("name it with --onto (opencode-auto land <dir> --onto
   <branch>), or land by hand") — never "settle the branches manually".

Every downstream check (the merge-base isolation point, the moved-original refusal, the
foreign-commit range, `--keep`'s previous-landing recognition) runs against the derived
original exactly as before — the ladder changes only which branch that is. `leftoverIsolationLines`
keeps its own round-grammar regex and its hand-merge recipe (true there: a leftover of an
earlier round has no establishment record to read — the current round's reflog entry belongs
to the current round's branch).

## D2 — `land --onto <branch>`: the person's rung, the teaching's remedy

The escape the refusals teach. A value flag on the shell's land row (`--onto <branch>` or
`--onto=<branch>`; a bare `--onto` is a usage error naming the shape — it would otherwise
swallow nothing and answer `""`), passed to `landUnit` as `opts.onto`, applying to every
designated repository that holds the round branch (the common case: one branch name
everywhere). It composes with every mode (`--keep`, `--merge`, `--abandon` — abandon checks
the original back out too). The shell's strict option ladder, the help rows and the README
change in the same lockstep ("land takes only --keep, --abandon, --merge and --onto
<branch>"); the scoped refusal for stray land flags keeps its `--keep`/`--abandon` shape —
`--onto` follows `--merge`'s cross-command posture exactly (a value flag the loose commands
ignore, the strict ones refuse by name).

## The floors

- A repository with exactly one ordinary branch and its reflog intact: every rung names the
  same branch — the landing, its printed lines and every other refusal byte-identical.
- A repository with no usable reflog (`core.logAllRefUpdates=false`, expired past the
  establishment, or an establishment from a detached HEAD): the floor answers exactly as the
  pre-change code did.
- The reflog read writes nothing and its every failure shape reads as no-record — the floor.
- A repo holding a second ordinary branch added *after* isolation (the finding's `main`+`wip`
  trace): rung 2 names the establishment's branch — the new landing, the ruled change.
- A person's own `auto/*`-named branch outside the round grammar: a candidate like any other
  on the floor, and the record's answer when it was the establishment's branch.

premises this ruling changes: **0074** (§2.3's landing step rode an unstated single-candidate
premise — "check out the original branch" assumed a repository where elimination identifies
it; re-read in the same change: §2's mechanism, §2.2's untouched establishment (U-L1 — the
record read adds no write; git's own checkout writes it), §2.4's lanes-inside-isolation,
§4's refusals and §5's rulings all stand; the derivation itself becomes 0192's ladder, the
one case 0074 never wrote down). 0155 re-read and stands (its land rulings — the
no-merge-base refusal and D4's own-file resolution — run against the derived original,
unchanged by which rung derived it); 0191 re-read and stands (its evidence ladder is the
precedent this ruling follows, on the landing side; no shared surface moves).

Derives: **P6** (the showing: the original branch re-derived from git's own record of the
isolating act — no new state, the ref declined), **P2** (--onto outranks every rung;
unanswerable derivations stop and ask), **P12** (the deleted-record block; no-guess between
candidates; absent reflog → floor), **P8** (the refusals teach the naming act and list what
exists — never branch surgery), **P10** (the floors above), **P13** (the families' grammars
unchanged, the round filter tightened to its own exact grammar, --onto added in this one
change with the refusal lines' lockstep), **P20** (the wrong-branch landing of the deleted
original becomes a refusal). Tier touched: **mechanism** — `src/land.ts`, `src/git-land.ts`,
the shell's land row and README, the test homes; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the landing's identification of a designated repository's original branch — which
branch a round's work returns onto, from what evidence, and what the person is asked to do
when the evidence does not answer* (0074's landing family meeting git's own HEAD reflog at
the establishment checkout).

| home | disposition |
|---|---|
| `src/git-land.ts` (`reflogIsolationSource` beside the landing primitives — one read-only git call; isolateRound's checkout comment naming the record it writes) | changed — D1 |
| `src/land.ts` (pass 1's ladder replacing the candidate filter; the driver-family predicate tightened to `auto/R-<n>` exact; `onto` in LandOptions; the header's AUTO-DECISION paragraph restated as the ladder) | changed — D1/D2 |
| `packages/auto/src/index.ts` (`onto` a value flag; LAND_FLAGS and the strict-ladder usage line; the land help rows; the bare-`--onto` usage guard; threading to `landUnit`) | changed — D2 |
| `packages/auto/README.md` (the land synopsis row; the land section's derivation and refusal bullet) | restated |
| Test homes: `test/land.test.ts` (the defect, floor, escape, record and grammar pins; the ambiguous-branch pin reshaped), `packages/auto/test/e2e.test.ts` (the strict-ladder wording lockstep; the `--onto` CLI pin) | changed |
| `src/land.ts` `leftoverIsolationLines` | held, untouched — a leftover of an earlier round has no establishment record of the current branch; its hand-merge recipe is true there |
| The `refs/auto/original/R-NN` record ref (the finding's family note) | declined — P6: the reflog entry is already written by the isolation's own act; a ref is new persisted state with lifecycle nobody ruled |
| Per-repository `--onto` (different originals in one mixed fleet) | deferred — named residual (P21: no consumer ruled it; `--onto` is one branch name for every designated repository) |
| `plans/INDEX.md` (the 0192 row; 0074's row annotated) | changed |
| `AGENTS.md` (the land navigation line gains 0192) | restated |

## Residuals

- **Reflog expiry** (`gc.reflogExpire`, default 90 days, prunes oldest-first — exactly the
  establishment entry first): an expired record falls to the floor and, failing that, to
  `--onto`. Measured and documented; no expiry-copying machinery is built (P21).
- **Per-repository originals**: a mixed fleet whose repositories need different named
  originals lands by hand (`--onto` names one branch everywhere).
- **`--onto` outside land**: follows `--merge`'s cross-command posture (ignored by the loose
  commands, refused by name by the strict ones) — the existing shape, not a new policy.

## Tests

- `test/land.test.ts` (fail-before on pre-fix source in every named case):
  - the defect: a second ordinary branch added after isolation no longer blocks — the
    establishment's record names the original and the round lands on it (pre-fix: "cannot
    tell which of <original>, wip is the original branch");
  - the record's authority: the original deleted mid-round blocks naming it — never a
    landing onto the surviving branch (pre-fix: the wrong-branch landing, the defect's
    dangerous half);
  - the floor: reflogs off at establishment (`core.logAllRefUpdates=false` before
    isolation), two candidates → blocked teaching `--onto` (pre-fix: blocked with the old
    "settle the branches manually" wording); the same floor with one candidate lands — the
    byte-identical floor, passing on both sides by design;
  - the escape: `--onto wip` lands onto wip through the same no-reflog scene (pre-fix: the
    unknown option ignored, the ambiguous block);
  - `--onto` naming a branch the repository does not hold: blocked naming it and listing the
    local branches (pre-fix: the ambiguous block's different text);
  - the grammar: a person's own `auto/*`-named branch outside `auto/R-<n>` as the
    establishment's branch — the round lands back onto it (pre-fix: "no candidate original
    branch remains", the prefix filter hiding it).
- `packages/auto/test/e2e.test.ts`: the strict-ladder line's lockstep ("--onto" in the land
  options sentence); one `--onto` CLI landing end-to-end (the flag parsed, the value
  threaded, the round landed on the named branch).
- The suite's untouched land pins (the happy path, `--keep`, `--merge`, `--abandon`, every
  other refusal) pass unchanged — the byte-identical floor.
