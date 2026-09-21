{{> head}}

当前任务:

{{taskBlock}}

{{#if modeExec}}场景模式注意事项({{modeName}}):
{{modeExec}}

{{/if}}{{#if solo}}该任务的实现已在之前的会话中完成,不要重做。本次会话只执行收尾:{{/if}}{{^solo}}该任务的全部子任务已在之前的会话中逐一完成,不要重做。本次会话只执行收尾:{{/if}}

1. 更新 docs/ 中受本任务影响的文档,使下一个会话仅凭磁盘文件就能理解当前进展;
2. 写 docs/{{taskId}}/report.md:{{#if reportForm}}{{reportForm}}{{/if}}{{#if solo}}
   {{/if}}供后续会话与审核者仅凭磁盘文件了解本次任务的产出。报告中的引用(文档或代码)一律
   写目标目录根相对路径(如 docs/{{taskId}}/S01/index.md、src/foo.ts:42,反引号或链接,可带
   :行号),写前确认路径存在——失效引用会被 DRIVER 的引用检查拦截;行号锚可能随目标文件
   修改而漂移,DRIVER 会对不一致的锚自动追加 @<sha> 版本标记(该范围仅对标记的历史版本
   有效),已带标记的引用不要自行改动;不要引用轮次目录 docs/R-NN/ 内的状态文件
   (台账 phases.md、阶段归档内的 PLAN 快照);
3. 任务状态由 DRIVER 在会话结束后统一登记。{{> state-rule}}{{#if resultRule}}
   结论行:{{resultRule}}
   结论行写在 docs/{{taskId}}/report.md 最后一行正文(终止符之前)、独占一行,只能是
   `Result: PASS` 或 `Result: FAIL <一句话原因>`——这是 DRIVER 协议串,照原样书写,不要翻译、
   不要加粗或加列表符号;DRIVER 读到 `Result: FAIL` 即把本任务置为阻塞、停止运行交人工处理。{{/if}}
{{#if resolveList}}
4. 本任务执行期间 DRIVER 自动代答了以下本应由你询问用户的问题(无人值守下 DRIVER 代替
   用户把它们闭环了,你当时收到的是自动答复):

{{resolveList}}

   请在 docs/{{taskId}}/report.md 中单列「自动代答问题」一节,逐条写
   `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)`——原问题照抄上面列出的,所选方案与
   理由写你当时实际怎么定的。上面每一条都必须出现{{#if auditScope}};{{auditScope}}{{/if}}{{^auditScope}}。{{/if}}
{{/if}}
以上全部完成前不要结束会话。

{{> eof-rule}}

{{> doc-layout}}
