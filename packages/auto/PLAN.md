# opencode-auto 实施计划

非交互式编程 Agent 驱动器（driver）：将一份实施计划放入目标目录，driver 按任务逐步调用
opencode serve 完成开发；遇阻即停、生成问题描述、等待人工介入后以新会话续跑，直到计划全部完成。

历史任务（第一阶段..第四阶段，T-001..T-024）已全部完成，原文归档于
[docs/plan-archive.md](./docs/plan-archive.md)；行为约定的权威文档为包内 AGENTS.md 与
README.md。本文件只保留格式契约与当前阶段任务。

## 目标 PLAN.md 格式（driver 的解析对象，本文件自身亦遵循）

每个任务一个二级标题，状态标记在标题尾，`blocked` 段记录问答历史，`verify` 为验收标准：

```markdown
## T-NNN: 任务标题 [pending|in_progress|blocked|done]
  - verify: command: <验收命令>   # driver 包装为脚本亲自执行;也可为自然语言,由旁路脚本生成会话翻译成可执行脚本
  - verified: <执行通过的命令>    # driver 验证通过后写入,作为高可信完成记录
  - final: <stage>@<round>      # driver 写入的终审阶段标记(--final-review 追加的 T-F 任务,stage ∈ audit|remediate|validate|finalize)
  - blocked-at: <date>          # blocked 时由 driver 写入
  - question: "<上次卡住的问题>"  # blocked 时由 driver 写入
  - answer: "<人工解答>"         # 可选;阻塞后直接重新运行即续跑,无需填写
  - attempts: <n>
任务描述正文(注入分解会话 prompt 的核心内容;子任务检查项由分解会话产出、driver 注入)
```

driver 状态机：`pending → in_progress → done | blocked`；`blocked` → 重新运行 driver 即重新进入
`in_progress`（attempts + 1，无需填写 answer，可选 answer 会注入上下文）。
**PLAN.md 与 CURRENT.md 只由 driver 写入**：agent 会话不得编辑；子任务勾选在子任务
会话结束后由 driver 按可信勾选（验收统一在任务级进行）；`[done]` 在任务级验收
通过后由 driver 写入。
当前任务镜像在 CURRENT.md（每会话必读，抗上下文压缩），AGENTS.md 只含固定指针块。

---

## 任务列表

## 第五阶段：-m/--mode 模式层与 --final-review 终审闭环

背景：不同场景（迁移/优化/新实现/测试）下提示词侧重不同，需要不影响 driver 调度状态机的
轻量模式层；既有 `--review` 的终审只是最后一个任务的单会话全面审核、无修复闭环，需要
任务驱动的多阶段终审流程（Audit → Refactor/Patch → Validate → Finalize，Validate 可回退
Audit、审计轮上限熔断）。完整设计见 docs/mode-final-review-design.md（唯一设计基准，含
已确认决策、状态机与恢复规则、文件级改动清单；与其冲突的旧表述以该文档为准）。

## T-025: 模式层 src/mode.ts 与 CLI 接线 [done]
  - verify: command: bun typecheck && bun test
按设计文档 A 节实现提示词级模式层（V1 仅注册 migrate；optimize/implement/test 为既定
扩展名，未注册即不可用）：
- 新增 src/mode.ts：ModeSpec 类型（name / init / exec / final{audit, validate, finalize}，
  文案中文）；MODES 注册表仅 migrate（迁移/升级场景——init 导语：以保持外部行为不变为
  前提、任务按"基线确认 → 迁移改造 → 回归验证"排布、verify 优先复用既有测试/构建命令；
  exec 注记：与旧实现对等行为、兼容层与 AUTO-DECISION 标注要求；final 各阶段侧重——
  audit 新旧行为对等与残留旧路径、validate 回归覆盖、finalize 旧实现清理与兼容层收尾）；
  resolveMode(name) 未注册返回 undefined；
- index.ts：-m/--mode 进 VALUE_FLAGS 并新增短选项 -m（镜像 -p 的吞值规则），init 与 run
  均接受、缺省 migrate，未注册名为用法错误退出码 1（报文列出当前支持的模式），用法文本
  更新；run 经 Opts 透传，init -p 传入 renderInit；
- prompt.ts：renderInit 增模式导语段；renderDecompose/renderSubtask/renderWrapup/
  renderWhole 的 Opts 增 mode 注入 exec 段；
- runner.ts：Opts 增 mode 并透传至上述 render 调用；
- 新增 test/mode.test.ts（resolveMode 注册命中与未注册返回 undefined）；test/prompt.test.ts
  补模式注入断言（renderInit 出现 migrate 导语、执行类模板出现 exec 段）。
  遵循包内 AGENTS.md 代码风格（中文注释、Bun API 优先、避免 any）。

## T-026: 终审基础设施 plan.ts 与 prompt.ts [done]
  - verify: command: bun typecheck && bun test
