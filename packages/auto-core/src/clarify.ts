// clarify, the person's release command (plans/0116) — the one command that
// performs the awaiting stop's manual act: it writes the whole-line
// `Clarified: yes` into the one document a gate is awaiting and commits it,
// byte-identical to a correct hand edit plus its commit. The gates stay the
// sole authority (clarifiedMark, phaseGateProblems and analysisProblems are
// untouched; the command only produces the state they read) and the manual
// path stays fully supported — the stop lines name the command first and the
// hand edit beside it.
//
// Two surfaces, each at its own moment (plans/0204 D1):
//   1. the project analysis docs/analysis.md, unreleased, only while no round
//      is established — the gate's own project-start condition (plan's rows
//      0a–0d, transfer's projectStart), mode-independent. Establishment never
//      requires the analysis (the off posture establishes from config with
//      the stub on disk, and the analysis is a living document a person may
//      draft at any time), so past that moment an unreleased analysis is a
//      note line beside the survey branch, never the target; the release
//      grammar gates run first, so a mark is never written onto a document
//      the release checks would refuse anyway;
//   2. the held survey of the current human-gated phase — the handover route
//      (all tasks done, the phase not complete), survey.md present, open
//      Fork: lines, no mark: the same predicate transfer's boundary refusal
//      and run's boundary stop check ahead of any session.
//
// The command is the review (plans/0116 D3, completed by 0204 D2): before
// writing it prints what the mark accepts — the survey's Fork: lines with
// their Recommend: defaults, the analysis's roadmap lines, its round-brief
// proposals and the brief proposal. Overrides keep their channel: an answer
// beside a fork line, written before (riding the release commit) or after (a
// plain committed edit the planners read — the release stays).
//
// The dirty-tree discipline is close's D20 tightened to the target (D5): the
// target document's own uncommitted changes — the person's fill, the whole
// analysis commonly still untracked — fold into the release commit (that is
// what "add the line and commit" means); the driver's own surfaces — the
// driver-state leftovers and the `.opencode/` config layer init leaves
// uncommitted — fold silently beside them (the manual release a person
// performs with `git add -A` sweeps exactly these); everything else refuses,
// the files listed. No confirmation prompt: the deliberate invocation at a
// stop that named the command is the confirmation, close's discipline.
//
// The result is close's shape — the complete printable output, so the shell
// row is a thin wrapper: "released" (exit 0), "held" (exit 2 — nothing
// awaiting, problems, bare forks, a dirty tree, or a failed commit: the mark
// is written and the manual commit named), "error" (exit 1 — an unreadable
// phase index). The commit is the driver's own, Auto-Stage: clarify, the PLAN
// family the release's other halves (PLAN brief install …) sit in.
import { join } from "node:path"
import { analysisProblems, roundBriefProposals, ROUND_BRIEFS_HEADING } from "./analysis"
import { briefProposal, BRIEF_PROPOSAL_HEADING } from "./brief"
import { ANALYSIS_DOC, roundDirName } from "./docpaths"
import { EOF_MARK } from "./doccheck"
import { changedFiles, commitTree, driverStateFile, repoRoots } from "./git"
import {
  CLARIFIED_MARK,
  clarifiedMark,
  currentRound,
  forkLines,
  forksWithoutRecommend,
  nearMissForkLines,
  phaseGates,
  phaseSurveyDoc,
  readPhases,
  roundRoot,
  routePhase,
  surveyForks,
} from "./phases"
import { loadPhaseTypes } from "./phases/custom"
import { phaseRefText } from "./plan"
import { roadmapRounds } from "./roadmap"
import { shellProfile } from "./shell"
import { loadPlan } from "./tasks"

export type ClarifyResult = { type: "released" | "held" | "error"; lines: string[] }

// `phases` is the project's config value: the analysis gate is
// mode-independent, but the command that consumes a released analysis is
// plan's in m mode (transfer refuses it), so the next-step lines say so.
export type ClarifyOptions = { phases: string }

