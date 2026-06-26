// Canonical git-state classification — pure, deterministic, unit-tested, platform-neutral.
//
// Why this lives in core/: git state detection must be IDENTICAL across the Claude Dynamic Workflow
// adapter (.claude/workflows/*.js) and the Codex adapter (codex/ + bin/*.mjs). Keeping the *decision*
// here as a pure function — fed RAW git facts gathered by a thin OS-running wrapper (bin/git-state.mjs
// or a Claude subagent) — means the same rules run on Linux/macOS/Windows and under either tool, with
// zero duplicated logic to drift. The wrapper runs git; this module never shells out, so it is fully
// testable and OS-agnostic. Unit tests: scripts/git-state.test.mjs.
//
// raw = {
//   isRepo,            // bool: `git rev-parse --is-inside-work-tree` succeeded
//   headSymbolicRef,   // string|null: `git symbolic-ref -q HEAD` (e.g. 'refs/heads/main'); null => detached HEAD
//   currentBranch,     // string|null: `git rev-parse --abbrev-ref HEAD` ('HEAD' or null when detached)
//   headSha,           // string: `git rev-parse HEAD` (may be '' on an unborn branch)
//   gitDir,            // string: `git rev-parse --git-dir`
//   gitCommonDir,      // string: `git rev-parse --git-common-dir`
//   dirty,             // bool: `git status --porcelain` non-empty
// }
//
// Returns a normalized, serializable state object. `currentBranch` is null when on a detached HEAD.
// `isWorktree` is true for a *linked* worktree (gitDir !== gitCommonDir), false for the main worktree.
export function classifyGitState(raw) {
  const r = raw || {}
  const isRepo = r.isRepo === true
  // detached HEAD: symbolic-ref absent, or abbrev-ref literally 'HEAD'
  const detachedHead = isRepo && (!r.headSymbolicRef || r.currentBranch === 'HEAD' || r.currentBranch == null)
  let currentBranch = null
  if (isRepo && !detachedHead) {
    if (r.currentBranch && r.currentBranch !== 'HEAD') currentBranch = String(r.currentBranch)
    else if (r.headSymbolicRef && r.headSymbolicRef.startsWith('refs/heads/')) currentBranch = r.headSymbolicRef.slice('refs/heads/'.length)
  }
  const norm = (p) => (p == null ? '' : String(p).replace(/\\/g, '/').replace(/\/+$/, ''))
  const gitDir = norm(r.gitDir)
  const gitCommonDir = norm(r.gitCommonDir)
  // linked worktree: the per-worktree git dir differs from the shared common dir
  const isWorktree = isRepo && !!gitDir && !!gitCommonDir && gitDir !== gitCommonDir
  const unbornBranch = isRepo && !detachedHead && (!r.headSha || String(r.headSha).trim() === '')
  return {
    isRepo,
    detachedHead,
    currentBranch,
    isWorktree,
    unbornBranch,
    dirty: r.dirty === true,
    headShort: r.headSha ? String(r.headSha).trim().slice(0, 9) : '',
  }
}
