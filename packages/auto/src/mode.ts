// -m/--mode 模式层(设计文档 A.1): 提示词级场景引导,不影响 driver 调度状态机。
// 模式以文件模板管理——内置 templates/modes/<name>.md(经 `with { type: "file" }`
// 编译期嵌入,新增内置模式 = 加文件 + 一条导入),目标目录 .opencode/auto/modes/
// <name>.md 可新增或覆盖同名内置模式,新增模式零源码改动。
// ModeSpec 三段文案的注入点: init → renderInit 的模式导语;exec → 分解/整任务/
// 子任务/收尾等执行类提示词的注意事项段;final → 终审各阶段提示词的侧重
// (renderFinalTask 消费;remediate 阶段不注入)。
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import builtinMigrate from "../templates/modes/migrate.md" with { type: "file" }

export type ModeSpec = {
  name: string
  // renderInit 的模式导语: 场景定义、任务排布原则、verify 侧重。
  init: string
  // 执行类提示词(分解/整任务/子任务/收尾)附加的模式注意事项。
  exec: string
  // 终审各阶段提示词的侧重。
  final: { audit: string; validate: string; finalize: string }
}

// 模式文件协议: 首行 `# <name>`(须与文件名一致),五节齐备、无未知节。
const SECTIONS = ["init", "exec", "final: audit", "final: validate", "final: finalize"]

// 模式名约束: 小写字母开头的字母/数字/连字符(与 CLI 取值一致)。
const NAME_PATTERN = /^[a-z][a-z0-9-]*$/

// 装载全部模式: 内置注册表 + 目标目录 .opencode/auto/modes/<name>.md(同名覆盖
// 内置)。文件不合法时抛出(由 CLI 转为退出码 1 的用法错误)。dir 省略时仅内置。
export function loadModes(dir?: string): Record<string, ModeSpec> {
  const modes: Record<string, ModeSpec> = { migrate: parseModeFile("migrate", readFileSync(builtinMigrate, "utf8")) }
  if (!dir) return modes
  const overlayDir = join(dir, ".opencode", "auto", "modes")
  let files: string[] = []
  try {
    files = readdirSync(overlayDir)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
  }
  for (const file of files.sort()) {
    if (!file.endsWith(".md")) continue
    const name = file.slice(0, -3)
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`模式文件名 ${join(".opencode", "auto", "modes", file)} 不合法: 须为小写字母开头的字母/数字/连字符`)
    }
    modes[name] = parseModeFile(name, readFileSync(join(overlayDir, file), "utf8"))
  }
  return modes
}

// 解析模式文件内容;不合法时抛出并指明缺失/非法的节。
export function parseModeFile(name: string, text: string): ModeSpec {
  const lines = text.split("\n")
  const title = /^#\s+(.+?)\s*$/.exec(lines[0] ?? "")
  if (!title || title[1] !== name) throw new Error(`模式文件 ${name}.md 首行须为 "# ${name}"`)
  const bodies = new Map<string, string[]>()
  let section: string | undefined
  for (const line of lines.slice(1)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) {
      section = heading[1]
      if (!SECTIONS.includes(section)) {
        throw new Error(`模式文件 ${name}.md 含未知节 "## ${section}"(可用节: ${SECTIONS.map((key) => `## ${key}`).join("、")})`)
      }
      if (!bodies.has(section)) bodies.set(section, [])
      continue
    }
    if (section) bodies.get(section)!.push(line)
  }
  const body = (key: string) => trimBody(bodies.get(key) ?? []).join("\n")
  const missing = SECTIONS.filter((key) => !body(key))
  if (missing.length) {
    throw new Error(`模式文件 ${name}.md 缺少节: ${missing.map((key) => `## ${key}`).join("、")}`)
  }
  return {
    name,
    init: body("init"),
    exec: body("exec"),
    final: { audit: body("final: audit"), validate: body("final: validate"), finalize: body("final: finalize") },
  }
}

function trimBody(lines: string[]): string[] {
  const copy = [...lines]
  while (copy.length && !copy[0].trim()) copy.shift()
  while (copy.length && !copy[copy.length - 1].trim()) copy.pop()
  return copy
}
