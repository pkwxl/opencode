# refcheck 范围收敛与恢复设计(OPENCODE_AUTO_REF_CHECK)

> 状态: **P1 已实施(2026-09-08): 开关 + 三层挂点管控 + D2 废弃项摘除;P2/P3 未实施**。
> 本文是对 stable-refs-design.md §4.5/D6 的修订。需求来源(2026-09-08 会话,三条):
>
> 1. refcheck 绝不动 docs 目录树——永不移动/重命名其中任何文件与目录;改写绝不动
>    文档排版(排版不变式已于 2026-09-08 先行固化,见 stable-refs-design.md §4.5)。
> 2. 针对遗留文档因移动导致的引用失效:仅在专设的失效确认机制(scanRefs findings)
>    确认失效后,才借助 git 历史追踪原文件移动记录,就地改写恢复引用。
> 3. 整个 refcheck 机制经 `OPENCODE_AUTO_REF_CHECK=on/off` 开关管控,**默认关闭**;
>    并收敛检查范围(仅三类,见 D4)。

## 1. 决策表

| 编号 | 决策 |
|---|---|
| D1 | **树不变式**: refcheck 永不移动/重命名 docs 目录树中的任何文件与目录;**排版不变式**: 改写仅就地替换命中 token,行结构/空白/对齐/末尾换行原样保留,无命中不写回(已固化)。恢复机制同样只改引用文本,绝不搬移文件 |
| D2 | **摒弃移动适配**: 废弃 `docpaths.migrateLegacyDocs` 的 run 启动迁移挂点(loop.ts)与 fix-docs 脚本的目录化迁移步骤——不再以搬移文件适配 stable-refs;legacy 平铺布局原地保留,`resolveTaskDoc`/`resolveSubtaskDoc` 读回落永久保留以兼容存量;由此产生的失效引用走 §4 恢复机制 |
| D3 | **开关管控整个 refcheck**: `OPENCODE_AUTO_REF_CHECK=on/off`,默认 **off**;off 时三层挂点(提交前 auto-correct、check 子命令引用扫描、verify 门禁预扫)全部空转,目标目录零引用检查行为。`fix-refs` 一次性手动脚本属人工显式入口,不受开关约束 |
| D4 | **范围收敛**(on 时仅三类): ① 缺失恢复——仅对「曾出现且当前缺失」的引用目标做 git 历史 rename 追踪与就地恢复(§4);② 提交前移动修正——仅对提交前发生移动的文件(renamePairs 现状语义)做路径修正(§5);③ 范围再确认——仅对被编辑修改过的文件(含嵌套子 git 仓库源码)的 `:N`/`:N-M` 行号锚做再确认,内容不一致时保留原范围、追加 `@<sha>` 版本标记(§6) |
| D5 | 「AI 会话历史中出现过」的确定性判据 = 目标所属 git 仓库的历史中曾存在该路径(`git log` rename 地图含其为 old)。AI 会话产物经统一提交落账,git 历史即会话历史的确定性投影——不引入会话转录扫描,保持 driver 确定性 |

## 2. 开关(src/switches.ts)

- `SWITCH_ENV` 增 `refCheck: "OPENCODE_AUTO_REF_CHECK"`;`Switches` 增
  `refCheck: boolean`;`SWITCH_DEFAULTS.refCheck = false`;解析/报错/启动日志
  复用既有 onOff 通道(非法值 throw 中文报错、非默认项启动日志)。
- 管控点(实施期接线):
  - `runner.ts` afterSession 的 `autoCorrectRefs(dir)`——off 跳过;
  - `check.ts` 引用扫描段——off 跳过(静默,verbose 可查开关全量);
  - `runner.ts` verify 门禁 `taskRefFindings` 预扫——off 跳过;
  - `script/fix-refs.ts` 手动脚本不受约束(显式人工执行等价于显式开启)。
- 测试影响: 现有三层挂点测试在注入 `OPENCODE_AUTO_REF_CHECK=on` 的 env 下运行
  (parseSwitches 纯函数注入);补缺省 off 行为测试(三层空转、目标目录零改动)。

## 3. 不变式(实施全程不得破坏)

- 树不变式与排版不变式(D1);
- 恢复与修正的最小范围原则: 只改写「失效确认后的该引用」所在文档中的该路径
  token,不波及其他引用与文档;
- 统一提交不变式不受影响(改写随本次统一提交落账,不另起提交)。

## 4. 缺失引用恢复(D4①,git 历史追踪)

- **触发**: `autoCorrectRefs` 复扫 findings 中 `problem: "missing"` 的条目
  (开关 on;失效确认在先,恢复在后——顺序不可颠倒)。
