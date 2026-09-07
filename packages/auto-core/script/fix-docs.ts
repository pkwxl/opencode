// 文档树预整理脚本(fix-docs,一次性手动入口): 在正式运行迁移驱动前对遗留
// 工作目录一条龙执行——① migrateLegacyDocs 目录树还原为新结构(docs/ 平铺
// 任务文档 → docs/T-NNN/<role>.md 等,stable-refs §4.1;冲突按 mtime 最新
// 优先占领空闲目标位,目标被占/非空目录不移动原地保留,空目录不算冲突;旧
// 引用记号按映射机械改写);② autoCorrectRefs(git rename 配对改写手动重组
// 的文件移动 + 复扫失效引用落 .auto/invalid-refs.md,仅新出现的 ⚠)。
// 用法: bun script/fix-docs.ts [dir](缺省当前目录)
// 退出码: 0 无失效引用;1 用法/环境错误或仍有失效引用(清单为人工订正入口)。
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { migrateLegacyDocs } from "../src/docpaths"
import { autoCorrectRefs } from "../src/refcheck"

const dir = resolve(process.argv[2] ?? ".")
const info = await stat(dir).catch(() => undefined)
if (!info?.isDirectory()) {
  console.error(`目录不存在: ${dir}`)
  process.exit(1)
}
console.log(`文档树预整理: ${dir}`)
const { moved, rewritten, skipped } = await migrateLegacyDocs(dir)
console.log(`  ↻ 目录化迁移: 搬移 ${moved.length} 项,活文档引用改写 ${rewritten.length} 个文件`)
if (skipped.length) console.log(`  ↻ 冲突跳过 ${skipped.length} 项(登记 .auto/migrate-skips.md,仅首次警告)`)
const findings = await autoCorrectRefs(dir)
console.log(
  findings.length
    ? `仍有失效引用 ${findings.length} 处,人工核验订正入口: .auto/invalid-refs.md`
    : "无失效引用",
)
process.exit(findings.length ? 1 : 0)
