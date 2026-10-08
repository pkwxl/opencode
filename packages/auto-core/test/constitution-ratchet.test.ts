// The constitution drift ratchet (plans/0072 §2 U-B, executed as T-131): the
// five constants of src/agents-block.ts — POINTER / TEST_PRINCIPLE /
// COMMIT_PRINCIPLE / SUMMARY_PRINCIPLE / REFS_SPEC — are the single source of
// the constitution's wording. Every other carrier (the agent contract, the
// prompt partials and templates, the builtin intent pack and mode text)
// states a constitution rule in its own words or points at the AGENTS.md
// block, and never restates the wording. This suite holds the carriers to
// that, in the chain-writes pattern: a probe table of distinctive phrases per
// rule (each probe validated against its constant so the table cannot rot
// when the wording changes), a scan over the carrier files, and zero hits —
// ever, no budget table. The block's own rendered bytes are frozen (0072's
// amendment), so a probe that stops matching its constant means the constant
// changed illegally, and that failure is the point.
//
// What counts as a restatement: a carrier file containing one of the probe
// phrases verbatim (case-insensitive, minor drift like an inserted "the"
// allowed where the probe says so). Paraphrase drift — same rule, different
// words — is out of the ratchet's reach by design (plans/0072 §4): it is
// caught by the audit cadence, which any edit to a carrier reruns. The
// sanctioned keeps (the mapping's keep rows: the contract's AGENTS.md note,
// the mid-conversation test re-anchors, fanout's stream-scoped sentences) are
// pinned legal below, so a probe addition is checked against them too.
import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { AGENTS_BLOCK_END, AGENTS_BLOCK_START, CONSTITUTION, GUIDANCE, renderAgentsBlock, renderConstitutionPreamble } from "../src/agents-block"

const TEMPLATES = resolve(import.meta.dir, "..", "templates")

// The carrier roots (plans/0072 §4): everything under templates/ a session
// reads. templates/README.md is maintainer documentation about the tool, not
// text any session receives, so it is not a carrier.
const CARRIER_DIRS = [join(TEMPLATES, ".opencode"), join(TEMPLATES, "prompts"), join(TEMPLATES, "intents"), join(TEMPLATES, "modes")]

// The probes: distinctive phrases of each constitution constant. Adding a
// probe: it must match its constant (the anti-rot test enforces this) and
// must not occur in a sanctioned keep (the keeps test enforces that).
const PROBES: Record<keyof typeof CONSTITUTION, RegExp[]> = {
  POINTER: [
    /full content and progress/i,
    /reread them if context has been compacted/i,
    /than relying on (your )?session memory/i,
    /renames of phases, tasks and subtasks/i,
    /ticks in their indexes/i,
    /are made by (the )?DRIVER alone/i,
    /you normally don'?t need to read state files/i,
    /AGENTS\.md is not a place for notes/i,
  ],
  TEST_PRINCIPLE: [
    /Test principle:/i,
    /slow or produce large amounts of output/i,
    /are always run by (the )?DRIVER/i,
    /write the command as a script under/i,
    /write that script'?s path into/i,
    /reports? the exit code and the output file/i,
    /the file directly to judge the result/i,
  ],
  COMMIT_PRINCIPLE: [
    /one unified recursive commit/i,
    /no session should ever run/i,
    /nor alter commit history/i,
    /commit-type command/i,
    /nested sub-repositories first/i,
    /Background worth preserving belongs in/i,
  ],
  SUMMARY_PRINCIPLE: [
    /Summary principle:/i,
    /closing summary or wrap-up narration/i,
    /never reads chat text/i,
    /pure wasted tokens with no reader/i,
    /DRIVER is non-interactive/i,
  ],
  REFS_SPEC: [
    /stable-refs design document/i,
    /live only under/i,
    /S<2-digit-seq>/i,
    /never move them, never rename them/i,
    /these paths are permanent/i,
    /relative to the target directory root/i,
    /DRIVER neither checks nor rewrites references/i,
    /@<sha>/i,
    /Do not reference state files inside round directories/i,
    /differences across rounds are expressed through separate/i,
  ],
}

