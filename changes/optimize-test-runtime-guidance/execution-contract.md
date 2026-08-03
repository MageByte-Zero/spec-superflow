# 执行合同：测试时长与阶段交接优化

## Intent Lock

- **要解决的问题**：642 项测试虽全部通过，但全量 `npm test` 为 303.68 秒，离 180 秒参考目标差 123.68 秒；低风险内部改动也被重复工件、审批和回执拖慢。
- **范围内**：四个热点套件消除重复 Node/Git/计划链路；同一进程内复用同一不可变 Git 回执范围的验证；每个独立风险保留一个端到端所有者；为低风险测试、文档和测试辅助改动提供可升级的轻量路径；保留九个 skill 的阶段交接合同。
- **范围外**：删除唯一风险证据、改变生产 CLI/API/exports/安装器或 Full 路径语义、提高测试并发掩盖成本、增加运行时依赖。

## Approved Behavior

1. 重型套件使用每套件 Git seed、每案例隔离副本；副本不能污染 seed 或相邻案例。
2. `guard-specs-merged`、`cmd-execution`、`guard` 的重复行为经 `dispatchCli`、`cmd-execution.run`、`runGuard` 或窄内部模块进程内执行；`execution-plan` 保持对 `execution-plan.mjs` 的直接合同覆盖并复用 seed/copy。
3. `scripts/spec-superflow.mjs sync`/`execution` 和 `scripts/guard/guard.mjs` 各保留成功、验证失败、stdout/stderr、退出码和 cwd 的 focused wrapper smoke。
4. 每项独立风险只有一个完整链路所有者。`execution-plan` 快速覆盖报告删除、空文件、目录、符号链接和控制字符路径；guard 完整链路只保留删除与符号链接。修复链完整覆盖首次可重试和第五次熔断；中间次数直接覆盖控制记录。
5. `workflow-selection.json` 支持 `lightweight` 记录：受影响路径、每项排除检查、一次范围确认、验证策略/结果和升级原因。只允许低不确定性的测试、文档或测试辅助改动；无法证明条件、公开边界/行为/安装器/状态机/外部副作用/数据/权限/配置语义或高不确定性，一律 Full。执行中新风险立即升级 Full。
6. 九个流程 skill 均维持“当前阶段、已完成/阻塞、下一阶段、进入条件”的收口说明；成功 `closing` 与 `abandoned` 才无下一阶段。
7. 先成功构建，再计时完整 `npm test`；全量测试集不减。超过 180 秒时记录热点证据并从 `executing` 回 `bridging`；只有目标或范围变化才回 `specifying` 重走 DP-2。
8. 同一次 Node 进程内，对同一仓库和同一完整不可变 base/head SHA 的 Git 身份与 ancestry 验证可复用；符号引用、短 SHA、不同范围或不同仓库必须重新解析，不得以缓存绕过 Git ancestry 检查。

## Design Constraints

- 内部测试边界不得经 `src/index`、package exports 或公开文档成为 API。
- 测试仍使用 Node 20 原生能力，无新增运行时依赖；`--test-concurrency=2` 保持不变。
- 任何迁移必须先记录 `changes/optimize-test-runtime-guidance/verification-risk-ownership.md`：独立风险、原完整链路、唯一端到端测试文件/名称、快速合同位置、删减理由。
- 不得删除唯一的 wrapper 成功/失败、状态迁移、Git ancestry、发布回执新鲜度、首次重试或第五次熔断证据。

## Execution Batches

### Batch 1：缩短四个热点且保留风险所有权

- **任务**：1.4、1.5、1.6（以已交付的 fixture/内部边界为基础）。
- **路径**：`tests/lib/guard-specs-merged.test.mjs`、`tests/lib/execution-plan.test.mjs`、`tests/lib/cmd-execution.test.mjs`、`tests/lib/guard.test.mjs`、必要的 `scripts/lib/` 内部入口、`verification-risk-ownership.md`。
- **完成标准**：四个映射成立；每个非所有者完整链路都有快速合同替代；相同 immutable Git range 在一次进程内不重复启动 Git；矩阵完整；wrapper smoke 和不可删锚点仍在。
- **证据**：四个定向测试、wrapper smoke、cache 命中/失效合同、assertion/失败路径对比及每套件计时。

### Batch 2：实现风险自适应轻量路径

- **任务**：2.1、2.2。
- **路径**：`scripts/lib/workflow-recommendation.mjs`、workflow/guard/CLI 路由模块、相关测试、工作流 skill 文档。
- **完成标准**：`lightweight` 记录包含规定字段；仅合格内部改动准入；所有排除信号和“无法证明”均 Full；执行中新风险停止轻量并升级 Full。
- **证据**：记录读写、准入、排除、升级和 Full 兼容的合同测试。

### Batch 3：交接合同与全量验证

- **任务**：3.1、4.1。
- **依赖**：Batch 1、2 通过。
- **完成标准**：九个 skill 的交接合同仍通过；构建和完整回归通过并写入环境、结果、四个热点耗时和总耗时。
- **证据**：`node --test tests/lib/workflow-handoff-docs.test.mjs`、`npm run build`、计时 `npm test`。

## Test Obligations

- 从失败测试开始：轻量路径记录/准入/升级、风险所有权矩阵完整性、Git cache 命中/失效、四个热点的内部边界与 wrapper smoke。
- 必须覆盖：seed 隔离；报告五种证据状态；首次/第五次修复阈值；轻量路径的所有排除条件和未知影响；升级后 Full 控制仍生效。
- 回归敏感区：CLI 参数、stdout/stderr/exit/cwd、Git ancestry、状态转换、publication receipt、existing Full/Quick/Hotfix/Tweak。

## Execution Planning

- DP-4 前运行 `ssf execution recommend`，按以上三个 batch 定义 wave；模式、并行能力和非推荐选择由该命令的持久化 recommendation 决定。
- 未经新的 DP-3 和 DP-4，不得使用旧的 execution plan、旧 review receipt 或已过期的批准继续实现。

## Review Gates

- 每个 DP-4 wave 完成后，以 `ssf execution review` 写入当前 plan 的 `pass`/`fail` receipt；依赖 wave 只有在前置 `pass` 后才能开始。
- Batch 1 review 特别检查：没有删掉唯一证据、矩阵路径和测试名可解析、wrapper smoke 未被替代。
- Batch 2 review 特别检查：未知风险默认升级 Full，不能把轻量路径当作覆盖 Full 的快捷开关。
- Batch 3 review 特别检查：全量命令没有省略文件，时间报告不把 build 混入测试时间。

## Escalation Rules

- **回退 `specifying`**：目标、范围或风险定义变化；重新完成 DP-2。
- **回退 `bridging`**：合同/计划过期，或完整回归超过 180 秒但目标与范围不变；更新测量与设计后重建合同。
- **停止实现**：seed 污染、wrapper smoke 失败、唯一风险证据缺失、轻量路径遇到排除信号、或测试失败；先进入 debugging，不得以删断言关闭。
