# auto-core 全量代码审查报告(2026-09-17)

范围:`packages/auto-core/src` 全部 53 个文件(约 1.4 万行,auto-core 分支)。
方法:6 组并行深审(主循环/git/会话恢复/规划校验/配置开关/基础设施)+ 高危项人工逐条复核(标 ✓ 为已亲验源码)。

总体评价:工程质量高——原子写、宽容解析、状态机幂等恢复、注释与设计文档互链密度均属上乘。残留风险集中在三类系统性倾向:**文本协议解析过宽、进程/超时边界、git 命令失败被吞成"干净"**。

---

## High(建议近期修复)

### H1. verify 超时只杀外层 bash,被测脚本成孤儿继续写工作区 ✓(两组独立发现)

`verify.ts:94-105` + `testrun.ts:266`。非可执行脚本走 `bash -c 'bash "$0" …'`,`proc.kill()` 只杀外层;内层脚本被孤儿化继续运行并改写工作区/输出文件——而这条恰是交接定版脚本的主路径(`Bun.write` 物化的 `tmp/test.<n>.sh` 恒 0644)。后果:已判 124 的测试仍在跑,撞下一单元 clean 门禁或污染判定输入;下一轮 verify 还会 truncate 孤儿仍在写的同一输出文件。

修复:独立进程组 + kill 负 pid;或 `bash "$0"` 分支改 `exec bash "$0"`;或对 override 脚本补 chmod +x。

### H2. `parseVerdict` 全文取首个匹配且未锚定,可假通过 ✓

`review.ts:384-392`:`/结论[:：]\s*(通过|差距[^\n]*|重验[^\n]*)/` 在全文任意位置取**第一个**匹配,`通过` 还是前缀匹配("结论: 通过标准是…" 也命中)。判定会话正文若先引用判定标准、末行才写真实"结论: 差距 …",会被判 pass 直接 `markDone`(review.ts:150)。对照 `final.ts:69` 的 `parseConclusion` 是倒序取末行 + 行首锚定 + 整值相等——同族两口径,review 侧是疏漏。**唯一能直接颠覆完成判定正确性的缺陷。**

修复:对齐 final.ts(倒序扫描、`^结论[:：]` 行首锚定、通过须整行相等);`差距` 空描述按解析失败处理。

### H3. `handoffStatus` 同款未锚定,半截交接可被误判已收口 ✓

`handover.ts:99`:`/状态[:：]\s*(继续|完成)/` 全文任意位置匹配;提示词本身含"状态: 继续"指令,AI 复述即中招。execute.ts:57/124/363/454 与 runner.ts:186 的交接判定、严格恢复写核全部经此函数——半截文档被误判"已写完的交接",绕过写核凭不完整交接续跑甚至直接勾选子任务。

修复:行首锚定(`/^\s*状态[:：]\s*(继续|完成)\s*$/m`)或取最后非空行判定。

### H4. 错误分类器子串正则误伤 + `isRetryable===false` 一刀切归 quota ✓(两组独立发现)

`chain.ts:180,183,200`:

- `QUOTA_RE` 的 `credit` 命中 "credentials"、`balance` 命中 "load balancer"(已实测)——认证/网关错误被误归 quota,且 quota 在 session.ts:329 排在重试阶梯**之前**直接切换降级模型,本可自愈的瞬时抖动烧掉降级候选;
- `TRANSIENT_RE` 裸数字 `500|502|503|504` 命中 "15000 rows" 等任意报文(后果较轻,污染归类报表);
- `isRetryable === false` 一律归 quota——确定性 4xx(如 driver 自身构造的 400、SDK 参数错误)会逐条烧完降级候选后进入 awaitRecovery 无限等待,永挂而非暴露。

修复:词边界/语境限定(`\bcredit\b` 且排除 credentials;`insufficient balance` 等);数字改为 `\b(500|502|503|504)\b` 或匹配 statusCode 字段;`isRetryable===false` 须叠加配额证据(402 或配额文案)才归 quota,否则单列 nonRetryable 跳过降级环。

