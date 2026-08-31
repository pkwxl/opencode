# init 项目配置固化与 AGENTS.md 维护规则 — 设计说明

> 本文档是"run 选项迁移 init 固化"(`.opencode/auto/config.json` 项目配置层)与
> "AGENTS.md 瘦身维护规则"(第四标记块 `opencode-auto:maint`)的唯一设计基准:
> 实现任务以本文为准。P1..P4 分期已全部实现(init/run 选项面与 §B/§C 一致,
> 维护规则块、check 行数 note 与 README/包内 AGENTS.md 文档均已生效)。

## 背景与动机

1. **宪法级选项的跨 run 漂移**:`run` 每次重新接受 `-m/--mode`、`--agent`、
   `--verify`、`--commit`、`--subtask`、`--context-limit` 等"决定会话被如何告知、
   验收与提交语义如何运作"的开关。同一目标目录跨天/跨人运行忘带参数即回落缺省,
   与上次运行语义错配。`.auto/config.json` 的 mode 持久化与"init 与 run 应使用
   相同模式"的警告(src/index.ts resolveModeFlag)正是该症状的首个补丁——补丁
   应推广为原则:**项目属性在 init 固化,run 只控制本次执行**。
2. **AGENTS.md 原则块与运行选项失配**:init 写入验证原则块与提交原则块、PLAN.md
   模板的 verify 字段说明、init -p 规划提示词,共同假设"验证/提交执行权在
   driver";而 `--verify false` / `--commit false` 是 run 选项——关闭时会话读到的
   AGENTS.md 契约描述的是一条并不运转的流水线,原则块成空文。同样,`--agent` /
   `--context-limit` 分别决定系统提示词契约与模型上下文预算,run 中途更换即中途
   改宪法。
3. **AGENTS.md 膨胀风险**:AGENTS.md 不在只读之列(任务可更新其余内容),长迁移
   (数十任务 × 多会话)中没有约束防止它累积实现细节、命令输出、一次性决策,逐渐
   退化为"项目百科全书 + 垃圾堆";而它作为 system context 每个 provider turn 都会
   进入上下文,膨胀直接侵蚀全部会话的有效上下文。需要一个极简的维护协议(外部
   讨论已给出方向:工作流入口 + 路由 + 更新纪律,而非知识库架构)。

## 1. 与现状的关系(不变量)

- driver 独占状态写入、统一提交、全局单会话、进度恢复、终审闭环等机制零改动;
- `runAll` / `runTask` 的 Opts 形状不变:配置由 `src/index.ts` 解析后照常注入
  (loop/runner 不感知配置来源;e2e 直调 `runAll(dir, {})` 不受影响);
- AGENTS.md 三个既有标记块(指针/验证/提交)机制不变,第四块沿用同一幂等追加
  机制(driver 只追加标记块、永不改写其余内容的原则不变);
- 模式层仍是提示词级引导,不进调度状态机;`loadModes` / `parseModeFile` 协议
  不变。

## 2. 外部建议(ChatGPT)的适配映射

该建议面向"通用线性开发工作流";本包是迁移自动化 driver,按下表适配:

| 外部建议 | 处置 |
| --- | --- |
| Workflow / Current Task / 线性阶段状态机 | **已有机制覆盖,不在 AGENTS.md 复述**:阶段 = PLAN.md 任务序,当前任务 = CURRENT.md 镜像,角色 = 会话提示词指派;AGENTS.md 复述流程会形成第二事实源,与 PLAN/提示词漂移 |
| Context Routing(`docs/agents/*.md`) | **采纳(轻量)**:作为维护规则块第 2 条的路由约定;不预置 architecture/implementation/testing 骨架——迁移项目的主题文件由会话按需创建 |
| ≤150 行 / Update don't append / 只沉淀持久知识 | **采纳**:维护规则块第 1/3/4 条,压缩为四条中文规则 |
| AGENTS.md Maintenance Rules 章节 | **采纳为第四标记块** `opencode-auto:maint`:与指针/验证/提交块同机制,init/run 幂等补写,对会话与人工同等可见 |
| Architect→Implementer→Tester 显式角色流程 | **不采纳字面流程**:本包执行流由 driver 调度(分解/子任务/收尾/判定/审核),AGENTS.md 只承载入口与纪律 |
| 知识库 / Memory GC / ADR 等重型机制 | **不采纳**:迁移场景以 PLAN.md + docs/ 过程产物 + 知识提取(fixme-knowledge-design §D,未来)覆盖,AGENTS.md 保持入口定位 |

