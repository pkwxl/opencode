// Contract surface for claude (MA.5, plans/0041 §4; root plan open question
// 7). The adapter once translated two host surfaces at every process start —
// the opencode-shaped agent contract `.opencode/agent/<name>.md` (as claude's
// --append-system-prompt) and the target's `opencode.json` permission rules
// (as --settings) — both gone with plans/0296: the host's configuration is
// never the tool's, read nowhere, translated nowhere. What remains is the
// fixed process posture:
//
// | --permission preset (MA.4)        | allow → --permission-mode bypassPermissions; |
// |                                   | deny / block → --permission-prompts none     |
// | question tool                     | AskUserQuestion disallowed (capability off)  |
// | AGENTS.md                         | read natively (built-in AGENTS.md support)   |
import type { PermissionPreset } from "../types"

// The process arguments of a start. Pure derivation from the preset — the
// target directory contributes nothing (a permission posture a project wants
// lives in the claimant host's own configuration, the person's affair).
export async function contractArgs(preset: PermissionPreset): Promise<{ args: string[] } | { error: string }> {
  const args: string[] = ["--disallowed-tools", "AskUserQuestion"]
  if (preset === "allow") args.push("--permission-mode", "bypassPermissions")
  else args.push("--permission-prompts", "none")
  return { args }
}