### H5. 嵌于大仓库子目录时永不写 .gitignore,`.auto/` 被提交并自锁 clean 门禁 ✓

`gitignore.ts:24`:判据是"无 .gitignore 且无本目录 .git 才空转",但 `git.ts` 的 repoRoots/commitTree 明确支持大仓库子树场景(`.git` 在上级、本目录往往无 .gitignore)。后果:`commitTree` 的 `git add -A -- .` 把 `.auto/`(stats.json、progress.json、handover.json)与 `tmp/` 提交进用户父仓库;且 stats 心跳(30s)持续改写已跟踪的 stats.json → 每单元 beginUnit 都被自己制造的脏区阻塞。

修复:判据改为 `git rev-parse --is-inside-work-tree`(与 repoRoots 同口径),在 work tree 内即补写 .gitignore。

### H6. log.ts 对已关闭的 readline 调 `prompt()` 崩溃 ✓

`log.ts:53-60` + `interactive.ts:107-111`:stdin 关闭(管道耗尽/Ctrl+D/终端断开)时 `rl.on("close")` 只置内部 `dead`,未 `setInput(undefined)`;log.ts 模块级 `rl` 引用继续存活,此后任何一条日志触发 `rl.prompt(true)` 抛 `ERR_USE_AFTER_CLOSE`,可打穿主流程(interactive.ts 的 settle 有 dead 守卫,log.ts 侧漏了对称清理)。

修复:close 时同步 `setInput(undefined)`,或 log.ts 的 prompt 包 try/catch。

### H7. 半开探针解救不了悬挂的同步 POST(设计文档 §4.4 已记为取舍,但收益打折)

`watch.ts:563-576` + `attempt.ts:216-234` + `server.ts:33`:探针 ~2×idleTime 判半开后 abort 的是 SSE 通道;阻塞的 `client.session.prompt`(v2 同步 POST)走另一条已半开的连接,watch 错误结果无人消费,重试阶梯要等 TURN_TIMEOUT(2h)才启动——比 T-068 事故现场(44 分钟)更久。探针实际收益只剩提前释放 SSE 连接配额。

修复:prompt promise 与 watching 竞速(watching 带错误先回即取消 POST),或 POST 挂 AbortSignal 随半开判定一并 abort。

---

## Medium

### M1. git 命令失败被吞成"干净/无外部提交" ✓(倾向确认)

`git.ts:214-220`(foreignCommits 不查 `git log` 退出码:基线 SHA 失效/仓库损坏 → 返回 0 个外部提交,unitViolations/baselineIntact/rollbackUnit 全部误判)、`git.ts:163-164`(unitViolations 里 rev-parse 失败 `head===undefined` 直接 continue,与 baselineIntact:234-238 报问题的口径不一致)、`git.ts:442-460`(hasChanges/statusEntries 非零退出返回 false/[] → commitTree 跳过提交、beginUnit 判干净)。与"宁阻塞不误放"的提交边界设计意图相反。

修复:把"命令失败"与"结果为空"区分开,失败一律按脏/有外部提交的保守方向处置。

### M2. 中断恢复补账的 commitTree 不查返回值 ✓

`loop-phase.ts:402-407`:交接中断恢复路径(归档已在而台账缺行)`await commitTree(...)` 不检查 settled.ok,与 handoverPhase:288-298 同型调用(失败即退出 2)口径不一。若本阶段是最后一个,下轮路由直接 complete → **退出码 0 报"全部完成"而归档/台账改动未提交**,违反"提交是完成条件"。

修复:同款检查 settled.ok,失败打印清单并 return 2。

### M3. H2/H3 交接恢复支不回同步 handovers 计数,撞号覆盖归档

`exec-session.ts:135-146`(对照 73、205-221):closedHandovers 对未收口记录返回 `record.n - 1`;H2-!hasArchived 支正确 `handovers++`,但 H2-hasArchived 支与 H3 支只补写记录,handovers 停在 n-1。同次运行下次交接复用号 n,`archiveHandoff` 的 rename 覆盖已落账的 testhandoff-<n>.md,违背"归档续号取两侧最大、不覆盖"不变量。

