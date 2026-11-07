# 0197 — the service shell's entry hygiene: refusal texts that teach the landed surfaces, auth before existence, the first-free token name, the port bound, the launcher watcher's freshness floor

Status: active-authority (0166 remediation step 037, wave W3-shell-seam; finding 0165-219 =
S29-11, S4, CONFIRMED — re-verified against HEAD `1a43601e2` at ruling time: the interactive
refusal's P3-era teaching at `packages/auto-server/src/request.ts:128-133` with its comment at
l.115-120, profile.ts's "its config-fix routes arrive with the REST lifecycle surface" at
l.42-45, store.ts's `token-${tokens.length + 1}` fallback at l.181, daemon.ts's 404-before-auth
on the two WebSocket routes at l.798-800, index.ts's unbounded `--port` at l.388-391, and
daemon.ts's `options.launch || holder?.pid === proc.pid` watcher flip at l.384. Two of the
record's items were already consumed by earlier steps: request.ts's CONFIG_KEYS comment was
re-read and restated by **0193 D2** (the hint table's move, the CLI-as-named-surface decision),
and worker.ts's "this shell's own plan route arrives with P1d" comment no longer exists —
0193's rewrite of that file took it. The record's remedy branch "name POST /projects/<p>/amend
beside the CLI" in the frozen-key refusals is **0193 D2's already-ruled decline** (P8: the
named remedy must exist for the caller, and the CLI command does; the request grammar speaks
the flag tails as field spellings through the amend operation's field names) — not re-litigated
here.)

One finding, one family: **the entry surfaces' hygiene** — the texts a person or operator
reads at the service shell's doors (a request refusal, a profile comment, a token name, an
HTTP status, a serve flag, a run state) each teach or hold a small truth, and six of them had
drifted or were born wrong. One ruling per item, all small, all in
packages/auto-server.

Derives: **P8** — every surfaced line teaches its remedy: D1's refusal stops sending a person
to the CLI for a transport the daemon itself attaches to every width-1 run, and teaches where
interactivity actually lives (the daemon's own endpoint — 0193 D3's served-surface discipline
applied to a request-refusal line); D5's refusal names the range instead of letting
`Bun.serve` answer a stack trace. **P12** — fail loud, conservative under uncertainty: D4
makes the unknown-run answer on the unauthenticated door the same 401 as the wrong secret
(existence is no longer told apart without a credential — the conservative reading), and D6's
watcher resolves an uncertain lock (present but from before this spawn) toward NOT flipping —
the run stays `starting`, honest, until its exit settles it. **P13** — frozen additive-only
vocabularies: D1 rewrites one refusal string and D4 changes two routes' status answers — both
are protocol-string changes made by conscious lockstep in this one change (the registry and
flip procedure of plans/0035): the interactive refusal is the shared validator's one text (the
worker's stderr refusal and the daemon's 400 carry the same string — one home, both surfaces
move together), and the WS routes' unknown-run answer moves from 404 to 401 (worker) and
behind the 401/403 gate (interactive) together with the test pins and daemon.md's status
table. **P6** — derived state: D6's `running` is derived from observable evidence, and the
derivation gains the soundness test it lacked (the lock must be THIS run's lock, not any
lock); D3's fallback name derives from the store's own current set (first free `token-N`),
never from a count that a revoke makes stale. **P5** — single ownership: the fallback name,
the refusal string, the port bound and the freshness floor each live in exactly one home
(store.ts, request.ts, index.ts, daemon.ts) — no second source. **P10** — the byte-identical
floor: every behavior not named by a defect ruling is unchanged — the frozen-key refusals,
the transport/plan/transfer/lane grammars, the known-run auth answers, the bare-spawn watcher
(the pid match stands), `--port 0`, named token issues, and every other serve flag. Amends:
none — no principle restated. Tier: runtime code (packages/auto-server src), tests
(packages/auto-server test), documentation (daemon.md's status table and launcher section).

premises this ruling changes: **0162 D4's watcher clause** ("the watcher flips on lock presence
under a launcher" — its INDEX row and `docs/daemon.md`'s launcher section carry the same
wording) — the flip's criterion is restated here from **presence** to **freshness**: under a
launcher the flip requires the holder's `started` at or past the run's spawn instant, so a
stale lock a crashed run left behind does not show the new run `running`. The clause's premise
(the holder's pid names a process inside the launcher's own namespace, never the wrapper pid
recorded here — why the pid match cannot be the test under a launcher) stands unchanged; what
changes is the evidence the substitute test demands. 0162's INDEX row is annotated in this
change. **0067 §三 item 5's remainder** (the operation-shaped hint half "can take the hint
over then") — already re-read by 0193 D2 and declined on P8 grounds; D2 here consumes the
comment-level residue of the same AUTO-DECISION family (profile.ts's "arrive with the REST
lifecycle surface" future tense for a landed surface), changing no ruled decision: the
decline stands, the comment now states the landed state. **0067's agentRecovery "startup"** —
unchanged in value and render; the profile comment refreshed around it (D2) states why
"startup" and not "init" (`fix` is an operation of this shell, not a subcommand — the `run
<bin> fix <dir>` hint shape would name a command this binary refuses). A discovered open
question on that hint's own text is recorded in Residuals, not acted on here.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P8** — "detection records … every surfaced line teaches its remedy." A refusal that
  teaches a remedy the caller cannot use (drive interactive runs with the CLI, when the
  daemon attaches the transport to every width-1 run it spawns) is a defect of the line
  itself, not of the mechanism; the line is the deliverable here. The refreshed teaching
  names the daemon's own surfaces — the transport attachment (why there is nothing to
  request) and the WebSocket endpoint — exactly the served-surface discipline 0193 D3 ruled
  for the core's person-facing lines, applied to the request vocabulary's one refusal that
  still taught another shell's command as the only way.
