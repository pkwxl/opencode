# 计划：opencode `packages/quota` 独立限额查询模块（kimi + zhipu，多账号）

状态：**已评审通过，实施延后**（本文件即实施时的唯一 spec，未来会话可直接按 §8 清单动工）。
拟稿：2026-09-30。来源：两份浏览器抓包（kimi 2026-09-29，zhipu 2026-09-30；抓包中的令牌均已过期，**不得**写入任何文件或复用）。

## 1. 目标

在 opencode monorepo 中新增一个**独立模块**，在线查询模型服务商账号的配额/限额状态（kimi：5 小时限额、周限额、月度订阅余额；zhipu/bigmodel：coding-plan 的分档限额），为"切换模型 / 切换账号"提供数据依据。查询是 advisory-only：模块只产出数据，**永不自动触发切换**。

## 2. 范围与硬约束

- 新包落在 `opencode/packages/quota/`（`@opencode-ai/quota`，private）。`packages/auto-core` 正在整体重构：**零改动**（`packages/auto`、`opencode.json`、根 tsconfig 同样不动）；新包**零依赖 auto-core**，只用 Bun 标准库。
- 对齐 auto-core 既有词汇便于将来接线：窗口 scope 用 `5h` / `7d`，字段名用 `utilization` / `resetAt`（epoch ms）。"月限额"是订阅余额不是限流窗口，单列 `subscription`，不冒充 scope。
- 依据 auto-core 设计文档 `packages/auto-core/plans/0057-session-exception-and-quota-window-design.md`：§9 曾把"供应商配额端点探测"推迟（卡在 C4 凭据约束：凭据值只进子进程环境）。本模块作为**独立进程/独立包**绕开该约束，继承 §9 的契约精神：advisory、失败即"无答案"、超时即"无答案"；§11 item 10（观测不得 preempt 调度）同样适用。将来接入 `.auto/windows.json` 时用其预留的 `WindowSource = "probe"`。
- 安全纪律（C4 精神）：令牌/Cookie 原文不进代码、文档、测试、日志、错误信息；错误一律打码；本计划文档本身不含任何凭据。
- `opencode/` 是嵌套 git 仓库（分支 auto-core），**不执行任何 git 提交类命令**，由 DRIVER 统一提交。
- 已定决策：通用 `packages/quota`（kimi、zhipu 为前两个 adapter）；令牌来源 = `--token`/env + 0600 本地令牌文件；CLI 输出**仅 JSON**；支持**同一供应商多账号**。

## 3. 端点规格

> 实测状态：**两家均已完成（2026-10-01，两轮）**——最小头集、错误形态、窗口语义见各节实测结论；实施时同步进包 README。

### 3.1 kimi（www.kimi.com）

- `POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats`
- 请求体：`{}`（Content-Type: application/json；Connect-RPC，抓包显示 connect-protocol-version: 1）。
- 凭据头：`Authorization: Bearer <JWT>`。抓包中的 Bearer 是 `iss=account` 的 access JWT，有效期仅 **15 分钟**；另有 `kimi-auth` cookie（`iss=user-center`，约 **30 天**）是长命会话凭据——哪个（或哪些组合）能直接查本端点由实测决定，优先引导存长命凭据。
- 需实测是否必需：`x-msh-device-id`、`x-msh-platform: web`、`x-msh-session-id`、`x-language`、`r-timezone` 等。
- 响应（直接 JSON，无信封）：

```json
{
  "ratelimitCode5h": { "ratio": 0.3472, "enabled": true, "resetTime": "2026-09-29T10:30:32.618725Z" },
  "ratelimitCode7d": { "ratio": 0.4811, "enabled": true, "resetTime": "2026-10-05T00:30:32.618725Z" },
  "subscriptionBalance": {
    "id": "…", "feature": "FEATURE_OMNI", "type": "SUBSCRIPTION", "unit": "UNIT_CREDIT",
    "amountUsedRatio": 0.5937, "kimiCodeUsedRatio": 0.5756,
    "expireTime": "2026-10-10T00:00:00Z", "domain": "DOMAIN_NEXUS"
  }
}
```

