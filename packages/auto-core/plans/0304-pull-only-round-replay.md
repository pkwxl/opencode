# 0304 — A pull-only round through recovery and close

On 2026-11-24, 07:38–07:40 UTC, a scripted client drove one isolated Git
project from its formulation floor to a closed round over HTTP. The
standalone daemon and its spawned coordinator workers ran the clean
`a7f2b7bf1` build. Both incident replays recovered. The final claim
answered `done`.

## Setup and exposure

The fixture started with an established R-01, one `implement` phase, a
filled round brief and close listing, a charter requiring coverage, and
108 numeric examples. Its task was to implement `python3 twice.py N`.
The configured close build was `python3 twice.py 7 | grep -qx 14`.
Fixture preparation committed these inputs. The first transfer constructed
the formulation todo. The daemon then made every share and close commit.

The service was built and started with these commands, with temporary
project, credential and store paths:

```sh
# From packages/auto-server
bun run build
server=dist/opencode-auto-server
"$server" register "$project" --data-dir "$store"
"$server" token issue --scopes executor --name producer --out "$producer_key" --data-dir "$store"
"$server" token issue --scopes executor --name verifier --out "$verifier_key" --data-dir "$store"
"$server" token issue --scopes read,control --name operator --out "$operator_key" --data-dir "$store"
"$server" serve --host 127.0.0.1 --port 0 --data-dir "$store"
```

`GET /health` returned `line` and `checkout` at `a7f2b7bf1`. The first
`ready` and the replacement worker's `ready` returned the same commit and
protocol `0.1`. Across the run and shutdown, 45 requests returned 40 HTTP
200s, three 202s for worker stops and two 409s identifying active workers.
Nine grants were claimed across six kinds.

| Kind | Grants | Measured outcome |
| --- | ---: | --- |
| synthesize | 1 | Corrected 111-row reply landed at `919e943`. |
| formulate | 2 | Handoff landed at `56775fa`, completed plan at `3a23588`. |
| verify | 3 | Formulation PASS, implementation FAIL, repaired implementation PASS. |
| execute | 1 | Initial implementation landed at `1a4b91e`. |
| fix | 1 | Signed arithmetic repair landed at `f1f49a3`. |
| distill | 1 | Four-section phase handover landed at `97a683a`. |

This is one local fixture round under 0255’s measurement instrument.
The producer and verifier used distinct credentials and scripted artifact
writes. The protocol caller supplied all inputs, including three synthetic
conflict rows for grammar coverage. External adoption, autonomous model
quality and manual-prompt usage were unmeasured. The fixture had no
close-due assurance row, so it exercised zero audit grants.

## Recovery witnessed on the wire

1. **0299, ledger grammar.** The producer sent 108 obligation rows and
   three conflict rows without their leading dashes. The first report
   returned `blocked/commitFailed`, identified ledger line 1 and the
   missing literal prefix, and named the consumed reply and restored todo.
   The client checked the floor bytes and unchanged HEAD. Prefixing the
   same rows with `- ` and reporting the original pair landed all 111.
   Repeating the report left HEAD at the same commit.
2. **0300, graceful stop.** Before writing any planning document, the
   producer wrote only its handoff with `Status: continue` and reported
   `ended`. The commit contained the handoff. Replay left HEAD unchanged.
   The next grant was `T-001 formulate 2` and its prompt named the handoff.
3. **0300, pending settlement.** The resumed producer submitted a task
   and index without a coverage map. The report named the missing map and
   left HEAD unchanged. The operator's reconcile request returned 409
   with `DELETE /runs/run-000001`. The stop returned 202. After GET showed
   the worker was terminal, reconcile returned 200 with nothing to
   reconcile. The original report remained available for settlement.
4. **0300, successor.** A fresh client process and replacement worker
   began with the task and kind. A different token, another channel on
   the producer token, and the wrong kind each received a wait. The
   original token and channel recovered the grant from `brief` while
   `ready` listed zero live leases and an in-flight settlement. The
   successor mapped every row to T-002 and retried the recovered pair
   twice. Both responses named the same commit. Afterward `brief`
   returned a wait and the verifier claimed the unit. The client used
   public endpoints throughout recovery.

## Verification and close

The verifier checked all 111 coverage mappings before passing the plan.
The initial implementation deliberately used an absolute value. Running
the command for every integer from −54 through 53 found 54 incorrect
negative outputs and 54 correct outputs. A single FAIL gap led to a fix
grant. Re-verification checked exit code and exact stdout for all 108
processes. All passed, the README described the invocation, and the task
closed at `6a368c5`.

Distillation returned `phase-boundary`. An immediate transfer hit the
second 409, naming `run-000002`. Following the supplied stop and retry
completed the transition at `43d9377`. The daemon logged
`✓ round close checks passed`. Project status showed one of one phases
and both tasks done, with a clean Git tree. A fresh claim returned
`done`. The final worker was stopped during teardown.

Both successful transfers returned the same generic HTTP summary. The
daemon log identified the round-close check and project status confirmed
the resulting state. Neither incident required an off-protocol ledger
read or a production code change in this run.

Derives: P5, P8, P10 and P19. Field evidence under 0255 and the preview
posture of 0279, covering the fixes recorded in 0301 and 0302.