## 3. 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 配置载体 | `.opencode/auto/config.json`(新增;**版本化、随仓库共享、人工可编辑**)。不沿用 `.auto/config.json`——整个 `.auto/` 被 gitignore,是运行时状态,宪法应进 git 历史审计。未知键忽略(前向兼容) |
| 配置内容 | 全键显式:`mode / agent / contextLimit / subtask / verify / verifyIdle / verifyMax / commit`(schema 见 §A);init 写出完整文件 |
| 迁移至 init 的选项 | `-m/--mode`、`--agent`、`--context-limit`、`--subtask`、`--verify`、`--verify-idle`、`--verify-max`、`--commit`(分类总表见 §4) |
| run 侧处置 | 上述选项在 `run` 出现即用法错误(退出码 1),报文给出修订指引(`init --<flag> <值>` 或直接编辑 config);镜像 `--commit-subtask` 移除的既有先例 |
| init 合并语义 | **仅写命令行显式给出的键**,未给出的键保留既有配置值(新项目取内置缺省)→ init 兼具创建与修订(amend)两种身份;重复 init 无参数不重置已有配置 |
| 人工修订通道 | 直接编辑 `.opencode/auto/config.json`;坏 JSON / 越界值 / 未注册模式 → run 与 init 均退出码 1 并指明键名(严格失败优于静默回落) |
| 模式解析收口 | `-m` 仅 init 接受;resolveModeFlag 的"与持久化不一致警告"随固化消失(不再存在 run 侧分歧);run 读 `config.mode` → `loadModes` 查找,未注册名按环境错误退出 1 |
| 原则块表述 | AGENTS.md 三个既有块保持**与配置无关的不变式**表述(会话不跑验证/不提交),不随 verify/commit 开关改写——避免配置与 AGENTS.md 双源;生效配置由 run 启动横幅与 status 打印 |
| 留在 run 的选项 | `--server / --verbose / -i / --wait-answer / --wait-between / --permission / --review / --early(--early-review) / --final-review / --dryrun`(理由见 §4) |
| AGENTS.md 维护规则 | 第四标记块 `opencode-auto:maint`(全文见 §D.1):精简(≤150 行)/ 路由不复制(docs/agents/)/ 更新不追加 / 只沉淀持久工作流知识 |
| agent 契约同步 | `templates/.opencode/agent/auto.md` 更新 AGENTS.md 相关条款:不得改写任何 opencode-auto 标记块、更新其余内容须遵守维护规则块(init 总是替换该文件 → 旧项目一次 init 即升级) |
| config 只读护栏 | `.opencode/auto/config.json` 加入 src/protect.ts 的 FILES(run 期间 chmod 0o444;人工修订在 run 外进行) |
| check 扩展 | AGENTS.md 超 150 行输出 note(不计 findings、不影响退出码)——维护规则的唯一机器观测点 |

## 4. 选项分类总表

现状 run 选项逐一归类("迁移" = 移入 init 并持久化到 config):

