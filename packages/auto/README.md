# opencode-auto

按 `PLAN.md` 驱动 [opencode](https://opencode.ai) 自动逐任务执行实施的命令行工具。
状态由 driver 独占维护:每个任务先经分解会话拆成带验证命令的子任务,再逐子任务调度
会话完成(上一会话上下文占比低于 50% 时复用,否则新建),验收由旁路的独立审核会话
判定勾选与完成(driver 自己不执行固定命令);遇到权限问题或无法自主决策的反复提问时
停机等待人工处理。

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
opencode-auto run [dir]      # 按 PLAN.md 逐任务自动执行
opencode-auto status [dir]   # 查看各任务状态
```

`run` 的选项:

| 选项 | 说明 |
| --- | --- |
| `--agent <name>` | 指定 opencode agent(默认使用目标目录配置) |
| `--server <url>` | 复用已运行的 `opencode serve`,不另起进程;也可用环境变量 `OPENCODE_AUTO_SERVER` |
| `--verbose [true]` | 输出会话内全部消息部件(文本、工具调用、推理、步骤等)与上下文用量/占比,每行带时间戳,并每 10 秒列出 git status 新出现的变动文件(含子目录中的嵌套 git 仓库) |
| `--wait-answer [1-60]` | 提问先等待人工 stdin 答复(分钟):非权限提问超时自动答复;权限提问与权限审批(permission 请求)回答 `allow`/`yes`/`y` 等即授权放行,超时或其余回答则拒绝并阻塞;不带值默认 1 分钟;缺省此选项则立即自动答复、权限请求直接阻塞 |
| `--commit-subtask [true]` | 每完成一项子任务立即 git 提交,并每 30 秒上报子任务进度与预计剩余时间 |

每次 `run` 都会在目标目录的 `.auto/logs/run-<时间戳>.log` 新建日志文件,
终端的全部输出同步写入该文件(逐条直写,进程中断也不丢已输出内容)。

退出码:`0` 全部完成;`1` 用法/环境错误;`2` 阻塞等待人工介入。

## 执行流水线

driver 对每个任务执行三段式流水线,**PLAN.md 与 CURRENT.md 只由 driver 写入**:

1. **分解**(任务正文无检查项时):一个只读会话分析任务并写出
   `docs/T-NNN.subtasks.md`(Markdown 检查项,每项末尾标注建议的
   ``(verify: `<命令>`)``);driver 解析后把检查项注入 PLAN.md 正文。
   未产出有效文件会自动带反馈重试一次,仍失败则阻塞。
2. **逐子任务执行**:任务内所有执行会话(分解/子任务/修复/收尾)串成一条链,
   上一会话结束时上下文占比低于 50% 则下一个会话复用它,否则新建
   (占比始终跟踪,与 `--verbose` 无关;拿不到模型上下文上限时一律新建);
   会话结束后由一个**旁路的独立审核会话**(总是新建,不进会话链)审核该子任务:
   审核者可读代码、自行运行或调整检查命令,判定写入 `.auto/verify.md`
   (末行 `结论: 通过|差距`),driver 解析结论,通过才勾选;不通过先开一次
   修复会话再复审,仍不通过则阻塞。无 verify 标注的检查项按可信勾选。
3. **收尾**:一个会话统一更新 docs/、清扫提交、写 `docs/T-NNN.report.md`
   (含建议的 `verified-command:` 行与末行 `结论: 通过|差距`)。随后任务级
   审核会话独立验收整个任务(任务 `verify` 字段与报告中的命令均为参考),
   通过后 driver 标 `[done]`(审核实际运行的命令记入 `verified` 字段);
   差距会追加修复子任务重跑,最多 3 轮,耗尽阻塞。

driver 全程不亲自执行任何固定 verify 命令——命令只是给审核 AI 的参考,
命令本身写错或环境不适用不会导致误判不通过。

当前任务镜像在 `CURRENT.md`(任务开始与每次勾选后重写,含完整任务内容与进度);
`init` 追加的 AGENTS.md 指针块要求每个会话先读它——AGENTS.md 作为 system context
每个 provider turn 现场重读,不随上下文压缩丢失,server 无需重启。

`run` 期间 driver 会把 PLAN.md、CURRENT.md、opencode.json、AGENTS.md 置为只读
(chmod 0o444),driver 自身写入时临时恢复、写完立即重置;`run` 结束(含阻塞退出)
恢复可写,便于人工介入编辑。这是提示词契约之外的防误写护栏——同用户进程仍可经
bash chmod 绕过,并非安全边界。

## PLAN.md 格式

```md
# <项目> 实施计划

## T-001: 任务标题 [pending]
  - verify: command: bun test    # 或自然语言验收描述
任务描述:目标、范围、关键约束。不要手工编写子任务检查项——
分解会话会自动生成并注入。
```

- 任务标题格式:`## T-<编号>: <标题> [<状态>]`,状态为 `pending` / `in_progress` /
  `blocked` / `done`,driver 取第一个非 `done` 任务执行。
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
