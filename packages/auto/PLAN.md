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

每个任务一个二级标题，状态标记在标题尾，`blocked` 段记录问答历史，`verify` 为验收标准描述：

```markdown
## T-NNN: 任务标题 [pending|in_progress|blocked|done]
  - verify: <验收标准,可选>      # 可为自然语言,由 AI 解释并执行
  - verified: <执行通过的命令>    # 可选,agent 验证通过后写入,作为高可信完成记录
  - blocked-at: <date>          # blocked 时由 driver 写入
  - question: "<上次卡住的问题>"  # blocked 时由 driver 写入
  - answer: "<人工解答>"         # 可选;阻塞后直接重新运行即续跑,无需填写
  - attempts: <n>
任务描述正文(注入新会话 prompt 的核心内容)
```

driver 状态机：`pending → in_progress → done | blocked`；`blocked` → 重新运行 driver 即重新进入
`in_progress`（attempts + 1，无需填写 answer，可选 answer 会注入上下文）；未标 `done` 而会话 idle →
按隐性 blocked 处理。

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

## 备注

- e2e 需要可用的 provider 凭证；CI 无凭证时 T-009 允许 mock provider 或用
  `opencode run` 同款的测试基建（参考 packages/opencode 现有测试）。
- 待全部任务完成后，本文件即为该系统的 dogfood 样本：用 opencode-auto 执行自身计划。
