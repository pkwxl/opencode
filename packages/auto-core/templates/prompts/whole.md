{{> head}}

Current task (its document is docs/{{taskId}}/todo.md):

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}You are responsible for the whole task this time, completed within a single session, without decomposing it into subtasks.{{#if continuation}} The previous session was interrupted by the context limit. First read {{handoffFile}} to learn the progress and the next steps, then carry on from there.{{/if}}

{{#if processRefs}}{{processRefs}}

{{/if}}Constraints:
{{#if selfCheck}}1. {{selfCheck}};
{{/if}}{{> question-rule}}
3. You may add to the content of docs/ but not modify it (if a modification is unavoidable, {{^ask}}annotate it as AUTO-DECISION and {{/if}}record it in the relevant document);{{#if ondemand}}
   if the DRIVER inserts a "[DRIVER] This session's context is about to reach the limit" notice, immediately write {{handoffFile}} as that notice instructs and end the session;{{/if}}
   {{> state-rule}}
{{#if testByDriver}}
Test execution protocol (--test-by-driver): do not run compile, test, build, lint or similar commands directly inside the session — they can take a long time or produce a lot of output. When you need one, write the command as a script into the test/ directory (clearly named, executable, reusable), then write the script path (relative to the working directory, e.g. test/build.sh) into tmp/test.sh to tell the DRIVER to run it, and end your turn to wait. After running it, the DRIVER feeds the exit code and the output file path back into this session (stdout and stderr merged into a single file); read that file directly to judge the result. To test again, write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running).{{#if handoverTest}} After the test is committed the DRIVER sometimes asks you to finish and write out the remaining work that does not depend on the test result, to write the test-related progress and next steps into {{testHandoffFile}}, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write {{testHandoffFile}} **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — that naming family is what the DRIVER observes to establish handover ordering, and writing it yourself is misread as a handover that happened. Record your interpretation of the test result and any corrections in the established artifact documents of this execution scope, or leave them to be folded into the handover document at the next handover.{{/if}}{{/if}}
