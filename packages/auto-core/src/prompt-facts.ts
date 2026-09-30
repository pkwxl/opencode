// The render facts' composition helper (E2, plans/0061 §6.3): the PromptFacts
// value the prompt renderers draw everything run-level from — the prompt
// globals that were prompt.ts's module state before E2 (the active intent
// pack, the humanQuestions flag), the template library handle, the
// switch-derived ask tier, and the phase registry's implement entry the
// phase-less renders fall back to. The callers build the facts where they
// render (one build per render call); the pack loads with the target
// directory's overlay, the same load the run's preflight validated, so an
// invalid pack still throws there through its own facts build.
import { loadIntents, resolveIntent } from "./intent/load"
import { phaseType, REQUIRED_TYPE } from "./phases/registry"
import type { PromptFacts } from "./prompt"
import { autoSwitches } from "./switches"
import { promptTemplateNames } from "./template"

// dir selects the intent-pack overlay (the target directory's
// .opencode/auto/intents/; undefined = the built-ins alone, the module
// default before E2). humanQuestions carries plan's attended-human mode
// (Opts.humanQuestions / stopBefore === "execute"): the question-rule
// partial renders its human-answer branch.
// The structural input lets a caller pass its Opts directly.
export function promptFacts(input: { dir?: string; humanQuestions?: boolean } = {}): PromptFacts {
  return {
    pack: resolveIntent(loadIntents(input.dir)),
    humanQuestions: Boolean(input.humanQuestions),
    templateNames: promptTemplateNames(),
    ask: autoSwitches().ask,
    implementPhase: phaseType(REQUIRED_TYPE)!,
  }
}
