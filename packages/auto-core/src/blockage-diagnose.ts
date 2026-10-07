// The blockage diagnosis session and the blockage document (plans/0082
// §4–§6, D3–D8): at a covered block site, after the honest block lines have
// named the located files (D2, printed from src/blockage.ts), the driver
// assembles the dossier, opens one read-only side-channel session on the
// requireArtifact skeleton (the knowledge-extraction dispatch: a fresh
// session, the mode brief + dossier + pointers as input, one artifact — the
// remediation plan), strictly parses the plan (D5, the RESOLVE_FORMAT
// discipline; unparsable or errored ⇒ fail-closed to the static message with
// the raw reply appended to the round's audit trail), writes
// docs/R-NN/blockage-<seq>.md (D6: the driver parses the session's plan into
// the document, header + verbatim sections + the execution protocol) and
// commits it on its own (`Auto-Stage: blockage`, the prompt-audit pattern —
// written before anything it might change, surviving a run that goes no
// further). The interactive fast path (D9) then offers the options over the
// sideband: the pick writes the same `Choice:` line and the executor runs
// inline; declining leaves exactly the detached state.
//
// Read-only (D4): where the adapter cannot restrict the session's toolset,
// the prompt's charter line ("propose only — you never edit; the executor
// ignores anything outside the format") carries the discipline and the
// strict parse is the backstop — the session's only sanctioned write is the
// plan document itself, which the driver rewrites before anything commits.
import { rm } from "node:fs/promises"
import { join } from "node:path"
import { requireArtifact } from "./artifact"
import {
  diagnosisSuspended,
  dossierState,
  evidenceFragments,
  honestBlockLines,
  locateSpans,
  nextBlockageSeq,
  parseRemediationPlan,
  readBlockageDocs,
  renderDossier,
  type BlockMapEntry,
  type RemediationPlan,
} from "./blockage"
import { executeBlockageChoice } from "./blockage-execute"
import type { Interactive } from "./interactive"
import { log } from "./log"
import type { ClientSource, Opts } from "./opts"
import { roundDirName } from "./docpaths"
import { currentRound } from "./phases"
import { renderPrompt } from "./prompt"
import { promptFacts } from "./prompt-facts"
import { autoSwitches } from "./switches"
import { renderTemplate } from "./template"
import { commitTree } from "./git"

// The core-owned operating-mode brief (D3), rendered as pre-built data: the
// template registry holds it, so it versions with the code and never exists
// as a second copy in the target to drift.
export function renderModeBrief(): string {
  return renderTemplate("_mode-brief", {})
}

// What a block site hands the diagnosis: the dossier's inputs (all assembled
// mechanically — the block map from the composition state, the evidence the
// gate produced) plus the two D2 lines the site wants printed.
export type BlockageSite = {
  directory: string
  gate: string
  step: string
  // The verdict text as the audit records it (e.g. "INCONSISTENT — <evidence>").
  verdict: string
  // The free evidence text whose quoted fragments the locator searches.
  evidence: string
  // The render gate's offending literals, searched beside the evidence
  // quotes (same dossier shape, D10 v1).
  literals?: readonly string[]
  blockMap: readonly BlockMapEntry[]
  auditTail: readonly string[]
  intro: string
  next: string
}

// How the site calls the diagnosis: the run's server control (the pool), the
// session options the caller built (sessionOpts at the loop sites; a
// minimal literal at the run boundary), the sideband for the fast path.
export type BlockageCall = { server: ClientSource; opts: Opts; repl?: Interactive }

export type BlockageStatus = "off" | "suspended" | "documented" | "remediated" | "failed" | "dirty"

export type BlockageResult = { status: BlockageStatus; lines: string[]; file?: string }