修复:两条支路确定 closedN 后补 `handovers = Math.max(handovers, closedN)`。

### M4. 无提交仓库回滚必失败,恢复死循环

`git.ts:288-304`:无提交仓库 `git stash push` 退出 1(实测),AI 期间 `git init` 的新嵌套仓库只要有未提交改动,rollbackUnit 第①步必失败 → dirty 交人工 → 死循环。另 `!sha && head` 分支跳过 reset 后日志仍宣称"从干净基线重做",但本单元 driver 提交全留在历史里。

修复:无提交仓库改用"移入临时目录/git clean 前备份";空基线已有提交的仓库如实上报无法保真。

### M5. 外部 server 健康检查无超时

`server.ts:132-138`:defaultConnect 用裸 `fetch(/api/health)`,无 timeoutFetch/AbortSignal;目标地址半开/黑洞时 manage() 启动阶段永久悬挂(此时探针、TURN_TIMEOUT 均未就位)。

修复:健康检查加 `AbortSignal.timeout(REQUEST_TIMEOUT_MS)`。

### M6. runSession catch-all 把 driver 自身编程错误送进无限恢复环

`session.ts:311-321`(配合 253-256):attempt 抛出的任何异常(含 TypeError 等确定性 bug)都包成"会话错误:"进重试阶梯与 awaitRecovery;探测会话走同一代码路径同样抛错 → 永远判未恢复 → 无限等待,每 30 分钟白烧一个探测会话,真实故障被掩盖。

修复:只包装已知 SDK/网络错误形态,其余异常原样上抛。

### M7. wrapup 形检门禁无法区分"本次产出"与存量 report.md

`wrapup.ts:23-28,48-76`:reportProblems 只做存在性+形检,无会话前快照/mtime 比对。修复轮收尾与任务回退重跑场景中,旧 report.md 已提交在案,本次收尾会话零落盘照样过检——正是 session-boundary-hardening 要堵的"零落盘自然结束"形态(understand/decompose 有"已存在即跳过"前置路径,wrapup 没有)。

修复:会话前记录(或删除)旧 report.md,门禁要求文件在本会话期间被重写过(mtime/哈希/基线 diff 任一)。

### M8. PROTOCOL_MARKERS 未覆盖三份执行模板,testhandoff 排他条款可被覆盖静默移除

`template.ts:98-119`:§L(2026-09-17 防伪修订)在 subtask/fix/whole 三模板补的"不得自行创建 testhandoff-<n>.md"排他条款不在 PROTOCOL_MARKERS 中,目标目录 `.opencode/auto/prompts/subtask.md` 覆盖时删掉该条款无任何装载期校验。

修复:为三份模板登记标记(注意条款在 `{{#if handoverTest}}` 内,校验需容忍未启用场景)。

### M9. 解析器静默吞掉近似任务标题

`plan.ts:42,56-60`:HEADING 不匹配的行直接跳过——状态大小写错误(`[Done]`)、状态拼写错误、缺冒号等形态一律静默丢失该任务,next() 径直跳过无任何告警;与 duplicate id 抛错(plan.ts:62)的严格口径不一致。

修复:对 `/^## T-[\w-]+/` 命中但 HEADING 不命中的行抛解析错误。

### M10. appendTask 不防正文含 `## ` 行,可注入幽灵任务

`plan.ts:295-302`:终审提案正文(AI 产出)原样写入 PLAN.md;正文含 `## 背景` 之类行会截断该任务正文,恰含 HEADING 形态行(如 `## T-F9: … [pending]`)则注入会被主循环真实执行的幽灵任务。

修复:appendTask 拒绝或转义 body 中以 `## ` 开头的行。

### M11. agents-block 全文空行折叠破坏用户内容

`agents-block.ts:72`:`\n{3,} → \n\n` 折叠在判定块是否变化之前无条件作用于整个 AGENTS.md(含代码块内有意保留的连续空行);removePointer(114、119)的 `.trim()` 同理剥掉首尾空白。

修复:折叠只应用于摘除 legacy 块后的局部接缝,或不做全文规范化。

