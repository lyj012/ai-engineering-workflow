#!/usr/bin/env node
// PreToolUse hook entry — hard-blocks forbidden git commands before the Bash tool runs.
// Wired in .claude/settings.json (matcher: Bash). Reads the PreToolUse JSON payload on stdin,
// extracts the command, and exits 2 (blocking the tool) with the reason on stderr when a git red
// line is hit. Classifier + unit tests: core/git-guard.mjs / scripts/git-guard.test.mjs.
import { classifyGitCommand } from '../core/git-guard.mjs'

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', d => { input += d })
process.stdin.on('end', () => {
  let cmd = ''
  try {
    const payload = JSON.parse(input || '{}')
    cmd = (payload.tool_input && payload.tool_input.command) || payload.command || ''
  } catch { cmd = '' }
  const r = classifyGitCommand(cmd)
  if (r.blocked) {
    process.stderr.write(`[git-guard] BLOCKED (${r.rule}): ${r.reason}\n命中命令：${cmd}\n这是发布流水线的硬安全红线。如确属必要，请人工在终端用 ! 前缀亲自执行并自负其责。`)
    process.exit(2)   // exit 2 = block the tool; stderr is fed back as the reason
  }
  process.exit(0)
})
