# opencode-auto 目标目录模板

把本目录的三个文件复制到目标项目根目录:

- `PLAN.md` — 实施计划,driver 的状态源。每个任务一个 `## T-NNN:` 段,状态标记
  `[pending|in_progress|blocked|done]`,`verify` 字段声明完成后的外部校验命令。
- `opencode.json` — 权限白名单:安全的只读/构建/测试命令自动放行,其余 bash 命令
  升级为人工审批(触发阻塞流程)。
- `.opencode/agent/auto.md` — 非交互执行 agent 契约。

## 使用

```sh
opencode-auto run <dir> --agent auto
# 或连接已有的常驻 server:
OPENCODE_AUTO_SERVER=http://127.0.0.1:4096 opencode-auto run <dir> --agent auto
```

## 人工介入流程

1. driver 遇阻(question 工具 / 权限审批 / verify 失败 / 未标记完成就结束)会自动停机,
   退出码为 2,问题写入 `PLAN.md` 对应任务的 `question` 字段。
2. 人工排查后,把解答写入该任务的 `answer` 字段。
3. 重新运行 `opencode-auto run <dir>`,driver 会为该任务开启全新会话并携带问答历史继续。
4. 全部任务标记 `[done]` 后,driver 退出码为 0。

查看进度:`opencode-auto status <dir>`
