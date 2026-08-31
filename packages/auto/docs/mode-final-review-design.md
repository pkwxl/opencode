# --mode 模式层与 --final-review 终审闭环 — 设计说明

> 本文档是 `--mode` 模式层与 `--final-review` 终审闭环的唯一设计基准:实现任务以本文
> 为准;与其冲突的旧约定(`--review` 终审升级为 `docs/final-audit.md` 单会话全面审核
> 的既有语义保持不变,终审闭环是独立新增的机制,不改动它)以本文为准。

> **修订(终审不对检验再做检验)**:终审任务(T-F\<k\>,全部四阶段)依 final 字段
> 强制 review=0 且跳过任务级三段式验收(`--verify` 对其无效),任务不再写 verify
> 字段、提案的 `verify:` 行兼容剥离一律忽略;报告缺失/协议非法由路由解析时的
> brokenReport 阻塞兜底(退出码 2,人工核查),不再有结构检查 verify 的修复轮
> 自愈。下文与该修订冲突的描述(结构检查 verify、协议自愈、remediate/finalize
> 参与逐任务审核等)以本修订为准。

## 背景与动机

1. **模式层**:不同场景(迁移、优化、新实现、测试)下,计划初始化与执行各阶段的
   提示词侧重不同(如迁移强调"外部行为不变、新旧对等")。当前提示词无场景概念,
   需要一个不影响 driver 调度状态机的轻量模式层,且新增模式零调度改动。
2. **终审闭环**:既有 `--review` 的终审(最后一个任务的 final 审核)是单会话全面
   审核,产出报告后没有修复闭环;审核发现的差距只能人工处理。需要一个任务驱动的
   多阶段终审流程(Audit → Refactor/Patch → Validate → Finalize,Validate 可回退
   Audit),把"终审发现的问题"也纳入 driver 驱动的分解/执行/验收闭环,并获得与
   普通任务一致的断点恢复能力。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| CLI 形态 | `--final-review [n]` 独立选项(可与 `--review n` 组合:逐任务审核照常 + 终审闭环;单用即仅终审)。不采用 `--review-level`(会破坏 `--review` 既有的数值语义与解析),不引入 `--final` 修饰符(单独出现无意义,双拼法徒增解析分支) |
| n 语义 | 审计轮上限(含首轮 Audit,即 Audit→Remediate→Validate 的最大循环次数);缺省(无选项)0 不启用;裸选项 = 2;显式值须为 1..5 整数,否则用法错误(退出码 1) |
| 回退熔断 | Validate 差距且审计轮耗尽 → 把残余差距写入 PLAN.md 阻塞问题(block 最后的 validate/audit 任务)并退出码 2;**不生成 Manual_Escalation 任务**——人工介入在本包是停机事件而非任务,"给人看的任务"会让 verify/收尾/勾选语义空转;残余风险清单已在 audit/validate 报告中,阻塞问题引用文件指针即可 |
| 审计报告结构化 | 复用本包"末行结论"中文协议,不用 JSON(自由会话稳定产出 JSON 比"末行结论"更脆,且 parseVerdict 已有成熟解析形态):audit 报告末两行 `结论: <概述>` 与 `策略: 重构\|修补\|无`,driver 正则解析做确定性路由 |
| `策略: 无` 路由 | 直达 Finalize,**跳过 Remediate 与 Validate**:Audit 本身就是全局检查,无补救即无验证对象;原任务已有任务级 verify 兜底 |
| Validate 路由 | 报告末行 `结论: 通过`(→ 生成 Finalize 任务)或 `结论: 差距 <描述>`(→ 回退 Audit,受轮上限约束);不设独立"建议"字段——结论即建议 |
| 模式层形态 | `src/mode.ts` 类型化注册表(策略模式精神),不用 prompts/ 目录模板:提示词是 TS 函数组合(带运行时参数:路径/字段/上下文),templates/ 只承载 init 复制件且须逐文件 `with { type: "file" }` 导入嵌入二进制,目录模板两者都冲突。新增模式 = 加一个类型完整的条目,driver 零改动 |
| 终审阶段载体 | 真任务入 PLAN.md(`T-F<k>` ID + `final: <stage>@<round>` 字段标记),复用 runTask 全流水线(分解/子任务会话/收尾/CURRENT.md/进度恢复/commit 档位;任务级验收与逐任务审核依 final 强制跳过),driver 只做"生成任务 → 跑任务 → 解析报告路由"的状态机 |
| audit/validate 任务的逐任务审核 | **(修订)** 全部终审任务跳过逐任务审核与任务级三段式验收——终审阶段本身即检验,不对检验再做检验(审核/验收套娃浪费会话且语义混乱):runTask 内按 final 标记强制 review=0 且 verify 关闭(收尾后直接 done);闭环内部的修复质量由同轮 validate 回归验证兜底 |
| 产物位置 | `docs/final/`(audit-r\<N\>.md / refactor-r\<N\>.md / patch-r\<N\>.md / validate-r\<N\>.md / finalize.md / plan-\<stage\>-r\<N\>.md 提案),避开既有终审报告 `docs/final-audit.md`(`--review` 的产物,命名不冲突) |
| 全局单会话不变量 | 保持:终审闭环全程串行(生成会话 → 任务会话),无并行窗口,不需要 worktree |

