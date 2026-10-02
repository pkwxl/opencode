# opencode-auto 无头化服务化演进 — 方向评估与预规划（待讨论）

> 日期：2026-10-01
> 状态：评估结论；**已立项并实施完毕——T-086..T-098（2026-10-02）：`packages/auto-server` 壳包、daemon/worker 子进程拓扑、REST 控制面 + SSE/WS、Web 客户端与端到端收口**；旧状态"未立项，供将来讨论"作废（2026-10-02 勘正，`plans/0069` §4.2 A8）。正文保持评估稿原貌，实施真相以 `packages/auto-server` 及其文档为准。
> 评估对象：`~/worksapce/aseo/opencode/packages/auto-core`（branch `auto-core`，HEAD `6e146c979`）+ `packages/auto`
> 命题：把 opencode-auto 演进为纯无头自动化服务，经 RESTful API 操作、以 SSE 获取运行状态；配套纯 Web 客户端实现基本执行控制。
> 备注：本文为讨论稿，用中文书写；若日后正式立项进入仓库 `plans/NNNN-*.md`，按 AGENTS.md 约定应重写为英文。

## 一、结论（TL;DR)

方向成立，且代码库已在有意识地朝这个方向演进，改造成本比预想低得多。原五组件拆分（无头执行核心 / 动态配置工具套件 / REST API 模块 / 纯 Web 客户端 / 简单命令行控制台）大体正确，但需两处修正：

1. **"无头执行核心"已经存在**——就是 `auto-core` 本身。不要分叉或重写，只需新增一个 server 形态的 shell 包；核心永远不认识 HTTP（core/shell 契约：core does not know shells）。
2. **"动态配置"必须重新解读**。本程序的配置模型是刻意"反动态"的（init 固定 → amend 修订 → 运行期冻结，运行期出现宪法键即 exit 1）。正确含义是 **API 可达**（API-driven pre-run config），而非**运行中可变**（mid-run mutable）。破坏配置宪法是此次迁移唯一可能毁掉整个设计的路径。

## 二、方向成立的依据（现状盘点）

### 已经具备的服务化基础

| # | 事实 | 证据 |
|---|---|---|
| 1 | 整个运行时是一个库函数 | `src/loop.ts:33` `runAll(directory, opts: RunAllOpts): Promise<number>`；`planPrelude` / `closeUnit` / `task-add` / `renderStatus(dir)` 同样可直接调用。CLI shell（`packages/auto`）仅 ~1600 行参数解析与打印 |
| 2 | CLI 形态归属 shell，server 合法地是"另一个 shell" | `docs/shell-contract.md` §A 决策规则；注入点 `setShellProfile` / `registerTemplate` / `registerAgentAdapter` 全部现成 |
| 3 | 人机交互在关键点已做到传输无关 | `Interactive` sideband 接受注入的 `io: { input, output }` 流（`src/interactive.ts:34`，默认 stdin/stdout）；控制面是进程内服务调用：`Control.requestExit()`（`src/exit.ts:37`）、`Router.requestFailback(order)`。`/exit`、`/failback` 本质上已是等待被 WebSocket 调用的方法 |
| 4 | 可观测性基于磁盘、天然多进程安全 | `renderStatus(dir)` 纯读 unit 文件 + `.auto/units.json` + 阶段索引；`status` 从不取锁，明确设计为可与运行中进程并存；每次运行写完整同步审计日志 `.auto/logs/run-*.log` |
| 5 | 每目录单 driver 已被强制保证 | `.auto/run.lock`（pid+host JSON，陈旧 pid 探测，`src/lock.ts`）→ 一个 daemon 监管 N 个 worker 作用于 N 个目录，今天就是安全的 |
| 6 | 崩溃与 kill 同构，worker 可以是牲口不是宠物 | `src/exit.ts` 头注：进度持久化后，下次运行"precisely"恢复；`/exit` 即在任何安全边界产生与真实 kill 完全同构的现场。supervisor 可随意 kill/重启 worker |
| 7 | 下层已有 REST+SSE 先例 | opencode adapter 本身就 spawn/接管 `opencode serve` 并消费 SSE（`src/agent/opencode/`）；本 monorepo 已有同款架构（`packages/server`、`packages/web`、`packages/console`） |

