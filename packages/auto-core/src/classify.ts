// The failure-message classifier (plans/0055 §7.1, R14): the model
// registry's `classifier` entries read the provider failure messages that the
// error patterns (src/chain.ts classifySessionError) cannot settle — other
// languages, plan-specific limits, "resets at 15:00", a 429 that really means
// a spent quota — so a quota is recognized while the agent is still retrying,
// before every retry has failed, and a reset time can say when a down mark
// clears.
//
// The classifier is advisory (§10 item 18): its answer can only raise a class
// the patterns left undecided and name a reset time. It never lowers a class,
// never judges completion (C6), and a wrong answer costs one unnecessary
// move, which the down-mark expiry and failback undo.
//
// What leaves the driver (C4): only the redacted error text — the message and
// the response body, key-like tokens, e-mail addresses and URL query strings
// removed, truncated to 2,000 characters — in a one-shot session titled
// `auto: classify error` that runs on the adapter's default agent (not the
// `auto` contract) with every tool denied (PromptInput.bare). Never the
// prompt, a diff or a file.
//
// Cost: answers are cached for the run, keyed by the redacted text with its
// digits, ids and times masked, so a repeated message costs one call; a run
// makes at most 20 calls, after which the patterns decide alone (the log says
// so once). A 30 s timeout or any failure counts as no answer. The
// classifier's own failures are classified by the patterns alone and mark
// only the classifier entry down.
//
// Where the answers act lives with the callers: src/watch.ts asks beside the
// event stream of a retrying turn and settles it when an answer raises the
// class; src/session.ts writes the reset time into the down marks of the key
// → model → wait escalation. Without a registry or without a classifier list
// nothing here runs (C2). Sits below watch: no loop, no session-driving, no
// agent start imports (import-direction rule).
import type { AgentClient, AgentErrorPatterns, AgentEvent, AgentRetryPolicy } from "./agent/types"
import { classifySessionError, NEUTRAL_RETRY_POLICY, rateSignal, rateThresholdMet, retryPolicyOf, type ErrorClass, type ErrorInfo } from "./chain"
import { ringHasUsableKey } from "./keyring"
import { log, vlog } from "./log"
import { isoInZone, usableAt } from "./model-window"
import type { ModelEntry, ModelRegistry } from "./models"
import { renderClassifyError } from "./prompt"
import type { Router } from "./router"
import type { RoutingFacts } from "./routing"
import { formatClientError } from "./session-api"
import type { Usage } from "./stats"

// A run's call budget, the per-call timeout, the input size and the reset
// horizon (§7.1).
export const CLASSIFY_CALL_LIMIT = 20
export const CLASSIFY_TIMEOUT_MS = 30_000
export const CLASSIFY_INPUT_CHARS = 2_000
export const RESET_HORIZON_MS = 7 * 86_400_000
export const CLASSIFY_TITLE = "auto: classify error"

// The classes a reply may name: the pattern classes minus `overflow`, which
// the context steps and the handover own and the classifier is never asked
// about.
export type ClassifierClass = "quota" | "rate" | "auth" | "transient" | "unknown"
const CLASSES: readonly string[] = ["quota", "rate", "auth", "transient", "unknown"]

// A parsed reply: the class, and the reset time the text named (epoch ms), as
// the reply stated it — acceptedReset decides whether it may set a mark.
export type ClassifierAnswer = { class: ClassifierClass; resetAt?: number }

// ---------------------------------------------------------------------------
// When it is asked (§7.1)
// ---------------------------------------------------------------------------

// Only where the patterns are not decisive: a retry event the patterns class
// as unknown, or as a rate signal still below its threshold (transient or
// unknown then); a session error that ends as unknown. Never about overflow,
// and never about a message the patterns already class as quota or auth (or
// rate, which is already the escalation's class). Nor about a failure whose
// reset the provider or the agent already stated (plans/0057 §5.3): a stated
// reset outranks the answer's, and the classifier's job is the providers
// that state nothing.
export function shouldAsk(surface: "retry" | "error", info: ErrorInfo, cls: ErrorClass, extra?: AgentErrorPatterns): boolean {
  if (info.resetAt !== undefined) return false
  if (cls === "unknown") return true
  return surface === "retry" && cls === "transient" && rateSignal(info, extra)
}

