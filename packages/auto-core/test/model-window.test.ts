import { describe, expect, test } from "bun:test"
import {
  checkTimeZone,
  DEFAULT_WINDOW_TZ,
  formatWindowState,
  type ModelWindow,
  nextOpening,
  parseWindow,
  usableAt,
  type WindowSpec,
  windowState,
} from "../src/model-window"

// Instants are written as UTC ISO strings. Week of reference: mon 2026-09-21 .. sun 2026-09-27.
const utc = (iso: string): number => Date.parse(`${iso}Z`)

function win(text: string): ModelWindow {
  const parsed = parseWindow(text)
  if ("error" in parsed) throw new Error(parsed.error)
  return parsed.window
}
const only = (...texts: string[]): WindowSpec => ({ only: texts.map(win) })
const avoid = (...texts: string[]): WindowSpec => ({ avoid: texts.map(win) })
const errorOf = (text: string): string => {
  const parsed = parseWindow(text)
  return "error" in parsed ? parsed.error : ""
}

describe("parseWindow: grammar", () => {
  test("times alone mean every day; minutes count from the start day's midnight", () => {
    expect(win("09:00-18:00")).toEqual({ text: "09:00-18:00", days: [0, 1, 2, 3, 4, 5, 6], start: 540, end: 1080 })
  })

  test("a day, a range, a wrapping range, a list and a list with ranges", () => {
    expect(win("sat 10:00-12:00").days).toEqual([6])
    expect(win("mon-fri 09:00-18:00").days).toEqual([1, 2, 3, 4, 5])
    expect(win("fri-mon 09:00-18:00").days).toEqual([0, 1, 5, 6])
    expect(win("sat-sun 00:00-24:00").days).toEqual([0, 6])
    expect(win("sat,sun 09:00-18:00").days).toEqual([0, 6])
    expect(win("mon-wed,fri 09:00-18:00").days).toEqual([1, 2, 3, 5])
    expect(win("sat,sat 09:00-18:00").days).toEqual([6])
  })

  test("an end at or before the start crosses midnight; 24:00 is the end of the day", () => {
    expect(win("22:00-06:00")).toMatchObject({ start: 1320, end: 1800 })
    expect(win("22:00-00:00")).toMatchObject({ start: 1320, end: 1440 })
    expect(win("22:00-24:00")).toMatchObject({ start: 1320, end: 1440 })
    expect(win("00:00-24:00")).toMatchObject({ start: 0, end: 1440 })
  })

  test("a bad shape names the text and the expected grammar", () => {
    for (const text of ["", "9:00-18:00", "09:00", "mon-fri", "mon-fri09:00-18:00", "mon-fri  09:00-18:00", " 09:00-18:00", "09:00 - 18:00"]) {
      expect(errorOf(text)).toBe(
        `window "${text}": expected [days ]HH:MM-HH:MM, e.g. "mon-fri 09:00-18:00", "sat,sun 00:00-24:00" or "22:00-06:00"`,
      )
    }
  })

  test("bad times are named", () => {
    expect(errorOf("24:00-06:00")).toBe('window "24:00-06:00": 24:00 is allowed only as the end (start at 00:00 instead)')
    expect(errorOf("25:00-06:00")).toBe('window "25:00-06:00": start 25:00 is not a time (expected 00:00..23:59)')
    expect(errorOf("09:60-18:00")).toBe('window "09:60-18:00": start 09:60 is not a time (expected 00:00..23:59)')
    expect(errorOf("09:00-24:30")).toBe('window "09:00-24:30": end 24:30 is not a time (expected 00:00..24:00)')
    expect(errorOf("09:00-18:75")).toBe('window "09:00-18:75": end 18:75 is not a time (expected 00:00..24:00)')
    expect(errorOf("09:00-09:00")).toBe(
      'window "09:00-09:00": start and end are both 09:00; a window cannot be empty (00:00-24:00 is a whole day)',
    )
  })

  test("bad days are named", () => {
    expect(errorOf("mon-fry 09:00-18:00")).toBe(
      'window "mon-fry 09:00-18:00": days "mon-fry": unknown day "fry" (expected mon, tue, wed, thu, fri, sat or sun)',
    )
    expect(errorOf("Mon 09:00-18:00")).toBe(
      'window "Mon 09:00-18:00": days "Mon": unknown day "Mon" (expected mon, tue, wed, thu, fri, sat or sun)',
    )
    expect(errorOf("mon-mon 09:00-18:00")).toBe(
      'window "mon-mon 09:00-18:00": days "mon-mon": range "mon-mon" starts and ends on the same day (write the day alone)',
    )
    expect(errorOf("sat,,sun 09:00-18:00")).toBe(
      'window "sat,,sun 09:00-18:00": days "sat,,sun": item "" is not a day or a range (expected e.g. mon, mon-fri or sat,sun)',
    )
    expect(errorOf("mon-wed-fri 09:00-18:00")).toBe(
      'window "mon-wed-fri 09:00-18:00": days "mon-wed-fri": item "mon-wed-fri" is not a day or a range (expected e.g. mon, mon-fri or sat,sun)',
    )
  })
})

