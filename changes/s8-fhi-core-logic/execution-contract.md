# S8 · FHI 核心逻辑 — 执行契约

## Intent Lock

将若谷家庭幸福指数（FHI）测评系统 V3.0 完整产品级设计方案落实为可运行的 miniapp 功能。核心交付：69 题完整题库 → V3.0 评分引擎（含12型识别/三级预警/环形图能量流/若谷心语/4层建议） → 双图系统（环形图+四象限雷达图） → 完整 8 节测评报告。替换当前所有 mock/占位页面。

## Scope Fence

### In Scope

- `shared/fhi/fhi-2.0.0.json` 完整 69 题题库数据（仅 4 题反向，无每题 weight）
- 后端评分引擎 V3.0：`(原始分/原始满分)×权重` 公式 + 层级比值 + 12 型识别 + 维度级三级预警 + 环形图能量流 + 若谷心语 + 4 层建议
- 后端 API 响应扩展：`POST/GET /api/v1/fhi/responses` 返回完整 V3.0 报告数据结构
- 双图 Canvas 组件：FhiRingChart（3 层圆环 + 饱和度 + 能量流动状态）+ FhiRadarChart（8 轴四象限 + 层级背景色 + 40% 参考线）
- `result.vue` 完整 8 节报告：核心结果 + 环形图 + 雷达图 + 类型画像 + 4 层建议 + 预警 + 若谷心语 + 附录
- `wizard.vue` 动态答题流程：69 题加载 + 5 点李克特 + 导航 + 草稿保存 + 提交
- `intro.vue` / `index.vue` / `share-landing.vue` 更新为 8 维度 69 题
- 前端服务层 `services/fhi.ts` + 类型定义 `types/fhi.ts`

### Out of Scope

- AI 对话测评（`conversation.vue`，P1）
- 管理后台 FHI 配置页（已由 s5a/s5b 覆盖）
- 分享邀请码 UI/UX 改进
- 多成员参评 / 家庭聚合评分
- 测评报告 PDF 导出/打印

## Approved Behavior

| ID | 需求 | 来源 | 验收条件 |
|----|------|------|----------|
| REQ-QB-1 | 题库含 69 题、8 维度、4 层级 | fhi-question-bank | JSON 加载后 totalQuestions === 69, maxScore === 100 |
| REQ-QB-2 | 仅 4 道反向题（17/34/35/44） | fhi-question-bank | isReversed===true 的题目恰好 4 道，题号匹配 |
| REQ-QB-3 | 每题不含 weight 字段 | fhi-question-bank | JSON 中无任何题目的 weight 属性 |
| REQ-SE-1 | V3.0 评分公式：(原始分/原始满分)×权重 | fhi-scoring-engine | 关系亲密度 11 题和 33 → 33/55×18 = 10.8 |
| REQ-SE-2 | 层级比值：基础层/30, 关系层/32, 共识层/18, 进化层/20 | fhi-scoring-engine | 四层比值百分比输出 |
| REQ-SE-3 | 12 型识别：优先级判定 T1→T12 | fhi-scoring-engine | 每种类型的边界条件测试通过 |
| REQ-SE-4 | 维度级三级预警：关系亲密度<7.2 / 情绪环境<5.6 | fhi-scoring-engine | 红/橙/黄三种级别触发条件正确 |
| REQ-SE-5 | 环形图能量流：3 环饱和度 + 传导效率 + 流动状态 | fhi-scoring-engine | 健康流动/局部阻塞/传导衰减 三种状态可复现 |
| REQ-SE-6 | 若谷心语：基于家庭类型生成个性化寄语 | fhi-scoring-engine | 12 种类型各有对应心语 |
| REQ-SE-7 | 4 层建议：优先干预(4 阶段/12周) + 次要 + 优势 + 长期 | fhi-scoring-engine | 建议结构完整，阶段时间线合理 |
| REQ-UP-1 | result.vue 展示 8 节报告 | fhi-user-pages | 8 个章节卡片均可展开查看 |
| REQ-UP-2 | 环形图 + 雷达图双图渲染 | fhi-user-pages | Canvas 绘制正确，颜色/坐标/标注无误 |
| REQ-UP-3 | wizard.vue 动态 69 题 + 草稿保存 | fhi-user-pages | 断点续答恢复准确，提交成功跳转 |
| REQ-UP-4 | 信息页更新为 8 维度 69 题 | fhi-user-pages | index/intro/share 均从 API 加载 |

