# 工作流轻量化实施记录

## 改动与收益边界

Native（持久化值 `inline`）成为执行推荐默认值；任务数、文件数、wave 数不再触发 SDD。新 Native 计划默认一次 `final` 独立审查，SDD 默认 `wave`。没有 `review_policy` 的旧计划保留原 wave 门禁，避免已有执行记录被静默放宽。

恢复入口合并为一次 `ssf resume`：调试优先，短路径不补 Full 执行计划，无效短路径凭据回到凭据恢复。Full 可从 debugging 回退 specifying/bridging；规划和契约技能先进入对应状态再写文件，恢复时跳过自转换。

统一任务解析覆盖模板粗体 ID、缩进、CRLF、未知勾选标记；未知标记不能被当作完成。可设置决策字段与序列化保持一致。specs/design 省略规则贯通验证；Full 在进入 specifying 前拒绝省略 tasks。

评审输入报告保存独立快照，复用文件名不会破坏历史失败证据。非语义 resync 保留失败链；模式修订保留适用证据，范围变更保守失效通过结果并保留未解决失败。已解决失败链遇到新代码时归档，新轮单独计数，不能把仍未解决的失败清零。

隔离记录目标 checkout/branch。finish 验证实际目标，分别记录待验证、待清理与完成状态。清理前校验并归档被 Git 忽略的活动 change，保留原目标副本，再同步最终状态与证据。失败保留隔离；branch-only 不删除 checkout；不自动 force 删除；完成后重试幂等。

## 成本变化

以仓库 `scripts/token-baseline.mjs` 的同一静态估算口径比较，审计时为 **20,731 estimated tokens**。本次移除九个技能重复交接模板，缩短 workflow-start/build-executor/release-archivist，并让 SDD 子提示按需读取；当前为 **11,471 estimated tokens，减少 44.7%**；完整数值见 `token-baseline.json`。

这衡量的是静态指令体积，不是生产会话 token 或端到端时长。用户截图中等待答复占 43.4%，模型/子代理运行占 40.7%；主线程工具时间未包含子代理工具调用，不能据此断言全部测试执行只占 0.67%。实际收益需用同任务、同模型、同环境的会话追踪比较。

任务级运行受影响测试；集成/最终验证在相应边界执行，代码、环境或命令变化后重新验证。未配置模型时继承宿主；更新检查缓存 24 小时且不阻断恢复；isolate 外层超时覆盖子模块初始化。

## 场景核验

| 场景 | 检查的行为 |
|---|---|
| Quick 继续并遇到 bug | 无 Full plan 仍可恢复和进入 debugging |
| Full 调试发现范围变化 | 可回退 specifying/bridging，无自锁 |
| 模板任务与异常勾选 | checkpoint 能识别 ID，未知标记阻止完成 |
| 报告覆盖 + open fail + 格式修正 | 快照仍有效，resync 后次数与依赖门禁保留 |
| Native 多 wave | 任务依赖完成即可继续，最终仍须真实审查 |
| final fail→pass→新代码→fail | 归档已解决轮次，新轮可继续修复 |
| 最终审查后新增代码或提交 | 旧通过不能放行交付 |
| worktree 内执行 finish | 合并正确目标，状态和证据存续 |
| 验证或清理失败后重试 | 隔离保留；匹配代码、命令、环境才复用验证 |
| branch-only finish | 切回记录目标，保留 checkout |

上述可执行回归覆盖 CLI/状态/文件/Git 行为；文档检查仅用于检查指令一致性，不宣称证明代理一定遵循指令。

## 独立审查

初审发现两个阻塞问题：finish 删除 ignored change 证据、final 新轮误接已解决失败链。两项均先补真实 Git 回归复现，再修复。初审和聚焦复审报告保留在活动 change 的 reviews 目录。

本次只交付隔离分支，不执行 Git 合并、推送或发布。
