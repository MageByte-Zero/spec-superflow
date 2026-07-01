<h1 align="center">spec-superflow</h1>

<p align="center">
  <strong>源码级融合 OpenSpec 规划引擎 + Superpowers 执行纪律的 AI 编程工作流插件</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="INSTALL.md"><img src="https://img.shields.io/badge/multi--agent-supported-green.svg" alt="Multi-agent supported"></a>
  <a href="https://github.com/MageByte-Zero/spec-superflow/stargazers"><img src="https://img.shields.io/github/stars/MageByte-Zero/spec-superflow" alt="GitHub Stars"></a>
</p>

<p align="center">
  <a href="#为什么需要它">为什么需要它</a> |
  <a href="#推荐使用方式">使用方式</a> |
  <a href="docs/README_en.md">English</a> |
  <a href="docs/showcase.html">Showcase</a> |
  <a href="#核心-skills">Skills</a> |
  <a href="#快速开始">快速开始</a> |
  <a href="#工作流">工作流</a> |
  <a href="#常见问题">FAQ</a>
</p>

---

## 为什么需要它

用 AI 写代码时，最常碰到两个失控点：

- **还没想清楚要做什么，AI 就开始写代码。** 你说了句"帮我加个权限控制"，它就开始改几十个文件。改到一半才发现 —— 到底要 RBAC 还是 ABAC？

- **规划文档写得明明白白，但执行阶段还是会跑偏。** proposal 写了、design 画了，但实现过程中没人盯着测试、没人卡 review，等到合并才发现行为不对。

**spec-superflow 在两个失控点之间用源码级的引擎 + 桥接协议建立起一道硬墙：**

`need-explorer` 先把需求问清楚 -> `spec-writer` 把意图沉淀为正式工件（Schema 引擎验证格式）-> `contract-builder` 把规划压缩成执行契约 `execution-contract.md` -> `build-executor` 以 TDD + SDD + Review Gate 三重纪律强制执行 -> `bug-investigator` 处理执行中的阻塞 -> `code-reviewer` 审查每批产出 -> `release-archivist` 验证后收口 -> `spec-merger` 同步 delta spec 防止规范腐烂。

它不是把 OpenSpec 和 Superpowers 并排安装再手工拼接，而是把两者的核心引擎和能力**吸收进一个自包含的工作流 owner**。

| 设计原则 | 说明 |
|---|---|
| Spec First | 没有稳定的规划工件，不允许进入实现 |
| Guarded Handoff | `execution-contract.md` 是规划到实现的唯一交接层 |
| Strong Guardrails | 实现过程中违反契约的行为被明确拦截并回退 |
| Schema Validated | 规划期工件经过 Schema 引擎验证，不合格不允许进入桥接 |
| Execute Disciplined | TDD 铁律 + SDD 子代理驱动 + Review Gate 双重审查 |
| Self-Contained | 不需要运行时安装 OpenSpec 或 Superpowers，一个插件全包 |

## 适用场景

### ✅ 推荐使用

| 场景 | 原因 |
|------|------|
| **大型功能开发** | 需要明确的规划、审查、测试门禁，防止实现偏离设计 |
| **多人协作项目** | `execution-contract.md` 提供明确的协作合约和审查标准 |
| **长期维护项目** | `spec-merger` 防止规范腐烂，delta spec 机制支持持续演进 |
| **需要 TDD + Review Gate** | 内置 TDD 铁律 + SDD 子代理驱动 + 双重审查 |
| **棕地项目（brownfield）** | need-explorer 先检查现有代码，再规划变更 |
| **需要规划稳定性检查** | contract-builder 确保规划稳定后才进入实现 |

### ❌ 不推荐使用

| 场景 | 原因 | 建议 |
|------|------|------|
| **快速原型 / Demo** | 工作流太重，token 消耗大 | 直接用 Claude Code 默认行为 |
| **探索性开发** | 规划会频繁变化，合约会反复失效 | 用 `need-explorer` 单 skill，不走完整流程 |
| **个人实验项目** | 审查门禁和归档流程是负担 | 用 Superpowers 或 OpenSpec 单一框架 |
| **学习/实验新工具** | 工作流会限制探索自由度 | 直接动手实验 |

### 💡 经验法则

> **v0.7.0 起，自动模式检测会让 hotfix/tweak 级别的小变更自动走轻量流程，不再把轻微场景排除在外。**
>
> 简单判断：如果你会在团队周会上花 5 分钟以上解释这个改动，那 spec-superflow 是值得的。

