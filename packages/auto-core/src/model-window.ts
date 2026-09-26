// Model windows (plans/0055 §4.4, §4.2 `tz`): the `avoid` / `only` window lists
// of a registry model entry, the registry time zone, and the two questions
// selection asks: is a model inside its windows at an instant, and when does
// the earliest of several models open next. Pure: every function takes the
// instant `now` (epoch ms) from its caller and never reads the clock itself.
// The registry loader parses and validates with this module; it prefixes each
// error with the field and the layer.
//
// Grammar: `[days ]HH:MM-HH:MM`, days and times separated by one space.
//   - days: `mon`..`sun` (lowercase), a range `mon-fri`, or a comma list
//     `sat,sun`. A list item may itself be a range (`mon-wed,fri`). Absent
//     days = every day.
//   - times: two-digit hours and minutes, 00:00..23:59. `24:00` is allowed only
//     as the end. An end at or before the start crosses midnight: `22:00-06:00`
//     runs from 22:00 to 06:00 the next day and belongs to the day it starts on,
//     so `fri 22:00-06:00` covers Friday night into Saturday morning.
// AUTO-RESOLVE: may a day range wrap past sun into mon (`fri-mon`)? -> yes, `fri-mon` = fri, sat, sun, mon; a range whose two ends are the same day (`mon-mon`) is refused (a wrapping range is the natural reading of a weekend span, and `mon-mon` could mean one day or the whole week, so the strict registry refuses it rather than guess)
// AUTO-RESOLVE: may a comma list contain ranges (`mon-wed,fri`)? -> yes (the design names a range and a comma list separately; allowing both in one list adds no ambiguity and saves a second window entry)
// AUTO-RESOLVE: what does a window whose start equals its end (`09:00-09:00`) mean? -> it is refused (it could mean an empty window or a whole day; `00:00-24:00` already spells the whole day)
//
// Time zone: every window of the registry reads the wall clock of one IANA
// zone (`tz`, default UTC), so `09:00-18:00` means 09:00 to 18:00 local time on
// each day, across DST changes. A window boundary is the first instant at
// which the local clock shows that date and time or a later one:
//   - a local time that does not exist (the hour skipped when DST starts) maps
//     to the instant the clock jumps past it. A window that starts inside the
//     skipped hour opens at the jump; one that lies wholly inside it is empty
//     on that day.
//   - a local time that occurs twice (the hour repeated when DST ends) maps to
//     its first occurrence. A window keeps one contiguous span on that day: it
//     never closes and reopens when the clock turns back.
// AUTO-RESOLVE: which instant do non-existent and duplicated local times of a DST change day mean? -> the first instant at which the local clock shows that time or a later one: a skipped time opens at the jump, a repeated time means its first occurrence (the rule of cron-style schedulers; it keeps windows contiguous, and adjacent windows such as `00:00-02:30` and `02:30-24:00` never leave a gap or an overlap)
//
// Availability: `avoid` makes the model unusable inside any of its windows,
// `only` makes it usable only inside one of them, and a model with neither is
// always usable. The loader refuses an entry with both lists; given both, this
// module requires both (outside every `avoid` window and inside an `only` one).
// AUTO-DECISION: given both lists, apply both rules rather than assume one is absent (costs nothing and keeps usableAt and nextOpening consistent for any input)
//
// Horizon: windows repeat every week, so a model that does not open within a
// week never opens. Searches look HORIZON_DAYS local days ahead, one week plus
// a day, which also covers the hour a DST change moves a boundary by.
// AUTO-DECISION: an 8-day search horizon (one week plus one day of slack for DST shifts; a longer horizon only costs time)

export const DEFAULT_WINDOW_TZ = "UTC"

// One parsed window. `days` holds the weekdays it starts on (0 = sunday, as
// Date.getUTCDay counts). `start` and `end` are minutes after the local
// midnight of the start day; `end` > `start`, and `end` > 1440 crosses midnight.
export type ModelWindow = { text: string; days: readonly number[]; start: number; end: number }

