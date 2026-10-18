// The person-proxy brief (plans/0105): `driver-helper [dir]` renders, from
// the same state derivation the stop lines already use, the brief a
// coding-agent session holding the person's pen needs at a boundary `run`
// cannot cross — the third rendered role beside the manual suite's driver
// (prompts/, 0093) and the work order's guest session (0076). Read-only,
// stdout, flagless (the plan --scaffold precedent): no file written, nothing
// parsed back (D4 — run/transfer/plan gain zero inputs; the proxy's writes
// land only in person-owned channels that already exist, and the next
// command recovers by the re-derivation it always performs), no run lock
// taken (a live lock is reported, never refused on — the brief is exactly
// what a person reads while a run sits blocked), no services, no loop
// imports (the plan/close posture; import-direction's FORBIDDEN table pins
// it).
//
// The brief is six blocks in order (D3): ROLE (the proxy pin — never the
// driver, prompts/run.md reference-not-role), PRIMER (DRIVER_PRIMER
// verbatim), STATE (the live facts plus the stop's own lines, composed by
// the same emitters the terminal prints — plan.ts's lines-returning twins),
// CHANNELS (this state's rows of the map below), POLICY (ASSIST_RULE
// verbatim plus the state's recorded defaults and the stop-and-ask
// boundary), RECOVERY (the exact commands, rendered with the brief's own
// dir argument). A healthy mid-state renders the rhythm brief, not an
// error: the command is consultable at any moment (D2).
//
// The state→channels map (D5) — every grammar and command already exists;
// the map invents nothing, it names, per stop, what the person's pen may
// touch. Detection is by import, never re-implemented:
//
//   | State (detection)                                        | Open channels                                                       | Recovery              |
//   |----------------------------------------------------------|---------------------------------------------------------------------|-----------------------|
//   | 1  project start, analysis unreleased (analysisGate's    | docs/analysis.md — sections, Fork: lines, ## Project brief,         | transfer (m: plan)    |
//   |    reads: analysisProblems, clarifiedMark)               | ## Roadmap; release by whole-line Clarified: yes                    |                       |
//   | 2  round-start gate G1 (roundBriefText undefined on an   | docs/R-NN/round.md — goal, acceptance, release criteria; the        | transfer              |
//   |    established round, or the pre-establishment rhythm)   | person commits it (the review act)                                  |                       |
//   | 3  formulation review stop (route plan, or               | the phase's plan-input.md (a changed text restarts the open step);  | edit, then transfer;  |
//   |    awaitingFormulation)                                  | round brief and project brief the fixed inputs                      | then plan, run        |
//   | 4  human gates (phaseGateProblems)                       | survey.md — fork answers, Recommend: defaults, Clarified: yes       | transfer              |
//   |    acceptance gate (same predicate family)               | (the brief proposal rides the release); acceptance's Accepted: yes  |                       |
//   | 5  phase boundary stop (handover route, gates passing)   | read the phase's task reports; the next phase's plan-input.md may   | transfer              |
//   |                                                          | be written ahead                                                     |                       |
//   | 6  round-close gate held (roundCloseProblems)            | ## Close of docs/R-NN/round.md (filled and committed by the person);| run, then transfer    |
//   |                                                          | a missing report self-heals through run                             |                       |
//   | 7  roadmap-exhausted stop (releasedRoadmapRounds)        | extend ## Roadmap of docs/analysis.md with the next round's line    | transfer              |
//   | 8  task FAIL / blocked (blocked status or gaps.md)       | docs/T-NNN/gaps.md — read, then accept or rework                    | close; run --repair   |
//   | 9  blockage dossier held (readBlockageDocs + choiceMark) | one Choice: line in docs/R-NN/blockage-<seq>.md                     | the next advance      |
//   | 10 config / provenance findings (planFix,                | amend --<key> <value>; sync; fix                                    | themselves            |
//   |    provenanceComparison)                                 |                                                                      |                       |
//   | 11 dirty-tree block at a start gate (changedFiles)       | the person resolves the tree (driver-exclusive leftovers            | run                   |
//   |                                                          | self-heal)                                                           |                       |
//   | 12 release-gate containment (repoRoots finds a nested    | the nested repository's own fixes                                   | release               |
//   |    repository)                                           |                                                                      |                       |
//   | 13 nothing to advance (pending tasks)                    | none — the next act is execution                                    | run                   |
//   | 14 run lock live (liveRunLock)                           | none — wait for the run to end                                      | —                     |
//
// Rows 8–12 are standing facts that ride beside the primary stop row; row
// 14 rides as a STATE line and a leading channel whenever the lock is live
// (the brief still renders the state beneath, so the person sees what
// follows the run). One deliberate deviation from the table's order: while
// work pends, row 13 wins over row 12 — the map's own row 13 says the next
// act is execution — and the destination's release channel then rides as
// the standing row it is. The dirty-tree row (11) stays quiet at the two
// stops whose uncommitted state is the design (the analysis flow and the
// round-start gate: committing is the person's review act there); the
// round-close checks run without the config build — a brief must not run
// the target's build — and say so when one is configured.
import { join } from "node:path"
import { GUIDANCE } from "./agents-block"
import { analysisProblems, releasedRoadmapRounds } from "./analysis"
import { choiceMark, readBlockageDocs, rejectedMark } from "./blockage"
import { provenanceComparison } from "./bundle"
import { CONFIG_FILE } from "./config"
import { planFix } from "./config-fix"
import { ANALYSIS_DOC, reportForUserPath, roundBriefPath, roundDirName, taskDoc } from "./docpaths"
import { awaitingFormulation } from "./formulate"
import { changedFiles, nestedRepoPrefixes, repoRoots } from "./git"
import { liveRunLock, lockStatusLine } from "./lock"
import {
  analysisAwaitingLines,
  analysisHeldLines,
  emptyIndexNotice,
  executeNotice,
  gateStopLines,
  nothingToAdvanceLine,
  phaseBoundaryLines,
  roadmapExhaustedLines,
  roundCloseRefusalLines,
} from "./plan"
import { planInputPath } from "./plan-input"
import {
  clarifiedMark,
  currentRound,
  formatPhases,
  legacyLayoutProblem,
  phaseAcceptanceDoc,
  phaseFlowBlockedLine,
  phaseGateProblems,
  phaseGates,
  phaseIndexPath,
  phaseSurveyDoc,
  phaseTitle,
  readPhases,
  roundRoot,
  routePhase,
  surveyForks,
  type PhaseUnit,
} from "./phases"
import { loadPhaseTypes } from "./phases/custom"
import { provenanceFindings } from "./provenance"
import { roundBriefText } from "./round-brief"
import { roundCloseProblems } from "./round-close"
import { shellProfile } from "./shell"
import { autoSwitches } from "./switches"
import { loadPlan } from "./tasks"

