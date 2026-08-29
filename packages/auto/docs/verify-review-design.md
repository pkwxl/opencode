# verify 三段式与 --review 审核循环 — 设计说明

> 本文档是 PLAN.md 第三阶段(T-017..T-021)的唯一设计基准:分解、执行、审核会话均以
> 本文为准。包内 AGENTS.md 中与本文冲突的旧约定(如"driver 不亲自执行任何 verify
> 命令")将在 T-021 统一改写;此前任务实现时不要按旧约定"纠正"代码。

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
| verify 产物位置 | 系统临时目录 `os.tmpdir()` 下按目标目录基名分子目录:`/tmp/<目标目录基名>/{verify.sh, verify.out, verify.err}`;不进仓库,清扫提交规则不变 |
| `--review` 语义 | 缺省不启用;裸 `--review` = 3 轮;`--review n` 须为 1..10 的整数,否则用法错误(退出码 1) |
| `--subtask off` 下 review 失败 | 与该模式 verify 失败行为一致:回退 `pending` 停机(退出码 2),不进 fix 循环 |
| 审核范围界定 | 提示词引导:审核会话依据 `docs/T-NNN.report.md` + git log/status 自行界定本任务改动范围,不新增持久化状态 |

## A. verify 三段式(脚本准备 → driver 执行 → AI 判定)

### A.1 机制层 `src/verify.ts`(T-017)

纯逻辑模块,不依赖 SDK 与 runner,可独立单测。导出:

```ts
// /tmp/<目标目录基名>/(不负责创建,调用方或本函数内 mkdir -p 均可,测试须可注入临时目录)
verifyTmpDir(dir: string): string   // join(os.tmpdir(), basename(resolve(dir)))

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
- **generate**:verify 为自然语言或缺失 → 交脚本生成会话(脚本持久于 /tmp,缺失时
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
或任务验收标准,写出可执行脚本到 runner 传入的 `scriptPath`(/tmp 下绝对路径)并
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
- **/tmp 碰撞与清理**:不同路径同基名的目标目录共享同一 `/tmp/<基名>/`;文件每次
  执行覆盖写,脚本跨轮复用,系统重启丢失则按规则重新生成/包装,可接受。
- **Windows**:交叉编译产物需 bash 可用(git bash);verify 脚本假设 POSIX shell,
  文档注明。
- **超时清理**:kill 只杀直接子进程,孙进程树不保证清理(V1 已知局限)。
- **脚本复用策略(V1)**:AI 生成脚本每任务生成一次、跨修复轮复用;判定会话发现
  脚本不足时可自行补跑只读检查,不自动重生成脚本(演进项:判定标注脚本缺陷时触发
  重生成)。
- **dogfood 顺序**:执行 T-017..T-021 期间运行中的 driver 仍是旧版(模块已在进程
  内加载),旧 verify 语义贯穿本阶段执行,符合预期;新行为自下一次 run 生效。

## E. 测试与验证

- 每任务 verify:`bun typecheck` + 对应测试文件(见 PLAN.md 各任务 verify 字段);
- `test/verify.test.ts` 不依赖 opencode server 与网络,超时用注入小超时值验证;
- e2e(`OPENCODE_AUTO_E2E=1`,需凭据)为可选手工验证项:三段式 verify 与
  `--review 1` 循环各跑一次,观察 `/tmp/<基名>/` 产物、audit 报告与 fix 注入;
- 全部任务完成后 `bun run build` 冒烟,确认 `type: "file"` 模板导入不受影响
  (预计不变)。