## 推荐使用方式

### 入口永远从这里开始

**触发入口是 `workflow-start`。**

每次开始或恢复一个变更，你只需要告诉 Agent 一句话：

```
用 workflow-start 开始
```

`workflow-start` 会检查当前工件目录，**内容级检测**（不只是检查文件是否存在，还比较 proposal 范围 vs 契约意图锁），判断你处于哪个阶段，然后自动路由到正确的下一个 skill。

### 完整流程：一次贯穿 7 个状态

```text
你说"帮我加一个权限控制"
       │
       ▼
┌──────────────────┐
│ workflow-start  │  ← 唯一入口。内容级状态检测、路由到正确 skill
└──────┬───────────┘
       │
       ▼
   exploring         need-explorer 追问："你要 RBAC 还是 ABAC？" "多大粒度？"
       │                  一次一个问题，2-3 方案对比，推荐最佳并解释原因
       ▼
   specifying        spec-writer 产出 4 份工件 + Schema 引擎实时验证
       │                  proposal + specs + design + tasks
       │                  不合格 → 拒绝，指出问题 → 修订后重新验证
       ▼
   bridging          contract-builder 解析引擎自动提取 → 压缩为 execution-contract.md
       │                 ┌────────────────────────────────────────────┐
       │                 │ execution-contract.md                      │
       │                 │  - Intent Lock (从 proposal 自动提取)      │
       │                 │  - Approved Behavior (从 specs 自动提取)   │
       │                 │  - Design Constraints (从 design 自动提取) │
       │                 │  - Task Batches (从 tasks 自动提取)         │
       │                 │  - Test Obligations & Review Gates          │
       │                 └────────────────────────────────────────────┘
       │
  ◇ 用户批准 ◇        ← 唯一一次人工介入：你看一眼，确认，然后说"批准"
       │
       ▼
   executing         build-executor
       │                 ├─ TDD 铁律: NO PRODUCTION CODE WITHOUT FAILING TEST
       │                 ├─ SDD: 子代理实施 → 双重审查(spec合规+代码质量) → 修复 → 重新审查
       │                 ├─ Review Gate: 每批次完成后 code-reviewer 审查
       │                 └─ 进度台账: .superpowers/sdd/progress.md 防会话压缩丢失
       │
       ├──[遇到 bug]──→ debugging
       │                 bug-investigator
       │                 4 阶段根因分析: 根因 → 模式分析 → 假设验证 → 实现修复
       │                 3+ 次修复失败 → 质疑架构 → 升给用户
       │
       ▼
   closing           release-archivist
       │                 验证前完成铁律: NO COMPLETION CLAIMS WITHOUT FRESH EVIDENCE
       │                 运行测试 → 读输出 → 确认通过 → 才说完成
       │
       ▼
   syncing           spec-merger (如果存在 delta spec)
                         ADDED/MODIFIED/REMOVED/RENAMED → 智能合并到主规范
                         冲突检测: 多个变更同时改同一个 capability
```

**关键约束：**

- 没有 `execution-contract.md` 或未被用户批准 → **不允许进入实现**
- 实现中违反契约 → **拦截并回退**，不是靠开发者"感觉不对"来手动纠偏
- 需求变更 → **强制回退到 `specifying` 或 `bridging`**，不在执行阶段悄悄改
- 遇到 bug → **强制走 debugging 状态**，不允许"随便试试看能不能修"

### 为什么它厉害：真正的源码级融合

市面上 AI 编程工作流基本是两派：

| 流派 | 代表 | 优势 | 短板 |
|---|---|---|---|
| 规划派 | OpenSpec | 产出清晰的 proposal、specs、design、tasks，有 Schema 验证引擎 | 只管写文档，不管执行。文档写完了，实现阶段还是裸奔 |
| 纪律派 | Superpowers | TDD、SDD、review gate、系统化调试、验证铁律 | 没有正式的规划工件层和 Schema 验证，对"需求是否已经明确"缺乏硬判断 |

**spec-superflow 不是"两边都装"，而是"去重叠、留异同、加独创"：**