// What the shell threads in: the loaded config's own facts (the renderer is
// config-parse-blind by design — the shell refuses an unloadable config, and
// this module never reads keys itself). build is carried only to be named in
// the round-close caveat; the brief never runs it.
export type HelperBriefOpts = {
  /** config phases — the mode key: "m" the manual single phase, else phased. */
  phases: string
  /** config build — named in the round-close caveat, deliberately not run. */
  build?: string
  /** config scanExempt — the scan sites' exemption list. */
  scanExempt?: readonly string[]
  /** config acceptanceGate — the phase types whose completion is acceptance-gated. */
  acceptanceGate?: readonly string[]
}

// The brief's one composed constant: the ROLE block (D3). The load-bearing
// block — a pasted session must not drift into the driver's seat, and the
// installed manual suite's master control actively recruits its reader as
// one (prompts/run.md), so the pin names it as reference material, not the
// execution path. The hard rules are the system's existing gates restated,
// never new enforcement (D8): protect, the clean-tree start gates, the SHA
// audit and the scans already bind the proxy.
const ROLE_LINES = [
  "You hold the person's pen at a boundary the driver (the `opencode-auto` CLI) deliberately leaves to the person. The CLI is the driver — it constructs, dispatches, commits and closes; you decide nothing the driver decides. You never write implementation code, never launch or drive task sessions, and never take the manual-driver role of `prompts/run.md`: the manual prompt suite that may be installed in this directory is reference material for a person choosing to hand-drive, not your execution path.",
  "Hard rules (the existing gates — protect, the clean-tree start gates, the close-out SHA audit, the P1 and containment scans — already enforce them; they bind this session exactly the same):",
  "- never write into `.auto/`, never tick an index line (`docs/R-NN/phases.md`, a phase's `tasks.md`), never rename a `todo.md` → `done.md` — those writes are the driver's alone;",
  "- never edit `.opencode/auto/brief.md` or `AGENTS.md` — the brief is driver-written state (seeded by `init/amend --brief`, installed from an approved proposal), and AGENTS.md is rendered from the config;",
  "- while a run holds the run lock (STATE names it when live), write nothing — wait for the run to end;",
  "- person-commits are the review acts at the person gates — the round-start `docs/R-NN/round.md` review commit the canonical one; commits over work belong to the driver alone.",
]