- 字段语义：`ratelimitCode5h` → scope `5h`；`ratelimitCode7d` → scope `7d`；`ratio` 即 utilization；`resetTime` 是 ISO 带微秒字符串（`Date.parse` 可解析，注意截断精度）；`subscriptionBalance` → 月度订阅（`amountUsedRatio`/`kimiCodeUsedRatio`/`expireTime`）。
- 抓包响应头参考：200，`Content-Type: application/json`，gzip。
- **实测结论（2026-10-01，两轮：第一轮令牌过期仅得错误形态，第二轮新鲜 Bearer 实测通过）**：
  - **最小头集 = `Authorization: Bearer <JWT>` + `Content-Type: application/json` 两项**。`connect-protocol-version` 可省（有/无均 200）；`x-msh-*`、`x-language`、`r-timezone`、`origin`、`referer`、`user-agent` 全部可省。缺 `Content-Type` 时网关先于鉴权返回 HTTP 415（空 body），必带。
  - **`kimi-auth` cookie 查不了本端点**：单独发、带全量浏览器头（含 `x-msh-device-id`/`x-msh-session-id`/`x-traffic-id`）、乃至整份 cookie jar 均复现 401 `REASON_INVALID_AUTH_TOKEN`——浏览器现持那枚 exp 2026-07-29/30，服务端照 exp 拒收。本端点唯一有效凭据类 = 15 分钟 Bearer；"存长命凭据"对 kimi 不成立，v1 只能抓即查（复制 Bearer → 15 分钟内查询），可持续方案 = 二期观察网页端的 Bearer 续期调用（§4 末段）。
  - Bearer 时效精确 900s（iat→exp）；第一轮探测晚于 exp 95s 即全数 401。401 形态（过期与无效同形）：HTTP 401 + `{"code":"unauthenticated","message":"invalid user token: …","details":[{"type":"common.error.v1.ErrorDetail","value":"<base64>","debug":{"reason":"REASON_INVALID_AUTH_TOKEN","localizedMessage":{"locale":"en-US|zh-CN","message":"…"}}}]}`。adapter 对 401 一律输出打码的"凭据已失效，请重新粘贴"，不透传 message 原文。
  - 响应确认（200 直接 JSON，无信封）：`ratelimitCode5h`/`ratelimitCode7d` 的 **`ratio` 可缺失**——实测全新 5h 窗（当期零消费）只回 `enabled` + `resetTime`；规范化把缺失 ratio 置 utilization 0。`resetTime` 语义与 zhipu 的 `nextResetTime` 同款 = 窗口内最近一次消费 + 窗长（实测 5h 边界 = 当日消费 + 5h、7d 边界 = 一周前消费 + 7d），同样不得当固定周期缓存。`subscriptionBalance` 字段齐全（amountUsedRatio/kimiCodeUsedRatio/expireTime/domain），expireTime 即订阅到期。

### 3.2 zhipu / bigmodel.cn

- `GET https://bigmodel.cn/api/monitor/usage/quota/limit`
- 凭据头：`Authorization: <JWT>`（**裸 JWT，无 `Bearer` 前缀**——与抓包的 `bigmodel_token_production` cookie 同值）。
- 可选头：`Bigmodel-Organization: org-…`、`Bigmodel-Project: proj-…`（多组织/项目账号需要，做成可选透传并存进账号元数据）；`Set-Language: zh`；`Accept: application/json`。
- 来源页面：`https://bigmodel.cn/coding-plan/personal/usage`。
- 响应信封：

```json
{
  "code": 200, "msg": "操作成功", "success": true,
  "data": {
    "level": "pro",
    "limits": [
      { "type": "CREDIT_LIMIT", "unit": 3, "number": 5, "usage": 12000, "currentValue": 852, "remaining": 11147, "percentage": 7,  "nextResetTime": 1790762886638 },
      { "type": "CREDIT_LIMIT", "unit": 6, "number": 1, "usage": 60000, "currentValue": 51461, "remaining": 8538, "percentage": 85, "nextResetTime": 1790821003984 }
    ]
  }
}
```

