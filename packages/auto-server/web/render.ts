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

// —— the write surface's scope vocabulary (P4b) ——

// Every write surface the client offers, with the scope that gates it. This
// is the UI's own routing table: a surface whose scope the token lacks is
// NOT RENDERED (never rendered-disabled — a hidden control cannot be
// clicked into a 403), exactly as the scope chips spell. The daemon's
// needScope is the authority; this table is the client's promise that every
// mutation path it can build is gated here first.
export type WriteSurfaceScope = "control" | "config" | "probe"
export type WriteSurface =
  | { surface: "start-run"; scope: "control" }
  | { surface: "close-unit"; scope: "control" }
  | { surface: "task-add"; scope: "control" }
  | { surface: "plan"; scope: "control" }
  | { surface: "config-init"; scope: "config" }
  | { surface: "config-amend"; scope: "config" }
  | { surface: "config-fix"; scope: "config" }
  | { surface: "config-reset"; scope: "config" }
  | { surface: "model-probe"; scope: "probe" }

export const WRITE_SURFACES: readonly WriteSurface[] = [
  { surface: "start-run", scope: "control" },
  { surface: "close-unit", scope: "control" },
  { surface: "task-add", scope: "control" },
  { surface: "plan", scope: "control" },
  { surface: "config-init", scope: "config" },
  { surface: "config-amend", scope: "config" },
  { surface: "config-fix", scope: "config" },
  { surface: "config-reset", scope: "config" },
  { surface: "model-probe", scope: "probe" },
]

// Whether a token's capabilities show a write surface. The models TABLE is
// read (no gate beyond `read`); the PROBE is the write surface of the models
// family — it spends tokens.
export function surfaceVisible(caps: Capabilities, surface: WriteSurface["surface"]): boolean {
  const entry = WRITE_SURFACES.find((item) => item.surface === surface)
  if (!entry) return false
  return caps[entry.scope]
}

// —— the two-step gate flow: confirm and clean-tree as two separate steps ——
//
// The CLI's -f skips BOTH the confirmation and the cleanliness gate; the API
// keeps them as two separate request fields, and the UI keeps them as two
// separate STEPS — never one bundled "force" action. The daemon checks
// clean-tree first, confirm second (the CLI's own order); each refusal
// carries `gate` naming which step asked, and answering one step adds
// exactly its own field to the request — the other step stays unanswered,
// so it will ask again on its own if it applies.

export type GateStep = "cleanTree" | "confirm"

// Which gate a refusal body names (null: not a gate refusal).
export function gateOf(body: Record<string, unknown>): GateStep | null {
  return body.gate === "cleanTree" || body.gate === "confirm" ? body.gate : null
}

// The refusal's own question / findings text, verbatim from the daemon (the
// confirm gate's question is the exact wording the core's prompt would show;
// the clean-tree gate's error is the dirty file list).
export function gateText(body: Record<string, unknown>): string {
  const lines = Array.isArray(body.lines) ? body.lines.filter((line): line is string => typeof line === "string") : []
  if (lines.length) return lines.join("\n")
  return typeof body.question === "string" ? body.question : typeof body.error === "string" ? body.error : ""
}

// The next request after a gate refusal: adds exactly the answered step's
// own field to the base request, touching nothing else. Each step is
// independently refusable — refusing is simply not sending (the flow's
// cancel), and no request exists that bundles both steps' answers before
// both gates asked.
export function answerGate(base: Record<string, unknown>, step: GateStep): Record<string, unknown> {
  return { ...base, [step]: true }
}

// The step's own wording, so the two steps never read as one:
export const GATE_STEP_WORDS: Record<GateStep, { action: string; refusal: string; note: string }> = {
  cleanTree: {
    action: "allow the dirty worktree (cleanTree)",
    refusal: "stop — keep the clean-tree gate",
    note: "its own field: this allows the write on a dirty tree; it confirms nothing",
  },
  confirm: {
    action: "confirm (the [y] the prompt would collect)",
    refusal: "stop — decline",
    note: "its own field: this answers the confirmation; it licenses no dirty tree",
  },
}

// —— the write request builders ——
//
// Each builder produces exactly the daemon's request vocabulary, refusing
// one hop early the shapes the daemon would 400 — the labels and hints of
// the forms are the vocabulary; nothing outside it can arrive here.

