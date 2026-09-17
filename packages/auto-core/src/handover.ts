import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"

// 测试交接(--handover-test)的中断恢复,见 docs/test-handover-early-design.md §I。
//
// 一次测试交接的时序是: 定版提交 #1 → 会话收尾并写交接文档 → 归档为
// testhandoff-<n>.md → 交接提交 #2 → 执行定版时消费出来的脚本 → 开续跑会话。
// driver 在其中任何一点被打断,重新运行时都要能精确落回被打断的位置——判据是
// **文件状态 × 提交状态**:交接文档在不在、完不完整、归档了没有、归档份落没落账。
// 本模块提供这套判定(纯函数,便于穷举单测)与它需要的、从文件和提交推不出来的
// 身份信息(待跑脚本、可供 fork 的会话锚点)的落盘记录。

// 在途交接记录(.auto/handover.json): 只记观测量推不出来的东西。记录丢失不使
// 机制失效——文件与提交状态仍能定出阶段,只是退化为"不知道该跑哪个脚本、没有
// 会话可 fork",按最新一次测试输出续跑。
export type Handover = {
  task: string
  // 交接文档相对目标目录的路径(docs/<id>/testhandoff.md 或
  // docs/<id>/S<kk>/testhandoff.md),兼作执行范围标识——记录只对本范围有效。
  scope: string
  // 提交信息构造用(watch 不持有执行范围标签,经定版处带下来)。
  unit: string
  n: number
  // 定版那一刻消费 tmp/test.sh 得到的待跑脚本与归档序号;并发态
  // (OPENCODE_AUTO_HANDOVER_CONCURRENT=on)定版即起跑,无待跑脚本可记。
  script?: string
  seq?: number
  // 定版那一刻的会话与末条消息 id: 收尾未完成时从这里 fork 出新会话重做收尾
  // (fork 复制 target 之前的消息,故取末条消息的**后一条**作锚点)。
  pinSession?: string
  pinMessage?: string
  // 收口之后开出的续跑会话: 它自己也可能被打断,恢复时从它 fork。
  nextSession?: string
  // 定版脚本的执行结果固化(F6 修订,2026-09-17): 收口执行落定即随记录写入——
  // 本地脚本除断电/强制终止外必然跑完,已执行即视为完成,恢复不再重复执行,
  // 凭此引用落盘的输出(详见设计文档 test-handover-early-design.md §M)。
  // 结构与 TestRunInfo 一致(结构化声明避免 handover → prompt 的反向依赖)。
  ran?: {
    script: string
    seq: number
    code: number
    ms: number
    timedOut: boolean
    timeoutReason?: "idle" | "max"
    out: string
  }
}

const FILE = join(".auto", "handover.json")

export async function saveHandover(dir: string, record: Handover): Promise<void> {
  await mkdir(join(dir, ".auto"), { recursive: true })
  await Bun.write(join(dir, FILE), JSON.stringify(record))
}

// 读取属于该执行范围的在途记录;范围不符、文件缺失或损坏返回 undefined
// (下一执行范围不得续上一范围的交接,与交接文档按范围命名同一道理)。
export async function recallHandover(dir: string, task: string, scope: string): Promise<Handover | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Handover>
    if (parsed.task !== task || parsed.scope !== scope) return undefined
    if (typeof parsed.unit !== "string" || typeof parsed.n !== "number") return undefined
    return parsed as Handover
  } catch {
    return undefined
  }
}

// 任一范围的在途记录(不校验范围): 流水线开头判断"本任务是否有测试交接在途"
// ——在途则不做陈旧清理,把交接文档交给恢复状态机。
export async function peekHandover(dir: string, task: string): Promise<Handover | undefined> {
  const raw = await Bun.file(join(dir, FILE)).text().catch(() => undefined)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as Partial<Handover>
    return parsed.task === task && typeof parsed.n === "number" ? (parsed as Handover) : undefined
  } catch {
    return undefined
  }
}

export async function forgetHandover(dir: string): Promise<void> {
  await rm(join(dir, FILE), { force: true })
}

