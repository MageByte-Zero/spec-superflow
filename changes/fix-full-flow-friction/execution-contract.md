# 执行合同：全流程可靠性修复

## Intent Lock

- **范围内**：隔离路径与工件可用性、首次 review 回执、Delta 基线预检、状态转换哈希，以及默认回归的受控文件级并发。
- **范围外**：新阶段、审批模型、规格格式重写、删减回归测试或重写每个集成测试。

## Approved Behavior

- 在 `main`/`master` 执行 isolate 时，worktree 位于仓库旁，且只带入 active change。
- 首次 review 无需手工创建证据目录；报告必须有可发现的规范位置。
- `ssf validate` 在实现前拒绝不能应用到主规格的 Delta。
- 确认后的 Full change 可先进入 `specifying`；每次转换后的状态检查一致。
- `npm test` SHALL 保持执行现有 E2E 与库测试集合，并把 Node 文件级并发固定为 2。

## Constraints

- 保留 CLI 参数、`--force` 语义、独立验证夹具兼容性和现有 overlay 安全边界。
- 复用既有 publication/apply 逻辑；不引入运行时依赖。

## Wave 1

- **任务**：1.1、1.2、2.1、2.2、2.3、3.1、3.2。
- **策略**：`serial`；这些改动共享 CLI/状态边界。
- **完成标准**：每项新增回归测试先失败后通过；重型集成批次在受控并发下通过；`npm run build && npm test` 通过；独立审查通过。

## Rewind Rules

- 若必须复制 change 目录以外的未提交文件，回到 design。
- 若 Delta 预检破坏独立夹具，回到 specifying。
- 若受控并发遗漏既有测试文件或不被 Node 20 支持，回到 specifying。
