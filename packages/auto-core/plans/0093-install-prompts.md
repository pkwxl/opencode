# 0093 — install-prompts: the suite resync command

The working rulings, kept verbatim as the design record. Status: landed 2026-10-11.

## The problem

The manual-driver suite travels as files: the person who drives a target directory by hand
(`prompts/run.md` handed to a coding-agent session) had no way to pick up a suite change short of
hand-copying files out of this package — dm-glm's `new prompts` commit was exactly that, and its
0089-vintage copy went stale the day 0090 landed. The suite is deliberately outside the driver's
runtime (nothing renders it), which also meant nothing embedded it: a compiled shell did not carry
the files at all.

## The rulings

- **D1 — the command and its surface.** `opencode-auto install-prompts [dir]`: flagless (a directory
  argument and nothing else), requiring an initialized project (the suite presumes the driver's docs
  machinery, and the refusal keeps the command from littering arbitrary directories). Exit 0 on a
  completed resync — an already-current suite included; 1 on refusal or write failure.

- **D2 — resync semantics.** Every suite file is copied byte-identical into `<dir>/prompts/`:
  differing content is rewritten, identical content is left untouched. A file in the target's
  prompts/ the suite does not carry is reported and never deleted — the person's local additions are
  theirs.

- **D3 — no run lock, no git.** The automated driver never reads the target's prompts/, so the resync
  writes nothing a live run reads and joins no lock refusal; it runs no git command either — the
  suite files are tracked content in the target, so the person reviews and commits the resync.

- **D4 — the embedded registry.** `src/install-prompts.ts` imports each suite file
  (`with { type: "file" }`, the template mechanism, so a compiled shell carries them) and holds the
  registry; adding a suite file registers it in the same change, and test/install-prompts.test.ts
  holds the registry to the directory's contents. The suite is still rendered by no runtime code —
  the installer is a copy, not a template registry.

## What is deliberately not done

- init does not seed prompts/ — init writes the config layer only; the suite is optional tooling for
  the person's manual driving, installed on demand.
- No deletion of extra files (D2) and no version stamping or marker file — drift shows as the
  resync's own rewritten list.
- No shell-profile surface: the file set is core-owned; every shell gets the same suite.