```text
OpenSpec 独有 ──────→ 吸收             Superpowers 独有 ──────→ 吸收
  Schema 引擎                    TDD 铁律 (RED-GREEN-REFACTOR)
  Delta Spec (ADDED/MODIFIED)    SDD (子代理驱动 + 双层审查)
  三维度验证 (verify-change)      系统化调试 (4 阶段根因分析)
  Spec 同步 (sync-specs)          结构化代码审查 (三级问题分级)
  批量归档冲突解决                 验证前完成铁律
                                  并行代理调度
                                        │
┌───────────────────────────────────────┼───────────────────────────────────────┐
│                              spec-superflow 独创                              │
│                                                                              │
│  🔗 桥接层 execution-contract.md — 解析引擎自动提取 4 工件 → 1 份可检查契约    │
│  🧭 内容级状态检测 — 不只是检查文件存在，还比较 proposal scope vs contract lock │
│  🚦 7 状态机 — exploring/specifying/bridging/approved/executing/debugging/closing  │
│  🧩 9 skill 协同 — 入口路由 → 澄清 → 锻造 → 桥接 → 执行 ⇄ 调试 → 审查 → 收口 → 同步  │
│                                                                              │
│  每个 skill 背后有真实的引擎代码：                                              │
│  - src/schema/       ← OpenSpec 基因: Requirement, Delta, Spec 类型定义       │
│  - src/validation/   ← OpenSpec 基因: 验证器 (SHALL/MUST, Scenario, Delta)    │
│  - src/parsing/      ← OpenSpec 基因: Requirement 块解析 + Delta Spec 解析     │
│  - scripts/          ← Superpowers 基因: task-brief, review-package 辅助工具  │
│  - hooks/            ← Superpowers 基因: session-start 多平台引导注入          │
│  - implementer/reviewer 模板 ← Superpowers 基因: SDD 双层审查提示模板           │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 核心 Skills

| # | Skill | 阶段 | 职责 | 来源 |
|---|---|---|---|---|
| 1 | `workflow-start` | 入口 | 内容级状态检测、7 状态路由、阻止非法跳转 | **独创** |
| 2 | `need-explorer` | 探索 | 一次一问+方案对比+推荐。嵌入 brainstorming 提问法 | 融合增强 |
| 3 | `spec-writer` | 规格 | 产出 proposal/specs/design/tasks。Schema 引擎实时验证 + writing-plans 粒度 | 融合增强 |
| 4 | `contract-builder` | 桥接 | 解析引擎自动提取 4 工件 → 压缩为 execution-contract.md | **独创** |
| 5 | `build-executor` | 执行 | TDD 铁律 + SDD 子代理驱动 + Review Gate。内嵌 implementer/reviewer 模板 | 融合增强 |
| 6 | `bug-investigator` | 调试 | 4 阶段根因调试。3+ 修复失败 → 质疑架构 | ← Superpowers |
| 7 | `code-reviewer` | 审查 | 结构化审查，三级问题分级，禁止表演性同意 | ← Superpowers |
| 8 | `release-archivist` | 收口 | 验证前完成铁律 + 归档 + 风险总结 | 融合增强 |
| 9 | `spec-merger` | 同步 | Delta Spec (ADDED/MODIFIED/REMOVED/RENAMED) → 主规范智能合并 | ← OpenSpec |

## 快速开始

### 安装

官方直接支持 **Claude Code / Cursor / OpenAI Codex CLI / OpenAI Codex App / GitHub Copilot CLI / Gemini CLI**。

另外，任何支持本地 `skills/` 目录的客户端，都可以用“通用本地安装”方式接入，例如 OpenCode、Trae、Qoder、Trae CN，或其他可配置技能目录的 IDE。

| 平台 | 安装方式 | 备注 |
|---|---|---|
| Claude Code | `/plugin marketplace add MageByte-Zero/spec-superflow` + `/plugin install spec-superflow@spec-superflow` | 推荐，零拷贝 |
| Cursor | `node /path/to/spec-superflow/scripts/install-cursor.mjs` | 把 skills 部署到 `.cursor/skills/`，生成 `.cursor/rules/phase-guard.mdc` |
| OpenAI Codex CLI | `codex plugin marketplace add MageByte-Zero/spec-superflow` + `codex plugin add spec-superflow@spec-superflow` | 已补 `.codex-plugin/` 和 `.agents/plugins/` |
| OpenAI Codex App | 先用 CLI 添加 marketplace，再从 `Plugins` 面板安装/启用 | 不在 OpenAI curated 目录里 |
| GitHub Copilot CLI | `copilot plugin marketplace add ...` + `copilot plugin install ...` | 从 `plugin.json` + `.claude-plugin/marketplace.json` 识别 |
| Gemini CLI | `gemini extensions install https://github.com/MageByte-Zero/spec-superflow` | 支持 `update` |
| OpenCode / Trae / Qoder / Trae CN / 其他本地技能客户端 | 克隆仓库后把 `skills/` 指向客户端的本地技能目录 | 本仓库提供 `.agents/skills -> ../skills` 入口 |

