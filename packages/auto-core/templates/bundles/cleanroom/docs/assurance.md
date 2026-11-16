# Assurance table

The project's standing assurance invariants, one row per invariant: the single
owner of what must hold. The DRIVER intersects each round's measured delta
with every row's watched surface; a row is due when the delta reaches its
surface or its cadence says so, and the round's verification owes exactly the
due rows — the audit duties and the test/acceptance duties of the intent pack
key their plans to this table, never to the standing surface.

The columns are the frozen grammar: kind `judgment` (a findings document
adjudicates) or `mechanical` (a green lane receipt covers); cadence `on-reach`
(the watched surface), `every-round`, `person-forced` or `periodic`; close
`blocks` (an uncovered row holds the round's close), `accrue` (an uncovered row
accrues, recorded at the close, paid by the next round that reaches it) or
`close-due` (an uncovered row gets the round's last adjudication before the
close may land). The baseline cell cites committed adjudications (a findings
document and its commit) — the carry basis; it stays empty until the first
adjudication lands one, and the driver's close-audit rewrites it on every
green adjudication.

This file is seeded by the cleanroom bundle from its eight standing audit
dimensions; the seed installs at init and never overwrites a table that
stands — the rows are the project's own data from the first edit on. An
existing project transcribes its last audit's conclusions into rows by hand
(the person's act): one row per standing invariant, the watched surfaces
pointed at the project's real deliverable root — the seed's `src` token is the
neutral placeholder for it — and the baselines citing the audit documents that
already adjudicated each row. A project with no table keeps today's behavior
exactly: nothing is due, nothing blocks.

| id | invariant | kind | watched surface | cadence | close | baseline |
| --- | --------- | ---- | --------------- | ------- | ----- | -------- |
| S-01 | MUST coverage (every behavior the specification and the brief's MUSTs name is carried into some contract, or explicitly deferred) | judgment | docs/capability-catalog.md, src | on-reach | accrue |  |
| S-02 | behavioral conformance to the specification | judgment | src | on-reach | accrue |  |
| S-03 | public interface conformance | judgment | src | on-reach | accrue |  |
| S-04 | scope discipline (nothing the specification does not ask for) | judgment | src | on-reach | accrue |  |
| S-05 | spec hygiene (the specification notes carry observable behavior only) | judgment | docs | on-reach | accrue |  |
| S-06 | clean-room independence (no structural cloning of the reference implementation) | judgment | crossing events, similarity flags | every-round | close-due |  |
| S-07 | paradigm conformance (the deliverable reads in the target platform's paradigm) | judgment | src | on-reach | accrue |  |
| S-08 | contract coverage (every implemented behavior maps to a stated contract and its property) | judgment | src, docs/capability-catalog.md | on-reach | accrue |  |

<!-- auto: eof -->
