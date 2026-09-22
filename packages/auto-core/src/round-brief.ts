// The round brief docs/R-NN/round.md (roundBrief role, M4.2, plans/0049 G2):
// the human's statement of what a round is for. establishRound writes the stub
// once; a human fills it in and commits it with the round setup (the named
// round-start gate, plans/0049 G1). Two readers:
//   - every phase-planning session gets the brief (roundBriefText), so phase
//     todo.md files carry no Goal/Exit of their own (plans/0048 R8);
//   - the round-close gate reads the `## Close` section (closeSection), the
//     restatement listing of root plan D12 in its middle form (plans/0049 G8).
// Only the `## Close` heading is protocol (0035, amendment M4.2); the other
// stub headings are scaffolding, and the content under all of them is free.
import { join } from "node:path"
import { roundBriefPath, roundDirName } from "./docpaths"

// Driver protocol string: the heading whose body the round-close gate requires.
export const ROUND_CLOSE_HEADING = "## Close"

// The stub: four sections, each holding only a comment hint, so an untouched
// stub injects nothing into planning and fails the close check.
export function renderRoundBrief(round: number): string {
  return [
    `# Round ${roundDirName(round)}`,
    "",
    "## Goal",
    "",
    "<!-- What this round must achieve, in the target's own terms. Every phase-planning session reads this file. -->",
    "",
    "## Acceptance criteria",
    "",
    "<!-- How a reviewer tells the round's goal was met: checks, behaviors, evidence. -->",
    "",
    "## Release criteria",
    "",
    "<!-- What must hold before the round is closed and the next one starts. The driver itself checks that the whole",
    "     tree holds no reference into docs/T-*, docs/R-* or .auto/ and, when config `build` is set, that the build",
    "     passes. -->",
    "",
    ROUND_CLOSE_HEADING,
    "",
    "<!-- Fill in before `continue`: list the decisions of this round that were restated into the target's own",
    "     documentation, and the ones accepted as lost with the process documents. `continue` refuses while this",
    "     section is empty. -->",
    "",
  ].join("\n")
}

// HTML comments are the stub's hints, never content.
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "")
}

// The brief as planning input: comments stripped, then undefined when no
// section holds any body text (an untouched stub, an empty file, no file).
export async function roundBriefText(dir: string, round: number): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, roundBriefPath(round))).text().catch(() => undefined)
  if (raw === undefined) return undefined
  const text = stripComments(raw)
  const body = text.split("\n").filter((line) => line.trim() && !/^#{1,6}\s/.test(line.trim()))
  return body.length ? text.replace(/\n{3,}/g, "\n\n").trim() : undefined
}

// The body of the `## Close` section with comments stripped: undefined when
// the file or the heading is missing, "" when the section is empty. The
// section runs to the next heading of level 1 or 2.
export function closeSection(text: string): string | undefined {
  const lines = stripComments(text).split("\n")
  const start = lines.findIndex((line) => line.trim() === ROUND_CLOSE_HEADING)
  if (start === -1) return undefined
  const body: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s/.test(line.trim())) break
    body.push(line)
  }
  return body.join("\n").trim()
}
