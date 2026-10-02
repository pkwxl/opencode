// The Web client's pure display model (P4a): the vocabularies and shapes the
// DOM renders, with no DOM dependency — bun tests import this module directly
// (test/web-client.test.ts), pinning the client's honesty rules where they
// live instead of scraping the page:
//   - the run-state vocabulary (the exit-code mapping the daemon serves,
//     "paused" spelled as the resumable state it is);
//   - the start form's option vocabulary — the per-run RunAllOpts fields and
//     the OPENCODE_AUTO_* switch layer ONLY. A constitutional config key
//     cannot be typed into a form that has no field for it: the frozen-flag
//     boundary is UI-enforced before the daemon ever sees the request;
//   - the completion display — every "done" mark derives from the status read
//     model's commit verdicts (a unit is done exactly when its done.md exists
//     inside the driver's closing commit — commit-is-completion, the direction
//     draft §五), never from agent self-report and never from log prose (the
//     client renders the log verbatim and parses nothing);
//   - the Closed: distinction — a closed unit renders ⊘ the way the core's
//     own tree marks it: done for scheduling, not delivered.
export type RunState = "starting" | "running" | "completed" | "failed" | "blocked" | "paused" | "killed" | "restored"

// The terminal states in the exit-code vocabulary, spelled for a human: exit
// 0 completed, 1 failed, 2 blocked-needs-human (re-run resumes), 3 the
// graceful pause (progress persisted, re-run resumes precisely — what the
// pause button produces), 130 killed. "starting"/"running" are live;
// "restored" is the P3c restart state (a run the question journal brought
// back after a daemon restart — its worker is not this daemon's child).
export const STATE_LABEL: Record<RunState, string> = {
  starting: "starting",
  running: "running",
  completed: "completed",
  failed: "failed",
  blocked: "blocked — needs a human (re-run resumes)",
  paused: "paused — resumable (progress persisted, re-run resumes precisely)",
  killed: "killed",
  restored: "restored (pending questions recovered after a daemon restart)",
}

export const TERMINAL_RUN_STATES: readonly RunState[] = ["completed", "failed", "blocked", "paused", "killed"]

export const stateLabel = (state: string): string => STATE_LABEL[state as RunState] ?? state
export const isTerminalState = (state: string): boolean => (TERMINAL_RUN_STATES as readonly string[]).includes(state)
export const isLiveState = (state: string): boolean => state === "starting" || state === "running"

// The scope capabilities the UI gates on (the daemon's scope tiers): controls
// hidden without `control`, the question UI without `answer`, the config UI
// (arriving with P4b) without `config`. The scope source is typed — GET
// /session — never a parsed refusal message.
export type Capabilities = { read: boolean; control: boolean; answer: boolean; config: boolean; probe: boolean }

export function capabilitiesOf(scopes: string[]): Capabilities {
  return {
    read: scopes.includes("read"),
    control: scopes.includes("control"),
    answer: scopes.includes("answer"),
    config: scopes.includes("config"),
    probe: scopes.includes("probe"),
  }
}

// —— the start form's vocabulary: per-run options only ——

export const PERMISSION_MODES = ["auto-allow", "ask-allow", "ask-deny", "ask-fail"] as const

// The start form's option fields, exactly the per-run fields the run request
// accepts (the daemon's parseOptions allowlist): the JSON form of the CLI
// `run` session flags. THE FROZEN-FLAG BOUNDARY IS UI-ENFORCED: there is no
// field for any constitutional config key (mode, agent, contextLimit, …) —
// those are frozen by init and revised with amend, and a form that offered
// them would be the exact "convenient runtime config mutation" the
// constitution forbids. The daemon refuses them anyway (parseOptions); the
// client never offers them at all.
export type StartOptionField =
  | { key: "verbose" | "newSession" | "dryrun"; kind: "boolean"; label: string; hint: string }
  | { key: "waitAnswer" | "waitBetween"; kind: "minutes"; label: string; hint: string }
  | { key: "permission"; kind: "enum"; values: readonly string[]; label: string; hint: string }
  | { key: "maxSessions"; kind: "integer"; label: string; hint: string }
  | { key: "server"; kind: "string"; label: string; hint: string }