describe("checkTimeZone", () => {
  test("the default is UTC", () => {
    expect(DEFAULT_WINDOW_TZ).toBe("UTC")
    expect(checkTimeZone(DEFAULT_WINDOW_TZ)).toEqual({ tz: "UTC" })
  })

  test("an IANA name is accepted in its canonical spelling", () => {
    expect(checkTimeZone("Asia/Shanghai")).toEqual({ tz: "Asia/Shanghai" })
    expect(checkTimeZone("europe/berlin")).toEqual({ tz: "Europe/Berlin" })
  })

  test("an unknown zone is named with the expected form", () => {
    for (const tz of ["Mars/Olympus", "", "Asia/Shang hai"]) {
      expect(checkTimeZone(tz)).toEqual({
        error: `time zone "${tz}" is unknown (expected an IANA time zone name, e.g. "UTC", "Asia/Shanghai" or "Europe/Berlin")`,
      })
    }
  })
})

describe("usableAt", () => {
  test("a model without windows is always usable", () => {
    expect(usableAt({}, "UTC", utc("2026-09-21T10:00"))).toBe(true)
    expect(usableAt({}, "Asia/Shanghai", utc("2026-09-26T23:59"))).toBe(true)
  })

  test("avoid: unusable inside any window, start inclusive and end exclusive", () => {
    const peak = avoid("mon-fri 09:00-18:00")
    expect(usableAt(peak, "UTC", utc("2026-09-21T08:59"))).toBe(true)
    expect(usableAt(peak, "UTC", utc("2026-09-21T09:00"))).toBe(false)
    expect(usableAt(peak, "UTC", utc("2026-09-21T17:59"))).toBe(false)
    expect(usableAt(peak, "UTC", utc("2026-09-21T18:00"))).toBe(true)
    expect(usableAt(peak, "UTC", utc("2026-09-26T10:00"))).toBe(true)
    expect(usableAt(avoid(), "UTC", utc("2026-09-21T10:00"))).toBe(true)
  })

  test("only: usable only inside one of the windows", () => {
    const cheap = only("00:00-08:00", "sat-sun 00:00-24:00")
    expect(usableAt(cheap, "UTC", utc("2026-09-23T07:59"))).toBe(true)
    expect(usableAt(cheap, "UTC", utc("2026-09-23T08:00"))).toBe(false)
    expect(usableAt(cheap, "UTC", utc("2026-09-26T12:00"))).toBe(true)
    expect(usableAt(cheap, "UTC", utc("2026-09-27T23:59"))).toBe(true)
    expect(usableAt(cheap, "UTC", utc("2026-09-28T08:00"))).toBe(false)
    expect(usableAt(only(), "UTC", utc("2026-09-23T07:59"))).toBe(false)
  })

  test("a window crossing midnight belongs to the day it starts on", () => {
    const night = only("fri 22:00-06:00")
    expect(usableAt(night, "UTC", utc("2026-09-25T21:59"))).toBe(false)
    expect(usableAt(night, "UTC", utc("2026-09-25T22:00"))).toBe(true)
    expect(usableAt(night, "UTC", utc("2026-09-26T05:59"))).toBe(true)
    expect(usableAt(night, "UTC", utc("2026-09-26T06:00"))).toBe(false)
    // friday early morning is thursday's night, and thursday is not listed
    expect(usableAt(night, "UTC", utc("2026-09-25T03:00"))).toBe(false)
    // saturday night is not listed either
    expect(usableAt(night, "UTC", utc("2026-09-26T23:00"))).toBe(false)
  })

  test("a window ending at 24:00 runs to midnight and no further", () => {
    const evening = only("mon 20:00-24:00")
    expect(usableAt(evening, "UTC", utc("2026-09-21T23:59"))).toBe(true)
    expect(usableAt(evening, "UTC", utc("2026-09-22T00:00"))).toBe(false)
  })

  test("windows read the wall clock of the registry time zone", () => {
    // Asia/Shanghai is UTC+8 all year
    const peak = avoid("mon-fri 09:00-18:00")
    expect(usableAt(peak, "Asia/Shanghai", utc("2026-09-21T00:59"))).toBe(true)
    expect(usableAt(peak, "Asia/Shanghai", utc("2026-09-21T01:00"))).toBe(false)
    expect(usableAt(peak, "Asia/Shanghai", utc("2026-09-21T10:00"))).toBe(true)
    // friday 17:00 UTC is saturday 01:00 in Shanghai
    expect(usableAt(avoid("sat 00:00-02:00"), "Asia/Shanghai", utc("2026-09-25T17:00"))).toBe(false)
  })
})

