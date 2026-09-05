#!/usr/bin/env bun
import { fileURLToPath } from "url"

// 一次性生成独立可执行文件 dist/auto-migrate(模板与 SDK 均已嵌入)。
// 用法: bun run build [--target <bun-平台三元组>]
const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const TARGETS = [
  "bun-linux-x64",
  "bun-linux-arm64",
  "bun-linux-x64-musl",
  "bun-linux-arm64-musl",
  "bun-darwin-x64",
  "bun-darwin-arm64",
  "bun-windows-x64",
] as const

const index = process.argv.indexOf("--target")
const raw = index === -1 ? undefined : process.argv[index + 1]
const target = TARGETS.find((item) => item === raw)
if (raw && !target) {
  console.error(`未知 --target: ${raw}\n可选值: ${TARGETS.join(", ")}`)
  process.exit(1)
}
// 交叉编译时按平台后缀区分产物,避免覆盖本机二进制。
const outfile = target ? `dist/auto-migrate-${target.replace(/^bun-/, "")}` : "dist/auto-migrate"

const result = await Bun.build({
  entrypoints: ["src/index.ts"],
  minify: true,
  compile: { ...(target ? { target } : {}), outfile },
})
if (!result.success) {
  for (const log of result.logs) console.error(log)
  process.exit(1)
}
console.log(`已生成独立可执行文件: ${outfile}`)
