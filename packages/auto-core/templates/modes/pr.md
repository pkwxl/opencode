# pr

## init
This plan belongs to a change-set scenario: the round's output is one review-ready change set (a pull request or an
equivalent review unit):
- Arrange the tasks toward a coherent, self-contained series: every task is a logical step of the one change set, not
  an independent venture;
- Tests and documentation are part of the change, planned with the behavior they cover — never a trailing task;
- Anything that does not belong to the one change set (an unrelated fix, a spotted refactor) is named and left out,
  not absorbed.

## exec
Change-set mode notes:
- Commit hygiene is part of the deliverable: one logical change per unit, no debug leftovers, no commented-out code,
  no noise diffs;
- The change set stays describable: a reviewer can read its units and tell what the change does and why; anything
  beyond a few sentences of description splits into its own task;
- Keep the diff minimal: no reformatting of untouched regions, no dependency churn beyond what the change needs;
- Record scope decisions (what was deliberately left out, what was split off) as AUTO-DECISION requires.
