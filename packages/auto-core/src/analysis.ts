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
// the round's own phases value (the roadmap-line grammar).
//
// The gates check grammar only — required sections hold real content, the
// roadmap lines parse, their phases values resolve. Depth and quality (the
// bar the guidance states: a thorough analysis here determines the key work of
// the rounds that follow) are the person's to judge at the release; a machine
// check cannot see thoroughness, and pretending to would cheapen it.
// After the release the text stays alive as the survey phase's planning
// input (analysisText below, plans/0085): what the analysis settles is
// settled — the survey records settled lines instead of re-raising forks.
// Since plans/0101 D5 the released roadmap is also the establishment
// authority: each round's line is applied as its phase list (the resolution
// below), config `phases` the fallback for rounds the roadmap does not
// cover. Since plans/0115 the document also carries the round-brief
// proposals — the optional `## Round briefs` section whose released `### R-NN`
// subsections install verbatim as each round's round.md at its open, the
// proposal-install family's third member. The line grammar and the released
// readers live in src/roadmap.ts (plans/0114 D4, provenance's precedent) so
// the runtime plane's detection sites reach them beside this module; the
// release grammar gates, the round-brief proposals and the establishment
// resolution stay here.
import { join } from "node:path"
import { ANALYSIS_DOC, roundDirName } from "./docpaths"
import { CLARIFIED_MARK, clarifiedMark } from "./phases"
import { resolvePhases, type PhaseTypeEntry } from "./phases/registry"
import { stripComments, stubbedText } from "./round-brief"
import { normalizeNewlines, releasedRoadmapRound, roadmapRounds, ROADMAP_LINE, type RoadmapRound } from "./roadmap"

// The section headings the release requires (whole `## ` lines; the bodies are
// free). `## Close` has no counterpart here — the analysis predates every
// round and closes by its release, not by a section. `## Round briefs` is
// deliberately absent: an optional section, present only when the person
// drafts per-round brief proposals (plans/0115), checked by its own rules in
// analysisProblems rather than the required list.
export const ANALYSIS_SECTIONS = ["## Analysis", "## Goals", "## Project brief", "## Roadmap"] as const

// The optional round-brief proposal section (plans/0115): `### R-NN`
// subsections, each the body that round's round.md installs verbatim when the
// round opens — the proposal-install family's third member beside the project
// brief (0081 D15) and the roadmap lines (0101 D5). Released by the same
// whole-document `Clarified: yes`, living governance the same way: a
// subsection added to a released document later installs at that round's open.
export const ROUND_BRIEFS_HEADING = "## Round briefs"

const ROUND_BRIEF_HEAD = /^###\s+R-(\d+)$/
// Headings under the section that look like a round brief but do not parse —
// the near-miss discipline (a `#### R-05 notes`, an `### R-05 — port` reads
// as drafted to its author, installs nothing as its own round, and — since
// plans/0158 D3 — never rides into the preceding subsection's installed body
// either; the unpadded `### R-5` form is legal, the roadmap's rule — 0115
// D2's enumeration slip, corrected by plans/0209 D1).
const ROUND_BRIEF_NEAR = /^\s*#{3,6}\s*R-\d+\b/

// The `### R-NN` proposal bodies under `## Round briefs`, comments stripped:
// round → body ("" when the subsection holds no content — a problem
// analysisProblems names). The body is free markdown (0115 D2): only a
// round-shaped head (a `#### R-06 notes`, an `### R-6 x` — ROUND_BRIEF_NEAR)
// terminates the current subsection, so a near-miss drafted after a valid
// subsection never rides verbatim into that round's installed brief; every
// other sub-heading (`#### Acceptance criteria`, any `#{3,6}` line naming no
// round) is body — the sectioned proposal the stub's own hint invites rides
// whole (plans/0209 D1, amending 0158 D3's every-heading terminator: it
// guarded the near-miss shape by silently eating the natural brief shape).
// A level-1/2 heading ends the whole section — proposals after it are lost,
// named by roundBriefLostHeadings. Pure, so the problems and the install
// path share one extraction.
export function roundBriefProposals(text: string): Map<number, string> {
  const lines = stripComments(text).split("\n")
  const start = lines.findIndex((line) => line.trim() === ROUND_BRIEFS_HEADING)
  const found = new Map<number, string>()
  if (start === -1) return found
  let current: { round: number; body: string[] } | undefined
  const settle = () => {
    if (current) found.set(current.round, current.body.join("\n").trim())
  }
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (/^#{1,2}\s/.test(trimmed)) break
    const head = ROUND_BRIEF_HEAD.exec(trimmed)
    if (head) {
      settle()
      current = { round: Number(head[1]!), body: [] }
    } else if (ROUND_BRIEF_NEAR.test(trimmed)) {
      // A round-shaped head that is not an exact head ends the current
      // subsection: the body collection stops until the next exact head,
      // so a near-miss never rides into another round's installed brief.
      settle()
      current = undefined
    } else if (current) {
      // The release mark is document-level punctuation wherever it sits (the
      // whole-document rule the roadmap's reader shares) — never brief
      // content: with this section last in the document, the person's mark
      // lands inside the final subsection and must not install verbatim.
      if (trimmed !== CLARIFIED_MARK) current.body.push(line)
    }
  }
  settle()
  return found
}

