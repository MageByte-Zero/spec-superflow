# spec-superflow 执行链路与成本评估

日期：2026-09-20。基于 `1571ccc`、package version `1.2.0`。本次仅评估，未修改运行时代码或工作流规则。

## 结论

用户反馈的“慢”有充分的代码依据。主要原因是跨层协议不一致导致的阻塞与恢复返工，再叠加过多的执行控制、重复审查和大段提示词。暂未发现已检查解析循环中的无限循环或传统线程锁死锁；已复现多种工作流层面的互相等待和无法按文档继续的路径。

四项假设的评估：

| 假设 | 结论 | 主要证据 |
|---|---|---|
| 状态和门禁不闭环 | 成立 | 快速路径进不了 debugging；debugging 无合法重新规划出口；stale plan 与失败 review 互相阻塞 |
| CLI 与 Skill 偏差 | 成立 | resume 强制快速路径补 plan；阶段推进时机与注入规则相反；closing 与 finish 冲突 |
| 执行链路过重 | 成立 | 每任务、每 wave、最终审查重叠；每任务全量测试；修订强制 SDD；多层信息重复 |
| 严重 bug | 成立 | finish 在 worktree 内定位错误，实际未合并 main 却删除 worktree；模板任务无法保存 checkpoint |

没有用户真实运行轨迹，不能量化每种问题在用户会话中的发生频率，也不能把静态文本估算当成实际计费 token。下面区分“已复现”“代码/指令确认”和“优化建议”。

## 验证范围与结果

检查了九个核心 Skill、实现/审查子提示词、状态与 workflow 选择、guard、执行计划与回执、调试台账、恢复/checkpoint、isolate/finish、运行时资源、配置、hash、解析与验证关键循环，以及相应测试。

- `npm run build` 成功。
- `npm test`：856 tests / 147 suites，856 pass，0 fail，0 skipped，约 56.8 秒。这是本机本次结果。
- 使用独立临时 change 和临时 Git 仓库复现异常；未对真实仓库执行 merge、worktree 删除或状态迁移。
- 测试全部通过并不能证明跨阶段链路正确：本次异常多数落在模块间组合、恢复路径和真实 worktree 路径上。

本次诊断脚本与输出保存在 `/tmp/ssf-audit-repro.mjs`、`/tmp/ssf-review-repro.mjs`、`/tmp/ssf-finish-repro.mjs` 及同名前缀日志中。脚本从仓库根目录运行，全部使用临时目录；它们不是已加入测试套件的回归测试。

## 优先修复的阻塞与缺陷

### F1 · P1 · finish 把隔离 worktree 当成主干，随后删除它【已复现】

位置：`scripts/lib/cmd-finish.mjs:92`、`:131`、`:205`。

`mainRoot` 来自 `git -C <change-dir> rev-parse --show-toplevel`。当 change-dir 位于隔离 worktree，这个结果就是隔离 worktree；代码随后在这里 merge 自己的分支，并将“隔离 HEAD 是当前 HEAD 的祖先”当成合并完成证明。

复現：创建 main 和 demo worktree，在 demo 提交 feature，再从 demo 传入其内部的 `changes/demo` 调用 finish，验证命令使用恒成功的测试桩。

结果：日志报告 merge 成功；真正 main HEAD 不变、没有 feature；worktree 被删除；最后删除分支时因为 `mainRoot` 已不存在而报错。分支引用仍保留，本次未观察到提交丢失，但工作目录已经被清理，用户需要额外恢复。

建议：隔离时持久化源 checkout、目标分支、隔离 checkout 和实际分支名；finish 按这份元数据定位与验证合并目标，确认目标确实包含隔离提交后才清理。不要用当前路径或 change 目录名推断全部生命周期信息。已有 feature branch、branch fallback、自定义隔离名称也必须覆盖。

### F2 · P1 · 快速路径恢复被要求补建禁止创建的 execution plan【已复现】

位置：`scripts/lib/change-recovery.mjs:77`、`:118`；对照 `skills/workflow-start/SKILL.md:41` 和 build-executor 快速路径规则。

`inspectExecution` 只依据 approved-for-build / executing / debugging 判断 required，没有依据 workflow 与有效 receipt 豁免。