## A. 模式层(`-m/--mode`)

### A.1 注册表 `src/mode.ts`

```ts
export type ModeSpec = {
  name: string
  // renderInit 的模式导语:场景定义、任务排布原则、verify 侧重
  init: string
  // 执行类提示词(分解/整任务/子任务/收尾)附加的模式注意事项
  exec: string
  // 终审各阶段提示词的侧重
  final: { audit: string; validate: string; finalize: string }
}
export const MODES: Record<string, ModeSpec> = { migrate: { ... } }
```

- V1 只注册 `migrate`(迁移/升级:以保持外部行为不变为前提,任务按"基线确认 →
  迁移改造 → 回归验证"排布,verify 优先复用既有测试/构建命令;终审 audit 侧重
  新旧行为对等与残留旧路径,validate 侧重回归覆盖,finalize 侧重旧实现清理与
  兼容层收尾)。`optimize/implement/test` 为既定扩展名,未注册即不可用。
- `resolveMode(name): ModeSpec | undefined`;CLI 侧未注册名 → 用法错误退出码 1,
  报文列出当前支持的模式。
- 文案为提示词级引导,不含调度语义;实现任务时在 prompt.test.ts 断言注入。

### A.2 CLI 接线

- `-m/--mode <name>` 进 VALUE_FLAGS(`src/index.ts`),新增短选项 `-m`(镜像 `-p`
  的吞值规则);`init`(作用于 renderInit)与 `run`(经 Opts 透传 runner)都接受,
  缺省 `migrate`。
- 持久化:V1 不做(只有一种模式不存在分歧);README 注明 init 与 run 应使用相同
  模式。PLAN.md 头部注释戳(`<!-- opencode-auto-mode: migrate -->`)列为后续可选项。

## B. `--final-review [n]` 终审闭环

### B.1 选项语义与组合矩阵

`parseFinalReviewLimit` 镜像 `parseReviewLimit` 风格:缺省 0 不启用;裸选项 2;
显式值 1..5 整数,否则用法错误退出码 1。用法文本同步。

| 组合 | 语义 |
| --- | --- |
| `--final-review` 单用 | 无逐任务质量审核;原任务全部完成后进入终审闭环 |
| `--review n` + `--final-review [m]` | 逐任务审核照常;终审闭环在全部任务完成后进行 |
| `--early` / `--early-review` | 只作用于逐任务审核窗口,与终审无交互;`--early-review` 与 `--final-review` 可同现 |
| `--dryrun` | 不执行任务,终审不触发 |
| `--commit once` | 整体提交保持在终审全部结束后的既有位置(终审闭环本身产生的改动一并提交) |
| `--subtask off/ondemand` | 终审任务遵循全局档位;终审任务不做任务级验收,无 verify 差距回退一途(报告异常在路由时阻塞) |
| `--wait-between` | 终审任务之间同样生效(与普通任务一致) |

退出码:终审任务 blocked/incomplete → 既有退出码 2 语义;熔断 → 2(阻塞写入
PLAN.md);Finalize 完成 → 0。

### B.2 状态机与流水线

核心机制:终审阶段是入 PLAN.md 的真任务,由主循环 `next()` 按文件顺序自然执行
(追加在文件尾);driver 的终审状态机是 `(PLAN.md 中带 final 标记的任务及其状态,
docs/final/ 产物)` 的**纯函数**,无新增持久化状态。

