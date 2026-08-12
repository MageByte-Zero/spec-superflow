# sdd-execution-control

## MODIFIED Requirements

### Requirement: 审查修复具有聚焦 re-review 与轮次上限

系统 MUST 为失败 review 记录修复轮次、原始发现、修复范围和 re-review 结论；达到自动修复上限后 MUST 阻止继续自动修复，并 MUST 提供显式、可审计的人工裁决命令，为同一 current plan、wave 与失败链授权恰好一次连续 review，而不得合成 pass receipt 或提前解除依赖阻塞。

#### Scenario: 达到自动修复上限

- **WHEN** 同一 wave 达到配置的未通过修复/re-review 上限
- **THEN** wave 状态为 `adjudication-required`
- **AND** 未经人工裁决不得记录下一次 review

#### Scenario: 人工授权一次 review

- **WHEN** 操作者对 current plan 中 `adjudication-required` 的 wave 使用 `allow-review` 决策并显式确认理由
- **THEN** 系统保存绑定 plan hash、revision、wave、失败链身份、决策、理由和时间的 adjudication receipt
- **AND** 仅允许一次从上一 review head 连续开始的 review
- **AND** 依赖 wave 在 replacement `pass` receipt 前保持阻塞

#### Scenario: 授权后的 review 通过

- **WHEN** 被授权的连续 review 记录 `pass`
- **THEN** 原 repair chain 变为 `resolved`
- **AND** 依赖 wave 按既有 pass receipt 规则放行

#### Scenario: 授权后的 review 仍失败

- **WHEN** 被授权的连续 review 记录 `fail`
- **THEN** failure evidence 被追加而不重写历史记录
- **AND** wave 再次变为 `adjudication-required`
- **AND** 需要新的人工裁决才能再记录 review

#### Scenario: 裁决输入无效或过期

- **WHEN** plan 过期、wave 未处于 `adjudication-required`、参数缺失、授权已使用或失败链身份不匹配
- **THEN** 系统拒绝裁决或 review
- **AND** 不修改 receipt、repair state 或依赖状态
