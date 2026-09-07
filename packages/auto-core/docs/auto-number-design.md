# --auto-number 自动编号:设计基准与会话交接

> 本文档是 `--auto-number` 的设计基准。主体代码、后续工作清单(新测试、文档
> 同步、构建回归)已全部完成并通过 typecheck 与全量测试(2026-09-04)。
> **修订(2026-09-07,stable-refs P3 / D5)**:`autoNumber` 缺省值自 `false` 翻转为
> `true`(`--no-auto-number` 保留为退出开关);除缺省值外机制零改动,下文"缺省 =
> `--no-auto-number`""缺省 false"等表述为翻转前的历史基准。

## 目标

引入一对布尔开关 `--auto-number` / `--no-auto-number`(缺省 = `--no-auto-number`,
沿用历史行为):

- **--auto-number**:任务编号(T-NNN)在目标目录**永不重复**;关键编号记录
  (.auto/next-task)缺失时,可通过 AI 会话推导恰当的下一任务编号以恢复记录。
- **--no-auto-number**:现状——阶段规划会话每阶段自 T-001 重排编号,无持久化记录
  (阶段化流程下 PLAN.md 每阶段交接后重置空模板,编号跨阶段/跨轮次会重复,
  docs/T-NNN.*.md 等产物文件名与提交信息中的编号随之冲突)。

## 已确认决策(用户拍板)

1. **开关层级 = init 宪法级**:固化到 .opencode/auto/config.json 的 `autoNumber`
   键(布尔,缺省 false);init/continue 接受这对开关(amend 语义),run 出现即
   退出码 1(报文给修订指引);两开关同现且均未带 `=false` 为用法错误退出码 1。
2. **记录载体 = .auto/next-task 状态文件**:内容仅为一个正整数(下一可用编号)。
   driver 维护;.auto/ 已被 gitignore,新克隆天然缺失 → 正好触发恢复流程。
3. **恢复时机 = 缺失时先恢复再继续**:惰性触发于阶段规划会话之前(planPhase
   入口),不在 run 启动时无条件检查(m 模式无规划会话,开关不产生效果;init 时
   该组合打一次 ℹ 提示)。

## 机制设计

- **编号消费点只有阶段规划会话**:planPhase 先 `ensureNumbering` 确保记录就位,
  把记录值作为 `numberStart` 注入 phase-plan.md 模板(`任务编号自 T-NNN 起连续
  递增,不得复用更早编号`,替代原「自 T-001」文案);collect 校验全部任务编号
  ≥ 记录起点,复用已占用编号视为无效产出,走 requireArtifact「带反馈重试一次,
  仍失败隐性阻塞退出 2」语义;成功后 `advanceNextTask` 把记录推进到本次最大编号
  +1(只增不减)。
- **记录恢复(ensureNumbering,src/numbering.ts)**:
  - 记录存在且为合法正整数 → 直接使用;
  - 缺失 → 先算确定性下限 `taskNumberFloor`(扫描当前 PLAN.md、
    docs/phases/**/PLAN.md 归档、docs/**/T-*.md 产物文件名,取最大编号 +1;
    解析失败的 PLAN 退化为标题行正则提取);
  - floor = 1(无任何历史证据,全新项目)→ 直接写 1,不开会话;
  - floor > 1 → 开旁路一次性 AI 恢复会话(模板 number-recovery.md,伪任务 PLAN、
    requireArtifact 骨架、提交 stage=numbering),AI 另可查 git 提交历史发现
    产物已删除的编号,把推导结果写入 .auto/next-task;driver 以 floor 校验产出
    (小于下限 = 无效,重试一次仍失败隐性阻塞)。
- **T-F 终审编号不参与**:T-F<k> 是独立推导命名空间(按既有终审任务数 +1),
  不进入自动编号记录(taskNumber 只认 `T-<纯数字>`)。

## 已完成的改动(文件级)

- `src/config.ts` — `ProjectConfig.autoNumber`(缺省 false)、validateProjectConfig
  布尔校验、formatProjectConfig 条件段「· 自动编号 on」。
- `src/index.ts` — BOOLEAN_FLAGS 增 auto-number/no-auto-number;run 冻结清单
  加两键(专属修订指引文案);init 分支互斥校验 + explicit.autoNumber 合并;
  init 在 `autoNumber && phases === "m"` 时打 ℹ 提示;runAll Opts 注入
  `autoNumber: config.autoNumber`;用法文案(两行命令行 + 宪法级选项清单 +
  一条选项说明)。
