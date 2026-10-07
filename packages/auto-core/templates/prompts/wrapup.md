{{> head}}

Current task:

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}{{#if precedence}}Authority order for everything in this prompt:
{{precedence}}

{{/if}}{{#if solo}}The implementation of this task was completed in earlier sessions; do not redo it. This session only performs the wrap-up:{{/if}}{{^solo}}All subtasks of this task were completed one by one in earlier sessions; do not redo them. This session only performs the wrap-up:{{/if}}

1. Update the documents in docs/ affected by this task;
2. Write docs/{{taskId}}/report.md:{{#if reportForm}} {{reportForm}}{{/if}} so that later sessions and reviewers can learn what this task produced from the files on disk alone. Every reference in the
   report (to a document or to code) follows the directory's reference conventions as the AGENTS.md block states them;
{{#if resultRule}}3. Verify the task: you are this task's verification session — a fresh pair of eyes over the work, never the work sessions' self-report. Inspect the task's own output directly{{#if commitRange}}, in its commit range {{commitRange}} (every change this task's sessions made){{/if}}, and judge every `## Acceptance` criterion of the task above by that inspection alone — never from the work sessions' claims, without re-running the acceptance's executable checks (its tests, the typecheck or build — the work sessions already ran them under the task's self-check constraint), and never accepting a claim you have not inspected yourself. Then, by outcome:
   - every criterion met → write the report of 2 in the evidence form: one short section per acceptance criterion — what was done, and the evidence (your inspection and its outcome, the artifact path or code location) — then two sections of your own, overall conclusion and open issues, and end the report with `Result: PASS`;
   - any criterion unmet → write no report at all. Instead write docs/{{taskId}}/gaps.md (overwriting whatever is there): first a compact summary of what you verified as OK (so the fix session does not redo it), then one entry per gap — the missing or wrong required action, where (files), and what exactly to do — ending with `Result: FAIL <one-sentence reason>` as that file's last line of body text (no terminator in that file). A fix session then closes exactly the listed gaps and the verification re-runs from scratch;
{{/if}}{{#if resultRule}}4{{/if}}{{^resultRule}}3{{/if}}. The task status is recorded by the DRIVER in one pass after the session ends.{{#if resultRule}}
   Result line: {{resultRule}}
   The result line is a DRIVER protocol string, on a line of its own — write it exactly as given, do not translate, bold or list-mark it: `Result: PASS` ends the report (docs/{{taskId}}/report.md, the last line of body text before the terminator), `Result: FAIL <one-sentence reason>` ends the gap list (docs/{{taskId}}/gaps.md, the last line of body text, no terminator). On `Result: FAIL` the DRIVER runs a bounded fix loop over the gap list — at most two fix rounds, each closing exactly the listed gaps, then the verification re-runs from scratch; past the budget the task blocks and the run stops for human handling.{{/if}}
{{#if resolveList}}
{{#if resultRule}}5{{/if}}{{^resultRule}}4{{/if}}. While this task was running, the DRIVER auto-answered the following questions that you should have asked the user (with nobody at
   the keyboard, the DRIVER closed them on the user's behalf, and what you received at the time was an automatic reply):

{{resolveList}}

   In docs/{{taskId}}/report.md give these their own section, "Proxy-answered questions", with one line per item:
   `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` — copy the original question verbatim from the list above, and
   write the option and reason you actually settled on at the time. Every item above must appear{{#if auditScope}}; {{auditScope}}{{/if}}{{^auditScope}}.{{/if}}
{{/if}}
Do not end the session before all of the above is done.

{{> eof-rule}}

{{> doc-layout}}
