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
// AI 段时长并行计入进行中会话的 aiMs 累计(thisAiMs / per-session 口径)。
function fold(handle: Handle) {
  const open = handle.doc.open
  if (!open) return
  const now = clock()
  if (now <= open.at) return
  const ms = Math.min(now - open.at, MAX_TICK)
  book(handle.doc, ms, open.ai)
  if (open.ai && handle.session) handle.session.aiMs += ms
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

// 会话内进行中状态(不持久化): statsSessionBegin 关联当前任务并清零累计;AI 段每次
// fold 的时长并行计入 aiMs(thisAiMs / per-session 口径),会话内人工等待计入 waitMs
// (per-session wallMs = aiMs + waitMs,与三桶"wallMs 排除纯人工等待"口径区分)。
// kill -9 丢失未落账的会话内累计(三桶经折旧仍承认到 lastWriteAt,per-session 无从
// 归属故宁少不多——与折旧不进 per-session 同一取舍)。
type ActiveSession = {
  task: string
  aiMs: number
  waitMs: number
}

type Handle = {
  doc: StatsDoc
  // 本进程起点快照(statsBoot): loadStats 时刻(折旧+轮次滚动之后)的三桶 Totals
  // 副本;桶在本进程内被重置(statsTask/statsPhase 切换)时对应快照同步归零,保证
  // "本进程增量 = statsTotals − statsBoot" 始终对齐当前桶身份。不持久化。
  boot: { task: Totals; phase: Totals; round: Totals }
  writing: Promise<void> // 写队列尾: 所有落盘(心跳/事件/flush)都经此链串行化
  session?: ActiveSession // 进行中的 AI 会话(statsSessionBegin/End 维护)
  // 人工等待嵌套深度计数: depth 0→1 关段(fold 后 open=undefined,墙钟/AI 均不
  // 增长)、归零时 waitMs 单记入三桶并重开段(ai 标志恢复为关段前的值)。嵌套去重:
  // --early 并行会话等重叠等待只计一次(计划 :52)。由此层级桶的 aiMs 语义 =
  // "AI 活跃墙钟时长"(任一会话 AI 段开放的墙钟区间并集),而非各会话 AI 时长之
  // 和——并行会话重叠时 层级 aiMs ≤ Σ session aiMs,属预期而非漏计。
  wait: { depth: number; start: number; ai: boolean }
  timer?: ReturnType<typeof setInterval> // 会话期 30s 心跳(fold+落盘,unref)
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
  const handle: Handle = {
    doc,
    boot: { task: copyTotals(doc.taskB), phase: copyTotals(doc.phaseB), round: copyTotals(doc.roundB) },
    writing: Promise.resolve(),
    wait: { depth: 0, start: 0, ai: false },
  }
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
  stopHeartbeat(handle)
  handle.session = undefined
  fold(handle)
  handle.doc.open = undefined
  queueWrite(dir, handle)
  await handle.writing
  handles.delete(dir)
}

// ===== 层级切换与读数(statsPhase/statsTask/statsTotals/statsId/statsBoot)=====

function copyTotals(t: Totals): Totals {
  return {
    aiMs: t.aiMs,
    wallMs: t.wallMs,
    waitMs: t.waitMs,
    sessions: t.sessions,
    tasks: t.tasks,
    usage: { ...t.usage },
  }
}

// 读数实时外推: 把开放段 [open.at, now] 的未落账部分计入**副本**返回(与 fold 同一
// 钳制),不修改 doc、不落盘——展示层任意时刻可读到当前值,状态机不受影响。
function extrapolate(doc: StatsDoc, bucket: Bucket): Bucket {
  const copy: Bucket = { id: bucket.id, since: bucket.since, ...copyTotals(bucket) }
  const open = doc.open
  if (open) {
    const now = clock()
    if (now > open.at) {
      const ms = Math.min(now - open.at, MAX_TICK)
      copy.wallMs += ms
      if (open.ai) copy.aiMs += ms
    }
  }
  return copy
}

// 阶段切换(runPhaseLoop routePhase 后/非分阶段 "m"): fold 当前段(计入旧桶)后,
// 字母变化时重置 phaseB(id=letter, since=now)并落盘;相同字母幂等(不重置、累计
// 继续)。boot.phase 随桶重置归零,保持"本进程增量"口径对齐当前桶。
export async function statsPhase(dir: string | undefined, letter: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  if (handle.doc.phaseB.id === letter) return
  handle.doc.phase = letter
  handle.doc.phaseB = emptyBucket(letter, clock())
  handle.boot.phase = emptyTotals()
  queueWrite(dir, handle)
}

// 任务切换(runTaskLoop 任务横幅处): fold 后,id 变化时重置 taskB、清空 sessions
// 映射(计划 :49;清空前聚合已入三桶,per-session 展示丢历史属已接受取舍)并落盘;
// 同 id 幂等——中断续跑同任务不重置、不重复计数、保留 per-session 续接。
// AUTO-DECISION: tasks 计数 = 进入一个不同任务 id 计 +1(含本进程首次进入),累加在
// phase/round 桶(对应"阶段 N 个任务 / 本轮 N 个任务"报文口径);taskB 重置后置 1 表
// 示本桶覆盖当前这一个任务。备选"按任务完成计数"被否决:完成时刻(blocked/
// incomplete 也算?)口径模糊,而"进入"语义简单且跨中断幂等(同 id 不重复计)。
export async function statsTask(dir: string | undefined, id: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  if (handle.doc.taskB.id === id) return
  handle.doc.taskB = emptyBucket(id, clock())
  handle.doc.taskB.tasks = 1
  handle.doc.phaseB.tasks += 1
  handle.doc.roundB.tasks += 1
  handle.doc.sessions = {}
  handle.boot.task = emptyTotals()
  queueWrite(dir, handle)
}

export type StatsScope = "task" | "phase" | "round"

// 读数: 返回该桶累计副本 + 开放段实时外推(未落账段即时计入,不修改状态不落盘)。
// dir === undefined 返回 undefined。
export async function statsTotals(
  dir: string | undefined,
  scope: StatsScope,
): Promise<Bucket | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  const bucket = scope === "task" ? handle.doc.taskB : scope === "phase" ? handle.doc.phaseB : handle.doc.roundB
  return extrapolate(handle.doc, bucket)
}