使用真实 `workflow recommend → accept → approved-for-build → executing` 建立 Quick，再生成恢复摘要，得到 `EXECUTION_PLAN_REQUIRED`，next_action 要求重建 plan。Skill 却明确不允许 Quick 建 plan。Tweak / direct Hotfix / lightweight 同样受到这个状态判断影响。

建议：guard、resume、execution/debug CLI 和 Skill 路由共用一个 workflow policy；恢复读到有效快速路径 receipt 时直接给出 bounded verification 的下一步。

### F3 · P1 · 调试入口缺失，调试期间重规划也缺少出口【已复现】

位置：`scripts/guard/guard.mjs:37`、`:81`、`:110`、`:199`。

Quick、Tweak、lightweight 的独立转换表有 debugging→executing，却没有 executing→debugging；又明确不回退 Full 表，所以进入调试返回 `workflow-transition-unknown`。direct Hotfix 的 fallback 行为不同，不能把四者混为一谈。

Full 的 debugging 只有恢复 executing 或 abandoned 的出口，没有 debugging→specifying/bridging。用完整示例工件和有效 execution plan，确认恢复门禁原本通过；进入 debugging 后模拟发现新增 scope 并更新 proposal，再测试：恢复 executing 被 stale contract/plan 阻止，退回 specifying/bridging 又是不合法转换。

建议：所有支持执行的模式都应有明确调试入口；debugging 应可因 scope/contract 变化直接回到对应规划阶段。正常恢复保留 freshness 检查，重新规划出口不能要求旧计划先变新。

### F4 · P1 · resume 可以绕过 debugging 的调查阶段【已复现】

位置：`scripts/lib/change-recovery.mjs:155`、`:178`。

`selectNextAction` 优先依据 plan 中 eligible wave 返回 build-executor，然后才看 state 路由。状态明确为 debugging、plan 有未完成 wave 时，恢复结果却是 build-executor。

建议：先决定状态允许的操作，再考虑 eligible wave；debugging 优先路由调查，不因存在可执行任务而恢复普通派发。

### F5 · P1 · stale plan 与失败 review 构成恢复环【已复现】

位置：`scripts/lib/execution-plan.mjs:145`、`:308`。

已有 fail receipt 时，对 tasks 增加一个空行：

1. resync 拒绝，要求先关闭 fail 修复链。
2. review 拒绝，要求 plan 先有效。

这不是无条件永久死锁：还原文档到旧 hash 或 revise 能绕行。但前者要求找回精确内容，后者使旧 review 失效，并可能升级 SDD，和“无语义修正的低成本恢复”目标相反。

建议：为确认无语义变化的 resync 提供保留失败链的迁移；或在一个恢复命令中明确给出可逆操作。避免把“先修 A”与“先修 B”同时设为唯一建议。

### F6 · P1 · 固定复审报告路径会破坏上一轮失败证据【已复现核心机制】

位置：`skills/build-executor/SKILL.md:173`、`skills/build-executor/task-reviewer-prompt.md:156`；`scripts/lib/execution-plan.mjs:164`、`:588`。

失败 receipt 绑定报告内容 hash。Skill 首次报告使用 `<wave>.md`，复审使用固定 `<wave>-rereview.md`；如果后续一轮覆盖仍被失败 receipt 引用的报告，记录新 review 前就会因旧报告 hash 不匹配而拒绝。adjudicate 同样要求旧失败证据有效。

在临时 Git 仓库记录 fail 后覆盖同一个报告，再尝试记录 pass，稳定返回 `failed review report evidence is invalid`。因此固定复审文件名在第二次复审写入时存在可确定的冲突。

建议：CLI 分配不可变的 wave/attempt 报告 ID，报告路径每轮唯一。每任务报告和每 wave 回执也要区分。不要要求代理自行猜命名规则。

### F7 · P1 · 阶段推进时机与注入规则互相矛盾【指令确认】

位置：`skills/workflow-start/SKILL.md:135`；`skills/spec-writer/SKILL.md:70`；`skills/contract-builder/SKILL.md:48`；`scripts/lib/cmd-inject.mjs:10`、`:25`。

入口保留 exploring，让 spec-writer 在完成全部规划工件并 DP-2 后才转 specifying；但 exploring 的 phase guard 禁止创建规划工件。contract-builder 又在写完并批准契约后才转 bridging；specifying 的 phase guard 禁止修改契约。

