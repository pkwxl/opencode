# 0299 — the synthesize ledger's row dash: ambiguous in the letter, silent in the parser, and the refusal's remedy misnames the channel's state

> Findings only, nothing enacted. Filed by the estate (the recorded
> adoption site) at its fifth dispatch sitting, 2026-11-22, under the
> standing instrument (plans/0255's field-record duty; the 0290/0295/0297
> shape — a record, its remedy families, and the site cost measured; the
> tool's own rulings stay the tool session's). Takes 0299 past the tool
> session's own 0298 (the verify grammar stated) per the 0294→0295
> precedent.

## The finding

Three defects stacked on one share class, each small, together costing
the site two refused settlements, two consumed reply writes, and one
launcher-side misdiagnosis before a code read found the truth.

**The field cost, measured (igb T-029 synthesize 1, 2026-11-22):** a
synthesize child composed a full constructor reply (sources-brief over
five sources, a 111-row ledger — O-01…O-108 plus C-01…C-03 — the
Rationale line), verified every quote anchoring, and wrote it at the
prescribed todo path ahead of the terminator. The report refused:

```
blocked/commitFailed — "the synthesis reply is invalid: the ledger
carries no row of the session's own — every obligation the sources
name needs one — rewrite the reply at docs/T-029/todo.md in the exact
prescribed shape, fixing exactly these findings"
```

### 1 — the letter's dash is ambiguous, and the parser's truth is strict

`templates/prompts/formulate-synthesize.md` teaches the row grammar as
markdown bullets whose leading `- ` is simultaneously the bullet marker
and a literal the parser requires:

```
Row grammar, exactly (the pipes and quotes are DRIVER-parsed):

- O-<nn> | <source name, exactly as headed above> | "<verbatim quote from that source>" | <what the plan must cover>
- C-<nn> | <source A> vs <source B> | "<quote from A>" / "<quote from B>" | <the authority order's verdict; what the plan must record>
```

A careful reader reads the dash as bullet punctuation — the site's
child did, the site's launcher did on first read — and writes
`O-01 | …`. But `parseLedger` (formulate-synthesis.ts) requires it:

```js
if (!line || line.startsWith("#") || !line.startsWith("- ")) return
```

### 2 — the parser skips dash-less rows silently, so the refusal names nothing

That same guard RETURNS without pushing a problem for any non-empty
line that fails the `- ` prefix. A ledger of 111 dash-less rows parses
as zero rows with zero problems; `checkSynthesisReply` then surfaces
only the generic `!own.length` message — "no row of the session's own"
— naming neither the dash nor any offending line, against the
formulate collect's own refusal-naming standard (each offending line
named) and 0297's identical diagnosability finding for the verify
kind. The unparseable-line arm EXISTS in the function (the
`does not parse` problem, whose own message shows the dashed form) —
the prefix guard just answers before it can.

### 3 — the remedy letter misnames the channel's state

The settlement's landing restores the todo to its booked floor BEFORE
validating the captured reply ("the session's write is the channel,
never the document" — executor-coordinator.ts, the synthesize
settlement). On refusal the reply is therefore already gone, yet the
remedy says "rewrite the reply at docs/T-029/todo.md … fixing exactly
these findings" — which reads as repair-in-place of a standing text.
The site's launcher, finding the file without the reply after the
first refusal, misdiagnosed a "lost write" and had the child rewrite
the same dash-less content (verified on disk a second time), earning
the same refusal. The reply channel being consumed by design is
lawful; the remedy's letter should say the reply is consumed and the
holder composes anew (or the refusal should fire before the restore,
naming what it consumed).

## The recovery, measured

The launcher read the settlement's code (the parser's prefix guard),
then resumed the producing child — it still held the composed reply in
context — with the one-word correction: every row line begins
`- `. The rewrite (prefixes added outside all quote fields, content
byte-identical) settled clean at `47e7393` (the phase-synthesize
commit), the third report attempt of the share.

## Remedy families (the tool's to rule)

- The template's grammar letter states the dash as part of the
  grammar — the rows rendered as code spans (`- O-<nn> | …`), or the
  bullet removed and the dash named in prose.
- `parseLedger`'s prefix guard either accepts dash-less rows (the
  `- ` optional before `[OC]-`) or raises the existing
  `does not parse` problem for a non-empty non-conforming line — a
  ledger that parsed to zero rows over a non-empty body is itself the
  finding to name.
- The refusal's remedy names the channel's true state: the reply is
  consumed at every settlement attempt; the holder composes anew (or
  the restore moves after the validation, keeping the refused reply
  readable for repair).

## Derives

P5 (one derivation, the parser's own guard), P8 (every surfaced line
teaching its remedy), P10 (the dash's dual reading pinned absent),
P19 (the field record the instrument's own duty).
