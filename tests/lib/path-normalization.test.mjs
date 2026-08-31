// tests/lib/path-normalization.test.mjs
// CI 回归：GitHub Actions Windows runner 的 TEMP 落在 8.3 短路径下
// （C:\Users\RUNNER~1\AppData\Local\Temp），而 `git worktree list` 返回
// 长路径（C:\Users\runneradmin\...）。isSubpath 此前依赖 JS 版
// realpathSync，它无法解析 8.3 短名组件（组件名与 readdir 结果不匹配
// → ENOENT → fallback 保留短形式），导致：
//   1. cwd 明明在 worktree 内却误报"越界 WARN"（execution-plan R5）
//   2. finish 同样的 WARN 误报 + 基于路径字符串的清理判定失真
// 修复要求：路径规范化必须用 realpathSync.native（Win32 GetFinalPathName-
// 风格，能解析 8.3 短名）。本文件在能拿到真实 8.3 短名目录的环境下验证
// （绝大多数 NTFS 系统 C:\PROGRA~1 存在），拿不到则跳过——与 symlink
// 探测跳过同模式。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { isSubpath as isSubpathPlan } from '../../scripts/lib/execution-plan.mjs';
import { isSubpath as isSubpathFinish } from '../../scripts/lib/cmd-finish.mjs';

// 探测本机是否存在可解析的 8.3 短名目录。Windows 卷可能通过注册表
// （fsutil 8dot3name）禁用短名生成，此时无法本地复现，跳过。
function probeShortPath() {
  if (process.platform !== 'win32') return null;
  const candidates = ['C:/PROGRA~1', 'C:/Program Files'];
  const short = candidates[0];
  try {
    const resolved = realpathSync.native(short);
    const long = candidates[1];
    // 短名必须解析到长名（大小写不敏感），否则视为 8.3 不可用。
    if (resolved.toLowerCase() !== long.toLowerCase()) return null;
    // JS 版此时应仍返回短形式（证明差异存在），否则该环境无回归意义。
    let jsForm;
    try {
      jsForm = realpathSync(short);
    } catch {
      return null;
    }
    if (jsForm.toLowerCase() !== short.toLowerCase()) return null;
    return { short: jsForm, long: resolved };
  } catch {
    return null;
  }
}

for (const [label, isSubpath] of [
  ['execution-plan.isSubpath', isSubpathPlan],
  ['cmd-finish.isSubpath', isSubpathFinish],
]) {
  describe(`8.3 短路径兼容 — ${label}`, () => {
    it('8.3 短名路径与长路径判定为同一目录（isSubpath 返回 true）', () => {
      const probe = probeShortPath();
      if (!probe) {
        // 本卷未启用 8.3 短名，无法本地复现 CI 行为——跳过而非误报。
        return;
      }
      // parent 用短名、child 用长名：CI 上 cwd 来自进程（短名 TEMP），
      // worktree 路径来自 git 输出（长名），两者必须判定为相等。
      assert.equal(
        isSubpath(probe.short, probe.long),
        true,
        `isSubpath must treat ${probe.short} === ${probe.long}`
      );
      // 反向也成立：parent 长名、child 短名。
      assert.equal(
        isSubpath(probe.long, probe.short),
        true,
        `isSubpath must treat ${probe.long} === ${probe.short}`
      );
      // 子路径判定不受影响：长路径下子目录仍在短名 parent 内。
      assert.equal(isSubpath(probe.short, probe.long + '/x'), true);
    });
  });
}