// The canonical unit refs close takes (the daemon's own CLOSE_REF): a round
// R-NN, a phase R-NN.P<nn> or a task T-NNN.
export const CLOSE_REF = /^(?:R-\d{2,}|R-\d{2,}\.P\d{2,}|T-\d{3,})$/

export type CloseRequest = { ref: string; reason: string; cascade?: true; changes?: "commit" | "stash" }

export function buildCloseRequest(raw: { ref: string; reason: string; cascade: boolean; changes: string }): CloseRequest {
  const ref = raw.ref.trim()
  if (!CLOSE_REF.test(ref)) throw new ClientUsageError(`${ref || "(empty)"}: not a unit reference; expected a round R-NN, a phase R-NN.P<nn> or a task T-NNN`)
  const reason = raw.reason
  if (!reason.trim()) throw new ClientUsageError('"reason" requires non-empty text (the close reason; the explicit ref and the reason are the confirmation)')
  if (reason.includes("\n")) throw new ClientUsageError('"reason" must be one line (the Closed: value and the close commit subject\'s tail)')
  if (raw.changes !== "" && raw.changes !== "commit" && raw.changes !== "stash") throw new ClientUsageError('changes takes "commit"|"stash" or empty')
  return { ref, reason: reason.trim(), ...(raw.cascade ? { cascade: true } : {}), ...(raw.changes ? { changes: raw.changes as "commit" | "stash" } : {}) }
}

export function buildTaskRequest(title: string): { title: string } {
  if (!title.trim()) throw new ClientUsageError('"title" requires a one-line task title')
  if (title.includes("\n")) throw new ClientUsageError('"title" must be one line; longer context belongs in the task document — add the task, then edit its docs/T-NNN/todo.md')
  return { title: title.trim() }
}

// The plan request: "input" is the planning input text (the CLI's plan -p),
// "append" rides an input (the CLI's own usage rule). With neither, the
// no-agent routes take the request (round establishment, the round-close
// gate, the drift re-sync).
export function buildPlanRequest(input: string, append: boolean): { input?: string; append?: true } {
  const text = input.trim()
  if (append && !text) throw new ClientUsageError('"append" rides a planning input: fill the input first (appending adds the tasks planned from the input)')
  return { ...(text ? { input: text } : {}), ...(append ? { append: true } : {}) }
}

// The config form's field set — the constitutional keys init freezes and
// amend revises, in their config-file spellings (the daemon's
// CONFIG_REQUEST_KEYS). The two keys with no flag (acceptanceGate, build)
// have no field, exactly as the daemon refuses them; nothing here can carry
// a config key to a RUN (that form has none, the frozen-flag boundary).
export type ConfigField =
  | { key: "mode"; kind: "string"; label: string; hint: string }
  | { key: "agent"; kind: "enum"; values: readonly string[]; label: string; hint: string }
  | { key: "contextLimit" | "idleTime" | "idleMax"; kind: "integer"; label: string; hint: string }
  | { key: "subtask"; kind: "enum"; values: readonly string[]; label: string; hint: string }
  | { key: "testByDriver" | "handoverTest" | "autoNumber" | "wrapup"; kind: "boolean"; label: string; hint: string }
  | { key: "phases"; kind: "string"; label: string; hint: string }
  | { key: "parallel"; kind: "enum"; values: readonly string[]; label: string; hint: string }
  | { key: "scanExempt"; kind: "list"; label: string; hint: string }

export const CONFIG_FIELDS: readonly ConfigField[] = [
  { key: "mode", kind: "string", label: "mode", hint: "a registered mode name; defaults to migrate" },
  { key: "agent", kind: "enum", values: ["", "opencode", "claude"], label: "agent", hint: "the coding agent that runs the sessions; opencode drops the key (its default)" },
  { key: "contextLimit", kind: "integer", label: "context limit (k tokens)", hint: "a positive integer; defaults to 64" },
  { key: "subtask", kind: "enum", values: ["", "off", "auto", "true", "ondemand"], label: "subtask", hint: "off|auto|true|ondemand; defaults to auto" },
  { key: "idleTime", kind: "integer", label: "idle time (minutes)", hint: "an integer 1..120; defaults to 10" },
  { key: "idleMax", kind: "integer", label: "idle max (minutes)", hint: "an integer 0..1440 (0 = no cap); defaults to 0" },
  { key: "testByDriver", kind: "boolean", label: "test by driver", hint: "the driver runs the test command (handoverTest requires it)" },
  { key: "handoverTest", kind: "boolean", label: "handover test", hint: "test handover between attempts; requires test by driver" },
  { key: "autoNumber", kind: "boolean", label: "auto number", hint: "continue the T-NNN numbering record automatically" },
  { key: "wrapup", kind: "boolean", label: "wrapup", hint: "the closing wrap-up session after each task" },
  { key: "phases", kind: "string", label: "phases", hint: "a letter preset (e.g. m, amt, admtvk) or phase type ids (analysis,security-review,…)" },
  { key: "parallel", kind: "enum", values: ["", "none", "low", "medium", "high"], label: "parallel", hint: "none|low|medium|high; none drops the key (its default)" },
  { key: "scanExempt", kind: "list", label: "scan exempt (globs)", hint: "path globs relative to the target, comma-separated; empty list drops the key" },
] as const

