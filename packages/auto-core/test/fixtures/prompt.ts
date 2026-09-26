// Shared fixture for the prompt-family tests: the sample plan/task, the
// checklist-carrying listPlan/listTask, the proxy-answer entry factory
// resolveItem, the migrate mode. Split out of test/prompt.test.ts
// (plans/0024-module-split-plan.md S19, pure move); lives in fixtures/ —
// bun test only picks up *.test.ts, so this file is never run as a test.

import { loadModes } from "../../src/mode"
import { planOf } from "./units"
import type { ResolveItem } from "../../src/resolve"

export const plan = planOf(
  `## T-001: build the schema [done]
Modeling.

## T-002: implement the migration [blocked]
  - verify: command: bun test
  - question: "strategy A or B?"
  - answer: "A"
  - attempts: 1
Write the migration script.

## T-003: write the API [pending]
  - verify: API returns 200
REST endpoints.
`,
)

export const task = plan.tasks[1]!

// A checklist-carrying task (the carrier the fork pipeline injects the
// subtask list into): the first item is ticked to mimic a resume scenario.
export const listPlan = planOf(
  `## T-004: forked execution [pending]
Whole-task description.

- [x] write the schema part
- [ ] write the execution logic
- [ ] write the docs
`,
)
export const listTask = listPlan.tasks[0]!

// L1 grounding fixture (session-boundary-hardening design §4.1): the
// preceding task T-001 is done with all its subtasks ticked (reproducing the
// name-collision shape of the kernel-dm T-068 incident "T-068.S01–S10 all
// ticked was misread"), the current task T-002 is in progress with all its
// subtasks unticked — the grounding-block / qualified-id assertions read
// this.
export const groundPlan = planOf(
  `## T-001: preceding task [done]
Description.

- [x] preceding subtask one
- [x] preceding subtask two

## T-002: current task [in_progress]
Description.

- [ ] current subtask one
- [ ] current subtask two
- [ ] current subtask three
`,
)
export const groundTask = groundPlan.tasks[1]!

// Proxy-answer entry factory (the wrap-up close-loop H7 list input): by
// default builds one driver-sourced, unpaired proxy answer.
export function resolveItem(question: string): ResolveItem {
  return { at: 0, task: task.id, phase: "m", round: 1, source: "driver", question }
}

export const migrate = loadModes().migrate!
