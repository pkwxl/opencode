// The Web client's page wiring (P4a, auto-core plans/0067 §三.4): the thin
// layer over the daemon's P1–P3 surfaces — the read surface (the project
// whitelist, the run list, the status tree and its commit verdicts, the SSE
// streams, the pending questions) and the run control surface (start, pause,
// kill). The page is the served shell (web/index.html); this module is the
// whole behavior, built with no framework and no dependency — the daemon
// bundles it (script/build-web.ts) and serves it as /app.js.
//
// The client's constitution, mirrored from the direction draft §五:
//   - commit-is-completion: every "done" the page shows renders from the
//     status read model's commit verdicts (done.md inside the closing
//     commit) — never from agent self-report, never from the log. The log is
//     rendered verbatim in a pre and NOTHING parses it;
//   - the frozen-flag boundary is UI-enforced: the start form offers the
//     run's own options and the OPENCODE_AUTO_* switch layer only — no
//     config key has a field to ride in;
//   - the token is the gate: scope-aware (controls hidden without `control`,
//     the question UI without `answer`), carried on the Authorization header
//     (and on the WS query string, the browser's one header-less channel);
//   - the client writes nothing but through the daemon's API: no git in the
//     browser, no .auto/ awareness beyond the read endpoints.
import { AutoApi, ApiError, type ProjectSummary, type RunView, type StatusModel } from "./api"
import { SseTail, type SseFrame } from "./sse"
import { InteractiveSession, type PendingQuestion } from "./interactive"
import { buildStartOptions, buildSwitches, capabilitiesOf, closedNote, isLiveState, isTerminalState, START_OPTION_FIELDS, stateLabel, verdictBanner, verdictRows, type Capabilities } from "./render"

// —— tiny DOM helpers (textContent everywhere: no dynamic HTML is ever built) ——

const byId = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id)
  if (!(found instanceof HTMLElement)) throw new Error(`the page is missing #${id}`)
  return found as T
}
const el = (tag: string, ...children: (Node | string | null | undefined)[]): HTMLElement => {
  const node = document.createElement(tag)
  for (const child of children) if (child !== null && child !== undefined) node.append(typeof child === "string" ? document.createTextNode(child) : child)
  return node
}
const clear = (node: HTMLElement): void => {
  while (node.firstChild) node.removeChild(node.firstChild)
}
const show = (node: HTMLElement, on: boolean): void => {
  node.classList.toggle("hidden", !on)
}
const text = (node: HTMLElement, value: string | null | undefined): void => {
  clear(node)
  if (value) node.append(value)
}

// The caps the streams keep (the page stays livable over a long run).
const LOG_LINES = 2000
const EVENT_LINES = 500

type State = {
  token: string
  api: AutoApi
  scopes: string[]
  caps: Capabilities
  projects: ProjectSummary[]
  project: string | undefined
  model: StatusModel | undefined
  runs: RunView[]
  run: string | undefined
  session: InteractiveSession | undefined
  logTail: SseTail | undefined
  engineTail: SseTail | undefined
  statusEventsTail: SseTail | undefined
  lastEventId: number
}

const state: State = {
  token: "",
  api: new AutoApi("", ""),
  scopes: [],
  caps: capabilitiesOf([]),
  projects: [],
  project: undefined,
  model: undefined,
  runs: [],
  run: undefined,
  session: undefined,
  logTail: undefined,
  engineTail: undefined,
  statusEventsTail: undefined,
  lastEventId: 0,
}

