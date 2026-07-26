// Shared daily-development route classifier for Claude and Codex adapters.
// Pure decision logic only: no IO, no git, no model calls.

const FULL_REQUEST_PATTERNS = [
  /\b(?:run|use|start|execute|perform)\s+(?:the\s+)?full\s+workflow\b/i,
  /\bfull\s+workflow\b/i,
  /complete\s+(?:workflow|flow)/i,
  /formal\s+full\s+delivery/i,
  /strict\s+audit/i,
  /critical\s+check/i,
  /\/critical-check\b/i,
  /sandbox\s+delivery/i,
  /formal\s+audit/i,
  /完整工作流|完整流程|执行全流程|走完整工作流|全流程/,
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
  /\b(payment|payroll|billing|invoice|refund)\b/i,
  /\b(permissions?|authorization|authorize|access\s+control|rbac)\b/i,
  /\bauth(?:entication)?\b|\blogin\b|\bsession\b|\boauth\b|\bsso\b/i,
  /\b(amount\s+(?:calculation|rules?|logic)|calculate\s+amount|settlement|ledger|account\s+balance|balance\s+(?:calculation|transfer|settlement|ledger)|pricing\s+(?:algorithm|rules?|calculation|engine)|price\s+(?:algorithm|rules?|calculation|engine))\b/i,
  /\b(?:third[-\s]?party|external|provider|oauth|sso|payment|auth)\s+(?:callback|webhook)\b/i,
  /\b(?:callback|webhook)\s+(?:signature|secret|verification|endpoint|handler)\b/i,
  /\bentitlements?\b|\bmembership\s+(?:access|permissions?|roles?)\b|\bsubscription\s+(?:billing|entitlement|permission|access)\b/i,
  /\b(?:data\s+)?migration\b|\bmigrate\s+(?:production\s+)?data\b|\bschema\s+migration\b/i,
  /\bproduction\s+(?:config|data|database|secret|credential)\b|\bprod(?:uction)?\s+(?:config|data|database)\b/i,
  /\bsecurity\b|\bsecret\b|\bencryption\b|\bapi\s*key\b|\b(?:access|refresh|auth|bearer|secret)\s+token\b/i,
  /\bcredentials?\s+(?:storage|handling|validation|verification|rotation|leak|flow|secret|token)\b/i,
  /\bdelete\s+(?:data|record|table|production|customer|user)\b|\bdestructive\b|\bdrop\s+table\b|\btruncate\b/i,
  /\bmulti-tenant\b|\btenant\s+isolation\b/i,
  /支付|权限|授权|认证|登录|金额|结算|账本|余额|会员权益|数据迁移|生产配置|生产数据|安全|密钥|删除数据|多租户/,
  /第三方回调|外部回调|支付回调|认证回调|授权回调|回调(签名|验签|端点|接口)/,
]

const FORMAL_DELIVERY_PATTERNS = [
  /formal\s+(handoff|submit|submission|delivery)/i,
  /ready\s+to\s+(submit|deliver|merge|release)/i,
  /customer\s+delivery/i,
  /正式(交付|提交|验收)/,
  /准备(提交|交付|发布|合并)/,
]

