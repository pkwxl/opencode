# Executor

Use the registered project and endpoint the operator supplies. Read its URL and bearer token from their local-only JSON file with `url` and `token` fields. Keep the file outside the checkout and the token out of transcripts, logs, and child instructions. Use a stable `channel` for each worker or hub in that project, including across retries. Omit the field to use the token's default channel.

With `CONNECTION` set to the operator's file and `PROJECT` set to the registered name, this shell helper sends a request. Disable shell tracing before using it.

```sh
url=$(jq -er '.url' "$CONNECTION")
project=$(jq -nr --arg name "$PROJECT" '$name | @uri')
executor() {
  jq -er '"Authorization: Bearer " + .token' "$CONNECTION" |
    curl -q --silent --show-error --fail-with-body --header @- \
      --json "$2" "${url%/}/projects/$project/executor/$1"
}
executor ready '{"channel":"worker"}'
executor claim '{"channel":"worker","task":"T-012","kind":"execute"}'
```

Treat HTTP errors as request failures. Show the operator the error if it needs their action. Successful responses carry `protocol: 1` and one payload, `step`, `menu`, or `question`. Stop and ask the operator to update the client if the protocol or a step kind is unknown.

## Solo worker

1. Ask `ready` for `menu.claimable`, or use `claim` for the next available step. Claim a specific unit with its ID as `task` and a kind from the menu. Only a live grant authorizes work.
2. For `execute`, `verify`, or `fix`, work in the returned `workspace` and follow `prompt`. The coordinator owns staging, commits, and driver state. Never run Git staging or commit operations. Leave `.auto/`, the index, task and phase state, configuration, and AGENTS.md to the coordinator. Execute and fix may edit their assigned deliverables within the task's scope and the current task's handoff. Verification may write only the task's report or gap list. For verification, use a fresh agent context and a different token from the producer of the immediately preceding execute or fix share.
3. Use the grant's `id` as request field `step` and retain its exact `lease`. Send `heartbeat` with `{"channel":"worker","leases":[{"step":"<id>","lease":"<lease>"}]}` before the deadline in Unix milliseconds. Track the returned deadline. Stop all writes if the lease is gone or expires.
4. If a decision is needed, stop the affected work and send `question` with `text` and the complete `task`, `step`, `lease` tuple. The response's `question.id` identifies the pending item. Raise project-wide questions with `text` alone. Identical raises deduplicate while pending, so reconcile a lost response before raising again after settlement. Refresh the live brief with `brief {"task":"T-012","kind":"execute"}` on the same channel to read answers. If it includes `answerCursor`, send that value as `cursor` on the same brief request and follow each `answers` step's `next` cursor. Use `null` to start from the first answer.
5. End a turn with `report` carrying `step`, `lease`, and `outcome: "ended"` when the brief's work ends, or `outcome: "failed"` when work hits a blocker. A short optional `note` explains what happened. The coordinator judges artifacts and completion. Use `release` with the same pair if giving back work that never began.

A report or release response describes what comes next. Request a fresh claim before starting another work step. For `wait`, sleep `retryAfter` seconds and recheck the menu, the claim, or the current brief as appropriate. A gate wait calls for the person session. Render the remedy and end the session at `blocked` or `phase-boundary`. Show the summary and end at `done`.

If a claim response is lost, check the same channel's `menu.leases` with `ready` before trying another untargeted claim. If the menu shows a lease, claim again with its `kind` and the same channel. A matching `id` and `lease` recovers the held brief. If either value changes because the old lease expired, treat the returned grant as a new attempt and follow its brief. Retry a lost report or release with its original pair and the same report outcome. A successor claim can resume settlement of an already accepted report. A stale holder must stop writing and let the new holder continue.

## Hub

Use `ready` to assign an offered task and kind by ID. Start a child with that target and let it claim on its own channel, or claim on a hub-owned channel and pass the leased brief and workspace to a child that cannot make requests. Keep one live lease per project in this preview. A hub that holds the grant handles all requests for that child, including heartbeat and settlement. For self-serving children, have them heartbeat and report or have an authorized caller act on the same token and channel once they stop. Stop an interrupted child before giving back its lease. Report `"failed"` if the child stops after work began, or release if it never began. Leave implementation to the leased worker.

Keep project loops and leases separate. Use `GET /projects` with `read` to list registered projects. Where the operator enabled open creation, `POST /projects` with `projects` accepts `root`, `name`, and optional `config` for a new directory under a declared root. Retry creation with the same token and unchanged body.

<!-- auto: eof -->
