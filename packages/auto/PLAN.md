# opencode-auto 实施计划

非交互式编程 Agent 驱动器（driver）：将一份实施计划放入目标目录，driver 按任务逐步调用
opencode serve 完成开发；遇阻即停、生成问题描述、等待人工介入后以新会话续跑，直到计划全部完成。

## 架构决策（已确认）

1. **基于 `opencode serve` + `@opencode-ai/sdk/v2`，不改动 core**。
   - server spawn：`createOpencodeServer()`（`packages/sdk/js/src/v2/server.ts`）
   - client：`createOpencodeClient()`（`packages/sdk/js/src/v2/client.ts`）
   - 事件流：`GET /event`；question：`GET /question`、`POST /question/{requestID}/reply|reject`；
     session：`POST /api/session`、`POST /api/session/{id}/prompt`、`POST /api/session/{id}/interrupt`
2. **一个任务 = 一个全新会话**，会话间不共享上下文；文件系统是唯一状态源。
3. **非权限询问自动答复，同问题重问才停止**：监听到 `question.asked` 时，权限相关问题立即
   reject + interrupt，写入问题描述后 driver 退出；非权限问题由 driver 自动答复
    "你根据情况来自主决策如何做即可,..." 后继续执行，仅当就同一问题再次询问时才按
    阻塞处理；人工在会话外处理完毕后直接重启 driver 续跑，无需填写答案（可选填 answer 补充说明）。
   若运行时带 `--wait-answer [1-60]`（分钟，不带值默认 1，缺省为 0 即立即自动答复），
   非权限提问会先在命令行等待人工输入回答（回车确认），超时无响应才自动答复。
4. **完成以 Agent 自报为准**：verify 由 AI 解释并执行，执行通过则将实际命令写入任务的
   `verified` 字段作为高可信完成记录（未通过或未执行则不记录），验证通过还须勾选任务正文中
对应的验证检查项（`- [ ]` → `- [x]`）；driver 只在会话外
   重新解析计划文件复核 `[done]` 标记，不再复跑 verify 命令；未标 done 而 idle 仍按
   隐性 blocked 处理。
5. driver 本身作为本 monorepo 新包 `packages/auto` 开发（Bun + TypeScript，遵循根 AGENTS.md
   与 packages/opencode/AGENTS.md 规范；测试从 `packages/auto` 目录运行，不在仓库根跑）。

## 目标 PLAN.md 格式（driver 的解析对象，本文件自身亦遵循）

每个任务一个二级标题，状态标记在标题尾，`blocked` 段记录问答历史，`verify` 为验收标准：

```markdown
## T-NNN: 任务标题 [pending|in_progress|blocked|done]
  - verify: command: <验收命令>   # driver 亲自执行;也可为自然语言,由收尾会话翻译成命令
  - verified: <执行通过的命令>    # driver 验证通过后写入,作为高可信完成记录
  - blocked-at: <date>          # blocked 时由 driver 写入
  - question: "<上次卡住的问题>"  # blocked 时由 driver 写入
  - answer: "<人工解答>"         # 可选;阻塞后直接重新运行即续跑,无需填写
  - attempts: <n>
任务描述正文(注入分解会话 prompt 的核心内容;子任务检查项由分解会话产出、driver 注入)
```

driver 状态机：`pending → in_progress → done | blocked`；`blocked` → 重新运行 driver 即重新进入
`in_progress`（attempts + 1，无需填写 answer，可选 answer 会注入上下文）。
**PLAN.md 与 CURRENT.md 只由 driver 写入**：agent 会话不得编辑；子任务勾选在 driver 亲自
执行该项 verify 命令通过后发生；`[done]` 在任务级验收通过后由 driver 写入。
当前任务镜像在 CURRENT.md（每会话必读，抗上下文压缩），AGENTS.md 只含固定指针块。

---

## 任务列表

## T-001: 初始化 packages/auto 包骨架 [done]
  - verify: bun typecheck
建立 `packages/auto`：package.json（依赖 `@opencode-ai/sdk`）、tsconfig、入口
`src/index.ts`（CLI：`opencode-auto run <dir>` / `opencode-auto status <dir>`）。
遵循 monorepo 现有包的配置风格（参考 packages/cli）。

## T-002: 实现 PLAN.md 解析器与原子写回 [done]
  - verify: bun test
`src/plan.ts`：解析任务条目（ID、标题、状态、verify、blocked 段字段、正文），
支持状态翻转与 blocked 字段写入；写回采用临时文件 + rename 保证原子性。
用例覆盖：全部状态流转、含特殊字符的问答文本、重复 ID 报错。

## T-003: server 生命周期管理 [done]
  - verify: bun test
`src/server.ts`：优先连接已存在的 `opencode serve`（健康检查探活），否则
`createOpencodeServer()` 在目标目录拉起；driver 退出时若是自己拉起的则回收。

## T-004: 单任务会话执行器 [done]
  - verify: bun test
