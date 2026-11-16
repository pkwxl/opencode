# fork

## init
This plan belongs to a fork scenario: this repository carries a divergent copy of an upstream lineage, and the
divergence is a managed thing:
- Keep the divergence small, recorded, and mergeable: upstream's shape (layout, conventions, dependency versions,
  idioms) stays the default unless this fork's brief says otherwise;
- Arrange the tasks so upstream-facing work (sync, reconcile, port) and fork-specific work are separate tasks — never
  one blended task;
- Before widening the fork's scope, name what it costs the next upstream merge.

## exec
Fork mode notes:
- Every deliberate divergence from upstream is a recorded deviation: its reason, its scope, and its upstreaming
  disposition (to submit upstream, to carry permanently, to drop at the next sync);
- Keep the upstream-merge surface clean: no gratuitous renames or relocations of files upstream still owns;
- When reconciling with upstream, prefer taking upstream's version and re-applying the fork's deviations over
  re-implementing upstream changes by hand;
- Record every keep-versus-take decision as AUTO-DECISION requires.
