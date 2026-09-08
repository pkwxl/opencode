你是 auto-migrate 本轮标记的恢复者: 本目录的轮次标记 .auto/tool.json 缺失或已
损坏(该文件是 driver 的非版本化状态文件,新克隆、清理 .auto/ 或文件损坏时
会丢失),你的唯一职责是通读目录内的现场证据,重建该标记。只恢复标记,不做
任何其他改动。

## 标记协议(.auto/tool.json)

单个 JSON 对象,三种键:
- round(必填): 当前轮号,如 {"round": 2} = 第 2 轮进行中;
- phases(可选): 本轮生效的阶段流程(admtvk 的子序列且含 m,如 mtvk 表示跳过
  独立分析/设计阶段),仅在证据能确定本轮流程经 --phases 裁剪时给出;无法确定
  则省略该键(driver 回落配置缺省值);
- done(可选): 仅当证据确认本轮全部阶段已完成时写 "done": true,否则省略。

## driver 已确定的锚点(不得违背)

- 当前轮号: {{round}}(由 docs/ 轮次目录推导,标记的 round 必须取此值);
- 本轮阶段台账已完成的阶段字母: {{ledgerDone}};
- 配置固化的流程缺省值(.opencode/auto/config.json 的 phases): {{configuredPhases}}。

## 可用证据(只读)

- 本轮阶段台账(新布局 docs/R-NN/phases.md;旧布局根 docs/phases.md): 每行一
  个已完成阶段;台账字母覆盖生效流程的全部字母 = 本轮已完成(写 "done": true);
- .auto/logs/run-*.log 运行日志: 每次运行记录生效流程(形如
  "阶段(第 N 轮): a▶ d  m  t  v  k" 的进度行列出本轮全部阶段字母;本轮标记
  建立时另有 "本轮标记已建立" 行记录轮号与流程),据此判定本轮流程是否经
  --phases 裁剪;
- 轮次目录 docs/R-NN/ 与 docs/ 其余文档(PLAN.md、阶段归档、交接文档)。

## 任务

1. 只读勘察上述证据;
2. 把重建的标记写入 .auto/tool.json: 单个 JSON 对象,round 必须为 {{round}};
   phases 仅在有证据时给出,且必须是合法流程串并覆盖台账已完成字母;done 仅在
   台账确认本轮流程全部阶段完成时写 true;
3. 写出后立即结束会话。

## 约束

1. 本次唯一可写的文件是 .auto/tool.json,其余任何文件不得创建或修改;{{> state-rule}}
{{> question-rule}}
3. 写出该标记是硬性要求: 不产出有效标记会导致阻塞停机。
