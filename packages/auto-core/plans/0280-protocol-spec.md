# 0280 — The spec established: docs/protocol.md, the `0.1` preview version, the protocol-doc ratchet

The 0279 docket's first slice. The protocol's specification is
[docs/protocol.md](../docs/protocol.md) — the standing single source,
maintained: every future protocol change amends it in the same change, and
numbered plans record rulings and history, never the spec. This document
records the ruling that established it, the version ruling it carried, and
the ratchet that enforces it; it deliberately does not restate the wire.

## Category scope

Tier: mechanism — the spec document, the version literal, the ratchet.

Derives: P5 (one spec home, one version literal, one derivation of the
stage-word vocabulary), P13 (the frozen vocabularies now stated in a
maintained spec with a tombstone section — ids never reused, removals
recorded), P18 (the record outlives the tool: the spec is a plain
maintained document, machine-checkable against the code it describes), P6
(the doc's enumerations are derived from the code's constants at test
time, never a second hand-maintained list). Amends: none — 0279's ruling
is enacted, not changed.

## The version ruling applied

The wire's `protocol` literal flips from `1` to **`0.1`, preview** — two
constants, one home per package, pinned equal by the ratchet:

- `EXECUTOR_PROTOCOL = 0.1` (auto-core `src/executor-coordinator.ts`) —
  the reply envelope's `protocol` field (the worker's 200 body stamps it;
  the coordinator's response-size measures simulate the same envelope
  shape), imported by the server's `executor-worker.ts` and
  `executor-hub.ts` (whose version check now names both versions on
  mismatch, the preview-honesty letter).
- `PROTOCOL_VERSION = 0.1` (auto-server `src/ws-protocol.ts`) — the `v`
  field of every WebSocket step frame; the `StepRequest`/`StepDone` types
  widen their `v` to `number` and the parse stamps the constant (the
  literals never appear twice).

The `1` is recorded as premature in the spec's tombstone section — the
compatibility record. A stale v1 client fails loudly at the handshake with
both versions named. The bundled web client was rebuilt in the same change
(it inlines the ws-protocol module; the build ratchet caught it).

## The ratchet

`test/protocol-doc.test.ts` in both packages, both directions: the doc's
` ```protocol ` vocabulary blocks are parsed and pinned against the code's
constants —

- the core arm: the wire version (`EXECUTOR_PROTOCOL`), the grant kinds
  (`WORK_TYPE_IDS`, now exported — one table the catalog renders and the
  spec enumerates), the share stage words (`SHARE_STAGE_WORDS`, derived
  from the new `SHARE_STAGE_OF_KIND` table plus the three shape-specific
  commits `park`/`done`/`clarify` — `shareMessage` reads the table, so the
  per-kind ternary's single home is now the table the ratchet reads), the
  tombstone record;
- the server arm: the routes (`executorRoutes`), the scopes (`SCOPES`), and
  the one-version rule (`PROTOCOL_VERSION === EXECUTOR_PROTOCOL`, both
  equal to the doc's stated version).

A vocabulary that grows in code without the doc, or in the doc without
code, is red either way — the conscious lockstep P13 demands, made
mechanical. The manual-prompts ratchet's stage-word anchors moved with the
ternary's removal (the standing moved-anchor discipline), each arm now
pinning its kind's table entry.

## Companion changes

The AGENTS.md documentation-system family gains `protocol.md`; the INDEX's
protocol rows point at the spec as the standing home; the auto-server
README's intro and executor section point at the spec and state `0.1`;
docs/daemon.md's frame-version mention follows.

## Residuals

- The spec describes the wire as it stands at this change; the docket's
  later slices amend it in their own changes (0281 the `synthesize` kind,
  0282 the route/scope tombstones, 0283 the CLI tombstone list, 0284 the
  project lifecycle).
- The person claim/answer arms and their scopes are documented as they
  stand — 0282's demolition letters will amend the spec then, not now.

## Tests and verification

`test/protocol-doc.test.ts` (auto-core, five tests), the server arm
(auto-server, three tests), the standing suites green in both packages:
auto-core 3523 across 175 files (3518 + the five new tests, beside the
coordinator comment/const changes), typecheck exit 0; auto-server 222
across 32 files (219 + the three new tests, the web bundle rebuilt) beside
the container's pre-existing IPv6-bind failure, failing on the committed
tree identically — 0265's record), typecheck exit 0.
