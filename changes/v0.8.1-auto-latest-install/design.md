# 设计文档

## 目标

让用户安装/升级 spec-superflow 时不需要手动指定版本号：
1. Cursor 本地部署脚本默认从 GitHub latest release 自动拉取。
2. 启动 workflow 时自动检查版本，若落后则提示升级。

## Cursor 脚本设计

### 当前行为

`scripts/install-cursor.mjs` 要求用户先 `git clone` 仓库，然后运行脚本，脚本从本地仓库复制 `skills/` 并生成 `.cursor/rules/phase-guard.mdc`。

### 新行为

默认无参数运行时：
1. 调用 GitHub API `GET https://api.github.com/repos/MageByte-Zero/spec-superflow/releases/latest` 获取 `tag_name`。
2. 下载 `https://github.com/MageByte-Zero/spec-superflow/archive/refs/tags/{tag}.tar.gz` 到 `/tmp`。
3. 解压到临时目录。
4. 从解压目录部署：
   - 复制 `skills/*` → `.cursor/skills/`
   - 读取 `scripts/lib/cmd-inject.mjs` 或复用现有 phase-guard 生成逻辑创建 `.cursor/rules/phase-guard.mdc`
5. 清理临时目录。
6. 输出安装版本。

### 参数

- `--local <path>`：使用本地仓库路径，跳过下载。
- `--tag <tag>`（可选）：指定 release tag，用于测试旧版本或预发布。

### 网络失败处理

- 任何网络/解压错误都打印明确错误并退出码 1。
- 部署前先把现有 `.cursor/skills/spec-superflow*` 移到临时备份，失败时回滚。

## 版本检查设计

### `scripts/check-update.mjs`

- 读取本地版本：优先 `package.json` 的 `version`；如果不存在，读 `plugin.json` 的 `version`。
- 读取远程版本：`npm view spec-superflow version`。
- 比较：
  - 本地 == 远程 → 输出 `✅ spec-superflow is up to date (x.y.z)`，退出码 0。
  - 本地 < 远程 → 输出 `⚠️  spec-superflow x.y.z is available (current: a.b.c). Upgrade: /plugin install spec-superflow@x.y.z`，退出码 1。
  - 无法比较 → 输出警告，退出码 2。

### `workflow-start` 集成

- 在 `workflow-start/SKILL.md` 的启动流程中增加一步：
  - Run: `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-update.mjs"`
  - If exit code 1, prepend a one-line reminder to the response.
- 不阻塞工作流：即使用户未升级，也继续检测状态和路由。

## 文档更新

- `INSTALL.md` Cursor 部分改为默认一键安装最新版：
  ```bash
  npx spec-superflow/install-cursor
  # 或
  node <(tmp path)>/install-cursor.mjs
  ```
  实际仍需要用户下载脚本？如果脚本本身能从 GitHub 拉取，可以先提供一个 curl 命令下载脚本再执行。
- `README.md` 同步版本说明到 v0.8.1，增加“自动升级”卖点。

## 测试策略

1. `ssf validate changes/v0.8.1-auto-latest-install` 通过。
2. `node scripts/install-cursor.mjs --local .` 在本地仓库路径下仍能正确部署（回归）。
3. `node scripts/check-update.mjs` 在本地 0.8.1 与 npm 0.8.0/0.8.1 比较时输出正确。
4. `npm run build && npm test` 通过。
5. `ssf doctor` 通过。
