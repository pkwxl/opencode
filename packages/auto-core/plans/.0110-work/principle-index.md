# The canonical principle index — post-checkpoint-2b (approved 2026-10-21)

- derived from: `principles-draft.md` (stage 2) + `positioning-and-tiers.md` (stage 2b) + the checkpoint-2b approval line in the plan's Execution record — nothing else; where this file and the drafts disagree, the approval line wins.
- purpose: the verbatim prompt input for every stage-4+ child session (D17). Full treatments live in the two drafts; this index is the assignment vocabulary.

## The set

**Tier I — constitutional** (six; removal breaks a positioning pillar, fence, or contract):

- **P1** the deliverable stands alone — the shipped artifact is exactly what a nested destination repo's git manages; every process-side reference from it (process-document path, bare task id, out-of-root path) is a defect, recorded during rounds as one count, enforced at the person's release moment; the remedy is restatement, never bare deletion.
- **P2** the person brackets every boundary — bounded agency with the human the unbounded backstop; consequential decisions are surfaced for the person and never consumed as closed; every automatic escalation is bounded and terminates at the person.
- **P3** completion is never judged by agent self-report — a unit is done only when its artifacts are on disk and committed (or a person closed it); verification is planned, independent, fresh-session work judging the work itself; flow and recovery key on driver-persisted evidence.
- **P4** committing is the completion condition *(contract-grade)* — the driver holds the commit right exclusively; the unified commit, the SHA baseline audit, and git history as rollback anchor. (Derives from P3 on P18's substrate.)
- **P7** grammars, never content *(fence-grade)* — the driver checks and writes only mechanical grammars it defines (paths, markers, trailers, field blocks, event streams); content quality is judged by acceptance work, sessions, and people.
- **P18** the record outlives the tool — plain files and git are the only durable state; permanent document paths; machine-addressable history; journals best-effort over a committed trail; no lock-in, no special tooling.

**Tier II — operating principles** (twelve; standing trade-offs, each with choice / default / revisit trigger):

- **P5** single ownership *(absorbs P11)* — every kind of state and every mechanism has exactly one owning home and exactly one writer; no mirrors, no second sources of truth; duplicates consolidated, held by ratchets that only shrink. (State: documents / `.auto/` / config; mechanism: one module, layer, or carrier.)
- **P6** derived state, idempotence, re-derivation — prefer state derived from durable evidence over newly persisted state; what persists is minimal; every step idempotent; every recovery re-derives from disk.
- **P8** deliberate enforcement moments — detection records (counts, warnings, findings); blocking is reserved for the stop's own work and the person's moments; every surfaced line teaches its remedy.
- **P10** the byte-identical floor — every opt-in mechanism degrades to the unchanged baseline (unset switches, absent declarations, missing capabilities); ruled defect fixes are the exemption, never masked by a floor.
- **P12** fail loud; conservative under uncertainty — failures surfaced, never swallowed into a clean verdict; uncertain readings resolve toward dirty / no-reuse / no-carry; degradation renders its fallback.
- **P13** frozen additive-only vocabularies — protocol literals, event vocabularies, exit codes, document grammars change only by conscious lockstep in one change, grow additively, retire through tombstones; never silent dual meanings.
- **P14** one-way dependencies through declared seams — the core never knows shells or HTTP; differences inject via profiles/registrations/parameters; layers point downward through entry modules held by ratchets; agent SDKs confined to adapters.
- **P15** policy is data; governance pinned — prompt copy in templates, judgment content in packs/bundles; renderers assemble, code never authors copy; the runtime reads materialized surfaces and never interprets intent; committed governance text never floats with the binary.
- **P16** genericity *(restated)* — no real project's paths, layout, or special cases enter core or shell code; project facts ride the target's declared surfaces (config, packs, brief, roadmap); the escape is always a structural rule, never an in-code exemption.
- **P17** declared concurrency — parallelism admitted on declarations (`Depends:`/`Touches:`), bought at the cheapest fitting isolation tier, bounded by disjoint scopes with one sole writer of shared git state; wrong declarations surface loudly, never as corruption.
- **P19** measured evidence — rulings grounded in measured field evidence (incidents, censuses, live probes, cost tables), every claim cited; speculation is not a basis; compensation machinery re-audited on schedule.
- **P20** in-flight work is never destroyed — transient faults waited out with accumulated context kept; control changes land only at safe boundaries; heuristics advise before they enforce; probes never pollute the real session.

## Tombstones and requirement families (ids never reused)

- **P9 — demoted** to the counts-not-lists presentation convention: a concrete requirement (human-facing surfaces carry aggregate counts; itemization only where the list is the work — the release fix list, a stop's own blocking problems; ruled 0109). Lives on its surfaces (`round-close.ts`, `driver-helper.ts`, `conclusion.ts`), not in the constitution.
- **P11 — folded into P5** (one ownership principle, two scopes: state and mechanism).
- **P16's secrets half — demoted** to the security requirement family: keys and env values are references (`{env:NAME}`/`{file:path}`), never literals; a resolved value never enters anything the tool builds or logs. Hard, testable, held by code and review (AGENTS.md invariants keep carrying it).

## Assignment vocabulary (for stage-4 rows)

- Status words: `active-authority` | `superseded-by NNNN` | `historical-only`.
- Principle ids: from the set above only; a ruling matching none → flag as orphan (do not force-fit); a family of orphans suggesting a missing principle → flag with a one-line candidate statement.
- Release column: every corpus document 0001–0109 is `pre`; the two anomalies (0028's deletion; the absent `AUTO_NEXT_REFACTOR_PLAN.md`) get their own rows per D2.
