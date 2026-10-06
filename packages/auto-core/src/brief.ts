// The project brief .opencode/auto/brief.md (plans/0052 D9, superseded by
// plans/0081 D11): the project's *constants* — what this project is, where
// the reference/source lives, where the deliverable goes, the constraints
// every round must respect; read by every planning session of every round.
// Nothing requires the person to fill or maintain it by hand: the optional
// seed (`init --brief <text> | --brief-file <path>`, written verbatim,
// nothing written when omitted) only points the first survey at the
// reference; the analysis owns the brief from there — the survey phase's
// closing task proposes a `## Project brief` section, the person's
// `Clarified: yes` approves it, and the driver installs that section
// verbatim (D15.2, loop-phase.ts installApprovedBrief). `amend --brief
// <text> | --brief-file <path>` stays the person's rare manual override and
// the default path's install channel (D15.4, the `a` phase's proposal).
// The stub-and-hand-edit model (0052 D9) and reset's remove-while-stub rule
// retired with this; a bare re-init writes no brief file (D11.1, §7 A5).
// The headings are scaffolding the driver never parses (0052 §7); `fix`
// writes under `## Source` / `## Target` when it moves the retired keys here.
import { join } from "node:path"
import { stubbedText } from "./round-brief"

export const BRIEF_FILE = join(".opencode", "auto", "brief.md")

export const BRIEF_SOURCE_HEADING = "## Source"
export const BRIEF_TARGET_HEADING = "## Target"

// The survey's brief proposal heading (plans/0081 D15.1): the section the
// survey phase's closing task writes beside its evidence, approved by the
// person's `Clarified: yes` and installed verbatim on release (D15.2).
export const BRIEF_PROPOSAL_HEADING = "## Project brief"

// The brief as planning input: undefined when the file is missing, empty or
// holds only comments (comment-only text injects nothing — a seed or a
// generated brief always carries real text).
export async function projectBriefText(dir: string): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, BRIEF_FILE)).text().catch(() => undefined)
  return raw === undefined ? undefined : stubbedText(raw)
}

// The `## Project brief` proposal inside a survey (plans/0081 D15.1): the
// section body between the heading and the next level-1/2 heading, or
// undefined when the survey carries none or the body is empty. Pure, so the
// install step (loop-phase.ts) and the tests share one extraction.
export function briefProposal(surveyText: string): string | undefined {
  const lines = surveyText.split("\n")
  const start = lines.findIndex((line) => line.trim() === BRIEF_PROPOSAL_HEADING)
  if (start === -1) return undefined
  let end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line.trim()))
  if (end === -1) end = lines.length
  let last = end
  while (last > start + 1 && !lines[last - 1]!.trim()) last--
  const body = lines.slice(start + 1, last).join("\n").trim()
  return body || undefined
}

// Appends `body` to the end of the `heading` section of a brief (before the
// next level-1 or level-2 heading), adding the heading at the end when absent.
export function appendToSection(text: string, heading: string, body: string): string {
  const trimmed = text.trimEnd()
  if (!trimmed) return `${heading}\n\n${body.trimEnd()}\n`
  const lines = trimmed.split("\n")
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start === -1) return `${trimmed}\n\n${heading}\n\n${body.trimEnd()}\n`
  let end = lines.findIndex((line, i) => i > start && /^#{1,2}\s/.test(line.trim()))
  if (end === -1) end = lines.length
  let last = end
  while (last > start + 1 && !lines[last - 1]!.trim()) last--
  const rest = lines.slice(end)
  return [...lines.slice(0, last), "", body.trimEnd(), ...(rest.length ? ["", ...rest] : [])].join("\n") + "\n"
}
