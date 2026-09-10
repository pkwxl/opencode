# 精确断点恢复实施计划(交接文档)

> 状态:**已实施完毕**。代码与文档同步均已完成(`bun typecheck` + `bun test` 全绿);
> 设计真相已归入 verify-review-design.md H 节,本文件保留作实施记录。

## 需求原文

针对所有异常中断的 AI 会话,再次执行时均复用被中断的会话(覆盖 Ctrl+C 退出、
服务器故障、AI 服务故障等);强制新会话须显式指定 `--new-session`;程序运行状态与
会话上下文完全匹配——何种状态异常退出,恢复后基于该状态精准驱动后续控制流程。

补充澄清(用户):中断时**若已保存交接文件则开新会话**(旧会话上下文已用满、进度
由交接文档承载);**未保存交接文件则像 `opencode -r <session-id>` 那样恢复原会话
上下文**继续。

## 已确认决策

| 决策点 | 结论 |
| --- | --- |
| 时间窗 | 完全去掉 RESUME_WINDOW_MS(30 分钟):active 记录复用仅看 sessionAlive;陈旧上下文靠 `--new-session` 逃生 |
| `--new-session` 语义 | 仅跳过会话复用;phase 阶段精确重入保留。且立即把记录转 active=false(防无会话阶段中断后旧会话与已推进阶段错位) |
| 交接文件优先 | active 恢复时若交接文档已存在(ondemand `docs/<id>.handoff.md` 或 handover-test 的 `<id>.testhandoff.md`)→ 不复用旧会话,开新会话凭交接续跑;`状态: 完成` 时直接跳过整任务会话 |
| 旁路一次性会话 | 维持重跑新会话(产物幂等保证状态匹配),不写进度记录 |
| 增强项 | ① verify 修复轮中断精确恢复(stage=fix + gap 持久化);② SSE 事件流中断不再误判会话结束(按会话错误处理 + abort 孤儿回合) |

维持现状:退出码体系;优雅退出(阻塞/回退 pending)→ active=false 不复用。

> **2026-09-10 追加**:恢复点落盘时机经 [session-resume-precedence-design.md](session-resume-precedence-design.md)
> 进一步细化——active 记录改为**提示词下发成功时即写**(认领回合进行中的会话,
> 此前"回合结束后才写"会在回合中被 kill 时丢失认领),可重试会话错误还原为下发前
> 快照;阶段级旁路步骤(规划/交接)也经 requireArtifact 的 spec.step 携带恢复点,
> 且会话恢复优先于文件推导路由。本文"会话内恢复/phase 阶段"语义不变,落盘时机与
> 覆盖面以该文档为准。

~~runSession 运行中瞬时错误重试仍换新会话~~ ——已被
[session-error-retry-plan.md](session-error-retry-plan.md) 取代(2026-09-09 实施):
isRetryable:false 直接阻塞不重试;可重试错误改为 fork(chain.id) 重试,失败即弃、
原会话不受影响,不再无差别清空 chain.id 换白板会话。

## 已完成(代码,已验证全绿)

### src/resume.ts
- 删除 `RESUME_WINDOW_MS`/`RESUME_WINDOW_MINUTES` 导出;文件头注释重写(无时间窗、
  `-r` 同构、交接优先、--new-session)。
- `Phase` verify 变体:stage 加 `"fix"`,加 `gap?: string`(修复轮判定差距原文)。
  `parseProgress` 整体透传 phase 对象,gap 自动兼容,无需改动。

### src/runner.ts
- import 去掉 RESUME_WINDOW_*;`Opts` 加 `newSession?: boolean`。
- runTask 恢复判定块:去时间窗;`handedOff`(recalled.active 且交接文档存在)优先于
  复用;`--new-session` 时先 `saveProgress({...recalled, active: false})` 再开新会话;
  三种不复用原因各自的日志文案。
- runTask 大注释块与非完成结局块注释同步(去 30 分钟窗表述)。
- verifyTask:抽出 `fixRound(gap, round)` 闭包(fix 会话 + wrapup,正常修复轮与恢复
  共用);fix 分支前 `persist({kind:"verify", stage:"fix", round, rechecks, replaced, gap})`;
  `pending` 排除 fix stage;新增 `pendingFix`(stage=fix 且 gap 为字符串)在循环首轮
  消费,重新下发 renderFix 续跑。
- `phaseText`/`nextStepText` 补 verify fix 文案。
- watch:加 `settled` 标志(仅 idle 正常结算置位);`for await` 耗尽且未 settled →
  `client.session.abort(sessionID)` 中止孤儿回合 + error 置"事件流中断(未收到会话
  结束事件,疑似 server 故障或网络断开)"→ attempt 包装为"会话错误:" blocked,走既有
  重试/active 保持路径,不再误勾选子任务。
- executeWhole:进入时读 handoff 文件 `状态:` 行播种——`完成` 直接返回跳过整任务会话,
  `继续` 置 `continuation=true` 开场续跑(陈旧文件由 pipeline 非恢复路径清除,文件
  存在即 active 恢复)。
- runExecSession:进入时检测 testHandoffFile 非空 → `continuation=true` 播种续跑
  (renderTestContinue 容忍 run=undefined)。

### src/index.ts
- `BOOLEAN_FLAGS` 加 `new-session`;run 分支解析透传 runAll;顶部布尔选项注释、
  用法文本 run 行 `[--new-session]` 与选项说明行均已补。

### src/loop.ts
- runAll opts 类型加 `newSession?: boolean`;runTask 调用透传。

### test/resume.test.ts
- 移除 RESUME_WINDOW_MS 引用;原窗口测试改为"任意久远记录仍返回(at: 0)";
- 新增 stage=fix + gap 往返测试。

## 待完成(仅文档同步)

1. **docs/verify-review-design.md H 节**(约 294-318 行):
   - "会话内恢复"行:改为 active 且会话存活即复用(无时间窗;与 `opencode -r` 同构);
     补 `--new-session`(仅跳过复用)与交接文件优先规则。
   - "phase 阶段"行:verify stage 加 `fix`(含 gap 差距原文持久化)。
   - H.1 已知取舍:删除"verify 修复轮无单独阶段标记"一条(已由 stage=fix 解决),
     保留 early 审核结论与 AGENTS.md 措辞两条。
   - 新增决策行:SSE 事件流中断(未收 idle 即断流)→ abort 孤儿回合并按会话错误
     处理(保持 active 可复用),不再误判会话正常结束。
2. **docs/behavior.md** 进度恢复条目(约 259-269 行):重写"30 分钟窗"句子;补
   --new-session、交接文件优先、修复轮精确恢复、断流处理。
3. **docs/structure.md**:`src/runner.ts` 条目(含"active 且 30 分钟窗内"表述)与
   `src/resume.ts` 条目(RESUME_WINDOW_MS=30 分钟)同步。
4. **README.md**:中断恢复章节(约 322-340 行,"30 分钟内"段落重写,补交接优先与
   --new-session 说明);run 选项表(约 151 行起)加 `--new-session` 行。
5. **本文件**:全部完成后可删除(设计真相归 verify-review-design.md H 节)或标记已实施。
6. AGENTS.md(包根)导航行"中断恢复 → src/resume.ts"仍准确,无需改;确认无 30 分钟
   残留表述即可。

## 验证

```bash
bun typecheck && bun test
```

文档改动后无需重新跑测试(无代码变更),但建议最终再跑一次确认。
