// The version this binary reports for --version. Kept in step with the
// package.json "version" field by test/cli.test.ts, which asserts the two
// match: a compiled binary cannot read the manifest (only imported files are
// embedded), so this constant is the version the build ships.
export const VERSION = "0.0.0"