| 选项 | 归属 | 理由 |
| --- | --- | --- |
| `-m/--mode` | **迁移** | 模式相关(用户点名);提示词级场景引导应全项目一致,现有持久化 + 警告已是症状补丁 |
| `--agent` | **迁移** | AGENTS.md/契约内容相关:agent 文件即系统提示词契约,init 生成并维护 auto.md;run 中途换 agent = 中途改行为宪法 |
| `--context-limit` | **迁移** | 模型相关:上下文预算依 agent 绑定的模型上下文窗口而定,与 agent 同时选定 |
| `--subtask` | **迁移** | 计划形态相关:auto 档经分解会话把检查项注入 PLAN.md(任务正文持久形态),与 off/ondemand 的整任务流水线提示词不同;中途切换使同一计划内任务执行形态混杂、跨 run 不一致 |
| `--verify` | **迁移** | AGENTS.md 内容相关:验证原则块 + PLAN verify 字段 + init -p 提示词三处在 init 时即假设该机制;run 关闭则原则块与 verify 字段成空文,"done"的含义(verified 与否)随 run 漂移 |
| `--verify-idle` / `--verify-max` | **迁移** | 参数化的是既定的验收机制,与 verify 同属验收宪法;机器差异经人工编辑 config 调整(config 本身就是修订通道) |
| `--commit` | **迁移** | AGENTS.md 内容相关:提交原则块在 init 下沉;`--commit false` 时块内"driver 统一提交"表述与实际不符,审计轨迹(git 历史)语义随 run 漂移 |
| `--server` | 留 run(+init -p) | 环境接入(本机是否有现成实例),非项目属性 |
| `--verbose` / `-i` | 留 run | 终端 UX |
| `--wait-answer` / `--wait-between` | 留 run | 本次运行的人机交互节奏(监督强度),逐次权衡 |
| `--permission` | 留 run | 本次运行的权限监督策略(ask-* 需人在场、与 dryrun 联动);opencode.json 的放行规则本身是 init 产物,策略是运行时监督,两者正交 |
| `--review` / `--early` / `--early-review` | 留 run | 审核深度与调度优化是逐次运行的成本权衡;产物(audit 报告 / fix 检查项)为附加文档,不改变 AGENTS.md 契约与计划静态形态(修复注入是 additive 修复机制,verify 差距修复亦同) |
| `--final-review` | 留 run | 终审闭环是"全部任务完成之后"的收尾触发器,逐次决定是否进入 |
| `--dryrun` | 留 run | 一次性检查模式 |

判别标准(写入 README):**"改它需要同时改 AGENTS.md / PLAN / 契约的表述,或它
描述的是模型/项目属性" → init;"只描述本次运行怎么跑、人怎么盯" → run。**

## A. 项目配置层 `src/config.ts`(新增)

```ts
import type { SubtaskMode } from "./runner"

// .opencode/auto/config.json 的全量模式;未知键忽略(前向兼容)。
export type ProjectConfig = {
  mode: string          // 须为 loadModes(dir) 已注册名
  agent: string         // 缺省 "auto";存在性仍由 run 前完整性检查兜底
  contextLimit: number  // 千 tokens(与 CLI 单位一致;run 侧 ×1000 注入 Opts)
  subtask: SubtaskMode
  verify: boolean
  verifyIdle: number    // 分钟,1..120
  verifyMax: number     // 分钟,0 = 不设,1..1440
  commit: boolean
}

export const CONFIG_DEFAULTS: ProjectConfig = {
  mode: "migrate", agent: "auto", contextLimit: 64, subtask: "auto",
  verify: false, verifyIdle: 10, verifyMax: 0, commit: true,
}

// 读取 + 校验: 文件缺失 → 缺省 + legacy 回落(.auto/config.json 的 mode);
// 坏 JSON / 键值越界 / mode 未注册(loadModes) → throw(中文报错含键名与期望),
// CLI 侧转退出码 1。run 与 init -p 均经此入口。
export async function loadProjectConfig(dir: string): Promise<ProjectConfig>

// init 用: 显式给出的键覆盖既有值,其余保留;返回待写回的完整配置。
export function mergeProjectConfig(existing: ProjectConfig, explicit: Partial<ProjectConfig>): ProjectConfig

// 普通整写(mkdir -p .opencode/auto;不在 protect 期内的写入,无需原子写)。
export async function saveProjectConfig(dir: string, config: ProjectConfig): Promise<void>

// run 启动横幅 / status 共用的一行摘要,如:
// 模式 migrate · agent auto · 子任务 auto · 验收 off · 看门狗 idle 10m/max 不设 · 提交 on · 上下文上限 64k
export function formatProjectConfig(config: ProjectConfig): string
```

- 落盘后校验的值域与既有 parse\* 一致(contextLimit 正整数;verifyIdle 1..120;
  verifyMax 0..1440;subtask/commit 取值枚举);init 的 CLI 解析复用
  src/index.ts 既有 parseCommit/parseSubtask/parseContextLimit/parseVerifyIdle/
  parseVerifyMax——两道关口径一致;
- legacy 回落仅当新文件不存在时生效;新文件一经写出,`.auto/config.json` 不再
  读取(不删除,留在 gitignore 内自然沉没);
