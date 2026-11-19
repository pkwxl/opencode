# 0265 — The daemon's environment pinned

Discharges [0264](0264-adoption-standdown-findings.md) finding 01 (the
daemon's environment, the load-bearing carrier nothing pins). Derives P12
(the carrier's losses surfaced at boot, each line teaching its remedy —
fail loud at the one moment the whole carrier is inspectable, never one
blocked run at a time), P8 (warnings, not gates: the daemon still starts;
a missing key degrades per-run through the core's own failure marks, a
boot that refuses to serve would be the cure killing the patient), P5 (one
registry grammar — the reference check is the core's own
`checkModelReferences` over `loadModels`, the same wording a worker's run
surfaces; no second registry reader enters the shell), P16 (the check's
boundary is the tool's own references — the registry's env/file keys; the
site's seat names and PATH entries ride the site's declared surfaces,
discovered through their own contracts, never named here), P18 (the
manifest a plain JSON file in the daemon's data directory, presence only),
P10 (the floor: absent `--env-file` not one spawn differs — the manifest
and the warnings additive beside it, the ruled defect's fix the exemption
a floor never masks), P13 (no wire act: no route, no request field, no
response vocabulary — the report rides the daemon handle, an internal
surface), and P19 (the finding's measured evidence the consumer: three
restarts, each surfacing a new lost carrier, the second one costing a
person-bracketed advance). Amends none. Tier: mechanism.

## Category scope

Tier: mechanism (code homes `packages/auto-server/src/env-boot.ts` (new) +
`packages/auto-server/src/daemon.ts` (the report at `startDaemon`, the
handle's `bootWarnings`) + `packages/auto-server/src/index.ts` (the flag,
the load, the banner print, the usage); test home
`packages/auto-server/test/env-boot.test.ts`; the operator-guide truth
pass `packages/auto-server/README.md` + `packages/auto-server/docs/daemon.md`).

Premises this ruling changes: none. Re-read in this change: **0162 D4**
(stands — the launcher's ownership and invocation unchanged; the carrier
it reads is now pinned beside it, the launcher letter gaining its durable
form), **0067** (stands — the daemon's shape untouched: no route, no
request surface; the report computed once at the daemon's own start, the
one home every host — CLI or embedding — passes through), the **security
family** (stands, and now pinned from a new side: the manifest carries
names only; the parse refusal names a line number, never the line's bytes
— a value may be a secret; the registry check reads no value by its own
C4 note — three new surfaces, all conforming to the display rule).

## The ruling

**The declaration — `serve --env-file <path>`.** `NAME=VALUE` lines (`#`
comments, blank lines, a later duplicate wins; values literal bytes — no
quoting, no interpolation, the file is declarations not a script;
whitespace around the `=` trimmed; a name may not be empty or carry
internal whitespace), loaded at boot into the daemon's environment with
**the file's names winning over the inherited shell's** — the file the
durable declaration, the shell the fallback for names it does not carry.
The path resolves against the serve command's working directory (0223 D3's
`--launch` truth: one resolution for the source and compiled layouts) and
must be a readable file, refused at the operator's own act (exit 1) when
it is not; a malformed line refuses naming its line number, never the
line's bytes. The load happens before `startDaemon`, so the manifest and
every check read the effective carrier.

**The boot manifest.** Every start writes the effective environment's
names — presence only, sorted, the `OPENCODE_AUTO_*` switch layer excluded
exactly as the spawn filter excludes it (those names never reach a child,
so they are not carrier names) — to `<data-dir>/env-manifest.json`
(`{v, at, names}`, the boot instant included). Plain daemon-owned state in
the data directory, never a project's; overwritten each boot, best-effort
(a manifest that cannot be written is one warning, never a failed start).

**The boot self-check.** Two arms, both computed once at `startDaemon` and
carried on the handle as `bootWarnings` (the serve entry prints them after
its banner; an embedding host reads the field): the **lost-names diff** —
the previous manifest's names against the current environment, each lost
set one warning naming the names and the previous boot's instant, teaching
the two re-declaration routes (the shell, or `--env-file`); and the
**reference check** — the model registry loaded through the core's
`loadModels` (the operator layer located by the same env injection the
preload and the tests use, the builtin phase types the vocabulary — no
project context exists at boot) and checked through `checkModelReferences`,
each unresolvable reference one warning in the run surface's own wording,
the boot line hours ahead of the first blocked run. A broken layer is one
warning naming its first problem. The report never throws.

**The declines.** Fatal boot checks (P8 — the reasoning above); a general
env-name allowlist or seat-name check (P16/P21 — the site's seat contract
is the site's declared surface, its own block text already teaching the
persistent seat file; the tool names no host fact); dotenv-style
interpolation or quoting (declarations, not a script — a value that must
carry a newline is the shell's business, not the carrier file's).

## Tests

`packages/auto-server/test/env-boot.test.ts` — the parse (pairs, empty
values, `=` inside values, comments/blanks, duplicate last-wins, the
malformed refusals at their line numbers); the manifest (sorted, presence
only, the switch layer excluded); the report (a fresh boot silent, the
second boot naming exactly the lost pair with the re-declaration remedy
and never a value, the restored carrier silent, the corrupt manifest
warned-and-rewritten, the registry arm carrying the core's own wording
per reference and falling silent when the references resolve, the broken
layer one warning, never a crash); the daemon surface (`startDaemon`
computes the report and writes the manifest into its data dir); and the
serve wiring (a missing file refused at the flag, a malformed line refused
at its number with the line's bytes never echoed, the valueless flag the
usage refusal). The standing auto-server suites green (the handle change
additive); `bun typecheck` exit 0 both packages.
