# 0195 — the CLI parser's refusal grammar completed: positional arity, boolean `=value`, the empty key, `_lane`'s machine-entry policy

Status: active-authority (0166 remediation step 035, wave W3-shell-seam; findings 0165-166,
0165-211 and 0165-212 re-verified live against HEAD `2c2aba422` at ruling time — the `--`
refusal flooding with the whole ~80-name vocabulary verbatim, `run <dir> --verbose=x`
accepted through the banner with verbose silently on, `status <dir> <extra>` printing the
status of `<dir>` with the extra word swallowed. Finding 0165-167 is **already remediated at
HEAD by ruling 0193 D1** — the one emitter family's `phasesLine` is phased-aware, verified
live: an `init --phases dm` project's missing-index line teaches `transfer`, m mode's teaches
`plan`, and plan's own refusal names transfer consistently; this ruling dispositions the row,
adds the shell-level pin the finding's surface still lacks, and changes no core code for it).

One family: **0159's enumeration guard enumerates flag tokens per command, but the parser's
grammar has token forms and one entry the guard's frame never covered.** Three forms outside
`--flag [value]`: positional overflow (every command resolves `positional[0]`-class indices
and never checks what follows — 0159's own deferred residual, recorded at its l.105), the
`=value` of boolean flags (the eq branch sets any value and every reader is a `!== "false"`
comparison, so `--verbose=flase` means true — the exact shape 0159 closed for `--probe
false`'s space form), and the empty key (`--` parses to `""`, and `startsWith("")` matches
every name, so the did-you-mean clause floods with the entire vocabulary, retired flags
included). And one entry: the hidden `_lane`, whose policy 0193 D5 scoped to the shared
vocabulary alone, leaving run's execution shaping, plan's input flags and the close family
passing the machine entry silently ignored — the residual 0193 itself named as this step's
to rule.

Derives: **P12** — fail loud, conservative under uncertainty: a swallowed word is the
principle's clean-verdict shape in miniature — `run dir1 dir2` runs dir1 with dir2 never
surfacing, `--dryrun=flase` spends the tokens dryrun was meant not to, a launcher-drifted
`_lane --dryrun` runs a real lane; each now refuses at the shell's argument policy, the
earliest moment the mistake is visible. **P8** — deliberate enforcement moments: the refusals
are the stop's own usage errors, each naming the offending token and the command's true
grammar (the remedy taught in the line itself); detection alone was 0159's era — the residual
is now enforcement. **P13** — frozen additive-only vocabularies: every change is an added
refusal shape; no exit code changes (all are usage errors, exit 1, the pinned family), no
literal changes meaning, no flag retires; the new lines land with their pins in the same
change, and the guard's `_lane` column grows by extension, not rewording of its standing
members. **P10** — the byte-identical floor: every argv form accepted today stays accepted
(bare booleans, the swallowed `true`/`false` space form, `=true`/`=false`, the per-command
positional grammars as documented in every synopsis, `_lane <dir> --unit <id> [--merge
<branch>]` — the default launcher's exact argv, plus the session flags its block genuinely
reads); what changes is exactly the ruled defect fixes, each fail-before covered. Amends:
none — no principle restated. Tier: shell code (`packages/auto/src/index.ts` alone — the
phasesLine half rides 0193 D1's core change unchanged), tests (`packages/auto/test/e2e.test.ts`).

premises this ruling changes: **0193 D5's residual clause** ("`_lane`'s policy owns the
shared vocabulary alone … a stricter machine-entry policy is step 035's to rule" — ruled
here: the policy becomes the strict allowlist of what the entry's block reads; the enum
guard's `_lane` column premise "the layers beyond the shared vocabulary are not
re-enumerated" is superseded — the column now enumerates the whole vocabulary), **0159's
deferred positional residual** (its recorded scene `plan a b --scaffold` running on `a` —
now a usage error; 0159's own enumeration-guard frame is unchanged, the positional form
joins it as this ruling's tests). Each re-read in this document where its premise is
touched.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P12** — the three token-form defects are each a swallowed signal: the directory
  resolution trusts `positional[0]` and ignores the rest; the boolean readers trust
  "anything but false is true"; the suggestion engine trusts that a prefix filter over a
  non-empty key produces a readable clause. Uncertain readings resolve toward the refusal,
  never toward the silent default.
- **P13** — the CLI's refusal vocabulary is frozen grammar: exit codes stay (1, the usage
  family), the existing refusal lines stay byte-identical (pinned by the standing e2e usage
  tests), the additions are new refusal shapes that teach their remedy (P8). The `--` line
  keeps the unknown-option form — no new vocabulary element is invented for it.
- **P10** — the floor is measured per accepted form: the arity table matches every synopsis
  in COMMANDS (close 2, fork 3, remove-fork 2, everything else 1 — the synopses are the
  documented grammar this check enforces, not a new policy); the boolean validation accepts
  exactly the forms the parser already produced meaning for; `_lane`'s allowlist is exactly
  the flag set its block reads (`--unit`, `--merge`, and `parseSessionFlags`' six). No
  legitimate caller's argv changes behavior.
- **P8** — every new line names the offending token and the true grammar: the arity refusal
  quotes the extra word and the command's positional grammar; the boolean refusal names the
  flag, the two valid values and the bare-means-true rule; the `_lane` refusal names the
  entry's whole flag grammar and whose invocation the flag belongs to.
- **P21** — machinery waits for its consumer: the conventional end-of-options **marker
  semantics** for `--` are declined — no flag in the vocabulary takes a value that may begin
  with a dash (no directory, branch, url or path a caller needs to shield), so the marker
  has no consumer; the ruling takes the finding's other remedy (no suggestions for the
  empty key), and a future dash-leading value adds the marker consciously, in the same
  change as the flag that needs it. The `_lane` allowlist, by contrast, has its consumer
  already: the core's lane launcher (`src/shell.ts` `defaultLaneLauncher` — the exact argv
  pinned above) and the launcher-drift hazard the refusal surfaces.
- **P19** — measured evidence: the unrefused `_lane` set was enumerated, not guessed — the
  OWNED_FLAGS ladder already refuses plan's routes, land's, sync's, models' and
  install-prompts' flags on the hidden entry; what passes today is exactly twelve flags
  (run's six execution-shaping, plan's two input, close's four family), each named in D4.

## D1 — positional overflow is a usage error on every command (0165-166)

One check after the per-command positional splits (close's ref, fork's target and worktree
path, remove-fork's path have consumed and validated their own leading words) and before
the directory resolves: `positional.length` against the command's arity — close 2, fork 3,
remove-fork 2, everything else 1 (the hidden `_lane` included: its launcher passes exactly
the worktree). The refusal quotes the first extra word and states the command's positional
grammar — the three special commands their documented synopsis shape, the rest
"`<command> takes at most one directory argument (usage: opencode-auto <command> [dir])`".
Exit 1, stderr, the usage family's code. This closes 0159's own recorded scene
(`plan a b --scaffold` running on `a`): the plan input, the refusals and the gates all fire
as before; only the swallowed word now surfaces first — it is the earliest mistake on the
line.

**The interplay the check exposed (found in-change, at verification)**: the retired
watchdog extras `--verify-idle`/`--verify-max` were whitelist literals, not value flags —
so `run <dir> --verify-idle 10` leaked the 10 as a stray positional, and the arity check
fired ahead of the rename notice that owns exactly that line (the pinned test
`run refuses options frozen by init` caught it, red). The fix is the file's own documented
rule for retired value flags (0053 D13: "--implement-file/--implement-prompt/--commit
swallow one too, so their argument is never mistaken for the directory"): the two extras
join VALUE_FLAGS, keeping the swallow courtesy — `--verify-idle 10` swallows, the rename
notice is the one answer, and the arity check sees no extra word. The 0159 guard derives
VALUE_FLAGS from the source, so its refusal columns pick the swallowed form up in the same
change; `--commit-subtask` (never a value flag) keeps its bare shape. A retired flag whose
notice is the remedy owns its value token; the arity grammar owns everything else.

## D2 — the `=`-form of boolean flags is validated (0165-212)

After the retirement-notices loop (a retired boolean — `--amend=x` — keeps its retirement
notice, the more specific remedy; every flag remaining is one the command's policy accepted)
and before any command block reads a flag: for every BOOLEAN_FLAGS member present with a
value other than `""` (bare), `"true"` or `"false"`, one usage error — the flag named, the
two valid values, the offending value quoted, the bare-means-true and `=false`-opt-out
remedies taught. The space form is unchanged (the parser swallows only a literally
following `true`/`false`; any other next token stays positional and is D1's to refuse); the
`--probe=false` opt-out and `--dryrun=false` shapes are untouched. This covers every
boolean-reading command at once — run/plan/transfer's session flags, close's pair, land's
booleans, init/amend's config booleans, fix/sync's `--dryrun` — one home for the check, at
the parser's own policy layer, exactly where 0159 put the probe fix's sibling.

## D3 — the empty key suggests nothing (0165-211)

`similarOptions` returns no suggestions for the empty key: `--` (and `--=x`) keep the
unknown-option refusal — `unknown option --; run 'opencode-auto <command> --help' …` — an
honest one-line answer naming the token as what it is here: not an option. The marker
semantics are declined on P21 grounds (above). The strict ladders (close, land) share the
fix through the same helper — `close --` answers `-- is not a close option: <usage>`
without the flood. One line changed; no other key's suggestions change (a one-character
prefix still suggests; the flood was the empty prefix alone).

## D4 — `_lane`'s machine-entry policy is the strict allowlist (0193 D5's residual, ruled)

The hidden entry takes exactly what its block reads: `--unit <id>`, `--merge <branch>` and
the session flags `parseSessionFlags` consumes (`--server`, `--verbose`, `--interactive`,
`--wait-answer`, `--permission`, `--new-session`). Every other known flag is refused with
one line naming that grammar and the truth beside it: the entry's argv is the parent run's
lane launcher's own — the flag belongs to a public command's invocation. The measured
unrefused set this closes: run's execution shaping (`--wait-between`, `--max-sessions`,
`--repair`, `--stop-after`, `--boundary`, `--dryrun`), plan's input (`-p/--prompt`,
`--file`) and the close family (`--reason`, `--cascade`, `--commit-changes`,
`--stash-changes`) — twelve flags, each silently ignored before, each a real hazard in the
one shape that reaches it: launcher drift (a future lanes change threading `--dryrun` into
the spawn would run a real lane, spending tokens the parent meant not to spend). The
refusal sits after `refuseFrozenFlags("_lane")` (0193 D5's layer keeps its specific
notices) and before the entry's work. The 0159 guard's `_lane` column extends with it:
every flag of the derived vocabulary outside the allowlist must refuse with exit 1 naming
it — the column no longer scopes to the shared layers (the superseded premise, above).
Nothing legitimate is refused: the default launcher's argv is the allowlist's floor, and
the server shell is untouched (its lane channel is the `worker '<json>'` self-spawn, no
argv flags — the strictness question does not arise there).

## D5 — phasesLine: verified fixed by 0193 D1, pinned at the shell (0165-167)

The defect — the banner's missing-index remedy teaching `plan` exactly where plan refuses
naming `transfer` — was the shell-mirror family's member S29-08 half, remediated by step
033's one emitter family: `auto-core/src/banner.ts` `phasesLine` carries the phased split
(0101 D4's rule), both shells render through it, and the served surface names the server's
own routes (0193 D3). Verified live at this step's HEAD: a phased project's line teaches
`transfer`, m mode's teaches `plan`, the core's `status` view agrees, plan's refusal
teaches transfer — one consistent teaching. This change adds the pin the finding's named
surface (the CLI binary's banner) still lacked: an e2e over the real CLI — the phased
banner's missing-index line names transfer, the m-mode status line names plan. No code
changes for D5; the fail-before proof was step 033's (the phases-line split, both shells,
in 0193's floors list), and re-proving a committed remedy against its pre-fix source would
measure 033's change, not this one's.

## Category scope (0123 D1's discipline)

- **Code homes**: `packages/auto/src/index.ts` — `similarOptions` (D3, one line), the
  boolean `=`-form validation after the retirement loop (D2), the positional-arity check
  after the per-command positional splits (D1), `refuseLaneForeignFlags` and its call in
  the `_lane` block (D4), and the retired watchdog extras joining VALUE_FLAGS (D1's
  in-change swallow interplay). No other file changes behavior.
- **Test homes**: `packages/auto/test/e2e.test.ts` — the D1/D2/D3 refusal pins, the D4
  direct pins and the 0159 guard's `_lane` column extension, the D5 shell-level phasesLine
  pin. No auto-core or auto-server test changes (D5's emitter pins already live in
  `auto-core/test/banner.test.ts`, passing unchanged).
- **Documentation**: this document; the INDEX row; the program's ledger rows (0165-166,
  0165-167, 0165-211, 0165-212) and step record. No AGENTS.md navigation line — the CLI
  parser is the shell's own surface, already carried by the W3 family's line (0193).

### Re-reads

- **0193 D5** — the ruling's own residual clause is superseded by D4 here: the shared
  vocabulary layer (retired, frozen, revision pairs) keeps 0193's notices and order; the
  non-shared layers move from "the launcher's own argv" (permissive) to the ruled
  allowlist. The 0159 guard's `_lane` test comment — "the layers that are each public
  command's own surface are not re-enumerated here" — is rewritten with the extension.
- **0159** — its enumeration-guard design is unchanged and extends (the `_lane` column);
  its deferred positional residual closes (D1); its probe-fix precedent (the boolean space
  form) is completed for the eq form (D2) — the same invariant, the one token form left.
- **0053 D13/D20/D22, 0068 §6.4/D7** — the value-flag swallow rules, close's ref-first
  split and the lane entry's flags are untouched (the arity check enforces the synopses
  those rulings documented; `_lane`'s `--unit`/`--merge` stay exactly as 0068 defined).
- **0101 D4** — the phased split's teaching (D5) is 0193 D1's enactment of it; this ruling
  adds the shell-level pin only.

## Floors and proofs

- Byte-identical (pinned green on both sides): every existing usage/refusal pin in
  `packages/auto/test/e2e.test.ts` (the help precedence family, the owned-flag pointers,
  the retired notices, the strict ladders' messages, the 0159 guard's run/plan/transfer
  columns); the lane isolation and scheduler e2e suites (the launcher's real argv through
  the allowlist); the core suites untouched (no core src change).
- Fail-before (red on pre-fix source, green after): the D1 pin (`status <dir> <extra>`
  prints status today), the D2 pin (`run <dir> --verbose=x` accepted through the banner),
  the D3 pin (the `--` refusal flooding), the D4 pins (`_lane --dryrun` / `-p` / `--reason`
  accepted-and-ignored today) and the guard's extended `_lane` column (the twelve flags
  passing today).

## Residuals

- `--=x`'s value half: the refusal names `--` alone (the key, not the value) — the honest
  minimal form; a person who meant a value meant some other flag, and the line's pointer
  at `--help` answers.
- The marker semantics for `--` stay unruled-in (P21, above): a future flag whose value may
  begin with a dash adds the marker in its own change.
- The auto-server entry hygiene (stale refusal texts, token-name fallback, run-id shapes)
  is step 037's finding 0165-219 — the server's argv surface is not this ruling's (its
  lane channel carries no flags).

## Tests

Named in Category scope; the exact red pins are enumerated in the step record
(`plans/0166-remediation/035-w3-parser-polish.md`).
