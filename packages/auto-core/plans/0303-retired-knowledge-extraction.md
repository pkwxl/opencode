# 0303 — Remove the retired knowledge extraction helpers

## Category scope

Tier: push session removal. Premises this ruling changes: 0283 and 0296
retired the extraction sessions and ordered removal once their callers
were gone. Their dispositions stand. Historical knowledge remains input
to formulation.

## Decision

The caller census across core, CLI and daemon found two consumers in the
knowledge module: formulation builds its digest and index, and preflight
recognizes the path of the knowledge phase’s artifact. The former push
sessions’ output wrappers, existing-output checks, scan for extraction
inputs, completion check and temporary output path had only test callers
or references within that retired group.

Remove those helpers and their dedicated tests. Exercise the path
recognizer against the actual phase registry artifact. Keep the stable
prior-knowledge path, historical digest fixtures and the registered
template override markers. The pull executor consumes the same stored
documents through the same readers.

Derives: P10 (the live readers and their fixtures keep their behavior),
P18 (committed knowledge survives the writer) and P21 (the removed helpers
lost their production consumers with the extraction sessions).
