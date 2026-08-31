{{> head}}

当前任务(其他子任务由其他会话完成,不要碰):

{{taskBlock}}

{{#if blockedAnswered}}该任务此前被阻塞。上次的问题:"{{question}}",已获解答:"{{answer}}"。请据此继续。

{{/if}}{{#if blockedUnanswered}}该任务此前因以下问题被阻塞:"{{question}}"。用户未提供解答,直接重新运行了 driver,说明该问题不是提问而是会话外的事务(如授权、环境修复),用户已在会话外处理完毕。不要再就同一问题调用 question 工具,直接继续执行;若确认问题仍存在,自主决策处理方式。

{{/if}}{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}你本次只负责该任务的这一个子任务:

- [ ] {{subtask}}

约束:
1. 严格只完成这一个子任务,完成后立即按下方步骤收尾并结束会话,以控制单次会话的上下文大小;
{{> question-rule}}
3. 收尾:
   a. 自我检查该子任务是否真正完成;{{#if verify}}整个任务的验收在最后由独立审核会话统一进行,
      不通过会把差距反馈回来修复;{{/if}}
   b. {{#if verify}}不要运行任务级 verify(验收由 driver 交独立审核会话处理)、{{/if}}可新增但不要修改 docs/ 中的内容(若必须修改按 AUTO-DECISION 记入相关文档);{{> state-rule}}
