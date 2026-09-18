// runner 系单测的共享夹具: 示例任务 task、fake client 族(fakeClient/sseClient/retryClient/idleStream)、
// git 临时仓库助手(git/freshRepo)。拆分自 test/runner.test.ts(docs/module-split-plan.md S18,纯搬运);
// 放 fixtures/ 子目录——bun test 只收 *.test.ts,本文件不会被当测试跑。

import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { OpencodeClient } from "@opencode-ai/sdk/v2"
import { parse } from "../../src/plan"

export const task = parse(
  "PLAN.md",
  `## T-001: 示例任务 [pending]
正文。
`,
).tasks[0]!

// 立即结束的事件流: 只发一个属于 sessionID 的 idle 事件(watch 据此正常结算)。
async function* idleStream(sessionID: string) {
  yield { type: "session.idle", properties: { sessionID } }
}

// 最小 fake client(仅覆盖 runner 用到的表面;缺省行为 = 全部成功):
// calls 记录 fork/create 调用,updates 记录会话改名参数。
export function fakeClient(
  over: {
    fork?: (sessionID: string) => unknown
    get?: (sessionID: string) => unknown
    prompt?: () => unknown
    messages?: (sessionID: string) => unknown
    // 事件流当前跟随的会话(未新建时的 idle 目标): 复用/恢复接管路径不调用
    // create,idle 事件须发给链上既有会话,否则 watch 收不到结束事件。
    current?: string
    // 自定义事件流(缺省为单 idle 正常结束流):收当前会话 id,便于测试发定向事件;
    // () => AsyncIterable 亦可(参数少者可赋给参数多者)。
    events?: (sessionID: string) => AsyncIterable<unknown>
  } = {},
) {
  const calls = {
    forks: [] as string[],
    creates: 0,
    updates: [] as { id: string; title: string }[],
    // 记录每次 prompt 下发参数,供模型路由断言(model 缺省时该属性不存在)。
    prompts: [] as { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[],
    // 每次 prompt 的 options.signal(H7: 探针判半开联动中止 POST 的断言点)。
    promptSignals: [] as (AbortSignal | undefined)[],
    // 记录 session.abort 调用的会话 id,供提前结算/断流清理断言(D.2 降级前必 abort)。
    aborts: [] as string[],
    // 提问答复/驳回(auto-resolve T-005): replies 记每次答复文案,rejects 记驳回的
    // requestID(重复提问走驳回 + abort)。
    replies: [] as string[],
    rejects: [] as string[],
    // 每次 fork 传入的分叉锚点(undefined = 整份分叉),供定版点分叉断言。
    forkAnchors: [] as (string | undefined)[],
    // 每次 promptAsync(steer)下发的文本,供截断续跑/交接 steer 断言。
    steers: [] as string[],
  }
  let seq = 0
  let lastCreated = over.current ?? "ses_new_0"
  const client = {
    session: {
      create: async () => {
        calls.creates++
        lastCreated = `ses_new_${++seq}`
        return { data: { id: lastCreated } }
      },
      fork: async (params: { sessionID: string; messageID?: string }) => {
        calls.forks.push(params.sessionID)
        calls.forkAnchors.push(params.messageID)
        const result = over.fork ? over.fork(params.sessionID) : { data: { id: `ses_fork_${calls.forks.length}` } }
        // fork 出的副本是后续 prompt 的下发目标,事件流跟随它(与 create 同规则)。
        const id = (result as { data?: { id?: string } }).data?.id
        if (id) lastCreated = id
        return result
      },
      get: async (params: { sessionID: string }) => (over.get ? over.get(params.sessionID) : { data: { id: params.sessionID } }),
      update: async (params: { sessionID: string; title: string }) => {
        calls.updates.push({ id: params.sessionID, title: params.title })
        return {}
      },
      prompt: async (
        params: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; parts: unknown[] },
        options?: { signal?: AbortSignal },
      ) => {
        calls.prompts.push(params)
        calls.promptSignals.push(options?.signal)
        return over.prompt ? over.prompt() : {}
      },
      promptAsync: async (params: { sessionID: string; parts: unknown[] }) => {
        calls.steers.push(String((params.parts[0] as { text?: string } | undefined)?.text ?? ""))
        return {}
      },
      abort: async (params?: { sessionID: string }) => {
        if (params?.sessionID) calls.aborts.push(params.sessionID)
        return {}
      },
      messages: async (params: { sessionID: string }) => (over.messages ? over.messages(params.sessionID) : { data: [] }),
    },
    question: {
      reply: async (params: { requestID: string; answers: string[][] }) => {
        calls.replies.push(params.answers.flat().join(""))
        return {}
      },
      reject: async (params: { requestID: string }) => {
        calls.rejects.push(params.requestID)
        return {}
      },
    },
    event: { subscribe: async () => ({ stream: over.events ? over.events(lastCreated) : idleStream(lastCreated) }) },
  } as unknown as OpencodeClient
  return { client, calls }
}