```
[原任务全部 done](next() 返回空,终审未完成)
 → 生成会话(旁路一次性,requireArtifact 骨架)产出任务提案 docs/final/plan-audit-r1.md
 → driver 解析并 appendTask:T-F1,字段 final: audit@1(不写 verify 字段)
 → 主循环 next() 拾取 → runTask(T-F1) 全流水线(分解/子任务/收尾;强制跳过任务级
   验收与逐任务审核,收尾后直接 done)
 → runTask 完成且任务带 final 标记 → 路由:解析 docs/final/audit-r1.md 末行
      策略: 无        → 生成 Finalize 任务 → 执行 → commit once(既有位置)→ 退出 0
      策略: 重构|修补  → 生成 remediate 任务 → 执行
                       → 生成 validate 任务 → 执行
 → 解析 docs/final/validate-r1.md 末行:
      结论: 通过 → 生成 Finalize 任务 → 执行 → 完成
      结论: 差距 → 审计轮 < n ? 生成聚焦残余差距的 audit@<r+1> 任务 → 继续闭环
                  审计轮 ≥ n ? 熔断(block 最后任务,退出码 2)
      报告缺失/协议行非法 → brokenReport 阻塞该任务(退出码 2,人工核查)
```

- 任务 ID `T-F<k>`:k = 既有终审任务数 + 1,追加顺序确定、免碰撞(HEADING 的
  `T-[\w-]+` 兼容);`T-` 前缀匹配 persistStage 的进度写入条件(`src/runner.ts`),
  终审任务内部中断走既有 recallProgress/peekProgress 机制,零新增。
- 任务标题带阶段前缀(如 `终审审计(第 1 轮)`),status 命令自然可见。
- runTask 完成后的路由挂点与 `next()` 为空时的终审启动挂点均在 `src/loop.ts`
  主循环接入;终审启动打印横幅(`banner("全部任务完成,进入终审闭环")`)。

### B.3 任务生成会话 `renderFinalTask(plan, stage, round, prior, mode)`

旁路全新会话(不进任何任务链,复用 runner 导出的 requireArtifact 骨架:产物缺失
带反馈重试一次,仍失败按隐性阻塞)。输入为上游产物指针(audit/validate 报告路径、
残余差距原文、全部已完成任务概览),产出提案文件 `docs/final/plan-<stage>-r<N>.md`:

```
# <任务标题>

<任务正文:目标、范围、上下文、检查项由 runTask 的分解会话另行生成,不手写>
```

(修订:提案不再包含可选 `verify:` 行——终审任务强制跳过任务级验收,该字段无用;
旧提案中残留的该行解析时兼容剥离、被忽略。)

- 各阶段侧重注入 `mode.final[stage]`(migrate 见 A.1);
- 提案正文是任务的自包含描述:凭它 + CURRENT.md + docs/ 即可执行;
- 约束:只规划不实施;复用 QUESTION_RULE / STATE_RULE;硬性要求产出提案文件;
- audit@r≥2 的生成会话输入为 validate 差距原文 + 上一轮报告,提示词要求聚焦
  残余差距与回归检查,不做全量重审。

driver 解析提案后 `appendTask`:ID/`final` 字段由 driver 决定,标题与正文取自提案,
不写 verify 字段(终审任务强制跳过任务级验收)。

### B.4 报告协议与验收的关系

- **audit 任务**:正文要求产出审计报告 `docs/final/audit-r<N>.md`,末两行
  `结论: <概述>`、`策略: 重构|修补|无`。
- **validate 任务**:报告 `docs/final/validate-r<N>.md`,末行
  `结论: 通过` 或 `结论: 差距 <描述>`。
- **报告异常兜底(修订)**:终审任务不做任务级验收,策略/结论行缺失或取值非法
  (多为会话漏写或报告被人工改动)在 runTask 完成后的路由解析时按 brokenReport
  阻塞该任务——退出码 2、提示人工核查(修复报告或删改终审任务后状态重建重新
  路由);不做修复轮自愈。
- **remediate 任务**:报告 `docs/final/refactor-r<N>.md` / `patch-r<N>.md`,
  自由正文无协议;修复质量由同轮 validate 回归验证兜底。
- **finalize 任务**:收尾报告 `docs/final/finalize.md`(自由正文)。
- 各终审任务的收尾会话仍照常写 `docs/T-F<k>.report.md` 产出摘要,与阶段报告并存
  (摘要 vs 结论,不冲突)。

### B.5 熔断

Validate 差距且审计轮耗尽:`block(path, 最后的终审任务id, question)`,question 为
`终审闭环连续 <n> 轮仍未通过,残余差距见 docs/final/validate-r<N>.md 与
docs/final/audit-r<M>.md:<最近一轮差距原文>`,退出码 2。人工处理(改 PLAN/改代码/
直接重跑)后重新运行:blocked 任务直接续跑(既有语义),或人工删改终审任务后由
状态重建重新路由。

### B.6 runTask 适配

