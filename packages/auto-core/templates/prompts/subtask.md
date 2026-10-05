{{> head}}

{{> ground-state}}

Current task:

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}{{#if precedence}}Authority order for everything in this prompt:
{{precedence}}

{{/if}}{{#if subtaskList}}The subtask list of this task, by title (executed in order; the other items belong to other sessions, do not touch them):

{{subtaskList}}

You are responsible for item {{index}} of that list only:

{{/if}}{{^subtaskList}}You are responsible for this single subtask of the task only:

{{/if}}- [ ] {{subtask}}
{{#if continuation}}
The previous session was interrupted by the context limit. First read {{handoffFile}} to learn the progress and the next steps, then carry on from there.
{{/if}}
{{#if warm}}{{#if digest}}This session has inherited the task-background digest: the text of docs/{{taskId}}/context.md is already in context, so do not re-read it. The files the understanding stage read are not in this context — read the ones this subtask needs.{{/if}}{{^digest}}This session has inherited the task-background context (the understanding stage's digest and loaded content), so do not re-read files that are already in context; if background is still missing, read the docs/{{taskId}}/context.md digest.{{/if}}{{/if}}{{^warm}}If docs/{{taskId}}/context.md exists, read it first to learn the task background before starting (if it does not exist, read the source yourself as needed).{{/if}}
{{#if todoFile}}This subtask's scope declaration is in {{todoFile}} (written during decomposition — read it first if it exists). {{/if}}If docs/{{taskId}}/shared.md (the shared-context index) exists, read the files it lists on demand and by reference. The completion decision for this subtask — whether it is done — is the DRIVER's, made once this session ends.

Verification: run the checks that target this subtask's own changes (its tests, the typecheck or build of what it touched), not the full suite.{{#if last}} This is the last subtask: once it is done, run the task's full acceptance verification once, for the whole task, and fix what it finds.{{/if}}

{{#if processRefs}}{{processRefs}}

{{/if}}Constraints:
1. Complete this one subtask strictly, and as soon as it is done, close out with the steps below and end the session, so as to keep the context of a single session small;
{{> question-rule}}
3. Close-out:
{{#if selfCheck}}   a. {{selfCheck}};
{{/if}}   b. you may add to the content of docs/ but not modify it (if a modification is unavoidable, {{^ask}}annotate it as AUTO-DECISION and {{/if}}record it in the relevant document).
{{#if budget}}

Context-budget protocol (this session manages its own context): the DRIVER watches this session's token usage and steers in one-line `[DRIVER] context: …` notices at milestones (about half the budget, then about 85%) — information, not interrupts; keep working. When the rest of this subtask would not fit the budget, hand over at a natural boundary — a coherent step finished, nothing half-edited: write into {{handoffFile}} (overwriting it) what a brand-new session continuing this subtask from that file alone needs — the progress so far, the key decisions, the verified facts and file paths, the dead ends, and the next steps — ending with `Status: continue` (subtask incomplete) or `Status: done` (subtask fully done) as its last line, a protocol string the driver parses, written verbatim and untranslated; then end the session. A "[DRIVER] This session's context has reached the wall" notice overrides everything above: write the file immediately and end the session.
{{/if}}

{{> eof-rule}}

{{#if artifactConvention}}{{artifactConvention}}

{{/if}}{{> doc-layout}}

{{> test-protocol}}
