# 0118 — The notification wait: a running child's output is never read

The manual-driver suite's master control polled. The field report, a plain serial run (no mode phrase,
no `parallel:` — the serial floor) on a notification-delivering host: after launching a task child
background-first exactly as 0092 rules, the master kept fetching the running child's live output —
polling the transcript to learn quietness and progress — instead of waiting for its completion
notification, spending its own scarce context on every fetch. Prompt copy and its ratchet alone — no
src change; the fix rules the wait's mechanism, retires one nudge and re-keys one wall.

This ruling Derives: **P7** (grammars, never content — the master's whole intake from a child is the
verdict line plus the mechanical checks, both grammars; a running child's transcript is content
judgment material that belongs to the child roles, and fetching it is the driver consuming content it
has no check for — the wait bullet extends the fence from what the master judges to what it even
reads), **P19** (measured evidence — the ruling is grounded in the field incident and a read of the
copy against it; the three inductions below are cited from the copy as it stood, not hypothesized),
**P20** (in-flight work never destroyed — supervising a working child never disturbs it: the fallible
quietness heuristic whose discharge required surveillance is retired outright rather than enforced,
the one remaining enforced stop — the budget wall — is keyed to a mechanical clock fact, and a working
child is touched only at its own completion or at the wall), and **P13** (frozen additive-only
vocabularies — a protocol-adjacent string retires through the conscious lockstep: run.md, the ratchet
(the "still there?" absence pinned beside the surviving nudge string) and this document in one change,
while 0092's own pins stand undisturbed). Tier touched: **mechanism only** — the manual suite's prompt
copy and its ratchet; no principle change; the INDEX release cell stays open until the next release
event.

## Evidence

The incident, then the copy read against it. Three inductions caused the polling, each a defect of the
instruction set rather than of the master:

1. **The loop named no wait.** Step 2 launches the child; step 3 opened "When it ends:" — the mechanism
   that carries "ends" to the master was never stated. The completion notification appeared exactly
   once in the whole suite (run.md's labeling rationale: a label is "the only visibility a background
   child gets beyond the completion notification"), never as the wait's shape. A master left to choose
   a mechanism reaches for the host's only child-inspection primitive — fetching the task's output.
2. **The quiet nudge could only be discharged by watching.** "When your platform can message a running
   background child and it has been quiet past ~10 minutes, prefer one nudge line" — quietness is a
   live-transcript fact; there is no way to know it without reading the child's output. The rule
   contradicted its own neighbor ("nobody watches a child's live transcript") and, being the concrete
   duty, won.
3. **The wall's trigger was under-specified.** "A background child that runs past its session budget
   without ending" — how the master learns "without ending" was unstated, and output-fetching is the
   answer a model improvises. The suite's own taught wait idiom was poll-shaped besides (pace's
   sleep-and-`date` steps — clock polling, but the shape generalizes to child polling).

The damage was not cosmetic: every fetch pulled the child's transcript into the master's context,
spending the resource run.md's own context rule declares scarcest ("You may drive dozens of tasks in
this one session; your context is the scarce resource").

## D1 — the completion notification is the wait

A new bullet in run.md's launching section rules the mechanism 0092 left implicit: after launching a
child, the master acts on it again only when its completion notification arrives (a foreground launch
needs no separate wait — its call blocks and returns with the final reply). **Never fetch, tail or
poll a running child's transcript**, whatever the question — quietness, progress, liveness: the
transcript is the child session's context, no mechanical check reads it, and a background child cannot
be quiet-killed, so its silence endangers nothing. Where a host's only wait shape is a call that both
blocks on the child and returns its output (a facility shape stated generically — no host's API enters
the copy, P16), the master takes from the return **the final reply alone** — the verdict line plus the
mechanical checks are the whole intake, as the context rule already says. Two cross-ties bind the rule
into the loop: step 3's opening now names the wait's two shapes ("the completion notification of the
background launch, the call's return of a foreground one"), and the context rule's intake sentence
names the prohibition ("never through a running child's transcript").

## D2 — the clock reads `date`, never the child

Where the master must hold a clock while a child runs — the budget wall, a mode's gates — it holds it
the pace idiom's way: short sleep steps reading `date`, never the child's output. The budget wall is
re-keyed to its actual epistemic source: a fact of clock arithmetic alone — the launch time the master
recorded plus the session budget the master itself filled, against `date` — never a fact of the child's
output. The wall's action is unchanged (stop the child at launch + budget, relaunch with the continue
line — P20's preservation: the checkpointed tree makes it safe); only the trigger's channel is ruled.

## D3 — the mid-flight quiet nudge retired

0090 D2's quiet-child nudge survives exactly where it belongs: in the relaunch line on the
forced-foreground host, as the lesson handed to a killed child's successor ("poll your log in short
steps — never sit waiting on a long command" — the string stands verbatim, its pin untouched). The
mid-flight form is retired: **no nudge is ever sent to a running background child**. Its discharge
required transcript-watching (induction 2 above), and its object was empty — a background child cannot
be quiet-killed, so a silent one is in no danger; the budget wall is and remains the sole backstop.
The quietness bullet is re-keyed to match: quietness is never a stop condition of the master's, **and
never a fact it learns** — a child sitting silent is simply one whose completion notification has not
arrived, and that is all the master knows of it.

## D4 — the ratchet lockstep (P13)

The ratchet gains an 0118 test pinning the new literals (the wait sentence, the never-fetch sentence,
the pace-idiom hold, the clock-arithmetic key, the no-mid-flight-nudge sentence, step 3's notification
opening, both cross-tie phrases) and one **absence** pin — `"still there?"` must not return — beside
0092's surviving pins (the background-first sentence, "nobody watches a child's live transcript", the
forced-foreground fact, the nudge string), which stand undisturbed: the retirement is of the nudge's
mid-flight occurrence alone, and the surviving occurrence was rewrapped so the pinned string sits on
one line.

## Enactment notes

- All changes are in `prompts/run.md` (the launching section: the budget-wall sentence's clock key, the
  new wait bullet, the quietness bullet's re-key, the nudge sentence's rewrap; the context rule's
  intake sentence; the loop's step 3 opening) and the ratchet test; nothing in `src/`, no template, no
  companion touched — the companions' survival discipline is the child's own, over its own logs, and
  binds unchanged (0092's stance carried forward; P5: one home for the wait, the master's copy).
- The wait rules every launch shape in the suite — the serial loop, the parallel wave's several
  children (each waited on by its own notification; the wave's per-child-end rules key on
  notifications, as they always did implicitly), the phase-transfer children — no per-section re-keying
  is needed: "act on it again only when its completion notification arrives" is stated per child.
- Indexed in plans/INDEX.md's post-baseline table with an open release cell; the suite's navigation
  line in AGENTS.md gains the pointer.
