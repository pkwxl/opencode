// The Web client's typed API surface (P4a): one class carrying the token to
// every endpoint of the daemon the client consumes — the read surface (the
// project whitelist, runs, the polled status read model, the SSE streams of
// P1e/P2b) and the run control surface (start, kill). This module has no DOM
// dependency (fetch is a web standard Bun implements too), so the served
// smoke test drives the client's own transport against a live daemon.
//
// The token rides the Authorization header everywhere — including the SSE
// streams, which is why the client reads SSE over fetch (web/sse.ts) instead
// of EventSource: a browser EventSource cannot set headers, and extending the
// daemon's SSE routes with query-string tokens would widen the credential's
// footprint for no gain. The one exception is the WebSocket (a browser socket
// cannot set headers either), whose endpoint already takes ?token=.
//
// The shapes below mirror the daemon's wire contracts (src/daemon.ts view(),
// src/observe.ts StatusModel, src/store.ts RegisteredProject) as the subset
// the client renders.
export type ProjectSummary = { name: string; directory: string; registered: string }
export type SessionInfo = { service: string; scopes: string[] }

export type RunRequest = { options: Record<string, unknown>; switches: Record<string, string> }
export type RunView = {
  id: string
  project: string
  directory: string
  state: string
  code: number | null
  signal: string | null
  pid: number | null
  started: string
  ended: string | null
  tail: string
  live: boolean
  request?: RunRequest
}

export type WorktreeVerdict = { root: string; clean: boolean; changed: string[] }
export type StatusModel = {
  directory: string
  generated: string
  lock: { statusLine: string; holder?: unknown } | null
  git: { clean: boolean; worktrees: WorktreeVerdict[] }
  status: string[]
  verdicts: {
    rule: string
    worktree: "clean" | "dirty"
    phases: { id: string; label: string; done: boolean; closed: string | null; current: boolean }[]
    tasks: {
      id: string
      phase: string
      title: string
      status: "pending" | "in_progress" | "blocked" | "done"
      done: boolean
      closed: string | null
      attempts: number
      subtasks: { text: string; done: boolean }[]
    }[]
    problems: string[]
  }
  state: { units: unknown; stats: unknown; windows: unknown; progress: unknown }
  unparsable: string[]
  logFile: string | null
}

// The daemon's refusal shape (every error body carries `error`); the client
// surfaces it verbatim — it never guesses a cause from prose.
export class ApiError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `the daemon answered ${status}`)
    this.status = status
    this.body = body
  }
}

export class AutoApi {
  private readonly base: string
  private readonly token: string

  constructor(base: string, token: string) {
    this.base = base.replace(/\/+$/, "")
    this.token = token
  }

  private async call(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    let parsed: unknown = undefined
    if (text.trim()) {
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = undefined
      }
    }
    const record = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    if (!response.ok) throw new ApiError(response.status, record)
    return record
  }

  // The scope source: any known token, no specific scope. This is the typed
  // answer the UI's scope gating reads (capabilitiesOf, web/render.ts).
  async session(): Promise<SessionInfo> {
    const body = await this.call("GET", "/session")
    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((scope): scope is string => typeof scope === "string") : []
    return { service: typeof body.service === "string" ? body.service : "opencode-auto-server", scopes }
  }

  // The whitelist (the read scope): the project list the daemon may run in.
  async projects(): Promise<ProjectSummary[]> {
    const body = await this.call("GET", "/projects")
    const projects = Array.isArray(body.projects) ? body.projects : []
    return projects.filter((entry): entry is ProjectSummary => typeof entry === "object" && entry !== null && typeof (entry as ProjectSummary).name === "string")
  }

  async runs(): Promise<RunView[]> {
    const body = await this.call("GET", "/runs")
    return Array.isArray(body.runs) ? (body.runs as RunView[]) : []
  }

  async run(id: string): Promise<RunView> {
    return (await this.call("GET", `/runs/${encodeURIComponent(id)}`)) as unknown as RunView
  }

  // Start a run. The payload the client can build carries `project`, the
  // per-run options (the RunAllOpts fields — web/render.ts's form vocabulary)
  // and the OPENCODE_AUTO_* switch overrides, and nothing else: no config key
  // has a field to ride in (the frozen-flag boundary is UI-enforced), and the
  // daemon's parseOptions is the second gate.
  async startRun(project: string, options?: Record<string, unknown>, switches?: Record<string, string>): Promise<RunView> {
    const body = await this.call("POST", "/runs", { project, ...(options && Object.keys(options).length ? { options } : {}), ...(switches && Object.keys(switches).length ? { switches } : {}) })
    return body as unknown as RunView
  }

  // Kill: the force-terminate half (the double-SIGINT path → killed/130).
  async killRun(id: string): Promise<RunView> {
    return (await this.call("DELETE", `/runs/${encodeURIComponent(id)}`)) as unknown as RunView
  }

  // The polled status read model (the read scope).
  async status(project: string): Promise<StatusModel> {
    return (await this.call("GET", `/projects/${encodeURIComponent(project)}/status`)) as unknown as StatusModel
  }

  // The SSE streams, opened with the token on the header (web/sse.ts consumes
  // the response bodies; these return the Response, not parsed content). The
  // signal is the reader's stop (web/sse.ts's SseTail aborts its open stream
  // when the page switches away).
  openLog(project: string, signal?: AbortSignal): Promise<Response> {
    return this.openStream(`/projects/${encodeURIComponent(project)}/log`, signal)
  }

  openEvents(project: string, signal?: AbortSignal): Promise<Response> {
    return this.openStream(`/projects/${encodeURIComponent(project)}/events`, signal)
  }

  // The typed driver-events stream (P2b): `after` is the resume cursor — the
  // id of the last received event (the SSE standard's Last-Event-ID, spelled
  // as the query the daemon takes).
  openStatusEvents(project: string, after = 0, signal?: AbortSignal): Promise<Response> {
    return this.openStream(`/projects/${encodeURIComponent(project)}/status-events${after > 0 ? `?after=${after}` : ""}`, signal)
  }

  private async openStream(path: string, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${this.base}${path}`, { headers: { authorization: `Bearer ${this.token}`, accept: "text/event-stream" }, signal })
    if (!response.ok || response.body === null) {
      const text = response.body === null ? "" : await response.text().catch(() => "")
      let record: Record<string, unknown> = {}
      try {
        const parsed: unknown = text.trim() ? JSON.parse(text) : undefined
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) record = parsed as Record<string, unknown>
      } catch {
        // A non-JSON refusal body: the status alone names it.
      }
      throw new ApiError(response.status, record)
    }
    return response
  }

  // The WebSocket endpoint of a run's interactive surface, with the token on
  // the query string (a browser WebSocket cannot set headers — the daemon's
  // own documented variant for exactly this client).
  interactiveUrl(runId: string): string {
    return `${this.base.replace(/^http/, "ws")}/runs/${encodeURIComponent(runId)}/interactive?token=${encodeURIComponent(this.token)}`
  }
}