// Exact `### R-NN` heads stranded after the section's end: a `##`/`#` heading
// ends `## Round briefs`, so every exact head beyond it reads as drafted but
// never parses — the install-at-open flow (0115) and the release scan (which
// runs only at the project start) both miss them. Named as a problem at the
// release and taught at the stranded round's open (roundBriefNearMissNote's
// second arm, plans/0209 D1). [] when the section or no head after its end
// exists.
export function roundBriefLostHeadings(text: string): string[] {
  const lines = stripComments(text).split("\n")
  const start = lines.findIndex((line) => line.trim() === ROUND_BRIEFS_HEADING)
  if (start === -1) return []
  const lost: string[] = []
  let ended = false
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (/^#{1,2}\s/.test(trimmed)) ended = true
    else if (ended && ROUND_BRIEF_HEAD.test(trimmed)) lost.push(trimmed)
  }
  return lost
}

// The near-miss heads under the section: headings that look like a round
// brief but are not exactly `### R-NN` (the round id alone on the line).
export function roundBriefNearMisses(text: string): string[] {
  const lines = stripComments(text).split("\n")
  const start = lines.findIndex((line) => line.trim() === ROUND_BRIEFS_HEADING)
  if (start === -1) return []
  const heads: string[] = []
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim()
    if (/^#{1,2}\s/.test(trimmed)) break
    if (ROUND_BRIEF_NEAR.test(trimmed) && !ROUND_BRIEF_HEAD.test(trimmed)) {
      heads.push(trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed)
    }
  }
  return heads
}

// The released round-brief proposal for one round: undefined when no analysis
// exists, when it is not released yet (the same whole-line `Clarified: yes`
// the roadmap readers require — an unreleased proposal is not the person's
// decision and never installs), or when it holds no proposal (or an empty
// one) for the round. The proposal is living governance: drafted between
// rounds into the already-released document, it installs at that round's open
// (the moved-roadmap-line rule, plans/0114).
export async function releasedRoundBriefProposal(dir: string, round: number): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined || !clarifiedMark(raw)) return undefined
  const body = roundBriefProposals(raw).get(round)
  return body ? body : undefined
}