## Test Obligations

### 必须通过测试的场景

1. **V3.0 评分公式**：发送 69 题 mock 答案，验证各维度得分 = (原始分/原始满分)×权重
2. **反向题计分**：题 34 选 5 → normalized=1，题 17 选 1 → normalized=5
3. **12 型完整覆盖**：构造 12 种数据组合，每种触发对应类型（T1→T12）
4. **三级预警**：构造红色/橙色/黄色/无预警各一种场景
5. **环形图状态**：构造高/中/低三种饱和度数据，验证流动状态判定
6. **答题提交流程**：69 题全答 → POST → 成功 → 跳转 result
7. **断点续答**：答 30 题离开 → 再次进入恢复第 30 题
8. **边界测试**：全 1 分（总分最低）、全 5 分（总分满分）
9. **信息页数据加载**：index/intro/share 从 API 加载显示 8 维度

### 测试优先级要求

所有评分引擎相关测试（1-5）SHALL 在 Batch 2 完成时通过。
所有前端集成测试（6-9）SHALL 在 Batch 7 完成时通过。

## Implementation Constraints

1. **评分公式**：必须使用 `(原始分/原始满分)×权重`，不得使用 per-question weight
2. **预警检测粒度**：维度级（关系亲密度<7.2、情绪环境<5.6），非子维度级
3. **反向题**：仅 4 道（17/34/35/44），题 55/56 为正常题
4. **环形图中环**：包含 4 维度（关系亲密度+情绪环境+价值稳定性+精神文化），满分 50（不是 V2.0 的 38）
5. **环形图颜色**：外环 #4A90D9、中环 #E8833A→#5CB85C 渐变、内环 #F5A623
6. **雷达图坐标**：0°=关系层、90°=进化层、180°=共识层、270°=基础层
7. **Canvas API**：使用 uni-app 封装的 `uni.createCanvasContext`，不依赖第三方图表库
8. **草稿保存**：每题自动 PUT（防抖 500ms），网络失败时本地缓存兜底
9. **响应扩展**：后端 API 新增字段不得破坏已有前端调用
10. **题库 JSON**：`version` 标记为 `"3.0.0"`，无 `weight` 字段

## Execution Batches

### Batch 1: 数据层 — 题库 + 类型定义
**Depends on**: 无
**文件**: `shared/fhi/fhi-2.0.0.json` (Create), `miniapp/src/types/fhi.ts` (Create), `backend/src/shared/fhi/score.d.ts` (Modify)
**任务**:
- 1.1 创建完整 69 题题库 JSON（V3.0，4 反向，无 weight）
- 1.2 定义前端 V3.0 类型定义（FhiRingChart, FhiReport 等）
- 1.3 更新后端评分类型定义（LayerRatio, RingChartData 等）
**Done when**: 题库加载后 totalQuestions===69, maxScore===100, 反向题恰好 4 道
**Review**: 数据完整性校验（满分求和 100、题数 69、反向题 4）

