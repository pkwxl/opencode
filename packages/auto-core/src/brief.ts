// The project brief .opencode/auto/brief.md (plans/0052 D9): the human's
// statement of what the whole project is for, including a migration's source
// and target (the retired `source`/`destDir` keys, D3). Modelled on the round
// brief (round-brief.ts): init writes the stub when the file is missing, a
// human fills it in, and every planning session reads it with the comments
// stripped, so an untouched stub injects nothing. reset removes the file only
// while it equals the stub; a filled brief is human intent and is kept.
// The headings are scaffolding the driver never parses (0052 §7); `fix` writes
// under `## Source` / `## Target` when it moves the retired keys here.
import { join } from "node:path"
import { stubbedText } from "./round-brief"

export const BRIEF_FILE = join(".opencode", "auto", "brief.md")

export const BRIEF_SOURCE_HEADING = "## Source"
export const BRIEF_TARGET_HEADING = "## Target"

// The stub: four sections, each holding only a comment hint.
export function renderProjectBrief(): string {
  return [
    "# Project brief",
    "",
    "## Goal",
    "",
    "<!-- What the project must achieve, in the target's own terms. Every planning session reads this file;",
    "     a round's own goal goes in docs/R-NN/round.md. -->",
    "",
    BRIEF_SOURCE_HEADING,
    "",
    "<!-- For a migration: what is migrated from — directories, modules, versions, relative to this directory. -->",
    "",
    BRIEF_TARGET_HEADING,
    "",
    "<!-- Where the deliverable goes: code, tests and user documentation. Keep deliverables out of docs/ and",
    "     .opencode/ — docs/ holds the process documents (docs/R-NN, docs/T-NNN) and .opencode/ the driver's",
    "     configuration. -->",
    "",
    "## Constraints",
    "",
    "<!-- What planning must respect: exclusions, mappings, conventions, tools or dependencies to avoid. -->",
    "",
  ].join("\n")
}

// The brief as planning input: undefined when the file is missing, empty or an
// untouched stub.
export async function projectBriefText(dir: string): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, BRIEF_FILE)).text().catch(() => undefined)
  return raw === undefined ? undefined : stubbedText(raw)
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
