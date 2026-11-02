# Falsification replay: six design questions answered from `principles.md` alone

I read only `./principles.md` (490 lines). Every citation below is a P-id or a line number in that file.

---

## Q1: Commits from the person inside a unit's range on resume

**(a) Decision.** The driver stops for the person. It neither adopts those commits nor rolls them back, and the stop names the commits and tells the person what they can do next.

**(b) Deciding principles**
- **P4 (contract-grade).** Adopting would break close-out purity. "every commit in `baseline..HEAD` carries the driver trailer" (l.95), and "a unit completes only through its unified commit" (l.89). The constitution already names this exact act: "The person must not hand-commit inside a unit's range — it breaks the SHA-baseline audit" (l.99).
- **P4 again.** Rolling back is also forbidden: "foreign commits are never rolled back — 'the authority over git state belongs to a human'" (l.96). With adopt and roll back both ruled out, stopping is the only option left.
- **P12.** Readings resolve "always conservative toward dirty / foreign commits present" (l.247). "Foreign commits present" is a halt state, not something the driver repairs.
- **P2.** The commit was the person's act. If the driver took it into its own unit, the person's act would be "consumed as closed" silently (l.51). The terminal of this path is the person.
- **P8.** The stop must teach its remedy (l.199). Two sanctioned paths exist: `close` with the `Closed:` field if the person considers the unit done (l.98, and P3 "or when a person closed it", l.71), or the person reverts or resets by hand and runs the driver again. Any "accept as new baseline" option has to be a command the person runs explicitly, never the driver's default.

**(c) Pulling the other way**
- **P6** says recovery re-derives from disk, and the work is on disk and committed.
- **P20** says in-flight work is never destroyed.
- **R5 / the exchange** favour unattended throughput.

They lose because stopping destroys nothing: no rollback happens, since P4 forbids it. P6 is Tier II and P4 is a Tier I contract. Also, re-derivation can't decide the question: whether a partial hand commit counts as the unit's work is a judgment the person makes, not something git can show.

**(d) Confidence: high.** The constitution was enough; l.96 and l.99 together nearly decide it. The one remaining tension is l.185 (see the gaps section).

---

## Q2: Must an experiment-worktree command take the live run's lock?

**(a) Decision.** No. The command doesn't take the run lock and doesn't refuse while a run is live. It does keep exclusive ownership of its own reserved branch name, and it fails loudly if git's own lockfiles collide.

**(b) Deciding principles**
- **P5 (single ownership, state scope).** Each state kind has one home and one writer. The run lock guards the run's state: that directory's `.auto/`, working tree, index and HEAD. The command writes none of these. Its reserved branch and worktree registration are a different state kind, and the command is their only writer. Making it take another owner's lock would mix two ownership domains.
- **P17.** "disjoint scopes mean no shared mutable path, so isolation is unnecessary rather than merely expensive" (l.355). If the disjointness claim turns out to be wrong, the failure is meant to show up loudly (a failing git ref or lock operation), "never as corruption" (l.347).
- **P18.** The record is "manipulable by any human, agent or script without the driver present" (l.126). The person could run `git worktree add` by hand during a live run without harming it, so the tool's own command needs no more exclusion than that.
- **P21 / P19.** No incident or consumer has shown a conflict. Adding exclusion here would be machinery built ahead of evidence. The boundary disclaimer says guardrails exist for accidental writes (l.435), and here there is no accidental write to guard against.

**(c) Pulling the other way**
- **P12** says take the conservative direction under uncertainty, which would mean refusing.
- **P5's** "One lock per directory" (l.157) and **P17's** "one sole writer of shared git state" (l.347/364) could be read as covering any write to the shared `.git`.

They lose on two counts. First, the question states that the write sets are disjoint, so there is no uncertainty to resolve conservatively. Second, "shared git state" in P17's derivations means the commits, index and landings the parent serializes (l.355). A reserved branch is, by definition, not shared.

**(d) Confidence: medium.** I had to infer what the lock covers and what counts as "shared git state". The constitution doesn't say.

---

## Q3: How to allocate task ids so they never repeat

**(a) Decision.** Option B: derive the next id from durable evidence each time, with no record file. The evidence set must be P18's full durable state, meaning the files **and git history** (task paths and `Auto-Task` trailers ever committed), not only the artifacts that still exist.

**(b) Deciding principles**
- **P6.** "Prefer state derived from durable evidence… over newly persisted state", and "every recovery re-derives from disk" (l.176). A next-number file is exactly the "rot-prone state" that 0006 rejected (l.178).
- **P5.** A counter kept alongside the task directories is a second source of truth that can drift from them (l.147, l.149).
- **P3 / P7.** Option A's recovery uses an AI side session. That makes recovery depend on a session's output rather than "driver-persisted evidence" (l.71). It also puts judgment into a purely mechanical grammar (ids and index lines), which P7 reserves to the driver (l.107).
- **P21.** Option A's recovery procedure is machinery that only exists to defend a record the tool doesn't need.
- **P18, which forces the amendment to B.** "Deletion is safe only after distillation, and pairs directories with index lines in one commit; git history retains everything" (l.134). If the highest-numbered task is distilled and deleted, Option B as worded (indexes plus surviving directories) would hand out that number again. Counting ids from git history keeps the sequence monotonic without a record.
- **P17.** Under lanes, allocation is a shared-state read-modify-write. It must be done only in the serialized parent (l.355), so an unlanded worktree can't produce a duplicate.

