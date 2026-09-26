{{> head}}

Current task (its document is docs/{{taskId}}/todo.md):

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks.{{#if continuation}} The previous session ended with a context-budget handover. First read {{handoffFile}} to learn the progress and the next steps, then carry on from there.{{/if}}

{{#if processRefs}}{{processRefs}}

{{/if}}Constraints:
{{#if selfCheck}}1. {{selfCheck}};
{{/if}}{{> question-rule}}
3. You may add to the content of docs/ but not modify it (if a modification is unavoidable, {{^ask}}annotate it as AUTO-DECISION and {{/if}}record it in the relevant document);
   {{> state-rule}}
{{#if budget}}
Context-budget protocol (this session manages its own context): the DRIVER watches this session's token usage and steers in one-line `[DRIVER] context: …` notices at milestones (about half the budget, then about 85%). Those notices are information, not interrupts — keep working. The handover timing is your decision, made from your own understanding of the task: when the remaining work would not fit the budget (a notice says so, or your own judgment does), hand over at a natural boundary — a coherent step finished, nothing half-edited. Write into {{handoffFile}} (overwriting it) what the brand-new session continuing this task from that file alone plus the task-background digest context.md and docs/ needs, so it does not re-read what you already read: the progress so far, the key decisions, the verified facts and file paths, the dead ends, and the next steps; end the document with `Status: continue` (task incomplete) or `Status: done` (task fully done) as its last line — a protocol string the driver parses, write it verbatim and untranslated — then end the session. A session that finishes the task comfortably inside the budget needs no handover; a "[DRIVER] This session's context has reached the wall" notice overrides everything above: write the file immediately and end the session.

{{/if}}{{#if testByDriver}}
Test execution protocol (--test-by-driver): do not run compile, test, build, lint or similar commands directly inside the session — they can take a long time or produce a lot of output. When you need one, write the command as a script into the test/ directory (clearly named, executable, reusable), then write the script path (relative to the working directory, e.g. test/build.sh) into tmp/test.sh to tell the DRIVER to run it, and end your turn to wait. After running it, the DRIVER feeds the exit code and the output file path back into this session (stdout and stderr merged into a single file); read that file directly to judge the result. To test again, write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running).{{#if handoverTest}} After the test is committed the DRIVER sometimes asks you to finish and write out the remaining work that does not depend on the test result, to write the test-related progress and next steps into {{testHandoffFile}}, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write {{testHandoffFile}} **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — that naming family is what the DRIVER observes to establish handover ordering, and writing it yourself is misread as a handover that happened. Record your interpretation of the test result and any corrections in the established artifact documents of this execution scope, or leave them to be folded into the handover document at the next handover.{{/if}}{{/if}}