所有平台安装方式见 [INSTALL.md](INSTALL.md)。

### 版本说明

- 当前发布版本：`v0.8.1`
- `spec-superflow` 是自包含插件，不需要在运行时单独安装 OpenSpec 或 Superpowers
- 上游能力来源分别是 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) 和 [obra/superpowers](https://github.com/obra/superpowers)
- 本仓库不把 OpenSpec / Superpowers 当作运行时依赖来锁定版本号；如果你想看每个版本吸收了哪些上游能力，请直接看 `CHANGELOG.md`
- 发布说明会按 `spec-superflow` 版本记录功能基线，而不是要求用户先安装上游工具

### Session-Start Hook（可选但推荐）

- **Claude Code**：自动加载仓库根目录的 `hooks/hooks.json`。
- **Cursor**：把 `hooks/hooks-cursor.json` 复制到目标项目的 `.cursor/hooks.json`（Cursor 只识别 `.cursor/` 下的 hooks）。

这样每次新会话开始时，Agent 自动知道 spec-superflow 已就绪。

### 使用

安装完成后，告诉 Agent：

- 启动新的变更 → "用 workflow-start 开始"
- 恢复旧的变更 → "继续上次的工作流"
- 不确定当前状态 → "帮我看看现在该干什么"

Agent 会自动检查当前工件，**内容级判断**处于哪个阶段。

### CLI 工具链

除了 skill 工作流，spec-superflow 还提供独立的 CLI 工具：

```bash
# 全局安装后可直接使用 ssf 命令
npm install -g spec-superflow

# 或在项目中通过 npx 使用
npx spec-superflow list
```

| 命令 | 功能 |
|------|------|
| `ssf list` | 列出所有 changes 及状态 |
| `ssf validate <dir>` | 验证工件完整性 |
| `ssf doctor` | 健康检查（版本同步、hooks、skills、文档一致性） |
| `ssf version <semver>` | 一键同步版本号到所有 manifest |
| `ssf sync <change-dir>` | delta spec → main spec 合并（含冲突检测） |
| `ssf config` | 显示/修改项目配置 |
| `ssf state init <dir>` | 初始化 `.spec-superflow.yaml` 状态文件（含工件哈希） |
| `ssf state check <dir>` | 检查状态文件与工件一致性 |
| `ssf state transition <dir> <to>` | 记录状态转换 |
| `ssf state get <dir> <field>` | 读取单个状态字段 |
| `ssf state rebuild <dir>` | 从工件重建状态文件 |
| `ssf state set <dir> <field> <value>` | 设置状态字段（workflow、execution_mode、决策点结果） |
| `ssf inject <dir>` | 生成多平台 phase-guard 产物（Claude / Cursor / Copilot / Gemini） |
| `ssf inject <dir> --platforms cursor,copilot` | 仅生成指定平台的 phase-guard 产物 |
| `ssf audit <dir>` | 从 `.spec-superflow.yaml` 生成决策点审计报告 |

### 快速路径（hotfix / tweak）

v0.7.0 新增自动模式检测，让小变更自动进入轻量流程：

- **自动推断** — `workflow-start` 根据 `proposal.md` 和 `tasks.md` 自动判断 `hotfix` / `tweak` / `full`。
- **hotfix** — ≤2 文件、无新模块、无 schema 变更时，跳过 need-explorer 和完整 spec-writer，走最小契约 → inline 执行 → 轻量闭合。超出阈值自动升级为 full。
- **tweak** — ≤4 文件、纯配置/文档修改时，跳过 need-explorer、spec-writer 和 contract-builder，直接编辑 → 轻量闭合。超出阈值自动升级为 full。

配合 `guard.mjs` 的模式感知和 `docs/decision-points.md` 的 7 个标准决策点，小变更不再被流程拖慢。

配置系统支持可选的 `spec-superflow.config.json`，可自定义工件顺序、跳过工件、调整阈值等。不创建文件则使用内置默认值。

## 工作流

对于名为 `<change-name>` 的变更，推荐的工件目录：

```text
workflow/
├── specs/                          # 主规范库（spec-merger 维护）
│   └── <capability>/spec.md
└── changes/<change-name>/
    ├── proposal.md
    ├── design.md
    ├── tasks.md
    ├── specs/                      # Delta specs（变更结束后 syncer 合并到主规范）
    │   └── <capability>/spec.md
    └── execution-contract.md
```

流程线是：

```text
proposal/specs/design/tasks -> execution-contract.md -> 用户批准 -> 开始实现
                                                              │
                                              ┌─ TDD ─ SDD ─ Review ─┤
                                              │                       │
                                              └─ debugger ─ reviewer ─┘
```

**规划本身不等于可以实现。** 如果 `execution-contract.md` 缺失、过时或未被用户批准，工作流会拒绝进入实现阶段。

## 引擎架构

```
spec-superflow/
├── src/                              # ← 嵌入式引擎（TypeScript 源码）
│   ├── schema/                       #   类型定义：Requirement, Delta, Spec, Change
│   ├── validation/                   #   验证器 + 多语言 tokenizer：SHALL/MUST, Delta 冲突, 中英文分词
│   └── parsing/                      #   解析器：Requirement 块 + Delta Spec
│
├── skills/                           # 9 个 Skill
│   ├── workflow-start/        #   入口路由（7 状态 + 内容级检测）
│   ├── need-explorer/                #   需求澄清
│   ├── spec-writer/                  #   工件生成（Schema 验证）
│   ├── contract-builder/              #   桥接契约（自动提取）
│   ├── build-executor/           #   执行总督（TDD + SDD）
│   │   ├── implementer-prompt.md     #   子代理实施模板
│   │   └── task-reviewer-prompt.md   #   子代理审查模板
│   ├── bug-investigator/          #   4 阶段根因调试
│   ├── code-reviewer/                #   结构化审查
│   │   └── code-reviewer-prompt.md   #   审查者提示模板
│   ├── release-archivist/            #   验证 + 收口
│   └── spec-merger/                  #   Delta Spec → 主规范同步
│
├── scripts/                          # CLI + 辅助脚本
│   ├── spec-superflow.mjs            #   CLI 入口 (ssf 命令)
│   ├── lib/                          #   CLI 子命令模块
│   ├── guard/                        #   阶段转换守护脚本
│   ├── install-cursor.mjs            #   Cursor 本地部署脚本
│   ├── infer-workflow.mjs            #   workflow 模式自动推断
│   ├── get-config                    #   配置查询 bash helper
│   ├── task-brief                    #   提取单任务文本
│   ├── review-package                #   生成审查 diff
│   └── validate-artifacts            #   引擎验证入口
│
├── hooks/                            # Session-start 钩子（多平台）
├── templates/                        # 6 个工件模板（中文化）
└── package.json
```

## 示例

两个完整 change 示例展示了从 proposal 到 execution contract 的贯通路径：

- `docs/examples/add-dark-mode/` -- 新 UI 功能（暗色模式）
- `docs/examples/refactor-auth-boundary/` -- brownfield 后端重构（认证边界）

阅读顺序：`proposal.md` -> `specs/` -> `design.md` -> `tasks.md` -> `execution-contract.md`

## 常用问题

<details>
<summary><strong>spec-superflow 和 OpenSpec / Superpowers 什么关系？</strong></summary>

spec-superflow 是**源码级融合**，不是简单并列：

- **上游来源**：OpenSpec 来自 [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)，Superpowers 来自 [obra/superpowers](https://github.com/obra/superpowers)
- **吸收了 OpenSpec 的 Schema/验证/解析引擎**（`src/` 目录），但丢弃了 CLI 命令和 profile 系统
- **吸收了 Superpowers 的 TDD 铁律、SDD 子代理模式、系统化调试、代码审查**（skill 内嵌 + 辅助脚本），但丢弃了 brainstorming、writing-plans（方法论已融入 need-explorer/spec-writer）
- **独创了 contract-builder 桥接层** — 将规划语言转化为可检查的执行契约
- **自包含** — 不需要安装 OpenSpec 或 Superpowers 运行时
- **9 个 skill** vs OpenSpec 的 12 个 AI command + Superpowers 的 14 个 skill — 去重叠、留异同、加独创

</details>

<details>
<summary><strong>能和我已有的 OpenSpec 或 Superpowers 共存吗？</strong></summary>

建议不要在同一个会话中混用。如果同时激活 OpenSpec 的 `/opsx:*` 和 spec-superflow 的 workflow-start，可能出现两套流程竞争。选择一个做 workflow owner。

已有 OpenSpec 工件目录的项目可以直接用 spec-superflow 接管——`contract-builder` 能读取现有的 proposal/specs/design/tasks 生成 execution contract。
</details>

<details>
<summary><strong>execution contract 怎么知道该更新了？</strong></summary>

以下情况视为 contract 过时（内容级检测，不只是文件时间戳）：

- `proposal.md` 范围变了（比较 intent lock 字段）
- `specs/` 里的已批准需求改了
- `design.md` 架构或接口约束变了
- `tasks.md` 执行批次变了

过时后 `workflow-start` 会回退到 `contract-builder`，不会继续执行。
</details>

<details>
<summary><strong>Schema 引擎验证什么？</strong></summary>

`spec-writer` 生成工件后自动运行 `src/validation/validator.ts`：

- **spec.md**：每个 Requirement 必须含 `SHALL` 或 `MUST`，至少 1 个 `#### Scenario:`
- **Delta spec**：ADDED/MODIFIED 必须有 requirement text + scenario，同 spec 内不能有跨段冲突（如 MODIFIED 和 REMOVED 同时出现）
- **proposal.md**：## Why 至少 50 字符，## What Changes 不能为空
- **tasks.md**：每个任务必须有完成定义

不合格 → 拒绝进入 contract-builder。
</details>

<details>
<summary><strong>SDD (Subagent-Driven Development) 怎么工作的？</strong></summary>

执行阶段的核心模式：

1. **Pre-flight 审查** — 扫描计划冲突
2. **每任务循环**：派实施子代理（用 `implementer-prompt.md`）→ 生成 `review-package` diff → 派审查子代理（用 `task-reviewer-prompt.md`）→ 双向判断（spec 合规 + 代码质量）→ 不合格 → 修复 → 重新审查
3. **进度台账** — `.superpowers/sdd/progress.md` 防止会话压缩后丢失进度
4. **最终全分支审查** — `code-reviewer` 审查完整变更

模型选择策略：机械任务用便宜模型，集成/判断用标准模型，架构/最终审查用最强模型。
</details>

## 版本历史

- **v0.8.1** — 自动安装最新版。Cursor 部署脚本默认从 GitHub latest release 拉取；新增 `scripts/check-update.mjs`，`workflow-start` 启动时提示升级；Claude Code 升级命令明确为 `/plugin update spec-superflow@spec-superflow`。
- **v0.8.0** — Skill 重命名（`workflow-start`、`spec-writer`、`build-executor` 等 9 个见名知意名字）、Batch Inline 执行模式（减少小型需求 subagent 调度）、设计前用户确认门禁（DP-0）、各 AI 平台安装说明同步。
- **v0.7.0** — 感知增强 + 多平台修复。自动模式检测（hotfix/tweak/full 推断）、多平台 phase-guard 注入（Cursor / Copilot / Gemini）、决策点审计报告 `ssf audit`、Cursor 本地部署脚本、模板中文化。修复 Copilot CLI `author` 格式和 Cursor 安装路径。
- **v0.6.0** — 快速感知。hotfix/tweak 快速路径、phase-guard.md 阶段防漂移、7 个标准决策点协议、guard.mjs 模式感知。`ssf inject` + `ssf state set` 新命令。
- **v0.5.0** — 可靠性层。guard.mjs 守护脚本（5 维度硬门禁）、.spec-superflow.yaml 状态文件、SHA256 哈希加速过期检测。`ssf state` 5 子命令。
- **v0.4.0** — 平台化演进。新增 CLI 工具链（`ssf` 6 子命令）、可配置 Schema（`spec-superflow.config.json`）、中英文双 tokenizer、spec 冲突检测、git worktree 隔离。8 状态机（含 abandoned 终态）。
- **v0.3.0** — 工作流增强。Inline 执行模式、abandoned 终态、三维验证（Completeness/Correctness/Coherence）、writing-plans 方法论整合。
- **v0.2.0** — 源码级融合。新增引擎层（src/），从 6 skill 扩展到 9 skill。新增 TDD 铁律、SDD、系统化调试、代码审查、Delta Spec 同步。7 状态机。
- **v0.1.0** — 首次发布。6 skill 工作流，contract-builder 桥接层，6 状态机。

---

**Star 一下，下次需要的时候能找到。**