// ---------------------------------------------------------------------------
// Redaction (C4) and the cache key
// ---------------------------------------------------------------------------

// A URL's query string: from `?` after a path (absolute or relative) up to
// whitespace or a quote.
const QUERY_RE = /(\/[^\s?#"'<>]*)\?[^\s#"'<>]+/g
const BEARER_RE = /\bBearer\s+[^\s"',;]+/gi
const SK_RE = /\bsk-[A-Za-z0-9_-]+/g
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
// A run of 24 or more key characters: the base64 and URL-safe base64
// alphabets, so a key with `+`, `/` or `=` in it is caught whole. A long URL
// path or a long identifier word is redacted too; the classifier needs the
// wording, not the paths.
// AUTO-DECISION: key characters are letters, digits and `+ / = _ -` (the base64 and base64url alphabets) and the dot is not one of them (a base64 secret split at `/` would otherwise leak in pieces shorter than 24; host names stay readable because the dot breaks the run, and the price of the literal rule — a long path or identifier word redacted too — only costs classification wording, never a secret)
const KEY_RUN_RE = /[A-Za-z0-9+/=_-]{24,}/g

// The redacted text of one error: key-like tokens (`sk-…`, `Bearer …`, runs
// of 24 or more key characters), e-mail addresses and URL query strings are
// replaced before anything else happens to the text.
export function redact(text: string): string {
  return text
    .replace(QUERY_RE, "$1?[redacted]")
    .replace(BEARER_RE, "Bearer [redacted]")
    .replace(SK_RE, "sk-[redacted]")
    .replace(EMAIL_RE, "[email]")
    .replace(KEY_RUN_RE, "[redacted]")
}

// What the classifier sees of an error (§7.1 "What it sees"): the message and
// the response body, redacted, then truncated to 2,000 characters.
// AUTO-DECISION: redaction runs before the truncation (a key cut at the 2,000th character would otherwise fall under the 24-character run and leak its first part)
export function classifierInput(info: ErrorInfo): string {
  const text = [info.message, info.responseBody].filter((part): part is string => part !== undefined && part.trim() !== "").join("\n")
  return redact(text).slice(0, CLASSIFY_INPUT_CHARS)
}

const ISO_TIME_RE = /\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?/gi
const CLOCK_RE = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]\.?m\.?)?|\b\d{1,2}\s*[ap]m\b/gi
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// An id: a token of six or more word characters or dashes that mixes letters
// and digits (request ids, completion ids, trace ids).
const ID_RE = /\b(?=[\w-]*\d)(?=[\w-]*[A-Za-z])[\w-]{6,}\b/g

// The cache key of an error (§7.1 "Cost"): its redacted text with times, ids
// and every remaining digit masked and the whitespace collapsed, so a repeated
// message — the same wording with another request id, count or clock time —
// costs one call.
// AUTO-DECISION: the key is built from the redacted input, not the raw message (the run's cache then never holds a secret either, and two messages differing only in a redacted token are the same message to the classifier)
export function classifierCacheKey(input: string): string {
  return input
    .replace(ISO_TIME_RE, "<time>")
    .replace(CLOCK_RE, "<time>")
    .replace(UUID_RE, "<id>")
    .replace(ID_RE, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
}

// ---------------------------------------------------------------------------
// The reply (§7.1 "What it answers")
// ---------------------------------------------------------------------------

// ISO 8601 with an offset (`Z`, `+08:00` or `+0800`), to the minute at least.
const ISO_OFFSET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i

// One JSON line: {"class": "quota"|"rate"|"auth"|"transient"|"unknown",
// "resetAt": "<ISO 8601 with offset>"|null}. A reply that does not parse
// counts as no answer (undefined). The shape is English from the start and
// parsed only here; its template is templates/prompts/classify-error.md.
// AUTO-DECISION: the reply is read line by line (code fences and surrounding prose skipped) and the last line that parses as a JSON object with a known class wins, the class read case-insensitively (models often fence JSON or restate it; the last statement is the answer, and a reply without such a line is still no answer)
// AUTO-DECISION: a resetAt that is not ISO 8601 with an offset (a bare clock time, a date without zone) is dropped and the class kept (the zone of such a time is unknowable, so it must not set a mark; the class is still an answer to the question that was asked)
export function parseClassifierReply(text: string): ClassifierAnswer | undefined {
  let found: ClassifierAnswer | undefined
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(/^`+|`+$/g, "").trim()
    if (!line.startsWith("{") || !line.endsWith("}")) continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue
    const fields = value as Record<string, unknown>
    const cls = typeof fields.class === "string" ? fields.class.trim().toLowerCase() : undefined
    if (cls === undefined || !CLASSES.includes(cls)) continue
    const resetAt = parseResetAt(fields.resetAt)
    found = { class: cls as ClassifierClass, ...(resetAt !== undefined ? { resetAt } : {}) }
  }
  return found
}

function parseResetAt(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined
  const text = value.trim()
  if (!ISO_OFFSET_RE.test(text)) return undefined
  // `+0800` → `+08:00`: Date.parse takes the colon form everywhere.
  const at = Date.parse(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"))
  return Number.isFinite(at) ? at : undefined
}

// A reset time that may set when a down mark clears (§7.1): in the future
// and at most 7 days away; anything else is ignored and the mark clears at
// the scope boundary as before. The same horizon holds for a reset the
// provider or the agent stated (an ErrorInfo's, plans/0057 §5.3).
export function acceptedReset(answer: ClassifierAnswer | ErrorInfo | undefined, now: number): number | undefined {
  const at = answer?.resetAt
  return at !== undefined && at > now && at <= now + RESET_HORIZON_MS ? at : undefined
}

// ---------------------------------------------------------------------------
// The raise-only merge (§7.1 "What it may change")
// ---------------------------------------------------------------------------

// The class after an answer: it replaces `unknown`, and it may raise a rate
// signal below its threshold (the patterns' `transient`) to `quota`. It never
// lowers a class the patterns found. A `rate` answer is a rate signal like
// the patterns' own: it counts as `rate` only once the threshold holds (the
// agent gave up curing it by itself under its retry policy, chain.ts
// agentGaveUp) — below it the agent is still backing off, and the class stays
// as it was.
// AUTO-RESOLVE: does a `rate` answer settle a retrying turn at once? -> only once the patterns' rate threshold holds (§7.1 lets the answer replace `unknown`, but F17's threshold exists because a single 429 is the agent's own backoff; a classifier naming the same thing must not settle sooner than the patterns would, while quota and auth, which retrying cannot cure, settle at once)
export function mergeClass(pattern: ErrorClass, answer: ClassifierClass, info: ErrorInfo, policy: AgentRetryPolicy = NEUTRAL_RETRY_POLICY): ErrorClass {
  if (pattern === "unknown") {
    if (answer === "rate") return rateThresholdMet(info, policy) ? "rate" : "unknown"
    return answer
  }
  if (pattern === "transient" && answer === "quota") return "quota"
  return pattern
}

// One answer for a log line: `quota, resets 2026-09-27T15:00:00+08:00` (the
// reset only when it is accepted, shown in the registry's time zone).
export function describeAnswer(answer: ClassifierAnswer, tz: string, now: number): string {
  const reset = acceptedReset(answer, now)
  return reset !== undefined ? `${answer.class}, resets ${isoInZone(reset, tz)}` : answer.class
}

// ---------------------------------------------------------------------------
// The run's classifier (§7.1 "How it runs")
// ---------------------------------------------------------------------------

// What one watch needs to ask: the run's client (the classifier's session is
// created through the run's hosts), the registry with its classifier list, the
// agent filter, the dispatch clock, a log label (the task id) and the per-call
// timeout. `clientOf` resolves the pick's entry agent through the pool
// (§8.1); absent, every call runs on the watch's own client.
export type Classifier = {
  client: AgentClient
  clientOf?: (agent: string) => Promise<AgentClient>
  registry: ModelRegistry
  agentFilter: string | undefined
  // The run's router (the routing decision state: the down marks the entry
  // choice and the failure marking read, the key marks the ring predicate
  // reads), carried by the routing facts the classifier is built from.
  router: Router
  now: () => number
  label: string
  timeoutMs: number
}

// The run's classifier, or undefined — no registry, or no classifier list (or
// an empty one) — in which case nobody asks and the run is byte-identical to
// one without the feature (C2).
// AUTO-DECISION: the classifier's one-shot session runs on the pick entry's own host when the caller hands the pool's client resolver (the entry's agent, exactly as §7.1 settles: "the pool hands out the entry's host"); the watch's own client remains the fallback, which a no-registry caller and the tests keep passing
export function classifierFor(
  client: AgentClient,
  routing: RoutingFacts | undefined,
  label = "",
  clients?: (agent: string) => Promise<AgentClient>,
): Classifier | undefined {
  if (routing === undefined || !(routing.registry.classifier?.names.length ?? 0)) return undefined
  return {
    client,
    ...(clients !== undefined ? { clientOf: clients } : {}),
    registry: routing.registry,
    agentFilter: routing.agentFilter,
    router: routing.router,
    now: () => routing.clock.now(),
    label,
    timeoutMs: CLASSIFY_TIMEOUT_MS,
  }
}

// The first usable classifier entry (§7.1): the agent filter, the windows and
// the down marks apply, as does the provider's key ring (§6.2 rule 4 — an
// entry whose ring has no key left would only fail); the context cap does
// not, the prompt being tiny. v1 runs classifiers on opencode profiles only
// (the loader refuses others, and the adapter check repeats it here).
// AUTO-DECISION: the ring predicate (§6.2 rule 4) applies to classifier entries beside the three rules §7.1 names (an exhausted ring cannot serve the call, and asking it would only spend the run's call budget on a certain failure)
export function classifierEntry(router: Router, registry: ModelRegistry, agentFilter: string | undefined, now: number): { name: string; entry: ModelEntry } | undefined {
  for (const name of registry.classifier?.names ?? []) {
    const entry = registry.models.get(name)
    if (entry === undefined) continue
    const adapter = registry.agents.get(entry.agent)?.adapter
    if (adapter !== "opencode" || (agentFilter !== undefined && adapter !== agentFilter)) continue
    if (!usableAt(entry, registry.tz, now) || router.isModelDown(name, now)) continue
    if (entry.provider !== undefined && !ringHasUsableKey(router, entry.provider, now)) continue
    return { name, entry }
  }
  return undefined
}

// Where the classifier's token usage goes. Never into the unit's session
// totals: the classifier's session is not the watched session (the watch
// bills only its own session's steps), and it opens no stats segment. A
// per-model stats bucket for it registers here; until one does, the usage is
// only measured.
export type ClassifyUsageSink = (usage: Usage, entry: string) => void

// Run state (per process; tests reset it): the answers by cache key, the
// calls in flight by cache key, the calls made and whether the limit line
// was logged.
const answers = new Map<string, ClassifierAnswer>()
const inflight = new Map<string, Promise<ClassifierAnswer | undefined>>()
let calls = 0
let limitNoted = false
let usageSink: ClassifyUsageSink | undefined

export function setClassifyUsageSink(sink: ClassifyUsageSink | undefined): void {
  usageSink = sink
}

// The cached answer for an error, if one is known this run.
export function cachedAnswer(info: ErrorInfo): ClassifierAnswer | undefined {
  const input = classifierInput(info)
  return input === "" ? undefined : answers.get(classifierCacheKey(input))
}

// The calls this run has made (tests and the limit line read it).
export function classifierCalls(): number {
  return calls
}

// Asks about an error: a known answer resolves at once, a call in flight for
// the same key is joined, otherwise a new call starts. undefined = nothing is
// asked: no provider text, the run's call limit is spent (the log says so
// once), or no classifier entry is usable now. The promise resolves to the
// answer, or undefined for no answer (timeout, failure, unparsable reply);
// it never rejects.
export function askClassifier(classifier: Classifier, info: ErrorInfo): Promise<ClassifierAnswer | undefined> | undefined {
  const input = classifierInput(info)
  if (input === "") return undefined
  const key = classifierCacheKey(input)
  const known = answers.get(key)
  if (known !== undefined) return Promise.resolve(known)
  const pending = inflight.get(key)
  if (pending !== undefined) return pending
  if (calls >= CLASSIFY_CALL_LIMIT) {
    if (!limitNoted) {
      limitNoted = true
      log(`ℹ the failure-message classifier reached its limit of ${CLASSIFY_CALL_LIMIT} calls for this run; from now on the error patterns decide alone`)
    }
    return undefined
  }
  const now = classifier.now()
  const pick = classifierEntry(classifier.router, classifier.registry, classifier.agentFilter, now)
  if (pick === undefined) {
    vlog(`  classifier: no classifier entry is usable now; the error patterns decide alone`)
    return undefined
  }
  calls += 1
  const call = runClassifier(classifier, pick, input, now)
    .catch(() => undefined)
    .then((answer) => {
      if (answer !== undefined) answers.set(key, answer)
      return answer
    })
    .finally(() => inflight.delete(key))
  inflight.set(key, call)
  return call
}

// One call: the prompt with the current time in the registry's zone, the
// one-shot session, then the reply parsed — or no answer, with the
// classifier's own failure classified by the patterns alone.
// AUTO-DECISION: a classifier failure marks its entry down only when the patterns class it quota, auth or rate — the classes that mark a model down anywhere (§7); a timeout, a transient or unknown failure and an unparsable reply are no answer and mark nothing, so a flaky free model is simply asked again next time within the call budget
async function runClassifier(
  classifier: Classifier,
  pick: { name: string; entry: ModelEntry },
  input: string,
  now: number,
): Promise<ClassifierAnswer | undefined> {
  const { registry } = classifier
  const text = renderClassifyError({ now: isoInZone(now, registry.tz), tz: registry.tz, error: input })
  vlog(`  classifier: asking ${pick.name} about a failure message (call ${calls}/${CLASSIFY_CALL_LIMIT})`)
  // The entry's own host (§8.1): the pool starts it here if the entry is the
  // first dispatch on its agent; the watch's client is the fallback.
  const client = (await classifier.clientOf?.(pick.entry.agent)) ?? classifier.client
  const outcome = await oneShot(client, pick.entry, text, classifier.timeoutMs)
  if (outcome.usage.steps > 0) usageSink?.(outcome.usage, pick.name)
  const prefix = classifier.label ? `${classifier.label} ` : ""
  if (outcome.kind === "timeout") {
    vlog(`  classifier: ${pick.name} gave no answer within ${Math.round(classifier.timeoutMs / 1000)} s; the error patterns decide alone`)
    return undefined
  }
  if (outcome.kind === "failed") {
    const cls = classifySessionError(outcome.error, client.errorPatterns, retryPolicyOf(client.retryPolicy, pick.entry.retry))
    if (cls === "quota" || cls === "auth" || cls === "rate") {
      classifier.router.markModelDown(pick.name)
      log(`⚠ ${prefix}the classifier ${pick.name} failed (${cls}); marked it down, and the error patterns decide this failure alone`)
    } else vlog(`  classifier: ${pick.name} failed (${cls}); the error patterns decide alone`)
    return undefined
  }
  const answer = parseClassifierReply(outcome.text)
  if (answer === undefined) vlog(`  classifier: ${pick.name} gave a reply that does not parse; the error patterns decide alone`)
  return answer
}

type OneShot =
  | { kind: "reply"; text: string; usage: Usage }
  | { kind: "failed"; error: ErrorInfo; usage: Usage }
  | { kind: "timeout"; usage: Usage }

// The one-shot session: created titled `auto: classify error`, subscribed
// before the prompt, the prompt sent bare on the entry's model (its base
// step and variant; an entry without `model` runs on the agent's default)
// and on the adapter's default agent — no `agent` key, so not the `auto`
// contract — then read until the turn ends, fails or the timeout aborts it.
async function oneShot(client: AgentClient, entry: ModelEntry, text: string, timeoutMs: number): Promise<OneShot> {
  const usage: Usage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
  const created = await client.create({ title: CLASSIFY_TITLE })
  if (!created.ok) return { kind: "failed", error: { message: formatClientError(created.error) }, usage }
  const session = created.value.id
  const stop = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    stop.abort()
  }, timeoutMs)
  const halted = new Promise<IteratorResult<AgentEvent>>((resolve) => {
    const done = () => resolve({ done: true, value: undefined })
    if (stop.signal.aborted) done()
    else stop.signal.addEventListener("abort", done, { once: true })
  })
  let failure: ErrorInfo | undefined
  const fail = (more: ErrorInfo) => {
    failure = { ...failure, ...more, message: [failure?.message, more.message].filter(Boolean).join("\n") || undefined }
  }
  const texts = new Map<string, string>()
  const billed = new Set<string>()
  let settled = false
  try {
    const events = await client.events(stop.signal)
    void client
      .prompt(
        {
          session,
          text,
          ...(entry.model !== undefined ? { model: entry.model } : {}),
          ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
          bare: true,
        },
        stop.signal,
      )
      .then((sent) => {
        if (sent.ok || stop.signal.aborted) return
        fail({ message: formatClientError(sent.error) })
        stop.abort()
      })
    const inner = events[Symbol.asyncIterator]()
    for (;;) {
      const step = await Promise.race([inner.next(), halted])
      if (step.done) break
      const event = step.value
      if (event.session !== session) continue
      if (event.type === "part") {
        const part = event.part
        if (part.kind === "text" && part.final) texts.set(part.id, part.text)
        if (part.kind === "step-finish" && !billed.has(part.id)) {
          billed.add(part.id)
          usage.input += part.tokens.input
          usage.output += part.tokens.output
          usage.reasoning += part.tokens.reasoning
          usage.cacheRead += part.tokens.cacheRead
          usage.cacheWrite += part.tokens.cacheWrite
          usage.cost += part.cost
          usage.steps += 1
        }
        continue
      }
      if (event.type === "error") {
        const name = event.error.name ?? ""
        const detail = event.error.message ?? name
        fail({
          message: detail.toLowerCase().includes(name.toLowerCase()) ? detail : `${name} ${detail}`,
          ...(event.error.statusCode !== undefined ? { statusCode: event.error.statusCode } : {}),
          ...(event.error.isRetryable !== undefined ? { isRetryable: event.error.isRetryable } : {}),
          ...(event.error.responseBody !== undefined ? { responseBody: event.error.responseBody } : {}),
          terminal: true,
        })
        continue
      }
      if (event.type === "retry") {
        // The classifier's own provider is failing: a class the escalation
        // acts on ends the call at once (its entry is marked down); anything
        // else waits for the agent's own retry within the timeout.
        fail({
          ...(event.error.message !== undefined ? { message: event.error.message } : {}),
          ...(event.error.statusCode !== undefined ? { statusCode: event.error.statusCode } : {}),
          ...(event.error.isRetryable !== undefined ? { isRetryable: event.error.isRetryable } : {}),
          ...(event.error.responseBody !== undefined ? { responseBody: event.error.responseBody } : {}),
          ...(event.attempt !== undefined ? { attempt: event.attempt } : {}),
          ...(event.next !== undefined ? { next: event.next } : {}),
        })
        const cls = classifySessionError(failure ?? {}, client.errorPatterns, retryPolicyOf(client.retryPolicy, entry.retry))
        if (cls === "quota" || cls === "auth" || cls === "rate") break
        continue
      }
      // With every tool denied nothing should ask; anything that does is
      // refused and the turn goes on.
      if (event.type === "question") {
        await client.rejectQuestion(event.request)
        continue
      }
      if (event.type === "permission") {
        await client.replyPermission(event.request, "reject")
        continue
      }
      if (event.type === "idle") {
        settled = true
        break
      }
    }
  } finally {
    clearTimeout(timer)
    const unfinished = !settled
    stop.abort()
    if (unfinished) await client.abort(session)
  }
  if (failure !== undefined && (settled || !timedOut)) return { kind: "failed", error: failure, usage }
  if (!settled) return timedOut ? { kind: "timeout", usage } : { kind: "failed", error: failure ?? { message: "the classifier session ended without an answer" }, usage }
  return { kind: "reply", text: [...texts.values()].join("\n"), usage }
}

// Tests reset the module state (one Bun process runs many test files). The
// answers, in-flight calls and budget are the module's own until they move
// into the router service with their unit; the down marks already live
// there and need no reset here (the preload installs a fresh router per
// test).
export function resetClassifier(): void {
  answers.clear()
  inflight.clear()
  calls = 0
  limitNoted = false
  usageSink = undefined
}
