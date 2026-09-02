{{> head}}

当前任务:

{{taskBlock}}

任务级独立审核会话对本任务的验收未通过,差距如下:

{{gap}}

约束:
1. 只修复审核指出的差距,逐项核对并修复,不要做差距之外的实现工作;
{{> question-rule}}
3. {{#if verify}}不要运行任务级 verify(验收由 driver 交独立审核会话处理)、{{/if}}不要更新 docs/(最后统一收尾);
   {{> state-rule}}
4. 修复完成并自我检查后,立即结束会话。
{{#if testByDriver}}
测试执行协议(--test-by-driver): 不要在会话内直接运行测试命令;需要测试时,把完整测试脚本写入 tmp/test.sh(可执行;目标目录下 driver 管理的工作目录),然后结束本轮消息等待 driver 执行。driver 执行后会把退出码与完整输出文件路径反馈回本会话,你直读文件判断结果;需要再次测试时重写 tmp/test.sh,重跑同一测试可把反馈中给出的归档脚本复制为 tmp/test.sh。{{#if handoverTest}}测试失败且本会话上下文达到上限时,driver 会要求你把进度与后续步骤写入 {{testHandoffFile}} 并结束会话,由新会话继续。{{/if}}{{/if}}