// The window lists of a model entry (structurally, a registry model entry).
export type WindowSpec = { avoid?: readonly ModelWindow[]; only?: readonly ModelWindow[] }

// A model's window state at an instant: usable until `until` (undefined: no
// window closes it within the horizon), or unusable until `opens` (undefined:
// it never opens).
export type WindowState = { open: true; until: number | undefined } | { open: false; opens: number | undefined }

const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
const EXPECTED = `expected [days ]HH:MM-HH:MM, e.g. "mon-fri 09:00-18:00", "sat,sun 00:00-24:00" or "22:00-06:00"`
const EXPECTED_DAY = "expected mon, tue, wed, thu, fri, sat or sun"
const MINUTE_MS = 60_000
const DAY_MS = 86_400_000
const HORIZON_DAYS = 8
const HORIZON_MS = HORIZON_DAYS * DAY_MS

// AUTO-DECISION: parse results are `{ window } | { error }` values, not exceptions (the registry loader collects every error of a file before it fails, as the claude contract check already returns `{ error }`)
export function parseWindow(text: string): { window: ModelWindow } | { error: string } {
  const bad = (why: string) => ({ error: `window "${text}": ${why}` })
  const match = /^(?:([^ ]+) )?(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(text)
  if (!match) return bad(EXPECTED)
  const [startHour, startMinute, endHour, endMinute] = match.slice(2).map(Number) as [number, number, number, number]
  if (startHour === 24 && startMinute === 0) return bad("24:00 is allowed only as the end (start at 00:00 instead)")
  if (startHour > 23 || startMinute > 59) return bad(`start ${match[2]}:${match[3]} is not a time (expected 00:00..23:59)`)
  if (endHour > 24 || endMinute > 59 || (endHour === 24 && endMinute > 0))
    return bad(`end ${match[4]}:${match[5]} is not a time (expected 00:00..24:00)`)
  const start = startHour * 60 + startMinute
  let end = endHour * 60 + endMinute
  if (end === start) return bad(`start and end are both ${match[2]}:${match[3]}; a window cannot be empty (00:00-24:00 is a whole day)`)
  if (end < start) end += 1440
  if (match[1] === undefined) return { window: { text, days: [0, 1, 2, 3, 4, 5, 6], start, end } }
  const days = parseDays(match[1])
  if ("error" in days) return bad(days.error)
  return { window: { text, days: days.days, start, end } }
}

function parseDays(text: string): { days: number[] } | { error: string } {
  const days = new Set<number>()
  for (const item of text.split(",")) {
    const ends = item.split("-")
    if (item === "" || ends.length > 2) return { error: `days "${text}": item "${item}" is not a day or a range (expected e.g. mon, mon-fri or sat,sun)` }
    const [from, to] = ends.map((name) => DAY_NAMES.indexOf(name))
    const unknown = ends.find((name) => !DAY_NAMES.includes(name))
    if (unknown !== undefined) return { error: `days "${text}": unknown day "${unknown}" (${EXPECTED_DAY})` }
    if (to === undefined) {
      days.add(from!)
      continue
    }
    if (from === to) return { error: `days "${text}": range "${item}" starts and ends on the same day (write the day alone)` }
    for (let day = from!; ; day = (day + 1) % 7) {
      days.add(day)
      if (day === to) break
    }
  }
  return { days: [...days].sort((a, b) => a - b) }
}

// Validates a registry `tz` with Intl.DateTimeFormat and returns its canonical
// spelling (`asia/shanghai` → `Asia/Shanghai`), which the logs show.
// AUTO-RESOLVE: accept every zone Intl.DateTimeFormat accepts, including case variants and fixed offsets such as "+08:00", or only exact IANA names? -> every zone Intl accepts, shown in its canonical spelling (the design names Intl as the validator; a fixed offset has no DST and cannot be misread)
export function checkTimeZone(tz: string): { tz: string } | { error: string } {
  try {
    return { tz: new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone }
  } catch {
    return { error: `time zone "${tz}" is unknown (expected an IANA time zone name, e.g. "UTC", "Asia/Shanghai" or "Europe/Berlin")` }
  }
}

// Is a model with these windows usable at instant now?
export function usableAt(spec: WindowSpec, tz: string, now: number): boolean {
  if (spec.avoid !== undefined && inside(spec.avoid, tz, now)) return false
  return spec.only === undefined || inside(spec.only, tz, now)
}

// The earliest instant at or after now at which any of specs is usable, or
// undefined when none opens within the horizon (for example an empty `only`
// list, or an `avoid` list covering the whole week).
export function nextOpening(specs: readonly WindowSpec[], tz: string, now: number): number | undefined {
  let best: number | undefined
  for (const spec of specs) {
    const at = opening(spec, tz, now)
    if (at !== undefined && (best === undefined || at < best)) best = at
  }
  return best
}

export function windowState(spec: WindowSpec, tz: string, now: number): WindowState {
  if (!usableAt(spec, tz, now)) return { open: false, opens: opening(spec, tz, now) }
  const closings = [
    spec.avoid === undefined ? undefined : firstStart(spec.avoid, tz, now),
    spec.only === undefined ? undefined : coverEnd(spec.only, tz, now),
  ].filter((at): at is number => at !== undefined)
  return { open: true, until: closings.length ? Math.min(...closings) : undefined }
}

// The window state as a short phrase for the logs and the `models` command:
// `open`, `open until 18:00 Asia/Shanghai`, `opens 18:00 Asia/Shanghai` or
// `closed` (never opens). A time on another local day than now carries its
// weekday: `opens mon 09:00 Asia/Shanghai`.
// AUTO-RESOLVE: how does the window state read? -> "open", "open until [ddd ]HH:MM <tz>", "opens [ddd ]HH:MM <tz>", "closed" (the design's examples, plus a weekday when the time is not today, since a bare "09:00" two days ahead would read as today)
export function formatWindowState(state: WindowState, tz: string, now: number): string {
  if (state.open) return state.until === undefined ? "open" : `open until ${clock(tz, state.until, now)} ${tz}`
  return state.opens === undefined ? "closed" : `opens ${clock(tz, state.opens, now)} ${tz}`
}

// An instant as the local wall clock of `tz` shows it, in ISO 8601 with the
// zone's offset at that instant, to the second: `2026-09-27T15:00:00+08:00`
// (`+00:00` for UTC). The failure-message classifier's prompt states the
// current time this way, and its reply names a reset time in the same shape
// (plans/0055 §7.1).
export function isoInZone(at: number, tz: string): string {
  const wall = wallAt(tz, at)
  const offset = Math.round((wall - at) / MINUTE_MS)
  const sign = offset < 0 ? "-" : "+"
  const abs = Math.abs(offset)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${new Date(wall).toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function clock(tz: string, at: number, now: number): string {
  const wall = wallAt(tz, at)
  const time = new Date(wall).toISOString().slice(11, 16)
  if (dayOf(wall) === dayOf(wallAt(tz, now))) return time
  return `${DAY_NAMES[new Date(wall).getUTCDay()]} ${time}`
}

// ---------------------------------------------------------------------------
// Searches over window occurrences
// ---------------------------------------------------------------------------

// One occurrence of a window: the instants [start, end) of one local day's run.
type Occurrence = { start: number; end: number }

function opening(spec: WindowSpec, tz: string, now: number): number | undefined {
  let at = now
  while (at - now <= HORIZON_MS) {
    if (spec.only !== undefined && !inside(spec.only, tz, at)) {
      const start = firstStart(spec.only, tz, at)
      if (start === undefined) return undefined
      at = start
    }
    const free = spec.avoid === undefined ? at : coverEnd(spec.avoid, tz, at)
    if (free === undefined) return undefined
    if (free === at) return at
    at = free
  }
  return undefined
}

function inside(windows: readonly ModelWindow[], tz: string, at: number): boolean {
  return occurrences(windows, tz, at, -1, 1).some((o) => o.start <= at && at < o.end)
}

// The earliest occurrence start at or after at, within the horizon.
function firstStart(windows: readonly ModelWindow[], tz: string, at: number): number | undefined {
  let best: number | undefined
  for (const o of occurrences(windows, tz, at, -1, HORIZON_DAYS)) {
    if (o.start >= at && (best === undefined || o.start < best)) best = o.start
  }
  return best
}

// The first instant at or after at that no occurrence covers: at itself when
// none covers it, else the end of the chain of overlapping or adjacent
// occurrences. undefined when the chain runs past the horizon.
function coverEnd(windows: readonly ModelWindow[], tz: string, at: number): number | undefined {
  let end = at
  for (;;) {
    const covering = occurrences(windows, tz, end, -1, 1).filter((o) => o.start <= end && end < o.end)
    if (!covering.length) return end
    end = Math.max(...covering.map((o) => o.end))
    if (end - at > HORIZON_MS) return undefined
  }
}

// The non-empty occurrences of windows that start on the local days from
// `from` to `to` (inclusive) around the local day of at. An occurrence that
// contains at starts on the day of at or the day before; the day after is
// included for zones whose clock turns back across midnight.
function occurrences(windows: readonly ModelWindow[], tz: string, at: number, from: number, to: number): Occurrence[] {
  const today = dayOf(wallAt(tz, at))
  const list: Occurrence[] = []
  for (let offset = from; offset <= to; offset++) {
    const day = today + offset * DAY_MS
    const weekday = new Date(day).getUTCDay()
    for (const window of windows) {
      if (!window.days.includes(weekday)) continue
      const start = firstReach(tz, day + window.start * MINUTE_MS)
      const end = firstReach(tz, day + window.end * MINUTE_MS)
      // Equal when the whole window lies in the hour skipped by a DST change.
      if (start < end) list.push({ start, end })
    }
  }
  return list
}

// ---------------------------------------------------------------------------
// Wall-clock arithmetic. A "wall" value is a local date and time encoded as
// the epoch ms at which a UTC clock would show it.
// ---------------------------------------------------------------------------

// A memo of one formatter per zone; it holds no state that changes results.
const formatters = new Map<string, Intl.DateTimeFormat>()

function wallAt(tz: string, at: number): number {
  let format = formatters.get(tz)
  if (format === undefined) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    })
    formatters.set(tz, format)
  }
  const part: Record<string, number> = {}
  for (const p of format.formatToParts(at)) if (p.type !== "literal") part[p.type] = Number(p.value)
  return Date.UTC(part.year!, part.month! - 1, part.day!, part.hour! % 24, part.minute!, part.second!) + (((at % 1000) + 1000) % 1000)
}

const dayOf = (wall: number): number => Math.floor(wall / DAY_MS) * DAY_MS

// The zone's UTC offset in ms at an instant.
const offsetAt = (tz: string, at: number): number => wallAt(tz, at) - at

// The first instant at which the local clock shows wall or a later time. The
// offsets a day before and a day after bracket any DST change near wall: a
// candidate instant is real when the zone has its offset there. Two real
// candidates mean a repeated hour (the earlier wins); none means a skipped
// hour, whose jump is found by bisection between the two offsets.
function firstReach(tz: string, wall: number): number {
  const before = offsetAt(tz, wall - DAY_MS)
  const after = offsetAt(tz, wall + DAY_MS)
  let best: number | undefined
  for (const offset of [before, after]) {
    const at = wall - offset
    if (offsetAt(tz, at) === offset && (best === undefined || at < best)) best = at
  }
  if (best !== undefined) return best
  // Skipped: before the jump the clock is behind wall, after it ahead.
  let lo = wall - after
  let hi = wall - before
  while (hi - lo > 1000) {
    const mid = lo + Math.floor((hi - lo) / 2000) * 1000
    if (offsetAt(tz, mid) === before) lo = mid
    else hi = mid
  }
  return hi
}
