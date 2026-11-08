# 0226 — the glossary and registers refresh: the two documentation registers reconciled with the corpus they serve

Status: active-authority (0166 remediation step 066, wave WA-docs; findings 0165-179 = S02-07
(S4, CONFIRMED — the glossary lags the vocabulary: a dozen terms in code and docs have no
entry, the measured list "key hold, walk, sealed wall, launcher, adoption, info class,
knowledge boundary, tree lanes, regression lane, clarify, driver-helper, width", some
predating v0.3.0) and 0165-180 = S02-08 (S4, CONFIRMED — principles.md's trade-off/risk
registers stale against 0124–0164: R2, R4, R7's "last showed" cells behind the corpus; T8 a
candidate annotation; two candidate new trade-off rows; T3 context-only), with the F-twins
F15/F16 the same findings from the release-audit register).

One family — the two documentation **registers** (the glossary's one-concept-one-term map;
principles.md's trade-off and risk tables) reconciled with the vocabulary and rulings they
exist to track. Both findings are the same defect measured at the two registers: a register
that stopped being maintained against the corpus, so the map a reader (agent or person)
relies on answers yesterday's corpus. 0165 is the evidence, not the authorization; this
ruling states what a refresh owes and enacts it. Zero code behavior is ruled; the enactment
is the two documents, the mid-cycle register row 0225 D6's rule requires for the
principles.md edit, and the pin that holds the refreshed surfaces against silent drift (the
0221/0225 docs-pin pattern).

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P18** (the record outlives the tool — plain files as the only durable state,
  machine-addressable): the glossary and the registers ARE durable navigation state; a
  register stale against the corpus it serves is the record degrading its own addressability
  — the finding's measured impact, "the registers stop being the watched list", is P18's
  own loss. The repair is plain-file row edits and additions, nothing else.
- **P19** (measured evidence; every claim cited): every row this ruling adds and every cell
  it refreshes is cited to the ruling that measured it — the refresh records measurement,
  it never invents. The scope boundary is measured too: S02's list is the finding's own
  census, re-verified term by term against each owning module's header at this step's HEAD
  before any row was written (the execution log enumerates the reads).
- **P13** (frozen additive-only vocabularies): the glossary is the vocabulary's
  one-concept-one-term map — its completeness is P13's discipline on the documentation
  axis. The refresh is additive (new rows, one widened class row); no existing term is
  renamed or reinterpreted, and the widened row keeps the existing two classes' meanings
  intact (the info class is 0135's addition, standing since it landed).
- **P5** (single ownership): the registers are the one owning home for standing trade-offs
  and watched risks; the refresh adds rows and updates cells in that one home, creating no
  mirror (the pin asserts the home's content, it never duplicates it).

## Decisions

### D1 — what a register refresh owes (the rule this wave enacts against)

A documentation register refreshed mid-corpus owes four things, each an answer to a way
this refresh could land already stale or untraceable:

1. **Currency at the landing moment, not the finding's snapshot.** The 0165 findings
   measured staleness against 0124–0164; a refresh landing after 0225 that wrote only the
   findings' own instances would be stale on arrival (the exact defect, re-committed by the
   repair). The cells therefore state the newest measured showing at the landing moment —
   R2's cell carries the 0198→0201 lockstep lag the 0166 program itself measured, not only
   0161's instance; R7's cell carries the review's 41-in-9-days measurement with the
   current due-cut position. The glossary rows state each term as its owning module's
   header defines it at HEAD (0213's self-invoke is in the launcher row; 0204's
   project-start condition is in the clarify row).
2. **Every change cited.** A cell or row without its ruling pointer is unmeasured claim
   (P19); each carries the plans pointer the corpus's own INDEX rows carry.
3. **The principles.md edit recorded as reconciliation.** The register cells' content is
   derived from rulings; refreshing them is a wording repair bringing the text to what
   rulings already rule — 0225 D6's reconciliation class, so one row lands in releases.md's
   mid-cycle amendment register with this change (the glossary is not the constitution; its
   edit needs no register row).
4. **Rows are watched, never closed.** The registers' own preambles stand: a trade-off row
   is a standing decision with its reopening condition; a risk row is watched, never
   resolved by wording. The refresh updates cells and adds rows (T10, T11); it deletes
   nothing and closes nothing — a cell's "last showed" update is the watch working, not a
   resolution.

### D2 — the glossary's twelve rows (0165-179/F15)

Each term of S02-07's measured list gets its row, placed in the section its concept area
owns, worded from the owning module's header at HEAD (the glossary's own "Missing term?"
rule: the term the owning module's header uses):

| term | owning home (read at HEAD) | placement |
| --- | --- | --- |
| key hold | `src/keyring.ts` — `UNSTATED_KEY_HOLD_MS`, 0163 D1 | Model routing and failures |
| new-session walk | `src/keyring.ts` — `RingWalk`, 0163 D2 | Model routing and failures |
| sealed reference wall | `src/wall.ts`, 0132 (amended 0189, 0190) | Git, completion and gates |
| knowledge boundary | `src/external-dirs.ts`, 0122/0147 (widened 0188 D3) | Git, completion and gates |
| lane worker launcher (the "launcher" of the core) | `src/shell.ts` — `laneLauncher`, 0068 §6.4 D2; 0213 D1's `selfInvoke` | Lanes |
| confinement launcher (the daemon's launcher — S02's "launcher / confinement") | `packages/auto-server/docs/daemon.md` §confinement launcher, 0162 D4 | Lanes (its concept kin: lane children inside a confinement) |
| adoption (foreign-commit adoption) | 0145; P4's derivation wording since 0225 D1; 0183 D3's readable-drift bound | Recovery and handover |
| info class | `src/config-fix.ts`, 0135; P8's recorded-state class since 0225 D2 | the existing fixable/manual row widened to the three-class vocabulary (one concept: a config-fix finding's classes) |
| tree lanes | `src/lanes.ts` — `treeTiers`, 0126 | Lanes |
| regression lane | `src/regression.ts`, 0098 (the two-level pass) | Lanes |
| clarify | `src/clarify.ts`, 0116; the two surfaces' moments 0204 D1 | Configuration, CLI and run-time controls |
| driver-helper | `src/driver-helper.ts`, 0105 (the person-proxy brief) | Configuration, CLI and run-time controls |
| width | `--max-sessions`, 0068; 0126 (docs waves at width out of the box) | Lanes |

The two launchers are two concepts (two rows, the glossary's one-concept-one-row rule); the
twelve-term list yields thirteen rows plus the one widened row because "launcher /
confinement" names both. No existing row's meaning changes; the widened class row keeps
fixable and manual as they were.

### D3 — the principles.md registers (0165-180/F16)

Refreshed cells (each the newest measured showing at the landing moment):

- **R2** (channel divergence) last showed: **0161** (the manual suite lacked the
  Auto-Nested grammar since 0021 D4), re-shown by **0198→0201** — the progress rule
  changed the loop 2026-11-06 and reached the manual suite's fix loop 2026-11-08 (0201 D2
  retiring the pre-0198 phrasing, 0200's residual discharged). The ratchet test and the
  deliberate-recording mitigation stand.
- **R4** (constitution creep) last showed: **0146's threshold import** into P2's
  Tier I line (retired by 0225 D4) **and the AGENTS.md navigation re-showing** the 0165
  review measured (0165-060/061/065 — INDEX grammar, stale homes, the navigation's R4
  reduction; repaired by the 0166 program's step 002). The tier test at every `Amends:`
  stands.
- **R7** (corpus growth without governance) last showed: **the 0165 review** — 41 rulings
  (0124–0164) unreleased in 9 days with the per-release audit lagging; the corpus now at
  0225, the due cut the 0166 program's step 070, and 0225's mid-cycle register
  accumulating rows for that cut's consumption.
- **T8** (wait-and-preserve vs fail-fast) ruled cell extended: **0163 D1** — the
  five-minute key hold, a person-ruled standing constant (an unstated key failure holds
  briefly, never a long driver-invented park), beside 0015/0016 and 0057; **0219 D2**
  (eligible-with-wait) joins the same family — a curable, window-blocked recorded model
  waits, it does not die. The choice cell carries the key-hold clause; the reopen trigger
  (waits dominating productive wall-clock in the stats) unchanged.
- **T3** re-read, **context only** (S02's own reading adopted): 0162's 3600 s background
  reap is throughput pressure on the *driving channel*, not the boundary rhythm — the row,
  its choice and its trigger unchanged.

New rows (the finding's two candidates, each a standing tension with its reopening
condition — the register's own shape):

- **T10 — the lock's writer gate vs the read-only channel's reach** (P5 against P8): the
  run lock gates commands that write what a running driver reads; a read-only channel
  takes none and stays loud on collision — `fork` is lock-blind (0129: its writes to the
  source directory are the inert `auto-fork/*` branch family and `.git/worktrees`
  registrations, surfaces no run reads or enumerates, so the lock protected no state and
  its refusal blocked the channel's one consumer); `driver-helper` reports a live lock,
  never refuses on it (0105 D4); 0225 D5 states the scope definition. Reopens when a
  measured race shows a lockless command's writes meeting a run that reads them (the
  "surfaces no run reads" fact is the row's floor — a run change that begins enumerating
  the fork family's surfaces reopens it).
- **T11 — the driver-exclusive commit right vs the person's own commits in an interrupted
  unit's range** (P4 against P8/P20): adoption — a resume that finds the person's commits
  in the unit's range adopts them as readable drift (0145; 0183 D3's bound), the close-out
  re-anchoring at the current HEAD so the range still contains only driver commits (0225
  D1's P4 wording); never a stop, never a rollback. Reopens when a field incident shows an
  adoption corrupting the close-out audit or swallowing the person's intent (a hand-commit
  meant to revert the unit, adopted as its progress).

Re-read standing, cells unchanged: T1, T2, T4, T5, T6, T7, T9, R1, R3, R5, R6 — no newer
showing measured for any (R1's family — codification narrower than the ruling — last
measured 0103's addendum two; the 0132 Category-scope subset enactment 0165-067/F10
measured is the category-scope audit finding's own class, held in How-to-rule's section,
not a codification drift).

### D4 — the pin

`test/docs-registers-reconciliation.test.ts` (the 0225/065 docs-pin pattern): the twelve
glossary rows' distinctive phrases, the refreshed register cells' phrases, the two new
trade-off rows' phrases, and this ruling's mid-cycle register row asserted in their homes —
fail-red at this step's starting HEAD (all absent), green after. Anchoring a needle means
moving it in the same change as a sanctioned ruling, never to silence it.

## Derivation and Category scope

Derives: **P18** (the showing: the glossary and the registers are the durable record's own
navigation surfaces — reconciled to the corpus they serve, the refresh plain-file additive
row work in their one home), **P19** (the showing: every added row and refreshed cell cited
to its ruling, the term list re-verified against the owning headers at HEAD before any row
was written, the scope boundary the finding's own census — the refresh records measurement,
invents nothing), **P13** (the showing: the glossary is the vocabulary map's one home; the
refresh is additive, no term renamed or reinterpreted, the widened class row preserving the
existing classes' meanings), **P5** (the showing: the registers stay the one owning home
for standing trade-offs and watched risks — cells updated and rows added there, no mirror
created; the pin asserts, never duplicates). Amends: **none** — no principle statement,
chosen default or lifecycle changes; the principles.md edit is reconciliation under 0225
D6's rule (register cells derived from rulings, brought to the rulings' own content), and
it is so recorded in releases.md's mid-cycle amendment register. Tier touched:
**documentation** (the glossary, the registers' section of principles.md, the
releases.md register row; zero code, zero runtime behavior). premises this ruling changes:
**none** — no standing ruling rests on the registers' stale cells (the cells are derived
documentation); the rulings this refresh cites (0161, 0163, 0126, 0129, 0135, 0145, 0098,
0105, 0116, 0122/0147/0188, 0132, 0068, 0162, 0198, 0201, 0213, 0219, 0225) are each
**re-read this change and restated in the registers, not amended**; 0110's register
framework is exercised, not altered; 0225 D6's change-control rule is followed, not
changed.

### Category scope (0123 D1's discipline)

Family: *the documentation registers — the glossary's term map and principles.md's
trade-off/risk tables, their recording surfaces and the pin that holds them*.

| home | disposition |
| --- | --- |
| `docs/glossary.md` — the twelve-term rows (thirteen rows: the two launchers), the widened fixable/manual/info row | changed — D2 |
| `docs/principles.md` — the trade-off register (T8's cells, T10, T11) and the risk register (R2, R4, R7) | changed — D3 |
| `docs/releases.md` — the mid-cycle amendment register | changed — one row (this change, reconciliation class, D1 item 3) |
| `test/docs-registers-reconciliation.test.ts` (new) + `test/lanes.ts` | changed — the pin and its manifest row (D4) |
| `plans/INDEX.md` | changed — the 0226 row |
| `docs/principles.md` — principle statements, How-to-rule, the preamble | held — no principle text touched; the registers are their own section |
| `AGENTS.md` | held — no code mapping or navigation change (no src file moves; the glossary pointer already stands in the overview) |
| `docs/structure.md`, `docs/shell-contract.md` | held — no module mapping changes |
| `plans/NNNN` originals (every ruling cited above) | held untouched — the registers move toward the rulings, never they toward the registers |
| Step 067 (wa-docs-accuracy) | consumed — the glossary's package-section gap (no auto-server row beside the general/simple shells) recorded in Residuals as that wave's material |

## Residuals

- The glossary's package section still lacks an `auto-server` row (the general and simple
  shells have theirs; the daemon/service-shell vocabulary — daemon, hub, bridge — lives in
  `packages/auto-server/docs/daemon.md` and README, not this map). A docs-accuracy matter
  for step 067's family (server docs), named there — not smuggled into this step's
  measured list.
- A register refresh is a snapshot, not a mechanized watch: no test can force a new ruling
  to update a cell. The pin holds the refreshed surfaces against silent drift; the
  per-release audit (releases.md's duty) is the standing re-census, and the next cut
  (step 070) is the first one this refresh serves.
- The register cells' currency is as of 0225 (this step's landing moment, D1 item 1);
  rulings landed after this step owe their own cell updates in the same change — the
  residual is the discipline's, not a mechanism's.