const NO_GIT_WRITE_PATTERNS = [
  /do\s+not\s+(?:commit|push|publish|open\s+(?:a\s+)?pr|create\s+(?:a\s+)?pr)/i,
  /don't\s+(?:commit|push|publish|open\s+(?:a\s+)?pr|create\s+(?:a\s+)?pr)/i,
  /no\s+need\s+to\s+(?:commit|push|publish|open\s+(?:a\s+)?pr|create\s+(?:a\s+)?pr)/i,
  /no\s+(?:commit|push|publish|pr)\b/i,
  /commit\s+only.*(?:do\s+not|don't)\s+push/i,
  /(?:check|inspect|review)\s+only.*(?:do\s+not|don't)\s+(?:modify|edit|commit|push)/i,
  /不(?:要|得)?(?:提交|推送|发布|创建\s*PR|开\s*PR|修改)/,
  /(?:不用|无需|先别|别)(?:提交|推送|发布|创建\s*PR|开\s*PR|修改)/,
  /只(?:检查|审查|分析)[，,]?\s*不(?:要|用)?(?:修改|提交|推送|发布)/,
]

const READ_ONLY_ROUTE_RULES = [
  ['analysis', 'ROUTE_ANALYSIS', [
    /\/analysis\b/i,
    /\bonly\s+(?:analy[sz]e|clarify|assess|evaluate|explain)\b/i,
    /\b(?:analy[sz]e|clarify|assess|evaluate|explain)\b.*\b(?:this|the|code|module|implementation|architecture|design|flow|logic|changes?|diff|repo|repository|system|risk|risks?)\b/i,
    /\bhow\s+(?:does|do|is|are)\b.*\b(?:work|works|implemented|structured)\b/i,
    /分析|澄清|评估/,
  ]],
  ['review', 'ROUTE_REVIEW', [
    /\/review-changes\b/i,
    /\breview\b.*\b(diff|changes?|pr|pull request|code|bug\s*fix|fix|error\s+handling|refactor|patch)\b/i,
    /independent\s+review/i,
    /代码审查|评审.*(diff|改动|PR|代码|修复|重构|异常|错误)|审查.*(diff|改动|PR|代码|修复|重构|异常|错误)/i,
  ]],
  ['delivery-summary', 'ROUTE_DELIVERY_SUMMARY', [
    /\/delivery-summary\b/i,
    /delivery\s+summary|handoff\s+notes|acceptance\s+notes/i,
    /交付摘要|验收说明|交接说明|总结.*(改动|变更)/,
  ]],
  ['pre-push-check', 'ROUTE_PRE_PUSH_CHECK', [
    /\/pre-push-check\b/i,
    /pre[-\s]?push\s+check/i,
    /提交前检查|推送前检查|检查.*(提交|推送|pre[-\s]?push)/i,
  ]],
]

const MUTATING_EXPLICIT_ROUTE_RULES = [
  ['feature-dev', 'ROUTE_FEATURE_DEV', [/\/dev-feature\b/i]],
  ['fast-dev', 'ROUTE_FAST_DEV', [/\/dev-fast\b/i]],
]

const MUTATING_INTENT_ROUTE_RULES = [
  ['bugfix', 'ROUTE_BUGFIX', [/bug|error|exception|crash|failed|failure|regression/i, /修复|报错|异常|失败|回归/]],
  ['refactor', 'ROUTE_REFACTOR', [/refactor|restructure|simplify|optimi[sz]e\s+structure/i, /重构|优化结构|整理结构/]],
  ['git-publish', 'ROUTE_GIT_PUBLISH', [/\b(commit|push|open\s+(?:a\s+)?pr|create\s+(?:a\s+)?pr)\b/i, /提交|推送|创建\s*PR|打开\s*PR|开\s*PR/i]],
  ['feature-dev', 'ROUTE_FEATURE_DEV', [/complete\s+(feature|page|crud|module)/i, /new\s+(feature|page|api|module|crud)/i, /完整(功能|页面|CRUD|模块)|新增(功能|页面|接口|模块)/i]],
  ['fast-dev', 'ROUTE_FAST_DEV', [/change|adjust|update|modify|add\s+(field|button|state)|fix\s+style/i, /改一下|修一下|加个字段|调个页面|修改|调整|更新/]],
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

function routeResult(route, finalStatus, reasons, warnings, stopBeforeGitWrites, extra = {}) {
  return {
    finalStatus,
    route,
    flow: FLOW_BY_ROUTE[route],
    verificationLevel: verificationLevelForRoute(route),
    reasons,
    warnings,
    stopBeforeGitWrites,
    ...extra,
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

  for (const [route, finalStatus, patterns] of READ_ONLY_ROUTE_RULES) {
    if (!matchesAny(text, patterns)) continue
    reasons.push(`read-only intent matched ${route}`)
    const highRiskMatches = collectMatches(text, HIGH_RISK_PATTERNS)
    const extra = {}
    if (highRiskMatches.length > 0) {
      warnings.push('high-risk terms matched; preserve this read-only route and do not edit or publish without a separate modification request')
      extra.highRiskMatches = highRiskMatches
    }
    return routeResult(route, finalStatus, reasons, warnings, true, extra)
  }

  const highRiskMatches = collectMatches(text, HIGH_RISK_PATTERNS)
  if (highRiskMatches.length > 0) {
    reasons.push('high-risk modification trigger matched')
    return {
      finalStatus: 'ROUTE_FULL_WORKFLOW',
      route: 'full-workflow',
      flow: 'Full Workflow',
      verificationLevel: 'full',
      reasons,
      warnings,
      highRiskMatches,
      stopBeforeGitWrites: true,
    }
  }

  for (const [route, finalStatus, patterns] of MUTATING_EXPLICIT_ROUTE_RULES) {
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

  for (const [route, finalStatus, patterns] of MUTATING_INTENT_ROUTE_RULES) {
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
