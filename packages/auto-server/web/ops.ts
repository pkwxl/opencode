// The Web client's write surface (P4b over P1d): the operations panel —
// units (close, task-add), the plan surface, the config ops and the models
// view with the probe. The client's constitution, the same three rules the
// read surface keeps:
//   - EVERY mutation goes API → daemon → core function (closeUnit, addTask,
//     runAll, the config writers): no git in the browser, no .auto/
//     awareness beyond the read endpoints, no request the daemon does not
//     own the vocabulary of;
//   - confirm and clean-tree are TWO SEPARATE STEPS, each with its own
//     button, each independently refusable (the cancel is "do not send"):
//     the first request of a gated flow carries no gate field at all, and
//     each refusal's answer adds exactly its own field (answerGate) — the
//     CLI's -f bundling is history, not API semantics, and the UI does not
//     rebuild it;
//   - scope-gated by the typed session source: the units hide without
//     `control`, the config ops without `config`, the probe without `probe`
//     (hidden, not disabled — a control that cannot be clicked cannot be
//     discovered by a token that must not use it).
// No DOM-global reach: the panel is built once and re-gated per token and
// project selection (refresh()); the deps are read live so a reconnect with
// a different token re-gates everything.
import { AutoApi, ApiError } from "./api"
import {
  answerGate,
  buildCloseRequest,
  buildConfigRequest,
  buildPlanRequest,
  buildProbeRequest,
  buildTaskRequest,
  CONFIG_FIELDS,
  gateOf,
  gateText,
  GATE_STEP_WORDS,
  PROBE_WORDS,
  surfaceVisible,
  type Capabilities,
  type GateStep,
} from "./render"

// —— tiny DOM helpers (the same textContent-only discipline as main.ts) ——

const el = (tag: string, ...children: (Node | string | null | undefined)[]): HTMLElement => {
  const node = document.createElement(tag)
  for (const child of children) if (child !== null && child !== undefined) node.append(typeof child === "string" ? document.createTextNode(child) : child)
  return node
}
const clear = (node: HTMLElement): void => {
  while (node.firstChild) node.removeChild(node.firstChild)
}
const text = (node: HTMLElement, value: string | null | undefined): void => {
  clear(node)
  if (value) node.append(value)
}
const show = (node: HTMLElement, on: boolean): void => {
  node.classList.toggle("hidden", !on)
}
const labeled = (labelText: string, input: HTMLElement, hint?: string): HTMLElement => {
  const label = el("label", labelText)
  label.append(input)
  if (hint) label.title = hint
  return label
}

export type OpsDeps = {
  /** The client's API (re-read per call: a reconnect replaces it). */
  api: () => AutoApi
  /** The token's capabilities (the typed scope source, re-read per refresh). */
  caps: () => Capabilities
  /** The selected project, when one is. */
  project: () => string | undefined
  /** A spawned run to select (the plan flow's centerpiece: its questions land in the run's question card). */
  onRunStarted: (id: string) => void
  /** A write landed — refresh the read model (the status tree, the verdicts). */
  onWrite: () => void
}

export type OpsPanel = {
  root: HTMLElement
  /** Re-gate the surfaces per the token's scopes and the project selection. */
  refresh: () => void
}

// One gated flow in progress: the request as it stands (each answered step's
// field accumulated) and the sender it rides. A flow exists only between a
// gate refusal and its answer (or the cancel); no flow ever starts with a
// gate field in it.
type GateFlow = {
  label: string
  base: Record<string, unknown>
  send: (request: Record<string, unknown>) => Promise<Record<string, unknown>>
}