// The refusal's analysis bullet (plans/0204 D1): the document's state beside
// the survey branch. The third spelling matters — an unreleased analysis past
// the project start is not "released" (which the branch order asserted for a
// document it had just declined to target): its moment has passed, and the
// teaching names the hand channel's real consequences (the roadmap and
// round-brief readers arm on a hand release, living governance for the rounds
// and phases not yet started).
type AnalysisBullet = "released" | "absent" | "unreleased-past"

const analysisBulletLine = (state: AnalysisBullet): string =>
  state === "released"
    ? `the project analysis ${ANALYSIS_DOC} is released`
    : state === "absent"
      ? `no project analysis ${ANALYSIS_DOC} exists`
      : `the project analysis ${ANALYSIS_DOC} is unreleased — its release moment (the project start) has passed, so it is not this command's target; ` +
        `a hand \`${CLARIFIED_MARK}\` edit is the channel, putting the roadmap and round-brief proposals in force for the rounds and phases not yet started`

export async function clarifyGate(directory: string, opts: ClarifyOptions): Promise<ClarifyResult> {
  const { bin } = shellProfile()
  const manual = opts.phases === "m"
  const advance = `${bin} ${manual ? "plan" : "transfer"} ${directory}`

  // —— 1. The analysis gate, at its own moment (plans/0204 D1): the branch is
  // taken only while no round is established — the project-start condition
  // plan's rows 0a–0d and transfer's projectStart hold (`currentRound` 1 with
  // no R-01 directory). Past it an unreleased analysis rides branch 2 as the
  // note, never as the target: the analysis is a living document (the off
  // posture's establishment leaves the stub on disk, a person may draft one
  // at any time), and its mid-project release is a consequential act no stop
  // surfaces.
  const raw = await Bun.file(join(directory, ANALYSIS_DOC)).text().catch(() => undefined)
  const unreleased = raw !== undefined && !clarifiedMark(raw)
  if (unreleased && (await currentRound(directory)) === 1 && !(await roundRoot(directory, 1))) {
    let types: ReturnType<typeof loadPhaseTypes>
    try {
      types = loadPhaseTypes(directory)
    } catch (error) {
      return { type: "error", lines: [`⏸ ${error instanceof Error ? error.message : String(error)}`] }
    }
    const problems = analysisProblems(raw, types)
    if (problems.length) {
      return {
        type: "held",
        lines: [
          `⏸ ${ANALYSIS_DOC} has problems that hold its release:`,
          ...problems.map((problem) => `  ${problem}`),
          `fix them with your agent (this state's guidance is in AGENTS.md), then re-run: ${bin} clarify ${directory} — or write \`${CLARIFIED_MARK}\` yourself once they are fixed`,
        ],
      }
    }
    // The round-brief proposals the release puts in force (plans/0204 D2):
    // one line per `### R-NN`, from analysis.ts's own parser — the same
    // extraction the problems gate and the install path share. The absent
    // posture teaches what a round without a proposal keeps: its gate.
    const briefs = roundBriefProposals(raw)
    return await release(
      directory,
      ANALYSIS_DOC,
      raw,
      [
        `the release of ${ANALYSIS_DOC} puts in force, as written:`,
        ...roadmapRounds(raw).map((entry) => `  - ${roundDirName(entry.round)} ${entry.phases} — ${entry.goal}`),
        ...(briefs.size
          ? [...briefs.keys()].map(
              (round) =>
                `  - ${roundDirName(round)} — its round-brief proposal installs verbatim as its round.md when it opens (that round's round-start gate passes on this release)`,
            )
          : [`  - no \`${ROUND_BRIEFS_HEADING}\` proposals — every round keeps its round-start gate, where you write its round.md by hand`]),
        ...forkLines(raw).map((line) => `  ${line.trim()}`),
        `  ${
          briefProposal(raw) !== undefined
            ? `the \`${BRIEF_PROPOSAL_HEADING}\` proposal installs verbatim into .opencode/auto/brief.md on the release`
            : `no \`${BRIEF_PROPOSAL_HEADING}\` proposal present — the project brief stays as it is`
        }`,
      ],
      `PLAN clarify the analysis release (${ANALYSIS_DOC})`,
      `next: ${advance} — the approved brief installs and ${roundDirName(1)} opens under the roadmap's line`,
    )
  }

  // —— 2. The survey gate of the current human-gated phase —— An unreleased
  // analysis reaching this branch is past its moment: the refusal teaches it
  // in the analysis bullet, every other non-error result carries the same
  // teaching as one appended ℹ line (plans/0204 D1 — one statement per
  // output).
  const analysis: AnalysisBullet = raw === undefined ? "absent" : unreleased ? "unreleased-past" : "released"
  const survey = await surveyGate(directory, opts, bin, advance, analysis)
  if (survey.refusal || survey.result.type === "error" || !unreleased) return survey.result
  return {
    ...survey.result,
    lines: [
      ...survey.result.lines,
      `ℹ ${ANALYSIS_DOC} is unreleased — its release moment (the project start) has passed, so it was not this command's target; ` +
        `a hand \`${CLARIFIED_MARK}\` edit is the channel, putting the roadmap and round-brief proposals in force for the rounds and phases not yet started`,
    ],
  }
}