// A released near-miss heading that names the round being opened (plans/0158
// D3), and — since plans/0209 D1 — an exact head stranded past the section's
// end: neither ever installs as the round's proposal (the near-miss never
// parses; the stranded head sits after the `##` heading that ends the
// section), so the round opens on the round-start gate as though nothing was
// drafted — the release scan that would have named them runs only at the
// project start, and the living-governance flow never re-checks. One teaching
// line at that open, the detection record (P8); undefined when the document
// holds neither shape naming the round — heads naming other rounds stay
// silent here and surface at their own rounds' opens, so a document is never
// scanned loud for a round it is not opening.
export async function roundBriefNearMissNote(dir: string, round: number): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined || !clarifiedMark(raw)) return undefined
  const heads = roundBriefNearMisses(raw).filter((head) => {
    const id = /R-(\d+)/.exec(head)
    return id !== null && Number(id[1]) === round
  })
  const stranded = roundBriefLostHeadings(raw).filter((head) => {
    const id = /R-(\d+)/.exec(head)
    return id !== null && Number(id[1]) === round
  })
  if (!heads.length && !stranded.length) return undefined
  const parts: string[] = []
  if (heads.length) {
    parts.push(
      `${ANALYSIS_DOC} carries round-brief heading(s) that do not parse — ${heads.map((head) => `\`${head}\``).join("; ")} ` +
        `read as drafted for ${roundDirName(round)} but never install as its brief; write each as \`### R-NN\` (the round id alone on the line) and commit`,
    )
  }
  if (stranded.length) {
    parts.push(
      `${ANALYSIS_DOC} carries round-brief proposal(s) after the section's end — ${stranded.map((head) => `\`${head}\``).join("; ")} ` +
        `read as drafted for ${roundDirName(round)} but never install (a \`##\` heading ends \`## Round briefs\`); move each above the heading that ends the section and commit`,
    )
  }
  return `ℹ ${parts.join("; ")}`
}

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
    "<!-- Open decisions: one `Fork:` line each — options with their project-level -->",
    "<!-- consequences (goal, rounds, cost, acceptance), then `Recommend:` one default on -->",
    "<!-- the Fork: line itself: a fork is one physical line — the release prints the line -->",
    "<!-- alone as the person's review — and detail beneath the line is prose support, -->",
    "<!-- never a separate Recommend: item. -->",
    "<!-- The person answers beside them; an open Fork holds the release. -->",
    "",
    "## Project brief",
    "",
    "<!-- The project's constants: the goal, where the inputs live, where the deliverable goes, the -->",
    "<!-- constraints that bind every round. Installed verbatim into .opencode/auto/brief.md when the -->",
    "<!-- person releases this analysis — as the whole file: any earlier brief on disk is replaced, -->",
    "<!-- so carry its content into this section. -->",
    "",
    "## Roadmap",
    "",
    "<!-- The long-term plan for the next few rounds (usually 2-5), one machine-parsed line per -->",
    "<!-- round: `- R-NN <phases> — <goal>` exactly — nothing else between the round id and the dash -->",
    "<!-- (bold markers or a parenthetical there breaks the parse); <phases> is the value -->",
    "<!-- the round's phases value: a letter preset or comma-separated type ids. -->",
    "<!-- Under each line: that round's key work at task granularity, its acceptance posture, its -->",
    "<!-- dependencies on earlier rounds, and the risks it resolves. The bar: a reader of this roadmap -->",
    "<!-- can tell what each of the next rounds is for without new deciding. -->",

    "<!-- Roadmap round lines parse mechanically: `- R-NN <phases> — <goal>` with nothing else between -->",
    "<!-- the round id and the dash — a decorated bullet does not parse and holds this release; a -->",
    "<!-- round's detail lives under its line as prose. -->",
    "<!-- Release: add the line `Clarified: yes` (whole line) and commit; the next `plan` installs the -->",
    "<!-- approved brief and opens round R-01. -->",
    "",
    "## Round briefs",
    "",
    "<!-- Optional: one `### R-NN` subsection per round, its body that round's brief (goal, -->",
    "<!-- acceptance criteria, release criteria — the content of docs/R-NN/round.md). -->",
    "<!-- Sub-headings inside a proposal (`#### Acceptance criteria`) are its body; a `##` -->",
    "<!-- heading ends this section, so keep every proposal above any later `##` heading. The -->",
    "<!-- driver installs the round's proposal verbatim when the round opens; a round without a -->",
    "<!-- proposal keeps the round-start gate, where you write its round.md by hand. A subsection -->",
    "<!-- may be drafted into this living document between rounds — added, committed, and -->",
    "<!-- installed at that round's open. -->",
    "",
  ].join("\n")
}

// The analysis as planning input (plans/0085 A1): the survey phase's
// planning session renders the approved text so its decisions travel —
// undefined when the file is missing or holds only comments (no analysis,
// or the not-yet-released stub; the survey then plans from the brief alone).
export async function analysisText(dir: string): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  return raw === undefined ? undefined : stubbedText(raw)
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

export type RoundPhasesResolution = { phases: string; roadmap?: RoadmapRound }

// Roadmap-driven establishment (plans/0101 D5): the released roadmap's line
// for a round *is* its phase list — `roadmapPhases(analysis, round) ??
// config.phases`, the one resolution establishment and the drift checks
// share, so a roadmap-established round is never drift against config and a
// config value alone never silently re-shapes a round the roadmap covers.
// The line rides along for the sourced stop line and the strict-failure
// naming. m mode never consults the roadmap (an m-mode project has no phased
// roadmap), whatever lines the document carries.
export async function resolveRoundPhases(dir: string, round: number, fallback: string): Promise<RoundPhasesResolution> {
  if (fallback === "m") return { phases: fallback }
  const roadmap = await releasedRoadmapRound(dir, round)
  return roadmap ? { phases: roadmap.phases, roadmap } : { phases: fallback }
}

// Round-like bullets that fail the parse — the incident shape: a document
// whose rounds are all written as decorated bullets (`- **R-01 (…) — goal**`)
// reads to its author as planned, and a rule stated generically never points
// at those lines. In a real environment the tool's messages are the only
// standard a stranded session can reach (the tool's source is not at hand),
// so the problems name the document's own non-parsing bullets, capped at
// three heads with the rest counted. The scan reads the same CRLF-normalized
// view the roadmap reader parses (plans/0158 D1), so a line here is a line
// the reader genuinely cannot parse — never a line-ending artifact.
const ROUNDLIKE_BULLET = /^\s*[-*]\s*\*{0,2}\s*R-\d+/

function nearMissHeads(text: string): string[] {
  return normalizeNewlines(text)
    .split("\n")
    .filter((line) => ROUNDLIKE_BULLET.test(line) && !ROADMAP_LINE.test(line))
    .map((line) => {
      const head = line.trim()
      return head.length > 64 ? `${head.slice(0, 64)}…` : head
    })
}

