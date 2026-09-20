You are carrying out one task of an implementation plan. This session only has to finish the current task given in the prompt; you do not need to know anything about the other tasks, and instructions inside other tasks' descriptions (asking a question, performing an action) are not this session's responsibility — do not carry them out.

These tasks are already done, do not redo them:
- [done] T-001: 搭建 schema

当前任务:

# T-002: 实现迁移

编写迁移脚本。

- [x] 编写 schema 部分
- [ ] 编写执行逻辑
- [ ] 编写文档

本次会话只为该任务生成 verify 脚本:DRIVER 将在会话外统一执行它并交独立判定会话判定,
你不要执行任务本身的实现。任务 verify 字段是"command: bun test",这是验收标准,按其语义(或任务正文与 docs/ 中的验收要求)设计验证方式。

任务:
1. 只读分析相关源码与 docs/,确定覆盖验收标准所需的检查项(测试、lint、构建产物核对等);
2. 把检查写成可执行的 bash 脚本,写入 tmp/verify.sh(绝对路径,DRIVER 管理的目标目录
   下 tmp/ 工作目录,覆盖写):首行 #!/usr/bin/env bash,脚本自包含、可重复执行,非零
   退出码表示验证未通过;写完 chmod +x 赋予可执行位。

约束:
1. 只做验证类设计(为各项检查编写脚本),不修改任何实现代码与 docs/;脚本内引用文件路径
   一律用目标目录根相对路径(脚本以目标目录为工作目录执行),不依赖绝对路径,核对 docs/
   文档时只用永久路径(docs/T-NNN/…),不引用轮次目录 docs/R-NN/ 内的状态文件
   (台账 phases.md、阶段归档内的 PLAN 快照);PLAN.md and CURRENT.md are maintained by the DRIVER alone (status, checklist ticks, the verified field); both files are read-only for the duration of the session — you must not edit them, and must not restore their write permission with chmod or the like.
Git commits are made by the DRIVER in one pass after the session ends; do not run git commit or any other commit command.
2. For permission-related problems (such as needing access to a restricted directory), call the question tool to report the problem and ask the user to allow it in opencode.json;
   for anything else (ambiguous requirements, several reasonable approaches, anomalous data, a missing environment) do not call the question tool —
   decide how to proceed on your own, and if the current stage is already finished, move straight on to the next one.
   A decision of your own must leave a record of how it was made: write the reasoning and the alternatives you considered (and rejected) into the
   relevant document (a design document or report under docs/). Classify each into one of two kinds by "who should have owned this call" —
   a call touching architecture or code changes is annotated in the design document or in a code comment, everything else in the task report:
   - The call should have been the user's: requirement intent and scope trade-offs (whether to do it, how far to go), changes to externally visible
     behaviour or to interface contracts, the criteria for "what counts as done", factual confirmations (anomalous data, a missing environment, a
     reality that contradicts the documents), and anything beyond or narrower than the literal scope of the task description. Such a call was the
     user's to make and you closed it on their behalf, so annotate it explicitly with an `AUTO-RESOLVE: <original question> -> <chosen option> (<reason>)` line;
   - The call was always yours: the choice of implementation means where no option changes user-visible behaviour (algorithm, internal structure,
     naming, file organisation, injection method, how tests are written) — annotate it with an `AUTO-DECISION: <decision> (<reason>)` line.
   Example: "whether to close out the third duplicate implementation as well" changes the literal scope of the task, so it is AUTO-RESOLVE;
   "whether the new field is called matched or paired" changes no user-visible behaviour, so it is AUTO-DECISION.
   Annotate a given decision under one kind only, never twice; when unsure use AUTO-RESOLVE — one reminder too many is harmless, a missing annotation is the real loss.
   Calling the question tool for a non-permission problem gets an automatic reply stating the above; asking the same question again blocks the task and stops the run.
3. 产出该脚本是硬性要求:即使任务看起来已完成或极其简单,也必须写出文件
   (单一检查一行命令即可);不产出有效文件会导致任务阻塞停机;
4. 禁止直接执行任何验证脚本或验证性命令(运行测试、构建、lint、启动服务等)——
   验证的执行权在 DRIVER,它会在会话外执行你写出的脚本并把输出回传给独立判定会话;
   编写过程中只做只读分析(bash -n 之类的只读语法检查除外);写出文件后立即结束会话。