// 当前 taskB.id(trackSubtasks 守卫: statsId === task.id 才信 statsTotals,T-002 消费)。
// AUTO-DECISION: 同步且不触发惰性装载——守卫读数应无副作用;未装载/空 id 返回
// undefined 即守卫失败,语义正确。若为守卫读数触发一次 load(读盘+落盘)反而引入
// 不必要的 IO 与状态时序,否决。
export function statsId(dir: string | undefined): string | undefined {
  if (!dir) return undefined
  return handles.get(dir)?.doc.taskB.id || undefined
}

// 本进程起点快照(loadStats 时刻、折旧+轮次滚动之后;桶在本进程内重置时对应快照
// 归零)。"累计 X(本进程 Y)"口径: 本进程增量 = statsTotals(scope) − statsBoot(scope)
// 的同名字段差。返回深拷贝,调用方改动不影响内部状态。
export async function statsBoot(
  dir: string | undefined,
): Promise<{ task: Totals; phase: Totals; round: Totals } | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  return { task: copyTotals(handle.boot.task), phase: copyTotals(handle.boot.phase), round: copyTotals(handle.boot.round) }
}

// 历轮聚合读数(T-006 轮次完成行的"历轮累计"段): history 副本(rounds = 已滚出
// 轮数,totals 为历轮合计,不含本轮 roundB)。rounds = 0 时调用方省略历轮段。
export async function statsHistory(
  dir: string | undefined,
): Promise<{ rounds: number; totals: Totals } | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  return { rounds: handle.doc.history.rounds, totals: copyTotals(handle.doc.history.totals) }
}

// ===== 会话与等待(statsSessionBegin/End、statsWaitBegin/End)=====

// 会话期心跳周期: fold+落盘,限制 kill -9 损失 ≤ ~30s(折旧只承认到 lastWriteAt)。
const HEARTBEAT_MS = 30_000

// sessions 淘汰上限: 超 64 按 at(最后活跃时刻)淘汰最旧(聚合已入三桶,无损)。
const MAX_SESSIONS = 64

function startHeartbeat(dir: string, handle: Handle) {
  if (handle.timer) return // 已在跳(嵌套/并行会话共用一个)
  handle.timer = setInterval(() => {
    fold(handle)
    queueWrite(dir, handle)
  }, HEARTBEAT_MS)
  handle.timer.unref() // 不阻止进程退出
}

function stopHeartbeat(handle: Handle) {
  if (handle.timer) clearInterval(handle.timer)
  handle.timer = undefined
}

function addUsage(target: Usage, delta: Usage) {
  target.input += num(delta.input)
  target.output += num(delta.output)
  target.reasoning += num(delta.reasoning)
  target.cacheRead += num(delta.cacheRead)
  target.cacheWrite += num(delta.cacheWrite)
  target.cost += num(delta.cost)
  target.steps += num(delta.steps)
}

// prompt 下发前(runner attempt): fold 当前段后开 AI 段、关联当前任务并启动 30s
// 心跳(fold+落盘,unref)。
// AUTO-DECISION: begin 时不落盘——紧接的首次心跳(≤30s)即把 fold 结果持久化,
// kill -9 损失仍受心跳周期上界约束;备选"begin 即 queueWrite"只缩小数秒窗口却
// 每次会话多一次写盘,否决。
// begin 时已有进行中会话(并行/异常路径未配对 end): 旧会话的内存累计被遗弃(三桶
// 已入账无损,per-session 宁少不多),新会话从零累计。
export async function statsSessionBegin(dir: string | undefined, taskID: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  fold(handle)
  handle.session = { task: taskID, aiMs: 0, waitMs: 0 }
  handle.doc.open = { at: clock(), ai: true }
  startHeartbeat(dir, handle)
}

