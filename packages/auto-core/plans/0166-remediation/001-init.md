# Step 001 — Program initialization

- **Wave**: program (no register bucket; no finding dispositioned)
- **Status**: done 2026-11-05
- **Starting HEAD**: 5d5e427bf (branch `auto-core`, clean tree)
- **Record**: this file is its own step record.

## Scope

The initialization clause of the durable program (0166 §DURABLE PROGRAM, items 1–5): scope,
prescribed order, status table, coverage ledger, current position. Docs-only — `plans/` alone
is touched; no product code, no test homes, no ruling (Category scope: none, as 0166 records).

## Work log

- Read 0166 (the program), 0165 §0/§3/§5/§9/§10 (register + wave program), AGENTS.md.
- Extracted the 0165 register mechanically (escaped-pipe-aware table parse): 224 ids, 36
  buckets, no gaps or duplicates.
- Designed the 81-step schedule: the prescribed mainline order with the 16 standalone register
  buckets at dependency-appropriate positions (rationale recorded in the Program status
  section); each step sized for one 180-minute worker.
- Verified completeness mechanically before writing: every 0165 id in exactly one step,
  bucket fidelity (aliases `W-fork/W-lanes`→step 031, `W-shell-seam`→step 033; union 006
  enacted jointly by 010+011), 14 F-ids each exactly once. Two hand-design omissions were
  caught by this check and fixed (0165-142 added to step 013; the W-vocab step created for
  0165-134) — the check exists for exactly this failure mode.
- Wrote the three execution sections into `plans/0166-three-package-remediation.md` and
  updated its Status line.

## Verification

- Completeness script: `224 ids + 14 F-ids, 81 steps, buckets faithful`; ledger 238 rows.
- `bun typecheck` — clean. No suite run: docs-only change.

## Dispositions

None — initialization dispositions no finding. All 238 ledger rows remain `—`.

## Result

Committed with the program sections in the same change (one proper step). Next action for the
program: step 002 (w0-index-navigation).
