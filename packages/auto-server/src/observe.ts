// The disk observability surface (P1e, auto-core plans/0067 §三.4): everything
// the daemon knows about a run it reads from disk — an SSE tail of the run log
// and the polled status read model over `.auto/*.json` plus git. Zero core
// change by construction: every read here is a pure read the core itself takes
// without a lock (`renderStatus`, `liveRunLock`, `repoRoots`, plain file
// reads), and the daemon writes nothing into the target directory — the
// `.auto/` writes stay driver-exclusive (draft §五).
//
// The four defensive-read caveats of the assessment (§4) are absorbed here:
//   1. `.auto/progress.json` is written NON-atomically (a direct Bun.write,
//      auto-core src/resume.ts:145-147), so a poller can read torn JSON — an
//      unparseable read is "no change / retry next tick", never an error state
//      surfaced to clients (readJsonFile: `torn`, reported under `unparsable`
//      and otherwise served as absent). The same tolerance covers every other
//      state file mid-rotation (the atomic writers' rename window reads as
//      absent) and the log/journal mid-write.
//   2. The log file is shell-started (the worker's own setLogFile) — there is
//      nothing to tail until a run wrote one; the tailer idles until the file
//      appears, it never errors.
//   3. Log file names carry second-resolution timestamps
//      (`run-<ISO-to-seconds>.log`, auto-core src/log.ts:55-56); one run per
//      directory makes collisions impossible (a second run in the same second
//      APPENDS to the same name) but makes name construction wrong — the
//      newest log is DISCOVERED by listing, never constructed (newestRunLog).
//   4. `.auto/run-events.jsonl` is truncated at each run start (auto-core
//      src/engine/events.ts:90-99), and the run log rotates by new file — a
//      tailer RE-SEEKS on rotation, never assumes append-only across runs.
//
// What the tails deliver, and what they never do:
//   - the log channel delivers whole lines promptly (the audit log is
//     writeSync per entry, no buffering, auto-core src/log.ts:89-91 — even a
//     kill -9'd worker leaves complete lines), but the lines are PROSE for
//     humans and are never parsed for state (no scraping, draft §五);
//   - the events channel delivers `.auto/run-events.jsonl` lines as
//     structured payloads — the typed engine journal (vocabulary `turn-start |
//     input | fx | fx-result | fx-reject | settle`, auto-core
//     src/engine/events.ts:54-60), safe to tail read-only.
//
// Completion truth (draft §五, "the unified commit is the completion
// condition"): every "done" the status model serves derives from the unit
// state files the driver's closing commits rename (todo.md → done.md) and the
// git dirty/clean verdict — agent self-report is never trusted, and no log
// line is scraped for it. The structured verdicts below are computed here, at
// the API's read seam, over the same pure reads `renderStatus` uses.
import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { physicalDir, repoRoots } from "@opencode-ai/auto-core/git"
import { RUN_EVENTS_FILE } from "@opencode-ai/auto-core/engine/events"
import { liveRunLock, lockStatusLine, type LockHolder } from "@opencode-ai/auto-core/lock"
import { currentPhase, currentRound, phaseLabel, readPhases } from "@opencode-ai/auto-core/phases"
import { renderStatus } from "@opencode-ai/auto-core/status"
import { loadPlan } from "@opencode-ai/auto-core/tasks"

// —— the newest run log (caveat 3: discover, never construct) ——

// `run-<YYYY-MM-DD_HH-MM-SS>.log`, exactly the shape setLogFile writes
// (auto-core src/log.ts:55-56). Fixed-width and zero-padded, so plain
// lexicographic order IS chronological order — no mtime needed (same-second
// mtimes are ambiguous; the stamp in the name is the only sort key that
// cannot lie). Non-matching names (temp files, a person's notes) never tail.
const RUN_LOG_NAME = /^run-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.log$/
const LOGS_DIR = join(".auto", "logs")