`src/runner.ts`：渲染 prompt 模板（任务正文 + 计划摘要 + 历史问答 + 完成契约：
解释执行 verify 验收标准、通过则记录 verified、标 done、更新 docs、git 提交全部未提交改动
（含之前会话中断遗留的改动，不限于本次会话修改的文件；含独立 .git 的子目录通常被父仓库
ignore，需按文件系统主动查找并先提交子仓库，父提交信息中记录其路径与 SHA）），
创建新 session，发送 prompt，消费 `GET /event` 事件流直到 session idle / question.asked / error。
`--new-session-subtask` 时改为严格按一个子任务一次全新会话执行：driver 从任务正文提取
`- [ ]` 检查项，逐项开新会话（prompt 只含该子任务，要求勾选对应检查项后立即结束，
不做 verify/标 done/docs），会话结束后 driver 重读 PLAN.md 确认该检查项已勾选（未勾选
按隐性 blocked 处理）；全部子任务完成后再开一个收尾会话统一执行完成契约；无检查项的
任务回退为单会话。以此控制任务完成过程中单次会话的最大上下文大小。

## T-005: 阻塞流程（显式 + 隐性） [done]
  - verify: bun test
显式：权限相关 `question.asked` → reject 该 question + interrupt session → 将问题与最近一条
assistant 消息摘要写入 PLAN.md blocked 段 → driver 以退出码 2 停机。非权限 question 由 driver
自动答复自主决策话术继续执行；同一问题被再次询问时走同一 blocked 流程。
隐性：session idle 但任务未标 done → 提取最后 assistant 消息作为问题描述，走同一
blocked 流程。瞬时会话错误（session.error，如 provider 网关报错）先换新会话自动重试
（共 3 次尝试，即重试 2 次），重试耗尽才走 blocked。

## T-006: 完成校验与文档收尾确认 [done]
  - verify: bun test
session idle 且任务已标 done 后：driver 重新从磁盘解析 PLAN.md 复核 `[done]` 标记即视为完成；
verify 由 agent 自行解释执行，driver 不再外部复跑。通过后才允许推进下一任务。

## T-007: 恢复扫描与主循环 [done]
  - verify: bun test
`src/loop.ts`：启动时扫描 PLAN.md，取第一个非 done 任务：pending → 下发；
blocked → 不要求 answer，直接开新会话续跑（attempts+1），prompt 告知 agent 问题已在
会话外解决、不要重问；有可选 answer 时注入问答历史。串行推进直到全部 done（退出码 0）。
任务完成时显示本次用时；`--verbose` 时每行输出带当前时间，并每 10 秒按文件修改
时间戳列出上次检查以来有变更的文件（跳过 node_modules 与 .git），便于观察进展。
`--commit-subtask` 时 prompt 要求 agent 每完成并勾选一项子任务检查项即按提交规则
提交一次（含嵌套 .git 子仓库），实现子任务级别的变动历史追踪；driver 同时每 30 秒
重读 PLAN.md 输出当前任务的子任务进度（done/total）、已用时与预计剩余用时（按已完成
子任务线性投影，精度受检查频度限制）。

## T-008: 目标项目模板与 Agent 契约 [done]
  - verify: bun test
`templates/`：目标目录的 `opencode.json`（permission 白名单规则）+ agent 配置，
system 契约明确：① 只做当前任务 ② 权限问题必须调用 question 工具报告；非权限问题自主决策，
调用 question 工具会被自动答复，同一问题重问才阻塞 ③ 完成须跑 verify、记录 verified、
勾选任务正文中已完成的检查项（含验证项）、标 done、更新 docs、
git 提交全部改动（被 ignore 的嵌套 .git 子仓库按文件系统查找、先提交，父提交信息记录其
路径与 SHA）。附 README 说明人工介入流程。

## T-009: 端到端验收 [done]
  - verify: bun test test/e2e.test.ts
`test/fixture/`：一个含 3 个任务的示例计划（其中一个任务设计成必然触发 question）。
全程自动跑通：任务 1 完成 → 任务 2 阻塞停机 → 模拟人工在会话外介入（不写 answer）→ 重启续跑
→ 任务 3 完成 → 退出码 0，且 PLAN.md 全部标 done、docs 已更新。

---

## 第二阶段：driver 独占状态写入的三段式流水线

背景：淘汰"AI 自维护 PLAN.md 状态"的工作方式。改为 driver 独占 PLAN.md/CURRENT.md 写入；
任务先经分解会话产出 `docs/T-NNN.subtasks.md`（每项带 verify 命令），driver 注入检查项后
逐子任务调度独立会话，并亲自执行 verify 命令判定勾选与 [done]；当前任务镜像到 CURRENT.md
（agent 契约要求每会话必读，抗上下文压缩）；server 长驻不重启（AGENTS.md/CURRENT.md 每个
provider turn 现场重读，无 server 级缓存）。

## T-010: plan.ts 状态编辑函数 [done]
  - verify: command: bun test test/plan.test.ts
  - verified: bun test test/plan.test.ts
