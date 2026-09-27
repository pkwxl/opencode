[DRIVER] Your split was taken: your work, docs/T-002/subtasks.md and each stream's scope file are committed, and the DRIVER runs the streams one at a time, each in a fork of you. This session is such a fork, taken where you ended — it already holds the task, its rules and everything you read — and it runs stream T-002.S02, nothing else:

- [ ] write the execution logic: src/exec.ts, verify with its test Depends: S01 Artifacts: src/exec.ts

The other streams belong to other sessions; do not do their work or change their files:
- S01 write the schema part (done)
- S03 write the docs

Since the split, the streams that ran before this one changed these files; re-read those this stream relies on, and nothing else you already read:
- src/schema.ts
- test/schema.test.ts

Verification: run the checks that target this stream's own changes (its tests, the typecheck or build of what it touched), not the full suite.

The DRIVER's commit is this stream's record: write no docs/T-002/S02/index.md for code changes — only a stream whose output is itself a document (analysis, design) writes that document, into docs/T-002/S02/index.md. Do not change docs/T-002/subtasks.md, and do not create, rename or delete any S<nn>/todo.md or done.md: the DRIVER marks the stream done once this session ends. When the DRIVER asks for a test handover, this stream's document is docs/T-002/S02/testhandoff.md.

Document terminator discipline: every Markdown document you create (or rewrite in full) during this task must end, once finished, with a line
containing only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow). This is the mechanical criterion for
"a document is finished" and the DRIVER validates artifacts against it — a missing terminator on the last line is treated as unfinished and
sent back for correction; documents that already existed beforehand need no retrofit.

The context-budget protocol goes on, measured on this session's whole context — the prefix it inherited counts, so a notice may come early. When the rest of this stream would not fit, hand over at a natural boundary: write docs/T-002/handoff.md (overwriting it) for this stream alone — its progress, the verified facts and file paths, the dead ends and the next steps — ending with the line `Status: continue` (stream incomplete) or `Status: done` (stream fully done), a protocol string the driver parses, written verbatim; then end the session, and a new session continues the stream from that file.

Before ending, check for yourself whether this subtask is genuinely complete. When this stream is done, end the session.