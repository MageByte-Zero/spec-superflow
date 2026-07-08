# Batch 2 前半段: 评分引擎 V3.0 重写 (Task 2.1-2.3)

## 背景

当前 `backend/src/shared/fhi/score.ts` 使用旧公式，需要完全重写为 V3.0 规范。

### 现状
- 当前 `score.ts` 读取 `FormPackage.dimensions[]`（旧结构），新 JSON 使用 `layers[].dimensions[].subDimensions[].questions[]`
- 当前仅返回 `{ score_total, band_code, band_name, dimension_scores }`
- 新 JSON 文件位于 `shared/fhi/fhi-2.0.0.json`
- API 路由 `backend/src/routes/v1/fhi.ts` 通过 `import fhiPackage from '../../shared/fhi/fhi-2.0.0.json'` 加载
- API 调用：`const result = scoreAnswers(fhiPackage as any, answers)`

### 新 JSON 结构示例
```json
{
  "version": "3.0.0",
  "total_questions": 69,
  "max_score": 100,
  "layers": [{
    "id": "foundation",
    "name": "基础层",
    "maxScore": 30,
    "dimensions": [{
      "id": "d1",
      "name": "家庭结构稳定性",
      "weight": 16,
      "rawMax": 45,
      "subDimensions": [{
        "id": "d1_1",
        "name": "家庭成员稳定性",
        "maxScore": 4,
        "questions": [
          { "id": 1, "text": "家庭主要成员长期稳定共同生活...", "isReversed": false, "order": 1 },
          { "id": 2, "text": "家庭整体关系较少出现严重动荡...", "isReversed": false, "order": 2 }
        ]
      }]
    }]
  }]
}
```

### 答题输入格式 (Answer)
```typescript
interface Answer { question_id: string; value: number }
// question_id 是题号字符串（如 "1", "2"），value 1-5
```

### 依赖类型 (已实现于 score.d.ts)
- `ScoreOutput` 类型已定义，含 totalScore, dimensionScores, layerRatios, familyType, alert, ringChart, heartMessage, suggestions
- `Answer` 类型已存在

## Task 2.1: V3.0 评分公式

**文件**: `Modify: backend/src/shared/fhi/score.ts`

**要求**:
1. 函数签名改为: `export function scoreAnswers(answers: Answer[], form?: any): ScoreOutput`
   - 内部直接 `import` 新 JSON（使用 `import fhiData from './fhi-2.0.0.json' with { type: 'json' }`）
   - `form` 参数可选保留用于测试时传入 mock 数据
   
2. 核心公式:
   ```
   normalized_rating = isReversed ? (6 - rating) : rating
   dimension_raw_sum = SUM(该维度所有题目的 normalized_rating)
   dimension_score = (dimension_raw_sum / dimension_rawMax) × dimension_weight
   ```

3. 维度参数:
   | 维度ID | rawMax | weight |
   |--------|:------:|:------:|
   | d1 | 45 | 16 |
   | d2 | 40 | 14 |
   | d3 | 55 | 18 |
   | d4 | 45 | 14 |
   | d5 | 35 | 10 |
   | d6 | 40 | 8 |
   | d7 | 45 | 10 |
   | d8 | 40 | 10 |

4. 层级比值:
   - foundation: layerScore = d1+d2, maxScore=30
   - relationship: layerScore = d3+d4, maxScore=32
   - consensus: layerScore = d5+d6, maxScore=18
   - evolution: layerScore = d7+d8, maxScore=20
   - ratio = layerScore / maxScore
   - distributionType: 
     - 全部 ≥ 60% → "四层均衡"
     - foundation > 60% AND 最高 → "基础层>60%"
     - relationship > 60% AND 最高 → "关系层>60%"
     - consensus > 60% AND 最高 → "共识层>60%"
     - evolution > 60% AND 最高 → "进化层>60%"

5. 反向题: 仅题 17, 34, 35, 44 为反向

