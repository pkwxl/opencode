# 0222 — the worker bridge's secret off argv, and the switches carrier switches-only

Status: active-authority (0166 remediation step 062, wave W-server-trust; findings 0165-054 =
S29-01 (S2, CONFIRMED — the per-run secret readable from `/proc/<pid>/cmdline`, the impostor
bridge adopted by the replace rule, reproduced by the record's R9-daemon F probe) and 0165-171 =
S29-06 (S3, CONFIRMED — the switches carrier admitting the two env-only names, reproduced by the
record's parse probe)).

Two rulings of one family — where a per-run credential may travel, and what the per-run override
layer of the served surface is:

- **The per-run worker-bridge secret rides the worker's argv** (0165-054): the spawn payload the
  daemon builds carries `transport: { run, url, token: secret }` as one argv token —
  `JSON.stringify({ directory, options, switches, transport, … })`. `/proc/<pid>/cmdline` is
  world-readable (mode 0444, no credential gating), so any local user — and the run's own agent
  session, a descendant process — reads the run's bridge credential from it, connects to
  `/runs/<id>/worker?token=…`, and the hub's replace rule ("a second connection replaces the
  first") adopts it as the run's bridge: the person's answers and `/exit`, `/failback` frames
  are forwarded to the impostor, forged `question` frames reach the person's clients, forged
  `settled` frames are journaled as durable. The argv choice was made by worker.ts's own
  AUTO-DECISION when the payload was "directory, a handful of options, switch overrides" — the
  P3b secret was added later without revisiting it. Beside it, `interactive-ws.ts`'s
  `freshRunSecret` comment claimed the secret "is never stored, only held here" while it is
  journaled (the `opened` record's `secret` field, 0600) and was printed in argv.
- **The per-run `switches` carrier admits the two env-only names that are not switches**
  (0165-171): `KNOWN_SWITCHES = new Set([...Object.values(SWITCH_ENV), …])` registers every
  name the core's registry answers to — including `OPENCODE_AUTO_MODELS` (the operator registry
  layer's path: a file path, not a parsed switch — `parseSwitches` never reads it, the
  registry's own comments say so) and `OPENCODE_AUTO_SERVER` (the external agent server URL's
  env form, the same class). Admitted, they are applied to the worker's environment verbatim
  (`applySwitches`), so a `control` token names any readable JSON on the machine as the
  operator registry layer — choosing the agent `bin` the driver spawns and which `{env:…}`
  /`{file:…}` values resolve into that child's environment — or points every session (prompts
  carrying project content) at an arbitrary server. `options.server` carries the same endpoint
  choice as a first-class per-run option with no bound at all. The scope tiers exist so a
  token is narrower than the operator; the carrier leaked the operator's own layer-picking
  through the switch grammar.

## The boundary, answered from docs/principles.md and the Security family first (0123's discipline)

- **The Security family** (AGENTS.md, the requirement family both findings are governed by):
  "nothing but the operator writes either layer" — the model registry's layers are the
  operator's alone. `OPENCODE_AUTO_MODELS` *is* the operator layer's path selector; admitting
  it in a per-run request makes every `control` token a third writer of the layer choice — the
  family's letter refused exactly this. The family's display discipline ("env names echoed,
  never values") is the credential's letter too: a per-run secret is a value the driver
  generates; it may reach the one process that needs it and the 0600 restart record that
  re-serves it, never a world-readable surface — and argv is one (`ps` prints it to every
  local user). The family's spawn discipline ("every child the driver runs spawns over the
  scrubbed base" — X1, 0059, extended to every driver child by 0180) is the affirmative
  channel: an `OPENCODE_AUTO_*`-named variable never reaches an agent child, so the prefix is
  the lawful carriage for a driver-domain credential.
- **P13** (frozen additive-only vocabularies): the per-run override layer's vocabulary is the
  switch registry's. 0067 §3 item 2's letter — "per-run overrides go only through the existing
  env-switch layer (`OPENCODE_AUTO_*` → the per-run options of the API)" — defines the carrier
  as the *switch* layer; the two env-only names are outside it by the registry's own design
  (kept out of `Switches`, `nonDefaultSwitches` and `formatSwitches` "a path has neither"
  default nor domain). Admitting them was a vocabulary drift the shared validator never
  ruled; refusing them is the restoration, not a narrowing. The refusal texts grow additively;
  no existing accepted name changes meaning.
- **P12** (fail loud, conservative under uncertainty) and **P2** (the person brackets every
  boundary): the bridge credential authenticates the one channel that carries the person's
  answers and run control; a reader of it becomes the run's bridge *silently* — the replace
  rule closed the real socket with "replaced", never surfacing the substitution to the person.
  Refusing a second worker socket while the first is open converts the attack's adoption step
  into a loud refusal (the error frame names the rule), the impostor's only remaining path the
  401 every wrong secret already gets.
- **P16** (genericity) and **P5** (single ownership): the daemon's v1 boundary is single
  machine ("single machine, multiple directories", the documented posture — loopback bind by
  default, same-host lock arbitration). `options.server` accepting any URL let a served route
  silently cross that boundary; binding the option to loopback is the boundary's own letter
  applied to the field, not a new policy. The operator's wider channel exists and is owned:
  the confinement launcher's environment overlay (`serve --launch` — "the daemon's environment
  is the carrier the launcher reads"), which is the one lawful env route to a worker since the
  daemon's spawn filter drops every `OPENCODE_AUTO_*` from its own environment by design
  ("a driver environment must not reach a run").

## Decisions

### D1 — the bridge secret rides the spawn environment; the bridge latches to its live connection (0165-054)

The per-run secret leaves the argv payload and rides the worker's spawn environment under
**`OPENCODE_AUTO_BRIDGE_TOKEN`** (the name defined in `src/request.ts`, the one shared
vocabulary module; the daemon adds it after its `OPENCODE_AUTO_*` spawn filter, which drops
the daemon's ambient layer and keeps the child's environment exactly as deliberate as
before). The prefix is the load-bearing choice: the agent-domain X1 scrub
(auto-core `src/agent/env.ts` — `driverVariable` matches the `OPENCODE_AUTO_` prefix minus the
two opencode flags) removes it from every process the driver runs — both adapters' spawns, the
script runner, the lane batch, the regression slot, the round-close build, the version checks
(0180's census) — so **no agent session inherits the credential, with zero core change**: the
existing seam already carries the guarantee, and the prefix's own meaning ("driver-domain
variable") is exactly what a bridge credential is. The argv payload's `transport` shrinks to
`{ run, url }` (`parseTransport` updated — `token` becomes an unknown field refused like every
other, the shape message re-stated); the worker reads the token from the environment when a
transport payload is present, and a transport payload without the environment token is a
usage error teaching the truth (the secret rides the spawn environment; a hand-spawned run
carries no transport at all — its questions take the stdin-closed degradation path, the
documented hand-spawned shape). The lane launcher (this shell's `profile.ts`) strips the name
for lane children — no lane child carries a channel by rule, so the credential's process
reach is the one worker that owns the bridge; the switch layer still inherits, 0180's
launcher posture unchanged.

The **bridge latch**: `interactive-ws.ts`'s open handler refuses a second worker socket while
the first is open — the impostor (or a stale duplicate) receives one error frame naming the
rule and a close, the first socket remains the bridge. The replace rule's only legitimate
consumer — the worker's own reconnect — always arrives after its predecessor's close cleared
`hub.worker` (`worker-interactive` reconnects only from `onclose`, backoff-capped), so the
latch refuses nothing legitimate: one worker process holds one live bridge socket at a time
by its own construction. `freshRunSecret`'s "never stored" comment is corrected to the truth:
the secret is held in the hub, journaled 0600 in the daemon's data directory for the restart
reconstruction (the question journal's own AUTO-DECISION, unchanged — without it the orphan's
reconnect is a 404), and carried to the worker through the spawn environment — never argv,
never a log line (the worker's bridge banner names the URL alone, as it already did).

Rejected arms, on the record: the request-file/fd carriage (moving the whole payload off
argv) — that is S29-10's own named linkage ("S29-01's remedy removes the E2BIG class
entirely"), a step-063 finding whose state-machine halves (the spawn-throw wedge, the no-proc
delete) this step must not pre-empt; its blast radius (the `worker '<json>'` hand-spawn
contract, the transfer self-spawn, the lane launcher payload, every spawning test) buys no
credential guarantee the env carriage lacks — `/proc/environ` is owner-only where
`/proc/cmdline` is world-readable. A non-prefixed env name rejected with it: it would need
the X1 scrub extended (a core change) where the prefix buys the same guarantee through the
existing seam. Refusing the secret from the journal rejected: the journal write is 0067's
ruled restart mechanism, 0600 beside the store's tokens — the same owner-only class as the
spawn env, the v1 single-operator-machine posture.

**Pin**: a spawned worker's argv (read as the process itself sees it) carries no `oar_` token
— the finding's own repro inverted — while the spawn environment carries
`OPENCODE_AUTO_BRIDGE_TOKEN` with the `oar_` shape (the carriage moved, not dropped); the
latch pinned against the real handlers (a second worker socket refused, the first still
serving), and the worker-side refusals (a `transport` with a `token` field; a transport
without the environment token) pinned as usage errors.

### D2 — the switches carrier takes switches only; `options.server` loopbound (0165-171)

`KNOWN_SWITCHES` excludes `SWITCH_ENV.models` and `SWITCH_ENV.server`; `parseSwitches` refuses
each with its own teaching — `OPENCODE_AUTO_MODELS` is "the operator registry layer's path, not
a switch" and `OPENCODE_AUTO_SERVER` "the external agent server URL's env form, not a switch" —
naming the operator's real channels (the XDG config root the worker inherits, the confinement
launcher's environment overlay) and, for the server name, the per-run form that does exist
(`options.server`, loopbound by the same ruling). The retired names keep their pass-through
posture (the core answers them with its own notice — passed through, never refused here), and
every live switch name is unaffected: the refusal is additive, the carrier's grammar restored
to 0067 §3 item 2's letter.

`options.server` is accepted only as a **loopback URL** (host `127.0.0.1`, `::1` or
`localhost` — the daemon's documented single-machine boundary applied to the one field that
silently crossed it): a non-loopback value is a 400 naming the boundary and the operator's
wider channel (the confinement launcher's environment overlay — the daemon's spawn filter
drops the ambient `OPENCODE_AUTO_*` layer by design, so the launcher is the one lawful
environment route to a worker, never a per-run request). The register's other arm — a serve
flag opting the operator into unbounded server URLs — declined on P21: no measured consumer
asks for the wider field, the launcher already owns the operator's channel, and a new flag is
new frozen vocabulary for a reach nobody has needed. The CLI's `--server` keeps its own
unbounded shape (a terminal is one person's one act — the probe rate-window's own asymmetry,
stated for the same class of surface); the web client's start-form field keeps working for
the loopback case, its hint re-stated to teach the rule where the value is typed, the bundle
regenerated in the same lockstep.

**Pins**: the two names refused with their teachings at the shared validator (unit), the
daemon's POST /runs answering 400 for them ahead of project resolution (the
validation-before-spawn order), `options.server` accepting a loopback URL and refusing an
off-host one with the remedy line, and the floors — a live switch and a retired name still
pass validation unchanged.

## Derivation and Category scope

Derives: the **Security family** (both D1's carriage and D2's layer-exclusivity are the
family's own letters — the secret never on a world-readable surface, the operator layers
written by the operator alone), **P13** (the carrier's vocabulary restored to the registry's,
refusals additive), **P12** (the latch converts silent substitution into a loud refusal;
uncertain endpoint values refuse), **P2** (the person's answer channel bound to the process
the daemon spawned), **P5** (the one lawful env route to a worker is the launcher's overlay —
no second writer of the operator layer), **P16** (the loopback rule is the v1 boundary's own
letter, no project fact named), **P10** (floors pinned: every live switch, the retired
pass-through, a loopback server URL, and the no-transport hand-spawn byte-identical), **P19**
(the rejected arms measured against the record's own evidence — the repro, the exit-2
degradation bound, the register's S3 rating note). Amends: none — 0067's letters stand
(§3 item 2 restored, not changed; the journal secret its ruled mechanism); 0180's X1 scope is
consumed as designed (the prefix scrub covering one more driver-domain name is the seam's
own shape, no census entry added — no core spawn site changes).

premises this ruling changes: none. (0067 §8's T-094 journal rationale re-read standing; the
daemon.md lines that stated the argv carriage are corrected as this change's documentation
lockstep, not as a premise flip.)

Tier: mechanism (auto-server's spawn carriage, bridge admission and request vocabulary — no
core src change; the core seam consumed read-only).

### Category scope

The Security family's server-side half, enacted category-complete in one change:

- Code homes: `packages/auto-server/src/request.ts` (the `OPENCODE_AUTO_BRIDGE_TOKEN` name,
  `parseTransport`'s `{run, url}` shape, `KNOWN_SWITCHES`'s exclusion and the two refusals,
  `parseOptions`'s loopback rule), `packages/auto-server/src/daemon.ts` (the spawn env
  carriage, the payload's token-free transport, the comment truth), `packages/auto-server/src/
  worker.ts` (the environment token read and its usage refusals, the payload docs),
  `packages/auto-server/src/interactive-ws.ts` (the latch, the secret's comment truth),
  `packages/auto-server/src/profile.ts` (the lane launcher's strip), `packages/auto-server/
  web/render.ts` (the server-field hint) + `src/web/client.ts` (the regenerated bundle),
  `packages/auto-server/src/index.ts` (the USAGE line's transport wording).
- Test homes: `packages/auto-server/test/daemon.test.ts` (the argv/env carriage pin), `test/
  ws-protocol.test.ts` (the latch pin), `test/worker.test.ts` (the request-vocabulary cases
  re-pointed — the transport fixtures carry no token — and the new refusal rows in their own
  fast test beside the timing-drift table), `test/web-build.test.ts` (the regenerated bundle,
  existing pins), plus a focused validator pin (the two names, the loopback rule, the floors)
  in `test/worker.test.ts`'s vocabulary suite.
- Documentation homes: `packages/auto-server/docs/daemon.md` (the carriage rule beside the
  switch table and the bridge endpoint row, the loopbound `options.server` line),
  `packages/auto-server/src/index.ts`'s USAGE (the same lockstep), this package's INDEX row
  and AGENTS.md navigation line (the server-trust seams), `docs/structure.md` only where a
  mapping changes (auto-server rows are the auto-server package's own docs; the core's
  structure.md row for the switch registry unchanged — no core file touched).

## Residuals

- The same-uid reader: `/proc/<worker>/environ` and the 0600 journal remain readable by a
  process of the same user (the agent session among them, kernel-ptrace-policy permitting) —
  the v1 single-operator-machine posture both surfaces already documented; the deeper fix
  (fd carriage) is bounded by the same posture and named here, not built (P21).
- The `?token=` query carriage stays on both WebSocket routes (a browser upgrade cannot carry
  headers; the documented v1 loopback posture, daemon.ts's own note) — the register's family
  note, unrebuilt.
- The argv payload itself still carries unbounded client text (the E2BIG/ENOENT class) —
  S29-10's own finding, step 063's state-machine halves untouched here by design.
- The terminal-run hub keeping its secret valid (no eviction, no state check at the worker
  upgrade) — S29-05/0165-170, step 064's, beside which this step's latch is the adoption-side
  belt only.
- An impostor that legitimately holds the secret (a same-uid journal reader) and arrives
  while no bridge is open is still adopted — the credential is the credential; the latch
  bounds the flip-flop, not the first connect.
