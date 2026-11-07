# 0214 — the provenance direction's honest unknown, and sync's convergence of its own interrupted write

Status: active (ruled by 0166 step 054, 2026-11-08). Three findings of the
0165 register out of the S22 config/materialization review: **0165-043**
(S22-01, S2 — a body-only provenance difference is labelled binary-newer
whichever binary is older), **0165-154** (S22-02, S3 — a crash mid-applySync
misattributes the tool's own write as person-edited forever) and **0165-158**
(S22-08, S3 — the provenance direction tests pin only heading-delta cases,
the oracle gap behind the first finding). One family: the provenance
grammar's direction story and the sync command's crash window — the two
halves of 0100's stamp design the register measured against its own
second-checkout rationale.

The boundary answers first (the requirement-intake rule): the family is
*the bundle-provenance comparison grammar and the sync plan's edited
branch*. Home-set: `src/provenance.ts` (the direction derivation and the
three message surfaces), `src/sync.ts` (the plan's edited branch, the
entry vocabulary, the format caveat), the test homes
`test/provenance.test.ts` and `test/sync.test.ts`, and the documentation
homes (plans/INDEX.md, AGENTS.md's navigation, docs/structure.md). Every
detection site (preflight, fix, status, driver-helper) and both shells
consume the comparison and the formatters through `provenanceComparison`
and `formatSyncPlan` — no site-specific wording exists anywhere, verified
by grep; the fix lands once in the pure half and flows to every surface.
0165 is the evidence, not the authorization: every decision below is
ruled here.

## Derivation and Category scope

Derives: P12 (the detection layer must not state a fact it does not know —
the body-only case's direction is unknowable from the evidence the design
collects, and P12's "nothing is guessed silently" is exactly the
assertion being removed), P13 (the direction labels are protocol strings
read by tests and rendered to the person; the ambiguous case enters the
vocabulary by conscious additive lockstep in this one change — comparator,
consumers, entry union, pins together), P6 (an interrupted apply must be
convergeable by re-derivation from disk, not forever misclassified by the
stale stamp; the recovery reads the durable evidence — disk bytes vs the
binary's bytes — and heals without a new persisted state), P8 (both fixes
keep detection non-gating; the honest wording teaches the remedy that
fits, the caveat surfacing the downgrade risk at the person's confirm),
P18 (the person's record keeps explaining itself: "the running bundle
differs in body only — either side may be newer" is a readable truth, the
re-stamp line names what converged and why), P10 (every untouched shape
byte-identical: the three named directions' labels, findings, notice and
plan lines unchanged; the unstamped bootstrap and `--from-bundle` paths
untouched), P5 (one comparator, one message home per surface — the
ambiguous case is derived where the direction is derived, never
re-derived per consumer from `added`/`removed` emptiness), P7 (the
comparator judges only the grammars it defines — sha equality and heading
lines; it judges no content, which is precisely why it cannot name a
direction over a body-only change).

premises this ruling changes: **0100 D2** — its letter "the comparison is
pure and three-state, both directions named" carried the premise that the
headings delta always names the direction. Measured false for the
sha-differing, heading-identical file: the delta names the direction when
non-empty (both directions still named there), and its emptiness over a
sha difference names the direction UNKNOWN — a fourth, additive value,
not a guess. The 0100 INDEX row is annotated in this change. 0158's
notice-aggregate rule ("the aggregate clause's advice must match the
divergence it names") is not invalidated — it is extended to the new
case by its own terms (the finding record says so); its row stands
unannotated.

Tier: mechanism (the provenance grammar's vocabulary and the sync plan's
entry set — both additive; no constitutional principle moved).

### Category scope

- Derives: P12, P13, P6, P8, P18, P10, P5, P7 — with the showing clauses
  above; the enactments below are where each shows.
- Code homes: `src/provenance.ts`, `src/sync.ts`. Test homes:
  `test/provenance.test.ts`, `test/sync.test.ts`. Documentation homes:
  this document, plans/INDEX.md (the 0214 row + the 0100 annotation),
  AGENTS.md (the provenance navigation line), docs/structure.md (the
  Bundle provenance and Bundle sync rows). No shell source touched: the
  shells print `formatSyncPlan`'s output and the core formatters
  verbatim (verified — no wording pin exists in packages/auto or
  auto-server).

## D1 — the direction's honest unknown: a body-only difference carries the direction it cannot name (0165-043, 0165-158)

The defect (the finding's scene, 0100's own second-checkout rationale): a
project materialized by binary v2 whose pack body was reworded under
unchanged headings, opened by binary v1. disk = stamp (nobody edited
anything), the binary's bytes differ, `added = removed = []` — and the
ternary `removed.length === 0 ? "binary-newer"` labels v1 newer. Every
surface then asserts the unknown as fact: fix/status print "the running
bundle is newer", the preflight notice's aggregate says "can fast-forward
to the running binary's bundle (sync)", and `formatSyncPlan` prints its
downgrade caveat only for `binary-older` — so the person confirms a sync
that writes the older bytes over the newer committed pack, undetected
until the v2 binary runs again. The S22 review's own diagnosis names the
class: "the one place the detection layer states a fact it does not know,
and the person-facing advice compounds it into a downgrade."

The ruling: the evidence the grammar collects (sha equality, heading
lines) CANNOT name a direction over a body-only difference — a body
rewording may have landed in the binary before or after the bundle the
project materialized from; both scenes produce byte-identical evidence.
P7 is the ground: the comparator judges only its grammars, and its
grammar has no order information between binary versions. P12 forbids the
silent guess. So the direction vocabulary grows additively (P13, one
conscious lockstep in this change): a stale file whose headings delta is
empty while the sha differs carries **`direction: "body-only"`** — the
label names the evidence's shape (the difference lives in body prose
alone), not a direction, because that is the honest content. The three
named directions keep their exact definitions: binary-newer (adds, drops
nothing), binary-older (drops, adds nothing — including the not-shipped
case), diverged (both); a non-empty delta can never be body-only by
construction, so no existing reading changes.

Every message surface derives its body-only arm from the one value (P5 —
never re-derived per consumer):

- `provenanceFindings` (fix's manual findings, status's rows): "stale —
  the running bundle differs in body only (either binary may be newer);
  run sync to fast-forward the unedited files". The trailing advice stays
  the family's shared clause — the binary-older finding prints it today
  too, and the sync plan's caveat is where the downgrade risk is taught
  (P8: the line teaches the remedy, the caveat guards the act).
- `provenanceNoticeLine` (preflight): the per-file part says "the running
  bundle differs in body only — either side may be newer"; the aggregate
  grows its fourth arm — when any stale file is body-only, "differ from
  the running binary's bundle (a body-only difference cannot name the
  newer side — sync names each; upgrade the tool if your binary is not
  the newer one)" — after `predates` and `retired` in precedence (a
  known-older binary and a retired file each teach the stronger, more
  specific truth; the parts list names every file regardless). The
  unqualified "can fast-forward" aggregate is now reachable only when
  every stale file carries a non-empty, non-removed delta — 0158's rule
  extended to the new case by its own terms.
- `formatSyncPlan` (the sync plan the person confirms over): the
  fast-forward line's caveat grows its second arm — a body-only entry
  prints " (a body-only difference — either the running binary or your
  materialized pack may be newer; this writes the binary's bytes;
  upgrade the tool if that is not intended)". The binary-older caveat's
  wording is untouched.

