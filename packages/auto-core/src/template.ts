// 提示词模板装载与渲染(文案与逻辑分离)。全部会话提示词以文件模板管理: 内置
// 模板在 templates/prompts/(经 `with { type: "file" }` 编译期嵌入二进制,
// readFileSync 在编译产物中同样可读嵌入路径);目标目录 .opencode/auto/prompts/
// 下同名 .md 可覆盖内置模板(_partials.md 按节名合并共享片段);外壳另可经
// registerTemplate 登记附加模板(物理拆包后的壳层扩展点)。协议敏感模板覆盖时
// 校验关键协议内容仍在,防止覆盖后丢失 driver 解析会话产出的依据。
//
// 模板语法(刻意保持最小;清单类数据由调用方预拼接为字符串,不做循环):
//   {{var}}             变量: string 直接替换;boolean/undefined 渲染为空
//   {{#if x}}…{{/if}}   x 为非空字符串或 true 时保留块内容
//   {{^x}}…{{/if}}      与上一条相反(x 空/false/未定义时保留)
//   {{> name}}          共享片段(_partials.md 的 `## name` 节);标签前只有空白时,
//                       该空白作为片段缩进——独占一行应用到每一行,行内仅应用到
//                       第二行起(首行已带模板内前缀)
// 块/片段标签独占一行时整行吞掉(standalone 语义),条件段书写不必顾虑空行。
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import tplDecompose from "../templates/prompts/decompose.md" with { type: "file" }
import tplDecomposeA from "../templates/prompts/decompose-a.md" with { type: "file" }
import tplDecomposeD from "../templates/prompts/decompose-d.md" with { type: "file" }
import tplDecomposeK from "../templates/prompts/decompose-k.md" with { type: "file" }
import tplDecomposeM from "../templates/prompts/decompose-m.md" with { type: "file" }
import tplDecomposeT from "../templates/prompts/decompose-t.md" with { type: "file" }
import tplDecomposeV from "../templates/prompts/decompose-v.md" with { type: "file" }
import tplContextBase from "../templates/prompts/context-base.md" with { type: "file" }
import tplDryrun from "../templates/prompts/dryrun.md" with { type: "file" }
import tplFinalTask from "../templates/prompts/final-task.md" with { type: "file" }
import tplFix from "../templates/prompts/fix.md" with { type: "file" }
import tplHandoffSteer from "../templates/prompts/handoff-steer.md" with { type: "file" }
import tplInferSource from "../templates/prompts/infer-source.md" with { type: "file" }
import tplKnowledge from "../templates/prompts/knowledge.md" with { type: "file" }
import tplNumberRecovery from "../templates/prompts/number-recovery.md" with { type: "file" }
import tplPartials from "../templates/prompts/_partials.md" with { type: "file" }
import tplPhaseHandover from "../templates/prompts/phase-handover.md" with { type: "file" }
import tplPhasePlan from "../templates/prompts/phase-plan.md" with { type: "file" }
import tplPriorKnowledge from "../templates/prompts/prior-knowledge.md" with { type: "file" }
import tplReview from "../templates/prompts/review.md" with { type: "file" }
import tplReviewFix from "../templates/prompts/review-fix.md" with { type: "file" }
import tplSubtask from "../templates/prompts/subtask.md" with { type: "file" }
import tplTestContinue from "../templates/prompts/test-continue.md" with { type: "file" }
import tplTestHandover from "../templates/prompts/test-handover.md" with { type: "file" }
import tplTestResult from "../templates/prompts/test-result.md" with { type: "file" }
import tplUnderstand from "../templates/prompts/understand.md" with { type: "file" }
import tplVerifyJudge from "../templates/prompts/verify-judge.md" with { type: "file" }
import tplVerifyScriptGen from "../templates/prompts/verify-script-gen.md" with { type: "file" }
import tplWhole from "../templates/prompts/whole.md" with { type: "file" }
import tplWrapup from "../templates/prompts/wrapup.md" with { type: "file" }