- **步骤**:
  1. 构建 rename 历史地图: 目标仓库及嵌套子仓库各自执行
     `git log --find-renames --diff-filter=R --name-status --format= -z`,
     按新→旧序遍历、首现优先,old→new 链式解析到最终落点(带 visited 防环)。
  2. 逐 missing 目标: 地图含该路径为 old → 解析最终落点;落点当前存在 →
     `rewriteRefs` 就地改写该引用(排版不变式);落点不存在(已删除)→
     保留 finding 入失效清单,人工订正。
  3. 改写后复扫,`.auto/invalid-refs.md` 只登记未恢复的失效引用。
- **界定**: 只恢复「移动/改名」导致的失效;删除与语义变化不自动恢复(沿用
  stable-refs §8 边界)。

## 5. 提交前移动修正(D4②)

现状语义保留不变: `renamePairs`(索引 vs HEAD,先 `git add -A` 暂存)→
`rewriteRefs` 活文档。仅「提交前发生移动」的文件参与路径修正,恰为既有行为,
无实现增量;纳入开关管控(off 时随 autoCorrectRefs 一并空转)。

## 6. 引用范围再确认(D4③,行号锚 + 版本标记)

- **对象**: 带行号锚(`:N` 或 `:N-M`)的引用,其目标文件「被编辑修改过」——
  判据 = 目标文件在所属(可能嵌套的)git 仓库中有未提交内容差异
  (`git diff HEAD --name-only`,renamePairs 已 `git add -A`,暂存区即改动全集;
  嵌套子仓库逐个判定,镜像 git.ts 统一提交的嵌套优先遍历)。
- **一致性判定**: 目标文件 HEAD 版本的范围行切片 vs 当前工作区版本同范围行切片
  (当前文件行数不足即不一致):
  - 一致 → 引用不动;
  - 不一致 → **保留原引用范围不变**,锚改写为 `path:N-M@<sha>`(sha = 所属仓库
    当前 HEAD 短哈希 7 位)——语义: 该范围仅对此历史版本有效,其后续内容已发生
    变更。
- **解析扩展**: `extractRefs` 尾锚解析顺序——先剥可选 `@<sha>` 再剥 `:N(-M)`;
  `Ref` 增 `ver?: string`。
- **校验语义**: 带 `ver` 的引用视为历史快照引用——只查路径存在性,行号上限校验
  豁免(历史版本不可机械校验);幂等——已带 `ver` 的引用不再追加或更新标记,留待
  人工订正。
- **文案同步**(P3 实施时): AGENTS.md 第六标记块(引用规范)与 wrapup/fix 模板
  补 `@sha` 标记语义说明。

## 7. 废弃与保留清单(D2)

| 对象 | 处置 |
|---|---|
| loop.ts 启动迁移挂点(migrateLegacyDocs) | 废弃 |
| fix-docs 的目录化迁移步骤 | 废弃(P1 实施定: 摘除后与 fix-refs 完全等价,脚本一并退役,保留 fix-refs 为唯一手动入口) |
| `migrateLegacyDocs` 及其测试 | 随挂点退役 |
| 读回落(resolveTaskDoc/resolveSubtaskDoc/旧平铺构造器) | 永久保留,兼容存量平铺项目 |
| 失效清单 `.auto/invalid-refs.md` 机制 | 保留(恢复失败项的人工订正入口) |

## 8. 实施分期

| 期 | 内容 | 验证 |
|---|---|---|
| P1 | 开关(switches.ts)+ 三层挂点管控 + 缺省 off 回归测试改造;D2 废弃项摘除 | 本包 typecheck + test 绿(挂点测试注入 on;新增 off 空转用例) |
| P2 | 缺失恢复(rename 历史地图 + 就地改写恢复 + 复扫) | 新增恢复单测(移动恢复/删除保留/嵌套仓库/幂等) |
| P3 | 范围再确认(改动文件检测 + `@sha` 语法与解析/校验扩展 + 嵌套仓库 SHA)+ 规范块/模板文案 | 新增再确认单测(一致不动/不一致追加标记/幂等/子仓库) |

每期同步修订: 本文件状态行、stable-refs-design.md §4.5 修订注记、behavior.md
「引用一致性三层」条目(补开关条件与范围收敛)、structure.md refcheck/switches
条目、AGENTS.md 导航行(去「未实施」标注)。

## 9. 明确不做

- 不扫描 AI 会话转录判定「出现过」(D5: git 历史为确定性投影);
- 不自动恢复删除/语义变化类失效(人工订正,失效清单为入口);
- 不把开关落盘为宪法键(实验期只读环境,沿用实验开关契约;转正另议);
- 不动 docs 目录树任何文件与目录的位置与命名(D1,含恢复路径)。
