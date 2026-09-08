// 引用预清理脚本(独立于会话挂点的一次性入口,stable-refs §4.5): 在正式运行
// 迁移驱动前,对工作目录手动执行一轮 autoCorrectRefs——git rename 配对 → 活文档
// 引用机械改写 → 缺失恢复(refcheck-scope P2: missing 引用经 git 历史 rename
// 地图追踪落点就地恢复)→ 复扫并维护失效清单 .auto/invalid-refs.md(只登记未恢复
// 项,仅新出现的 ⚠)。
// 典型场景: 遗留工作树按新目录结构重组(移动/改名无需手动 git add,配对前脚本
// 自动全量暂存)后运行本脚本,文档引用即机械改写到新路径;剩余缺失引用以
// .auto/invalid-refs.md 为人工核验订正入口。改写与扫描范围 = docs/**/*.md
// (排除 docs/phases/**,stable-refs §3.3)——重组时请先把文档归位 docs/ 再跑。
// 用法: bun script/fix-refs.ts [dir](缺省当前目录)
// 退出码: 0 无失效引用;1 用法/环境错误或仍有失效引用(清单即处置入口)。
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { autoCorrectRefs, gitAvailable } from "../src/refcheck"

const dir = resolve(process.argv[2] ?? ".")
const info = await stat(dir).catch(() => undefined)
if (!info?.isDirectory()) {
  console.error(`目录不存在: ${dir}`)
  process.exit(1)
}
console.log(`引用预清理: ${dir}`)
if (!(await gitAvailable(dir))) console.log("  note: 非 git 目录,rename 配对不可用(仅校验 + 失效清单)")
const findings = await autoCorrectRefs(dir)
console.log(
  findings.length
    ? `仍有失效引用 ${findings.length} 处,人工核验订正入口: .auto/invalid-refs.md`
    : "无失效引用",
)
process.exit(findings.length ? 1 : 0)
