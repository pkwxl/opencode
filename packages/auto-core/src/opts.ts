// 会话级选项与执行结局类型: runTask/runOnce 与各旁路会话共用的透传参数、
// 单元停机出口与提交结果联合,外加两个预算常量。纯类型 + 常量,无运行时依赖,
// 位于依赖图底层——任何模块都可引入而不拉进会话驱动图。
// 拆分自 src/runner.ts(plans/0024-module-split-plan.md S1,纯搬运)。
import type { Interactive } from "./interactive"
import type { ModeSpec } from "./mode"
import type { ServerControl } from "./server"

// 任务结局。dirty(plans/0021-commit-boundary-design.md)= 单元启动 clean 门禁失败的专用
// 出口: 不写 PLAN.md、不做清扫提交,git 状态的决定权在人工,调用方直接停机退出 2。
export type Outcome =
  | { type: "completed" }
  | { type: "blocked"; question: string }
  | { type: "incomplete"; reason: string }
  | { type: "dirty"; files: string[] }

// 单元停机出口(blocked = 问题写 PLAN.md + interrupted 清扫提交;dirty = 不写不扫,
// 人工处置 git 后重跑)。供各执行函数的返回联合引用,替代原 `Outcome & {type:"blocked"}`。
export type UnitStop = { type: "blocked"; question: string } | { type: "dirty"; files: string[] }

// A failing task-level acceptance feeds the gap back into the execution
// session chain; after this many unsuccessful fix rounds the task blocks for
// human intervention.
export const FIX_ROUNDS = 3

// 判定会话替换脚本的重验轮数上限(独立于修复轮预算)。
export const REVERIFY_ROUNDS = 3

// 完成条件门禁(plans/0021-commit-boundary-design.md P2): 返回 SessionCommit——统一提交
// 失败或(baseline 给出时)单元收口校验不通过 → failed,调用方按"不视为完成"
// 阻塞停机待人工;无 dir / 门禁关闭 → ok(旧行为)。baseline 仅在单元收口调用点
// (子任务末次提交/隐藏任务 spec.commit)传入。
export type SessionCommit = { type: "ok" } | { type: "failed"; question: string }

// --subtask 三档: off(单会话完成)/ auto(自动分解,缺省;子任务会话上下文达到
// 2x --context-limit 时同样交接文档 + 新会话续跑)/ ondemand(单会话执行,
// 上下文达到 2x --context-limit 时交接文档 + 新会话续跑)。
export type SubtaskMode = "off" | "auto" | "ondemand"

// --permission 四档: 权限请求(permission.asked)的处理策略,缺省 ask-deny。
// auto-allow 立即自动授权(always 放行,不等待);ask-* 先等人工(--wait-answer
// 分钟,未设则不等待即视为超时;allow/yes/y 等回答视为授权,明确拒绝的回答拒绝
// 该权限但会话继续),超时分别回落:ask-allow 自动授权 / ask-deny 自动拒绝但会话
// 继续(AI 无授权绕开) / ask-fail 拒绝并退出运行(阻塞停机)。
export type PermissionMode = "auto-allow" | "ask-allow" | "ask-deny" | "ask-fail"

