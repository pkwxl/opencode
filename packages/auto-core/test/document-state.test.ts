// src/document/state.ts 子任务状态协议(M1.0)的单测:扫描三态(无状态文件=旧版路径/
// todo=待办/done=完成;激活后双文件或同缺=非法)、effectiveDone 双轨合并、改名幂等、
// 注入写定的跳过规则。

import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { effectiveDone, renameTodoToDone, scanSubtaskStates } from "../src/document/state"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "subtask-state-"))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function put(path: string, text = "x") {
  const abs = join(dir, path)
  await mkdir(abs.split("/").slice(0, -1).join("/"), { recursive: true })
  await Bun.write(abs, text)
}

describe("scanSubtaskStates", () => {
  test("无任何状态文件: active=false,沿用 PLAN.md 勾选(旧版产物)", async () => {
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(false)
    expect(result.illegal).toEqual([])
    expect(result.states).toEqual([
      { index: 1, todo: false, done: false },
      { index: 2, todo: false, done: false },
    ])
  })

  test("双文件并存: 非法 both", async () => {
    await put("docs/T-001/S01/todo.md")
    await put("docs/T-001/S01/done.md")
    const result = await scanSubtaskStates(dir, "T-001", 1)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([{ index: 1, kind: "both" }])
  })

  test("todo 与 done 皆缺(协议已被其他子任务激活): 非法 neither", async () => {
    await put("docs/T-001/S01/done.md")
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([{ index: 2, kind: "neither" }])
  })

  test("协议未激活时不判 neither(旧版产物全部无状态文件不属非法)", async () => {
    const result = await scanSubtaskStates(dir, "T-001", 3)
    expect(result.active).toBe(false)
    expect(result.illegal).toEqual([])
  })

  test("混合: todo 待办 / done 完成,合法", async () => {
    await put("docs/T-001/S01/done.md")
    await put("docs/T-001/S02/todo.md")
    const result = await scanSubtaskStates(dir, "T-001", 2)
    expect(result.active).toBe(true)
    expect(result.illegal).toEqual([])
    expect(result.states).toEqual([
      { index: 1, todo: false, done: true },
      { index: 2, todo: true, done: false },
    ])
  })
})

describe("effectiveDone", () => {
  const items = [{ done: true }, { done: false }, { done: true }]

  test("协议未激活: 沿用勾选轨", () => {
    const scan = { active: false, states: [], illegal: [] }
    expect(effectiveDone(scan, items)).toEqual([true, false, true])
  })

  test("协议激活: done.md 覆盖勾选;todo.md 压下勾选;同缺回落勾选", () => {
    const scan = {
      active: true,
      states: [
        { index: 1, todo: false, done: true },
        { index: 2, todo: true, done: false },
        { index: 3, todo: false, done: false },
      ],
      illegal: [{ index: 3, kind: "neither" as const }],
    }
    expect(effectiveDone(scan, items)).toEqual([true, false, true])
  })
})

describe("renameTodoToDone", () => {
  test("todo → done 改名,内容原样保留", async () => {
    await put("docs/T-001/S01/todo.md", "# S01\n")
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).text()).toBe("# S01\n")
    expect(await Bun.file(join(dir, "docs/T-001/S01/todo.md")).exists()).toBe(false)
  })

  test("幂等: done 已存在(改名与提交间中断后重入)静默跳过", async () => {
    await put("docs/T-001/S01/todo.md", "新\n")
    await put("docs/T-001/S01/done.md", "旧\n")
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).text()).toBe("旧\n")
  })

  test("协议未激活(无 todo.md): 静默跳过不报错", async () => {
    await renameTodoToDone(dir, "T-001", 1)
    expect(await Bun.file(join(dir, "docs/T-001/S01/done.md")).exists()).toBe(false)
  })
})
