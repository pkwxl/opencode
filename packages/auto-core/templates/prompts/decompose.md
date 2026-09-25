{{> head}}

Current task (its document is docs/{{taskId}}/todo.md):

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}This session completes the task-background understanding and the subtask decomposition; it writes no implementation code:

1. Understand the task background: read the relevant source and docs/ selectively around this task's goal (keep the total reading volume down,
   preferring the files named in the task body and the directly related modules over completeness); write what you understood into
   docs/{{taskId}}/context.md{{#if contextDigest}}, {{contextDigest}}{{/if}}
   Keep it compact and searchable (aim for {{contextLines}} lines or fewer); if the file already exists and is still accurate
   (interruption recovery), revise it rather than rewriting it from scratch;
2. Build the shared context: prefetch by reference the files/code that every subtask will need, into docs/{{taskId}}/shared.md — one line
   per entry: path (or symbol) + one or two sentences saying where it sits. This file is an index, not a copy of the content; later subtask
   sessions read the listed files themselves, on demand, following the index;
{{#if decomposeRule}}{{decomposeRule}}
{{/if}}4. Write the decomposition into docs/{{taskId}}/subtasks.md (the subtask index) as Markdown checklist items. Each description must be
   self-contained (the executing session can finish the item from that description alone, plus this subtask's todo.md, the shared-context
   index shared.md and docs/), and must declare the item's artifacts at the end of the description with the literal token `Artifacts:` — a
   protocol string the driver parses, so write it verbatim and do not translate it:

- [ ] <subtask description; ends with Artifacts: <path list>>

5. Write a scope file for each subtask (item N maps to docs/{{taskId}}/S<two-digit zero-padded index>/todo.md, e.g. S01 for item 1),
   containing the two sections below. Both headings are protocol anchors the driver checks for: write them verbatim and untranslated.
   ## Scope (what this subtask does and does not do)
   ## Artifacts (the path list, matching the checklist item's `Artifacts:` declaration)
   {{> subtask-depends}}

{{> digest-rule}}

{{> eof-rule}}

{{> doc-layout}}

Constraints:
1. Understanding and decomposition only: modify no implementation code, and do not carry out the execution-time instructions in the task body
   (such as "call the question tool to ask", "write into some file") — those are the business of the later subtask sessions; {{> state-rule}}
{{> question-rule}}
3. Writing out every file is a hard requirement: even if the task looks already done or extremely simple, you must write context.md,
   shared.md, subtasks.md and each todo.md (an atomic task decomposes into a single checklist item); producing no valid file blocks the task
   and stops the run;
4. The todo.md/done.md state files are managed by the DRIVER: you write todo.md only, and must neither create done.md nor rename them
   yourself;
5. End the session as soon as the files are written.