6. 5 档位:
   | 范围 | code | name |
   |------|------|------|
   | 90-100 | growth | 卓越成长型 |
   | 75-89 | harmony | 稳定发展型 |
   | 60-74 | developing | 风险预警型 |
   | 40-59 | attention | 失衡压力型 |
   | 0-39 | support | 高危重建型 |

## Task 2.2: 12型识别 + 三级预警

**文件**: `Modify: backend/src/shared/fhi/score.ts` (同一文件，补充函数)

### 12型判定 (优先级 T1→T12)
```
dimension_completion = dimension_score / dimension_weight

T1:  总分≥90 AND 所有维度完成率≥60%
T2:  关系层比值 > 基础层比值 AND 关系层比值≥70%
T3:  基础层比值 > 关系层比值 AND 基础层比值≥70%
T4:  共识层比值≥70% AND 精神文化(d6)得分最高
T5:  进化层比值≥70% AND 韧性(d7) > 结构(d1)
T6:  资源(d2)完成率 < 40% AND 总分60-74
T7:  (亲密度(d3)完成率 < 40% OR 情绪(d4)完成率 < 40%) AND 总分60-74
T8:  价值(d5)完成率 < 40%
T9:  规划(d8)完成率 < 40%
T10: 基础层比值≥60% AND 关系层比值 < 40%
T11: 总分40-59 AND 至少2个维度完成率 < 40%
T12: 总分<40 OR 触发底线预警
```

### 三级预警 (维度级检测)
```
核心因子:
- 关系亲密度(d3) < 7.2(40%×18) → 亲子信任/夫妻支持风险
- 情绪环境(d4) < 5.6(40%×14) → 情绪安全感/压抑紧张度风险

级别:
- 红色(red): d3<7.2 OR d4<5.6 AND 总分<60
- 橙色(orange): d3<7.2 OR d4<5.6 AND 总分≥60
- 黄色(yellow): 任一维度完成率<50% 但未触发核心因子
- 橙色+总分75-89 → isHiddenHighRisk=true
```

### T1-T12 的建议文本
参考 V3.0 文档 (`../../../若谷家庭幸福指数（FHI）测评系统 V3.0.0` 的 4.2 节) 中的"一句话描述"和"若谷建议"

## Task 2.3: 环形图能量流 + 若谷心语 + 4层建议

**文件**: `Modify: backend/src/shared/fhi/score.ts` (同一文件)

### 环形图 (V3.0 三环结构)
```
外环(根基层): d1+d2, max=30
中环(能力层): d3+d4+d5+d6, max=50 (注意！V3.0 中环包含关系层+共识层4维度，max=50)
内环(目标层): d7+d8, max=20

饱和度 = layerScore / layerMax
能量传导:
  flow_base_to_cap = middle_sat / outer_sat (if outer_sat>0)
  flow_cap_to_target = inner_sat / middle_sat (if middle_sat>0)

流动状态:
  both ≥ 0.8 → "健康流动"
  any < 0.5 → "局部阻塞"
  其他 → "传导衰减"
  如果外环/中环/内环出现 0 → 对应的流为 0
```

### 若谷心语
基于家庭类型(T1-T12)生成简短心语。例如:
- T1: "您的家庭已经构建了一个令人羡慕的幸福生态系统。请珍惜这份来之不易的平衡，也可将您的经验分享给更多家庭。"
- T12: "看见家庭的伤痛本身就是勇气的开始。寻求专业帮助不是失败，而是给家庭一个重生的机会。"

为全部 12 型生成对应心语。

### 4层建议
- priority: 4阶段(第1-2周/第3-4周/第5-8周/第9-12周)，基于最薄弱维度生成行动建议
- secondary: 次薄弱维度巩固建议(2-3条)
- strengths: 优势维度强化建议(2-3条)
- longTerm: 长期方向(1-2条)

### 复测建议
- red → "3个月后复测"
- orange → "6个月后复测"  
- yellow/none → "12个月后复测"