- mode 校验依赖 `loadModes(dir)`,config.ts 由此依赖 mode.ts(方向:config →
  mode,与 prompt → mode 同向,无环);mode.ts 的 readPersistedMode/
  writePersistedMode 删除,职责并入本模块。

## B. init 改造(src/index.ts)

选项面(用法文本同步):

```
opencode-auto init [dir] [-p|--prompt <prompt-text>] [-m|--mode <name>] [--agent <name>]
    [--subtask [off|auto|ondemand]] [--verify [true|false]] [--verify-idle [1-120]]
    [--verify-max [1-1440]] [--commit [true|false]] [--context-limit [n]] [--server <url>]
```

流程(保持既有顺序骨架):

1. 解析显式键(复用既有 parse\* 函数;`-m` 经缩减版 resolveMode 校验注册名:
   显式值 > 既有 config 值 > 缺省);
2. `loadProjectConfig`(含 legacy 回落)→ `mergeProjectConfig` → 校验 →
   `saveProjectConfig`;
3. 打印生效配置(formatProjectConfig);
4. 既有步骤不变:usePromptLibrary → 模板复制(PLAN/opencode.json 跳过已存在、
   auto.md 总是替换)→ ensurePointer(含新的 maint 块,见 §D)→ ensureGitignore;
5. `-p` 会话的 agent 取合并后 config;
6. `--agent` 显式值仅持久化(与现状一致不做存在性校验,留给 run 前完整性检查)。

## C. run 改造(src/index.ts)

选项面:

```
opencode-auto run [dir] [--server <url>] [--verbose [true|false]] [--interactive|-i]
    [--wait-answer [1-60]] [--wait-between [1-60]] [--permission [auto-allow|ask-allow|ask-deny|ask-fail]]
    [--review [1-10]] [--early] [--early-review [1-10]] [--final-review [1-5]] [--dryrun [true|false]]
```

- 参数解析循环不动(`-m`/`--verify` 等照旧进 flags Map);**run 分支开头统一拒绝
  已固化选项**:`mode / agent / context-limit / subtask / verify / verify-idle /
  verify-max / commit` 任一出现 → 退出码 1,报文形如
  `--verify 已在 init 固化(.opencode/auto/config.json)。变更方式: opencode-auto init <dir> --verify <值>,或直接编辑该文件`(`-m` 报文同型);
  `--commit-subtask` 既有移除报文保留;
- `loadProjectConfig` 失败 → 退出码 1;成功后
  `log("⚙ 项目配置(.opencode/auto/config.json): " + formatProjectConfig(cfg))`
  (既有"沿用上次持久化的模式"提示随之删除);
- mode 解析:`loadModes(directory)[cfg.mode]`,未注册 → 退出码 1(报文列出支持
  的模式);
- 注入 runAll Opts(形状不变):`agent: cfg.agent`、
  `contextLimit: cfg.contextLimit * 1000`、`subtask/commit/verify` 直传、
  `verifyIdleMs/verifyMaxMs` 换算、`mode: ModeSpec`;`--review/--early/
  --permission/...` 照旧解析透传;
- loop 内既有降级提示(early 无 verify 窗口)按配置值自然触发,零改动;
- `status` 命令:加载 config 成功则在任务清单前打印同一行配置摘要(失败仅提示
  配置缺失/非法,不阻塞任务列表)。

## D. AGENTS.md 提示词优化

### D.1 第四标记块 `opencode-auto:maint`(src/loop.ts 常量 + ensurePointer 追加)

```text
<!-- opencode-auto:maint:start -->
AGENTS.md 维护规则(本文件是工作流入口,不是知识库):
1. 保持精简: 全文不超过 150 行;不写入实现细节、长解释、命令输出或单任务知识。
2. 路由不复制: 模块/阶段/任务特定的信息写入 docs/agents/<主题>.md,本文件只保留
   一行路由条目(主题 → 路径)。
3. 更新不追加: 新增信息前先检查既有规则或路由条目是否应修改;淘汰过时内容,
   不要累积历史备注。
4. 只沉淀持久的工作流知识: 仅记录会影响未来多数任务执行方式的约定;临时调试
   状态、一次性决策、对话过程不写入(一次性决策按 AUTO-DECISION 记入相关文档)。
<!-- opencode-auto:maint:end -->
```

