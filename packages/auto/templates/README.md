# opencode-auto 模板目录

本目录是主程序的**内置模板源**(编译期嵌入独立二进制)。不需要手工复制到目标项目:
`opencode-auto <dir>` 每次运行都会幂等维护目标目录里的对应文件。用户文档见
[上层 README.md](../README.md)。

## 目标目录维护产物

| 模板 | 写入位置(目标目录) | 维护规则 |
| --- | --- | --- |
| `PLAN.scaffold.md` | `PLAN.md` | 仅在 `PLAN.md` 缺失、或仍是历史遗留的占位任务模板时写入**空模板**;任务由阶段规划会话填充,状态与字段(`attempts`/`verify`/`verified`/`question`/`final`)由 driver 独占维护 |
| `opencode.json` | `opencode.json` | 权限白名单:安全的只读/构建/测试命令自动放行,其余 bash 命令升级为人工审批(触发阻塞流程);**仅缺失时创建**,已有文件不改写(人工可编辑) |
| `.opencode/agent/auto.md` | `.opencode/agent/auto.md` | 非交互执行 agent 契约;与模板不一致即替换(契约漂移以模板为准),按配置的 `verify` / `testByDriver` 两态渲染 |
| (无模板) | `.opencode/auto/config.json` | 首次运行把命令行显式给出的关键参数与缺省值一起固化(版本化、随仓库共享、人工可编辑) |

本目录的 `PLAN.md` 是旧的占位任务模板,主程序不再写它:保留用于识别并替换历史遗留的
占位 `PLAN.md`,同时作为 `verify` 条件渲染的漂移校验样本。

## 提示词与模式模板

- `prompts/` — 各类会话的提示词(每种会话一个文件,共享片段集中在 `prompts/_partials.md`)。
  目标目录 `.opencode/auto/prompts/<name>.md` 同名文件可覆盖任意内置模板,不需要重新编译;
  协议敏感模板(判定/审核/脚本生成/参数推断)被覆盖时会校验 driver 解析所依赖的关键协议行,
  缺失即以退出码 1 失败。改完模板须跑 `test/prompt.test.ts` 防协议行漂移。
- `modes/` — 内置场景模式文件(`-m/--mode` 选择)。目标目录 `.opencode/auto/modes/<name>.md`
  可新增模式或覆盖内置——**新增模式 = 放一个模式文件,零源码改动**。

新增内置模板文件时,必须在对应登记处同步加一条 `with { type: "file" }` 导入
(`src/tool.ts` 顶部、`src/phases.ts`、`src/template.ts` 的 embedded 注册表、`src/mode.ts`)——
这是嵌入独立二进制的唯一方式。

## 使用

```sh
# 首跑: 固化配置 + 维护模板产物 + 自动推进完整 admtvk 二次迁移;再跑自动断点续跑
opencode-auto <dir>

# 项目意图(每次运行均可整写覆盖 .opencode/auto/brief.md,无 -p 时保留既有文件)
opencode-auto <dir> -p "<项目意图>"

# 迁移参数(都不给则由参数推断会话依据前置知识自动推断并固化)
opencode-auto <dir> --source-dir legacy --source-path pkg --dest-dir app

# 只跑一次权限预检,不执行任何任务
opencode-auto <dir> --dryrun

# 复用已有的常驻 server(缺省自动 spawn 并托管一个 opencode serve)
OPENCODE_AUTO_SERVER=http://127.0.0.1:4096 opencode-auto <dir>

# 提问与权限审批先等待人工在命令行作答(分钟,1-60,不带值默认 1):非权限提问超时自动答复
opencode-auto <dir> --wait-answer 5

# verbose: 输出会话内全部消息部件(文本、工具调用、推理、步骤等)与上下文用量/占比,
# 每行带时间戳,并每 10 秒列出 git status 新出现的变动文件(含嵌套 .git 子仓库)
opencode-auto <dir> --verbose

# interactive: 旁路交互(与 --verbose 互斥)——终端保持干净输出并常驻等待输入,
# 回车把输入发往当前活动会话;日志文件仍保留 verbose 级完整记录
opencode-auto <dir> --interactive

# commit: 会话后统一提交(缺省启用,收回 agent 的提交权)——任何会话结束且 driver 完成
# 状态写入后递归提交全部改动(先嵌套 .git 子仓库后本仓库),标题带任务编号与阶段;
# false 关闭:改动留在工作区由人工提交
opencode-auto <dir> --commit false

# subtask: 子任务划分档位 off|auto|ondemand(缺省 auto)
# off = 一个会话完成整个任务(验收不通过不做修复重跑,直接回退 pending 停机);
# ondemand = 单会话执行、上下文达 contextLimit 的 2 倍时写交接文档换新会话续跑
opencode-auto <dir> --subtask off
```

