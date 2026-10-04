{{> head}}

Current task (its document is docs/{{taskId}}/todo.md):

{{taskBlock}}

{{#if modeExec}}Scenario mode notes ({{modeName}}):
{{modeExec}}

{{/if}}This session completes the task-background understanding and the subtask decomposition; it writes no implementation code. The current phase is {{phaseName}}:

1. Understand the task background: read the relevant source and docs/ selectively around this task's goal (prefer the files named in the
   task body and the directly related modules over completeness); write what you understood into
   docs/{{taskId}}/context.md{{#if contextDigest}}, {{contextDigest}}{{/if}}
   Keep it compact and searchable (aim for {{contextLines}} lines or fewer); if the file already exists and is still accurate
   (interruption recovery), revise it in place;
2. Build the shared context: prefetch by reference the files/code every subtask will need into docs/{{taskId}}/shared.md — one line per
   entry: path (or symbol) + one or two sentences saying where it sits; an index, not a copy — subtask sessions read the listed files
   themselves, on demand;
{{#if decomposeRule}}{{decomposeRule}}
{{/if}}{{#if phaseDuties}}{{phaseDuties}}
{{/if}}5. Write the decomposition into docs/{{taskId}}/subtasks.md (the subtask index) as Markdown checklist items. Each item opens with a
   short title and a colon (the other subtask sessions see only the titles of the items that are not theirs); the description must be
   self-contained (the executing session can finish the item from it alone, plus the item's todo.md, the shared-context
   index shared.md and docs/) and ends with the item's artifacts after the literal token `Artifacts:` — a
   protocol string the driver parses, so write it verbatim and do not translate it:

- [ ] <short title>: <subtask description; ends with Artifacts: <path list>>

{{#if parallelRules}}

Subtask parallelism ({{parallel}}): this project runs independent subtasks side by side, each in its own isolated execution lane. Apply the
level's discipline below to the checklist items — `Depends:` names only real prerequisites, `Artifacts:` lists every file the item will change,
and two items that would change the same file are ordered with `Depends:` instead:

{{parallelRules}}

{{/if}}
6. Write a scope file for each subtask (item N maps to docs/{{taskId}}/S<two-digit zero-padded index>/todo.md, e.g. S01 for item 1),
   containing the two sections below. Both headings are protocol anchors the driver checks for: write them verbatim and untranslated.
   ## Scope (what this subtask does and does not do)
   ## Artifacts (the path list, matching the checklist item's `Artifacts:` declaration)
   {{> subtask-depends}}

Constraints:
1. Understanding and decomposition only: modify no implementation code, and do not carry out the execution-time instructions in the task body
   (such as asking a question, writing into some file) — those are the business of the later subtask sessions.
{{> question-rule}}
3. Writing out every file is a hard requirement: even if the task looks done or trivial, you must write context.md,
   shared.md, subtasks.md and each todo.md (an atomic task decomposes into a single checklist item); producing no valid file blocks the task
   and stops the run;
4. You write each subtask's todo.md only — never done.md;
5. End the session as soon as the files are written.

{{> eof-rule}}

{{> digest-rule}}

{{> doc-layout}}

<!-- auto: eof -->