- **P12** — "uncertain readings resolve toward dirty / no-reuse / no-carry." D4 and D6 are
  this rule at two doors: an unauthenticated probe's unknown-run question resolves toward
  "no answer distinguishable from a wrong credential" (401, the same body), and a lock whose
  provenance is uncertain (present, but started before this spawn) resolves toward "not this
  run's lock" (no flip). Neither hides a failure: the run's state remains observable through
  its exit, and the authenticated caller still learns a run id does not exist (404 after
  auth, like GET /runs/<id>).
- **P13** — "protocol literals … change only by conscious lockstep in one change." The
  interactive refusal string is pinned in two places (worker.test.ts's usage table; the
  shared validator's own comment) and carried on two surfaces (worker stderr, daemon 400);
  the unknown-run status answers are pinned in interactive-ws.test.ts and described in
  daemon.md's status table. All move in this one change, with the pins and the doc.
- **P6** — "prefer state derived from durable evidence." The token fallback name derives
  from the store's current set — the first `token-N` not taken — so the derived name is
  sound exactly when the evidence (the set) is, instead of keying on a length a revoke
  invalidates.

## D1 — the interactive refusal teaches the landed surface (request.ts)

`options.interactive`'s refusal (and the comment above `parseOptions`) said the transport
"arrives with the WebSocket transport of the later units (P3); until then drive interactive
runs with opencode-auto run <dir> -i" — P3 landed; the daemon attaches the transport to
**every width-1 run it spawns** (`daemon.ts`'s `startRun`: `transport = maxSessions >= 2 ?
undefined : {...}`), and the transport is daemon-written, never a client field
(`parseTransport`'s own rule). The refreshed refusal: interactivity is not a per-run option —
every width-1 run the daemon spawns already carries the transport (its questions and /exit,
/failback over the WebSocket endpoint `/runs/<id>/interactive`), and a wide run
(`options.maxSessions ≥ 2`) takes no channel at all (the core's one-channel rule, 0162 D2) —
so there is nothing to request. The CLI's `-i` is named nowhere in the new text: this shell
has its own interactive surface, and the line teaches it (0193 D3's discipline).

## D2 — the stale entry comments state the landed state (profile.ts)

profile.ts's AUTO-DECISION said the server "ships no interactive `fix` command — its
config-fix routes arrive with the REST lifecycle surface". The `fix` operation is served
(`POST /projects/<project>/fix`, dryrun-capable, ops.ts OP_DEFINITIONS); the comment's future
tense is the residue of the same 0067 §三 AUTO-DECISION family 0193 D2 re-read. Refreshed:
`fix` is an operation of this shell, not a subcommand — the core's `run <bin> fix <dir>`
hint shape (the "init" agentRecovery value) would name a command this binary refuses, so
"startup" keeps the recovery hint off the false subcommand shape. The value, its render and
its 0067 ruling are untouched (a discovered question on the hint's own text: Residuals).

## D3 — the unnamed token fallback is the first free token-N (store.ts)

`token-${tokens.length + 1}` collides after a revoke: issue token-1, token-2; revoke
token-1; the next unnamed issue computes token-2 and is refused "already exists" — a
confusing refusal answering an act (issue unnamed) the operator cannot know was wrong. The
fallback derives from the store's current set: the smallest `token-N` no stored token
holds (a user-named "token-5" occupies slot 5 — the check is by name, both directions).

## D4 — auth precedes run-id existence on the two WebSocket routes (daemon.ts)

`/runs/<id>/{worker,interactive}` answered 404 for an unknown id before any auth — the only
routes in the daemon that told existence to an unauthenticated caller (GET/DELETE
`/runs/<id>` check the scope first; the project routes resolve the project after the scope;
POST /runs checks `control` before reading the body). The order is restored to the daemon's
own rule: the interactive route authenticates the operator token (401 unknown, 403 the
scope gate) before the run lookup (a known token still learns 404 — existence is not
secret to the authenticated); the worker route's credential IS the run's per-run secret, so
an unknown run id answers the same 401 ("unknown run secret: …") as a wrong secret — no
run-id enumeration on either door, no new status shape (401 and its body already existed on
both routes). The known-run answers are byte-identical.

## D5 — `serve --port` is bounded (index.ts)

`/^\d+$/` accepted 99999 and let `Bun.serve` throw its stack trace — the opposite of a
refusal. The flag now takes an integer 0..65535 (0 picks a free one — the documented
meaning, unchanged), out of range a usage refusal naming the range and the 0 convention.

## D6 — under a launcher, the watcher's flip requires the lock's freshness (daemon.ts)

Under `--launch` the starting→running watcher flipped on the lock file's **presence** — a
stale lock left by a crashed run showed the new run `running` before its worker took any
lock. The substitute test the launcher contract forces (the holder's pid names a process in
the launcher's namespace, never the wrapper pid) now demands evidence the lock is THIS
run's: the holder's `started` at or past the run's spawn instant (both `new Date()
toISOString()` on the one machine's clock; the spawn instant is captured immediately before
`Bun.spawn`, a strict lower bound on everything the child does). A lock from before the
spawn — a crashed run's leftover — does not flip the state; the run stays `starting`,
observable either way through its exit (0162 D4's own fallback, unchanged). The bare-spawn
arm (the pid match) is untouched. Failure direction: a clock stepped backwards past the
spawn leaves a genuinely running run shown `starting` until its exit — the conservative
reading (P12), degrading nothing that keys on the state (`liveRunOn` counts both, the view
marks both live).

## Category scope (0123 D1's discipline)

- **Code homes**: `packages/auto-server/src/request.ts` (D1 — the refusal and the comment),
  `packages/auto-server/src/profile.ts` (D2 — the comment), `packages/auto-server/src/store.ts`
  (D3 — the fallback), `packages/auto-server/src/daemon.ts` (D4 — the two WS routes' order;
  D6 — the watcher and the `launch` option's comment), `packages/auto-server/src/index.ts`
  (D5 — the `--port` bound). No auto-core or packages/auto source changes.
- **Test homes**: `packages/auto-server/test/worker.test.ts` (D1's refreshed-text pin),
  `packages/auto-server/test/daemon.test.ts` (D3's first-free pin, D6's stale-lock-under-
  launcher pin), `packages/auto-server/test/interactive-ws.test.ts` (D4's auth-order pins),
  `packages/auto-server/test/cli.test.ts` (D5's port-bound pins). The confinement-launcher
  test's comment (daemon.test.ts, "under a launcher it is the lock's presence") is restated
  with the freshness rule in the same change.
- **Documentation**: this document; the INDEX row (+ 0162's annotated); daemon.md's status
  table (the 404 row's unknown-run clause) and its launcher section's watcher sentence;
  the program's ledger row 0165-219 and step record 037.

### Re-reads

- **0162 D4** — the launcher contract's mechanism (the wrapper argv, the namespace fact, the
  kill semantics, the bare floor) stands; the watcher clause's criterion is restated
  (presence → freshness) with the why preserved; its INDEX row annotated.
- **0193 D2** — the frozen-key hint ruling stands untouched (this ruling's D1/D2 consume the
  remaining stale texts of the same AUTO-DECISION family; the operation-shaped-hint decline
  is re-cited, not reopened).
- **0193 D3** — the served-surface seam's discipline (core lines under the server profile
  name the server's true surfaces) is applied here to the shell's own request vocabulary;
  no core render site changes.
- **0067 §四/§三** — the interactive transport's landing is the fact D1's text now teaches;
  §三 item 5's re-read chain (0193 D2 → here) closes at the comment level.
- **plans/0035** — the protocol-string flip procedure: two string changes (D1's refusal, the
  WS routes' status answers) made in one change with their pins and doc rows, additive in
  effect (no dual meanings: the old texts are gone everywhere at once).

## Floors and proofs

- Byte-identical (pinned by the untouched suites): the frozen-key refusals (the CLI-named
  surface, 0193 D2's decline), the transport/plan/transfer/lane grammars and their
  daemon-written rules, the known-run WS answers (401 wrong secret, 403 scope, 409 width,
  400 non-websocket, the upgrades), the bare-spawn watcher (pid match), `--port 0` and
  every other serve flag, named token issues and revokes, the token digests and 0600
  writes.
- Fail-before (red on pre-fix source, green after — backups in /tmp, cmp-verified): D1's
  pin (the old text teaches the CLI; the new text is absent), D3's pin (the revoke-then-
  issue collision), D4's pins (the unauthenticated unknown-run probe answers 404 today on
  both routes; the wrong-secret and unknown-id answers are distinguishable today), D5's pin
  (`--port 99999` exits 0-shaped refusal-free today — the flag loop accepts it), D6's pin
  (a stale lock under a launcher flips the run to `running` today).

## Residuals

- The "startup" agentRecovery hint's own text ("re-run opencode-auto-server — the default
  contract is rebuilt from the template at startup") names a remedy this shell's plain
  re-run does not perform: the contract is rebuilt by the init/amend/fix **operations**
  (the config-op engine), not by any subcommand of this binary. Discovered at this step
  (the finding's comment staleness led there); the fix is a core hint-shape question on
  0193 D3's seam (the two-value "init"|"startup" vocabulary is 0055-era), not entry
  hygiene — recorded here, unacted on, for the program to schedule (noted in the step
  record and the program's unresolved list).
- The wrong-secret and unknown-run answers on the worker route share one 401 body but not
  one timing shape (the unknown run skips the digest compare). The response bodies being
  identical, the residue is a local-loopback timing channel of no demonstrated consumer
  (P21); noted, not built on.

## Tests

Named in Category scope; the exact red pins are enumerated in the step record
(`plans/0166-remediation/037-w3-server-entry-hygiene.md`).