// Branch 2 (plans/0116 D1): the survey gate over the routed phase, the result
// paired with a refusal flag — the general refusal's analysis bullet is the
// unreleased-analysis teaching's home there, so clarifyGate appends the ℹ
// note only beside the non-refusal results.
async function surveyGate(
  directory: string,
  opts: ClarifyOptions,
  bin: string,
  advance: string,
  analysis: AnalysisBullet,
): Promise<{ result: ClarifyResult; refusal: boolean }> {
  let state: Awaited<ReturnType<typeof readPhases>>
  try {
    state = await readPhases(directory)
  } catch (error) {
    return { result: { type: "error", lines: [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`] }, refusal: false }
  }
  if (state === undefined) return { result: generalRefusal(directory, advance, analysis, "no round is established"), refusal: true }
  const route = await routePhase(directory, { loadPlan, bin, phases: opts.phases })
  if (route.type === "blocked") return { result: { type: "error", lines: [`⏸ phase flow blocked: ${route.reason}`] }, refusal: false }
  if (route.type === "handover" && phaseGates(route.phase).includes("human")) {
    const doc = phaseSurveyDoc(route.phase)
    const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
    if (text === undefined) {
      return {
        result: {
          type: "held",
          lines: [
            `⏸ ${doc} is missing — the survey must exist before the phase can complete; the phase's closing task writes it, so this is a gate problem, not a clarification awaiting you (see the boundary stop)`,
          ],
        },
        refusal: false,
      }
    }
    if (clarifiedMark(text)) {
      // The interrupted release's tell (plans/0207 D2, 0165-187): the mark
      // written but the document uncommitted — a kill between clarify's own
      // write and its commit, or a hand release never committed. The advance
      // the already-released line names would refuse the uncommitted survey
      // at its preflight; the line teaches the one manual commit first.
      // Derived from disk, never a record; the committed case keeps today's
      // line byte-identical.
      if ((await changedFiles(directory)).some((file) => file.replaceAll("\\", "/") === doc)) {
        return {
          result: {
            type: "held",
            lines: [
              `⏸ ${doc} is released in the worktree but the release is not committed — commit it by hand (git add ${doc} && git commit), ` +
                `then continue: ${bin} transfer ${directory} — the phase completes on the next advance`,
            ],
          },
          refusal: false,
        }
      }
      return {
        result: {
          type: "held",
          lines: [`⏸ ${doc} is already released — the phase completes on the next advance: ${bin} transfer ${directory}`],
        },
        refusal: false,
      }
    }
    // Near-miss fork lines (plans/0169 D3): the release accepts exactly the
    // strict grammar's defaults, so a near-miss decision line must be
    // normalized before the release — never silently skipped.
    const nearMiss = nearMissForkLines(text)
    if (nearMiss.length > 0) {
      return {
        result: {
          type: "held",
          lines: [
            `⏸ ${doc} carries ${nearMiss.length} near-miss Fork line(s) the release scan cannot read — normalize them to start with \`Fork:\` (or remove them), then re-run: ${bin} clarify ${directory}`,
            ...nearMiss.map((line) => `  ${line.trim().slice(0, 120)}`),
          ],
        },
        refusal: false,
      }
    }
    if (surveyForks(text) > 0) {
      const bare = forksWithoutRecommend(text)
      if (bare > 0) {
        return {
          result: {
            type: "held",
            lines: [
              `⏸ ${doc} has ${bare} Fork: line(s) without a \`Recommend:\` default — the person decides from consequences plus one default; ` +
                `have your agent add the missing defaults, then re-run: ${bin} clarify ${directory}`,
            ],
          },
          refusal: false,
        }
      }
      return {
        result: await release(
          directory,
          doc,
          text,
          [
            `the release of ${doc} accepts every recorded default:`,
            ...forkLines(text).map((line) => `  ${line.trim()}`),
            `\`${CLARIFIED_MARK}\` accepts every \`Fork:\` line's \`Recommend:\` default — your own answers sit beside the lines (written now or later: a later answer is a plain committed edit the planners read)`,
          ],
          `PLAN clarify ${phaseRefText(route.phase)} (release the recorded forks)`,
          `next: ${bin} transfer ${directory} — the phase completes, the approved \`${BRIEF_PROPOSAL_HEADING}\` section installs, and the next phase's plan task is constructed for your review`,
        ),
        refusal: false,
      }
    }
    // Zero forks with a proposed brief (plans/0169 D3): the proposal's
    // approval is a release moment too — the mark installs it (the sibling
    // channel's shape: the analysis release is mark-gated whatever its fork
    // count). Zero forks and no proposal: the gate passes by itself (an
    // ungated completion) — not a clarification moment; the general refusal
    // below names the state.
    if (surveyForks(text) === 0 && briefProposal(text) !== undefined) {
      return {
        result: await release(
          directory,
          doc,
          text,
          [`the release of ${doc} approves the proposed \`${BRIEF_PROPOSAL_HEADING}\` section — it installs as the project brief on the next advance:`],
          `PLAN clarify ${phaseRefText(route.phase)} (release the proposed brief)`,
          `next: ${bin} transfer ${directory} — the phase completes, the approved \`${BRIEF_PROPOSAL_HEADING}\` section installs, and the next phase's plan task is constructed for your review`,
        ),
        refusal: false,
      }
    }
  } else if (route.type === "execute") {
    const pending = route.plan.tasks.filter((task) => task.status !== "done").length
    return {
      result: {
        type: "held",
        lines: [
          `⏸ ${phaseRefText(route.phase)} still holds ${pending} pending task(s) — the clarification gate follows the phase's completion; execute them first: ${bin} run ${directory}`,
        ],
      },
      refusal: false,
    }
  }
  const atBoundary =
    route.type === "handover"
      ? `${phaseRefText(route.phase)} is at its boundary without a held survey (no open Fork: lines await you)`
      : route.type === "plan"
        ? `${phaseRefText(route.phase)} has no tasks yet — its planning has not run; the gate follows the phase's work`
        : `${roundDirName(state.round)} is complete — the next advance opens the following round`
  return { result: generalRefusal(directory, advance, analysis, atBoundary), refusal: true }
}