中断恢复也有问题：已经 specifying 的变更重跑 spec-writer，结尾仍执行 specifying→specifying；已经 bridging 时 contract-builder 同样会尝试自转换，CLI 没有这样的边。

建议：统一状态为“当前允许执行的阶段”。先检查并进入 specifying，再写规划工件；先进入 bridging，再生成契约。对恢复明确 `if state != target`。注入内容由同一 policy 生成，避免另一套自然语言状态机。

### F8 · P1 · closing 提前宣告终止，finish 失败后恢复无路由【指令与代码确认】

位置：`skills/workflow-start/SKILL.md:20`；`skills/release-archivist/SKILL.md:113`、`:116`；`scripts/lib/change-recovery.mjs:137`。

release-archivist 一方面称 closing 转换是最终动作、之后停止，紧接着又要求转换后执行 finish。workflow-start 与 resume 遇到 closing 直接 next=none；finish 失败仍保留 closing，下一轮按正常入口无法继续完成物理归档。

建议：定义一个明确终点。优先保持 executing 直到 Full 的验证、同步与必需收尾全部完成，再原子化关闭；若保留“逻辑关闭先于物理合并”，则必须有独立 finish status 和可恢复下一步，不能仅凭 closing 宣称所有工作完成。

### F9 · P2 · 模板生成的标准任务无法保存 checkpoint【已复现】

位置：`templates/tasks.md:11`；`scripts/lib/sdd-overlay.mjs:69`。

模板是 `- [ ] **1.1 ...**`；`computeTaskHash` 只接受 `- [ ] 1.1 ...`。用模板形式调用 task hash 返回 `Task '1.1' was not found in tasks.md`。Inline 要求任务间保存 checkpoint，因此按模板执行就可能在记录进度时中断。

建议：任务格式、task-brief、task count、hash、完成检查使用同一个解析器，覆盖加粗、缩进、CRLF。不能为保存执行进度要求用户改写已经批准的计划格式。

### F10 · P2 · artifacts.skip 不能贯穿后续门禁【已复现 specs 分支】

位置：`scripts/guard/checks/artifacts-exist.mjs:16`；`schema-valid.mjs:31`；`tasks-checkbox-format.mjs:11`；`tasks-complete.mjs:10`。

存在性检查尊重 skip；schema 仍固定要求至少一个 spec。跳过 tasks 时，进入执行和关闭的任务门禁仍要求 tasks.md。配置允许省略工件，但后续会要求补回，精简路径形同无效。

建议：要么明确禁止跳过必要工件，并在配置时解释原因；要么把 skip 转成统一 artifact policy，检查替代证据。不能允许配置成功后才在下游反复补文件。

### F11 · P2 · state set 成功却丢弃允许写入的字段【已复现】

位置：`scripts/lib/cmd-state.mjs:20`；`scripts/lib/state-loader.mjs:64`。

允许设置 `dp_1/2/3/6/7_decisions`、`confirmed`，但 writer 没有序列化对应全部字段。`state set ... dp_2_confirmed true` 返回成功，紧接 `state get` 返回 null。

建议：字段 schema 统一派生默认值、允许更新字段与序列化器；测试对所有 settable 字段做 round-trip。状态格式不要宣称可从工件完整重建：人工批准与真实执行证据无法靠工件推断。

## 已确认的成本放大机制

### C1 · Plan revise 强制 SDD，并使已有回执失效

`scripts/lib/cmd-execution.mjs:86` 明确拒绝任何非 sdd 的 revise。实测单任务推荐 inline、创建 inline 成功；再次推荐仍是 inline，但 revise inline 失败。这是现有政策实现，不是偶然抛错。

简单计划变更可能强制派发子代理、加载模板、重新审查旧 wave。建议修订保留用户模式，允许基于当前事实重新推荐；只使受影响任务及其依赖的证据失效。

### C2 · 审查粒度没有统一

`skills/code-reviewer/SKILL.md:12` 同时要求每个 SDD task、每个 wave、每个 major feature、合并前审查。build-executor 也同时定义 Per-Task Loop、Planned-Wave Loop 和 final broad review。

