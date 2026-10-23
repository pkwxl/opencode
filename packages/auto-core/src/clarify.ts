// clarify, the person's release command (plans/0105) — the one command that
// performs the awaiting stop's manual act: it writes the whole-line
// `Clarified: yes` into the one document a gate is awaiting and commits it,
// byte-identical to a correct hand edit plus its commit. The gates stay the
// sole authority (clarifiedMark, phaseGateProblems and analysisProblems are
// untouched; the command only produces the state they read) and the manual
// path stays fully supported — the stop lines name the command first and the
// hand edit beside it.
//
// Two surfaces, resolved in state order (sequential by construction: the
// analysis releases before any round exists):
//   1. the project analysis docs/analysis.md, unreleased — mode-independent
//      (transfer's project-start shape for a phased project, plan's m-mode
//      rows); the release grammar gates run first, so a mark is never written
//      onto a document the release checks would refuse anyway;
//   2. the held survey of the current human-gated phase — the handover route
//      (all tasks done, the phase not complete), survey.md present, open
//      Fork: lines, no mark: the same predicate transfer's boundary refusal
//      and run's boundary stop check ahead of any session.
//
// The command is the review (plans/0105 D3): before writing it prints what
// the mark accepts — the survey's Fork: lines with their Recommend: defaults,
// the analysis's roadmap lines and brief proposal. Overrides keep their
// channel: an answer beside a fork line, written before (riding the release
// commit) or after (a plain committed edit the planners read — the release
// stays).
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
import { analysisProblems } from "./analysis"
import { briefProposal, BRIEF_PROPOSAL_HEADING } from "./brief"
import { ANALYSIS_DOC, roundDirName } from "./docpaths"
import { EOF_MARK } from "./doccheck"
import { changedFiles, commitTree, driverStateFile, repoRoots } from "./git"
import {
  CLARIFIED_MARK,
  clarifiedMark,
  forkLines,
  forksWithoutRecommend,
  phaseGates,
  phaseSurveyDoc,
  readPhases,
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

export async function clarifyGate(directory: string, opts: ClarifyOptions): Promise<ClarifyResult> {
  const { bin } = shellProfile()
  const manual = opts.phases === "m"
  const advance = `${bin} ${manual ? "plan" : "transfer"} ${directory}`

  // —— 1. The analysis gate (state order: before any round exists) ——
  const raw = await Bun.file(join(directory, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw !== undefined && !clarifiedMark(raw)) {
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
    return await release(
      directory,
      ANALYSIS_DOC,
      raw,
      [
        `the release of ${ANALYSIS_DOC} puts in force, as written:`,
        ...roadmapRounds(raw).map((entry) => `  - ${roundDirName(entry.round)} ${entry.phases} — ${entry.goal}`),
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

  // —— 2. The survey gate of the current human-gated phase ——
  let state: Awaited<ReturnType<typeof readPhases>>
  try {
    state = await readPhases(directory)
  } catch (error) {
    return { type: "error", lines: [`⏸ phase flow blocked: ${error instanceof Error ? error.message : String(error)}`] }
  }
  if (state === undefined) return generalRefusal(directory, advance, raw !== undefined, "no round is established")
  const route = await routePhase(directory, { loadPlan, bin })
  if (route.type === "blocked") return { type: "error", lines: [`⏸ phase flow blocked: ${route.reason}`] }
  if (route.type === "handover" && phaseGates(route.phase).includes("human")) {
    const doc = phaseSurveyDoc(route.phase)
    const text = await Bun.file(join(directory, doc)).text().catch(() => undefined)
    if (text === undefined) {
      return {
        type: "held",
        lines: [
          `⏸ ${doc} is missing — the survey must exist before the phase can complete; the phase's closing task writes it, so this is a gate problem, not a clarification awaiting you (see the boundary stop)`,
        ],
      }
    }
    if (clarifiedMark(text)) {
      return {
        type: "held",
        lines: [`⏸ ${doc} is already released — the phase completes on the next advance: ${bin} transfer ${directory}`],
      }
    }
    if (surveyForks(text) > 0) {
      const bare = forksWithoutRecommend(text)
      if (bare > 0) {
        return {
          type: "held",
          lines: [
            `⏸ ${doc} has ${bare} Fork: line(s) without a \`Recommend:\` default — the person decides from consequences plus one default; ` +
              `have your agent add the missing defaults, then re-run: ${bin} clarify ${directory}`,
          ],
        }
      }
      return await release(
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
      )
    }
    // Zero forks: the gate passes by itself (an ungated completion) — not a
    // clarification moment; the general refusal below names the state.
  } else if (route.type === "execute") {
    const pending = route.plan.tasks.filter((task) => task.status !== "done").length
    return {
      type: "held",
      lines: [
        `⏸ ${phaseRefText(route.phase)} still holds ${pending} pending task(s) — the clarification gate follows the phase's completion; execute them first: ${bin} run ${directory}`,
      ],
    }
  }
  const atBoundary =
    route.type === "handover"
      ? `${phaseRefText(route.phase)} is at its boundary without a held survey (no open Fork: lines await you)`
      : route.type === "plan"
        ? `${phaseRefText(route.phase)} has no tasks yet — its planning has not run; the gate follows the phase's work`
        : `${roundDirName(state.round)} is complete — the next advance opens the following round`
  return generalRefusal(directory, advance, raw !== undefined, atBoundary)
}

// The neither-gate refusal (plans/0105 D2): what was checked, where the mark
// is valid, and the next command.
function generalRefusal(directory: string, advance: string, analysisPresent: boolean, stateLine: string): ClarifyResult {
  return {
    type: "held",
    lines: [
      "⏸ nothing awaits your clarification right now:",
      `  - ${analysisPresent ? `the project analysis ${ANALYSIS_DOC} is released` : `no project analysis ${ANALYSIS_DOC} exists`}`,
      `  - ${stateLine}`,
      `\`${CLARIFIED_MARK}\` releases exactly two moments: the unreleased analysis at the project start, and a held survey's open \`Fork:\` lines at a phase boundary — the awaiting stop names the document of the moment.`,
      `next: ${advance}`,
    ],
  }
}

// The shared write-and-commit tail. The dirty check runs first (plans/0105
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

// The document with the release line added: before the eof terminator when
// the text ends with one, else appended at the end — one blank line of
// separation either way. Reached only when no mark is present.
function withMark(raw: string): string {
  const text = raw.trimEnd()
  if (text.endsWith(EOF_MARK)) {
    const body = text.slice(0, text.length - EOF_MARK.length).trimEnd()
    return `${body}\n\n${CLARIFIED_MARK}\n\n${EOF_MARK}\n`
  }
  return `${text}\n\n${CLARIFIED_MARK}\n`
}
