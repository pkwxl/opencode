# Step 034 — w3-services-allowlist: the services() allowlist evasion in auto-server's worker-interactive

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W3-shell-seam, finding **0165-089** (S06-04). Started 2026-11-07 at
HEAD `15873713a` (tree clean; steps 001–033 done).

## Finding

0165-089 (S3, CONF, BOUND, P14/P5; measures 0061 C1–C5, 0067 §四 P3): the
`services()` allowlist is evaded across the package boundary —
`auto-server/src/worker-interactive.ts` imports the ambient accessor
(`services` from `@opencode-ai/auto-core/services`) and calls
`services().control.requestExit()` / `services().router.requestFailback(order)`
for the transport's control channel, while the callers ratchet
(`srcFiles()` in `test/services.test.ts`) walks auto-core's src only; the
module's header justifies the read by the core's `interactive` entry, which
names a different module. No wrong behavior today (one run per worker
process; `close()` clears `live` before runAll's finally uninstalls, so a
late frame cannot reach the fallback holder) — the cost is the seam: a shell
depends on the core's ambient holder and its install order, invisible to
the ratchet that exists to hold exactly that boundary.

## Current state at start (verified against HEAD 15873713a)

- The import and both call sites confirmed at
  `packages/auto-server/src/worker-interactive.ts:46,164,167`; the header's
  justification ("interactive is one of the SERVICE_ENTRIES") confirmed at
  lines 21–24.
- `srcFiles()` in `test/services.test.ts:354-366` walks
  `join(import.meta.dir, "..", "src")` — auto-core only; a repo-wide grep
  finds exactly one production import of `auto-core/services` outside the
  core (the worker transport) and two test imports (auto-server's
  ws-protocol suite, packages/auto's e2e — tests installing holders, the
  core's own tests' pattern).
- 0067 P3b's durable record (the liveness gate) and 0061's C-clause ("may
  be called only from the modules listed in SERVICE_ENTRIES") re-read: no
  ruling sanctions a shell caller; 0067's gate exists precisely so a frame
  never lands on the process-default holder — the direct import is the
  ungoverned half beside it.

## Plan (enactment order; each ingredient lands green)

1. Ruling 0194 written first (Derives/Amends, Category scope, premise guard).
2. Core seam: `src/interactive.ts` exports `requestControl(action, order)`
   — the sideband's control-request route; the module's own three ambient
   reads (the hard-wait pause /exit, the free-line /exit, the /failback
   order) route through it, byte-identical.
3. `packages/auto-server/src/worker-interactive.ts` rewired onto the seam;
   header rewritten (the false SERVICE_ENTRIES justification removed).
4. The boundary ratchet extended to where the core cannot look: each
   shell's own suite asserts its src never imports
   `@opencode-ai/auto-core/services` (new `test/no-ambient-services.test.ts`
   in both shells; auto-server's is the fail-before red).
5. Full verification (three packages), fail-before proofs over /tmp
   backups; docs (ruling, INDEX row, AGENTS nav), ledger, program position,
   single commit.

## Verification

All measured on the committed state (fail-before reds measured on pre-fix
source over `/tmp` backups, files restored and `cmp`-verified
byte-identical, suites re-run green). Three packages touched.

- **auto-core**: `bun typecheck` clean; full suite **3090 pass / 0 fail**
  (155 files; 3089 at step 033's close + the seam pin).
- **packages/auto**: `bun typecheck` clean; full suite **153 pass / 8 skip /
  5 fail** (the 151/8/5 baseline + the 2 boundary guards; the 5 = the
  pre-existing fork/remove-fork trailer-scan failures, names re-verified).
- **packages/auto-server**: `bun typecheck` clean; full suite **139 pass /
  1 fail** — ambient and with a clean config home, identical (24 files; the
  1 = the known 0165-220 observe `sawDirty` race, error trace verified at
  observe.test.ts:542, step 073's). The step-033-recorded ambient baseline
  (118/18, the operator registry's unset env keys refusing every
  daemon-spawned run) **no longer reproduces on this machine**: measured
  identically at pre-fix sources today (HEAD worker-interactive + HEAD
  interactive.ts, the new tests aside) the ambient suite gives **137 pass /
  1 fail** across 23 files — exactly step 033's clean-env HEAD baseline;
  the operator models.json still names the four unset keys on disk, so the
  machine's ambient condition drifted between sessions, independent of this
  step (fixed tree = pre-fix tree + the 2 new tests, both ways). The
  step's own focused suites green: `no-ambient-services` + `ws-protocol`
  10/0 (the control-channel behavior byte-identical through the seam);
  `ops` + `worker` 29/0.
- **Fail-before red** (pre-fix source, new tests fixed):
  - server (HEAD worker-interactive.ts): `no-ambient-services.test.ts`
    **1 red** — the real scan flags `src/worker-interactive.ts` (the bite
    row passes beside it, proving the scanner itself sound); restored,
    cmp-verified, re-run green.
  - core (HEAD interactive.ts): `interactive.test.ts` file-level red
    (`requestControl` not exported — 0 pass / 1 fail); restored,
    cmp-verified, re-run green 22/22.
  - packages/auto's scan is a standing guard, green on both sides by
    design (its src never imported the holder).
- **Byte-identical floors pinned green, unchanged**: the terminal
  sideband's control-word behavior (the 0182 D2 pause /exit, the free-line
  /exit, both /failback forms, the registry-aware refusal —
  interactive.test.ts, passing unmodified); the transport's control channel
  (ws-protocol.test.ts: unapplied before the first attach, applied after
  it, malformed failback refused, applied frames landing on the installed
  holder — passing unmodified).

## Dispositions

- **0165-089** — **fixed** under ruling **0194**: the ambient-holder read
  left the shell entirely (`requestControl` in `src/interactive.ts` is the
  one route; the module's own three reads collapsed into it), the false
  header justification replaced, and the boundary held where the core's
  ratchet cannot look — each shell's own `no-ambient-services` scan
  (auto-server's fail-before red; packages/auto's standing guard).
  `SERVICE_ENTRIES` unchanged (still exactly the five, shrink-only, pinned
  in test/services.test.ts which passes unmodified).

Residuals recorded (0194's own list): the exports boundary itself
(whether `auto-core/services` should be a subpath at all) stays step 036's
(finding 0165-174); the transport's slash-only failback discipline stays
narrower than the terminal's registry-aware check by 0067 P3b's own
AUTO-DECISION.