- ensurePointer 增第四个布尔返回值 `maint`(幂等:文本含
  `opencode-auto:maint:start` 即跳过),init 与 runAll 两处调用点同步打印;
- 既有三个块的文本不动(它们描述的是与配置无关的不变式,见 §3"原则块表述")。

### D.2 agent 契约(templates/.opencode/agent/auto.md)

第 2 条中 AGENTS.md 段落改为:

> AGENTS.md 不在只读之列: 任务需要时可以更新它,但不得删除或改写任何
> opencode-auto 标记块(指针/验证/提交/维护规则,`<!-- opencode-auto:*:start -->`
> 到 `<!-- opencode-auto:*:end -->`);更新其余内容时遵守 AGENTS.md 维护规则块
> (保持精简、路由到 docs/agents/、更新不追加、只沉淀持久工作流知识)。

(init 总是替换该文件 → 旧目标目录一次 init 即升级。)

### D.3 docs/agents/ 路由约定

- 语义分工:`docs/agents/<主题>.md` = **跨任务**的工作流知识(规范、映射约定、
  环境 quirks);docs/ 根的既有产物(subtasks/report/fix/final 等)= **单任务**
  过程产物。两者都随 driver 统一提交入库;
- 不预置骨架文件;会话在首次需要时创建主题文件并在 AGENTS.md 维护一行路由
  (维护规则块第 2 条即协议,无 driver 侧解析——纯提示词契约);
- `check` 不扫描 docs/agents/(它扫描的是"违背验证执行权"的语句,范围不变)。

### D.4 check 扩展(src/check.ts)

- notes 增一条:AGENTS.md 总行数 > 150 →
  `AGENTS.md 当前 <n> 行,超过 150 行上限(维护规则块第 1 条),建议按规则精简并把细节路由到 docs/agents/`;
  note 不进 findings、不影响退出码(与现有 notes 同级)。

## E. 兼容与迁移

| 场景 | 行为 |
| --- | --- |
| 旧项目(仅 `.auto/config.json` 有 mode) | loadProjectConfig 回落读取 mode,run 打 `ℹ 模式沿用旧位置 .auto/config.json 的持久化值,重跑 init 可固化完整配置`;init 写出新文件后回落终止 |
| 旧脚本 `run -m xxx` / `run --verify` 等 | 退出码 1 + 修订指引(发布说明注明 breaking) |
| 重复 `init`(无参数) | 配置不变(全键保留),模板/块照常幂等 |
| `init --verify false`(amend) | 仅改写 verify 键,其余保留 |
| 中途把 verify on→off | 已 done 任务的 verified 字段不回溯;未完成任务此后收尾即 done;`--review`/`--early` 的既有联动(串行审核/降级提示)按新值生效 |
| 中途切换 subtask | 已注入检查项的任务照旧从勾选状态续跑(进度 phase 按任务记录,不跨任务混淆);新任务按新档执行;README 注明不建议中途切换 |
| 中途换 mode | 仅提示词文案变化(模式不进调度状态机的既有保证);终审已产出的报告不受影响 |
| 中途把 commit off | 工作区开始累积未提交改动(run 启动时 pendingChanges 提示既有) |
| `.opencode/auto/config.json` 坏值 | run/init 均退出码 1,报错含键名与期望值域 |

## F. 组合行为矩阵(run 侧留驻选项 × 配置)

| 组合 | 行为 |
| --- | --- |
| config verify=false + `--review n` | 既有语义:审核串行,启动打降级提示 |
| config verify=false + `--early` | 既有语义:并行窗口不存在,降级提示(`--early` 仍需搭配 `--review` 的校验不变) |
| config verify=true + `--review --early` | 并行审核照旧(看门狗取 config 的 verifyIdle/verifyMax) |
| `--dryrun` | 读 config 的 agent/contextLimit;verify/commit/subtask 不参与 |
| `--final-review` | 终审任务照旧强制跳过任务级验收(与 config.verify 无交互) |
| `-i` / `--verbose` / `--wait-*` / `--permission` / `--server` | 与配置零交互,照旧 |
| `status` | 打印配置摘要 + 任务清单 |

