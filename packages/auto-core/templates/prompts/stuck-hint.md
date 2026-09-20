[DRIVER] Loop detected: {{#if repeatError}}the tool {{tool}} has now failed {{count}} times with exactly the same error.{{/if}}{{^repeatError}}the tool {{tool}} has now returned exactly the same result {{count}} times for the same arguments.{{/if}}

- Tool: {{tool}}
- Arguments: {{input}}
- {{#if repeatError}}Error{{/if}}{{^repeatError}}Output{{/if}}: {{detail}}

Repeating the same action will not produce a different result; this route is a dead end.
{{#if level1}}
Stop and check your premises before acting again: do the path and the file really exist? Is the file's current content what you believe it to be (read it before changing it)? Are the command, the arguments and the dependencies usable? Then switch means — use another tool, locate things another way (search by content rather than by line number), split a large change into small steps, or supply the missing precondition first. Do not repeat the same call with the same arguments.
{{/if}}
{{#if level2}}
This is reminder number {{level}}, which means the approach you switched to last time is still going in circles. Write these three things out in your reply before acting:
1. what exactly you are trying to achieve;
2. which approaches you have already tried, and at which step each one failed (quote the real error, do not go by impression);
3. which previously untried approach you will use next, and why.
Do not issue the same call again before you have written these out.
{{/if}}
{{#if level3}}
This is the last reminder; the DRIVER will not interrupt again. Stop retrying: if this problem really cannot be solved right now, mark the leftover with `AUTO-FIXME: <reason and plan>` in the relevant code comment or in a document under docs/, state clearly which parts are done and which are not, and end this session so that the DRIVER can carry the process forward; if there is still one clearly untried approach you are confident in, try that one alone, and if it fails, close out as described above.
{{/if}}
