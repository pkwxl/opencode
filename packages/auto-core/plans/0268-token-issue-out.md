# 0268 — Token issue's clean credential delivery

Ruling of 2026-11-20: [0264](0264-adoption-standdown-findings.md)
finding 06's remedy family enacted — the token CLI's stdout mixing, the
plain defect (the credential between the ✓ status line and the shown-once
note, `packages/auto-server/src/index.ts:358-363` at the finding's read;
the first mint's wrong-line grab the measured incident). The docket's
first slice of the [protocol completion program](0267-protocol-completion-program.md).

Derives P7 (the file's bytes a pinned grammar, exactly the credential and
the newline that terminates it — no wrapper, no metadata; the consumers
are Bearer headers and scripts, and a wrapper would make every one of
them parse), P8 (every refusal teaching its remedy: the missing parent
naming the directory and the operator's own mkdir, the existing target
naming the move-aside, the undelivered mint naming its revoke), P10 (the
floor: absent `--out` the three stdout lines byte-identical — the ruled
defect's fix the exemption, never a reshaping of the shown-once surface),
P12 (fail loud: an unopenable path exits 1 naming the file, the
credential never printed as a fallback — the exact inversion of the
defect would be the remedy failing open — and a partial file removed
rather than left as a silent maybe-credential), P13 (additive vocabulary:
one new flag on one subcommand, the usage surfaces growing their letter,
no protocol literal, exit code or wire act changed), P18 (the credential
a plain durable file — mode 0600, `cat`-able, script-consumable, no
special tooling, the store still keeping only the digest), and P19 (the
finding's measured chain the consumer: the wrong-line grab recovered only
by revocation, the credential named the one line of the three a script
cannot re-derive). The **security family's display discipline** shows as
the finding's own measures field: under `--out` the credential transits
no stdout at all — transcripts, logs and captured pipes never hold it.
Amends none. Tier: mechanism.

## Category scope

Tier: mechanism (code home `packages/auto-server/src/index.ts` — the
flag, the `issueTokenToFile` delivery, the usage block and token prose;
test home `packages/auto-server/test/daemon.test.ts`, the token describe;
the operator-guide truth pass `packages/auto-server/README.md` +
`packages/auto-server/docs/daemon.md`).

Premises this ruling changes: none. Re-read in this change: **0067**
(stands — the store's letter untouched: the digest-only store, the 0600
`tokens.json`, the shown-once print; `--out` adds a second delivery
route for the same one-time plaintext, the mint itself unchanged).

## The ruling

**The flag — `token issue --out <path>`.** Present, the credential is
written direct to the file and printed nowhere; the ✓ status line and
the shown-once note stay on stdout **unchanged** (the 0264 remedy
family's own letter — the shown-once text untouched). The path resolves
against the command's working directory, the `--launch`/`--env-file`
truth of 0223 D3 and 0265 (one resolution for the source and compiled
layouts).

**The payload.** Exactly the bytes the shown-once line puts on stdout:
the credential and its terminating newline, nothing else. The floor's
middle line and the file are the same bytes — `cat <file>` behaves like
today's print, `$(cat <file)` strips the newline the shell always strips.
PEM-style wrappers, scope annotations and creation metadata declined:
each would make every consumer parse before use, and the store (name,
scopes, created) already holds the metadata authoritatively.

**The write.** A direct `open` with create-exclusive and mode 0600 —
ruled over 0215's write-tmp-then-rename, with the reason: 0215's
discipline protects a **live surface** from half-written reads and
readers from partial bytes; this file is a fresh credential whose only
consumer is the operator who just asked for it, the exclusive create is
itself the atomicity that matters (the file either exists whole-and-mine
or not at all), and a tmp file riding the target's directory would add a
second name to clean up for no reader. The mode rides the creation (the
only moment a mode is honestly chosen for a credential); chmod on an
existing file declined together with the overwrite arm itself — an
existing target is refused, so no pre-existing mode ever holds a
credential and no clobbered bytes ever pass through this flag.

**The pre-flight, before the mint.** Taught first so no undeliverable
credential is ever minted: the parent directory must exist (a missing
parent refused naming it — `token issue` never creates directories,
mkdir is the operator's own act, outside this flag's letter), must be a
directory and be writable (each refusal naming the location), and the
target must not exist (refused naming the move-aside or the fresh path).
The exclusive write after the mint remains the proof — the pre-flight
teaches, the open decides; a race between them lands in the failure arm
below. A mint refusal under a valid `--out` (unknown scope, duplicate
name) creates no file: the open follows the mint, never precedes it.

**The failure arm.** A write that fails after a successful mint never
prints the credential and never leaves a partial file: a file the write
may have created is removed (an `EEXIST` excluded — that entry is not
this command's to delete), and the refusal names the path, the system
error, and the token's revoke — the store holds a digest of a credential
delivered nowhere, dead weight `token list` shows and one revoke cleans.
An automatic rollback of the mint declined: a second store write inside
an error path, its own failure unhandleable cleanly (the residual below).

**The floor.** Absent `--out`, byte-identical: the same parse (the
unknown-argument teaching alone grows the flag's name, the usage block
its letter), the same mint, the same three stdout lines in the same
order — pinned by test against the exact bytes.

## Residuals

- A write failing between mint and delivery leaves the minted token in
  the store (digest only, plaintext nowhere on earth) until the
  operator's revoke — the refusal teaches it. The window is the race or
  the disk error the pre-flight could not see; measured shape: none (the
  finding is about the delivery route, not disk failures).

## Companion changes and verification

The INDEX row; the README quick-start line and auth section, daemon.md's
token block and `--out` paragraph (the truth pass, 0265's pattern);
`packages/auto-server/test/daemon.test.ts` — two tests in the token
describe: the delivery (stdout exactly the two status lines, the file
exactly `oas_…\n`, mode 0600, the store verifying the file's own bytes,
and the floor's three lines in order) and the refusals (missing parent
naming the directory with nothing minted, file-as-parent and a 0500
directory both named, the existing target never clobbered, the mint
refusal leaving no empty file, the valueless flag's usage teaching) —
the standing suites green beside the container's pre-existing IPv6-bind
failure (failing on the committed tree identically, 0265's record);
`bun typecheck` exit 0.