// Normalizes the form's raw values into the init/amend request's config
// object. Empty means absent (the CLI's absent-value semantics); the
// shape rules are the daemon's own, refused here one hop early. The
// scanExempt list has a third state: "[]" (an explicitly empty list) drops
// the key — spelled as a lone dash in the form.
export function buildConfigRequest(raw: Record<string, string>): { config: Record<string, unknown> } {
  const config: Record<string, unknown> = {}
  for (const field of CONFIG_FIELDS) {
    const value = raw[field.key] ?? ""
    if (field.kind === "boolean") {
      if (value === "true") config[field.key] = true
      else if (value === "false") config[field.key] = false
      else if (value !== "") throw new ClientUsageError(`${field.label} takes true|false`)
      continue
    }
    if (value.trim() === "") continue
    switch (field.kind) {
      case "string":
        config[field.key] = value.trim()
        continue
      case "enum":
        if (!(field.values as readonly string[]).includes(value)) throw new ClientUsageError(`${field.label} takes ${field.values.filter(Boolean).join("|")}`)
        // The key droppers ride as their own spellings (agent "opencode",
        // parallel "none"): the daemon reads them as "drop the key", which
        // is a real amend action (ensure the key is unset), so they are sent.
        config[field.key] = value
        continue
      case "integer": {
        if (!/^\d+$/.test(value.trim())) throw new ClientUsageError(`${field.label} takes an integer`)
        const parsed = Number(value.trim())
        if (field.key === "contextLimit" && parsed < 1) throw new ClientUsageError("context limit takes a positive integer")
        if (field.key === "idleTime" && (parsed < 1 || parsed > 120)) throw new ClientUsageError("idle time takes an integer 1..120 (minutes)")
        if (field.key === "idleMax" && (parsed < 0 || parsed > 1440)) throw new ClientUsageError("idle max takes an integer 0..1440 (minutes)")
        config[field.key] = parsed
        continue
      }
      case "list": {
        // A lone dash is the explicit empty list (drops the key); otherwise
        // comma-separated globs.
        if (value.trim() === "-") continue
        config[field.key] = value.split(",").map((glob) => glob.trim()).filter(Boolean)
        continue
      }
    }
  }
  return { config }
}

// —— the probe's own two-step admin act ——
//
// The probe is behind THREE gates before anything fires: the `probe` scope
// (the surface is not rendered without it), the explicit in-UI confirmation
// (arm, then confirm — two deliberate acts, never a checkbox), and the
// daemon's rate window (429 renders as information, never an auto-retry).
// The builder refuses to build a request before both UI steps were taken.

export type ProbeUiStep = { scope: boolean; armed: boolean; confirmed: boolean }

// The request the confirm step sends — or null when the two-step act is not
// complete (nothing to send: the API method is simply not callable).
export function buildProbeRequest(step: ProbeUiStep): { probe: true; confirm: true } | null {
  if (!step.scope || !step.armed || !step.confirmed) return null
  return { probe: true, confirm: true }
}

// The probe surface's own words: what arming means, what confirming means.
export const PROBE_WORDS = {
  intro: "the probe sends the service-availability prompt to every listed model — one short agent round trip each; it spends real tokens and is rate-limited on this daemon (one fire per window)",
  arm: "arm the probe (step 1 of 2 — reveals the confirmation)",
  confirm: "confirm and fire (step 2 of 2 — this starts agents and spends tokens)",
  disarm: "disarm",
} as const
