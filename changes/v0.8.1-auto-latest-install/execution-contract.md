# 执行合同

## Intent Lock

- **变更名称**：v0.8.1 auto-latest install + update reminder
- **要解决的问题**：安装/升级 spec-superflow 时需要手动指定版本号，容易遗漏最新版。
- **范围内**：
  - `scripts/install-cursor.mjs` 默认从 GitHub latest release 下载。
  - 新增 `scripts/check-update.mjs`。
  - `workflow-start` 启动时版本检查提示。
  - `INSTALL.md` / `README.md` / `CHANGELOG.md` 更新。
  - 版本号升级到 `0.8.1`。
- **范围外**：
  - 修改 Claude Code `/plugin` 客户端升级机制。
  - 修改其他平台安装脚本。
  - 自动静默升级。

## Approved Behavior

- **已批准需求摘要**：
  - Cursor 安装脚本默认自动安装 GitHub latest release。
  - 保留 `--local` 参数用于本地开发部署。
  - workflow 启动时检查版本并提示升级。
- **关键场景**：
  - 用户在新项目中运行 Cursor 安装脚本，无需 clone 仓库即可获得最新版。
  - 用户启动 workflow 时收到升级提醒。
- **验收检查**：
  - `ssf doctor` 通过。
  - `npm test` 通过。
  - `--local` 路径部署仍工作。
  - `check-update.mjs` 能正确比较版本。

## Design Constraints

- **架构约束**：不破坏现有安装脚本行为，仅扩展默认行为。
- **接口约束**：`install-cursor.mjs` 新增可选参数。
- **依赖约束**：需要 GitHub API 和 npm registry 网络访问。
- **数据约束**：临时下载文件必须清理，失败必须回滚。

## Task Batches

### Batch 1

- **目标**：改造 Cursor 安装脚本支持 latest release。
- **输入**：当前 `scripts/install-cursor.mjs`。
- **输出**：支持 `--local`、默认下载 latest release、错误回滚的脚本。
- **完成标准**：`--local .` 路径部署成功，默认路径至少 dry-run 逻辑正确。

### Batch 2

- **目标**：新增版本检查脚本并集成到 workflow-start。
- **输入**：Batch 1 产出的脚本基础。
- **输出**：`scripts/check-update.mjs` 和集成后的 `workflow-start/SKILL.md`。
- **完成标准**：`check-update.mjs` 返回正确退出码，workflow-start 能提示升级。

### Batch 3

- **目标**：文档、版本号、发布。
- **输入**：Batch 2 产出的功能。
- **输出**：更新后的 README/INSTALL/CHANGELOG、版本号 0.8.1、tag v0.8.1。
- **完成标准**：npm/GH release 完成。

## Test Obligations

- **必须先从失败测试开始的行为**：
  - `--local` 路径下找不到 source 时应失败。
- **必需的边界情况**：
  - GitHub API 失败。
  - npm 不可达。
  - 本地版本等于/高于远程版本。
- **回归敏感区域**：
  - `scripts/install-cursor.mjs` 原有本地部署路径。

## Execution Mode

- **模式**：`Inline`
- **选择理由**：变更范围小（2 个脚本 + 文档），无跨模块依赖，适合当前会话直接实现。

## Verification Dimensions

| 维度 | 状态 | 发现 |
|------|------|------|
| Completeness | Pending | — |
| Correctness | Pending | — |
| Coherence | Pending | — |

**总体结论**：Pending

## Review Gates

- Batch 1 后：确认 `--local` 行为未破坏。
- Batch 2 后：确认 `check-update.mjs` 输出正确。
- Batch 3 后：确认发布成功。

## Escalation Rules

- 如果 GitHub API 限流或不稳定，可降级为文档说明手动下载。