// The one-shot readers bound at module scope (they exist before connect).
const ui = {
  conn: byId<HTMLSpanElement>("conn"),
  scopes: byId<HTMLSpanElement>("scopes"),
  projectsNote: byId<HTMLParagraphElement>("projects-note"),
  projects: byId<HTMLUListElement>("projects"),
  projectEmpty: byId<HTMLParagraphElement>("project-empty"),
  projectBody: byId<HTMLDivElement>("project-body"),
  projectHead: byId<HTMLDivElement>("project-head"),
  lockLine: byId<HTMLDivElement>("lock-line"),
  statusTree: byId<HTMLPreElement>("status-tree"),
  verdictBanner: byId<HTMLDivElement>("verdict-banner"),
  verdicts: byId<HTMLTableElement>("verdicts"),
  git: byId<HTMLDivElement>("git"),
  startWrap: byId<HTMLDivElement>("start-wrap"),
  startOptions: byId<HTMLDivElement>("start-options"),
  switchRows: byId<HTMLDivElement>("switch-rows"),
  startError: byId<HTMLDivElement>("start-error"),
  runsNote: byId<HTMLParagraphElement>("runs-note"),
  runs: byId<HTMLTableElement>("runs"),
  runDetail: byId<HTMLDivElement>("run-detail"),
  runHead: byId<HTMLDivElement>("run-head"),
  runControls: byId<HTMLDivElement>("run-controls"),
  questionsNote: byId<HTMLDivElement>("questions-note"),
  questions: byId<HTMLDivElement>("questions"),
  statusEvents: byId<HTMLPreElement>("status-events"),
  log: byId<HTMLPreElement>("log"),
  engineEvents: byId<HTMLPreElement>("engine-events"),
  tail: byId<HTMLPreElement>("tail"),
}

// —— connection ——

const setConn = (note: string, kind: "ok" | "down" | ""): void => {
  text(ui.conn, note)
  ui.conn.className = kind
}

async function connect(token: string): Promise<void> {
  const api = new AutoApi(window.location.origin, token)
  let session
  try {
    session = await api.session()
  } catch (error) {
    setConn(error instanceof ApiError ? `refused (${error.status}): ${error.message}` : "cannot reach the daemon", "down")
    return
  }
  state.token = token
  state.api = api
  state.scopes = session.scopes
  state.caps = capabilitiesOf(session.scopes)
  setConn(`connected · ${session.service}`, "ok")
  renderScopes()
  buildStartForm()
  await Promise.all([refreshProjects(), refreshRuns()])
  window.setInterval(() => void refreshRuns(), 2000)
  window.setInterval(() => void refreshStatus(), 3000)
}

function renderScopes(): void {
  clear(ui.scopes)
  for (const scope of ["read", "control", "answer", "config", "probe"]) {
    const chip = el("span", scope)
    chip.className = `scope${state.caps[scope as keyof Capabilities] ? " on" : ""}`
    chip.title = state.caps[scope as keyof Capabilities] ? `this token carries the ${scope} scope` : `this token does not carry the ${scope} scope`
    ui.scopes.append(chip)
  }
}

// —— projects ——

async function refreshProjects(): Promise<void> {
  if (!state.caps.read) {
    text(ui.projectsNote, "this token has no read scope — the project list needs it")
    return
  }
  try {
    state.projects = await state.api.projects()
  } catch {
    return // the next tick retries; the conn indicator says the rest
  }
  clear(ui.projects)
  text(ui.projectsNote, state.projects.length ? `${state.projects.length} registered (the whitelist)` : "no registered projects (register with: opencode-auto-server register <dir>)")
  for (const project of state.projects) {
    const item = el("li", el("span", project.name), el("span", project.directory))
    item.className = project.name === state.project ? "sel" : ""
    item.querySelector(":scope > span:last-child")?.classList.add("dir")
    item.addEventListener("click", () => void selectProject(project.name))
    ui.projects.append(item)
  }
}

async function selectProject(name: string): Promise<void> {
  state.project = name
  state.run = undefined
  stopStreams()
  await refreshProjects()
  await refreshStatus()
  openStreams()
  renderRun()
  show(ui.projectBody, true)
  show(ui.projectEmpty, false)
  show(ui.startWrap, state.caps.control)
}

// —— the status read model ——

async function refreshStatus(): Promise<void> {
  if (!state.project || !state.caps.read) return
  try {
    state.model = await state.api.status(state.project)
  } catch {
    return // a refused poll (a daemon blip) is the next tick's business
  }
  renderStatus()
  // A selected run's tail is part of the run view's own refresh.
  if (state.run) void refreshSelectedRun()
}

function renderStatus(): void {
  const model = state.model
  if (!model) return
  const project = state.projects.find((entry) => entry.name === state.project)
  clear(ui.projectHead)
  ui.projectHead.append(el("strong", state.project ?? ""), el("span", ` ${model.directory}`))
  if (project) ui.projectHead.append(el("span", ` registered ${project.registered}`))
  text(ui.lockLine, model.lock ? model.lock.statusLine : "")
  ui.lockLine.className = model.lock ? "banner lock" : "hidden"
  text(ui.statusTree, model.status.join("\n"))
  text(ui.verdictBanner, verdictBanner(model.verdicts))
  renderVerdicts(model)
  renderGit(model)
}