新增 driver 侧编辑函数：`setSubtasks`（用分解结果替换正文检查项）、`tick`（勾选指定检查项）、
`appendSubtask`（修复轮追加检查项）、`markDone`（写 verified 字段并标 [done]，无 verified 时
清除该字段）；新增解析辅助 `subtaskVerify`（从检查项文本提取 ``(verify: `cmd`)``）与
`verifyCommand`（任务级 `verify: command: <cmd>` 前缀约定）。edit() 支持正文整体替换。
用例覆盖：注入/替换检查项、勾选、追加、markDone 有无 verified 两种路径、命令提取。

## T-011: prompt.ts 三类会话模板重构 [done]
  - verify: command: bun test test/prompt.test.ts
  - verified: bun test test/prompt.test.ts
替换现有模板：`renderDecompose`（只读分析，产出 docs/T-NNN.subtasks.md，每项必须带 verify
命令；禁止改实现代码与状态文件）；`renderSubtask`（做一个子任务 + 跑该项 verify + 按
commitSubtask 提交；不再勾选 PLAN.md）；`renderWrapup`（更新 docs、清扫提交、写
docs/T-NNN.report.md，含 `verified-command:` 行与末行 `结论: 通过|差距`；不再标 done）。
删除整任务模板 `render`。question 规则与提交规则保持不变。

## T-012: runner/loop 流水线与 CURRENT.md [done]
  - verify: command: bun typecheck && bun test
  - verified: bun typecheck && bun test
runner.ts 重写 runTask：begin → 无检查项时先跑分解会话并注入检查项（分解产物缺失/无检查项
按 blocked 处理）→ 逐未勾选子任务开独立会话，会话后 driver 亲自执行该项 verify 命令
（失败先开一次修复会话，仍失败按 blocked；无命令的检查项按可信勾选）→ 全部勾选后跑收尾
会话，driver 判定任务级验收（`command:` 前缀直接执行；否则从 report.md 提取
`verified-command` 执行；均无命令时按报告 `结论` 行判定）→ 通过则 markDone 完成，差距则
appendSubtask 追加修复子任务，最多 3 轮，耗尽按 blocked。删除 confirmDone/confirmTick。
新增 CURRENT.md 写入（任务开始与每次勾选后重写，含任务完整内容与进度快照）。
loop.ts 移除 newSessionSubtask 选项。server 保持长驻。

## T-013: CLI 与模板更新 [done]
  - verify: command: bun run build && bun test
  - verified: bun run build && bun test
index.ts 移除 `--new-session-subtask`（新流水线成为默认）；`init` 幂等维护 AGENTS.md 指针块
（`<!-- opencode-auto:start/end -->` 包围，告知每会话必读 CURRENT.md、勿编辑状态文件；
已存在则跳过，文件缺失则创建）。templates/PLAN.md 更新 verify 约定（`command:` 前缀、
不要手工写检查项）；templates/.opencode/agent/auto.md 重写工作契约（每会话先读 CURRENT.md、
状态文件只读、问题规则与提交规则保留）。

## T-014: e2e 全流程验收 [done]
  - verify: command: bun test test/e2e.test.ts
  - verified: bun test test/e2e.test.ts
更新 test/e2e.test.ts：fixture 的 verify 字段改用 `command:` 前缀；流程含分解会话，断言不变
（T-001 完成 → T-002 阻塞停机 → 会话外介入续跑 → T-003 完成 → 退出码 0）。

## T-015: 文档收尾 [done]
  - verify: command: bun typecheck
  - verified: bun typecheck
README.md 与包内 AGENTS.md 同步新行为约定：driver 独占 PLAN.md/CURRENT.md 写入、verify 分级
（command: 由 driver 执行，自然语言由收尾会话翻译）、CURRENT.md 抗压缩机制、server 长驻、
`--new-session-subtask` 移除；本文件（PLAN.md）的"目标 PLAN.md 格式"一节同步更新。

## T-016: 状态文件只读保护 [done]
  - verify: command: bun test && bun typecheck
  - verified: bun test && bun typecheck
`run` 期间把 driver 独占的文件（PLAN.md、CURRENT.md、opencode.json、AGENTS.md）chmod 为只读
（0o444），作为提示词契约之外的纵深防御；driver 自身写入（plan.ts edit、runner 写 CURRENT.md）
临时恢复可写、写完立即重新置只读；`run` 结束（含阻塞退出）在 finally 中恢复可写（0o644），
便于人工介入时正常编辑。新增 `src/protect.ts`（protect/unprotect/allowWrite/reprotect，
模块级开关，未启用时为 no-op 以兼容测试与单测脚本）。README、包内 AGENTS.md、agent 模板
契约同步说明（含局限：同用户进程可经 bash chmod 绕过，定位为防误写护栏而非安全边界）。

---

## 备注

- e2e 需要可用的 provider 凭证；CI 无凭证时 T-009 允许 mock provider 或用
  `opencode run` 同款的测试基建（参考 packages/opencode 现有测试）。
- 待全部任务完成后，本文件即为该系统的 dogfood 样本：用 opencode-auto 执行自身计划。