// The one entry the covered block sites call (verifyPlanStep's two block
// branches, the write-time handover check's fail-closed, the render gate's
// catch): prints the honest block lines, then — switch on, cap not tripped —
// assembles the dossier, diagnoses, writes and commits the document, and
// offers the interactive pick. "remediated" means the caller should let the
// blocked step re-compose and re-verify from scratch (D7); everything else
// blocks as before.
export async function openBlockage(site: BlockageSite, call: BlockageCall): Promise<BlockageResult> {
  const round = await currentRound(site.directory).catch(() => 1)
  const docs = await readBlockageDocs(site.directory, round)
  // The dossier (D1/D2) assembles whatever the switch's fate — the corrected
  // block line is mechanical truth and survives the kill switch.
  const fragments = [...evidenceFragments(site.evidence), ...(site.literals ?? []).filter((literal) => literal.length >= 8)]
  const hits = await locateSpans(
    site.directory,
    fragments,
    docs2sources(site.blockMap),
  )
  for (const line of honestBlockLines({ intro: site.intro, hits, next: site.next })) log(line)
  if (!autoSwitches().remediate) {
    return { status: "off", lines: [`ℹ consented remediation is switched off (${"OPENCODE_AUTO_REMEDIATE"}=off) — the located-file line above stays (mechanical truth), the diagnosis session and the blockage document do not run`] }
  }
  // The two-consecutive-reblocks suspension (D8): static message + full
  // audit pointer — repeated disagreement means the human reads.
  if (diagnosisSuspended(docs, site.step)) {
    return {
      status: "suspended",
      lines: [
        `⏸ diagnosis for ${site.step} is suspended: the last two blockage documents of this step were both executed and the step blocked again (diagnosis quality, or the wrong option keeps being approved) — read ${join("docs", roundDirName(round), "prompt-audit.md")} and the blockage documents, then resolve by hand`,
      ],
    }
  }
  const seq = nextBlockageSeq(docs)
  const file = join("docs", roundDirName(round), `blockage-${seq}.md`)
  const state = await dossierState(site.directory, site.auditTail)
  const dossier = renderDossier({ gate: site.gate, step: site.step, verdict: site.verdict, blockMap: site.blockMap, hits, state })
  // The pointers (D4): the surfaces the session reads on disk — the block
  // map's own sources plus the round's document roots and the audit.
  const pointers = [...new Set([...docs2sources(site.blockMap), join("docs", roundDirName(round)), join("docs", roundDirName(round), "prompt-audit.md")])]
    .filter((path) => !path.includes("(absent)"))
    .join(", ")
  const facts = promptFacts({ dir: site.directory, intent: call.opts.intent })
  const prompt = renderPrompt(facts, "diagnose", { modeBrief: renderModeBrief(), dossier, pointers, file })
  const task = { id: "PLAN", title: `blockage diagnosis (${site.gate})`, status: "in_progress" as const, attempts: 0, body: "" }
  let unparsable = ""
  const diagnosed = await requireArtifact(
    call.server,
    task,
    prompt,
    call.opts,
    {
      kind: "blockage diagnosis",
      role: "diagnose",
      // Independent hidden task unit (entry clean gate + SHA baseline); no
      // spec.commit — the driver commits the final document itself, after
      // rewriting the session's raw plan into it.
      unitStart: true,
      artifact: `the remediation plan ${file} (Analysis, then Options with a Recommendation, or Escalation)`,
      detail: "missing, empty, or not in the strict format",
      get requirement() {
        return (
          `write the remediation plan to ${file} in exactly the format the prompt states (## Analysis; ## Options with ### <A> options — Channel / Edits with verbatim old-span anchors / Consequences — and one Recommendation line; or ## Escalation instead of Options). ` +
          `Every edit names an existing file.${unparsable ? ` Problem last time: ${unparsable}.` : ""}`
        )
      },
      reset: () => rm(join(site.directory, file), { force: true }),
      collect: async () => {
        const text = await Bun.file(join(site.directory, file)).text().catch(() => "")
        const plan = parseRemediationPlan(text)
        if (plan === undefined) {
          unparsable = "the plan did not parse (check the section headings, the channel words, the edit lines' anchors and the Recommendation)"
          return undefined
        }
        if (plan.kind === "options") {
          const missing = plan.options.flatMap((option) => option.edits.map((edit) => edit.path)).filter((path) => path.includes("(") || path.startsWith("<"))
          if (missing.length) {
            unparsable = `edits name files that are not real paths: ${missing.join(", ")}`
            return undefined
          }
        }
        return plan
      },
    },
  )
  if ("type" in diagnosed) {
    if (diagnosed.type === "dirty") {
      return { status: "dirty", lines: [`⏸ worktree not clean before the blockage diagnosis session; handle it manually (commit/clean) and re-run:`, ...diagnosed.files.map((f) => `  ${f}`)] }
    }
    return failClosed(site, round, file, diagnosed.question)
  }
  const plan = diagnosed
  // The document (D6): the driver parses the session's plan into the final
  // shape — header (gate, step, verdict, located spans, block map, state),
  // the sections verbatim, the Decision the person answers, the execution
  // protocol — and commits it on its own.
  const document = renderBlockageDocument({ seq, round, gate: site.gate, step: site.step, verdict: site.verdict, blockMap: site.blockMap, hits, state, plan })
  await Bun.write(join(site.directory, file), document)
  const settled = await commitTree(site.directory, { id: "PLAN", title: `blockage diagnosis (${site.gate})` }, { stage: "blockage", subject: `PLAN blockage ${seq} ${site.gate} (${site.step})` })
  if (!settled.ok) {
    return {
      status: "failed",
      file,
      lines: [`⏸ the blockage document was written to ${file} but its commit failed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Commit it manually and re-run`],
    }
  }
  log(`✓ blockage document committed: ${file} — answer it by writing one line \`Choice: <letter>\` into its Decision section${call.repl ? "" : ", then re-run"}`)
  // The interactive fast path (D9): identical artifacts — the pick writes
  // the same Choice line, the executor runs inline.
  if (call.repl && plan.kind === "options") {
    const picked = await sidebandPick(call.repl, file, plan)
    if (picked !== undefined) {
      const text = await Bun.file(join(site.directory, file)).text()
      const marked = appendChoiceLine(text, picked)
      await Bun.write(join(site.directory, file), marked)
      const choice = await commitTree(site.directory, { id: "PLAN", title: `blockage diagnosis (${site.gate})` }, { stage: "blockage", subject: `PLAN blockage ${seq} choice ${picked} (sideband)` })
      if (!choice.ok) {
        return { status: "failed", file, lines: [`⏸ the sideband choice was written to ${file} but its commit failed: ${choice.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}. Commit it manually and re-run`] }
      }
      const executed = await executeBlockageChoice(site.directory, file, marked)
      if (executed.type === "reblocked") {
        return { status: "failed", file, lines: [`⏸ remediation re-blocked: ${executed.reason}`] }
      }
      return { status: "remediated", file, lines: [`✓ remediation executed inline (${file} option ${picked}) — the blocked step re-composes and re-verifies from scratch`] }
    }
    log(`ℹ sideband pick declined — the detached mark in ${file} stands; write \`Choice: <letter>\` there and re-run`)
  }
  return { status: "documented", file, lines: [] }
}

