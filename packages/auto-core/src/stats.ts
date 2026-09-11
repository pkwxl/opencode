// 跨中断累计统计(plans/STATS_PLAN.md §1): 任务/会话/阶段/轮次各级的累计用时与
// Token 分项,持久化在目标目录 `.auto/stats.json`(gitignore 内、driver 独占写、
// 不进 protect 名单)。进程可被 kill -9 随时打断,故统计增量落盘:开放段 fold +
// 30s 心跳刷新 lastWriteAt,下一进程装载时只承认 `[open.at, lastWriteAt]` 的折旧
// (宁少不多、绝不虚高)。
//
// 计时模型: 单段(segment)状态机——`open?: { at, ai }` 至多一个进行中的段;每次
// 边界 fold 把 `[open.at, now]` **并行**累加进 task/phase/round 三个桶(不做子层
// 向父层折叠——阶段内含非任务时间,折叠式会丢)。ai 段同时累加 aiMs/wallMs,墙钟
// 段只累加 wallMs;fold 钳制 [0, MAX_TICK](时钟回拨/休眠防御)。
//
// 健壮性: 原子写(.tmp → rename + 写队列串行化,对齐 plan.ts edit);解析逐字段
// 宽容(镜像 resume.ts parseProgress,坏 = 缺失不 throw);sessions 超 64 按 at
// 淘汰;所有写失败 catch 静默——统计永不影响流程/退出码。
//
// 公共 API 首参一律 `dir: string | undefined`,undefined = 空转(不发心跳、不读
// 写盘);内部 `Map<dir, Handle>` 惰性装载。同目录并发两个 run 不支持(后写覆盖,
// 偏小不炸)——已接受边界,不加锁文件。
import { mkdir, realpath, rename } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { currentRound } from "./phases"

// ===== schema(v:1,落盘 compact JSON;plans/STATS_PLAN.md :28-43)=====

// 逐 step-finish part 增量累加的用量(采集接线在 T-003,本模块只管入库与聚合)。
export type Usage = {
  input: number
  output: number
  reasoning: number
  cacheRead: number
  cacheWrite: number
  cost: number
  steps: number
}

export type Totals = {
  aiMs: number
  wallMs: number
  waitMs: number
  sessions: number
  tasks: number
  usage: Usage
}

export type Bucket = Totals & { id: string; since: number }

// per-sessionID 累计(需求 2 子会话续接);task 为所属任务,at 为最后活跃时刻(淘汰序)。
export type SessionStat = {
  task: string
  aiMs: number
  wallMs: number
  rounds: number
  usage: Usage
  at: number
}

export type StatsDoc = {
  v: 1
  round: number // 装载时 currentRound(dir) 快照
  phase: string // 当前阶段字母(statsPhase 维护)
  open?: { at: number; ai: boolean } // 至多一个进行中的段
  lastWriteAt: number // 任一写入刷新 = 上一进程死亡时刻的代理
  taskB: Bucket
  phaseB: Bucket
  roundB: Bucket
  sessions: Record<string, SessionStat>
  history: { rounds: number; totals: Totals } // 已滚出历轮聚合(单桶有界)
}

// loadStats 的续接信息(有旧文档时返回,供启动横幅打印;plans/STATS_PLAN.md §4.6)。
// 快照在折旧入账之后、轮次滚动之前截取——round/phase/task 均为上一进程停下时的位置。
export type StatsResume = {
  round: number
  phase: string
  task?: string
  taskWallMs: number
  taskAiMs: number
  lastWriteAt: number
}

// fold/折旧的单段时长上限: 时钟回拨、休眠唤醒等异常间隔截断到 30 分钟(宁少不多)。
export const MAX_TICK = 30 * 60_000

const FILE = join(".auto", "stats.json")

// AUTO-DECISION: now 注入采用模块级可替换时钟(setStatsClock 测试钩子)。备选方案
// 是 loadStats/fold 等各 API 加可选 now 形参——但 fold 还发生在心跳与 S03/S04 各
// 会话/读数 API 内部,形参要逐层穿透全部公共 API,污染签名且接线层(T-002/T-003)
// 也得跟着传;模块级时钟一处注入全模块生效,测试 afterEach 复位即可,否决形参案。
let clock: () => number = Date.now

// 替换统计模块的时钟(测试注入确定性 now);不传参调用恢复 Date.now。
export function setStatsClock(fn?: () => number) {
  clock = fn ?? Date.now
}

// ===== 空值构造 =====

function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0, steps: 0 }
}

function emptyTotals(): Totals {
  return { aiMs: 0, wallMs: 0, waitMs: 0, sessions: 0, tasks: 0, usage: emptyUsage() }
}

function emptyBucket(id: string, since: number): Bucket {
  return { id, since, ...emptyTotals() }
}

function emptyDoc(round: number, now: number): StatsDoc {
  return {
    v: 1,
    round,
    phase: "",
    lastWriteAt: now,
    taskB: emptyBucket("", now),
    phaseB: emptyBucket("", now),
    roundB: emptyBucket(String(round), now),
    sessions: {},
    history: { rounds: 0, totals: emptyTotals() },
  }
}

