<h1 align="center">spec-superflow</h1>

<p align="center"><strong>轻量、可恢复、以证据收口的 AI 编程工作流</strong></p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://github.com/MageByte-Zero/spec-superflow/stargazers"><img src="https://img.shields.io/github/stars/MageByte-Zero/spec-superflow" alt="GitHub Stars"></a>
  <a href="https://www.npmjs.com/package/spec-superflow"><img src="https://img.shields.io/npm/v/spec-superflow" alt="npm version"></a>
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> · <a href="#两个执行路径">执行路径</a> · <a href="#安装">安装</a> · <a href="#命令">命令</a> · <a href="docs/README_en.md">English</a>
</p>

---

spec-superflow 把 OpenSpec 的结构化规划与 Superpowers 的验证纪律组合成一个自包含插件。v2 将新任务收敛为两个入口：明确的小改动直接执行，需要共同确认范围的改动先形成一份短计划再执行。

当前版本：`v2.0.0`

默认行为偏向低成本：当前会话内执行、最终审查一次、最终验证一次、普通调试留在执行阶段。子代理、逐波审查和 worktree 都需要显式选择。

## 为什么是 v2

旧流程把任务分成多个模式，并在规划、契约、执行和审查之间复制状态。复杂任务可以得到约束，但普通任务也会承担固定成本，状态或收据损坏时还可能反复回跳。

v2 删除新任务的模式问卷和手写 `execution-contract.md`，以一份执行计划作为授权事实源：

| 旧默认 | v2 默认 |
|---|---|
| 五种路径选择 | `direct` 或 `planned` |
| 四份规划文档 + 手写契约 | `proposal.md` + `tasks.md`；spec/design 按需 |
| 逐阶段确认 | planned 只确认一次具体计划 |
| SDD/子代理和逐任务审查 | 当前会话执行 + 最终审查 |
| 自动 worktree | 当前目录特性分支；worktree 显式启用 |
| 调试切换独立状态 | 普通诊断留在 `executing` |
| 多处缓存可阻塞计划 | schema v2 执行计划为事实源 |

已有变更继续按原来的状态、审批和审查证据恢复，不会被自动迁移或重置。

## 快速开始

要求 Node.js 20+。

```bash
npm install -g spec-superflow
mkdir -p changes/fix-login-timeout
```

目标、边界和验证方式已经明确时，直接执行：

```bash
ssf workflow start changes/fix-login-timeout \
  --path direct \
  --scope "修复登录超时，不改变认证协议"

ssf workflow complete changes/fix-login-timeout \
  --verification-command "npm test"
```

范围需要先对齐时，创建两份短文档：

```text
changes/add-session-refresh/
├── proposal.md   # 目标、边界、验收、风险
└── tasks.md      # 有序 checkbox 任务及其验证证据
```

用户批准这份具体计划后开始执行：

```bash
ssf workflow start changes/add-session-refresh \
  --path planned \
  --confirm \
  --reason "用户已批准 proposal.md 与 tasks.md"

ssf workflow complete changes/add-session-refresh \
  --verification-command "npm test"
```

`planned` 默认生成 `inline + final` 执行计划。只有明确需要委派时才增加 `--mode sdd`；只有确实需要独立目录时才运行 `ssf isolate <dir> --worktree`。

## 两个执行路径

### Direct

适合意图清楚、影响面可判断、验证可复现的改动。它不生成规划包、推荐收据或执行契约，只记录用户请求的范围和最终验证结果。

如果执行中发现范围扩大，补齐 `proposal.md` 和 `tasks.md`，再以一次明确批准升级到 `planned`，无需重开状态机。

### Planned

适合跨模块、公共接口、数据语义、安装器或状态机等需要先对齐的改动。

- `proposal.md`：目标、非目标、验收条件、主要风险。
- `tasks.md`：唯一编号的 checkbox 任务，每项写清完成证据。
- `specs/`：行为约束或发布基线需要更新时添加。
- `design.md`：存在真实技术取舍时添加。

实现默认在当前会话串行完成，最后审查完整 Git range。失败审查必须使用稳定 issue ID；同一问题连续三次仍未解决时才进入人工裁决，不把无关问题累计成死循环。

