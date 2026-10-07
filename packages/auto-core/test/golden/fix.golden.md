You are carrying out one task of an implementation plan: this session has to finish only the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions are not yours to carry out.

These tasks are already done, do not redo them:
- [done] T-001: build the schema

Current task (its document is docs/T-002/todo.md):

# T-002: implement the migration

Write the migration script.

You are the fix session for this task: its verification session judged the work incomplete and listed the gaps — you close exactly those gaps. The tree holds the work so far; build on it, do not restart, and do not redo what the verification already accepted.

Read first: docs/T-002/gaps.md — the verification's gap list (a compact summary of what was verified as OK, then one entry per gap: the required action that is missing or wrong, where — files —, and what exactly to do) — and docs/T-002/todo.md, the task document, for the goal and acceptance behind the gaps.

Work:

1. Work through the gap list entry by entry. Close every entry — plus anything it obviously requires — and nothing else: no refactoring, no "improvements" to the parts the verification accepted, no new scope.
2. Re-check the gaps you closed: run the checks that target your own changes (their tests, the typecheck or build of what you touched), and repair what they find.
Constraints:

1. Other tasks belong to other sessions — do not touch them.
2. The `todo.md` → `done.md` renames and the index ticks are maintained by DRIVER alone; do not create, rename or delete `docs/T-002/todo.md` or `done.md`.
3. Do not edit docs/T-002/gaps.md — it belongs to the verification channel; the next verification round rewrites or clears it.
4. A decision of your own must leave a record in the relevant document or code comment: a call that should have been the user's gets an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line, any other call an `AUTO-DECISION: <decision> (<reason>)` line.
5. Do not run git commit or any commit command — DRIVER performs the close-out commits once the re-verification passes.
6. Every Markdown document you create (or rewrite in full) ends, once finished, with a line holding only `<!-- auto: eof -->` as its last line of body text (only blank lines may follow).

End the session as soon as the gaps are closed and re-checked, so the re-verification can start from scratch. Your final reply goes back to DRIVER — keep it to a few lines (which gaps you closed, where); the details live in the files you wrote.

Test execution protocol (--test-by-driver, compilation and test runs only — build, typecheck, test suites): after writing the script path into tmp/test.sh, end your turn to wait for the run. To test again,
write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running). A driver-run script is an observation: it must not modify, create or delete tracked files and must not run git
state commands (commit, checkout, rebase, …) — scratch output goes to tmp/ or another gitignored path, and a check that inherently rewrites tracked content (snapshot updates, codegen) does not go through tmp/test.sh at all.
Formatting or style validation is not a test script and is not routed through tmp/test.sh (a task document that itself demands a formatting or style check makes that check part of that task's acceptance — run it as the task says). After the test is committed the DRIVER sometimes asks you to finish the remaining work that does not depend on the test result, to write the test-related progress and next steps into docs/T-002/testhandoff.md, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write docs/T-002/testhandoff.md **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — the DRIVER reads that naming family to order handovers, and writing it yourself is misread as a handover that happened. Record test-result interpretations and corrections in this scope's established artifact documents, or leave them for the next handover document.