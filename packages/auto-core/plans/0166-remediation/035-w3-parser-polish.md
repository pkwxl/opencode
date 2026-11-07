# Step 035 — w3-parser-polish: CLI parser polish — extra positionals, `--flag=value` validation, `--` flood, phasesLine remedy

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W3-shell-seam, findings **0165-166, 0165-167, 0165-211, 0165-212** (+
the `_lane` machine-entry residual 0193 D5 named as this step's to rule).
Started 2026-11-07 at HEAD `2c2aba422` (tree clean; steps 001–034 done; no
recovery needed — the coordinator verified the fresh-step path).

## Findings

- **0165-166** (S26-03, S3, CONF, 0159's own deferred residual): extra
  positionals are silently ignored on every command —
  `packages/auto/src/index.ts` resolves `directory = positional[0]` (close
  [1], fork [2], remove-fork [1]) and never checks overflow; `run dir1 dir2`
  runs dir1, `plan a b --scaffold` runs on `a` (plans/0159 l.105 recorded it).
- **0165-167** (S27-01, S3, CONF): phasesLine's missing-index remedy named
  `plan`, but its only caller context (phased projects, `config.phases !==
  "m"`) is exactly where plan refuses naming `transfer` — the banner taught
  the command that refuses, one refusal away from the right one.
- **0165-211** (S26-01, S4, CONF): the `--` end-of-options token parses to
  the empty key; `similarOptions("")` matches every KNOWN_FLAGS member
  (`startsWith("")`), so the refusal floods with ~80 names including retired
  flags.
- **0165-212** (S26-02, S4, CONF): boolean flags' `--flag=value` form is
  unvalidated — the `=` branch sets any value and every reader is
  `!== "false"`, so `--verbose=x` / `--verbose=flase` silently means true (the
  shape 0159 closed for `--probe=false`'s space form).

## Current state at start (verified against HEAD 2c2aba422)

- All four re-probed live. 166/211/212 confirmed present (the `--` flood
  verbatim; `run --verbose=x` accepted through the banner; `status dir
  extra-word` prints the status of dir with the extra word swallowed).
- **0165-167 already remediated at HEAD by step 033's ruling 0193 D1**: the
  one emitter family (`auto-core/src/banner.ts` `phasesLine`) is phased-aware
  — a phased project's missing-index line teaches `transfer`, m mode's
  teaches `plan`. Live probe: `init --phases dm` + `status` →
  `run opencode-auto transfer to establish the round`; plan's own refusal
  names transfer consistently. The CLI renders through `runBannerLines`
  (index.ts's `logRunBanner`); the server's worker likewise. The fail-before
  proof was step 033's (the phases-line split, both shells, in 0193's floors
  list); this step adds the shell-level pin the finding's surface still
  lacks (no e2e pins the missing-index line through the CLI binary).
- 0193 D5's named residual verified: `_lane` accepts beyond its shared
  vocabulary exactly run's execution shaping (`--wait-between`,
  `--max-sessions`, `--repair`, `--stop-after`, `--boundary`, `--dryrun`),
  plan's input (`-p/--prompt`, `--file`) and the close family (`--reason`,
  `--cascade`, `--commit-changes`, `--stash-changes`) — the OWNED_FLAGS
  ladder already refuses plan's routes, land's, sync's, models' and
  install-prompts' flags on `_lane`; the launcher's argv is only
  `_lane <dir> --unit <id> [--merge <branch>]` (the session flags read by
  `parseSessionFlags` are consumed, not ignored).

## Plan (enactment order; each ingredient lands green)

1. Ruling 0195 written first (Derives/Amends, Category scope, premise guard).
2. D3 — `similarOptions` returns no suggestions for the empty key (one line).
3. D2 — the `=`-form of BOOLEAN_FLAGS validated after the retirement notices
   loop (bare / `=true` / `=false` / the swallowed space form pass).
4. D1 — the positional-arity refusal after the per-command positional splits,
   before directory resolution (close 2, fork 3, remove-fork 2, else 1).
5. D4 — `_lane`'s strict machine-entry allowlist (`--unit`, `--merge`, the
   session flags; every other known flag refused, one line teaching the
   entry's grammar) + the 0159 guard's `_lane` column extended to the whole
   vocabulary.
6. D5 — the CLI-level phasesLine pin (phased run banner teaches transfer; m
   mode's status line teaches plan).
7. Full verification (packages/auto + auto-core), fail-before proofs over
   /tmp backups; docs (ruling, INDEX row, AGENTS nav), ledger, program
   position, single commit.

## Verification

All measured on the committed state (fail-before reds measured on pre-fix source over
`/tmp` backups, files restored and `cmp`-verified byte-identical, suites re-run green).
Touched: `packages/auto` (src + tests) and this package's plans/docs; auto-core src and
auto-server src untouched.

- **packages/auto**: `bun typecheck` clean; full suite **158 pass / 8 skip / 5 fail** —
  the 153/8/5 baseline plus the 5 net-new tests (the 4 token-form pins + the phased
  missing-index pin; the `_lane` guard column rewrites its existing test, +0 count). The
  5 = the pre-existing fork/remove-fork trailer-scan family (fork ×2, remove-fork ×3,
  each failing at `fork T-NNN <path> <dir>` exit 1) — **re-verified pre-existing on the
  pre-fix source** (same names, same count, source then restored and `cmp`-verified).
- **auto-core**: `bun typecheck` clean; full suite **3090 pass / 0 fail** (155 files,
  unchanged — no core src change; D5's emitter pins already lived in
  `test/banner.test.ts`, passing unmodified).
- **auto-server**: `bun typecheck` clean; full suite **139 pass / 1 fail** — the 1 = the
  known 0165-220 observe `sawDirty` race (step 073's), identical to step 034's measured
  baseline; no server file touched.
- **Fail-before red** (pre-fix `src/index.ts` over `/tmp`, tests fixed):
  - the 4 token-form pins **4 red** — each at its first finding-specific assertion (D1:
    `status <dir> <extra>` printing the status of `<dir>`; D2: `run <dir> --verbose=flase`
    accepted through the banner; D3: the `--` refusal naming ~80 flags; D4:
    `_lane --dryrun` accepted-and-ignored, stderr empty);
  - the widened `_lane` guard column **1 red** with exactly the twelve measured flags
    unrefused (prompt, reason, file, wait-between, max-sessions, stop-after, boundary,
    dryrun, repair, cascade, commit-changes, stash-changes — each "exit 1, stderr empty",
    the silently-ignored shape);
  - the D5 phased pin green on both sides by design (the remedy is step 033's 0193 D1;
    this step adds the shell-level pin, no code change — re-proving a committed remedy
    would measure 033's change, not this one's).
- **In-change discovery** (found by the suite at verification, fixed in the same change):
  the retired watchdog extras `--verify-idle`/`--verify-max` were whitelist literals, not
  value flags, so `run <dir> --verify-idle 10` leaked the 10 as a stray positional and the
  new arity check fired ahead of the rename notice owning the line (the pinned test
  `run refuses options frozen by init` went red, and with it the boundary test's
  `_lane --verify-idle 5` pin). The fix is the parser's own documented rule for retired
  value flags (0053 D13's swallow courtesy): the two extras join VALUE_FLAGS, their
  rename notice is the one answer again, and the 0159 guard's derived columns pick the
  swallowed form up in the same change. Ruling 0195 D1 carries the interplay.
- **Byte-identical floors green on both sides**: every pre-existing usage/refusal pin
  (help precedence, owned-flag pointers, retired notices, strict ladders, the frozen-key
  and enum-guard columns); the lane isolation, lane scheduler and stream-lanes e2e suites
  (the launcher's real argv through the allowlist — all green); `--probe=false`,
  `--dryrun=false`, bare and space-form booleans, the documented arities.

## Dispositions

- **0165-166** (extra positionals silently ignored) — **fixed** under ruling **0195 D1**:
  the positional-arity usage error on every command (close 2, fork 3, remove-fork 2, else
  1 — every synopsis's grammar), quoting the first extra word; 0159's own deferred
  residual closed; red fail-before, the D1 pin green after.
- **0165-167** (phasesLine's missing-index remedy naming plan where plan refuses naming
  transfer) — **fixed by step 033's ruling 0193 D1** (the one emitter family's phased
  split), verified live at this step's HEAD and **pinned at the shell** by this step
  (the phased run banner teaches transfer, m mode's status line teaches plan); no code
  change here — the fail-before was step 033's (both shells' phases-line split).
- **0165-211** (the `--` vocabulary flood) — **fixed** under ruling **0195 D3**: the empty
  key suggests nothing (`--` and `--=x` keep the plain unknown-option refusal; the strict
  ladders their own shapes); the end-of-options marker semantics declined on P21 grounds,
  recorded in the ruling; red fail-before.
- **0165-212** (boolean `=value` unvalidated) — **fixed** under ruling **0195 D2**: the
  `=`-form of BOOLEAN_FLAGS validated after the retirement-notices loop (bare / =true /
  =false / the swallowed space form pass untouched; a retired boolean keeps its
  retirement notice); red fail-before.
- **0193 D5's named residual** (`_lane`'s non-shared vocabulary — "a stricter
  machine-entry policy is step 035's to rule") — **ruled and enacted** under ruling
  **0195 D4**: the strict allowlist (--unit, --merge, the session flags — the default
  launcher's exact argv plus what the block genuinely reads), every other known flag
  refused naming the entry's grammar; the 0159 guard's `_lane` column widened to the
  whole derived vocabulary (the twelve silently-ignored flags red fail-before, green
  after); 0193 D5's shared-vocabulary layer keeps its specific notices and order.

Residuals recorded (0195's own list): `--=x`'s value half unnamed in the refusal (the
key alone is the honest minimal form); the `--` marker semantics unruled-in (P21); the
auto-server entry hygiene stays step 037's (finding 0165-219).
