# Install

`spec-superflow` is a self-contained plugin. You do not need to install OpenSpec or Superpowers at runtime.

Source lineage:

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [obra/superpowers](https://github.com/obra/superpowers)

Current release: `v0.8.1`. This repo tracks `spec-superflow` versions, not runtime dependency versions for the upstream projects.

## Claude Code

### Marketplace Install（推荐）

```
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
```

两行命令搞定。零拷贝、零配置。

### 升级到最新版

如果已经安装过，使用 update 命令升级到最新版：

```
/plugin update spec-superflow@spec-superflow
```

每次启动 workflow 时，`workflow-start` 也会检查版本并提示是否需要升级。

### 本地安装

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
```

在 Claude Code 中执行：

```
/plugin install file:/absolute/path/to/spec-superflow
```

## Cursor

Cursor 不会自动加载 `.cursor-plugin/plugin.json` 中的 `skills`，需要通过本地部署方式安装。

### 自动部署最新版（推荐）

下载并运行安装脚本，它会自动从 GitHub latest release 拉取最新版并部署到 `.cursor/`：

```bash
# 下载脚本到临时目录并执行
curl -fsSL https://raw.githubusercontent.com/MageByte-Zero/spec-superflow/main/scripts/install-cursor.mjs -o /tmp/install-cursor.mjs
node /tmp/install-cursor.mjs
```

脚本会完成：
- 从 GitHub latest release 下载 spec-superflow
- 把 `skills/` 复制到 `.cursor/skills/`
- 生成 `.cursor/rules/phase-guard.mdc`（alwaysApply）

`.cursor/` 是本地生成目录，已加入 `.gitignore`，不需要提交到仓库。

### 从本地仓库部署（开发/测试）

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
# 然后手动创建 phase-guard.mdc，内容可参考 scripts/install-cursor.mjs
```

### 验证

在 Cursor Agent 中输入：

```
/workflow-start
```

如果能看到技能被调用，说明安装成功。

## OpenAI Codex CLI

`spec-superflow` 不在 OpenAI curated 目录中。先把本仓库添加为 Codex marketplace：

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow
codex plugin add spec-superflow@spec-superflow
```

验证：

```bash
codex plugin list | grep spec-superflow
```

## OpenAI Codex App

Codex App 使用同一套本地 marketplace 配置。先执行 Codex CLI 安装命令：

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow
codex plugin add spec-superflow@spec-superflow
```

然后重启 Codex App，在 **Plugins** 面板里切换到 `spec-superflow` marketplace，即可看到并启用插件。

## OpenCode

OpenCode 使用本地 skills 发现方式。仓库已提供 `.agents/skills -> ../skills` 入口，所以在本仓库中打开 OpenCode 时可直接发现技能。

在其它项目中使用时，把本仓库的 `skills/` 复制或 symlink 到目标项目的 `.agents/skills`：

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p your-project/.agents
ln -s /absolute/path/to/spec-superflow/skills your-project/.agents/skills
```

详细说明见 [.opencode/INSTALL.md](.opencode/INSTALL.md)。

## GitHub Copilot CLI

Copilot CLI 会从仓库根目录的 `plugin.json` 和 `.claude-plugin/marketplace.json` 识别插件（后者被包含在官方支持的 marketplace 路径列表中）。

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow
copilot plugin install spec-superflow@spec-superflow
```

如果安装失败，请检查根目录 `plugin.json` 的 `author` 字段是否为对象（`{ "name": "..." }`），而不是字符串。

## Gemini CLI

```
gemini extensions install https://github.com/MageByte-Zero/spec-superflow
```

更新：

```
gemini extensions update spec-superflow
```

## Trae

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
mkdir -p ~/.trae/skills
cp -R spec-superflow/skills/* ~/.trae/skills/
```

## Qoder / Trae CN / Other Local Skill Clients

If your client can point to a local `skills/` directory, use the same repository clone and map `spec-superflow/skills` into the client-specific skill location.

Typical flow:

```bash
git clone https://github.com/MageByte-Zero/spec-superflow.git
```

Then configure your client to load skills from:

- `<repo>/skills`
- or a client-specific local skills directory that symlinks/copies from `<repo>/skills`

---

## 使用

安装完成后，告诉 Agent：

```
用 workflow-start 开始
```

`workflow-start` 会检查当前工件目录，判断你处于探索 / 规格 / 桥接 / 执行 / 收口的哪个阶段，然后自动路由到正确的下一个 skill。

- 启动新的变更 → "用 workflow-start 开始"
- 恢复旧的变更 → "继续上次的工作流"
- 不确定当前状态 → "帮我看看现在该干什么"

## 工作流目录约定

对于名为 `<change-name>` 的变更：

```text
workflow/
└── changes/<change-name>/
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