- 成功判定：`code === 200 && success === true`；其余 code 视为该账号查询失败（把 `msg` 打码后放进 error）。
- 字段语义：`percentage`（0-100 整数）→ `utilization = percentage / 100`（亦可 `currentValue / usage` 交叉校验）；`nextResetTime` 已是 epoch ms；`usage`=总额、`currentValue`=已用、`remaining`=剩余，透传为 `limit`/`used`/`remaining`。
- **窗口语义：已实测确认（2026-10-01，level=max 单账号）**，见下方实测结论；未知档位仍按 delta 规则兜底，吃不准一律 `unknown` 并把 `unit/number` 保留在 `raw` 里。
- **实测结论（2026-10-01）**：
  - 最小头集 = `Authorization: <裸 JWT>` 单独一项即 200；`Accept`/`Set-Language`/`bigmodel-organization`/`bigmodel-project`/`referer`/`user-agent` 全部可省（org/project 填非法值也被忽略，个人账号）。`Bearer ` 前缀服务端同样接受（宽容），adapter 统一按裸 JWT 发送。
  - **HTTP 状态码不是错误信号**：无 Authorization 头 → HTTP 200 + `{"code":1001,"success":false,"msg":"Header中未收到Authorization参数…"}`；伪令牌 → HTTP 200 + `{"code":401,"success":false,"msg":"令牌已过期或验证不正确"}`。成功判定只看信封 `code===200 && success===true`；信封 `code:401` → 打码的"凭据已失效，请重新粘贴"，其余非 200 code → 通用失败（msg 打码）。响应头 `Content-Type: application/json;charset=UTF-8`，解析须容忍 charset 后缀。
  - scope 映射：`(unit:3, number:5)` → `5h`、`(unit:6, number:1)` → `7d`，均滚动窗。行为学确认：unit=6 行在其 `nextResetTime` 指定时刻整点重置（pct 85→23、used 骤降），unit=3 行边界随消费在小时尺度推进。
  - `nextResetTime` = 最近一次消费时刻 + 窗口长度：只在发生消费时推进，窗口闲置时可停留在**过去**（实测见某行 nextResetTime 落后当下 ~15h 而窗口仍在计用）。adapter 不得把过去的 nextResetTime 当作未来等待时刻——视为"下次消费时才重置"，scope 照映射表归类。
  - 字段语义修正：`percentage` = `currentValue/usage` 四舍五入；`remaining` 与 `usage−currentValue` 可差 1（舍入），原样透传不重算；`usage` 是当期额度且**会变**（同一账号一天内随 pro→max 套餐升级观测到 12000→28000、60000→140000），不得当固定 limit 缓存；`level` 为套餐档字符串（"pro"、"max" 均观测到）。
  - JWT 形态：payload **无 `exp`**（仅 user_type/user_channel/user_id/user_key/customer_id/username），且含一个被控制字节替换的逗号、**不是合法 JSON**——exp 解码必须软失败；zhipu 的 `tokenExpiresAt`/`tokenStale` 恒空，信封 `code:401` 是唯一失效信号。

## 4. 凭据与登录状态设计

两家都没有公开的 OAuth device-flow 或 refresh 端点，凭据即网页会话 JWT。设计：

