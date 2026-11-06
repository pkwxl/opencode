# 0173 — The release baseline walks past every trailer-less commit, the driver witness is the trailer block, the audit range is checked, and the driver's git children run scrubbed beside a hooks notice

Status: **active**. Ruled 2026-11-06 by 0166 step 013 (wave W6-git), enacting 0165-004 (S19-01,
S1, CONFIRMED — the release gate certifies over an empty scan after any person commit),
0165-140 (S19-07, S3, CONFIRMED — the substring Auto-Stage criterion), 0165-141 (S19-08, S3,
CONFIRMED — foreignCommits' unchecked range) and 0165-142 (S19-09, S3, CONFIRMED — the unruled
git-hooks question).

## Derives

Derives: P1 — the deliverable stands alone and the release moment is its only enforcement, so the
scan's range must be the migration's whole writing, whoever committed it: the current
driverBaseline stops at the FIRST trailer-less commit, so the person's own remedy commit ("fix,
commit, and the re-run certifies") empties the scan and the ✓ certifies over every remaining
finding — P1's enforcement moment passes by construction once HEAD is anyone's but the driver's.
P4 shows in D2 (the commit's trailer block is the driver's witness — git history as the audit
anchor, one grammar for every reader) and D3 (an audit that cannot judge its range fails loud,
never answers zero); P12 in D3 the same way (the unreadable log and the rewound HEAD resolve
toward dirty); P8 in D4 (the hooks posture is surfaced at run start, every line teaching it); P10
in every floor (hookless repos and trailer-only histories are byte-identical). Tier: operating —
P1/P4 statements applied to the existing audit surfaces; no Tier I statement changes.

premises this ruling changes: 0119 (D1's walk — "walk HEAD's history while commits carry the
Auto-Stage trailer and return the first commit without it" is replaced by the boundary rule below;
the maintainer's OOM ruling — never materialize what the project never touched, never walk a
pristine history in the node process — stands and is what the `--grep` form keeps: git filters
server-side, the node process sees only the matching commits), 0074 (§2.3's landing commit —
"deliberately carries no Auto-Stage trailer … the person's to curate" stands, and the landing
subject `land auto/R-NN: …` becomes a RECOGNIZED boundary of the migration's writing at the
release scan: the squashed round is the migration's content and is scanned as such; the trailer's
absence is unchanged), 0059 (X1's env isolation — the measured door (the target's hooks seeing
OPENCODE_AUTO_AGENT through the driver's commit children) closes by D4's scrub; X1's agent-children
isolation stands). Re-readings: 0103 D2 (the release gate's loop) stands — its remedy line's
"commit, and the re-run certifies" becomes true; 0140's task-corpus readers stand, gaining the
trailer-block grammar (D2) — the whole-line match anywhere in the body was the same accidental
shape; 0022 3.1/3.3 (baselineIntact/rollbackUnit) stand, gaining the ancestry check (D3).

## Category scope (0123 D1's discipline)

Family: *the git audit family* (who witnessed a commit as the driver's, and what range an audit
means). Home-set: `src/git.ts` (driverStage/trailerBlock, foreignCommits, driverBaseline,
unitViolations, baselineIntact, rollbackUnit, taskFirstCommit, the git() spawn env),
`src/wall.ts` (the sealed-channel scan's witness), `src/release.ts` (the scan range, the ✓ line,
the isolate refusal), `src/land.ts` (the foreign-count caller), `src/loop-preflight.ts` (the hooks
notice), `test/git.test.ts`, `test/release.test.ts`, `test/protect.test.ts`-adjacent preflight
tests, `test/wall*.test.ts`. No frozen vocabulary changes: no new stage words, no grammar a
document carries — the trailer-block reader is a stricter reading of the writer's existing shape
(message() already ends every body with a trailer paragraph; the `Auto-Task`/`Auto-Nested`
readers keep their keys).

## D1 — the release baseline is the parent of the oldest boundary commit reachable from HEAD

driverBaseline is re-ruled: walk HEAD's first-parent history for the OLDEST commit that carries a
driver witness (a line starting `Auto-Stage:`, git's own `--grep=^Auto-Stage:` — anchored per
line, so prose mentions and quoted trailers mid-line never match) or a landing subject (a line
starting `land auto/`, the `--fixed-strings` grep over land's grammar); the baseline is that
commit's first parent (the empty string when it is the root — the whole history is the
migration's). Person commits above the run — the release remedy loop's own fix commits, an
adopted or agent-made commit, an unrelated README edit — sit INSIDE the range and are scanned with
it: deliverable content is P1's subject whoever wrote it. The pre-driver upstream below the
boundary stays unscanned (0119's ruling kept; the `--grep` form keeps its cost bound — a pristine
upstream the migration only read matches nothing and never streams to the node process). When no
boundary commit is reachable, the baseline is HEAD itself (a repository the migration never wrote
into the history of — nothing of the migration is committed there; the clean-tree check owns the
worktree), and release refuses instead when the repository is in config `isolate` — the unlanded
round's writing sits on the `auto/R-NN` branch the driver knows; the refusal names it. The ✓ line
states what was scanned (the boundary kind, the baseline short SHA, the changed-file count) — the
certified state is checkable, not asserted. round-close's ledger reads the same function (0119 D2:
both gates, one set).

## D2 — the driver witness is the trailer block, one reader

`driverStage(body)` in git.ts: the trailer block is the LAST paragraph of the body, witnessed only
when every line of it is trailer-shaped (`Key: value`); the function returns the Auto-Stage value
from that block alone. A prose paragraph mentioning the trailer (the measured
"Note: the driver's Auto-Stage: trailer is not on this one."), a subject quoting it, or a body
quoting another commit's message ABOVE the last paragraph never witness a driver commit; git's
own `%(trailers:…)` parser reads the same block, and the anchored `--grep` form used by D1's walk
matches the same line. Every audit reader uses it: foreignCommits (the count of bodies without a
witnessed stage), driverBaseline's D1 walk (the grep pre-filter's candidates are the witness
shape by construction), wall.ts's sealed-channel scan, land's foreign-commit refusal (through
foreignCommits). The task readers (`taskFirstCommit`, the `Auto-Task: T-NNN` match) read the same
block for their key — a whole-line match anywhere in the body was the same accidental shape
(0140's readers stand, gaining the grammar). The deliberate imitation door (0165-024/S12-05 — any
writer can add a trailer) stays open and stays the commit-provenance guard's family (0169 D4);
checking the value against a stage vocabulary is consciously not enacted — no central stage
registry exists to check against (P21: the registry is a name until a consumer rules it).

