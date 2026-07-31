# test-discipline

## Requirements

### Requirement: 测试必须可证伪地保护行为

当实现或修改自动化测试时，build-executor MUST 要求测试说明其保护的可观察行为、会使其失败的生产代码变化，以及独立于实现得出的预期结果。

#### Scenario: 行为驱动的回归测试

- **WHEN** implementer 为新行为添加测试
- **THEN** 报告包含预期的 RED 失败、GREEN 通过及会被该测试捕获的生产变更

### Requirement: 禁止伪造的文本存在测试

build-executor MUST 禁止把脚本、skill、prompt 或源文本的字符串存在断言作为行为测试，并 MUST 禁止无法区分生产实现是否正确的常量断言。

#### Scenario: 测试只匹配 prompt 文本

- **WHEN** 新测试仅断言某段 skill 或 prompt 包含指定字符串
- **THEN** reviewer 将其标记为不满足行为测试要求
- **AND** 要求以可观察行为的测试替代

### Requirement: 文档无需伪造测试

build-executor MUST 明确说明纯人工文案或说明性文档改动不要求编造自动化测试，但仍需要适当的格式、链接或构建验证。

#### Scenario: 纯文档修改

- **WHEN** 一个任务只修改人工可读文档且不改变可执行行为
- **THEN** 执行计划要求相应的文档验证
- **AND** 不将缺少单元测试视为缺陷
