// Verbose mode prefixes every output line with the current local time so a
// human watching the terminal can follow the timeline of events.
let verbose = false

export function setVerbose(on: boolean) {
  verbose = on
}

export function log(...args: unknown[]) {
  const text = args.map((arg) => (typeof arg === "string" ? arg : String(arg))).join(" ")
  if (!verbose) return console.log(text)
  const stamp = new Date().toTimeString().slice(0, 8)
  console.log(text.split("\n").map((line) => `[${stamp}] ${line}`).join("\n"))
}
