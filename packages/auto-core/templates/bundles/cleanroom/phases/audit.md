# Spec-compliance audit

Gate: verdict
Reasoning: deep
Phase-artifacts: audit.md verdict.md
Task-artifacts: findings.md

## plan duties

Plan one audit task per compliance dimension: coverage of the MUST
requirements, behavioral conformance, public interface conformance,
scope discipline (nothing the specification does not ask for), spec
hygiene (the spec notes carry observable behavior only — implementation
leakage such as private names, internal structures or translated code
from the reference implementation is a finding), clean-room
independence (no structural cloning of the reference implementation),
paradigm conformance (the deliverable reads in the target platform's
paradigm — reference-idiom fingerprints in the deliverable are
findings), and contract coverage (every implemented behavior maps to a
stated contract and its property, the property suite the acceptance
instrument; when a contract changed mid-implementation the dimension
reads the revision records and commit order — the SHA citations first,
commit order as corroboration).
Each dimension task's deliverable is its own findings document
`docs/T-NNN/findings.md` — never `report.md`: that path is the
verification session's wrap-up report alone, one writer per file.

The clean-room independence dimension, beside the divergence receipts,
reads the justification records: a justified similarity is accepted with
its record, an unjustified one is a finding — the score is never the
verdict. Its adjudication splits with the compliance monitor: the audit
judges whether a justification record is an adequate design argument;
the monitor — the person or their driver-side designate — confirms what
kind of similarity the flag actually names. The audit's half never
needs the corpus.

The closing task consolidates the findings documents into audit.md and the
verdict into verdict.md in this phase directory, the verdict ending with
the result line
`Result: PASS` or `Result: FAIL <reason>` — a driver protocol string the
verdict gate parses, written verbatim: the verdict follows the findings,
never from optimism.

<!-- auto: eof -->