// The fail-closed arm (D5): the static message plus the raw reply appended
// to the round's audit trail — the verifier's discipline, a guarantee that
// can be slept through is not a guarantee.
async function failClosed(site: BlockageSite, round: number, file: string, question: string): Promise<BlockageResult> {
  await rm(join(site.directory, file), { force: true })
  const audit = join("docs", roundDirName(round), "prompt-audit.md")
  const previous = await Bun.file(join(site.directory, audit)).text().catch(() => "")
  const stamp = new Date().toISOString()
  await Bun.write(
    join(site.directory, audit),
    `${previous.trim() ? `${previous.trimEnd()}\n` : "# Prompt-audit record (plans/0080 §5): every plan-step consistency verdict of this round\n\n"}- ${stamp} blockage diagnosis ${site.step}: FAILED — the session produced no parsable remediation plan; raw tail follows\n${question.trim().split("\n").map((line) => `  ${line}`).join("\n")}\n`,
  )
  const settled = await commitTree(site.directory, { id: "PLAN", title: `blockage diagnosis (${site.gate})` }, { stage: "prompt-audit", subject: `PLAN prompt-audit blockage diagnosis ${site.step} (failed)` })
  if (!settled.ok) {
    log(`⏸ the diagnosis-failure audit record could not be committed: ${settled.failures.map((failure) => `${failure.rel}: ${failure.error}`).join("; ")}; commit ${audit} manually`)
  }
  return {
    status: "failed",
    lines: [`⏸ blockage diagnosis failed closed (no parsable remediation plan after one retry) — the raw reply is appended to ${audit}; fix the diagnosis model or resolve the blockage by hand`],
  }
}

