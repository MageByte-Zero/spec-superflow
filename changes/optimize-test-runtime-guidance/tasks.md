# 实现任务

## 交付与证明

| 批次 | 交付结果 | 依赖 | 证明 |
|---|---|---|---|
| 1 | 四个慢套件消除重复 Node 启动与重复完整链路 | 无 | 风险所有权矩阵、断言/冒烟覆盖和每套件计时 |
| 2 | 低风险内部改动走轻量执行纪律 | 无 | 路由与升级合同测试 |
| 3 | 每个流程阶段给出下一步 | 批次 1、2 | 阶段交接文档合同测试 |
| 4 | 全量时间和覆盖得到验证 | 批次 1、2、3 | 成功构建后单独计时 `npm test` |

## Tasks

- [x] **1.1 建立种子副本夹具**：新增 `tests/helpers/` 中的 Git seed/copy fixture；每个 suite 初始化一次、每个案例仍拥有独立 worktree/`.git` 元数据和两提交历史，并断言 seed/相邻副本的 HEAD、配置、状态、未跟踪/忽略文件和符号链接不变；证明：夹具独立性测试。
- [x] **1.2 导出内部可测边界**：让 CLI dispatcher 与 guard 核心可进程内调用但不经 `src/index`、package exports 或公开文档成为 API；为 `scripts/spec-superflow.mjs` 与 `scripts/guard/guard.mjs` 保留成功、验证失败、stdout/stderr、exit code 与 cwd 冒烟；证明：核心行为和 child-process 矩阵。
- [x] **1.3 逐 suite 迁移重型测试**：按 `cmd-execution`、`execution-plan`、guard 顺序迁移，只有当前 suite 的种子不变量、成功/失败路径和 CLI 冒烟均通过才删除原 setup；证明：对应三个测试文件。
- [x] **1.4 清理四个剩余热点**：`tests/lib/guard-specs-merged.test.mjs` 用 `dispatchCli`、`runGuard` 与 publication helpers 替换重复 wrapper 调用；`tests/lib/execution-plan.test.mjs` 保持 `execution-plan.mjs` 直接覆盖并复用 Git seed/copy；`tests/lib/cmd-execution.test.mjs` 用 `cmd-execution.run` 与 `dispatchCli`；`tests/lib/guard.test.mjs` 用 `runGuard`、`cmd-state`/`cmd-execution` 或 `dispatchCli`。仅保留 `scripts/spec-superflow.mjs sync`/`execution` 和 `scripts/guard/guard.mjs` 的成功、失败、stdout/stderr、退出码、cwd 冒烟；证明：四个套件的断言/失败路径对比和计时。
- [x] **1.5 压缩重复完整链路**：建立 `verification-risk-ownership.md` 矩阵，每行记录独立风险、原完整链路位置、唯一端到端测试文件/测试名、快速合同位置和删减理由。一个风险仅有一个端到端所有者；同一规则在 CLI、计划和 guard 层的其它覆盖改为快速模块合同。`execution-plan` 保留报告证据全部类型的快速合同，guard 只保留删除与符号链接代表例；修复链保留首次可重试和第五次熔断端到端证据，中间计数直接构造控制记录验证。不得删除公开 wrapper 成功/失败、状态迁移、Git ancestry、发布回执新鲜度或这两个修复阈值；证明：矩阵、定向测试和前后耗时。
- [x] **1.6 消除重复 Git 范围验证**：为 `execution-plan.mjs` 引入仅进程内的 Git 验证缓存，键为仓库绝对路径和已解析的完整 immutable base/head SHA；同一键复用 repo/root、commit 与 ancestry 证明，符号引用、短 SHA、不同范围或不同仓库一律重新解析。不得删除 Git ancestry、伪造回执或非祖先端到端证据；证明：缓存命中/失效快速合同、既有真实 Git 范围回归和定向计时。
- [x] **2.1 实现轻量内部改动路径**：扩展既有 `.superpowers/sdd/workflow-selection.json` 的 `facts` 和 `selection`，固定记录受影响路径、每项排除信号检查、`lightweight` 单次范围确认、验证策略和确认时间；只在测试、文档或测试辅助代码且能证明没有生产行为、公开边界、安装器、状态机、外部副作用、数据/权限/配置语义改动时准入。预期行为不清、验证不可复现、影响路径不完整或任一项不能证明时视为高不确定性；符合时只要求单批执行、一次聚焦审查和最终验证；证明：记录读写与准入合同测试。
- [x] **2.2 实现风险升级**：任何排除条件或执行中新风险出现时，停止轻量路径并路由回 Full；Full 的 DP-2/DP-3/DP-4、执行计划与波次审查保持不变；证明：每个排除条件和升级分支的合同测试；前置：2.1。
- [x] **3.1 定义阶段交接格式**：保持九个流程 skill 的正常、阻塞、审批等待、closing 前 release 继续条件和两个终态说明；证明：阶段交接文档合同测试矩阵。
- [x] **4.1 验证优化结果**：在 macOS 15.7.7 / 12 CPU / Node 24.4.1 / Apple Git 2.50.1 且无并行其他负载时，先运行 `npm run build`，再单独计时 `npm test`；把环境、总数、通过/失败/跳过、四个热点套件耗时和 elapsed 写入 change 验证报告。超过 180 秒则带 suite-duration 证据从 `executing` 回退 `bridging` 重建契约；只有范围或目标变化才回退 `specifying` 并重走 DP-2，不得关闭；证明：`npm run build` 与计时 `npm test`。

## 实施备注

- 时间目标用于本机验收和改进判断；若同等覆盖未达到目标，保留测量证据并从 `executing` 回到 `bridging` 重建契约，而不删减测试。