- `src/numbering.ts`(新增)— NEXT_TASK_FILE / taskNumber / readNextTask /
  writeNextTask / taskNumberFloor / advanceNextTask / ensureNumbering。
- `templates/prompts/number-recovery.md`(新增)— 恢复会话提示词(下限输入、
  证据清单、硬性产出协议);`src/template.ts` 登记 embedded +
  PROTOCOL_MARKERS([".auto/next-task"])。
- `src/prompt.ts` — renderPhasePlan 加 `numberStart?: number`(渲染为补零的
  T-NNN 数字段);新增 renderNumberRecovery({floor})。
- `templates/prompts/phase-plan.md` — 编号起点条件段(`{{#if numberStart}}` /
  `{{^numberStart}}`)。
- `src/loop.ts` — runAll Opts 加 `autoNumber?`;planPhase 接线(ensureNumbering
  → numberStart 注入 → collect 复用校验 → advanceNextTask 推进并打日志)。
- `AGENTS.md` — 宪法级选项清单与导航各加一条。
- 既有测试快照修复(非新测试):test/e2e.test.ts 两处 config 全键断言补
  `autoNumber: false`;test/template.test.ts 模板清单断言 18 → 19 并补
  "number-recovery"。

## 验证现状

- `bun typecheck` 通过;`bun test` 273 个测试(271 pass + 2 个 e2e 条件跳过)全绿。
- 手工冒烟:init --auto-number 固化配置并打印「自动编号 on」摘要、phases="m" 提示;
  run --auto-number 退出码 1 且报文正确;两开关同现退出码 1;--no-auto-number amend
  回 false;taskNumberFloor/advanceNextTask/渲染均已验证。
- `bun run build` 通过,新模板 number-recovery 已确认嵌入独立二进制(dist/opencode-auto)。

## 后续工作清单(已全部完成)

1. **新测试**(已编写,bun test 从 packages/auto 运行):
   - `test/numbering.test.ts`(新文件):taskNumber 边界(T-F1/非数字)、readNextTask
     非法内容、taskNumberFloor(空目录/当前 PLAN/归档 PLAN/docs 产物/解析失败
     退化/T-F 不参与)、advanceNextTask 只增不减、ensureNumbering 纯函数面
     (记录存在直接用 / floor=1 直接写 1)。
   - config.test.ts:autoNumber 缺省 false、非法值(非布尔)严格失败、merge amend
     语义、formatProjectConfig「自动编号 on」条件段。
   - e2e.test.ts:init --auto-number 固化 true、--no-auto-number 覆盖回 false、
     两开关同现(init/continue)退出码 1、run --auto-number/--no-auto-number 退出
     码 1 且报文含成对修订指引、phases = "m" 提示、=false 视同未给出。
   - prompt.test.ts:renderPhasePlan numberStart 开/关两态文案、
     renderNumberRecovery 协议内容(.auto/next-task、floor 原值与补零、git 历史
     证据、硬性产出协议);渲染前 usePromptLibrary(undefined) 复位。
   - loop/planPhase 的 collect 编号复用校验与记录推进会拉起会话,未覆盖(只测
     纯函数面,按既定取舍)。
2. **文档同步**(已完成):README.md(breaking 清单、配置表 autoNumber 行、init
   选项表、continue 按轮修订清单、阶段化流程一节末尾「自动编号」行为描述)、
   docs/behavior.md(宪法级选项枚举行补两键、新增 --auto-number 行为契约条、
   统一提交 PLAN 伪任务 label 清单补 numbering、模板计数 18→19 与协议敏感模板
   清单补 number-recovery)、docs/structure.md(src/numbering.ts 与本设计文档条目、
   模板计数 19、index.ts/config.ts/prompt.ts/loop.ts/template.ts 条目补 autoNumber
   描述、git.ts 条目伪任务 label 清单)、src/git.ts 注释(Auto-Stage 伪任务阶段
   标签);templates/README.md 无选项/模板计数描述,无需同步。
3. **构建回归**(已完成):见上「验证现状」。
4. 全文检索「18 个」「auto-number」已确认无遗漏描述。