// ===== 宽容解析(镜像 resume.ts parseProgress: 逐字段 typeof 判定,坏 = 缺失)=====

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function parseUsage(raw: unknown): Usage {
  const u = (raw ?? {}) as Record<string, unknown>
  return {
    input: num(u.input),
    output: num(u.output),
    reasoning: num(u.reasoning),
    cacheRead: num(u.cacheRead),
    cacheWrite: num(u.cacheWrite),
    cost: num(u.cost),
    steps: num(u.steps),
  }
}

function parseTotals(raw: unknown): Totals {
  const t = (raw ?? {}) as Record<string, unknown>
  return {
    aiMs: num(t.aiMs),
    wallMs: num(t.wallMs),
    waitMs: num(t.waitMs),
    sessions: num(t.sessions),
    tasks: num(t.tasks),
    usage: parseUsage(t.usage),
  }
}

function parseBucket(raw: unknown, fallbackId: string): Bucket {
  const b = (raw ?? {}) as Record<string, unknown>
  return { id: str(b.id) || fallbackId, since: num(b.since), ...parseTotals(b) }
}

function parseSessions(raw: unknown): Record<string, SessionStat> {
  const sessions: Record<string, SessionStat> = {}
  if (typeof raw !== "object" || !raw) return sessions
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== "object" || !value) continue // 坏条目跳过(无损,聚合已入桶)
    const s = value as Record<string, unknown>
    sessions[id] = {
      task: str(s.task),
      aiMs: num(s.aiMs),
      wallMs: num(s.wallMs),
      rounds: num(s.rounds),
      usage: parseUsage(s.usage),
      at: num(s.at),
    }
  }
  return sessions
}

function parseStatsDoc(raw: string): StatsDoc | undefined {
  try {
    const p = JSON.parse(raw) as Record<string, unknown>
    if (typeof p !== "object" || !p) return undefined
    const open = p.open as Record<string, unknown> | undefined
    const history = (p.history ?? {}) as Record<string, unknown>
    return {
      v: 1,
      round: num(p.round),
      phase: str(p.phase),
      open: num(open?.at) > 0 ? { at: num(open?.at), ai: open?.ai === true } : undefined,
      lastWriteAt: num(p.lastWriteAt),
      taskB: parseBucket(p.taskB, ""),
      phaseB: parseBucket(p.phaseB, ""),
      roundB: parseBucket(p.roundB, ""),
      sessions: parseSessions(p.sessions),
      history: { rounds: num(history.rounds), totals: parseTotals(history.totals) },
    }
  } catch {
    return undefined
  }
}

// ===== fold / 折旧 / 轮次滚动 =====

// 段时长钳制 [0, MAX_TICK]: 负值(时钟回拨)/NaN 归 0,超上限截断。
function clampTick(ms: number): number {
  if (!(ms > 0)) return 0
  return Math.min(ms, MAX_TICK)
}

// 把一段时长并行累加进 task/phase/round 三桶;ai 段同加 aiMs。
function book(doc: StatsDoc, ms: number, ai: boolean) {
  if (!ms) return
  for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
    bucket.wallMs += ms
    if (ai) bucket.aiMs += ms
  }
}

// 折开放段: 入账 [open.at, now] 并把锚点推进到 now(段保持开放)。
// 时钟回拨(now <= open.at)时锚点不动——若后退锚点,已入账区间会被下次 fold 双计。
function fold(handle: Handle) {
  const open = handle.doc.open
  if (!open) return
  const now = clock()
  if (now <= open.at) return
  book(handle.doc, Math.min(now - open.at, MAX_TICK), open.ai)
  open.at = now
}

// 折旧上一进程遗留段: 只承认 [open.at, lastWriteAt](lastWriteAt = 死亡时刻代理,
// 宁少不多)。
// AUTO-DECISION: 折旧同样过 MAX_TICK 钳制(clampTick)。计划 :47 未明说折旧是否
// 钳制,但"宁少不多"原则下一律钳制最稳妥:lastWriteAt 异常(坏文件宽容解析出的
// 离谱值)时不受钳制会一次性虚增数小时;备选"折旧不钳制、只 fold 钳制"会放大坏
// 数据影响面,否决。折旧不进 per-session(open 段不携带 sessionID,无从归属),
// 同样是宁少不多的已接受取舍。
function depreciate(doc: StatsDoc) {
  const open = doc.open
  if (!open) return
  book(doc, clampTick(doc.lastWriteAt - open.at), open.ai)
  doc.open = undefined
}