关键参数(`--mode`/`--agent`/`--source-*`/`--dest-dir`/`--subtask`/`--verify`/`--commit`/
`--context-limit`/`--idle-time`/`--idle-max`/`--test-by-driver`/`--handover-test`)只在
**首次运行**时生效并固化;二次运行起显式给出且与固化值不一致即用法错误(退出码 1),
修订通道为直接编辑 `.opencode/auto/config.json`。完整选项表与机制说明见
[README.md](../README.md#使用)。

## 人工介入流程

1. driver 遇阻(权限相关 question / 权限审批 / 会话错误重试耗尽 / 未标记完成就结束)会自动停机,
   退出码为 2,问题写入 `PLAN.md` 对应任务的 `question` 字段。
   非权限的 question 会被 driver 自动答复("你根据情况来自主决策如何做即可,…")并继续执行;
   只有就同一问题再次询问时才会停机等待人工介入。
   若运行时带 `--wait-answer [1-60]`(不带值默认 1 分钟),提问(含权限提问与
   权限审批)会先在命令行等待人工输入回答(回车确认):权限请求回答 allow/yes/y 等
   即授权放行并继续,超时或其余回答才拒绝并阻塞;非权限提问超时无响应则自动答复;
   不带此选项则非权限提问立即自动答复、权限类提问直接阻塞。
2. 阻塞的问题不是提问,而是需要在会话外处理的事务(如放行权限、修复环境)。
   人工排查处理后**无需填写 `answer` 字段**,直接重新运行即可,driver 会为该任务开启
   全新会话并告知 agent 问题已在会话外解决、不要重问。
   (可选:如需给 agent 补充说明,仍可填写 `answer` 字段,会一并注入上下文。)
3. 重新运行 `opencode-auto <dir>`,driver 依 `.auto/progress.json` 与 PLAN.md 状态从断点
   精确续跑(会话半途中断、记录仍新鲜时复用原会话,不重做已完成的工作)。
4. 全部阶段完成(阶段台账 `docs/phases.md` 覆盖 `admtvk` 全部字母)→ 退出码为 0,并写完成
   标记 `.auto/tool.json`;此后重跑报告"已全部完成"并退出 0,删除该文件可显式开启新一轮。

## 查看进度

`status` 子命令已移除,进度直接看文件:

- `PLAN.md` — 任务与子任务检查项的勾选状态及各字段;
- `CURRENT.md` — 当前任务镜像;任务完成即删除,非完成结局保留文件并写入"中断备注";
- `docs/phases.md` — 阶段台账;每次启动也会打印一行阶段进度,如 `阶段: a✓ d✓ m▶ t v k`;
- `.auto/progress.json` — 断点恢复依据;`.auto/logs/run-<时间戳>.log` — 完整运行日志;
- `docs/T-NNN.subtasks.md` / `.report.md` / `.fix.md` / `.audit.md`、`.auto/verify.md` /
  `.auto/review.md` — 各会话产出与判定记录。
