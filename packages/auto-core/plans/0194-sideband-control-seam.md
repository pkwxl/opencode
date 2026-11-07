# 0194 — the sideband's control requests a declared core seam; no shell reaches the ambient holder

Status: active-authority (0166 remediation step 034, wave W3-shell-seam; finding 0165-089 =
S06-04, CONFIRMED — re-verified against HEAD at ruling time: the import at
`packages/auto-server/src/worker-interactive.ts:46`, the ambient calls at lines 164/167, the
callers ratchet's `srcFiles()` (test/services.test.ts) walking auto-core's src alone, and the
header's own justification (lines 21–24) naming the core's `interactive` entry — a different
module. A repo-wide grep finds no other production import of `auto-core/services` outside the
core; the two test imports (auto-server's ws-protocol suite, packages/auto's e2e) install
holders, the core's own tests' sanctioned lifecycle pattern).

One finding, one family: **the run-services allowlist claimed a reach it did not have.** 0061's
clause is universal — "`services()` … may be called only from the modules listed in
`SERVICE_ENTRIES`" — and its enforcement, the callers ratchet, is a scan over auto-core's src.
A shell package importing the ambient accessor stands outside the scan by construction: the
allowlist can only govern callers the core can see. 0067 P3b then built the worker transport's
control channel on that ungoverned import, with a liveness gate (control frames land only after
the run's first `attach`) protecting the *holder's install order* — the exact property the
ratchet family exists to hold — and the transport's header justified the read by an entry that
names the core's own terminal sideband. No wrong behavior today (one run per worker process;
`close()` clears `live` before runAll's finally uninstalls), but the next core change that
threads control as data breaks the server silently, invisible to every ratchet. The remedy is
not widening the allowlist (it names core modules; a shell module can never enter it) and not
teaching the core's scan about sibling packages (the core never knows shells): **the route
becomes a declared seam the core owns, and each shell's own suite enforces the boundary the
core's scan cannot see.**

Derives: **P14** — one-way dependencies through declared seams: the shell transport's
difference (a WebSocket bridge carrying the control vocabulary) injects through the existing
`Interactive` seam; what it needed from the run — applying a control request to the run's
services — is core logic and becomes a core export in the sideband's own home, exactly the
register's proposed remedy. **P5** — single ownership: the mechanism "a sideband applies a
control request to the run's services" ends with exactly one owning home (`src/interactive.ts`'s
`requestControl`, the one ambient read left in the module), and the boundary assertion that
holds it exists where it can actually see every caller (each shell's own src scan; the core's
callers ratchet keeps its core-side reach unchanged). **P10** — the byte-identical floor: the
terminal sideband's three control-word behaviors are untouched (their existing pins pass
byte-identical), the worker transport's observable behavior (frames, refusals, log lines) is
untouched; the change is exactly the route, fail-before covered by the boundary scans and the
seam's own pin. Amends: none — no principle restated. Tier: core code (`src/interactive.ts`),
shell code (`packages/auto-server/src/worker-interactive.ts`), tests in all three packages.

premises this ruling changes: **0067 P3b's control-channel route** (the durable record's
control-liveness clause presupposed the transport reaching the ambient accessor by direct
import — an import no ratchet could see; the route becomes the core seam, and the liveness
gate, its rationale and its `applied: false` starting-window answer stand unchanged — the
record's own words "it must never land on the ambient accessor's process-default holder" are
the gate's premise, kept, while the ungoverned import beside it goes), **0061 C1–C5's reach
premise** (the clause says "only from the modules listed" while its ratchet could only ever
see core modules; the enforcement now extends to the shells' own suites by their own scans —
`SERVICE_ENTRIES` itself is unchanged, still shrink-only, still core-modules-only). Each
re-read in this document where its premise is touched.

## The boundary, answered from docs/principles.md first (0123's discipline)

