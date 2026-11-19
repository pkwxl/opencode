# 0261 — The executor restriction catalog and daemon postures

The stage-3 design slice ruled ahead of its enactment — the maintainer's
exploration of 2026-11-19 (how a coding-agent consumer should understand the
protocol, and where the tool's duty toward it ends), settled into the shape
[0256](0256-independence-direction.md) stage 3 will enact. No code, template
or test lands here; the enactment slices carry their own tiers and homes,
one ingredient per change, per the stage's own letter.

Derives P2 (provisioning is the operator's bracket: the tool's whole duty
toward the coding-agent side is information provision — the catalog states
each work type's restrictions, and how a consumer provisions against,
enforces or ignores them is never the tool's machinery; when to rotate an
executor session is the same bracket, the tool's duty there ending at the
recovery mechanism), P5 (one source: the
catalog is derived from exactly the tables the landing fence reads — the
fence the settlement rendering, the catalog the dispatch rendering, never a
second hand-maintained list), P6 (rotation adds no state: holder identity is
token + channel, and the coordinator cannot distinguish one executor session
from five sequential ones presenting it — scheduled succession is recovery's
existing shape, not a new mechanism), P7 (the catalog states mechanical
grammars alone — permitted paths, standing prohibitions, authority
vocabularies — never content), P10 (the floor: a consumer that ignores the
catalog, or a server that has not yet shipped it, behaves byte-identically
to today; the prose prompts remain the no-machinery floor), P12 (no
enforcement claim is made, so there is no degradation to render dishonestly
— violations surface at the standing boundary checks, which fail loud),
P13 (the id set and the menu block are additive under `protocol: 1`, frozen
thereafter, never dual meanings), P15 (the catalog is data on the wire; the
enactment teaches it with pinned prompt sentences, and no code authors
copy), P16 (no host-dialect knowledge enters the daemon — claude's and
codex's permission vocabularies stay on their side of the seam; the
maintainer's own correction against the per-host render sketch, and against
reading the 0190/opencode carry as a precedent — that machinery dies with
the push path, 0256 stage 6), P17 (the two sub-agent shapes ride the
declared concurrency — one channel per worker, grants scoped), P19 (the
consumer is named from the field — the adoption site's
configure-before-launch preparation flow, its confinement already built
from the tool's published letters; rotation timing and its cost curve are
the operator's measured concern, never a tool-side premise; the
strength-by-probe idea was declined while derivation
was kept), P20 (rotation lands at safe boundaries; an orphaned child's
writes are kept and the successor's stop duty preserves the single writer;
a long-turn lease keeps the clock it was issued under, 0260), and P21 (the
declined slate — per-host config renders, pre-configured probe-tested type
registries, enforcement-class marking, delegated heartbeat, a target-side
tightening key — each without a locked consumer; the catalog itself has its
consumer in the wire's existing readers). Amends none — 0256 stage 3 names
"the ratchet's executor prompt gaining the daemon postures"; this ruling
specifies what those postures and the catalog are, and contradicts no
letter.

## Category scope

Tier: design — nothing lands; the enactment slices (the wire block, the
prompt postures, the ratchet) carry their own tiers at stage 3.

Premises this ruling changes: none. Re-read in this change: **0246 D4** (the
menu letter — `ready` is "the hub-as-scheduler's menu", pure, already
carrying kinds and touches; the catalog's `types` block extends that menu,
a dedicated route declined as surface without a consumer), **0246 D7** (the
executor prompt's letter — the catalog sentence and the postures extend its
teaching at enactment), **0248 D5 / 0259** (the fence letter — stands, and
is read forward as the catalog's derivation source), **0249** (recovery —
rotation inherits its successor-claim and stable-channel letters verbatim),
**0252** (the prompt pair and ratchet — the catalog sentence joins the
pinned set at enactment), **0218** (cited for its
faithful-translation-or-honest-decline pattern as family resemblance only;
its surface is the push path's claude carry, untouched here), **0260** (the
lease clock — the long-turn guidance cites it; stands).

## The ruling

### D1 — the interaction model, confirmed against the code

The dispatcher model the maintainer described is standing wire behavior,
verified at the coordinator, not new machinery: `menu.claimable` already
answers "what is the nature of the next work" mechanically (per unit the
claimable `kinds` and the `touches` declaration, `src/executor-coordinator.ts`),
and both sub-agent shapes are ruled (0246 D1's hub posture; `prompts/executor.md`
Hub): self-serving children claim, heartbeat and report on their own
channels, and hub-held grants pass the leased brief to a child while the hub
handles every request for it. Heartbeat renewal is holder-bound (`sameHolder`
gates it), so a hub cannot renew a lease granted on a child's channel —
children prone to long LLM turns ride the hub-held shape, or their own
heartbeats under 0260's configured budget, with the hard cap (issued +
2× window) bounding any single grant however often renewed: an arc beyond
it re-claims as a new attempt, workspace state preserved. Rotation is
holder identity, not session identity: a successor presenting the same
token + channel inherits the state through `menu.leases` and claim recovery
(0249's letters), so an executor session may end naturally with work live
under it and a scheduled successor takes over — the channel is the role's
identity across sessions, an operational teaching line, not a mechanism.
The all-in-one mode stands beside it: the solo executor launched by the
person's delegation (0250) or by the daemon (0256 W). Naming held: *driver*
stays the coordinator's word — the launcher is the daemon or the person.

### D2 — the catalog: duty, ids, entries, carrier, floor

**The duty is information provision, whole and entire.** The coordinator
exposes a machine-readable statement of each work type's restrictions; what
a consuming agent or operator does with it — building enforced sub-agent
templates, tightening a sandbox, or nothing — is theirs alone. **The
consumer, named from the field** (P19): the adoption site's preparation
flow — the cleanroom of [0257](0257-executor-preview-findings.md)'s
record, which configures everything before a migration project launches
(the baseline config and compliance set, the confinement launcher whose
writable allowlist predates the executor bridge), learns the tool from its
published letters, and prepares its cooperation accordingly. The `types`
block is input to that preparation: read at setup, folded into the site's
own allowlists and launchers. The site's sitting sessions already rotate
long work through continuation prompts — the holder-identity recovery of
D1 is the protocol's formalization of that operator rhythm, and when to
rotate stays the operator's judgment (P2). The site's "and maybe more" is
held as the open consumer note: further consumed surfaces join by their
own consumers, each its own change (P21). The type ids
are frozen additive (P13) and never exceed what the coordinator can grant:
today `execute`, `verify`, `fix` (the wire's grant kinds) and the person
channel's step kinds (`human`, `question`); the stage-2 convergence items
(0256: formulation steps, the transfer advance's session work, the
close-audit) are the named future ids, each joining only when its work
becomes claimable — the catalog never advertises an id it cannot grant.
Entries carry the type-level letter: the standing prohibitions (Git staging
and commit-type operations, `.auto/`, the index ticks and the todo.md →
done.md renames, configuration, AGENTS.md) and the per-kind permitted write
surfaces (verify: the task's report and gap list; execute/fix: the unit's
effective scope plus the per-kind artifact paths), the person entry its
authority vocabulary (answer within delegation, gate release) — the
machine-readable form of the boundary `prompts/executor.md` already teaches
in prose. Unit-level scope stays where it already rides (the menu's
`touches`, the grant's workspace); the catalog is type-level only.
**Derivation**: from exactly the tables the fence reads (0248 D5 as
restored by 0259) and the coordinator's own authority checks — one source,
two renderings, the fence at settlement and the catalog at dispatch (P5,
P7). **Carrier**: an additive `types` block on `ready`'s menu, under the
frozen `protocol: 1` (the unknown-kind teaching already standing: a client
that does not know the block asks its operator to update); a dedicated
route declined — one more surface with no consumer needing a standalone
fetch (P21). The exact field grammar is the enactment's to pin against
0246 D4's letter. **Floor**: absent from a server or ignored by a client =
today's behavior, byte-identical, proven by test (P10).

### D3 — the boundary of duty: the declined machinery, the standing authority

Declined, with reasons, the machinery this exploration considered and the
maintainer cut: per-host config renders (the daemon authoring claude
settings or codex profiles would make it fluent in hosts' permission
dialects and hostage to their drift — P16's letter, and P21: no consumer's
shape is locked), pre-configured probe-tested sub-agent type registries and
enforcement-class marking (the operator's bracket, P2 — and with no
enforcement claim made there is nothing to degrade dishonestly, P12), and a
target-side tightening key (no real target has asked; P21). The posture
that remains, stated once so the enactment teaches it: prevention inside a
foreign session is the operator's to build from the catalog, best-effort
and host-specific; the coordinator's boundary checks — the landing fence,
the booked-tree and SHA-baseline audits, settlement's per-root proofs — are
the only agent-independent authority, and settlement judges trees and
working state (0258), never session conduct: circumvention is detected and
blocked, never corrupts. The catalog makes no enforcement claim at all.

### D4 — the postures `prompts/executor.md` gains at enactment

The daemon postures (0256 stage 3) land as prompt sentences beside the
standing hub teaching: read the menu, spawn the typed child per kind;
hub-held grants for children whose turns outrun a heartbeat, self-serving
channels otherwise; rotation — a hub ending with live grants simply ends
(the lease rides to its deadline, the successor on the same token and
channel recovers through `menu.leases`), when to rotate being the
operator's judgment — the tool's duty ends at the recovery mechanism —
and the successor's first duty on
an inherited workspace is stopping any orphaned child it finds, the
single-writer rule (P20) — the abnormal-stop wording ("stop an interrupted
child before giving back its lease") stands for unplanned stops, the
planned-rotation rule beside it; and the catalog sentence: the `types`
block states requirements, provisioning them is the operator's affair, the
coordinator's boundary checks the authority either way.

### D5 — the ratchet at enactment

The enactment pins the three renderings together in one change, the 0203
both-sides pattern: the wire `types` block, the fence's permitted-set
tables, and the `executor.md` sentence — a change to the fence's grammar
cannot land without the catalog and the prompt line moving with it, and
the absent-block floor (byte-identical menu for a client that ignores it)
is pinned by test beside them.

## Residuals

- **Delegated heartbeat** (a hub renewing a lease granted on a child's
  channel): no consumer until a self-serving child both outruns a
  configured 0260 budget and cannot hold the hub-held shape; revisit then.
- **The id set's growth** tracks stage-2 convergence; each new id is its
  own enactment change with its fence-tables entry and ratchet pin.

## Companion changes and verification

The INDEX row is this ruling's only companion (0257's no-code shape); the
AGENTS.md executor navigation line gains the catalog pointer at enactment,
not before — no mechanism lands here. Form checks only: no code, template
or test touched; the working tree carries exactly the ruling and its INDEX
row.
