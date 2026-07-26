// Shared daily-development route classifier for Claude and Codex adapters.
// Pure decision logic only: no IO, no git, no model calls.

const FULL_REQUEST_PATTERNS = [
  /complete\s+flow/i,
  /formal\s+full\s+delivery/i,
  /strict\s+audit/i,
  /critical\s+check/i,
  /\/critical-check\b/i,
  /sandbox\s+delivery/i,
  /formal\s+audit/i,
  /完整流程/,
  /严格审计/,
  /沙箱实现/,
]

const INDEPENDENT_REVIEW_PATTERNS = [
  /independent\s+review/i,
  /独立\s*(review|评审|审查)/i,
]

const INDEPENDENT_VERIFICATION_PATTERNS = [
  /independent\s+verification/i,
  /独立\s*(verification|验证)/i,
]

const HIGH_RISK_PATTERNS = [
  /payment|payroll|billing|invoice|refund/i,
  /permission|authorization|authorize|access\s+control|rbac/i,
  /\bauth(?:entication)?\b|login|session|oauth|sso/i,
  /amount|price|pricing|balance|settlement|ledger/i,
  /callback|webhook/i,
  /entitlement|membership|subscription/i,
  /migration|migrate\s+data|schema\s+migration/i,
  /production\s+(config|data|database)|prod\b/i,
  /security|secret|token|credential|encryption/i,
  /delete\s+(data|record|table)|destructive|drop\s+table|truncate/i,
  /multi-tenant|tenant\s+isolation/i,
  /支付|权限|授权|认证|登录|金额|回调|会员权益|数据迁移|生产配置|生产数据|安全|密钥|删除数据|多租户/,
]

const FORMAL_DELIVERY_PATTERNS = [
  /formal\s+(handoff|submit|submission|delivery)/i,
  /ready\s+to\s+(submit|deliver|merge|release)/i,
  /customer\s+delivery/i,
  /正式(交付|提交|验收)/,
  /准备(提交|交付|发布|合并)/,
]

const NO_GIT_WRITE_PATTERNS = [
  /do\s+not\s+(commit|push)/i,
  /don't\s+(commit|push)/i,
  /no\s+(commit|push)/i,
  /不(要|得)?(提交|推送|发布)/,
]

const EXPLICIT_ROUTE_RULES = [
  ['analysis', 'ROUTE_ANALYSIS', [/\/analysis\b/i]],
  ['review', 'ROUTE_REVIEW', [/\/review-changes\b/i]],
  ['delivery-summary', 'ROUTE_DELIVERY_SUMMARY', [/\/delivery-summary\b/i]],
  ['pre-push-check', 'ROUTE_PRE_PUSH_CHECK', [/\/pre-push-check\b/i]],
  ['feature-dev', 'ROUTE_FEATURE_DEV', [/\/dev-feature\b/i]],
  ['fast-dev', 'ROUTE_FAST_DEV', [/\/dev-fast\b/i]],
]

const INTENT_ROUTE_RULES = [
  ['analysis', 'ROUTE_ANALYSIS', [/only\s+(analyze|analyse|clarify|assess)/i, /分析|澄清|评估/]],
  ['bugfix', 'ROUTE_BUGFIX', [/bug|error|exception|crash|failed|failure|regression/i, /修复|报错|异常|失败|回归/]],
  ['refactor', 'ROUTE_REFACTOR', [/refactor|restructure|simplify|optimi[sz]e\s+structure/i, /重构|优化结构|整理结构/]],
  ['review', 'ROUTE_REVIEW', [/\breview\b.*\b(diff|changes|pr|pull request|code)\b/i, /independent\s+review/i, /代码审查|评审.*(diff|改动|PR)/i]],
  ['delivery-summary', 'ROUTE_DELIVERY_SUMMARY', [/delivery\s+summary|handoff\s+notes|acceptance\s+notes/i, /交付摘要|验收说明|交接说明/]],
  ['pre-push-check', 'ROUTE_PRE_PUSH_CHECK', [/pre[-\s]?push\s+check/i, /提交前检查|推送前检查/]],
  ['git-publish', 'ROUTE_GIT_PUBLISH', [/\b(commit|push|open\s+pr|create\s+pr)\b/i, /提交|推送|创建PR|打开PR/i]],
  ['feature-dev', 'ROUTE_FEATURE_DEV', [/complete\s+(feature|page|crud|module)/i, /new\s+(feature|page|api|module|crud)/i, /完整(功能|页面|CRUD|模块)|新增(功能|页面|接口|模块)/i]],
  ['fast-dev', 'ROUTE_FAST_DEV', [/change|adjust|update|add\s+(field|button|state)|fix\s+style/i, /改一下|修一下|加个字段|调个页面|调整|更新/]],
]

const FLOW_BY_ROUTE = {
  'analysis': 'Analysis Flow',
  'bugfix': 'Bugfix Flow',
  'refactor': 'Refactor Flow',
  'review': 'Review Flow',
  'delivery-summary': 'Delivery Summary Flow',
  'pre-push-check': 'Pre-Push Check',
  'git-publish': 'Git Publish Flow',
  'feature-dev': 'Feature Dev',
  'fast-dev': 'Fast Dev',
}

