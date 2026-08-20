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
3. **询问即停止**：监听到 `question.asked` 立即 reject + interrupt，写入问题描述后 driver 退出；
   人工在计划文件中填写答案后重启 driver，开新会话续跑。
4. **完成不信任 Agent 自报**：driver 在会话外重新解析计划文件确认标记，并亲自执行任务的
   `verify` 命令，失败则回退为 blocked。
5. driver 本身作为本 monorepo 新包 `packages/auto` 开发（Bun + TypeScript，遵循根 AGENTS.md
   与 packages/opencode/AGENTS.md 规范；测试从 `packages/auto` 目录运行，不在仓库根跑）。

## 目标 PLAN.md 格式（driver 的解析对象，本文件自身亦遵循）

每个任务一个二级标题，状态标记在标题尾，`blocked` 段记录问答历史，`verify` 声明外部校验命令：

```markdown
## T-NNN: 任务标题 [pending|in_progress|blocked|done]
  - verify: <shell 命令,可选>
  - blocked-at: <date>          # blocked 时由 driver 写入
  - question: "<上次卡住的问题>"  # blocked 时由 driver 写入
  - answer: "<人工解答>"         # 人工填写;driver 见 answer 即续跑
  - attempts: <n>
任务描述正文(注入新会话 prompt 的核心内容)
```

driver 状态机：`pending → in_progress → done | blocked`；`blocked` + 有 `answer` → 重新进入
`in_progress`（attempts + 1）；未标 `done` 而会话 idle → 按隐性 blocked 处理。

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
运行 verify、标 done、更新 docs），创建新 session，发送 prompt，消费
`GET /event` 事件流直到 session idle / question.asked / error。

## T-005: 阻塞流程（显式 + 隐性） [done]
  - verify: bun test
显式：`question.asked` → reject 该 question + interrupt session → 将问题与最近一条
assistant 消息摘要写入 PLAN.md blocked 段 → driver 以退出码 2 停机。
隐性：session idle 但任务未标 done → 提取最后 assistant 消息作为问题描述，走同一
blocked 流程。错误/重试耗尽同样走 blocked。

## T-006: 完成校验与文档收尾确认 [done]
  - verify: bun test
session idle 且任务已标 done 后：driver 重新从磁盘解析 PLAN.md 复核标记；
任务声明了 `verify` 时在目标目录执行该命令；任一失败 → 回退 blocked 并附输出。
通过后才允许推进下一任务。

## T-007: 恢复扫描与主循环 [done]
  - verify: bun test
`src/loop.ts`：启动时扫描 PLAN.md，取第一个非 done 任务：pending → 下发；
blocked 有 answer → 注入问答历史开新会话（attempts+1）；blocked 无 answer →
打印等待提示退出（退出码 2）。串行推进直到全部 done（退出码 0）。

## T-008: 目标项目模板与 Agent 契约 [done]
  - verify: bun test
`templates/`：目标目录的 `opencode.json`（permission 白名单规则）+ agent 配置，
system 契约明确：① 只做当前任务 ② 无法自主决策必须调用 question 工具、禁止猜测
③ 完成须跑 verify、标 done、更新 docs。附 README 说明人工介入流程。

## T-009: 端到端验收 [done]
  - verify: bun test test/e2e.test.ts
`test/fixture/`：一个含 3 个任务的示例计划（其中一个任务设计成必然触发 question）。
全程自动跑通：任务 1 完成 → 任务 2 阻塞停机 → 脚本模拟人工写 answer → 重启续跑
→ 任务 3 完成 → 退出码 0，且 PLAN.md 全部标 done、docs 已更新。

---

## 备注

- e2e 需要可用的 provider 凭证；CI 无凭证时 T-009 允许 mock provider 或用
  `opencode run` 同款的测试基建（参考 packages/opencode 现有测试）。
- 待全部任务完成后，本文件即为该系统的 dogfood 样本：用 opencode-auto 执行自身计划。
