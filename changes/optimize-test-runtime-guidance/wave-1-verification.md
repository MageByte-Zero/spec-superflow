# Wave 1 定向验证与计时

测量方式：在同一 macOS 15.7.7 / Node 24.4.1 参考机上，直接运行各测试文件；测试 runner 输出的 suite `duration_ms` 用于和优化前完整回归日志中的同名 suite 对照。断言没有因计时而删除：仅将重复 child-process 链路改为进程内边界，公共 wrapper 冒烟仍由 `internal-command-guard-boundaries` 持有。

| 套件 | 命令 | 优化前完整回归同名 suite | Wave 1 定向结果 | 覆盖差异 |
| --- | --- | --- | --- | --- |
| 发布回执 | `node --test tests/lib/guard-specs-merged.test.mjs` | 94.69s，6 个回执场景 | 7/7 pass，suite 2.99s（进程 real 3.29s） | 保留 no-delta、缺 receipt、legacy boolean、current、source stale、baseline stale；新增注入流可观察断言。 |
| 执行计划 | `node --test tests/lib/execution-plan.test.mjs` | 91.87s，28 个场景 | 27/27 pass，suite 3.80s | 保留五种报告证据和第五次熔断；中间 repair 计数不再创建不同 Git commit，连续性仍由首次 retry 场景覆盖。 |
| `ssf execution` | `node --test tests/lib/cmd-execution.test.mjs` | 87.26s，33 个场景 | 33/33 pass，suite 6.34s（进程 real 18.86s） | state get/set/init 与 execution 均进程内；计划、revision、Git range、删除报告、首次 retry、第五次熔断仍断言。 |
| guard 控制记录 | `node --test tests/lib/guard.test.mjs` | 63.10s，14 个控制记录场景 | 37/37 pass，control-record suite 3.22s、全文件 4.07s | guard/CLI 重复调用进程内；报告删除和符号链接保留端到端，空/目录等由 execution-plan 快速合同覆盖。 |

附加边界证据：`node --test tests/lib/internal-command-guard-boundaries.test.mjs` 覆盖 `scripts/spec-superflow.mjs` 与 `scripts/guard/guard.mjs` 的成功、验证失败、stdout/stderr、exit code 和 cwd；`node --test tests/lib/verification-risk-ownership.test.mjs` 校验所有权矩阵。

这不是最终全量时间结论；Wave 3 仍须先构建、再单独计时完整 `npm test`。