// 带 signal 透传的 fake 订阅: 记录 subscribe 收到的 AbortSignal;事件流先发一个
// idle 事件(watch 据此正常结算),finally 记录收尾——真实 SDK 生成器在消费方
// break 时经 return() 走 finally(仅 releaseLock 不断连接),由 driver 显式 abort
// 关闭底层连接,本测试断言的正是"信号已透传且各退出路径必然 abort"。
export function sseClient(
  id: string,
  over: { prompt?: () => unknown } = {},
) {
  const state = { signal: undefined as AbortSignal | undefined, closed: false }
  const client = {
    session: {
      create: async () => ({ data: { id } }),
      prompt: async () => (over.prompt ? over.prompt() : {}),
      abort: async () => ({}),
    },
    event: {
      subscribe: async (_params: unknown, options?: { signal?: AbortSignal }) => {
        state.signal = options?.signal
        const stream = async function* () {
          try {
            yield { type: "session.idle", properties: { sessionID: id } }
          } finally {
            state.closed = true
          }
        }
        return { stream: stream() }
      },
    },
  } as unknown as OpencodeClient
  return { client, state }
}

// 构造一个只发 session.error(可选 isRetryable)+ session.idle 的事件流,喂给
// fakeClient 同款的 subscribe——outcomes 按 create/fork 调用顺序逐个消费,
// 决定该次新建/分叉出的会话本轮是否报错。
export type Outcome = "error-retryable" | "error-fatal" | "ok"
// used: 与 outcomes 同序的"该次会话末端上下文用量"(给数字则每次会话同额),不给则为
// 0(纯报错桩)。
// 经 message.updated 事件注入,与真实链路同一条计量路径(input + cache.read)。
// message: 报错文案,决定 classifySessionError 的归类 —— 缺省 "usage limit" 落 quota
// (配额支的既有用例据此),传 transient/unknown 文案则走重试阶梯。
export function retryClient(outcomes: Outcome[], used: number[] | number = [], message = "usage limit") {
  // prompts 记每次下发参数(model 缺省时该属性不存在),供模型路由/降级断言。
  const calls = { forks: [] as string[], creates: 0, prompts: [] as { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }[] }
  const queue: unknown[] = []
  let index = 0
  let seq = 0
  const enqueue = (id: string) => {
    const tokens = typeof used === "number" ? used : (used[index] ?? 0)
    const outcome = outcomes[index++]
    if (tokens > 0) {
      queue.push({
        type: "message.updated",
        properties: {
          info: {
            id: `msg_${id}`,
            sessionID: id,
            role: "assistant",
            time: { completed: Date.now() },
            tokens: { input: tokens, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            providerID: "zai",
            modelID: "glm",
          },
        },
      })
    }
    if (outcome === "error-retryable" || outcome === "error-fatal") {
      queue.push({
        type: "session.error",
        properties: { sessionID: id, error: { name: "APIError", data: { message, isRetryable: outcome === "error-retryable" } } },
      })
    }
    queue.push({ type: "session.idle", properties: { sessionID: id } })
  }
  const client = {
    session: {
      create: async () => {
        calls.creates++
        const id = `ses_new_${++seq}`
        enqueue(id)
        return { data: { id } }
      },
      fork: async (params: { sessionID: string }) => {
        calls.forks.push(params.sessionID)
        const id = `ses_fork_${calls.forks.length}`
        enqueue(id)
        return { data: { id } }
      },
      update: async () => ({}),
      prompt: async (params: { sessionID: string; model?: { providerID: string; modelID: string }; parts: unknown[] }) => {
        calls.prompts.push(params)
        return {}
      },
      promptAsync: async () => ({}),
      abort: async () => ({}),
      messages: async () => ({ data: [] }),
      get: async (params: { sessionID: string }) => ({ data: { id: params.sessionID } }),
    },
    event: { subscribe: async () => ({ stream: (async function* () { while (queue.length) yield queue.shift() })() }) },
  } as unknown as OpencodeClient
  return { client, calls }
}

export async function git(dir: string, ...args: string[]) {
  const proc = Bun.spawn(["git", "-C", dir, ...args], { stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`git ${args.join(" ")} 退出码 ${code}: ${err || out}`)
  return out
}

export async function freshRepo() {
  const dir = await mkdtemp(join(tmpdir(), "auto-runner-"))
  await git(dir, "init", "-q")
  await git(dir, "config", "user.email", "t@t")
  await git(dir, "config", "user.name", "t")
  return dir
}
