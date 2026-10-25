# 0122 — root-symlink external_directory allows: init stamps them, fix keeps them

The aster-mig cleanroom baseline reads its reference corpus through the `linux` symlink at the project
root (`linux` → `/workspace/linux`, a layout-separation wall). Reading through the relative path costs
nothing; the moment a session names the real path — the read tool resolving the symlink, a model-built
absolute path — opencode raises its separate `external_directory` consent, a gate independent of the
`read` permission patterns (the project's `opencode.json` already allowed `/workspace/linux/**` for the
read action and the ask fired anyway). An unattended driver session holds the default ask-deny posture:
the ask waits, times out, and is denied — and the exec session of T-002 (2026-10-25, 16:55:14, run log
`run-2026-10-25_08-51-23.log`) ended right there, at 4% context with the inventory work gathered in
context and nothing on disk; the wrap-up FAILed the missing artifact, one fix round was killed by a
double Ctrl+C, and a re-verification round burned before the artifact finally landed. The person's only
remedy was a hand edit of the target's `opencode.json` — the same remedy the ask-fail message names.

This ruling Derives: **P16** (genericity — no project path enters code; the top-level symlink is itself
the declared surface, a filesystem declaration the person plants, and "allow the real paths of the
target's root symlinks" is the structural rule, never an in-code exemption), **P7** (grammars, never
content — the driver writes a mechanical JSON grammar derived from disk facts; it judges no content),
**P6** (derived state, idempotence — the entries re-derive from the symlinks at every write, re-running
reproduces the same bytes, and the machine-specific real path lives only in the gitignored
`opencode.json`, never in git), and **P10** (the byte-identical floor — a directory with no root
symlinks, or with symlinks that stay inside the project, gets no finding, no write, and a template
byte-identical to before). Tier touched: **mechanism and data** — a new core module, two command
surfaces, tests; no principle change.

## D1 — the derivation rule

Every **top-level symlink** of the target directory whose `realpath` resolves **outside the project
root** contributes exactly one permission entry — `"<realpath>/**": "allow"` — under
`permission.external_directory` of the target's own `opencode.json`. Broken symlinks are skipped
(nothing to allow); a real path that is the root itself or one of its ancestors is excluded (allowing a
parent of the project would be near-global, not a corpus); internal real paths are excluded (they raise
no gate); several symlinks onto one corpus contribute one entry (sorted, deduped).

## D2 — the write shape

A pure parse-and-insert: the driver's entries go at the **front** of the `external_directory` object —
opencode evaluates a permission object's rules last-match-wins, so the person's later rules (the
compliance wall's deny) always win the tie — and a key the person already set, to any action, counts as
present and is never inserted over. Every other key and the person's key order are untouched;
serialization is the template's 2-space indent with a trailing newline; a second run is byte-stable.
The write chmods 0644 first when the file is read-only (the `saveProjectConfig` precedent). A file that
cannot hold per-pattern entries (malformed, a flat `external_directory` action) is never guessed at:
undefined up, report down.

## D3 — the command surfaces, and the one conscious amendment

`init` sets the entries up **whether it just created `opencode.json` from the template or found a
person's file**: one additive insert of exactly the allow entries, one status line
(`stamped: opencode.json permission.external_directory allows for …`), and a warning — never a failure
— on an unshapeable file. This consciously amends config-fix's standing rule that "files a person may
have edited (opencode.json, brief.md) are only written when missing, as init does": the amendment is
this insert alone, recorded in `config-fix.ts`'s own rule header. `fix` keeps the entries in sync as a
standard **fixable** finding in the shared rule table — `fix` (clean-tree gate, y/N confirmation) and
`fix -f` (the automation path) apply the identical write through the identical applyFix, and the
missing-file template write carries the stamp so one pass sets a fresh file up completely. A stale
allow (its base neither a current real path nor present on disk — the corpus moved, the symlink was
deleted) is a **manual** finding, report-only: never guess, never delete person content. Neither
command writes mid-run (both refuse under a live run lock; `opencode.json` is protected read-only
during runs).