## G. 文件级改动清单与分期

| 文件 | 改动 | 分期 |
| --- | --- | --- |
| `src/config.ts`(新增) | ProjectConfig / CONFIG_DEFAULTS / loadProjectConfig / mergeProjectConfig / saveProjectConfig / formatProjectConfig(含 legacy 回落与值域校验) | P1 |
| `src/mode.ts` | 删除 readPersistedMode / writePersistedMode(职责并入 config.ts;loadModes / parseModeFile 不动) | P1 |
| `test/config.test.ts`(新增) | 缺省 / 合并 / amend / legacy 回落 / 坏 JSON / 越界值 / 未注册 mode / 未知键忽略 | P1 |
| `test/mode.test.ts` | 持久化用例迁往 config.test.ts | P1 |
| `src/index.ts` | run 分支拒绝固化选项 + loadProjectConfig 注入;init 分支选项面扩展 + merge/save + 打印配置;resolveModeFlag 缩减为 init 侧;用法文本重写 | P2 |
| `src/protect.ts` | FILES 增 `.opencode/auto/config.json` | P2 |
| `test/e2e.test.ts` | run 拒绝各固化选项(退出码 1 + 报文);init 写出完整 config;init amend 仅改显式键;status 打印 | P2 |
| `src/loop.ts` | MAINT_RULE 常量 + ensurePointer 第四块(返回值 / 两处调用点打印) | P3 |
| `templates/.opencode/agent/auto.md` | D.2 条款修订 | P3 |
| `src/check.ts` | AGENTS.md 行数 note | P3 |
| `test/prompt.test.ts` / `test/check.test.ts` | auto.md 含 maint 引用断言(防漂移);行数 note 用例 | P3 |
| `README.md` / 包内 `AGENTS.md` | init/run 选项表重写、配置文件节、维护规则块与 docs/agents/ 约定、兼容迁移说明 | P4 |

分期边界:P1(纯逻辑,可独立合入,合入后 config.ts 暂无人调用)→ P2(CLI 双
命令切换,行为生效点;发布说明注明 breaking 与迁移指引)→ P3(AGENTS.md 提示词
侧,可与 P2 并行开发但建议其后合入)→ P4(文档)。

## H. 风险、边界与已知局限

- **"修订需 init"的额外步骤**:固化根治漂移但把变更成本前移;两条修订通道
  (init amend / 直接编辑 config)均已保留,且 config 进 git 历史可审计变更;
- **维护规则是提示词级约束**:150 行上限与路由纪律无硬校验(note 仅提示),
  会话仍可能膨胀 AGENTS.md——机器观测点只有 check 的 note;标记块本身受
  "不得改写"契约与幂等补写保护;
- **config 版本化 vs 机器差异**:同一目标目录换机器运行时共享看门狗/上下文上限
  参数;必要时该机器本地编辑 config(设计接受这一摩擦,换取宪法单一事实源);
- **docs/agents/ 与 docs/ 根的分工靠约定**:会话可能把过程产物写进 agents/
  (低风险,终审 audit 侧重视角可纠正);
- **中途切换 subtask/verify 的任务形态混杂**(见 §E):README 明示不建议;
- **protect 新增条目**:run 期间 config 只读,人工修订需等 run 结束(与 PLAN 等
  既有护栏一致);
- **dogfood 顺序**:实现期间运行中的 driver 仍是旧版,新行为自下一次 run 生效;
  本包自身 AGENTS.md 的选项描述在 P4 前与代码不一致(实现会话须以本文档为准)。

## I. 测试与验证

- `bun typecheck` + `bun test`:P1 纯函数;P2 e2e 解析用例镜像既有风格(临时
  目录,不依赖 server 与网络);
- 手工验证:旧目标目录(含 `.auto/config.json`)run 观察回落提示;init 后
  AGENTS.md 四块齐备、config 完整;`init --verify true` amend 只改一键;
  `run --verify` 报退出码 1 与指引;run 启动横幅 / status 打印配置摘要;
- AGENTS.md 维护规则触发路径:构造 >150 行 AGENTS.md 跑 check 观察 note;
- 全部完成后 `bun run build` 冒烟(auto.md 模板仍经 `type: "file"` 嵌入,
  templates/ 无新增文件)。
