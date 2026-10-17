// The per-file withDir wrapper factory (plans/0102 stage C, tests-2): the
// seven copies across the suite differed only in how the temp directory is
// made — a mkdtemp prefix string, or a zero-argument maker (close.test.ts's
// freshRepo flavor) — while the body was always the same try/finally with a
// recursive rmSync. Import as `const withDir = withDirFactory("auto-plan-")`
// (or `withDirFactory(() => freshRepo())`) and wrap test bodies unchanged;
// the tmpdir prefix string stays each file's own (it names the suite in
// /tmp when a test crashes mid-run).

import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// A mkdtemp prefix under the system tmpdir, or a maker returning the
// directory (string or promise of one) the wrapper runs fn in.
export type DirMaker = string | (() => string | Promise<string>)

export function withDirFactory(make: DirMaker) {
  return (fn: (dir: string) => Promise<void>) => async () => {
    const dir = typeof make === "string" ? mkdtempSync(join(tmpdir(), make)) : await make()
    try {
      await fn(dir)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
}
