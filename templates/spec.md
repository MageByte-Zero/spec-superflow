# 能力规格

## Purpose（可选）

仅当这个 delta 能说明新能力规格的目的时填写本段。此段可省略：旧模板和未包含
Purpose 的历史 delta 仍然有效。同步仅在创建新的主规格时使用非空 Purpose；缺省时会
生成确定性的默认 Purpose，且不会改写既有主规格的 Purpose。

## ADDED Requirements

### Requirement: 需求名称

The system SHALL 提供清晰且可测试的所需行为。

#### Scenario: 正常路径

- **WHEN** 触发动作发生
- **THEN** 系统产生预期结果

## MODIFIED Requirements

### Requirement: 现有需求名称

The system SHALL 按此处描述的更新行为执行。

#### Scenario: 更新后的行为

- **WHEN** 执行某个已知现有路径
- **THEN** 出现新的 approved behavior

## REMOVED Requirements

### Requirement: 已弃用需求名称

**Reason**: 为什么要移除该行为。

**Migration**: 应该用什么替代它。
