#!/usr/bin/env bun
// JSON-only CLI (plan 0066 §5): every output line is JSON on stdout — compact
// by default, two-space indented with --pretty. Exit codes: 0 success (a batch
// query with some accounts succeeding counts as success), 1 query failure
// (network / credentials / endpoint), 2 usage error.

import { clearToken, isValidLabel, readMeta, saveToken } from "./store.js"
import { expiryInfo, maskToken } from "./jwt.js"
import { listAccounts, queryQuota } from "./query.js"
import type { FetchLike, ProviderId } from "./types.js"

const USAGE =
  "usage: quota <kimi|zhipu> [query|list|token <label> <value|--stdin|--clear>] [--account <label>] [--token <value>] [--org <org>] [--project <proj>] [--pretty]"

const PROVIDERS: readonly string[] = ["kimi", "zhipu"]
const VALUE_FLAGS = new Set(["--account", "--token", "--org", "--project"])
const BOOL_FLAGS = new Set(["--pretty", "--stdin", "--clear"])

export interface CliIo {
  /** Output sink (one JSON text per call, newline added); defaults to stdout. */
  write?: (line: string) => void
  /** Stdin replacement for `token <label> --stdin` (tests). */
  stdin?: string
  /** Token-store base override (tests). */
  home?: string
  fetchImpl?: FetchLike
  /** Environment override (tests); defaults to process.env. */
  env?: Record<string, string | undefined>
}

interface ParsedArgs {
  provider: ProviderId
  sub: string
  positional: string[]
  values: Map<string, string>
  bools: Set<string>
}

class UsageError extends Error {}

function isProvider(s: string): s is ProviderId {
  return s === "kimi" || s === "zhipu"
}

function parseArgs(argv: string[]): ParsedArgs {
  const values = new Map<string, string>()
  const bools = new Set<string>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith("--")) {
      if (VALUE_FLAGS.has(arg)) {
        if (i + 1 >= argv.length) throw new UsageError(`选项 ${arg} 缺少值`)
        values.set(arg, argv[i + 1])
        i++
      } else if (BOOL_FLAGS.has(arg)) {
        bools.add(arg)
      } else {
        throw new UsageError(`未知选项 ${arg}`)
      }
    } else {
      positional.push(arg)
    }
  }
  if (positional.length < 1) throw new UsageError("缺少 provider")
  const providerArg = positional[0]
  if (!isProvider(providerArg)) {
    throw new UsageError(`未知 provider "${providerArg}"（可用：${PROVIDERS.join("、")}）`)
  }
  return { provider: providerArg, sub: positional.length > 1 ? positional[1] : "query", positional, values, bools }
}

export async function runCli(argv: string[], io: CliIo = {}): Promise<number> {
  const write = io.write ?? ((line: string) => process.stdout.write(`${line}\n`))
  const print = (v: unknown, pretty: boolean) => write(JSON.stringify(v, null, pretty ? 2 : undefined))
  const usageExit = (msg: string): number => {
    print({ ok: false, error: msg, usage: USAGE }, false)
    return 2
  }
  try {
    const args = parseArgs(argv)
    const pretty = args.bools.has("--pretty")
    switch (args.sub) {
      case "query": {
        if (args.positional.length > 2) throw new UsageError("query 子命令不接受位置参数")
        const r = await queryQuota(args.provider, {
          account: args.values.get("--account"),
          token: args.values.get("--token"),
          home: io.home,
          env: io.env,
          fetchImpl: io.fetchImpl,
        })
        if (!r.ok) return usageExit(r.error)
        print({ ok: true, value: r.value }, pretty)
        return r.value.results.some((x) => x.ok) ? 0 : 1
      }
      case "list": {
        if (args.positional.length > 2) throw new UsageError("list 子命令不接受位置参数")
        const r = await listAccounts(args.provider, { home: io.home })
        if (!r.ok) return usageExit(r.error)
        print({ ok: true, value: r.value }, pretty)
        return 0
      }
      case "token":
        return await tokenCommand(args, io, print)
      default:
        return usageExit(`未知子命令 "${args.sub}"`)
    }
  } catch (e) {
    if (e instanceof UsageError) return usageExit(e.message)
    // Unexpected: never leak a stack or request material (plan 0066 §2 masking discipline).
    print({ ok: false, error: "内部错误" }, false)
    return 1
  }
}

async function tokenCommand(
  args: ParsedArgs,
  io: CliIo,
  print: (v: unknown, pretty: boolean) => void,
): Promise<number> {
  const pretty = args.bools.has("--pretty")
  if (args.positional.length < 3) throw new UsageError("token 子命令缺少 <label>")
  const label = args.positional[2]
  if (!isValidLabel(label)) throw new UsageError(`非法 label "${label}"（需字母/数字开头，仅含字母数字._-）`)
  const provider = args.provider
  if (args.bools.has("--clear")) {
    if (args.bools.has("--stdin") || args.values.has("--token") || args.positional.length > 3) {
      throw new UsageError("--clear 不接受令牌值")
    }
    await clearToken(provider, label, io.home)
    print({ ok: true, value: { provider, account: label, cleared: true } }, pretty)
    return 0
  }
  let token: string
  if (args.bools.has("--stdin")) {
    if (args.positional.length > 3) throw new UsageError("--stdin 不接受位置令牌值")
    const text = io.stdin ?? (await Bun.stdin.text())
    token = text.trim()
    if (token === "") throw new UsageError("stdin 未提供令牌")
  } else {
    if (args.positional.length < 4) throw new UsageError("缺少令牌值（位置参数或 --stdin）")
    if (args.positional.length > 4) throw new UsageError("多余的令牌参数")
    token = args.positional[3].trim()
    if (token === "") throw new UsageError("令牌值为空")
  }
  // Merge org/project into the existing metadata so a plain re-save keeps them.
  const meta: Record<string, unknown> = { ...(await readMeta(provider, label, io.home)) }
  const org = args.values.get("--org")
  if (org !== undefined) meta.org = org
  const project = args.values.get("--project")
  if (project !== undefined) meta.project = project
  await saveToken(provider, label, token, Object.keys(meta).length > 0 ? meta : undefined, io.home)
  const info = expiryInfo(token)
  const value: Record<string, unknown> = { provider, account: label, masked: maskToken(token) }
  if (info.expiresAt !== undefined) {
    value.tokenExpiresAt = info.expiresAt
    value.tokenStale = info.stale
  }
  print({ ok: true, value }, pretty)
  return 0
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2))
}