### Batch 2: 后端评分引擎 V3.0
**Depends on**: Batch 1
**文件**: `backend/src/shared/fhi/score.ts` (Modify), `backend/src/routes/v1/fhi.ts` (Modify)
**任务**:
- 2.1 V3.0 评分公式（\`(rawSum/rawMax)×weight\`）
- 2.2 12 型识别 + 三级预警
- 2.3 环形图能量流 + 若谷心语 + 4 层建议
- 2.4 集成到 API 路由（响应扩展）
**Done when**: curl POST mock 答案后，响应包含完整的 dimension_scores, layer_ratios, type_id, alert, ring_chart, heart_message, suggestions
**Review**: 12 型全覆盖 + 3 级预警全覆盖

### Batch 3: 前端服务层 + 信息页更新
**Depends on**: Batch 1
**文件**: `miniapp/src/services/fhi.ts` (Create), `index.vue/intro.vue/share-landing.vue` (Modify)
**任务**:
- 3.1 创建 API 服务层（getForm/getDraft/saveDraft/submit/getResult）
- 3.2 更新三个信息页为 8 维度（从 API 加载）
**Done when**: 信息页显示 8 维度 69 题，API 可正常调用

### Batch 4: 答题页重写
**Depends on**: Batch 3
**文件**: `miniapp/src/pages-sub/fhi/wizard.vue` (Modify)
**任务**:
- 4.1 动态题目加载 + 5 点李克特 + 导航
- 4.2 草稿保存 + 断点续答 + 提交
**Done when**: 69 题可完整答题→提交→跳转 result

### Batch 5: 双图 Canvas 组件
**Depends on**: Batch 1
**文件**: `miniapp/src/components/FhiRingChart.vue` (Create), `FhiRadarChart.vue` (Create)
**任务**:
- 5.1 环形图组件（3 层圆环 + 饱和度 + 能量流动状态）
- 5.2 四象限雷达图组件（8 轴 + 层级背景色 + 40%参考线）
**Done when**: 两个组件在独立测试页中渲染正确

### Batch 6: 结果页 — 完整 8 节报告
**Depends on**: Batch 3, Batch 2, Batch 5
**文件**: `miniapp/src/pages-sub/fhi/result.vue` (Modify)
**任务**:
- 6.1 实现 8 节完整报告（核心结果/环形图/雷达图/类型画像/4层建议/预警/心语/附录）
**Done when**: 从 API 加载结果后，8 节卡片均正确渲染

### Batch 7: 集成验证
**Depends on**: Batch 4, Batch 6
**文件**: 无（仅测试）
**任务**:
- 7.1 全流程集成测试：后端公式验证 + 前端完整流程 + 边界测试 + 状态覆盖
**Done when**: 9 项测试义务全部通过

## Review Gates

1. **Batch 1 → Batch 2 门**：确认题库 JSON 数据完整性（满分 100、题数 69、反向题 4）
2. **Batch 2 → Batch 3 门**：确认评分引擎所有单元测试通过（12 型 + 3 级预警全覆盖）
3. **Batch 4 → Batch 5 门**：确认答题流程完整（动态加载→草稿→提交→跳转）
4. **Batch 5 → Batch 6 门**：确认环形图和雷达图渲染正确
5. **Batch 6 → Batch 7 门**：确认 8 节报告完整展示
6. **Batch 7 完成后**：全量 Review（回检查）

## Escalation Rules

- **未映射的需求**: 所有 15 个 REQ 均已覆盖到执行批次中 — 无未映射需求
- **评分公式偏离 V3.0** → 立即停止，回退到 specifying
- **环形图/雷达图 Canvas 渲染严重异常** → 评估方案（备选：简化版 CSS 模拟）
- **题库数据中反向题数量 ≠ 4** → 立即停止，修正 JSON 数据
- **中环满分误用 V2.0 的 38 而非 V3.0 的 50** → 立即停止，修正评分引擎
- **如发现需要多成员参评或聚合评分** → 记录为 P1 需求，本次不纳入（out of scope）
- **如依赖的 API 不存在或签名不匹配** → 评估范围变更，重新路由到 bridge-contract

## 批准

<!-- DP-3: 用户需明确批准此执行契约后再开始执行 -->

请审阅以上执行契约，确认无误后回复 **「同意，开始执行」** 以进入执行阶段。
