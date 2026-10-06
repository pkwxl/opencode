// The round user report's driver-side vocabulary (plans/0081): the wrap-up
// task's mandated title — the self-heal's bounded-once guard scans the
// index for it (D4), and the report-duty partial asks the planner for the
// same title so both paths converge — and the D3 charter as one text. The
// planning prompts carry the charter through templates/prompts/_partials.md
// (`## report-duty`); this copy composes the self-heal's append input, so a
// driver-composed input never depends on template text.
import { reportForUserPath } from "./docpaths"

export const REPORT_TASK_TITLE = "Round user report"

// The D3 charter, spelled out for the report's writer. `report` is the
// repository-relative report path; the caller passes it so the text names
// where the artifact goes.
export function reportCharter(report: string): string {
  return [
    `The report is written for the person who started the run — plain prose, path links, no driver-protocol obligations beyond the closing terminator line \`<!-- auto: eof -->\`. Its charter:`,
    `1. What this round set out to do, in the person's own terms (the project brief, the round brief, the planning input);`,
    `2. What happened, phase by phase: what each phase delivered, its verdict, and headline counts (tasks done / failed / blocked / closed by hand);`,
    `3. **Needs your attention** — the section the whole report exists for: every provisionally-defaulted planning question with its options, implications and override path; open questions and the safe defaults currently in force; the round's AUTO-RESOLVE proxy decisions with enough context to confirm or overturn each; FAIL verdicts and what they mean; environment gaps; recorded deviations and assumption notes; mid-round decisions that belong in the project brief (the next survey folds them in);`,
    `4. Where to look deeper: an artifact index (spec-notes, verdicts, notable task reports), one line each — the report links, it never copies at length.`,
  ].join("\n")
}

// The self-heal's append input (D4): one task, the mandated title, the
// report path, the charter in full.
export function reportAppendInput(round: number): string {
  const report = reportForUserPath(round)
  return (
    `Round report self-heal (plans/0081 D4): the round's final phase is about to complete, and ${report} — the round's account ` +
    `to the person who started the run — does not exist or is empty. Append exactly ONE task, titled exactly "${REPORT_TASK_TITLE}", ` +
    `placed last in this phase's task index; its session writes ${report} per the charter below, and the task document restates ` +
    `the charter in full (self-contained, as every task document must be). A FAIL verdict anywhere in the round is one of the ` +
    `report's findings, not a reason to skip the report task.\n\n${reportCharter(report)}`
  )
}
