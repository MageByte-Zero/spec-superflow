# 变更提案

## Why

当前安装/升级 spec-superflow 时，用户需要手动指定版本号（如 `/plugin install spec-superflow@0.8.0` 或 `node scripts/install-cursor.mjs` 依赖本地仓库）。这容易遗漏最新版本，也增加心智负担。用户希望安装脚本能自动拉取并安装最新版本。

## What Changes

- 改造 `scripts/install-cursor.mjs`：默认从 GitHub latest release 下载 source tarball，解压后部署到 `.cursor/skills/` 和 `.cursor/rules/`。
- 保留 `--local <path>` 参数，允许从本地仓库部署（兼容现有用法）。
- 新增 `scripts/check-update.mjs`：比较本地版本与 npm latest，输出是否需要升级。
- 在 `workflow-start/SKILL.md` 中增加启动时版本检查：运行 `scripts/check-update.mjs`，若落后则提示用户升级命令。
- 更新 `INSTALL.md` 与 `README.md` 中 Claude Code 升级说明：Claude Code marketplace 中已安装插件需用 `/plugin update spec-superflow@spec-superflow` 升级到最新版。
- 更新 `INSTALL.md` 中 Cursor 安装说明，改为“自动拉最新版”。
- 版本号升级到 `0.8.1`。

## Capabilities

### 新增能力

- cursor-auto-latest-install — Cursor 本地部署脚本默认安装 GitHub latest release。
- update-check-reminder — workflow 启动时检测版本并提示升级。

## Scope

### In Scope

- `scripts/install-cursor.mjs` 改造。
- `scripts/check-update.mjs` 新增。
- `workflow-start/SKILL.md` 增加版本检查提示。
- `INSTALL.md` / `README.md` 安装说明更新。
- 版本号同步到 `0.8.1`。

### Out of Scope

- 修改 Claude Code `/plugin` 客户端本身的升级行为（不可控）。
- 修改其他平台（Copilot/Gemini）的安装脚本（它们本身支持 `@latest` 或 marketplace）。
- 自动静默升级（只提示，不替用户执行）。

## Impact

- 影响的代码区域：`scripts/`、`skills/workflow-start/SKILL.md`、文档。
- 影响的 API 或接口：无破坏性变更，`install-cursor.mjs` 新增可选参数。
- 依赖或涉及的外部系统：GitHub Release API、npm registry。
