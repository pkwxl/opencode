# opencode-auto

按 `PLAN.md` 驱动 [opencode](https://opencode.ai) 自动逐任务执行实施的命令行工具。
状态由 driver 独占维护:每个任务先经分解会话拆成子任务,再逐子任务调度会话完成
(上一会话上下文占比低于 50% 时复用,否则新建,会话结束即由 driver 勾选),收尾后由
旁路的独立审核会话做任务级验收判定完成(driver 自己不执行固定命令);遇到权限问题
或无法自主决策的反复提问时停机等待人工处理。

## 构建独立可执行文件

```sh
cd packages/auto
bun run build            # 生成 dist/opencode-auto(本机平台)
bun run build -- --target bun-windows-x64   # 交叉编译,产物带平台后缀
```

产物是单个自包含文件(模板与 SDK 已嵌入),拷贝到任意机器即可运行。
运行 `run` 时仍需目标机器装有 `opencode` CLI,或提供已有 server 地址(见下文)。

也可以不构建,直接用 Bun 运行源码:

```sh
bun run packages/auto/src/index.ts <子命令> ...
```

## 使用

```sh
opencode-auto init [dir]     # 生成 PLAN.md、opencode.json、.opencode/agent/auto.md 模板,并在 AGENTS.md 追加 CURRENT.md 指针块
opencode-auto init [dir] -p "<需求描述>"   # 初始化后直接调用一次 AI 按需求填充 PLAN.md,人工审核后再 run
opencode-auto run [dir]      # 按 PLAN.md 逐任务自动执行
opencode-auto status [dir]   # 查看各任务状态
```

`init` 对已存在的 PLAN.md、opencode.json 一律跳过;`.opencode/agent/auto.md` 与内置
模板不一致时总是替换,保证 agent 契约为最新版本。

`run` 的选项:

| 选项 | 说明 |
| --- | --- |
| `--agent <name>` | 指定 opencode agent(默认使用目标目录配置) |
| `--server <url>` | 复用已运行的 `opencode serve`,不另起进程;也可用环境变量 `OPENCODE_AUTO_SERVER` |
| `--verbose [true]` | 输出会话内全部消息部件(文本、工具调用、推理、步骤等)与上下文用量/占比,每行带时间戳,并每 10 秒列出 git status 新出现的变动文件(含子目录中的嵌套 git 仓库) |
| `--interactive` / `-i` | 旁路交互(与 `--verbose` 互斥):终端保持非 verbose 的干净输出并常驻等待人工输入,回车把输入作为额外用户消息发往当前活动会话(steer 语义,在下一 provider turn 边界处理;无活动会话时输入丢弃并提示),等待输入不阻塞正常执行;日志文件仍保持 `--verbose` 级别的完整记录。`--wait-answer`/`--wait-between` 的人工等待也经这条输入行接收,ask 结束后恢复接收会话消息 |
| `--wait-answer [1-60]` | 提问先等待人工 stdin 答复(分钟):非权限提问超时自动答复;权限提问与权限审批(permission 请求)回答 `allow`/`yes`/`y` 等即授权放行,超时或其余回答则拒绝并阻塞;不带值默认 1 分钟;缺省此选项则立即自动答复、权限请求直接阻塞 |
| `--wait-between [1-60]` | 任务之间暂停等待人工(分钟):回车立即开始下一任务,超时自动继续;不带值默认 1 分钟;缺省此选项则任务间不暂停 |
| `--commit [mode]` | 提交时机:`subtask` 每完成一项子任务立即提交(缺省,并每 30 秒上报子任务进度与预计剩余时间);`task` 仅在每个任务收尾时提交;`once` 任务期间不提交,整个计划完成后开一次整体提交会话;`none` 从不提交。旧选项 `--commit-subtask` 保留为别名(`=false` 等价 `--commit task`) |
| `--subtask [mode]` | 子任务划分:`auto` 自动分解(缺省);`off` 关闭划分,单会话完成整个任务,未完成则回退 pending 等人工改进后重试;`ondemand` 先单会话执行,上下文达到 `--context-limit` 时 driver 插入交接提示,AI 写出 `docs/T-NNN.handoff.md` 后由新会话续跑 |
| `--dryrun [true]` | 权限预检:只调用一次 AI,列出执行任务可能需要的 opencode.json 授权之外的目录/操作并逐只读探查确认,报告写入 `.auto/dryrun.md` 并打印到终端;不执行任何任务 |
| `--context-limit [n]` | 会话复用的上下文已用量上限(单位: 千 tokens):上一会话已用量达到该上限即新建会话,与 50% 占比阈值同时生效(两者都满足才复用);`--subtask ondemand` 下同时是交接阈值;缺省为 64(即 64k tokens) |

每次 `run` 都会在目标目录的 `.auto/logs/run-<时间戳>.log` 新建日志文件,
终端的全部输出同步写入该文件(逐条直写,进程中断也不丢已输出内容);
`--interactive` 下日志文件额外包含 verbose 明细(会话部件、上下文用量、变更文件),与 `--verbose` 运行时的记录一致。

退出码:`0` 全部完成;`1` 用法/环境错误;`2` 阻塞或未完成为 pending,等待人工介入;`130` 被强制终止。

运行期间单次 Ctrl+C 不会终止(仅提示),3 秒内再次按下 Ctrl+C 才强制退出;
退出前会尽力恢复 PLAN.md 等文件的可写权限并关闭 opencode server。

每个任务与子任务开始时,输出会打出显著横幅(`=` 行为任务,`-` 行为子任务):

```
=============================================================
T-009 实现迁移
=============================================================

-------------------------------------------------------------
T-009 子任务 1：编写迁移脚本的 schema 部分
-------------------------------------------------------------
```

## 执行流水线

driver 对每个任务执行流水线,**PLAN.md 与 CURRENT.md 只由 driver 写入**。执行方式
由 `--subtask` 决定(`auto` 为缺省):

`--subtask auto`(自动分解):

1. **分解**(任务正文无检查项时):一个只读会话分析任务并写出
   `docs/T-NNN.subtasks.md`(Markdown 检查项);driver 解析后把检查项注入
   PLAN.md 正文。未产出有效文件会自动带反馈重试一次,仍失败则阻塞。
2. **逐子任务执行**:任务内所有执行会话(分解/子任务/修复/收尾)串成一条链,
   上一会话结束时上下文占比低于 50% 且已用量低于 `--context-limit`(默认 64k
   tokens)则下一个会话复用它,否则新建(占比与用量始终跟踪,与 `--verbose`
   无关;拿不到模型上下文上限时占比记 100,一律新建);
   子任务会话自我检查自己的工作,会话结束后 driver 直接勾选检查项——
   验收不在子任务级进行。
3. **收尾与验收**:见下方公共部分。

`--subtask off`(关闭划分):一个会话完成整个任务,随后进入公共收尾与验收;
验收不通过(或会话未能完成)时**不追加修复子任务**,driver 把任务状态改回
`pending` 并以退出码 2 停机,由人工改进 PLAN.md 后重新运行。

`--subtask ondemand`(按需交接):先按单会话执行;会话进行中上下文已用量达到
`--context-limit` 时,driver 向该会话插入交接提示,AI 把进度与后续步骤写入
`docs/T-NNN.handoff.md`(末行 `状态: 继续|完成`)后结束,driver 开新会话从交接
文档续跑,直到任务完成。验收差距仍按公共部分的修复子任务机制处理。

公共部分(**收尾与验收**):一个会话统一更新 docs/、按 `--commit` 配置清扫提交、
写 `docs/T-NNN.report.md`(含建议的 `verified-command:` 行与末行
`结论: 通过|差距`)。随后任务级审核会话(旁路独立会话,总是新建,不进会话链)
验收整个任务:审核者可读代码、自行运行或调整检查命令(任务 `verify` 字段与报告
中的命令均为参考),判定写入 `.auto/verify.md`(末行 `结论: 通过|差距`),driver
解析结论;通过后 driver 标 `[done]`(审核实际运行的命令记入 `verified` 字段);
差距会追加修复子任务重跑,最多 3 轮,耗尽阻塞(off 模式除外,见上)。

driver 全程不亲自执行任何固定 verify 命令——命令只是给审核 AI 的参考,
命令本身写错或环境不适用不会导致误判不通过。

当前任务镜像在 `CURRENT.md`(任务开始时即写入——中断运行遗留的缺失/过期文件会被
重建——每次勾选后刷新,含完整任务内容与进度);
`init` 追加的 AGENTS.md 指针块要求每个会话先读它——AGENTS.md 作为 system context
每个 provider turn 现场重读,不随上下文压缩丢失,server 无需重启。

上次运行被 kill/Ctrl+C 中断时,PLAN.md 可能遗留 `in_progress` 标记(实际无会话在跑);
`run` 启动时会把它们全部重置为 `pending` 再正常续跑(`attempts` 保留),无需手工清理。

`run` 期间 driver 会把 PLAN.md、CURRENT.md、opencode.json 置为只读
(chmod 0o444),driver 自身写入时临时恢复、写完立即重置;`run` 结束(含阻塞退出)
恢复可写,便于人工介入编辑。这是提示词契约之外的防误写护栏——同用户进程仍可经
bash chmod 绕过,并非安全边界。AGENTS.md 不在只读之列(任务可更新它),driver 只在
`run`/`init` 启动会话前确保其中存在 opencode-auto 指针块,缺失则追加。

## PLAN.md 格式

```md
# <项目> 实施计划

## T-001: 任务标题 [pending]
  - verify: command: bun test    # 或自然语言验收描述
任务描述:目标、范围、关键约束。不要手工编写子任务检查项——
分解会话会自动生成并注入。
```

- 任务标题格式:`## T-<编号>: <标题> [<状态>]`,状态为 `pending` / `in_progress` /
  `blocked` / `done`,driver 取第一个非 `done` 任务执行。状态标记前的空格可省略
  (`标题[pending]` 也能解析),但写计划时建议保留。
- 字段行(`  - key: value`)必须紧跟标题且连续。driver 会自行维护 `attempts`、
  `verified`、`question`、`answer` 等字段与全部状态标记,**请勿手工编辑**;
  agent 会话也被禁止编辑 PLAN.md 与 CURRENT.md。
- `verify` 是验收标准(命令或自然语言描述均可),作为旁路独立审核会话的验收
  依据与参考验证方式;审核通过后 driver 把审核实际运行的命令记入 `verified`
  字段并标 `[done]`。

## 阻塞与恢复

任务阻塞(退出码 `2`)时,driver 会把问题写入该任务的 `question` 字段并停机:

- **权限问题**:带 `--wait-answer` 运行时会先等待人工指令,回答 `allow`/`yes`/`y` 等
  即授权继续;否则按提示在目标目录 `opencode.json` 的 `permission` 规则中放行;
- **其他问题**:在会话外处理(或在 `answer` 字段填写解答),然后重新运行
  `opencode-auto run` 即可从阻塞处续跑。