- **多账号存储**：`~/.config/quota/<provider>/<label>.token`（0600），`label` 用户自取（默认 `default`）；可选伴随 `<label>.json`（0600）存非敏感元数据（zhipu 的 org/project、备注）。目录尊重 `XDG_CONFIG_HOME`。
- **令牌解析顺序**：CLI `--token` > env（`KIMI_WEB_TOKEN` / `ZHIPU_WEB_TOKEN`）> 令牌文件。前两者一次性使用，不落盘。
- **首登（无 device-flow）**：浏览器登录 → 打开配额页（kimi `https://www.kimi.com/settings/subscription?tab=quota`；zhipu `https://bigmodel.cn/coding-plan/personal/usage`）→ DevTools Network 复制 Authorization 头值 → `echo <值> | quota <provider> token <label> --stdin`。存储时回显打码（掩码指纹 + 解码出的 exp）。实测修订（2026-10-01）：kimi 的 `kimi-auth` cookie 查不了配额端点（§3.1），**kimi 只能存 15 分钟 Bearer（抓即查）**，长命凭据仅 zhipu 成立（其 web JWT 无 exp，长期有效）；kimi 的可持续方案 = 二期观察网页端 Bearer 续期调用（见下段）。
- **保持登录**：CLI 解码 JWT payload（base64，**不验签**）取 `exp`：`list` 与每次查询结果带 `tokenExpiresAt`；剩余 <24h 标 `tokenStale: true`；401 时输出明确的"token 已失效，请重新粘贴"JSON 错误。v1 策略 = 存"最长命的有效凭据"、过期手动重贴；实施时顺带观察网页端在 access token 过期后的续期调用，若存在稳定可模仿的 renew/refresh connect 端点，二期加 `quota <provider> refresh <label>`（可选，不承诺）。
- 不做：读浏览器 cookie 库、自动化无头登录、验证码/扫码流程。

## 5. CLI 规格

- 入口：`src/cli.ts`（bun 直跑；可加 `bin`）。输出**仅 JSON**：默认紧凑一行，`--pretty` 缩进两格；成功/失败都写 stdout（失败另置退出码），无其它人类可读输出。
- 命令：
  - `quota <provider>`（或 `quota <provider> query`）：查询该 provider **全部**已存账号。输出 `{ ok: true, value: { provider, results: [ { account, ok: true, value: QuotaSnapshot } | { account, ok: false, error } ] } }`——**每账号独立成败，单账号失败不拖垮整批**；一个账号都没存时按用法错误处理。`--account <label>` 只查单个；`--token <值>` 临时凭据（label 记 `adhoc`）。
  - `quota <provider> list`：列已存账号，只给 `label`、掩码指纹（如 `eyJ…X5uT` 前后各 4 字符）、`tokenExpiresAt`、`tokenStale`、元数据；无令牌原文。
  - `quota <provider> token <label> <值 | --stdin>`：添加/更新；`--org/--project`（zhipu）随元数据一并存。
  - `quota <provider> token <label> --clear`：删除。
- 退出码：0 成功（含批查中部分账号失败）；1 查询失败（网络/凭据/端点）；2 用法错误。
- provider id：`kimi`、`zhipu`。

## 6. 类型与实现规格

- `Result<T> = { ok: true; value: T } | { ok: false; error: string; status?: number }`（与 auto-core `agent/opencode/client.ts` 的 settle 形状一致）。
- `QuotaWindow { scope: "5h" | "7d" | "day" | "unknown"; utilization: number; resetAt?: number; enabled?: boolean; used?: number; limit?: number; remaining?: number; raw?: Record<string, unknown> }`
- `QuotaSnapshot { provider: "kimi" | "zhipu"; account: string; fetchedAt: number; tokenExpiresAt?: number; tokenStale?: boolean; windows: QuotaWindow[]; level?: string; subscription?: { amountUsedRatio: number; kimiCodeUsedRatio?: number; expireAt?: number; unit?: string; feature?: string; domain?: string } }`
- adapter 规格：每家一个 `src/kimi.ts` / `src/zhipu.ts`，fetch **可注入**（测试用 double），10s 超时（`AbortSignal.timeout` 组合），无重试（advisory：失败即无答案）；规范化宽容（字段缺失/类型不对 → 跳过该窗口或置 `unknown`，绝不抛异常穿透）。
- `src/store.ts`：读/写/删 0600 令牌文件与元数据；写入原子（tmp → rename，仿 auto-core quota-windows）。
- `src/index.ts`：导出 `queryQuota(provider, opts)` / `listAccounts(provider)` 等公共 API，供将来其它包按 `"@opencode-ai/quota"` 引用。

## 7. 工程接线与测试

