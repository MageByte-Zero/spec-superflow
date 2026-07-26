# 变更提案：消除规格漂移

## 背景（Why）

当前工作流同时保存变更期的 delta spec（`changes/<change>/specs/`）和项目根目录的发布基线（`specs/`），但 `ssf sync` 只是把 delta 文件原样复制到基线，`spec_merged` 也只是未验证的布尔值。这样会让两个位置在内容、路径或同步时机上静默分叉；恢复流程无法证明正在执行的 change 与已发布基线之间的关系。

## 变更内容（What Changes）

- 明确 `changes/<change>/` 为活动工作流的唯一事实源；状态机、工件校验与执行 guard 只解析该 change。
- 将根 `specs/` 定义为已发布规范基线；它不参与活动 change 的状态转换。
- 将 `ssf sync` 改为把 delta 操作应用到基线规范，而不是复制 delta 文本。
- 在 change 状态中保存可验证的合并回执：源 delta、合并前基线和合并后基线的哈希及受影响能力路径。
- 让 closing guard 依据回执验证基线仍对应当前 change；任何一端后续变更都会要求重新同步。

## 能力（Capabilities）

### 新增能力

- `spec-publication-receipt`：记录并验证 change delta 到发布基线的同步证据。

### 修改能力

- `spec-sync`：以 delta 应用语义更新根 `specs/`。
- `workflow-routing`：活动状态转换只以 change 工件为输入，并在 closing 时验证发布回执。

## 范围（Scope）

### 范围内（In Scope）

- 同步路径解析、delta 应用、发布回执、closing guard、CLI 输出、测试与相关技能/文档。
- 现有 change 目录中的 delta spec 保留为审计记录，不再被根基线覆盖或替代。

### 范围外（Out of Scope）

- 改变八状态模型、决策点含义或执行计划格式。
- 让根 `specs/` 反向驱动活动 change 的状态。
- 自动修复历史仓库中已经漂移的基线；它们必须由用户明确运行同步。

## 影响（Impact）

- 影响的代码区域：`scripts/lib/cmd-sync.mjs`、状态加载器、closing guard、CLI 测试、同步技能与工作流文档。
- 影响的接口：`ssf sync <change-dir>` 输出与 `.spec-superflow.yaml` 的发布回执字段。
- 外部系统：所有安装表面调用同一 CLI，无需平台私有适配。