// 交接文档的状态行(`状态: 继续|完成`): ondemand 的 handoff.md 与测试交接的
// testhandoff.md 共用同一判据(交接边界写核,session-recovery-fidelity-design.md
// 3.3 R3)。undefined = 缺失/无效。
//
// 两种交接对这行的用法不同。handoff.md 的交接 steer 只是**建议**交接,会话真把活
// 干完了自然无需交接,故 `完成` 是一条真实出口,runSubtask 据此收口。测试交接没有
// 这条出口: 测试结果必须由下一个会话判读,交接之后一定还有工作,`完成` 不可达——
// test-wrapup.md 因此只要求写 `状态: 继续`,driver 也只消费"这行在不在"(见
// handoffComplete),不对值分支。解析仍兼收两值: 会话万一写了 `完成`,按写完处理
// 好过判成半截文件要求重写。
export function handoffStatus(text: string): string | undefined {
  return /状态[:：]\s*(继续|完成)/.exec(text)?.[1]
}

// 交接文档是否写完(F1/F2): 有状态行即完整;没有状态行但内容已落账(已跟踪且
// 与提交一致)同样视为完整——提交那一刻文件是整的,缺行只是该内容写于状态行
// 约定之前。两者都不满足的非空内容按"半截文件"处理(driver 死在会话写文件途中)。
export function handoffComplete(content: string | undefined, committed: boolean): boolean {
  if (content === undefined || content.trim() === "") return false
  return handoffStatus(content) !== undefined || committed
}

// 交接时序被打断的位置:
// - none   无交接痕迹,现状流程
// - wrapup 定版已提交、收尾未完成 → 从定版锚点 fork 重做收尾
// - commit 交接文档已写完但未收口 → 归档(如未归档)+ 提交 #2 + 执行 + 续跑
// - test   归档份已落账(提交 #2 已发生)→ 执行 + 续跑
// 判定只看观测量;记录的有无不改变阶段,只决定"执行"这一步是重跑记录里的脚本
// 还是退化为引用最近一次测试输出。
export type HandoverStage = "none" | "wrapup" | "commit" | "test"

// 恢复观测序号与归档续号基数(防伪: 会话在 testhandoff-<n>.md 命名族里的自行
// 落笔不是交接证据)。阶段观测以在途记录的 n 为权威——记录由 driver 在交接收口
// 时写下,指着真正收口的那份归档;记录缺失(机制上线前的存量现场)才回落盘扫描。
// 归档续号取两侧最大: 盘上即使躺着误写件也不覆盖,续号跳过它(设计文档
// test-handover-early-design.md §I,2026-09-17 修订)。
export function handoverSeq(record: Handover | undefined, diskMax: number): { observed: number; nextBase: number } {
  const observed = record?.n ?? diskMax
  return { observed, nextBase: Math.max(diskMax, observed) }
}

export function handoverStage(observed: {
  // 在途记录(仅用于区分"收尾未完成"与"从来没交接过")。
  record?: Handover
  // 当前份 testhandoff.md 的内容(undefined/空白 = 不在盘)与它是否已落账。
  current?: string
  currentCommitted: boolean
  // 归档份 testhandoff-<n>.md 是否在盘、是否已落账。
  archived: boolean
  archivedCommitted: boolean
}): HandoverStage {
  // 空文件与不在盘等价: 会话建了文件还没写就被打断,内容量是零。
  const current = observed.current?.trim() ? observed.current : undefined
  if (observed.archived) return observed.archivedCommitted ? "test" : "commit"
  if (handoffComplete(current, observed.currentCommitted)) return "commit"
  // 文档不完整(或不在盘): 有定版记录才谈得上"收尾未完成";没有记录又没有文档
  // 就是没有交接在途。记录在而文档半截 → 重做收尾。
  if (observed.record) return "wrapup"
  // 没有记录却留着一份半截文档(本机制上线前的存量现场): 已经写下的内容仍是
  // 进度,按已交接收口处理,不凭空重做。
  return current === undefined ? "none" : "commit"
}
