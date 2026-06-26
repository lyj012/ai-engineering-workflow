// Canonical SCOPE check — pure, deterministic, unit-tested, platform-neutral.
//
// Given the files a delivery actually changed and the plan's declared SCOPE, decide whether anything fell
// outside SCOPE. Same rule for Claude and Codex (Claude's deliver engine reconciles via
// core/changed-files.mjs; this is the focused changed-vs-scope check, exposed as `bin/core.mjs scope-check`
// and `bin/scope-check.mjs`). Pure: paths in, verdict out. Unit tests: scripts/scope-check.test.mjs.
//
// input = {
//   changedFiles,        // string[]: target-root-relative paths that changed
//   scopeFiles,          // string[]: plan.affected.files (allowed)
//   optionalScopeFiles,  // string[]: also-allowed (e.g. README)
// }
// returns { ok, inScope, violations } — ok is true only when no changed file is outside SCOPE.
function norm(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '')
}

export function checkScope(input) {
  const i = input || {}
  const changed = (Array.isArray(i.changedFiles) ? i.changedFiles : []).map(norm).filter(Boolean)
  const allowed = new Set([
    ...(Array.isArray(i.scopeFiles) ? i.scopeFiles : []).map(norm).filter(Boolean),
    ...(Array.isArray(i.optionalScopeFiles) ? i.optionalScopeFiles : []).map(norm).filter(Boolean),
  ])
  const violations = changed.filter((f) => !allowed.has(f))
  const inScope = changed.filter((f) => allowed.has(f))
  return { ok: violations.length === 0, inScope, violations }
}