function renderVerdicts(model: StatusModel): void {
  clear(ui.verdicts)
  const head = el("tr", el("th", ""), el("th", "unit"), el("th", "state"), el("th", "note"))
  ui.verdicts.append(el("thead", head))
  const body = el("tbody")
  for (const row of verdictRows(model.verdicts)) {
    const mark = el("span", row.mark)
    mark.className = "mark"
    const stateText = row.kind === "phase" ? (row.done ? "done" : row.closed !== null ? "closed" : "open") : row.done ? "done" : row.mark === "▶" ? "in progress" : row.mark === "⏸" ? "blocked" : "pending"
    const note = row.closed !== null ? el("span", closedNote(row.closed) ?? "") : undefined
    if (note) note.className = "closed-note"
    const unit = row.kind === "phase" ? el("span", `${row.id} — ${row.label}`) : el("span", `${row.id} ${row.title}`)
    if (row.kind === "task" && row.subtasks.of > 0) unit.append(el("span", ` [subtasks ${row.subtasks.done}/${row.subtasks.of}]`))
    if (row.kind === "task" && row.attempts > 0 && !row.done) unit.append(el("span", ` (attempts: ${row.attempts})`))
    const tr = el("tr", el("td", mark), el("td", unit), el("td", stateText), el("td", note ?? ""))
    if (row.kind === "phase") tr.style.fontWeight = "600"
    body.append(tr)
  }
  for (const problem of model.verdicts.problems) body.append(el("tr", el("td", "⚠"), el("td", problem)))
  if (model.unparsable.length) body.append(el("tr", el("td", "⚠"), el("td", `state files mid-write (no change / retry next tick): ${model.unparsable.join(", ")}`)))
  ui.verdicts.append(body)
}

function renderGit(model: StatusModel): void {
  clear(ui.git)
  const overall = el("div", model.git.clean ? "clean" : "dirty")
  overall.className = model.git.clean ? "banner" : "banner warn"
  ui.git.append(overall)
  for (const worktree of model.git.worktrees) {
    const row = el("div", `${worktree.clean ? "✓ clean" : "✗ dirty"} — ${worktree.root}`)
    if (!worktree.clean) {
      const list = el("pre", worktree.changed.join("\n"))
      list.className = "box"
      row.append(list)
    }
    ui.git.append(row)
  }
}

// —— the SSE streams (per selected project; the newest run's log is the tail's own target) ——

function stopStreams(): void {
  state.logTail?.stop()
  state.engineTail?.stop()
  state.statusEventsTail?.stop()
  state.logTail = undefined
  state.engineTail = undefined
  state.statusEventsTail = undefined
  state.session?.close()
  state.session = undefined
  state.lastEventId = 0
}

function appendCapped(node: HTMLPreElement, line: string, cap: number): void {
  node.append(`${line}\n`)
  while (node.childNodes.length > cap) node.removeChild(node.firstChild!)
}

// A `tail` attach frame says where the channel's target went; the log and the
// engine journal re-read from the new/rotated/truncated target's START, so a
// non-resumed attach clears the buffer (the frames that follow are the whole
// current target again — keeping the old ones would duplicate a run).
function onTailFrame(node: HTMLPreElement, frame: SseFrame, resumedKeeps: boolean): void {
  if (frame.event !== "tail") return
  let reason = "start"
  try {
    reason = (JSON.parse(frame.data) as { reason?: string }).reason ?? "start"
  } catch {
    // The attach payload is the daemon's own shape; an unparsable one keeps the buffer.
    return
  }
  if (reason === "resumed" && resumedKeeps) return
  clear(node)
}

