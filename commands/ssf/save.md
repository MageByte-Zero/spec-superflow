---

description: 为一个 spec-superflow change 保存兼容 checkpoint
argument-hint: "<change-name-or-path> --task <id> --next <next-step>"
allowed-tools: Bash(npx:*)
---

只把 `$ARGUMENTS` 作为对话输入，从中提取明确的 change、task 和 next，以及用户明确提供的可选 evidence 字段。信息不足时先询问一次；不要编造 verification 或 review 证据。

确认参数后运行 `npx --yes --package spec-superflow@0.10.0 ssf save "<change>" --task "<task-id>" --next "<next-step>" [--completed "<completed>"] [--verification "<verification>"] [--review "<review>"] [--risk "<risk>"] [--commit-start "<commit-start>"] [--commit-end "<commit-end>"] --json`。每个值必须来自已提取或已确认的信息，并作为单独引用的字面参数传入。只报告 CLI 返回的 checkpoint 结果，并保留现有状态机和存储边界。
