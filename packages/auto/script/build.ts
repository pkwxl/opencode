#!/usr/bin/env bun
import { fileURLToPath } from "url"

// One-shot build of the standalone executable dist/opencode-auto (templates
// and SDK embedded).
// Usage: bun run build [--target <bun platform triple>]
const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const

const index = process.argv.indexOf("--target")
const raw = index === -1 ? undefined : process.argv[index + 1]
const target = TARGETS.find((item) => item === raw)
if (raw && !target) {
  console.error(`Unknown --target: ${raw}\nvalid values: ${TARGETS.join(", ")}`)
  process.exit(1)
}
// Cross-compiled outputs get a platform suffix so they never overwrite the
// native binary.
const outfile = target ? `dist/opencode-auto-${target.replace(/^bun-/, "")}` : "dist/opencode-auto"

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  minify: true,
  compile: { ...(target ? { target } : {}), outfile },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`Standalone executable generated: ${outfile}`)
