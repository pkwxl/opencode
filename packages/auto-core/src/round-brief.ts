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
// Since plans/0115 the brief has a proposal channel beside the hand-written
// one: a released `### R-NN` subsection under `## Round briefs` of
// docs/analysis.md installs verbatim at the round's open (renderInstalled-
// RoundBrief + installRoundBrief below, the brief-install family's third
// member) — the round-start gate appears only for rounds without a released
// proposal.
import { join } from "node:path"
import { roundBriefPath, roundDir, roundDirName } from "./docpaths"

// Driver protocol string: the heading whose body the round-close gate requires.
export const ROUND_CLOSE_HEADING = "## Close"

// AUTO-DECISION (wording, 0106): two repairs from one field round — the
// enforcer naming caught up to 0101 (`transfer` opens rounds since; m
// mode keeps plan; the hint still said `plan`), and the depth clause
// added after a proxy session filled the section structurally but
// shallow: each restated decision names where it landed, each accepted
// loss names what it cost. The heading stays the protocol; this text is a
// stripped comment hint only. Shared by the stub and the installed brief —
// the round-close gate reads the heading wherever the file came from.
const CLOSE_HINT = [
  "<!-- Fill in before the next round: list the decisions of this round that were restated into the target's own",
  "     documentation, and the ones accepted as lost with the process documents — each restated decision names",
  "     where it landed, each accepted loss names what it cost. `transfer` (m mode: `plan`) refuses to open the",
  "     next round while this section is empty. -->",
]

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
    ...CLOSE_HINT,
    "",
  ].join("\n")
}

// HTML comments are the stub's hints, never content. Exported since the
// project analysis document (src/analysis.ts, plans/0084) stubs the same way
// and its section checks strip with the same rule.
export function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, "")
}

// The brief as planning input: comments stripped, then undefined when no
// section holds any body text (an untouched stub, an empty file, no file).
export async function roundBriefText(dir: string, round: number): Promise<string | undefined> {
  const raw = await Bun.file(join(dir, roundBriefPath(round))).text().catch(() => undefined)
  return raw === undefined ? undefined : stubbedText(raw)
}

// A stubbed document as planning input: comments stripped, undefined when no
// line outside the headings holds text. Shared with the project brief (brief.ts).
export function stubbedText(raw: string): string | undefined {
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

// The installed shape (plans/0115): the proposal body verbatim under the
// round's title, the `## Close` stub section appended so the protocol heading
// the round-close gate reads is in place by construction. The three-part
// discipline of the stub (Goal / Acceptance criteria / Release criteria) stays
// the guidance's bar — the body is the person's released words, structured as
// they structured them (sub-headings included: since plans/0209 D1 the
// extractor keeps every sub-heading that names no round, so a sectioned
// proposal installs whole and this line's "verbatim" is true of it).
export function renderInstalledRoundBrief(round: number, proposal: string): string {
  return [`# Round ${roundDirName(round)}`, "", proposal.trimEnd(), "", ROUND_CLOSE_HEADING, "", ...CLOSE_HINT, ""].join("\n")
}

// The commit seam the install runs through — brief.ts BriefCommitter's shape,
// restated locally so this module (the document layer) imports nothing above
// it: the free commitTree of git.ts and the run's git service both satisfy it.
// The optional paths parameter is the install's own pathspec (plans/0207 D1);
// a seam that ignores it keeps its own scoping, exactly as before.
export type RoundBriefCommitter = (
  dir: string,
  task: { id: string; title: string },
  info: { stage: string; subject: string },
  paths?: readonly string[],
) => Promise<{ ok: boolean; failures?: Array<{ rel: string; error: string }> }>

export type RoundBriefInstall = { installed: boolean; lines: string[] }

// Install a released round-brief proposal (plans/0115 D3): write the composed
// file over the untouched stub, land the driver's own `round-start` commit —
// which sweeps the uncommitted round setup when the install runs at the
// establishment, the driver's commit replacing the gate's person one — and
// return the log lines. Since plans/0207 D1 (0165-013) the sweep is bounded
// to the establishment's write surface: the commit's pathspec is the round's
// root directory `docs/R-NN` (round.md plus the phase index and phase seeds
// establishRoundSetup wrote), so the person's unrelated uncommitted work
// stays for the next clean gate to judge — the release consumptions run
// ahead of it, and what they fold is unlisted otherwise. Never clobbers: a
// round.md that already holds real content stands (the person's file wins,
// an ℹ line saying so). An equal re-run writes nothing and only re-commits
// (the interrupted-install shape: the write landed, the commit did not —
// round.md sits inside the pathspec, so the re-run's commit stages it). The
// commit failure is a ⚠ line, never a throw — the caller's stop owns the
// exit code.
export async function installRoundBrief(
  dir: string,
  round: number,
  source: string,
  proposal: string,
  commit: RoundBriefCommitter,
): Promise<RoundBriefInstall> {
  const target = join(dir, roundBriefPath(round))
  const name = roundDirName(round)
  const composed = renderInstalledRoundBrief(round, proposal)
  const existing = await Bun.file(target).text().catch(() => undefined)
  if (existing !== undefined && existing !== composed && stubbedText(existing) !== undefined) {
    return { installed: false, lines: [`ℹ the released round-brief proposal was not installed: ${roundBriefPath(round)} already holds content — the file on disk stands`] }
  }
  if (existing !== composed) await Bun.write(target, composed)
  const settled = await commit(dir, { id: "PLAN", title: `round start (${name})` }, {
    stage: "round-start",
    subject: `PLAN start ${name} (round brief installed from ${source})`,
  }, [roundDir(round)])
  if (!settled.ok) {
    return {
      installed: true,
      lines: [
        `⚠ the round brief was written to ${roundBriefPath(round)} but its commit failed: ` +
          `${(settled.failures ?? []).map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Commit manually and re-run`,
      ],
    }
  }
  return {
    installed: true,
    lines: [`✓ round brief installed verbatim: ${source} \`### ${name}\` → ${roundBriefPath(round)} (the round-start commit; your release approved it)`],
  }
}
