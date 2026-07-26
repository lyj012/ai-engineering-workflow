// daily-router —— Claude Code daily-development router metadata and deterministic routing contract.
// Thin adapter layer only. It does not replace the full plan/deliver/publish workflows.

export const meta = {
  name: 'daily-router',
  description: 'Claude Code 日常开发路由：普通任务进入 Fast/Feature/Bugfix/Refactor/Review/Delivery/Pre-Push/Git Publish；显式完整流程或高风险任务升级既有 Full Workflow。',
  whenToUse: '需要以 Codex ai-engineering-workflow 的日常产品形态驱动 Claude Code：默认直接开发，带验证与交付护栏，高风险升级完整 Workflow。',
  deterministicCore: [
    'core/daily-route.mjs',
    'core/pre-push-status.mjs',
    'bin/core.mjs daily-route',
    'bin/core.mjs pre-push-status',
    'bin/pre-push-check.mjs',
  ],
  escalationWorkflows: [
    'plan-from-requirement.js',
    'deliver-from-plan.js',
    'publish-delivery.js',
    'auto-deliver.js',
  ],
  safety: [
    'No git add .',
    'No force-push',
    'No protected branch publishing without explicit opt-in',
    'Do not include AGENTS.md, .env, token/key/secret files, personal config, generated local output, debug logs, or unrelated files',
    'Remote URLs must be masked; embedded credentials must not be logged',
    'PREPUSH_READY must not mean PUBLISHED.',
  ],
}

// The Claude Workflow runtime cannot safely import normal Node modules in all contexts, so the executable
// contract lives in core/ + bin/. This file intentionally stays as a thin routable workflow descriptor.
// Use `.claude/skills/ai-engineering-workflow/SKILL.md` as the human/agent-facing entry and
// `node bin/core.mjs daily-route --stdin` for deterministic route decisions.

const DAILY_ROUTES = [
  { command: '/dev-fast', route: 'ROUTE_FAST_DEV', flow: 'Fast Dev', verification: 'light' },
  { command: '/dev-feature', route: 'ROUTE_FEATURE_DEV', flow: 'Feature Dev', verification: 'core-path' },
  { command: 'bug / error / exception', route: 'ROUTE_BUGFIX', flow: 'Bugfix Flow', verification: 'targeted regression' },
  { command: 'refactor / optimize structure', route: 'ROUTE_REFACTOR', flow: 'Refactor Flow', verification: 'regression' },
  { command: '/review-changes', route: 'ROUTE_REVIEW', flow: 'Review Flow', verification: 'read-only' },
  { command: '/delivery-summary', route: 'ROUTE_DELIVERY_SUMMARY', flow: 'Delivery Summary Flow', verification: 'submit-ready summary' },
  { command: '/pre-push-check', route: 'ROUTE_PRE_PUSH_CHECK', flow: 'Pre-Push Check', verification: 'read-only git safety' },
  { command: 'commit / push / open PR', route: 'ROUTE_GIT_PUBLISH', flow: 'Git Publish Flow', verification: 'remote verification required before PUBLISHED' },
  { command: '/critical-check', route: 'ROUTE_FULL_WORKFLOW', flow: 'Full Workflow', verification: 'full' },
]

export function routeTable() {
  return DAILY_ROUTES.map(r => ({ ...r }))
}
