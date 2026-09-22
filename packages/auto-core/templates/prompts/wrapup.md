{{> head}}

Current task:

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}{{#if solo}}The implementation of this task was completed in earlier sessions; do not redo it. This session only performs the wrap-up:{{/if}}{{^solo}}All subtasks of this task were completed one by one in earlier sessions; do not redo them. This session only performs the wrap-up:{{/if}}

1. Update the documents in docs/ affected by this task, so that the next session can understand the current progress from the files on disk alone;
2. Write docs/{{taskId}}/report.md:{{#if reportForm}} {{reportForm}}{{/if}}{{#if solo}}
   {{/if}}{{^solo}} {{/if}}so that later sessions and reviewers can learn what this task produced from the files on disk alone. Every reference in the
   report (to a document or to code) must be a path relative to the target directory root (e.g. docs/{{taskId}}/S01/index.md,
   src/foo.ts:42, in backticks or as a link, optionally with :line), and you must confirm the path exists before writing it — broken
   references are caught by the DRIVER's reference check; line anchors can drift as the target file changes, and the DRIVER appends an
   @<sha> version marker to any anchor that no longer matches (the range is then valid only for the marked historical version) — do
   not alter references that already carry a marker yourself; do not reference the state files inside the round directory docs/R-NN/
   (the ledger phases.md, the PLAN snapshots in the phase archives);
3. The task status is recorded by the DRIVER in one pass after the session ends. {{> state-rule}}{{#if resultRule}}
   Result line: {{resultRule}}
   Write the result line as the last line of body text of docs/{{taskId}}/report.md (before the terminator), on a line of its own; it
   may only be `Result: PASS` or `Result: FAIL <one-sentence reason>` — this is a DRIVER protocol string: write it exactly as given, do
   not translate it, do not bold it or add a list marker; when the DRIVER reads `Result: FAIL` it marks this task blocked and stops the
   run for human handling.{{/if}}
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