**(c) Pulling the other way.** P6's own known tension says "Some state must persist" (l.191), and a persisted counter never goes backwards. It loses because widening the derivation to include git history restores monotonicity with zero persisted state. The recompute cost is trivial, well under P6's revisit trigger (l.195).

**(d) Confidence: high on B over A; medium on the git-history amendment.** The constitution never states the id-uniqueness rule itself. The amendment is my inference from l.134.

---

## Q4: Budget for fix rounds

**(a) Decision.** No fixed cap. Fix rounds are gated on progress: keep running fix → fresh re-verification while each round makes measurable progress, and block for the person after two consecutive rounds without progress. After that comes `--repair`, then the person.

To keep the loop bounded, "progress" should mean the driver-parsed gap count reaches a **new minimum** (strictly below the best so far). This is my addition, not the constitution's.

**(b) Deciding principles**
- **P2.** The derivation states it directly: "fix rounds (progress-gated, never count-capped — two consecutive no-gap rounds block, 0146 amending 0083 D5) → `--repair` → the human" (l.61). It also requires that "every automatic escalation is bounded, and the terminal of every bounded path is the person" (l.51). A count that must reach a new low each time can't fall forever, so the bound holds. A rule of "fewer gaps than last round" would not hold it: a pattern like 3→2→3→2 never trips "two without progress".
- **P3.** Each re-verification is a fresh session that judges by inspection (l.78). "a FAIL never clears anything — only a gate or artifact re-earned does".
- **P7.** Progress must be measured on a grammar the driver defines, such as per-criterion verdict lines or a gap count. The driver must never judge whether a fix is "better".
- **P20.** A task that is still converging must not be halted by an arbitrary count. A fixed cap would also spend the person's attention on what is still mechanical work (§0 exchange).

**(c) Pulling the other way.** P2's "bounded" pushes toward a simple count cap. It loses because the progress gate with a new-minimum rule is bounded. The same bullet's "consent is the budget… no pre-authorized budget" (l.61) applies after the block (the `--repair` and remediation marks), not to the automatic rounds before it.

**(d) Confidence: high on the direction, low-to-medium on the progress measure.** The rule is stated, but "progress" is undefined and the wording "no-gap" looks like a slip.

---

## Q5: Config-check output for a key superseded by design

**(a) Decision.**
- **When the two sources agree:** stay silent. No finding, exit 0. The check still verifies that they agree; it just has nothing to report.
- **When they disagree:** report a finding and exit 1. The finding names both values, says which source governs right now, and gives the remedy: `fix` to repair toward the authoritative source by rule, or `amend`. The check itself never reconciles them.

**(b) Deciding principles**
- **P8.** "every surfaced line teaches the remedy it wants" (l.199). A posture that is working as designed needs no remedy and has no future moment, so it is neither a ✗ nor a ⚠.
- **P13.** Exit codes and literals must never carry "silent dual meanings" (l.264). If exit 1 also fired for "everything is as designed", it would no longer reliably mean "needs attention".
- **§0 exchange / T5 / R5.** Human attention is the scarce resource. A permanent finding the person can't act on trains them to ignore the check.
- **P12** (disagreement case). "never silent precedence" (l.248) applies, and nothing is "guessed silently" (l.242). A conflict between two sources the person stated has to be surfaced.
- **P2** (disagreement case). Which value the person meant is their decision. The check proposes a remedy and never applies it. The config is "read-only during runs" and "the driver never amends it" (l.156, l.67).
- **P5.** Config changes only through `amend` or `fix`. This sets the remedy channels.

**(c) Pulling the other way**
- **P12 / P13's "never silent precedence"** (l.248, l.280) suggests always naming the supersession. It loses because when the sources agree, no precedence is exercised and nothing is chosen.
- **P5's "no mirrors, no second sources of truth"** (l.147) makes a superseded key look like consolidation debt worth flagging. It loses because that debt belongs to the release traceability audit (l.457), not to the person's exit code. The config-vs-roadmap supersession is a ruled posture (l.67).

**(d) Confidence: medium.** The constitution has no explicit rule about checks reporting intended postures. I assembled this from P8, P12 and P13.

---

## Q6: Where a graceful `/exit` takes effect

**(a) Decision.** At the next internal boundary: the next handover, or entry into wrap-up/verification. This holds on one condition: the driver has committed the outgoing session and persisted a record that resume can use there. Not at task close, and not immediately.

