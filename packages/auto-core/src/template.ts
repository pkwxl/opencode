// Prompt-template loading and rendering (copy separated from logic). All
// session prompts live as file templates: built-ins under templates/prompts/
// (embedded into the binary at compile time via `with { type: "file" }`;
// readFileSync resolves the embedded paths in the compiled artifact as well);
// same-named .md files in the target directory's .opencode/auto/prompts/
// override them (_partials.md merges shared partials per section); shells may
// additionally register templates via registerTemplate and individual partial
// sections via registerPartial (the shell extension points after the physical
// package split). Overrides of protocol-sensitive templates/partial sections
// are validated at load time for their tier-1 markers, so an override cannot
// silently drop the anchors the driver parses session output against (the
// two-tier marker model is documented above PROTOCOL_MARKERS).
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
import tplHandoffSteer from "../templates/prompts/handoff-steer.md" with { type: "file" }
import tplImplementPlan from "../templates/prompts/implement-plan.md" with { type: "file" }
import tplInferSource from "../templates/prompts/infer-source.md" with { type: "file" }
import tplKnowledge from "../templates/prompts/knowledge.md" with { type: "file" }
import tplNumberRecovery from "../templates/prompts/number-recovery.md" with { type: "file" }
import tplPartials from "../templates/prompts/_partials.md" with { type: "file" }
import tplPhaseHandover from "../templates/prompts/phase-handover.md" with { type: "file" }
import tplPhasePlan from "../templates/prompts/phase-plan.md" with { type: "file" }
import tplPriorKnowledge from "../templates/prompts/prior-knowledge.md" with { type: "file" }
import tplStuckHint from "../templates/prompts/stuck-hint.md" with { type: "file" }
import tplSubtask from "../templates/prompts/subtask.md" with { type: "file" }
import tplTestContinue from "../templates/prompts/test-continue.md" with { type: "file" }
import tplTestWrapup from "../templates/prompts/test-wrapup.md" with { type: "file" }
import tplTestResult from "../templates/prompts/test-result.md" with { type: "file" }
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
  "handoff-steer": tplHandoffSteer,
  "implement-plan": tplImplementPlan,
  "infer-source": tplInferSource,
  knowledge: tplKnowledge,
  "number-recovery": tplNumberRecovery,
  "phase-handover": tplPhaseHandover,
  "phase-plan": tplPhasePlan,
  "prior-knowledge": tplPriorKnowledge,
  "stuck-hint": tplStuckHint,
  subtask: tplSubtask,
  "test-continue": tplTestContinue,
  "test-wrapup": tplTestWrapup,
  "test-result": tplTestResult,
  whole: tplWhole,
  wrapup: tplWrapup,
  _partials: tplPartials,
}

