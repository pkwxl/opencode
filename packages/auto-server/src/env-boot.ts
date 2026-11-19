// The daemon's environment, pinned (plans/0265 — 0264-01's fix). The
// confinement launcher reads the daemon's own environment as the carrier of
// everything a spawned run needs (the serve banner's own line; plans/0162
// D4), and that carrier was pure inheritance: every restart re-derived it
// from the launching shell's memory, and each lost name surfaced one blocked
// run at a time (the adoption site's measured evening — the model keys
// first, then the divergence seat's PATH entry, each costing a person-
// bracketed advance). Three additive acts here, every one names never values
// (the security family's display rule — a name is displayable, a value
// never):
//
//   serve --env-file <path>   the durable declaration: NAME=VALUE lines
//                             loaded into the daemon's environment at boot,
//                             the file's names winning over the inherited
//                             shell's
//   the boot manifest         the effective environment's names (presence
//                             only, the spawn filter's own set — the
//                             OPENCODE_AUTO_* switch layer never reaches a
//                             child) written to <data-dir>/env-manifest.json
//                             at every start
//   the boot self-check       the previous manifest's names against the
//                             current environment (the carrier's losses one
//                             warning line), and the tool's own references
//                             resolved at boot — the model registry checked
//                             through the core's checkModelReferences, the
//                             same wording a worker's run surfaces, hours
//                             earlier instead of one blocked run later
//
// The check's boundary (P16, the finding's own letter): the tool resolves
// the references it owns — the registry's env/file keys. The site's seat
// names ride the site's own declared surfaces; nothing here knows them.
import { checkModelReferences, loadModels, ModelRegistryError } from "@opencode-ai/auto-core/models"
import { BUILTIN_PHASE_TYPES } from "@opencode-ai/auto-core/phases/registry"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

export const MANIFEST_NAME = "env-manifest.json"

// The manifest's grammar: v 1, the boot instant, the sorted names the
// spawned children would receive. Presence only — readable state, never a
// secret store.
export type EnvManifest = { v: 1; at: string; names: string[] }

export function manifestOf(env: Record<string, string | undefined>, at = new Date()): EnvManifest {
  return {
    v: 1,
    at: at.toISOString(),
    names: Object.keys(env).filter((name) => !name.startsWith("OPENCODE_AUTO_")).sort(),
  }
}

// NAME=VALUE declarations, one per line: '#' comments and blank lines aside,
// everything else must be a NAME=VALUE pair (the value may be empty and may
// itself contain '='; surrounding whitespace around the '=' is trimmed; the
// name may not be empty or carry internal whitespace). Values are otherwise
// literal bytes — no quoting, no interpolation (the file is declarations,
// not a script); a later duplicate wins. The refusal names the line NUMBER
// only, never the line's bytes — a value may be a secret.
export function parseEnvFile(text: string): Record<string, string> {
  const parsed: Record<string, string> = {}
  const lines = text.split("\n")
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    const name = eq < 0 ? "" : line.slice(0, eq).trim()
    if (eq < 0 || !name || /\s/.test(name)) {
      throw new Error(`line ${index + 1} is not a NAME=VALUE declaration`)
    }
    parsed[name] = line.slice(eq + 1).trim()
  }
  return parsed
}

// The boot report: the lost-names diff and the reference check, the lines
// the serve entry prints after its banner (and a test asserts directly);
// also writes the manifest for the NEXT boot. Never throws — a boot report
// that crashed the daemon would be the cure killing the patient; every
// failure is a warning line of its own (P12: surfaced, never swallowed).
export async function environmentBootReport(
  dataDir: string,
  env: Record<string, string | undefined> = process.env,
): Promise<string[]> {
  const warnings: string[] = []
  const path = join(dataDir, MANIFEST_NAME)
  let previous: EnvManifest | undefined
  try {
    const read = JSON.parse(await readFile(path, "utf8")) as EnvManifest
    if (Array.isArray(read?.names)) previous = read
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== "ENOENT") {
      warnings.push(`⚠ environment: the previous boot's manifest could not be read (${code ?? String(error)}) — the lost-names diff is skipped, the manifest rewritten`)
    }
  }
  if (previous?.names.length) {
    const lost = previous.names.filter((name) => env[name] === undefined)
    if (lost.length) {
      warnings.push(
        `⚠ environment: ${lost.length} name${lost.length === 1 ? "" : "s"} the launcher's carrier held at the previous boot (${previous.at}) ${lost.length === 1 ? "is" : "are"} not set now: ${lost.join(", ")} — ` +
          `re-declare them (the launching shell, or serve --env-file) and restart, or the runs that need them block one at a time`,
      )
    }
  }
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, `${JSON.stringify(manifestOf(env))}\n`)
  } catch (error) {
    warnings.push(`⚠ environment: the boot manifest could not be written (${(error as NodeJS.ErrnoException).code ?? String(error)}) — the next boot's lost-names diff is skipped`)
  }
  // The tool's own references, at boot: the registry load is the core's one
  // grammar (P5 — no second registry reader), the operator layer located
  // through the same env injection the preload and the tests use; a broken
  // layer is a warning naming its first problem, never a daemon that will
  // not start (the runs surface the strict failure themselves).
  try {
    const registry = await loadModels(dataDir, { env, phaseTypes: BUILTIN_PHASE_TYPES.map((entry) => entry.type) })
    if (registry) {
      for (const problem of checkModelReferences(registry, env)) {
        warnings.push(`⚠ environment: ${problem.message} — unresolvable at boot (names are shown, never values)`)
      }
    }
  } catch (error) {
    const first = (error instanceof ModelRegistryError ? error.problems[0] : undefined) ?? String(error).split("\n")[0]
    warnings.push(`⚠ environment: the model registry could not be loaded at boot (${first}) — fix the named layer and restart`)
  }
  return warnings
}