// The banned wordings: the exact restatement texts U-B collapsed (0072 §6.2's
// duplications K5–K10, K16 and the contradictions' retired sides). They are
// paraphrases of the constitution — the constants' own probes cannot see
// them — so they are banned by name: re-adding any of these texts to a
// carrier fails the ratchet directly. This is the regression arm for the
// consolidation itself; paraphrases beyond this list remain the audit
// cadence's to catch (0072 §4). Each entry names the finding it retired and
// carries its text verbatim (matched case-insensitively as a substring; a
// text that shows up inside a constitution constant belongs in PROBES
// instead — the classification test enforces this).
const BANNED: { finding: string; text: string }[] = [
  // K7: the state-rule partial (retired whole) and the contract's item 5
  { finding: "K7 state-rule", text: "do not run git commit or any other commit command" },
  { finding: "K7 state-rule", text: "git commits are made by the DRIVER" },
  { finding: "K7 state-rule", text: "the index ticks of phases, tasks and subtasks" },
  { finding: "K7 state-rule", text: "do not make them yourself" },
  { finding: "K5 item 5", text: "and do not rewrite commit history" },
  { finding: "K5 item 5", text: "commits all changes in one pass" },
  // K6: the test protocol's retired restatements (contract branch and the
  // whole/subtask inline heads; the operational extras stayed)
  { finding: "K5 item 2", text: "Build, test, compile, lint and other commands" },
  { finding: "K6 contract", text: "the DRIVER feeds the exit code and the output file" },
  { finding: "K6 whole/subtask", text: "or similar commands directly inside the session" },
  { finding: "K6 whole/subtask", text: "write the command as a script into the test/ directory" },
  { finding: "K6 whole/subtask", text: "take a long time or produce a lot of output" },
  { finding: "K4 t-duty", text: "Test execution follows the test execution protocol" },
  { finding: "K4 t-duty", text: "scripts are handed to the DRIVER to run" },
  // K8: the state-file ownership restatements
  { finding: "K5 item 2", text: "State files are read-only" },
  { finding: "K5 item 2", text: "the index ticks and the todo.md → done.md renames are maintained" },
  { finding: "K8 subtask", text: "state files are managed by the DRIVER" },
  { finding: "K8 subtask/doc-layout", text: "you must not create, rename or delete them yourself" },
  { finding: "K8 decompose", text: "neither create done.md nor rename them" },
  { finding: "K8 planners", text: "do not create done.md" },
  { finding: "K8 planners", text: "the completion rename is the DRIVER's job" },
  { finding: "K8 planners/handover", text: "the other state files are read-only" },
  { finding: "K8 planners/handover", text: "maintained exclusively by the DRIVER" },
  { finding: "K8 planners/handover", text: "do not run git commit or similar commands yourself" },
  { finding: "K16 chmod", text: "do not change file permissions via chmod or the like" },
  // K9: doc-layout's retired constitution clauses
  { finding: "K9 doc-layout", text: "always use their permanent docs/T-NNN/… path" },
  { finding: "K9 doc-layout", text: "each phase directory's todo.md / done.md are managed" },
  // K10: wrapup's retired reference instructions
  { finding: "K10 wrapup", text: "you must confirm the path exists before writing it" },
  { finding: "K10 wrapup", text: "the DRIVER does not check references afterwards" },
  { finding: "K10 wrapup", text: "do not reference the state files inside the round directory" },
  // K5 item 1: the contract's retired pointer sentences
  { finding: "K5 item 1", text: "reread them after your context has been compacted" },
  // K2: dryrun's retired restatement wording
  { finding: "K2 dryrun", text: "your final message restates the report's key points" },
]

type Hit = { file: string; line: number; rule: string; text: string }

function carrierFiles(): string[] {
  const files: string[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.md$/.test(name)) files.push(relative(TEMPLATES, p).replaceAll("\\", "/"))
    }
  }
  for (const dir of CARRIER_DIRS) walk(dir)
  return files
}

const globalProbes = (flags: string) => (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)

// The scan: every probe (constant-derived regex and banned literal) against
// every carrier file's text.
function scanTexts(texts: Record<string, string>): Hit[] {
  const probes: [string, RegExp][] = Object.entries(PROBES).flatMap(([rule, list]) => list.map((re) => [rule, re] as [string, RegExp]))
  const g = globalProbes("g")
  const hits: Hit[] = []
  for (const [file, raw] of Object.entries(texts)) {
    const starts: number[] = [0]
    for (let k = 0; k < raw.length; k++) if (raw[k] === "\n") starts.push(k + 1)
    const lineOf = (idx: number): number => {
      let lo = 0
      let hi = starts.length - 1
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1
        if (starts[mid]! <= idx) lo = mid
        else hi = mid - 1
      }
      return lo + 1
    }
    const lowered = raw.toLowerCase()
    for (const [rule, probe] of probes) {
      for (const m of raw.matchAll(g(probe))) {
        const line = lineOf(m.index!)
        const end = raw.indexOf("\n", m.index!)
        hits.push({ file, line, rule, text: raw.slice(starts[line - 1]!, end === -1 ? raw.length : end).trim() })
      }
    }
    for (const { finding, text } of BANNED) {
      const at = lowered.indexOf(text.toLowerCase())
      if (at >= 0) {
        const line = lineOf(at)
        const end = raw.indexOf("\n", at)
        hits.push({ file, line, rule: `banned(${finding})`, text: raw.slice(starts[line - 1]!, end === -1 ? raw.length : end).trim() })
      }
    }
  }
  return hits
}