function openStreams(): void {
  if (!state.project || !state.caps.read) return
  text(ui.log, "")
  text(ui.engineEvents, "")
  text(ui.statusEvents, "")
  state.logTail = new SseTail(
    (signal) => state.api.openLog(state.project!, signal),
    {
      onFrame: (frame) => {
        if (frame.event === "tail") {
          onTailFrame(ui.log, frame, false)
          return
        }
        if (frame.event === "line") appendCapped(ui.log, frame.data, LOG_LINES)
      },
    },
    { reconnectMs: 1500 },
  )
  state.engineTail = new SseTail(
    (signal) => state.api.openEvents(state.project!, signal),
    {
      onFrame: (frame) => {
        if (frame.event === "tail") {
          onTailFrame(ui.engineEvents, frame, false)
          return
        }
        if (frame.event === "run-event") appendCapped(ui.engineEvents, frame.data, EVENT_LINES)
      },
    },
    { reconnectMs: 1500 },
  )
  // The typed driver-events channel (P2b): every frame's id is the resume
  // cursor, so a reconnect — or the channel's own `dropped` frame (the
  // daemon drops a subscriber that fell more than 256 events behind) —
  // resumes exactly after the last received event: no event is rendered
  // twice, none is lost.
  const takeStatusEvent = (frame: SseFrame): void => {
    if (frame.event === "tail") {
      onTailFrame(ui.statusEvents, frame, true)
      return
    }
    if (frame.event === "dropped") {
      appendCapped(ui.statusEvents, "· subscriber dropped (fell behind); resuming from the last event id", EVENT_LINES)
      state.statusEventsTail?.stop()
      const resume = new SseTail((signal) => state.api.openStatusEvents(state.project!, state.lastEventId, signal), { onFrame: takeStatusEvent }, { reconnectMs: 1500 })
      state.statusEventsTail = resume
      resume.start()
      return
    }
    if (frame.event !== "status-event") return
    if (frame.id !== undefined) state.lastEventId = Math.max(state.lastEventId, frame.id)
    appendCapped(ui.statusEvents, `#${frame.id ?? "?"} ${frame.data}`, EVENT_LINES)
    // Unit-change push rides the typed events: a transition (or a run
    // bracket) means the read model changed — refresh it now rather than
    // waiting the poll.
    try {
      const parsed = JSON.parse(frame.data) as { type?: string }
      if (parsed.type === "unit-transition" || parsed.type === "run-start" || parsed.type === "run-end") void refreshStatus()
    } catch {
      // Not JSON: not this channel's grammar; rendered verbatim above.
    }
  }
  state.statusEventsTail = new SseTail((signal) => state.api.openStatusEvents(state.project!, state.lastEventId, signal), { onFrame: takeStatusEvent }, { reconnectMs: 1500 })
  state.logTail.start()
  state.engineTail.start()
  state.statusEventsTail.start()
}

// —— runs ——

async function refreshRuns(): Promise<void> {
  if (!state.caps.read) return
  try {
    state.runs = await state.api.runs()
  } catch {
    return
  }
  renderRuns()
}

function renderRuns(): void {
  clear(ui.runs)
  const runs = [...state.runs].sort((a, b) => (a.started < b.started ? 1 : -1))
  text(ui.runsNote, runs.length ? `${runs.length} run${runs.length === 1 ? "" : "s"} (this daemon's registry — history does not survive a restart)` : "no runs yet (start one with the control scope)")
  const head = el("tr", el("th", "run"), el("th", "project"), el("th", "state"), el("th", "exit"), el("th", "started"))
  ui.runs.append(el("thead", head))
  const body = el("tbody")
  for (const run of runs) {
    const badge = el("span", stateLabel(run.state))
    badge.className = `state ${run.state}`
    const exit = el("td", run.signal ? `signal ${run.signal}` : run.code !== null ? String(run.code) : isTerminalState(run.state) ? "?" : "—")
    const tr = el("tr", el("td", run.id), el("td", run.project), el("td", badge), exit, el("td", run.started.replace("T", " ").slice(0, 19)))
    if (run.id === state.run) tr.className = "sel"
    tr.addEventListener("click", () => void selectRun(run.id))
    body.append(tr)
  }
  ui.runs.append(body)
}

async function refreshSelectedRun(): Promise<void> {
  if (!state.run) return
  try {
    const run = await state.api.run(state.run)
    const at = state.runs.findIndex((entry) => entry.id === run.id)
    if (at >= 0) state.runs[at] = run
    renderRunDetail(run)
  } catch {
    // The run left the registry (a restart); the next runs refresh drops it.
  }
}

