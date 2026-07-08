# S8 · FHI 核心逻辑 — 执行任务 (V3.0)

## File Structure

```
Create: shared/fhi/fhi-2.0.0.json
  — 完整题库数据（69 题，8 维度，4 层级，仅 4 道反向题，无每题 weight）

Create: miniapp/src/types/fhi.ts
  — FHI 前端 TypeScript 类型定义（V3.0 全量：FhiForm, FhiRingChart, FhiReport 等）

Modify: backend/src/shared/fhi/score.d.ts
  — 新增 V3.0 类型：LayerRatio, FamilyTypeResult, AlertResult, RingChartData, ReportSection, HeartMessage 等

Modify: backend/src/shared/fhi/score.ts
  — 重写为 V3.0 引擎：(原始分/原始满分)×权重公式 + 维度级三级预警 + 12型识别 + 环形图能量流 + 若谷心语 + 4层建议

Modify: backend/src/routes/v1/fhi.ts
  — POST /responses 和 GET /responses/:id 响应扩展为 V3.0 完整报告结构

Create: miniapp/src/services/fhi.ts
  — FHI API 服务层

Create: miniapp/src/components/FhiRingChart.vue
  — 若谷家庭能量环形图组件（3层同心圆环 + 饱和度 + 能量流动状态标注）

Create: miniapp/src/components/FhiRadarChart.vue
  — 四象限 8 维雷达图组件（0°/90°/180°/270° 布局 + 层级背景色 + 40%参考线）

Modify: miniapp/src/pages-sub/fhi/index.vue
  — 更新：8 维度 69 题，API 数据加载

Modify: miniapp/src/pages-sub/fhi/intro.vue
  — 更新：4 层级 + 8 维度 + 测评说明，API 数据加载

Modify: miniapp/src/pages-sub/fhi/share-landing.vue
  — 更新：8 维度，API 数据加载

Modify: miniapp/src/pages-sub/fhi/wizard.vue
  — 重写：动态 69 题加载、导航、草稿、提交

Modify: miniapp/src/pages-sub/fhi/result.vue
  — 重写：8 节完整报告（环形图+雷达图+类型画像+预警+心语+建议+附录）
```

## Interfaces

### Batch 1 → Batch 2
- **Produces**: `fhi-2.0.0.json`（69 题完整数据）— score.ts 依赖
- **Produces**: `FhiQuestion/FhiDimension/FhiLayer` 类型定义 — 所有后续任务依赖

### Batch 2 → Batch 3
- **Produces**: `POST /api/v1/fhi/responses` 扩展后的 JSON 响应格式 — 前端结果页渲染依赖

### Batch 2 → Batch 5
- **Produces**: `ScoreOutput` / `RingChartData` / `FamilyTypeResult` / `AlertResult` / `HeartMessage` 类型 — 前端类型定义依赖

### Batch 3 → Batch 4
- **Produces**: `services/fhi.ts` — wizard.vue 调用

### Batch 4 → Batch 6
- **Produces**: `FhiRingChart.vue`, `FhiRadarChart.vue` — result.vue 嵌入

## Tasks

### Batch 1: 数据层 — 题库 + 类型定义
*Depends on: nothing*

#### Task 1.1: 创建完整题库 JSON (V3.0)
- **Files**: `Create: shared/fhi/fhi-2.0.0.json`
- **Steps**:
  1. 按 V3.0 规格构建嵌套 JSON：4 层级 → 8 维度 → 69 题
  2. 每道题包含：id(1-69), text, isReversed, layerId, dimensionId, subDimensionId, order
  3. **不包含** weight 字段
  4. 仅 4 题设置 isReversed: true（题 17, 34, 35, 44）
  5. 版号设置为 "3.0.0"
  6. 运行完整性校验：8 维度满分之和 === 100、69 题全部存在、反向题恰好 4 道
  7. **Commit**: `feat(fhi): add complete 69-question bank for FHI 3.0.0`

#### Task 1.2: 定义前端 FHI 类型 (V3.0)
- **Files**: `Create: miniapp/src/types/fhi.ts`
- **Steps**:
  1. 定义 `FhiQuestion`：id, text, isReversed, order, dimensionId, layerId
  2. 定义 `FhiDimension`：id, name, weight, rawMax, questions
  3. 定义 `FhiLayer`：id, name, maxScore, dimensions
  4. 定义 `FhiForm`：id, version, totalQuestions, maxScore, layers
  5. 定义 `FhiDimensionScore`：dimensionId, name, rawSum, weight, score, completion
  6. 定义 `FhiLayerRatio`：layerId, name, score, maxScore, ratio, distributionType
  7. 定义 `FhiRingChart`：outerSaturation, middleSaturation, innerSaturation, flowStatus, blockedLayer
  8. 定义 `FhiFamilyType`：typeId, typeName, description, suggestion, strengths, weaknesses, risks
  9. 定义 `FhiAlert`：level, triggeredDimensions, message, actionText, retestAdvice
  10. 定义 `FhiSuggestion`：priority, secondary, strengths, longTerm
  11. 定义 `FhiReport`：sections: { core, ringChart, radarChart, familyType, suggestions, alert, heartMessage, appendix }
  12. **Commit**: `feat(fhi): add V3.0 frontend TypeScript types`