// 模板上下文: 值为 string(替换)、boolean(条件判断,true 渲染为空)或 undefined。
export type Ctx = Record<string, string | boolean | undefined>

type Node =
  | { kind: "text"; text: string }
  | { kind: "var"; name: string }
  | { kind: "block"; name: string; negated: boolean; children: Node[] }
  | { kind: "partial"; name: string; indent: string; standalone: boolean }

// 内置模板注册表: 新增内置模板 = 加文件 + 一条 `with { type: "file" }` 导入并
// 登记到这里(用户自定义/覆盖走目标目录 .opencode/auto/prompts/,无需改源码)。
const embedded: Record<string, string> = {
  decompose: tplDecompose,
  "decompose-a": tplDecomposeA,
  "decompose-d": tplDecomposeD,
  "decompose-k": tplDecomposeK,
  "decompose-m": tplDecomposeM,
  "decompose-t": tplDecomposeT,
  "decompose-v": tplDecomposeV,
  "context-base": tplContextBase,
  dryrun: tplDryrun,
  "final-task": tplFinalTask,
  fix: tplFix,
  "handoff-steer": tplHandoffSteer,
  "infer-source": tplInferSource,
  knowledge: tplKnowledge,
  "number-recovery": tplNumberRecovery,
  "phase-handover": tplPhaseHandover,
  "phase-plan": tplPhasePlan,
  "prior-knowledge": tplPriorKnowledge,
  review: tplReview,
  "review-fix": tplReviewFix,
  subtask: tplSubtask,
  "test-continue": tplTestContinue,
  "test-handover": tplTestHandover,
  "test-result": tplTestResult,
  understand: tplUnderstand,
  "verify-judge": tplVerifyJudge,
  "verify-script-gen": tplVerifyScriptGen,
  whole: tplWhole,
  wrapup: tplWrapup,
  _partials: tplPartials,
}

// 协议敏感模板的必备内容: 目标目录覆盖这些模板时,装载期校验协议标记仍在。
const PROTOCOL_MARKERS: Record<string, string[]> = {
  decompose: ["- [ ]"],
  "decompose-a": ["- [ ]"],
  "decompose-d": ["- [ ]"],
  "decompose-k": ["- [ ]"],
  "decompose-m": ["- [ ]"],
  "decompose-t": ["- [ ]"],
  "decompose-v": ["- [ ]"],
  "final-task": ["策略: 重构|修补|无", "结论: 通过", "结论: 差距"],
  "handoff-steer": ["状态: 继续", "状态: 完成"],
  "infer-source": ['"sourceDir"', '"blocked"'],
  "number-recovery": [".auto/next-task"],
  "phase-handover": ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引", "{{handover}}"],
  "phase-plan": ["## T-NNN: <任务标题> [pending]", "PLAN.md"],
  review: ["结论: 通过", "结论: 差距", ".auto/review.md"],
  "review-fix": ["- [ ]"],
  understand: ["context.md"],
  "verify-judge": ["结论: 通过", "结论: 差距", "结论: 重验", ".auto/verify.md", "verified-command"],
  "verify-script-gen": ["#!/usr/bin/env bash"],
}

// 动态注册表: 外壳经 registerTemplate 登记的附加模板与协议标记。独立于 embedded
// 存放,usePromptLibrary 重载(目标目录覆盖装载)后仍保留;与内置模板同名时注册
// 内容生效(外壳可整体替换内置文案),目标目录覆盖始终为最高优先。
const registered: Record<string, string> = {}
const registeredMarkers: Record<string, string[]> = {}

type Library = { dir: string | undefined; templates: Record<string, string>; partials: Record<string, string> }

function readTemplate(path: string): string {
  return readFileSync(path, "utf8").trim()
}

function readOverlayDir(dir: string): string[] {
  try {
    return readdirSync(dir)
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : ""
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error
    return []
  }
}