- 仿 `packages/codemode` 模板：`package.json`（`private: true`、`type: module`、`exports: { ".": "./src/index.ts" }`、`scripts: { typecheck: "tsgo --noEmit", test: "bun test" }`、devDeps 三件套 `@tsconfig/bun` / `@types/bun` / `@typescript/native-preview` 均 `catalog:`）；`tsconfig.json` extends `@tsconfig/bun`。
- 根目录 `bun install` 链接 workspace（workspaces glob `packages/*` 自动发现，无需改根 package.json）；`bun turbo typecheck` 自动覆盖；`turbo.json` 增加一条 `"@opencode-ai/quota#test"` 让 CI（`bun turbo test`）跑到。
- 测试（`test/*.test.ts`，`bun:test`，手写 fetch double，不用 MSW）：两 adapter 各自的成功 / 401 / 信封 code≠200 / 畸形 JSON / 超时；规范化边界（缺字段、微秒 ISO、percentage 越界）；store（读写删、0600、损坏文件容忍）；CLI（多账号批查、单账号失败隔离、list 不泄露原文、退出码）。

## 8. 实施步骤（延后，届时按序执行）

1. curl 实测：**已完成（2026-10-01，两轮）**。zhipu 结论回填 §3.2，kimi 结论回填 §3.1（最小头集 = Bearer + Content-Type；`kimi-auth` cookie 无效；`ratio` 可缺失）。实施时把结论同步进包 README。
2. 建包骨架 + 根 `bun install`。
3. `src/types.ts` + 两 adapter + 规范化 + 单测。
4. `src/store.ts`（多账号）+ 单测。
5. `src/cli.ts`（list / token / query）+ 单测。
6. `turbo.json` CI 项。
7. 验证：`bun turbo typecheck` 全绿；`cd opencode/packages/quota && bun test` 全绿；有有效令牌时对两家真实账号各实查一次（多账号至少两枚）。
8. 包内 `README.md`：端点与字段语义、实测头集合、scope 映射表、首登/保持登录指引、安全注意、与 0057 §9 的关系。

## 9. 明确不做 / 后续方向

- 不做：改 `packages/auto-core` / `packages/auto` / `opencode.json` / 根 tsconfig；与 `.auto/windows.json`、路由、probe 循环集成（重构后再接，接入点 = `WindowSource: "probe"`）；自动切换决策；令牌自动续期（二期视实测结论）。
- 后续方向：接入 auto-core 重构后的路由/账号切换（本模块输出即"哪家的哪个账号还打得动"的依据）；更多 provider adapter（OpenRouter/DeepSeek/Anthropic 等，0057 §9/F14/F15 已有调研线索）。

## 10. 输出示例

`quota kimi --pretty`：

```json
{
  "ok": true,
  "value": {
    "provider": "kimi",
    "results": [
      {
        "account": "main",
        "ok": true,
        "value": {
          "provider": "kimi",
          "account": "main",
          "fetchedAt": 1791072000000,
          "tokenExpiresAt": 1791158400000,
          "tokenStale": false,
          "windows": [
            { "scope": "5h", "utilization": 0.3472, "resetAt": 1790737832618, "enabled": true },
            { "scope": "7d", "utilization": 0.4811, "resetAt": 1791251432618, "enabled": true }
          ],
          "subscription": { "amountUsedRatio": 0.5937, "kimiCodeUsedRatio": 0.5756, "expireAt": 1760054400000, "unit": "UNIT_CREDIT", "feature": "FEATURE_OMNI", "domain": "DOMAIN_NEXUS" }
        }
      },
      { "account": "backup", "ok": false, "error": "token 已失效，请重新粘贴（401）", "status": 401 }
    ]
  }
}
```

`quota zhipu --pretty`（单账号时 `results` 同结构）：

```json
{
  "ok": true,
  "value": {
    "provider": "zhipu",
    "results": [
      {
        "account": "default",
        "ok": true,
        "value": {
          "provider": "zhipu",
          "account": "default",
          "fetchedAt": 1791072000000,
          "level": "pro",
          "windows": [
            { "scope": "5h", "utilization": 0.07, "resetAt": 1790762886638, "used": 852, "limit": 12000, "remaining": 11147 },
            { "scope": "7d", "utilization": 0.85, "resetAt": 1790821003984, "used": 51461, "limit": 60000, "remaining": 8538 }
          ]
        }
      }
    ]
  }
}
```
