# 0251 — Executor park and creation recovery

Implements the dependency park recovery effect in 0249 D1 and a new-directory
creation preview under the 0249 slice 5 recovery contract.

An execute report can land a dependency park after the standing same-phase
and declared-artifact checks. Capture the blocker and previous registry
value in the share intent. Prove the park commit by its parent, tree and
lease-specific message before applying the registry effect. A matching
registry value allows receipt replay. The scheduler releases the parked
task when the blocker closes, and the resumed brief includes the existing
park-release note. The park record stays available for retries until
close-out or a later park supersedes it. Fix and verify keep their existing
verdict contracts.

Open creation uses the authenticated token identity and project name as
the durable retry identity. Root identity and canonical config bind the
request to that intent. The new directory is initialized through the
standing init operation inside private staging. A retry of incomplete init
restarts from an empty, identity-checked staging directory. Directory
descriptors pin filesystem use. No-replace rename publishes initialized
staging, and its filesystem identity binds registration to the published
directory. An existing directory continues through operator registration.
The preview serves direct children of declared Linux roots.

Same-project parallel leasing remains a freeze condition. This change
tests simultaneous leases across projects, including renewal, settlement
replay and rejection of a competing claim in the same project. The
current serial coordinator uses a single project HEAD and index as the
share witness. Parallel admission needs to tie each grant to a durable
workspace and per-unit progress, then attribute its delta and confine
staging before settlement. In a shared documentation tree, an ambiguous
writer must cause refusal. In worktree lanes, recovery must distinguish
the lease workspace commit from the subsequent project landing. Both
need overlap, expiry, restart and replay tests with another lease live.