// roundB 滚进 history(历轮聚合,单桶有界);task/phase 桶不动——三桶并行累加,
// roundB 已含全部,无丢失;task/phase 由下一次 statsTask/statsPhase 重置。
function rollHistory(doc: StatsDoc) {
  const totals = doc.history.totals
  totals.aiMs += doc.roundB.aiMs
  totals.wallMs += doc.roundB.wallMs
  totals.waitMs += doc.roundB.waitMs
  totals.sessions += doc.roundB.sessions
  totals.tasks += doc.roundB.tasks
  for (const key of Object.keys(totals.usage) as (keyof Usage)[]) {
    totals.usage[key] += doc.roundB.usage[key]
  }
  doc.history.rounds += 1
}

// ===== 原子写 + 写队列 =====

type Handle = {
  doc: StatsDoc
  writing: Promise<void> // 写队列尾: 所有落盘(心跳/事件/flush)都经此链串行化
}

// 对齐 plan.ts edit 的 .tmp → rename;stats.json 非 protect 名单文件,无需
// allowWrite/reprotect。失败向上抛,由 queueWrite 的 catch 静默。
async function atomicWrite(dir: string, text: string) {
  const auto = join(dir, ".auto")
  await mkdir(auto, { recursive: true })
  const file = join(auto, "stats.json")
  const target = await realpath(file).catch(() => file)
  const tmp = join(dirname(target), `.${basename(target)}.${process.pid}.tmp`)
  await Bun.write(tmp, text)
  await rename(tmp, target)
}

// 入队一次落盘: 快照序列化在入队时刻(点位持久化,后续内存改动不影响已排队写),
// lastWriteAt 同步刷新;写失败 catch 静默(统计永不影响流程/退出码)。
function queueWrite(dir: string, handle: Handle) {
  handle.doc.lastWriteAt = clock()
  const text = JSON.stringify(handle.doc)
  handle.writing = handle.writing.then(() => atomicWrite(dir, text)).catch(() => {})
}

// ===== 装载(loadStats / flushStats)=====

const handles = new Map<string, Handle>()
const loading = new Map<string, Promise<Loaded>>()

type Loaded = { handle: Handle; resumed?: StatsResume }

// 惰性装载: 已装载直接返回;并发首次装载共用同一 promise。
function ensure(dir: string): Promise<Loaded> {
  const existing = handles.get(dir)
  if (existing) return Promise.resolve({ handle: existing })
  const pending = loading.get(dir)
  if (pending) return pending
  const created = load(dir).finally(() => loading.delete(dir))
  loading.set(dir, created)
  return created
}

async function load(dir: string): Promise<Loaded> {
  const now = clock()
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  const parsed = raw ? parseStatsDoc(raw) : undefined
  const round = await currentRound(dir).catch(() => 1)
  let resumed: StatsResume | undefined
  let doc: StatsDoc
  if (parsed) {
    doc = parsed
    // 折旧上一进程遗留段(只承认 [open.at, lastWriteAt])。
    depreciate(doc)
    // 续接快照: 折旧之后、轮次滚动之前(呈现上一进程停下时的位置)。
    resumed = {
      round: doc.round,
      phase: doc.phase,
      task: doc.taskB.id || undefined,
      taskWallMs: doc.taskB.wallMs,
      taskAiMs: doc.taskB.aiMs,
      lastWriteAt: doc.lastWriteAt,
    }
    // 轮号变化: roundB 滚进 history 并重置。round 字段损坏(<1)视为缺失,
    // 只刷快照不滚动,避免空轮次虚增 history.rounds。
    if (doc.round >= 1 && round !== doc.round) {
      rollHistory(doc)
      doc.roundB = emptyBucket(String(round), now)
    }
    doc.round = round
  } else {
    // 损坏/缺失 = 从当下重开(换机/清 .auto/ 同此路径,统计非事实来源)。
    doc = emptyDoc(round, now)
  }
  // 开本进程首段(墙钟段,ai=false;会话段由 statsSessionBegin 切换)。
  doc.open = { at: now, ai: false }
  doc.lastWriteAt = now
  const handle: Handle = { doc, writing: Promise.resolve() }
  handles.set(dir, handle)
  queueWrite(dir, handle)
  return { handle, resumed }
}

// runAll 启动调用: 读盘(损坏/缺失 = 从当下重开)→ 折旧 → 轮次滚动 → 开本进程
// 首段。有旧文档时返回可打印的续接信息;全新目录、重复调用(不重复折旧)或
// dir === undefined 返回 undefined。
export async function loadStats(dir: string | undefined): Promise<StatsResume | undefined> {
  if (!dir) return undefined
  if (handles.has(dir)) return undefined
  return (await ensure(dir)).resumed
}

// runAll finally 优雅收口: 折开放段后关段落盘(文档不留 open,下一进程装载无
// 折旧),并卸载句柄(再次 loadStats 重新读盘)。无句柄或 dir === undefined 空转。
export async function flushStats(dir: string | undefined): Promise<void> {
  if (!dir) return
  if (!handles.has(dir) && !loading.has(dir)) return
  const { handle } = await ensure(dir)
  fold(handle)
  handle.doc.open = undefined
  queueWrite(dir, handle)
  await handle.writing
  handles.delete(dir)
}