## D3 — an audit that cannot judge its range fails loud

foreignCommits returns undefined on a nonzero `git log` (an unresolvable baseline, a corrupt
repository); every caller treats undefined as a problem line (the close-out and resume gates
block; rollbackUnit's repository goes to failures "cannot be judged"; land's refusal counts it
foreign — conservative under uncertainty, P12) — never as zero. The audits add the ancestry check:
`git merge-base --is-ancestor <baseline> HEAD` — false means HEAD was rewound to or below the
baseline (an agent's `git reset --hard HEAD~N` mid-unit), the range means nothing, and the problem
line names it ("history rewritten below the unit baseline (HEAD <head> does not contain <sha>)");
unitViolations and baselineIntact both check it ahead of the foreign count, and rollbackUnit
refuses the repository on it (its `reset --soft <baseline>` over a rewound HEAD would move HEAD
forward and stash the reversal — the finding's measured shape).

## D4 — the driver's git children run scrubbed; the hooks posture is surfaced

The ruling on 0165-142: the driver's git children HONOR the target repository's hooks (the
person's commit policy — a formatter, a signer — is theirs on every commit the repository will
carry, the driver's bookkeeping included), and the spawn scrubs the driver's own variables: the
git() helper's env drops every `OPENCODE_AUTO_*` key (GIT_OPTIONAL_LOCKS still set) — the hooks
run under the person's environment, never seeing the driver's switches (0059 X1's measured
incident — a project's pre-commit test hook starting real agent sessions through
OPENCODE_AUTO_AGENT — closes; no hook bypass is enacted, so a person's failing hook still halts
the run loudly as a commit failure). The posture is surfaced at run start (P8): preflight reports,
per repository, the git hooks it carries (a non-sample file under the repository's hooks
directory, or a `core.hooksPath` set inside the tree) with one teaching line — the hooks run on
the driver's commits too, a failing one halts the run, and the driver's variables are scrubbed
from their environment. A session-planted hook therefore runs at the driver's commits under a
scrubbed env — and its message interference is caught by the close-out's audit (a stripped
Auto-Stage trailer reads as a foreign commit and blocks), the measured repro's own ending.

## Residuals

- The deliberate imitation door (any writer can author a trailer block) stays open — the
  commit-provenance guard's family (0169 D4), unchanged by the stricter grammar.
- A hand-made squash whose LAST squashed message ends in a driver trailer paragraph still reads
  as a driver commit at D2's block rule (git's own %(trailers) parser reads the same last
  paragraph) — the accidental prose and mid-body shapes are gone; the squash-imitation tail is
  the guard's family.
- The hooks notice is detection only: a hook that fails the driver's commit still surfaces as a
  commit failure line naming git's error (loud, the cause the person's own policy) — no per-hook
  remediation is invented.

## Tests

- git.test.ts: driverStage's grammar (the trailer paragraph witnessed; prose mention, quoted
  message above the block, single-line subject never); foreignCommits undefined on an unresolvable
  baseline and the ancestry problem line on a rewound HEAD (unitViolations, baselineIntact both
  block; rollbackUnit refuses); driverBaseline's walk (person commits above the run inside the
  range — the S1 repro: two releases across a partial fix commit, the second still lists the
  rest; the landed repository recognized by the landing subject; the root driver commit's empty
  baseline; the never-written repository's HEAD baseline).
- release.test.ts: the partial-fix repro end to end (release → fix one finding, commit → release
  still lists the rest); the isolate refusal naming the round branch; the ✓ line's range facts.
- wall: the prose-mention commit reads as an amendment, not a driver violation.
- preflight: the hooks notice (a hook present → one line; none → silent, the floor) and the env
  scrub (a hook capturing its environment sees no OPENCODE_AUTO_*).

Fail-before: the S1 repro's second release certified over the empty scan; the prose-mention
commit read as a driver commit at unitViolations; the rewound HEAD passed the close-out; the hook
saw OPENCODE_AUTO_AGENT.
