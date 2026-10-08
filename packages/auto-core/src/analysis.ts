// The pre-round project analysis document docs/analysis.md (plans/0084): the
// assisted first-run step that fixes the engagement's goals before any round
// exists. The person and their coding agent produce it together — the agent's
// instructions travel in the AGENTS.md block's analysis guidance state, not in
// a driver-driven session — and the driver's part is the mechanical half this
// module owns: the stub (comment-hinted, the round brief's pattern), the
// grammar checks, and the release facts the prelude acts on. The release
// (`Clarified: yes`, the survey gate's mark reused) simultaneously approves
// the `## Project brief` proposal (installed verbatim into
// .opencode/auto/brief.md by the brief install, plans/0081 D15.2 generalized)
// and hands the round structure to the `## Roadmap` section: one line per
// planned round, `- R-NN <phases> — <goal>`, whose <phases> is the value
// `amend --phases` would set for that round.
//
// The gates check grammar only — required sections hold real content, the
// roadmap lines parse, their phases values resolve. Depth and quality (the
// bar the guidance states: a thorough analysis here determines the key work of
// the rounds that follow) are the person's to judge at the release; a machine
// check cannot see thoroughness, and pretending to would cheapen it.
import { ANALYSIS_DOC } from "./docpaths"
import { resolvePhases, type PhaseTypeEntry } from "./phases/registry"
import { stripComments } from "./round-brief"

// The section headings the release requires (whole `## ` lines; the bodies are
// free). `## Close` has no counterpart here — the analysis predates every
// round and closes by its release, not by a section.
export const ANALYSIS_SECTIONS = ["## Analysis", "## Goals", "## Project brief", "## Roadmap"] as const

// One planned round of the roadmap: `- R-01 adm — <goal>`. The phases value
// holds no spaces (a letter preset or a comma-separated type-id list, the
// `amend --phases` grammar); the separator is an em dash, with `--` accepted
// as the ASCII spelling. Lines that do not match anywhere in the document are
// prose and ignored — the whole-document scan is the survey `Fork:` line's
// rule (a roadmap line under a scratch heading still counts: the person reads
// the whole file before releasing, and so does the driver).
const ROADMAP_LINE = /^\s*[-*]\s*R-(\d+)\s+([a-z][a-z0-9,()-]*)\s+(?:—|--)\s*(.+)$/

// The stub the first plan writes: every section carries only a comment hint,
// so an untouched stub has no content anywhere and fails the release checks
// the way an untouched round brief fails planning injection.
export function renderAnalysisStub(): string {
  return [
    "# Project analysis",
    "",
    "## Analysis",
    "",
    "<!-- The thorough, evidence-based analysis of the project: an existing codebase gets a real -->",
    "<!-- inventory (areas, sizes, structure, what works, what hurts); a fresh project gets a grounded -->",
    "<!-- account of what exists around it. Work with your coding agent; the guidance for this step is -->",
    "<!-- in the AGENTS.md block it reads. -->",
    "",
    "## Goals",
    "",
    "<!-- The overall project goals in the project's own terms, as clarified with the person. -->",
    "",
    "<!-- Open decisions: one `Fork:` line each — options, consequences, a recommended default. -->",
    "<!-- The person answers beside them; an open Fork holds the release. -->",
    "",
    "## Project brief",
    "",
    "<!-- The project's constants: the goal, where the inputs live, where the deliverable goes, the -->",
    "<!-- constraints that bind every round. Installed verbatim into .opencode/auto/brief.md when the -->",
    "<!-- person releases this analysis. -->",
    "",
    "## Roadmap",
    "",
    "<!-- The long-term plan for the next few rounds (usually 2-5), one line per round: -->",
    "<!-- `- R-NN <phases> — <goal>`, where <phases> is the value `amend --phases` sets for that round. -->",
    "<!-- Under each line: that round's key work at task granularity, its acceptance posture, its -->",
    "<!-- dependencies on earlier rounds, and the risks it resolves. The bar: a reader of this roadmap -->",
    "<!-- can tell what each of the next rounds is for without new deciding. -->",
    "",
    "<!-- Release: add the line `Clarified: yes` (whole line) and commit; the next `plan` installs the -->",
    "<!-- approved brief and opens round R-01. -->",
    "",
  ].join("\n")
}

// The body of one `## ` section with the stub's comments stripped: undefined
// when the heading is missing, "" when the section holds no content outside
// comments and headings.
function sectionBody(text: string, heading: string): string | undefined {
  const lines = stripComments(text).split("\n")
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return undefined
  let end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line.trim()))
  if (end === -1) end = lines.length
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim()
}

export type RoadmapRound = { round: number; phases: string; goal: string }

// Every roadmap round line in the document, in order (whole-document scan).
export function roadmapRounds(text: string): RoadmapRound[] {
  const rounds: RoadmapRound[] = []
  for (const line of text.split("\n")) {
    const match = ROADMAP_LINE.exec(line)
    if (match) rounds.push({ round: Number(match[1]), phases: match[2]!, goal: match[3]!.trim() })
  }
  return rounds
}

// The roadmap's phases value for one round, undefined when the roadmap plans
// no line for it (the person diverged, or the roadmap ends before it).
export function roadmapPhases(text: string, round: number): string | undefined {
  return roadmapRounds(text).find((entry) => entry.round === round)?.phases
}

// The grammar problems that hold the release. Empty = the document is
// releasable in shape (whether it is good is the person's call — the release
// line `Clarified: yes` is theirs, checked by phases.ts clarifiedMark).
// `types` resolves the roadmap's phases values against the builtins plus the
// project's custom types, the `amend --phases` yardstick.
export function analysisProblems(text: string, types: readonly PhaseTypeEntry[]): string[] {
  const problems: string[] = []
  for (const heading of ANALYSIS_SECTIONS) {
    const body = sectionBody(text, heading)
    if (body === undefined) problems.push(`${ANALYSIS_DOC} is missing its \`${heading}\` section`)
    else if (!body) problems.push(`\`${heading}\` holds no content yet (the stub's hints are comments, not content)`)
  }
  if (!roadmapRounds(text).length) {
    problems.push(`\`## Roadmap\` plans no round: one line per planned round, \`- R-NN <phases> — <goal>\` (for example \`- R-01 adm — port the retry ladder with tests\`)`)
  }
  const known = types.map((entry) => entry.type)
  for (const entry of roadmapRounds(text)) {
    if (resolvePhases(entry.phases, types)) continue
    problems.push(`the roadmap line \`R-${String(entry.round).padStart(2, "0")} ${entry.phases}\` is not a phases value (a letter preset over admtvk, or a comma-separated type-id list; known types: ${known.join(", ")})`)
  }
  return problems
}
