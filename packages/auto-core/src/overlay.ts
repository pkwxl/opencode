// The overlay-directory loader the mode and intent-pack registries share:
// the .opencode/auto/<sub>/<name>.md files of a target directory — read,
// sorted, .md-filtered, with the shared name grammar (a lowercase letter,
// then letters/digits/hyphens) enforced once. A missing or non-directory
// overlay is the empty overlay (the built-ins alone); any other read error
// rethrows. The callers parse each file with their own section protocol.
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

// Name constraint shared by every overlay surface (mode files, intent
// packs): lowercase letter followed by letters/digits/hyphens — the same
// rule as the CLI value.
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

// One overlay file: its overlay key (the file name without .md) and its
// text. `sub` is the overlay's directory under .opencode/auto/ ("modes",
// "intents"); `kind` names the file class in the name-grammar error ("mode"
// / "intent pack").
export function overlayMarkdownFiles(dir: string, sub: string, kind: string): { name: string; text: string }[] {
  const overlayDir = join(dir, ".opencode", "auto", sub)
  let files: string[] = []
  try {
    files = readdirSync(overlayDir)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }
  const loaded: { name: string; text: string }[] = []
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`${kind} file name ${join(".opencode", "auto", sub, file)} is invalid: must be a lowercase letter followed by letters/digits/hyphens`)
    }
    loaded.push({ name, text: readFileSync(join(overlayDir, file), "utf8") })
  }
  return loaded
}