async function selectRun(id: string): Promise<void> {
  const run = state.runs.find((entry) => entry.id === id)
  // The streams and the interactive surface are project/run-scoped: selecting
  // a run of another project selects that project first — and the run
  // selection is set AFTER it, because a fresh project selection is what
  // clears the run selection (selectProject's own reset).
  if (run && run.project !== state.project) await selectProject(run.project)
  state.run = id
  renderRuns()
  await refreshSelectedRun()
  openInteractive(id)
  show(ui.runDetail, true)
}

function renderRun(): void {
  renderRuns()
  if (!state.run) show(ui.runDetail, false)
}

function renderRunDetail(run: RunView): void {
  clear(ui.runHead)
  const badge = el("span", stateLabel(run.state))
  badge.className = `state ${run.state}`
  ui.runHead.append(el("strong", run.id), badge, el("span", ` ${run.project} · ${run.directory}`), el("span", ` pid ${run.pid ?? "—"}`), el("span", ` started ${run.started.replace("T", " ").slice(0, 19)}`))
  if (run.ended) ui.runHead.append(el("span", ` ended ${run.ended.replace("T", " ").slice(0, 19)}`))
  clear(ui.runControls)
  if (state.caps.control) {
    if (isLiveState(run.state)) {
      const pause = el("button", "pause (graceful /exit)")
      pause.addEventListener("click", () => {
        state.session?.requestExit()
        text(ui.questionsNote, "pause requested — the run exits at its next safe boundary (exit 3, resumable)")
      })
      const kill = el("button", "kill (force-terminate)")
      kill.className = "danger"
      kill.addEventListener("click", () => void state.api.killRun(run.id).catch((error: unknown) => setConn(error instanceof ApiError ? error.message : String(error), "down")))
      ui.runControls.append(pause, kill)
    }
    if (run.state === "paused") {
      // The vocabulary's own resume: a plain re-run of the same project with
      // the same per-run request continues from the persisted progress.
      const resume = el("button", "resume (re-run — continues from persisted progress)")
      resume.className = "primary"
      resume.addEventListener("click", () => void startRun(run.project, run.request?.options as Record<string, unknown> | undefined, run.request?.switches))
      ui.runControls.append(resume)
    }
  } else {
    ui.runControls.append(el("span", "run control needs the control scope"))
  }
  text(ui.tail, run.tail || "(no output yet)")
}

// —— the interactive surface (per selected run) ——

function openInteractive(runId: string): void {
  state.session?.close()
  if (!state.caps.answer && !state.caps.control) {
    state.session = undefined
    text(ui.questionsNote, "the interactive surface needs the answer or control scope")
    clear(ui.questions)
    return
  }
  const session = new InteractiveSession(state.api.interactiveUrl(runId), {
    onHello: (hello) => {
      text(ui.questionsNote, `interactive channel open · run ${hello.run} is ${hello.state} · worker bridge ${hello.worker ? "connected" : "not connected"}`)
      renderQuestions()
    },
    onQuestion: () => renderQuestions(),
    onSettled: () => renderQuestions(),
    onError: (message) => {
      text(ui.questionsNote, message)
    },
    onControlDone: (action, applied, reason) => {
      text(ui.questionsNote, `${action}: ${applied ? "applied" : `not applied${reason ? ` — ${reason}` : ""}`}`)
    },
    onState: (sessionState) => {
      if (sessionState === "retrying") text(ui.questionsNote, "interactive channel lost — reconnecting (the pending set is replayed on reconnect)")
      if (sessionState === "closed") text(ui.questionsNote, "")
    },
  })
  state.session = session
  session.connect()
  renderQuestions()
}

function renderQuestions(): void {
  clear(ui.questions)
  const session = state.session
  if (!session) return
  const pending: PendingQuestion[] = session.pending
  if (!pending.length) {
    ui.questions.append(el("span", "no pending questions"))
  }
  for (const question of pending) {
    const card = el("div")
    card.className = "question"
    const head = el("div", `⏸ ${question.text}`)
    if (question.minutes !== undefined) head.append(el("span", ` (waits ${question.minutes}m, then auto-continues)`))
    card.append(head)
    if (state.caps.answer) {
      const input = document.createElement("textarea")
      input.placeholder = "the answer (empty = confirm the default)"
      const send = el("button", "answer")
      send.addEventListener("click", () => {
        session.answer(question.id, input.value)
        input.value = ""
      })
      card.append(input, send)
    } else {
      card.append(el("span", "answering needs the answer scope"))
    }
    ui.questions.append(card)
  }
}

