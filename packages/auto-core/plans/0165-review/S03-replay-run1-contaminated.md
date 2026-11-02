# Falsification replay: six questions answered from docs/principles.md alone

Source read: `/workspace/aseo/opencode/packages/auto-core/docs/principles.md` (490 lines). No other repository file was read, grepped or listed; no git log; no web.

## Isolation breach: read this first

I followed the read rule, but the isolation was still breached. Before my first tool call, the harness put `packages/auto-core/AGENTS.md` into this agent's context (the "project instructions" system reminder, loaded because the working directory is this package). That file's navigation section names the actual ruling for every one of the six questions:

- Q1: "0145 the foreign-commit adoption on the unexpected-interruption resume — never a stop"
- Q2: "0139 — fork and remove-fork take no run lock"
- Q3: "0150 the floor derivation" / "the `.auto/next-task` record and its AI recovery session retired"
- Q4: "the progress-based fix budget — two consecutive no-gap rounds block, progress extends the loop, 0146"
- Q5: "`info` the recorded-state note class … no person act, no gate failed, 0135; the supersession note divergence-only … agreement silent — 0136"
- Q6: "the session handover and the wrap-up entry exit boundaries since 0143"

So these answers are **not blind**. For each question I give the decision I can derive from the constitution's text, plus a **blind estimate**: whether a reader without AGENTS.md would probably land on the same side. To get a valid run, use a subagent whose working directory is outside `packages/auto-core` (or one that loads no project instructions) and give it `principles.md` by absolute path.

There is a second, independent caveat. **Q4's answer is written into the constitution itself** (l.61), so even a clean run tests recall on Q4, not derivation.

---

## Q1: foreign commits found in the interrupted unit's range on resume

**(a) Decision.** Adopt the commits as the interrupted unit's progress and continue, with no stop. Record one surfaced line naming the foreign commits. The unit still completes only through the driver's fresh verification and unified commit.

**(b) Deciding principles.**
- **P4** (l.96): "foreign commits are never rolled back — 'the authority over git state belongs to a human'". The person's commit is an exercise of that authority, so the driver neither reverts it nor sits in judgment on it.
- **P2** (l.51): committing and then re-running is the person's own act. A stop would ask the person to make again a decision they have just made, and the re-run is the person's bracket.
- **P8** (l.199): "blocking is reserved for the stop's own work and the person's moments". The person's moment has already happened, so the right enforcement here is to record, not to block. A stop would also have no remedy to teach except history surgery.
- **P6** (l.176, l.183): recovery re-derives from disk and git. The resume reads the tree as it now stands, which keeps it crash-isomorphic.
- **P20** (l.391): in-flight work is never destroyed. The resumed unit continues from its persisted progress.
- **P3** (l.71, l.78): adopting does not weaken completion. The commits are not a session's narrative, and the fresh verification still "judg[es] every … criterion by inspection of the work".

**(c) Opposing pulls.**
- **P4 itself**: l.95 "every commit in `baseline..HEAD` carries the driver trailer" and l.99 "The person must not hand-commit inside a unit's range — it breaks the SHA-baseline audit". These lose because the audit protects the driver's exclusive commit right against AI sessions (l.94 "AI sessions never run commit-type commands"), and l.96 places authority over git with the person. Adopting does require l.99 to be restated, though, and that is an amendment, not a derivation.
- **P12 / P6 strict resume**: l.247 "always conservative toward dirty / foreign commits present" and l.185 "uncertainty → no reuse, roll back to the unit baseline". These lose because rolling back foreign commits is forbidden (l.96), which leaves the conservative branch with only a dead-end stop as an executable form. Conservatism is kept instead by P3's fresh verification of the resulting tree.

**(d) Confidence: low. The constitution is not sufficient; I had to guess.** The text contradicts itself (l.95/99/185 against l.96) and never says whether a re-run counts as the person's consent. A blind reader leaning on l.95, l.99 and l.247 could defensibly answer "stop for the person". My pick matches the injected 0145 line, and I cannot certify I would have reached it blind. Blind estimate: about 50/50.

---

## Q2: does the experiment-worktree (fork) command need the run lock?

**(a) Decision.** No. The command takes no run lock and may run beside a live run.

