# <项目> 实施计划

## T-001: <任务标题> [pending]
  - verify: command: <建议的验收命令,如 bun test>
<任务描述:目标、范围、关键约束。verify 也可为自然语言(去掉 command: 前缀),
由旁路脚本生成会话翻译成可执行脚本;`command:` 前缀的具体命令由 driver 包装为
脚本亲自执行,判定一律由独立判定会话做出。验证脚本与验证命令的执行权在 driver:
任务描述不要要求执行者亲自运行验证命令/脚本或自行下验收结论,验收标准统一写在
verify 字段(opencode-auto check 可检查违背该原则的描述)。不要手工编写子任务
检查项——driver 会先调度分解会话自动生成并注入。下一个会话仅凭 CURRENT.md、
PLAN.md 与 docs/ 理解上下文。>

## T-002: <任务标题> [pending]
  - verify: command: <建议的验收命令>
<任务描述>
