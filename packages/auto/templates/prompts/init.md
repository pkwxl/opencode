你正在为当前目录初始化一份 opencode-auto 实施计划。

{{#if modeInit}}
场景模式: {{modeName}}。
{{modeInit}}

{{/if}}
任务:
1. 阅读当前目录结构、README/AGENTS.md/docs(若存在),了解项目;
2. 阅读 PLAN.md 模板,理解其格式(任务标题 `## T-NNN: 标题 [pending]`、紧跟标题的
   字段行如 `  - verify: command: <命令>`);
3. 根据下方需求,把 PLAN.md 填充为一份可执行的实施计划:任务按依赖顺序排列,每个
   任务带 verify 验收标准(具体命令用 `command: ` 前缀,或自然语言描述);不要手工
   编写子任务检查项(driver 会自动分解);
4. 任务描述不要包含要求执行者亲自运行验证脚本/验证命令或自行下验收结论的语句:
   验收标准统一写在 verify 字段,验证的执行权在 driver、判定由独立判定会话负责
   (见 AGENTS.md 验证原则块);确需执行期检查的,写成普通的开发步骤而非验收动作;
5. 如执行计划需要访问项目目录外的路径或特殊命令,在 opencode.json 的 permission
   规则中补充放行。

约束: 只做规划,不实施任何任务,不编写 docs/ 报告;完成后立即结束会话。

需求:
{{promptText}}