// The newest run log of the directory, by listing `.auto/logs/` and sorting
// the stamp-bearing names; undefined when the directory has none yet (no run
// started, or a project never run). One run per directory means two runs in
// the same second share ONE file (setLogFile opens the same name to append) —
// the discovery keeps naming that file, which is exactly the newest run's.
// AUTO-DECISION (name sort, not mtime/birthtime): the ISO-to-seconds stamp in
// the name is monotonic and unambiguous; a same-second pair has one name, and
// mtime comparisons are same-second ambiguous on every filesystem that lacks
// nanosecond stat.
export function newestRunLog(directory: string): string | undefined {
  let names: string[]
  try {
    names = readdirSync(join(directory, LOGS_DIR))
  } catch {
    return undefined // no .auto/logs yet — nothing was ever tailed
  }
  const logs = names.filter((name) => RUN_LOG_NAME.test(name)).sort()
  return logs.at(-1)
}

// —— defensive JSON reads (caveat 1: torn is "no change / retry next tick") ——

type JsonRead = { state: "absent" } | { state: "torn" } | { state: "ok"; value: unknown }

// One `.auto/` state file, read defensively: absent (missing, or inside an
// atomic writer's rename window), torn (present but unparseable — the
// non-atomic progress.json mid-write, or a file mid-rotation), or ok. A torn
// read is a fact about the read, never an error state: the caller serves the
// last-known absence and names the file under `unparsable`, so the next poll
// picks up whatever the writer settled on.
async function readJsonFile(directory: string, rel: string): Promise<JsonRead> {
  const text = await Bun.file(join(directory, rel)).text().catch(() => undefined)
  if (text === undefined) return { state: "absent" }
  try {
    return { state: "ok", value: JSON.parse(text) }
  } catch {
    return { state: "torn" }
  }
}

// —— the git verdicts (dirty / clean per worktree) ——

export type WorktreeVerdict = { root: string; clean: boolean; changed: string[] }

