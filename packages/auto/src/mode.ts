// -m/--mode 模式层(设计文档 A.1): 提示词级场景引导,不影响 driver 调度状态机。
// ModeSpec 三段文案的注入点: init → renderInit 的模式导语;exec → 分解/整任务/
// 子任务/收尾等执行类提示词的注意事项段;final → 终审各阶段提示词的侧重
// (T-026 的 renderFinalTask 消费,V1 先随注册表一并定义)。
export type ModeSpec = {
  name: string
  // renderInit 的模式导语: 场景定义、任务排布原则、verify 侧重。
  init: string
  // 执行类提示词(分解/整任务/子任务/收尾)附加的模式注意事项。
  exec: string
  // 终审各阶段提示词的侧重。
  final: { audit: string; validate: string; finalize: string }
}

// V1 仅注册 migrate(迁移/升级场景);optimize/implement/test 为既定扩展名,
// 未注册即不可用。新增模式 = 加一个类型完整的条目,driver 零改动。
export const MODES: Record<string, ModeSpec> = {
  migrate: {
    name: "migrate",
    init: `本次计划属于迁移/升级场景,以保持外部行为不变为前提:
- 任务按"基线确认 → 迁移改造 → 回归验证"排布: 先固化当前外部行为的基线
  (既有测试、可复现的检查或行为快照),再做迁移改造,最后做回归验证;
- 每个任务的 verify 字段优先复用既有的测试/构建命令,避免发明未运行过的检查;
- 不夹带与迁移无关的功能变更或重构,确有必要时单独立项。`,
    exec: `迁移/升级模式注意事项:
- 新实现须与旧实现保持对等行为(输入输出、边界情形、错误路径均不得漂移);
- 迁移期间引入的兼容层、临时分支或开关须注明用途与移除时机;
- 凡为推进迁移而做出的取舍(暂留旧路径、简化某分支等)属于代码变更决策,
  按 AUTO-DECISION 要求记录决策过程并标注。`,
    final: {
      audit: `迁移场景的终审侧重: 对照基线抽查新旧实现的行为对等性,排查残留的旧路径、
死代码与未收尾的兼容层。`,
      validate: `迁移场景的回归侧重: 既有测试/构建命令对基线行为的回归覆盖是否充分,
未覆盖的行为差异是否已补充验证。`,
      finalize: `迁移场景的收尾侧重: 旧实现的清理与兼容层的收尾(移除、归档,或注明保留理由)。`,
    },
  },
}

// 解析模式名;未注册返回 undefined(CLI 侧报用法错误并列出支持的模式)。
export function resolveMode(name: string): ModeSpec | undefined {
  return MODES[name]
}
