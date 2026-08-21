# opencode-auto

按 `PLAN.md` 驱动 [opencode](https://opencode.ai) 自动逐任务执行实施的命令行工具。
每个任务在一个(或按子任务拆分的多个)opencode 会话中完成,完成与否只以磁盘上的
`PLAN.md` 状态为准;遇到权限问题或无法自主决策的反复提问时停机等待人工处理。

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
opencode-auto init [dir]     # 生成 PLAN.md、opencode.json、.opencode/agent/auto.md 模板
opencode-auto run [dir]      # 按 PLAN.md 逐任务自动执行
opencode-auto status [dir]   # 查看各任务状态
```

`run` 的选项:

| 选项 | 说明 |
| --- | --- |
| `--agent <name>` | 指定 opencode agent(默认使用目标目录配置) |
| `--server <url>` | 复用已运行的 `opencode serve`,不另起进程;也可用环境变量 `OPENCODE_AUTO_SERVER` |
| `--verbose [true]` | 输出 agent 文本与时间戳,并每 10 秒列出变更文件 |
| `--wait-answer [1-60]` | 非权限提问先等待人工 stdin 答复(分钟),超时自动答复;不带值默认 1 分钟;缺省此选项则立即自动答复 |
| `--commit-subtask [true]` | 每完成一项子任务检查项立即 git 提交,并每 30 秒上报子任务进度与预计剩余时间 |
| `--new-session-subtask [true]` | 每个子任务检查项用独立新会话执行(控制单会话上下文),最后跑一个收尾会话做 verify 与标记 [done] |

退出码:`0` 全部完成;`1` 用法/环境错误;`2` 阻塞等待人工介入。

## PLAN.md 格式

```md
# <项目> 实施计划

## T-001: 任务标题 [pending]
  - verify: 验收标准(自然语言或命令,由 agent 解释并执行,如 bun test)
任务描述:目标、范围、关键约束。可含子任务检查项:

- [ ] 子任务一
- [ ] 子任务二

## T-002: 任务标题 [pending]
  - verify: ...
任务描述
```

- 任务标题格式:`## T-<编号>: <标题> [<状态>]`,状态为 `pending` / `in_progress` /
  `blocked` / `done`,driver 取第一个非 `done` 任务执行。
- 字段行(`  - key: value`)必须紧跟标题且连续。driver 会自行维护 `attempts`、
  `verified`、`question`、`answer` 等字段,请勿手工编辑。
- `verify` 是验收标准描述,由 agent 自己解释并执行;执行通过后 agent 会把实际命令
  记入 `verified` 字段。driver 只检查 `[done]` 标记(或子任务勾选),不重新执行 verify。

## 阻塞与恢复

任务阻塞(退出码 `2`)时,driver 会把问题写入该任务的 `question` 字段并停机:

- **权限问题**:按提示在目标目录 `opencode.json` 的 `permission` 规则中放行;
- **其他问题**:在会话外处理(或在 `answer` 字段填写解答),然后重新运行
  `opencode-auto run` 即可从阻塞处续跑。