function loadLibrary(dir: string | undefined): Library {
  const templates: Record<string, string> = {}
  for (const [name, path] of Object.entries(embedded)) templates[name] = readTemplate(path)
  Object.assign(templates, registered)
  const markers = { ...PROTOCOL_MARKERS, ...registeredMarkers }
  let partials = parsePartials(templates["_partials"]!)
  if (dir) {
    const overlayDir = join(dir, ".opencode", "auto", "prompts")
    for (const file of readOverlayDir(overlayDir).sort()) {
      if (!file.endsWith(".md")) continue
      const name = file.slice(0, -3)
      const content = readTemplate(join(overlayDir, file))
      if (name === "_partials") {
        partials = { ...partials, ...parsePartials(content) }
        continue
      }
      const missing = (markers[name] ?? []).filter((marker) => !content.includes(marker))
      if (missing.length) {
        throw new Error(
          `提示词模板覆盖 ${join(".opencode", "auto", "prompts", file)} 缺少关键协议内容: ${missing.join("、")}` +
            `(协议行是 driver 解析会话产出的依据,不能删除)`,
        )
      }
      templates[name] = content
    }
  }
  return { dir, templates, partials }
}

let library: Library = loadLibrary(undefined)
const cache = new Map<string, Node[]>()

// CLI 入口(init/run)以目标目录调用一次,装载 .opencode/auto/prompts/ 覆盖;幂等,
// 传 undefined 恢复仅内置(测试用)。装载失败(协议校验等)抛出,由调用方决定退出。
export function usePromptLibrary(dir: string | undefined): void {
  if (library.dir === dir) return
  library = loadLibrary(dir)
  cache.clear()
}

// 登记附加模板(外壳启动时调用): text 为模板全文(支持与内置相同的模板语法),
// markers 为协议敏感模板的必备内容(目标目录覆盖时的校验依据,同 PROTOCOL_MARKERS,
// 省略 = 非协议敏感)。重复注册以后者为准;_partials 走目标目录覆盖机制,不接受
// 注册。注册即时生效并跨 usePromptLibrary 重载保留。
export function registerTemplate(name: string, text: string, markers?: string[]): void {
  if (!name) throw new Error("模板名不能为空")
  if (name === "_partials") throw new Error("共享片段经目标目录 _partials.md 覆盖,不接受注册")
  const content = text.trim()
  if (!content) throw new Error(`模板 ${name} 的内容不能为空`)
  registered[name] = content
  if (markers && markers.length) registeredMarkers[name] = markers
  else delete registeredMarkers[name]
  library.templates[name] = content
  cache.delete(name)
}

export function renderTemplate(name: string, ctx: Ctx): string {
  const text = library.templates[name]
  if (text === undefined) throw new Error(`未知提示词模板: ${name}`)
  return renderNodes(parseCached(name, text), ctx, 0)
}

// 渲染任意模板文本(不走注册表;片段引用当前库的共享片段)——测试与预览用。
export function renderText(text: string, ctx: Ctx): string {
  return renderNodes(parseTemplate(text), ctx, 0)
}

// 当前生效的模板名(测试断言内置齐备用)。
export function promptTemplateNames(): string[] {
  return Object.keys(library.templates).sort()
}

// _partials.md 的 `## <name>` 节解析为片段表;首行 H1 与节外的说明文字忽略,
// 节体去除首尾空行。
export function parsePartials(text: string): Record<string, string> {
  const partials: Record<string, string> = {}
  let name: string | undefined
  let lines: string[] = []
  const flush = () => {
    if (name === undefined) return
    while (lines.length && !lines[0].trim()) lines.shift()
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    partials[name] = lines.join("\n")
  }
  for (const line of text.split("\n")) {
    const heading = /^##\s+(\S+)\s*$/.exec(line)
    if (heading) {
      flush()
      name = heading[1]
      lines = []
      continue
    }
    if (name !== undefined) lines.push(line)
  }
  flush()
  return partials
}

function parseCached(key: string, text: string): Node[] {
  let nodes = cache.get(key)
  if (!nodes) {
    nodes = parseTemplate(text)
    cache.set(key, nodes)
  }
  return nodes
}

