[DRIVER] The test script has finished running (run number {{seq}}).

- Script: {{script}}
- Exit code: {{code}}; took {{ms}}ms; timeout: {{runTimeout}}
- Full output (stdout and stderr merged): {{out}} (judge by reading the file directly, in chunks if it is large; do not conclude by guessing){{#if violation}}
- Side-effect violation: {{violation}}. A driver-run script is an observation — rewrite the script read-only (no tracked-file writes, no git state commands) before asking for another run; the restored content is the pre-run state, so redo any real change through your normal edits.{{/if}}

Judge the test result from this and carry on: if something needs fixing, keep fixing it; when you need to test again, write the same script path into tmp/test.sh once more to re-run it (the script is in the test/ directory, reusable, and may be modified before re-running).
