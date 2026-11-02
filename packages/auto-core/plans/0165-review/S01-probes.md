# S01 — mechanical probes (triaged)

Date 2026-11-02 · HEAD read 358be4003, re-run at d579016b2 · status: done.
Regenerate the raw output with `bun plans/0165-review/tools/probe.ts` (from `packages/auto-core`); the family check
with `bun plans/0165-review/tools/family-check.ts`. Below: the triaged result (false positives removed).

## Coverage

INDEX.md (all rows), the code homes of every INDEX row, path references in AGENTS.md (core + auto),
docs/structure.md, docs/shell-contract.md, docs/principles.md, every post-baseline plan (0110–0164), the
`OPENCODE_AUTO_*` census over the three packages' src vs their docs, the src→test import census, the Auto-Stage
literals, git tags, exit-code call sites, the shell-contract §A module list.

## Triage notes (false positives, so later steps do not re-chase them)

- Unresolved paths in AGENTS.md / structure.md / auto AGENTS.md are **target-directory** paths (`docs/R-NN/*`,
  `docs/T-NNN/*`, `docs/analysis.md`) or the deliberately retired `docs/behavior.md` mention — not defects.
- shell-contract.md's `src/index.ts`, `script/build.ts`, `test/isolation.test.ts`, `docs/daemon.md` are shell-package
  paths written relative to the shell — not defects.
- INDEX row 0128's `\|` is a valid GFM escape — fine. 0138's `/opencode.json` family-check miss is a `.gitignore`
  line, not a file. 0132's `audit.md` miss is a "held, untouched" row.