// Protocol markers are two-tiered (M1.3, plans/0033; open question 3 of the
// root plan): tier-1 = driver-enforced protocol anchors (the strings the
// driver itself parses out of session output, or whose loss silently breaks
// the driver↔session contract) — an override missing any of them is rejected
// at load time as a usage error; tier-2 = intent content (quality bars,
// duties, governance) — marker-free by definition, it lives in intent packs
// and is never guarded here. Everything currently listed below is tier-1.
const PROTOCOL_MARKERS: Record<string, string[]> = {
  decompose: ["- [ ]", "context.md", "todo.md"],
  "decompose-a": ["- [ ]", "context.md", "todo.md"],
  "decompose-d": ["- [ ]", "context.md", "todo.md"],
  "decompose-k": ["- [ ]", "context.md", "todo.md"],
  "decompose-m": ["- [ ]", "context.md", "todo.md"],
  "decompose-t": ["- [ ]", "context.md", "todo.md"],
  "decompose-v": ["- [ ]", "context.md", "todo.md"],
  "handoff-steer": ["Status: continue", "Status: done"],
  "implement-plan": ["# T-NNN: <任务标题>", "Phase: {{phaseId}}", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <任务标题>", "{{taskIndex}}"],
  "infer-source": ['"sourceDir"', '"blocked"'],
  "number-recovery": [".auto/next-task"],
  "phase-handover": ["## 关键决策", "## 约束与坑", "## 下一阶段必读清单", "## 产物索引", "{{handover}}"],
  "phase-plan": ["# T-NNN: <任务标题>", "Phase: {{phaseId}}", "## Goal", "## Scope", "## Acceptance", "- [ ] T-NNN <任务标题>", "{{taskIndex}}"],
  "test-wrapup": ["{{handoffFile}}", "not dependent on this test run's result"],
  wrapup: ["Result: PASS", "Result: FAIL"],
}
// (decompose family: the checklist format plus the context.md / todo.md
// artifact paths are what the driver validates the session output against —
// M1.0 merged understand+decompose session, plans/0030.)

// An override still carrying a pre-flip spelling (`状态: 继续`, …) fails here:
// the dual-read layer was retired with the legacy layouts (M3.7, root open
// question 17), so the old spelling would be dead text the parser never reads.
const lacksMarker = (content: string) => (marker: string) => !content.includes(marker)

// Tier-1 markers for shared partial sections (M1.3): the target directory's
// _partials.md overlay merges per section; overriding one of these sections
// must preserve the anchors the driver depends on — the eof doc-shape marker,
// the state-file exclusivity surface, and the question/annotation protocol
// (AUTO-RESOLVE/AUTO-DECISION lines are what src/resolve.ts scans for in the
// session's documents). Sections not listed here are marker-free.
const PARTIAL_MARKERS: Record<string, string[]> = {
  "eof-rule": ["<!-- auto: eof -->"],
  "state-rule": ["CURRENT.md"],
  "task-depends": ["Depends:", "Depends: none", "Touches:"],
  "subtask-depends": ["Depends:", "Depends: none", "Touches:"],
  "question-rule": ["question tool", "AUTO-RESOLVE", "AUTO-DECISION"],
}

// Dynamic registries: shells register additional templates (registerTemplate)
// and individual shared-partial sections (registerPartial), each with optional
// tier-1 markers. Stored apart from the built-ins so they survive
// usePromptLibrary reloads; same-named registrations take precedence over
// built-ins, and target-directory overrides always win over both.
const registered: Record<string, string> = {}
const registeredMarkers: Record<string, string[]> = {}
const registeredPartials: Record<string, string> = {}
const registeredPartialMarkers: Record<string, string[]> = {}

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
  const partialMarkers = { ...PARTIAL_MARKERS, ...registeredPartialMarkers }
  let partials = { ...parsePartials(templates["_partials"]!), ...registeredPartials }
  if (dir) {
    const overlayDir = join(dir, ".opencode", "auto", "prompts")
    for (const file of readOverlayDir(overlayDir).sort()) {
      if (!file.endsWith(".md")) continue
      const name = file.slice(0, -3)
      const content = readTemplate(join(overlayDir, file))
      if (name === "_partials") {
        // Per-section merge with tier-1 marker validation per overridden
        // section (same enforcement as template-level markers).
        const sections = parsePartials(content)
        for (const [section, body] of Object.entries(sections)) {
          const missing = (partialMarkers[section] ?? []).filter(lacksMarker(body))
          if (missing.length) {
            throw new Error(
              `shared-partial overlay ${join(".opencode", "auto", "prompts", file)}: section ${section} is missing required protocol content: ${missing.join(", ")}` +
                ` (protocol lines are what the driver parses session output by, and cannot be removed)`,
            )
          }
        }
        partials = { ...partials, ...sections }
        continue
      }
      const missing = (markers[name] ?? []).filter(lacksMarker(content))
      if (missing.length) {
        throw new Error(
          `prompt template overlay ${join(".opencode", "auto", "prompts", file)} is missing required protocol content: ${missing.join(", ")}` +
            ` (protocol lines are what the driver parses session output by, and cannot be removed)`,
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

// Register an additional template (called by shells at startup): text is the
// full template body (same template syntax as built-ins); markers declare the
// tier-1 protocol anchors a target-directory override must preserve (same
// semantics as PROTOCOL_MARKERS; omitted = not protocol-sensitive). Re-
// registering replaces the previous registration. `_partials` is rejected:
// shared partials register per section via registerPartial. Registrations
// take effect immediately and survive usePromptLibrary reloads.
export function registerTemplate(name: string, text: string, markers?: string[]): void {
  if (!name) throw new Error("template name must not be empty")
  if (name === "_partials") throw new Error("shared partials register per section (registerPartial) or are overridden via the target directory's _partials.md; whole-file registration is not accepted")
  const content = text.trim()
  if (!content) throw new Error(`template ${name} must not be empty`)
  registered[name] = content
  if (markers && markers.length) registeredMarkers[name] = markers
  else delete registeredMarkers[name]
  library.templates[name] = content
  cache.delete(name)
}

// Register one shared-partial section (M1.3, plans/0033): the registerTemplate
// counterpart for the `_partials` surface. name is the section name
// (`## <name>` in _partials.md); a same-named registration replaces the
// built-in section. markers declare tier-1 anchors that a target-directory
// _partials.md overlay must preserve when overriding this section. Takes
// effect immediately and survives usePromptLibrary reloads; a target-directory
// overlay of the section still wins over the registration.
export function registerPartial(name: string, text: string, markers?: string[]): void {
  if (!name) throw new Error("partial name must not be empty")
  const content = text.trim()
  if (!content) throw new Error(`partial ${name} must not be empty`)
  registeredPartials[name] = content
  if (markers && markers.length) registeredPartialMarkers[name] = markers
  else delete registeredPartialMarkers[name]
  library.partials[name] = content
  cache.delete(`@${name}`)
}

export function renderTemplate(name: string, ctx: Ctx): string {
  const text = library.templates[name]
  if (text === undefined) throw new Error(`unknown prompt template: ${name}`)
  return renderNodes(parseCached(name, text), ctx, 0)
}

// Render arbitrary template text (bypasses the registry; partial references use
// the current library's shared partials) — for tests and previews.
export function renderText(text: string, ctx: Ctx): string {
  return renderNodes(parseTemplate(text), ctx, 0)
}

// Template names currently in effect (tests assert the built-ins are complete).
export function promptTemplateNames(): string[] {
  return Object.keys(library.templates).sort()
}

// Parse the `## <name>` sections of _partials.md into a partial table; the
// leading H1 and any prose outside a section are ignored, and section bodies
// have leading/trailing blank lines trimmed.
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