- **P14** — the core never knows shells: the core's ratchet cannot scan what the core must not
  name. The seam is therefore core-owned (the sideband's home module exports the route) and the
  enforcement beyond the core is each shell's own assertion — the only party that can see the
  boundary from the other side. This is the same direction as the direction test's "the core
  imports no HTTP": the boundary lives where its two sides can each hold it.
- **P5** — single ownership, two scopes: the mechanism scope consolidates interactive.ts's
  three ambient reads into the one exported route (the module keeps exactly one `services()`
  call site — the seam's own); the ratchet-family scope closes the gap between the allowlist's
  claim and its scan's reach, without growing the allowlist (a shell module is not a core
  module; entering the list is not an option, and the finding's remedy agrees).
- **P13** — frozen vocabularies grow additively by conscious lockstep: `requestControl`'s
  action pair `"exit" | "failback"` is the sideband's own existing control vocabulary (the
  terminal words, the transport's `ControlAction`) restated as one seam signature; no literal
  changes meaning, none retires.
- **P10** — the byte-identical floor: unset, absent, unchanged — a shell whose src never
  imported the holder sees nothing change; the terminal sideband's words behave identically
  (pinned); the transport's frames, gates and log lines behave identically (its own e2e and
  ws-protocol pins pass unchanged).
- **P21** — machinery waits for its consumer: the seam's shape is dictated by the one consumer
  that exists (the worker transport's two requests); no optional `bind(control)` threading, no
  interface growth on `Interactive` — the register's alternative remedy declined precisely
  because it would grow the frozen interface for a need one export already answers.

## D1 — the seam: `requestControl(action, order)` in `src/interactive.ts`

`src/interactive.ts` (the sideband's home, a `SERVICE_ENTRIES` member) exports:

```ts
export function requestControl(action: "exit" | "failback", order: string[] = []): void
```

— the one route every control word takes into the run's services: `exit` sets the run-wide
/exit flag through the installed holder's control (`services().control.requestExit()`),
`failback` posts the model-order request to the installed holder's router
(`services().router.requestFailback(order)`). The module's own three call sites — the
hard-wait pause's `/exit` (0182 D2), the free-line `/exit`, the free-line `/failback` — route
through it, so the module's ambient reads collapse to the seam's one call and the mechanism has
exactly one home (the behavior byte-identical; the existing interactive pins pass unchanged).
A transport outside auto-core (the worker's WebSocket bridge) imports this export and never
the holder module: the ambient read stays inside a module the callers ratchet can see, and the
allowlist's reach and its scan's reach stay the same shape. The function performs no
validation — the terminal sideband validates with its registry names, the transport with its
slash-only rule; validation is the caller's transport knowledge, the application is the
run's state, and the seam carries exactly the latter.

## D2 — the worker transport rewired; its header's false justification removed

`packages/auto-server/src/worker-interactive.ts` drops the `@opencode-ai/auto-core/services`
import; its `control()` arm calls `requestControl("exit")` / `requestControl("failback",
order)` after its own two gates (the slash-only failback discipline and the first-attach
liveness gate — both stay the transport's own: the worker holds no registry, and 0067 P3b's
liveness clause is the gate's own premise, unchanged). The header's paragraph justifying the
ambient read ("the sideband's own route (interactive is one of the SERVICE_ENTRIES)") is
replaced with the seam's truth: the export is the sideband's route into the run's services —
the one a transport outside the core may take; the ambient holder is unreachable from a shell
src by this ruling's boundary scans.

## D3 — the boundary beyond the core: each shell's own scan

The core's callers ratchet keeps its core-side reach (unchanged list, unchanged scan). The
boundary it cannot see is held where it can be seen: a new suite in each shell —
`test/no-ambient-services.test.ts` in `packages/auto` and `packages/auto-server` — asserts
that no file under the shell's `src/` imports `@opencode-ai/auto-core/services` in any form
(the quoted specifier, static or dynamic import; prose without the quoted form is not an
import), with a real-sources guard and crafted-source bite rows after the core ratchets' own
practice. Tests are exempt by design: installing a fresh holder is the core's own tests'
lifecycle pattern (`createServices`/`installServices` exist for it), and the shells' suites
verifying the control channel through an installed holder are that pattern's continuation —
the boundary is production reach, not test observation. `packages/auto`'s scan is green at
HEAD (its src never imported the holder) and guards the future; `packages/auto-server`'s is
the ruled defect's fail-before red. What this ruling does **not** decide: whether
`auto-core/services` should be a package subpath at all — the exports boundary (entry modules
vs the open `./*` map) is finding 0165-174, step 036's ruling; the scans here are the shells'
own discipline, whatever the map later says.

## Category scope (0123 D1's discipline)

- **Code homes**: `src/interactive.ts` (`requestControl`; the three call sites rewired);
  `packages/auto-server/src/worker-interactive.ts` (the import replaced, the two calls, the
  header restated). No other file changes behavior.
- **Test homes**: `test/interactive.test.ts` (the seam's pin: the requests land on the
  *installed* holder — exit and failback both); `packages/auto-server/test/no-ambient-services.test.ts`
  (new — the boundary scan, fail-before red on pre-fix source, bite rows);
  `packages/auto/test/no-ambient-services.test.ts` (new — the same guard, green at HEAD);
  the existing `packages/auto-server/test/ws-protocol.test.ts` control-channel test and the
  e2e suites run unchanged (the transport's observable behavior identical).
- **Documentation**: this document; the INDEX row; AGENTS.md's run-services navigation line;
  the program's ledger row (0165-089).

### Re-reads

- **0067 P3b** — the durable record's control-liveness clause stands whole (first-attach
  liveness, the `applied: false` starting window, "never land on the ambient accessor's
  process-default holder"); what changes is the *route* the applied frames take after the
  gate: the seam, not the direct import. The E2E list ("/failback reaching the router — the
  router's own consumption line in the run's log, not the transport's") describes behavior
  this ruling preserves exactly.
- **0061 C1–C5** — the allowlist's letter ("only from the modules listed") is now true at
  every package: the core side by the unchanged ratchet, the shell side by D3's scans.
  `SERVICE_ENTRIES` does not grow (the length ratchet stands); `interactive` remains on it —
  legitimately now in a stronger sense: the module is the home of the seam that serves every
  sideband transport's control requests.
- **0181 D1 / 0182 D2** — the sideband's detach and the pause's `/exit` are untouched (the
  pause's request routes through the seam; behavior pinned by the existing 0182 tests,
  unchanged).

## Floors and proofs

- Byte-identical (pinned by existing suites, passing unchanged): the terminal sideband's
  `/exit` at the pause, the free-line `/exit`, both `/failback` forms (interactive.test.ts);
  the transport's control-channel behavior (ws-protocol.test.ts: unapplied before the first
  attach, applied after it, malformed failback refused) and its e2e vocabulary.
- Fail-before (red on pre-fix source, green after): auto-server's boundary scan (the
  production import present at HEAD); the core seam's pin (the export absent at HEAD —
  file-level red, the established shape for a not-yet-exported seam); packages/auto's scan is
  a standing guard, green both sides by design.

## Residuals

- The exports boundary itself (should `auto-core/services` be a subpath a shell could even
  name?) — step 036's (finding 0165-174); this ruling's scans hold the shells regardless.
- The transport's slash-only failback discipline stays narrower than the terminal sideband's
  registry-aware check (0067 P3b's own AUTO-DECISION, restated in D1's terms — validation is
  transport knowledge); a future registry-carrying transport widens its own check.

## Tests

Named in Category scope; the exact red pins are enumerated in the step record
(`plans/0166-remediation/034-w3-services-allowlist.md`).