- `OPENCODE_AUTO_E2E_KEYS` is documented and read by tests only — not a defect.
- Template registration: every file under templates/ and prompts/ is registered (no gap).
- Exit codes: shells exit 0/1/2/3 and code-variables; the core exits 130 only — coherent with AGENTS.md (per-command
  truth is S26/S27's question).

## Findings

```jsonl
{"id":"S01-01","title":"INDEX table grammar broken in 27 rows: an undefined 7th cell in 0139–0164, 8 cells in 0162, an unescaped pipe in 0086","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["P18","P13","INDEX 'Maintaining this index'"],"loc":["auto-core/plans/INDEX.md:106","auto-core/plans/INDEX.md:167-192"],"symbol":"INDEX rows","evidence":"header `| doc | what it ruled | status | principles | code homes | release |` (6 cells); rows 0139–0164 carry a 7th annotation cell; 0162 splits into 8; 0086's status column reads 'done`) at the implementation→testing boundary…'","repro":{"cmd":"bun plans/0165-review/tools/probe.ts","observed":"P1 section lists each row"},"impact":"renderers drop or shift cells — the one maintained manifest misreports status/principles/release for 27 rows","remedy":"fold the 7th-cell annotations into the 'what it ruled' cell; escape pipes; keep 6 cells","family":["INDEX.md 'Maintaining this index' l.204"],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S01-02","title":"INDEX row order: 0148 listed before 0147","sev":"S4","conf":"CONFIRMED","cat":"TRACE","measures":["INDEX ordering rule"],"loc":["auto-core/plans/INDEX.md:175-176"],"symbol":"post-baseline rows","evidence":"l.175 0148-fix-commit-identifiers, l.176 0147-worktree-knowledge-boundary","repro":null,"impact":"ordering convention broken","remedy":"swap the rows","family":[],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S01-03","title":"11 INDEX code homes name src files that no longer exist, 9 of them in active-authority rows","sev":"S3","conf":"CONFIRMED","cat":"TRACE","measures":["P18","P5"],"loc":["auto-core/plans/INDEX.md (rows 0001, 0003, 0004, 0006, 0010, 0020, 0023, 0034, 0054)"],"symbol":"code homes column","evidence":"src/check.ts, current.ts, final.ts, fixme.ts, index.ts, refcheck.ts, review.ts, server.ts, subtask-state.ts, verify.ts (+ templates/prompts/phase-plan.md in superseded 0046)","repro":{"cmd":"bun plans/0165-review/tools/probe.ts","observed":"P2 section"},"impact":"the maintained manifest points an active ruling at a nonexistent home (the code moved: server.ts → agent/opencode/server.ts; index.ts → packages/auto/src/index.ts)","remedy":"annotate the moved/retired homes in the manifest (originals stay untouched)","family":["S01-01"],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S01-04","title":"six OPENCODE_AUTO_* switches parsed in code are documented nowhere (README, MANUAL, daemon docs, core docs)","sev":"S3","conf":"CONFIRMED","cat":"DOC","measures":["P13","P8"],"loc":["auto-core/src/switches.ts"],"symbol":"OPENCODE_AUTO_FORK, _HANDOVER_CONCURRENT, _HEAP_SNAPSHOT, _SHARE, _SYNTHESIS_TIMEOUT, _TASK_CONTEXT","evidence":"34 distinct names in src, 16 in auto/README.md; the six absent from every user/design doc","repro":{"cmd":"bun plans/0165-review/tools/probe.ts","observed":"P5 section"},"impact":"undiscoverable behavior switches; or dead experiment switches (S17 decides which)","remedy":"document or retire each (S17)","family":["auto/README.md switch table"],"prior":"NEW","wave_hint":"switch census"}
{"id":"S01-05","title":"five auto-core modules have no direct test import (stats-schema 635 lines, engine/fx, engine/sources, overlay, clean); loop-plan/loop-phase thinly tested; status has no test file","sev":"S3","conf":"CONFIRMED","cat":"TEST","measures":["principles 'How to rule': a requirement names its test home"],"loc":["auto-core/src/stats-schema.ts","auto-core/src/engine/fx.ts","auto-core/src/engine/sources.ts","auto-core/src/overlay.ts","auto-core/src/clean.ts","auto-core/src/status.ts"],"symbol":"test census","evidence":"no test file imports them (P6 section); loop-plan imported only by append.test.ts, loop-phase only via fixtures/loop.ts","repro":null,"impact":"indirect coverage only — S14/S15/S09/S22 judge what ruled behavior is untested","remedy":"per owning step","family":[],"prior":"NEW","wave_hint":"test gaps"}
{"id":"S01-06","title":"docs drift: shell-contract §A names a nonexistent core module `server` and omits clarify/release/fork/remove-fork/driver-helper; §C claims CONTRACT_FILE is exported (a plain const); auto/AGENTS.md omits fork/remove-fork/driver-helper and still names the retired brief stub","sev":"S3","conf":"CONFIRMED","cat":"DOC","measures":["P13","0133","P5"],"loc":["auto-core/docs/shell-contract.md:9-10","auto-core/docs/shell-contract.md:57","auto-core/src/config-fix.ts:67","auto/AGENTS.md:7,26"],"symbol":"command and module lists","evidence":"`[ -f src/server.ts ]` fails; §A auto row: init/amend/transfer/plan/close/run/land/fix/sync/reset/status/models/install-prompts; config-fix.ts:67 `const CONTRACT_FILE`","repro":null,"impact":"the onboarding contract misdescribes the boundary; a new shell author copies a stale list","remedy":"re-key §A/§C and auto/AGENTS.md in one docs change (S26 confirms the CLI side)","family":["auto/MANUAL.md cheat sheet","auto/src/index.ts:715 'the public sixteen' comment"],"prior":"NEW","wave_hint":"docs truth"}
{"id":"S01-07","title":"AGENTS.md navigation regrown into R4's documented failure mode: 67 bullets averaging ~485 characters (longest ~2.6K)","sev":"S3","conf":"CONFIRMED","cat":"CPLX","measures":["R4","principles.md l.453"],"loc":["auto-core/AGENTS.md (## Navigation)"],"symbol":"navigation section","evidence":"principles.md l.453: 'AGENTS.md's 65-bullet navigation is the precedent-documented failure mode'; the file's own rule: 'new mechanisms add one navigation line'","repro":{"cmd":"awk '/^## Navigation/{p=1;next} /^## /{p=0} p&&/^- /' AGENTS.md | wc -l","observed":"67"},"impact":"the file every agent session loads (≈8K tokens each) carries mechanism detail that belongs in plans/ — the token cost of every session in this repository","remedy":"a navigation diet: one short line per mechanism + pointer; the detail moves to structure.md/plans","family":["docs/structure.md"],"prior":"NEW","wave_hint":"W0 governance"}
{"id":"S01-08","title":"loop-plan.ts is 1184 lines against its own header's promise to stay under 600","sev":"S4","conf":"CONFIRMED","cat":"CPLX","measures":["P5","0102"],"loc":["auto-core/src/loop-plan.ts:6"],"symbol":"module size","evidence":"l.6 '…do not push that file past 600 lines'","repro":null,"impact":"the promised split never happened (S08 judges the seam)","remedy":"split along the seam S08 names, or retire the promise","family":[],"prior":"NEW","wave_hint":"complexity"}
```

## Seam notes

- S17: decide documented vs dead for the six switches (S01-04).
- S08: the loop-plan split seam (S01-08). S09/S14/S15/S22: the untested modules (S01-05).
- S26/S28: confirm the CLI command lists against S01-06 rather than rediscovering them.