CLI 却只有每个 wave 的单一 pass/fail receipt；已经 pass 的 wave 再记录会报错。task-reviewer 的默认路径还只含 wave ID，多个 task 易互相覆盖。应明确：任务自查是轻量内部动作，独立审查以 wave 为单位；最终审查只覆盖集成风险和尚未覆盖的 diff。一个波次的多个 task 不分别写同一 wave 的最终回执。

另一个审查正确性问题：code-reviewer 用 `HEAD~1` 取 base，但 review-package 明确使用任务开始时 base 以覆盖多次提交；两套约定会造成漏审或补审返工。

### C3 · 全量测试按任务重复运行

implementer-prompt 要求每个 task 在提交前跑全量；release-archivist 再跑全量；finish 默认再跑 `npm test`。不计修复，N 个任务至少形成 N+2 次全量执行要求。

以本仓库本次 56.8 秒为示意，6 个任务约产生 8 次、7.6 分钟累计全量测试工作；并发、缓存、环境变化会改变实际墙钟时间，不能当成实测端到端耗时。reviewer 模板已经限制无理由重跑测试，这是应保留的优化。

建议按变更范围做任务定向验证，集成 wave 做回归，最终代码快照做一次全量；合并后验证依据实际合并结果判断是否需要补跑。复用证据需绑定 tree、命令、环境和结果，不能只复用一句 pass。

### C4 · 小工作也加载完整大工作流

使用仓库 `token-baseline.mjs` 的字符估算口径：

| 项目 | 估算 token |
|---|---:|
| workflow-start | 4,534 |
| build-executor | 4,974 |
| release-archivist | 2,065 |
| 以上三项合计 | 11,573 |
| baseline 工具全部统计项 | 20,731 |
| 仓库既有 token-baseline.json | 9,669 |

同口径总量增长 114.4%；workflow-start 增长 170.8%，build-executor 增长 284.7%。工具统计的是磁盘文本，不是所有文本都会在每次执行加载，也没有计入模型思考、工具结果、项目工件与历史上下文。

九个 Skill 中 Standard User-Facing Handoff 段落累计 11,076 字符，占九个 Skill 总字符约 13.8%。implementer 和 task-reviewer 模板分别约 2,005、2,432 token；如果每任务完整展开，6 个任务仅这两个模板就约 26,622 token，尚未含任务上下文。

建议：入口只做 detect→next action；按 workflow/mode 按需加载详细规则；公共输出规则仅定义一次；子代理只接任务差量、相关约束、证据路径。无需牺牲行为边界、验收条件和异常处理。

### C5 · 同一信息跨多个可变载体重复

当前 proposal/spec/design/tasks → contract 又写 behavior、scenarios、test obligations、waves → execution-plan JSON → state summary → progress → review/checkpoint。部分重复用于审计合理，但目前不同载体同时承担事实来源，导致 hash/receipt 迁移工作远超任务本身。

建议保留稳定 ID 引用而非复制正文。人读文档负责意图、行为、设计决策；机器记录负责状态、批准、执行证据。状态、进度与证明不要同时要求代理手写。

### C6 · 额外等待与资源寻址开销

- workflow-start 每次运行 check-update；`scripts/check-update.mjs:43` 同步 npm 查询最多等 10 秒，代码没有 TTL 缓存。“提醒非阻塞”不等于进程不等待。建议移出关键链路或缓存一天；不要把已结束变更恢复绑到网络检查。
- `cmd-isolate.mjs:31` 外层 15 秒超时，`ensure-branch.mjs:112` 子模块初始化允许 120 秒。正常慢 clone 可能被上层提前终止并留下部分隔离上下文。此项为静态确认，未做真实网络慢速复现。
- runtime asset allowlist 没包含 re-review-prompt、writing-good-tests、code-reviewer-prompt；已验证用 portable asset read 读取 re-review-prompt 被拒绝。外部消费仓库不一定存在 Skill 中的相对路径，需要额外找插件根目录。建议所有必需资源走同一运行时解析接口。
- 没配置 model profile 时，Skill 同时要求显式 model 且不允许自动选择，可能停在派发前。建议明确继承宿主模型的低配置回退规则，而不是为了成本优化制造硬门禁。

## 建议的精简目标

不要立即再叠加一层控制面。先让现有路径闭环，再删重复信息和交互。

### 统一可执行事实

