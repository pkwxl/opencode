[driver] 此前的会话在测试失败且上下文达到上限后交接。先读 {{handoffFile}} 了解进度与后续步骤,{{#if runScript}}再核对最近一次测试: 退出码 {{runCode}},输出 {{runOut}} 与 {{runErr}},脚本归档 {{runScript}},{{/if}}然后继续完成任务;测试仍按协议把脚本写入 tmp/test.sh 由 driver 执行,不要在会话内直接运行。{{#if stuck}}
注意: 测试交接已连续进行 {{stuck}} 次。请先评估是否陷入了当前无法解决的问题: 若是,以 `AUTO-FIXME: <原因与计划>` 在代码注释或 docs/ 文档中标注遗留,记录后跳过该问题继续后续工作;若认为可以解决,继续修复。{{/if}}