// The block map's source paths (the locator's first tier): the path part
// before any " (absent)" annotation, excluding template ids and inline
// pseudo-sources.
function docs2sources(blocks: readonly BlockMapEntry[]): string[] {
  return blocks
    .map((entry) => entry.source.replace(/\s*\(absent\)$/, ""))
    .filter((source) => /^(\.opencode|docs)\//.test(source))
}

// The interactive pick (D9): the sideband offers the options; a bare option
// letter approves and executes now, anything else (empty, quit, "edit")
// leaves exactly the detached state — the mark can be added later by hand.
async function sidebandPick(repl: Interactive, file: string, plan: Extract<RemediationPlan, { kind: "options" }>): Promise<string | undefined> {
  const options = plan.options.map((option) => `  ${option.id}: ${option.title} (${option.channel})`).join("\n")
  const answer = await repl.question(
    `⏸ blockage ${file} — pick a remediation option to approve and execute now (or reply anything else to leave the detached mark):\n${options}`,
  )
  const letter = answer?.trim().toUpperCase()
  return letter !== undefined && plan.options.some((option) => option.id === letter) ? letter : undefined
}

// Append the person's (sideband-sanctioned) Choice line under the Decision
// heading — the same line they would have written by hand.
export function appendChoiceLine(text: string, option: string): string {
  const lines = text.split("\n")
  const at = lines.findLastIndex((line) => line.trim() === "## Decision")
  const mark = `Choice: ${option}`
  if (at < 0) return `${text.trimEnd()}\n\n${mark}\n`
  lines.splice(at + 1, 0, "", mark)
  return lines.join("\n")
}

// The final document (D6): header + verbatim sections + Decision + the
// execution protocol. The options render in exactly the parser's grammar so
// the executor re-parses what the person approved.
export function renderBlockageDocument(input: {
  seq: number
  round: number
  gate: string
  step: string
  verdict: string
  blockMap: readonly BlockMapEntry[]
  hits: readonly { fragment: string; file?: string; lineStart?: number; lineEnd?: number; unlocated?: boolean }[]
  state: string
  plan: RemediationPlan
}): string {
  const spans = input.hits
    .map((hit) =>
      hit.unlocated || hit.file === undefined || hit.lineStart === undefined
        ? `- "${hit.fragment}" → unlocated (the evidence may paraphrase)`
        : `- "${hit.fragment}" → ${hit.file}:${hit.lineStart}${hit.lineEnd !== undefined && hit.lineEnd !== hit.lineStart ? `-${hit.lineEnd}` : ""}`,
    )
    .join("\n")
  const header = [
    `# Blockage ${input.seq}: ${input.gate} (${input.step})`,
    "",
    `- Round: ${roundDirName(input.round)}`,
    `- Gate: ${input.gate}`,
    `- Step: ${input.step}`,
    `- Verdict: ${input.verdict}`,
    "",
    "Block map:",
    ...input.blockMap.map((entry) => `- ${entry.block} → ${entry.source}`),
    "",
    "Located spans:",
    spans,
    "",
    "State snapshot:",
    ...input.state.split("\n").map((line) => `  ${line}`),
    "",
    "## Analysis",
    "",
    input.plan.analysis,
    "",
  ]
  const body =
    input.plan.kind === "escalation"
      ? ["## Escalation", "", input.plan.escalation, ""]
      : [
          "## Options",
          "",
          ...input.plan.options.flatMap(renderOption),
          `Recommendation: ${input.plan.recommendation}`,
          "",
        ]
  const decision = [
    "## Decision",
    "",
    "Choice: <one option letter>",
    "Notes: <optional>",
    "",
  ]
  const protocol = [
    "## Execution protocol",
    "",
    "1. The next `run`/`plan` executes an un-executed `Choice:` mark mechanically: one commit per edit (`Auto-Stage: remediation`).",
    "2. Each edit applies only while its old span still matches the quoted first and last lines literally; a changed file re-blocks, never overwrites blindly.",
    "3. A mid-sequence commit failure stops the sequence and re-blocks naming the partial state.",
    "4. After execution the blocked step re-composes and re-verifies from scratch — remediation never clears a verdict; only the gate re-running clears it.",
    "5. Driver-exclusive state (index ticks, todo.md → done.md renames, .auto/units.json) is never touched; every gate re-runs.",
    "",
  ]
  return [...header, ...body, ...decision, ...protocol].join("\n")
}

// One option in the parser's grammar (the executor re-parses the document,
// so the document's options must round-trip).
function renderOption(option: Extract<RemediationPlan, { kind: "options" }>["options"][number]): string[] {
  const lines = [`### ${option.id} ${option.title}`, `Channel: ${option.channel}`]
  if (option.channel === "advice") {
    lines.push(`Advice: ${option.advice ?? ""}`)
  } else {
    lines.push("Edits:")
    for (const [index, edit] of option.edits.entries()) {
      lines.push(`${index + 1}. ${edit.path} — replace lines ${edit.first}–${edit.last} (${edit.oldFirst} | ${edit.oldLast}) with:`)
      lines.push(...edit.text.split("\n"))
    }
  }
  lines.push(`Consequences: ${option.consequences}`, "")
  return lines
}

// The render gate's covered block site (plans/0082 §7 D10 v1): the run
// boundary's catch (loop.ts) hands the PromptGuaranteeError here — the
// dossier's shape for the render gate is the violated assert, the offending
// literals and the located sources; the honest block line names files, then
// the blockage machinery owns the decision. Extracted so the boundary and
// the tests drive one code path.
export async function openRenderGateBlockage(input: {
  directory: string
  violation: string
  server: ClientSource
  opts: Opts
  repl?: Interactive
}): Promise<BlockageResult> {
  const result = await openBlockage(
    {
      directory: input.directory,
      gate: "render-gate",
      step: "render",
      verdict: input.violation,
      evidence: input.violation,
      blockMap: [{ block: "the violated assert's literals", source: "the composed prompt" }],
      auditTail: [],
      // The offending literals themselves (D10 v1): the assert line names
      // each literal after "contain", the one anchor free text cannot
      // forge — quote-pairing the whole message would mis-pair the pack's
      // own quoted name.
      literals: [...input.violation.matchAll(/contain "([^"]+)"/g)].map((match) => match[1]!),
      intro: `\u23f8 prompt guarantee violation: ${input.violation}`,
      next: "  fix the located conflicting source (the intent pack, the planning input, or the prompt overlay) and re-run",
    },
    { server: input.server, opts: input.opts, ...(input.repl ? { repl: input.repl } : {}) },
  )
  if (result.status === "off") {
    return { ...result, lines: [...result.lines, "  fix the conflicting source (the intent pack, the planning input, or the prompt overlay) and re-run"] }
  }
  return result
}
