// Deterministic git red-line classifier — the Claude-side runtime block behind the auto-publish chain.
//
// Scope & honest limits: the publish / auto-deliver engines dispatch git via subagent Bash calls; a
// PreToolUse hook (.claude/settings.json → scripts/git-guard-hook.mjs) runs this classifier against every
// Bash command and BLOCKS the tool before it executes when a red line is hit. It is a real *runtime* block
// on the Claude side for the enumerated red lines below (force-push / push --mirror / delete remote branch /
// force refspec / reset --hard <remote> / history rewrite / force-delete branch). It is NOT a universal,
// unbypassable security boundary: it covers these enumerated destructive ops (not, e.g., a plain non-force
// push to a default branch — that is gated at the engine level by PROTECTED + allowMainPush), and on the
// Codex adapter there is no PreToolUse hook, so there it is a documented convention, not a runtime block.
//
// Robustness: each shell segment is classified independently (a forbidden op anywhere in a compound command
// is still caught; an unrelated flag in another segment is not a false positive). Within a segment, global
// git options between `git` and the subcommand (`git -c x=y`, `git -C <dir>`, `git --git-dir=<d>` …) are
// skipped so they cannot move the subcommand out of range, and surrounding quotes are stripped from tokens
// so a quoted refspec (`"+main"`, `":branch"`) cannot evade force/delete detection. Unit tests: scripts/git-guard.test.mjs.
//
// Returns { blocked: boolean, rule: string, reason: string }.

// global git options that consume the NEXT token as their value (separate-token form)
const GIT_OPTS_WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--super-prefix'])
const dequote = (t) => String(t).replace(/^['"]+|['"]+$/g, '')

// Parse one shell segment into { sub, args } for its git invocation, skipping leading global options
// (and their separate-token values). Returns null when the segment is not a git invocation.
function gitInvocation(seg) {
  const toks = String(seg).trim().split(/\s+/).filter(Boolean)
  let gi = -1
  for (let i = 0; i < toks.length; i++) { if (dequote(toks[i]) === 'git') { gi = i; break } }
  if (gi === -1) return null
  let j = gi + 1
  while (j < toks.length) {
    const t = dequote(toks[j])
    if (t.startsWith('-')) { const base = t.split('=')[0]; j += (GIT_OPTS_WITH_VALUE.has(base) && !t.includes('=')) ? 2 : 1 }
    else break
  }
  if (j >= toks.length) return null
  return { sub: dequote(toks[j]), args: toks.slice(j + 1).map(dequote) }
}

export function classifyGitCommand(command) {
  const full = String(command || '').replace(/\s+/g, ' ').trim()
  const block = (rule, reason) => ({ blocked: true, rule, reason })
  for (const seg of full.split(/&&|\|\||;|\|/)) {
    const inv = gitInvocation(seg)
    if (!inv) continue
    const { sub, args } = inv
    const hasFlag = (...names) => args.some(a => names.includes(a) || names.some(n => a.startsWith(n + '=')))

    if (sub === 'push') {
      if (hasFlag('--force', '--force-with-lease', '-f')) return block('force-push', 'git push --force / -f / --force-with-lease 被硬禁：绝不改写已发布历史。')
      if (hasFlag('--mirror')) return block('push-mirror', 'git push --mirror 被硬禁。')
      if (hasFlag('--delete', '-d')) return block('delete-remote-branch', 'git push --delete / -d 删远程分支 被硬禁。')
      if (args.some(a => /^\+\S/.test(a))) return block('force-refspec', 'git push 用 + 前缀强制 refspec 被硬禁。')
      if (args.some(a => /^:\S/.test(a))) return block('delete-remote-branch', 'git push <remote> :<branch>（删远程分支）被硬禁。')
    }
    if (sub === 'reset' && args.includes('--hard') && args.some(a => /^[A-Za-z0-9._-]+\/\S/.test(a))) return block('reset-hard-remote', 'git reset --hard <remote>/<branch> 被硬禁：会丢弃本地、强对齐远程。')
    if (sub === 'filter-branch' || sub === 'filter-repo') return block('history-rewrite', 'git filter-branch / filter-repo（重写已发布历史）被硬禁。')
    if (sub === 'branch' && (args.includes('-D') || (args.includes('--delete') && args.includes('--force')))) return block('force-delete-branch', 'git branch -D（强制删除分支）被硬禁。')
  }

  return { blocked: false, rule: '', reason: '' }
}
