# Batch 1: 数据层 — 题库 + 类型定义

## Task 1.1: 创建完整题库 JSON (V3.0)

**文件**: `Create: shared/fhi/fhi-2.0.0.json`

**要求**:
- 构建完整嵌套 JSON：4 层级 → 8 维度 → 69 题
- 每道题包含：`id`(1-69), `text`, `isReversed`, `layerId`, `dimensionId`, `subDimensionId`, `order`
- **不包含** weight 字段
- 仅 4 题设置 `isReversed: true`：
  - 题 17: "家庭长期因资源匮乏而感到焦虑（反向）"
  - 题 34: "家庭中长期存在压抑氛围（反向）"
  - 题 35: "家庭成员经常处于紧张状态（反向）"
  - 题 44: "家庭长期存在价值观层面的激烈冲突（反向）"
- 版号: `"3.0.0"`, `total_questions: 69`, `max_score: 100`

**维度参数**:
| 维度ID | 维度名 | 权重(满分) | 题数 | 原始满分 | 所属层 |
|--------|--------|:----------:|:----:|:--------:|--------|
| d1 | 家庭结构稳定性 | 16 | 9 | 45 | foundation |
| d2 | 家庭资源保障性 | 14 | 8 | 40 | foundation |
| d3 | 家庭关系亲密度 | 18 | 11 | 55 | relationship |
| d4 | 家庭情绪环境 | 14 | 9 | 45 | relationship |
| d5 | 家庭价值稳定性 | 10 | 7 | 35 | consensus |
| d6 | 家庭精神文化 | 8 | 8 | 40 | consensus |
| d7 | 家庭韧性成长力 | 10 | 9 | 45 | evolution |
| d8 | 家庭系统规划力 | 10 | 8 | 40 | evolution |

**层级**:
- `foundation` / 基础层 / 30分（d1+d2）
- `relationship` / 关系层 / 32分（d3+d4）
- `consensus` / 共识层 / 18分（d5+d6）
- `evolution` / 进化层 / 20分（d7+d8）

**JSON 完整题目列表见 spec 文档**: `spec-superflow/changes/s8-fhi-core-logic/specs/fhi-question-bank/spec.md`

**完整性校验**:
- 8 维度满分之和 === 100
- 全部 69 题存在
- 反向题恰好 4 道（题号 17,34,35,44）
- 每题无 weight 属性

**参考文件**: 完整的题目列表在 spec `specs/fhi-question-bank/spec.md` 中

---

## Task 1.2: 定义前端 FHI 类型 (V3.0)

**文件**: `Create: miniapp/src/types/fhi.ts`

**TypeScript 接口**:
```typescript
interface FhiQuestion {
  id: number
  text: string
  isReversed: boolean
  order: number
  dimensionId: string
  layerId: string
  subDimensionId?: string
}

interface FhiDimension {
  id: string
  name: string
  weight: number
  rawMax: number
  questions: FhiQuestion[]
}

interface FhiLayer {
  id: string
  name: string
  maxScore: number
  dimensions: FhiDimension[]
}

interface FhiForm {
  id: string
  version: string
  totalQuestions: number
  maxScore: number
  layers: FhiLayer[]
}

interface FhiDimensionScore {
  dimensionId: string
  name: string
  rawSum: number
  weight: number
  score: number
  completion: number  // score / weight
}

interface FhiLayerRatio {
  layerId: string
  name: string
  score: number
  maxScore: number
  ratio: number       // score / maxScore
  distributionType?: string  // e.g. "基础层>60%"
}

interface FhiRingChart {
  outerSaturation: number
  middleSaturation: number
  innerSaturation: number
  flowStatus: '健康流动' | '局部阻塞' | '传导衰减' | '结构断裂'
  blockedLayer?: string
}

interface FhiFamilyType {
  typeId: string      // "T1"-"T12"
  typeName: string
  band: string        // 5档位
  description: string
  suggestion: string
  strengths: string[]
  weaknesses: string[]
  risks: string[]
}

interface FhiAlert {
  level: 'red' | 'orange' | 'yellow' | 'none'
  triggeredDimensions: Array<{
    dimensionId: string
    name: string
    score: number
    threshold: number
  }>
  message: string
  actionText: string
  retestAdvice: string
  isHiddenHighRisk?: boolean   // 隐性高危家庭标记
}

interface FhiSuggestion {
  priority: Array<{
    stage: string
    time: string
    action: string
    frequency: string
  }>
  secondary: string[]
  strengths: string[]
  longTerm: string[]
}

interface FhiReport {
  coreScore: { totalScore: number; band: string }
  ringChart: FhiRingChart
  radarChart: { dimensionScores: FhiDimensionScore[]; layerRatios: FhiLayerRatio[] }
  familyType: FhiFamilyType
  suggestions: FhiSuggestion
  alert: FhiAlert
  heartMessage: string
  appendix: { dimensionScores: FhiDimensionScore[] }
}
```

---

## Task 1.3: 更新后端评分类型定义

**文件**: `Modify: backend/src/shared/fhi/score.d.ts`

**需要新增的类型**:
```typescript
// 层级比值
interface LayerRatio {
  layerId: string
  name: string
  score: number
  maxScore: number
  ratio: number
  distributionType?: string
}

// 环形图数据
interface RingChartData {
  outerSaturation: number
  middleSaturation: number
  innerSaturation: number
  flowStatus: '健康流动' | '局部阻塞' | '传导衰减' | '结构断裂'
  blockedLayer?: string
}

// 家庭类型结果
interface FamilyTypeResult {
  typeId: string
  typeName: string
  band: string
  description: string
  suggestion: string
  strengths: string[]
  weaknesses: string[]
  risks: string[]
}

// 预警结果
interface AlertResult {
  level: 'red' | 'orange' | 'yellow' | 'none'
  triggeredDimensions: Array<{
    dimensionId: string
    name: string
    score: number
    threshold: number
  }>
  message: string
  actionText: string
  retestAdvice: string
  isHiddenHighRisk?: boolean
}

// 心语
interface HeartMessage {
  text: string
}

// 建议
interface SuggestionResult {
  priority: Array<{
    stage: string
    time: string
    action: string
    frequency: string
  }>
  secondary: string[]
  strengths: string[]
  longTerm: string[]
}

// 综合评分输出
interface ScoreOutput {
  totalScore: number
  dimensionScores: DimensionScore[]  // 现有类型扩展
  layerRatios: LayerRatio[]
  familyType: FamilyTypeResult
  alert: AlertResult
  ringChart: RingChartData
  heartMessage: string
  suggestions: SuggestionResult
}
```

**注意**: 保留现有 `DimensionScore` 类型不变，只需扩展字段。
