## Goal

Adjudicate round {{round}}'s close-due assurance rows. The assurance table ({{assuranceDoc}}) holds judgment rows whose watched surfaces this round reached — they are due an adjudication at the closing tree, and this round carries no audit phase to produce one. This task is that adjudication: one delta-scoped session judging exactly the rows named below at the tree as it closes, never the standing audit shell.

## Scope

This document is the single input of this close-audit task: the DRIVER assembled it from the round's measured state when it created the task, and nothing else is injected into your session.

### The close-due rows ({{assuranceDoc}})

Each row below is due at this close and uncovered — no adjudication receipt names it yet. Judge each on its own terms: read its invariant, its watched surface and its cited baseline, examine what the round's measured delta changed on that surface, and decide whether the invariant holds at the closing tree.

{{dueRows}}
{{#if delta}}
### The round's measured delta

The driver measured this round's change below from git — what the round changed since it opened. Key your adjudication to this change: the cited baseline stands for everything it misses, your judgment is owed for everything it reaches.

{{delta}}
{{/if}}
### The deliverable and its verdict

Write your adjudication into {{findingsDoc}}: one section per due row above, the row's id in the section's heading, what you examined and the evidence you weighed (named commits, paths, documents), and each section's conclusion. End the document with the result line as its last line of body text:

`Result: PASS` — every due row's invariant holds at the closing tree, or
`Result: FAIL <one-sentence reason>` — naming the first row that does not hold.

The line is a driver protocol string, written verbatim: the driver reads it as this adjudication's receipt, and only a PASS covers its rows. An adjudication never repairs in-round: modify nothing outside your own task directory — a FAIL is a finding for the person, routed to them at the round's close, and the remedy it names is theirs to order, never yours to enact.

## Acceptance

- {{findingsDoc}} exists and carries one section per due row above, each section's heading naming its row id, and the document ends with the `Result: PASS` or `Result: FAIL <one-sentence reason>` line as its last line of body text;
- the adjudication is your own reading of the closing tree: every conclusion cites what it examined (commits, paths, documents), never a restatement of the baseline's or the table's own words alone;
- nothing outside your task directory is modified — an adjudication judges and documents, it never repairs in-round.

<!-- auto: eof -->
