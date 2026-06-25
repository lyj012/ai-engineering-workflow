// Canonical changed-files reconciliation — pure, deterministic, unit-tested.
//
// Cross-checks the three independent views of "what changed": the independent Verify file list, the
// generated diff's file list, and the plan SCOPE. Discrepancies are surfaced as issues (recorded as
// delivery open items). Inline copy lives in deliver-from-plan.js between CHANGED-FILES markers;
// self-check behaviour-diffs them. Unit tests: scripts/changed-files.test.mjs.
//
// input = { verifiedFiles, diffFiles, scopeFiles, optionalScopeFiles }  (target-root-relative paths)
export function reconcileChangedFiles(input) {
  const i = input || {}
  const verified = Array.isArray(i.verifiedFiles) ? i.verifiedFiles : []
  const diff = Array.isArray(i.diffFiles) ? i.diffFiles : []
  const scope = new Set([...(Array.isArray(i.scopeFiles) ? i.scopeFiles : []), ...(Array.isArray(i.optionalScopeFiles) ? i.optionalScopeFiles : [])])
  const issues = []
  const vSet = new Set(verified), dSet = new Set(diff)
  // Verify vs Diff — only compare when both sides actually have data
  if (verified.length && diff.length) {
    const onlyVerify = verified.filter(f => !dSet.has(f))
    const onlyDiff = diff.filter(f => !vSet.has(f))
    if (onlyVerify.length || onlyDiff.length) {
      issues.push(`Verify 与 Diff 变更文件不一致：仅Verify[${onlyVerify.join(', ') || '无'}] 仅Diff[${onlyDiff.join(', ') || '无'}]`)
    }
  }
  // Diff must stay within plan SCOPE (when SCOPE is known)
  if (scope.size && diff.length) {
    const outOfScope = diff.filter(f => !scope.has(f))
    if (outOfScope.length) issues.push(`Diff 超出 SCOPE：${outOfScope.join(', ')}`)
  }
  return { consistent: issues.length === 0, issues }
}
