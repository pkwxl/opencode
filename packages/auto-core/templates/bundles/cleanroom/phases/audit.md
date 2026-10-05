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
Findings go to audit.md. The closing task consolidates the findings into
verdict.md in this phase directory, ending with the result line
`Result: PASS` or `Result: FAIL <reason>` — a driver protocol string the
verdict gate parses, written verbatim: the verdict follows the findings,
never from optimism.

<!-- auto: eof -->
