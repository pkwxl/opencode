// The model registry's shared read-side helpers — the half of the former
// `models` command's data module (plans/0055 §9) that live callers still
// hold: what the switches need to know about a loaded registry
// (switchModelRegistryInfo, the run start's parse) and the run start's
// refusal of a project layer the unified commit would commit
// (projectLayerRefusal, loop-preflight's shared check). The command's own
// surface — checkModels (the registry checks as data), describeModels (the
// effective table per phase type and routing role) and formatModels (the
// printed lines) — is gone with the models command itself (plans/0296, the
// opencode severance: the tool spawns no agent session, ever, so no fleet
// is described or probed); the exports below survive because the run start
// shares them.
//
// Nothing here reads a referenced value (C4). Keys and env references appear
// by reference name (`MOONSHOT_KEY_A`, `~/.secrets/zhipu-c`); a literal env
// value appears by its variable name alone.
import { fileTracked, gitIgnored } from "./git"
import { layerLabel, MODELS_FILE, projectLayerPath } from "./models"
import type { ModelRegistry } from "./models-schema"
import type { SwitchModelRegistry } from "./switches"

// What the switches need to know about a loaded registry (plans/0055 §9 R7):
// the internal names a bare OPENCODE_AUTO_MODEL value may take, and the tier
// lists as text for the OPENCODE_AUTO_MODEL_FALLBACK refusal that names them.
// Shared by the run start (which hands it to the switches through
// setSwitchModelRegistry). undefined is not
// a value here: a caller without a registry passes nothing and the switches
// keep their no-registry grammar.
export function switchModelRegistryInfo(registry: ModelRegistry): SwitchModelRegistry {
  const tiers = (["deep", "simple"] as const)
    .map((tier) => `${tier}: ${registry.tiers[tier]?.names.join(", ") ?? "(not declared)"}`)
    .join("; ")
  return { names: new Set(registry.models.keys()), tiers }
}

// The run start's refusal of a project layer that the unified commit would
// commit, or undefined. It is checked before the layer's content is read and
// does not depend on it. The entry is the operator's own since plans/0296
// (init writes none, fix carries no rule), so the remedy names the person's
// own .gitignore line; a tracked layer must be untracked first, since ignore
// rules skip tracked files. Outside a git work tree nothing commits the
// layer, so there is no refusal.
// AUTO-RESOLVE: when a project layer is both unignored and malformed, which refusal is shown? -> the ignore refusal, checked before the content is read (it does not depend on the content, and a layer the unified commit would take is refused even while it does not parse)
// AUTO-RESOLVE: a tracked project layer passes no ignore rule even with an operator's entry, and fix cannot untrack it: refuse it with a line of its own that names the untrack command and the operator's own ignore line (fix alone would leave the refusal in place)
export async function projectLayerRefusal(directory: string): Promise<string | undefined> {
  const project = projectLayerPath(directory)
  if (!(await Bun.file(project).exists()) || (await gitIgnored(directory, MODELS_FILE)) !== false) return undefined
  const label = layerLabel({ name: "project", path: project })
  const own = `add its line to .gitignore yourself (/${MODELS_FILE} — the entry is the operator's own, plans/0296)`
  return (await fileTracked(directory, MODELS_FILE))
    ? `${label}: git tracks it, so the unified commit would commit it; untrack it (git -C ${directory} rm --cached ${MODELS_FILE}), ${own}, then re-run`
    : `${label}: git does not ignore it, so the unified commit would commit it; ${own}, then re-run`
}
