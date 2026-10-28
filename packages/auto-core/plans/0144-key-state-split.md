# 0144 — the key-failure state split: one-shot skip flags for evidence-free failures, order-first rotation search, `/failback` rewinds the ring

The maintainer's request (2026-10-28, design conversation over the key rings): with multiple keys
configured for a provider, *when creating each new session, attempts to establish the connection
should always be made in sequential order regardless of what errors were previously encountered
(except when switching keys inside a session) — this ensures priority usage of the quota for keys
ordered earlier*, the rationale being that *quota recovery may also result from a manual reset,
rather than solely waiting for the 5-hour or weekly/monthly quota recovery*. The maintainer's own
refinement, same conversation: *We can simply resolve the issue by just have a mark of skip flag,
when error happens to a KEY, any retry will skip it if skip flag is set, and then clear the flag,
so a later retry will check it again.* The approval ruling, closing the design: *the skip-flag is
primarily used in unattended scenarios, whereas `/failback` works when the user makes manual
changes.*

## The measurement (what the ring state holds today, and where each half of the request lands)

- The ring's run state (`src/router.ts`): a per-provider position that **never moves back** —
  "a cleared key mark does not rewind it, only a failure of the current key advances it (§6.4),
  so there is no restart churn" — and per-key down marks that clear at the failback-scope
  boundaries (task by default), a mark carrying a stated reset (`until`) surviving the clears.
  Every **new run** starts at key 1 unconditionally (marks are in-memory only, §6.4 D5); the one
  cross-run record (`.auto/windows.json`, 0057 §8) never blocks a dispatch by design — it only
  times the recovery wait's sleep.
- The proposal as first stated (rewind to key 1 at **every new session**) measures against three
  walls of the mechanism itself: **the key is a property of the managed server, not the session**
  — rotation is a server restart (`§4.3`), so a per-session rewind pays a restart per session;
  **the rotation path forks the failed session** — the fork *is* a new session, so a session-start
  rewind would rotate 1→2, fork, land on 1 again, fail, rotate… forever (the oscillation
  scope=session failback already needed one carve-out to prevent, `src/failback.ts`); and **it
  re-buys a known failure** — while key 1 is spent for five stated hours, every session would pay
  prompt → rejection → classify → restart → fork before any work.
- The gap the rationale exposes, measured: within a run, a **recovered earlier key is never
  preferred again while a later key works** — the position never rewinds, and `/failback` (the
  one moment a manual reset is signaled to the driver) clears every mark, `until` included, but
  leaves the position where it is (`consumeFailback` clears `downModels` and `downKeys`, never
  `positions`). A run that rotated at 02:00 burns key 2's quota all night even after key 1's
  stated reset passes at 05:00 — the person's declared key order inverted for the rest of the run.
- And the parked-mark half of the same gap: a key that failed **without stating a reset** is held
  down until the failback-scope boundary — a driver-invented duration with no provider evidence
  behind it — while the skip-flag idea names exactly the right amount of memory for that class:
  *it just failed; don't retry it immediately; check it again at the next retry.*

The defect, one sentence: the key ring holds two different facts — a provider-stated reset and a
bare recent failure — in one mark shape, parked on one arbitrary duration, behind a position that
never re-preferences an earlier key even when its state has cleared, and the operator's explicit
reset command does not move it.

## D1 — the state split: one-shot skip flags beside `until` marks

`markKeyDown(provider, key, until?)` and the whole per-provider key state split by whether the
failure stated a reset:

- **A stated reset (`until` present) writes an `until` mark** — unchanged from today: the key is
  excluded until the instant, the mark survives every boundary clear, and past the instant it
  reads as cleared. This is measured provider state (P19); discarding it (what a skip-flag-only
  design would do) re-buys known failures on every ring wrap, and nothing backstops it —
  `.auto/windows.json` holds the same reset but never blocks a dispatch.
