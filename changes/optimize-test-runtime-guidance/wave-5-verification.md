# Wave 5 验证：全量测试时长

## 环境

- macOS 15.7.7；12 CPU
- Node.js v24.4.1
- Apple Git 2.50.1
- `npm run build` 在计时前通过；计时只包含后续 `npm test`。

## 结果

```text
tests 653
pass 653
fail 0
cancelled 0
skipped 0
todo 0
real 164.38 seconds
```

`npm test` 使用既有完整命令：`node --test --test-concurrency=2 tests/e2e.test.mjs tests/lib/*.test.mjs`；未省略测试文件，也未提高并发。

## 热点与结论

| 测量 | 耗时 |
|---|---:|
| 上轮全量基线 | 188.34 秒 |
| 本轮全量 | 164.38 秒 |
| 改善 | 23.96 秒（12.7%） |
| 参考目标 | 180 秒 |

### 当前 HEAD 的单套件计时

以下命令均以 `node --test --test-concurrency=2 <suite>` 单独运行并退出为 0：

| 热点套件 | `real` |
|---|---:|
| `tests/lib/guard-specs-merged.test.mjs` | 4.06 秒 |
| `tests/lib/execution-plan.test.mjs` | 11.73 秒 |
| `tests/lib/cmd-execution.test.mjs` | 12.68 秒 |
| `tests/lib/guard.test.mjs` | 17.16 秒 |

本轮比目标快 15.62 秒。`execution-plan` 通过同进程复用完整 immutable Git SHA 的仓库、commit 与 ancestry 证明，避免相同回执在计划、guard 和审查链中重复启动 Git。符号引用、新范围和不同仓库仍重新解析；成功与非祖先失败均有合同测试。定向四热点回归为 106/106 通过，62.90 秒（含构建）。
