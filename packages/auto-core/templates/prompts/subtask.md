{{> head}}

{{> ground-state}}

Current task:

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}{{#if subtaskList}}The complete subtask list of this task (executed in order; the other items belong to other sessions, do not touch them):

{{subtaskList}}

You are responsible for item {{index}} of that list only:

{{/if}}{{^subtaskList}}You are responsible for this single subtask of the task only:

{{/if}}- [ ] {{subtask}}
{{#if continuation}}
The previous session was interrupted by the context limit. First read {{handoffFile}} to learn the progress and the next steps, then carry on from there.
{{/if}}
{{#if warm}}This session has inherited the task-background context (the understanding stage's digest and loaded content), so do not re-read files that are already in context; if background is still missing, read the docs/{{taskId}}/context.md digest.{{/if}}{{^warm}}If docs/{{taskId}}/context.md exists, read it first to learn the task background before starting (if it does not exist, read the source yourself as needed).{{/if}}
{{#if todoFile}}This subtask's scope declaration is in {{todoFile}} (written during decomposition — read it first if it exists). {{/if}}If docs/{{taskId}}/shared.md (the shared-context index) exists, read the files it lists on demand and by reference. The todo.md/done.md state files are managed by the DRIVER alone: you must not create, rename or delete them — the completion decision for this subtask and the rename belong to the DRIVER.

{{> doc-layout}}

{{> eof-rule}}

{{#if artifactConvention}}{{artifactConvention}}

{{/if}}Constraints:
1. Complete this one subtask strictly, and as soon as it is done, close out with the steps below and end the session, so as to keep the context of a single session small;
{{> question-rule}}
3. Close-out:
{{#if selfCheck}}   a. {{selfCheck}};
{{/if}}   b. you may add to the content of docs/ but not modify it (if a modification is unavoidable, {{^ask}}annotate it as AUTO-DECISION and {{/if}}record it in the relevant document); {{> state-rule}}
   c. If the DRIVER inserts a "[DRIVER] This session's context is about to reach the limit" notice, immediately write {{handoffFile}} as that notice instructs (last line `状态: 继续|完成`, counting whether this subtask is complete) and end the session, so that a new session can continue from the handover document;
{{#if testByDriver}}
Test execution protocol (--test-by-driver): do not run compile, test, build, lint or similar commands directly inside the session — they can take a long time or produce a lot of output. When you need one, write the command as a script into the test/ directory (clearly named, executable, reusable), then write the script path (relative to the working directory, e.g. test/build.sh) into tmp/test.sh to tell the DRIVER to run it, and end your turn to wait. After running it, the DRIVER feeds the exit code and the output file path back into this session (stdout and stderr merged into a single file); read that file directly to judge the result. To test again, write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running).{{#if handoverTest}} After the test is committed the DRIVER sometimes asks you to finish and write out the remaining work that does not depend on the test result, to write the test-related progress and next steps into {{testHandoffFile}}, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write {{testHandoffFile}} **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — that naming family is what the DRIVER observes to establish handover ordering, and writing it yourself is misread as a handover that happened. Record your interpretation of the test result and any corrections in the established artifact documents of this execution scope, or leave them to be folded into the handover document at the next handover.{{/if}}{{/if}}
