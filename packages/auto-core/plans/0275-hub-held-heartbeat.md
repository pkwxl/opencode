# 0275 — Hub-held renewal for long executor turns

## Category scope

Executor lifecycle and manual-driver teaching. Derives: P19 (0262-02
measured an in-session heartbeat reaped during a long turn), P20 (stop
the writer before returning the workspace), P2 (the operator provisions
the worker and chooses when to rotate), P10 (existing clients and
coordinator requests keep their behavior).

Premises this ruling changes: none. 0267 brings forward the holder side
of Program W. 0260's cap and 0261's same-holder requirement still apply.

## Decision

The `opencode-auto-server executor-hub` command calls the executor HTTP
routes from the POSIX workspace host. It checks the token scopes before
requesting work and refuses person authority. Each instance owns a stable
channel, reads the menu and requests one kind configured with a child
command supplied by the operator. Each successful claim starts a fresh process. Separate instances
can serve concurrent channels. Verification uses its own token. Agent
adapters and model selection remain at the stage set by 0267.

Renew halfway through the remaining acknowledged interval, matching both
step and lease in the response. The last acknowledged deadline bounds the
child even during a stalled request. At the coordinator's cap the worker
waits out the last interval. Losing the grant or failing to confirm it
stops the child group. A shutdown during claim waits for the response so
an unused grant can be released. After launch, stop the writers before
reporting the outcome. A lost settlement response is recoverable through
the standing original-pair retry and successor claim rules.

A killed hub can leave a child running. Before restarting, the operator
stops orphaned writers on the workspace host. Recovery of a live grant
requires the same holder and explicit resume. Manual hubs can also rotate
at the operator's discretion with the grant live until its deadline.
A command that starts an independent service outside its process group
requires operator-managed cleanup.

## Homes

The runnable hub and its lifecycle tests live in auto-server's
`src/executor-hub.ts` and `test/executor-hub.test.ts`. The launch
contract lives in its README. The manual postures live in
`prompts/executor.md` and are pinned by `test/manual-prompts-ratchet.test.ts`.