export function buildOpsPanel(deps: OpsDeps): OpsPanel {
  // —— the shared outcome renderer ——

  const outcome: HTMLElement = el("div")
  outcome.className = "ops-outcome hidden"
  let flow: GateFlow | undefined
  const flowHost: HTMLElement = el("div")

  const linesOf = (body: Record<string, unknown>): string => {
    const lines = Array.isArray(body.lines) ? body.lines.filter((line): line is string => typeof line === "string") : []
    if (lines.length) return lines.join("\n")
    return typeof body.error === "string" ? body.error : ""
  }

  const renderOutcome = (label: string, status: number, body: Record<string, unknown>, gate?: GateStep): void => {
    clear(outcome)
    show(outcome, true)
    const head = el("div", `${label} — ${status}`)
    head.className = status >= 400 ? "err" : "ok-note"
    outcome.append(head)
    const prose = linesOf(body)
    if (prose) {
      const pre = el("pre", prose)
      pre.className = "box"
      outcome.append(pre)
    }
    // The plan operation's spawned run: point at the interactive surface
    // where its questions land (the centerpiece flow — the run is already
    // selected by the caller).
    if (typeof body.id === "string" && body.id.startsWith("run-")) {
      outcome.append(el("div", `the planning session runs as ${body.id}: its questions arrive in the run's pending-questions card — answering them is what lands the tasks`))
    }
    clear(flowHost)
    if (gate === undefined) {
      flow = undefined
      return
    }
    // The gate step: the daemon's own text verbatim, the step's two words,
    // and exactly two buttons — answer this step, or stop. Refusing a step
    // is final for the flow: nothing is sent, the daemon changed nothing.
    const words = GATE_STEP_WORDS[gate]
    const step = el("div")
    step.className = "gatestep"
    const ask = el("div", words.note)
    ask.className = "dim"
    const answer = el("button", words.action)
    answer.className = "primary"
    answer.addEventListener("click", () => {
      const current = flow
      if (!current) return
      const next = answerGate(current.base, gate)
      void sendGated(current.label, next, current.send)
    })
    const refuse = el("button", words.refusal)
    refuse.addEventListener("click", () => {
      flow = undefined
      clear(flowHost)
      outcome.append(el("div", "stopped — the step was refused and nothing was changed"))
    })
    step.append(answer, refuse, ask)
    flowHost.append(step)
    outcome.append(flowHost)
  }

  const sendGated = async (label: string, base: Record<string, unknown>, send: (request: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<void> => {
    try {
      const body = await send(base)
      flow = undefined
      renderOutcome(label, 200, body)
      deps.onWrite()
    } catch (error) {
      if (!(error instanceof ApiError)) {
        renderOutcome(label, 0, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      const step = gateOf(error.body)
      if (step !== null) flow = { label, base, send }
      else flow = undefined
      renderOutcome(label, error.status, error.body, step ?? undefined)
    }
  }

  const sendPlain = async (label: string, call: () => Promise<Record<string, unknown>>): Promise<void> => {
    flow = undefined
    try {
      const body = await call()
      renderOutcome(label, 200, body)
      deps.onWrite()
    } catch (error) {
      if (error instanceof ApiError) renderOutcome(label, error.status, error.body)
      else renderOutcome(label, 0, { error: error instanceof Error ? error.message : String(error) })
    }
  }

  const errOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

  // —— the units block (the control scope): close, task-add, plan ——

  const closeRef = document.createElement("input")
  closeRef.type = "text"
  closeRef.placeholder = "T-001 | R-01.P01 | R-01"
  const closeReason = document.createElement("input")
  closeReason.type = "text"
  closeReason.placeholder = "the one-line reason (the Closed: value)"
  const closeCascade = document.createElement("input")
  closeCascade.type = "checkbox"
  const closeChanges = document.createElement("select")
  closeChanges.append(el("option", ""), el("option", "commit"), el("option", "stash"))
  const closeErr = el("div", "")
  closeErr.className = "err"
  const closeButton = el("button", "close unit")
  closeButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    try {
      const request = buildCloseRequest({ ref: closeRef.value, reason: closeReason.value, cascade: closeCascade.checked, changes: closeChanges.value })
      text(closeErr, "")
      // close takes no gate fields at all: the explicit ref and the reason
      // are the confirmation (everything is reversible: git revert).
      void sendPlain(`close ${request.ref}`, () => deps.api().closeUnit(project, request))
    } catch (error) {
      text(closeErr, errOf(error))
    }
  })

  const taskTitle = document.createElement("input")
  taskTitle.type = "text"
  taskTitle.placeholder = "the one-line task title"
  const taskErr = el("div", "")
  taskErr.className = "err"
  const taskButton = el("button", "add task")
  taskButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    try {
      const request = buildTaskRequest(taskTitle.value)
      text(taskErr, "")
      void sendPlain("task-add", () => deps.api().addTask(project, request))
      taskTitle.value = ""
    } catch (error) {
      text(taskErr, errOf(error))
    }
  })

  const planInput = document.createElement("textarea")
  planInput.placeholder = "the planning input (the CLI's plan -p) — empty for the no-agent routes (round establishment, the round-close gate, the drift re-sync)"
  const planAppend = document.createElement("input")
  planAppend.type = "checkbox"
  const planErr = el("div", "")
  planErr.className = "err"
  const planButton = el("button", "plan")
  planButton.className = "primary"
  planButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    try {
      const request = buildPlanRequest(planInput.value, planAppend.checked)
      text(planErr, "")
      void (async () => {
        try {
          const body = await deps.api().plan(project, request)
          renderOutcome("plan", 200, body)
          if (typeof body.id === "string") deps.onRunStarted(body.id)
          else deps.onWrite()
        } catch (error) {
          if (error instanceof ApiError) renderOutcome("plan", error.status, error.body)
          else renderOutcome("plan", 0, { error: errOf(error) })
        }
      })()
    } catch (error) {
      text(planErr, errOf(error))
    }
  })

  const forceCloseNote = el("div", "closing a unit to let the round advance (the CLI's plan --force-close)? close it above first, then plan — each half its own surface")
  forceCloseNote.className = "dim"
  const unitsBlock = el(
    "div",
    el("h3", "Units (the control scope)"),
    el("div", "close a unit — the explicit ref and the reason are the confirmation (no other step; the undo is git revert of the close commit)"),
    labeled("ref", closeRef, "a round R-NN, a phase R-NN.P<nn> or a task T-NNN"),
    labeled("reason", closeReason),
    labeled("cascade", closeCascade, "close explicit dependents too"),
    labeled("changes", closeChanges, 'how to handle uncommitted changes ("commit" folds them into the close commit, "stash" stashes them); empty refuses anything beyond the driver\'s own state files'),
    el("div", closeButton, closeErr),
    el("div", "add a task (the CLI's plan --new-task route: the document, the index line, the commit — no session)"),
    labeled("title", taskTitle),
    el("div", taskButton, taskErr),
    el("div", "plan — the no-agent routes run in the daemon; a planning input starts the planning session as a run (stopBefore: execute, humanQuestions armed): its questions arrive in the run's pending-questions card, and answering them is what lands the tasks"),
    planInput,
    el("div", labeled("append", planAppend, "append the tasks planned from the input to the current phase (rides an input)")),
    el("div", planButton, planErr),
    forceCloseNote,
  )
  unitsBlock.className = "ops-block"

  // —— the config block (the config scope): init / amend / fix / reset ——

  const configInputs = new Map<string, HTMLElement>()
  const configGrid = el("div")
  configGrid.className = "field"
  for (const field of CONFIG_FIELDS) {
    let input: HTMLElement
    if (field.kind === "boolean") {
      const box = document.createElement("input")
      box.type = "checkbox"
      box.dataset.key = field.key
      box.dataset.kind = "tri"
      input = box
    } else if (field.kind === "enum") {
      const select = document.createElement("select")
      select.dataset.key = field.key
      for (const value of field.values) select.append(el("option", value))
      input = select
    } else {
      const box = document.createElement("input")
      box.type = field.kind === "integer" ? "number" : "text"
      box.dataset.key = field.key
      if (field.kind === "integer" && field.key === "contextLimit") box.min = "1"
      input = box
    }
    input.title = field.hint
    configInputs.set(field.key, input)
    const hint = el("span", field.hint)
    hint.className = "hint"
    configGrid.append(labeled(field.label, input, field.hint), hint)
  }

  // The tri-state booleans: unchecked-and-untouched = absent, checked =
  // true, explicitly toggled off = false (a select would be honest too, but
  // a checkbox with a visible "explicit off" marker is the least lying
  // shape). The marker is the checkbox's title while it holds an explicit
  // false.
  const rawConfig = (): Record<string, string> => {
    const raw: Record<string, string> = {}
    for (const field of CONFIG_FIELDS) {
      const input = configInputs.get(field.key)!
      if (field.kind === "boolean") {
        const box = input as HTMLInputElement
        if (box.dataset.set !== "true") continue // never touched: absent
        raw[field.key] = String(box.checked)
        continue
      }
      const value = (input as HTMLInputElement).value
      if (value.trim() !== "") raw[field.key] = value
    }
    return raw
  }
  for (const field of CONFIG_FIELDS) {
    if (field.kind !== "boolean") continue
    const box = configInputs.get(field.key) as HTMLInputElement
    box.addEventListener("change", () => {
      // First touch marks the key as explicitly set (false included — an
      // amend turning a stored true off is a real revision).
      if (box.dataset.set !== "true") {
        box.dataset.set = "true"
        box.checked = true
      }
      box.title = box.dataset.set === "true" ? `${field.hint} — explicitly set (${box.checked})` : field.hint
    })
  }

  const configErr = el("div", "")
  configErr.className = "err"
  const initButton = el("button", "init (full overwrite)")
  initButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    try {
      const request = buildConfigRequest(rawConfig())
      text(configErr, "")
      // The first request carries the config alone — the gates ask in their
      // own order (clean-tree, then confirm), each answered by its own step.
      void sendGated("init", request, (r) => deps.api().init(project, r))
    } catch (error) {
      text(configErr, errOf(error))
    }
  })
  const amendButton = el("button", "amend (revise the given keys)")
  amendButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    try {
      const request = buildConfigRequest(rawConfig())
      text(configErr, "")
      void sendPlain("amend", () => deps.api().amend(project, request))
    } catch (error) {
      text(configErr, errOf(error))
    }
  })
  const fixPreview = el("button", "fix: preview (dryrun)")
  fixPreview.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    // The dryrun is the read-only drift gate: findings answer 409 with the
    // CLI's exit 1 — rendered as the pre-view it is, never an error color.
    void (async () => {
      try {
        const body = await deps.api().fix(project, { dryrun: true })
        renderOutcome("fix dryrun", 200, body)
      } catch (error) {
        if (error instanceof ApiError) renderOutcome("fix dryrun", error.status, error.body)
        else renderOutcome("fix dryrun", 0, { error: errOf(error) })
      }
    })()
  })
  const fixApply = el("button", "fix: apply")
  fixApply.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    void sendGated("fix", {}, (r) => deps.api().fix(project, r))
  })
  const resetButton = el("button", "reset (de-initialize)")
  resetButton.className = "danger"
  resetButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    void sendGated("reset", {}, (r) => deps.api().reset(project, r))
  })

  const configBlock = el(
    "div",
    el("h3", "Config (the config scope)"),
    el("div", "the constitutional keys, frozen by init and revised here — the two keys with no flag (acceptanceGate, build) are hand-edited in .opencode/auto/config.json and have no field"),
    configGrid,
    el("div", initButton, amendButton, configErr),
    el("div", "fix — the rule table over the config layer:"),
    el("div", fixPreview, fixApply),
    el("div", resetButton),
  )
  configBlock.className = "ops-block"

  // —— the models block (read: the table; probe: the probe) ——

  const modelsPre = el("pre", "")
  modelsPre.className = "box hidden"
  const modelsButton = el("button", "describe the model registry")
  modelsButton.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    void (async () => {
      try {
        const body = await deps.api().models(project)
        show(modelsPre, true)
        text(modelsPre, linesOf(body))
      } catch (error) {
        if (error instanceof ApiError) {
          show(modelsPre, true)
          text(modelsPre, linesOf(error.body))
        } else text(modelsPre, errOf(error))
      }
    })()
  })

  // The probe's two-step admin act: arm (step 1 — deliberate, reveals the
  // confirmation), confirm (step 2 — the only act that sends). No checkbox,
  // no auto-retry: a 429 renders as information (the window's retryAt) and
  // re-arming is a new two-step act.
  const probe = { armed: false }
  const probeIntro = el("div", PROBE_WORDS.intro)
  probeIntro.className = "dim"
  const probeArm = el("button", PROBE_WORDS.arm)
  const probeConfirm = el("button", PROBE_WORDS.confirm)
  probeConfirm.className = "danger"
  const probeDisarm = el("button", PROBE_WORDS.disarm)
  const probeState = el("div", "")
  const renderProbe = (): void => {
    show(probeArm, !probe.armed)
    show(probeConfirm, probe.armed)
    show(probeDisarm, probe.armed)
    text(probeState, probe.armed ? "armed — the confirmation below is step 2 of 2; nothing has been sent" : "")
  }
  probeArm.addEventListener("click", () => {
    probe.armed = true
    renderProbe()
  })
  probeDisarm.addEventListener("click", () => {
    probe.armed = false
    renderProbe()
  })
  probeConfirm.addEventListener("click", () => {
    const project = deps.project()
    if (!project) return
    // buildProbeRequest refuses to build before both steps were taken; the
    // daemon's scope + confirm + rate-window gates answer whatever arrives.
    const request = buildProbeRequest({ scope: surfaceVisible(deps.caps(), "model-probe"), armed: probe.armed, confirmed: true })
    if (!request) return
    probe.armed = false
    renderProbe()
    void sendPlain("model probe", () => deps.api().probeModels(project))
  })

  const probeBlock = el(
    "div",
    el("h3", "The model probe (the probe scope — opt-in, admin-issued)"),
    probeIntro,
    el("div", probeArm, probeConfirm, probeDisarm),
    probeState,
  )
  probeBlock.className = "ops-block"
  renderProbe()

  const modelsBlock = el(
    "div",
    el("h3", "Models (read-only — runs beside a live run)"),
    el("div", modelsButton),
    modelsPre,
  )
  modelsBlock.className = "ops-block"
  modelsBlock.append(probeBlock)

  // —— the panel ——

  const note = el("div", "")
  note.className = "dim"
  const root = el(
    "div",
    el("h2", "Operations"),
    note,
    unitsBlock,
    configBlock,
    modelsBlock,
    outcome,
  )
  root.className = "ops"

  const refresh = (): void => {
    const caps = deps.caps()
    const project = deps.project()
    const any = surfaceVisible(caps, "close-unit") || surfaceVisible(caps, "config-init") || surfaceVisible(caps, "model-probe")
    show(unitsBlock, project !== undefined && surfaceVisible(caps, "close-unit"))
    show(configBlock, project !== undefined && surfaceVisible(caps, "config-init"))
    show(modelsBlock, project !== undefined && caps.read)
    show(probeBlock, project !== undefined && surfaceVisible(caps, "model-probe"))
    const missing: string[] = []
    if (!caps.control) missing.push("control (close, task-add, plan)")
    if (!caps.config) missing.push("config (init, amend, fix, reset)")
    if (!caps.probe) missing.push("probe (the model probe)")
    text(note, project === undefined ? "select a project" : any ? "every mutation goes through the daemon's operations — the client never touches the repository itself" : `the write surface needs a scope this token lacks: ${missing.join("; ")}`)
    if (!caps.probe && probe.armed) {
      // A token swap mid-flow must not leave an armed probe standing.
      probe.armed = false
      renderProbe()
    }
  }

  return { root, refresh }
}
