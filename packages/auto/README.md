# opencode-auto

按 `PLAN.md` 驱动 [opencode](https://opencode.ai) 自动逐任务执行实施的命令行工具。
状态由 driver 独占维护:每个任务先经分解会话拆成带验证命令的子任务,再逐子任务调度
独立会话完成,driver 亲自执行 verify 命令判定勾选与完成;遇到权限问题或无法自主决策的
反复提问时停机等待人工处理。

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
| `--wait-answer [1-60]` | 非权限提问先等待人工 stdin 答复(分钟),超时自动答复;不带值默认 1 分钟;缺省此选项则立即自动答复 |
| `--commit-subtask [true]` | 每完成一项子任务立即 git 提交,并每 30 秒上报子任务进度与预计剩余时间 |

退出码:`0` 全部完成;`1` 用法/环境错误;`2` 阻塞等待人工介入。

## 执行流水线

driver 对每个任务执行三段式流水线,**PLAN.md 与 CURRENT.md 只由 driver 写入**:

1. **分解**(任务正文无检查项时):一个只读会话分析任务并写出
   `docs/T-NNN.subtasks.md`(Markdown 检查项,每项末尾标注
   ``(verify: `<命令>`)``);driver 解析后把检查项注入 PLAN.md 正文。
   未产出有效文件会自动带反馈重试一次,仍失败则阻塞。
2. **逐子任务执行**:每个未勾选检查项一个全新会话(控制单会话上下文);
   会话结束后 driver 亲自执行该项 verify 命令,通过才勾选;失败先开一次
   修复会话,仍失败则阻塞。无 verify 命令的检查项按可信勾选。
3. **收尾**:一个会话统一更新 docs/、清扫提交、写 `docs/T-NNN.report.md`
   (含 `verified-command:` 行与末行 `结论: 通过|差距`)。driver 据此判定:
   `verify: command: <cmd>` 前缀的任务直接执行该命令;否则提取报告中的
   verified-command 执行;均无命令时按结论行判定。差距会追加修复子任务
   重跑,最多 3 轮,耗尽阻塞。

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
- `verify` 是验收标准:`command: <命令>` 前缀表示由 driver 亲自执行;自然语言
  描述由收尾会话翻译成命令写入 report.md 的 `verified-command` 行,再由 driver
  执行;执行通过后 driver 把实际命令记入 `verified` 字段并标 `[done]`。

## 阻塞与恢复

任务阻塞(退出码 `2`)时,driver 会把问题写入该任务的 `question` 字段并停机:

- **权限问题**:按提示在目标目录 `opencode.json` 的 `permission` 规则中放行;
- **其他问题**:在会话外处理(或在 `answer` 字段填写解答),然后重新运行
  `opencode-auto run` 即可从阻塞处续跑。
