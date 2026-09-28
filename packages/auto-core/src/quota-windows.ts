// Learned quota windows (plans/0057 §8, S5): the one piece of provider state
// the driver keeps across runs, in .auto/windows.json. A spent five-hour,
// daily or weekly window is the provider's state, not the driver's, so a
// reset a failure stated (headers, the stream, a known wording — or the
// classifier's reading) outlives the process that learned it: a re-run, or a
// probe that failed without saying why, still knows until when the account
// cannot answer.
//
// The record is read for one purpose (§8, §11 item 4): the wait-and-probe
// loop's sleep (session.ts planSleep), when the failure it waits out states
// no instant of its own — which is also how a probe that cannot succeed yet
// is skipped. It never disables a model, never writes a down mark, never
// refuses a dispatch (§11 item 10: the escalation still starts from a real
// rejection), and never reaches past the horizon (RESET_HORIZON_MS): an entry
// is dropped once its reset passes or seven days after it was learned.
//
// Keyed by the account, not the model (§8): the agent profile (a claude
// profile is one login, its CLAUDE_CONFIG_DIR), then the provider for an
// opencode model, then the ring's key reference by name — never a value
// (C4). Without a registry the directory has one agent, so the provider
// alone names the account (`zai-coding-plan`), and a model string without
// one (claude's) is the agent's own account, `default`. An account the key
// misses (a renamed profile, a registry added later) costs one failed
// dispatch, which states the reset again.
//
// Each entry is one (account, scope) pair, the latest statement standing:
// `spent` = the window refuses requests until `resetAt`; a healthy turn's
// usage-window observation (claude's `limit` event, F20) is stored beside
// them with its utilization and replaces a spent entry of the same window
// when it says the window is open again, and a turn that succeeds on the
// account clears its spent entries. Only spent entries are ever read.
//
// Writes are atomic (.tmp → rename) and serialized; a failure is silent —
// like stats, the record never affects flow or exit codes. One driver
// process per directory (the run lock), so the in-memory copy, loaded once
// per directory, is the file.
import { mkdir, rename } from "node:fs/promises"
import { join } from "node:path"
import type { AgentEvent, LimitScope } from "./agent/types"
import type { SessionChain } from "./chain"
import { RESET_HORIZON_MS } from "./classify"
import type { RoutingFacts } from "./routing"

// Where an entry's reset came from (§8's list, as the driver can tell it):
// `stated` = the failure's own statement — opencode's headers, claude's
// stream, or a known wording (S4a) — which the driver sees through the one
// AgentError shape (C6) without the adapter's name; `classifier` = the
// failure-message classifier read it; `observed` = a healthy turn's usage
// windows (§5.2). §8's `probe` names §9's quota endpoints, which are
// deferred (§11 item 5).
export type WindowSource = "stated" | "classifier" | "observed"

export type LearnedWindow = {
  account: string
  scope: LimitScope
  resetAt: number
  learnedAt: number
  source: WindowSource
  spent: boolean
  utilization?: number
}

const FILE = join(".auto", "windows.json")

const loaded = new Map<string, Promise<LearnedWindow[]>>()
const writing = new Map<string, Promise<void>>()

// The account a chain's dispatch runs on. Under a registry: the entry's
// agent profile, its provider and the ring's current key by name (a raw
// override value runs on the default agent, its provider the model string's
// prefix); without one: the provider of the chain's model — the routed one,
// else the one the terminal was shown — or `default`.
export function accountOf(chain: Pick<SessionChain, "model" | "modelEntry" | "modelShown">, routing: RoutingFacts | undefined): string {
  if (routing !== undefined) {
    const entry = routing.registry.models.get(chain.modelEntry ?? "")
    const provider = entry !== undefined ? entry.provider : providerOf(chain.modelEntry)
    const key = provider !== undefined && routing.router.hasActiveRing(provider) ? routing.router.currentKey(provider) : undefined
    return `${entry?.agent ?? routing.defaultAgent}${provider !== undefined ? `/${provider}` : ""}${key !== undefined ? `#${key.label}` : ""}`
  }
  return providerOf(chain.model ?? chain.modelShown) ?? "default"
}

function providerOf(model: string | undefined): string | undefined {
  const slash = model?.indexOf("/") ?? -1
  return slash > 0 ? model!.slice(0, slash) : undefined
}

// A failure's stated reset, recorded as a spent window of its scope (a
// classifier's reset carries none: `unknown`). A per-minute cap is not a
// window: the agent's own backoff cures it within the minute.
export async function learnFailure(
  dir: string | undefined,
  account: string,
  failure: { resetAt?: number; scope?: LimitScope; resetSource?: "stated" | "classifier" },
  now: number,
): Promise<void> {
  if (dir === undefined || failure.resetAt === undefined || failure.resetAt <= now) return
  if (failure.scope === "request" || failure.scope === "token") return
  await update(dir, now, (list) =>
    upsert(list, { account, scope: failure.scope ?? "unknown", resetAt: failure.resetAt!, learnedAt: now, source: failure.resetSource ?? "stated", spent: true }),
  )
}

