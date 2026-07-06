# Install

`spec-superflow` 是一个自包含插件，**不需要**在运行时安装 OpenSpec 或 Superpowers。

源码血缘：

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎（Schema 验证、Delta Spec、工件解析）
- [obra/superpowers](https://github.com/obra/superpowers) — 执行纪律（TDD 铁律、SDD、系统化调试、代码审查）

当前发布版本：**v0.8.12**。

---

## 平台总览

| 平台 | 安装 | 升级 | 卸载 |
|------|------|------|------|
| Claude Code | marketplace | `/plugin update` | `/plugin uninstall` |
| Cursor | skills 目录 / GitHub 导入 / 一键脚本 | 重新运行脚本 | 删除 `.cursor/skills/` |
| OpenAI Codex CLI | Plugin Directory / marketplace | `codex plugin update` | `codex plugin remove` |
| OpenAI Codex App | Plugins 面板 / marketplace | CLI 更新后 App 面板启用 | App 面板禁用 |
| GitHub Copilot CLI | marketplace | `copilot plugin update` | `copilot plugin uninstall` |
| Gemini CLI | `gemini extensions install` | `gemini extensions update` | `gemini extensions uninstall` |
| OpenCode | plugin entry / skills 目录 | `git pull` | 删除 plugin/skills |
| WorkBuddy | `ssf install-workbuddy` | 重新运行安装器 | 删除 marketplace 插件并禁用 |
| Trae IDE / TRAE Work | `.trae/skills` / 上传 zip 或 .skill / marketplace | `git pull` + 重新导入 | UI 卸载或删除技能目录 |

---

## Claude Code

### 安装（推荐：Marketplace）

```bash
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
```

两行命令搞定。零拷贝、零配置。安装后自动加载 `hooks/hooks.json`，每次新会话自动注入上下文。

### 升级

```bash
/plugin update spec-superflow@spec-superflow
```

另外，每次启动 workflow 时，`workflow-start` 也会检查版本并提示是否需要升级。

### 卸载

```bash
/plugin uninstall spec-superflow@spec-superflow
```

### 本地安装（开发 / 离线）

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git

# 在 Claude Code 中执行：
/plugin install file:/absolute/path/to/spec-superflow
```

---

## Cursor

Cursor 原生发现 `.cursor/skills/`、`.agents/skills/`、`~/.cursor/skills/`，并兼容 `.claude/skills/`、`.codex/skills/` 等目录。安装脚本会把 `skills/` 复制到 `.cursor/skills/`，并生成 `.cursor/rules/phase-guard.mdc`（`alwaysApply: true`）。

### 安装（推荐：一键脚本）

```bash
curl -fsSL https://raw.githubusercontent.com/MageByte-Zero/spec-superflow/main/scripts/install-cursor.mjs | node -
```

脚本会自动从 GitHub latest release 拉取最新版。

### 升级

重新运行安装命令即可（自动覆盖旧文件）：

```bash
curl -fsSL https://raw.githubusercontent.com/MageByte-Zero/spec-superflow/main/scripts/install-cursor.mjs | node -
```

### 卸载

```bash
rm -rf .cursor/skills/
rm -f .cursor/rules/phase-guard.mdc
```

> `.cursor/` 是本地生成目录，已在 `.gitignore` 中，不需要提交到仓库。

### 从本地仓库部署（开发 / 测试）

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
cd your-project
node /absolute/path/to/spec-superflow/scripts/install-cursor.mjs --local /absolute/path/to/spec-superflow
```

### 手动部署

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p .cursor/skills
cp -R /absolute/path/to/spec-superflow/skills/* .cursor/skills/
mkdir -p .cursor/rules
# 手动创建 phase-guard.mdc，内容参考 scripts/install-cursor.mjs
```

### Session-Start Hook（Cursor）

安装脚本会自动把 `hooks/hooks-cursor.json` 写入 `.cursor/hooks.json`。如果手动部署，需要自行复制：

```bash
cp /path/to/spec-superflow/hooks/hooks-cursor.json .cursor/hooks.json
```

### GitHub 导入

也可以在 Cursor 的 **Customize → Rules → Add Rule → Remote Rule (Github)** 中输入仓库 URL 导入。对于需要 `scripts/`、`docs/`、`templates/` 的完整工作流，仍推荐一键脚本。

### 验证

在 Cursor Agent 中输入：

```
/workflow-start
```

如果能被调用，说明安装成功。

---

## OpenAI Codex CLI

Codex CLI 的主流方式是打开 `/plugins` 插件目录安装；自动化或社区分发场景使用 `codex plugin marketplace add`。

### 安装（推荐：插件目录）

```bash
codex
/plugins
```

在插件目录中切换到相应 marketplace，选择 `spec-superflow` 并安装。

### 安装（命令行 marketplace）

```bash
codex plugin marketplace add hashgraph-online/awesome-codex-plugins
codex plugin add spec-superflow@spec-superflow
```

### 升级

```bash
codex plugin update spec-superflow
```

### 卸载

```bash
codex plugin remove spec-superflow
```

### 验证

```bash
codex plugin list | grep spec-superflow
```

---

## OpenAI Codex App

Codex App 的主流方式是 **Plugins** 面板。仓库已提供 `.codex-plugin/plugin.json` 和 `.agents/plugins/marketplace.json`，可被 Codex marketplace/目录读取。

### 安装（推荐：App 面板）

打开 **Plugins**，搜索或切换到对应 marketplace，选择 `spec-superflow`，点击 **Add to Codex** / install。

### 安装（CLI 预装）

先通过 CLI 添加 marketplace 和插件：

```bash
codex plugin marketplace add hashgraph-online/awesome-codex-plugins
codex plugin add spec-superflow@spec-superflow
```

然后**重启 Codex App**，在 **Plugins** 面板中启用 `spec-superflow`。

### 升级

```bash
codex plugin update spec-superflow
```

更新后重启 Codex App。

### 卸载

在 Codex App 的 **Plugins** 面板中禁用即可。也可以 CLI 移除：

```bash
codex plugin remove spec-superflow
```

---

## GitHub Copilot CLI

Copilot CLI 的主流方式是 marketplace。仓库已提供根目录 `plugin.json` 和 `.github/plugin/marketplace.json`；Copilot CLI 也兼容 `.claude-plugin/marketplace.json`。

### 安装

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow
copilot plugin install spec-superflow@spec-superflow
```

### 升级

```bash
copilot plugin update spec-superflow
```

### 卸载

```bash
copilot plugin uninstall spec-superflow
```

> 如果安装失败，请检查根目录 `plugin.json` 的 `author` 字段是否为对象格式（`{ "name": "..." }`），而非字符串。

---

## Gemini CLI

### 安装

```bash
gemini extensions install https://github.com/MageByte-Zero/spec-superflow
```

### 升级

```bash
gemini extensions update spec-superflow
```

### 卸载

```bash
gemini extensions uninstall spec-superflow
```

---

## OpenCode

OpenCode 支持本地 plugin 文件和 Agent Skills 目录。仓库已提供 `.opencode/plugins/spec-superflow.js` 插件入口，以及 `.agents/skills -> ../skills` 兼容入口。

### 安装（推荐：Plugin Mode）

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
```

在 OpenCode 的插件配置或 UI 中指向仓库内的插件文件：

```text
/absolute/path/to/spec-superflow/.opencode/plugins/spec-superflow.js
```

不要只复制这个 `.js` 文件到另一个项目；它会按相对路径读取仓库里的 `skills/` 和 `GEMINI.md`。如果希望项目内零配置，使用下面的 skills symlink 方式。

### 安装（Skills Symlink）

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p your-project/.agents
ln -s /absolute/path/to/spec-superflow/skills your-project/.agents/skills
```

如果 symlink 不方便，直接复制：

```bash
mkdir -p your-project/.agents
cp -R /absolute/path/to/spec-superflow/skills your-project/.agents/skills
```

### 升级

```bash
cd /path/to/spec-superflow && git pull
```

如果用的是复制而非 symlink，升级后需要重新复制。

### 卸载

```bash
rm -rf your-project/.agents/skills
```

详细说明见 [.opencode/INSTALL.md](.opencode/INSTALL.md)。

---

## WorkBuddy

WorkBuddy 把 Skill 作为插件管理：Skill 文件需要进入 WorkBuddy marketplace 的 `plugins/` 目录，并在 `~/.workbuddy/settings.json` 中启用。安装器默认写入 `cb_teams_marketplace`。

### 安装（推荐：一键脚本）

```bash
npx spec-superflow@latest install-workbuddy
```

本地仓库调试：

```bash
node /absolute/path/to/spec-superflow/scripts/spec-superflow.mjs install-workbuddy --local /absolute/path/to/spec-superflow
```

### 升级

重新运行安装命令即可覆盖旧技能并保留已有 `enabledPlugins` 配置。

### 卸载

删除 WorkBuddy marketplace 中的 spec-superflow skill 目录，并从 `~/.workbuddy/settings.json` 的 `enabledPlugins` 中移除对应键：

```text
workflow-start@cb_teams_marketplace
need-explorer@cb_teams_marketplace
spec-writer@cb_teams_marketplace
contract-builder@cb_teams_marketplace
build-executor@cb_teams_marketplace
bug-investigator@cb_teams_marketplace
code-reviewer@cb_teams_marketplace
release-archivist@cb_teams_marketplace
spec-merger@cb_teams_marketplace
```

---

## Trae

Trae IDE / TRAE Work 原生支持 `SKILL.md`。项目技能目录是 `.trae/skills/`，全局技能目录是 `~/.trae/skills/`；TRAE Work 也支持上传包含根级 `SKILL.md` 的 zip 或 `.skill` 文件，并可从内置 skill marketplace 安装。

### 安装（本地目录）

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p .trae/skills
cp -R spec-superflow/skills/* .trae/skills/
```

全局安装：

```bash
mkdir -p ~/.trae/skills
cp -R spec-superflow/skills/* ~/.trae/skills/
```

### 升级

```bash
cd /path/to/spec-superflow && git pull
cp -R skills/* ~/.trae/skills/
```

### 卸载

```bash
rm -rf .trae/skills/
rm -rf ~/.trae/skills/
```

---

## Qoder / Trae CN / 其他本地技能客户端

任何支持本地 `skills/` 目录的客户端，都可以用同样方式接入：

### 安装

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
```

然后配置客户端从以下路径加载技能：

- `<repo>/skills`（直接指向仓库）
- 或复制 / symlink 到客户端指定的技能目录

### 升级

```bash
cd /path/to/spec-superflow && git pull
```

如果用的是复制方式，升级后需要重新复制到客户端技能目录。

### 卸载

删除客户端技能目录中的 spec-superflow 技能即可。

---

## 使用

安装完成后，告诉 Agent：

```
用 workflow-start 开始
```

`workflow-start` 会检查当前工件目录，判断你处于探索 / 规格 / 桥接 / 执行 / 收口的哪个阶段，然后自动路由到正确的下一个 skill。

- 启动新的变更 → `用 workflow-start 开始`
- 恢复旧的变更 → `继续上次的工作流`
- 不确定当前状态 → `帮我看看现在该干什么`

## 工作流目录约定

对于名为 `<change-name>` 的变更：

```text
changes/<change-name>/
├── proposal.md
├── design.md
├── tasks.md
├── specs/
│   └── <capability>.md
└── execution-contract.md
```

流程线：`proposal/specs/design/tasks -> execution-contract.md -> 用户批准 -> 开始实现`

规划本身不等于可以实现。如果 `execution-contract.md` 缺失、过时或未被用户批准，工作流会拒绝进入实现阶段。

## 验证

安装后验证：

- `workflow-start` skill 已可用
- 其余 8 个 skill 全部可见

## 故障排查

### Agent 找不到 skill

- 检查 skill 目录名是否与 skill 名一致
- 检查目录下是否存在 `SKILL.md`

### 工作流过早开始实现

从 `workflow-start` 入口开始，不要直接调用 `build-executor`。

推荐流程：`exploring -> specifying -> bridging -> approved-for-build -> executing -> closing`