### 仍然终端绑定的位置（诚实清单）

| 位置 | 现状 | 迁移处置 |
|---|---|---|
| `loop.ts:92-96` SIGINT → exit 130、`process.exit` | 假定拥有整个进程 | run 放到子进程执行，天然隔离 |
| `lock.ts:61` process exit hook 释放锁 | 同上 | 同上 |
| `confirm.ts` / `session-api.ts askHuman` / `loop-progress.ts` waitBetween 的 readline | 直连 stdin（部分已支持注入 io） | 面向一次性配置命令的映射为 POST；会话内问答走 `Interactive` 注入 |
| `log.ts` 模块级单例，直接 console.log 人类可读散文 | 无事件总线 | 唯一真正需要新增的核心机制（见下） |

### 三个真实的缺口

1. **没有结构化事件总线**。唯一实时信号是终端文本 + 审计文件，而日志行是给人看的散文、不是协议，Web 端不得刮取。需要给 `RunServices` 增加一个小型事件发射服务（先例完全一致：0061 就是这么把 `control`、`router` 变成服务的），同时喂日志文件和 SSE 订阅者；事件结构化（unit 迁移、session 起止、question、usage、error），绝不刮英文文本。
2. **阻塞式问答流**。`plan` 会话的 `humanQuestions` 无超时等待人类；Web 端必须处理断线重连，因此服务端需要**待答问题队列 + 可持久投递**，而不是一条 WS 消息。接入点就是 `Interactive.question()`。
3. **进程拓扑**。`runAll` 必须在子进程中执行而非 API 进程内：SIGINT/exit-hook 假定进程所有权，且子进程隔离免费带来 kill/恢复叙事。

## 三、修正后的目标组件划分

1. **无头执行核心 = `auto-core` 原地演进**。只新增：事件总线服务；（可选）把最后几处 readline 的 io 也做成可注入。核心永不 import HTTP。
2. **动态配置 = 尊重宪法**。init/amend/fix/reset 以 API 暴露（pre-run）；per-run 覆盖只走现有 env 开关层（`OPENCODE_AUTO_*` → API 的 per-run options）；运行中变更只走现有控制面（`/exit`、`/failback`、`close`、`task-add`）。"动态" = API 可达，不是运行中可变。
3. **REST/SSE 模块 = 新 shell 包**（暂名 `packages/auto-server`）。资源面直接从命令清单推导：
   - projects（目标目录，daemon 级白名单注册）
   - runs：POST 立即返回 run id；run lock 冲突映射 409/423；exit 0/1/2/130 机械映射 HTTP 状态
   - config ops（init/amend/fix/reset）、units（close / task-add）、plan（input / append / force-close）、models
   - SSE：logs、events、status；WS：interactive + question 队列
4. **纯 Web 客户端**：消费 status 树、事件流、问题队列。在 3 之上是薄层。
5. **简单命令行控制台：`packages/auto` 原样保留**。它仍是参考 shell、daemon 不可用时的逃生通道、回归基线。

### 进程拓扑（建议）

```
daemon (supervisor, packages/auto-server)
 ├─ REST API + SSE/WS 端点
 ├─ run 注册表：runs/{id} → (dir, pid, 状态)
 └─ 每 run 一个子进程 worker
     └─ runAll(dir, opts)   ← .auto/run.lock 保证每目录单实例
                                ↑ 磁盘读模型：.auto/*.json + .auto/logs/*.log + git
```

## 四、分阶段实施路线