describe("constitution drift ratchet", () => {
  const texts = Object.fromEntries(carrierFiles().map((file) => [file, readFileSync(join(TEMPLATES, file), "utf8")]))

  test("no carrier restates a constitution wording — the flat rule", () => {
    // One home for the constitution's wording: src/agents-block.ts. Any
    // carrier containing a probe phrase names its site below and belongs
    // reworded to its own voice (or deleted) — never added to a budget.
    const sites = scanTexts(texts).map((hit) => `templates/${hit.file}:${hit.line} [${hit.rule}]: ${hit.text}`)
    expect(sites.join("\n")).toBe("")
    expect(scanTexts(texts).length).toBe(0)
  })

  test("the probe table still sees the constitution", () => {
    // Guards the ratchet against vacuously passing: every probe must match
    // its own constant today, and every rule carries a probe floor. A probe
    // that stops matching means the constant's wording changed — the block's
    // bytes are frozen (0072's amendment), so that failure is loud on
    // purpose; re-anchor the probe only together with a sanctioned constant
    // change, never to silence a hit.
    for (const [rule, probes] of Object.entries(PROBES) as [keyof typeof CONSTITUTION, RegExp[]][]) {
      expect(probes.length, rule).toBeGreaterThanOrEqual(5)
      for (const probe of probes) expect(probe.test(CONSTITUTION[rule]), `${rule}: ${probe}`).toBe(true)
    }
    // Classification: a banned wording is a paraphrase outside the constants
    // (one matching a constant belongs in PROBES, where the anti-rot check
    // applies), and the banned list is non-trivial (the regression arm for
    // the collapse itself).
    for (const { finding, text } of BANNED) {
      for (const constant of Object.values(CONSTITUTION)) expect(constant.toLowerCase().includes(text.toLowerCase()), `banned ${finding}: ${text}`).toBe(false)
    }
    expect(BANNED.length).toBeGreaterThanOrEqual(20)
  })

  test("a planted restatement is caught; the sanctioned keeps stay legal", () => {
    // The scanner pinned on synthetic input (the chain-writes pattern):
    // planting any constitution constant — or any of the retired restatement
    // wordings — into a carrier-shaped text must produce a hit naming the
    // rule, while the mapping's keep rows (texts the person's approved
    // mapping sanctions verbatim) must scan clean, so the probe tables stay
    // compatible with exactly those keeps.
    for (const [rule, text] of Object.entries(CONSTITUTION) as [keyof typeof CONSTITUTION, string][]) {
      const planted = scanTexts({ "prompts/planted.md": `Do the work.\n${text}\nEnd the work.` })
      expect(planted.length, rule).toBeGreaterThan(0)
      expect(planted.every((hit) => hit.rule === rule || hit.rule.startsWith("banned(")), rule).toBe(true)
      expect(planted[0]!.file).toBe("prompts/planted.md")
    }
    // The retired wordings return verbatim, exactly as a regression would
    // re-add them: each banned text is caught by its own entry (a longer
    // retired phrase may also trip a shorter one it contains — "the other
    // state files are read-only" contains the contract item's "State files
    // are read-only" — both hits are correct).
    for (const { finding, text } of BANNED) {
      const planted = scanTexts({ "prompts/regression.md": `Constraints:\n1. ${text}.\n2. End the session.` })
      expect(planted.length, finding).toBeGreaterThanOrEqual(1)
      expect(planted.some((hit) => hit.rule === `banned(${finding})`), finding).toBe(true)
      expect(planted.every((hit) => hit.rule.startsWith("banned(")), finding).toBe(true)
    }
    // The keeps (0072 §6.3 keep rows, verbatim today):
    const keeps: Record<string, string> = {
      // E1 keep: the contract's AGENTS.md note (auto.md item 2 tail)
      "agent/auto.md": "AGENTS.md carries the DRIVER's opencode-auto marker block (pointer/commit/summary/reference conventions,\nmerged into a single <!-- opencode-auto:start --> to <!-- opencode-auto:end --> block) and is not a place for notes:\nrecord anything worth keeping in docs/ documents instead.",
      // E2a's surviving instance: the contract's read-only/chmod sentence
      "agent/auto.md (chmod)": "For the duration of the session AGENTS.md and opencode.json are read-only — you must not edit them,\nand must not restore their write permission with chmod or the like.",
      // E3 keeps: the mid-conversation test re-anchors
      "prompts/test-continue.md": "tests still follow the protocol — put the script into the test/ directory and write the script path into tmp/test.sh for the DRIVER to run, do not run it inside the session.",
      "prompts/test-result.md": "when you need to test again, write the same script path into tmp/test.sh once more to re-run it (the script is in the test/ directory, reusable, and may be modified before re-running).",
      // E4 keep: fanout's stream-scoped record sentence
      "prompts/fanout.md": "The DRIVER's commit is this stream's record: write no {{outputFile}} for code changes.",
      // E5/R12 keep: the dryrun highlights channel (K2 resolved on the dryrun side; the block is frozen)
      "prompts/dryrun.md": "your final message is this run's printed highlights — the DRIVER takes it as the report's key points (the run asks for that one line, so it is not the closing summary the AGENTS.md constitution bans).",
      // wrapup's status sentence (E4's flagged instance there was the state-rule include, not this lead)
      "prompts/wrapup.md": "3. The task status is recorded by the DRIVER in one pass after the session ends.",
      // R6 keep: ground-state's ledger wording ("git commit records" is a thing not to infer from, not a prohibition)
      "prompts/ground-state": "ticks are maintained by the DRIVER once each subtask session ends and do not change during a session;\nnever infer whether this task is done from other tasks' documents, handovers or git commit records",
    }
    const keepHits = scanTexts(keeps)
    expect(keepHits.map((hit) => `${hit.file} [${hit.rule}] ${hit.text}`)).toEqual([])
  })

  test("one source, two renderings: the preamble is the block's body", () => {
    // The seam T-137 consumes (plans/0076's standalone work orders): the
    // preamble renders exactly the block's paragraphs, so the AGENTS.md
    // block and the exported constitution can never drift apart, and the
    // switch drops exactly the test principle.
    for (const testByDriver of [true, false]) {
      const block = renderAgentsBlock({ testByDriver })
      const preamble = renderConstitutionPreamble({ testByDriver })
      expect(block).toBe(`${AGENTS_BLOCK_START}\n${preamble}\n${AGENTS_BLOCK_END}`)
      expect(block.startsWith(`${AGENTS_BLOCK_START}\nThis directory is driven by opencode-auto.`)).toBe(true)
      expect(block.endsWith(`${AGENTS_BLOCK_END}`)).toBe(true)
      expect(preamble.split("\n\n")).toHaveLength(testByDriver ? 5 : 4)
    }
  })

  test("the preparation guidance renders beside the constitution only when asked (plans/0084)", () => {
    // The execution floor stays byte-identical without `guidance` (the test
    // above holds it); with it, the primer, the assist rule and the state's
    // own text ride inside the markers — the whole delivery surface for the
    // assisted-preparation states, pinned so the guidance cannot silently
    // shrink to nothing.
    expect(GUIDANCE.DRIVER_PRIMER.length).toBeGreaterThan(500)
    expect(GUIDANCE.ASSIST_RULE).toContain("never invent the person's answer")
    expect(GUIDANCE.ANALYSIS_STATE).toContain("determines the key work of the rounds that follow")
    for (const guidance of [
      { kind: "analysis" },
      { kind: "round", round: "R-01" },
      { kind: "phase", phase: "R-01.P01", inputPath: "docs/R-01/P01-implement/plan-input.md", scaffold: "- What this step is for" },
    ] as const) {
      const rendered = renderAgentsBlock({ guidance })
      expect(rendered.startsWith(`${AGENTS_BLOCK_START}\nThis directory is driven by opencode-auto.`)).toBe(true)
      expect(rendered.endsWith(`${AGENTS_BLOCK_END}`)).toBe(true)
      expect(rendered).toContain(GUIDANCE.DRIVER_PRIMER)
      expect(rendered).toContain(GUIDANCE.ASSIST_RULE)
      expect(rendered.length).toBeGreaterThan(renderAgentsBlock().length)
    }
    expect(renderAgentsBlock({ guidance: { kind: "analysis" } })).toContain(GUIDANCE.ANALYSIS_STATE)
    expect(renderAgentsBlock({ guidance: { kind: "round", round: "R-02" } })).toContain("round R-02 preparation")
    expect(renderAgentsBlock({ guidance: { kind: "phase", phase: "R-01.P02", inputPath: "docs/R-01/P02-design/plan-input.md", scaffold: "s" } })).toContain(
      "phase R-01.P02 preparation",
    )
    expect(renderAgentsBlock({ guidance: { kind: "phase", phase: "R-01.P02", inputPath: "docs/R-01/P02-design/plan-input.md", scaffold: "s" } })).toContain(
      "docs/R-01/P02-design/plan-input.md",
    )
  })
})