**(b) Deciding principles**
- **P6.** "`/exit` is a scheduled stop at an existing safe boundary, fully isomorphic to the recovery path of any real crash/kill interruption" (l.183). A handover and wrap-up entry are existing boundaries. Pausing there leaves exactly the state a crash just after that boundary's commit would leave, so there is no special pause state.
- **P20.** "`/exit` deferred to the next safe boundary (0014)" (l.401) means the next one, not the unit's end. "windows gate dispatches, never running turns" (l.401). The next fresh-session dispatch is exactly such a gate. Pausing immediately would destroy a running session's work, which P20 forbids. Double-Ctrl+C remains the person's channel for an immediate stop (l.406).
- **P4 / P3.** Every session end is a driver commit (l.94), and "multiple driver commits [are] legal" (l.95). An open unit with driver commits is a legal state, and resume advances from the persisted record (l.80, l.187), not from the session's narrative.
- **P2.** The pause is the person's decision. Deferring it to the close of a long task could delay it by hours.

**(c) Pulling the other way**
- **P20's** "hibernate stops at unit ends (0027)" (l.401) suggests the unit as the grain for stopping.
- **P6's** "uncertainty → no reuse, roll back to the unit baseline" (l.185) could, on resume, throw away work done before the pause.

Both lose. Hibernate is an automatic window control, while `/exit` is the person's request. The rollback risk applies only when resume is uncertain, which is why the decision carries its condition. If the boundary has no persisted resume record, it isn't a safe boundary, and the pause falls through to the next one that does, ultimately the task close.

**(d) Confidence: medium-high.** "safe boundary" is never defined, so I had to infer that intra-unit handovers qualify.

---

## Where the constitution was silent, ambiguous or self-contradictory

1. **Q1: possible contradiction between rollback rules.**
   - l.185: "Strict resume's fidelity bar: uncertainty → no reuse, roll back to the unit baseline"
   - l.96: "foreign commits are never rolled back — 'the authority over git state belongs to a human'"

   A unit range containing foreign commits is exactly the uncertain case, and the two rules then point in opposite directions. I resolved it by tier, but **nothing in the document says Tier I outranks Tier II** when they conflict. l.445 only says "a documented tension between two principles is a ruling's material". I inferred the precedence from the tier test (l.18) and the hierarchy diagram (l.20–25).
   - The response to l.99 ("The person must not hand-commit inside a unit's range") is never stated: block, adopt, or remedy menu.

2. **Q2: lock scope is silent.**
   - l.157: "One lock per directory (`.auto/run.lock`)". It doesn't say which commands must take the lock, or whether "directory" means the working directory or the repository.
   - l.347: "one sole writer of shared git state". It doesn't define whether refs or worktree registrations count as shared git state.

3. **Q3: the id-uniqueness rule is never stated, and a literal Option B would break it.**
   - The only id statements are l.273 ("ids the durable protocol") and l.430, which concerns principle ids.
   - l.134 permits deleting task directories together with their index lines, so deriving from surviving artifacts alone can reuse an id.
   - l.191 lists the state that must persist ("units.json, windows.json, stats") and says nothing about id allocation.

4. **Q4: the key line is ambiguous, carries a threshold the tier rules forbid, and cites an untraceable plan.**
   - l.61: "fix rounds (progress-gated, never count-capped — two consecutive no-gap rounds block, 0146 amending 0083 D5)"
     - "no-gap" literally describes a passing round. It presumably means "no-progress", and "progress" is undefined.
     - "two consecutive" is a threshold, which the tier rules say never belongs in the constitution: "Concrete requirements (formats, grammars, exit codes, thresholds…) are not here" (l.3), and l.453 says the same. l.207 ("one retry then block, exit 2") does the same thing.
     - Plan 0146 lies outside the stated corpus ("plans corpus (0001–0109, baselined `pre`)", l.3; "Current as of release v0.3.0", l.5). Its provenance can't be checked from this document.
   - Also on l.61: "consent is the budget — 'every remediation needs a fresh mark; there is no pre-authorized budget'". Read literally, this conflicts with running fix rounds automatically. Its scope (after the block only) is my inference.

5. **Q5: no rule on reporting intended postures, and three pulls with no tie-breaker.**
   - "never silent precedence" (l.248; also l.278, l.280)
   - "every surfaced line teaches the remedy it wants" (l.199)
   - "no mirrors, no second sources of truth" (l.147)

   The only supersession precedent is l.67: "the config stays constitutional ('the driver never amends it', 0084 D6, superseded only in that resolution-at-establishment writes nothing — 0101 D5)". The exit-1 convention is mentioned only in passing: "The exit-1 findings convention of fix/sync deviates from exit-2 wording deliberately" (l.278).

6. **Q6: "safe boundary" is undefined.**
   - l.183: "a scheduled stop at an existing safe boundary"
   - l.401: "`/exit` deferred to the next safe boundary (0014); hibernate stops at unit ends (0027)"

   Neither says whether a handover inside a unit qualifies. Putting the hibernate example (unit ends) beside the `/exit` one invites reading the unit as the stop grain. l.185's rollback-under-uncertainty also affects whether a pause inside a unit is safe.