// The assembly: six blocks in D3's order over the map's resolution. Every
// stop-line composition delegates to the shared emitters (plan.ts's twins);
// the channel and recovery texts are the map's own rows.
export async function renderHelperBrief(dir: string, opts: HelperBriefOpts): Promise<string[]> {
  if (!(await Bun.file(join(dir, CONFIG_FILE)).exists())) {
    throw new Error(`nothing to render: ${dir} has no ${CONFIG_FILE}; run opencode-auto init ${dir} first`)
  }
  const { bin } = shellProfile()
  const manual = opts.phases === "m"
  const advance = manual ? "plan" : "transfer"

  const facts: string[] = []
  const stopLines: string[] = []
  const channels: string[] = []
  const defaults: string[] = []
  const recovery: string[] = []
  // The two stops whose uncommitted tree is the design (the person's commit
  // IS the review act): the dirty-tree row stays quiet under them.
  let uncommittedByDesign = false
  const roundBriefChannel = (n: number): string =>
    `${roundBriefPath(n)} — the round brief: \`## Goal\`, \`## Acceptance criteria\`, \`## Release criteria\` (\`## Close\` stays empty until the round ends); the person fills it and commits it — the commit is the review act`
  const planInputChannel = (phase: PhaseUnit): string =>
    `${planInputPath(phase)} — the phase's planning input, free-form markdown (the active pack's scaffold: ${bin} plan ${dir} --scaffold prints it); written by the person, committed unchanged by the driver; a changed text restarts the open construction`
  // Row 6's renderer: the close checks (minus the build — the caveat names it
  // when configured; detection matches the gate on everything else), the
  // refusal lines verbatim, the channels and the recovery. Returns whether
  // the gate held (the caller falls through to the open rhythm when not).
  const roundCloseRow = async (closed: number): Promise<boolean> => {
    const close = await roundCloseProblems(dir, closed, { scanExempt: opts.scanExempt })
    if (!close.problems.length) return false
    stopLines.push(...roundCloseRefusalLines(dir, closed, closed + 1, close, "transfer"))
    if (opts.build) stopLines.push(`ℹ this brief did not run the config build (\`${opts.build}\`) — the close gate runs it on the next ${bin} transfer`)
    channels.push(
      `${roundBriefPath(closed)} — fill its \`## Close\` section (which decisions were restated into the target's own documentation, which accepted as lost) and commit; a missing round report self-heals through a re-run of ${bin} run ${dir}`,
    )
    recovery.push(`${bin} run ${dir} — a missing report task is appended automatically`, `then: ${bin} transfer ${dir}`)
    return true
  }

  facts.push(
    `mode: ${manual ? "m — the manual single phase (plan plans, run executes; no boundary vocabulary applies)" : `phased — config phases "${opts.phases}" (transfer advances, plan dispatches, run executes)`}`,
  )

  // Row 14 — the live lock: reported, never refused on (D1). It rides first
  // in STATE and leads CHANNELS with the wait; the state beneath still
  // renders, so the person sees what follows the run.
  const holder = liveRunLock(dir)
  if (holder) {
    facts.push(`run lock live: ${lockStatusLine(holder)} — write nothing while it holds; this brief's channels open when the run ends`)
    channels.push(`none while the run holds the lock — wait for it to end (poll with ${bin} status ${dir})`)
  }

  const round = await currentRound(dir)
  const legacy = await legacyLayoutProblem(dir)
  const established = legacy === undefined && (await Bun.file(join(dir, phaseIndexPath(round))).exists())
  if (legacy) {
    facts.push(legacy)
    channels.push("none — an old-layout project is not supported by this version; finish it on the release it started with")
  } else if (!established) {
    // Not established: the analysis flow (rows 1/2), or the direct and
    // resumed establishment shapes (row 2's rhythm; row 6 when the previous
    // round's close checks hold it).
    facts.push(`round ${roundDirName(round)} — not established yet (${phaseIndexPath(round)} is missing)`)
    let analysisOn = true
    try {
      analysisOn = autoSwitches().analysis
    } catch (error) {
      facts.push(`⚠ the analysis switch layer failed to parse: ${error instanceof Error ? error.message : String(error)}`)
    }
    const analysisFlow = analysisOn && round === 1 && !(await roundRoot(dir, 1))
    if (analysisFlow) {
      uncommittedByDesign = true
      const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
      if (raw === undefined) {
        // The stop before the stub: the first advance opens the flow.
        facts.push(`no ${ANALYSIS_DOC} yet — the first ${advance} opens the assisted project analysis`)
      } else {
        let problems: string[]
        try {
          problems = analysisProblems(raw, loadPhaseTypes(dir))
        } catch (error) {
          facts.push(`⚠ ${error instanceof Error ? error.message : String(error)}`)
          problems = []
        }
        if (problems.length) stopLines.push(...analysisHeldLines(dir, advance, problems))
        else if (!clarifiedMark(raw)) stopLines.push(...analysisAwaitingLines(dir, advance, surveyForks(raw)))
        else {
          // Released, not yet established: the next advance installs the
          // approved brief and opens R-01 under the roadmap's line.
          stopLines.push(`✓ the project analysis is released; the next ${advance} installs the approved \`## Project brief\` proposal and opens round R-01 under the roadmap's line, stopping at the round-start gate`)
        }
      }
      channels.push(
        `${ANALYSIS_DOC} — its sections (\`## Analysis\`, \`## Goals\`, \`## Project brief\`, \`## Roadmap\`) and one \`Fork:\` line per open decision; release by adding the whole line \`Clarified: yes\` and committing — the person's commit`,
      )
      recovery.push(`${bin} ${advance} ${dir}`)
    } else {
      // The switch off, a later round, or an interrupted start: the previous
      // round's close checks gate the opening, else the establishment rhythm.
      if (round > 1 && (await roundCloseRow(round - 1))) {
        // row 6 rendered
      } else {
        uncommittedByDesign = true
        recovery.push(`${bin} ${advance} ${dir} — it establishes ${roundDirName(round)} and stops at the round-start gate (the setup stays uncommitted; your commit is the review)`)
        channels.push(`after that ${advance}: ${roundBriefChannel(round)}`)
      }
    }
  } else {
    const state = await readPhases(dir).catch(() => undefined)
    if (state) facts.push(`round ${roundDirName(round)}: ${formatPhases(state)}`)
    const route = state ? await routePhase(dir, { loadPlan, bin, phases: opts.phases }) : undefined
    if (route?.type === "blocked") {
      stopLines.push(phaseFlowBlockedLine(route.reason))
      channels.push("none until the index is fixed by hand — the blocked line above names what and how")
      recovery.push(`fix what the blocked line names, then re-run this brief or: ${bin} run ${dir}`)
    } else if (manual && route) {
      // m mode keeps its own shapes (plans/0101 D8): plan/run alone.
      if (route.type === "plan") {
        stopLines.push(...emptyIndexNotice(dir, route.plan.index))
        // The G1 window: m mode's establishment also stops with the setup
        // uncommitted for the person's review commit.
        uncommittedByDesign = true
        channels.push(
          `the planning input — pass it with ${bin} plan ${dir} -p <text> | --file <path> (the pack's scaffold prints with ${bin} plan ${dir} --scaffold; ${bin} plan ${dir} --phase points the AGENTS.md guidance at it)`,
        )
        recovery.push(`${bin} plan ${dir} -p <text> | --file <path>`, `then: ${bin} run ${dir}`)
      } else if (route.type === "execute" || route.type === "handover") {
        const failed = await failedTasks(dir, route.plan.tasks)
        if (failed.length) failedRow(dir, failed, channels, recovery)
        else {
          stopLines.push(...executeNotice(dir, route, true))
          channels.push("none — the next act is execution")
          recovery.push(`${bin} run ${dir}`)
        }
      }
    } else if (route?.type === "complete") {
      if (await roundCloseRow(round)) {
        // row 6 rendered
      } else {
        const roadmap = await releasedRoadmapRounds(dir)
        if (roadmap !== undefined && !roadmap.some((entry) => entry.round === round + 1)) {
          // Row 7 — roadmap-exhausted: transfer's own stop lines verbatim.
          stopLines.push(...roadmapExhaustedLines(dir, round))
          channels.push(`${ANALYSIS_DOC} — extend its \`## Roadmap\` with the next round's line (\`- ${roundDirName(round + 1)} <phases> — <goal>\`, its phases value the round establishes under)`)
          recovery.push(`${bin} transfer ${dir}`)
        } else {
          facts.push(`round ${roundDirName(round)} is complete and passes its close checks — the next transfer opens ${roundDirName(round + 1)} and stops at its round-start gate`)
          uncommittedByDesign = true
          channels.push(`after that transfer: ${roundBriefChannel(round + 1)}`)
          recovery.push(`${bin} transfer ${dir}`)
        }
      }
    } else if (route) {
      const phase = route.phase
      const briefFilled = await roundBriefText(dir, round)
      if (route.type === "plan") {
        // Row 3's construct-awaiting shape: nothing constructed yet. With
        // the brief still the stub this is the G1 window — the uncommitted
        // setup is the person's pending review, not a start-gate block.
        facts.push(`${phaseTitle(phase)} holds no tasks — nothing is constructed yet`)
        if (!briefFilled) {
          uncommittedByDesign = true
          channels.push(roundBriefChannel(round))
        }
        channels.push(planInputChannel(phase))
        recovery.push(`${bin} transfer ${dir} — it constructs the plan task and stops for your review`, `then: ${bin} plan ${dir} (dispatch), ${bin} run ${dir} (execute)`)
      } else if (route.type === "execute") {
        const awaiting = awaitingFormulation(route.plan.tasks, phase)
        const failed = await failedTasks(dir, route.plan.tasks.filter((task) => task !== awaiting))
        if (awaiting) {
          // Row 3 — the formulation review stop: the todo stands reviewed.
          facts.push(`the formulation task ${awaiting.id} stands constructed and reviewed (docs/${awaiting.id}/todo.md — driver-owned: fix its inputs, never the todo)`)
          if (!briefFilled) channels.push(roundBriefChannel(round))
          channels.push(planInputChannel(phase))
          recovery.push(
            `${bin} transfer ${dir} — its idempotent reconstruct absorbs changed inputs and stops for review again`,
            `${bin} plan ${dir} — dispatches the reviewed todo (the formulation session, the collect checks, the wrap-up)`,
            `then: ${bin} run ${dir}`,
          )
        } else if (failed.length) {
          failedRow(dir, failed, channels, recovery)
        } else {
          // Row 13 — the rhythm brief: transfer's own refusal line verbatim.
          stopLines.push(nothingToAdvanceLine(dir, phase, route.plan.tasks.filter((task) => task.status !== "done").length))
          channels.push("none — the next act is execution (`run` executes; the boundary follows)")
          recovery.push(`${bin} run ${dir}`)
        }
      } else if (route.type === "handover") {
        // Rows 4 and 5: the gates first, else the boundary stop — run's own
        // default stop shape, its lines verbatim.
        const gates = phaseGates(phase, opts.acceptanceGate)
        const problems = await phaseGateProblems(dir, phase, gates)
        if (problems.length) {
          const acceptance = gates.includes("acceptance") ? phaseAcceptanceDoc(phase) : undefined
          stopLines.push(...gateStopLines(dir, phase, problems, acceptance))
          if (problems.some((problem) => problem.startsWith("clarification:"))) {
            channels.push(
              `${phaseSurveyDoc(phase)} — resolve the recorded \`Fork:\` lines (each carries a \`Recommend:\` default; append your answers beside any line you override), then add the whole line \`Clarified: yes\` and commit — the release also approves the proposed \`## Project brief\``,
            )
            defaults.push("the held forks' `Recommend:` defaults — `Clarified: yes` accepts them all")
          }
          if (acceptance) {
            channels.push(`${acceptance} — review the phase's case, then add the whole line \`Accepted: yes\` and commit, or write rework notes for an append (\`plan --append\`)`)
          }
          recovery.push(`${bin} transfer ${dir}`)
        } else {
          stopLines.push(...(await phaseBoundaryLines(dir, phase)))
          // The next phase of the same index read (id-keyed: the route's
          // phase object comes from another read).
          const index = state?.phases.findIndex((unit) => unit.id === phase.id) ?? -1
          const next = state && index >= 0 ? state.phases[index + 1] : undefined
          channels.push(
            `review the completed phase — its task reports (\`docs/T-NNN/report.md\` of its tasks)${next ? `; ahead: ${planInputPath(next)} may be written now (the next transfer's construct reads it)` : ""}`,
          )
          recovery.push(`${bin} transfer ${dir}`)
        }
      }
    }
  }

  // —— The standing rows (D5: 9, 10, 12) — facts that ride beside the stop ——

  // Row 9 — un-Choice'd blockage documents of this round (a stale-span
  // `Rejected:` mark is recorded and skipped: the run continues into a fresh
  // diagnosis).
  for (const doc of await readBlockageDocs(dir, round)) {
    if (choiceMark(doc.text) === undefined && !rejectedMark(doc.text)) {
      channels.push(`${doc.file} — the blockage dossier awaiting the person's decision: add exactly one \`Choice: <option letter>\` line (the lettered options are listed in the document); the next advance's remediation executor applies it`)
      recovery.push(`the next advance executes the Choice: ${bin} ${manual ? "plan" : "transfer"} ${dir}`)
    }
  }

  // Row 10 — config and provenance findings: the fix/sync surfaces, read the
  // same way those commands read them.
  const fix = await planFix(dir)
  if (fix.findings.length) {
    const fixable = fix.findings.filter((finding) => finding.class === "fixable").length
    facts.push(
      `⚠ config findings: ${fix.findings.length} (${fixable} fixable by rule, ${fix.findings.length - fixable} manual) — ${bin} fix ${dir} --dryrun lists them`,
    )
    channels.push(`.opencode/auto/config.json and the config layer — fixable findings repair by rule (${bin} fix), manual ones by hand; config keys change with ${bin} amend ${dir} --<key> <value>`)
  }
  const provenance = await provenanceComparison(dir)
  if (provenance !== undefined) {
    const findings = provenanceFindings(provenance)
    if (findings.length) {
      facts.push(`⚠ bundle provenance: ${findings.length} materialized file(s) stale or person-edited — the pack still loads and runs; ${bin} sync ${dir} plans the upgrade`)
      channels.push(`the materialized intent-pack files — unedited ones fast-forward with ${bin} sync ${dir}; person-edited ones are yours alone (reported, never written)`)
    }
  }

  // Row 11 — the dirty tree at a start gate (quiet at the two stops whose
  // uncommitted state is the person's pending review).
  if (!uncommittedByDesign && (await changedFiles(dir)).length) {
    facts.push(`⚠ the worktree holds uncommitted changes — a start gate refuses them (driver-exclusive leftovers self-heal)`)
    channels.push("the worktree — commit or clean the changes you own; driver-exclusive state files (.auto/, the index ticks, the renames) self-heal at the next start gate")
    recovery.push(`${bin} run ${dir} — it self-heals the driver-exclusive leftovers and names anything else`)
  }

  // Row 12 — the destination's release channel: standing wherever a nested
  // repository exists; while work pends, execution is the next act and this
  // rides after it.
  {
    const roots = (await repoRoots(dir)).filter((root) => root !== dir)
    if (roots.length) {
      const names = nestedRepoPrefixes(dir, roots)
      channels.push(
        `${names.join(", ")} — the destination repositor${names.length > 1 ? "ies" : "y"}: containment findings the working rounds only record (task ids, out-of-root paths, process-document references) are enforced at the release gate; the fixes are the destination's own content work`,
      )
      recovery.push(`${bin} release ${dir} — certifies the destination standing alone (exit 2 while findings remain)`)
    }
  }

  // POLICY's recorded defaults: the held forks (row 4) and the round report's
  // needs-attention section — where provisional defaults and AUTO-RESOLVE
  // decisions surface for the person's considered answer.
  {
    const report = await Bun.file(join(dir, reportForUserPath(round))).text().catch(() => undefined)
    if (report?.includes("Needs your attention")) {
      defaults.push(`the needs-attention section of ${reportForUserPath(round)} — the round's provisional defaults and AUTO-RESOLVE decisions, each phrased by its project consequence`)
    }
  }

  // —— The six blocks, in D3's order ——
  const lines: string[] = [`# Person-proxy brief — ${dir}`, ""]
  lines.push("## ROLE — the person's pen, never the driver", "")
  for (const line of ROLE_LINES) lines.push(line)
  lines.push("", "## PRIMER — how the driver works", "")
  lines.push(GUIDANCE.DRIVER_PRIMER)
  lines.push("", "## STATE — the live facts and this stop's own lines", "")
  for (const line of facts) lines.push(`- ${line}`)
  if (stopLines.length) lines.push("")
  for (const line of stopLines) lines.push(line)
  lines.push("", "## CHANNELS — what the person's pen may touch here", "")
  for (const line of channels) lines.push(`- ${line}`)
  if (!channels.length) lines.push("- none — the next act is the driver's (see RECOVERY)")
  lines.push("", "## POLICY", "")
  lines.push(GUIDANCE.ASSIST_RULE)
  lines.push("")
  lines.push(
    defaults.length
      ? `Recorded defaults this state already carries: ${defaults.join("; ")}.`
      : "Recorded defaults this state already carries: none beyond the documents named above.",
  )
  lines.push("Everything else is stop-and-ask: enumerate what is unknown, ask the person, keep undecided points open — never invent the person's answer.")
  lines.push("", "## RECOVERY — the exact commands for this state", "")
  if (recovery.length) for (const line of recovery) lines.push(`- ${line}`)
  else lines.push(`- ${bin} status ${dir} — nothing to advance right now; the state lines above name the situation`)
  return lines
}

// Row 8's predicate: the tasks a FAIL or a block left holding — a blocked
// runtime status, or a gap list on disk for a task not yet done (the
// verification session writes docs/T-NNN/gaps.md on FAIL, the run blocks).
async function failedTasks(dir: string, tasks: readonly { id: string; status: string }[]): Promise<string[]> {
  const failed: string[] = []
  for (const task of tasks) {
    if (task.status === "done") continue
    if (task.status === "blocked" || (await Bun.file(join(dir, taskDoc(task.id, "gaps"))).exists())) failed.push(task.id)
  }
  return failed
}

// Row 8's channels and recovery: the accept-or-rework fork of a FAIL.
function failedRow(dir: string, failed: readonly string[], channels: string[], recovery: string[]): void {
  const { bin } = shellProfile()
  for (const id of failed) {
    channels.push(`docs/${id}/gaps.md — the verification's gap list: read it, then accept the failure or plan the rework (the task stays blocked until one of the two)`)
  }
  recovery.push(`${bin} close <T-NNN> ${dir} --reason "<text>" — accept the failed task (done for scheduling, never delivered)`)
  recovery.push(`${bin} run ${dir} --repair <n> — bounded rework rounds over the report's evidence (the first FAIL blocks without it)`)
}
