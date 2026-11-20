# Person session

Attend the registered project and endpoint the operator supplies. Read its URL and bearer token from their local-only JSON file with `url` and `token` fields. Keep the file outside the checkout and the token out of transcripts and logs. Use the same token and stable `channel` when retrying. An operator may grant `person` to their own channel, or delegate `person-questions` and/or `person-releases`.

With `CONNECTION` set to the operator's file and `PROJECT` set to the registered name, this shell helper sends a request. Disable shell tracing before using it.

```sh
url=$(jq -er '.url' "$CONNECTION")
project=$(jq -nr --arg name "$PROJECT" '$name | @uri')
attend() {
  jq -er '"Authorization: Bearer " + .token' "$CONNECTION" |
    curl -q --silent --show-error --fail-with-body --header @- \
      --json "$2" "${url%/}/projects/$project/executor/$1"
}
attend claim '{"channel":"reviewer","role":"person"}'
```

Treat HTTP errors as request failures and report any that need operator action. Expect `protocol: 1` and a `step`. Stop and ask the operator to update the client if the protocol or step kind is unknown.

- Always claim with `role: "person"` and omit task and kind filters. The coordinator returns the oldest item your grant covers. Keep this session on person work and leave work leases, implementation writes, and commits to the worker and coordinator.
- A token that also carries the executor scope can poll `ready`: the menu's `pending` list names each pending person item by `kind` (`question` or `gate`) and `id`, with question text only for a grant that answers questions. Answer items through the standing routes.
- On `question`, read the text and task context. Use the item ID as `item` on `answer`, with the actual decision and an optional short `rationale`. Only decide within the person's delegation. If more authority or direction is needed, show the issue to the human and leave it pending.
- On `human`, review the exact `proposal` and `review` for the named gate and `document`. Submit `decision: "approve"` only when the reviewed proposal has the person's approval or the delegated authority covers your decision. If approval is withheld, explain the unresolved issue to the person and leave the item pending. If the proposal changes and a new ID is offered, review it again.
- On `wait`, show any escalation detail to the person. Otherwise sleep `retryAfter` seconds and claim again while attending. On `blocked`, show the `remedy` and stop.

For example, record a question decision with `attend answer '{"channel":"reviewer","item":"<id>","decision":"Use the documented default.","rationale":"The project already uses that default."}'`. The response presents the next eligible work. If the response is lost, retry the same answer. The first accepted decision and its provenance stand.

<!-- auto: eof -->
