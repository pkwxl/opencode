{{> head}}

Current task:

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}{{#if solo}}The implementation of this task was completed in earlier sessions; do not redo it. This session only performs the wrap-up:{{/if}}{{^solo}}All subtasks of this task were completed one by one in earlier sessions; do not redo them. This session only performs the wrap-up:{{/if}}

1. Update the documents in docs/ affected by this task;
2. Write docs/{{taskId}}/report.md:{{#if reportForm}} {{reportForm}}{{/if}} so that later sessions and reviewers can learn what this task produced from the files on disk alone. Every reference in the
   report (to a document or to code) follows the directory's reference conventions as the AGENTS.md block states them;
3. The task status is recorded by the DRIVER in one pass after the session ends.{{#if resultRule}}
   Result line: {{resultRule}}
   Write the result line as the last line of body text of docs/{{taskId}}/report.md (before the terminator), on a line of its own; it
   may only be `Result: PASS` or `Result: FAIL <one-sentence reason>` — a DRIVER protocol string: write it exactly as given, do not
   translate, bold or list-mark it; on `Result: FAIL` the DRIVER marks this task blocked and stops the run for human handling.{{/if}}
{{#if resolveList}}
4. While this task was running, the DRIVER auto-answered the following questions that you should have asked the user (with nobody at
   the keyboard, the DRIVER closed them on the user's behalf, and what you received at the time was an automatic reply):

{{resolveList}}

   In docs/{{taskId}}/report.md give these their own section, "Proxy-answered questions", with one line per item:
   `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` — copy the original question verbatim from the list above, and
   write the option and reason you actually settled on at the time. Every item above must appear{{#if auditScope}}; {{auditScope}}{{/if}}{{^auditScope}}.{{/if}}
{{/if}}
Do not end the session before all of the above is done.

{{> eof-rule}}

{{> doc-layout}}