// statsSessionEnd 的打印用报告(◉ 会话结束行,T-003/T-004 消费): thisAiMs = 本次
// 会话 AI 时长;session = 该 sessionID 跨中断累计(含本次);task/phase/round = 三桶
// 当前累计副本(与 statsTotals 同口径)。
export type StatsSessionReport = {
  thisAiMs: number
  session: SessionStat
  task: Bucket
  phase: Bucket
  round: Bucket
}

// 回合结束(含 error/blocked/异常,runner 8 个 return 全带): fold、usage 入四层
// (task/phase/round 三桶 + per-session)、sessions 计数 +1、关 AI 段重开墙钟段、
// 停心跳、落盘,返回打印用报告。无配对 begin(下发失败等异常兜底)时 thisAiMs = 0,
// usage 与 sessions/rounds 计数照记——消耗真实发生,不丢。
export async function statsSessionEnd(
  dir: string | undefined,
  sessionID: string,
  usage: Usage,
): Promise<StatsSessionReport | undefined> {
  if (!dir) return undefined
  const { handle } = await ensure(dir)
  fold(handle)
  stopHeartbeat(handle)
  const active = handle.session
  handle.session = undefined
  const doc = handle.doc
  const now = clock()
  // 关 AI 段重开墙钟段;若正处于人工等待中(段已关),由 waitEnd 负责重开——
  // 把 wait.ai 拨回 false,等待结束后恢复的是墙钟段而非已结束会话的 AI 段。
  if (handle.wait.depth === 0) doc.open = { at: now, ai: false }
  else handle.wait.ai = false
  for (const bucket of [doc.taskB, doc.phaseB, doc.roundB]) {
    bucket.sessions += 1
    addUsage(bucket.usage, usage)
  }
  // per-session 续接: 同 sessionID 跨中断(fork 续跑)累加 rounds/aiMs/usage;
  // task 以本次 begin 关联为准(缺省沿用旧值/当前 taskB.id)。
  const entry = doc.sessions[sessionID] ?? {
    task: "",
    aiMs: 0,
    wallMs: 0,
    rounds: 0,
    usage: emptyUsage(),
    at: 0,
  }
  entry.task = active?.task ?? (entry.task || doc.taskB.id)
  entry.aiMs += active?.aiMs ?? 0
  entry.wallMs += (active?.aiMs ?? 0) + (active?.waitMs ?? 0)
  entry.rounds += 1
  addUsage(entry.usage, usage)
  entry.at = now
  doc.sessions[sessionID] = entry
  evictSessions(doc)
  queueWrite(dir, handle)
  return {
    thisAiMs: active?.aiMs ?? 0,
    session: { ...entry, usage: { ...entry.usage } },
    task: extrapolate(doc, doc.taskB),
    phase: extrapolate(doc, doc.phaseB),
    round: extrapolate(doc, doc.roundB),
  }
}

// 超上限按 at 升序淘汰最旧(淘汰无损: 聚合已入三桶;per-session 展示丢历史属
// 已接受取舍,见 context.md 风险节)。
function evictSessions(doc: StatsDoc) {
  const ids = Object.keys(doc.sessions)
  if (ids.length <= MAX_SESSIONS) return
  ids.sort((a, b) => doc.sessions[a].at - doc.sessions[b].at)
  for (const id of ids.slice(0, ids.length - MAX_SESSIONS)) delete doc.sessions[id]
}

// 人工等待开始(askHuman/stepPause/--wait-between): 嵌套深度 +1;最外层 fold 当前
// 段后关段(等待期间 aiMs/wallMs 均不增长——总用时排除纯人工等待,计划 :14/:52)并
// 落盘。reason 目前不消费(计划签名预留,供将来审计/vlog)。
export async function statsWaitBegin(dir: string | undefined, reason?: string): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  handle.wait.depth += 1
  if (handle.wait.depth > 1) return // 嵌套: 重叠等待只计一次
  fold(handle)
  handle.wait.ai = handle.doc.open?.ai ?? false
  handle.wait.start = clock()
  handle.doc.open = undefined
  queueWrite(dir, handle)
}

// 人工等待结束: 深度归零时 waitMs 单记入三桶(clampTick 钳制,会话内则同时计入
// per-session wallMs),并按关段前的 ai 标志重开段、落盘。无配对 begin 空转。
export async function statsWaitEnd(dir: string | undefined): Promise<void> {
  if (!dir) return
  const { handle } = await ensure(dir)
  if (handle.wait.depth === 0) return
  handle.wait.depth -= 1
  if (handle.wait.depth > 0) return
  const now = clock()
  const ms = clampTick(now - handle.wait.start)
  if (ms) {
    for (const bucket of [handle.doc.taskB, handle.doc.phaseB, handle.doc.roundB]) {
      bucket.waitMs += ms
    }
    if (handle.session) handle.session.waitMs += ms
  }
  handle.doc.open = { at: now, ai: handle.wait.ai }
  queueWrite(dir, handle)
}