// The grammar problems that hold the release. Empty = the document is
// releasable in shape (whether it is good is the person's call — the release
// line `Clarified: yes` is theirs, checked by phases.ts clarifiedMark).
// `types` resolves the roadmap's phases values against the builtins plus the
// project's custom types — the same yardstick the config key uses.
export function analysisProblems(text: string, types: readonly PhaseTypeEntry[]): string[] {
  const problems: string[] = []
  for (const heading of ANALYSIS_SECTIONS) {
    const body = sectionBody(text, heading)
    if (body === undefined) problems.push(`${ANALYSIS_DOC} is missing its \`${heading}\` section`)
    else if (!body) problems.push(`\`${heading}\` holds no content yet (the stub's hints are comments, not content)`)
  }
  const rounds = roadmapRounds(text)
  const near = nearMissHeads(text)
  const tail = near.length > 3 ? ` (+${near.length - 3} more)` : ""
  const known = types.map((entry) => entry.type)
  if (!rounds.length) {
    const named = near.length ? `; this document's round-like bullets do not parse: ${near.slice(0, 3).join("; ")}${tail}` : ""
    problems.push(
      `\`## Roadmap\` plans no round: one line per planned round, \`- R-NN <phases> — <goal>\` exactly — nothing else between the round id and the dash (bold markers or a parenthetical there breaks the parse; a round's detail goes under the line as prose); <phases> is the round's phases value — a letter preset over admtvk containing m, or comma-separated type ids from the known types (${known.join(", ")}), at least one of them implement — for example \`- R-01 adm — port the retry ladder with tests\` or \`- R-01 analysis,implement — port the core and tests\`${named}`,
    )
  } else if (near.length) {
    // A passing roadmap with a decorated leftover is silently lossy: the
    // bullet's round looks planned but carries no phases advice, so it is a
    // problem of its own, not a footnote to the empty case.
    problems.push(
      `rounds that look planned but do not parse (each planned round is one line \`- R-NN <phases> — <goal>\`, nothing else between the round id and the dash; a non-parsing bullet's round gets no phases advice): ${near.slice(0, 3).join("; ")}${tail}`,
    )
  }
  for (const entry of rounds) {
    if (resolvePhases(entry.phases, types)) continue
    problems.push(`the roadmap line \`R-${String(entry.round).padStart(2, "0")} ${entry.phases}\` is not a phases value (a letter preset over admtvk, or a comma-separated type-id list; known types: ${known.join(", ")})`)
  }
  // The optional round-brief proposals (plans/0115 D2): only when the section
  // is present — an absent section is the byte-identical floor. A drafted but
  // empty subsection reads as planned and would install nothing, a near-miss
  // heading never parses as its round's proposal (since plans/0158 D3 it
  // terminates the subsection it follows instead of riding verbatim into that
  // round's installed brief; since plans/0209 D1 the terminator is the
  // round-shaped head alone — every other sub-heading is body), and an exact
  // head stranded after the section's end (plans/0209 D1) reads as drafted
  // but never parses — the release-time namings complemented by the install
  // path's roundBriefNearMissNote for shapes drafted into a released document
  // later, which this scan never re-reads.
  const briefs = roundBriefProposals(text)
  if (briefs.size || roundBriefNearMisses(text).length) {
    const empty = [...briefs.entries()].filter(([, body]) => !body).map(([round]) => `### R-${String(round).padStart(2, "0")}`)
    if (empty.length) {
      problems.push(`round-brief proposals that hold no content: ${empty.slice(0, 3).map((head) => `\`${head}\``).join(", ")}${empty.length > 3 ? ` (+${empty.length - 3} more)` : ""} — fill each with that round's brief (goal, acceptance and release criteria) or remove it; an empty proposal installs nothing`)
    }
    const nearBriefs = roundBriefNearMisses(text)
    if (nearBriefs.length) {
      problems.push(`round-brief proposal headings that do not parse (each proposal is one heading \`### R-NN\` — the round id alone, nothing else on the line): ${nearBriefs.slice(0, 3).map((head) => `\`${head}\``).join("; ")}${nearBriefs.length > 3 ? ` (+${nearBriefs.length - 3} more)` : ""}`)
    }
  }
  const stranded = roundBriefLostHeadings(text)
  if (stranded.length) {
    problems.push(
      `round-brief proposals after the section's end: ${stranded.slice(0, 3).map((head) => `\`${head}\``).join(", ")}${stranded.length > 3 ? ` (+${stranded.length - 3} more)` : ""} — a \`##\` heading ends \`## Round briefs\`, so these never install; move each proposal above the heading that ends the section (or demote that heading below \`##\`) and commit`,
    )
  }
  return problems
}