export const START_OPTION_FIELDS: readonly StartOptionField[] = [
  { key: "verbose", kind: "boolean", label: "verbose", hint: "full log detail (the audit log records in full regardless)" },
  { key: "newSession", kind: "boolean", label: "new session", hint: "start fresh sessions instead of resuming the project's chains" },
  { key: "dryrun", kind: "boolean", label: "dry run", hint: "plan the run's shape without spending agent turns" },
  { key: "waitAnswer", kind: "minutes", label: "wait-answer (minutes)", hint: "how long a question waits for the human before the fallback applies (0 = no wait)" },
  { key: "waitBetween", kind: "minutes", label: "wait-between (minutes)", hint: "the pause between tasks (0 = none; the pause auto-continues on timeout)" },
  { key: "permission", kind: "enum", values: PERMISSION_MODES, label: "permission", hint: "the permission gate's mode for tool use" },
  { key: "maxSessions", kind: "integer", label: "max sessions", hint: "concurrent AI sessions — only 1 is accepted today" },
  { key: "server", kind: "string", label: "agent server", hint: "an external agent server URL this run talks to" },
] as const

// The options the form can produce — a subset of the request vocabulary by
// construction (the field descriptors above are the whole form).
export type StartOptions = Partial<{ verbose: boolean; newSession: boolean; dryrun: boolean; waitAnswer: number; waitBetween: number; permission: string; maxSessions: number; server: string }>

// A usage error of the client's own request builder (the daemon's 400s are
// the authority; these are the same shapes caught one hop earlier).
export class ClientUsageError extends Error {}

const INT = (value: string): number | undefined => {
  if (!/^-?\d+$/.test(value.trim())) return undefined
  return Number(value.trim())
}

// Normalizes the form's raw values into the request's options object, with
// the CLI's own absent-value semantics (empty string = absent). Throws
// ClientUsageError on a shape the daemon would refuse — the labels and hints
// above are the vocabulary; nothing outside it can arrive here.
export function buildStartOptions(raw: Record<string, string>): StartOptions {
  const options: StartOptions = {}
  for (const field of START_OPTION_FIELDS) {
    const value = raw[field.key]
    if (value === undefined || value.trim() === "") continue
    switch (field.kind) {
      case "boolean":
        if (value !== "true" && value !== "false") throw new ClientUsageError(`${field.label} takes true|false`)
        ;(options as Record<string, unknown>)[field.key] = value === "true"
        break
      case "minutes": {
        const minutes = INT(value)
        if (minutes === undefined || minutes < 0 || minutes > 60) throw new ClientUsageError(`${field.label} takes an integer 0..60 (minutes; 0 = no wait)`)
        ;(options as Record<string, unknown>)[field.key] = minutes
        break
      }
      case "enum":
        if (!(field.values as readonly string[]).includes(value)) throw new ClientUsageError(`${field.label} takes ${field.values.join("|")}`)
        ;(options as Record<string, unknown>)[field.key] = value
        break
      case "integer": {
        const count = INT(value)
        if (count === undefined || count < 1) throw new ClientUsageError(`${field.label} takes a positive integer`)
        ;(options as Record<string, unknown>)[field.key] = count
        break
      }
      case "string":
        ;(options as Record<string, unknown>)[field.key] = value.trim()
        break
    }
  }
  return options
}