- **A bare failure (no `until`) writes a one-shot skip flag** — the maintainer's semantics,
  verbatim: the flag makes the next rotation search pass the key over, the passing search clears
  it (at commit), and the search after that considers the key again. The flag has **no boundary
  semantics**: `clearDownMarks` stops touching key state entirely (the `until` half survives
  boundary clears as it already did, trivially — nothing clears it there; the flag half is not
  boundary state at all), so the key half of the failback-scope machinery dissolves. Keys become
  scope-independent under every `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE`; models keep the scope
  semantics unchanged.
- `isKeyDown` reads both kinds (flagged, or `until` active); `keyDownMark` stays the `until`
  mark's reader (a flagged key answers `undefined` — the flag is not a duration). The boundary
  hooks' calls (`attempt`, `loop-task`, `loop-phase`, `runner`) are unchanged — the router method
  keeps its signature and simply no longer walks key state.
- `extendKeyDownMark` (the classifier's late `resetAt`, §7.1) upgrades in evidence's direction
  only: an existing `until` mark extends; an existing **flag converts to an `until` mark** (the
  same failure's reset stated late — the one-shot guess replaced by the stated fact); no state at
  all reads false, as before (no resurrection).

Exhaustion is a decision-time state on the split: a search **refuses to land** when every other
key is flagged or `until`-held (a single-key ring always refuses). The refusal is applied like a
landing (D2), which consumes the passed flags — so the provider's entries leave the selection of
the moment through the model mark step 2 writes (the task's own exclusion), while §6.2 rule 4
holds them out whenever every key is flagged or `until`-held at selection time (chiefly the
`until` half, which no consumption shortens). The wait-and-probe loop owns the everything-down
recovery, exactly as before.

## D2 — the rotation search is order-first; every applied search consumes the flags it passed

`ringRotation`'s search starts at **declared position 0**, not after the current key: at the
first index that is neither the current key being rotated away from, nor `until`-held, nor
flagged, the rotation lands — so whenever a rotation fires at all, it lands on the **earliest
key the run has no evidence against**, the maintainer's "priority usage of the quota for keys
ordered earlier" realized at the only moment a key choice exists. The search is still
failure-triggered (a working key never triggers one), so the §6.4 restart-churn floor holds in
the only form that matters: no restart without a failure.

The decide/commit split is preserved (`§4.3`): `ringRotation` mutates nothing, and the decided
search carries `passed`, the flagged keys it visited before stopping. **Committing the search
applies it, landing or refusing**: the passed flags clear (the one-shot consumed — the next
search considers those keys again), the `from` key's failure is written (`until` or flag), and
the position moves only when the search landed. The escalation applies a refusal
unconditionally (it needs no host) and a landing after its host precondition — a decided landing
stays replayable, a caller that finds no host leaves every flag standing. The refusal's
consumption is the load-bearing half of the maintainer's wording — *"a later retry will check it
again"*: without it, a flag whose search never landed (the two-key ring's other key, the
escalation's fall-through) would stand forever with no rotation ever coming to consume it, which
is the permanent parking this change exists to remove. Its price is named and bounded: after a
refusal the passed keys read eligible again, so each task boundary (the model mark clearing)
admits at most one failed dispatch on the flagged current key before the order-first search
rotates onto the earliest eligible key — failure-driven, one restart, no ping-pong (the `from`
key always carries its fresh flag past its own rotation).

The residual, deliberate and named: **while a later key works, a recovered earlier key waits for
the next rotation** — no rewind without a failure (a working key never pays a restart). The
unattended everything-down case keeps §6.3's contract unchanged: the recovery probe clears the
provider's key state wholesale, tests the current key, re-marks it on failure (the earlier keys
then hold no state, so the next search's order-first walk lands on the first of them) — the
exhausted ring waits on the current key until it recovers or the person acts (D3). The reopen
trigger: a field report of an unattended manual reset of a **non-current** key under an
exhausted ring, where the probe's current-key contract would be the blocker.

## D3 — `/failback` rewinds the ring to the first key

The operator's explicit command — the moment a manual reset, a re-graded plan or a swapped key is
signaled — now resets the ring beside the marks it already clears: `consumeFailback` clears the
skip flags and the `until` marks (both were already cleared as "every mark, an `until`
included") **and resets every ring position to 0**, so the next dispatch runs on key 1 in
declared order. The attended/unattended split of the maintainer's approval ruling: the skip flag
and the order-first search heal the run unattended at the next rotation; `/failback` heals it on
the person's word at once. The parameterized `/failback` (the model-order override) keeps its
existing semantics; only the key state and the positions join the reset.

## D4 — floors and unchanged halves

- No registry, an external server, a single-key ring, an unactivated ring: byte-identical (the
  search, the flags and the rewind all sit behind `ringsActive`/`hasActiveRing` exactly as the
  marks did; `ringRotation` keeps its `keys.length < 2` refusal).
- The `until` half is byte-identical: stated-reset failures mark, survive boundaries, expire at
  the instant, extend on a late classifier answer — every existing `until` pin holds.
- `.auto/windows.json` (0057) is untouched — learned windows still never block a dispatch and
  still time the recovery wait; `accountOf` still names the current key's label.
- The recovery probe's ring half (§6.3) is untouched in contract — `clearRingMarks` clears the
  provider's key state (both kinds now), `markCurrentKeyDown` re-marks (flags or `until`-marks)
  the key the probe ran on, the position never moves.
- The spawn config, the labels (`key 2/3 ZHIPU_KEY_B`), the run-start block and the escalation
  ladder (key → model → wait, §7) are unchanged.

This ruling Derives: **P19** (measured evidence — the showing: a stated reset is provider state
the driver measured and keeps holding (the `until` half), while a bare failure carries no
duration evidence and now holds exactly the memory the fact supports, one skip; the order-first
search consumes the earliest key the run has no evidence against), **P6** (derived state,
idempotence — the showing: the skip flag is the minimal state for its fact, self-consuming at the
next search, with no boundary bookkeeping at all), **P2** (the person brackets every boundary —
the showing: `/failback` is the person's reset signal, and it now actually resets the ring it
claims to), **P12** (fail loud, conservative under uncertainty — the showing: an uncertain
failure excludes a key once, never parking it on a driver-invented duration), **P10** (the
byte-identical floor — the showing in D4). Amends: **0055 §6.4**'s never-rewind ruling (the
position still never moves *by itself* and never without a failure, but a rotation's search now
starts at declared order and may land on an earlier key, and `/failback` rewinds the positions —
the restart-churn floor it protected is held by the failure-trigger, not by the search order) and
0055 §6.4's key-mark boundary clearing (dissolved by D1; models keep it). Tier touched:
**mechanism** — core (`src/router.ts`, `src/keyring.ts`, comments in `src/session.ts`) and the
shell README's key-ring paragraph.

Tests: `test/keyring.test.ts` — the rotation describe rewritten to the new pins (the order-first
sequence A→B→C→A with the refusal naming its `passed` pair and the apply consuming them, the
position unmoved; the flag skipped by the search that passes it and consumed at its apply,
deciding clearing nothing; the `until` mark skipping its key to the instant and releasing it
after; a single-key ring always refusing while unknown providers, inactive and unactivated rings
answer nothing), boundary clears leaving key state alone and the position alone, the `/failback`
rewind case (positions to 0, all key state cleared, the spawn config naming key 1), and the
`extendKeyDownMark` flag→`until` upgrade; `test/failback.test.ts` — the key-state shapes under
the split (a flagged key reads down with no `until` mark; boundary clears never clear key state)
and `/failback` clearing both kinds; `test/agent-fake.test.ts` — the refusing-ring fall-through
(the passed flag consumed, rule 4 reading true, the provider excluded through the model mark,
the spawn config still naming the current key) and the three-dispatch one-shot healing case
(rotate A→B; refuse on B with A consumed; after the model mark's boundary clear the next
dispatch re-states B's failure and the order-first search lands on A — the later retry checks it
again); the `until` pins and the no-registry/external-server floors beside them unchanged.