#### Task 1.3: 更新后端评分类型定义
- **Files**: `Modify: backend/src/shared/fhi/score.d.ts`
- **Steps**:
  1. 新增 `LayerRatio`：layerId, name, score, maxScore, ratio, distributionType
  2. 新增 `RingChartData`：outerSaturation, middleSaturation, innerSaturation, flowStatus, blockedLayer
  3. 新增 `FamilyTypeResult`：typeId, typeName, band, description, suggestion, strengths, weaknesses, risks
  4. 新增 `AlertResult`：level, triggeredDimensions, message, actionText, retestAdvice
  5. 新增 `HeartMessage`：text
  6. 新增 `SuggestionResult`：priority, secondary, strengths, longTerm
  7. 整合为 `ScoreOutput` 包含上述所有字段
  8. **Commit**: `feat(fhi): update V3.0 score type definitions`

### Batch 2: 后端评分引擎 (V3.0)
*Depends on: Batch 1 (JSON + types)*

#### Task 2.1: V3.0 评分公式
- **Files**: `Modify: backend/src/shared/fhi/score.ts`
- **Steps**:
  1. 实现 `normalizeRating(rating, isReversed)` — 4 题反向
  2. 实现 `calculateDimensionScore(rawSum, rawMax, weight)` — `(rawSum/rawMax) × weight`
  3. 实现 `calculateAllDimensionScores(form, answers)`
  4. 实现 `calculateLayerRatios(dimensionScores, form)`
  5. 实现 `calculateTotalScore(dimensionScores)`
  6. 单元测试：mock 答案，验证 V3.0 公式输出（如关系亲密度 11 题和 33/55×18=10.8）
  7. **Commit**: `feat(fhi): implement V3.0 scoring formula`

#### Task 2.2: 12型识别 + 三级预警
- **Files**: `Modify: backend/src/shared/fhi/score.ts`
- **Steps**:
  1. 实现 `classifyFamilyType(dimensionScores, layerRatios, totalScore)` — T1→T12 优先级
  2. 实现 `calculateDimensionCompletion(score, weight)`
  3. 实现 `checkAlerts(dimensionScores, totalScore, form)` — 维度级阈值检测
  4. 为全部 12 型和 3 级预警编写单元测试
  5. **Commit**: `feat(fhi): implement 12-type classification and 3-level alerts`

#### Task 2.3: 环形图能量流 + 若谷心语 + 建议
- **Files**: `Modify: backend/src/shared/fhi/score.ts`
- **Steps**:
  1. 实现 `calculateRingChart(dimensionScores)` — 3 环饱和度 + 传导效率 + 流动状态
  2. 实现 `generateHeartMessage(typeResult)` — 基于类型生成心语
  3. 实现 `generateSuggestions(typeResult, dimensionScores)` — 4 层结构
  4. 实现 `generateRetestAdvice(alertLevel)` — 复测建议
  5. 单元测试验证环形图各种状态
  6. **Commit**: `feat(fhi): implement ring chart flow, heart message, and suggestions`

#### Task 2.4: 集成到 API 路由
- **Files**: `Modify: backend/src/routes/v1/fhi.ts`
- **Steps**:
  1. `POST /responses`: 调用 `scoreAnswers()` → 存储完整 V3.0 结果 → 响应含所有报告数据
  2. `GET /responses/:id`: 返回完整 V3.0 结果
  3. 集成测试：发送 mock 答案验证响应包含新字段
  4. **Commit**: `feat(fhi): integrate V3.0 engine with API routes`

### Batch 3: 前端服务层 + 信息页
*Depends on: Batch 1 (types)*

#### Task 3.1: 创建 API 服务层
- **Files**: `Create: miniapp/src/services/fhi.ts`
- **Steps**:
  1. 实现 `getForm()`, `getDraft()`, `saveDraft()`, `deleteDraft()`, `submitAnswers()`, `getResult()`
  2. **Commit**: `feat(fhi): create frontend API service layer`

