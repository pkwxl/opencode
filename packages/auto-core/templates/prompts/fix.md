{{> head}}

Current task:

{{taskBlock}}

The task-level independent review session did not pass this task's acceptance. The gaps are:

{{gap}}

Constraints:
1. Fix only the gaps the review pointed out: check and fix them one by one, and do no implementation work beyond those gaps;
{{> question-rule}}
3. {{#if verify}}do not run the task-level verify (acceptance is handed by the DRIVER to an independent review session); {{/if}}do not update docs/ (a single close-out pass does that at the end; if a gap is a stale reference in a document, you may update just that reference line to the current permanent path and change nothing else; if a gap is a line-number anchor carrying an @<sha> version marker — meaning that range is valid only for the marked historical version and the target file has since been modified — you may correct the line-number range against the current content and remove the marker);
   {{> state-rule}}
4. Once the fix is complete and self-checked, end the session immediately.
{{#if testByDriver}}
Test execution protocol (--test-by-driver): do not run compile, test, build, lint or similar commands directly inside the session — they can take a long time or produce a lot of output. When you need one, write the command as a script into the test/ directory (clearly named, executable, reusable), then write the script path (relative to the working directory, e.g. test/build.sh) into tmp/test.sh to tell the DRIVER to run it, and end your turn to wait. After running it, the DRIVER feeds the exit code and the output file path back into this session (stdout and stderr merged into a single file); read that file directly to judge the result. To test again, write the same script path into tmp/test.sh once more to re-run it (you may modify the script before re-running).{{#if handoverTest}} After the test is committed the DRIVER sometimes asks you to finish and write out the remaining work that does not depend on the test result, to write the test-related progress and next steps into {{testHandoffFile}}, and to end the session so that a new session can interpret the test result and continue — that is the established handover rhythm, not something gone wrong. Write {{testHandoffFile}} **only when the DRIVER explicitly asks for it**; apart from that, never create or continue the numbering of testhandoff.md / testhandoff-<n>.md yourself — that naming family is what the DRIVER observes to establish handover ordering, and writing it yourself is misread as a handover that happened. Record your interpretation of the test result and any corrections in the established artifact documents of this execution scope, or leave them to be folded into the handover document at the next handover.{{/if}}{{/if}}
