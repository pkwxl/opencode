#!/usr/bin/env bun
import { fileURLToPath } from "url"

// One-shot build of the standalone executable dist/opencode-auto-server
// (templates and SDK embedded).
// Usage: bun run build [--target <bun platform triple>]

// The build stamp (plans/0270): the tool tree's commit, read at compile and
// defined over AUTO_BUILD_COMMIT — the declared constant
// packages/auto-server/src/version.ts reads (the identity's one home, the
// fallback word's too). The stamp lives only in the artifact: no source
// edit, no generated file, the working tree clean. A tree git cannot name
// (no git, not a repository) gets no define — the source-side fallback
// rides honestly.

/** Shape-check a `git rev-parse --short HEAD` stdout line: a hex sha, or nothing. */
export function shortCommit(output: string | undefined): string | undefined {
  const trimmed = output === undefined ? undefined : output.trim()
  return trimmed !== undefined && /^[0-9a-f]{7,40}$/.test(trimmed) ? trimmed : undefined
}

/** The define map carrying the stamp into the bundle; absent commit, empty — the fallback rides. */
export function stampDefine(commit: string | undefined): Record<string, string> {
  return commit === undefined ? {} : { AUTO_BUILD_COMMIT: JSON.stringify(commit) }
}

function readHead(dir: string): string | undefined {
  const proc = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: dir, stdout: "pipe", stderr: "pipe" })
  return proc.exitCode === 0 ? proc.stdout.toString() : undefined
}

async function main() {
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
  const outfile = target ? `dist/opencode-auto-server-${target.replace(/^bun-/, "")}` : "dist/opencode-auto-server"

  const commit = shortCommit(readHead(dir))
  const result = await Bun.build({
    entrypoints: ["src/index.ts"],
    minify: true,
    define: stampDefine(commit),
    compile: { ...(target ? { target } : {}), outfile },
  })
  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`Standalone executable generated: ${outfile}${commit === undefined ? "" : ` (build ${commit})`}`)
}

if (import.meta.main) await main()
