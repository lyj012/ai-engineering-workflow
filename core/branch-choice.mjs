// Canonical branch-commit-strategy resolution — pure, deterministic, unit-tested, platform-neutral.
//
// Implements the customer git-choice gate shared by every adapter (Claude / Codex Desktop / Codex CLI):
// before ANY branch op / commit / push the customer must explicitly pick one of three strategies, and
// only the strategies that are actually valid in the CURRENT environment may be offered. This module is
// pure (fed git facts from core/git-state + a target-branch existence probe); the wrapper runs git.
// Unit tests: scripts/branch-choice.test.mjs. Consumed deterministically by bin/ and inlined-with-parity
// by the Claude publish workflow so the rule cannot drift.
//
// Three strategies:
//   'new-branch'      create a fresh branch from the current commit, then commit/push
//   'switch-existing' checkout a customer-named EXISTING branch (gitPolicy.targetBranch), then commit/push
//   'current-branch'  stay on the current branch and commit/push directly (legacy 'direct' maps here)
//
// Availability in the current environment (req: never present an invalid option):
//   new-branch      available in any repo (a branch can be cut even from a detached HEAD)
//   current-branch  UNavailable on a detached HEAD (there is no current branch to commit onto)
//   switch-existing available only when a targetBranch is named AND it exists (local or remote)
//
// input = {
//   requestedMode,        // string: customer choice ('' / 'direct' / one of the three)
//   targetBranch,         // string|null: required for switch-existing
//   detachedHead,         // bool: from core/git-state
//   targetBranchExists,   // bool|null: branch exists locally or on the remote (null = not probed)
// }
//
// Returns { availableOptions[], choiceProvided, resolvedMode, needsChoice, blockedReason }.
const MODES = ['new-branch', 'switch-existing', 'current-branch']

export function resolveBranchChoice(input) {
  const i = input || {}
  let mode = i.requestedMode ? String(i.requestedMode).toLowerCase() : ''
  if (mode === 'direct') mode = 'current-branch'   // backward-compat alias
  const targetBranch = i.targetBranch ? String(i.targetBranch) : null
  const detached = i.detachedHead === true
  const targetExists = i.targetBranchExists === true

  const availableOptions = [
    { mode: 'new-branch', available: true, reason: '从当前提交新建分支后提交推送' },
    {
      mode: 'switch-existing',
      available: !!targetBranch && targetExists,
      reason: !targetBranch
        ? '需指定 gitPolicy.targetBranch（已有分支名）'
        : (targetExists ? `切换到已有分支 "${targetBranch}" 后提交推送` : `分支 "${targetBranch}" 本地与远程均不存在`),
    },
    {
      mode: 'current-branch',
      available: !detached,
      reason: detached ? '当前为 detached HEAD，无当前分支可直接提交' : '保持当前分支不变，直接提交推送',
    },
  ]

  const isKnownMode = MODES.includes(mode)
  const chosen = availableOptions.find((o) => o.mode === mode) || null
  const choiceProvided = isKnownMode && !!chosen && chosen.available === true
  const resolvedMode = choiceProvided ? mode : null

  let blockedReason = null
  if (isKnownMode && chosen && !chosen.available) blockedReason = `所选提交方式 "${mode}" 在当前环境不可用：${chosen.reason}`

  return {
    availableOptions,
    choiceProvided,
    resolvedMode,
    needsChoice: !choiceProvided,
    blockedReason,
  }
}