describe("DST: wall-clock windows in zones that change their offset", () => {
  // Europe/Berlin 2026: CET (UTC+1) → CEST (UTC+2) on sun 03-29 at 01:00 UTC (02:00 → 03:00 local);
  // CEST → CET on sun 10-25 at 01:00 UTC (03:00 → 02:00 local, so 02:00-03:00 occurs twice).
  const berlin = "Europe/Berlin"

  test("the same local window moves by an hour in UTC across the change", () => {
    const office = only("09:00-18:00")
    expect(usableAt(office, berlin, utc("2026-03-27T07:59"))).toBe(false)
    expect(usableAt(office, berlin, utc("2026-03-27T08:00"))).toBe(true)
    expect(usableAt(office, berlin, utc("2026-03-27T16:59"))).toBe(true)
    expect(usableAt(office, berlin, utc("2026-03-30T06:59"))).toBe(false)
    expect(usableAt(office, berlin, utc("2026-03-30T07:00"))).toBe(true)
    expect(usableAt(office, berlin, utc("2026-03-30T16:00"))).toBe(false)
    // on the change day itself 09:00 is already summer time
    expect(nextOpening([office], berlin, utc("2026-03-28T17:00"))).toBe(utc("2026-03-29T07:00"))
  })

  test("a window starting in the skipped hour opens at the jump", () => {
    const early = only("02:30-04:00")
    expect(usableAt(early, berlin, utc("2026-03-29T00:59"))).toBe(false)
    expect(usableAt(early, berlin, utc("2026-03-29T01:00"))).toBe(true)
    expect(usableAt(early, berlin, utc("2026-03-29T01:59"))).toBe(true)
    expect(usableAt(early, berlin, utc("2026-03-29T02:00"))).toBe(false)
    expect(nextOpening([early], berlin, utc("2026-03-29T00:00"))).toBe(utc("2026-03-29T01:00"))
  })

  test("a window lying wholly in the skipped hour is empty that day", () => {
    const gap = only("sun 02:10-02:50")
    expect(usableAt(gap, berlin, utc("2026-03-29T01:00"))).toBe(false)
    expect(nextOpening([gap], berlin, utc("2026-03-28T12:00"))).toBe(utc("2026-04-05T00:10"))
    expect(nextOpening([gap], berlin, utc("2026-03-22T00:00"))).toBe(utc("2026-03-22T01:10"))
  })

  test("a repeated local time means its first occurrence, and a window stays one span", () => {
    const late = only("02:30-04:00")
    expect(nextOpening([late], berlin, utc("2026-10-24T12:00"))).toBe(utc("2026-10-25T00:30"))
    // 01:15 UTC is 02:15 CET, the second pass through the repeated hour: still inside
    expect(usableAt(late, berlin, utc("2026-10-25T01:15"))).toBe(true)
    expect(windowState(late, berlin, utc("2026-10-25T01:15"))).toEqual({ open: true, until: utc("2026-10-25T03:00") })

    const beforeTurn = only("01:00-02:30")
    expect(usableAt(beforeTurn, berlin, utc("2026-10-24T22:59"))).toBe(false)
    expect(usableAt(beforeTurn, berlin, utc("2026-10-24T23:00"))).toBe(true)
    expect(usableAt(beforeTurn, berlin, utc("2026-10-25T00:29"))).toBe(true)
    // closed at the first 02:30 and not reopened when the clock turns back to 02:00
    expect(usableAt(beforeTurn, berlin, utc("2026-10-25T00:30"))).toBe(false)
    expect(usableAt(beforeTurn, berlin, utc("2026-10-25T01:15"))).toBe(false)
  })

  test("adjacent windows leave neither a gap nor an overlap on change days", () => {
    const always = avoid("00:00-02:30", "02:30-24:00")
    for (const iso of ["2026-03-29T00:59", "2026-03-29T01:00", "2026-03-29T01:30", "2026-10-25T00:30", "2026-10-25T01:15", "2026-10-25T01:30"]) {
      expect(usableAt(always, berlin, utc(iso))).toBe(false)
    }
    expect(nextOpening([always], berlin, utc("2026-03-28T12:00"))).toBeUndefined()
    const split = avoid("00:00-02:30", "03:00-24:00")
    // open 02:30-03:00 local every day, except on the day that skips it
    expect(nextOpening([split], berlin, utc("2026-03-29T00:00"))).toBe(utc("2026-03-30T00:30"))
    expect(nextOpening([split], berlin, utc("2026-10-25T00:00"))).toBe(utc("2026-10-25T00:30"))
  })

  test("America/New_York: the next opening after the change keeps local time", () => {
    // EDT (UTC-4) → EST (UTC-5) on sun 2026-11-01 at 06:00 UTC
    const ny = "America/New_York"
    expect(nextOpening([avoid("mon-fri 09:00-17:00")], ny, utc("2026-10-30T20:00"))).toBe(utc("2026-10-30T21:00"))
    expect(nextOpening([only("mon 09:00-10:00")], ny, utc("2026-10-30T20:00"))).toBe(utc("2026-11-02T14:00"))
    // EST → EDT on sun 2026-03-08 at 07:00 UTC; the skipped 02:00-03:00 opens at the jump
    expect(nextOpening([only("sun 02:00-03:30")], ny, utc("2026-03-07T12:00"))).toBe(utc("2026-03-08T07:00"))
  })
})

