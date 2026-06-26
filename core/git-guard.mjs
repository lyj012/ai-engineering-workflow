// Deterministic git red-line classifier — the HARD enforcement layer behind the auto-publish chain.
//
// The publish / auto-deliver engines push automatically. "Never force-push / never rewrite published
// history / never delete a remote branch" must be physically enforced, not merely requested in a
// prompt. A PreToolUse hook (.claude/settings.json → scripts/git-guard-hook.mjs) runs this against
// every Bash command and BLOCKS the tool before it executes when a red line is hit. Intentionally
// conservative: it substring-matches the command, so even echoing a forbidden command is blocked.
// Unit tests: scripts/git-guard.test.mjs.
//
// Returns { blocked: boolean, rule: string, reason: string }.
export function classifyGitCommand(command) {
  const c = String(command || '').replace(/\s+/g, ' ').trim()
  const block = (rule, reason) => ({ blocked: true, rule, reason })
  const hasPush = /\bgit\s+push\b/.test(c)

  if (hasPush && /(^|\s)(--force-with-lease|--force|-f)(\s|=|$)/.test(c)) return block('force-push', 'git push --force / -f / --force-with-lease 被硬禁：绝不改写已发布历史。')
  if (hasPush && /(^|\s)--mirror(\s|$)/.test(c)) return block('push-mirror', 'git push --mirror 被硬禁。')
  if (hasPush && /(^|\s)(--delete|-d)(\s|$)/.test(c)) return block('delete-remote-branch', 'git push --delete / -d 删远程分支 被硬禁。')
  if (hasPush && /\spush\s+\S+\s+\+\S/.test(c)) return block('force-refspec', 'git push 用 + 前缀强制 refspec 被硬禁。')
  if (hasPush && /\spush\s+\S+\s+:\S/.test(c)) return block('delete-remote-branch', 'git push <remote> :<branch>（删远程分支）被硬禁。')
  if (/\bgit\s+reset\s+--hard\s+[A-Za-z0-9._-]+\/\S+/.test(c)) return block('reset-hard-remote', 'git reset --hard <remote>/<branch> 被硬禁：会丢弃本地、强对齐远程。')

  return { blocked: false, rule: '', reason: '' }
}