// The per-run OPENCODE_AUTO_* switch layer. Names must be env-switch names —
// the OPENCODE_AUTO_ prefix is the layer's own grammar, and it is exactly what
// keeps a constitutional config key out: none of them carries the prefix, so
// a "config on a run" cannot even be spelled here (the daemon's registry
// check is the second gate; this is the first).
export function buildSwitches(rows: { name: string; value: string }[]): Record<string, string> {
  const switches: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (!name) continue
    if (!name.startsWith("OPENCODE_AUTO_")) {
      throw new ClientUsageError(`"${name}" is not a switch name: per-run overrides are OPENCODE_AUTO_* environment names (the project's config keys are frozen by init — revise them with amend, never on a run)`)
    }
    switches[name] = row.value
  }
  return switches
}

// —— the completion display: commit verdicts only ——

// The status read model's verdict shapes the client renders (the daemon's
// StatusModel subset — src/observe.ts is the source of truth).
export type PhaseVerdict = { id: string; label: string; done: boolean; closed: string | null; current: boolean }
export type TaskVerdict = {
  id: string
  phase: string
  title: string
  status: "pending" | "in_progress" | "blocked" | "done"
  done: boolean
  closed: string | null
  attempts: number
  subtasks: { text: string; done: boolean }[]
}
export type Verdicts = { rule: string; worktree: "clean" | "dirty"; phases: PhaseVerdict[]; tasks: TaskVerdict[]; problems: string[] }

// One rendered row of the verdict table. `mark` is the completion mark and it
// has exactly one source: the read model's commit verdicts (done.md inside
// the closing commit). ⊘ is the Closed: distinction — a closed unit IS done
// for scheduling (the verdict says done) but not delivered, and the row says
// both rather than collapsing them.
export type VerdictRow =
  | { kind: "phase"; id: string; label: string; mark: "✓" | "⊘" | "▶" | " "; closed: string | null; done: boolean }
  | { kind: "task"; id: string; phase: string; title: string; mark: "✓" | "⊘" | "▶" | "⏸" | " "; closed: string | null; done: boolean; attempts: number; subtasks: { done: number; of: number } }

// The verdicts as display rows, phases then their tasks (the tree's own
// order). Nothing here reads the log, the tail or any agent text: the verdict
// table is the read model's structured verdicts, re-shaped for a table.
export function verdictRows(verdicts: Verdicts): VerdictRow[] {
  const rows: VerdictRow[] = []
  for (const phase of verdicts.phases) {
    rows.push({
      kind: "phase",
      id: phase.id,
      label: phase.label,
      mark: phase.closed !== null ? "⊘" : phase.done ? "✓" : phase.current ? "▶" : " ",
      closed: phase.closed,
      done: phase.done,
    })
    for (const task of verdicts.tasks.filter((task) => task.phase === phase.id)) {
      rows.push({
        kind: "task",
        id: task.id,
        phase: task.phase,
        title: task.title,
        mark: task.closed !== null ? "⊘" : task.done ? "✓" : task.status === "in_progress" ? "▶" : task.status === "blocked" ? "⏸" : " ",
        closed: task.closed,
        done: task.done,
        attempts: task.attempts,
        subtasks: { done: task.subtasks.filter((item) => item.done).length, of: task.subtasks.length },
      })
    }
  }
  return rows
}

// The banner the verdict table carries: the completion rule itself, and —
// when the worktree is dirty — the honest "verdicts unsettled" state (the
// read model settles verdicts only over a clean worktree; git is the record).
export function verdictBanner(verdicts: Verdicts): string {
  if (verdicts.worktree === "dirty") {
    return "worktree dirty — verdicts unsettled (a unit is done when its closing commit landed and the tree is clean; git is the record)"
  }
  return "completion = commit verdicts (done.md renamed inside the driver's closing commit; agent self-report is never trusted)"
}

// The closed-note of a row: the Closed: distinction spelled out, with the
// reason the close recorded (done for scheduling, not delivered).
export function closedNote(closed: string | null): string | null {
  if (closed === null) return null
  return `closed: done for scheduling, not delivered (${closed})`
}