按设计文档 B.3/B.4 实现终审闭环的数据与提示词基础（依赖 T-025）：
- plan.ts：Task 解析新增 final 字段（FIELD 行通用解析，edit 重写时随全部字段保留）；
  新增 appendTask(path, task)——文件尾追加完整任务块（标题行 + 字段行 + 正文，原子写，
  复用 edit 的 allowWrite/reprotect 流程）；
- prompt.ts：新增 renderFinalTask(plan, stage, round, prior, mode)，四阶段
  audit/remediate/validate/finalize 的旁路生成会话模板：输入上游产物指针与残余差距原文，
  产出提案 docs/final/plan-<stage>-r<N>.md（`# 标题`、自包含正文、可选
  `verify: command: <命令>` 行）；约束只规划不实施、verify 优先复用原任务验证命令、
  不得发明未运行过的检查；audit@r≥2 聚焦残余差距不全量重审；注入 mode.final[stage]
  侧重；复用 QUESTION_RULE/STATE_RULE，硬性要求产出提案文件；
- test/plan.test.ts：appendTask 追加与重复解析往返、final 字段往返、既有用例不回归；
- test/prompt.test.ts：renderFinalTask 关键断言（提案路径、阶段侧重注入、硬性要求句式、
  verify 命令约束语）。

## T-027: 终审状态机 src/final.ts 与 loop/runner 接线 [done]
  - verify: command: bun typecheck && bun test
按设计文档 B.1/B.2/B.5/B.6/C 节实现终审闭环状态机与 CLI（依赖 T-026）：
- index.ts：--final-review 进 VALUE_FLAGS，parseFinalReviewLimit 镜像 parseReviewLimit
  风格（缺省 0 不启用、裸选项 2、显式值须为 1..5 整数否则用法错误退出码 1），用法文本更新；
- runner.ts：导出 requireArtifact 与 runSession（或等价窄包装）供旁路生成会话复用；
  audit/validate 终审任务（依 final 字段）强制 review=0（--early 随之自然失效），
  refactor/patch/finalize 不变；
- 新增 src/final.ts：状态机路由纯函数——终审位置由（带 final 标记的任务及其状态，
  docs/final/ 产物）推导，无新增持久化状态；策略行（重构|修补|无）与结论行
  （通过|差距 <描述>）解析；appendFinalTask（T-F<k> 按追加顺序编号、
  `final: <stage>@<round>` 字段、audit/validate 固定结构检查 verify 命令、remediate
  取提案 verify 行）；审计轮计数与熔断（block 最后终审任务，question 引用残余差距
  原文与报告指针，退出码 2）；幂等重建规则 C.1..C.5（提案已产出未追加直接解析追加、
  下一阶段任务已存在不重复生成、任务 done 但报告缺失按阻塞提示人工核查）；
- loop.ts：Opts 透传 finalReview；主循环 runTask 完成且任务带 final 标记后解析报告
  路由追加下一任务；next() 为空且终审未完成时启动生成会话续跑循环；终审启动横幅；
  终审任务沿用既有 waitBetween/commit/退出码语义；
- 新增 test/final.test.ts（路由表：策略 无/重构/修补、结论 通过/差距、熔断与轮计数；
  提案文件幂等追加；状态重建各分支）——纯函数 + fixture 文件，不依赖 server 与网络。

## T-028: 终审文档同步与收尾 [done]
  - verify: command: bun typecheck && bun test
按设计文档 D 节 P3 收尾（依赖 T-027）：
- test/e2e.test.ts：补 CLI 解析用例（镜像既有风格）——-m 未注册名退出码 1、
  --final-review 非法值退出码 1、--final-review 与 --review/--early-review 组合不误报；
- README.md：命令表新增 -m/--mode 与 --final-review [1-5]（语义、组合矩阵、熔断与
  退出码）；新增终审闭环段落（T-F 任务、docs/final/ 产物、audit/validate 跳过逐任务
  审核、终审 verify 仍属 driver 执行不经权限体系的既有明示）；
- 包内 AGENTS.md：结构节补 src/mode.ts、src/final.ts 与 renderFinalTask 条目；行为
  约定新增 --mode 与 --final-review 条目（组合矩阵、熔断语义、模式不持久化的 V1 取舍）；
- 本文件"目标 PLAN.md 格式"注释行补 final 字段说明（driver 写入的终审阶段标记）；
- 通读更新后的两份文档与 src/ 实现逐项对照一致，无残留矛盾表述。

---

## 备注

- e2e 需要可用的 provider 凭证；CI 无凭证时允许 mock provider 或用 `opencode run`
  同款的测试基建（参考 packages/opencode 现有测试）。
- 各阶段完成后本文件持续作为该系统的 dogfood 样本：用 opencode-auto 执行自身计划。
