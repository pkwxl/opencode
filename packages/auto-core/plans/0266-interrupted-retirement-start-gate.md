# 0266 — The interrupted retirement finished at the start gate

Discharges [0264](0264-adoption-standdown-findings.md) finding 02 (the
advance's own writes orphaned at the next run's gate). Derives P6 (the
recovery is re-derivation: the working tree's bytes proven exactly the
tool's own deterministic write over the committed baseline — the same
content-proven shape as 0198's moved marker — and the proof one home,
`stampWallClosure` the same single derivation the finisher writes with),
P4 (the finish commit a driver commit through `commitTree`, the driver's
own record family, scoped to exactly the proven file), P8 (the ↻ line
teaching what was recovered and from which wall commit; every unproven
shape keeping the standing refusal and its teaching byte-identical), P10
(the floors: another file besides the config, bytes the derivation does
not reproduce — a person's edit —, no wall declared, or an already-clean
tree whose idempotent derivation proves nothing: all answer false and the
refusal is the unchanged generic line), P12 (a finish commit that fails
falls to the refusal naming the file — the commit's own ⚠ lines spoke;
never a silent pass), P20 (in-flight work never destroyed nor escalated:
the orphaned write recovered by the next run, the person's hand-commit
— the field's `5306a21` — the shape this retires), and P19 (the measured
chain the consumer: the handover's retirement write into the tracked
`opencode.json`, the advance blocked at the admission scan, run-000004's
gate refusing exactly that file). Amends none. Tier: mechanism.

## Category scope

Tier: mechanism (code home `src/wall.ts` (`finishInterruptedRetirement`,
the recognition and the finish) + `src/loop-preflight.ts` (the start
gate's finish-and-re-gate pass); test home `test/wall.test.ts`).

Premises this ruling changes: none. Re-read in this change: **0189**
(stands — `wallBoundary`'s finisher and the precheck's read-only half
unchanged; its letter "the advance itself finishes" gains the start-gate
mirror for the one interruption shape the advance cannot reach — its own
write dirties the tree the advance needs committed, and the re-run remedy
its failed-close arm teaches is refused by the same gate), **0149**
(stands — the active-progress exemption is evaluated first and takes the
whole dirty verdict; the two arms cannot coexist, a blocked advance
carrying no unit record), **0155 D1/D2** (stand — the unreadable verdict
answers before any exemption, and the gate's re-derivation after a finish
re-reads strictly), **0236 D5** (stands — `driverLeftoverLines`' teaching
families unchanged; the retirement moves from person-taught to
machine-recovered, the remaining families keeping their lines), **0132
D2's record grammar** (stands — and is the reason the finish commit rides
the housekeeping stage, never "wall": `findWallCommit` takes the most
recent `Auto-Stage: wall` body as THE record, and the finish commit
carries no door ledger).

## The ruling

**The recognition.** When the start gate answers dirty with exactly one
file — the tracked `opencode.json` — over a declared wall with a found
record, the gate asks one question: are the working tree's bytes exactly
`stampWallClosure(HEAD's bytes, the record's door targets)`, and do they
differ from HEAD's? Yes is the tool's own finished retirement write,
content-proven over the committed baseline the advance ran on (the
advance runs only on a committed tree, so the baseline the write rode is
HEAD; the derivation is deterministic and idempotent, so an already-
retired HEAD reproduces itself and proves nothing — the guard). No —
another file besides, no record, bytes the derivation does not reproduce
(a person's edit on the same file included) — is the caller's standing
refusal, byte-identical (P10).

**The finish.** Proven, the gate commits the file through `commitTree`
scoped to exactly it: subject `PLAN wall retirement (interrupted
advance)`, the **housekeeping** stage (a driver commit for every audit;
never the wall stage, whose record scan the finish commit must not
shadow), the body naming the wall commit and the recorded targets — the
commit is the wall family's own record of its own recovered write. A
failed commit answers false and the standing refusal names the file (the
commit's ⚠ lines already spoke, P12). One ↻ line logs the recovery.

**The gate's pass.** The start gate's dirty branch becomes at most one
finish-and-re-gate pass: the 0149 active-progress exemption first
(unchanged, whole-verdict), then the finish attempt, then — on a finish —
`beginUnit` re-derived so the baseline this run audits from includes the
finish commit; a still-dirty second read takes the standing refusal
(single-shot, never a loop). The unreadable verdict answers before all of
it, unchanged.

**The declines.** Finishing at `wallPrecheckFindings` (the person-facing
half stays read-only, its letter unchanged); re-running `retireAndDeny`
itself at the gate (the write is already on disk — the gate's duty is
recognition and commit, and a write-on-absence would be a second
mechanism where a proof suffices); a general "driver writes self-heal"
family (P21 — the one measured shape is enacted; the other record-less
kill windows keep their `driverLeftoverLines` teaching until their own
field evidence names them).

## Tests

`test/wall.test.ts`, the `interrupted()` fixture over a real closed wall
(the pre-retirement bytes committed as the advance's baseline, the
retired bytes left uncommitted — the measured evening's shape): the
proven write **committed** (the housekeeping stage, the body naming the
corpus target, the diff exactly `M opencode.json`), `findWallCommit`
**still reading the real record** (the finish commit out of the scan),
the start gate itself passing `ok` over the finished tree; the
**already-clean guard** (a second pass over the retired HEAD changes
nothing, HEAD byte-stable); and the **floors** — a person's edit on the
same file (nothing commits, the bytes stay), a second dirty file beside
the write (not the single-file shape), and no wall declared — all false
for the caller's refusal. The standing suites green: wall 33,
loop-preflight, transfer, the five reconciliation suites; `bun typecheck`
exit 0.
