# 0295 — The phantom host: pull-mode's model-free coordinator unstated, push-mode surfaces still teaching opencode-session carriage

Status: **findings record, 2026-11-22.** The adoption site's seventh
field record under 0255's incident instrument (0257, 0262, 0264, 0285,
0286, 0290, this — the estate's executor mode live on three lanes,
wire `0.1`, measured at the tree carrying `0294` (`e9149f5a4`), the
daemon serving that line). Exposure denominator: one adoption site,
bring-up day 5, zero days of release exposure. This document rules
nothing (0165's neutrality) and lands no code, no template, no test;
the fixes, when directed, each land as their own ruling per
0123/0110 D13. One finding — conceptual, documentation-side, with its
field cost measured — plus the person's ruling that closes it
site-side, recorded here because the tool's own surfaces seeded it.

Derives P19 (measured field record — every locus cited from the wire
replies, the dead session's error, the probed grants' brief bytes, and
the code as it stands), P18 (a plain corpus document, recorded
findings the only evidence channel), P8 (the remedy families named,
the fix rulings owed nothing here). Amends none — 0282's ask-channel
tombstone and 0283's push-CLI tombstones are cited as the boundary the
finding's seeds sit inside, never challenged.

## The principle the field made load-bearing (the person's ruling, recorded)

The push path's design had the tool invoke opencode for every model
call: the driver owned the sessions, spawned them into the project
directory, paid for them through its keyring, and read their work
back. The executor protocol inverts that direction **whole**: the
coordinator performs **no model calls at all** — derivation, fences,
settlement, commits; nothing else — and every grant's LLM work belongs
to whichever coding-agent session claims it. The claimant is
host-neutral by construction ("a coding agent session speaking the
routes", protocol.md's own opening; "any agent may claim"). There is
therefore **no work class "that keeps the opencode host"**: the
concept is a category error with no referent. The daemon's model
registry, its keyring, its `OPENCODE_CONFIG_CONTENT` spawn injection
(`spawnKeyConfig()`, src/router.ts) are push-mode machinery — under
pull mode they serve no route, spawn nothing (0282 killed the last
spawn carriage), and resolve nothing for any session the site might
start.

## The finding, measured

**The site invented an "opencode host" carrier — and the tool's
surfaces taught it.** Across three site-side design amendments
(2026-11-21/22) the adoption estate's operations document grew the
rule "reference-reading work keeps the opencode host: an opencode
session started in the project directory that claims over the same
routes," routing `formulate`/`synthesize` and reference-reading units
to it. The sitting of 2026-11-22 commissioned exactly that for igb's
T-016 (`synthesize`): a standalone opencode session, started in the
registered project directory with a hand-corrected executor letter —
and it **died at boot**, `ProviderModelNotFoundError: Model not found:
zai-coding-plan/glm-5.3`, no server-side session created. Root cause,
traced in the field: the per-project `opencode.json` names a model
that no opencode installation resolves standalone — the provider's
registration (the apiKey reference, the options floor) exists only
where the push driver injects it (`spawnKeyConfig()` →
`OPENCODE_CONFIG_CONTENT`, merged over the project's opencode.json at
the managed server's spawn), and the operator keyring
(`~/.config/opencode-auto/models.json`) feeds that injection alone.
Machinery with no function under pull mode decided what a pull-mode
session could not do.

**The mislabel's cost, measured the same sitting.** Two lanes'
`synthesize` units (igb T-016; erofs T-068, appearing after the site's
first executor-driven phase-boundary transfer) sat classified
"reference-reading, not child-carried" behind the concept — igb parked
half a sitting on the dead commissioning. Probe claims of both grants
(measured, then released/dispatched) showed both briefs
**self-contained**: the constructor prompt carries its charter and
evidential sources inlined ("You have no tools; answer from the texts
alone"), zero reference/corpus paths, every named source an in-tree
document — claimable by any configured agent. The person struck the
concept at the sitting ("there should never be such a concept"); both
shares then ran child-carried through the ordinary executor routes.

## The seeds, tool-side (loci and remedy families)

1. **`docs/protocol.md` never states the model-free-coordinator
   principle.** The spec pins routes, kinds, scopes, tombstones — and
   is silent on where LLM work happens, leaving an adopter to infer
   carriage from adjacent surfaces. Remedy family: a prose letter in
   the spec's own terms — the coordinator performs no model calls;
   every grant's model work is the claimant's; no kind implies a
   host. (The protocol-doc ratchet pins vocabularies; this is prose.)
2. **`prompts/executor.md` teaches opencode-session posture
   throughout** — beside its recorded staleness (`protocol: 1`, the
   tombstoned question route, the pre-0284 lifecycle shape; the site's
   §7 record, the 0285+ demolition track). Its refresh should state
   host-neutrality explicitly: any coding-agent session may claim; the
   coordinator never invokes a model.
3. **Per-project `opencode.json` as init writes it serves only
   push-mode spawn carriage** — the `"model"` binding and the
   opencode-session permission wall. Under pull mode the model binding
   is unresolvable standalone (the measured boot death) and the wall
   binds opencode sessions only, inert for every other claimant; both
   read to a fresh operator as executor carriage. Remedy families:
   stop writing the model binding under executor-mode projects, or
   mark it push-mode-only in the docs beside the wall's
   opencode-only scope.
4. *(Observed beside, a docs question never a defect:)* the daemon's
   `/models` surface and the keyring remain push-mode machinery
   serving no executor route; their letters should say so.

Classification: documentation/concept defect — no code behavior wrong
(the fence, the settlement and the close-out all behaved exactly as
designed through the whole episode; every commit the coordinator's).
The field cost: one dead commissioning, two site-side design
amendments misdocumenting carriage, one lane parked half a sitting,
and a supervisor-side rabbit hole tracing provider resolution that
pull mode never needed. Residuals: none code-side; the site's own
design document carries the strike at its next stand-down amendment.
