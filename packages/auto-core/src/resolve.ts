// 代答决策台账(docs/auto-resolve-design.md): 把"本应询问用户、却被 driver 自动
// 放行或代答的决策"(AUTO-RESOLVE)从"AI 本就该自己做的工程裁量"(AUTO-DECISION)
// 里拆出来,给前者独立标记、独立台账与独立的高亮报文通道。判别硬判据是**分歧点的
// 决定权本应属于谁**:属于用户(需求意图与范围取舍、对外契约、"什么算做完"的判定
// 标准、事实确认、触碰任务描述边界)→ AUTO-RESOLVE;属于 AI(实现手段,任一选项都
// 不改变用户可见行为)→ AUTO-DECISION。
//
// 两个来源: driver 源(question.asked 被自动答复,runner 接线 H1..H3)权威但只覆盖
// 会话确实发过问的情形;agent 源(会话在文档/代码里写下的 `AUTO-RESOLVE:` 标记行,
// 会话收尾扫描 H4)覆盖面取决于会话自觉。二者经 sameIssue 配对(driver 项置
// matched),报文只展示配对后的合并结果——driver 项有配对即由信息更全的 agent 项
// 取代,无配对则以 ⚠ 点名"会话未按要求标注"。
//
// 持久化在目标目录 `.auto/resolves.json`(gitignore 内、driver 独占写、不进 protect
// 名单),与 `.auto/stats.json` 同族但独立成文件——stats 有 30s 心跳高频写,把会增长
// 的问题文本数组塞进去会让每次心跳重写全量文本。台账只是 driver 的计数与高亮依据,
// 丢了不影响正确性: 持久审计轨迹是进 git 的两样东西——标记行本身与
// docs/T-NNN/report.md 的「自动代答问题」节。
//
// 健壮性照抄 src/stats.ts: 原子写(.tmp → rename + 写队列串行化)、逐字段宽容解析
// (坏 = 缺失不 throw)、所有写失败 catch 静默——审计永不影响流程与退出码。公共 API
// 首参一律 `dir: string | undefined`,undefined = 空转。同目录并发两个 run 不支持
// (后写覆盖),与 stats.json 同一已接受边界。
import { mkdir, realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { taskDoc } from "./docpaths"
import { changedFiles } from "./git"

// ===== schema(v:1,落盘 compact JSON;docs/auto-resolve-design.md §F)=====

export type ResolveSource = "driver" | "agent"

export type ResolveItem = {
  at: number
  task: string // T-NNN;旁路会话为伪任务 PLAN/AUTO(pseudoTask,runner.ts)
  phase: string // 阶段字母,未知为 ""
  round: number
  session?: string // driver 源携带会话 id
  source: ResolveSource
  question: string // driver 源 = 提问原文;agent 源 = 标记的 <原问题> 段
  option?: string // agent 源解析所得 <所选方案>
  reason?: string // agent 源解析所得 <理由>
  file?: string // agent 源:标记所在 `路径:行号`
  malformed?: boolean // agent 源:标记缺箭头/理由段
  matched?: boolean // driver 源:已找到配对的 agent 标记
}

export type ResolveDoc = { v: 1; items: ResolveItem[] }

// driver 源的回合内观测(runner watch() 的 Watch.resolves,T-005 接线): 落账所需的
// task/phase/round 由 attempt 侧在 await watching 之后补齐,故事件本身只带提问原文
// 与会话 id。
export type ResolveEvent = { at: number; question: string; session?: string }

// 落账时补齐的桶身份(collectAgentResolves 与 driver 侧共用)。
export type ResolveCtx = { task: string; phase?: string; round?: number; session?: string }

// 台账总量上限: 超出按 FIFO 淘汰最旧。上限内不会触及(一轮 24 任务 × 每任务个位数),
// 设上限只为防异常刷屏把文件撑大。
const MAX_ITEMS = 512

// 单文件扫描上限: 超过 2MB 的文件跳过(标记行只会出现在人写的文档与源码里)。
const MAX_SCAN_BYTES = 2 * 1024 * 1024

// 高亮块最多逐条列出的条数,超出只给"另有 N 条"。
const MAX_HIGHLIGHT = 8

// 报文单条问题文本的截断长度(driver 源提问可能是多行长文本,压成单行后截断)。
const MAX_TEXT = 80

const FILE = join(".auto", "resolves.json")

// AUTO-DECISION: now 注入沿用 stats.ts 的模块级可替换时钟(setResolveClock 测试
// 钩子),而非逐 API 加可选 now 形参——同一包内两处时钟注入手法保持一致,测试
// afterEach 复位即可。
let clock: () => number = Date.now

// 替换本模块时钟(测试注入确定性 now);不传参恢复 Date.now。
export function setResolveClock(fn?: () => number) {
  clock = fn ?? Date.now
}

// ===== 标记解析(§D)=====

// 标记行的两类前缀在任意位置都有效: 代码注释(`// AUTO-RESOLVE: …`)与 markdown
// 列表项(`- AUTO-RESOLVE: …`)同等合法,故只按标记本身定位、不约束行首。
const RESOLVE_MARK = /AUTO-RESOLVE[ \t`*]*[:：][ \t]*/
const DECISION_MARK = /AUTO-DECISION[ \t`*]*[:：][ \t]*/
// 分隔符三种写法,理由段中英文括号皆可。
const ARROW = /[ \t]*(?:->|→|=>)[ \t]*/
const REASON = /[(（]([^()（）]*)[)）][\s`*]*$/

export type ParsedResolve = {
  question: string
  option?: string
  reason?: string
  malformed?: boolean
}

// 单行解析(不跨行)。无标记、空正文或纯占位行返回 undefined;**容错优先**: 缺箭头
// 时整行作 question 仍然返回(malformed,照样计数并落账)——少报一条代答比格式洁癖
// 的代价大得多。缺理由段同样置 malformed(§F schema 注释口径: 缺箭头/理由段)。
export function parseResolveLine(text: string): ParsedResolve | undefined {
  const mark = RESOLVE_MARK.exec(text)
  if (!mark) return undefined
  const body = trimDecor(text.slice(mark.index + mark[0].length))
  if (!body) return undefined
  const arrow = ARROW.exec(body)
  if (!arrow || arrow.index === 0) return placeholder(body) ? undefined : { question: body, malformed: true }
  const question = trimDecor(body.slice(0, arrow.index))
  if (!question || placeholder(question)) return undefined
  const rest = trimDecor(body.slice(arrow.index + arrow[0].length))
  const reason = REASON.exec(rest)
  if (!reason) return { question, option: rest || undefined, reason: undefined, malformed: true }
  const option = trimDecor(rest.slice(0, reason.index))
  return { question, option: option || undefined, reason: trimDecor(reason[1]) || undefined }
}

// 去掉正文两端的空白与 markdown 装饰(行内代码的反引号、加粗星号),使文档里以
// `` `AUTO-RESOLVE: …` `` 形式写出的标记行与裸写的一致。
function trimDecor(text: string): string {
  return text.replace(/^[\s`*]+/, "").replace(/[\s`*]+$/, "")
}

// 语法说明行里的占位段(`<原问题>` 等)不是真的代答记录: 本设计的说明文档、wrapup
// 模板与本文件自身都写有格式样例,不排除会在每个改动文档的任务里被反复采集。
function placeholder(text: string): boolean {
  return /^<[^<>]*>$/.test(text)
}

// 归一化后全等或互为子串即视为同一问题。自 runner.ts 上收至此(收口先例: log.ts 的
// formatter 收口): 既供 runner 判重复提问,也供台账去重与 driver↔agent 配对。
export function sameIssue(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  return x === y || x.includes(y) || y.includes(x)
}

function normalize(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase()
}

// ===== 持久化(原子写 + 写队列;镜像 stats.ts)=====

// 逐字段宽容解析(镜像 resume.ts parseProgress): 坏条目跳过、坏字段取缺省,绝不
// throw——台账损坏只该让计数从当下重开,不该让运行停机。
function parseDoc(raw: string): ResolveDoc {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== "object" || !parsed) return { v: 1, items: [] }
    const list = Array.isArray(parsed.items) ? parsed.items : []
    const items: ResolveItem[] = []
    for (const entry of list) {
      if (typeof entry !== "object" || !entry) continue
      const item = entry as Record<string, unknown>
      const question = typeof item.question === "string" ? item.question : ""
      if (!question) continue // 无提问文本的条目无展示价值,丢弃
      items.push({
        at: typeof item.at === "number" && Number.isFinite(item.at) ? item.at : 0,
        task: typeof item.task === "string" ? item.task : "",
        phase: typeof item.phase === "string" ? item.phase : "",
        round: typeof item.round === "number" && Number.isFinite(item.round) ? item.round : 0,
        session: typeof item.session === "string" ? item.session : undefined,
        source: item.source === "agent" ? "agent" : "driver",
        question,
        option: typeof item.option === "string" ? item.option : undefined,
        reason: typeof item.reason === "string" ? item.reason : undefined,
        file: typeof item.file === "string" ? item.file : undefined,
        malformed: item.malformed === true ? true : undefined,
        matched: item.matched === true ? true : undefined,
      })
    }
    return { v: 1, items }
  } catch {
    return { v: 1, items: [] }
  }
}

async function readDoc(dir: string): Promise<ResolveDoc> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  return raw ? parseDoc(raw) : { v: 1, items: [] }
}

// 对齐 stats.ts/plan.ts 的 .tmp → rename;resolves.json 非 protect 名单文件,无需
// allowWrite/reprotect。失败向上抛,由 update 的 catch 静默。
async function atomicWrite(dir: string, text: string) {
  const auto = join(dir, ".auto")
  await mkdir(auto, { recursive: true })
  const file = join(auto, "resolves.json")
  const target = await realpath(file).catch(() => file)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  await Bun.write(tmp, text)
  await rename(tmp, target)
}

// 写队列: 同一目录的读-改-写串行化,并发调用不丢条目(stats.ts 是内存文档单写点,
// 本模块无常驻文档,故串行化的是整个读-改-写)。写失败静默。
const writing = new Map<string, Promise<void>>()

function update(dir: string, mutate: (doc: ResolveDoc) => void): Promise<void> {
  const next = (writing.get(dir) ?? Promise.resolve())
    .then(async () => {
      const doc = await readDoc(dir)
      mutate(doc)
      if (doc.items.length > MAX_ITEMS) doc.items = doc.items.slice(-MAX_ITEMS) // FIFO 淘汰最旧
      await atomicWrite(dir, JSON.stringify(doc))
    })
    .catch(() => {})
  writing.set(dir, next)
  return next
}

// 去重键: source + task + 归一化 question(同一问题在同一任务内重复落账只留一条;
// 跨任务同问题各留一条,因为它们是两次独立的代答)。
function key(item: { source: ResolveSource; task: string; question: string }): string {
  return `${item.source} ${item.task} ${normalize(item.question)}`
}

// 追加落账。已存在的同键条目不重复追加,但允许补齐信息(option/reason/file/matched
// 从无到有时就地更新)——driver 项的 matched 正是这样被 agent 扫描补上的。
export async function recordResolves(dir: string | undefined, items: ResolveItem[]): Promise<void> {
  if (!dir || !items.length) return
  await update(dir, (doc) => {
    const index = new Map(doc.items.map((item) => [key(item), item]))
    for (const item of items) {
      const existing = index.get(key(item))
      if (!existing) {
        doc.items.push(item)
        index.set(key(item), item)
        continue
      }
      existing.option ??= item.option
      existing.reason ??= item.reason
      existing.file ??= item.file
      if (item.matched) existing.matched = true
    }
  })
}

// ===== 会话收尾扫描(H4)=====

// 扫描本次会话的工作区变更文件,提取两类标记: AUTO-RESOLVE 落账(并回配 driver 项
// 的 matched),AUTO-DECISION 只回计数——台账的存在理由是驱动高亮,AUTO-DECISION 不
// 参与高亮就不需要行级持久化,它的持久轨迹本来就是进 git 的标记行本身。
// 变更文件经 git.ts 的 changedFiles 逐仓库遍历(嵌套子仓库是本项目常态);非 git
// 目录返回空清单,机制自然空转。二进制与超过 2MB 的文件跳过。
// 返回本次扫描到的标记条数(落账去重之前的口径: 它回答的是"扫描确实跑过、看见了
// 多少标记",而非"台账新增了几条")。
export async function collectAgentResolves(
  dir: string | undefined,
  ctx: ResolveCtx,
): Promise<{ resolves: number; decisions: number }> {
  if (!dir) return { resolves: 0, decisions: 0 }
  const files = await changedFiles(dir).catch(() => [] as string[])
  const items: ResolveItem[] = []
  let decisions = 0
  const at = clock()
  for (const file of files) {
    const text = await readScannable(join(dir, file))
    if (text === undefined) continue
    const lines = text.split("\n")
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!
      if (DECISION_MARK.test(line)) decisions++
      const parsed = parseResolveLine(line)
      if (!parsed) continue
      items.push({
        at,
        task: ctx.task,
        phase: ctx.phase ?? "",
        round: ctx.round ?? 0,
        source: "agent",
        question: parsed.question,
        option: parsed.option,
        reason: parsed.reason,
        file: `${file}:${i + 1}`,
        malformed: parsed.malformed,
      })
    }
  }
  if (items.length) {
    await update(dir, (doc) => {
      mergeAgent(doc, items)
    })
  }
  return { resolves: items.length, decisions }
}

// 落账 agent 项 + 回配 driver 项: 同一任务内经 sameIssue 命中的 driver 项置
// matched(报文侧据此把它折叠掉,由信息更全的 agent 项代表这次代答)。
function mergeAgent(doc: ResolveDoc, items: ResolveItem[]) {
  const index = new Map(doc.items.map((item) => [key(item), item]))
  for (const item of items) {
    const existing = index.get(key(item))
    if (existing) {
      existing.option ??= item.option
      existing.reason ??= item.reason
      existing.file ??= item.file
      if (!item.malformed) existing.malformed = undefined
    } else {
      doc.items.push(item)
      index.set(key(item), item)
    }
    for (const other of doc.items) {
      if (other.source !== "driver" || other.task !== item.task) continue
      if (sameIssue(other.question, item.question)) other.matched = true
    }
  }
}

// 可扫描文件的读取: 目录/不存在/超限返回 undefined,含 NUL 字节的按二进制跳过。
async function readScannable(path: string): Promise<string | undefined> {
  const file = Bun.file(path)
  const size = await file.exists().then((ok) => (ok ? file.size : -1)).catch(() => -1)
  if (size < 0 || size > MAX_SCAN_BYTES) return undefined
  const text = await file.text().catch(() => undefined)
  if (text === undefined || text.includes(" ")) return undefined
  return text
}

// ===== 读回(resolvesOf)=====

export type ResolveScope = "task" | "phase" | "round"

// 按桶身份过滤读回(task = T-NNN / phase = 阶段字母 / round = 轮号)。读之前先等本
// 目录的写队列排空,保证刚落账的条目可见。dir === undefined 或 id 为空返回空数组
// ——空 id 会匹配上所有"阶段未知"的条目,那是桶身份不可信的窗口期,不如不给。
export async function resolvesOf(
  dir: string | undefined,
  scope: ResolveScope,
  id: string | number,
): Promise<ResolveItem[]> {
  if (!dir) return []
  const want = String(id)
  if (!want) return []
  await writing.get(dir)?.catch(() => {})
  const doc = await readDoc(dir)
  return doc.items.filter((item) =>
    scope === "task" ? item.task === want : scope === "phase" ? item.phase === want : String(item.round) === want,
  )
}

// ===== 高亮报文(§H)=====

export type HighlightOpts = {
  scope?: ResolveScope // 缺省 task
  id?: string | number // phase 字母 / 轮号(scope !== "task" 的文案用)
  decisions?: number // 本任务 AUTO-DECISION 计数(有代答时折进末行)
}

// 构造高亮块(纯函数)。items 为空返回空数组——没有代答就不该占任何版面。
// 展示前先做 driver↔agent 合并: 已配对的 driver 项被丢弃(agent 项信息更全,含所选
// 方案/理由/标记位置),未配对的 driver 项保留并点名"会话未按要求标注"。
export function resolveHighlight(items: ResolveItem[], opts?: HighlightOpts): string[] {
  const shown = items.filter((item) => !(item.source === "driver" && item.matched))
  if (!shown.length) return []
  const scope = opts?.scope ?? "task"
  const unmarked = shown.filter((item) => item.source === "driver").length
  if (scope !== "task") {
    const subject = scope === "phase" ? `阶段 ${opts?.id ?? ""} ` : `第 ${opts?.id ?? ""} 轮`
    const note = unmarked ? `(其中 ${unmarked} 个未按要求标注)` : ""
    return [`⚑ ${subject}共自动代答 ${shown.length} 个待确认问题${note},逐条见各任务报告`]
  }
  const report = taskDoc(shown[0]!.task || "T-NNN", "report")
  const lines = [`⚑ 本任务自动代答了 ${shown.length} 个本应由你确认的问题,请重点确认:`]
  for (const [i, item] of shown.slice(0, MAX_HIGHLIGHT).entries()) {
    lines.push(`  ${i + 1}. ${entryText(item)}`)
    if (item.file) lines.push(`     ${item.file}`)
  }
  if (shown.length > MAX_HIGHLIGHT) {
    lines.push(`  …另有 ${shown.length - MAX_HIGHLIGHT} 条,全部见 ${report}`)
  } else {
    lines.push(`  完整记录见 ${report} 的「自动代答问题」节`)
  }
  if (opts?.decisions) lines.push(`  另记录 AUTO-DECISION ${opts.decisions} 条(已折叠,见任务报告)`)
  return lines
}

// 单条文案: `<原问题> → <所选方案>(<理由>)`,缺项按实有部分收缩;driver 源未配对
// 与 agent 源格式不规范各自带 ⚠ 点名(两者是不同的失守: 前者是根本没标,后者是标了
// 但没按格式写)。
function entryText(item: ResolveItem): string {
  const question = compactText(item.question)
  if (item.source === "driver") return `${question}  ⚠ 会话未按要求写出 AUTO-RESOLVE 标记`
  const option = item.option ? ` → ${compactText(item.option)}` : ""
  const reason = item.reason ? `(${compactText(item.reason)})` : ""
  const warn = item.malformed ? "  ⚠ 格式不规范" : ""
  return `${question}${option}${reason}${warn}`
}

// 压成单行并截断: driver 源的提问原文可能是多行长文本,整段贴进结论行会把高亮块
// 淹掉;完整原文在台账与任务报告里。导出供 runner 的会话内即时行(H1)共用同一压缩
// 口径——两处展示的是同一份提问文本,截断长度不该各写一份。
export function compactText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > MAX_TEXT ? `${line.slice(0, MAX_TEXT)}…` : line
}
