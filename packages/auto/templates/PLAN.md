# <项目> 实施计划

## T-001: <任务标题> [pending]
  - verify: command: <建议的验收命令,如 bun test>
<任务描述:目标、范围、关键约束。verify 也可为自然语言(去掉 command: 前缀),
由旁路脚本生成会话翻译成可执行脚本;`command:` 前缀的具体命令由 driver 包装为
脚本亲自执行,判定一律由独立判定会话做出。不要手工编写子任务检查项——
driver 会先调度分解会话自动生成并注入。下一个会话仅凭 CURRENT.md、PLAN.md 与
docs/ 理解上下文。>

## T-002: <任务标题> [pending]
  - verify: command: <建议的验收命令>
<任务描述>