**(b) Deciding principles.**
- **P5** (l.147, l.157): the per-directory lock enforces one writer per state kind. The fork writes no state kind the run owns. Its reserved branch family and its worktree registration are its own slice, and the fork is their sole writer.
- **P17** (l.347): concurrency is admitted on declared disjoint scopes. A reserved branch namespace is a structural declaration of disjointness, so serialization is unnecessary.
- **P8** (l.199): refusing would block the person at a moment that is not the command's own work. Whether a run is live has no bearing on the experiment's correctness.
- **P2 / R5** (l.486, person-gate throughput): the person can prepare the retry while the long unattended span keeps running.
- **P20** (l.391): the fork touches nothing the run has in flight.

**(c) Opposing pull.** P17's "one sole writer of shared git state" (l.347): the ref store and the worktree list are physically shared git state of the repository the run commits into. P12's conservatism also pulls toward the lock. Both lose because the slices are disjoint by name (no run writes the reserved family), git's own ref and worktree locking makes each write atomic, and the lock's scope (l.157) is the driver's directory state, not every git write. One residual: a matching teardown command must still refuse a run that is live *inside the fork*, because that state belongs to the fork.

**(d) Confidence: medium-high. The constitution is mostly sufficient,** but it is silent on the lock's exact scope, which l.157 states only as "One lock per directory". Blind estimate: likely the same answer.

---

## Q3: next task number from a persisted record (A) or derived from artifacts (B)?

**(a) Decision.** Option B: derive highest+1 from the surviving index lines and task directories each time, and keep no record.

**(b) Deciding principles.**
- **P6** (l.176, l.178): "Prefer state derived from durable evidence … over newly persisted state", and "derived, with zero new rot-prone state". A recovery procedure for a lost record is exactly the symptom this principle exists to remove: "every recovery re-derives from disk rather than trusting memory or self-report".
- **P3** (l.71, l.80): "flow and recovery advance on driver-persisted evidence, never on a session's narrative". An AI side session reconstructing a counter is recovery by narrative.
- **P5** (l.147): a next-number record is a second source of truth beside the artifacts that actually carry the numbers, and the option's own wording ("lost or inconsistent") admits the drift.
- **P7** (l.107): the id is a grammar the driver defines. Settling it with an AI session moves a grammar question into the judgment layer.
- **P18** (l.126): a fresh clone or fork carries the committed artifacts but not driver-local runtime state. Under B it continues correctly; under A it resets or needs the recovery path.
- **P12** (l.242): highest+1 is the conservative direction.
- **P21 / P19**: the AI recovery session is compensation machinery that loses its consumer once derivation exists.

**(c) Opposing pull.** P6's own tension (l.191, "Some state must persist") and the uniqueness goal itself. After a ruled deletion of the highest-numbered unit (l.134, "Deletion is safe only after distillation") or after a wipe-and-restart, B re-issues a number that history already used. This loses because A fails in the same cases and worse ones (the record goes missing exactly at the clone, fork or wipe). The residual should be named as an explicit open gap (P19, l.383): uniqueness holds among surviving artifacts, and any consumer that scans git history bounds its scan at the id's latest introduction.

**(d) Confidence: high. The constitution is sufficient;** P6 and P3 decide it directly. Blind estimate: the same answer.

---

## Q4: budget for fix rounds

**(a) Decision.** Use a progress-gated budget instead of a fixed cap. Fix rounds continue while they make progress, and the unit blocks for the person after **two consecutive rounds with no progress**. Progress means reaching a **new minimum** open-gap count (best so far), which keeps the loop provably bounded. The escalation chain is fix rounds, then `--repair`, then the person.

**(b) Deciding principles.**
- **P2** (l.61) states the rule almost word for word: "fix rounds (progress-gated, never count-capped — two consecutive no-gap rounds block, 0146 amending 0083 D5) → `--repair` → the human". l.51 adds "every automatic escalation is bounded, and the terminal of every bounded path is the person".
- **P20** (l.391): a fix loop that is converging is in-flight work. A count cap halts it on an arbitrary number when the next round would have closed it.
- **P3** (l.78): each re-verification is a fresh, independent session, so progress is measured from the driver-parsed verdict and gap list, never from what the fix session claims.
- **P8** (l.199): the block lands when the loop stops converging, which is the stop's own work, rather than at a preset count.
- **P19** (l.369): a fixed count is a pre-emptive number, while the progress rule is ruled from evidence.

