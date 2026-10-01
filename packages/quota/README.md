# @opencode-ai/quota

独立限额查询模块：在线查询模型服务商账号的配额/限额状态（kimi、zhipu/bigmodel），为"切换模型 / 切换账号"提供数据依据。**advisory-only**——只产出数据，永不自动触发切换；失败即"无答案"，超时即"无答案"（无重试）。

设计 spec 与端点实测记录：[`packages/auto-core/plans/0066-quota-module-plan.md`](../auto-core/plans/0066-quota-module-plan.md)（本文件同步了其中的实测结论）。对 auto-core 0057 §9 的关系：该节把"供应商配额端点探测"推迟，卡在 C4 凭据约束（凭据值只进子进程环境）；本包作为独立进程/独立包绕开该约束，并继承其契约精神（advisory、失败即无答案、观测不得 preempt 调度）。将来接入 `.auto/windows.json` 时使用其预留的 `WindowSource = "probe"`。本包零依赖 auto-core，只用 Bun 标准库。

## CLI

```sh
quota <provider>                          # 查询该 provider 全部已存账号（= query）
quota <provider> --account <label>        # 只查一个已存账号
quota <provider> --token <值>             # 一次性临时凭据（不落盘，label 记 adhoc）
quota <provider> list                     # 列已存账号：掩码指纹 / tokenExpiresAt / 元数据，无原文
quota <provider> token <label> <值>       # 添加/更新账号凭据
echo <值> | quota <provider> token <label> --stdin
quota <provider> token <label> --clear    # 删除
```

- 输出**仅 JSON**（stdout）：默认紧凑一行，`--pretty` 缩进两格。退出码：`0` 成功（批查中部分账号失败也算成功）、`1` 查询失败（网络/凭据/端点，批查全败也归此）、`2` 用法错误。
- 批查输出每账号独立成败：`{ ok: true, value: { provider, results: [{ account, ok, value?|error? }] } }`。
- provider id：`kimi`、`zhipu`。开发期可直接 `bun <本包>/src/cli.ts <args>` 运行。

## 凭据与多账号

- 存储位置：`~/.config/quota/<provider>/<label>.token`（0600，尊重 `XDG_CONFIG_HOME`）；可选 `<label>.json`（0600）存非敏感元数据（zhipu 的 org/project、备注）。写入原子（tmp → rename）。
- 令牌解析顺序：`--token` > 环境变量（`KIMI_WEB_TOKEN` / `ZHIPU_WEB_TOKEN`）> 令牌文件；前两者一次性使用、不落盘。
- **首登（无 device-flow）**：浏览器登录 → 打开配额页（kimi `https://www.kimi.com/settings/subscription?tab=quota`；zhipu `https://bigmodel.cn/coding-plan/personal/usage`）→ DevTools Network 复制请求的 `Authorization` 头值 → `echo <值> | quota <provider> token <label> --stdin`。
- **两家的可持续性不同（实测结论，2026-10-01）**：
  - **zhipu**：web JWT payload 无 `exp` 且不是合法 JSON，**长期有效**——存一次即可长期查询；信封 `code: 401` 是唯一失效信号，届时重贴。
  - **kimi**：配额端点只认 **15 分钟 Bearer**（`kimi-auth` cookie 被服务端按自身 exp 拒收，带全量浏览器上下文亦然）——只能**抓即查**（复制 Bearer → 15 分钟内查询）。可持续方案 = 二期观察网页端 Bearer 续期调用，若存在稳定的 renew/refresh connect 端点再加 `quota kimi refresh <label>`（不承诺）。
- CLI 解码 JWT payload（base64，不验签）取 `exp`：查询结果与 `list` 带 `tokenExpiresAt`（epoch ms）；剩余 <24h 标 `tokenStale: true`。zhipu 的 payload 永远解不出 exp，这两字段恒缺省。

## 端点规格与实测头集（2026-10-01 实测）

### kimi

`POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`，请求体 `{}`，**最小头集 = `Authorization: Bearer <JWT>` + `Content-Type: application/json` 两项**（缺 Content-Type 网关先于鉴权回 HTTP 415 空响应体；`connect-protocol-version`、`x-msh-*`、`x-language`、`r-timezone`、`origin`、`referer`、`user-agent` 全部可省）。

- 响应为直接 JSON（无信封）：`ratelimitCode5h` / `ratelimitCode7d` / `subscriptionBalance`。
- **`ratio` 可缺失**：全新窗口（当期零消费）只回 `enabled` + `resetTime`，规范化置 utilization 0。
- `resetTime` 语义 = 窗口内最近一次消费 + 窗长（与 zhipu 的 `nextResetTime` 同款），**不得当固定周期缓存**。
- 401（过期与无效同形）为真实 HTTP 状态，响应 message 可能夹带令牌物料——adapter 一律输出打码的 `token 已失效，请重新粘贴（401）`，不透传原文。

### zhipu / bigmodel.cn

`GET https://bigmodel.cn/api/monitor/usage/quota/limit`，**最小头 = `Authorization: <裸 JWT>` 一项**（服务端宽容接受 `Bearer ` 前缀，adapter 统一发裸 JWT；`Accept` / `Set-Language` / `bigmodel-organization` / `bigmodel-project` / `referer` / `user-agent` 个人账号均可省；org/project 做成可选透传，存账号元数据）。

- **HTTP 状态码不是错误信号**：无凭据/坏凭据都是 HTTP 200 + 信封错误（`code: 1001` / `code: 401`）。成功判定只看 `code === 200 && success === true`；`code: 401` → 打码的"凭据已失效"；其余非 200 code → 通用失败（msg 打码截断）。响应 `Content-Type` 带 charset 后缀，解析须容忍。
- **scope 映射**（滚动窗，行为学确认）：

  | unit | number | scope |
  |-----:|-------:|-------|
  | 3 | 5 | `5h` |
  | 6 | 1 | `7d` |
  | 其它 | — | `unknown`（`unit`/`number` 保留在 `raw`） |

- `nextResetTime`（epoch ms）= 最近一次消费 + 窗长：闲置时可停留在**过去**（含义 = 下次消费时才重置），adapter 原样透传为 `resetAt`，**消费方不得拿它排等待**。
- 字段透传：`usage` → `limit`（**会随套餐档变化**，不得当固定 limit 缓存）、`currentValue` → `used`、`remaining` 原样（与 `usage−currentValue` 可差 1，不重算）；`percentage`/100 → `utilization`（越界收敛到 [0,1]）；`level` 为套餐档字符串（"pro"/"max" 均观测到）。

## 安全注意（C4 精神）

- 令牌/cookie 原文不进代码、文档、测试、日志、错误信息；`list` 与 token 存储回显只给掩码指纹（前 4 + 后 4，如 `eyJ…X5uT`）与解码出的 exp。
- 错误信息一律打码：服务端 message 中的长凭据形片段替换为 `***` 并截断；网络错误只报"网络错误/查询超时"，不透传底层异常。
- 令牌文件 0600、目录 0700；解析顺序中 `--token`/env 用完即弃。不要把令牌贴进 shell 历史——用 `--stdin`。

## 开发

```sh
bun install            # 仓库根目录，链接 workspace
bun test               # 本包目录；fetch 可注入，测试全部使用手写 double，不触网
bun turbo typecheck    # 或 --filter=@opencode-ai/quota
```

CI 已注册 `@opencode-ai/quota#test`（turbo.json）。库用法：`import { queryQuota, listAccounts } from "@opencode-ai/quota"`。
