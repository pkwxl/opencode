# Step 026 — w-session-ask-restart

Wave: W-session. Findings: 0165-116 (S13-02, S3, CONFIRMED — askHuman with no timeout never
returns on a closed or non-readable stdin: readline's question stays pending, the run waits
forever and every later ask queues behind the dead one), 0165-117 (S13-05, S3, CONFIRMED —
concurrent restarts of one managed host double-spawn and leak a server: two callers in the
same window each close-and-spawn, the loser's instance live and unreferenced for the rest of
the run), 0165-196 (S13-07, S4, CONFIRMED — session-driving hygiene: ensureForkBase's header
claims a verified-clean ctxbase turn no check performs and its digest dispatch drops the
caller's switches snapshot; toBlankSession's comment claims the usage counters reset while
`used` is kept; the probe catch's comment cites SDK rejections 0037 D2 rules out). Started
2026-11-06 at HEAD `d203914ff`.

## Scope

The ask channel's closed-input truth, the managed host's restart serialization, and the
session-driving hygiene trio. The pool-level sibling gate for restart-under-siblings rides
0178's landed deferral (S17-02's remedy, step 018); this step's restart fix is the in-flight
promise sharing. The probe catch's comments are made true (the contract-violating shape
named, 0069 §2.4's wait posture kept, deliberately unlike 0185 D1's task-dispatch catch) —
the first draft's rethrow at the probe door was withdrawn by the ruling: it would have
silently amended 0069's measured compensation ruling on a hygiene finding's inference.

## Design ruling

Ruling **0186** ([0186-ask-restart-hygiene.md](../0186-ask-restart-hygiene.md)) — D1/D2/D3.

## Implementation order (the recovery map)

1. `src/session-api.ts` — stdinAsk's close resolution and non-readable floor (D1).
2. `src/agent/opencode/server.ts` — restart's in-flight promise (D2).
3. `src/session.ts` — ensureForkBase's switches pass-through and header correction; the probe
   catch's comment truth and awaitRecovery's header phrase (D3); `src/chain-transitions.ts` —
   toBlankSession's comment.
4. Tests: session-api (closed-stdin child), agent-server (the two-caller restart),
   agent-fake (the switches pass-through).
5. Ruling 0186 + INDEX row + navigation; fail-before; suites; bookkeeping; commit.

## Execution log

- 2026-11-06: step opened after step 025's commit (d203914ff) in the same worker stretch; the
  register rows and the three records read; the code homes surveyed (stdinAsk, manage's
  restart, ensureForkBase, the probe catch, toBlankSession).
- 2026-11-06 (the interrupted stretch): D1–D3 landed with their three tests, and ruling 0186 +
  its INDEX row + the AGENTS.md navigation line written — the session interrupted before
  verification and commit; recovered from the working tree at resume.
- 2026-11-07 (the resumed worker, the maintainer's delegation instruction): review against the
  ruling — the four src homes and three tests match D1/D2/D3 (the runSession pass-through's
  `switches` is the eighth parameter; the join line's teaching shape; the close race resolving
  undefined with the non-readable floor before it). The step record's own Scope and
  implementation order still carried the withdrawn probe-rethrow draft (the ruling withdrew it
  on the 0069 §2.4 re-reading) — repaired to the comment-truth shape; no src repair needed.
  Verification, fail-before and bookkeeping below; commit at close.

## Verification

- `bun typecheck` exit 0 in packages/auto-core and packages/auto.
- auto-core full suite: **3024 pass, 0 fail** (153 files; 3021 at step 025's close — the three
  new pins).
- Fail-before (the fixed src backed up outside the tree at `/tmp/step026-backup/`, the pre-fix
  content written in per proof with `git show HEAD:<path>`, restored after — `git diff`
  byte-identical to before the proofs; the three tests green again on the restored tree):
  - the closed-stdin child **times out at its 15 s bound** on the pre-fix `src/session-api.ts`
    (readline's question never settling, the child's stdout never closing — the runner killed
    the dangling child; 0165-116's own repro shape).
  - the two-caller restart is **red on the spawn count** on the pre-fix
    `src/agent/opencode/server.ts` — `Expected: 2, Received: 3` (the initial spawn plus both
    restarts' spawns, the loser's instance the leak 0165-117 names).
  - the digest-rebuild pin **times out at its 10 s bound** on the pre-fix `src/session.ts` —
    the dropped snapshot fallen to the ambient parse's `0,90` ladder, the second retry waiting
    90 minutes.
- packages/auto suite: 149 pass, 8 skip, 5 fail — the same pre-existing fork/remove-fork
  baseline (2 fork + 3 remove-fork, step 031's wave); no new failure; typecheck clean.

## Close-out

Step done 2026-11-07. Ruling **0186** active-authority; the INDEX row, the AGENTS.md
session-driving navigation line, ledger rows 0165-116/117/196 and the program's
status/current-position land in the same commit. Residuals (0186's list): a deterministic
driver fault during a probe still cycles the wait (0069 §2.4's standing posture — a measured
incident re-opens it); the restart-under-live-siblings gate rides 0178's deferral (a non-walk
restart beside live sibling sessions keeps today's shape); the closed-stdin floor answers at
once only on an already-non-readable channel — a readable-but-silent channel (a held-open
pipe) still waits, that being a human who may yet answer.