用共享 policy 回答：当前模式需要哪些工件、允许哪些转换、哪些证据使下一步可执行。guard、resume、inject、debug、closing 均调用它。Skill 只解释为什么、如何完成当前动作。

提供一个紧凑状态读取入口（可以扩展已有 resume，不必新增命令），返回：`state`、`workflow`、`next_action`、`blockers`、`required_evidence`。正常回复不重复全部 plan/recommendation/历史。

状态迁移要求：合法回退、恢复幂等、终态有真实完成条件。人工授权作为独立证据保存，不能被 init/rebuild 的 hash 刷新隐式替代。

### 两档负担，明确异常路径

- 小改动：请求边界 + 一条结构化记录（模式、验证方式、diff、结果），定向验证，确有风险时一次 focused review，然后关闭。
- 复杂改动：规划和批准 + wave 级执行与审查 + 统一收尾。SDD 由独立任务可并行性和风险决定，不因文档修订自动触发。

Quick/Tweak/Hotfix 可以保留为不同资格/验证政策，但不要为每个名字维护一套近似却不同的状态机。Hotfix 的事故回归要求应保留。

### 文件精简而不丢信息

推荐的新变更最小人读布局：

| 文件 | 唯一职责 |
|---|---|
| proposal.md | 问题、范围、非目标、验收概览；小变更可由结构化记录替代 |
| specs/ | 跨实现仍有效的行为与场景；只保存真实需求 |
| design.md（条件生成） | 非显然的架构选择、约束与风险；无决策则省略 |
| tasks.md | 任务 ID、依赖、交付结果、证明命令 |

execution-contract 若保留，应是上述工件的短索引与批准快照：hash、需求/任务 ID、例外和风险；不要再复制全部规格与 wave。执行计划和进度归机器 ledger，review 只记录结论、问题、代码范围和证据。

这是后续设计方向，涉及兼容迁移，不能直接删除现有契约或证据。

### 减少确认次数

把 DP-0/DP-1 重复的 scope 确认合并；规划包审批与派生契约的重复审批合并为一个用户能审阅的结果；执行模式默认使用用户已接受的策略，仅在实质风险变化时重新询问。调试失败、范围变化、不可逆外部操作仍保留必要决策。

## 整改顺序与验收

1. **先修正确性**：F1 收尾定位；F2–F4 路由和 debug 边；F5–F6 失败恢复；F7–F8 阶段和终态协议。否则“压缩 Skill”只会把 bug 隐藏得更深。
2. **统一格式与策略**：F9–F11、skip、字段 schema、资源解析、超时预算；把模板当作集成测试输入。
3. **再降执行成本**：取消强制 SDD 修订，统一 wave review，按代码快照复用验证证据，压缩公共指令与派生工件。

至少增加以下端到端验收：

- 从真实模板建立 change，按 Skill 顺序完整走完，不允许测试直接写终态掩盖路径问题。
- 每种 workflow 在每个中间阶段中断后 resume，得到唯一合法下一步。
- Quick 验证失败→debug→修复→closing，全程无 contract/plan。
- Full debug 发现范围变化→重新规划→批准→继续；旧证据仅按影响失效。
- fail review + 非语义修正、连续两轮复审、并行 wave 证据均可恢复。
- 原 checkout 与隔离 checkout 两种路径调用 finish；合并前中断、测试失败和清理失败可恢复且不误报完成。
- 所有 settable 字段写读一致；模板任务可保存 checkpoint；skip 在所有门禁一致。

性能验收先记录基线：CLI 调用数、人工确认轮次、加载提示词字节、模型实际输入/输出 token、独立审查次数、全量测试次数、自动重试数与总耗时。用单文件修复、小型多文件变更、跨模块 Full 三类固定场景比较。可将“标准场景提示词输入减半、简单任务不启用 SDD、同一代码快照不无理由重复全量验证”作为目标，但目前没有数据证明这些目标已经实现。

## 补充：与 Superpowers v6.4.1 的执行策略对比

核验日期 2026-09-20；GitHub latest release API 返回 v6.4.1，发布于 2026-09-19 00:32:44 UTC。固定 tag 的 commit 为 `5bf4e78011075bcfc0dc295f0724994cd123ee71`。以下是上游参考与本项目建议，不代表已修改当前行为。

