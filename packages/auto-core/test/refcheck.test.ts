import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  activeDocs,
  autoCorrectRefs,
  extractRefs,
  formatRefGap,
  gitAvailable,
  renamePairs,
  rewriteRefs,
  scanRefs,
  taskRefFindings,
  validateRefs,
} from "../src/refcheck"

describe("extractRefs", () => {
  test("反引号 span 与 md 链接均提取;非路径 token 忽略", () => {
    const text = ["详见 `docs/T-001/subtasks.md` 与 [收尾报告](docs/T-001/report.md)。", "普通词 `hello` 与 `word` 不算引用。"].join("\n")
    expect(extractRefs(text)).toEqual([
      { path: "docs/T-001/subtasks.md", at: 1 },
      { path: "docs/T-001/report.md", at: 1 },
    ])
  })

  test(":行号 尾锚剥离为 line", () => {
    const text = "见 `docs/T-001/context.md:42` 的说明。"
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", line: 42, at: 1 }])
  })

  test("含空白的 token 忽略", () => {
    expect(extractRefs("见 `docs / T-001.md`")).toEqual([])
  })

  test("围栏内的行豁免", () => {
    const text = ["```", "cat docs/T-001.context.md", "```", "见 `docs/T-001/context.md`。"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", at: 4 }])
  })

  test("标记行豁免(已删除|已归档|历史)", () => {
    const text = ["旧路径 `docs/T-001.context.md` 已删除。", "`docs/T-002.audit.md` 是历史产物。", "现行 `docs/T-002/audit.md`。"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-002/audit.md", at: 3 }])
  })

  test("同 token 一行多次出现只取一次;at 为 1 起行号", () => {
    const text = ["x", "`docs/T-001.md` 与 `docs/T-001.md`"].join("\n")
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001.md", at: 2 }])
  })
})

describe("rewriteRefs", () => {
  const pair = { old: "docs/T-1.md", new: "docs/T-1/report.md" }

  test("词边界命中并计数", () => {
    const { text, count } = rewriteRefs("先读 `docs/T-1.md`,再读 [x](docs/T-1.md)。", [pair])
    expect(text).toBe("先读 `docs/T-1/report.md`,再读 [x](docs/T-1/report.md)。")
    expect(count).toBe(2)
  })

  test("不误配前缀(docs/T-1.md ≠ docs/T-11.md / docs/T-1.md.bak)", () => {
    const { text, count } = rewriteRefs("`docs/T-11.md` 与 `docs/T-1.md.bak`", [pair])
    expect(text).toBe("`docs/T-11.md` 与 `docs/T-1.md.bak`")
    expect(count).toBe(0)
  })

  test("围栏与标记行豁免", () => {
    const text = ["```", "docs/T-1.md", "```", "`docs/T-1.md` 已归档。", "`docs/T-1.md`"].join("\n")
    const result = rewriteRefs(text, [pair])
    expect(result.text).toBe(["```", "docs/T-1.md", "```", "`docs/T-1.md` 已归档。", "`docs/T-1/report.md`"].join("\n"))
    expect(result.count).toBe(1)
  })

  test("多 pair 依次应用", () => {
    const { text, count } = rewriteRefs("`docs/final/audit-r1.md` 和 `docs/final-audit.md`", [
      { old: "docs/final/audit-r1.md", new: "docs/T-F1/audit-r1.md" },
      { old: "docs/final-audit.md", new: "docs/T-F1/final-audit.md" },
    ])
    expect(text).toBe("`docs/T-F1/audit-r1.md` 和 `docs/T-F1/final-audit.md`")
    expect(count).toBe(2)
  })

  test("正则元字符路径安全转义", () => {
    const { text, count } = rewriteRefs("`docs/a+b.md`", [{ old: "docs/a+b.md", new: "docs/a+b/x.md" }])
    expect(text).toBe("`docs/a+b/x.md`")
    expect(count).toBe(1)
  })
})

async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  return dir
}

describe("activeDocs / validateRefs / scanRefs", () => {
  test("活文档枚举: docs/**/*.md,排除 docs/phases/**,排序输出", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await mkdir(join(dir, "docs/phases/a-analysis"), { recursive: true })
      await Bun.write(join(dir, "docs/T-002/S01/index.md"), "x")
      await Bun.write(join(dir, "docs/T-002/report.md"), "x")
      await Bun.write(join(dir, "docs/phases/a-analysis/PLAN.md"), "x")
      await Bun.write(join(dir, "docs/phases.md"), "台账(docs/phases.md 属活文档,仅 docs/phases/ 目录排除)")
      expect(await activeDocs(dir)).toEqual(["docs/T-002/S01/index.md", "docs/T-002/report.md", "docs/phases.md"])
      expect(await activeDocs(dir)).toEqual((await activeDocs(dir)).slice().sort())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: 存在性 + 行号 ≤ 总行数;目录引用只查存在性", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), "a\nb\n")
      const refs = extractRefs("`docs/T-001/context.md`、`docs/T-001/context.md:2`、`docs/T-001/context.md:9`、`docs/T-001`、`docs/T-999/x.md`")
      expect(await validateRefs(dir, refs)).toEqual(
        new Map([
          ["docs/T-001/context.md", "beyond-eof"],
          ["docs/T-999/x.md", "missing"],
        ]),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scanRefs: 失效引用产出 findings(含位置与原文);豁免形态不报告", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "src/mod.ts"), "code\n")
      await Bun.write(
        join(dir, "docs/T-001/report.md"),
        [
          "正常引用 `docs/T-001/context.md`(缺失,missing)。",
          "行号越界 `src/mod.ts:99`。",
          "豁免: `docs/gone.md` 已删除,`docs/old.md` 是历史路径。",
          "```",
          "围栏内 `docs/gone-fenced.md` 不检查。",
          "```",
          "形态之外: `https://example.com/x`、`/abs/path`、`v1.2`、`./rel.md` 不校验。",
        ].join("\n"),
      )
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "正常引用 `docs/T-001/context.md`(缺失,missing)。", path: "docs/T-001/context.md", problem: "missing" },
        { file: "docs/T-001/report.md", line: 2, text: "行号越界 `src/mod.ts:99`。", path: "src/mod.ts", problem: "beyond-eof" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("md 链接的 #fragment 剥离后按路径校验", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/target.md"), "x\n")
      await Bun.write(join(dir, "docs/live.md"), "见 [目标](docs/target.md#section)。见 [断链](docs/dead.md#section)。")
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/live.md", line: 1, text: "见 [目标](docs/target.md#section)。见 [断链](docs/dead.md#section)。", path: "docs/dead.md#section", problem: "missing" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("gitAvailable: 非 git 目录 false;taskRefFindings: 范围限定 docs/T-<id>/**,formatRefGap 组装差距文案", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      expect(await gitAvailable(dir)).toBe(false)
      await Bun.write(join(dir, "docs/T-001/report.md"), "失效 `docs/gone.md`。")
      await Bun.write(join(dir, "docs/T-002/report.md"), "同样失效 `docs/gone.md`。")
      const findings = await taskRefFindings(dir, "T-001")
      expect(findings).toHaveLength(1)
      expect(findings[0]).toMatchObject({ file: "docs/T-001/report.md", path: "docs/gone.md", problem: "missing" })
      const gap = formatRefGap(findings)!
      expect(gap).toContain("任务产物文档存在失效引用")
      expect(gap).toContain("- docs/T-001/report.md:1 → docs/gone.md(路径不存在)")
      expect(gap).toContain("修复要求")
      expect(formatRefGap([])).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("renamePairs / autoCorrectRefs", () => {
  test("renamePairs: 未跟踪新路径暂存后参与配对,输出目标目录相对路径", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "code")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 纯 mv(不暂存)后配对仍成立: renamePairs 自行 git add -A
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      expect(await renamePairs(dir)).toEqual([{ old: "src/old.ts", new: "src/new.ts" }])
      // 无 rename 改动 → 空配对
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "rename")
      expect(await renamePairs(dir)).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("autoCorrectRefs: rename 配对机械改写活文档引用;删除类产出 findings(不自动改)", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "src/old.ts"), "l1\nl2\nl3\n")
      await Bun.write(join(dir, "docs/dead.ts"), "gone")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/old.ts:3` 与 `docs/dead.ts`。")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      await Bun.spawn(["mv", join(dir, "src/old.ts"), join(dir, "src/new.ts")]).exited
      await rm(join(dir, "docs/dead.ts"))
      const findings = await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("见 `src/new.ts:3` 与 `docs/dead.ts`。")
      expect(findings).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "见 `src/new.ts:3` 与 `docs/dead.ts`。", path: "docs/dead.ts", problem: "missing" },
      ])
      // 幂等: 再跑一次无 rename、findings 不变,文档不再变化
      await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("见 `src/new.ts:3` 与 `docs/dead.ts`。")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("非 git 目录: renamePairs/autoCorrectRefs 空转不报错(validate 仍可跑)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/live.md"), "引用 `docs/gone.md`。")
      expect(await renamePairs(dir)).toEqual([])
      const findings = await autoCorrectRefs(dir)
      expect(findings).toHaveLength(1)
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe("引用 `docs/gone.md`。")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
