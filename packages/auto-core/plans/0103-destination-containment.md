# 0103 — Destination containment: the P1 scan's true scope

Ruled from spi-nor-glm's R-01 close (2026-10-18). The project's first
round-close gate — the whole-tree P1 scan at `transfer`'s round-open —
surfaced three findings at once, one bug and two scope errors:

1. **`prompts/` blocked the round close.** The manual-driver suite
   (install-prompts, plans/0093) had been resynced into the target's
   `prompts/`, and the whole-tree scan read its nine runbooks as
   deliverables: they name `docs/T-NNN/todo.md`, `.auto/run.lock` and the
   rest **by design** — they are the driver's own runbooks. Nine blocking
   problems that are the tool tripping over machinery it installed itself.
2. **Seventy advisory lines of noise.** The bare-task-id warning fired for
   every outer-workspace file that names a task — the migration harness's
   own `test/*.sh` scripts (`# T-039 freeze item 5 …`, `echo "== T-050
   ktest …"`) name tasks freely and legitimately. Warning about content the
   person has ruled acceptable is noise the round report then repeats every
   round.
3. **The real violations were only advisories.** The destination repository
   `aster-spi-nor` (a nested git repository, gitignored by the workspace,
   the shipped deliverable of the migration) carried ~90 comment citations
   of the process side — `(T-034 §2.2's "protect glue" row)`, `(design
   T-035 §5)`, `AUTO-DECISION: (T-050)` — every one a pointer that breaks
   when the repository ships standalone, and every one a *warning*, so
   nothing mechanical ever pushed back on the sessions writing them.

The maintainer's ruling, verbatim: *test/* can refer to T-NNN; only
destination source code and docs such as in `aster-spi-nor` should not refer
to T-NNN and any path out of its own root repo.

- **`prompts/` joins the agent-contract surfaces** (roles.ts
  `contractSurface`): outside P1 scope, like `AGENTS.md`, `.gitignore` and
  `.opencode/`. The suite's home holds driver runbooks, not deliverable
  content; the whole-tree scan must not trip on what install-prompts
  writes. No new document role — the eof scan, protect list and the rest of
  the role model are untouched; `p1Scope` alone widens its exclusion.
- **The bare task id leaves the outer workspace entirely.** The TASK_ID
  check no longer runs for files of the target directory itself: the
  workspace's harness scripts name tasks freely, so the check would only
  generate noise (the register-name rationale of plans/0045 lived in this
  tree and never applied to what ships). The `warnings` half of
  `processReferenceScan` dies with it — the scan returns problems only, and
  the round-close gate's warnings keep the build line alone.
- **Inside a nested repository, containment blocks** (`git.ts
  nestedRepoPrefixes` → `document/process-refs.ts`, threaded through all
  three scan sites: unit close-out, standalone adoption, round close). A
  file under a nested repository is a piece of a shipped, self-contained
  deliverable — the destination of a migration or an isolated component —
  and answers two rules the workspace does not:
  - a bare task id is a **problem**: shipped code restates what the id
    pointed at (the `ProcessReferenceScan` message says so);
  - no path the file adds may lead **outside the repository's own root**: a
    `..` chain whose climb exceeds the file's directory depth inside the
    repository (counted from the repository root — the prefix is not a
    level), or an absolute path under the target directory. Pure path
    arithmetic; the scan still never asks whether a path exists. A
    workspace-relative first segment (`test/x.sh` written from a session's
    cwd) is deliberately **not** caught — it is indistinguishable from the
    repository's own tree and the scan refuses existence probes; the
    prompt-side discipline below carries that half.
- **The sessions are told the rule they are blocked on** (0102 stage F's
  rationale, applied again): the intent packs' `### process-references`
  (default + the three shipped bundles) gain the stricter nested-repository
  sentence, and the manual-driver suite's five task-id sites (run-task,
  run-fix, run-verify, run-as-subtasks, resume-subtasks) re-key from
  "reword to the bare task-id form / a warning to log" to "restate what it
  pointed at; inside a nested repository the bare id and any out-of-root
  path fail as well". The ratchet-pinned P1 path list stays verbatim.
- **The template-byte change is one designed provenance-staleness event**
  (0100): materialized projects see the pack as stale at the next preflight
  and fast-forward it with `sync` — a charter-key change this is not, but
  the detection and the upgrade path are the same.

## Verification

Core typecheck clean; `test/document-roles.test.ts` re-keyed and extended
(the outer-workspace silence, the nested task-id problem with its message,
the `..`-climb and absolute-path escapes beside the stays-inside cases, the
`prompts/` contract surface) — 66 pass; round-gates, work-order,
manual-prompts-ratchet, install-prompts and the three prompt suites green;
the full `bun test` run is recorded in the commit. The spi-nor-glm side —
the ~90 citation lines restated away in `aster-spi-nor`, the R-01 close
listing drafted, `transfer` re-run to the roadmap-exhausted stop — is the
ruling's working proof, recorded in the workspace repo, not here.

## Addendum — the second ruling (2026-10-18, same day)

The first cut enforced containment at every scan site. The maintainer went
further in the other direction: *only when we are ready to release the
destination must such references be removed — since additional rounds are to
do, we may just record them and delay the treating — but a clearly `release`
sub-command might be needed.*

- **D2 — containment is recorded during the working rounds.** Restating
  citations away is churn a working round should not be forced into: the
  findings would re-appear with every session that writes into the
  destination, and blocking on them would tax the migration's velocity for a
  property only the shipped state needs. `processReferenceScan` returns them
  as `deferred`: the unit close-out logs a ⚠ line, standalone adoption the
  same, and the round-close gate lists them as warnings — the running ledger
  the person reads each round. The classic process-path rule (docs/T-*,
  docs/R-*, .auto/) keeps blocking everywhere as before; only the
  containment class is deferred.
- **D3 — `release`, the enforcement moment.** A new shell subcommand backed
  by `src/release.ts`: for every nested repository — the destination — a
  clean-tree check (an uncommitted state is not a releasable state) and the
  whole-tree scan under the release posture, where the recorded findings
  become problems with removal wording. A gate, not a scrubber: removal is
  content work the person's agent does (restate the decision a citation
  pointed at, vendor or rewrite what a path named); the re-run certifies
  with one `✓ <destination> @ <HEAD>` line. AUTO-* markers are deliberately
  not demanded away — they are self-contained content, and stripping them
  would erase recorded rationale; that stays editorial choice. The outer
  workspace is never the destination's business (its dirt, its task-naming
  scripts). Exit 0 certified / 2 findings remain / 1 nothing to release; the
  command is flagless like `status`, joins the legacy-layout refusal, and
  takes no run-lock refusal (read-only; the clean-tree check makes a
  mid-flight certification refuse on its own).

The manual-driver suite keeps its stricter wording deliberately: an
agent-driven run has no release gate standing behind it, so its verification
child holds the line the driver's rounds now defer.