上游 v6.4.1 把 Native 执行作为正式的低成本选项：主会话实施整份计划，末尾一次独立审查。它没有宣布全面取消 SDD，也没有把 Native 无条件设为所有项目默认；计划交接仍根据计划事实给出推荐并保留用户已选模式。[发行说明](https://github.com/obra/superpowers/blob/v6.4.1/RELEASE-NOTES.md)

| 维度 | spec-superflow 当前行为 | v6.4.1 参考与建议 |
|---|---|---|
| 普通多任务实现 | 多 wave 或任务数超过阈值便推荐 SDD | Native 能执行整份计划；本项目应优先考察耦合、风险和上下文成本，不能只按数量升级 |
| Inline 审查 | 每个 planned wave 仍需 review receipt | Native 没有逐任务独立审查，末尾一次 fresh review；要真正降低当前成本，需要同步改 guard 和 receipt policy |
| 模式修订 | revise 必须 sdd | 上游 Native/SDD 共用恢复 ledger；本项目应允许切换执行方式而保留仍有效的完成证据 |
| 同类微任务 | Per-Task Loop 容易逐项派发 | 同类小改动合并为一个 dispatch/review 单位 |
| 修复 | 有 focused re-review，但代理复用约定不够明确 | 前几轮复用原实现代理，复审只读取修复范围；保留每轮不可变报告路径 |
| 并行 | parallel wave 推荐 SDD | 上游 SDD 明确禁止多个 implementation 子代理并行；SDD 的主要收益是上下文隔离与逐任务审查，不等于并行加速 |
| 模型选择 | 配置 profile，未配置时缺乏默认出口 | 按角色难度选择；便宜模型多轮重试可能反而贵，实际轮次和成功率比单价更有意义 |

[Native 规则](https://github.com/obra/superpowers/blob/v6.4.1/skills/executing-plans/SKILL.md)；[SDD 规则](https://github.com/obra/superpowers/blob/v6.4.1/skills/subagent-driven-development/SKILL.md)。

推荐保留两种执行模式，不再新增第三套状态机：

- **Native 为本项目默认建议**：主会话直接执行，按实际交付结果组织任务，保存简短完成证据；Full 的末尾保留一次独立审查。Quick/Tweak 继续使用其适用验证规则，不统一强加重型最终审查。
- **SDD 按需启用**：用户要求逐任务独立审查，或任务上下文确实可隔离且交接收益大于重建成本。任务多、文件多、多 wave 都不是充分条件。
- **局部高风险不等于全局 SDD**：主会话实现时，可仅在共享接口、数据迁移或权限边界定稿处增加一次独立审查。这是审查政策，不必新增执行模式或 DP。
- **依赖强的任务由同一执行者连续处理**：先压缩为可验收交付单元；不要仅为了调度把创建文件、补字段、更新配置和写测试各拆成代理任务。

例如，30 个任务按每任务一个 implementer、一个 reviewer，再加 final reviewer，理想无返工情形也有 61 次派发；Native 实现可把常规派发降到最终一个 reviewer。但实际实现工作和主会话上下文仍有成本，不能据此宣称 token 或耗时下降 98%。截图中的 69 次派发须逐项归因后才能判断浪费比例。

值得吸收的规划机制是任务按可独立验收结果划分、显式列出依赖接口，以及一次性列出最容易漏掉的输入/失败条件并归属到对应测试；不建议照搬上游把完整实现代码预写进所有计划的要求，这会与本项目精简工件目标冲突。[规划规则](https://github.com/obra/superpowers/blob/v6.4.1/skills/writing-plans/SKILL.md)

也不直接照搬以下选择：Native 修复后永不复审、所有最终审查都固定使用最强模型、任何计划歧义都由控制器自行裁定。应分别根据修复风险、diff 难度、是否改变用户批准的需求决定；同时避免以“风险”为由对普通可逆实现细节重复询问。

建议后续用同一组代表任务对当前模式、Native、同类任务合并后的 SDD 做比较，固定验收标准与模型组合，记录：总输入/输出 token、费用、墙钟时间、代理累计运行时间、派发/重试数、用户等待、漏检问题及返工。先验证能否减少派发同时保持缺陷发现能力，再宣称收益。

## 补充：OpenSpec v1.13.1 的可借鉴机制

2026-09-20 核验 GitHub latest release 为 v1.13.1（2026-09-17 发布），已将该 tag 源码取到临时目录核对。以下机制部分早于本次发布；不将所有 OPSX 特性都归为 v1.13.1 新增。[发行说明](https://github.com/Fission-AI/OpenSpec/releases/tag/v1.13.1)

| 机制 | 上游证据 | 对本项目的建议 |
|---|---|---|
| 依赖驱动的动作 | `src/core/artifact-graph/graph.ts`；`schemas/spec-driven/schema.yaml` | planning readiness 从工件依赖推导；保留必要授权和验证门禁，减少为了改文档而扭转阶段 |
| 明确下一步 | `src/core/change-status-policy.ts`；`src/commands/workflow/status.ts` | status/resume 返回同源的 next action、阻塞原因与补齐方法；不用 Skill 再独立算一次 |
| 按当前动作返回指令 | `src/commands/workflow/instructions.ts` | 返回当前任务所需路径、进度和规则；不每次加载全流程说明 |
| 入口指令单一来源 | `src/core/templates/workflows/apply-change.ts` 的 `getApplyInstructions` 同时用于 Skill 与 command | 将共享规则和模式政策做成单一来源；注意上游并不是把全部 runtime gate 都由这段文字生成 |
| Profile 控制安装内容 | `src/core/profiles.ts` | 核心入口与高级恢复工具分离；仅引用实际可用命令，缺少扩展 Skill 时给 CLI fallback |
| 显式跳过无行为变更的 specs | `schemas/spec-driven/schema.yaml` 与 apply 的 `skip_specs` 处理 | 无规格行为变化时不创造虚假需求；skip 同时用于 readiness、验证、同步与归档 |
| 任务解析统一与保守判定 | `src/utils/task-progress.ts` | 一套任务解析器服务 status/checkpoint/hash/closing；不认识的 checkbox 状态视为未完成，避免误关单 |
| 工件各司其职 | `schemas/spec-driven/schema.yaml` | specs 写行为；design 写非显然决策并引用 proposal；每个 task 自带证明方式，跨任务集成才独立列验证任务 |
| 安全归档 | archive 与发行说明的 preflight/校验机制 | 先验证候选变更再写入；解析、validate 与 sync/archive 使用一致的 delta 解释，避免执行末尾才发现分歧 |

[OPSX 文档](https://github.com/Fission-AI/OpenSpec/blob/v1.13.1/docs/opsx.md)；[默认 schema](https://github.com/Fission-AI/OpenSpec/blob/v1.13.1/schemas/spec-driven/schema.yaml)；[共享 apply 指令](https://github.com/Fission-AI/OpenSpec/blob/v1.13.1/src/core/templates/workflows/apply-change.ts)。

不能照搬的细节：

- `src/core/artifact-graph/state.ts` 的 completed 以输出文件存在为依据；这不是语义正确、契约已批准或代码验证通过。SSF 仍需内容校验和与变更绑定的批准证据。
- 默认 schema 的 design 指令说按复杂性决定是否创建，但 tasks 的 requires 仍包含 specs 与 design。不能据文字说明认定默认图已经实现所有可选工件；SSF 必须在政策和门禁两层一致支持省略。
- apply 实際阻塞依据直接 `apply.requires`；缺失传递依赖另有诊断与警告。SSF 要明确区分必须满足的安全条件与建议补齐的内容，不能把任何“ready”都解释成全链验证通过。
- Profiles 减少安装的入口，不等于自动减少每次调用的上下文：上游 apply 仍要求读取返回的所有 contextFiles。SSF 可进一步按任务裁剪，但必须携带约束与依赖接口。
- Stores 等跨仓库规划能力目前不解决本轮慢与 token 问题，不纳入本轮整改。
- OpenSpec 的 archive 主要是规范同步和变更归档，不能直接当作 SSF 的 Git merge/worktree cleanup 实现。

融合后的建议：OpenSpec 提供工件依赖与明确下一步的思路；Superpowers 提供 Native 执行、必要独立审查与恢复纪律；SSF 保留可验证批准、增量规范和跨平台入口。用户只需要理解规划、执行、验收收尾，内部用共享 policy 决定当前动作，避免再叠加新的流程层。与前文一致，本轮先修正确性，再逐步替换现有重复规则，不一次重写全部状态机。
