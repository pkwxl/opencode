# Spec-compliance audit

Gate: verdict
Reasoning: deep
Phase-artifacts: audit.md verdict.md
Task-artifacts: findings.md

## plan duties

Plan one audit task per compliance dimension the due set reaches. The due
set is what this planning document's measured delta block and the assurance
table (docs/assurance.md) produce together: a table row is due when the
round's delta reaches its watched surface or its cadence says so, and each
due row's dimension gets its own audit task; a dimension no due row covers
keeps the standing mandate — audit it first-hand. The dimensions: coverage
of the MUST requirements, behavioral conformance, public interface
conformance, scope discipline (nothing the specification does not ask
for), spec hygiene (the spec notes carry observable behavior only —
implementation leakage such as private names, internal structures or
translated code from the reference implementation is a finding),
clean-room independence (no structural cloning of the reference
implementation), paradigm conformance (the deliverable reads in the
target platform's paradigm — reference-idiom fingerprints in the
deliverable are findings), and contract coverage (every implemented
behavior maps to a stated contract and its property, the property suite
the acceptance instrument; when a contract changed mid-implementation the
dimension reads the revision records and commit order — the SHA
citations first, commit order as corroboration).

A dimension the due set does not reach is carried, never skipped: the
closing task adjudicates it against its cited baseline — the table's
baseline cell — with the carry argument recorded (the round's delta
misses the row's watched surface, the cited adjudication stands), and
the consolidation names every dimension either way: audited this round,
or carried with its argument.

Each dimension task's deliverable is its own findings document
`docs/T-NNN/findings.md` — never `report.md`: that path is the
verification session's wrap-up report alone, one writer per file. The
findings document names the assurance row id of the dimension it
adjudicates (the id token, e.g. S-06, on its own word boundary) and
concludes with its result line — the driver's cover-set check reads
exactly that linkage: only a findings document that names the row id and
carries `Result: PASS` adjudicates it.

First-hand once per tree state: judge the tree you stand at, and let
receipt validity carry the rest — a check whose committed receipt stands
at this tree (its `Tree:` range covering the tree, its `Decides:` paths
naming the surfaces it decided) is cited, never re-executed, and a later
motion of the tree re-verifies exactly the surfaces it moved. The
standing suite runs once per tree state as the regression bound, and
determinism of changed sections is proven by running them twice.

The clean-room independence dimension, beside the divergence receipts,
reads the justification records: a justified similarity is accepted with
its record, an unjustified one is a finding — the score is never the
verdict. Its adjudication splits with the compliance monitor: the audit
judges whether a justification record is an adequate design argument;
the monitor — the person or their driver-side designate — confirms what
kind of similarity the flag actually names. The audit's half never
needs the corpus.

The closing task consolidates the findings documents into audit.md and the
verdict into verdict.md in this phase directory, naming every dimension
either way (audited, or carried with its argument), the verdict ending
with the result line
`Result: PASS` or `Result: FAIL <reason>` — a driver protocol string the
verdict gate parses, written verbatim: the verdict follows the findings,
never from optimism.

<!-- auto: eof -->
