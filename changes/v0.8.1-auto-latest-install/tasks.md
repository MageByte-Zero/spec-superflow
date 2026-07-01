# 实现任务

## 文件结构

- `Modify: scripts/install-cursor.mjs` — 默认从 GitHub latest release 下载，支持 `--local` 覆盖
- `Create: scripts/check-update.mjs` — 本地 vs npm latest 版本检查
- `Modify: skills/workflow-start/SKILL.md` — 启动时调用版本检查并提示
- `Modify: INSTALL.md` — Cursor 一键安装最新版说明
- `Modify: README.md` — 版本历史与卖点同步
- `Modify: CHANGELOG.md` — v0.8.1 条目
- `Modify: package.json` / manifests — 版本号 `0.8.1`

## 1. Batch 1: Cursor 脚本改造

- [ ] **1.1 解析命令行参数**

在 `scripts/install-cursor.mjs` 中：
- 使用 `node:util.parseArgs` 解析 `--local` 和 `--tag`。
- 默认行为：从 GitHub latest release 下载。

**Files**: `Modify: scripts/install-cursor.mjs`

- [ ] **1.2 实现 latest release 下载与部署**

- 调用 GitHub API 获取 latest tag。
- 下载 tarball 到 `/tmp`。
- 解压。
- 复制 `skills/` → `.cursor/skills/`。
- 生成 `.cursor/rules/phase-guard.mdc`（可复用现有生成逻辑或调用 `ssf inject`）。
- 清理临时目录。

**Files**: `Modify: scripts/install-cursor.mjs`

- [ ] **1.3 实现 `--local` 兼容路径**

- 如果传了 `--local <path>`，从该路径复制 skills 并生成 rules，与旧行为一致。

**Files**: `Modify: scripts/install-cursor.mjs`

- [ ] **1.4 错误处理与回滚**

- 下载/解压失败时退出码 1。
- 部署失败时回滚备份。

**Files**: `Modify: scripts/install-cursor.mjs`

- [ ] **1.5 提交 Batch 1**

```bash
git add scripts/install-cursor.mjs
git commit -m "feat(cursor): install-cursor.mjs defaults to GitHub latest release"
```

## 2. Batch 2: 版本检查脚本与 workflow 集成

- [ ] **2.1 创建 scripts/check-update.mjs**

- 读取本地 `package.json` / `plugin.json` version。
- 调用 `npm view spec-superflow version`。
- 输出结果并返回 0/1/2。

**Files**: `Create: scripts/check-update.mjs`

- [ ] **2.2 集成到 workflow-start**

在 `skills/workflow-start/SKILL.md` 中：
- 启动时运行 `node "${CLAUDE_PLUGIN_ROOT}/scripts/check-update.mjs"`。
- 退出码 1 时，在响应顶部加一行升级提示。

**Files**: `Modify: skills/workflow-start/SKILL.md`

- [ ] **2.3 提交 Batch 2**

```bash
git add scripts/check-update.mjs skills/workflow-start/SKILL.md
git commit -m "feat(workflow): add update check reminder on workflow start"
```

## 3. Batch 3: 文档、版本号与发布

- [ ] **3.1 更新 INSTALL.md**

- Cursor 部分写默认一键安装最新版命令。
- 保留 `--local` 说明。

**Files**: `Modify: INSTALL.md`

- [ ] **3.2 更新 README.md**

- 版本历史增加 v0.8.1。
- 版本号改为 v0.8.1。

**Files**: `Modify: README.md`

- [ ] **3.3 更新 CHANGELOG.md**

- 增加 v0.8.1 条目。

**Files**: `Modify: CHANGELOG.md`

- [ ] **3.4 版本号升级到 0.8.1**

```bash
node scripts/spec-superflow.mjs version 0.8.1
```

**Files**: `Modify: package.json`, `plugin.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/plugin.json`, `.codex-plugin/plugin.json`, `gemini-extension.json`

- [ ] **3.5 验证与测试**

```bash
node scripts/spec-superflow.mjs doctor
node scripts/spec-superflow.mjs validate changes/v0.8.1-auto-latest-install
npm run build
npm test
node scripts/install-cursor.mjs --local . --dry-run  # 如果支持
node scripts/check-update.mjs
```

**Files**: `Modify: dist/`

- [ ] **3.6 提交并发布**

```bash
git add -A
git commit -m "chore(release): bump to v0.8.1 with auto-latest install"
git tag v0.8.1
git push origin main v0.8.1
```

## 4. Batch 4: 收尾

- [ ] **4.1 生成 audit 与 phase-guard**

```bash
node scripts/spec-superflow.mjs audit changes/v0.8.1-auto-latest-install
node scripts/spec-superflow.mjs inject changes/v0.8.1-auto-latest-install
```

**Files**: `Create: changes/v0.8.1-auto-latest-install/decision-point-audit.md`

- [ ] **4.2 最终提交**

```bash
git add -A
git commit -m "chore(closure): audit and phase-guard for v0.8.1"
```
