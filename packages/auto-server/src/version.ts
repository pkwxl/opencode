// The tool's build identity — the one home (plans/0270) of everything the
// wire and the serve banner report about which build is speaking. VERSION is
// the version this binary reports for --version, kept in step with the
// package.json "version" field by test/cli.test.ts, which asserts the two
// match: a compiled binary cannot read the manifest (only imported files are
// embedded), so this constant is the version the build ships. BUILD_COMMIT is
// the commit the build script stamps at compile (script/build.ts reads the
// tool tree's `git rev-parse --short HEAD` and Bun.build `define`s it over
// AUTO_BUILD_COMMIT) — the stamp lives only in the built artifact, never a
// source edit or generated file, so the working tree stays clean. Running
// from source, nothing was stamped: the honest fallback names itself (P12),
// never a fabricated commit.
export const VERSION = "0.0.0"

/** The unstamped fallback (a source/dev run): names itself, never a fabricated commit. */
export const UNSTAMPED_COMMIT = "dev"

// The define seam: `declare` is erased at typecheck (tsgo sees the
// declaration and stays green), leaving a free identifier at bundle time
// that Bun.build's define replaces with the stamped literal. The typeof
// guard keeps an unstamped run (source, dev) safe — no ReferenceError.
declare const AUTO_BUILD_COMMIT: string | undefined

/** The commit this process was built from — the stamped sha, or the source fallback. */
export const BUILD_COMMIT: string = typeof AUTO_BUILD_COMMIT === "string" ? AUTO_BUILD_COMMIT : UNSTAMPED_COMMIT

export type BuildFingerprint = { version: string; commit: string }

/** The assembly the wire and the banner read: the version constant beside the build commit. */
export function buildFingerprint(commit: string = BUILD_COMMIT): BuildFingerprint {
  return { version: VERSION, commit }
}

// 0293 (0290 F3's fix): the source-mode line — the identity a source run can
// actually name. 0270's stamp reads `dev` from source (the honest floor) and
// its residual assumed the resident daemons run built artifacts; the field
// measured the opposite — the estate runs from checkout until a release
// cuts, so a daemon that outlives its own checkout serves stale operations
// beside freshly-spawned bridges with no surface naming the skew. The
// amendment narrows 0270's declined runtime git read to its anchor: the read
// runs against THIS FILE's tree (import.meta.dir — the tool's own source,
// never the working directory, which names whatever project repository the
// operator launched against, 0270's P16 guard standing), and only when
// nothing was stamped (a compiled binary's $bunfs has no tree and no git;
// the stamped commit stands, no spawn). The dirty suffix is coarse by
// design — any dirt in the tool repo names itself. The comparison home is
// /health's `line` (the daemon's own, captured at its start) beside its
// fresh `checkout` read; the serve banner and the bridge handshake carry
// the same resolution.
export async function resolvedLine(): Promise<string> {
  if (BUILD_COMMIT !== UNSTAMPED_COMMIT) return BUILD_COMMIT
  if (import.meta.dir.includes("$bunfs")) return UNSTAMPED_COMMIT
  const commit = await gitLine(["rev-parse", "--short", "HEAD"])
  if (commit === undefined) return UNSTAMPED_COMMIT
  const dirt = await gitLine(["status", "--porcelain"])
  return dirt === undefined || dirt === "" ? commit : `${commit}+dirty`
}

async function gitLine(args: string[]): Promise<string | undefined> {
  try {
    const proc = Bun.spawn(["git", "--no-optional-locks", ...args], { cwd: import.meta.dir, stdout: "pipe", stderr: "pipe" })
    const out = await new Response(proc.stdout).text()
    if ((await proc.exited) !== 0) return undefined
    return out.trim() || undefined
  } catch {
    return undefined
  }
}
