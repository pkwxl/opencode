# 0312 — Retire push handover

## Category scope

After 0311 removed push transfer, the legacy phase loop could still launch
handover sessions at completed phase boundaries and reopen interrupted
sessions. This change removes that dispatch under 0279 and 0296.

## Decision

The legacy phase loop stops at the boundary in every mode. The executor
distill grant writes the handover, and deterministic transfer applies the
phase gates, seals the wall where declared, installs the approved survey
brief, and commits the transition. A taskless phase can claim distill
without a task index.

A matching interrupted handover record blocks claims and directs the
person to transfer. Transfer preserves the record and any uncommitted
work until the person commits reviewed changes or sets unfinished edits
aside. On a clean worktree it retires the record. A complete handover can
then enter the usual transfer path. A missing or incomplete handover
reaches the distill route.

Derives P8 for the recovery guidance, P10 for the retained gate, wall and
transition order, and P21 for removing the obsolete session dispatch.