#### Task 3.2: 更新信息页为 8 维度
- **Files**: `Modify: miniapp/src/pages-sub/fhi/index.vue`, `intro.vue`, `share-landing.vue`
- **Steps**:
  1. 三个页面从 API 加载数据，移除硬编码 6 维度
  2. `intro.vue` 增加 4 层级结构说明和测评说明
  3. **Commit**: `feat(fhi): update landing pages to 8 dimensions`

### Batch 4: 答题页重写
*Depends on: Batch 3 (service)*

#### Task 4.1: 题目加载 + 导航
- **Files**: `Modify: miniapp/src/pages-sub/fhi/wizard.vue`
- **Steps**:
  1. 动态加载 69 题，5 点李克特选项
  2. 进度条、上一题/下一题导航
  3. 首题禁"上一步"，末题变"提交"
  4. **Commit**: `feat(fhi): implement dynamic wizard`

#### Task 4.2: 草稿保存 + 提交
- **Files**: `Modify: miniapp/src/pages-sub/fhi/wizard.vue`
- **Steps**:
  1. 自动保存草稿（防抖 500ms），进入时恢复
  2. 提交验证 → API 调用 → 导航至 result
  3. **Commit**: `feat(fhi): implement draft save and submission`

### Batch 5: 双图组件
*Depends on: Batch 1 (types)*

#### Task 5.1: 环形图组件
- **Files**: `Create: miniapp/src/components/FhiRingChart.vue`
- **Props**: `ringData: { outerSaturation, middleSaturation, innerSaturation, flowStatus, blockedLayer }`
- **Steps**:
  1. Canvas 绘制 3 层同心圆环：外环 #4A90D9、中环 #E8833A→#5CB85C 渐变、内环 #F5A623
  2. 每环宽度根据饱和度填充（饱和度 0.8 则填充 80% 弧长）
  3. 环上标注层级名称和饱和度百分比
  4. 中心区域显示能量流动状态文字（健康流动/局部阻塞/传导衰减/结构断裂）
  5. **Commit**: `feat(fhi): create FhiRingChart component`

#### Task 5.2: 四象限雷达图组件
- **Files**: `Create: miniapp/src/components/FhiRadarChart.vue`
- **Props**: `dimensionScores: Array<{name, score, maxScore, layerId}>`
- **Steps**:
  1. Canvas 绘制 8 轴四象限雷达图
  2. 坐标：0°=关系层、90°=进化层、180°=共识层、270°=基础层
  3. 同层级同背景色填充多边形
  4. 40% 和 100% 参考线
  5. 轴末端标注维度名称和得分(如"结构稳定性 12/16")
  6. **Commit**: `feat(fhi): create FhiRadarChart component`

### Batch 6: 结果页 — 完整 8 节报告
*Depends on: Batch 3 (service), Batch 2 (API), Batch 5 (charts)*

#### Task 6.1: 实现 8 节报告
- **Files**: `Modify: miniapp/src/pages-sub/fhi/result.vue`
- **Steps**:
  1. 从 API 加载结果数据（`getResult(responseId)`）
  2. **第一节-核心结果**：大字总分 + 类型名称 + 报告编号/日期
  3. **第二节-环形图**：嵌入 FhiRingChart + 能量流动解读文字
  4. **第三节-雷达图**：嵌入 FhiRadarChart + 四层得分表格 + 重心分析
  5. **第四节-类型画像**：T编号·名称 + 描述 + 优势/短板/风险
  6. **第五节-改进建议**：4 层结构（优先干预项表格/次要提升/优势强化/长期方向）
  7. **第六节-预警**：条件渲染红/橙/黄/无卡片 + 复测建议
  8. **第七节-若谷心语**：引用风格个性化寄语
  9. **第八节-附录**：8 维详细得分表 + 每题得分明细(可展开)
  10. 底部操作按钮
  11. 使用折叠卡片管理长页面
  12. **Commit**: `feat(fhi): implement complete 8-section report page`

### Batch 7: 集成验证
*Depends on: Batch 4, Batch 6 (all frontend)*

#### Task 7.1: 全流程集成测试
- **Steps**:
  1. 后端 curl 测试 `POST /responses` 验证 V3.0 公式和完整响应
  2. 前端构建后在微信开发者工具预览完整答题→报告流程
  3. 边界测试：全 1 分（最低）、全 5 分（最高）
  4. 构造数据验证 12 型每种类型的触发
  5. 验证 3 级预警触发
  6. 验证环形图各状态（健康流动/局部阻塞/传导衰减）
  7. **Commit**: `test(fhi): add V3.0 integration tests`
