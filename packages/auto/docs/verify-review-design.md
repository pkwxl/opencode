# verify 三段式与 --review 审核循环 — 设计说明

> 本文档是 PLAN.md 第三阶段(T-017..T-021)的唯一设计基准:分解、执行、审核会话均以
> 本文为准。包内 AGENTS.md 中与本文冲突的旧约定(如"driver 不亲自执行任何 verify
> 命令")将在 T-021 统一改写;此前任务实现时不要按旧约定"纠正"代码。
> 第四阶段(T-022..T-024,--early 并行审核)以本文 F 节为唯一设计基准。

## 背景与动机

1. **verify 执行效率与稳定性**:当前任务级验收完全在旁路审核会话内进行,AI 通过 bash
   工具运行检查命令,工具输出被截断(2000 字符),大输出场景下 AI 反复重跑同一命令,
   浪费上下文与时间。改为 driver 直接执行脚本、输出落盘、AI 只读文件判定后:输出零
   截断、命令只执行一次、执行与判定分离更客观。
2. **缺少实现质量的独立审核**:verify 只回答"验收标准是否满足",不回答"实现是否忠实
   于设计/任务描述、是否处理了所有情形、验证过程本身是否全面有效"。新增 `--review`
   审核循环补上这一层,并以驱动式 fix 子任务闭环。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| verify 产物位置 | 目标目录下 `tmp/` 子目录:`tmp/{verify.sh, verify.out, verify.err}`(V2 修订: 自 `/tmp/<目标目录基名>` 迁入工作目录,会话可直读、避免 /tmp 权限问题;run/init 经 ensureGitignore 保证不进仓库,清扫提交规则不变) |
| `--review` 语义 | 缺省不启用;裸 `--review` = 3 轮;`--review n` 须为 1..10 的整数,否则用法错误(退出码 1) |
| `--subtask off` 下 review 失败 | 与该模式 verify 失败行为一致:回退 `pending` 停机(退出码 2),不进 fix 循环 |
| 审核范围界定 | 提示词引导:审核会话依据 `docs/T-NNN.report.md` + git log/status 自行界定本任务改动范围,不新增持久化状态 |

## A. verify 三段式(脚本准备 → driver 执行 → AI 判定)

### A.1 机制层 `src/verify.ts`(T-017)

纯逻辑模块,不依赖 SDK 与 runner,可独立单测。导出:

```ts
// 目标目录下 tmp/(不负责创建,调用方或本函数内 mkdir -p 均可)
verifyTmpDir(dir: string): string   // join(resolve(dir), "tmp")

export type VerifyScript =
  | { kind: "existing"; script: string }   // 直接使用既有可执行文件
  | { kind: "wrapped"; script: string }    // driver 包装命令生成的 verify.sh
  | { kind: "generate" }                   // 需 AI 生成会话产出脚本

resolveVerifyScript(task: Task, dir: string): Promise<VerifyScript>
runVerifyScript(dir: string, script: string, timeoutMs?: number):
  Promise<{ code: number; ms: number; timedOut: boolean; out: string; err: string }>
```

`resolveVerifyScript` 判定规则(`verifyCommand(task)` 为 `src/plan.ts` 既有函数,提取
`verify: command: <cmd>` 前缀):

- **existing**:cmd 为单 token(`/^\S+$/`)、不以 `-` 开头,且作为路径(相对 `dir` 或
  绝对)存在并可执行(`X_OK`)→ 直接用该文件。例:`./scripts/e2e.sh`、`/abs/check.sh`。
- **wrapped**:cmd 存在但不满足 existing(如 `bun test`、`make check`)→ driver 写
  `verifyTmpDir/verify.sh`:首行 `#!/usr/bin/env bash`,其后为原命令原文,**不加
  `set -e` 等额外语义**,退出码原样透传;`chmod 0o755`。每次 verifyTask 重新生成
  (幂等覆盖,verify 字段可能被人工改过)。
- **generate**:verify 为自然语言或缺失 → 交脚本生成会话(脚本持久于 tmp/,缺失时
  重新生成;跨修复轮复用)。

`runVerifyScript` 执行语义:

- `cwd` = 目标目录;脚本可执行(有执行位)则直接 `spawn [script]`,否则
  `spawn ["bash", script]`;
- stdout 整写 `verify.out`、stderr 整写 `verify.err`(每次执行前 truncate;
  Bun.spawn 的 stdout/stderr 可直接接 `Bun.file(path)` 写端,版本不支持则 pipe
  后流式复制);
- 超时常量 `VERIFY_TIMEOUT_MS = 10 分钟`(导出供测试覆盖小值);超时 `proc.kill()`,
  `code = 124`、`timedOut = true`(已知局限:孙进程树不保证清理,V1 接受);
- **退出码非 0 不直接判失败**——判定权在 AI,保留"脚本本身坏/环境不适用不误判"的
  既有韧性。

### A.2 脚本生成会话 `renderVerifyScriptGen(plan, task, scriptPath)`(T-018)

旁路全新会话(不进任务执行链)。只读分析源码与 docs/,按 verify 字段的自然语言语义
或任务验收标准,写出可执行脚本到 runner 传入的 `scriptPath`(tmp/ 下绝对路径)并
`chmod +x`。约束:只做验证类操作(运行测试/检查、读文件),不修改任何实现代码;
硬性要求产出文件(缺失带反馈重试一次,仍失败按隐性阻塞——与分解会话/判定文件同
策略);复用 QUESTION_RULE / STATE_RULE。

### A.3 判定会话 `renderVerifyJudge(plan, task, run)`(T-018,替换并删除 renderVerify)

旁路全新会话。提示词注入:脚本路径、退出码、耗时、是否超时、out/err 绝对路径。
要求:直读 out/err 文件(大文件分段读,不经工具截断——这正是本次改造的目的)、读
相关代码,必要时可自行补跑只读检查;保留"脚本/命令本身有问题不判不通过,说明原因
并用等价方式验证"。判定协议不变:写 `.auto/verify.md`(VERDICT_FILE),末行
`结论: 通过` 或 `结论: 差距 <描述>`,可选 `verified-command: <driver 实际执行的
脚本路径或原命令>` 独立成行。

### A.4 runner 接入(T-019)

`verifyTask` 新流程:

```
script = resolveVerifyScript(task, dir)
  └─ generate → 先开脚本生成会话(一次性 chain {pct:100, used:0},不进任务链;
                 产物缺失带反馈重试一次,仍失败隐性阻塞)
run = runVerifyScript(dir, script)        # log: 退出码、耗时、out/err 路径
verdict = 判定会话(renderVerifyJudge)+ 解析 VERDICT_FILE(沿用 parseVerdict
           与"缺失重试一次"策略)
pass → markDone(path, id, verdict.command ?? verifyCommand(task) ?? 实际脚本路径)
gap  → 既有 renderFix 修复循环不变(FIX_ROUNDS=3);每轮修复后重跑同一脚本再判定
```

现有 `review()` 中"判定文件缺失带反馈重试一次"的骨架可抽为通用 helper 供生成会话
与判定会话复用。会话链、dryrun、interactive、权限等待行为均不受影响。

### A.5 verified 字段

通过时优先取判定文件 `verified-command:` 行,其次 `verifyCommand(task)`(原始命令),
最后实际执行的脚本路径;不通过或未执行则清除(维持现状)。

## B. --review 审核循环(T-020)

### B.1 选项语义

`index.ts`:`--review` 进 VALUE_FLAGS;`parseReviewLimit`:缺省(无选项)→ 0 不启用;
裸选项 → 3;显式值须为 1..10 整数,否则用法错误退出码 1。用法文本同步。

### B.2 流水线(runTask 重构)

```
runTask:
  begin; writeCurrent
  首轮: [auto] ensureDecomposed / [off|ondemand] executeWhole(仅首轮,后续轮直接进检查项循环)
  for (reviewRound = 0; ; ):
    逐未勾选检查项: runSubtask → tick → writeCurrent
    wrapup 会话
    verifyTask(三段式,内部修复轮 ≤ 3;每轮 review-fix 后自然重置)
    if opts.review ≤ 0 → markDone 已完成,返回 completed
    audit = reviewTask:
      final = 当前任务之后全部任务 done(或无后继)
      旁路审核会话 renderReview(plan, task, { final })
      产出 docs/T-NNN.audit.md(final: docs/final-audit.md)
      结论写 .auto/review.md(REVIEW_FILE,协议同 VERDICT_FILE,复用同一解析)
    通过 → completed
    差距:
      off 模式 → setStatus pending,返回 incomplete(与该模式 verify 失败一致)
      reviewRound+1 > limit → blocked(question = 审核差距全文)
      否则 → 旁路修复规划会话 renderReviewFix → docs/T-NNN.fix.md 检查项
             → plan.appendSubtasks 注入 PLAN.md → writeCurrent 刷新
             → continue 外层(子任务会话逐项执行 → 收尾 → verify → 再审核)
```

状态全在 PLAN.md,中断重跑自然续;fix 检查项复用既有子任务会话机制,不新造执行路径。

### B.3 审核会话 `renderReview(plan, task, { final })`(T-018)

审核维度:**忠实性**(实现与任务描述/设计文档对齐)、**正确性**(边界情形是否处理)、
**验证过程全面性与有效性**(verify 脚本与判定是否有效覆盖验收标准)。

- `final = false`(中间任务):范围**以本任务改动为限**——依 `docs/T-NNN.report.md`
  与 git log/status(自上一任务完成后的提交与工作区状态)界定,明确禁止审核其他
  任务的代码;
- `final = true`(最后一个任务):对整个计划执行过程中的设计、实现、文档做全面
  审核(通读 PLAN.md 全部任务、docs/ 各报告与设计文档、整体 git 历史);
- 产出审计报告 `docs/T-NNN.audit.md`(final 为 `docs/final-audit.md`),结论写
  REVIEW_FILE,末行 `结论: 通过` 或 `结论: 差距 <描述>`;
- 只审不改:禁止修改任何实现代码(audit 报告与结论文件除外);复用
  QUESTION_RULE / STATE_RULE。

### B.4 修复规划会话 `renderReviewFix(plan, task, gap)`(T-018)

旁路全新会话。输入审核差距(及 audit 报告路径),产出**单步或多步** fix 检查项到
`docs/T-NNN.fix.md`(`- [ ]` 自包含描述,凭描述 + CURRENT.md + docs/ 即可执行);
硬性要求产出(缺失带反馈重试一次,仍失败隐性阻塞)。driver 经
`plan.appendSubtasks(path, id, items)` 把检查项追加到任务正文既有检查项块之后
(无检查项时接正文末),随后刷新 CURRENT.md。

## C. 文件级改动清单

| 文件 | 改动 | 任务 |
| --- | --- | --- |
| `src/verify.ts`(新增) | verifyTmpDir / resolveVerifyScript / runVerifyScript / VERIFY_TIMEOUT_MS | T-017 |
| `test/verify.test.ts`(新增) | 来源三分支、包装内容、执行/退出码/out-err 落盘、超时 kill | T-017 |
| `src/prompt.ts` | REVIEW_FILE;renderVerifyScriptGen / renderVerifyJudge(删 renderVerify)/ renderReview / renderReviewFix | T-018 |
| `test/prompt.test.ts` | 新模板断言,移除 renderVerify 旧断言 | T-018 |
| `src/runner.ts` | verifyTask 三段式;Opts.review 字段 | T-019 |
| `src/index.ts` / `src/loop.ts` | --review 解析与透传、用法文本 | T-020 |
| `src/plan.ts` / `test/plan.test.ts` | appendSubtasks + 用例 | T-020 |
| `src/runner.ts` | runTask 外层 review 循环、reviewTask、fix 注入、isFinal 判定 | T-020 |
| `README.md` / 包内 `AGENTS.md` | 选项表、流水线、行为约定改写 | T-021 |

## D. 风险、边界与已知局限

- **权限体系**:driver 直接执行 verify 脚本不经 opencode 权限体系,等同人工在本地
  跑测试;脚本来源为用户 PLAN 或受提示词约束的生成会话,定位为便利性取舍而非安全
  边界,文档须明示。
- **tmp/ 位置与清理**:产物位于目标目录 tmp/(V2 前 位于 /tmp/<基名>/,同基名目录共享);文件每次
  执行覆盖写,脚本跨轮复用,系统重启丢失则按规则重新生成/包装,可接受。
- **Windows**:交叉编译产物需 bash 可用(git bash);verify 脚本假设 POSIX shell,
  文档注明。
- **超时清理**:kill 只杀直接子进程,孙进程树不保证清理(V1 已知局限)。
- **脚本复用策略(V1)**:AI 生成脚本每任务生成一次、跨修复轮复用;判定会话发现
  脚本不足时可自行补跑只读检查,不自动重生成脚本(演进项:判定标注脚本缺陷时触发
  重生成)。
- **dogfood 顺序**:执行 T-017..T-021 期间运行中的 driver 仍是旧版(模块已在进程
  内加载),旧 verify 语义贯穿本阶段执行,符合预期;新行为自下一次 run 生效。

## F. --early 并行审核(T-022..T-024)

### F.1 动机与已确认决策

verify 的脚本执行阶段(`runVerifyScript`,超时上限 10 分钟)是纯本地进程,不含任何
opencode 会话;`--review` 的审核会话此前串行排在整个 verify 之后。`--early` 把审核
会话挪进脚本执行窗口并行,节省约一个审核会话的墙钟时间(脚本越长收益越大;短脚本
场景退化为串行,不劣于现状)。

| 决策点 | 结论 |
| --- | --- |
| 并行窗口 | 仅 driver 执行 verify 脚本的阶段;窗口内 verify 侧零会话 |
| 全局不变量 | **任意时刻至多一个 LLM 会话**(公理,记入本节;任何并行化扩展前必须先修订本节) |
| 窗口内代码改动 | 零:审核会话只审不改(既有契约);review 差距只出修复计划不执行修复 |
| worktree | 不需要,舍弃(无代码改动并行 → 无状态分叉、无合并回主线、无第二 server) |
| 修复轮审核 | 每次脚本执行(含修复轮重跑)都重开一次新审核;通过时的审核与通过代码严格同步,**不再二次串行审核** |
| audit 阻塞传播 | 窗口 join 得到 blocked 即从 verifyTask 返回 blocked(脚本输出已落盘,重跑语义与既有 blocked 一致) |

### F.2 流水线

```
每轮(round):
  逐检查项子任务会话 → 收尾会话                          (不变)
  verifyTask:
    resolve 脚本(existing/wrapped;generate 先开生成会话)   (不变)
    ── 启动审核会话(旁路一次性 chain, renderReview early 措辞) ──┐
    driver 执行脚本(runVerifyScript)                            │ 并行窗口
    ── join 审核会话 → audit 结论(blocked 则立即上抛)          ─┘
    判定会话(renderVerifyJudge) → VERDICT_FILE                (不变)
    通过 → markDone,携带 audit 结论返回 {type:"done", audit}
    差距 → renderFix 修复 → 收尾 → 重新执行脚本 ∥ 重开新审核 → 再判定
    off 模式差距 / 修复轮耗尽 → 既有语义不变
  结论合并(runTask 外层消费 verifyTask 带回的 audit):
    verify 通过 + audit 通过   → completed
    verify 通过 + audit 差距   → 既有 review 差距流程(off→pending;超轮→blocked;
                                 否则 planReviewFix → appendSubtasks → 下一轮)
    audit 阻塞                → blocked(见上表)
    verify 差距/off/耗尽       → 既有语义;audit 报告仍留 docs/ 供人工参考
```

时序保证(全局单会话不变量的两个落点):

1. **启动侧**:generate 分支的脚本生成会话结束后才启动审核(existing/wrapped 无前置
   会话,直接与脚本并行启动);
2. **汇合侧**:脚本执行完毕先 join 审核,再开判定会话——审核慢于短脚本时判定等待,
   不得重叠。

### F.3 审核会话适配(renderReview early 模式)

- 提示词告知 verify 脚本正在同目录执行:避免运行可能与之冲突的命令(并发跑测试等),
  以读文件 / git log 为主;
- 维度 3(验证过程有效性)按脚本内容与验收标准做**静态审核**(脚本文件在执行前已存在
  于 `tmp/verify.sh`),运行结果的解读属判定会话职责;
- final 判定、结论协议(REVIEW_FILE)、产物重试策略(requireArtifact)全部不变。

### F.4 选项语义

- `--review N --early`:组合模式;`--early` 为布尔修饰,要求 review 已启用,单独出现
  为用法错误(退出码 1);
- `--early-review [n]`:快捷糖,等价 `--review n --early`;裸选项 3,显式值 1..10
  (复用 parseReviewLimit 校验);与 `--review` 同时出现为用法错误(消除歧义);
- 非 early(`--review N` 单用)行为完全不变:审核仍在整个 verify 通过后串行执行;
- `--subtask off` / `--commit once|none` / `--interactive` 无额外约束(无 worktree
  依赖);`--dryrun` 不达 verify,early 自然无效。

### F.5 runner 接口约定

- `verifyTask` 增加可选挂点参数(审核 thunk):`runVerifyScript` 前启动、判定会话前
  join;每次脚本执行(含修复轮)重开;最后一次 audit 随 done 返回;
- `verifyTask` 返回值扩展:`{ type: "done"; audit?: Verdict }`(非 early 模式不带);
- `runTask` 外层:early 时不再独立调用 reviewTask,消费 verifyTask 带回的 audit;
  非 early 走原路径;轮数计数、off 模式、FIX_ROUNDS 语义均不变。

### F.6 风险与边界

- 短脚本场景审核慢于脚本时判定会话等待,极端下 early 收益为零,不劣于串行;
- 审核会话若补跑只读命令可能与脚本争用环境(如测试缓存):F.3 提示词已约束以读为主;
- 中断恢复零新增:遗留 `.auto/review.md` 与 audit 报告由 requireArtifact 的 reset()
  在下次运行清理,无新增持久化并行状态;
- `--interactive`:窗口内唯一会话为审核会话,attach 无歧义。

## G. 判定会话执行限制与重验协议(后续修订,以此为准)

> 本节修订 A.3 的判定会话约定与相关提示词;与其冲突的旧文("必要时可自行补跑只读
> 检查""说明原因并用等价方式验证")以本节为准。其余各节(A/B/F)不变。

| 决策点 | 结论 |
| --- | --- |
| 判定会话执行权 | **禁止直接执行任何验证脚本或验证性命令**(运行测试、构建、lint、启动服务等);执行结果一律以 driver 回传的 out/err 文件为准;只读检查(读文件、git log/status、grep 源码)不受限 |
| 脚本缺陷处理 | 判定会话可编写**新的验证脚本替换**指定脚本(`tmp/verify.sh`,覆盖写 + chmod +x),判定文件末行 `结论: 重验 <原因>` |
| 重验循环 | driver 固定改为执行该指定路径(不再按 verify 字段重新解析——wrapped 重包装会覆盖替换产物),输出整写回传同一对 out/err,由新判定会话继续判定;至多 REVERIFY_ROUNDS=3 轮,耗尽或声称重验但未写出脚本按隐性阻塞(blocked) |
| verified-command | 判定通过且替换过脚本时,可附 `verified-command: <新脚本核心命令>`;markDone 的取值优先级不变 |
| 生成会话 | renderVerifyScriptGen 同样禁止执行验证性命令(只读分析 + `bash -n` 类语法检查除外) |
| 审核会话 | renderReview 两形态维度 3 统一为静态审核(脚本内容/判定记录对照验收标准),不执行验证脚本或验证命令;early 额外告知脚本并行执行、以只读为主 |
| 原则下沉 | init 向 AGENTS.md 追加验证原则块(独立标记 `opencode-auto:verify:start/end`,幂等、与指针块互不影响)、PLAN.md 模板与 renderInit 提示词写明"任务描述不要求执行者亲自运行验证命令/脚本";`opencode-auto check` 启发式扫描 AGENTS.md/PLAN.md 中与原则相违背的描述,命中退出码 1(否定句、driver 归属句、PLAN 字段行与 opencode-auto 标记块不算) |

## H. 中断恢复、看门狗与判定会话 verify 字段授权(后续修订,以此为准)

> 本节修订会话记忆、verify 超时与判定会话写权限的约定;与其冲突的旧文
> (固定 10 分钟超时、`.auto/session.json` 仅记会话 ID、状态文件绝对只读)
> 以本节为准。

| 决策点 | 结论 |
| --- | --- |
| 进度记录 | `.auto/progress.json` 取代 session.json:`{task, session?, at, active, phase}`;driver 在每个阶段边界写入(active=false 总结态),执行链会话运行期间由 attempt 刷新为 active=true(半途态);旁路一次性会话(判定/审核/脚本生成/修复规划)不写,修复"旁路会话污染执行链记忆"缺陷;旧版 session.json 兼容读取(视为半途会话、无阶段) |
| phase 阶段 | decompose / whole / subtasks / wrapup / verify{stage: generate\|exec\|judge, round, rechecks, replaced, run?, audit?} / review{round, stage: audit\|planfix\|fixrun} |
| 会话内恢复 | active 且 ≤30 分钟(RESUME_WINDOW_MS,自最后一次活动起算)且会话在 server 上存在 → 复用原会话;否则新会话;两种情况首个提示词均附"[driver] 中断后的继续"(按 phase 给出下一步指引) |
| 阶段级重入 | verify 有持久化 run → 跳过脚本重跑直接判定(early 缺 audit 时只补跑审核);off/ondemand 已过执行阶段不重跑 executeWhole;review/planfix 且 fix.md 有效直接注入;verify/review 阶段已标 done 的任务由 loop 置回 in_progress 补跑;decompose 先直读 subtasks.md |
| 优雅退出 | 非完成结局(阻塞/回退 pending)在 CURRENT.md 写"中断备注"(原因/阶段/恢复方式)并保留文件,记录转总结态(不复用会话);任务完成才删除 CURRENT.md 与记录;网络类 blocked(会话错误重试耗尽)保持 active 记录(会话半途无法总结) |
| 链内复用间隔 | 复用条件在 pct<50 && used<contextLimit/2 之上增加"距上一会话结束 ≤5 分钟"(REUSE_IDLE_MS);重启恢复的 30 分钟窗不受此限(复用决策已由该窗做出,chain.at 重置为当前时刻) |
| verify 看门狗 | 固定 10 分钟超时废除:轮询(默认 5s)verify.out/verify.err 文件大小,任一增长即重置 idle 计时;持续 `--verify-idle`(缺省 10 分钟,1..120)无增长才 kill(退出码 124,timeoutReason=idle);`--verify-max`(缺省不设,1..1440)为绝对上限兜底(timeoutReason=max)。只要持续有输出,运行时长不受限 |
| 判定会话写授权 | 判定会话期间临时 allowWrite(PLAN.md)、结束后 reprotect 并校验:解析失败或任务集合/状态/attempts/正文任一变化 → 恢复会话前快照并警告(越权编辑整体还原);提示词授权**仅更新后续未完成(pending/blocked)任务的 verify 字段**(保持 `command: ` 单行格式),当前脚本无通病时不做任何修改;CURRENT.md 不放开(纯镜像,写了会被覆盖) |
| 原则块措辞 | AGENTS.md 验证原则块(init 追加)补充判定会话 verify 字段授权例外;STATE_RULE 对判定会话改为 judge 专属表述 |

### H.1 已知取舍

- verify 修复轮(判定差距 → renderFix 会话)进行中被中断的,没有单独阶段标记:
  恢复后从脚本执行重走一轮判定(可能重复一次差距反馈,收敛不受影响);
- review/audit 阶段恢复时,early 已得出的审核结论若尚未被消费即中断,恢复后
  重新开审核会话(不做结论持久化复用,窗口极窄、代价一次会话);
- AGENTS.md 验证原则块的措辞更新只对新 init 目录生效(标记块幂等追加、不回写)。

## E. 测试与验证

- 每任务 verify:`bun typecheck` + 对应测试文件(见 PLAN.md 各任务 verify 字段);
- `test/verify.test.ts` 不依赖 opencode server 与网络,超时用注入小超时值验证;
- e2e(`OPENCODE_AUTO_E2E=1`,需凭据)为可选手工验证项:三段式 verify 与
  `--review 1` 循环各跑一次,观察 `tmp/` 产物、audit 报告与 fix 注入;
- 全部任务完成后 `bun run build` 冒烟,确认 `type: "file"` 模板导入不受影响
  (预计不变)。
