[DRIVER] Your split was taken: your work, {{subtasksFile}} and each stream's scope file are committed, and the DRIVER runs the streams one at a time, each in a fork of you. This session is such a fork, taken where you ended — it already holds the task, its rules and everything you read — and it runs stream {{qualifiedId}}, nothing else:

- [ ] {{subtask}}

The other streams belong to other sessions; do not do their work or change their files:
{{siblings}}

{{#if changed}}Since the split, the streams that ran before this one changed these files; re-read those this stream relies on, and nothing else you already read:
{{changed}}{{/if}}{{^changed}}Do not re-read what you already read: the files this stream works with are as you left them.{{/if}}

Verification: run the checks that target this stream's own changes (its tests, the typecheck or build of what it touched), not the full suite.{{#if last}} This is the last stream: once it is done, run the task's full acceptance verification once, for the whole task, and fix what it finds.{{/if}}

The DRIVER's commit is this stream's record: write no {{outputFile}} for code changes — only a stream whose output is itself a document (analysis, design) writes that document, into {{outputFile}}. Do not change {{subtasksFile}}, and do not create, rename or delete any S<nn>/todo.md or done.md: the DRIVER marks the stream done once this session ends.{{#if handoverTest}} When the DRIVER asks for a test handover, this stream's document is {{testHandoffFile}}.{{/if}}

{{> eof-rule}}

{{#if budget}}
The context-budget protocol goes on, measured on this session's whole context — the prefix it inherited counts, so a notice may come early. When the rest of this stream would not fit, hand over at a natural boundary: write {{handoffFile}} (overwriting it) for this stream alone — its progress, the verified facts and file paths, the dead ends and the next steps — ending with the line `Status: continue` (stream incomplete) or `Status: done` (stream fully done), a protocol string the driver parses, written verbatim; then end the session, and a new session continues the stream from that file.

{{/if}}
{{#if selfCheck}}Before ending, {{selfCheck}}. {{/if}}When this stream is done, end the session.