// A usage-window observation (the `limit` event). A window is spent when it
// is used up, or when a rejected statement names it alone; any other
// observation of a window says it is open, which supersedes a spent entry.
export async function learnObserved(dir: string | undefined, account: string, event: Extract<AgentEvent, { type: "limit" }>, now: number): Promise<void> {
  if (dir === undefined || event.windows.length === 0) return
  await update(dir, now, (list) => {
    let next = list
    for (const w of event.windows) {
      if (w.resetAt <= now) continue
      const spent = (w.utilization ?? 0) >= 1 || (event.status === "rejected" && event.windows.length === 1)
      next = upsert(next, {
        account,
        scope: w.scope,
        resetAt: w.resetAt,
        learnedAt: now,
        source: "observed",
        spent,
        ...(w.utilization !== undefined ? { utilization: w.utilization } : {}),
      })
    }
    return next
  })
}

// A turn went through on the account: no window of it refuses requests now,
// whatever an entry said (a provider may reset early). Writes only when an
// entry changes.
export async function accountAnswered(dir: string | undefined, account: string, now: number): Promise<void> {
  if (dir === undefined) return
  await update(dir, now, (list) => list.filter((w) => !(w.account === account && w.spent)))
}

// The latest reset among the account's spent windows (a probe before it
// cannot succeed), undefined when none is known.
export async function learnedReset(dir: string | undefined, account: string, now: number): Promise<LearnedWindow | undefined> {
  if (dir === undefined) return undefined
  await writing.get(dir)
  const list = live(await load(dir), now)
  let latest: LearnedWindow | undefined
  for (const w of list) if (w.account === account && w.spent && (latest === undefined || w.resetAt > latest.resetAt)) latest = w
  return latest
}

// For unit-test resets only (module state shared across test files).
export function resetQuotaWindows(): void {
  loaded.clear()
  writing.clear()
}

function upsert(list: LearnedWindow[], entry: LearnedWindow): LearnedWindow[] {
  return [...list.filter((w) => !(w.account === entry.account && w.scope === entry.scope)), entry]
}

function live(list: LearnedWindow[], now: number): LearnedWindow[] {
  return list.filter((w) => w.resetAt > now && now - w.learnedAt <= RESET_HORIZON_MS)
}

// Applies one change to the directory's entries, dropping the dead ones, and
// writes the result when it differs from what was there. Changes run one at
// a time per directory (read, change and write as one step), so an
// observation arriving beside a failure's statement loses neither.
async function update(dir: string, now: number, change: (list: LearnedWindow[]) => LearnedWindow[]): Promise<void> {
  const step = (writing.get(dir) ?? Promise.resolve())
    .then(async () => {
      const before = await load(dir)
      const after = live(change(live(before, now)), now)
      if (JSON.stringify(after) === JSON.stringify(before)) return
      loaded.set(dir, Promise.resolve(after))
      await write(dir, JSON.stringify({ windows: after }, null, 2) + "\n")
    })
    .catch(() => {})
  writing.set(dir, step)
  await step
}

async function write(dir: string, text: string): Promise<void> {
  await mkdir(join(dir, ".auto"), { recursive: true })
  const tmp = join(dir, `${FILE}.${process.pid}.tmp`)
  await Bun.write(tmp, text)
  await rename(tmp, join(dir, FILE))
}

function load(dir: string): Promise<LearnedWindow[]> {
  let list = loaded.get(dir)
  if (list === undefined) {
    list = Bun.file(join(dir, FILE))
      .text()
      .then(parse, () => [])
    loaded.set(dir, list)
  }
  return list
}

const SCOPES: ReadonlySet<string> = new Set(["request", "token", "5h", "7d", "day", "unknown"])
const SOURCES: ReadonlySet<string> = new Set(["stated", "classifier", "observed"])

// Lenient: a corrupt file is an empty record, a malformed entry is skipped.
function parse(raw: string): LearnedWindow[] {
  let doc: unknown
  try {
    doc = JSON.parse(raw)
  } catch {
    return []
  }
  const windows = (doc as { windows?: unknown } | null)?.windows
  if (!Array.isArray(windows)) return []
  const out: LearnedWindow[] = []
  for (const w of windows as Record<string, unknown>[]) {
    if (typeof w !== "object" || w === null) continue
    const { account, scope, resetAt, learnedAt, source, spent, utilization } = w
    if (typeof account !== "string" || typeof scope !== "string" || !SCOPES.has(scope)) continue
    if (typeof resetAt !== "number" || typeof learnedAt !== "number" || typeof source !== "string" || !SOURCES.has(source) || typeof spent !== "boolean") continue
    out.push({
      account,
      scope: scope as LimitScope,
      resetAt,
      learnedAt,
      source: source as WindowSource,
      spent,
      ...(typeof utilization === "number" ? { utilization } : {}),
    })
  }
  return out
}
