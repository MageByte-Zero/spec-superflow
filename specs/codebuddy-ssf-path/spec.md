# codebuddy-ssf-path

## Purpose

The codebuddy-ssf-path capability documents the published behavior for users and maintainers.

## Requirements

### Requirement: 跨平台生成 ssf 命令 shim

CodeBuddy 安装器 SHALL 在 `<codebuddyRoot>/spec-superflow/bin/` 目录下生成 `ssf` 命令 shim，其可执行行为等价于 `node <pluginRoot>/scripts/spec-superflow.mjs <args...>`，其中 `<pluginRoot>` 是已部署的插件运行时目录。

shim 文件集合取决于目标平台：

- POSIX（Linux / macOS）SHALL 生成一个无扩展名的可执行文件 `ssf`，内容为 `#!/bin/sh` 起始的 shell 脚本，通过 `exec node "<pluginRoot>/scripts/spec-superflow.mjs" "$@"` 转发全部参数。
- Windows SHALL 生成 `ssf.cmd`（CMD 批处理）与 `ssf.ps1`（PowerShell）两个 shim，分别以 `node "<pluginRoot>/scripts/spec-superflow.mjs" %*` 与 `node "<pluginRoot>/scripts/spec-superflow.mjs" $args` 转发全部参数。

shim 内容中的 `<pluginRoot>` SHALL 以绝对路径形式内嵌，且 SHALL 对含空格与特殊字符的路径做正确引用（quoted），保证在 Git Bash、CMD、PowerShell 中均可直接执行。

#### Scenario: POSIX 平台安装生成 shell shim

- **WHEN** 在 Linux 或 macOS 上安装 CodeBuddy 插件
- **THEN** `<codebuddyRoot>/spec-superflow/bin/ssf` 存在、可执行（含 shebang `#!/bin/sh`），其内容通过 `node` 调用部署的 `spec-superflow.mjs`

#### Scenario: Windows 平台安装生成 CMD 与 PowerShell shim

- **WHEN** 在 Windows 上安装 CodeBuddy 插件
- **THEN** `<codebuddyRoot>/spec-superflow/bin/ssf.cmd` 与 `<codebuddyRoot>/spec-superflow/bin/ssf.ps1` 均存在，且通过 `node` 调用部署的 `spec-superflow.mjs`

#### Scenario: 路径含空格时 shim 仍可执行

- **WHEN** `<codebuddyRoot>` 的路径包含空格（如 `C:\Users\John Doe\.codebuddy`）
- **THEN** 生成的 shim 中对 `<pluginRoot>` 的引用被正确加引号，执行 `ssf --version` 不报路径解析错误

### Requirement: 将 bin 目录注册到用户 PATH（幂等）

CodeBuddy 安装器 SHALL 将 `<codebuddyRoot>/spec-superflow/bin` 注册到当前用户的 PATH 环境变量中，并且 SHALL 保证重复安装不产生重复的 PATH 条目（幂等）。

PATH 注册的跨平台策略：

- Windows SHALL 通过用户级环境变量（`HKCU\Environment`）写入，不得使用 `setx`（其 1024 字符截断风险），不得写入系统级 PATH。
- POSIX SHALL 向用户默认 shell 的配置文件追加 `export PATH="<binDir>:$PATH"` 行：bash 使用 `~/.bashrc`，zsh 使用 `~/.zshrc`；当默认 shell 无法识别时回退到 `~/.profile`。

当安装命令带 `--no-path` 选项时，安装器 SHALL NOT 修改用户的 PATH 环境变量，但仍 SHALL 生成 shim 文件。

#### Scenario: 首次安装注册 PATH

- **WHEN** 用户首次安装且 PATH 中不存在该 bin 目录
- **THEN** 用户 PATH 中出现 `<codebuddyRoot>/spec-superflow/bin` 条目，且该条目唯一

#### Scenario: 重复安装不重复注册

- **WHEN** 用户重复运行安装器且 PATH 中已存在该 bin 目录
- **THEN** PATH 中该目录条目数不增加（保持 1 条）

#### Scenario: --no-path 跳过 PATH 修改

- **WHEN** 用户以 `--no-path` 运行安装器
- **THEN** 用户 PATH 保持不变，但 `<codebuddyRoot>/spec-superflow/bin/` 下的 shim 仍被生成

#### Scenario: Windows 用户级 PATH 写入

- **WHEN** 在 Windows 上安装且未带 `--no-path`
- **THEN** PATH 修改发生在用户级环境变量（`HKCU\Environment`），系统级 PATH 未被修改

#### Scenario: POSIX shell 配置文件追加

- **WHEN** 在 Linux 或 macOS 上安装且未带 `--no-path`
- **THEN** 检测到的 shell 配置文件（`~/.bashrc` / `~/.zshrc` / `~/.profile`）中追加了一行 `export PATH="<binDir>:$PATH"`，且重复安装不产生重复行

### Requirement: 卸载时清理 shim 与 PATH 条目

CodeBuddy 卸载器 SHALL 在卸载时删除 `<codebuddyRoot>/spec-superflow/bin/` 目录（含全部 shim），并 SHALL 从用户 PATH 中移除该目录条目（Windows 用户级 PATH 移除该条目；POSIX 从 shell 配置文件中移除对应 export 行）。

卸载器 SHALL NOT 修改或删除 PATH 中的其他条目，SHALL NOT 删除用户 shell 配置文件中的其他内容。

#### Scenario: 卸载后 PATH 不含 bin 目录

- **WHEN** 用户运行卸载器且此前已注册 PATH
- **THEN** 用户 PATH 中不再出现 `<codebuddyRoot>/spec-superflow/bin` 条目，其他 PATH 条目保持不变

#### Scenario: 卸载删除 shim 目录

- **WHEN** 用户运行卸载器
- **THEN** `<codebuddyRoot>/spec-superflow/bin/` 目录被删除

#### Scenario: 卸载不影响其他 PATH 条目与配置文件内容

- **WHEN** 用户运行卸载器且用户 PATH 中含有其他自建条目、shell 配置文件中含有其他用户内容
- **THEN** 其他 PATH 条目与 shell 配置文件中的其他内容均保持不变

### Requirement: install-codebuddy 命令支持 --no-path 选项

`ssf install-codebuddy` 命令 SHALL 新增 `--no-path` 布尔选项。默认（不带该选项）行为为生成 shim 并注册 PATH；带 `--no-path` 时仅生成 shim、不注册 PATH。`--dry-run` 模式 SHALL 在计划输出中显示是否将注册 PATH 及目标 bin 目录。

#### Scenario: 默认安装输出与行为

- **WHEN** 用户不带 `--no-path` 运行 `ssf install-codebuddy`
- **THEN** 安装输出包含 bin 目录路径与 PATH 注册信息，且用户 PATH 被更新

#### Scenario: dry-run 展示 PATH 计划

- **WHEN** 用户以 `--dry-run` 运行 `ssf install-codebuddy`
- **THEN** 计划输出包含 bin 目录路径与 PATH 注册说明，且不实际修改任何文件或环境变量