### M12. refcheck 围栏开关不区分 ``` 与 ~~~

`refcheck.ts:31`:任一方围栏行翻转同一 fenced 状态;``` 内嵌 ~~~ 示例(markdown 教程常见)导致状态错位,代码块内 `path.ts:12` 被误扫为引用 → 误报进 invalid-refs.md → verify 拦进修复轮。

修复:记录开围栏字符类型,同类型才关闭(CommonMark 语义)。

### M13. 模型引用只校验含 `/`

`chain.ts:155-158` + `switches.ts:198/226` + `interactive.ts:80`:`splitModel("prov/")` 产出空 modelID、`"/model"` 产出空 providerID,三处校验只查 `includes("/")`,坏值过严格校验后运行期才炸。

修复:统一 validModelRef 帮助函数(`/` 两侧均非空),三处共用。

---

## Low(择要)

- `attempt.ts:301-304`:可重试错误还原遗漏 `chain.pct`,复用启发式口径不自洽。
- `runner.ts:300`:"会话错误:"分支自 2026-09-16 改造后成死代码(session.ts:321 对所有该类前缀进无限等待环,绝不返回),注释失真。
- 非原子写漏网:`current.ts:30-32`(且写失败时 reprotect 被跳过)、`review.ts:294-295`(checkPlanEdit 越权还原直写 PLAN.md)、`resume.ts:122-124`(progress.json)、`handover.ts:51-53`(handover.json)。其余写路径均 tmp+rename。
- `loop-preflight.ts:174-225`:protect 后的 exit-2 出口遗留只读现场,且 SIGINT 处理器在 preflight 返回后才注册。
- `loop.ts:68 / loop-phase.ts:334`:PLAN.md 解析异常无兜底,人工改坏 PLAN 时堆栈崩溃而非用法错误。
- `loop-phase.ts:385-390`:阶段字母不匹配的陈旧 openStep 永不清理,逐轮重复告警。
- `testrun.ts:130,211`:任务 id 子串匹配(T-001 撞 docs/T-0010/);testHandoffExists 与 cleanTestHandoffs 的 glob 深度不一致,深层遗留交接文档永远清不掉却永久否决会话复用。
- `plan.ts:85,187`:attempts 被人工改成非数字后 NaN 永久写回(NaN+1 循环污染)。
- `plan.ts:170-171`:声明产物路径无目录约束,`../../etc/x.md`、绝对路径均可,形检口径出现目录外盲区。
- `plan.ts:127,133-167`:声明含未闭合括号时路径粘入章节文字必然 blocked 且 AI 无法自愈;`产出:` 前置断言要求空白/行首,"，产出:…" 漏检(D4 fail-open)。
- `reset.ts:63-115`:plan/apply 间 TOCTOU,确认期间文件被改会被误删(apply 应复核判据)。
- `stats.ts:555,663`:等待与并行会话交叉时开放段互相覆盖(仅 --early 路径);`stats.ts:231,519-526`:无会话期间无心跳,超长测试/构建墙钟被 MAX_TICK 钳到 30 分钟。
- `switches.ts:189-232`:模型条目表/候选表不去首尾空白;`switches.ts:277-284`:RECOVERY_WAIT=0 通过校验形成探测热循环。
- `config.ts:121-123`:legacy .auto/config.json 坏 JSON 静默吞掉(新文件严格失败,两档口径)。
- `template.ts:187-197`:registerTemplate 在 usePromptLibrary 之后调用会即时压低目标目录覆盖优先级(既定调用序无碍,无断言防护)。
- `prompt.ts:452,471`:renderKnowledge/renderPriorKnowledge 调 modeCtx 不传 verify,自定义模式 `{{#if verify}}` 条件段静默丢失(内置模板无影响)。
- `phases.ts:249-264`:currentRound 不校验条目是否为目录,名为 R-05 的文件会使后续 mkdir 裸错;`phases.ts:160-167`:空台账文件丢头部注释。
- `mode.ts:47 / template.ts:154`:覆盖目录里名为 *.md 的子目录以 EISDIR 裸错。
- `refcheck.ts:54`:文件名中 `@<7-40位hex>` 一律当版本标记剥离(无行号锚时也生效)→ missing 误报;`refcheck.ts:35`:"历史"豁免子串过宽;`refcheck.ts:285-289`:同路径多引用时 beyond-eof 误伤无行号锚的裸引用。
- `resolve.ts:142-146`:代答归一化互为子串过度配对,⚑ 高亮漏点名(少报方向)。
- `agents-block.ts:76-86`:多个标准块并存时不去重,重复注入。
- `git.ts:466`:identityArgs 只查 user.email,email 已配而 name 缺失的仓库提交必失败;`git.ts:70-86`:嵌套仓库失败后外层 add 无内容可暂存产生误导性 "nothing to commit" failure。
- `protect.ts:23,28`:对不存在文件静默 no-op,unprotect 一律 0o644 覆盖原权限位。
- `knowledge.ts:196`:existingRoundDoc 读文件无 .catch(TOCTOU/目录同名时崩溃),同族其他读点均兜底。
- `doccheck.ts:36-45`:D6 豁免按纯文件名判定粒度过宽(任意深度 PLAN.md/CURRENT.md 都豁免);MIN_DOC_CHARS 对修改既有小文件整体生效。
- `watch.ts:300,313,522`:提前结算口只看 errorInfo.isRetryable(可被后续事件覆盖回 true),绕过粘性 retryable 变量,与收口口(580)口径不一致。
- `exec-session.ts:114-118`:H1 定版会话失效的冷启动回落遗留半截 testhandoff.md,二次中断后存量兼容支会把它补状态行当已收口提交(窗口窄)。
- `opts.ts:56`:注释仍把已退役的 `--commit false` 描述为活功能;包级 AGENTS.md 退出码清单漏了 3(loop.ts:116 实际返回 3,exit.ts 注释一致,是文档遗漏)。

---

## 修复优先级建议

1. **H2/H3**(文本协议判定)——直接影响完成判定正确性,改动小(锚定+倒序);
2. **H1**(孤儿进程)——每次交接超时都在制造现场;
3. **H4**(错误分类)——决定故障是自愈还是无限挂起;
4. **H5/H6**——特定环境下确定性故障;
5. **M1/M2** 归入"提交边界宁阻塞不误放"的同一批整改。

## 修复记录

- 2026-09-17(auto-core 分支):**H1/H2/H3 已修复**——verify.ts 两个分支均改 `exec`(超时 kill 落在真脚本上,不再留下孤儿脚本继续写输出);review.ts `parseVerdict` 对齐 final.ts 口径(行首锚定、倒序取最后一个结论行、`通过` 须整值相等,并导出供回归测试);handover.ts `handoffStatus` 改整行锚定(值恰为 继续|完成,正文复述提示词字样不再命中)。回归测试:test/verify.test.ts(孤儿脚本不得续写输出)、test/review.test.ts(parseVerdict 假通过等 8 例)、test/handover.test.ts(状态行锚定 5 例);`bun typecheck` 干净、`bun test` 850 全绿。

## 核查后确认无问题的面(节选)

- 异步资源管理严谨:attempt 的 SSE AbortController/finally 收段兜底、watch 探针定时器在生成器 finally 清理、step/waitBetween 的 readline 配对关闭。
- git 调用全程 spawn 数组无注入面;pathspec 子树限定与嵌套仓库深度排序处理周到。
- 布尔/数字解析无 truthiness 陷阱;三路优先级(宪法键/实验开关/CLI)无交叉污染;commit:false 双入口严格失败与设计一致。
- failback 模块态随进程复位,无跨任务泄漏;sticky 清理闭环正确。
- 模板引擎块嵌套/standalone 吞行/片段缩进/深度保护均正确;testhandoff 排他条款三模板逐字节一致(缺的是覆盖校验,见 M8)。
- stats 原子写/写队列/宽容解析/折旧钳制与注释一致;--early 并行路径的 aiMs 欠计边界不会真实触发。
<!-- auto: eof -->
