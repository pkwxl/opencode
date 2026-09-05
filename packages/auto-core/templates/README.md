# opencode-auto 目标目录模板

把本目录的三个文件复制到目标项目根目录:

- `PLAN.md` — 实施计划,driver 的状态源。每个任务一个 `## T-NNN:` 段,状态标记
  `[pending|in_progress|blocked|done]`,配置启用验收(`verify: true`)时任务带
  `verify` 字段描述任务级验收标准(命令或自然语言),由旁路的独立判定会话解释
  driver 执行的验证脚本;通过会把实际命令写入 `verified` 字段作为高可信完成记录
  (未启用验收时模板不含 verify 字段与验收描述,任务收尾后直接标 done)。
  子任务检查项由分解会话生成、由 driver 直接勾选。
- `opencode.json` — 权限白名单:安全的只读/构建/测试命令自动放行,其余 bash 命令
  升级为人工审批(触发阻塞流程)。
- `.opencode/agent/auto.md` — 非交互执行 agent 契约。

## 使用

```sh
opencode-auto run <dir> --agent auto
# 或连接已有的常驻 server:
OPENCODE_AUTO_SERVER=http://127.0.0.1:4096 opencode-auto run <dir> --agent auto
# 提问与权限审批时等待人工在命令行作答(分钟,1-60,默认 1):非权限提问超时自动答复,
# 权限请求回答 allow/yes/y 等即授权放行,超时或其余回答则阻塞:
opencode-auto run <dir> --agent auto --wait-answer 5
# verbose: 输出会话内全部消息部件(文本、工具调用、推理、步骤等)与每条助手消息的上下文用量/占比,
# 每行输出带当前时间,并每 10 秒列出 git status 新出现的变动文件(含嵌套 .git 子仓库),便于观察进展:
opencode-auto run <dir> --agent auto --verbose true
# interactive: 旁路交互(与 --verbose 互斥)——终端保持干净输出并常驻等待输入,
# 回车把输入作为额外消息发往当前活动会话(无活动会话时丢弃);日志文件仍保留 verbose 级完整记录:
opencode-auto run <dir> --agent auto --interactive
# commit: 会话后统一提交(缺省启用,收回 agent 的提交权)——任何会话结束且 driver 完成状态写入后,
# driver 递归提交全部改动(先嵌套 .git 子仓库后本仓库),提交信息带任务编号与阶段,
# 实现子任务级别的变动历史追踪与按会话回滚;false 关闭:
opencode-auto run <dir> --agent auto --commit false
# new-session-subtask: 严格按一个子任务一次全新会话执行(任务正文需用 - [ ] 检查项列出子任务),
# 控制单次会话的最大上下文大小;每个子任务会话结束以其检查项勾选为准,
# 全部子任务完成后再开一个收尾会话统一更新 docs、提交剩余改动,
# 随后由旁路独立审核会话做任务级验收,通过则由 driver 标 [done]:
opencode-auto run <dir> --agent auto --new-session-subtask
```

## 人工介入流程

1. driver 遇阻(权限相关 question / 权限审批 / 会话错误重试耗尽 / 未标记完成就结束)会自动停机,
   退出码为 2,问题写入 `PLAN.md` 对应任务的 `question` 字段。
   非权限的 question 会被 driver 自动答复("你根据情况来自主决策如何做即可,...")并继续执行;
   只有就同一问题再次询问时才会停机等待人工介入。
   若运行时带 `--wait-answer [1-60]`(不带值默认 1 分钟),提问(含权限提问与
   权限审批)会先在命令行等待人工输入回答(回车确认):权限请求回答 allow/yes/y 等
   即授权放行并继续,超时或其余回答才拒绝并阻塞;非权限提问超时无响应则自动答复;
   不带此选项则非权限提问立即自动答复、权限请求直接阻塞。
2. 阻塞的问题不是提问,而是需要在会话外处理的事务(如放行权限、修复环境)。
   人工排查处理后**无需填写 `answer` 字段**,直接重新运行即可,driver 会为该任务开启
   全新会话并告知 agent 问题已在会话外解决、不要重问。
   (可选:如需给 agent 补充说明,仍可填写 `answer` 字段,会一并注入上下文。)
3. 重新运行 `opencode-auto run <dir>`,driver 会为该任务开启全新会话并携带历史继续。
4. 全部任务标记 `[done]` 后,driver 退出码为 0。

查看进度:`opencode-auto status <dir>`
