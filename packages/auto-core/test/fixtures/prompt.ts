// prompt 系单测的共享夹具: 示例计划 plan/task、带检查项的 listPlan/listTask、台账条目工厂 resolveItem、
// migrate 模式。拆分自 test/prompt.test.ts(plans/0024-module-split-plan.md S19,纯搬运);
// 放 fixtures/ 子目录——bun test 只收 *.test.ts,本文件不会被当测试跑。

import { loadModes } from "../../src/mode"
import { parse } from "../../src/plan"
import type { ResolveItem } from "../../src/resolve"

export const plan = parse(
  "PLAN.md",
  `## T-001: 搭建 schema [done]
建模。

## T-002: 实现迁移 [blocked]
  - verify: command: bun test
  - question: "策略选 A 还是 B?"
  - answer: "选 A"
  - attempts: 1
编写迁移脚本。

## T-003: 编写 API [pending]
  - verify: API 返回 200
REST 接口。
`,
)

export const task = plan.tasks[1]!

// 带检查项的任务(fork 流水线子任务列表注入的载体): 首项已勾选模拟恢复场景。
export const listPlan = parse(
  "PLAN.md",
  `## T-004: 拆解执行 [pending]
整体描述。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档
`,
)
export const listTask = listPlan.tasks[0]!

// L1 接地夹具(session-boundary-hardening 设计 §4.1): 前序任务 T-001 已 done 且其子任务
// 全勾(复现 kernel-dm T-068 事故「前任务 S01–S10 全勾被误读」的撞名形态),当前任务
// T-002 进行中、子任务全未勾——接地块/全限定编号的断言以此为准。
export const groundPlan = parse(
  "PLAN.md",
  `## T-001: 前序任务 [done]
描述。

- [x] 前序子任务一
- [x] 前序子任务二

## T-002: 本任务 [in_progress]
描述。

- [ ] 本任务子任务一
- [ ] 本任务子任务二
- [ ] 本任务子任务三
`,
)
export const groundTask = groundPlan.tasks[1]!

// 台账条目工厂(收尾闭环 H7 的清单入参): 缺省造一条 driver 源、未配对的代答。
export function resolveItem(question: string): ResolveItem {
  return { at: 0, task: task.id, phase: "m", round: 1, source: "driver", question }
}

export const migrate = loadModes().migrate!
