spec-superflow —— 给 AI 编程装上"先想清楚再动手"的工作流引擎

---

## 1. 创意名称 + 创意介绍

**创意名称：spec-superflow**

**想解决什么问题：**

用 AI 写代码时，有两个反复出现的失控点 —— 第一，需求还没说清楚，AI 就开始改代码，改到一半才发现方向错了；第二，规划文档写得再漂亮，执行阶段还是会跑偏，测试没人盯、review 没人卡，等合并了才发现行为不对。

spec-superflow 在这两个失控点之间加了一道硬桥：先用对话把需求问清楚，再沉淀为正式规划工件，然后压缩成一份"执行契约"，最后只按已批准的契约推进实现，违反就拦截回退。

**为什么会想到做这个：**

我日常用 Claude Code 和 Trae 做开发，发现规划阶段和执行阶段之间始终缺一个"交接层"。OpenSpec 偏向静态文档产出，Superpowers 偏向执行纪律，但两者各管一段、没有打通。我认为好的 AI 编程体验不是"有更多文档"或"有更多规则"，而是在正确的时刻做正确的检查。所以 spec-superflow 把这些思想吸收进一个统一的工作流引擎，让 AI 从"帮忙写代码"升级为"帮忙管好写代码的过程"。

**大概是什么产品：**

一套本地安装的 AI 编程 skill 插件（非 SaaS、非 App），支持 Claude Code 和 Trae，通过 6 个协作 skill + 一个状态机，把"需求澄清 → 规划产出 → 契约桥接 → 纪律执行 → 收口归档"串联成标准工作流。

---

## 2. 目标用户及痛点

**面向哪些用户：**

- 用 Claude Code / Trae 做日常开发的工程师
- 需要管理中等以上复杂度变更的独立开发者或小团队
- 对"AI 写代码质量不稳定"有切身体会、想引入流程约束但又不想要重流程的开发者

**在什么场景下使用：**

- 开始一个新功能或重构时，先走 `spec-explorer` 把范围、约束、成功标准问清楚
- 规划阶段用 `spec-forger` 产出 proposal → specs → design → tasks 四份工件
- 准备动手前，用 `bridge-contract` 把规划压缩成 `execution-contract.md`（明确的输入/输出/边界/测试清单）
- 实现过程中，`execution-governor` 强制 TDD、卡 review 关卡，违规就退回
- 变更收口时，`closure-archivist` 做验证、总结和归档

**当前痛点：**

没有 spec-superflow 时，开发者通常面临三种困境：
- **方向失控：** 跟 AI 说"帮我加个权限"，它就改几十个文件，改到一半你才想起来 —— 到底是 RBAC 还是 ABAC？
- **质量失控：** proposal 写了、design 画了，但实现过程中没人盯着测试、没人卡 review，最终交付行为不一致
- **上下文断裂：** 每次新对话，AI 都不记得之前的规划决策，反复确认、反复偏离

---

## 3. 价值与意义

**效率提升价值：**

spec-superflow 的核心价值不是"让 AI 写得更快"，而是"让 AI 写得更对"。

- **Spec First 原则：** 没有稳定的规划工件，不允许进入实现。把"先想清楚再动手"从口号变成硬约束。
- **Guarded Handoff：** `execution-contract.md` 是规划到实现的唯一交接层，所有模糊决策在这里被显式压缩为可验证条目。
- **Strong Guardrails：** 实现中违反契约的行为被明确拦截并回退，而不是靠开发者"感觉不对"来手动纠偏。
- **Self-Contained：** 不需要额外安装 OpenSpec 或 Superpowers，即装即用，零运行时依赖。

一句话概括：把"AI 编程"从随机游走变成可控流水线。

**社会价值：**

spec-superflow 完全开源（MIT 许可证），所有 skill 文件、模板、示例均公开在 GitHub。这意味着：
- 任何用 AI 编程的开发者都可以免费使用、定制、贡献
- 两个完整的示例变更（add-dark-mode、refactor-auth-boundary）可以直接作为学习材料，降低流程化 AI 编程的入门门槛
- 通过标准化"需求 → 规划 → 契约 → 执行 → 归档"链路，帮助更多开发者从"AI 辅助写代码"过渡到"AI 辅助管工程"

**商业价值：**

作为开源基础设施，spec-superflow 的商业模式可以是：
- 企业定制版（私有部署、团队协作面板、合规审计日志）
- 高级模板库（行业特定变更模板、合规检查清单）
- 培训与咨询服务（帮助团队落地 spec-first 工作流）

---

## 4. 产品亮点

**6 状态状态机：**

```
exploring -> specifying -> bridging -> approved-for-build -> executing -> closing
```

每个状态有明确的进入条件和退出标准，非法跳转被 `workflow-orchestrator` 拦截。当需求变更或设计假设出错时，强制回退到对应的规划阶段重新来过。

**6 个协作 Skill：**

| Skill | 阶段 | 一句话职责 |
|---|---|---|
| `workflow-orchestrator` | 入口 | 检查状态、路由到正确的 skill、阻止非法跳转 |
| `spec-explorer` | 探索 | 澄清意图、范围、约束、成功标准 |
| `spec-forger` | 规格 | 生成 proposal、specs、design、tasks |
| `bridge-contract` | 桥接 | 把规划工件压缩为 execution-contract.md |
| `execution-governor` | 执行 | 强制 TDD、评审关卡、契约优先实现 |
| `closure-archivist` | 收口 | 验证、总结、归档准备 |

**关键创新 —— execution-contract.md：**

这是 spec-superflow 区别于其他工作流工具的核心。它不是又一份规划文档，而是一份"可检查的契约"：
- 明确列出本次变更的输入、输出、边界
- 逐条对应需要通过的测试
- 预定义验收关卡和 escalation 规则

**开源地址：** https://github.com/MageByte-Zero/spec-superflow

---

*（创意产物 HTML 文件见附件）*