**(c) Opposing pull.** P2's boundedness (l.51). Read on its face, "never count-capped" can loop forever if each verification keeps finding new gaps. T2 (l.467) also pulls: each round buys a fresh verification session. This loses only if progress is measured against the best-so-far minimum. Each progress round then sets a strictly lower minimum, so there are at most N of them (N = the initial gap count), and at most one non-progress round can sit between two of them, so the loop runs at most about 2N+2 rounds and ends at the person. Measuring progress against the previous round alone is **not** bounded: 5→4→6→5→7→6… alternates forever without two consecutive strikes.

**(d) Confidence: high, but this is not a derivation test.** The answer is in the constitution's text (l.61). Its wording is also ambiguous (see the final section).

---

## Q5: a config check meeting an expected, designed posture

**(a) Decision.**
- **When the two sources agree:** stay silent, with no finding, no note and exit 0.
- **When they disagree:** surface one **informational note**, not an exit-1 finding. The note names both values, which source governs, and how to reconcile them (amend the key, or change the authoritative source), and the command exits 0.

**(b) Deciding principles.**
- **P8** (l.199, l.201): "every surfaced line teaches the remedy it wants". A designed posture has no remedy. A finding would be noise that trains the person to ignore the command, and a fix would invite "cleaning up" what the design keeps. Exit 1 is reserved for state that needs the person to act.
- **P5** (l.156): the config is the person's, "revised per-key by amend, repaired by rule by fix". The checker has nothing it may repair here, and when the values agree, nothing manual is pending either.
- **T5 / P9** (l.432, l.470): quiet surfaces, with nothing enumerated unless the list is the work.
- **For disagreement, P12 and P2:** l.248 and l.278 say "never silent precedence", and l.51 says the person's decisions are never taken silently. The person must be told that their config value is not the one in force. The authoritative source is itself a later act by the person, though, and the behavior is correct by design with no gate failed. That makes the right class informational, not the drift gate.

**(c) Opposing pulls.**
- **Agreement, P12 "never silent precedence":** this could argue for always noting the supersession. It loses because when the values agree, precedence changes no behavior, so there is nothing being silent about.
- **Disagreement, P5 "no mirrors, no second sources of truth" (l.147):** this frames a divergent dormant key as drift, which argues for an exit-1 manual finding. It loses because the design has already ruled one source authoritative. The config key is an inert earlier statement, not a competing source, and the person needs knowledge, not an act. Under P8 the finding's moment has not come.

**(d) Confidence: medium for "silent on agreement"; medium-low for the severity on disagreement.** The constitution is partly silent: it defines no class between "finding" and "silent", and it never mentions a config key being superseded by another source (see the final section). Blind estimate: "silent on agreement" is likely. On disagreement, a blind reader is about evenly split between an info note and an exit-1 manual finding.

---

## Q6: where a graceful `/exit` takes effect during a long task

**(a) Decision.** At the **next internal safe boundary**, meaning the session handover point or the wrap-up (verification) entry, whichever comes first. Not immediately, and not deferred to the task's close.

**(b) Deciding principles.**
- **P20** (l.391, l.401): "control changes land only at safe boundaries" and "`/exit` deferred to the **next** safe boundary (0014)". The rule says the next boundary, not the unit's close.
- **P6** (l.183): `/exit` is "a scheduled stop at an existing safe boundary, 'fully isomorphic to the recovery path of any real crash/kill interruption'". A handover point passes that test: the session has ended, the driver has committed (P4, l.94: "after any session the driver recursively commits"), and the handover document and the progress record persist, so a resume re-derives from them. The wrap-up entry passes too.
- **P3 / T2** (l.78, l.467): wrap-up is a fresh session with "no context re-buy", so pausing at its entry loses nothing.
- **P2** (l.51): the person's request is honored at the earliest point that destroys nothing, not possibly hours later at the task's close.