- Opts 增 `mode`(透传 prompt 渲染);
- 终审任务(任务对象带 `final` 字段,全部四阶段)强制 `review = 0` 且跳过三段式
  验收(`--verify` 对其无效,`--early` 随之自然失效),收尾后直接 markDone
  (不写 verified);陈旧 verify/review 阶段恢复记录不补跑(enterAudit 加
  limit>0 守卫,verify 阶段记录走收尾跳过 + 直接完成);
- 导出 `requireArtifact` / `runSession` 供 `src/final.ts` 的生成会话复用;
- 其余(链复用、权限、交互、看门狗)零改动。

## C. 中断恢复与幂等

状态重建规则(`src/final.ts` 的路由纯函数,run 启动与每次 runTask 完成后求值):

1. 存在未完成(pending/in_progress/blocked)的终审任务 → 主循环既有机制处理,
   不生成新任务(blocked 等人工,in_progress 中断走 recallProgress);
2. audit 任务 done 且报告末行策略合法 → 按策略路由;若下一阶段任务已存在(追加后
   中断)→ 不重复生成,主循环直接拾取;
3. 提案文件已产出但对应任务未追加(追加前中断)→ 直接解析追加,不开生成会话;
4. 终审任务 done 但报告缺失/协议非法 → 路由时按 brokenReport 阻塞,提示人工
   核查(终审任务不做任务级验收,该检查是唯一兜底);
5. 全部原任务与终审任务 done、无待生成阶段 → 终审完成,退出 0。

## D. 文件级改动清单

| 文件 | 改动 | 分期 |
| --- | --- | --- |
| `src/mode.ts`(新增) | ModeSpec / MODES / resolveMode | P1 |
| `src/index.ts` | `-m/--mode`(VALUE_FLAG + 短选项)、`--final-review`(parseFinalReviewLimit)解析、用法文本 | P1 / P2 |
| `src/prompt.ts` | 各 render 注入 mode 段;renderFinalTask | P1 / P2 |
| `src/runner.ts` | Opts.mode;终审任务(final 字段)强制 review=0 且跳过任务级验收;导出 requireArtifact/runSession | P1 / P2 |
| `src/loop.ts` | Opts 透传;runTask 完成后路由挂点、next() 为空时终审启动挂点、横幅 | P2 |
| `src/plan.ts` | Task 解析 `final` 字段;appendTask | P2 |
| `src/final.ts`(新增) | 状态机路由表、策略/结论解析、appendFinalTask、幂等重建 | P2 |
| `test/mode.test.ts`(新增) / `test/plan.test.ts` / `test/prompt.test.ts` | 注册表与未知名报错;appendTask 与 final 字段往返、未知字段保留;模式注入与 renderFinalTask 断言 | P1 / P2 |
| `test/final.test.ts`(新增) | 路由表(策略 无/重构/修补;结论 通过/差距;熔断)、提案文件幂等追加、状态重建 | P2 |
| `test/e2e.test.ts` | CLI 解析用例(镜像既有风格) | P3 |
| `README.md` / 包内 `AGENTS.md` | 命令表、行为约定、结构节 | P3 |

## E. 风险、边界与已知局限

- **报告协议的会话依从性(修订)**:终审任务无结构检查验收兜底,报告协议行全靠
  提案正文中的硬性要求约束;漏写时在路由时按 brokenReport 阻塞、需人工介入,
  代价是一个停机事件而非自动修复——换取的是不对检验再做检验的纯粹性。
- **空 PLAN**:无任务时终审照常进入(audit 大概率 `策略: 无` → finalize),
  不特判。
- **终审成本**:每轮 = 生成会话×2..3 + 任务全流水线×2..3;`--final-review 1`
  可用作"只审一轮、不回退"的廉价形态。
- **dogfood 顺序**:实现期间运行中的 driver 仍是旧版,新行为自下一次 run 生效。
- **模式不持久化**(V1):跨天恢复时 CLI 忘带 `-m` 会回落 migrate;当前只有
  migrate 一种模式,无实际分歧,扩展第二模式前必须先补持久化(列为前置条件)。

## F. 测试与验证

- `bun typecheck` + `bun test`;final/mode 测试不依赖 opencode server 与网络
  (路由解析与状态重建为纯函数,提案/报告用 fixture 文件);
- e2e(`OPENCODE_AUTO_E2E=1`,需凭据)为可选手工验证项:`--final-review 1` 跑一次
  空转闭环(audit `策略: 无` → finalize),观察 `docs/final/` 产物、T-F 任务追加与
  勾选;
- 全部任务完成后 `bun run build` 冒烟,确认 `type: "file"` 模板导入不受影响
  (预计不变,templates/ 无新增)。
