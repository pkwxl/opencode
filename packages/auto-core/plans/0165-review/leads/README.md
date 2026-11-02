# Salvaged leads — unverified reproduction drafts

These files were written by the first (parallel) attempt at this review on 2026-11-02. All nine reviewer agents
were stopped by the usage limit before writing a report, so **nothing here is a finding yet**: each file is a
reproduction draft whose header comment states the claim it was built to test. The owning step runs it, then
records it under its `## Leads` section as confirmed (with a finding id), refuted (why), or not run (why).

They are stored as `.txt` so the package's typecheck (no `include` in tsconfig.json) and `bun test` discovery
ignore them. To run one, follow CONTRACT.md's harness: copy it to a temp dir **outside the repository** with its
real extension, and set any `TMP`/scratch-path constant at its top (it points at the first attempt's dead
session scratchpad) to `"$T/tmp"`. Imports are absolute paths into `packages/auto-core/src` and `test/fixtures`.
A draft may be incomplete — the agent was cut off mid-work; fix it rather than trust it.

| lead | step | the claim its header states |
|---|---|---|
| R1-doclanes.test.ts.txt | S05 | an /exit at a doc lane's wrap-up entry throws out of the doc loop mid-flight |
| R2-survey-commits.test.ts.txt | S07 | the survey phase + human clarification gate driven end to end over a real repo (read the scenes) |
| R2-foreign.test.ts.txt | S08 | the formulation todo beside a `--new-task` hand-added task reads "foreign" and cannot be reconstructed |
| R2-subheads.test.ts.txt | S09 | a round-brief proposal using `####` sub-headings is truncated at the first by 0158 D3's terminator |
| R3-selfreport.test.ts.txt | S11 | a work session's own `report.md` `Result: PASS` outranks the verify session's FAIL (false PASS, P3) |
| R3-oscillate.test.ts.txt | S11 | 0146 compares against the previous gap count, not the best — gap counts 2,1,2,1… never block (unbounded, P2) |
| R3-selfclose.test.ts.txt | S12 | a work session renaming its own todo.md → done.md is committed; after a FAIL the next load reads the task as done (P3) |
| R3-choice.test.ts.txt | S12 | the diagnosis session's verbatim text carrying `Choice: A` becomes a parsed person's mark the next prelude executes (P2) |
| R4-driver-throw-loop.test.ts.txt | S13 | a deterministic driver-side exception (the sideband's question() throwing) is reclassified as a transient session error and runs the retry ladder |
| R4-chain-ratchet.test.ts.txt | S13 | the chain-writes ratchet's binding finder (copied from test/chain-writes.test.ts:182-185, 226-230) tested for escapes |
| R4-stats.test.ts.txt | S15 | the stats store's lanes section across a round rollover, reported in the next round's conclusion |
| R4-ledger-a.ts.txt, R4-ledger-b.ts.txt | S15 | process A SIGKILLed right after a task switch's ledger append, process B resuming — duplicated or lost ledger lines (0152) |
| R5-walk-forward.test.ts.txt | S17 | the 0163 walk moves FORWARD off a healthy unmarked current key onto a later key whose hold passed |
| R5-walk-oscillation.test.ts.txt | S17 | a stated reset shorter than the rotation's restart lets the fork's new-session walk undo the rotation (0163 says impossible) |
| R5-walk-sibling.test.ts.txt | S17 | under doc lanes (shared managed server), a new session's walk restarts the server under a sibling's in-flight turn (P20) |
| R5-jsonmsg.ts.txt | S17 | (a scratch script, fake key strings) whether a JSON parse error of the registry echoes a key literal into its message — the secrets family |
| R5-claude-perms.test.ts.txt | S18 | the claude adapter's translation of the 0147 boundary pair + a 0122 root-symlink composite |
| R6-r6.test.ts.txt | S19/S20 | a multi-scene file over the git layer, fork and wall (read its scenes' headers) |
| R7-perm.test.ts.txt | S20 | the opencode.json permission stamps evaluated with opencode's own matcher under last-match-wins |
| R7-prov.test.ts.txt | S22 | the provenance direction for a body-only difference (a newer binary's materialization opened by an older one) |
| R8-argv-probe.ts.txt, R8-cli.sh.txt | S26 | argv handling probes against the CLI (scenes `shortflag` in the first attempt) |
| R8-cli-nopath.sh.txt | S27 | the CLI run with no PATH entries (agent bin discovery); the first attempt also built `ident` (git identity at init) and `lanes` scenes |
| R9-daemon.test.ts.txt | S29 | (F) the per-run bridge secret rides the worker's argv, readable from /proc/<pid>/cmdline; restored-run immortality across restarts |
| R9-ipv6.test.ts.txt | S29 | (H) an IPv6 bind writes a transport URL the worker's own validator refuses |
| R9-nogit-run.test.ts.txt | S29 | (B2) a server-initialized non-git target runs to completion with no commit anywhere |
| R9-ops.test.ts.txt | S30 | (A) the server's amend accepts `config.phases`, the key 0137 retired on amend; further scenes inside |
