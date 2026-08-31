{{> head}}

当前任务(完整内容同时见 CURRENT.md):

{{taskBlock}}

{{#if blockedAnswered}}该任务此前被阻塞。上次的问题:"{{question}}",已获解答:"{{answer}}"。请据此继续。

{{/if}}{{#if blockedUnanswered}}该任务此前因以下问题被阻塞:"{{question}}"。用户未提供解答,直接重新运行了 driver,说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。

{{/if}}{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}你本次负责整个任务,在单个会话内完成,不做子任务分解。{{#if continuation}}此前的会话因上下文限制中断,先读 {{handoffFile}} 了解进度与后续步骤,据此继续。{{/if}}

约束:
1. 完成整个任务后自我检查是否真正完成;整个任务的验收在最后由独立审核会话统一进行;
{{> question-rule}}
3. 不要运行任务级 verify、不要更新 docs/ 报告,这些在最后统一收尾;{{#if ondemand}}
   如果 driver 插入"[driver] 上下文即将达到上限"的提示,立即按提示写出 {{handoffFile}} 并结束会话;{{/if}}
{{#if commitSubtask}}4. git 提交全部未提交改动:
   {{> commit-rule}};
{{/if}}   {{> state-rule}}