function verificationLevelForRoute(route) {
  if (route === 'feature-dev') return 'core-path'
  if (route === 'pre-push-check' || route === 'delivery-summary' || route === 'git-publish') return 'submit-ready'
  if (route === 'analysis' || route === 'review') return 'read-only'
  return 'light'
}

function routeResult(route, finalStatus, reasons, warnings, stopBeforeGitWrites) {
  return {
    finalStatus,
    route,
    flow: FLOW_BY_ROUTE[route],
    verificationLevel: verificationLevelForRoute(route),
    reasons,
    warnings,
    stopBeforeGitWrites,
  }
}

function textOf(input) {
  if (typeof input === 'string') return input
  const i = input || {}
  return [i.command, i.intent, i.request, i.requirement, i.task, i.description, ...(Array.isArray(i.constraints) ? i.constraints : [])]
    .filter(Boolean)
    .map(String)
    .join('\n')
}

function matchesAny(text, patterns) {
  return patterns.some(re => re.test(text))
}

function collectMatches(text, patterns) {
  return patterns.filter(re => re.test(text)).map(re => String(re))
}

export function classifyDailyRoute(input) {
  const i = input || {}
  const text = textOf(i)
  const lower = text.toLowerCase()
  const reasons = []
  const warnings = []

  if (!text.trim()) {
    return {
      finalStatus: 'ROUTE_NEEDS_CLARIFICATION',
      route: 'clarification',
      flow: 'Needs Clarification',
      verificationLevel: 'none',
      reasons: ['empty request cannot be safely routed'],
      warnings,
      stopBeforeGitWrites: true,
    }
  }

  const independentReviewRequested = matchesAny(text, INDEPENDENT_REVIEW_PATTERNS)
  const independentVerificationRequested = matchesAny(text, INDEPENDENT_VERIFICATION_PATTERNS)

  if (matchesAny(text, FULL_REQUEST_PATTERNS) || (independentReviewRequested && independentVerificationRequested)) {
    reasons.push('explicit full workflow / audit / independent review+verify request')
    return {
      finalStatus: 'ROUTE_FULL_WORKFLOW',
      route: 'full-workflow',
      flow: 'Full Workflow',
      verificationLevel: 'full',
      reasons,
      warnings,
      stopBeforeGitWrites: true,
    }
  }

  if (matchesAny(text, HIGH_RISK_PATTERNS)) {
    reasons.push('high-risk trigger matched')
    return {
      finalStatus: 'ROUTE_FULL_WORKFLOW',
      route: 'full-workflow',
      flow: 'Full Workflow',
      verificationLevel: 'full',
      reasons,
      warnings,
      highRiskMatches: collectMatches(text, HIGH_RISK_PATTERNS),
      stopBeforeGitWrites: true,
    }
  }

  for (const [route, finalStatus, patterns] of EXPLICIT_ROUTE_RULES) {
    if (!matchesAny(text, patterns)) continue
    reasons.push(`explicit command matched ${route}`)
    const stopBeforeGitWrites = matchesAny(text, NO_GIT_WRITE_PATTERNS) || route !== 'git-publish'
    return routeResult(route, finalStatus, reasons, warnings, stopBeforeGitWrites)
  }

  if (matchesAny(text, FORMAL_DELIVERY_PATTERNS)) {
    reasons.push('formal handoff / submission / delivery intent')
    return {
      finalStatus: 'ROUTE_FORMAL_DELIVERY',
      route: 'formal-delivery',
      flow: 'Formal Delivery Flow',
      verificationLevel: 'necessary',
      reasons,
      warnings,
      stopBeforeGitWrites: matchesAny(text, NO_GIT_WRITE_PATTERNS),
    }
  }

  for (const [route, finalStatus, patterns] of INTENT_ROUTE_RULES) {
    if (!matchesAny(text, patterns)) continue
    reasons.push(`intent matched ${route}`)
    const stopBeforeGitWrites = matchesAny(text, NO_GIT_WRITE_PATTERNS) || route !== 'git-publish'
    return routeResult(route, finalStatus, reasons, warnings, stopBeforeGitWrites)
  }

  if (/crud/i.test(lower) || /页面|接口|功能|模块/.test(text)) {
    reasons.push('ordinary feature/module wording without high-risk trigger')
    return {
      finalStatus: 'ROUTE_FEATURE_DEV',
      route: 'feature-dev',
      flow: 'Feature Dev',
      verificationLevel: 'core-path',
      reasons,
      warnings,
      stopBeforeGitWrites: true,
    }
  }

  reasons.push('default daily development route')
  return {
    finalStatus: 'ROUTE_FAST_DEV',
    route: 'fast-dev',
    flow: 'Fast Dev',
    verificationLevel: 'light',
    reasons,
    warnings,
    stopBeforeGitWrites: true,
  }
}
