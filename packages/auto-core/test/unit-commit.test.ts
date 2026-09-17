// src/unit-commit.ts 的单测: refcheck 挂点门禁(gatedAutoCorrectRefs/gatedTaskRefGap)与 afterSession 完成条件门禁。
// 拆分自 test/runner.test.ts(docs/module-split-plan.md S18,纯搬运)。

import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { commitTree, unitBaseline } from "../src/git"
import { recallHandover, saveHandover } from "../src/handover"
import { afterSession, gatedAutoCorrectRefs, gatedTaskRefGap, rollbackUnitState } from "../src/unit-commit"
import { git, freshRepo, task } from "./fixtures/runner"

// ---- refcheck 挂点门禁(refcheck-scope-design D3,OPENCODE_AUTO_REF_CHECK 缺省 off)----

describe("gatedAutoCorrectRefs / gatedTaskRefGap(OPENCODE_AUTO_REF_CHECK 挂点门禁)", () => {
  test("off(缺省): 提交前 auto-correct 与 verify 门禁预扫空转,目标目录零引用检查行为", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 提交前发生移动(rename 配对可得),但 off 时不得改写
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      const before = await Bun.file(join(dir, "docs/T-001/report.md")).text()
      await gatedAutoCorrectRefs(dir, false)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(before)
      // 不扫失效引用、不产生失效清单
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
      // verify 门禁预扫空转: 无差距(门禁不存在)
      expect(await gatedTaskRefGap(dir, "T-001", false)).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("on: auto-correct 按 rename 配对改写并落失效清单;verify 门禁产出差距文案", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts` 与 `docs/gone.md`。\n")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      await gatedAutoCorrectRefs(dir, true)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("见 `src/new.ts` 与 `docs/gone.md`。\n")
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(true)
      const gap = await gatedTaskRefGap(dir, "T-001", true)
      expect(gap).toContain("任务产物文档存在失效引用")
      expect(gap).toContain("docs/gone.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("afterSession 完成条件门禁(commit-boundary-design.md)", () => {
  test("提交失败(pre-commit 拒绝)→ failed 带问题文本;门禁关闭(--commit false)→ ok", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-after-gate-"))
    try {
      await Bun.spawn(["git", "-C", dir, "init", "-q"]).exited
      await mkdir(join(dir, "hooks"))
      await writeFile(join(dir, "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 })
      await Bun.spawn(["git", "-C", dir, "config", "core.hooksPath", "hooks"]).exited
      await writeFile(join(dir, "a.txt"), "a")
      const failed = await afterSession(dir, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(failed.type).toBe("failed")
      if (failed.type === "failed") expect(failed.question).toContain("统一提交失败")
      const off = await afterSession(dir, { commit: false }, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(off).toEqual({ type: "ok" })
      const none = await afterSession(undefined, {}, { id: "T-001", title: "示例" }, { stage: "execute", subject: "T-001 执行" })
      expect(none).toEqual({ type: "ok" })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

// ---- rollbackUnitState(单元回滚编排)----

describe("rollbackUnitState(单元回滚编排)", () => {
  test("回滚成功即在途测试交接记录一并作废(.auto/handover.json 删除)", async () => {
    const dir = await freshRepo()
    try {
      await writeFile(join(dir, "seed.txt"), "s")
      await commitTree(dir, task, { stage: "execute", subject: "T-001: 基线前提交" })
      const baseline = await unitBaseline(dir)
      await writeFile(join(dir, "wip.txt"), "半截工作")
      // 在途记录: 定版后收尾途中(带待跑脚本与定版锚点)。
      await saveHandover(dir, {
        task: "T-001",
        scope: "docs/T-001/testhandoff.md",
        unit: "execute",
        n: 1,
        script: join(dir, "test", "t.sh"),
        pinSession: "ses_pin",
      })
      const done = await rollbackUnitState(dir, task, "执行会话", baseline!)
      expect(done.type).toBe("ok")
      // 记录指向的定版提交与锚点属被收回的单元,不删会让重做被恢复状态机接回
      // 「继续被丢弃的交接」。
      expect(await recallHandover(dir, "T-001", "docs/T-001/testhandoff.md")).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