Floors (P10): the three named directions' labels, findings, notices and
plan lines are byte-identical; the unstamped bootstrap (`adopt`/`differ`)
and `--from-bundle`'s self-declared `binary-newer` (the person's own
pristine-but-old assertion, 0100 D5) are untouched; current and
person-edited files never reach the direction at all.

The oracle gap (0165-158) closes with the fix, not beside it: the
direction tests pinned only heading-delta cases, which is how the silent
guess shipped unreviewed. The new pins construct BOTH time-directions of
the ambiguous scene (materialize a body-reworded bundle, compare against
the current binary — the binary-newer reality; materialize the current
bundle, compare against a body-reworded binary — the binary-older
reality) and assert the one honest answer at every surface: the
comparator's value, the finding's wording, the notice's aggregate (never
"can fast-forward", never "is newer"), and the sync plan's caveat. Both
scenes yield the same classification — that is the point being pinned.

## D2 — sync's edited branch converges its own interrupted write: disk at the binary's bytes re-stamps, never a false person-edit (0165-154)

The defect: `applySync` writes the managed files first and the sidecar
rewrite last. A kill between them (and the same window in
materialization itself — `materializeIntentBundle` writes the same
pair in the same order) leaves disk = the binary's bytes while the stamp
still records the old digests. Every later comparison takes the only
remaining branch: person-edited — and sync's edited branch stands on the
old stamp entry forever ("the stamp entry stands so detection keeps its
visibility"), so a file the person never touched is reported "edited
after materialization" with each run, with no convergence path short of
hand-editing the sidecar or re-init. P6's "every step idempotent, every
recovery re-derives from disk" held for the happy path only; the review
measured the kill point.

The ruling: in `planSync`'s edited branch, a file that IS on disk and
whose bytes equal the binary's bytes is the converged shape — either the
tool's interrupted write (files written, stamp not) or a person's own
hand-copy of the bundle's exact bytes. The two are indistinguishable and
converged by content: the managed file holds exactly what the running
bundle ships, which is what "current" means for an unedited file. The
branch therefore emits a new additive entry action **`re-stamp`**: the
stamp's entry moves to the binary's digests (`see(path, binary[path])`),
the FILE ITSELF IS NEVER WRITTEN (the person-edited guarantee's whole
purpose is never writing the file; here the write would be a no-op
beside), the sidecar rewrite rides through 0158's byte-honest gate (the
rendered next stamp differs from the sidecar on disk, so `stampText` is
set and `syncWritesAnything` counts it — the shell's confirm asks before
the sidecar moves, the dryrun names it), and the plan's line teaches
what converged and why: "already byte-identical to the running bundle —
re-stamped (an interrupted materialization/sync write; the file was not
written)". After the apply, the next comparison reads current everywhere
— the false person-edit dies at the next sync, not at the next re-init.

