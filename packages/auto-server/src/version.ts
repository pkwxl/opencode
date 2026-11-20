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
