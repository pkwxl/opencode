# Step 037 — w3-server-entry-hygiene: service-shell entry hygiene

Step record of the 0166 remediation program (see
[../0166-three-package-remediation.md](../0166-three-package-remediation.md)).
Wave W3-shell-seam (its last step), finding **0165-219** (S29-11, S4, CONF, UX,
P8/P12; the record [../0165-review/S29-daemon.md](../0165-review/S29-daemon.md)
item S29-11). Started 2026-11-07 at HEAD `1a43601e2` (tree clean; steps 001–036
done; no recovery needed — the coordinator verified the fresh-step path).

## Finding

**0165-219** (aggregate): hygiene across the service shell's entry files —
(a) `options.interactive`'s refusal teaches "interactive input arrives with the
WebSocket transport of the later units (P3); until then drive interactive runs
with `opencode-auto run <dir> -i`" — P3 landed, every width-1 daemon run
carries the transport; (b) stale AUTO-DECISION comments ("arrive with P1d /
the REST lifecycle surface") naming surfaces that have since landed; (c)
`issueToken`'s fallback `token-${tokens.length + 1}` collides after a revoke
(issue token-1, token-2, revoke token-1 → the next unnamed issue computes
token-2 and is refused "already exists"); (d) `/runs/<id>/{worker,interactive}`
answer 404 for an unknown id **before** any auth, so sequential run ids are
enumerable unauthenticated (every other route checks the token first); (e)
`serve --port` takes `/^\d+$/` with no 0–65535 bound (Bun.serve's own throw —
a stack trace, not a refusal); (f) under `--launch` the watcher flips
starting→running on the lock file's **mere presence** — a stale lock left by a
crashed run shows the new run `running` before its worker took the lock.

## Evidence re-verified against HEAD 1a43601e2

All six items probed on the current sources (steps 033–036 changed the named
files since the record's HEAD `2674dbaf3`):

- (a) **stands**: `src/request.ts:128-133` — the refusal still teaches the
  P3-era "until then drive interactive runs with opencode-auto run <dir> -i";
  the comment above it (l.115-120) still says the transport "arrives with P3
  (… T-093/T-094) … until that unit lands". The truth on disk: the daemon
  attaches the transport to **every width-1 run it spawns**
  (`daemon.ts:477`), never a client field (`parseTransport`'s daemon-written
  rule, `request.ts:266-270`).
- (b) **half gone, half stands**: request.ts's CONFIG_KEYS comment was already
  re-read and restated by **0193 D2** (the hint table's move; the CLI-as-named-
  surface decision with its P8 grounds — no new work); worker.ts's "this
  shell's own plan route arrives with P1d" no longer exists (0193's rewrite);
  **profile.ts:42-45 still says** "its config-fix routes arrive with the REST
  lifecycle surface" — the `fix` operation is served
  (`POST /projects/<project>/fix`, ops.ts OP_DEFINITIONS).
- (c) **stands**: `src/store.ts:181` — `const fallback = \`token-${tokens.length + 1}\``.
- (d) **stands**: `src/daemon.ts:798-800` — `findRun` and the 404 precede the
  secret compare (worker route) and `scopesForSocket` (interactive route);
  GET/DELETE `/runs/<id>` check the scope first (the inconsistency is real).
- (e) **stands**: `src/index.ts:388-391` — `/^\d+$/` then `Number(value)`;
  `--port 99999` reaches `Bun.serve`.
- (f) **stands**: `src/daemon.ts:376-388` —
  `if (options.launch || holder?.pid === proc.pid) run.state = "running"`:
  under launch the mere presence of a readable `.auto/run.lock` flips the
  state, stale or not.

## Plan (enactment order; each ingredient lands green)

1. Ruling **0197** written first (Derives/Amends, Category scope, premise
   guard) — the six items' rulings: D1 the interactive refusal's refreshed
   teaching, D2 the stale comments, D3 the token fallback (first free token-N),
   D4 auth-before-existence on the two WS routes, D5 the --port bound, D6 the
   --launch watcher's lock-freshness floor.
2. Enactment in packages/auto-server: request.ts (a), profile.ts (b),
   store.ts (c), daemon.ts (d + f), index.ts (e).
3. Regression tests in the package's existing suites, fail-before red on
   pre-fix source (backups in /tmp, cmp-verified restore, green re-run).
4. Full verification (all three packages), docs (ruling, INDEX row, step
   record), ledger row 0165-219, program position, single commit.

## Verification

All measured on the committed state (fail-before proofs over `/tmp/037-fixed/` backups: the
pre-fix source restored from `git show HEAD:…`, the proof run, the fixed file restored,
`cmp`-verified byte-identical, re-run green — every proof below). No auto-core or
packages/auto source touched.

- **auto-server**: `bun typecheck` clean; full suite **143 pass / 1 fail** (24 files,
  144 tests = the 142-test step-036 baseline + the 2 new tests, D3 and D6; D1, D4 and D5
  reshape existing tests). The 1 fail = **the known 0165-220 observe `sawDirty` race**
  (verified by name: "the external observer e2e … sawDirty" — the fixture can
  write-and-commit between two 150 ms polls; step 073's deterministic repair owns it); the
  file re-run alone **3× 9 pass / 0 fail** — the documented flake, not a regression (the
  step touches no observe path; the race flaky-passed at step 036's run, flaky-failed at
  this one, both within its measured behavior).
- **auto-core**: `bun typecheck` clean; full suite **3092 pass / 0 fail** (155 files) — the
  exact step-036 baseline, unchanged (no core source touched).
- **packages/auto**: `bun typecheck` clean; full suite **160 pass / 8 skip / 5 fail** — the
  exact step-036 baseline; the 5 = the pre-existing fork/remove-fork trailer-scan family
  (fork ×2, remove-fork ×3), identical names to step 036's verified baseline; no auto
  source touched.
- **Fail-before proofs** (each red on the named pre-fix source, restored and cmp-verified,
  green re-run):
  - **D1**: on pre-fix `request.ts`, `test/worker.test.ts` **1 fail** (the usage-vocabulary
    case — the refreshed interactive pin does not match the old P3-era text).
  - **D3**: on pre-fix `store.ts`, the "first free token-N" test **1 fail** (the
    revoke-then-issue scene: `length+1` computes token-2 and the issue is refused
    "already exists").
  - **D4**: on pre-fix `daemon.ts`, `test/interactive-ws.test.ts` **1 fail** (the auth-order
    pins: the unauthenticated unknown-run probes answered 404).
  - **D5**: on pre-fix `index.ts`, the "serve refuses bad flags" test **1 fail** — the
    failure output is the finding itself: `RangeError: The value of "options.port" is out
    of range. It must be >= 0 and <= 65535. Received 65536 … ERR_OUT_OF_RANGE` thrown from
    `Bun.serve` past the flag loop (the stack trace, not a refusal).
  - **D6**: on pre-fix `daemon.ts`, the "stale lock does not flip" test **1 fail** (the
    run flips to `running` on the stale lock inside the launcher's sleep window).
- Focused re-runs during enactment: `worker.test.ts` + `interactive-ws.test.ts` 10/0;
  `daemon.test.ts` 23/0 (the three new/extended tests confirmed by name).

## Dispositions

- **0165-219 (S29-11)** — **fixed** under ruling **0197**, all six items:
  - (a) the interactive refusal's P3-era teaching → **D1** (the daemon's own attachment,
    the endpoint named, the width rule; the CLI's `-i` named nowhere).
  - (b) the stale AUTO-DECISION comments → **D2** for profile.ts's "arrive with the REST
    lifecycle surface" (the landed `fix` operation stated, agentRecovery's why made true);
    request.ts's CONFIG_KEYS comment **already 0193 D2's** (re-read and restated at step
    033); worker.ts's "this shell's own plan route arrives with P1d" **already gone**
    (0193's rewrite); the finding's "name POST /projects/<p>/amend beside the CLI" remedy
    branch = **0193 D2's standing decline** (P8: the named remedy must exist for the
    caller), cited, not reopened.
  - (c) the token-name fallback → **D3** (first free `token-N` from the store's set).
  - (d) run-id existence before auth → **D4** (auth first on both WS routes; the worker
    route's unknown id = the wrong secret's 401).
  - (e) the unchecked port range → **D5** (0..65535 refused at the flag, the range named).
  - (f) the launcher watcher's stale-lock flip → **D6** (the freshness floor; 0162 D4's
    clause restated, its INDEX row annotated).
- **Discovered in-change** (recorded, unacted on — 0197's Residuals): the "startup"
  agentRecovery hint's own text ("re-run opencode-auto-server — the default contract is
  rebuilt from the template at startup") names a remedy this shell's plain re-run does not
  perform (the contract is rebuilt by the init/amend/fix operations); a core hint-shape
  question on 0193 D3's seam, for the program to schedule. Also noted: the worker route's
  unknown-id vs wrong-secret timing shapes differ (identical bodies; no demonstrated
  consumer — P21).

Residuals recorded: none beyond the two above. The step's scope held: no unrelated
cleanup; every other behavior byte-identical (the floors named in 0197).