| 阶段 | 内容 | 核心改动 |
|---|---|---|
| P1 | daemon + 子进程跑 run + REST 控制面 + SSE 尾随 `.auto/logs`、轮询 `.auto/*.json` | **零核心改动**——全部可观测性今天就在磁盘上 |
| P2 | `RunServices` 事件总线；SSE 订阅结构化事件；units.json 变更推送 | 一次小的核心改动（服务化模式照抄 control/router） |
| P3 | WS `Interactive` 传输适配（io 注入的两端在 server 侧对接）+ 可持久化待答问题队列 | 核心近乎零改动，主要是 server 包工作 |
| P4 | 纯 Web 客户端 | 无核心改动 |
| 全程 | `packages/auto` 不动 | — |

## 五、风险与必须守住的约束

本工具的可信度正来自那些"麻烦"的不变量，Web 化最大的风险就是图方便绕开它们：

- **driver 独占状态写**：API/Web 永远不得直接写 `.auto/`、`todo.md`/`done.md`、索引 tick——一切变更走 `closeUnit` / `task-add` / `runAll` 等库函数。
- **统一提交是完成条件**：Web 上的"完成"必须以 commit 为准（③ commit / ④ dirty），绝不信 agent 自报。
- **配置宪法**：不因 Web 好用而引入运行中改配置。
- **每目录单 run**：水平扩展只发生在目录维度，永不并发同目录。
- **信任边界放大**：`.opencode/auto/` 覆盖层会被逐字注入 prompt（等于执行该仓库的指令）；Web 一键触发任意目录的 run 会放大此风险 → daemon 必须维护目标目录白名单，且 API 需要 token 鉴权（本工具花真金白银的 token 并写 git）。

## 六、待讨论的开放问题（立项前需回答）

1. 事件总线的 schema：事件类型清单、与 `AgentEvent` 词汇的关系、是否进 `models-schema.ts` 式的冻结表。
2. 待答问题队列的持久化位置：`.auto/` 下新文件 vs daemon 内存 + 事件重放。
3. daemon 是否复用 monorepo `packages/server` 的基建（HTTP/SSE 模式），还是自包含（与"core 不认识 opencode 内部"的隔离原则如何平衡——auto 系只 import SDK 这条线要不要守住）。
4. 多机形态：daemon 与 worker 是否需要跨机（当前 run lock 的 host 字段已区分主机，但陈旧探测仅限本机）——第一版建议明确"单机多目录"为边界。
5. 新 shell 包命名与 bin 名（`packages/auto-server`？按 shell-contract §E 走 onboarding checklist）。
6. Web 端写操作的授权分级：只读 / 问答 / 控制面（exit、failback、close）/ 配置面（init/amend），是否分角色。
7. `models --probe` 这类烧 token 的操作的 API 暴露策略。
8. 旧 CLI 与 server 共存时的锁语义确认（现状已安全：server 子进程取锁，CLI 会被 409/423 拒绝——需在 UX 上明确呈现）。

## 七、证据索引（便于将来复核）

- 核心入口：`src/loop.ts:33`（runAll）；`docs/shell-contract.md`（core/shell 边界、注入点、onboarding checklist §E）
- 交互注入点：`src/interactive.ts:34`（io 注入）、`src/control-types.ts`（`Interactive`/`Boundary`）、`src/exit.ts:37`（`Control`）、`src/opts.ts:100-230`（`Opts`：interactive/humanQuestions/control/router/git 均为注入字段）
- 锁：`src/lock.ts`（holder JSON、stale 探测、re-entrant）
- 读模型：`src/status.ts:24`（`renderStatus(dir)` 纯磁盘读）；`.auto/` 下 units.json / progress.json / stats.json / windows.json / logs/
- 日志现状：`src/log.ts`（单例、console + 同步审计文件）
- 终端绑定残留：`grep process.stdin|readline` → `confirm.ts`、`session-api.ts:377`、`loop-progress.ts:32`、`step.ts:57`
- 恢复叙事：`src/exit.ts` 头注；resume/progress（0018-0022）
- 同构先例：`src/agent/opencode/`（REST+SSE 消费）、monorepo `packages/server|web|console`

<!-- auto: eof -->