// `git status --porcelain` per worktree, entries as `XY <path>` with the path
// relative to the project directory — the same shape and conversion as the
// core's own statusEntries (auto-core src/git.ts:703-719; it is private, and
// the core's exported changedFiles flattens the worktrees away), with the
// discovery shared: repoRoots is the core's own traversal (the project tree's
// every .git, nested repos included). Read-only — but a CONCURRENT reader must
// say so: `git status` opportunistically refreshes the index, taking
// .git/index.lock, and a poller colliding with the observed run's own
// `git add` blocks the run (found empirically: "Unable to create
// .git/index.lock: File exists" → the run's unified commit failed → blocked).
// `--no-optional-locks` is git's own flag for exactly this — a background
// process that must never take the lock. The core's own reads need no such
// flag: they run inside the run's own process, sequential with its writes.
async function worktreeVerdict(directory: string, root: string): Promise<WorktreeVerdict> {
  const phys = await physicalDir(directory)
  const top = Bun.spawn(["git", "-C", root, "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "ignore" })
  const toplevel = (await new Response(top.stdout).text()).trim()
  if ((await top.exited) !== 0 || !toplevel) return { root, clean: true, changed: [] }
  const proc = Bun.spawn(["git", "--no-optional-locks", "-C", root, "status", "--porcelain", "-z", "--no-renames", "-uall", "--", "."], {
    stdout: "pipe",
    stderr: "ignore",
  })
  const output = await new Response(proc.stdout).text()
  if ((await proc.exited) !== 0) return { root, clean: true, changed: [] }
  // The one collapsed form `-uall` still emits — a nested repository
  // directory — is skipped: that repository's own status lists its files.
  const changed = output
    .split("\0")
    .filter((entry) => entry && !(entry.startsWith("?? ") && entry.endsWith("/")))
    .map((entry) => `${entry.slice(0, 2)} ${relative(phys, join(toplevel, entry.slice(3)))}`)
  return { root, clean: changed.length === 0, changed }
}

// —— the polled status read model ——

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

export type StatusModel = {
  directory: string
  generated: string
  // Lock visibility: the statusLine of a live run lock (auto-core
  // src/lock.ts:95), with its holder — null when no live lock holds.
  lock: { statusLine: string; holder?: LockHolder } | null
  // The git verdicts: clean overall, and per worktree (the project tree's
  // every repository, nested ones included).
  git: { clean: boolean; worktrees: WorktreeVerdict[] }
  // The core's own tree renderer, called as-is (a pure read that takes no
  // lock by design, auto-core src/status.ts:24 / src/lock.ts:5) — the daemon
  // never re-derives a tree for the human view.
  status: string[]
  // The machine-readable completion verdicts, computed over the same pure
  // reads renderStatus uses (readPhases + loadPlan): a unit is done exactly
  // when its done.md exists — the rename rides the driver's closing commit —
  // and the verdicts are settled only over a clean worktree.
  verdicts: {
    rule: string
    worktree: "clean" | "dirty"
    phases: PhaseVerdict[]
    tasks: TaskVerdict[]
    problems: string[]
  }
  // The raw `.auto/` state files, defensively parsed: null = absent or torn
  // (the file names carry which — `unparsable` lists the torn ones).
  state: { units: unknown; stats: unknown; windows: unknown; progress: unknown }
  unparsable: string[]
  // The newest discovered run log (the file the SSE log tail follows), null
  // when the directory has none.
  logFile: string | null
}

const COMPLETION_RULE =
  "commit-is-completion: a unit is done exactly when its done.md exists (renamed inside the driver's closing commit) — agent self-report is never trusted; the tree's verdicts are settled over a clean worktree (git is the record)"

// The status read model of one registered project, assembled per poll from
// pure disk reads: the lock, the git verdicts, the core's rendered tree, the
// structured commit verdicts, the `.auto/` state files and the newest log.
// Nothing here ever throws at a caller for target-state reasons — a missing
// or torn file is a fact the model reports, not a failure of the request.
export async function readStatusModel(directory: string): Promise<StatusModel> {
  const holder = liveRunLock(directory)
  const worktrees = await Promise.all((await repoRoots(directory)).map((root) => worktreeVerdict(directory, root)))
  const git = { clean: worktrees.every((worktree) => worktree.clean), worktrees }

  // The human tree first (the core's own renderer, problems included as ⚠
  // lines — its views never fail), then the same reads as data.
  const status = await renderStatus(directory)
  const problems: string[] = []
  const phases: PhaseVerdict[] = []
  const tasks: TaskVerdict[] = []
  try {
    const round = await currentRound(directory)
    const state = await readPhases(directory, round)
    if (state) {
      const current = currentPhase(state)
      for (const phase of state.phases) {
        // The qualified runtime key R-NN.P<nn> (the unqualified local id P01
        // names the directory prefix alone; the qualified form is what every
        // other surface — fields, logs, stats buckets — keys on).
        const id = `${phase.round}.${phase.id}`
        phases.push({
          id,
          label: phaseLabel(phase),
          done: state.done.has(phase.id),
          closed: state.closed.get(phase.id) ?? null,
          current: current?.id === phase.id,
        })
        try {
          const plan = await loadPlan(directory, phase)
          for (const task of plan.tasks) {
            tasks.push({
              id: task.id,
              phase: id,
              title: task.title,
              status: task.status,
              done: task.status === "done",
              closed: task.closed ?? null,
              attempts: task.attempts,
              subtasks: (task.checklist ?? []).map((item) => ({ text: item.text, done: item.done })),
            })
          }
        } catch (error) {
          problems.push(`${phase.id}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  } catch (error) {
    // An unusable index is the tree's own ⚠ line in `status`; the structured
    // verdicts stay empty and name the problem.
    problems.push(error instanceof Error ? error.message : String(error))
  }

  const [units, stats, windows, progress] = await Promise.all(
    ([["units", join(".auto", "units.json")], ["stats", join(".auto", "stats.json")], ["windows", join(".auto", "windows.json")], ["progress", join(".auto", "progress.json")]] as const).map(
      async ([, rel]) => readJsonFile(directory, rel),
    ),
  )
  const read = (result: JsonRead): unknown => (result.state === "ok" ? result.value : null)
  const unparsable = (
    [
      [join(".auto", "units.json"), units],
      [join(".auto", "stats.json"), stats],
      [join(".auto", "windows.json"), windows],
      [join(".auto", "progress.json"), progress],
    ] as const
  )
    .filter(([, result]) => result.state === "torn")
    .map(([rel]) => rel)

  return {
    directory,
    generated: new Date().toISOString(),
    lock: holder === undefined ? null : { statusLine: lockStatusLine(holder), ...(holder === "unreadable" ? {} : { holder }) },
    git,
    status,
    verdicts: { rule: COMPLETION_RULE, worktree: git.clean ? "clean" : "dirty", phases, tasks, problems },
    state: { units: read(units), stats: read(stats), windows: read(windows), progress: read(progress) },
    unparsable,
    logFile: newestRunLog(directory) ?? null,
  }
}

// —— the SSE tails ——

export type TailChannel = "log" | "events"

// The poll cadence of the tails. The audit log is written straight through
// (writeSync per entry), so a poll sees each line within one interval: the
// delivery latency bound is this plus the client's read — 100 ms keeps a
// human-facing page live at negligible cost (one stat per open tail).
const TAIL_POLL_MS = 100
// A comment frame on an idle interval, so intermediaries hold the stream open
// and a dead connection surfaces as a write failure instead of silence.
const TAIL_HEARTBEAT_MS = 15_000

const EMPTY = new Uint8Array(0)
const NEWLINE = 10

const concat = (head: Uint8Array, tail: Uint8Array): Uint8Array => {
  if (!head.length) return tail
  const merged = new Uint8Array(head.length + tail.length)
  merged.set(head)
  merged.set(tail, head.length)
  return merged
}

// The SSE response tailing one channel of one registered project:
//   - "log": the newest `.auto/logs/run-*.log`, re-discovered every tick — a
//     NEWER name is a new run, and the tail re-seeks to the new file's start
//     (the per-run log is never appended across runs);
//   - "events": `.auto/run-events.jsonl`, the typed engine journal — the file
//     is TRUNCATED at each run start, so a shrink is a new run and the tail
//     re-seeks to 0.
// Framing is whole-line: bytes after the last newline stay buffered until the
// line completes, and a line is delivered in the very tick its newline lands
// (writeSync per entry means the writer's lines are already whole — the
// buffer only ever holds a torn tail mid-write). The log channel delivers
// prose verbatim and never parses it; the events channel delivers each line
// verbatim as a structured payload (the journal lines ARE typed JSON) and
// skips a line that does not parse — mid-write tolerance, never an error.
// AUTO-DECISION (start at the file's beginning, not its end): the newest file
// IS the current run's file — a per-run log, small by construction — so a
// connecting client gets the whole current run (banner included), and on
// rotation the same rule re-seeks to 0; tail-from-end would miss the run a
// client connected to watch and add a second position mode for no gain.
export function tailResponse(directory: string, channel: TailChannel): Response {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let poller: ReturnType<typeof setInterval> | undefined
  let heart: ReturnType<typeof setInterval> | undefined
  let stopped = false
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const stop = (): void => {
        if (stopped) return
        stopped = true
        if (poller) clearInterval(poller)
        if (heart) clearInterval(heart)
        try {
          controller.close()
        } catch {
          // Already torn down by the runtime; nothing to close.
        }
      }
      const send = (event: string, data: string): void => {
        if (stopped) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${data}\n\n`))
        } catch {
          stop() // the client is gone; the frames after this are for no one
        }
      }

      // The tail target: the newest log's name (re-discovered per tick), or
      // the journal's fixed name. `offset` is the file position already read;
      // `carry` holds the bytes of a line still waiting for its newline.
      let name: string | undefined = channel === "events" ? RUN_EVENTS_FILE : undefined
      let offset = 0
      let carry: Uint8Array = EMPTY
      const target = (): string | undefined => (name === undefined ? undefined : join(directory, channel === "log" ? join(LOGS_DIR, name) : name))

      const deliver = (line: string): void => {
        if (channel === "log") {
          send("line", line)
          return
        }
        // Structured payloads only: the journal's lines are typed RunEvent
        // JSON (events.ts:54-60); anything that does not parse is a torn
        // mid-write read, skipped until the next tick re-reads it whole.
        try {
          const parsed: unknown = JSON.parse(line)
          if (parsed !== null && typeof parsed === "object" && typeof (parsed as { type?: unknown }).type === "string") send("run-event", line)
        } catch {
          // A torn line: not delivered, not an error — the next tick retries.
        }
      }

      // Ticks never overlap: a tick's reads are async, and two in-flight
      // ticks would read the same offset range twice (a duplicated line —
      // found empirically in the compiled-binary smoke). A tick that fires
      // while one runs is skipped; the running one's offset advance and the
      // next tick pick up everything that lands in between.
      let ticking = false
      const tick = async (): Promise<void> => {
        if (stopped || ticking) return
        ticking = true
        try {
          if (channel === "log") {
            // Caveat 3/4: discover, never construct; a NEWER name is a new
            // run — re-seek to the new run's file from its beginning.
            const newest = newestRunLog(directory)
            if (newest !== name) {
              const first = name === undefined
              name = newest
              offset = 0
              carry = EMPTY
              if (name !== undefined) send("tail", JSON.stringify({ file: name, from: 0, reason: first ? "start" : "rotated" }))
              return // the new file's bytes arrive on the next tick
            }
          }
          const path = target()
          if (path === undefined) return
          const file = Bun.file(path)
          if (!(await file.exists())) return // not written yet (caveat 2)
          if (file.size < offset) {
            // Caveat 4: the journal is truncated at each run start; a shrink
            // is a new run. (The log rotates by new name, above; a shrink of
            // a log file cannot happen through the core's append-only fd —
            // re-seeking anyway is the only safe answer to a hand-truncated
            // file.)
            offset = 0
            carry = EMPTY
            send("tail", JSON.stringify({ file: name, from: 0, reason: "truncated" }))
          }
          if (file.size === offset) return
          const chunk = new Uint8Array(await file.slice(offset, file.size).arrayBuffer())
          offset = file.size
          const merged = concat(carry, chunk)
          const last = merged.lastIndexOf(NEWLINE)
          if (last < 0) {
            carry = merged // the line is still being written; hold its bytes
            return
          }
          carry = merged.subarray(last + 1)
          for (const line of decoder.decode(merged.subarray(0, last + 1)).split("\n")) {
            const text = line.endsWith("\r") ? line.slice(0, -1) : line
            if (text) deliver(text)
          }
        } catch {
          // A tick's read failure (the file vanishing mid-stat, a directory
          // being reset) is retried on the next tick — never an error frame.
        } finally {
          ticking = false
        }
      }

      // The attaching frame: for the journal its target is fixed and known
      // now; for the log it names nothing until discovery lands (the tick
      // that follows answers with the file it found).
      send("tail", JSON.stringify(channel === "events" ? { file: name, from: 0, reason: "start" } : { file: null, reason: "attaching" }))
      void tick()
      poller = setInterval(() => void tick(), TAIL_POLL_MS)
      heart = setInterval(() => {
        if (stopped) return
        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"))
        } catch {
          stop()
        }
      }, TAIL_HEARTBEAT_MS)
    },
    cancel() {
      // The client went away (its fetch aborted): stop polling immediately —
      // an unwatched tail holds a timer and a stat per interval for nothing.
      stopped = true
      if (poller) clearInterval(poller)
      if (heart) clearInterval(heart)
    },
  })
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      // The model is the poll; a reconnect re-reads from the run's start, so
      // there is no resume cursor to honor in P1.
      connection: "keep-alive",
    },
  })
}
