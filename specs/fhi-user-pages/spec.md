# S8 · FHI 用户页面 Spec (V3.0)

## MODIFIED: FHI 用户页面 (`fhi-user-pages`)

**ID**: `fhi-user-pages`  
**优先级**: P0  
**状态**: 待开始

### 要求

#### 1. 量表首页 (`index.vue`)

1.1 — SHALL 从 API 加载量表信息（`GET /api/v1/fhi/form`）
1.2 — SHALL 显示：量表名称（若谷家庭幸福指数 FHI）、69 题、8 维度、约 15 分钟
1.3 — SHALL 提供"开始测评"按钮，导航至 `intro`

#### 2. 量表介绍页 (`intro.vue`)

2.1 — SHALL 展示 4 层级结构说明（基础层/关系层/共识层/进化层）
2.2 — SHALL 展示 8 维度列表（含每层级的维度归属和简要说明）
2.3 — SHALL 展示测评说明（适用对象12岁以上、评分方式1-5分、作答时间15-20分钟、注意事项含反向题说明）
2.4 — SHALL 支持 `form_id` 参数传递
2.5 — SHALL 提供"开始测评"按钮，导航至 `wizard`

#### 3. 答题页 (`wizard.vue`)

3.1 — SHALL 从 API 加载题目列表
3.2 — SHALL 按顺序每题展示，5 点李克特选项（1=完全不符合 … 5=非常符合）
3.3 — SHALL 显示当前进度（第 X 题 / 共 69 题 + 进度条）
3.4 — SHALL 支持上一题/下一题导航，首题禁"上一题"，末题变"提交"
3.5 — SHALL 自动保存草稿至 API（防抖 500ms）
3.6 — SHALL 支持断点续答：进入时恢复草稿
3.7 — 提交前 SHALL 验证所有题目已回答
3.8 — 提交 SHALL 调用 `POST /api/v1/fhi/responses`
3.9 — 提交成功后 SHALL 导航至 `result?response_id=xxx`

#### 4. 结果页 (`result.vue`) — 完整 8 节报告

4.1 — SHALL 从 API 加载结果数据（`GET /api/v1/fhi/responses/:id`）

##### 第一节：核心结果
4.2 — SHALL 显示：总分（大字）、家庭类型名称（5档位）、等级标签
4.3 — 报告编号、测评日期、家庭编号 SHALL 展示

##### 第二节：若谷家庭能量环形图（主视觉）
4.4 — SHALL 嵌入 `FhiRingChart.vue` 组件
4.5 — 环形图 SHALL 展示 3 环：外环(根基层/蓝色)、中环(能力层/橙色→绿色渐变)、内环(目标层/金色)
4.6 — 环形图下方 SHALL 展示能量流动状态文字解读（健康流动/局部阻塞/结构断裂/传导衰减）

##### 第三节：四象限雷达图
4.7 — SHALL 嵌入 `FhiRadarChart.vue` 组件
4.8 — 雷达图 SHALL 使用四象限坐标布局：
   - 0° 方向（右侧）：关系层（关系亲密度、情绪环境）
   - 90° 方向（上方）：进化层（韧性成长力、系统规划力）
   - 180° 方向（左侧）：共识层（价值稳定性、精神文化）
   - 270° 方向（下方）：基础层（结构稳定性、资源保障性）
4.9 — 雷达图下方 SHALL 展示四层得分表格（基础层/关系层/共识层/进化层）和重心分析

##### 第四节：家庭类型画像
4.10 — SHALL 展示 12 型识别结果：主要类型（如 T1·卓越成长型）
4.11 — SHALL 展示：一句话描述、核心优势列表、核心短板列表、潜在风险列表

##### 第五节：改进建议（4层结构）
4.12 — SHALL 展示【优先干预项】（表格：阶段/时间/行动内容/频次，4 阶段 12 周）
4.13 — SHALL 展示【次要提升项】（列表）
4.14 — SHALL 展示【优势强化项】（列表）
4.15 — SHALL 展示【长期成长方向】（列表）

##### 第六节：风险预警
4.16 — SHALL 条件渲染预警卡片（红色🔴/橙色🟠/黄色🟡/无✅）
4.17 — 预警 SHALL 显示：预警状态文字、重点关注内容、建议复测时间

##### 第七节：若谷心语
4.18 — SHALL 展示个性化寄语（引用风格，基于家庭类型生成）

##### 第八节：附录
4.19 — SHALL 展示 8 维详细得分表（维度名/得分/满分/完成率）
4.20 — SHALL 提供展开/收起每题得分明细

##### 底部操作
4.21 — SHALL 包含"查看完整解读"、"购买FHI测评报告"、"分享给家人"按钮

#### 5. 分享落地页 (`share-landing.vue`)

5.1 — SHALL 显示分享者信息（名称、ID）
5.2 — SHALL 显示 8 维度列表
5.3 — 维度信息 SHALL 从 API 加载
5.4 — 提供"开始测评"和"注册并参与"两个 CTA

#### 6. 服务层 (`miniapp/src/services/fhi.ts`)

6.1 — SHALL 封装所有 FHI API 调用：
   - `getForm()` → `GET /api/v1/fhi/form`
   - `getDraft(formId)` → `GET /api/v1/fhi/drafts/current?form_id=xxx`
   - `saveDraft(formId, answers, currentIndex)` → `PUT /api/v1/fhi/drafts/current`
   - `deleteDraft(formId)` → `DELETE /api/v1/fhi/drafts/current`
   - `submitAnswers(formId, answers)` → `POST /api/v1/fhi/responses`
   - `getResult(responseId)` → `GET /api/v1/fhi/responses/:id`

#### 7. 类型定义 (`miniapp/src/types/fhi.ts`)

7.1 — SHALL 定义 TypeScript 接口：
   - `FhiQuestion` (id, text, isReversed, order, dimensionId, layerId)
   - `FhiDimension` (id, name, weight, rawMax, questions)
   - `FhiLayer` (id, name, maxScore, dimensions)
   - `FhiForm` (id, version, totalQuestions, maxScore, layers)
   - `FhiDimensionScore` (dimensionId, name, rawSum, weight, score, completion)
   - `FhiLayerRatio` (layerId, name, score, maxScore, ratio)
   - `FhiRingChart` (outerSaturation, middleSaturation, innerSaturation, flowStatus, blockedLayer)
   - `FhiFamilyType` (typeId, typeName, description, suggestion, strengths, weaknesses, risks)
   - `FhiAlert` (level, triggeredDimensions, message, actionText, retestAdvice)
   - `FhiSuggestion` (priority, secondary, strengths, longTerm)
   - `FhiReport` (sections: { core, ringChart, radarChart, familyType, suggestions, alert, heartMessage, appendix })

### 场景

#### Scenario: 完整答题→报告流程
- GIVEN 用户从首页进入，完成 69 题
- WHEN 提交后导航至 result 页
- THEN 显示完整 8 节报告
- AND 环形图渲染正确，3 环颜色分明
- AND 雷达图四象限布局正确
- AND 类型画像展示准确

#### Scenario: 预警卡片显示
- GIVEN 结果触发橙色关注
- WHEN result 页加载
- THEN 显示 🟠 橙色卡片 + 触发维度 + 复测建议

#### Scenario: 断点续答
- GIVEN 用户曾答到第 30 题后离开
- WHEN 再次进入 wizard
- THEN 恢复草稿，从第 30 题继续
