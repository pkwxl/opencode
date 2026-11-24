# 0302 — Diagnose a missing ledger row prefix on the first report

## Category scope

Tier: formulation synthesis and executor settlement. Premises this ruling
changes: 0097 and 0281. The ledger grammar, quote checks, seeded sequence
and construction commit still govern. Report 0299 exposed an ambiguity in
the prompt and a silent parse failure in replies.

## Decisions

The constructor prompt shows the literal dash and space inside its row
examples. In a submitted reply, the parser identifies the first line
missing that prefix and shows enough text to locate it. One such finding
suffices for repeated omissions. Reading a committed formulation todo
continues to allow the driver’s prose around its ledger rows.

The coordinator restores the booked todo before it validates the reply.
A validation refusal tells the producer that the submission was consumed
and names the file where the complete corrected reply must be written.
Reporting the original pair then retries the same construction.

Derives: P5 (one grammar for obligation and conflict rows), P8 (the
response identifies the line and the next write), P10 (historical todos
remain readable) and P19 (0299’s 111-row refusal and correction).
