{{> head}}

当前任务:

{{taskBlock}}

{{#if blockedAnswered}}该任务此前被阻塞。上次的问题:"{{question}}",已获解答:"{{answer}}"。请据此继续。

{{/if}}{{#if blockedUnanswered}}该任务此前因以下问题被阻塞:"{{question}}"。用户未提供解答,直接重新运行了 driver,说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。

{{/if}}{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}{{#if subtaskList}}本任务的完整子任务列表(按序执行,其他项由其他会话完成,不要碰):

{{subtaskList}}

你本次只负责其中的第 {{index}} 项:

{{/if}}{{^subtaskList}}你本次只负责该任务的这一个子任务:

{{/if}}- [ ] {{subtask}}
{{#if continuation}}
此前的会话因上下文限制中断,先读 {{handoffFile}} 了解进度与后续步骤,据此继续。
{{/if}}
{{#if warm}}本会话已继承任务背景上下文(理解阶段的摘要与已加载内容),无需重读已在上下文中的文件;如仍缺背景,可读 docs/{{taskId}}.context.md 摘要。{{/if}}{{^warm}}如存在 docs/{{taskId}}.context.md,先读之了解任务背景再开始(不存在则按需自行阅读源码)。{{/if}}

{{#if outputFile}}产出约定:本项若产出文档/分析/设计类内容,写入 {{outputFile}}(独立文件,标题写在首行,不并入其他文档);代码类产出直接落于源码树。

{{/if}}约束:
1. 严格只完成这一个子任务,完成后立即按下方步骤收尾并结束会话,以控制单次会话的上下文大小;
{{> question-rule}}
3. 收尾:
   a. 自我检查该子任务是否真正完成;{{#if verify}}整个任务的验收在最后由独立审核会话统一进行,
      不通过会把差距反馈回来修复;{{/if}}
   b. {{#if verify}}不要运行任务级 verify(验收由 driver 交独立审核会话处理)、{{/if}}可新增但不要修改 docs/ 中的内容(若必须修改按 AUTO-DECISION 记入相关文档);{{> state-rule}}
   c. 如果 driver 插入"[driver] 上下文即将达到上限"的提示,立即按提示写出 {{handoffFile}}(末行 `状态: 继续|完成`,以本子任务是否完成计)并结束会话,由新会话凭交接文档继续;
{{#if testByDriver}}
测试执行协议(--test-by-driver): 不要在会话内直接运行编译、测试、构建、lint 等可能耗时长或产生大量输出的命令;需要时把命令写成脚本放入 test/ 目录(命名清晰、可执行、可复用),再把脚本路径(相对工作目录,如 test/build.sh)写入 tmp/test.sh 告知 driver 执行,然后结束本轮消息等待。driver 执行后会把退出码与输出文件路径(stdout 与 stderr 合并落入单文件)反馈回本会话,你直读文件判断结果;需要再次测试时把同一脚本路径再次写入 tmp/test.sh 即可重跑(脚本可先修改再重跑)。{{#if handoverTest}}测试失败且本会话上下文达到上限时,driver 会要求你把进度与后续步骤写入 {{testHandoffFile}} 并结束会话,由新会话继续。{{/if}}{{/if}}
