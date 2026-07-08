# S8 · FHI 核心逻辑重构（评分引擎 V3 + 双图系统 + 完整报告）

## Why

当前 `miniapp/src/pages-sub/fhi/` 下的所有页面均为占位 mock（6 维度硬编码），与 若谷家庭幸福指数（FHI）测评系统 V3.0 规格严重脱节。具体问题：

1. **题库缺失**：`shared/fhi/fhi-2.0.0.json` 仅含 1 道桩题，后端评分引擎无法实际运行
2. **评分公式不匹配**：后端 `score.ts` 未实现 V3.0 规定的 `(维度原始分/维度满分)×维度权重` 公式
3. **缺失主视觉**：V3.0 将「若谷家庭能量环形图」作为报告 C 位主视觉，当前完全未实现
4. **结果页为 Mock**：`result.vue` 硬编码 78 分/3 维度，缺少双图系统（环形图+雷达图）、12 型家庭类型识别、三级预警、8 节报告模板
5. **答题页静态桩**：`wizard.vue` 硬编码一道题，无动态加载、无草稿保存、无提交流程
6. **维度数据不一致**：所有页面显示 6 维度，V3.0 规格为 8 维度 69 题

本次变更遵循 V3.0 完整产品级设计方案，聚焦核心逻辑层。

## What Changes

1. **完整题库数据**：将 V3.0 的 69 题（8 维度、4 层级）正式化为 `fhi-2.0.0.json`，仅标记 4 道反向题（17、34、35、44）
2. **评分引擎重写**：按 V3.0 公式 `(维度原始分之和 / 维度满分) × 维度权重` 重新实现 `score.ts`
3. **层级比值计算**：4 层（基础层/关系层/共识层/进化层）各自得分占满分的比例
4. **12 型家庭类型识别**：基于判定矩阵实现 12 型识别
5. **三级预警系统**：维度级检测（关系亲密度<7.2、情绪环境<5.6），红/橙/黄三色
6. **若谷家庭能量环形图**：3 层环结构（外环-根基层/中环-能力层/内环-目标层）+ 能量流动状态判断
7. **四象限雷达图**：8 维四象限布局（进化层/关系层/基础层/共识层于 90°/0°/270°/180° 方位）
8. **完整 8 节测评报告**：核心结果 + 环形图 + 雷达图 + 类型画像 + 改进建议（4 层结构）+ 风险预警 + 若谷心语 + 附录
9. **答题页动态化**：动态加载 69 题、单选导航、草稿自动保存、提交
10. **维度信息页更新**：intro/index/share-landing 从 6 维度更新为 8 维度 69 题

## Scope

### In Scope

- 后端：题库数据（69 题，仅 4 题反向）
- 后端：评分引擎 V3（新公式 + 层级比值 + 12 型识别 + 三级预警 + 环形图能量流计算）
- 后端：API 响应扩展（增加 type_id、layer_ratios、alert、ring_chart_data、report_sections）
- 前端：FhiRingChart.vue（若谷家庭能量环形图组件）
- 前端：FhiRadarChart.vue（四象限 8 维雷达图组件）
- 前端：result.vue 完整 8 节报告
- 前端：wizard.vue 动态答题流程
- 前端：intro/index/share-landing 维度信息更新
- 前端：services/fhi.ts + types/fhi.ts

### Out of Scope

- AI 对话测评（conversation.vue，P1）
- 管理后台 FHI 配置页（已由 s5a/s5b 覆盖）
- 分享邀请码 UI/UX 改进
- 多成员参评 / 家庭聚合评分
- 测评报告 PDF 导出/打印

## Impact

| 区域 | 影响 |
|------|------|
| `shared/fhi/fhi-2.0.0.json` | **替换**：1 题桩 → 69 题完整数据（4 反向题） |
| `backend/src/shared/fhi/score.ts` | **重写**：V3.0 公式 + 环形图能量流 + 12 型 + 三级预警 + 若谷心语 |
| `backend/src/shared/fhi/score.d.ts` | **修改**：新增所有 V3.0 结果类型 |
| `backend/src/routes/v1/fhi.ts` | **修改**：响应扩展 |
| `miniapp/src/components/FhiRingChart.vue` | **新增**：若谷家庭能量环形图组件 |
| `miniapp/src/components/FhiRadarChart.vue` | **新增**：四象限 8 维雷达图组件 |
| `miniapp/src/pages-sub/fhi/*.vue` | **重写/修改**所有 5 个页面 |
| `miniapp/src/services/fhi.ts` | **新增**：FHI API 服务层 |
| `miniapp/src/types/fhi.ts` | **新增**：FHI 类型定义 |

## Capabilities

### New Capabilities

1. **FHI Scoring Engine V3** — `(原始分和/原始总分)×维度权重` 公式，4 题反向计分
2. **Ring Chart Engine** — 3 层环饱和度计算 + 能量传导效率 + 流动状态判定
3. **Layer Ratio Calculator** — 四层占比
4. **Family Type Classifier (12-type)** — 优先级判定矩阵
5. **Alert Threshold Engine** — 维度级三级预警
6. **Report Generator** — 完整 8 节报告数据组合
7. **FHI Wizard (dynamic)** — 动态 69 题答题流程
8. **FHI Result Page (V3.0)** — 环形图 + 雷达图 + 类型画像 + 预警 + 心语

### Modified Capabilities

- 所有信息页面更新为 8 维度 69 题
- `POST /api/v1/fhi/responses` 响应扩展为 V3.0 完整结构
