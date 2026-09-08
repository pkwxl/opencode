import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkPrinciple } from "../src/check"
import { ensurePointer } from "../src/loop"
import { parseSwitches, SWITCH_ENV } from "../src/switches"

// refcheck 开关(refcheck-scope-design D3): 引用检查挂点测试在注入 on 的开关下
// 运行(parseSwitches 纯函数注入,不经环境变量 memo)。
const REFCHECK_ON = parseSwitches({ [SWITCH_ENV.refCheck]: "on" })

describe("checkPrinciple", () => {
  test("verify 启用: 标记要求会话亲自运行验证/执行提交的描述,放行合规语句", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ verify: true }))
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 正常任务 [pending]",
          "  - verify: command: bun test",
          "实现功能并自行编写单元测试。",
          "该执行权原则经 init 下沉到 AGENTS.md 验证原则块。",
          "中断后不再复跑 verify 命令,由 driver 重新执行。",
          "",
          "## T-002: 违规任务 [pending]",
          "  - verify: 验收标准描述",
          "完成后运行验收命令确认全部通过。",
          "请执行 verify 脚本并把结果贴在报告里。",
          "run the verification suite to accept the task.",
          "不要运行任务级 verify(验收由 driver 负责)。",
          "",
        ].join("\n"),
      )
      await Bun.write(
        join(dir, "AGENTS.md"),
        ["# AGENTS.md", "", "会话结束时执行验证脚本并记录退出码。", "driver 在会话外执行 verify 脚本,会话不得执行。", ""].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      // 四处违规: AGENTS 执行验证脚本 1 处 + PLAN 运行验收命令 / 执行 verify 脚本 /
      // run the verification 各 1 处
      expect(findings.length).toBe(4)
      expect(findings[0]).toMatchObject({ file: "AGENTS.md", line: 3, text: "会话结束时执行验证脚本并记录退出码。" })
      expect(findings[1]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 11, text: "完成后运行验收命令确认全部通过。" })
      expect(findings[2]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 12 })
      expect(findings[3]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 13 })
      // verify 字段行、否定句、driver 归属句均不计;缺验证/提交原则块与引用规范块给出提示
      expect(notes).toEqual([
        `AGENTS.md 缺少验证原则块,运行 opencode-auto init 可补写`,
        `AGENTS.md 缺少提交原则块,运行 opencode-auto init 可补写`,
        `AGENTS.md 缺少引用规范块,运行 opencode-auto init 可补写`,
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("testByDriver 启用: 标记要求会话亲自运行编译/测试/构建/lint 的描述,未启用时不检查", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ testByDriver: true }))
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 正常任务 [pending]",
          "实现功能并自行编写单元测试。",
          "测试脚本放 test/ 目录,脚本路径写入 tmp/test.sh,由 driver 执行。",
          "",
          "## T-002: 违规任务 [pending]",
          "完成后运行单元测试确认全部通过。",
          "请执行编译确认无类型错误。",
          "run the tests before finishing.",
          "",
        ].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      // 三处违规: 运行单元测试 / 执行编译 / run the tests 各 1 处
      expect(findings.length).toBe(3)
      expect(findings[0]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 8 })
      expect(findings[1]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 9 })
      expect(findings[2]).toMatchObject({ file: "PLAN.md", task: "T-002", line: 10 })
      // 编写(非执行动词)与 driver 归属句不计;缺测试执行原则块给出提示(引用规范块随文件缺失一并列入补写清单)
      expect(notes).toEqual([
        `AGENTS.md 不存在,可运行 opencode-auto init ${dir} 补写指针块、测试执行原则块、提交原则块、引用规范块`,
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("verify 未启用: 验证类描述不算违背,也不提示补写验证原则块", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 任务 [pending]",
          "完成后运行验收命令确认全部通过。",
          "请执行 verify 脚本并把结果贴在报告里。",
          "",
        ].join("\n"),
      )
      await Bun.write(
        join(dir, "AGENTS.md"),
        ["# AGENTS.md", "", "会话结束时执行验证脚本并记录退出码。", ""].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      // 验证原则块提示随 verify 关闭;提交原则块与引用规范块提示保留
      expect(notes).toEqual([`AGENTS.md 缺少提交原则块,运行 opencode-auto init 可补写`, `AGENTS.md 缺少引用规范块,运行 opencode-auto init 可补写`])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("配置非法: 按未启用处理并给出提示,提交原则照常检查", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({ idleTime: 999 }))
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n完成后 git commit -m 完成。\n")
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings.length).toBe(1)
      expect(notes[0]).toContain("项目配置(.opencode/auto/config.json)非法,验证/测试原则检查按未启用处理")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("标记要求会话执行 git 提交的描述,放行否定句与 driver 归属句", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(
        join(dir, "PLAN.md"),
        [
          "# 计划",
          "",
          "## T-001: 违规任务 [pending]",
          "完成后 git add -A 并 git commit -m 完成。",
          "每完成一个模块提交全部未提交改动。",
          "不要执行 git commit,统一提交由 driver 负责。",
          "提交信息遵循仓库现有风格。",
          "",
        ].join("\n"),
      )
      const { findings } = await checkPrinciple(dir)
      expect(findings.length).toBe(2)
      expect(findings[0]).toMatchObject({ file: "PLAN.md", task: "T-001", line: 4 })
      expect(findings[1]).toMatchObject({ file: "PLAN.md", task: "T-001", line: 5 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("AGENTS.md 的 opencode-auto 块整体跳过;init 补写后无提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n  - verify: command: bun test\n实现功能。\n")
      const before = await checkPrinciple(dir)
      expect(before.findings).toEqual([])
      expect(before.notes.length).toBe(1)
      // init 补写指针块、验证/测试/提交原则块、维护规则块与引用规范块后,块内的 driver 执行表述不再触发提示
      const ensured = await ensurePointer(dir, { verify: true, testByDriver: true })
      expect(ensured).toEqual({ pointer: true, principle: true, principleRemoved: false, test: true, testRemoved: false, commit: true, maint: true, refs: true })
      const after = await checkPrinciple(dir)
      expect(after.findings).toEqual([])
      expect(after.notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("verify 未启用: ensurePointer 不补写验证原则块,已存在的移除且前后文完好", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const block = "<!-- opencode-auto:verify:start -->\n验证原则: 验证由 driver 执行。\n<!-- opencode-auto:verify:end -->"
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "AGENTS.md"), "# AGENTS.md\n\n项目自有内容。\n")
      const first = await ensurePointer(dir)
      expect(first.principle).toBe(false)
      expect(first.principleRemoved).toBe(false)
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).toContain("项目自有内容。")
      expect(written).not.toContain("opencode-auto:verify:start")
      expect(written).toContain("opencode-auto:commit:start")
      // 已存在的验证原则块: 再次 ensure(verify 关)整块移除,前后文与空行分隔保持
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\n前文。\n\n${block}\n\n后文。\n`)
      const second = await ensurePointer(dir)
      expect(second.principleRemoved).toBe(true)
      const cleaned = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(cleaned).not.toContain("opencode-auto:verify:start")
      expect(cleaned).toContain("前文。")
      expect(cleaned).toContain("后文。")
      expect(cleaned).not.toContain("验证由 driver 执行")
      expect(cleaned).toMatch(/前文。\n\n后文。/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("testByDriver 未启用: ensurePointer 不补写测试执行原则块,已存在的移除且前后文完好", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    const block = "<!-- opencode-auto:test:start -->\n测试执行原则: 编译/测试由 driver 执行。\n<!-- opencode-auto:test:end -->"
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "AGENTS.md"), "# AGENTS.md\n\n项目自有内容。\n")
      const first = await ensurePointer(dir)
      expect(first.test).toBe(false)
      expect(first.testRemoved).toBe(false)
      const written = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(written).not.toContain("opencode-auto:test:start")
      // testByDriver 启用时补写,再关闭时整块移除,前后文与空行分隔保持
      const enabled = await ensurePointer(dir, { testByDriver: true })
      expect(enabled.test).toBe(true)
      expect(await Bun.file(join(dir, "AGENTS.md")).text()).toContain("opencode-auto:test:start")
      await Bun.write(join(dir, "AGENTS.md"), `# AGENTS.md\n\n前文。\n\n${block}\n\n后文。\n`)
      const second = await ensurePointer(dir)
      expect(second.testRemoved).toBe(true)
      const cleaned = await Bun.file(join(dir, "AGENTS.md")).text()
      expect(cleaned).not.toContain("opencode-auto:test:start")
      expect(cleaned).toMatch(/前文。\n\n后文。/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("PLAN.md 缺失时给出提示", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(notes.length).toBe(2)
      expect(notes[0]).toContain("AGENTS.md 不存在")
      expect(notes[1]).toContain("未找到 PLAN.md")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("AGENTS.md 超过 150 行输出精简提示(note 不进 findings)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      const filler = Array.from({ length: 155 }, (_, i) => `规则条目 ${i + 1}: 与工作流相关的持久约定。`).join("\n")
      await Bun.write(
        join(dir, "AGENTS.md"),
        [
          "# AGENTS.md",
          "",
          "<!-- opencode-auto:start --><!-- opencode-auto:end -->",
          "<!-- opencode-auto:verify:start --><!-- opencode-auto:verify:end -->",
          "<!-- opencode-auto:commit:start --><!-- opencode-auto:commit:end -->",
          "<!-- opencode-auto:maint:start --><!-- opencode-auto:maint:end -->",
          "<!-- opencode-auto:refs:start --><!-- opencode-auto:refs:end -->",
          "",
          filler,
          "",
        ].join("\n"),
      )
      const { findings, notes } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      // 2 行标题 + 空行 + 5 个标记块行 + 空行 + 155 行规则 = 163 行
      expect(notes).toEqual([
        "AGENTS.md 当前 163 行,超过 150 行上限(维护规则块第 1 条),建议按规则精简并把细节路由到 docs/agents/",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("checkPrinciple 引用检查(stable-refs P4)", () => {
  test("活文档失效引用进 refs;非 git 目录给 auto-correct 不可用 note;phases 状态文件排除", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "引用 `src/gone.ts`。\n行内含 已删除 标记的 `docs/old.md` 豁免。\n")
      await Bun.write(join(dir, "docs/phases/a-analysis/PLAN.md"), "状态文件引用 `src/also-gone.ts` 不检查。\n")
      const { findings, notes, refs } = await checkPrinciple(dir, REFCHECK_ON)
      expect(findings).toEqual([])
      expect(refs).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "引用 `src/gone.ts`。", path: "src/gone.ts", problem: "missing" },
      ])
      expect(notes).toEqual([
        "AGENTS.md 不存在,可运行 opencode-auto init " + dir + " 补写指针块、提交原则块、引用规范块",
        "非 git 目标目录: 提交前引用 auto-correct(rename 改写)不可用,引用检查仅做校验",
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("行号超出总行数计 beyond-eof;docs/ 缺失时不扫描、无非 git note", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "src/mod.ts"), "l1\nl2\n")
      await Bun.write(join(dir, "docs/live.md"), "见 `src/mod.ts:99`。\n")
      const first = await checkPrinciple(dir, REFCHECK_ON)
      expect(first.refs).toEqual([{ file: "docs/live.md", line: 1, text: "见 `src/mod.ts:99`。", path: "src/mod.ts", problem: "beyond-eof" }])
      // docs 存在而非 git → 给 auto-correct 不可用 note
      expect(first.notes).toContain("非 git 目标目录: 提交前引用 auto-correct(rename 改写)不可用,引用检查仅做校验")
      // docs/ 移除后: 无 refs、无非 git note
      await rm(join(dir, "docs"), { recursive: true, force: true })
      const second = await checkPrinciple(dir, REFCHECK_ON)
      expect(second.refs).toEqual([])
      expect(second.notes.every((note) => !note.includes("非 git"))).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("git 仓库内不给非 git note;init 补写后引用规范块提示消失", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await mkdir(join(dir, ".opencode/auto"), { recursive: true })
      await Bun.write(join(dir, ".opencode/auto/config.json"), JSON.stringify({}))
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "AGENTS.md"), "# AGENTS.md\n")
      await Bun.write(join(dir, "docs/ok.md"), "引用 `PLAN.md`。\n")
      const proc = Bun.spawn(["git", "-C", dir, "init", "-q"], { stdout: "ignore", stderr: "ignore" })
      await proc.exited
      const before = await checkPrinciple(dir, REFCHECK_ON)
      expect(before.refs).toEqual([])
      expect(before.notes).toEqual(["AGENTS.md 缺少提交原则块,运行 opencode-auto init 可补写", "AGENTS.md 缺少引用规范块,运行 opencode-auto init 可补写"])
      await ensurePointer(dir)
      const after = await checkPrinciple(dir, REFCHECK_ON)
      expect(after.refs).toEqual([])
      expect(after.notes).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("缺省 off(refcheck-scope D3): 引用检查空转——refs 恒空、无非 git note、目标目录零改动", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-check-"))
    try {
      await Bun.write(join(dir, "PLAN.md"), "## T-001: 任务 [pending]\n实现功能。\n")
      await Bun.write(join(dir, "docs/live.md"), "引用 `docs/gone.md`。\n")
      const before = await Bun.file(join(dir, "docs/live.md")).text()
      // 缺省开关(autoSwitches 读 process.env,测试环境未设 → refCheck=off)
      const { findings, notes, refs } = await checkPrinciple(dir)
      expect(findings).toEqual([])
      expect(refs).toEqual([])
      expect(notes.every((note) => !note.includes("非 git"))).toBe(true)
      // 零引用检查行为: 文档原样、不产生失效清单
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe(before)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
