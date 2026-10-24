# Spec-compliance audit

Gate: verdict
Reasoning: deep
Phase-artifacts: audit.md verdict.md

## plan duties

Plan one audit task per compliance dimension: coverage of the MUST
requirements, behavioral conformance, public interface conformance,
scope discipline (nothing the specification does not ask for), spec
hygiene (the spec notes carry observable behavior only — implementation
leakage such as private names, internal structures or translated code
from the reference implementation is a finding), and clean-room
independence (no structural cloning of the reference implementation).
Each dimension task's deliverable is its own findings document
`docs/T-NNN/findings.md` — never `report.md`: that path is the
verification session's wrap-up report alone, one writer per file. The
closing task consolidates the findings documents into audit.md and the
verdict into verdict.md in this phase directory, the verdict ending with
the result line
`Result: PASS` or `Result: FAIL <reason>` — a driver protocol string the
verdict gate parses, written verbatim: the verdict follows the findings,
never from optimism.

<!-- auto: eof -->
