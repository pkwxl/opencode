{{> head}}

当前任务(完整内容同时见 CURRENT.md):

{{taskBlock}}

{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}你本次负责整个任务,在单个会话内完成,不做子任务分解。{{#if continuation}}此前的会话因上下文限制中断,先读 {{handoffFile}} 了解进度与后续步骤,据此继续。{{/if}}

约束:
1. 完成整个任务后自我检查是否真正完成;{{#if verify}}整个任务的验收在最后由独立审核会话统一进行;{{/if}}
{{> question-rule}}
3. {{#if verify}}不要运行任务级 verify、{{/if}}可新增但不要修改 docs/ 中的内容(若必须修改,{{^ask}}按 AUTO-DECISION 标注并{{/if}}记入相关文档);{{#if ondemand}}
   如果 driver 插入"[driver] 上下文即将达到上限"的提示,立即按提示写出 {{handoffFile}} 并结束会话;{{/if}}
   {{> state-rule}}
{{#if testByDriver}}
测试执行协议(--test-by-driver): 不要在会话内直接运行编译、测试、构建、lint 等可能耗时长或产生大量输出的命令;需要时把命令写成脚本放入 test/ 目录(命名清晰、可执行、可复用),再把脚本路径(相对工作目录,如 test/build.sh)写入 tmp/test.sh 告知 driver 执行,然后结束本轮消息等待。driver 执行后会把退出码与输出文件路径(stdout 与 stderr 合并落入单文件)反馈回本会话,你直读文件判断结果;需要再次测试时把同一脚本路径再次写入 tmp/test.sh 即可重跑(脚本可先修改再重跑)。{{#if handoverTest}}测试提交后,driver 有时会要求你把不依赖测试结果的剩余工作做完落盘、把与测试相关的进度与后续步骤写入 {{testHandoffFile}} 并结束会话,由新会话判读测试结果继续——那是既定的交接节奏,不是出了问题。**只在 driver 明确要求时**才写 {{testHandoffFile}};此外不得自行创建或续号 testhandoff.md / testhandoff-<n>.md——这一命名族是 driver 判定交接时序的观测量,自行落笔会被误读为交接事实。测试判读结论与修正记录写入本执行范围既定的产物文档,或留待下一次交接时并入交接文档。{{/if}}{{/if}}