// 文本 → 节点树。块/片段标签"独占一行"(前后同行仅有空白)时整行吞掉;行内出现
// 时原位处理。闭合标签固定写 {{/if}}。
export function parseTemplate(text: string): Node[] {
  const roots: Node[] = []
  const stack: Extract<Node, { kind: "block" }>[] = []
  const emit = (node: Node) => {
    const parent = stack[stack.length - 1]
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  let pos = 0
  while (pos < text.length) {
    const start = text.indexOf("{{", pos)
    if (start === -1) {
      emit({ kind: "text", text: text.slice(pos) })
      break
    }
    const end = text.indexOf("}}", start + 2)
    if (end === -1) {
      emit({ kind: "text", text: text.slice(pos) })
      break
    }
    const tag = text.slice(start + 2, end).trim()
    const marker = tag[0]
    if (marker === "#" || marker === "^" || marker === "/" || marker === ">") {
      const lineStart = text.lastIndexOf("\n", start) + 1
      const before = text.slice(lineStart, start)
      const lineBreak = text.indexOf("\n", end + 2)
      const rest = text.slice(end + 2, lineBreak === -1 ? text.length : lineBreak)
      const alone = /^[ \t]*$/.test(before) && /^[ \t]*$/.test(rest)
      emit({ kind: "text", text: text.slice(pos, alone ? lineStart : start) })
      // 块标签独占一行时整行吞掉(含行尾换行);片段独占一行时保留行尾换行
      // (片段代表内容行,吞掉会使相邻行粘连),只吞标签与行尾空白。
      pos = alone
        ? marker === ">"
          ? lineBreak === -1
            ? text.length
            : lineBreak
          : lineBreak === -1
            ? text.length
            : lineBreak + 1
        : end + 2
      if (marker === "/") {
        if (tag !== "/if" && tag !== "/") throw new Error(`未知闭合标签: {{${tag}}}(只支持 {{/if}})`)
        if (!stack.pop()) throw new Error("多余的 {{/if}}")
        continue
      }
      let name = tag.slice(1).trim()
      if (marker === "#" && name.startsWith("if ")) name = name.slice(3).trim()
      if (!name) throw new Error(`空标签名: {{${tag}}}`)
      if (marker === ">") {
        emit({ kind: "partial", name, indent: /^[ \t]*$/.test(before) ? before : "", standalone: alone })
        continue
      }
      const block: Node = { kind: "block", name, negated: marker === "^", children: [] }
      emit(block)
      stack.push(block as Extract<Node, { kind: "block" }>)
      continue
    }
    emit({ kind: "text", text: text.slice(pos, start) })
    if (!tag) throw new Error("空标签名: {{}}")
    emit({ kind: "var", name: tag })
    pos = end + 2
  }
  const open = stack[stack.length - 1]
  if (open) throw new Error(`未闭合的 {{${open.negated ? "^" : "#if"}} ${open.name}}}`)
  return roots
}

function renderNodes(nodes: Node[], ctx: Ctx, depth: number): string {
  let out = ""
  for (const node of nodes) {
    if (node.kind === "text") out += node.text
    else if (node.kind === "var") {
      const value = ctx[node.name]
      out += typeof value === "string" ? value : ""
    } else if (node.kind === "partial") out += renderPartial(node, ctx, depth)
    else if (Boolean(ctx[node.name]) !== node.negated) out += renderNodes(node.children, ctx, depth)
  }
  return out
}

function renderPartial(node: Extract<Node, { kind: "partial" }>, ctx: Ctx, depth: number): string {
  if (depth > 8) throw new Error(`片段嵌套过深(疑似循环引用): ${node.name}`)
  const body = library.partials[node.name]
  if (body === undefined) throw new Error(`未知提示词片段: ${node.name}(检查 _partials.md 的节名)`)
  const text = renderNodes(parseCached(`@${node.name}`, body), ctx, depth + 1)
  if (!node.indent) return text
  const indented = text.split("\n").join(`\n${node.indent}`)
  return node.standalone ? node.indent + indented : indented
}
