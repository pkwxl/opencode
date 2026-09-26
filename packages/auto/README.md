# opencode-auto

按任务单元(阶段任务索引 `tasks.md` + `docs/T-NNN/`)驱动 [opencode](https://opencode.ai) 自动逐任务执行实施的命令行工具。
宪法级项目属性(agent 契约、提交语义、上下文预算、场景模式)经 `init` 固化到
`.opencode/auto/config.json`(版本化、随仓库共享、人工可编辑),`run` 只控制本次执行。
状态由 driver 独占维护:每个任务先经分解会话拆成子任务,再逐子任务调度会话完成
(缺省每个会话独立新建;`OPENCODE_AUTO_REUSE_SESSION=on` 时上一会话上下文占比低于
50% 且 5 分钟内结束则复用,会话结束即由 driver 勾选),收尾后由 driver 标 done。
检查/验收是规划出来的工作(验收任务、v 验收阶段):任务报告末尾的结论行写
`Result: FAIL` 时 driver 在提交后把该任务置为阻塞并停止运行,交人工调整任务
(任务级验收 `verify`、质量审核 `--review` 与终审闭环 `--final-review` 已于
2026-09-21 退役,见[验收结论行](#验收结论行result-passfail));遇到无法自主决策的
反复提问、`--permission ask-fail` 下无人答复的权限请求等情况时停机等待人工处理。
中断(含应用崩溃、网络故障)后重新运行可依进度记录精确恢复到中断的会话与阶段。

## 构建独立可执行文件

```sh
cd packages/auto
bun run build            # 生成 dist/opencode-auto(本机平台)
bun run build -- --target bun-windows-x64   # 交叉编译,产物带平台后缀
```

产物是单个自包含文件(模板与 SDK 已嵌入),拷贝到任意机器即可运行。
运行 `run` 时只需目标机器装有 `opencode` CLI——缺省会自动启动并托管一个
`opencode serve` 实例;也可提供已有 server 地址复用外部实例(见
[opencode server 与 agent 选择](#opencode-server-与-agent-选择))。

也可以不构建,直接用 Bun 运行源码:

```sh
bun run packages/auto/src/index.ts <子命令> ...
```

## 使用

```sh
opencode-auto init [dir]     # 初始化项目配置层:把项目配置固化到 .opencode/auto/config.json,生成 opencode.json、.opencode/agent/auto.md 模板与 .opencode/auto/brief.md 项目简报桩,在 AGENTS.md 幂等同步单一 opencode-auto 标记块,并把 driver 工作目录(tmp/、.auto/)、本地私有文件(/.gitignore、/.env、/AGENTS.md、/opencode.json、模型注册表项目层 /.opencode/auto/models.json)与目录树内的嵌套 git 仓库写进 .gitignore;不写 docs/——轮次目录由 plan 建立
opencode-auto amend [dir] --<键选项> <值> ...   # 只改写给出的配置键,其余保留(至少一个键;无配置即拒绝),见"修订(amend)"
opencode-auto fix [dir] [-f]  # 按规则修复配置层: 退役键删除/更名/迁入 brief.md,契约、AGENTS.md 块、.gitignore 与配置对齐,见"配置修复(fix)"
opencode-auto plan [dir] [-p "<规划输入>" | --file <路径>]   # 规划当前阶段的任务并停在执行前供人工评审;轮未建立时先建轮(打印轮首门禁),轮完成后经轮关闭检查开下一轮(见"规划与轮次生命周期(plan)")
opencode-auto run [dir]      # 按当前阶段的任务索引逐任务自动执行(agent/提交等语义来自项目配置)
opencode-auto reset [dir]    # 反初始化(与 init 互逆): 移除 init 写出的配置层产物,把工作区还原至未初始化状态
opencode-auto check [dir]    # 检查 AGENTS.md 与任务文档中违背验证/测试/提交执行权原则的描述,全量扫描 docs/ 活文档失效引用,并提示 AGENTS.md 标记块缺失或过期
opencode-auto status [dir]   # 打印项目配置摘要与只读的轮次 → 阶段 → 任务 → 子任务树
opencode-auto models [dir] [--probe]   # 打印模型注册表的生效表(各阶段类型 × 会话角色的档位、候选与当前可用性);--probe 另向每个列入的模型发送恢复探测提示词(可选、花费 token),见"模型注册表一览(models)"
```

新项目流程(`init` → `plan` → 填写并提交 → `plan`(可选)→ `run`):

```sh
opencode-auto init <dir> --phases "admtvk"   # 1. 固化项目配置(init 只写配置层,不建轮次目录)
opencode-auto plan <dir>                      # 2. 建立 docs/R-01/(阶段索引 + 阶段目录 + 轮简报桩),停在轮首门禁
#                                              3. 人工:审阅轮次设置、填写 docs/R-01/round.md(目标/验收/发布判据),提交
opencode-auto plan <dir> -p "首轮:把 legacy/pkg 迁移到 app/"   # 4. 可选:带规划输入规划 P01(也可手工在 tasks.md 列任务)
opencode-auto run <dir>                       # 5. 逐阶段执行;每轮完成后填 ## Close 再 plan 开下一轮
```

`m` 模式(缺省单次运行)同理:`init` → `plan`(建立隐式单阶段 `R-01/P01-implement`,停在轮首门禁)→
提交 → `plan -p`(可选,见[由 AI 规划任务](#由-ai-规划任务))或手工在 `tasks.md` 列任务 → `run`。
`init` 的 `-p`(改由直接编辑 `.opencode/auto/brief.md`)与 `--amend`(改用 `amend` 子命令)已退役;
`continue` 子命令已退役(开下一轮就是 `plan`)。

`init` 对已存在的 opencode.json 一律跳过;`.opencode/agent/auto.md` 与内置
模板不一致时总是替换,保证 agent 契约为最新版本。轮次目录(`docs/R-NN/`)不是 init 的产物——
由 `plan` 建立(见[规划与轮次生命周期(plan)](#规划与轮次生命周期plan))。

`init` 写 `.opencode/auto/config.json` 的语义是**无状态全量覆盖**:产出仅由本次执行
传入的参数决定,未给出的键一律回落内置缺省,不与磁盘上的旧配置做增量合并。于是
"干净环境跑一次无参 `init`"与"带参 `init` 之后再跑一次无参 `init`"产出逐字节一致
——单次 `init` 即可得到确定状态,无需前置清理;相同参数连跑多次结果恒定。想只改一
两个键而保留其余既有值,用 `amend` 子命令(见[修订(amend)](#修订amend));只想把
契约 / AGENTS.md 块刷新到与现有配置一致、或清掉已退役键,用 `fix`(见
[配置修复(fix)](#配置修复fix))——二者都不会把其余键重置为缺省。

**breaking 变更**:`run` 不再接受 `-m/--mode`、`--agent`、`--context-limit`、
`--subtask`、`--idle-time`、`--idle-max`、`--commit`、`--test-by-driver`、
`--handover-test`、`--auto-number`、`--no-auto-number`、`--phases`、`--parallel`
——任一出现即用法错误(退出码 1),报文
给出修订指引(`opencode-auto amend <dir> --<flag> <值>`,或直接编辑配置文件);这些
选项已固化为项目属性,见下节。`--implement-file`/`--implement-prompt` 已退役,任何命令
出现即用法错误,见[由 AI 规划任务](#由-ai-规划任务)。

## 项目配置(.opencode/auto/config.json)

"决定会话被如何告知、提交语义如何运作"的宪法级选项在 `init` 时固化到
`.opencode/auto/config.json`:版本化、随仓库共享、人工可编辑。`run` 每次启动读取
该文件并打印一行配置摘要,`status` 同样打印。选项归属的判别标准:**改它需要同时
改 AGENTS.md / 任务文档 / 契约的表述,或它描述的是模型/项目属性 → init;只描述本次
运行怎么跑、人怎么盯 → run。**

| 键 | 值域 | 缺省 | 说明 |
| --- | --- | --- | --- |
| `mode` | 已注册模式名 | `migrate` | 提示词级场景模式,见[模式层](#模式层-m-mode) |
| `agent` | `opencode` / `claude` | `opencode`(不写键) | 驱动全部会话的编码 agent(M6.1);`OPENCODE_AUTO_AGENT` 可按次覆盖。旧版本此键为契约名(如 `auto`),读到即报错并提示删除该键(`fix` 代删)——契约恒为 `.opencode/agent/auto.md`。见[agent 选择](#opencode-server-与-agent-选择) |
| `contextLimit` | 正整数(千 tokens) | `64` | 上下文预算基线:会话复用(需 `OPENCODE_AUTO_REUSE_SESSION=on`)的已用量阈值为其一半(缺省 32k);`subtask` 为 `ondemand` 时交接阈值为 2 倍 |
| `subtask` | `off` / `auto` / `ondemand` | `auto` | 子任务划分,见[执行流水线](#执行流水线) |
| `idleTime` | 1..120(分钟) | `10` | driver 托管脚本(test 脚本)的无进度判定窗口;旧键名 `verifyIdle` 在新键缺失时回落读取(`fix` 就地更名) |
| `idleMax` | 0..1440(分钟,0 = 不设) | `0` | driver 托管脚本的绝对时长上限;旧键名 `verifyMax` 在新键缺失时回落读取(`fix` 就地更名) |
| `verify` | **已退役** | — | 任务级验收已退役(2026-09-21):存量配置写着 `verify: true` 读入即报错退出 1(删该键——`fix` 代删——把验收规划成任务或用 v 阶段);`false` 或缺省忽略 |
| `commit` | `true`(**`false` 已退役**) | `true` | 会话后统一提交(git 历史即 AI 变更的审计轨迹);提交是完成条件,写着 `false` 的存量配置读入即报错退出 1(`fix` 删除该键) |
| `testByDriver` | `true` / `false` | `false` | 编译/测试/构建/lint 等命令由 driver 执行(会话经 `test/` 脚本 + `tmp/test.sh` 标记请求),见[测试执行协议](#测试执行协议--test-by-driver) |
| `handoverTest` | `true` / `false` | `false` | 测试失败且上下文达限时写交接文档换新会话续跑;须搭配 `testByDriver: true`,否则配置校验失败(退出码 1) |
| `autoNumber` | `true` / `false` | `true` | 自动编号(缺省启用,`--no-auto-number` 关闭):任务编号(T-NNN)在目标目录永不重复,下一可用编号持久化在 `.auto/next-task`,由阶段规划会话消费,记录缺失时先恢复再继续——见[阶段化流程](#阶段化流程--phases)一节末尾 |
| `phases` | `admtvk` 的子序列且含 `m`,或含 `implement` 的阶段类型 id 列表(逗号分隔字符串或 JSON 数组) | `"m"` | 阶段化流程(a 分析 → d 设计 → m 迁移实现 → t 测试 → v 验收 → k 知识提炼;列表形态可引用 `.opencode/auto/phases/` 下的自定义类型);`"m"` = 无阶段声明,即隐式单阶段 `docs/R-01/P01-implement`,不开交接会话,任务由人工列出或按规划输入规划(见[由 AI 规划任务](#由-ai-规划任务))。见[阶段化流程](#阶段化流程--phases) |
| `source` / `destDir` | **已退役** | — | 迁移源与目标是意图、不是配置(2026-09-23,auto-core plans/0052 D2/D3):写进 `.opencode/auto/brief.md`,由规划会话读取。存量配置写着任一键(任何值)读入即报错退出 1,报文给出原值与修法(抄进 brief.md 后删键——`fix` 代为迁入 `## Source` / `## Target` 节并删键);无参 `init` 全量覆盖会丢弃并逐个打印原值。两个键名永久占位,不再复用 |

**统一提交**(`commit: true`,缺省):任何会话结束且 driver 完成状态写入(如勾选
子任务)后,由 driver 递归提交全部改动——先嵌套 `.git` 子仓库、后目标目录所在
仓库,提交信息为短标签标题行 `T-NNN <label> <任务标题/子任务>`(如
`T-001 decompose 修复登录`、`T-001 S2 编写 schema`、`T-001 wrapup 修复登录`、
`T-001 done 修复登录`;trailer `Auto-Task` / `Auto-Stage`,目标仓库另以
`Auto-Nested` 记录全部嵌套仓库的最终/最新 SHA),git 历史即 AI 变更的审计轨迹、
回滚粒度 = 会话;**提交是完成条件**(auto-core plans/0021-commit-boundary-design.md):
统一提交失败一律阻塞停机待人工,任务/子任务/隐藏任务以工作区 clean 基线启动,
单元启动遇人工遗留脏区也会阻塞(先提交或清理再运行);
opencode 会话与提交同名,会话列表即任务进度;AI 会话不执行 git commit
(经 AGENTS.md 提交原则块与 agent 契约约束)。每次统一提交前 driver 先做**引用
auto-correct**(实验开关 `OPENCODE_AUTO_REF_CHECK=on` 时启用,缺省 off 不做):
git rename 配对成功的新旧路径机械改写活文档中的旧引用(只配对
rename,删除类不自动改),并复扫失效引用打 ⚠ 日志(改写随本次提交落账;非 git
目录空转)。`false` 关闭后改动留在工作区。

写入通道有四条:

1. **init(缺省,全量覆盖)**:`opencode-auto init <dir> [--<flag> <值> ...]`——产出
   仅由本次参数决定,未给出的键强制回落缺省值(无选项的手编键 `acceptanceGate` /
   `build` 保留)。既有文件里的已退役键(`commit: false`、`verify: true`、契约名
   `agent`、`source`、`destDir`)反正会被覆盖掉,故基线读取容忍它们:init 逐个打印
   `⚠ full overwrite drops the retired key <键> = <原值>` 后照常写出(auto-core
   plans/0052 D4)——存量 `commit: false` 不再挡住清除它的那次 init;
2. **amend(增量修订)**:`opencode-auto amend <dir> --<flag> <值>`——仅命令行显式
   给出的键被改写,其余保留既有值;裸选项取该键缺省档(如 `amend --test-by-driver`
   即 `testByDriver: true`),见[修订(amend)](#修订amend)。旧写法
   `init <dir> --amend --<flag> <值>` 与 `continue` 子命令均已退役(出现即报文指向
   `amend` / `plan`)。amend 会把已退役键原样带过去,故严格装载,遇之即失败并指向 `fix`;
3. **fix(按规则修复)**:`opencode-auto fix <dir>`——只修"读不进来或会悄悄失义"
   的键(已退役键删除/更名/迁入 brief.md),其余键原样保留,见
   [配置修复(fix)](#配置修复fix);
4. **直接编辑** `.opencode/auto/config.json`(init 每次写出全量键,人工编辑同样
   合法)。

坏 JSON / 键值越界 / `mode` 未注册 → `run` 与 `init` 均以退出码 1 失败,报错指明
键名与期望值域(严格失败优于静默回落);未知键忽略(前向兼容)。严格失败若属
`fix` 能修的一类(已退役键、旧键名、仅有旧版 `.auto/config.json`),`run` /
`amend` / `init` 的报文末尾追加一行
`fix: opencode-auto fix <dir>`,`status` 在 ⚠ 行下同样打印这一行。

**init 先全量校验、再写盘**(auto-core plans/0052 D7):选项取值、模式、前缀护栏
(只读:不丢已完成阶段、不删已有工作的阶段目录;阶段索引的重同步归 `plan`)、
目标目录提示词库覆盖件(`.opencode/auto/prompts/`)与意图包的校验全部在第一次写盘之前完成——任一失败即退出码 1,配置层原样不动(不写
config.json、不刷新契约与 AGENTS.md 块、不写 brief.md)。目标目录在 git 仓库内时还有
一道**提交能力前置校验**:统一提交是完成条件,仓库无法提交(未配置
user.name/user.email 等提交身份)即拒绝(退出码 1,报文给出配置方法)——先
`git config --global user.name/user.email`(或仓库内去掉 `--global`)再重跑。`run` 期间该文件
与 opencode.json、AGENTS.md 一起置为只读,人工修订请在 run 外进行。

兼容与迁移:

| 场景 | 行为 |
| --- | --- |
| 旧项目(仅 `.auto/config.json` 有 mode) | 新文件缺失时回落读取旧值,run 打提示"运行 `fix` 写出完整配置"(`fix` 以旧 mode + 缺省值写出新文件);init / fix 写出新文件后回落终止(旧文件不删除,留在 gitignore 内自然沉没,由 `reset` 一并清理) |
| 旧脚本 `run -m xxx` / `run --commit` 等 | 退出码 1 + 修订指引(breaking) |
| 已退役选项 `--verify` / `--review` / `--early` / `--early-review` / `--final-review` | 任何命令出现即退出码 1 + 退役说明(验收改为规划出的任务,报告结论行 `Result: FAIL` 停跑) |
| 已退役选项 `--source-dir` / `--source-path` / `--dest-dir` | 任何命令出现即退出码 1 + 退役说明(迁移源与目标是意图,写进 `.opencode/auto/brief.md`) |
| 存量配置含 `source` / `destDir` | `run` / `amend` / `init` 严格失败(`status` 打 ⚠ 行),报文给出原值与修法(抄进 brief.md 后删键)并指向 `fix`——`fix` 把原值迁入 brief.md 的 `## Source` / `## Target` 节后删键;无参 `init` 丢弃并打印原值后照常覆盖 |
| 已退役选项 `init -p` / `--prompt`(init 不再写 brief)与 `--amend` | 出现即退出码 1 + 退役说明(前者指向 `.opencode/auto/brief.md` 与 `plan -p`,后者指向 `amend` 子命令);已退役子命令 `continue` 同样出现即退出码 1 + 退役说明(指向 `plan`) |
| 未知的 `--` 选项(含拼错,如 `--next`) | 退出码 1 + 近似名提示(breaking;此前被静默忽略)。`check` / `status` 只接受目录参数,出现任何选项即拒绝;`reset` / `fix` 只接受目录参数与 `-f` |
| 重复 `init`(无参数) | **全键回落缺省值**(breaking:此前为"配置不变");模板与标记块照常幂等 |
| `init --test-by-driver true` 等带参 init | 给出的键按值写入,**未给出的键回落缺省** |
| `amend --test-by-driver true` | 仅改写显式给出的键,其余保留 |
| 覆盖已存在配置且工作区脏 | 退出码 1 + 未提交文件清单(含嵌套仓库/子模块);`-f`/`--force` 跳过 |
| 覆盖已存在配置且在交互式终端 | 提示确认 `[y/N]`,非 `y` 即取消且不做任何改动;非 TTY(CI/脚本)直接覆盖 |
| 存量 PLAN.md(含 `verify:` / `verified:` / `final:` 字段行、`T-F<k>` 任务) | M3.4 起不再读取;把任务迁为任务单元(见[任务单元格式](#任务单元格式))后继续 |
| 中途切换 `subtask` | 已注入检查项的任务照旧从勾选状态续跑(进度按任务记录,不跨任务混淆);新任务按新档执行;不建议中途切换 |
| 中途换 `mode` | 仅提示词文案变化(模式不进调度状态机) |
| 中途 `commit` off | 已不可能:`commit: false` 于 2026-09-15 退役,读到即报错退出 1(`fix` 删除该键且保留其余键;或手删/改 `true`,或无参 `init` 全量覆盖——丢弃并打印该键) |

组合要点:`--dryrun` 读配置的 `agent` / `contextLimit`,commit / subtask 不参与。

### init 的选项(固化与修订)

| 选项 | 说明 |
| --- | --- |
| `-m` / `--mode <name>` | 场景模式,写入配置的 `mode` 键(优先级: 显式值 > 既有配置值 > 缺省 `migrate`;未注册名为用法错误退出码 1,报文列出当前支持的模式);详见[模式层](#模式层-m-mode) |
| `--agent opencode\|claude` | 驱动会话的编码 agent,写入配置的 `agent` 键(缺省 `opencode`,不写键;`--amend --agent opencode` 删除该键);其他取值为用法错误;见[agent 选择](#opencode-server-与-agent-选择) |
| `--phases <admtvk 子序列含 m \| 阶段类型列表>` | 阶段化流程,写入配置的 `phases` 键(缺省 `"m"` = 单次运行);已有完成阶段时修订须满足前缀护栏(已完成阶段构成新值的前缀),否则报错并指引人工回退阶段索引。见[阶段化流程](#阶段化流程--phases) |
| `--subtask [mode]` | 子任务划分,写入配置(缺省/裸选项 `auto`):`auto` 自动分解;`off` 关闭划分,单会话完成整个任务;`ondemand` 上下文达到 `contextLimit` 的 2 倍时交接续跑。见[执行流水线](#执行流水线) |
| `--idle-time [1-120]` | driver 托管脚本的无进度判定窗口(分钟,缺省/裸选项 10;旧名 `--verify-idle` 已更名,出现即报错指引):driver 轮询输出文件(`tmp/test.<n>.out`,stdout/stderr 合并单文件)的大小,持续无增长达到该窗口才终止脚本(退出码记 124);只要输出持续增长,运行时长不受限 |
| `--idle-max [1-1440]` | driver 托管脚本的绝对运行时长上限(分钟,缺省/裸选项不设;旧名 `--verify-max` 已更名):兜底防止脚本无限循环输出;设为正整数时无论是否有输出,总时长超限即终止 |
| `--commit [true]` | 会话后统一提交,写入配置(缺省/裸选项 `true`)。**`false` 与旧别名 `none` 已于 2026-09-15 退役**——统一提交是完成条件(单元 clean 门禁/SHA 基线/恢复回滚均以提交恒开为前提),出现即用法错误退出 1;存量配置里的 `commit: false` 按坏文件严格失败,请删该键或改 `true` |
| `--context-limit [n]` | 上下文预算基线(单位: 千 tokens,缺省/裸选项 64),写入配置;上一会话已用量达到其一半(缺省 32k)即新建会话,与 50% 占比阈值同时生效 |
| `--test-by-driver [true]` | 编译/测试/构建/lint 等命令的执行权收归 driver(缺省/裸选项 `false`),写入配置:执行类会话不在会话内直接运行这类命令,改为把命令写成脚本放 `test/` 目录、把脚本路径写入 `tmp/test.sh` 请求 driver 执行,退出码与输出文件反馈回会话由 AI 直读判断。该开关同时决定测试执行原则块是否进入 AGENTS.md、测试协议段是否进入 agent 契约与执行类提示词。详见[测试执行协议](#测试执行协议--test-by-driver) |
| `--handover-test [true]` | 需搭配 `--test-by-driver`(否则用法错误退出码 1),写入配置:测试失败且会话上下文达到 `contextLimit` 时,要求 AI 写交接文档后换新会话续跑,防止在超大上下文中反复试错 |
| `--auto-number` / `--no-auto-number` | 自动编号开关,写入配置的 `autoNumber` 键(缺省 `--auto-number` = 启用,`--no-auto-number` 为关闭用退出开关;两开关同现且均未带 `=false` 为用法错误):启用后任务编号(T-NNN)在目标目录永不重复,阶段规划会话自 `.auto/next-task` 记录续接编号,记录缺失时先恢复再继续。`phases = "m"` 的规划会话(见[由 AI 规划任务](#由-ai-规划任务))同样自该记录续接。详见[阶段化流程](#阶段化流程--phases) |
| `-f` / `--force` | 跳过覆盖确认与工作区干净度检查,供 CI 与自动化脚本(与 `reset` / `fix` 共用);`amend` / `run` 出现即用法错误(amend 不丢弃任何键,无覆盖确认可跳) |

以上写入配置的选项在 `init`(缺省即全量覆盖)下"未给出即回落缺省值";"显式给出的键才被改写"
是 `amend` 子命令的语义(其 `-p`、`-f`、`--amend` 均为用法错误)。项目简报
`.opencode/auto/brief.md` 是独立文件:`init` 在文件缺失时写项目简报桩,既有文件保留
(不随配置的全量覆盖被清空);要给意图就直接编辑它——`init -p` 已退役(出现即报文指向
该文件与 `plan -p`)。`--server` 已随 init 去 AI 化移除(init 不再启动会话)。
init 不写 `docs/`(轮次目录由 `plan` 建立),也不启动任何 AI 会话。

### 修订(amend)

`opencode-auto amend [dir] --<键选项> <值> ...` 改写给出的配置键,其余键保留既有值
(auto-core plans/0052 D25;旧写法 `init --amend` 已退役,并入本命令),接受的键选项与
取值同 init(`-m/--mode`、`--agent`、`--subtask`、`--idle-time`、`--idle-max`、`--commit`、
`--context-limit`、`--phases`、`--test-by-driver`、`--handover-test`、
`--auto-number`/`--no-auto-number`、`--wrapup`/`--no-wrapup`、`--parallel`),值域
校验、`handoverTest` 搭配校验、阶段索引前缀护栏与 init 同源。

- **只收配置键**:`-p` 用法错误(brief 不是配置,直接编辑 `.opencode/auto/brief.md`);
  `-f` 用法错误(amend 不丢弃任何键,无覆盖确认与干净度闸门可跳);`--amend` 用法错误
  (冗余)。
- **至少一个键**:一个键选项都没给即用法错误,报文指向 `fix`(只想把契约 /
  AGENTS.md 块刷新到与现有配置一致,用 `fix`)。
- **无配置即拒绝**:目标目录没有 `.opencode/auto/config.json` 时退出码 1、指向
  `init`(仅有旧版 `.auto/config.json` 时另指向 `fix`,它按旧 mode 写出完整配置)。
- **严格装载**:既有配置读不进来(已退役键、越界值等)即失败,不会把坏键带过去;
  属 `fix` 能修的一类时报文末尾追加 `fix:` 行。
- **写什么**:config.json、agent 契约与 AGENTS.md 标记块(二者由配置渲染)——不碰
  轮次目录:改 `--phases` 时只做只读前缀护栏,索引与配置的差异作为漂移留给 `plan`
  重同步;`opencode.json`、`.gitignore` 与 brief.md 桩归 `init` / `fix` 管,amend 不碰。
- 成功时打印 `✓ amended (<给出的选项>)`,改动留在工作区,不提交——审阅后自行提交。

### 配置修复(fix)

`opencode-auto fix [dir] [-f]` 按规则修复配置层(auto-core plans/0052 D10/D11):
`.opencode/auto/config.json` 与 init 按它写出的产物。基线是磁盘上的既有配置
(按原始记录读,不经严格校验),不接受任何配置键选项,**从不把任何键重置为缺省**
——未知键与规则未点名的键一律原样保留。规则只修"读不进来或会悄悄失义"的键,
合法的替代写法(数组形态的 `phases`、`parallel: "none"`、`agent: "opencode"`)不动;
阶段索引的不一致不归 fix(归后续的 `plan`)。

发现分两类:**可修复**(fix)——确定且不改变含义,按下表执行;**需人工**(manual)
——只报告、不猜(如 `handoverTest: true` 而 `testByDriver: false`,改哪一边是人的
决定)。

| 对象 | 发现 | 动作 |
| --- | --- | --- |
| `config.json` 缺失、旧版 `.auto/config.json` 有 mode | 可修复 | 以旧 mode + 缺省值写出新文件 |
| `commit: false` / `verify`(任何值)/ 契约名 `agent`(如 `auto`) | 可修复 | 删键 |
| `verifyIdle` / `verifyMax` | 可修复 | 更名为 `idleTime` / `idleMax`(键序不变);新键已存在则删旧键 |
| `source` / `destDir` | 可修复 | 原值迁入 brief.md 的 `## Source` / `## Target` 节末尾(节缺失则在文末补节;brief.md 缺失则以桩为底),然后删键 |
| `config.json` 不是合法 JSON / 不是对象 | 需人工 | —— |
| 应用上述规则后配置仍装载失败(越界值、未注册 mode、搭配冲突…) | 需人工 | 报文照录;下方产物规则整体跳过(`skipped:` 行) |
| agent 契约 `.opencode/agent/auto.md` 缺失 / 与按 `testByDriver` 渲染的模板不一致 | 可修复 | 按模板重写 |
| AGENTS.md 标记块缺失 / 与当前配置渲染不一致 / 残留旧版或游离标记块 | 可修复 | 写入当前块并清理其余标记块(正文不动) |
| 意图包装载失败(标记块无从渲染) | 需人工 | —— |
| `.gitignore` 缺 `tmp/` 或 `.auto/` 条目 | 可修复 | 追加缺失条目 |
| `.gitignore` 缺 `/.opencode/auto/models.json` 条目(init 尚不写它时初始化的项目) | 可修复 | 追加该条目(其余本地私有条目留给人决定) |
| `opencode.json` 缺失 | 可修复 | 写内置模板(已存在即不动,可能含人工改动) |
| brief.md 缺失 | 可修复 | 写项目简报桩(已存在即不动) |

产物规则由配置渲染,故只在配置(应用键规则之后)能严格装载时执行。

交互同 `reset`:先打印发现清单(`fix:` / `manual:` / `skipped:` 行),有可修复项时
过工作区干净度闸门、再问一次 `[y/N]`(非 TTY 免提示;`-f`/`--force` 两道闸一并
跳过),然后按清单写盘并逐条打印 `fixed:` 行。fix 不提交,改动留在工作区供审阅。

| 情形 | 退出码 |
| --- | --- |
| 无配置、也无旧版 mode(未初始化,应先 `init`) | 1 |
| 无任何发现(配置层与配置一致) | 0 |
| 可修复项全部应用、无需人工项 | 0 |
| 有需人工项(可修复项照常应用) | 1 |
| 工作区脏(未给 `-f`) | 1,不做任何改动 |
| 确认时回答非 `y` | 0,不做任何改动 |

`run` / `status` / `check` 以及 amend 路径上的严格失败,在 fix 的键规则能修时附带
`fix: opencode-auto fix <dir>` 一行;契约缺失、AGENTS.md 块过期等恢复提示同样指向
`fix`(此前指向会重置其余键的无参 `init`)。

### 反初始化(reset)

`opencode-auto reset [dir]` 是 `init` 的逆操作:精确移除 `init` 写出的**配置层**产物,
把工作区还原至未初始化状态,消除配置残留对 opencode 主程序与其他扩展组件的干扰。

清理范围(枚举式白名单,无通配、无递归删除):

| 目标 | 动作 |
| --- | --- |
| `.opencode/auto/config.json` | 删除 |
| `.opencode/auto/brief.md` | **逐字节等于项目简报桩时才删**;填写过则保留(人的意图,不是 init 产物)并在清单中说明原因 |
| `.auto/config.json` | 删除(旧版仅含 `mode` 的残留配置) |
| `.opencode/agent/auto.md` | 删除(`init` 本就无条件按模板覆盖它,是纯 auto 产物) |
| `opencode.json` | **逐字节等于内置模板时才删**;被改过则保留并在清单中说明原因 |
| `AGENTS.md` | 只摘除 `opencode-auto` 标记块,其余正文原样保留;摘除后仅剩空壳标题(即该文件本就是 init 建的)则整个删除 |
| `.gitignore` | 只移除 init 写出的条目(`tmp/`、`.auto/`、本地私有文件 `/.gitignore`/`/.env`/`/AGENTS.md`/`/opencode.json`/`/.opencode/auto/models.json` 与现存的嵌套 git 仓库条目),用户自有条目保留;移除后文件为空则整个删除。模型注册表项目层 `.opencode/auto/models.json` 本身不删(它属于操作者,不是 driver 写的) |
| `.opencode/auto/`、`.opencode/agent/`、`.opencode/` | **仅在为空时**回收(`rmdir`,非空即跳过) |

**明确不动**:`docs/`(含轮次目录 `R-NN` 与任务目录 `T-NNN`)、`.auto/` 除
`config.json` 外的全部运行时状态(日志、`stats.json`、`resolves.json`、`progress.json`)、
`tmp/`。这些是人与 AI 的工作成果或运行痕迹,不是 `init` 的产物。

空目录才回收这一条同时保住了两样东西:你自建的提示词覆盖目录
`.opencode/auto/prompts/`,以及 `.opencode/agent/` 下你自己的其他 agent 契约。

执行前有两道闸(`-f`/`--force` 一并跳过):

- **工作区干净度**:目标目录所在仓库及目录树下全部嵌套仓库/子模块有未提交改动时,
  退出码 1 并列出文件,不做任何改动。git 是唯一的撤销手段,脏工作区意味着撤销不回来。
- **交互确认**:先打印完整清单(含保留项与原因),再问一次 `[y/N]`。非 TTY(CI、脚本)
  免提示直接执行——但干净度闸门照常生效。

`reset` 后再 `init`,产出与首次 `init` 逐字节一致。目录中没有任何 `init` 产物时,
`reset` 打印"未发现 init 产物"并以 0 退出。

### run 的选项(本次执行)

| 选项 | 说明 |
| --- | --- |
| `--server <url>` | 复用已运行的 `opencode serve`,不另起进程;也可用环境变量 `OPENCODE_AUTO_SERVER`。缺省时自动 spawn 一个 `opencode serve` 并托管其生命周期(网络故障与 AGENTS.md 更新会自动重启,见[opencode server 与 agent 选择](#opencode-server-与-agent-选择)) |
| `--verbose [true]` | 输出会话内全部消息部件(文本、工具调用、推理、步骤等)与上下文用量/占比,每行带时间戳,并每 10 秒列出 git status 新出现的变动文件(含子目录中的嵌套 git 仓库) |
| `--interactive` / `-i` | 旁路交互(与 `--verbose` 互斥):终端保持非 verbose 的干净输出并常驻等待人工输入,回车把输入作为额外用户消息发往当前活动会话(steer 语义,在下一 provider turn 边界处理;无活动会话时输入丢弃并提示),等待输入不阻塞正常执行;日志文件仍保持 `--verbose` 级别的完整记录。`--wait-answer`/`--wait-between` 的人工等待也经这条输入行接收,ask 结束后恢复接收会话消息。输入一行 `/exit` 不会发往会话,而是预约在下一个安全边界(阶段/任务/子任务交接完成处)暂停退出(退出码 `3`),进度已持久化,重新运行即可完整恢复 |
| `--wait-answer [1-60]` | 提问先等待人工 stdin 答复(分钟):非权限提问超时自动答复;权限请求在 `--permission` 的 ask-* 模式下作为等待窗口(见该选项);不带值默认 1 分钟;缺省此选项则非权限提问立即自动答复、权限类提问(question 工具)直接阻塞 |
| `--wait-between [1-60]` | 任务之间暂停等待人工(分钟):回车立即开始下一任务,超时自动继续;不带值默认 1 分钟;缺省此选项则任务间不暂停 |
| `--permission [mode]` | 权限请求(permission.asked)的处理策略,缺省 `ask-deny`:`auto-allow` 立即自动授权(always 放行,不等待);`ask-allow` / `ask-deny` / `ask-fail` 先等待人工(窗口为 `--wait-answer` 分钟,未设则不等待即视为超时;回答 `allow`/`yes`/`y` 等即授权,其余明确回答拒绝该权限但会话继续),超时分别回落:自动授权 / 自动拒绝但会话继续(AI 无授权绕开) / 拒绝并退出运行(阻塞停机,退出码 2) |
| `--dryrun [true]` | 权限预检:只调用一次 AI,列出执行任务可能需要的 opencode.json 授权之外的目录/操作并逐只读探查确认,报告写入 `.auto/dryrun.md` 并打印到终端;不执行任何任务 |
| `--new-session` | 中断恢复时强制开新会话:跳过会话复用(旧会话上下文已陈旧时的逃生阀),阶段级精确重入仍按进度记录执行;仅对本次运行生效,不写入配置。详见[中断恢复](#中断恢复) |

每次 `run`(以及进入循环的 `plan`)都会在目标目录的 `.auto/logs/run-<时间戳>.log` 新建日志文件,
终端的全部输出同步写入该文件(逐条直写,进程中断也不丢已输出内容);
`--interactive` 下日志文件额外包含 verbose 明细(会话部件、上下文用量、变更文件),与 `--verbose` 运行时的记录一致。

同一目录同一时刻只允许一个 driver 进程工作:`run` 启动时取得**运行锁**(run lock)
`.auto/run.lock`(JSON:进程号 `pid`、主机名 `host`、命令 `command`、起始时间 `started`),
运行结束(含 Ctrl+C 强制退出)即删除;`plan` 同样持锁(command 记为 `plan`,内部经
`runAll` 重入),`close` 亦持锁(command 记为 `close`)。另一进程持锁期间,`run`、
`plan` 与 `close` 以退出码 `1` 拒绝并报出持锁者;
`init`、`amend`、`fix`、`reset` 会改写运行中的 driver 所读的文件,同样以 `1` 拒绝
(`-f` 不越过运行锁);`check` 与 `status` 从不取锁,`status` 把活锁打印在首行
(`▶ run in progress (pid 1234 on build-3, since …)`、`plan`/`close` 持锁时为
`▶ plan in progress (…)`/`▶ close in progress (…)`)。持锁进程已不存在(如被 `kill -9`)的
本机锁视为失效,下一次 `run` 或 `plan` 自动移除并打印一行说明;记录在其他主机上的锁无法探查进程,
一律视为有效。锁文件无法解析时同样视为有效,确认无进程在跑后手工删除 `.auto/run.lock`。

退出码:`0` 全部完成(阶段化流程下 = 全部阶段完成);`1` 用法/环境错误(含阶段索引
缺失或非法、运行锁被另一进程持有);`2` 阻塞或未完成为 pending,等待人工介入(含阶段规划会话受阻与任务报告结论行 `Result: FAIL`);`3` `--interactive` 下收到 `/exit`、已在安全边界处暂停退出(不需要人工介入,重新运行即可完整恢复);`130` 被强制终止。

运行期间单次 Ctrl+C 不会终止(仅提示),3 秒内再次按下 Ctrl+C 才强制退出;
退出前会尽力恢复 opencode.json、AGENTS.md 等文件的可写权限并关闭 opencode server。

每个任务与子任务开始时,输出会打出显著横幅(`=` 行为任务,`-` 行为子任务,
首行重复字符 + 标题两行):

```
============================================================
T-009 实现迁移

------------------------------------------------------------
T-009 子任务 1：编写迁移脚本的 schema 部分
```

`auto` 子任务模式下,任务正文尚无检查项时,driver 在开分解会话前打出隐式
(自动)任务子任务分割标记(点线、空行后接 `<任务编号> <任务标题>: 子任务分解`):

```
............................................................
T-009 实现迁移: 子任务分解
```

### 规划与轮次生命周期(plan)

`plan [dir] [-p|--prompt <文本> | --file <路径>]` 是**规划命令**:它与 `run` 共用同一状态机,
多一个**停止条件**——任一规划步骤成功(或轮次走到本该执行任务的位置)即停下,供人工
评审任务清单;之后 `run` 照常执行(auto-core plans/0053 D4–D14)。

```sh
opencode-auto plan <dir>            # 轮未建立 → 建轮并停在轮首门禁;否则规划当前阶段并停在执行前
opencode-auto plan <dir> -p "…"     # 带规划输入:存为本阶段的 plan-input.md 后再规划
opencode-auto plan <dir> --file plan-brief.md   # 规划输入取自文件(-p 与 --file 互斥)
opencode-auto run <dir>             # 评审(可直接编辑/勾销任务)后执行
```

- **不需要 AI 的路由先行(plan prelude)**,在取运行锁之后、启动任何会话之前裁决:
   - **建轮**:当前轮 `docs/R-NN/` 未建立时,先(对上一轮)跑轮关闭检查,再建立本轮
     目录并打印轮首门禁提示(next 行),退出码 `0`。`phases = "m"` 时同样建
     `R-01/P01-implement`。
   - **开下一轮**:上一轮全部完成时,先跑轮关闭检查(G8):不过 → 打印问题清单
     (逐条 `✗` 行,`plan` 拒绝开下一轮直到修复),退出码 `2`;过 → 打印警告、
     建立新一轮并停在轮首门禁,退出码 `0`。
   - **阶段索引漂移重同步**:配置 `phases` 在建轮后变更、当前轮又未完成时,重同步
     未开始尾部的阶段目录(改动不提交,停下待评审后提交,退出码 `0`;带规划输入时
     先拒绝——先无输入重同步、提交、再带输入)。`run` 不重同步:遇到漂移以退出码 `1`
     停下并指向 `plan`。
   - **提示即退出**:路由阻塞 → 退出码 `1`;阶段已规划完(`run` 去执行;无输入时
     退出码 `0`,保持 `plan && run` 可连写)或 `m` 模式任务索引为空(提示手工列任务
     或改用 `-p`/`--file`)→ 打印提示退出。轮完成且本轮无需规划时,提示填
     `## Close` 后再 `plan` 开下一轮。
   - **输入拒绝(任何写盘之前,退出码 `1`)**:轮未建立、轮已完成待开新轮,或目标
     阶段已列有任务时,给出的规划输入不会被消费——报文指明「先无输入 `plan` 建轮、
     提交设置、再带输入」。
- **规划输入(planning input)**:`-p` 文本或 `--file` 文件内容(非空、二者互斥,
  `--file` 须为常规文件),由 driver 原样写入阶段目录的
  `docs/R-NN/P<nn>-<type>/plan-input.md`,**在规划单元开始前单独提交**;规划会话经
  phase-plan 模板的 `{{input}}` 块读到它。一个阶段一个文件、始终存最新一份(历史在
  git);输入变更会使在途规划步骤重开新会话。要无输入规划,删除该文件并提交即可。
- **`m` 模式**:`plan -p`/`--file` 即「由 AI 规划任务」的入口(原 `--implement-*`
  已退役),见[由 AI 规划任务](#由-ai-规划任务)。
 - **选项**:接受 `run` 的会话选项(`--server`、`--verbose`、`--interactive/-i`、
  `--wait-answer`、`--permission`、`--new-session`);拒绝一切配置类选项(报文同
  `run`)与 `--dryrun`、`--wait-between`、`--max-sessions`、`-f`、`--amend`、
  `--continue`(`run` 反过来拒绝 `-p`/`--file`)。持运行锁(command 记为 `plan`);
  进入循环时同样在 `.auto/logs/` 建日志文件。退出码同 `run`(另:轮关闭检查不过为 `2`)。
- **提问即问人(无 AUTO-RESOLVE)**:plan 为执行前的人工审阅而跑,其会话里的非权限
  提问一律由人工回答——driver **无超时等待**(`-i` 常驻输入行,未给 `-i` 时为 stdin
  提问),`--wait-answer` 的超时代答回落在此不生效,会话也不要求 AUTO-RESOLVE 标注
  (见[提问策略与代答审计(AUTO-RESOLVE)](#提问策略与代答审计auto-resolve))。
  输入渠道不可达(stdin 关闭或空回答)或同一问题重复询问,则阻塞交人工(退出码 `2`),
  在会话外处理后再跑。

追加任务(`--append`)与关闭单元(`close`、`plan --force-close`)见下面两节。

### 追加规划(plan --append)

`plan [dir] --append -p <文本> | --file <路径>` 向**当前阶段**追加任务:任务索引里
已有的行一个不动,新任务按规划输入追加在既有行之后,编号续接(`autoNumber` 开启时自
`.auto/next-task` 续接并推进,否则从已占用或已列出的最大编号 + 1 起)。它从不切换阶段——
路由此刻指向哪个阶段,就追加到哪个阶段,包括交接路由上交接文档已写出、或被阶段门禁拦下的
阶段。`m` 模式下索引非空时,带输入的 `plan` 本身就是追加,`--append` 可省(显式给出
亦算冗余)。

- **既有内容保持不动**:追加步骤(步骤种类 `phase-append`)进入时先对任务索引与各
  既有任务文档做快照;会话改写了既有行或既有任务文档即拒绝并要求重试。步骤中断后
  人工提交的半成品,重跑时按快照口径计入既有部分,只校验其后的新任务。
- **旧交接文档会被移除**:追加成功后,阶段内已写出的 `handover.md` 由 driver 在独立
  提交中删除,新任务跑完后重新蒸馏交接(acceptance.md / verdict.md 保留,由下一次
  蒸馏重写)。
- **任务流水线进行中不可追加**:某任务的恢复点还在 `.auto/progress.json` 里(任务
  执行到一半或刚被阻塞)时,`--append` 以退出码 `1` 拒绝——先 `run` 完成它,或
  `close` 关闭它。新任务本来也排在一个受阻任务之后,帮不上它。
- `--append` 不带输入即用法错误(追加的正是按输入规划出的任务);轮未建立、轮已完成
  待开新轮等路由上,输入的拒绝规则与普通规划输入一致。

### 关闭单元(close 与 plan --force-close)

`close <ref> [dir] --reason <文本> [--cascade] [--commit-changes | --stash-changes]`
把一个单元**关闭**(closed)而非完成:调度上按收口处理(`todo.md` → `done.md` 改名
与索引勾选照做),但**未交付**——原因写进该单元 `done.md` 字段块的 `Closed:` 字段,
状态树(`⊘` 标记)、已完成清单、规划提示与交接蒸馏都会标注「已关闭、未交付,不要假设
其产物存在」。目标 `ref` 必须属于当前轮且处于打开状态,三种形态:`T-NNN`(任务)、
`R-NN.P<nn>`(阶段)、`R-NN`(整轮,仅阶段化流程;`m` 模式的唯一阶段不可关闭,关闭
其中的任务即可)。`--reason` 必填且单行,它同时是 `Closed:` 的值与关闭提交主题的尾;
显式的 ref 加必填原因即是确认,`close` 不再二次询问。

- **提交与记录**:关闭改动落在一个独立提交里(主题 `<ref> closed: <原因>`,trailer
  `Auto-Stage: force-close`,正文列出全部被关闭单元、各阶段被跳过的门禁与并入/ stash
  的文件);被关闭的阶段由 driver 写出**机械交接桩**(四小节齐全的 handover.md,记录
  关闭原因与各任务的 done/closed 状态,不开蒸馏会话);`.auto/` 中**只清除被关闭单元
  自身**的运行记录(units.json 条目、进度记录、会话交接)。`.auto/next-task`
  不回退——已关闭的编号永不复用。
- **依赖**:`Depends:` 显式指向被关闭单元的打开任务会阻止关闭并逐一列出;`--cascade`
  把它们一并关闭(原因标注 cascade 来源,迭代到闭包)。缺省 `Depends:`(隐式认前序)
  视为已满足,输出会点名这些任务。子任务不参与级联关闭——其状态文件是任务进行到哪
  的记录。
- **脏工作区**:超出 driver 自身状态文件的未提交改动会使 `close` 拒绝(退出码 `1`,
  列出文件);`--commit-changes` 把改动并入关闭提交,`--stash-changes` 在每个仓库根
  `git stash push --include-untracked`(嵌套仓库先行,逐个打印)。
- **退出码**:`0` 已关闭;`1` 拒绝或用法错误;`2` 关闭提交或收口校验失败。
- **撤销即 `git revert`,没有 `reopen`**:`close` 的输出末尾打印
  `to undo before anything else runs: git revert <sha>`。revert 恢复 `todo.md`、去掉
  `Closed:` 字段、取消索引勾选并移除机械交接桩;被清除的运行记录**不**恢复,重开的
  任务从零开始——这正是重开该有的结果。限制在「任何后续工作开始之前」:一旦后续工作
  已建立在关闭之上(比如下一阶段已在新状态下规划),revert 会留下两个打开的阶段,
  `reopen` 也无济于事。
- **`plan --force-close <ref> --reason <文本> [上述关闭选项]`**:同一进程内先关闭、再
  接着走 `plan` 的正常流程(共用 `plan` 的运行锁;关闭被拒 → 退出码 `1` 且无任何
  写盘,提交失败 → `2`,关闭成功后退出码即 `plan` 的)。关闭类选项(`--reason`、
  `--cascade`、`--commit-changes`、`--stash-changes`)不带 `--force-close` 出现在
  `plan` 上即用法错误;其他命令不接受 `--force-close`。典型用法:

```sh
opencode-auto plan <dir> --force-close T-005 --reason "方向已换" --append -p "改做 X"   # 换掉一个任务
opencode-auto plan <dir> --force-close R-01.P02 --reason "本轮跳过"                     # 跳过该阶段,直接规划下一个
```

## opencode server 与 agent 选择

### opencode server:缺省自动启动与自动重启

`run` **缺省自动启动**一个 `opencode serve` 子进程(要求 PATH 上有
`opencode` CLI),其生命周期完全由本工具托管:正常退出或被强制终止时关闭 server。
仅当显式指定时才复用外部 server:`--server <url>` 或环境变量 `OPENCODE_AUTO_SERVER`
(要求该地址健康,否则报用法/环境错误退出码 1)。

托管实例在两种情况下会**自动杀死并重启新实例**:

1. **网络类会话错误**:会话错误匹配 `Internal network failure` / `Network error`
   等网络/服务故障特征时,driver 先重启 server 再换新会话重试(至多 3 次,仍失败
   则阻塞停机),避免对着同一坏实例反复失败;
2. **AGENTS.md 有更新**:AGENTS.md 是会话的 system context,driver 跟踪其变更
   指纹(mtime + size),发现更新后**在下一个新会话开启前**重启 server,使新会话
   必定加载最新内容(AGENTS.md 虽在每个 provider turn 现场重读,重启用于兜底
   缓存场景)。会话不再维护 AGENTS.md(`run` 期间只读),这一路径只在文件于
   运行中被外部改动时才会触发。

复用外部 server 时实例不受本工具管理:上述两种情况只打提示、不重启(网络错误
仍会换新会话重试),外部实例的启停与修复由使用者自行负责。

### agent 的含义与选择

`agent` 键选择**驱动会话的编码 agent**(`init --agent opencode|claude`,M6.1):

| 选择 | 说明 |
| --- | --- |
| `opencode`(缺省) | 托管或复用 `opencode serve`(见上节),能力全集 |
| `claude` | Claude Code headless(`claude -p --output-format stream-json`,要求 PATH 上有 `claude` CLI);每个工作会话一个子进程,`--server` 被忽略。缺失的能力(fork、提问等)在 run 启动时自动降级并逐条打印 |

优先级:外壳画像指定的 agent > 环境变量 `OPENCODE_AUTO_AGENT`(按次覆盖,空串 = 不覆盖)
> 配置 `agent` 键 > `opencode`。所有会话(m 模式的规划会话在内)都由 `run` 的
driver 发起,同样使用该 agent。

**agent 契约**恒为 `init` 生成并维护的 `.opencode/agent/auto.md`(M6.1 起不再可选;旧版
`--agent <name>` 的契约名语义已退役):非交互工作契约——严格只做本次角色、状态文件
只读、验证执行权在 driver、权限问题走 question 工具其余自主决策并记录决策过程。
opencode 把它作为会话 agent;claude 把其正文追加到系统提示词、把 `opencode.json`
的权限规则转写为 claude 设置。契约与内置模板不一致时 `init` / `amend` / `fix` 总是替换为最新模板,
`run` 启动时发现不一致会给出刷新提示;文件缺失时 run 前完整性检查拦截——二者都指向
`opencode-auto fix <dir>`(按现有配置重写契约,不动任何键)。

## 模型注册表与分层路由(model registry)

哪些模型存在、每个由哪个 agent 跑、用什么钥匙付费、什么时段便宜,是**操作者**的知识而非
项目内容:它住在目标目录之外的**模型注册表**(model registry,auto-core plans/0055)里,
由两层合并而成:

- **操作者层**(operator layer):`$OPENCODE_AUTO_MODELS` 指定的文件;未设时为
  `$XDG_CONFIG_HOME/opencode-auto/models.json`(`XDG_CONFIG_HOME` 缺省 `~/.config`,
  相对值被忽略)。指向的文件不存在即视为没有操作者层(不回落 XDG 路径)。
- **项目层**(project layer):`.opencode/auto/models.json`(可选)。它属于操作这台检出
  的人,不随仓库走,故为**本地私有文件**:`init` 把 `/.opencode/auto/models.json` 写进
  `.gitignore`(更早初始化的项目由 `fix` 补上该条目),`reset` 只移除条目、从不删文件
  本身,`run` 期间与其他配置一起置为只读;git 未忽略(或已跟踪)的项目层在 `run` /
  `plan` 启动时拒绝(退出码 1,报文指向 `fix`)。

两层都不存在即**无注册表**:一切行为与以往逐字节一致,环境开关语义不变。合并只做一级:
项目层的 `agents` / `models` / `tiers` / `routes` 每个键**整体替换**操作者层的同名条目
(`null` 值删除操作者层的该条目),`tz` / `classifier` 整体替换,条目内部从不合并。
装载**严格**:坏 JSON、未知字段(顶层与条目内都不容忍——拼错的 `aviod` 会把模型悄悄放回
高峰时段)、坏窗口、坏引用,均在启动时以退出码 1 逐条报出(每条点名层与文件)。注册表只在
run 启动时读一次,编辑在下次运行生效;driver 只读、从不写这两层。

### 注册表格式

JSON。**内部名**(internal name,`^[a-z][a-z0-9.-]*$`)是模型的注册表键:不含 `/`,
因此绝不会与裸 `provider/model` 串混淆。示例为示意(名字与窗口都不是任何 provider 的真实
价目表):

```json
{
  "tz": "Asia/Shanghai",
  "agents": {
    "opencode": { "adapter": "opencode", "env": { "HTTPS_PROXY": null } },
    "claude":   { "adapter": "claude", "env": { "HTTPS_PROXY": "http://127.0.0.1:7890" } },
    "claude-b": { "adapter": "claude",
                  "env": { "CLAUDE_CONFIG_DIR": "~/.claude-b", "HTTPS_PROXY": "{env:CLAUDE_B_PROXY}" } }
  },
  "models": {
    "opus":   { "agent": "claude",   "model": "opus", "avoid": ["mon-fri 09:00-18:00"] },
    "k3":     { "agent": "opencode", "model": "moonshotai/kimi-k3-256k", "wider": ["moonshotai/kimi-k3"],
                "keys": ["{env:MOONSHOT_KEY_A}", "{env:MOONSHOT_KEY_B}"] },
    "glm":    { "agent": "opencode", "model": "zhipuai/glm-4.6", "only": ["00:00-08:00", "sat-sun 00:00-24:00"],
                "keys": ["{env:ZHIPU_KEY_A}", "{env:ZHIPU_KEY_B}", "{file:~/.secrets/zhipu-c}"] },
    "free":   { "agent": "opencode", "model": "opencode/some-free-model" }
  },
  "tiers": { "deep": ["opus", "k3"], "simple": ["glm", "free"] },
  "routes": { "acceptance": "deep", "phase-handover": ["free"] },
  "classifier": ["free"]
}
```

**agent 画像**(agent profile,`agents.<name>`):`adapter` 必填(`opencode` / `claude`,
或外壳经 `registerAgentAdapter` 注册的名字);`bin` 可选(可执行文件,缺省用 adapter 自带
的 `opencode` / `claude`);`env` 可选(见下节);`server` 可选(仅 opencode:外部 server
地址,`--server` 仍按次覆盖)。没有 `agents` 节即隐含一个 `opencode` 画像。多个画像共用
一个 adapter 即可做**账号容错**:两个 claude 画像只差 `CLAUDE_CONFIG_DIR`,各自在 driver
之外登录,档位里两个都列,失败切换就是普通的模型降级。

**模型条目**(`models.<内部名>`):`agent` 必填(画像名);`model` 可选——缺省即用该
agent 自己的缺省模型(提示词不带 model),此时条目不能有 `keys` / `variant` / `wider`,
于是"只做暂停"的注册表可以表达;`avoid` / `only` 二选一(窗口列表);`keys` 为有序密钥环
(仅 opencode);`wider` 为上下文步进(仅 opencode);`variant` 透传 opencode 的每提示词
变体(如推理力度;claude 在装载时拒绝该字段);`context` 可选(以千 tokens 记的上下文窗口,
供启动前未报告窗口的 agent 使用)。

### 档位(tier)与路由

会话分两档:**deep**(需要深度推理)与 **simple**(报告、蒸馏、提取类)。把模型列进档位
就是它的分类;同一个模型可以同时出现在两档。程序默认表:阶段规划、m 模式规划扫描、分解为
deep;收尾、阶段交接、知识/前置知识、编号恢复、旁路一次性会话为 simple;任务会话(整任务、
子任务)用**阶段类型的执行档**——内置类型中 a 分析 / d 设计 / v 验收为 deep,m 实现 /
t 测试 / k 知识提炼为 simple,自定义类型读其类型文件的 `Reasoning: deep|simple` 字段
(缺省 deep,随项目版本化)。**借用**是单向的:simple 会话的 simple 列表没有可用模型时
续走 deep 列表(可用性优先于成本);deep 会话从不借用 simple——它等待,因为深度正是它
存在的理由。`routes` 可按操作者覆盖:键是角色词 / 阶段类型 id / 预设字母(优先级同
`OPENCODE_AUTO_MODEL` 的键语法;`*` 不允许——档位列表本身就是缺省),值是档名或一个
有序内部名列表。

每次下发在候选列表里取**第一个此刻可用的**条目:过 agent 过滤、在窗口内、未被降级标记、
其 provider 的密钥环(若有)还有未标记的 key、已知上下文窗口不低于项目上限(带步进的
条目看顶端一步)。同一提示词的延续(重试、失败后的 fork、等待环的重发、严格恢复)保持链上
模型不变;新提示词随时回首选——首选窗口重开或标记清除即自动回归,低价时段的回试因此不需要
额外状态。无可用候选时:有候选只是被窗口拦住 → **等待最早开放时刻**(睡眠在单元内、加
hibernate 同款 0–600 秒随机抖动、计入 `window` 等待、双击 Ctrl+C 可强退);全部被标记
降级 → 走既有**等待-探测环**(探测首个窗口内候选,成功即清其标记);过滤后档位一个候选
都不剩 → 预检错误(退出码 1),绝不静默等待。

会话错误按**key → 模型 → 等待**升级:配额/鉴权/限流类先试密钥环轮换,再降级模型,最后
等待(auto-core plans/0017 的重试阶梯不变)。

### 窗口(window)与时区

`avoid` 使模型在所列窗口内不可用,`only` 使模型仅在所列窗口内可用。语法
`[days ]HH:MM-HH:MM`:`days` 为 `mon`..`sun`、区间(`mon-fri`,可跨周如 `fri-mon`)或
逗号列表(列表项本身可是区间,`mon-wed,fri`),缺省为每天;`24:00` 只允许作终点;跨午夜
的窗口(`22:00-06:00`)属于它开始的那天。全文件一个 `tz`(IANA 时区,缺省 `UTC`),
按当地钟面解释、含夏令时规则(不存在的时间开在跳变处,重复的时间取第一次)。窗口只拦
**下发**,不打断进行中的回合;正在跑的回合跑完,下一次下发重新选择。机器时钟即准,系统
休眠后睡眠自然迟到(同 hibernate)。

### 密钥环(key ring)

一个 opencode provider 的多把 API key 构成一**环**:声明在模型条目上、作用于整个
provider——同一 provider 的所有条目必须声明同一环(或都不声明),两套不同的环是装载错误。
key **只接受引用**:`{env:NAME}` 或 `{file:path}`(相对路径相对所在层文件解析);字面量
密钥在装载时拒绝。driver 从不把 key 的值读进任何字符串:引用经 spawn config
(`OPENCODE_CONFIG_CONTENT`)交给托管的 opencode server,在 server 自己的进程内替换;
日志与输出只报引用名(`key 2/3 ZHIPU_KEY_B`)。**轮换即重启托管 server**:下一把 key 写进
spawn config、server 重启(会话跨重启保留),失败会话 fork 后以**同一模型**重发。环位只进
不退——清除的 key 标记不回卷环位,只有当前 key 失败才推进,避免重启抖动;探测环的成功
同样只清标记。外部 server(`--server`、画像 `server`)无法重启,环在其下不活跃(启动日志
说明)。**目前尚无 provider 被列为已验证支持密钥环**:通用 provider 路径(config apiKey
优先于环境与 `auth.json`、`{env:}`/`{file:}` 在 server 进程内替换、setConfig+restart
重发)已经源码与实机机制验证,但 bedrock、cloudflare、cloudflare-ai-gateway、gitlab 与
网关(env 先于 config)这类自定义装载路径须各自通过双钥冒烟(`OPENCODE_AUTO_E2E_KEYS`,
见 `packages/auto` 的 e2e 说明)后方可列入。

### 上下文步进(context step)

同一模型按数个 id 发售、共享提示缓存、只差上下文窗口与价格时(如 kimi `k3-256k` 与
`k3`),写**一个条目**:`model` 为基础档,`wider` 列出逐级更大的 id。条目是路由的单位:
档位、路由、窗口、密钥环、降级标记都作用于整条;项目上限的钳制看顶端一步。装载校验每一步
都在同一 provider 上且窗口严格递增(server 起来后核对,未知窗口则自该步起禁用并告警)。
会话上下文到达当前一步的**步进点**(窗口 − max(48k, 窗口/5))时,driver 向**同一会话**
发一条带下一 id 的插话——会话、历史与缓存前缀都不动,无 fork 无交接;插话一律点名当前
id,防止 server 把后续回合落回基础档。会话内只升不降;新会话(新提示词、交接后、降级到
本条目)从基础档起;恢复时按历史上下文量重算,不落盘。步进插话成功后的第一个
step-finish 核对缓存主张
(`cacheRead` 大 → 共享成立;整前缀 `cacheWrite` → 矛盾,每条目告警一次)。提前步进只是
多花差价;迟了则 server 照常压缩,日志记 `step-up late`。

### 画像 env:代理与多账号

画像 `env` 叠加在 driver 环境之上、只作用于该画像的进程:值为字面量(`~` 展开)、
`{env:NAME}` / `{file:path}` 引用(driver 在该画像的 host 启动前解析,host 重启沿用同一次
解析)或 `null`(移除继承的变量,把全局代理挡在必须直连的 agent 之外)。用途:`HTTPS_PROXY` 等
把该 agent 的流量走代理(`NO_PROXY` 缺省不含回环,driver 自身连托管 server 的回环流量
会被代理截走——预检在 `HTTP_PROXY` 已设而 `NO_PROXY` 不含 `127.0.0.1,localhost` 时
告警);`CLAUDE_CONFIG_DIR` 把两个外部登录的账号变成两个画像。**一个 opencode server
一个环境**:同一 server 上所有 provider 共享它的 env,部分 provider 需要代理时用
`NO_PROXY` 列直连主机,或声明两个 opencode 画像(各起一个托管 server、各持各的密钥环;
会话不跨画像)。外部 server 保持它启动时的 env,画像 `env` 对它无效。日志与
`models` 输出只报变量名,从不报值。

### 失败信息分类器(classifier)

provider 的失败话术各异(其他语言、套餐限额、"resets at 15:00"),错误模式串认不出时,
注册表 `classifier` 列出的模型(通常是免费模型)来读:仅在模式串不能定论时询问(unknown
类、或未到阈值的限流信号;绝不问 overflow / 已定的 quota / auth),一次失败回合只问一次,
30 秒超时或失败即当无答复、模式串结论照旧。答复是一行 JSON(`class` + 可选 `resetAt`),
**只升不降**:unknown 取答复的类(quota / rate / auth / transient,rate 也须待模式串自身
的阈值成立),未到阈值的限流信号只可升为 quota,从不下调模式串已定的类。quota / auth
答复像模式串一样立刻收束回合(中止后走
key → 模型 → 等待);`resetAt`(带时区偏移、未来 7 天内)设定降级标记的解除时刻。
每 run 至多 20 次、按脱敏文本缓存(同文只花一次)。它只送**脱敏后的错误文本**(≤2000 字符,
密钥样 token / 邮箱 / URL 查询串已去除),在 adapter 缺省 agent 上开一次性会话、**全部
工具禁用**——免费档可能留存它收到的内容,故输入面收得这么窄。分类器自身的失败由模式串
归类,只标记分类器条目自身。其 token 计入 `classify` 桶,不进单元会话合计。

### 多 agent 池与运行行为

有注册表时,driver 为**每个被选中的画像惰性启动一个 host**(没人选的画像永不拉起;每个
opencode 画像一个托管 server,画像的 `bin` / `env` / 密钥环 spawn config 都作用于自己的
进程——driver 亲自 spawn `opencode serve`,不再经 SDK)。会话**从不跨画像**:跨 agent 的
移动 = 新会话 + 工作区核对说明;会话链与持久记录(进度记录、fork 基点、交接锚点)都带
agent,旧记录无该字段即归缺省 agent。启动时按过滤后档位/路由列表涉及的 adapter 做**能力交集
降级**(逐条注明是哪个 agent 缺的;分类器列表不扩大交集);预检对每个被引用的画像跑
`<bin> --version`(10 秒)。
运行启动打印**路由块**(每档列表与各模型的 agent、窗口现状、环位;生效路由;过滤),每次
下发打 `◈` 行并注明移动原因(`window` / `quota` / `key ring` / `failback`,分类器来源
标注如 `quota (classifier)`),等待打 `⏸` 行、步进打 `⇡` 行。统计按内部模型名与档位记账
(裸覆盖值按原串),轮完成结论逐模型一行(仅本轮)加档位小结;无模型数据时持久化形状与
结论逐字节不变。

### 环境变量与命令在有无注册表下的行为

| 面 | 无注册表 | 有注册表 |
| --- | --- | --- |
| `OPENCODE_AUTO_MODEL` | 不变 | 键语法相同;值为**内部名**,或跑在缺省 agent 上的裸 `provider/model`(无窗口、无环、无步进)。覆盖匹配会话的候选列表,仅本次运行 |
| `OPENCODE_AUTO_MODEL_FALLBACK` | 不变 | **用法错误**(退出码 1):档位列表就是降级序 |
| `OPENCODE_AUTO_MODEL_FAILBACK_SCOPE` | 不变 | 清除降级标记(模型与 key 两类) |
| `/failback [a b …]` | 不变 | 参数为内部名;整体替换此后所有列表(同覆盖语义) |
| `OPENCODE_AUTO_AGENT`、外壳画像 `agent` | 选择运行唯一的 agent | **过滤**:仅该 adapter 上的模型是候选。配置 `agent`(init `--agent`)不再是过滤,而是**缺省 agent**——裸 `provider/model` 值与不带 agent 的会话记录归属它;无档位用到它时启动提示 |
| `--server` / `OPENCODE_AUTO_SERVER` | 不变 | 覆盖 opencode 画像的 `server`;外部 server 下密钥环不活跃,画像 `bin` / `env` 对它无效 |

注册表的生效表见 [模型注册表一览(models)](#模型注册表一览models)。

## 执行流水线

driver 对每个任务执行流水线,**索引勾选、`todo.md` → `done.md` 改名与 `.auto/units.json` 只由 driver 写入**。执行方式
由项目配置的 `subtask` 键决定(`auto` 为缺省):

`subtask: auto`(自动分解):

1. **分解**(`docs/T-NNN/subtasks.md` 尚无检查项时):一个会话分析任务并写出
   `docs/T-NNN/subtasks.md`(Markdown 检查项,即该任务的子任务清单本体)与各子任务
   目录的 `todo.md`。未产出有效文件会自动带反馈重试一次,仍失败则阻塞。
2. **逐子任务执行**:任务内所有执行会话(分解/子任务/修复/收尾)串成一条链,
   链内复用**缺省关闭**——每个提示词都开新会话(提示词自带完整上下文,不依赖
   上一会话的记忆);置 `OPENCODE_AUTO_REUSE_SESSION=on` 恢复阈值复用:上一会话
   结束时上下文占比低于 50%、已用量低于配置的 `contextLimit` 的一半(默认 32k
   tokens)且距其结束**不超过 5 分钟**才复用它(占比与用量始终跟踪,与
   `--verbose` 无关;拿不到模型上下文上限时占比记 100,一律新建;driver 托管
   脚本与旁路会话可能耗时较久,超过 5 分钟即视为上下文陈旧、自动换新会话)。每个会话结束都无条件打印两行统计:行 1 `◉ 会话结束: 上下文 n%
   (用量/上限 tokens),用时 X(累计 Y / N 轮)`(纯 AI 用时口径,跨中断累计),
   行 2 为 tokens 分项(入/出/思考/缓存读/缓存写/命中率/费用);复用会话与
   中断恢复接管的会话同样打印;任务完成/阶段收口/轮次完成时另有对应结论行
   (各级跨中断累计用时与 tokens 分项,统计存于目标目录 `.auto/stats.json`,
   清零即删除该文件);
    子任务会话进行中上下文已用量达到配置的 `contextLimit` 的 2 倍时,driver
    同样插入交接提示,AI 把本子任务进度写入 `docs/T-NNN/handoff.md`(末行
    `Status: continue|done`,以该子任务是否完成计)后结束,新会话凭交接文档续跑
    该子任务;子任务完成后 driver 删除该文件,下一子任务重新起算;
    子任务会话自我检查自己的工作,会话结束后 driver 把子任务 `todo.md` 改名为
    `done.md` 并勾选 subtasks.md 对应行。
3. **收尾**:见下方公共部分。

`subtask: off`(关闭划分):一个会话完成整个任务,随后进入公共收尾;会话未能
完成时**不做修复重跑**,driver 把任务状态改回 `pending` 并以退出码 2 停机,由人工
改进任务文档后重新运行。

`subtask: ondemand`(按需交接):先按单会话执行;会话进行中上下文已用量达到
配置的 `contextLimit` 的 2 倍时,driver 向该会话插入交接提示,AI 把进度与后续步骤写入
`docs/T-NNN/handoff.md`(末行 `Status: continue|done`;旧版 `状态: 继续|完成` 仍可读)后结束,driver 开新会话从交接
文档续跑,直到任务完成。

公共部分(**收尾**):一个会话统一更新 docs/、`docs/T-NNN/report.md`(各子任务
产出摘要),会话结束后由 driver 统一提交;随后 driver 读报告的结论行(见
[验收结论行](#验收结论行result-passfail)):无结论行或 `Result: PASS` → 把任务标
done;`Result: FAIL` → 任务置为阻塞、停止运行(退出码 2)。完成判定从不采信会话
自述:子任务由 driver 按状态文件勾选,单元以产物落盘且统一提交成功为完成条件;
检查工作本身规划成任务(验收任务、v 验收阶段),其结论只经结论行传给 driver。

没有单独的当前任务镜像(`CURRENT.md` 已于 2026-09-25 退役,auto-core
plans/0054):每个会话的提示词都内联当前任务,任务的完整内容与进度就在它自己的
`docs/T-NNN/todo.md` 与 `docs/T-NNN/subtasks.md` 里——AGENTS.md 指针块告诉会话在
上下文被压缩或拿不准进度时重读这两个文件(AGENTS.md 作为 system context 每个
provider turn 现场重读,不随上下文压缩丢失)。阻塞/回退 pending 的原因打印在运行
日志里,中断阶段留在进度记录中。早先版本遗留的 `CURRENT.md`(首行为它固定写的
标题)由 `run`/`plan` 启动时删除,删除随启动时的 carryover 提交落账;首行不同的
同名文件属于项目自身,不会被动。

非权限提问无人答复时由 driver 自动答复并要求 AI 自主决策继续;自动答复同时要求
AI **记录决策过程**(决策理由与否决的备选方案写入相关文档),并按「这个分歧点的决定权
本应属于谁」分两类标注 —— 本应由你拍板却被替你闭环的标 `AUTO-RESOLVE`、AI 本就该自己
做的工程裁量标 `AUTO-DECISION`,前者在任务结束时高亮置顶提醒你复核。详见
[提问策略与代答审计](#提问策略与代答审计auto-resolve)。

### 中断恢复

上次运行被 kill/Ctrl+C 中断时,`.auto/units.json` 可能遗留 `in_progress` 状态(实际无会话在跑);
`run` 启动时会把它们全部重置为 `pending` 再正常续跑(`attempts` 保留),无需手工清理。

恢复的依据是**进度记录** `.auto/progress.json`:run 期间 driver 在任务流水线的每个
阶段边界持久化 `{task, session, at, active, phase}`——`phase` 标记当前阶段
(分解 / 整任务执行 / 逐子任务 / 收尾 / 结论行检查),执行链会话在运行期间以
`active` 记录;dryrun、fork 基点等旁路一次性会话不写记录(不污染执行链记忆)。
任务完成即删除记录;旧版 `.auto/session.json` 兼容读取。

**会话内恢复**(会话半途、无法总结进度——kill/崩溃/网络故障):只要该会话在
server 上仍存在,driver 直接**复用该会话继续**(上下文不丢,与 `opencode -r
<session-id>` 同构,不再设时间窗;该接管不受 `OPENCODE_AUTO_REUSE_SESSION` 与复用
阈值约束,恢复日志带上继承的上下文用量,恢复说明用后即清、下一个提示词回归常规
规则);首个提示词附恢复说明,要求 AI 用 git status/diff
核对实际进度后从中断处继续。**交接文件优先**:中断前已写出
交接文档(subtask auto 子任务或 ondemand 的 `docs/<id>/handoff.md`、handover-test
的任务级/子任务级 `testhandoff.md`——任一范围的遗留均判定)时不复用旧会话——其
上下文已用满、进度由交接文档承载,
开新会话凭交接续跑(handoff 标记 `状态: 完成` 时直接跳过整任务会话)。会话已不可
用或显式给出 `--new-session` 时开新会话:恢复说明中按记录的阶段给出具体的下一步
指引,同样不重做已完成的工作——`--new-session` 仅跳过会话复用,阶段级精确重入
保留,是旧会话上下文已陈旧时的逃生阀。事件流中断(未收到会话结束事件即断流,
疑似 server 故障或网络断开)同样按会话半途处理,不会误判为会话正常结束。

**阶段级精确重入**:恢复时按 `phase` 重入流水线,而不是从头再来——

- 分解阶段:上次已写出 `docs/T-NNN/subtasks.md` 有效检查项 → 直接采用,不再开会话;
- 逐子任务:从首个未完成项继续(子任务 `todo.md`/`done.md` 天然持久);
- 收尾:off/ondemand 不再重跑整任务执行会话,直接重跑收尾;
- 收尾已完成(结论行检查阶段):不再开任何会话,直接读结论行并登记完成——旧版
  进度记录停在已退役的 verify / review 阶段时同样按此处理。

**优雅退出的总结**(非 AI 服务原因停机——阻塞、回退 pending 等):退出原因打印在
运行日志里,进度记录转为总结态(不再复用旧会话——人工介入可能耗时数小时且会改动
环境,旧会话上下文已不可信);重新运行后凭勾选状态与阶段记录开新会话精确继续。
严格恢复回滚单元时,被收回的工作存进 git stash(消息前缀 `auto-rollback`),日志
给出找回方式。网络故障重试耗尽
属于"会话半途无法总结",保持会话复用资格,恢复时优先找回原会话。

`run` 期间 driver 会把 opencode.json、`.opencode/auto/config.json`、AGENTS.md 与
模型注册表项目层 `.opencode/auto/models.json`(存在时;driver 只在启动时读它、从不写)
置为只读(chmod 0o444),driver 自身写入时临时恢复、写完立即重置。`run` 结束(含
阻塞退出)恢复可写,便于人工介入编辑(包括手工修订项目配置);被强杀的运行遗留的
只读位不妨碍 `init`/`amend`/`fix`/`reset` 改写这些文件。这是提示词契约之外的防误写
护栏——同用户进程仍可经 bash chmod 绕过,并非安全边界。会话不维护 AGENTS.md
(见[AGENTS.md 标记块](#agentsmd-标记块)):driver 只在启动会话前确保其中存在与当前
配置渲染一致的单一 opencode-auto 标记块(缺失则追加、内容不一致则整块替换,
旧版/多余的带名标记块一律清理),除此之外永不改写 AGENTS.md。

## 验收结论行(Result: PASS|FAIL)

任务级验收 `verify`(三段式脚本验收与 `verified` 字段)、质量审核 `--review`/`--early`/
`--early-review` 与终审闭环 `--final-review` 已于 2026-09-21 退役(auto-core
plans/0044-completion-side-retirement-design.md):检查与验收是**规划出来的工作**——
写成普通任务,或用阶段化流程的 v(验收)阶段。driver 对完成侧只保留一个判定:

- 收尾会话在 `docs/T-NNN/report.md` 最后一行正文(终止符之前)独占一行写
  `Result: PASS` 或 `Result: FAIL <一句话原因>`——协议串,照原样书写,不翻译、
  不加粗、不加列表符号。何时写、何谓 FAIL 属意图包内容(`## acceptance` /
  `### result-line`):任务描述要求检查、测试、验证或验收时必写,发现任务目标未达成时
  也写;PASS 须每项要求的检查都实际运行或观察过、证据写进报告。意图包省略该小节即
  不下发此要求(永不停跑);
- driver 以最后一个 `Result:` 行为准(大小写敏感):`PASS`、无报告或无结论行 →
  标 done;其他取值 → 视同无结论;`FAIL` → 报告与改动已随收尾统一提交,任务置为
  `[blocked]`、停止运行(退出码 2),原因打印在日志;
- 人工处置:接受结论 → 把该任务手工标 `[done]`;需要修复 → 在它**之前**插入修复
  任务(auto 模式下给该任务手工追加检查项属非法子任务状态,修复一律规划成任务);
  随后重新运行。直接重跑被阻塞的任务只会重跑收尾、重写结论行。

退役选项在任何命令出现即退出码 1(附退役说明);配置 `verify: true`
严格失败;模型路由的 verify-*/review-*/final-plan 角色键同样报错。存量 PLAN.md(含其
`verify:`/`verified:`/`final:` 字段行与 `T-F<k>` 任务)自 M3.4 起不再读取;
遗留的 `.auto/verify.md`、`.auto/review.md`、`tmp/verify.*` 不做清理。

## 测试执行协议(--test-by-driver)

`--test-by-driver`(宪法级选项,经 `init --test-by-driver` 固化到配置
`testByDriver` 键,`run` 出现即用法错误)把"实现环节中编译/测试/构建/lint 等
可能耗时长或产生大量输出的命令"的执行权收归 driver。适用会话为执行类会话——
子任务会话(`subtask: auto`)与整任务会话(`off` / `ondemand`);分解、收尾等
旁路会话不适用(`--dryrun` 亦不启用)。

协议机制:

- **请求 = 脚本 + 标记**:会话需要运行这类命令时,把命令写成脚本放入 `test/`
  目录(命名清晰、可执行、可复用,随仓库版本化),再把脚本路径(相对工作目录,
  如 `test/build.sh`)写入 `tmp/test.sh` 标记文件(目标目录下 driver 管理的
  工作目录,已被 gitignore),然后结束本轮消息。标记存在即"待执行请求"——
  没有 mtime 竞态,重写标记即可再次请求。
- **执行与输出**:driver 在会话 idle 时检测标记:内容 trim 后单行且指向现存
  文件路径 → 直接运行该脚本并 best-effort 补 `chmod +x`(会话忘加执行位无需
  排查;`test/` 内脚本已随统一提交版本化,不另归档);否则按内联脚本回落,
  把内容整写为 `tmp/test.<n>.sh` 后运行(保留执行快照供审计)。两种形态均移除
  标记后在目标目录执行(共用 `idleTime` / `idleMax` 看门狗),stdout/stderr
  合并整写 `tmp/test.<n>.out`(单文件,编号跨会话/跨运行接续)。退出码非 0
  不由 driver 判定——判断权在 AI。
- **反馈**:driver 经 steer(下一 provider turn 边界)把退出码、耗时、超时原因、
  脚本与输出文件路径注入**同一会话**;AI 直读文件判断(不经工具输出截断,大文件
  分段读)。重跑同一测试 = 把同一脚本路径再次写入 `tmp/test.sh`(脚本可先修改
  再重跑)。如此循环直至会话不再写标记、自然结束,回到主流水线。

每个执行会话入口会清除上一会话/上次运行遗留的待执行标记(归档历史保留),防止陈旧
请求污染新会话;测试脚本不经 opencode 权限体系(等同 driver 亲自在本地跑测试;
这是便利性取舍而非安全边界)。该约定同时经 init 下沉:AGENTS.md 的 opencode-auto
标记块内测试执行原则段落(随 `testByDriver` 出现或消失)、agent 契约带对应条款,
`check` 子命令在 `testByDriver` 启用时扫描 AGENTS.md 与任务文档中要求会话亲自
运行编译/测试/构建/lint 的描述。

### 测试交接(--handover-test)

`--handover-test`(需搭配 `--test-by-driver`,经 `init --handover-test` 固化到配置
`handoverTest` 键)针对"超大上下文中反复试错"。

**交接时机 = AI 发起测试的那一刻。** 判据是单条件:会话上下文已用 tokens 达到
`contextLimit`(不再叠加"测试失败")。之所以卡在测试请求这一刻,是因为它是唯一天然
干净的分割点——AI 发起测试通常意味着相关工作已做完、正要验证;越过这一刻上下文就
开始变化,不再好切。现场审计实测旧的双条件判据会让会话冲到上限的 2–4 倍
(64k/80k 上限 vs 实测 72.7k–264.3k),上下文越大,会话意外死亡时的损失面越大。

命中时 driver 在这一刻一口气做三件事:

1. **提交定版(提交 #1)**——固定被测的脚本与源码。此刻会话处于 idle,没有半写文件。
2. **并发执行测试**——不等会话收尾(串行会把会话晾到缓存失效)。
3. **下发收尾+交接指令**——要求 AI 把**不依赖本次测试结果**的剩余工作全部做完落盘,
   再把**与本次测试密切相关或依赖测试结果**的部分写入测试交接文档后结束会话。

会话结束后,driver **重测守卫**比对定版提交以来已跟踪的非文档改动(`test/` 脚本与
源码;文档面与未跟踪新增不计):有改动说明本次测试结果对不上工作区,则 `git stash -u`
挪开收尾改动、对定版快照重跑同一脚本、再 `stash pop` 恢复——收尾成果一份不丢,
"两次提交之间源码与脚本无修改"由此成立(pop 冲突不吞:stash 条目保留、阻塞停机)。
随后交接文档**归档**为 `testhandoff-<n>.md`,并落**提交 #2**确认交接。一次交接两次
提交,每次交接都有可回退的留档。

文档按执行范围命名:子任务为 `docs/<任务ID>/S<两位序号>/testhandoff.md`,整任务会话为
`docs/<任务ID>/testhandoff.md`;交接只对本执行范围生效——下一子任务不会
误读上一子任务的遗留交接。文档缺失带反馈重试一次,仍缺失按隐性阻塞停机
(严格恢复开启时无效一次即回滚重做)。归档份与当前份在执行范围完成时一并清除,
历史交接内容由 git 提交记录承载。driver 随即开新会话(上下文已超限,会话复用规则
自动新建),以续跑说明(先读交接文档、再判读那次测试的结果)继续完成任务,测试仍走
同一协议。

收尾提示词刻意**不提"上下文/上限"**:会话一旦知道自己上下文吃紧,就会自行判定余量
不足而省略本应完成的落盘工作(现场实证);也不写"不要改源码"——AI 发起测试时本就
知道被测内容不该动,真动了由定版提交 + 重测守卫兜底。

交接不设硬上限;连续交接超过 10 次时,续跑说明会附带提醒——先评估是否陷入当前
无法解决的问题,若是可经 `AUTO-FIXME: <原因与计划>` 标注遗留后跳过继续,由 AI
自主决策。交接文档与 `ondemand` 的 `docs/<任务ID>/handoff.md` 命名分离,两机制可
同现;任务非恢复续跑时,上次尝试遗留的交接文档(含归档份)会被清除(镜像 ondemand 语义)。

## 死循环检测(重复动作提示)

能力较弱的模型常会连续多次以同一方式重复同一个动作却始终不成功——同一个 edit 反复
报同一个错、参数微调后报错一字不差、反复读同一个文件得到完全相同的输出——上下文里
堆的全是同一段失败,自己走不出来。driver 在会话进行中观察每个工具调用的结果,识别到
这类重复即**主动向会话插入一条提示**,帮它跳出死循环。

判据(以会话为范围,不要求连续——交替重试同样识别):

| 情形 | 判据 | 次数 |
|---|---|---|
| 同一个报错反复出现 | 同一工具 + 同一报错文本(**不看参数**,参数微调仍算同一个坑) | 3 次 |
| 同参同果的空转 | 同一工具 + 同一参数 + 完全相同的输出(这次调用没带来新信息) | 4 次 |

报错不同或输出不同一律视为有进展,不计数。提示逐级升级:第一次摆出证据(工具、参数、
报错原文)并要求核对前提、换一种手段;第二次要求先写清"目标 / 已经试过什么、各自失败
在哪 / 下一步换用什么"再动手;第三次要求停止重试,以 `AUTO-FIXME: <原因与计划>` 标注
遗留、交代进度后结束会话,由 driver 推进后续流程。每个会话至多提示三次,命中后该动作
的计数清零(再犯满一轮才会再提示)。

检测**只提示、不停机**:不中止会话、不改变任何完成判定、不写状态文件。判据再稳妥也可能
误判(有的任务本就要反复跑同一条命令等外部状态变化),因此第三级也只是把"收尾"的决定权
交回 AI。

置 `OPENCODE_AUTO_STUCK=off` 关闭检测(缺省 `on`);`--dryrun` 权限预检会话恒不检测——
它本就靠反复被拒来探查权限边界,重复报错是其正常形态。

## 提问策略与代答审计(AUTO-RESOLVE)

无人值守流水线为了不停机,会把**本应由你拍板的分歧点**替你闭环掉。这类决策和 AI 本就
该自己做的工程裁量性质完全不同,却曾经混在同一个 `AUTO-DECISION` 标记里:一个任务记十
几条,真正该被看见的那两三条反而淹没其中。现在两者分开记、分开报。

判据只有一条 —— **这个分歧点的决定权本应属于谁**:

| 决定权归属 | 标记 | 典型情形 |
|---|---|---|
| **你(用户)** | `AUTO-RESOLVE: <原问题> -> <所选方案> (<理由>)` | 需求意图与范围取舍(做不做、做到哪)、对外可见行为与接口契约的变更、「什么算做完」的判定标准、事实确认类问题(数据异常、环境缺失、与文档不符的现状)、超出或收窄任务描述的字面范围 |
| **AI** | `AUTO-DECISION: <决策> (<理由>)` | 实现手段的选择,且任一选项都不改变用户可见行为(算法、内部结构、命名、文件组织、注入方式、测试写法) |

同一决策只标一类;拿不准标 `AUTO-RESOLVE` —— 多提醒一次无妨,漏报才是真损失。

driver 两路采集:① 会话真发了问、被自动答复回落的(人工在 `--wait-answer` 内真答了的
**不算**,那是你做的决定;`--dryrun` 权限预检会话也不算);② 会话收尾扫描本次未提交
改动里的两类标记行。两源配对后,`AUTO-RESOLVE` 在任务、阶段、轮次的结论行**之前**以
`⚑` 置顶展示:

```
⚑ 本任务自动代答了 3 个本应由你确认的问题,请重点确认:
  1. 是否把 prompt.ts 的第三份 formatTokens 一并收口 → 顺带收口(同层依赖,不引入反向 import)
     src/prompt.ts:501
  2. 折旧入账是否同样过 MAX_TICK 钳制 → 同样钳制(宁少不多)
     src/stats.ts:84
  3. 「什么算做完」是否包含并发场景  ⚠ 会话未按要求写出 AUTO-RESOLVE 标记
  完整记录见 docs/T-001/report.md 的「自动代答问题」节
  另记录 AUTO-DECISION 5 条(已折叠,见任务报告)
✓ T-001 完成: 用时 24 分 31 秒(AI 18 分 12 秒),会话 7 次
```

任务级逐条列出(超过 8 条只列前 8 条),阶段与轮次只给一行计数。`AUTO-DECISION`
**永不与它争版面**:有代答时折成末行一个数字,没有代答时连终端都不上(只进日志文件)。
收尾会话还会被注入 driver 观测到的代答清单,要求任务报告单列「自动代答问题」一节 ——
持久记录因此不依赖 AI 自觉,进了 git 的标记行与该节才是审计轨迹。

### 两档提问策略(`OPENCODE_AUTO_ASK`)

提问义务与标注义务**同进同退**,由这一个开关切换:

| 值 | 提问策略 | 标注要求 | 代答记录的完备性 |
|---|---|---|---|
| `off`(缺省) | 非权限问题一律不问,自主决策(与改造前逐字节等价) | 强制标注两类标记 | 只覆盖"会话仍然发了问"的少数情形,其余靠会话自觉,**漏标不可检测** |
| `on` | 归属于你的分歧点**主动调 question 工具发问** | 不要求任何标注 | 提问是流经 driver 的事件,**观测即完备** |

**要可审计的代答记录就用 `on`** —— 缺省档的计数不完备,别把它当全量。代价是每个问题
一次会话往返(token 与时长),以及提问变多后更容易撞上"同一问题重复询问即阻塞停机"的
安全网(该判定用的是归一化后子串包含,作用域限于当前回合)。

副产品:提问数就是**计划完备度指标**。计划写得完备 → 提问寥寥 → 跑完很安静;提问密集
→ 高亮块很吵 → 说明计划有洞。档位选择是你对自己计划质量的显式声明,程序不代劳。

台账落在目标目录 `.auto/resolves.json`(已被 gitignore,driver 独占写),与恢复判定完全
无关:损坏或缺失只是计数从当下重开,不影响运行。人工回退重跑同一任务前 `rm` 掉它即可
清零(与 `.auto/stats.json` 同款规程)。

**例外:`plan` 的会话不代答。** plan 为执行前的人工审阅而跑,非权限提问一律等人工
回答(无超时,`-i` 常驻输入行或 stdin),不产生 AUTO-RESOLVE 代答与标注;答不上来
(输入关闭)或同题重问即阻塞交人工。`run` 的会话(含 `run` 发起的规划会话)口径不变。

## 提示词模板与自定义

全部会话提示词以**文件模板**管理(文案与逻辑分离,提示词组装在核心包 `@opencode-ai/auto-core` 的 `src/prompt.ts`):

- 内置模板在核心包 `@opencode-ai/auto-core` 的 `templates/prompts/`(每种会话一个文件,共享片段集中在其
  `_partials.md`),编译期嵌入独立二进制;
- 目标目录 `.opencode/auto/prompts/<name>.md` 同名文件可**覆盖**任意内置模板
  (`_partials.md` 按节名合并共享片段),不需要重新编译。

模板语法刻意保持最小:

| 语法 | 含义 |
|---|---|
| `{{var}}` | 变量替换(string 直替;boolean/undefined 渲染为空) |
| `{{#if x}}…{{/if}}` / `{{^x}}…{{/if}}` | 条件段(x 非空字符串或 true 为真) |
| `{{> 片段名}}` | 引用 `_partials.md` 的 `## 片段名` 节;独占一行时行首缩进应用到片段每一行 |

块/片段标签独占一行时整行吞掉,书写不必顾虑空行。协议敏感模板(收尾、阶段交接、
分解等)被覆盖时会做**关键协议内容校验**:缺少 driver 解析所依赖的协议行(如收尾
模板的 `Result: PASS` / `Result: FAIL` 结论行说明)即装载报错退出(退出码 1),
防止自定义模板悄悄破坏 driver 协议。

## 模式层(-m/--mode)

`-m/--mode <name>`(仅 `init` 接受,写入配置的 `mode` 键;缺省 `migrate`;显式值须为
已注册的模式名,否则用法错误退出码 1,报文会列出当前支持的模式)是**提示词级**的
场景引导,不改变 driver 的调度状态机:

- 阶段规划会话注入场景导语:场景定义、任务排布原则与验证侧重;
- 执行类会话(分解 / 整任务 / 子任务 / 收尾)注入对应的注意事项。

模式同样以文件模板管理:**新增模式 = 在目标目录放一个模式文件,零源码改动**。
内置 `templates/modes/migrate.md`(auto-core 包,迁移/升级场景:以保持外部行为不变为前提,任务
按"基线确认 → 迁移改造 → 回归验证"排布,回归验证优先复用既有测试/构建命令;执行
注记要求新旧实现对等行为、兼容层注明用途与移除时机、迁移取舍按 `AUTO-DECISION`
要求标注);目标目录 `.opencode/auto/modes/<name>.md` 可新增模式或覆盖内置,文件
格式(注入前会经模板引擎渲染):

```markdown
# <模式名>(须与文件名一致,小写字母开头的字母/数字/连字符)

## init
(规划导语: 场景定义、任务排布原则、验证侧重)

## exec
(执行注意事项)
```

两节齐备,缺节/未知节为解析错误;终审闭环退役前的 `## final: audit` /
`## final: validate` / `## final: finalize` 三节仍可装载,内容忽略。

模式固化在项目配置的 `mode` 键(`.opencode/auto/config.json`):`init -m <name>`
显式修订(优先级: 显式值 > 既有配置值 > 缺省 `migrate`);`run` 读取配置解析,
不再接受 `-m`(出现即用法错误)。`optimize` / `implement` / `test` 等扩展场景
直接按上述格式添加文件即可。

## 阶段化流程(--phases)

`--phases <admtvk 子序列含 m | 阶段类型列表>`(`init` / `amend` 接受,写入配置的
`phases` 键;缺省 `"m"` = 无阶段声明,单次运行,行为与阶段化之前完全一致)把迁移类
长流程拆为阶段。取值有两种形态:

- **字母预置**:六个内置阶段 **a 分析(analysis) → d 设计(design) → m 迁移实现
  (implement) → t 测试(test) → v 验收(acceptance) → k 知识提炼(knowledge)**
  的子序列且包含 `m`(如 `m`、`amt`、`admtvk` 合法;`tma`、`adk`、重复字母、空串
  非法)。
- **阶段类型列表**:逗号分隔的类型 id(如 `analysis,security-review,implement`),
  顺序任意、可重复、须含 `implement`;config.json 里也可写成 JSON 数组。注意只有
  字符串 `"m"` 是单次运行,列表 `implement` 是带规划会话的阶段化流程。

**自定义阶段类型**:在 `.opencode/auto/phases/<type>.md` 一类型一文件定义(文件名即
类型 id,不得与内置类型、字母预置形态或模型路由角色词重名),在类型列表里按 id 引用:

```markdown
# Security review

Gate: verdict
Reasoning: deep
Phase-artifacts: threat-model.md
Task-artifacts: review.md

## plan duties

Plan one review task per trust boundary.

## decompose duties

Split by attack surface.
```

标题行为显示名;字段块可选(`Tasks:` 只接受 `yes`——自定义类型恒有任务,无任务的
知识提炼阶段只内置;`Gate:` 取 `none` / `verdict`;`Reasoning:` 取 `deep` / `simple`,声明该类型
任务会话(整任务、子任务)所需的推理档,缺省 `deep`,随类型文件版本化;产物路径相对阶段/任务目录);
`## plan duties` 必填(阶段规划会话的职责段),`## decompose duties` 可选(分解会话
的职责段)。非法文件按用法错误报出并指明文件。`OPENCODE_AUTO_MODEL` 可按类型 id
路由模型(`security-review=prov/model`,优先级 角色 > 类型 id > 预置字母 > `*`;
有模型注册表时值为内部名,见
[模型注册表与分层路由](#模型注册表与分层路由model-registry)),
未知类型键在 run 启动时报用法错误。

- **brief.md**:项目简报 `.opencode/auto/brief.md`(版本化、人工可编辑),由每个
  阶段的规划会话消费——它是项目级意图,a 阶段定下的基调 k 阶段同样需要。`init`
  在文件缺失时写一份**项目简报桩**(`## Goal` / `## Source` / `## Target`
  / `## Constraints` 四节,各节只有 HTML 注释提示;既有文件保留),人直接编辑填写;
  注入规划会话前剥掉注释,原样未填的桩不注入任何内容。各节标题只是脚手架,driver
  不解析。`reset` 只在它逐字节等于桩时删除,填写过即保留。init 不启动任何 AI 会话,
  也不接受 `-p`(意图直接编辑该文件;带规划输入的是 `plan -p`,见
  [由 AI 规划任务](#由-ai-规划任务))。
- **迁移源与目标**:属项目意图,写进 brief.md(如「把 `legacy/pkg` 迁移到
  `app/`」),规划会话读 brief 时一并得到——不再是配置(auto-core plans/0052
  D1–D3,2026-09-23)。原 `--source-dir` / `--source-path` / `--dest-dir` 选项与
  配置键 `source` / `destDir` 已退役:选项出现即用法错误,存量键读入即严格失败并
  给出原值,请抄进 brief.md 后删键——`fix` 代为迁入 `## Source` / `## Target` 节
  并删键(或无参 `init` 全量覆盖丢弃)。源系统大树仍可
  经软链接入工作目录,在 brief 里写链接路径即可。
- **轮次专用目录 `docs/R-NN/`**:阶段化流程(`phases ≠ "m"`)的每一轮是一个自
  包含轮次容器(R 后两位零填充,如 `R-01`,自然进位),轮首即建(`plan` 建:首轮
  `R-01`,上一轮完成并通过轮关闭检查后 `R-(N+1)`),其中一切**落盘即永久**——不改名、不改路径、不删除:
  阶段索引 `phases.md`、每个阶段
  一个**阶段目录** `P<nn>-<类型>/`(如 `P01-analysis/`,见下)、前置知识 `prior-kb.md`
  (轮首的 AGENTS.md 快照 `AGENTS.md.bak` 已于 2026-09-25 退役——AGENTS.md 只含按
  配置渲染的标记块,无需逐轮留档;旧轮次里已有的快照原样保留)。
  阶段目录收齐该阶段的一切:状态文件 `todo.md`/`done.md`、交接文档
  `handover.md`、任务索引 `tasks.md`(本阶段的任务清单,见[任务单元格式](#任务单元格式))、
  阶段级自由产物、类型标准产物(如 knowledge 阶段的知识文档 `kb.md`)与人写的验收
  记录 `acceptance.md`。任务本身在工作目录级的 `docs/T-NNN/`(编号全局唯一)。
  `phases = "m"` 同样建立 `docs/R-01/`,即隐式单阶段 `P01-implement/`。
  **旧布局不兼容**(auto-next 重构裁决):字母阶段布局(轮内 `<字母>-<英文名>/`
  归档、`handovers/`、`phase-docs/`、`- [done]` 台账行)与更早的平铺布局(根
  `docs/phases.md` 台账、`docs/phases/`、`docs/handovers/`、`docs/migration-kb/`)
  的项目不在本版本下推进,需要继续的项目请新开项目;残留的平铺读回落与旧布局
  检测报错随后续清理一并落地。
- **阶段索引(轮内 `docs/R-NN/phases.md`)与阶段目录**:轮首按 `phases` 预置
  字母展开写出索引(每阶段一行,只记顺序与成员)与各阶段目录(内含 `todo.md`)。
  阶段状态是**推导式**的——阶段完成 = 其目录内 `todo.md` 由 driver 改名为
  `done.md`(随交接提交落盘),当前阶段 = 索引中第一个未完成的阶段;索引行的勾选
  只是冗余视图,以文件为准:

  ```markdown
  # Phases (R-01)

  - [x] P01 analysis
  - [ ] P02 implement
  - [ ] P03 test
  ```

- **前缀护栏(只读)**:当前轮未完成且已有完成阶段时,`init` / `amend` 的
  `--phases` 新值必须以已完成阶段(按索引序)为前缀,否则报错(退出码 1)——防止
  把流程状态改成不可推导;当前轮已完成时护栏放开,新值作用于 `plan` 建立的下一轮。
  兼容的新值不再当场改写索引:索引与新值的差异作为**漂移**由 `plan` 重同步(重写
  尾部尚未开始的阶段目录,`run` 遇漂移退出码 1 并指向 `plan`)。索引行无法解析、
  类型未知或重复、阶段目录 `todo.md`/`done.md` 两者都有或都没有,同样为环境错误
  (退出码 1)。
- **人工回退**:回退到某阶段 = ① 把该阶段及其后各阶段目录内的 `done.md` 改名回
  `todo.md`(索引勾选随手取消,或留给 driver);② 需要续跑该阶段的某个任务时把
  `docs/T-NNN/done.md` 改名回 `todo.md`;③ 重跑 `run`。推导式状态使回退
  无需专门代码支持。
- `v`(验收)阶段是完成侧检查的承载点:v 阶段任务只验证与记录、不做修复,
  发现差距经任务报告的结论行上报——`Result: FAIL` 即阻塞停跑,由人工规划修复
  (见[验收结论行](#验收结论行result-passfail))。
- **阶段循环(`run`)**:配置 `phases ≠ "m"` 时 `run` 按"规划 → 执行 → 交接"推进到
  全部阶段完成,进度全部从阶段索引/阶段目录 + 任务索引/任务目录推导(运行时状态只在
  `.auto/units.json`):
  - **规划**:当前阶段尚无任务索引 `tasks.md`(或索引为空)时开一个**阶段规划会话**,
    把本阶段任务写成阶段目录内的 `tasks.md` 与各 `docs/T-NNN/todo.md`(格式见
    [任务单元格式](#任务单元格式))。driver 逐份形检(字段块、`## Goal`/`## Scope`/
    `## Acceptance`、末行终止符、`Phase:` 为本阶段编号、编号不与其他阶段或已完成任务
    冲突),不过关带反馈重试一次,重试前清掉本阶段上次产出。会话消费 `brief.md`
    (含迁移源与目标)、轮次简报、模式导语与**各前序阶段的交接文档**(handover 蒸馏产物是跨阶段
    记忆的唯一通道,前序原始 `docs/` 不注入;缺 handover 的阶段在清单中标注
    "(no handover document)");规划受阻退出码 2(人工处理后重跑)。
  - **执行**:有未完成任务时走既有主循环,任务级语义(分解/收尾/结论行/统一提交/
    断点恢复)与单次运行完全一致。
  - **k(知识提炼)阶段例外**:k 阶段不开规划会话、不列任务——
    plan 路由直接进入**知识提取旁路会话**(整体认领原 `--extract-knowledge`
    设计,见 `packages/auto-core/plans/0002-fixme-knowledge-design.md` 文首修订节),通读阶段索引与各
    阶段目录内的交接文档,把最终验证过的迁移经验蒸馏为该阶段目录内的类型标准
    产物 `docs/R-NN/P<nn>-knowledge/kb.md`(落盘即永久;章节
    骨架:迁移概要/API 与类型映射/实现模式/坑点与边界情况/可复用规则/设计
    偏差与重要决策/验证证据/参考)。
    **提取失败不污染退出码**:会话受阻或两次未产出仅打 ⚠ 警告,k 阶段照常交接
    (迁移成功不被文档生成失败反向污染;重试 = 把该阶段 `done.md` 改名回
    `todo.md`、删除其 `kb.md` 后重跑);交接前中断则重跑时按阶段目录内文档幂等
    跳过已产出。知识文档随统一提交入库。人工在
    k 阶段自行在其 `tasks.md` 列任务时走通用执行/交接路由,提取挂点不触发。
  - **交接**:本阶段任务全 done 后,先开**交接蒸馏会话**(旁路一次性,通读本阶段
    任务索引与 `docs/` 产物,提炼出阶段目录内的 `handover.md` 交接文档,必备
    四个小节:关键决策 / 约束与坑 / 下一阶段必读清单 / 产物索引;产物缺失带
    反馈重试一次,仍失败按隐性阻塞退出码 2),再由 driver 机械收口——阶段 `todo.md`
    改名为 `done.md` 并勾选索引行(任务索引原样留在阶段目录,无快照与重置),整体作为一次统一提交
    (`Auto-Stage: phase-transition`)落账。本阶段的 `docs/` 产物文档
    (`docs/T-*/` 等)为永久路径,交接不搬移。各步幂等,交接中途断电/Ctrl+C 后
    重跑会自行补完(含补做完成改名)。
  - 索引中全部阶段完成 → 退出码 0(`✓ all phases complete`)。
- **阶段进度行**:`run` 启动横幅在配置摘要后打印一行进度(`status` 改为打印完整的
  阶段/任务/子任务树),`✓` = 已
  完成、`▶` = 当前阶段、其余 = 未开始;续轮(轮次目录 `docs/R-NN` 最大号
  \> 1)时带轮次标注:

  ```text
  phases: P01-analysis✓ P02-design✓ P03-implement▶ P04-test
  phases (round 2): P01-analysis▶ P02-implement
  ```

- **自动编号(缺省启用,`init --no-auto-number` 关闭)**:关闭后阶段规划会话不再被提供起始编号,但任务目录 `docs/T-NNN/` 全局唯一,
  driver 仍拒绝与其他阶段或已完成任务冲突的编号。启用时
  任务编号在目标目录**永不重复**:下一可用编号持久化在 `.auto/next-task`(内容仅为
  一个正整数,driver 维护;`.auto/` 已被 gitignore,新克隆天然缺失),阶段规划会话
  自该记录续接编号,driver 校验产出不复用已占用编号(复用视为无效产出、带反馈重试
  一次仍失败按隐性阻塞退出码 2),规划成功后记录推进到本次最大编号 + 1(只增不减)。
  **记录缺失时先恢复再继续**:现存文件(各阶段任务索引 `tasks.md`、
  任务目录 `docs/T-NNN/` 等产物文件名)中无任何编号证据(全新项目)时直接写 1;否则开一个旁路一次性
  **编号恢复会话**通读归档与 git 提交历史推导下一编号(git 历史可发现产物已被删除的
  编号),driver 以确定性扫描的下限校验其写入(小于下限视为无效,重试一次仍失败按
  隐性阻塞退出码 2)。

- **开下一轮(`plan`)**:一轮阶段全部完成后(`run` 退出码 `0`),填
  `docs/R-NN/round.md` 的 `## Close` 节(列出哪些决策已重述进目标自身的文档、哪些
  接受流失)并提交,再跑 `plan`:它先跑轮关闭检查(全树 P1 扫描、目标构建、
  `## Close` 清单;不过 → 逐条列出,退出码 `2`,`plan` 拒绝开下一轮),通过后建立
  `docs/R-(N+1)/`——阶段索引与阶段目录按配置的 `phases` 展开,停在轮首门禁等待审阅提交;
  各步幂等,中断后重跑 `plan` 自然续完。新一轮的目标是补齐上一轮的遗漏、对齐残余
  差距,而不是重做已完成的工作;上一轮轮次目录原样保留(落盘即永久)。跨轮改配置用
  `amend`(当前轮已完成时前缀护栏放开,新值作用于 `plan` 建立的下一轮)。新一轮
  首个阶段规划会话注入上一轮结论摘录(轮内阶段目录索引 + 最后完成阶段的交接文档
  全文 + 迁移知识文档全文),后续阶段照常走本轮 handover 蒸馏链。回退新轮 = 删除
  新轮目录 `docs/R-(N+1)/` 后重跑 `run`,即恢复上一轮完成态。`continue` 子命令已
  退役(出现即报文指向 `plan`);`--continue` 不是任何命令的选项(出现即报错指引)。
- **轮次推导**:当前轮 = `docs/` 下 `R-NN` 轮次目录最大编号(轮首即建,无 +1),
  零新增持久化状态;`run` 的阶段进度行带轮次标注(如上),`status` 的树以 `R-NN`
  开头。

> 阶段化流程的 P1..P4 已全部接入:P3 起,交接文档由蒸馏会话产出并注入下一阶段
> 规划会话;P4 起,k(知识提炼)阶段整体认领原
> `--extract-knowledge` 设计(知识提取会话产出 knowledge 阶段目录内 `kb.md`,失败不污染
> 退出码)。`--track-fixme` 仍独立演进(`packages/auto-core/plans/0002-fixme-knowledge-design.md`),未实现。

## AGENTS.md 标记块

`init` / `amend` / `fix` / `run` 在目标目录 AGENTS.md 中幂等同步单一 opencode-auto 标记块
(`<!-- opencode-auto:start -->` 到 `<!-- opencode-auto:end -->`,内容为英文):
按当前配置渲染后与文件中现有的标准块比对,一致则不动、不一致则整块替换、缺失则
追加;文件中任何其他 `opencode-auto:<name>:start/end` 标记块(旧版六块格式,或
游离标记块)一律清理,除此之外永不改写 AGENTS.md。块内含以下段落:

| 段落 | 内容 |
| --- | --- |
| 指针 | 提示词已内联当前任务;上下文被压缩或拿不准进度时重读 `docs/T-NNN/todo.md` 与 `subtasks.md`;AGENTS.md 不记笔记 |
| 测试执行原则(Test principle) | 编译/测试/构建/lint 等命令由 driver 在会话外执行(仅 `testByDriver: true` 时出现) |
| 提交原则(Commit principle) | 会话后由 driver 递归统一提交,会话不执行 git 提交 |
| 摘要原则(Summary principle) | 非交互场景不产出会话末尾总结,产出物一律写入 docs/ |
| 引用与存放规范(Reference and storage conventions) | stable-refs:docs/T-NNN/ 目录化永久路径、引用根相对路径语法、检查三层 |

提交原则、摘要原则、引用规范描述的是**与配置无关的不变式**,无条件出现;测试执行
原则对应测试执行协议,随 `testByDriver` 开关出现或消失——机制不存在时,块内不保留
其描述。生效配置由 run 启动横幅与 `status` 打印。

**AGENTS.md 只承载这个标记块**(以及人工写在块外的内容):会话不维护它——原先的
维护规则段落、`docs/agents/<主题>.md` 路由约定与 150 行上限已于 2026-09-25 退役
(auto-core plans/0054)。原因:AGENTS.md 由 `init` 列入 `.gitignore`(仅本地),会话对它的
改动既不进统一提交、也不随单元回滚,完成条件与审计轨迹都覆盖不到;值得留存的知识
一律写进会随提交入库的 `docs/` 文档(阶段交接、知识阶段的 `kb.md` 等)。`run` 期间
AGENTS.md 只读,agent 契约(`.opencode/agent/auto.md`)同步要求会话不改它。`check`
在块缺失、内容与当前配置渲染不一致或残留旧版标记块时输出提示(note,不影响退出码)。

## 任务单元格式

任务按阶段登记在阶段目录的任务索引里,每个任务一个目录。`phases = "m"`(缺省)
即隐式单阶段 `docs/R-01/P01-implement/`:

```md
<!-- docs/R-01/P01-implement/tasks.md(任务索引:只记顺序与成员) -->
# Tasks

- [ ] T-001 任务标题
- [ ] T-002 另一个任务
```

```md
<!-- docs/T-001/todo.md(任务正文) -->
# T-001: 任务标题
Phase: R-01.P01

## Goal

目标。

## Scope

范围与关键约束。

## Acceptance

完成判据。
```

- 索引行格式 `- [ ] T-<编号> <标题>`,按行序执行;driver 取第一个未完成且依赖已满足的
  任务。**进度以文件为准**:任务目录内恰有 `todo.md`(未完成)或 `done.md`(已完成)
  之一,driver 完成任务时把 `todo.md` 改名为 `done.md` 并勾选索引行——勾选只是冗余
  视图,两者都没有或同时存在即环境错误(`run` 退出 1 并给修订指引)。
- 任务正文由标题行、紧随的字段块(`Phase:`,可选 `Depends:` / `Touches:`)与
  `## Goal` / `## Scope` / `## Acceptance` 三节组成;规划会话产出的任务文档按此强制
  形检,手写时建议同样遵守。不要手工编写子任务检查项——分解会话会写
  `docs/T-NNN/subtasks.md`,子任务进度同样以 `docs/T-NNN/S<nn>/todo.md|done.md` 为准。
- 依赖字段三层同构:任务写在 `Phase:` 行之后,阶段写在阶段目录 `todo.md` 的 `Type:`
  行之后,子任务写在 `S<nn>/todo.md` 开头(检查项第 n 行即 `S<nn>`)。`Depends: T-011, T-012`
  = 所列单元完成后才开始(只写同层编号:任务可引用本阶段任务或已完成的任务,阶段只引用
  本轮阶段,子任务只引用本任务子任务);缺省 = 依赖索引中的前一项(即串行),
  `Depends: none` = 无前置。`Touches:` 列出会改动的仓库相对路径(不得为绝对路径或含
  `..`),缺省 = 可能触及一切,目前只做检查、不参与调度。空值、自依赖、未知编号与环
  在规划/分解会话收口时打回重写,在 `run` 加载索引时即环境错误(任务、阶段退出 1;
  子任务阻塞退出 2)。
- 运行时状态(`in_progress` / `blocked`、尝试次数、fork 基点)只在 `.auto/units.json`,
  不写进任何文档;索引勾选与 `todo.md` → `done.md` 改名只由 driver
  维护,agent 会话不得改动。`opencode-auto status [dir]` 打印只读的轮次 → 阶段 → 任务
  → 子任务树。
- 验收标准写进 `## Acceptance`(或规划成独立的验收任务、v 阶段);结论经任务报告的
  结论行上报,见[验收结论行](#验收结论行result-passfail)。

### 由 AI 规划任务

`init --implement-file` / `--implement-prompt` 快捷模式已退役(auto-core plans/0053 D13):
任何命令出现这两个选项即用法错误(退出码 1),报文指向
`opencode-auto plan <dir> -p <text> | --file <path>`(先 `plan` 建轮并提交轮首设置;
见[规划与轮次生命周期(plan)](#规划与轮次生命周期plan))。
`init` 不再启动 AI 会话,也不再因这两个选项把 `subtask` 缺省为 `ondemand`、`wrapup`
缺省为关闭。

`phases = "m"` 的规划与阶段化流程共用同一个阶段规划会话(auto-core plans/0053 D12):

- 输入原样存为阶段目录下的 `plan-input.md`(`docs/R-01/P01-implement/plan-input.md`),
  在规划会话之前单独提交;规划会话按「计划文件」读取它,写出任务索引与各
  `docs/T-NNN/todo.md`,完成即统一提交(`Auto-Stage: phase-plan`)。
- 模型路由沿用 `implement-scan` 角色,已有的路由配置无需改动。
- 编号:`autoNumber` 开启时自 `.auto/next-task` 续接并在规划后推进;关闭时从已占用的
  最大编号之后开始。
- 规划会话被中断时,下一次 `run`(或 `plan`)先完成这一步骤、再执行任务;与阶段化
  流程的规划步骤一样复用未收口的会话。

## 原则检查(check)

`opencode-auto check [dir]` 启发式扫描目标目录的 `AGENTS.md` 与任务文档 `docs/T-*/todo.md`,报告与
"测试执行权 / 提交执行权在 driver"原则相违背的描述——即要求会话直接运行编译/
测试/构建/lint 命令,或要求会话执行 git 提交的语句(命中打印
文件、行号与原文,退出码 1;干净时退出码 0)。原则性/否定句("不要运行…")、
归属 driver 的语句、字段行与 opencode-auto 标记块不算违背;
匹配为启发式,报告供人工确认。测试类描述的检查仅在 `testByDriver: true` 时进行,
提交类检查始终进行。`check` 另输出提示(note,不影响退出码):缺少 opencode-auto 块、块内容与
当前配置渲染不一致(过期)、残留旧版/多余的带名标记块;这些提示都指向
`fix`(`init` / `run` / `fix` 都会幂等同步该标记块)。配置读不进来时 `check` 只报
一条 note,属 `fix` 的键规则能修的一类时追加 `fix:` 提示;`check` 不列出 `fix` 的
逐条发现——完整清单跑 `fix` 看(不确认即不改动)。

`check` 同时做**引用检查**(稳定引用规范,stable-refs;实验开关
`OPENCODE_AUTO_REF_CHECK=on` 时启用,缺省 off 不扫描):全量扫描活文档
(`docs/**/*.md`,排除 `docs/phases/` 旧布局状态归档与轮内 `docs/R-NN/<字母>-*/`
阶段归档)中的路径引用——反引号 span 与
Markdown 链接内的目标目录根相对路径(可带 `:行号` 锚),失效引用(路径不存在、
行号超出文件总行数)逐条打印并退出码 1;代码围栏内的路径与行内含
`已删除` / `已归档` / `历史` 标记的引用豁免;URL、绝对路径与版本号形态不校验。
`check` 还会在 AGENTS.md 缺少引用规范块、或目标目录非 git(提交前引用
auto-correct 不可用)时输出 note(非 git note 仅在开关 on 时)。引用的提交前自动
修复(rename 改写)见「统一提交」相关章节。

## 模型注册表一览(models)

`opencode-auto models [dir]` 只读地打印**模型注册表**(model registry)的生效表,不启动任何
agent、不写任何文件,因此不取运行锁,可与进行中的 `run` 并行。注册表由两层合并而成:操作者层
(`$OPENCODE_AUTO_MODELS`,未设时为 `$XDG_CONFIG_HOME/opencode-auto/models.json`,
`XDG_CONFIG_HOME` 缺省 `~/.config`)与可选的项目层 `.opencode/auto/models.json`(本地私有,
`init` 把它写进 `.gitignore`,老项目由 `fix` 补上)。两层都不存在即无注册表,运行行为与以往
逐字节一致。本节只说明本命令的输出:

- **来源与环境**:读到的层、窗口时区与当前时刻、agent 过滤(外壳画像的 agent,否则
  `OPENCODE_AUTO_AGENT`;按 profile 的 adapter 匹配)、项目上下文上限(配置 `contextLimit`)
  与缺省 agent(配置 `agent`);设置了 `OPENCODE_AUTO_MODEL` 时另起一行标明它覆盖哪些会话的候选。
- **agent profile**:每个 profile 的来源层(`[operator]` / `[project]` / `[implied]`)、adapter、
  `bin`、`server`(去掉 URL 中的用户信息)与 `env` **变量名**——字面值只标 `(literal)`,引用只标
  引用名(`(env CLAUDE_B_PROXY)`),`null` 标 `(removed)`,**从不打印任何值**。
- **模型条目**:来源层、agent、步进(`model` 之后接各 `wider` id)、`variant`、`context`、窗口
  与所在 provider 的 key ring;下一行给出**此刻是否可用及原因**——在窗口外(附下次开放时刻)、
  被 agent 过滤排除、已知上下文窗口低于项目上限;上下文窗口未知(opencode 在 server 启动后才
  报告,claude 在首轮之后)只作提示,不判为不可用。
- **key ring**:每个 provider 一行,按顺序列出引用名与个数,以及共享它的模型。
- **tiers / routes / classifier**:两档列表、路由覆盖与失败信息分类模型列表,各带来源层;没有被
  任何档位、路由列表或分类器引用的模型单独提示为未使用。
- **路由表**:每个阶段类型(内置类型与项目自定义类型)下,解析结果相同的会话角色合为一行:
  档位(缺省档,或 `route <键>` 覆盖,优先级 角色 > 类型 id > 预置字母)与有序候选,`✓`/`✗` 标
  此刻可用与否;simple 档在 `|` 之后接续借用的 deep 列表(deep 档从不借用 simple)。

退出码:无注册表时打印一行、退出码 `0`;注册表可被 `run` 接受时打印整表、退出码 `0`;
`run`/`plan` 启动时会拒绝的问题(坏 JSON、未知字段、坏窗口、引用的环境变量未设置或文件不可读、
git 未忽略的项目层等)逐条以 `⚠` 打印、退出码 `1`——注册表能载入时先打印整表再列问题。
`models` 不取运行锁;除 `--probe` 外不接受任何选项(与 `check`/`status` 同组)。
`--probe` 会**启动 agent**(按 profile 惰性拉起各自的 host,经 agent pool),向每个被档位、
路由列表或分类器引用的模型逐个发送一条极短的恢复探测提示词(wait-and-probe 环的同款),
逐模型打印一行应答或失败——它因此是可选的:探测产生真实 token 消耗。探测失败是逐模型的
发现,不是命令错误;退出码仍由注册表本身决定。

## 阻塞与恢复

任务阻塞(退出码 `2`)时,driver 会把问题写入该任务的 `question` 字段并停机:

- **权限问题**:按 `--permission` 策略处理(缺省 `ask-deny`)——`auto-allow` 立即
  自动授权;`ask-allow` / `ask-deny` / `ask-fail` 先等待人工指令(`--wait-answer`
  分钟,未设则不等待;回答 `allow`/`yes`/`y` 等即授权,明确的其余回答拒绝该权限但
  会话继续),超时分别自动授权 / 自动拒绝并继续(AI 无授权绕开) / 拒绝并阻塞停机
  (此时按提示在目标目录 `opencode.json` 的 `permission` 规则中放行后重跑);
- **其他问题**:在会话外处理(或在 `answer` 字段填写解答),然后重新运行
  `opencode-auto run` 即可从阻塞处续跑。

<!-- auto: eof -->
