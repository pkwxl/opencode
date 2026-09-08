import { describe, expect, test } from "bun:test"
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises"
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
  recordOnce,
  renameHistory,
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
    const text = "见 `docs/T-001/context.md:42`。"
    expect(extractRefs(text)).toEqual([{ path: "docs/T-001/context.md", line: 42, at: 1 }])
  })

  test(":N-M 区间尾锚剥离,line 取区间上界", () => {
    const text = "见 `kernel/comps/block/src/lib.rs:64-159`。"
    expect(extractRefs(text)).toEqual([{ path: "kernel/comps/block/src/lib.rs", line: 159, at: 1 }])
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

  test("改写不动排版: 仅命中 token 就地替换,行结构/空白/对齐/末尾换行原样保留", () => {
    const text = [
      "| 文档 | 说明 |",
      "| `docs/T-1.md` | 报告 |  ",
      "",
      "见 `docs/T-1.md`。",
      "```",
      "docs/T-1.md",
      "```",
      "末行无换行 `docs/T-1.md`",
    ].join("\n")
    const { text: out, count } = rewriteRefs(text, [pair])
    expect(count).toBe(3)
    // 逐行对比: 除命中 token 的就地替换外逐字节相同(行数不变、豁免行/空行/
    // 行尾空白原样;末行无换行状态保持——split/join 对称,不新增末尾换行)
    const before = text.split("\n")
    const after = out.split("\n")
    expect(after).toHaveLength(before.length)
    after.forEach((line, i) => {
      if (i === 1 || i === 3 || i === 7) expect(line).toBe(before[i]!.replaceAll(pair.old, pair.new))
      else expect(line).toBe(before[i])
    })
    // 无命中 → 输出与输入逐字节相同(调用方不写回,文件保持原样)
    expect(rewriteRefs(text, [{ old: "docs/gone.md", new: "docs/x.md" }]).text).toBe(text)
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

  test("validateRefs: 段边界后缀唯一匹配视为有效并消解(行号按匹配文件校验);多重匹配按缺失", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "pkg/src/mod.ts"), "a\nb\n")
      const refs = extractRefs("`src/mod.ts`、`src/mod.ts:2`、`src/mod.ts:9`、`src/gone.ts`")
      // 唯一命中 pkg/src/mod.ts → 有效;行号 9 超出其 2 行 → beyond-eof
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "beyond-eof"], ["src/gone.ts", "missing"]]))
      // 再添一份同后缀副本 → 语境歧义,按缺失
      await Bun.write(join(dir, "other/src/mod.ts"), "z")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "missing"], ["src/gone.ts", "missing"]]))
      // 直接命中优先于歧义: 根相对路径存在即有效(不再 missing);行号校验照常
      await Bun.write(join(dir, "src/mod.ts"), "a\nb\n")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["src/mod.ts", "beyond-eof"], ["src/gone.ts", "missing"]]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: 目录引用(尾缀 /)经后缀唯一匹配消解到目录;区间尾锚按上界校验行号", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "asterinas/kernel/comps/dm/lib.rs"), "a\nb\nc\n")
      const refs = extractRefs("`kernel/comps/dm/`、`kernel/comps/dm/lib.rs:1-2`、`kernel/comps/dm/lib.rs:1-9`")
      // 目录尾缀 / 消解到 asterinas/kernel/comps/dm → 有效;区间上界 9 超出 3 行 → beyond-eof
      expect(await validateRefs(dir, refs)).toEqual(new Map([["kernel/comps/dm/lib.rs", "beyond-eof"]]))
      // 再添一份同后缀目录副本 → 目录消解歧义,按缺失(文件引用仍唯一消解)
      await Bun.write(join(dir, "linux/kernel/comps/dm/x.rs"), "z")
      expect(await validateRefs(dir, refs)).toEqual(
        new Map([["kernel/comps/dm/", "missing"], ["kernel/comps/dm/lib.rs", "beyond-eof"]]),
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: 软链目录下钻参与后缀消解(参照源码树);循环软链不死循环", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "real/include/uapi/linux/dm.h"), "a\nb\n")
      await Bun.write(join(dir, "real/include/linux/kdev_t.h"), "x\n")
      await symlink(join(dir, "real"), join(dir, "linux"))
      // linux/include/linux/kdev_t.h 以树内相对写法 `include/linux/kdev_t.h` 唯一命中
      const refs = extractRefs("`include/linux/kdev_t.h`、`linux/dm.h:9`")
      expect(await validateRefs(dir, refs)).toEqual(new Map([["linux/dm.h", "beyond-eof"]]))
      // 循环软链(real/loop → linux → real)下钻有界,消解不受影响
      await symlink(join(dir, "linux"), join(dir, "real/loop"))
      expect(await validateRefs(dir, refs)).toEqual(new Map([["linux/dm.h", "beyond-eof"]]))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("validateRefs: 同一目标的带/不带尾杠两种写法共存消解(lookup 键归一不撞键)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "asterinas/kernel/core/comps/dm/lib.rs"), "x\n")
      const refs = extractRefs("`kernel/core/comps/dm/`、`kernel/core/comps/dm`")
      expect(await validateRefs(dir, refs)).toEqual(new Map())
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("scanRefs: 带上下文语境的相对引用经后缀唯一匹配消解(文档内同级路径)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    try {
      await Bun.write(join(dir, "docs/T-001/context.md"), "x\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "同级引用 `context.md` 与代码引用 `pkg/util.ts`。\n")
      await Bun.write(join(dir, "pkg/util.ts"), "code\n")
      expect(await scanRefs(dir)).toEqual([])
      // 唯一性破坏(另一任务也有 context.md)→ 恢复为 missing
      await Bun.write(join(dir, "docs/T-002/context.md"), "x\n")
      expect(await scanRefs(dir)).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: "同级引用 `context.md` 与代码引用 `pkg/util.ts`。", path: "context.md", problem: "missing" },
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("recordOnce: 新键 ⚠ 一次,已收录键静默;清单全量重写排序稳定,空 entries 删除文件", async () => {
    const dir = await mkdtemp(join(tmpdir(), "auto-refcheck-"))
    const warns: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => warns.push(args.map(String).join(" "))
    try {
      await recordOnce(dir, ".auto/reg.md", "# 清单\n", [
        { key: "b", warn: "乙" },
        { key: "a", warn: "甲" },
      ])
      expect(warns).toEqual(["  ⚠ 乙", "  ⚠ 甲"])
      expect(await Bun.file(join(dir, ".auto/reg.md")).text()).toBe("# 清单\n- a\n- b\n")
      // 复调: 已收录键 a 静默,新键 c 仍 ⚠;清单全量重写含三键
      warns.length = 0
      await recordOnce(dir, ".auto/reg.md", "# 清单\n", [
        { key: "a", warn: "甲" },
        { key: "c", warn: "丙" },
      ])
      expect(warns).toEqual(["  ⚠ 丙"])
      // 全量重写: 本轮未上报的 b 视为已修复,自动移除
      expect(await Bun.file(join(dir, ".auto/reg.md")).text()).toBe("# 清单\n- a\n- c\n")
      // 空 entries → 清单删除(修复后自动移除)
      await recordOnce(dir, ".auto/reg.md", "# 清单\n", [])
      expect(await Bun.file(join(dir, ".auto/reg.md")).exists()).toBe(false)
    } finally {
      console.log = original
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

  test("autoCorrectRefs: 失效清单 .auto/invalid-refs.md,仅对新出现引用 ⚠;修复后移除,复发再警告", async () => {
    const dir = await freshRepo()
    const seen: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => seen.push(args.join(" "))
    try {
      await Bun.write(join(dir, "docs/live.md"), "引用 `docs/gone.md` 与 `docs/lost.md`。")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 首轮: 两条新失效引用各警告一次,清单落盘(键排序,不含行号与原文)
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ 失效引用"))).toHaveLength(2)
      const list = await Bun.file(join(dir, ".auto/invalid-refs.md")).text()
      expect(list.split("\n").slice(1)).toEqual([
        "- docs/live.md → docs/gone.md(missing)",
        "- docs/live.md → docs/lost.md(missing)",
        "",
      ])
      // 次轮: 清单已收录,不再重复警告
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ 失效引用"))).toHaveLength(0)
      // 新增第三条 → 只警告新出现的
      await Bun.write(join(dir, "docs/live.md"), "引用 `docs/gone.md` 与 `docs/lost.md` 与 `docs/vanished.md`。")
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ 失效引用"))).toHaveLength(1)
      expect(seen.find((line) => line.includes("⚠ 失效引用"))).toContain("docs/vanished.md")
      // 全部修复 → 清单移除
      await Bun.write(join(dir, "docs/gone.md"), "x")
      await Bun.write(join(dir, "docs/lost.md"), "x")
      await Bun.write(join(dir, "docs/vanished.md"), "x")
      await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
      // 复发 → 视为新出现,重新警告
      await rm(join(dir, "docs/gone.md"))
      seen.length = 0
      await autoCorrectRefs(dir)
      expect(seen.filter((line) => line.includes("⚠ 失效引用"))).toHaveLength(1)
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe("缺失引用恢复(refcheck-scope P2,git 历史追踪)", () => {
  test("历史移动经 rename 地图链式解析就地恢复;落点已删除与纯删除保留入失效清单", async () => {
    const dir = await freshRepo()
    const seen: string[] = []
    const original = console.log
    console.log = (...args: unknown[]) => seen.push(args.join(" "))
    try {
      await Bun.write(join(dir, "src/chain-a.ts"), "c1\nc2\n")
      await Bun.write(join(dir, "src/victim.ts"), "v\n")
      await Bun.write(join(dir, "src/gone.ts"), "g\n")
      await Bun.write(join(dir, "docs/T-001/report.md"), "见 `src/chain-a.ts:2`、`src/victim.ts` 与 `src/gone.ts`。")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      // 历史移动(提交入历史): chain-a → chain-b → chain-c(链式);
      // victim → renamed 后落点再删除;gone 纯删除
      await git(dir, "mv", "src/chain-a.ts", "src/chain-b.ts")
      await git(dir, "commit", "-qm", "mv a->b")
      await git(dir, "mv", "src/chain-b.ts", "src/chain-c.ts")
      await git(dir, "mv", "src/victim.ts", "src/renamed.ts")
      await git(dir, "commit", "-qm", "mv b->c, victim->renamed")
      await rm(join(dir, "src/renamed.ts"))
      await rm(join(dir, "src/gone.ts"))
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "del renamed/gone")
      // rename 历史地图: 新→旧首现优先 + 链式解析到最终落点
      expect(await renameHistory(dir)).toEqual(
        new Map([
          ["src/chain-b.ts", "src/chain-c.ts"],
          ["src/victim.ts", "src/renamed.ts"],
          ["src/chain-a.ts", "src/chain-c.ts"],
        ]),
      )
      const findings = await autoCorrectRefs(dir)
      // chain-a 恢复到最终落点 chain-c(行号锚 :2 保留);victim 落点已删除、
      // gone 纯删除 → 不自动恢复,保留 finding
      const report = "见 `src/chain-c.ts:2`、`src/victim.ts` 与 `src/gone.ts`。"
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("缺失引用恢复"))).toHaveLength(1)
      expect(findings).toEqual([
        { file: "docs/T-001/report.md", line: 1, text: report, path: "src/victim.ts", problem: "missing" },
        { file: "docs/T-001/report.md", line: 1, text: report, path: "src/gone.ts", problem: "missing" },
      ])
      // 复扫后失效清单只登记未恢复项
      const list = await Bun.file(join(dir, ".auto/invalid-refs.md")).text()
      expect(list).toContain("- docs/T-001/report.md → src/victim.ts(missing)")
      expect(list).toContain("- docs/T-001/report.md → src/gone.ts(missing)")
      expect(list).not.toContain("chain-a")
      // 幂等: 再跑一次无恢复改写、文档不变、findings 与清单不变(未恢复项不重复 ⚠)
      seen.length = 0
      expect(await autoCorrectRefs(dir)).toEqual(findings)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe(report)
      expect(seen.filter((line) => line.includes("缺失引用恢复"))).toHaveLength(0)
      expect(seen.filter((line) => line.includes("⚠ 失效引用"))).toHaveLength(0)
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).text()).toBe(list)
    } finally {
      console.log = original
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("嵌套子仓库的历史移动同样参与恢复(路径换算目标目录相对)", async () => {
    const dir = await freshRepo()
    const sub = join(dir, "sub")
    try {
      await mkdir(sub, { recursive: true })
      await git(sub, "init", "-q")
      await git(sub, "config", "user.email", "t@t")
      await git(sub, "config", "user.name", "t")
      await Bun.write(join(sub, "lib/util.ts"), "u\n")
      await git(sub, "add", "-A")
      await git(sub, "commit", "-qm", "sub init")
      await Bun.write(join(dir, "docs/T-001/report.md"), "嵌套引用 `sub/lib/util.ts`。")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "outer init")
      // 子仓库内历史移动 util → helpers(外层引用随之失效)
      await git(sub, "mv", "lib/util.ts", "lib/helpers.ts")
      await git(sub, "commit", "-qm", "sub mv")
      const findings = await autoCorrectRefs(dir)
      expect(await Bun.file(join(dir, "docs/T-001/report.md")).text()).toBe("嵌套引用 `sub/lib/helpers.ts`。")
      expect(findings).toEqual([])
      expect(await Bun.file(join(dir, ".auto/invalid-refs.md")).exists()).toBe(false)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test("历史中不曾存在的路径不恢复(「曾出现」判据 = git 历史);非 git 目录空转", async () => {
    const dir = await freshRepo()
    try {
      await Bun.write(join(dir, "docs/live.md"), "引用 `docs/never-existed.md`。")
      await git(dir, "add", "-A")
      await git(dir, "commit", "-qm", "init")
      const findings = await autoCorrectRefs(dir)
      expect(findings).toHaveLength(1)
      expect(await Bun.file(join(dir, "docs/live.md")).text()).toBe("引用 `docs/never-existed.md`。")
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