describe("nextOpening", () => {
  test("a usable model opens now", () => {
    const now = utc("2026-09-21T08:00")
    expect(nextOpening([avoid("mon-fri 09:00-18:00")], "UTC", now)).toBe(now)
    expect(nextOpening([{}], "UTC", now)).toBe(now)
  })

  test("avoid: the model opens where the window ends", () => {
    expect(nextOpening([avoid("mon-fri 09:00-18:00")], "UTC", utc("2026-09-21T10:00"))).toBe(utc("2026-09-21T18:00"))
    expect(nextOpening([avoid("mon-fri 09:00-18:00")], "Asia/Shanghai", utc("2026-09-21T03:00"))).toBe(utc("2026-09-21T10:00"))
  })

  test("avoid: adjacent and overlapping windows chain, across midnight and days", () => {
    expect(nextOpening([avoid("mon-fri 09:00-18:00", "17:00-20:00")], "UTC", utc("2026-09-21T10:00"))).toBe(utc("2026-09-21T20:00"))
    expect(nextOpening([avoid("fri 18:00-24:00", "sat-sun 00:00-24:00")], "UTC", utc("2026-09-25T19:00"))).toBe(utc("2026-09-28T00:00"))
    expect(nextOpening([avoid("fri 22:00-06:00", "sat 06:00-08:00")], "UTC", utc("2026-09-26T01:00"))).toBe(utc("2026-09-26T08:00"))
  })

  test("only: the next window may be a week away", () => {
    const saturday = only("sat 10:00-12:00")
    expect(nextOpening([saturday], "UTC", utc("2026-09-26T11:00"))).toBe(utc("2026-09-26T11:00"))
    expect(nextOpening([saturday], "UTC", utc("2026-09-26T12:00"))).toBe(utc("2026-10-03T10:00"))
    expect(nextOpening([saturday], "UTC", utc("2026-09-27T00:00"))).toBe(utc("2026-10-03T10:00"))
    expect(nextOpening([only("sun 23:00-01:00")], "UTC", utc("2026-09-21T01:00"))).toBe(utc("2026-09-27T23:00"))
  })

  test("the earliest opening of several models wins", () => {
    const now = utc("2026-09-21T10:00")
    const specs = [only("sat 10:00-12:00"), avoid("mon-fri 09:00-18:00"), only("mon 15:00-16:00")]
    expect(nextOpening(specs, "UTC", now)).toBe(utc("2026-09-21T15:00"))
    expect(nextOpening([only(), only("tue 00:00-01:00")], "UTC", now)).toBe(utc("2026-09-22T00:00"))
  })

  test("undefined when no model ever opens", () => {
    const now = utc("2026-09-21T10:00")
    expect(nextOpening([], "UTC", now)).toBeUndefined()
    expect(nextOpening([only()], "UTC", now)).toBeUndefined()
    expect(nextOpening([avoid("00:00-24:00")], "UTC", now)).toBeUndefined()
    expect(nextOpening([avoid("mon-fri 00:00-24:00", "sat-sun 00:00-24:00"), only()], "UTC", now)).toBeUndefined()
  })
})