// 会话级选项: runTask/runOnce 与终审任务生成会话(src/final.ts 复用
// requireArtifact)共用的透传参数。
export type Opts = {
  agent?: string
  // 目标目录;用于下发失败时检测 agent 契约文件缺失并给出恢复提示。
  dir?: string
  verbose?: boolean
  waitAnswer?: number
  // --commit false: 关闭 driver 的会话后统一提交(缺省启用;提交机制见 src/git.ts)。
  commit?: boolean
  subtask?: SubtaskMode
  // --verify: 启用 driver 的任务级三段式验收(脚本准备 → driver 执行 → 独立判定);
  // 缺省不启用——任务在收尾后直接标 done(不写 verified,未经验证不落账),
  // --review 的质量审核相应改为串行执行。
  verify?: boolean
  // dryrun 会话: 权限请求自动拒绝但不中断(供 AI 记录受阻项),提问一律自动答复。
  dryrun?: boolean
  // 上下文预算基线(tokens);缺省 64k(--context-limit n 以千 tokens 计):会话
  // 复用的已用量阈值为其一半,交接 steer 阈值为其 2 倍(ondemand 整任务会话与
  // auto 子任务会话)。
  contextLimit?: number
  // --review 质量审核轮数上限(0=不启用);终审任务(final 字段)被强制置 0
  // (见 pipeline),终审任务生成会话(src/final.ts)不受影响。
  review?: number
  // --early: 审核会话挪进 verify 脚本执行窗口并行(需 review>0,设计文档 F 节),
  // 经 verifyTask 审核挂点实现。
  early?: boolean
  // --permission 四档: 权限请求的处理策略,缺省 ask-deny(见 PermissionMode)。
  permission?: PermissionMode
  // --interactive 旁路: 每个会话建立/复用时 attach,人工输入经它注入会话;
  // ask 的人工等待也改由它接收(语义不变)。
  interactive?: Interactive
  // server 控制句柄: 新会话前 syncAgents(AGENTS.md 有更新则重启 server)、
  // 网络类会话错误 restart 换新实例后重试。
  server?: ServerControl
  // driver 托管脚本的看门狗: 持续无输出的判定窗口(缺省 10 分钟)与绝对时长上限
  // (缺省不设;config 的 idleTime / idleMax 以分钟设定,verify 与 test 脚本共用)。
  idleMs?: number
  maxMs?: number
  // --test-by-driver: 测试/编译/构建等命令的执行协议(与 verify 三段式正交,
  // config.testByDriver 持久化、run 注入)——执行类会话(子任务/整任务/修复轮)
  // 不在会话内直接运行这类命令,把命令写成脚本放 test/ 目录、把脚本路径写入
  // tmp/test.sh 由 driver 执行(存在即待执行请求),driver 合并 stdout/stderr
  // 整写 tmp/test.<n>.out,退出码与输出文件路径 steer 回原会话由 AI 直读判断。
  testByDriver?: boolean
  // --handover-test(需 --test-by-driver,config 持久化): 测试失败(非零退出或
  // 看门狗超时)且会话上下文已用达到 contextLimit 时,要求 AI 写交接文档
  // docs/<id>/testhandoff.md(子任务会话落 docs/<id>/S<两位序号>/testhandoff.md,
  // 整任务/修复轮为任务级;子任务完成即清除,防下一子任务误读遗留交接)并结束
  // 会话,driver 开新会话据其续跑,防止在超大上下文中反复试错。
  handoverTest?: boolean
  // -m/--mode 场景模式(缺省 migrate): 透传给执行类与初始化提示词渲染。
  mode?: ModeSpec
  // --new-session: 中断恢复时跳过会话复用(即使被中断的会话仍存活也开新会话);
  // 阶段精确重入不受影响——仅放弃旧会话上下文,进度记录的 phase 照常指导续跑。
  newSession?: boolean
  // 阶段化流程下的当前阶段字母(loop 透传,缺省 undefined = 单次运行): "v"
  // (验收)阶段任务本身即检验,强制 review=0 且跳过任务级三段式验收——与终审
  // 任务的 final 字段共用同一豁免路径,为内部标记、不写 PLAN.md(设计文档
  // plans/0006-phases-design.md D.3)。
  phase?: "a" | "d" | "m" | "t" | "v" | "k"
  // --no-wrapup(config.wrapup 持久化,缺省 true): 关闭时每个任务的子任务/整
  // 任务执行完成后跳过收尾会话(renderWrapup),修复轮后的收尾同样跳过。
  wrapup?: boolean
}

// 上下文预算默认基线(tokens);--context-limit n 以千 tokens 覆盖。会话复用阈值
// 为其一半、交接 steer 阈值为其 2 倍。
export const DEFAULT_CONTEXT_LIMIT = 64_000