## 收口与恢复

`workflow complete` 会执行一次最终验证。planned 路径还会检查任务、最终审查和已有 delta spec 的同步状态。失败保持在执行阶段，修复后重试；不会把失败写成通过。

用户决定带着已知问题结束时，可以显式记录风险：

```bash
ssf workflow complete changes/example \
  --accept-risk \
  --confirm \
  --reason "接受已记录的兼容性限制，后续单独处理"
```

结果是 `accepted-risk`，原失败证据仍会保留，并且不会自动合并分支。

恢复已有任务：

```bash
ssf resume changes/example
ssf checkpoint list changes/example
```

缺失或损坏的授权、审查和 Git 证据会明确报错；工具不会用默认值伪造通过。完整状态与兼容规则见 [状态机文档](docs/state-machine.md)。

## Git 隔离

默认在当前 checkout 创建特性分支，减少目录切换和路径漂移：

```bash
ssf isolate changes/example
```

只有需要同时维护多个 checkout 时才使用 worktree：

```bash
ssf isolate changes/example --worktree
```

隔离信息会记录目标仓库、分支和路径；恢复时必须匹配这份记录。`ssf finish` 只处理已验证的隔离分支，验证失败会保留分支和工作目录供修复。

## 安装

### Claude Code

```bash
/plugin marketplace add MageByte-Zero/spec-superflow
/plugin install spec-superflow@spec-superflow
```

### OpenAI Codex CLI / App

```bash
codex plugin marketplace add MageByte-Zero/spec-superflow --ref v2.0.0
codex plugin add spec-superflow@spec-superflow
```

Codex 不启用 SessionStart 自动注入；请按需调用 `workflow-start`，或进入已有 spec-superflow change 后恢复。

### Cursor

```bash
npx spec-superflow@latest install-cursor
```

### GitHub Copilot CLI

```bash
copilot plugin marketplace add MageByte-Zero/spec-superflow
copilot plugin install spec-superflow@spec-superflow
```

### Gemini CLI

```bash
gemini extensions install https://github.com/MageByte-Zero/spec-superflow
```

项目支持 19 个 AI 编程平台。其他平台的安装器、目录和卸载方式见 [INSTALL.md](INSTALL.md)，能力差异见 [平台矩阵](docs/platform-matrix.md)。

## 命令

| 命令 | 用途 |
|---|---|
| `ssf workflow start <dir> --path direct|planned` | 启动新任务 |
| `ssf workflow complete <dir> ...` | 验证并记录交付结果 |
| `ssf isolate <dir> [--worktree]` | 创建特性分支或显式 worktree |
| `ssf resume [dir]` | 读取恢复上下文 |
| `ssf checkpoint save|list|show` | 保存或读取任务级恢复点 |
| `ssf validate <dir>` | 验证规划和 delta spec |
| `ssf sync <dir>` | 原子同步 delta spec 到发布基线 |
| `ssf doctor` | 检查安装、版本和资源一致性 |
| `ssf finish <dir>` | 验证并合并已记录的隔离分支 |

运行 `ssf --help` 查看完整命令。`workflow recommend/select/accept`、旧 execution plan 和八状态路由只用于恢复 v1 变更。

## 设计边界

- **按需规划**：小改动不承担完整 SDD 的固定成本。
- **单一授权源**：新 planned 任务由 schema v2 执行计划承载批准和执行模式。
- **证据优先**：空 Git range、截断范围、损坏 hash 或过期审查不能通过。
- **人类决策可见**：可接受风险，但必须留下理由，且不能伪造验证成功。
- **零运行时依赖**：CLI 使用 Node.js 标准库；TypeScript 仅用于构建。
- **按需加载**：普通会话不应被 SessionStart 或全局规则强制注入完整工作流。

项目借鉴 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 的规格组织与 [Superpowers](https://github.com/obra/superpowers) 的 TDD、调试和审查纪律，但运行时不依赖二者。

## 开发

```bash
npm install
npm run build
npm test
npm run validate
npm run check-versions
```

贡献说明见 [CONTRIBUTING.md](CONTRIBUTING.md)，版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## License

[MIT](LICENSE)
