// The roadmap grammar of docs/analysis.md's `## Roadmap` (plans/0084, the
// establishment authority since plans/0101 D5): the machine-parsed round
// lines `- R-NN <phases> — <goal>` and the released readers over them — a
// line rules only once the person released the document with a whole-line
// `Clarified: yes`. Split from src/analysis.ts (plans/0114 D4, provenance's
// precedent) so the runtime plane reaches the readers beside the pipeline
// (`fix`'s supersession finding names the config key a covering roadmap
// retires); analysis keeps the release grammar gates and the establishment
// resolution that composes these. Pure parsing plus the one file read;
// clarifiedMark comes from the phases domain like analysis's own use of it.
import { join } from "node:path"
import { ANALYSIS_DOC } from "./docpaths"
import { clarifiedMark } from "./phases"

// One planned round of the roadmap: `- R-01 adm — <goal>`. The phases value
// is the `amend --phases` grammar — a letter preset or a comma-separated
// type-id list, spaces around the ids accepted and normalized away on
// capture (a session's natural `a, b, c` list parses; the line grammar must
// accept exactly what the phases grammar accepts, or a correct fix bounces);
// the separator is an em dash, with `--` accepted as the ASCII spelling.
// Lines that do not match anywhere in the document are prose and ignored —
// the whole-document scan is the survey `Fork:` line's rule (a roadmap line
// under a scratch heading still counts: the person reads the whole file
// before releasing, and so does the driver).
const ROADMAP_LINE = /^\s*[-*]\s*R-(\d+)\s+([a-z][a-z0-9,() -]*?)\s+(?:—|--)\s*(.+)$/

export type RoadmapRound = { round: number; phases: string; goal: string }

// Every roadmap round line in the document, in order (whole-document scan).
export function roadmapRounds(text: string): RoadmapRound[] {
  const rounds: RoadmapRound[] = []
  for (const line of text.split("\n")) {
    const match = ROADMAP_LINE.exec(line)
    if (match) rounds.push({ round: Number(match[1]!), phases: match[2]!.replace(/\s+/g, ""), goal: match[3]!.trim() })
  }
  return rounds
}

// The roadmap's phases value for one round, undefined when the roadmap plans
// no line for it (the person diverged, or the roadmap ends before it).
export function roadmapPhases(text: string, round: number): string | undefined {
  return roadmapRounds(text).find((entry) => entry.round === round)?.phases
}

// The released roadmap's line for one round, undefined when no analysis
// exists, when it is not released yet (no whole-line `Clarified: yes` — an
// unreleased roadmap is not the person's decision and never rules), or when
// the roadmap plans no line for the round.
export async function releasedRoadmapRound(dir: string, round: number): Promise<RoadmapRound | undefined> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined || !clarifiedMark(raw)) return undefined
  return roadmapRounds(raw).find((entry) => entry.round === round)
}

// The released roadmap's lines as a set (plans/0101 D2 shape 4): undefined
// when no analysis exists, when it is unreleased, or when it plans no line
// at all — such a project never promised a roadmap, so its rounds keep falling
// back to config `phases` forever. A roadmap that plans any line governs the
// sequence's end: the round past its last line meets transfer's
// roadmap-exhausted stop, not a silent config round.
export async function releasedRoadmapRounds(dir: string): Promise<RoadmapRound[] | undefined> {
  const raw = await Bun.file(join(dir, ANALYSIS_DOC)).text().catch(() => undefined)
  if (raw === undefined || !clarifiedMark(raw)) return undefined
  const rounds = roadmapRounds(raw)
  return rounds.length ? rounds : undefined
}

export { ROADMAP_LINE }