// —— the start form ——

function buildStartForm(): void {
  clear(ui.startOptions)
  clear(ui.switchRows)
  for (const field of START_OPTION_FIELDS) {
    const label = el("label", field.label)
    label.title = field.hint
    let input: HTMLElement
    if (field.kind === "boolean") {
      const box = document.createElement("input")
      box.type = "checkbox"
      box.dataset.key = field.key
      box.value = "true"
      input = box
    } else if (field.kind === "enum") {
      const select = document.createElement("select")
      select.dataset.key = field.key
      select.append(el("option", ""))
      for (const value of field.values) select.append(el("option", value))
      input = select
    } else {
      const box = document.createElement("input")
      box.type = field.kind === "string" ? "text" : "number"
      box.dataset.key = field.key
      if (field.kind === "integer") box.min = "1"
      if (field.kind === "minutes") {
        box.min = "0"
        box.max = "60"
      }
      input = box
    }
    input.title = field.hint
    const hint = el("span", field.hint)
    hint.className = "hint"
    ui.startOptions.append(label, input, hint)
  }
  addSwitchRow()
}

function addSwitchRow(name = "", value = ""): void {
  const row = el("div")
  row.className = "switchrow"
  const nameInput = document.createElement("input")
  nameInput.type = "text"
  nameInput.placeholder = "OPENCODE_AUTO_*"
  nameInput.value = name
  const valueInput = document.createElement("input")
  valueInput.type = "text"
  valueInput.placeholder = "value"
  valueInput.value = value
  const drop = el("button", "×")
  drop.addEventListener("click", () => row.remove())
  row.append(nameInput, valueInput, drop)
  ui.switchRows.append(row)
}

function switchRows(): { name: string; value: string }[] {
  return [...ui.switchRows.querySelectorAll<HTMLDivElement>(".switchrow")].map((row) => ({
    name: (row.querySelector("input:first-child") as HTMLInputElement).value,
    value: (row.querySelector("input:nth-child(2)") as HTMLInputElement).value,
  }))
}

async function startRun(project: string | undefined, options?: Record<string, unknown>, switches?: Record<string, string>): Promise<void> {
  if (!state.caps.control || !project) return
  try {
    const run = await state.api.startRun(project, options, switches)
    text(ui.startError, "")
    await refreshRuns()
    await selectRun(run.id)
  } catch (error) {
    text(ui.startError, error instanceof ApiError ? `${error.status}: ${error.message}` : String(error))
  }
}

// —— wiring ——

byId<HTMLFormElement>("auth").addEventListener("submit", (event) => {
  event.preventDefault()
  const token = (byId<HTMLInputElement>("token").value || "").trim()
  if (token) void connect(token)
})
byId<HTMLButtonElement>("add-switch").addEventListener("click", () => addSwitchRow())
byId<HTMLButtonElement>("start-run").addEventListener("click", () => {
  // The form's own vocabulary is the request's: the RunAllOpts fields and the
  // OPENCODE_AUTO_* switches — a config key has no field here, and the build
  // helpers refuse anything else before the daemon ever sees it.
  const raw: Record<string, string> = {}
  for (const input of ui.startOptions.querySelectorAll<HTMLInputElement>("input, select")) {
    if (input.dataset.key === undefined) continue
    if (input.type === "checkbox") {
      if (input.checked) raw[input.dataset.key] = "true"
    } else if (input.value.trim() !== "") {
      raw[input.dataset.key] = input.value.trim()
    }
  }
  try {
    const options = buildStartOptions(raw)
    const switches = buildSwitches(switchRows())
    text(ui.startError, "")
    void startRun(state.project, options as Record<string, unknown>, switches)
  } catch (error) {
    text(ui.startError, error instanceof Error ? error.message : String(error))
  }
})

// The one-shot first paint reads nothing: the page is the login shell — the
// daemon serves it unauthenticated because it carries no data (no project
// names, no runs); everything after the token is a token-guarded call.
setConn("not connected — paste a token", "")