describe("windowState and formatWindowState", () => {
  const tz = "Asia/Shanghai"
  // fri 2026-09-25 11:00 in Shanghai
  const friday = utc("2026-09-25T03:00")
  // sat 2026-09-26 11:00 in Shanghai
  const saturday = utc("2026-09-26T03:00")
  const text = (spec: WindowSpec, now: number): string => formatWindowState(windowState(spec, tz, now), tz, now)

  test("structured state: open until the next closing, or closed until the next opening", () => {
    expect(windowState({}, tz, friday)).toEqual({ open: true, until: undefined })
    expect(windowState(avoid("mon-fri 09:00-18:00"), tz, friday)).toEqual({ open: false, opens: utc("2026-09-25T10:00") })
    expect(windowState(avoid("mon-fri 09:00-18:00"), tz, saturday)).toEqual({ open: true, until: utc("2026-09-28T01:00") })
    expect(windowState(only("00:00-08:00"), tz, friday)).toEqual({ open: false, opens: utc("2026-09-25T16:00") })
    expect(windowState(only(), tz, friday)).toEqual({ open: false, opens: undefined })
    expect(windowState(only("00:00-24:00"), tz, friday)).toEqual({ open: true, until: undefined })
  })

  test("short phrases name the local time and the zone, and a weekday when it is not today", () => {
    expect(text({}, friday)).toBe("open")
    expect(text(only("09:00-18:00"), friday)).toBe("open until 18:00 Asia/Shanghai")
    expect(text(avoid("mon-fri 09:00-18:00"), friday)).toBe("opens 18:00 Asia/Shanghai")
    expect(text(avoid("mon-fri 09:00-18:00"), saturday)).toBe("open until mon 09:00 Asia/Shanghai")
    expect(text(only("sat-sun 00:00-24:00"), friday)).toBe("opens sat 00:00 Asia/Shanghai")
    expect(text(only("00:00-08:00", "sat-sun 00:00-24:00"), saturday)).toBe("open until mon 08:00 Asia/Shanghai")
    expect(text(only(), friday)).toBe("closed")
  })
})
