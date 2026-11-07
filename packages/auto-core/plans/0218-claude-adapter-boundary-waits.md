# 0218 — the claude adapter's boundary teaching, its bounded waits, and the health probe's clock

Status: active-authority (0166 remediation step 058, wave WD-routing; findings 0165-033 = S18-01
(S2, CONFIRMED), 0165-136 = S18-03 (S3, CONFIRMED), 0165-202 = S18-06 (S4, CONFIRMED), 0165-203 =
S18-07 (S4, CONFIRMED) — 033 by trace over the adapter's contract translation and the shipped
template, the other three by the S18 record's deterministic traces at its HEAD).

Four defects of the agent-adapter layer, one per finding, ruled in one family pass:

- **The declared external_directory posture silently diverges under claude** (0165-033): 0041 D6's
  key map predates 0122's `permission.external_directory` section, `TOOLS` has no row for it, and
  `claudePermissions` skips the key — so the shipped template's knowledge boundary (`"/**": "deny"`),
  its `/tmp/**` allow, 0147's realpath allows and a sealed wall's standing deny reach no claude
  session under any preset, and no run-start line taught the loss. 0190 D1 answered the wall's half
  (the declared capability, the refusing close, the status row) and deferred the translation arm
  here with this finding.
- **The adapter's waits have no ceiling** (0165-136, 0157's own standing residual): `send`'s
  model-change path does `await live.done`, and `pump` resolves only after `await live.proc.exited`
  — a claude child that ignores stdin close hangs the dispatch forever; no watchdog owns it (no turn
  is running; the idle watchdogs judge turns).
- **The external-server health probe has no clock** (0165-202): `defaultConnect`'s
  `fetch("/api/health")` carries no signal, so an unreachable-but-unanswered `--server` host rides
  Bun's fetch default (~300 s) at run start, where the managed spawn fails loudly in 5 s — a
  mistyped or firewalled URL looks like a hung run.
