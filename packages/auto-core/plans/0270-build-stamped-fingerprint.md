# 0270 — The build-stamped fingerprint on the wire

Status: **fix ruling, 2026-11-20.** [0264](0264-adoption-standdown-findings.md)
finding 04's remedy family enacted — the tool's build identity stamped at
compile and carried at the executor handshake — the [protocol completion
program](0267-protocol-completion-program.md) docket's fingerprint slice (the
fourth of the field findings' fixes to land, after 0265, 0266 and 0268). The
finding's measured shape: `packages/auto-server/src/version.ts`'s `VERSION =
"0.0.0"` was the binary's whole identity — no build commit anywhere — and the
stale-daemon skew behind squashfs T-004's first `commitFailed` misdiagnosis
was discovered by the operator reading the tool's git logs, not by any surface
the protocol owned; daemon-vs-repo skew is the adoption site's standing shape
(0162's resident-host letter). The one letter the finding left open — which
responses carry the identity (its own design residual naming 0261's ready-menu
protocol block the natural home) — is ruled below.

Derives P5 (the identity's one home: `packages/auto-server/src/version.ts` is
the only module the wire and the serve banner read — `VERSION`, the fallback
word, `BUILD_COMMIT`, and the `buildFingerprint()` assembly all live there;
the build script only stamps at compile, never a second author, and names no
fallback value of its own), P7 (the fingerprint a mechanical grammar, never
content: the version constant and a `rev-parse` sha assembled by a function —
nothing derived from the repository beyond the sha, nothing judged), P10 (the
floor: absent the stamp — a source run — every surface byte-identical beside
the honest fallback word; absent the field — a client that ignores `build` —
the pre-change envelope, pinned by the e2e's stripped-envelope check; every
non-`ready` response, `--version`, and the error envelope untouched), P12
(the honest dev fallback: running from source, the commit reads `dev` — the
value names itself as unstamped, never a fabricated commit; a tree git cannot
name at build gets no define and the same fallback rides — the uncertainty
resolves toward naming itself, never toward invention), P13 (additive under
the frozen `protocol: 1`: the literal untouched, the `ready` envelope grows
exactly one field, and the `executor.md` additive-fields letter keeps the
standing stop-and-ask teaching keyed on unknown protocols and step kinds,
never on the additive field), P18 (the identity readable without special
tooling: plain fields on a plain JSON envelope, the banner a plain stdout
line, the stamp a git sha — no tooling, no lock-in), and P19 (the finding's
measured chain the consumer: the misdiagnosis read only through git
archaeology, the skew invisible at every blocked step — this change's field
named from that consumer, the operator's skew check at the first handshake).
Amends none.

## Category scope

Tier: mechanism — code home and test home in this change (0110 D13): the
identity's home `packages/auto-server/src/version.ts`, the stamp
`packages/auto-server/script/build.ts`, the carrier
`packages/auto-server/src/executor-worker.ts`, the banner
`packages/auto-server/src/index.ts`; test homes
`packages/auto-server/test/version.test.ts` (new — the assembly, the stamp
computation, the define seam's both sides) and `packages/auto-server/test/
executor-e2e.test.ts` (the wire pins), the ratchet arm
`packages/auto-core/test/manual-prompts-ratchet.test.ts`; the teaching
`packages/auto-core/prompts/executor.md`; the operator-guide truth pass
`packages/auto-server/README.md`.

Premises this ruling changes: none. Re-read in this change: **0264** (the
finding — stands as measured; its remedy family worded "on executor
responses," narrowed here to the `ready` handshake with the reason below),
**0267** (the docket's 0270 row — "the carrier the ready menu's protocol
block" pinned as the `ready` envelope beside `protocol: 1`: the block the
program names is the protocol field's own place on the ready body, the menu
remaining 0269's dispatch payload), **0269** (the freshest ready-shape letter
— the envelope keys it pinned (`["menu","protocol"]`, by the e2e) grow
consciously to `["build","menu","protocol"]` in the same change, the e2e
moving with them; its sibling-top-level-field decline was the catalog's —
dispatch data needing no standalone fetch — never a ruling against envelope
fields, and the identity is not dispatch data), **0261** (the frozen
`protocol: 1` letter — untouched, the fingerprint additive beside it), and
**0248** (the response envelope — the fingerprint rides outside
kind/reason/detail, the step blocks and the error envelope untouched). All
stand.

## The ruling

### The stamp: defined at compile, never written into the tree

`script/build.ts` reads the tool tree's commit at compile — `git rev-parse
--short HEAD` spawned from the package directory (git resolving the repository
root itself), the stdout line shape-checked (`shortCommit`: a trimmed hex sha
of 7–40 characters, anything git might otherwise say refused to `undefined`)
— and Bun.build `define`s it over `AUTO_BUILD_COMMIT`, a constant
`src/version.ts` declares and reads. The mechanism was chosen against its
alternatives: a post-build byte substitution of a marker string would pin the
compiled artifact's byte layout (an unequal-length replacement unsafe in a
110 MB binary), and a generated source file or source edit would dirty the
working tree against P4's clean-tree law — the define leaves the tree
untouched, the stamp living only in the built artifact (`dist/` ignored, the
build's own exit line now naming the stamp). Typecheck stays green through
the seam's shape: `declare const` is erased by tsgo (the declaration is what
it checks), leaving a free identifier at bundle time for the define to
replace, and the source reads it only through a `typeof` guard — an
unstamped run (source, dev, a tree git cannot name) never throws. The
substitution is total: every occurrence of the declared constant is replaced
(measured below — both source occurrences, the guard and the true branch).

### The fingerprint: `{ version, commit }`, the field `build`

The assembly `buildFingerprint()` returns `{ version, commit }` — `version`
the `VERSION` constant (the release line, kept in step with the manifest by
`test/cli.test.ts`), `commit` `BUILD_COMMIT` (the stamped sha, or the
fallback). Two fields, not one fused string, because the skew the finding
measured is invisible at the version line alone: the stale daemon carried the
same `VERSION = "0.0.0"` as the rebuilt one — the commit is the comparable
half and must be independently readable (a fused string would force every
consumer to parse before comparing). The wire field's name is pinned
**`build`** — it names what the finding needs named (which build is
speaking), beside `server`/`fingerprint` declined as respectively ambiguous
(the host is more than this binary) and abstract (the field carries a build,
not a hash of one).

### The carrier: the ready envelope, once per handshake

The fingerprint rides additively on `ready` — the worker's response body
`{ protocol: 1, build, menu }`, beside the frozen `protocol` literal: the
handshake every session starts with, the one place identity needs carrying.
**Per-response repetition declined**: repeating the field on every step
response would add bytes to `heartbeat`/`claim`/`brief`/`question`/`answer`/
`release`/`report` with no consumer (the skew check happens once, at the
handshake), and the frozen-envelope letter (0248, P13) keeps every other
response byte-identical — no per-step re-render of the identity (P5/P7: one
assembly, one carrier). **Under-menu carriage declined**: 0269 ruled the menu
the single dispatch-time payload *for dispatch data* — the project's claimable
work and its restrictions; the tool's build identity is the handshake's own
data, not project state, and rides at the envelope beside `protocol`, exactly
where the docket's "protocol block" letter places it.

### The honest dev fallback

Running from source, nothing was stamped: `commit` reads **`dev`** — the one
home `UNSTAMPED_COMMIT` in `version.ts` (the build script names no fallback
value of its own, pinned), the value naming itself as unstamped, never a
fabricated commit (P12). A runtime git read was declined and stays declined:
from the daemon's working directory it would name whatever project repository
the operator launched against, not the tool's tree (P16's hazard at its
plainest), and a compiled binary embeds only imported files — the identity
must be stamped at compile, when the tool's own tree is the build's input.
The fallback is pinned on both surfaces: the e2e (running from source) reads
`ready.build` as `{ version: "0.0.0", commit: "dev" }`, and the banner shows
`(build dev)`.

### The banner, coherent from the same home

The serve banner's first line gains the stamped identity from the same
module's exports — `opencode-auto-server 0.0.0 (build <commit>) serving on …`
— so a stale daemon names itself at its own startup line, the finding's
operator diagnosis moving from git archaeology to the daemon's own output.
`--version` is unchanged (declined): it is the manifest-step surface
(`test/cli.test.ts`'s pin, the version-only act), and it reports whichever
binary the operator runs, not the daemon that is serving — the skew consumer
reads the daemon's banner or the handshake. No README or docs line quoted the
banner's version shape (checked); the README truth pass adds the `build`
field's letter to the executor preview section, where the wire payload is
documented.

### The teaching, minimal

`prompts/executor.md`'s protocol sentence — "Successful responses carry
`protocol: 1` and one payload, `step`, `menu`, or `question`" — became
incomplete the moment `ready` grew a second non-payload field, so it is
extended by two clauses: the `ready` response also carries `build`, the
server's version and build commit — read it to detect a stale daemon; and
unknown extra fields are additive, not an unknown protocol — the standing
stop-and-ask teaching keyed on unknown protocols and step kinds, never on
the additive field (the e2e already proves an unknown request field passes
through; the teaching now names the response-side mirror). The ratchet pins
the sentences in the same change: the manual side in
`test/manual-prompts-ratchet.test.ts` (the coupling arm's pattern), the wire
side in the e2e and `test/version.test.ts` — the ruled relationship's sides
live in two packages, each held by its own suite.

### The floor (P10)

A client that ignores `build` reads the pre-change envelope — pinned by the
e2e's stripped-envelope check (`{ build, ...before }` leaving exactly
`["menu","protocol"]`); every other response body is byte-identical; the
error envelope, `--version`, and the whole non-executor surface untouched.

### Declined here

Per-response carriage and under-menu carriage (above); a runtime git read
(above); a dirty-tree suffix on the stamp (the sha names the commit the
person built — the release flow's own clean-tree law is the floor, and a
dirty build is that law's violation surfacing at the person, not a wire
grammar); `--version` growth (above); a dedicated identity route (0261's
dedicated-fetch decline at the field scale — the handshake carries it, no
consumer needs a fetch).

## Residuals

- **Dev-tree vs dev-tree skew is unmeasurable**: two different source trees
  both report `commit: "dev"` — inherent to the honest floor (an unstamped
  build has no identity to carry, and fabricating one is the ruled-out
  wrong). The adoption site's resident daemons run built artifacts; the
  measured case is covered from this change's first release.
- The define seam's end-to-end proof rides the manual build check below, not
  the suite — a full `Bun.build` compile in a test would build a ~110 MB
  artifact per run; the suite holds the computation, the assembly, and the
  seam's both-side names, the ruling's verification paragraph the built
  artifact itself.

## Companion changes and verification

The INDEX row; the AGENTS.md executor-leases navigation line's fingerprint
pointer; the README truth pass. Test evidence: `packages/auto-server/test/
version.test.ts` (3 tests — the assembly with the fallback and stamped
shapes, the stamp computation's shape-checks and the define map over
injection, the define seam's both-side names with the fallback word's one
home), the e2e's ready block (the field with the dev fallback, the outer
keys `["build","menu","protocol"]`, the stripped-envelope floor), the
ratchet's new arm (the executor prompt's fingerprint letter); the standing
suites green — auto-server 206 pass beside the container's pre-existing
IPv6-bind failure (failing on the committed tree identically, 0265's
record), typecheck exit 0; auto-core 3473 across 171 files (the ratchet's
one new test), typecheck exit 0. **The manual build check** (run at this
change, its output): `bun ./script/build.ts` → `Standalone executable
generated: dist/opencode-auto-server (build b7452853a)` (the tree's HEAD);
the artifact run once (`serve --port 0`) → first line
`opencode-auto-server 0.0.0 (build b7452853a) serving on http://127.0.0.1:37597 (data dir: …)`;
the sha occurring exactly twice in the binary's bytes — the define's total
substitution of the declared constant's two source occurrences; `git status`
clean after (the stamp never touching the tree).
