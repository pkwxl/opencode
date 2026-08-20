import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { load } from "../src/plan"
import { runAll } from "../src/loop"

// Opt-in end-to-end test: requires `opencode` on PATH (or
// OPENCODE_AUTO_SERVER pointing at a running serve) plus provider credentials.
//   OPENCODE_AUTO_E2E=1 bun test test/e2e.test.ts
const E2E = process.env.OPENCODE_AUTO_E2E === "1"

const PLAN = `## T-001: 创建 hello.txt [pending]
  - verify: test -f hello.txt && grep -q hello hello.txt
在当前目录创建 hello.txt,内容为 "hello"。

## T-002: 请求写权限并写入 greeting.txt [pending]
  - verify: test -f greeting.txt
这个任务需要先获得用户授权。调用 question 工具询问用户:
"是否允许在 opencode.json 中放行 greeting.txt 的写权限?"
拿到肯定答复后把问候语 "hello" 写入 greeting.txt。

## T-003: 汇总 [pending]
  - verify: test -f SUMMARY.md
创建 SUMMARY.md,列出生成的文件。
`

test.skipIf(!E2E)(
  "端到端: 三任务计划,含一次阻塞与人工介入续跑",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-e2e-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), PLAN)
      await Bun.write(
        join(dir, "opencode.json"),
        await Bun.file(new URL("../templates/opencode.json", import.meta.url)).text(),
      )

      // 第一轮: T-001 完成,T-002 触发 question → 阻塞停机
      expect(await runAll(dir, {})).toBe(2)
      const blocked = await load(join(dir, "PLAN.md"))
      expect(blocked.tasks[0]!.status).toBe("done")
      expect(blocked.tasks[1]!.status).toBe("blocked")
      expect(blocked.tasks[1]!.question).toBeTruthy()

      // 模拟人工介入: 阻塞的问题是会话外事务,无需填写 answer,直接重启续跑
      // 第二轮: T-002 携带"问题已在会话外解决,不要重问"的提示续跑,T-003 完成,全部 done
      expect(await runAll(dir, {})).toBe(0)
      const done = await load(join(dir, "PLAN.md"))
      expect(done.tasks.every((t) => t.status === "done")).toBe(true)
      expect(await Bun.file(join(dir, "SUMMARY.md")).exists()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  },
  { timeout: 600_000 },
)
