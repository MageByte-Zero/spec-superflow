# Install

`spec-superflow` 是一个自包含插件，**不需要**在运行时安装 OpenSpec 或 Superpowers。

源码血缘：

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎（Schema 验证、Delta Spec、工件解析）
- [obra/superpowers](https://github.com/obra/superpowers) — 执行纪律（TDD 铁律、SDD、系统化调试、代码审查）

当前发布版本：**v0.8.6**。

---

## 平台总览

| 平台 | 安装 | 升级 | 卸载 |
|------|------|------|------|
| Claude Code | marketplace | `/plugin update` | `/plugin uninstall` |
| Cursor | curl 一键脚本 | 重新运行脚本 | 删除 `.cursor/skills/` |
| OpenAI Codex CLI | marketplace | `codex plugin update` | `codex plugin remove` |
| OpenAI Codex App | CLI + App 面板 | CLI 更新 | App 面板禁用 |
| GitHub Copilot CLI | marketplace | `copilot plugin update` | `copilot plugin uninstall` |
| Gemini CLI | `gemini extensions install` | `gemini extensions update` | `gemini extensions uninstall` |
| OpenCode | clone + symlink | `git pull` | 删除 symlink |
| Trae / 其他本地客户端 | clone + copy | `git pull` + 重新 copy | 删除技能目录 |

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

Cursor 通过本地文件部署方式使用 spec-superflow。安装脚本会把 `skills/` 复制到 `.cursor/skills/`，并生成 `.cursor/rules/phase-guard.mdc`（`alwaysApply: true`）。

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

### 验证

在 Cursor Agent 中输入：

```
/workflow-start
```

如果能被调用，说明安装成功。

---

## OpenAI Codex CLI

`spec-superflow` 通过社区 marketplace 提供，PR 已提交至 [awesome-codex-plugins](https://github.com/hashgraph-online/awesome-codex-plugins)。

### 安装

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

Codex App 使用同一套本地 marketplace 配置。

### 安装

先通过 CLI 添加 marketplace 和插件：

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow
codex plugin add spec-superflow@spec-superflow
```

然后**重启 Codex App**，在 **Plugins** 面板中即可看到并启用 `spec-superflow`。

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

Copilot CLI 从仓库根目录的 `plugin.json` 和 `.claude-plugin/marketplace.json` 识别插件。

### 安装

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow-marketplace
copilot plugin install spec-superflow@spec-superflow-marketplace
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

OpenCode 使用本地 skills 发现方式。仓库已提供 `.agents/skills -> ../skills` 入口，在本仓库中打开 OpenCode 时可直接发现技能。

### 安装

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

## Trae

### 安装

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p ~/.trae/skills
cp -R spec-superflow/skills/* ~/.trae/skills/
```

### 升级

```bash
cd /path/to/spec-superflow && git pull
cp -R spec-superflow/skills/* ~/.trae/skills/
```

### 卸载

```bash
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
