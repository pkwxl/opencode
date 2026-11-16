# fix

## init
This plan belongs to a known-issue fix scenario: the issues are identified and described, and the round exists to
resolve them:
- One issue per task, the smallest coherent diff that fixes it; scope stays fenced to the reported behavior;
- Arrange freely by priority and dependency — there is no prescribed order between fixes;
- An issue that turns out larger than a fix (a behavior change, a redesign) is named as such and made a task of its
  own, never silently widened.

## exec
Fix mode notes:
- Every fix lands with its regression test — a test that fails without the fix and passes with it;
- No refactors, dependency bumps or format-only changes ride a fix; each of those is a task of its own;
- State any behavior change a fix introduces in the task's report (a fix that changes observable behavior says so
  explicitly);
- Record fix trade-offs (a partial fix, a workaround with conditions) as AUTO-DECISION requires.