- **A busy-process model change is silently ignored** (0165-203): the restart-on-model-change guard
  requires `!live.busy`; a prompt naming another model while a turn runs is written to the
  fixed-model process with no signal — a defensive gap today (steers carry the session's model,
  failover uses new sessions), a silent wrong-model run the day a caller forgets.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P19** — mechanisms are ruled from measured evidence; "adapter facts observed, not documented"
  (0041's own doctrine). The translation arm's three grammar claims (claude `Read`/`Glob`/`Grep`
  denies on `//<abs>/**` rule forms; `additionalDirectories` as the allows' carrier; claude's
  default outside-cwd behavior) were PLAUSIBLE-not-run at 0190 and remain unrun: **no `claude` CLI
  exists on any host this program has measured** (probe recorded in the step record). Ruling the
  translation now would trade a measured lie (0190 D1's ground) for an unmeasured one; the arm stays
  declined, its probe recipe named as the residual. The teaching arm needs no grammar fact — only
  the section's presence and the declared capability, both already measured.
- **P8** — every surfaced line teaches its remedy: the run-start note names exactly what the
  boundary loses (the knowledge boundary's deny, the allows, a wall's standing deny) and the
  opencode advance; the bounded wait's firing line names what it did; the timed-out health probe
  says it timed out; the busy-model refusal names the per-process model fact and the two lawful
  routes (send without a model, or after the turn ends).
- **P20** — in-flight work is never destroyed, and the terminal of every bounded wait is the person:
  the ceiling fires the kill ladder only on a process that is already closing (idle, its turn
  finished — the message goes to a NEW process that resumes the session), never on a running turn;
  nothing is interrupted that could still make progress. The grace before the ladder (5 s, the
  ladder's own scale) is the wait-out.
- **P12** — fail loud, conservative under uncertainty: a silent wrong-model run and a silent
  boundary loss are the swallowed failures; the refusal, the note and the timeout are their loud
  forms. A timed-out probe resolves toward "unavailable" (the conservative reading).
- **P10** — the byte-identical floor: a fleet that carries the posture, a target with no live
  `external_directory` entries, a model-matching steer, a model change at idle (the restart path),
  a health probe that answers — each byte-identical to today. The note and the refusals are the
  ruled defect fixes' own bytes (the exemption).
- **P7** — the driver checks grammars it defines: the note fires on the section's *presence*
  (entries read through `externalDirectoryLive`, the wall's own reader — one reader home), never on
  the section's meaning; the busy-model refusal compares two strings the adapter itself defined.
- **P13** — frozen additive-only vocabularies: no protocol literal, exit code or document grammar
  changes; `DegradeOpts` grows one optional field, `ClaudeAgentOptions` one optional ceiling,
  `defaultConnect` one optional clock — all additive seams in the established style (`spawn`,
  `contract`, `projectsDir`).
- **P5** — single ownership: the declared-section fact is read once per run start at the pool (the
  one caller holding the directory), the capability intersection stays `degradeAgents`'s one home,
  and the wall/status/refusal surfaces keep reading their own already-ruled facts.

## D1 — the translation arm declined on measured grounds; the teaching arm enacted (0165-033)

**The declined arm, recorded.** Translating `external_directory` into claude settings rules would
flip `CLAUDE_CAPABILITIES.externalDirectory` to `true` and lift 0190 D1's close refusal with it —
the seam was built for exactly that. Its ground is still missing: the three grammar claims above
are unverified on every host this program can measure (no `claude` CLI; 0041's doctrine forbids
ruling adapter facts from documentation). The arm stays **declined**, with its recipe as the named
residual: a host with the CLI must observe (a) whether `//`-prefixed absolute-path deny rules reach
`Read`/`Glob`/`Grep` in the running version's settings grammar, (b) whether `additionalDirectories`
carries the allows, and (c) what the version does outside the working directory by default — all
three before any translation lands, in the same change as the capability flip. The contract table's
boundary row and the capability comments are restated from "the adapter wave's question" to the
standing disposition (declined on P19 grounds, 0218 D1; the probe recipe above); the 0190-era
no-translation ratchet pin in `test/agent-claude.test.ts` keeps pinning the truth either way.

**The enacted arm.** The general run-start note 0190 D1 deferred here: `DegradeOpts` gains
`externalDirectoryDeclared?: boolean` (absent = the target declares nothing — every existing caller
byte-identical), and `degradeAgents` emits one note when the fleet's intersection lacks the posture
AND the flag is set:

> `opencode.json's permission.external_directory does not reach this fleet's sessions[; <agent>
> carries it nowhere]: the knowledge boundary's deny, its allows and any wall's standing deny are
> not carried into the sessions — run under the opencode agent (OPENCODE_AUTO_AGENT=opencode, or
> the config's agent key) to carry the boundary into sessions`

— one `⚙` note of the established family, labeled with the forcing agent under a registry
(`by(forced(...))`, the other notes' own mechanism). The one caller holding the directory reads the
flag: `startPool` derives it once at entry through `externalDirectoryLive` (the wall's own reader —
entries present = declared; absent, malformed or unreadable = not declared, the wall's and config
command families failing loud at their own moments), and threads it at both start arms. Since
`init`'s template ships the section, every properly-initialized project under a non-carrying fleet
learns the divergence at run start — the honest statement, not noise (P8/P12). The wall's own
surfaces (the close refusal, the status row) are unchanged and keep their moments.

**The floor.** A carrying fleet, an undeclared target, an unreadable or empty section: no note —
byte-identical. `degrade`'s single-agent callers without the flag: byte-identical.

## D2 — the closing wait is bounded; the ladder owns the wedged child (0165-136)

`send`'s closing wait (`await live.done`, the model-change path) races a ceiling —
`CLOSE_CEILING_MS = 5000`, the kill ladder's own scale (`bunSpawn.kill`'s SIGTERM→5 s→SIGKILL),
overridable through `ClaudeAgentOptions.closeCeilingMs` (a test seam in the options type's
established style). On the ceiling the ladder fires — `live.proc.kill()` — with one teaching line
through the host-threaded `log` (its first use; the seam existed since 0041):

> `⚠ a claude process did not exit 5s after its input closed; killing it (the session resumes on a
> new process)`

— and the `await live.done` that follows the kill resolves through the same ladder (SIGTERM at
once, SIGKILL 5 s later at the worst): the dispatch is bounded on every rung. `pump`'s
`await live.proc.exited` needs no timer of its own: nothing in a dispatch path awaits `live.done`
except this site, `abort()` and `close()` already kill, and the kill unblocks the pump through its
own exit — the one ceiling covers the finding's both halves (`client.ts:324`'s await and `:292`'s
pump fall). The killed process was closing, never busy (the restart path requires idle): no turn is
destroyed, the transcript stays resumable, the next process `--resume`s the session (P20).

**The floor.** A process that exits on stdin close (the CLI's own behavior, every existing test
double): the race resolves on `live.done` first — byte-identical, no timer fired, no line.

## D3 — the health probe carries a clock (0165-202)

`defaultConnect`'s fetch gains `AbortSignal.timeout(CONNECT_HEALTH_TIMEOUT_MS)` — `5000`, the
managed spawn's own start bound (`SERVE_START_TIMEOUT_MS`), overridable through a fourth optional
parameter (a test seam; `manage`'s default closure passes nothing). A probe that aborts resolves
toward unavailable (P12's conservative direction) with the timeout taught in the line:

> `opencode server unavailable: <url> (health check timed out after 5s — is the host reachable?)`

— a refused connection keeps today's exact `opencode server unavailable: <url>`. Measured: Bun's
fetch over a never-answering socket aborts as `DOMException:TimeoutError` at the stated ms (the
step record's probe).

**The floor.** A host that answers (or refuses) within the bound: byte-identical behavior and
message.

## D4 — a busy-process model change is refused, never silently run (0165-203)

`send` gains one guard ahead of the model-change restart: a prompt naming a model the live process
was not started with, while the process is busy (mid-turn), fails the call —

> `a model change reached a claude process mid-turn (its model is fixed per process start); the
> message was not sent — send it without a model, or after the turn ends`

— `ok: false`, nothing written (P12: the wrong-model run was the swallowed failure; today's driver
never sends the shape, so the floor is every existing steer: a model-matching steer and a
model-less prompt byte-identical, and the idle model-change restart byte-identical). The guard
completes the per-process model fact's grammar: idle = restart on change (the ruled path), busy =
refuse (0165-203), no third silent arm.

**The floor.** `live.busy` with the same model, or no model in the input: byte-identical.

premises this ruling changes: **0190** (D1's "deliberately no run-start degrade note of its own" —
the deferral itself, answered here: the note fires on the declared-section condition, so a
non-carrying run on a target with live entries is no longer note-less; re-read in the same change:
D1's capability shape, the refusal, the status row and the declined-translation ground all stand —
the note composes with them, the flag's own comment and the contract table restated to 0218's
disposition; 0190's INDEX row annotated). **0157** (its deferred P20-ceiling residual — "the
claude adapter's unbounded `await live.done` … needs its own P20-ceiling ruling" — is discharged
here by D2; re-read in the same change: the pool-drain and kill-ladder rulings stand, D2 reusing
the ladder's scale). 0041 D6 re-read and stands (the key map's translate-don't-duplicate shape;
the missing row stays the declared `externalDirectory: false` with the translation declined on
P19 grounds — the tenth-amendment note in `types.ts` restated to the standing disposition);
0055 §8.5 re-read and stands (the intersection's one home; the note threads through its existing
`by(forced(...))` labeling); 0040's degradation table row restated (D1's note joins the family).

Derives: **P19** (the declined translation: unmeasured grammar claims are not a ruling's ground;
the probe recipe named), **P8** (four teaching lines, each naming its remedy), **P20** (the ceiling
never touches a running turn; the ladder is the wedged child's own exit), **P12** (the silent
losses made loud; the conservative timeout direction), **P10** (the floors above), **P7** (the
note keys on the section's presence through the wall's own reader; the refusal on two
adapter-defined strings), **P13** (three additive optional seams; no frozen vocabulary moves),
**P5** (one reader for the declared-section fact; the intersection stays one home). Tier touched:
**mechanism** — `src/agent/claude/{client,contract}.ts`, `src/agent/opencode/server.ts`,
`src/capability.ts`, `src/agent-pool.ts`, the adapter comments in `src/agent/types.ts`, the test
homes; no principle text moves.

## Category scope (0123 D1's discipline)

Family: *the agent adapters' session-side reach and their process lifetimes — what a declared
external_directory posture may teach when the fleet cannot carry it, and the bounds on the waits
and model facts the claude adapter's dispatch path makes* (0041's adapter contract meeting 0122/
0147's boundary surface, 0157's deferred ceiling, 0055 §8.5's intersection). Home-set enumerated
at ruling time:

| home | disposition |
|---|---|
| `src/capability.ts` (the `externalDirectoryDeclared` opt; the note; the table row and the field comment restated) | changed — D1 |
| `src/agent-pool.ts` (the declared-section read at `startPool` entry through `externalDirectoryLive`; threaded at both start arms) | changed — D1 |
| `src/agent/claude/client.ts` (the bounded closing wait + the ladder + the teaching line; the busy model-mismatch refusal; the capability comment restated) | changed — D2/D4 |
| `src/agent/opencode/server.ts` (`CONNECT_HEALTH_TIMEOUT_MS`; `defaultConnect`'s signal, the timeout wording, the optional clock seam) | changed — D3 |
| `src/agent/claude/contract.ts` (the header table's boundary row restated to the standing disposition) | comment — D1 |
| `src/agent/types.ts` (the `externalDirectory` field comment restated — declined on P19 grounds, the probe recipe) | comment — D1 |
| `plans/INDEX.md` (the 0218 row; 0190's row annotated) | changed — D1 |
| `AGENTS.md` (navigation lines: the adapter row gains 0218, the pool/degradation row gains the note) | restated |
| `docs/structure.md` (the claude adapter, opencode adapter and agent pool rows) | restated |
| Test homes: `test/agent-claude.test.ts` (D2's bounded-wait pin over a wedged double; D4's refusal pin; the floors), `test/agent-server.test.ts` (D3's timeout pin over a never-answering socket), `test/capability.test.ts` + `test/agent-pool.test.ts` (D1's note unit + the threading pin) | changed |
| The wall family (`src/wall.ts`, `src/status.ts`, `src/external-dirs.ts` beyond the read) | held, untouched — 0190's surfaces keep their moments; D1 composes |
| `src/agent/claude/host.ts`, `stream.ts` | held, untouched — no finding measures them |
| The opencode client's 13-call surface, the pool drain, the kill ladder itself | held, untouched — D2 reuses the ladder, never changes it |

## Residuals

- **The translation arm's probe recipe** (D1's declined half): a host with the `claude` CLI must
  observe the three grammar facts (the `//`-rule forms, `additionalDirectories`, the default
  outside-cwd behavior) before any translation lands — with the capability flip and the
  no-translation ratchet pin updated in the same change. Until then a claude project's boundary is
  the teaching note, the status row and the wall's refusing close — the honest state.
- **D2's ceiling is grace, not guarantee**: a child that survives SIGKILL (uninterruptible I/O)
  outruns even the ladder; the person's kill of the run is the terminal of that last wait (P2), as
  it already is for every SIGKILL path.
- **D2's pump-side await carries no timer of its own** (the kill unblocks it; no dispatch path
  awaits it elsewhere) — a process wedged with no successor prompt leaves the pump pending until
  `close()` kills at run end; harmless by measurement, named here.
- **D3's clock is the connect path's alone**: the SDK client's per-request `timeoutFetch` keeps its
  own ruled shape; a health-answering host that stalls later is its finding's, not this one's.
- **D4's refusal is the adapter's own guard**: a future driver-side caller that needs mid-turn
  model changes must land its own ruling (queue-until-idle or process-per-model); the guard's
  message teaches today's two lawful routes only.
- 0190's residuals otherwise stand (status's shell-injected agent, the registry fleet's narrowing,
  0189's set).

## Tests

- `test/capability.test.ts`: the note's unit — a non-carrying fleet over `externalDirectoryDeclared:
  true` emits the teaching note; the same fleet without the flag emits nothing (the floor);
  a carrying fleet with the flag emits nothing. Fail-before red (the opt and the note did not
  exist).
- `test/agent-pool.test.ts`: the threading pin — `startPool` over a directory whose `opencode.json`
  holds live entries, under a host/client whose capabilities lack the posture, logs the `⚙` note;
  over a config without the section, no note (the floor). Fail-before red (no line was logged).
- `test/agent-claude.test.ts`:
  - D2: a wedged double (stdin closed, never exits; only `kill()` exits it) — the model-change
    prompt completes (ok, the new process started, the message written to it), the teaching line
    logged, `killed` true; with `closeCeilingMs` small the pin runs fast. Fail-before red (the
    pre-fix `await live.done` never resolves — the pin times out at its own explicit bound).
  - D2's floor: a well-behaved double (exits on end) — no line, no kill, byte-identical restart.
  - D4: a busy live process (a turn running) + `promptAsync` naming another model → `ok: false`
    with the refusal's wording, nothing written. Fail-before red (pre-fix `ok: true`, the message
    silently on the fixed-model process).
  - D4's floor: the same busy process + a model-matching steer → `ok: true` (unchanged).
- `test/agent-server.test.ts`: D3 — `defaultConnect` against a local socket that accepts and never
  answers, with the clock seam set small: rejects within the bound with the timeout wording; a
  refused connection keeps today's message. Fail-before red (no signal: the fetch rides the default
  and the pin's own race bound fails first).
