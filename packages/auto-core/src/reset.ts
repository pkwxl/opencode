// 反初始化(与 init 互逆): 精确移除 init 写出的配置层产物,把工作区还原到未
// 初始化状态,消除配置残留对 opencode 主程序与其他扩展组件的干扰。
//
// 边界(设计要点,改动前先读完):
//   1. 只清配置层。.auto/ 的运行时状态(日志、stats/resolves/progress)、
//      PLAN.md、docs/(含轮次目录 R-NN 与任务目录 T-NNN)、tmp/ 一律不动——
//      那些是人与 AI 的工作成果,不是 init 的产物。
//   2. 清单是枚举式白名单,没有通配、没有递归删除。
//   3. 目录回收一律用 rmdir(非空即抛,跳过),绝不用 rm -r。这道机制保住
//      .opencode/auto/prompts/(用户自建的提示词覆盖目录,template.ts 读取)
//      与 .opencode/agent/ 下用户自己的其他 agent 契约。
//   4. 与主程序共用的文件逐字节比对后才动: opencode.json 只在内容等于模板时
//      删除,被改过就保留;AGENTS.md 只摘除 opencode-auto 标记块。
import { rm, rmdir, stat } from "node:fs/promises"
import { join } from "node:path"
import templateConfig from "../templates/opencode.json" with { type: "file" }
import { removePointer } from "./agents-block"
import { removeGitignoreEntries } from "./gitignore"

export type ResetAction = "remove" | "strip" | "rmdir" | "keep"

export type ResetEntry = {
  // 相对目标目录的路径,用于打印清单。
  path: string
  action: ResetAction
  // keep 必填(说明为何保留);其余可选补充说明。
  reason?: string
}

// init 写出的配置层产物,按与写入互逆的顺序。
const CONFIG_JSON = join(".opencode", "auto", "config.json")
const BRIEF_MD = join(".opencode", "auto", "brief.md")
// 旧版仅含 mode 的配置(config.ts 的 LEGACY_FILE): 虽落在 .auto/ 下,性质是
// 配置而非运行时状态,属清理范围;.auto/ 其余内容不动。
const LEGACY_CONFIG = join(".auto", "config.json")
const AGENT_MD = join(".opencode", "agent", "auto.md")
// 空则回收的目录,按由内向外。
const PRUNE_DIRS = [join(".opencode", "auto"), join(".opencode", "agent"), ".opencode"]

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists()
}

// Bun.file(...).exists() 对目录恒为 false,目录存在性须走 stat。
async function dirExists(path: string): Promise<boolean> {
  return stat(path).then((entry) => entry.isDirectory(), () => false)
}

// 计算清单但不落盘: CLI 先打印给用户看、再确认,确认后才 applyReset。
export async function planReset(dir: string): Promise<ResetEntry[]> {
  const entries: ResetEntry[] = []

  for (const rel of [CONFIG_JSON, BRIEF_MD, LEGACY_CONFIG]) {
    if (await fileExists(join(dir, rel))) entries.push({ path: rel, action: "remove" })
  }

  // agent 契约不比对: init 本就无条件按模板覆盖它(内容不一致即替换),
  // 它是纯 auto 产物,手改不具备「用户自有内容」的地位。
  if (await fileExists(join(dir, AGENT_MD))) entries.push({ path: AGENT_MD, action: "remove" })

  // opencode.json 由主程序读取,可能承载用户自己的 model/permission 配置:
  // 逐字节等于模板才删,否则保留。
  const configFile = join(dir, "opencode.json")
  if (await fileExists(configFile)) {
    const [current, template] = await Promise.all([Bun.file(configFile).text(), Bun.file(templateConfig).text()])
    entries.push(
      current === template
        ? { path: "opencode.json", action: "remove" }
        : { path: "opencode.json", action: "keep", reason: "内容已被修改,非 init 模板原样,保留" },
    )
  }

  const agents = join(dir, "AGENTS.md")
  if (await fileExists(agents)) {
    const preview = await removePointer(dir, { dryRun: true })
    if (preview.emptied) entries.push({ path: "AGENTS.md", action: "remove", reason: "摘除标记块后仅剩空壳标题" })
    else if (preview.removed) entries.push({ path: "AGENTS.md", action: "strip", reason: "摘除 opencode-auto 标记块" })
  }

  const gitignore = join(dir, ".gitignore")
  if (await fileExists(gitignore)) {
    const preview = await removeGitignoreEntries(dir, { dryRun: true })
    if (preview.emptied) entries.push({ path: ".gitignore", action: "remove", reason: "移除条目后文件为空" })
    else if (preview.removed) entries.push({ path: ".gitignore", action: "strip", reason: "移除 tmp/ 与 .auto/ 条目" })
  }

  for (const rel of PRUNE_DIRS) {
    if (await dirExists(join(dir, rel))) entries.push({ path: `${rel}/`, action: "rmdir", reason: "仅在为空时回收" })
  }

  return entries
}

// 执行清单。rmdir 对非空目录抛错即跳过——这正是保住 prompts/ 与用户其他 agent
// 契约的机制,不要改成 rm -r。
export async function applyReset(dir: string, entries: ResetEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.action === "keep") continue
    if (entry.action === "rmdir") {
      await rmdir(join(dir, entry.path)).catch(() => {})
      continue
    }
    if (entry.path === "AGENTS.md") {
      if (entry.action === "remove") await rm(join(dir, "AGENTS.md"), { force: true })
      else await removePointer(dir)
      continue
    }
    if (entry.path === ".gitignore") {
      if (entry.action === "remove") await rm(join(dir, ".gitignore"), { force: true })
      else await removeGitignoreEntries(dir)
      continue
    }
    await rm(join(dir, entry.path), { force: true })
  }
}

// 清单的人读渲染(CLI 与测试共用,保证「打印什么」与「删什么」同源)。
export function formatResetPlan(entries: ResetEntry[]): string {
  const label: Record<ResetAction, string> = { remove: "删除", strip: "还原", rmdir: "回收空目录", keep: "保留" }
  return entries.map((entry) => `  ${label[entry.action]}: ${entry.path}${entry.reason ? ` (${entry.reason})` : ""}`).join("\n")
}
