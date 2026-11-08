# 0223 — the spawn boundary's three failure shapes: the throwing spawn, the unbracketed transport, the unresolved launcher

Status: active-authority (0166 remediation step 063, wave WF-server; findings 0165-055 =
S29-10 (S2, CONFIRMED — a spawn that throws wedges the run as `starting` forever, every
later operation on the project answering a 409 whose remedy cannot come, the kill a 202
that does nothing; reproduced by the record's E2BIG/ENOENT probes) and 0165-169 = S29-03
(S3, CONFIRMED — an IPv6 bind writes an unbracketed transport URL the worker's own
parseTransport refuses, reproduced `ws://::1:39899/…`) and 0165-172 = S29-09 (S3,
CONFIRMED — `serve --launch <relative>` never resolved or checked, reproduced every run
failing bash's 127 from the source layout)).

Three rulings of one family — the daemon's spawn boundary is where the served surface
meets the OS, and each finding is a way that meeting fails without a diagnosis:

- **A spawn that throws leaves the registry wedged** (0165-055): `startRun` registers the
  run, creates its hub and journals `opened` before `spawnWorker`, whose `Bun.spawn`
  throws synchronously — E2BIG when the single-token argv payload exceeds the kernel's
  128 KiB per-string cap (a large plan `input` or switch value, both uncapped), ENOENT
  for a missing `bash` under `--launch` or a removed worker binary. POST /runs answers
  Bun's generic 500; the plan/transfer operations' spawned routes answer their own 500;
  nothing unregisters. `liveRunOn` counts `starting` as live, so every later run, plan,
  transfer, close, task-add and init/amend on that project answers 409 "retry once the
  active run reaches a terminal state" — a state that cannot come — and `DELETE` answers
  202 "kill requested" over a record with no process. Only a daemon restart clears it.
- **An IPv6 bind writes a URL no parser accepts** (0165-169): the transport URL and the
  handle's own URL are templated `ws://${server.hostname}:${port}/…` — an IPv6 literal
  like `::1` interpolates unbracketed, and `new URL("ws://::1:39899/…")` fails, so the
  worker's shared validator (parseTransport) refuses the transport the daemon itself
  wrote: every width-1 run, planning run and transfer on such a bind dies on arrival.
  A wildcard bind (`::`, `0.0.0.0`) has the cousin fault — the URL names a bind address,
  not a connectable host.
- **`--launch` reaches the spawn unresolved** (0165-172): the confinement launcher path
  is stored verbatim; the spawn cwd is the package's `src/` in the source layout (the
  operator's cwd compiled), so a relative launcher resolves differently per layout —
  in the source layout every run fails bash's exit 127, recorded `failed`/127, and the
  serve banner announced the launcher active the whole time. Nothing checks the script
  exists or is readable.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P12** (fail loud; conservative under uncertainty): a synchronous spawn throw is a
  first-class failure of the run's own lifecycle, not an unhandled error — it must
  surface as a named refusal (the cause in the error and in the run's tail) and leave
  the registry in a state the operator can read and act on. A transport URL the
  daemon's own counterparty refuses is a defect at write time — the conservative
  direction is to write a URL that parses. A launcher path is checked at the operator's
  own act, not discovered missing at the first spawned run.
- **P8** (deliberate enforcement moments; every surfaced line teaches its remedy): the
  finding's 409 taught "retry once the active run reaches a terminal state" for a state
  that could never arrive, and its 202 said "kill requested" while nothing was
  requested — both are false remedies, the exact class P8 retires. The 400 that bounds
  the carriage names the real remedy (the CLI's `plan -p`, read in-process); the 500
  names the spawn's cause and states the record settled.
- **P6** (derived state, re-derivation): the wedged `starting` record was state with no
  deriving evidence behind it — no process, no lock, nothing to observe. The settle
  restores the invariant: a terminal record is derivable from the spawn's own failure.
- **P10** (the byte-identical floor): every request under the carriage bound, every
  IPv4/hostname bind, every absolute `--launch` path, and every spawn that succeeds are
  byte-identical to before — the ruled defect fixes are the only behavior changes, and
  the floors are pinned.
- **P13** (frozen additive-only vocabularies): the bound's refusal, the spawn-failure
  500 body and the `--launch` refusal are new additive surfaces; no accepted request,
  URL or flag changes meaning. The run-state vocabulary is untouched — a failed spawn
  maps onto `failed`/`code: null` through `terminalOf`'s existing default arm.
- **P19** (measured evidence) and **P21** (machinery waits for its consumer) govern the
  carriage question 0222 D1 deferred here: the record's remedy names the request-file
  arm ("S29-01's remedy removes the E2BIG class entirely"), but no measured consumer
  asks for a served run request over the bound — the finding's own 200 KB scene is
  manufactured, and every honest request (directory, options, switch overrides, the
  transport URL) is kilobytes; the one unbounded field is the plan payload's `input`,
  and a planning document that large already has a channel — the CLI's `plan -p`, read
  in-process with no carriage at all. The arm's blast radius (the `worker '<json>'`
  hand-spawn contract, the transfer self-spawn, the lane launcher payload, every
  spawning test, plus a new daemon-owned request-file lifecycle with its own crash
  windows) buys no guarantee a bound lacks. The register's own precedent is the same
  asymmetry: a served route is not a terminal (the probe rate window, the loopback
  server rule — 0222 D2), and the CLI's unbounded in-process carriage is the operator's
  wider channel, named in the refusal.

## Decisions

### D1 — the payload carriage stays argv, bounded at validation; a throwing spawn settles its record and answers a named 500 (0165-055)

**The carriage question (0222 D1's deferred linkage), ruled: argv stays, bounded.** The
run request continues to ride the worker's argv as one JSON token — the choice
worker.ts's AUTO-DECISION made and 0222 D1 re-affirmed for everything but the secret —
and the serialized document is bounded at **64 KiB** (`REQUEST_BYTE_LIMIT` in
`src/request.ts`, the one shared vocabulary module: half the kernel's 128 KiB
per-string cap, margin for everything else in the token). `requestTooLarge(serialized)`
returns the refusal text; it is enforced at the two homes that build the token:

- the daemon's `startRun` serializes the payload once (the same string `spawnWorker`
  puts in argv) and refuses **before registering anything** — a `RequestError`, so
  POST /runs answers a 400 with the teaching (the kernel cap, and the real remedy: a
  planning document that large is the CLI's `plan -p <text>`, read in-process; split
  or trim the input), and the plan/transfer operations' spawned routes convert the
  same error to their own 400. No run, hub or journal entry ever exists for an
  oversized request — the wedge's E2BIG half cannot be reached by a request.
- the worker entry checks its one argv token after the JSON parse (a hand-spawned
  document between the bound and the kernel cap gets the same teaching as its stderr
  usage refusal) — the same text both processes share, the shared-validator pattern's
  own rule.

Rejected arms, on the record: the **request-file/fd carriage** (the record's named
remedy) — declined on P19/P21: no measured consumer, the blast radius named above, and
a request file is newly persisted daemon-owned state with a cleanup lifecycle of its
own (P6's opposite); its trigger is named in Residuals. The **env carriage** — an env
string is under the same kernel per-string cap (MAX_ARG_STRLEN binds environ exactly
as it binds argv), so it moves the limit nowhere, hides the payload from `ps` (losing
the debuggability the AUTO-DECISION chose), and mints a new environment name for the
payload to ride. The **stdin carriage** — the worker's stdin is closed by construction
(the question-degradation contract owns it); not this step's to reopen.

**The wedge, healed at both halves.** `spawnWorker` wraps the `Bun.spawn` call in
try/catch: on a throw the record is settled first — `settle(run, null, null)`, the
existing vocabulary's own default arm (`failed`, `code: null`), the error text written
into the run's tail — and the open-question retirement `settle` already performs is a
no-op here (no bridge ever connected, no question ever raised; the journal's `opened`
record is inert at replay without an open question). Then the catch rethrows a
`SpawnError` carrying the run id and a message naming the cause. POST /runs catches
it: a **500** whose error names the cause and whose body carries the settled run view
— the client learns both the failure and that the project surface is free again. The
plan/transfer spawned routes let it ride their dispatch's existing 500 (the message
names the run; the record is settled either way). An E2BIG in the message appends its
teaching — after the bound, an E2BIG points at the daemon's inherited environment
(the spawn's env rides the same kernel limits), not the request.

**The lying 202, retired.** `deleteRun`, on a `starting` record with no process (the
wedge's own scene; after the settle the scene is unreachable — this is the belt under
it), settles the record as `failed` instead of answering "kill requested" over
nothing: the 202's note names the truth (no worker process existed; the record was
settled as failed by this delete — the project's surface is free again).

**Pins**: the ENOENT wedge heal (a daemon whose worker command is a missing binary:
the POST answers a named 500 with the failed run view, the tail carries the cause, the
next POST attempts a fresh spawn instead of the 409, the DELETE answers 409
already-terminal); the carriage bound (an oversized switch value: a 400 with the
teaching, no run registered — pre-fix this POST was the finding's E2BIG wedge); the
worker entry's refusal of an oversized hand-spawned token; the floor (an under-the-bound
request byte-identical: 202, the same payload).

### D2 — one URL-host formatter for the daemon's bound address (0165-169)

`connectHost(hostname)` in `src/daemon.ts`, exported for its pin: a host containing `:`
(an IPv6 literal) is bracketed — `[::1]` — and the wildcard binds map to the loopback
they cover (`0.0.0.0` → `127.0.0.1`, `::` → `::1`), because a URL this daemon hands out
is a connect-back address, not a bind address. Both formatting sites use it and nothing
else changes: the worker bridge transport URL (`ws://[::1]:<port>/runs/<id>/worker`)
and the handle's own URL (`http://[::1]:<port>` — the serve banner and the web client
link read it). The bind itself, `handle.hostname` and the registry are untouched.

**Pins**: a daemon bound on `::1` spawning a stand-in worker — `daemon.url` carries
`[::1]`, the payload's `transport.url` matches `ws://[::1]:<port>/…`, and
`parseTransport` accepts it (pre-fix: the unbracketed URL, the validator's refusal —
the finding's observed verbatim); the unit pin over `connectHost` (bracketing, both
wildcard mappings, the passthrough hosts).

### D3 — `--launch` resolves at the entry and is refused unless a readable file (0165-172)

The serve entry resolves the launcher path (`resolve`, against the serve command's
working directory — the one truth both layouts share) and refuses with exit 1 (the
usage convention) when it is not a readable file, naming the resolved path — the
banner that would otherwise announce the launcher active never lies. The daemon
resolves its copy once at `startDaemon` (against its own process cwd — the entry has
already checked; an embedding host gets its own cwd's truth), so the spawn never
re-resolves against the spawn cwd again: the source layout's `src/` and the compiled
layout's operator cwd stop mattering. The launcher seam itself (plans/0162) is
untouched — this is the seam's own input hygiene, not a redesign.

**Pins**: the entry run as a subprocess with a relative `--launch` naming no file —
exit 1 with the refusal naming the resolved absolute path (pre-fix: the daemon serves
on, nothing fails until the first run); the floor — an absolute readable launcher path
still serves (the existing launcher suite green, unchanged).

## Derivation and Category scope

Derives: **P12** (the throw surfaced as a named 500 and a terminal record; the URL
written parseable; the launcher refused at the operator's act), **P8** (the false
remedies — the unreachable-terminal 409, the empty 202 — retired; every new refusal
teaches its remedy), **P6** (the terminal record re-derivable from the spawn's own
failure; no new persisted state), **P10** (floors pinned: under-the-bound requests,
IPv4/hostname binds, absolute launchers, successful spawns — byte-identical), **P13**
(all new surfaces additive; the state vocabulary reused through its existing default
arm), **P19** (the carriage ruled from measured evidence — the repro's manufactured
200 KB, no recorded consumer near the bound), **P21** (the request-file arm declined,
its trigger named). Amends: none — 0067's request-carriage letters stand (the bound is
the AUTO-DECISION's own "far from argv limits" premise made true, not changed); 0162's
launcher seam unchanged; 0222 D1's deferred linkage is resolved by this ruling's D1 as
its named consumer (the arm declined, the bound enacted), which is the linkage's own
purpose, not a premise flip.

premises this ruling changes: none.

Tier: mechanism (auto-server's spawn boundary, transport formatting and serve entry —
no core src change; the core seam untouched).

### Category scope

The spawn-boundary family, enacted category-complete in one change:

- Code homes: `packages/auto-server/src/request.ts` (`REQUEST_BYTE_LIMIT`,
  `requestTooLarge`), `packages/auto-server/src/daemon.ts` (`connectHost`, startRun's
  serialized payload + pre-registration bound, spawnWorker's try/catch settle +
  `SpawnError`, postRuns's 400/500 catches, the ops spawn closures' RequestError arm,
  deleteRun's no-proc settle, the launch resolution at start), `packages/auto-server/
  src/worker.ts` (the entry's carriage check), `packages/auto-server/src/index.ts`
  (serve's `--launch` resolve + readable-file refusal).
- Test homes: `packages/auto-server/test/daemon.test.ts` (the wedge-heal pin, the
  bound pin, the `::1` transport pin, the `connectHost` unit pin), `test/worker.test.ts`
  (the bound's unit pin + the entry's oversized-token refusal), `test/cli.test.ts`
  (the `--launch` refusal pin).
- Documentation homes: `packages/auto-server/docs/daemon.md` (the carriage bound beside
  the run-request trust rules, the spawn-failure state beside the run-state list, the
  URL-host formatting note beside the bridge carriage paragraph, the launcher
  resolution in the confinement-launcher section), this package's INDEX row.
  AGENTS.md/structure.md: no core or auto file is touched and auto-server has no
  core-side navigation row (step 037's precedent, re-judged standing).

## Residuals

- The request-file carriage arm stays declined, its trigger named: a measured consumer
  needing served run requests over 64 KiB reopens the question (until then the CLI's
  in-process `plan -p` is the channel for larger planning documents — the refusal
  teaches it).
- The plan input (project content, not a credential) still rides world-readable argv
  under the bound — the 0165 register's own line between credentials (0165-054, fixed)
  and content; the v1 single-operator-machine posture. The deeper carriage (request
  file) would move it; declined with D1's arm.
- `deleteRun`'s no-proc settle arm is defensive — the wedge fix empties its natural
  scene (a throwing spawn settles at the throw); it exists so the class cannot
  re-wedge by another path.
- A spawn-failed run's hub stays in memory until the registry's eviction ruling
  (S29-05/0165-170, step 064) — the same bounded-registry question as every terminal
  run's.
- An E2BIG from the daemon's inherited environment (not the payload) remains possible
  in principle — the 500 names the cause and teaches the direction; the daemon's env
  is the operator's own spawn surface.
- `connectHost` maps the wildcards to the IPv4/IPv6 loopback literal of the same
  family; a bind on a scoped address (`fe80::1%eth0`) is unruled (URL zone encoding)
  — not a v1 surface.
- The `?token=` query carriage, the same-uid environ reader and the
  leaked-secret-first-connect latch residuals stand as 0222 named them.
