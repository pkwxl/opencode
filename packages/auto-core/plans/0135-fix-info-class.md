# 0135 — the info class: a recorded state is not a finding (the fix rule table's third class)

The field incident (2026-10-27, the maintainer's report on the aster-mig fork baseline — `fix` on
`/workspace/aster-mig-root/fork/baseline-t001`): the supersession note 0114 D2 had added printed under
the manual class as

```
config-layer findings in /workspace/aster-mig-root/fork/baseline-t001:
  manual: .opencode/auto/config.json: phases "survey,spec-read,design,implement,test,audit" is superseded — R-01 establishes under the released roadmap of docs/analysis.md; nothing to repair (reshape rounds by moving its lines)
1 finding(s) need a person (listed as manual above): edit the file by hand, then re-run opencode-auto fix /workspace/aster-mig-root/fork/baseline-t001
```

with exit 1. The maintainer's words: this output "consistently makes users uneasy, leading them to feel
that the current configuration is inconsistent with the software's expected state." The paste also
carried the note's em-dash rendered `?` — the reporting terminal's locale, not the tool's bytes.

The analysis: three defects compound in one output, all presentation, none in the finding's substance.
First, the rule table had two classes (0052 D10: fixable / manual, manual = "report only, never guess"),
and the supersession note — an expected posture with no person act — was slotted into manual in 0114
because no third class existed; the code comment itself already said "Nothing to repair". Second, the
shell renders every manual finding with a trailer that hard-codes one remedy ("edit the file by hand,
then re-run fix") written for the hand-repair kind (invalid JSON, an unshapeable opencode.json); for the
supersession note that advice is a dead end twice over — no edit of config.json clears the finding (it
follows the roadmap's coverage, not the file), and amending the key is the one act the design forbids
(`status`'s ℹ line ends "never by amending the key"; `amend --phases` refuses outright, 0114 D3). The
command's own closing line taught the wrong remedy, contradicting the finding's text two lines above it.
Third, manual findings exit 1 for plain `fix` and `fix --dryrun`, and `--dryrun`'s exit 1 is the
documented CI gate on config drift — a project under a released roadmap failed its drift gate forever
over a healthy state. `status` already framed the same fact correctly (an ℹ line, 0114 D2's own
wording); `fix`'s framing was the outlier. The census also noted the trailer is rough for two other
manual kinds (provenance findings — remedy `sync`; a stale external allow — remove if moved); those keep
manual, a person decision existing, and their findings' own text names the true remedy — only the
supersession note has no person act at all.

This ruling Derives: **P8** (deliberate enforcement moments — the class split is the principle's own
question answered: a posture with no remedy is detection that records, never a finding whose moment has
come; the surfaced lines stop teaching a false remedy), and **P13** (frozen additive-only vocabularies —
the `FixFinding` class vocabulary grows additively to three, `manual` keeps its meaning untouched, the
exit-code contract changes by conscious lockstep with the README table and the pins in this one change,
and the note's own text stays byte-identical). Tier touched: **presentation/vocabulary** — one class word
in the core's finding type, the shell's fix block, driver-helper's row 10, documents; no rule, no write,
no predicate moves.

## Category scope (0123 D1's discipline)

Family: *the fix rule table's finding classes and their enforcement moments (0052 D10's two-class
contract, 0114 D2's supersession note the recorded member).* Home-set enumerated at ruling time:

| home | disposition |
|---|---|
| `src/config-fix.ts` (`FixFinding.class`, the rules comment, `formatFixPlan`, the supersession block) | changed — the info class added, the note re-classed, the `info:` line rendered |
| `packages/auto/src/index.ts` (the fix block) | changed — the notes header, the info-only closing lines, the exit codes (plain and `--dryrun`) |
| `src/driver-helper.ts` (row 10) | changed — info findings excluded from the ⚠ config-findings row (a channel line there would send the pen after the one key the design forbids amending) |
| The note's text, the coverage predicate, `fixHint`, `status`'s ℹ line, `amend --phases`'s refusal | held — byte-identical; the note's substance was never the defect |
| The provenance and external-dirs manual findings | held, manual — a person decision exists (`sync`; remove if moved); their own text names the remedy |
| `test/config-fix.test.ts`, `test/driver-helper.test.ts`, `packages/auto/test/e2e.test.ts` | changed — re-pinned and extended |
| `packages/auto/README.md` | changed — the three-class paragraph, the table completed (the 0122/0100 rows it lacked; the stale brief-stub row removed — 0081 D11 retired that finding), the dryrun contract, the exit table, the transfer section's phrasing |
| `docs/structure.md`, `AGENTS.md` | changed — the Config fix row and the navigation line |

## The ruling

**D1 — the info class.** `FixFinding.class` grows additively to `"fixable" | "manual" | "info"`:
fixable = deterministic and meaning-preserving, applied; manual = report only, a person decides (never
guess); **info = recorded state, nothing to repair** — the note names an expected posture and its
channel, asks nothing of anyone, and fails no gate. The roadmap supersession (0114 D2) is the first and
only member. The vocabulary lands in one change with every consumer: `formatFixPlan`'s `info:` line, the
shell's fix block, driver-helper's row 10, the README's classes paragraph and rule table.

**D2 — the shell's framing follows the class.** With only info notes: the header reads
`config-layer notes in <dir>` (not findings), the closing line names the posture for both plain `fix`
and `--dryrun` (`✓ nothing to fix: the note(s) above are informational — nothing to repair` /
`dryrun: nothing was changed; the note(s) above are informational — nothing to repair`), the manual
trailer never prints, and both exit 0 — the CI drift gate stays green, an expected state is not drift.
Mixed with fixable or manual findings, the info lines simply ride in the list under the findings header;
the counts, the trailer and the exits count only fixable and manual.

**D3 — driver-helper's row stays quiet.** The person-proxy brief's ⚠ config-findings row counts only
fixable and manual findings; an info-only plan renders no row — the note's channel (the roadmap line) is
not a pen act against the config layer.

**D4 — the note's substance untouched; the `?` declined.** The problem text, the coverage predicate
(following the released roadmap's coverage, never the document's mere presence), m mode's exclusion and
`status`'s ℹ line are byte-identical. Replacing the em-dash for the reporting terminal was considered
and declined: the copy family uses `—`, `→`, `✓` pervasively by design, a single-character concession
would fork the style, and it would fix nothing about a non-UTF-8 terminal.

**D5 — the residual recorded.** The manual trailer's "edit the file by hand, then re-run fix" remains a
rough edge for the two manual kinds whose true remedies differ (provenance → `sync`; a stale external
allow → remove if moved). They stay manual — a person decision exists — and their findings' own text
names the remedy; the trailer is generic-rough there, never false-in-the-same-breath the way the
supersession note was. Reopened on the next field report that names it.

## Enactment

`src/config-fix.ts`, `packages/auto/src/index.ts` (the fix block), `src/driver-helper.ts` (row 10),
`test/config-fix.test.ts` (the 0114 pin re-pinned to the info class, the `formatFixPlan` pin),
`test/driver-helper.test.ts` (the info-only row-10 pin), `packages/auto/test/e2e.test.ts` (the info-only
case: notes header, no trailer, exit 0 plain and `--dryrun`, nothing written), `packages/auto/README.md`,
`docs/structure.md`, `AGENTS.md`, this file, the INDEX row. Verification: full typecheck clean (both
packages); auto-core 2802 and the shell 151 passing (+ the E2E-gated skips).

## The closing read

The incident's own scenario through the rebuilt CLI (a scratch project, `init --phases mt`, a released
`docs/analysis.md` whose line covers R-01): `fix --dryrun` prints the notes header, the one `info:`
line, and the informational closing, exit 0 with an empty stderr — no "need a person" trailer anywhere;
plain `fix` the same with the `✓ nothing to fix` close. The e2e case pins exactly this shape against
the real CLI, and the person-facing answer to the incident's unease is now the output itself: the state
is expected, nothing is inconsistent, nothing is asked.