// The neither-gate refusal (plans/0116 D2): what was checked, where the mark
// is valid, and the next command.
function generalRefusal(directory: string, advance: string, analysis: AnalysisBullet, stateLine: string): ClarifyResult {
  return {
    type: "held",
    lines: [
      "⏸ nothing awaits your clarification right now:",
      `  - ${analysisBulletLine(analysis)}`,
      `  - ${stateLine}`,
      `\`${CLARIFIED_MARK}\` releases exactly two moments: the unreleased analysis at the project start, and a held survey's open \`Fork:\` lines at a phase boundary — the awaiting stop names the document of the moment.`,
      `next: ${advance}`,
    ],
  }
}

// The shared write-and-commit tail. The dirty check runs first (plans/0116
// D5): the target document's own changes, the driver-state leftovers and the
// `.opencode/` config surfaces (init's never-committed config layer — the
// manual release a person performs with `git add -A` sweeps them, and the
// command emulates that act) fold into the release commit, each non-target
// fold listed in the commit body; everything else refuses with the files
// listed. The write places the exact whole line the gate scans for — before
// the eof terminator when the document carries one (the survey does; the
// terminator stays its last line), else at the document's end. A commit
// failure keeps the mark and names the manual commit (the brief-install
// warning discipline, promoted to the command's own exit); outside git the
// mark is written and no commit is made (close's line).
async function release(
  directory: string,
  doc: string,
  raw: string,
  review: string[],
  subject: string,
  next: string,
): Promise<ClarifyResult> {
  const normalize = (rel: string) => rel.replaceAll("\\", "/")
  const configSurface = (rel: string) => normalize(rel).startsWith(".opencode/")
  const dirty = await changedFiles(directory)
  const other = dirty.filter((file) => !driverStateFile(file) && !configSurface(file) && normalize(file) !== normalize(doc))
  if (other.length) {
    return {
      type: "held",
      lines: [
        `⏸ the worktree has changes beyond ${doc} and the driver's own surfaces (.opencode/, the driver-state files); commit or stash them first — the release commit carries the document's own changes and the mark alone:`,
        ...other.map((file) => `  ${file}`),
      ],
    }
  }
  const folded = dirty.filter((file) => normalize(file) !== normalize(doc))
  const body = folded.length
    ? ["Changes folded into this release commit:", ...folded.map((file) => `- ${file}`)].join("\n")
    : undefined
  await Bun.write(join(directory, doc), withMark(raw))
  const lines = [...review, `✓ \`${CLARIFIED_MARK}\` written to ${doc}`]
  if (!(await repoRoots(directory)).length) {
    return { type: "released", lines: [...lines, "ℹ not a git repository: the release mark is written but not committed"] }
  }
  const settled = await commitTree(directory, { id: "PLAN", title: `clarify (${doc})` }, { stage: "clarify", subject, ...(body !== undefined ? { body } : {}) })
  if (!settled.ok) {
    return {
      type: "held",
      lines: [
        ...lines,
        `⏸ the release commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. ` +
          `The mark is written — commit ${doc} manually, then continue: ${next}`,
      ],
    }
  }
  const foldedLines = folded.length ? [`folded into the release commit: ${folded.join(", ")}`] : []
  return { type: "released", lines: [...lines, `committed: ${subject}`, ...foldedLines, next] }
}

// The document with the release region added (plans/0169 D1): a trailing
// `## Release` section holding the mark, before the eof terminator when the
// text ends with one, else appended at the end — the person's region, a
// shape no session template carries (the legacy flush-left mark a person
// hand-wrote keeps counting; this is the channel the command writes).
// Reached only when no mark is present.
function withMark(raw: string): string {
  const region = `## Release\n\n${CLARIFIED_MARK}`
  const text = raw.trimEnd()
  if (text.endsWith(EOF_MARK)) {
    const body = text.slice(0, text.length - EOF_MARK.length).trimEnd()
    return `${body}\n\n${region}\n\n${EOF_MARK}\n`
  }
  return `${text}\n\n${region}\n`
}
