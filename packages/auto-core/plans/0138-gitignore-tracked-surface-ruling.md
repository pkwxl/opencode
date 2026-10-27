# 0138 — the .gitignore and opencode.json are committed project surfaces

The maintainer's question over the init-written ignore set (2026-10-27, the round after 0137): "Should
we add `.gitignore` back to git, and `opencode.json` to git again? since they affect the running of a
project. let's rethink what should be put in git, what not?" The wider set came from commit `088100858`
(2026-09-24, "init: commit-capability prerequisite and the wider .gitignore set") with rationale
recorded only in the commit message and the `gitignore.ts` comment ("the ignore rules are a local
arrangement … not committed") — no numbered ruling, no INDEX row.

The probe (the ruling's measurement): `init` a scratch project, commit, clone, replay what a first
`run` does on the clone. On the init machine git holds only `.opencode/` — the `.gitignore`, `AGENTS.md`
and `opencode.json` are all untracked. On the clone none of the three exist; preflight's `ensurePointer`
re-writes AGENTS.md and `ensureGitignore` re-creates a **2-line** `.gitignore` (`tmp/`, `.auto/` only),
and the housekeeping close-out commit (`git add -A`) **commits both** — the clone's git now permanently
holds a partial `.gitignore` and a tracked AGENTS.md, two machines holding different git contents for
one project. `opencode.json` is the sharper loss: the person's edits — the 0127 timeout keys, the 0122
external-directory stamps — live only in an unversioned file; the clone gets the bare template back
through `fix`'s missing-file rule. And the lane scaffolding copy (`SCAFFOLD_FILES` in `src/lanes.ts`)
exists *only because* these files are untracked — its own AUTO-DECISION comment says so.

The analysis: the file-by-file question resolves through what each file *is*. The ignore set is project
law every machine needs identically — the nested-repo entries are correctness-critical (an unignored
nested repository is absorbed by the parent's `add -A` as a gitlink), the workdir entries keep the
unified commit from carrying runtime state, and a self-ignored `.gitignore` never reaches git at all,
which is the root defect the probe measured. `opencode.json` is the project's host-program posture: the
permission table is governance, and both things the tool reads from it (0127's timeout keys, 0122's
allows) are project facts — the operator-local half of host configuration already has its designed
local home in the registry's project layer (0055 §4.1), so committing `opencode.json` completes 0055's
split rather than blurring it. `AGENTS.md` is the one derived file in the set — byte-identical from the
committed `config.json`, re-rendered by `ensurePointer` at every run start — and the remedy for its
clone drift is not tracking it but tracking the `.gitignore` that keeps it local on every machine alike.
`/.env` (secrets, defensive) and the registry's project layer (the operator's, preflight-enforced
local-only) hold.

This ruling Derives: **P18** (the record outlives the tool — the person's `opencode.json` edits were
unversioned and unrecoverable; a fresh clone now receives the whole ignore law and the host posture),
**P5** (single ownership — the probe's two-machines-two-contents drift was the ignore set with no one
owning its delivery; now init writes, git carries, `fix` reconciles, `reset` removes, one set), **P13**
(the `INIT_ENTRIES` vocabulary changed in one lockstep with `reset`, `fix`'s rule table, the README, the
lane scaffolding comment and the pins — the retired entries getting the config-key retirement
precedent: stripped by rule, never silently), **P2** (the person brackets every boundary — flipping
`opencode.json` from local to published is consequential, so its ignore line is the person's pen act, a
manual finding, while the `.gitignore` self-entry is the tool's own surface and strips fixable), and
**P19** (the probe above; the lane scaffolding comment as the recorded cost of the old ruling). Tier
touched: **config layer + fix rule table + teaching copy** — no run-path, gate or establishment
machinery moves.

## Category scope (0123 D1's discipline)

Family: *the init-written ignore set and the target directory's git surface (088100858's wider set,
0055 §4.1's local layer, 0122's stamps into `opencode.json`, reset's inverse).* Home-set enumerated at
ruling time:

| home | disposition |
|---|---|
| `src/gitignore.ts` (`INIT_ENTRIES` drops `/.gitignore` and `/opencode.json`; `RETIRED_ENTRIES`; `ensureNestedGitignore`, `retiredGitignoreEntries`, `removeGitignoreEntry`; `stripEntries` factored out of reset's inverse) | changed |
| `src/config-fix.ts` (the nested-entry append rule; the retired self-entry strip, fixable; the retired `/opencode.json` line, manual — the person's visibility call) | changed |
| `src/lanes.ts` (`SCAFFOLD_FILES` **held** — the pre-0138 shape still holds both files untracked, and a current project's copies are byte-identical no-ops beside HEAD; the comment re-voiced to the two channels) | comment only |
| `src/reset.ts` (`removeGitignoreEntries` follows `INIT_ENTRIES` in lockstep; a pre-0138 file's retired lines left as the person's — `fix` owns their retirement) | follows, comments re-voiced |
| run's `ensureGitignore` seam, `ensurePointer`, the preflight models gate, `protect.ts` | held — byte-identical |
| `packages/auto/src/index.ts` (the init ignore-set line now teaching the committed surfaces and the commit; the init and fix OPTION_HELP texts) | changed |
| The tests (`gitignore`, `reset`, `config-fix`, the two lane fixtures now committed-surface shapes, the shell e2e: the init entry lists, the older-project fix pins, the reset gate over a modified tracked `opencode.json`, the init dirty-list asserting the tracked surfaces in and `AGENTS.md` out) | changed |
| `packages/auto/README.md` (the init synopsis; the fix rule table's three new rows; the reset table's `.gitignore` row), `AGENTS.md` (the operational line), `packages/auto/AGENTS.md`, `docs/structure.md` | changed |

## The ruling

**D1 — the ignore set is tracked law.** `INIT_ENTRIES` becomes `/.env`, `/AGENTS.md`,
`/.opencode/auto/models.json`: init still writes the workdir entries, the local-only entries and the
nested-repository entries, but the `.gitignore` itself and `opencode.json` are no longer ignored. The
file surfaces untracked after init (the person commits it with the config layer, init's closing line
teaching the act), arrives whole on every fresh clone, and keeps every machine's rules identical.

**D2 — `AGENTS.md` stays local-only, now consistently.** The block is derived state — byte-identical
from the committed `config.json`, re-rendered by `ensurePointer` at every run start — so tracking it
would buy nothing the config does not hold while booking a tracked diff on every config change. The
old ruling's clone drift (a tracked AGENTS.md on clones, untracked on the init machine) heals by D1:
the tracked `.gitignore`'s `/AGENTS.md` entry keeps the file local on every machine alike. Residual,
accepted: a manual session on a fresh clone before the first `run` sees no block — if that ever bites
in the field, tracking it is the remedy (measure first).

**D3 — `fix` reconciles the set.** Beside the workdir and models rules, `fix` appends an entry for a
nested git repository in the tree (init stamps the set at init time; a repository appearing later — or
a pre-0138 clone whose partial file never carried the entries — would be absorbed as a gitlink), strips
the retired `/.gitignore` self-entry (fixable: the tool's own surface, the file surfacing untracked and
landing in git with the next commit), and reports the retired `/opencode.json` line as **manual** — the
visibility of a file holding person settings is the person's call, and whoever must keep it local
(raw secrets belong in references) owns their own line and the finding.

**D4 — migration is fix-gated, never silent.** No existing project changes until `fix` runs on it: the
plan lists the strip and the report, the person confirms, the surfaced files land with the next commit
(run's housekeeping close-out books them). `reset` mirrors the current init exactly; a pre-0138 file's
retired lines survive reset as the person's own entries.

**D5 — the lane scaffolding copy stays.** `SCAFFOLD_FILES` keeps `.gitignore` and `opencode.json`: a
pre-0138 project still holds both untracked, and without the copy its lane worktrees would see
`.auto/` as untracked dirt at every clean gate. For a current project the copies are byte-identical
no-ops beside HEAD; the two entries retire when no pre-0138 project runs lanes anymore.

Held with grounds: `/.env` (secrets courtesy, machine-uniform) and the registry's project layer
(0055 §4.1 — and its preflight gate's clone corner heals: the entry now arrives with the clone).

## Enactment

The core changes (`gitignore.ts`, `config-fix.ts`, the `lanes.ts` comment), the shell texts, the test
re-shapes, the README/AGENTS/structure rows, this file, the INDEX row. Verification: full typecheck
clean in both packages; both suites green (auto-core 2808, the shell 143 + the E2E-gated skips).

## The closing read

The ruling's own probe re-run on the rebuilt CLI: `init` leaves the `.gitignore` and `opencode.json`
beside `.opencode/` as untracked surfaces for the person's commit; the clone receives both; a first
`run` books nothing it did not book before. The pre-0138 shape migrates by one `fix` run — the
self-entry stripped, the `/opencode.json` line named for the person — and the set, the posture and the
stamps live in git from then on.
