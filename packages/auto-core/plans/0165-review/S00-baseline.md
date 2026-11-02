# S00 — baseline and health

Date 2026-11-02 · HEAD read 358be4003, re-checked at d579016b2 · status: done

- env: bun 1.4.2, 112 cores, ambient OPENCODE_AUTO_* unset, tree clean
- typecheck (tsgo --noEmit): auto-core clean, auto clean, auto-server clean
- auto-core `bun test` (--parallel): 2912 pass / 0 fail, 152 files, 109.5 s
- auto `bun test`: 154 pass / 8 skip (opt-in OPENCODE_AUTO_E2E real-opencode) / 0 fail, 121.6 s
- auto-server `bun test`: 134 pass / 2 fail / 1 unhandled error, 84.8 s — reproduced on a 2nd full run
  - FAIL observe e2e "SSE tail … torn progress.json never errors" — the known sawDirty poll-window flake (0162 residual)
  - FAIL worker.test.ts "the run request's usage vocabulary > malformed requests … exit 1" — times out at bun's 5000 ms default,
    deterministic in isolation (6.9 s); passes with --timeout 60000 (2 pass, 6.99 s). The unhandled error is the
    same test's late assertion (retired-switch subcase received 143 = SIGTERM from the timeout teardown, worker.test.ts:246).
    Not a behavior regression: a per-test budget breach after 0162 grew the case's sequential worker spawns.
    0162's record says "135 pass / 1 fail standing (observe flake)"; 0163 records only auto-core's suite.

## Re-run at d579016b2 (= 358be4003 + 0164, the maintainer's mid-review commit)
- typecheck auto-core, auto: clean
- auto-core test/install-prompts.test.ts + test/manual-prompts-ratchet.test.ts: 35 pass / 0 fail
- auto `bun test`: 154 pass / 8 skip / 0 fail, 122 s
- auto-server untouched by 0164 → its 358be4003 result stands (2 fail: observe flake + worker 5 s budget)

## Mutation baseline (re-check after any step that runs code)

`git status --porcelain` empty; `git worktree list` = the main worktree only; `git stash list` empty; `git branch -a | wc -l` = 10. The first attempt's reviewers left the repository untouched (verified after their stop); HEAD moved only by the maintainer's own commit d579016b2 (plan 0164).

## Findings

```jsonl
{"id":"S00-01","title":"auto-server suite red at HEAD: worker.test.ts usage-vocabulary case deterministically exceeds bun's 5 s per-test default","sev":"S3","conf":"CONFIRMED","cat":"TEST","measures":["P12","0162"],"loc":["auto-server/test/worker.test.ts:246"],"symbol":"the run request's usage vocabulary > malformed requests …","evidence":"(fail) … [5000.13ms] ^ this test timed out after 5000ms; alone 6.9 s; with --timeout 60000: 2 pass","repro":{"cmd":"cd auto-server && bun test test/worker.test.ts -t \"usage vocabulary\"","observed":"timeout at 5000 ms; the late assertion at :246 receives 143 (SIGTERM) as an unhandled error"},"impact":"the shell suite cannot go green on this host; 0162 recorded 135/1 (observe flake only)","remedy":"split the case or give it an explicit timeout; record the suite's real state in the ruling that touches it","family":["auto-server/test/observe.test.ts sawDirty flake"],"prior":"NEW","wave_hint":"server test health"}
{"id":"S00-02","title":"the shells' test suites have no bunfig preload — not hermetic against the operator's model registry and ambient OPENCODE_AUTO_*","sev":"S3","conf":"PLAUSIBLE","cat":"TEST","measures":["P12","0055 §4.1"],"loc":["auto/ (no bunfig.toml)","auto-server/ (no bunfig.toml)","auto-core/bunfig.toml:1-3"],"symbol":"test preload","evidence":"auto-core/bunfig.toml preloads test/preload.ts (XDG_CONFIG_HOME temp, OPENCODE_AUTO_MODELS removed); neither shell has a bunfig.toml","repro":null,"impact":"a shell e2e spawned with the operator environment may read ~/.config registry layers or switches; S28 checks how the e2e spawns the CLI","remedy":"a bunfig preload per shell mirroring the core's, or an explicit hermetic env in each spawn helper","family":["auto-core/test/preload.ts"],"prior":"NEW","wave_hint":"test hermeticity"}
```
