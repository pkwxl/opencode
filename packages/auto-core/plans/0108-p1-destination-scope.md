# 0108 — P1's deliverable is the destination: the scan's scope completes 0103's line

Ruled from dm-flash's R-01 close (2026-10-19), the second field round to trip
on the same seam. The round-close stop (rendered through the person-proxy
brief, 0105) held two blocking ✗ process-reference findings on
`test/dm/dm-audit.sh` and `test/dm/marker-audit.sh` — the person's audit
tooling, at the workspace root, referencing `docs/R-01/P02-design/
marker-table.md`, `docs/T-009/marker-protocol.md`, `.auto/`. The first aid
was a config exemption (`--scan-exempt test/*`); the maintainer then ruled
the general model, verbatim: *deliverable files should be managed by a child
directory's git; all files in the working directory, excluding the
destination git-managed child directories, are not deliverable files;
`prompts/` is also not deliverable.*

## The ruling and its lineage

0103 (spi-nor-glm's R-01 close) already drew this line for two of the P1
scan's three finding families: inside a nested repository — a shipped,
self-contained destination — a bare task id and a path leading outside the
repository's own root are findings (recorded while rounds run, enforced at
`release`), while in the outer workspace "the harness's own scripts name
tasks freely" and no task-id or out-of-root check runs at all. The
process-path reference check (docs/T-\*, docs/R-\*, `.auto/`) was left
running on the whole tree — so the one family whose blocking form fires at
round time was also the one still aimed at the workspace's own files.

0108 completes the line: **the deliverable is exactly what a nested
destination repository's git manages.** Everything else in the working
directory — test tooling, `prompts/`, `tmp/` scratch, the person's own
checkouts — is process workspace: it does not ship, it audits and drives the
process, and referencing `docs/` from it is what it is *for*. The reference
check therefore applies only to files inside a nested repository, alongside
the two containment families 0103 already scoped there.

The release gate already held this model alone: `release` certifies nested
repositories standing alone and answers a destination-less directory with
"nothing to release". P1 now agrees with it — a project with no nested
repository has no deliverable side and no P1 surface at all. (Consciously
retired: the 0045-era reading of the working tree itself as the deliverable
for in-place projects. Under the field model the deliverable is by
definition the child repositories; the workspace never ships, and a check
protecting a nothing-to-release tree protected nothing releasable.)

## D1 — the single gate, all four scan sites

`processReferenceScan` (src/document/process-refs.ts) skips every file not
inside one of the `nested` prefixes it already receives for the containment
rules. All four callers pass them today — the unit close-out
(src/execute.ts), the work-order adopt (src/work-order.ts), the round-close
gate (src/round-close.ts) and the release gate (src/release.ts, which scans
one destination at a time and pre-filters to its own paths) — so the rule
lands once and reaches every site with no caller change. A `repos.nested`
that is absent or empty means no destination repositories, hence no scan
surface: the workspace-only posture is a defined shape, not an error.

## D2 — `p1Scope` re-keyed, `contractSurface` retired

`p1Scope` (src/document/roles.ts) keeps the pure-path half — a non-process
role, not one of the project's `scanExempt` globs — while the nested gate
completing the deliverable definition lives in the scan (D1), which owns the
repository context. `contractSurface` (AGENTS.md, `.gitignore`,
`.opencode/`, `prompts/`) is deleted: it existed to keep freeform workspace
surfaces out of a scan that now never reaches workspace files at all.
`prompts/` is thereby formally not deliverable — structural, not
special-cased (the maintainer's sentence names it; the code no longer needs
to). AGENTS.md and `.opencode/auto/*` were already process roles through the
protect list, so their standing does not move.

## D3 — the message names the destination

The blocking finding's tail is reworded from "deliverable files must not
reference process documents" to "the destination must not reference process
documents" — the file:line head and the restatement remedy unchanged. The
old wording was the exact phrase that misled: deciding whether `test/*` were
"deliverable files" required the ruling this document records; the new one
names the side that ships. The ⚠ deferred records (task ids, out-of-root
paths) are unchanged byte-for-byte.

## D4 — round-close narrows its input

`roundCloseProblems` passes only the nested roots to `unitAddedLines` (the
outer root's tracked and untracked lines are all skippable now): the
whole-tree price is paid for the destinations alone, matching the header's
own "in every nested repository". The outer repository is no longer spawned
at round close at all.

## D5 — `scanExempt` keeps both halves, re-keyed

The config key's eof-scan role is untouched (terminator-free Markdown
fixtures anywhere), and its P1 role remains for destination files — a
person-declared exemption still silences the reference check on a nested
path, rare and deliberate. What disappears is the key's 0106-era motivation:
exempting *workspace* person-tool files from a reference check that no
longer runs on them. dm-flash's `test/*` entry from the first aid is
retired as moot (the structural rule covers it).

## D6 — the helper's channel row re-keyed

The person-proxy brief's process-reference row (0106 D3) now states the
scope: the finding is always inside a destination repository, the working
directory's own files are the process workspace and never scanned, and
`amend --scan-exempt <path>` remains the channel for a destination file
whose grammar legitimately names process paths.

## D7 — deliberately not changed

The manual-driver suite's planning sentence (`prompts/plan-append.md`) keeps
its conservative discipline (tasks should not create files referencing
process documents) and its ratchet-pinned grammar — advice to a planning
session, sound wherever the checks fire. The DRIVER_PRIMER's P1 sentence
stays true under the redefined term. The eof terminator scan, the protect
list, the clean-tree gates, the 0103 containment rules and the release gate
are untouched — the last three already keyed on destination membership.

## D8 — the review's two standing rulings (2026-10-19)

Ruled by the maintainer in review of this change; both pinned as invariants
in AGENTS.md.

1. **No environment-specific knowledge in tool source, ever.** dm-flash's
   `tests/` treatment was first aid through the declared channel — the
   target's own `--scan-exempt` config, never a line of core or shell code —
   and the structural rule then retired even that. Any future change that
   would need to name a real project inside `auto-core`/`auto` (or any
   shell's) source is wrong by construction: mechanisms stay generic,
   project-specific facts ride only the surfaces the target directory
   declares, and the need to special-case a known project is the signal that
   the structural rule is still missing.
2. **A destination-side reference fix is judged by the truth carried
   across.** Correcting a `T-XXX` (or process-path) reference in destination
   source comments means rewriting the true information the reference
   implied — derived from what it actually pointed at (the task document,
   the referenced file), written self-contained in the destination's own
   terms — and then removing the pointer. Removing the id while losing its
   information, paraphrasing from guesswork, or swapping in another
   outer-workspace pointer is not a fix; the existing remedy strings
   ("restate the content in place and remove the id", "never delete the
   record it anchored") already carry this reading, and no code change was
   needed — the ruling records how the remedy is to be read.

## Verification

`bun typecheck` clean; the full core suite green with the expectation
changes this change deliberately makes (outer-workspace reference findings
flip to clean floors, destination fixtures carry them instead);
`test/document-roles.test.ts`, `test/round-gates.test.ts`,
`test/subtask-shape.test.ts`, `test/driver-helper.test.ts` re-keyed; the
shell typecheck and suite green with its `--scan-exempt` help text and
README rows re-keyed. dm-flash: the `test/*` exemption removed
(`amend --scan-exempt none`), the round-close stop re-rendered clean of the
two ✗ findings through the structural rule alone.