Why sync and not the comparator: the classification "person-edited" is
HONEST at detection time — the stamp accurately says "the tool last
wrote X, the file now holds Y"; P3/P2's person-owned posture must keep
naming any divergence from the tool's last-written bytes, and
`compareProvenance` classifying disk=binary≠stamp as current would make
the stamp a lie (a file differing from its recorded bytes reported as
matching them). The defect is not the detection but the missing
convergence: the person's one propagation command must heal its own
interrupted act by re-derivation from disk (P6), not stand on the stale
entry. Detection surfaces (fix/status/preflight) keep reporting the file
until the person runs sync — the same posture every other stale shape
has; the remedy is the command, not a silent reclassification.

Floors (P10): a person-edited file whose bytes differ from the binary's
keeps today's edited branch byte-identically (entry, standing stamp
entry, wording); the deleted-file shape (`onDisk: false`) can never equal
the binary's bytes and keeps its branch; the stamp-entry-stands policy
itself (the person's real edits never re-stamped) is unchanged — the
re-stamp fires only on exact content equality with the running bundle.

Named residuals: a person who WANTS their byte-identical hand-copy to
stay flagged as an edit has no channel to say so (no observable
difference exists between their copy and the tool's write — the state
after convergence is the content truth); the re-stamp's convergence is
keyed to the RUNNING binary's bytes (an interrupted sync from an older
binary, interrupted before its sidecar rewrite and then re-planned under
a NEWER binary, converges to the newer binary's fast-forward instead —
the plan's write list already carries that file, so the scene degrades
to an ordinary fast-forward, conservative); fix/status report the
interrupted write as a person-edit UNTIL the person runs sync (detection
stays honest, the convergence is the command's — the same residual
shape every stale pack has).

## D3 — enactment and proof (both findings, one lockstep)

Code homes in one change: `src/provenance.ts` (the direction value, the
comment block over the three-state grammar, the findings arm, the notice
per-file arm and aggregate arm) and `src/sync.ts` (the `re-stamp` entry,
the widened `fast-forward` direction union, the format caveat's second
arm, the header comment's stamped-project description). Test homes:
`test/provenance.test.ts` (both time-directions of the body-only case at
the comparator, the finding's wording, the notice's aggregate and
per-file wording) and `test/sync.test.ts` (the interrupted-applySync
scene — plan.writes applied, stampText withheld — converged by re-stamp
with the file never written; the body-only fast-forward's caveat line).
Every pin is RED on pre-fix source (the direction reads binary-newer,
the wording asserts it, the caveat is absent, the interrupted write
reports edited-forever) and GREEN after; the touched files' pre-existing
pins stay green on pre-fix source (the floors). Documentation lockstep:
the 0214 INDEX row, the 0100 annotation, the AGENTS.md provenance
navigation line, the structure.md rows for both modules.
