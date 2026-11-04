# S26 — CLI shell A: parser, help, option policy

Date: 2026-11-04. HEAD read: e9c166fba (= d579016b2 in scope; `git diff --stat d579016b2..HEAD -- auto/src/index.ts auto/AGENTS.md auto/test/e2e.test.ts` empty). Status: done.

## Coverage

- auto/src/index.ts:1-1259 deep (argv parser + VALUE/REPEAT/BOOLEAN tables, retired-command notices, OPTION_HELP/COMMANDS/EXIT_CODES, OWNED/RETIRED/KNOWN flags, optionRefusal ladders, close/fork/remove-fork argument checks, land --merge trap, legacy-layout and run-lock gates); 1260-1449 partial (run/_lane/plan block entries — S27's scope); 1829-2030 partial (refuse* helpers, parseSessionFlags, loadRunConfig, logRunBanner); 2455-2495 partial (amend ladder); 3346-3359 probe (missing-subcommand tail).
- auto/AGENTS.md deep (50 lines).
- auto/test/e2e.test.ts probe (describe census) + 2813-2990 deep (help/unknown-command tests, the 0159 enumeration guard).

## Findings

```jsonl
{"id":"S26-01","title":"the `--` end-of-options token floods the refusal with the entire flag vocabulary","sev":"S4","conf":"CONFIRMED","cat":"UX","measures":["P8"],"loc":["auto/src/index.ts:1002","auto/src/index.ts:213-235"],"symbol":"similarOptions","evidence":"`--` parses to the empty key; similarOptions(\"\") matches every KNOWN_FLAGS member (startsWith(\"\")), so run/plan/transfer answer `unknown option -- (did you mean --agent / --server / … ~80 names incl. retired --commit --implement-file …)`","repro":{"cmd":"bun auto/src/index.ts run <empty-dir> --","observed":"one line naming the whole vocabulary incl. retired flags"},"impact":"an unreadable refusal for a conventional token","remedy":"return no suggestions for the empty key (or treat `--` as the positional marker); one line in similarOptions","family":[],"prior":"NEW","wave_hint":"shell polish"}
{"id":"S26-02","title":"boolean flags' --flag=value form is unvalidated: any non-false value means true","sev":"S4","conf":"CONFIRMED","cat":"DEF","measures":["P12","0159"],"loc":["auto/src/index.ts:217-224","auto/src/index.ts:2006"],"symbol":"parser eq-branch","evidence":"the `=` branch sets any value without membership/truthiness validation; every reader is `flags.get(k) !== \"false\"`, so `--verbose=x` (synopsis promises [true|false]) is silently on — the same shape 0159 closed for `--probe=false`","repro":{"cmd":"bun auto/src/index.ts run <dir> --verbose=x","observed":"accepted, verbose on"},"impact":"a typo'd boolean value (`=flase`) silently means true","remedy":"validate the `=`-form of BOOLEAN_FLAGS against true/false at parse (one check in the eq branch)","family":[],"prior":"NEW","wave_hint":"shell polish"}
{"id":"S26-03","title":"extra positionals are silently ignored on every command","sev":"S3","conf":"CONFIRMED","cat":"DEF","measures":["0159","P8"],"loc":["auto/src/index.ts:1210"],"symbol":"directory resolution","evidence":"directory = positional[0] (close [1], fork [2], remove-fork [1]); positional overflow never checked — 0159's own deferred residual (plans/0159 l.105: `plan a b --scaffold` runs on `a`)","repro":{"cmd":"code trace; 0159's recorded scene","observed":"no refusal path exists for a second positional"},"impact":"`run dir1 dir2` runs dir1; a mistyped extra word is swallowed silently","remedy":"refuse positional overflow per command (usage error naming the command's positional grammar), one check after the per-command positional splits","family":[],"prior":"RESIDUAL-0159","wave_hint":"shell usage-hardening"}
{"id":"S26-04","title":"amend (and _lane) silently ignore the retired extras --commit-subtask/--verify-idle/--verify-max","sev":"S3","conf":"CONFIRMED","cat":"DEF","measures":["P13","0159","P8"],"loc":["auto/src/index.ts:2486","auto/src/index.ts:1937-1960","auto/src/index.ts:956"],"symbol":"amendCommand allowed set","evidence":"the three extras are whitelisted in KNOWN_FLAGS (956) and explicitly added to amend's allowed set (2486), but their retirement notices live only in refuseFrozenFlags (1937-1960: run/plan/transfer) and init's block — parseConfigFlags reads neither","repro":{"cmd":"init a target, then `amend <dir> --commit-subtask` / `--verify-idle 5`","observed":"`name at least one key to change…` — the flag ignored without its notice; `amend <dir> --verify-idle 5 --context-limit 128` would amend context-limit silently beside it; `_lane … --commit-subtask` also proceeds"},"impact":"a retired flag's notice never reaches an amend caller; the enum guard (e2e.test.ts:2904) covers run/plan/transfer only, so the hole is unpinned","remedy":"drop the three from amend's allowed set (the generic `--x is not an amend option` ladder then catches them — or route them through a shared retired-extras refusal carrying their notices); add amend/_lane to the guard's CONSUMED table","family":["auto/test/e2e.test.ts:2904 CONSUMED"],"prior":"NEW","wave_hint":"shell usage-hardening"}
{"id":"S26-05","title":"enumeration drift in the CLI's own prose: 'the public sixteen' (18 rows), AGENTS.md's command list (15, no fork/remove-fork/driver-helper), the -f refusal naming init/reset/fix but not sync","sev":"S4","conf":"CONFIRMED","cat":"DOC","measures":["P13","P5"],"loc":["auto/src/index.ts:721-722","auto/AGENTS.md:7,29","auto/src/index.ts:1986"],"symbol":"COMMANDS comment / AGENTS.md Overview / force refusal","evidence":"COMMANDS holds 18 rows; KNOWN_COMMANDS comment says 'the public sixteen'; AGENTS.md:7 lists 15 subcommands (fork/remove-fork/driver-helper missing) and :29 still names the retired 'brief stub'; '-f/--force is an init/reset/fix option' while sync accepts it too (SYNC_FLAGS, OPTION_HELP force row says 'shared by init, reset, fix and sync')","repro":null,"impact":"stale self-description; the force refusal teaches an incomplete owner set","remedy":"one prose change: the comment, the AGENTS.md list, the refusal line; confirms S01-06's CLI-side family (shell-contract §A is its core side)","family":["S01-06"],"prior":"NEW","wave_hint":"docs truth"}
```

### S26-03 failure scenario
`opencode-auto plan proj extra-word --scaffold` → directory resolves to `proj`, `extra-word` never examined → the command runs on `proj`; the person's typo (a second path, a stray word) has no effect and no message. Same for `run a b`, `close T-001 a b`, `fork T-001 wt extra`.

### S26-04 failure scenario
`opencode-auto amend proj --verify-idle 5 --context-limit 128` → the ladder allows verify-idle (2486), parseConfigFlags ignores it, the amend writes context-limit 128 → the person believes the watchdog was configured; the retirement notice ("was renamed to --idle-time") never prints. `run`/`plan`/`transfer`/`init` all refuse the same flag with the notice.

## Leads

- R8-argv-probe — not run as written: the draft only echoes process.argv in a child; the value-flag swallow it was built to probe is pinned by the 0159 enum guard (e2e.test.ts:2904, spawns every flag) and refuseLaneValueFlags (index.ts:1882). Equivalent spot probes recorded in S26-01/S26-02 repros.
- R8-cli.sh — not run: a wrapper hardcoding the first attempt's dead scratchpad XDG path; the direct `bun auto/src/index.ts` invocation used instead.

## Residuals

- 0159 "extra positionals silently ignored" — **still open** → S26-03.
- "fix --dryrun exit 1 documented?" — **yes, closed on the help surface**: OPTION_HELP fix row (index.ts:324 "exit 0 when there are none, 1 when there are any") and EXIT_CODES (index.ts:592 names fix --dryrun under code 1). README/MANUAL check deferred to S28.
- amendPhasesHold — **fixed**: no occurrence anywhere in auto/ or auto-core/src (grep empty); 80fd308c5's claim holds.

## Verified clean

- Exit codes: `--help`/`-h` exit 0 stdout; bare invocation full usage stderr exit 1; unknown command one-line refusal exit 1; every option refusal exit 1 — EXIT_CODES (index.ts:591-595) carries 0/1/2/3/130 matching core AGENTS.md exactly (e2e.test.ts:2813 pins it).
- land's `--merge` swallow trap intercepted before directory resolution (index.ts:1200-1209) — the one value/boolean collision in the vocabulary.
- Retired commands `continue`/`check` answer ahead of every policy (260-280); scoped retirements (init's -p/--brief/--brief-file) fire on init alone; `--help` outranks every option refusal (pinned e2e.test.ts:2830-2870).
- close/fork/remove-fork positional[0] shape-checked before the directory resolves (CLOSE_REF 1110, FORK_TARGET 1150, remove-fork 1181) — a non-ref first word is a usage error, never a directory silently taken as the ref.
- `--probe=false` explicit opt-out honored (observed); `--from-bundle`/`--probe`/`--check` each refuse off-owner commands via OWNED_FLAGS (829-912); init refuses the retired extras with their notices (observed).
- The 0159 enum guard (e2e.test.ts:2904) derives VALUE/BOOLEAN/RETIRED from the source and asserts every non-consumed flag refuses with exit 1 naming it, for run/plan/transfer — a strong oracle (its coverage gap is S26-04's remedy).

## Design notes

The parser/policy layer is healthy and unusually well-tested for a hand-rolled CLI: one vocabulary, one help table, a source-derived enum guard. The defects found are all in the guard's blind spots — commands outside run/plan/transfer (amend's ladder hole) and token forms outside `--flag [value]` (`--`, `=value`, positional overflow). Best choice: the 0159 guard's design; worst: the retirement notices' placement inside refuseFrozenFlags, which made every other command's ladder responsible for remembering them (amend forgot). Change first: S26-04, then the positional-overflow refusal.

## Seam notes

- S27: the amend ladder hole's fix belongs with a CONSUMED-table extension (test home in the same change); verify `run` on an uninitialized directory exits loudly after the banner (loadProjectConfig returns defaults on a missing file, config.ts:147-151 — the banner prints defaults before the core's phase-routing refusal; confirm the exit path).
- S28: README/MANUAL retired-vocabulary sweep should take S26-05's AGENTS.md items with it; the `fix --dryrun` exit-1 doc check on the README side is open.
- S30/S29: the server shell's mirror ladders (ops.ts parseConfigKeys) likely share the amend hole — check against S26-04.
