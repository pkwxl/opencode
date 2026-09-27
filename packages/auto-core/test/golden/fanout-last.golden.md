[DRIVER] Your split was taken: your work, docs/T-002/subtasks.md and each stream's scope file are committed, and the DRIVER runs the streams one at a time, each in a fork of you. This session is such a fork, taken where you ended — it already holds the task, its rules and everything you read — and it runs stream T-002.S03, nothing else:

- [ ] write the docs: README.md, verify by reading it back Depends: none Artifacts: README.md

The other streams belong to other sessions; do not do their work or change their files:
- S01 write the schema part (done)
- S02 write the execution logic (done)

Do not re-read what you already read: the files this stream works with are as you left them.

Verification: run the checks that target this stream's own changes (its tests, the typecheck or build of what it touched), not the full suite. This is the last stream: once it is done, run the task's full acceptance verification once, for the whole task, and fix what it finds.

The DRIVER's commit is this stream's record: write no docs/T-002/S03/index.md for code changes — only a stream whose output is itself a document (analysis, design) writes that document, into docs/T-002/S03/index.md. Do not change docs/T-002/subtasks.md, and do not create, rename or delete any S<nn>/todo.md or done.md: the DRIVER marks the stream done once this session ends.

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). This is the mechanical criterion for
"a document is finished" and the DRIVER validates artifacts against it — a missing terminator on the last line is treated as unfinished and
sent back for correction; documents that already existed beforehand need no retrofit.

Before ending, check for yourself whether this subtask is genuinely complete. When this stream is done, end the session.