**(c) Opposing pulls.**
- **Toward the task's close:** P20's "in-flight work is never destroyed" could argue for the most conservative boundary, since a mid-task resume depends on the handover being persisted correctly. P10's floor (the older close-only behavior) pulls the same way. Both lose because the handover is designed to carry context through persisted documents, and l.183's crash-isomorphism test is met.
- **Toward immediately:** P20 rules this out directly, because a stop now would kill a running turn. The immediate path already exists as the person's force stop (double Ctrl+C, P20 tension at l.406).

**(d) Confidence: high for "not immediately"; medium-high for "the next internal boundary".** The constitution is mostly sufficient: it never defines "safe boundary", but l.183 supplies the test. Blind estimate: likely the same answer, though l.401's unit-grain examples could pull a blind reader toward "the task's close".

---

## Where the constitution is silent, ambiguous or self-contradictory

1. **Q1: P4 contradicts itself, and P6 joins the conflict.**
   - l.95: "every commit in `baseline..HEAD` carries the driver trailer"
   - l.96: "foreign commits are never rolled back — "the authority over git state belongs to a human""
   - l.99: "The person must not hand-commit inside a unit's range — it breaks the SHA-baseline audit — 0076."
   - l.185: "Strict resume's fidelity bar: uncertainty → no reuse, roll back to the unit baseline"
   - l.247: "always conservative toward dirty / foreign commits present"

   On the interrupted-resume path, purity (l.95) plus rollback under uncertainty (l.185) cannot both hold alongside never rolling back foreign commits (l.96). The text is also silent on two points: whether re-running counts as the person's consent, and how a person's commit is told apart from an agent's. If adoption is the ruling, l.99 now states a prohibition the system tolerates, and the constitution text itself would mislead.

2. **Q2: the lock's scope is unstated.** l.157 says only "One lock per directory (`.auto/run.lock`)", and it does not say which commands must take it. l.347 says "one sole writer of shared git state" without defining whether the repository's ref store and worktree list count as shared git state.

3. **Q3: sufficient, with one silence.** Id uniqueness under deletion is never addressed: l.134 ("Deletion is safe only after distillation … git history retains everything") permits deleting the top unit, after which derivation re-issues its number. l.272 ("Tombstoned key names never reused") covers config keys, not task ids.

4. **Q4: four problems.**
   - (i) The answer is in the text (l.61), so the question cannot falsify anything.
   - (ii) **Ambiguous wording.** l.61's "two consecutive **no-gap** rounds block" literally reads as "a round that found no gap", which is a PASS, the opposite of what is meant ("a round that closed no gap" or "made no progress").
   - (iii) **Tension.** l.61's "never count-capped" sits against l.51's "every automatic escalation is bounded". No progress measure is stated, so the text alone does not guarantee boundedness (see Q4(c)).
   - (iv) **Self-contradiction with the tier rule.** l.61 embeds a numeric threshold ("two consecutive"), while l.18 says "Mechanical, testable, right-or-wrong-by-inspection rules are concrete requirements; they live with their mechanisms … never in this constitution", and l.453 says "Formats, grammars, exit codes, thresholds and security mechanics stay in code headers … never in this constitution". This is a small case of the creep the risk register warns about (R4, l.485).

5. **Q5: no severity class between finding and silence; supersession absent.**
   - l.278 names only "The exit-1 findings convention of fix/sync deviates from exit-2 wording deliberately". No informational, expected-posture class exists in the constitution.
   - l.67 ("The roadmap governs establishment but the config stays constitutional") and l.156 ("The config layer is constitutional") never say a config key can be superseded by another source. A blind reader could take l.67 to mean the config wins.
   - l.147 ("no mirrors, no second sources of truth") sits uneasily with a design-sanctioned dormant key.

6. **Q6: "safe boundary" is undefined.** l.183 and l.401 use it without a definition. l.401's examples ("hibernate stops at unit ends", "windows gate dispatches, never running turns") are all unit-grain or dispatch-grain, which could steer a reader toward "the task's close". l.183's crash-isomorphism clause is the only usable test, and it does decide the question.

**Overall reading.** The constitution plainly predicts Q3 and Q6, and probably Q2. It contains Q4 outright. On Q5 it is incomplete about severity classes, and on Q1 it is internally contradictory, so it would probably not have predicted the "adopt, never a stop" ruling unaided.
