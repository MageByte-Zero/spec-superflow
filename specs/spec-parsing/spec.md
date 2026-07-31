# spec-parsing

## Requirements

### Requirement: 解析器忽略 fenced 示例中的结构标记

系统 MUST 忽略 fenced code block 内的 Requirements、delta、Requirement 和 Scenario 标题；这些文本不得创建需求、delta 操作或场景。

#### Scenario: 围栏中的 delta 标题

- **WHEN** spec 在 fenced code block 中展示 `## ADDED Requirements` 和需求示例
- **THEN** delta 解析结果不包含该示例中的操作或需求

#### Scenario: 围栏中的 Scenario 标题

- **WHEN** 真实需求的 fenced 示例内包含 `#### Scenario:` 文本
- **THEN** 场景计数不将该文本作为真实场景

### Requirement: 需求正文校验跳过元数据并支持连续正文

系统 MUST 从 Requirement 标题后的首段有效正文读取规范性断言，跳过字段式元数据，并将同一段的连续非空行作为一个正文判断单元。

#### Scenario: 元数据位于正文之前

- **WHEN** 需求标题后先出现 `**Owner**:` 等字段式元数据，随后出现包含 MUST 的正文
- **THEN** 校验通过规范性关键字检查

#### Scenario: 规范性断言跨行书写

- **WHEN** 需求正文的完整 MUST 断言跨越连续两行
- **THEN** 校验以合并后的正文判断该需求

### Requirement: 不支持的嵌套 spec 路径被拒绝

系统 MUST 检测 `specs/<capability>/` 下额外嵌套的 `spec.md`，并将其报告为无效布局；系统不得在存在其他有效规格时静默忽略该文件。

#### Scenario: 混合有效与嵌套规格

- **WHEN** change 同时包含 `specs/auth/spec.md` 与 `specs/auth/session/spec.md`
- **THEN** 布局校验失败并列出嵌套文件路径
- **AND** `ssf validate` 与 `ssf sync` 均不处理该 change
