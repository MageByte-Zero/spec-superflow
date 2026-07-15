# Install

`spec-superflow` 是一个自包含插件，**不需要**在运行时安装 OpenSpec 或 Superpowers。

源码血缘：

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) — 规划引擎（Schema 验证、Delta Spec、工件解析）
- [obra/superpowers](https://github.com/obra/superpowers) — 执行纪律（TDD 铁律、SDD、系统化调试、代码审查）

当前发布版本：**v0.9.1**。

---

## 平台总览

| 平台 | 安装 | 升级 | 卸载 |
|------|------|------|------|
| Claude Code | marketplace | `/plugin update` | `/plugin uninstall` |
| Cursor | skills 目录 / GitHub 导入 / 一键脚本 | 重新运行脚本 | 删除 `.cursor/skills/` |
| OpenAI Codex CLI | Plugin Directory / marketplace | marketplace refresh + re-add | `codex plugin remove` |
| OpenAI Codex App | Plugins 面板 / marketplace | CLI 更新后 App 面板启用 | App 面板禁用 |
| GitHub Copilot CLI | marketplace | `copilot plugin update` | `copilot plugin uninstall` |
| Gemini CLI | `gemini extensions install` | `gemini extensions update` | `gemini extensions uninstall` |
| OpenCode | plugin entry / skills 目录 | `git pull` | 删除 plugin/skills |
| WorkBuddy | `ssf install-workbuddy` | 重新运行安装器 | 删除 marketplace 插件并禁用 |
| Trae IDE / TRAE Work | `.trae/skills` / 上传 zip 或 .skill / marketplace | `git pull` + 重新导入 | UI 卸载或删除技能目录 |
| Cline | `ssf install-cline` | 重新运行脚本 | 删除 `.cline/skills/`、`.clinerules/` |
| Kiro | `ssf install-kiro` | 重新运行脚本 | 删除 `.kiro/skills/`、`.kiro/steering/` |
| Windsurf | `ssf install-windsurf` | 重新运行脚本 | 删除 `.windsurf/skills/`、`.windsurf/rules/` |
| Qwen Code | `ssf install-qwen` | 重新运行脚本 | 删除 `.qwen/skills/`、`.qwen/rules/` |
| Amazon Q Developer | `ssf install-amazon-q` | 重新运行脚本 | 删除 `.amazonq/skills/`、`.amazonq/rules/` |
| Roo Code | `ssf install-roocode` | 重新运行脚本 | 删除 `.roo/skills/`、`.roo/rules/` |
| Continue | `ssf install-continue` | 重新运行脚本 | 删除 `.continue/skills/`、`.continue/rules/` |
| Pi | `ssf install-pi` | 重新运行脚本 | 删除 `.pi/skills/` |
| ZCODE | `ssf install-zcode` | 重新运行脚本 | 删除 `.zcode/skills/`、`.zcode/rules/` |

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
codex plugin add spec-superflow@awesome-codex-plugins
```

### 直接安装指定 release tag

当社区 marketplace 镜像尚未同步时，可直接指定本仓库的 release tag：

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow --ref v0.9.0
codex plugin add spec-superflow@spec-superflow
```

这条路径绕过社区镜像延迟。

### 升级

```bash
codex plugin marketplace upgrade awesome-codex-plugins
codex plugin add spec-superflow@awesome-codex-plugins
codex plugin list | rg spec-superflow
```

### 卸载

```bash
codex plugin remove spec-superflow@awesome-codex-plugins
```

### 验证

```bash
codex plugin list | rg spec-superflow
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
codex plugin add spec-superflow@awesome-codex-plugins
```

然后**重启 Codex App**，在 **Plugins** 面板中启用 `spec-superflow`。

### 升级

```bash
codex plugin marketplace upgrade awesome-codex-plugins
codex plugin add spec-superflow@awesome-codex-plugins
codex plugin list | rg spec-superflow
```

更新后重启 Codex App 并新开会话；旧会话不会热加载 skills。

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

WorkBuddy 把 Skill 作为 marketplace 插件管理。安装器把 spec-superflow 部署为单个插件，包含 9 个 skill、运行时依赖（scripts/docs/templates/dist/hooks）、phase-guard 规则和 `.codebuddy-plugin/plugin.json` 清单，写入 `~/.workbuddy/plugins/marketplaces/<marketplace>/plugins/spec-superflow/`。

### 安装（推荐：一键脚本）

```bash
npx spec-superflow@latest install-workbuddy
```

本地仓库调试：

```bash
node /absolute/path/to/spec-superflow/scripts/spec-superflow.mjs install-workbuddy --local /absolute/path/to/spec-superflow
```

`--dry-run` 预览部署计划：

```bash
ssf install-workbuddy --dry-run
```

### 部署结构

```text
~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow/
├── .codebuddy-plugin/plugin.json   ← 插件清单（name, version, skills[]）
├── skills/                         ← 9 个 skill（${CLAUDE_PLUGIN_ROOT} 已重写）
├── rules/phase-guard.md            ← phase-guard 规则（WorkBuddy 自动加载）
├── scripts/  docs/  templates/     ← 运行时依赖
├── dist/  hooks/
```

`~/.workbuddy/settings.json` 中启用键为 `spec-superflow@cb_teams_marketplace`（单个键，非每 skill 一个）。

### 升级

重新运行安装命令即可覆盖旧插件并保留已有 `enabledPlugins` 配置。

### 卸载

```bash
rm -rf ~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow
```

然后从 `~/.workbuddy/settings.json` 的 `enabledPlugins` 中移除 `spec-superflow@cb_teams_marketplace`。

### 验证

```bash
ls ~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow/skills   # 应有 9 个 skill 目录
cat ~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow/rules/phase-guard.md
cat ~/.workbuddy/plugins/marketplaces/cb_teams_marketplace/plugins/spec-superflow/.codebuddy-plugin/plugin.json
```

重启 WorkBuddy 后，在对话中输入「用 workflow-start 开始」即可启动工作流。

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

## Cline

Cline 原生读取 `.clinerules/*.md` 作为常驻上下文。安装脚本部署 skills 到 `.cline/skills/`、运行时依赖到 `.cline/spec-superflow/`、phase-guard 规则到 `.clinerules/phase-guard.md`（Cline 自动加载，无需手动引用）。

### 安装

```bash
npx spec-superflow@latest install-cline
```

或从本地仓库（开发 / 离线）：

```bash
node scripts/install-cline.mjs --local /path/to/spec-superflow
```

### 升级

```bash
npx spec-superflow@latest install-cline
```

### 卸载

```bash
rm -rf .cline/skills .cline/spec-superflow .clinerules/phase-guard.md
```

### 验证

```bash
ls .cline/skills          # 应有 9 个 skill 目录
cat .clinerules/phase-guard.md
```

---

## Kiro

AWS Kiro IDE 读取 `.kiro/steering/*.md` 作为 steering 规则。安装脚本部署 skills 到 `.kiro/skills/`、运行时依赖到 `.kiro/spec-superflow/`、phase-guard 规则到 `.kiro/steering/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-kiro
```

### 升级

```bash
npx spec-superflow@latest install-kiro
```

### 卸载

```bash
rm -rf .kiro/skills .kiro/spec-superflow .kiro/steering/phase-guard.md
```

### 验证

```bash
ls .kiro/skills
cat .kiro/steering/phase-guard.md
```

---

## Windsurf

Codeium Windsurf 读取 `.windsurf/rules/*.md` 作为规则。安装脚本部署 skills 到 `.windsurf/skills/`、运行时依赖到 `.windsurf/spec-superflow/`、phase-guard 规则到 `.windsurf/rules/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-windsurf
```

### 升级 / 卸载 / 验证

```bash
# 升级
npx spec-superflow@latest install-windsurf
# 卸载
rm -rf .windsurf/skills .windsurf/spec-superflow .windsurf/rules/phase-guard.md
# 验证
ls .windsurf/skills && cat .windsurf/rules/phase-guard.md
```

---

## Qwen Code

Qwen Code CLI（Gemini CLI fork）读取 `.qwen/rules/*.md` 作为规则。安装脚本部署 skills 到 `.qwen/skills/`、运行时依赖到 `.qwen/spec-superflow/`、phase-guard 规则到 `.qwen/rules/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-qwen
```

### 升级 / 卸载 / 验证

```bash
npx spec-superflow@latest install-qwen
rm -rf .qwen/skills .qwen/spec-superflow .qwen/rules/phase-guard.md
ls .qwen/skills && cat .qwen/rules/phase-guard.md
```

---

## Amazon Q Developer

Amazon Q Developer CLI 读取 `.amazonq/rules/*.md` 作为规则。安装脚本部署 skills 到 `.amazonq/skills/`、运行时依赖到 `.amazonq/spec-superflow/`、phase-guard 规则到 `.amazonq/rules/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-amazon-q
```

### 升级 / 卸载 / 验证

```bash
npx spec-superflow@latest install-amazon-q
rm -rf .amazonq/skills .amazonq/spec-superflow .amazonq/rules/phase-guard.md
ls .amazonq/skills && cat .amazonq/rules/phase-guard.md
```

---

## Roo Code

Roo Code（Roo Cline）读取 `.roo/rules/*.md` 作为规则。安装脚本部署 skills 到 `.roo/skills/`、运行时依赖到 `.roo/spec-superflow/`、phase-guard 规则到 `.roo/rules/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-roocode
```

### 升级 / 卸载 / 验证

```bash
npx spec-superflow@latest install-roocode
rm -rf .roo/skills .roo/spec-superflow .roo/rules/phase-guard.md
ls .roo/skills && cat .roo/rules/phase-guard.md
```

---

## Continue

Continue（VS Code 扩展）读取 `.continue/rules/*.md` 作为规则。安装脚本部署 skills 到 `.continue/skills/`、运行时依赖到 `.continue/spec-superflow/`、phase-guard 规则到 `.continue/rules/phase-guard.md`。

### 安装

```bash
npx spec-superflow@latest install-continue
```

### 升级 / 卸载 / 验证

```bash
npx spec-superflow@latest install-continue
rm -rf .continue/skills .continue/spec-superflow .continue/rules/phase-guard.md
ls .continue/skills && cat .continue/rules/phase-guard.md
```

---

## Pi

Pi agent 从 `.pi/skills/`（全局 `.pi/agent/skills/`）读取技能。Pi 没有规则目录，安装脚本只部署 skills 到 `.pi/skills/`、运行时依赖到 `.pi/spec-superflow/`；启动工作流时需手动调用 `/workflow-start`。

### 安装

```bash
npx spec-superflow@latest install-pi
```

### 升级 / 卸载 / 验证

```bash
npx spec-superflow@latest install-pi
rm -rf .pi/skills .pi/spec-superflow
ls .pi/skills   # 应有 9 个 skill 目录
```

> Pi 无 phase-guard 规则自动注入，会话中请显式 `用 workflow-start 开始`。

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
│   └── <capability>/
│       └── spec.md
└── execution-contract.md
```

流程线：`proposal/specs/design/tasks -> execution-contract.md -> 用户批准 -> execution plan -> 开始实现`

规划本身不等于可以实现。如果 `execution-contract.md` 缺失、过时或未被用户批准，工作流会拒绝进入实现阶段。

### 受 guard 保护的执行计划

full/hotfix 在 DP-4 必须保存 current execution plan 到
`<change>/.superpowers/sdd/execution-plan.json`；它不属于 `execution-contract.md`。
SDD 是 default。只有用户明确选择 explicit override，才可改为 `inline` 或
`batch-inline`；Batch Inline 始终串行，不会自动成为默认模式或表示并行。`tweak`
免除 execution plan 与 review receipt gate。

```bash
ssf execution plan changes/my-change --mode sdd --reason "independent work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
ssf execution show changes/my-change --json
# 可将已有 inline/batch-inline 计划升级为 sdd，或重规划已有 sdd 的 wave/依赖；不能降级。
ssf execution revise changes/my-change --mode sdd --reason "need parallel work" \
  --wave foundation:parallel:1.1,1.2 \
  --wave integration:serial:2.1:foundation
ssf execution review changes/my-change --wave foundation --base <sha> --head <sha> \
  --report .superpowers/sdd/reviews/foundation.md --verdict pass
```

`--report` 相对于 `<change>` 解析，且必须位于
`<change>/.superpowers/sdd/reviews/` 之下。`--base` 和 `--head` 必须是该
`<change>` Git 工作树中的真实 commit，且 `base` 必须是 `head` 的祖先。
`<change>/.superpowers/sdd/reviews/` 的目录层级必须是物理、非符号链接目录；
report 本身必须为普通、非空、非符号链接文件。

每一个 wave 均须有当前 `pass` review receipt，才可启动依赖 wave 或进入 closing；
修订计划会废止旧 receipt。#47 所提出的恢复、切换与手动保存 slash command 尚未实现，
不能假定有 `/ssf:*` 命令。

Delta spec 的规范路径是 `specs/<capability>/spec.md`。扁平的 `specs/<capability>.md` 和根级 `specs/spec.md` 都不会被当作合法规范静默通过。

### `ssf inject` 用法

```bash
ssf inject changes/my-change --platforms cursor
ssf inject changes/my-change --platforms all
```

省略 `--platforms` 时，只有在项目里**恰好检测到一个**平台标记时才会自动注入；如果检测到多个平台，必须显式传 `--platforms <platform>` 或 `--platforms all`。

### 会话恢复与可选 prototype

```bash
ssf checkpoint save changes/my-change --task 1.1 --next "Run focused tests"
ssf checkpoint list changes/my-change
ssf checkpoint show changes/my-change 1.1
ssf handoff create changes/my-change --type research --objective "Compare approaches" --expected-output "Recommendation" --acceptance "Evidence recorded"
ssf handoff list changes/my-change
ssf handoff finish changes/my-change <handoff-id>
ssf handoff resolve changes/my-change <handoff-id> --decision accept
```

Checkpoint 是任务级恢复上下文。`result-ready` handoff 在继续受影响的工作前必须显式审阅并 resolve。Prototype 只在用户明确确认后创建；后端、CLI、配置和内部重构不会自动进入 prototype 流程。handoff 结果不会自动修改 `design.md` 或 `tasks.md`。

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

推荐流程：`exploring -> specifying -> bridging -> approved-for-build -> execution plan -> executing -> closing`

hotfix 快速路径：`exploring -> bridging -> approved-for-build -> executing`。hotfix 可以跳过完整的 `proposal.md`、`design.md`、`tasks.md`、`specs/`，但仍然必须先生成一份新的最小 `execution-contract.md`，并完成 DP-3 批准后才能开始实现。
