# 平台支持矩阵

spec-superflow 共支持 **17 个** AI 编程平台。每个平台按三层接入：

- **Skills** — 9 个 skill 部署到平台技能目录（`${CLAUDE_PLUGIN_ROOT}` 重写为绝对路径）。
- **Rules** — phase-guard 规则文件部署到平台规则目录，被平台自动加载为常驻上下文（守卫机制）。
- **Hooks** — SessionStart 上下文注入钩子（仅在该平台原生支持且已验证时接入）。

## 矩阵

| # | 平台 | Skills | Rules（路径 / 格式） | Hooks |
|---|------|:------:|----------------------|:-----:|
| 1 | Claude Code | ✅ | `.claude/rules/` · md | ✅ SessionStart |
| 2 | Cursor | ✅ | `.cursor/rules/` · mdc | ✅ sessionStart |
| 3 | OpenAI Codex CLI | ✅ | marketplace · md | ✅ |
| 4 | OpenAI Codex App | ✅ | marketplace · md | ✅ |
| 5 | GitHub Copilot CLI | ✅ | `.github/instructions/` · copilot | ✅ |
| 6 | Gemini CLI | ✅ | `GEMINI.md`（无 rules 目录） | ✅ |
| 7 | OpenCode | ✅ | `.opencode/` · md | — |
| 8 | WorkBuddy | ✅ | `marketplace plugin rules/` · md | — |
| 9 | Trae | ✅ | — | — |
| 10 | Cline | ✅ | `.clinerules/`（项目根）· md | — |
| 11 | Kiro | ✅ | `.kiro/steering/` · md | — ¹ |
| 12 | Windsurf | ✅ | `.windsurf/rules/` · md | — ¹ |
| 13 | Qwen Code | ✅ | `.qwen/rules/` · md | — ¹ |
| 14 | Amazon Q Developer | ✅ | `.amazonq/rules/` · md | — ¹ |
| 15 | Roo Code | ✅ | `.roo/rules/` · md | — |
| 16 | Continue | ✅ | `.continue/rules/` · md | — |
| 17 | Pi | ✅ | —（无规则目录） | — |

> ¹ Kiro / Windsurf / Qwen / Amazon Q 平台原生支持 hooks（comet 源码确认 hookFormat 分别为 kiro / windsurf / qwen / claude-code），但 spec-superflow 的 SessionStart 钩子在这些平台的可用性尚未逐一验证，故 v0.8.13 暂不写入 hook 配置，避免塞入失效配置。上下文注入由 phase-guard 规则（平台自动加载）承担。后续版本将逐平台验证后补齐。

## 路径来源

所有 `skillsDir` / `rulesDir` / `rulesFormat` / `hookFormat` 均与 [comet](https://github.com/rpamis/comet) 的 `src/core/platforms.ts` 交叉核实，并对照各平台官方约定。spec-superflow 的守卫机制是 **phase-guard 规则文件**（平台自动加载），而非 comet 的 PreToolUse 钩子——这是两层架构的根本区别。

## 安装命令速查

```bash
npx spec-superflow@latest install-<id>
# <id> ∈ {cline, kiro, windsurf, qwen, amazon-q, roocode, continue, pi, cursor, workbuddy}
```

Claude Code / Codex / Copilot / Gemini / OpenCode / Trae 走各自 marketplace 或本地目录，详见 [INSTALL.md](../INSTALL.md)。
