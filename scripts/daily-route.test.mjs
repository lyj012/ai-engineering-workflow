import { classifyDailyRoute } from '../core/daily-route.mjs'

export const CASES = [
  ['small ordinary change defaults fast dev', '改一下订单页面空状态', 'ROUTE_FAST_DEV'],
  ['explicit dev feature', '/dev-feature complete CRUD for inventory products', 'ROUTE_FEATURE_DEV'],
  ['complete page is not full workflow by itself', 'complete page for customer list', 'ROUTE_FEATURE_DEV'],
  ['bug routes bugfix', 'fix exception when saving form', 'ROUTE_BUGFIX'],
  ['review route stays read-only', '/review-changes review current diff', 'ROUTE_REVIEW'],
  ['explicit review beats bug words', '/review-changes review this bug fix', 'ROUTE_REVIEW'],
  ['pre-push route', '/pre-push-check before commit', 'ROUTE_PRE_PUSH_CHECK'],
  ['explicit pre-push beats error words', '/pre-push-check before committing the error fix', 'ROUTE_PRE_PUSH_CHECK'],
  ['customer list does not trip auth substring', 'complete page for customer list', 'ROUTE_FEATURE_DEV'],
  ['formal delivery route', 'prepare formal delivery handoff', 'ROUTE_FORMAL_DELIVERY'],
  ['delivery summary with high-risk wording stays summary', '/delivery-summary summarize payment callback changes', 'ROUTE_DELIVERY_SUMMARY'],
  ['analysis with high-risk wording stays analysis', '/analysis 分析一下支付回调', 'ROUTE_ANALYSIS'],
  ['review with high-risk wording stays review', '/review-changes 审查支付代码', 'ROUTE_REVIEW'],
  ['pre-push with high-risk wording stays pre-push', '/pre-push-check 检查认证模块的改动', 'ROUTE_PRE_PUSH_CHECK'],
  ['do-not-push overrides publish route git writes', 'do not push, just explain what push would do', 'ROUTE_GIT_PUBLISH'],
  ['explicit dev-fast high-risk escalates', '/dev-fast adjust payment callback handler', 'ROUTE_FULL_WORKFLOW'],
  ['independent review alone stays review', 'independent review current diff only', 'ROUTE_REVIEW'],
  ['independent review beats bugfix wording', 'independent review this bug fix', 'ROUTE_REVIEW'],
  ['review beats error wording', 'review the error handling changes', 'ROUTE_REVIEW'],
  ['review beats refactor wording', 'review this refactor', 'ROUTE_REVIEW'],
  ['natural analysis module stays analysis', 'analyze this module', 'ROUTE_ANALYSIS'],
  ['natural assess implementation stays analysis', 'assess this implementation', 'ROUTE_ANALYSIS'],
  ['natural clarify code stays analysis', 'clarify how this code works', 'ROUTE_ANALYSIS'],
  ['natural explain architecture stays analysis', 'explain this architecture', 'ROUTE_ANALYSIS'],
  ['independent review plus verification escalates', 'independent review and independent verification before delivery', 'ROUTE_FULL_WORKFLOW'],
  ['explicit critical escalates', '/critical-check run strict audit', 'ROUTE_FULL_WORKFLOW'],
  ['full workflow english escalates', 'run the full workflow', 'ROUTE_FULL_WORKFLOW'],
  ['use full workflow english escalates', 'use Full Workflow', 'ROUTE_FULL_WORKFLOW'],
  ['full workflow chinese escalates', '走完整工作流', 'ROUTE_FULL_WORKFLOW'],
  ['full flow chinese escalates', '执行全流程', 'ROUTE_FULL_WORKFLOW'],
  ['high-risk auth escalates', 'change login session authorization rules', 'ROUTE_FULL_WORKFLOW'],
  ['price label is ordinary frontend work', '修改商品价格标签', 'ROUTE_FAST_DEV'],
  ['css design token is ordinary frontend work', '调整 CSS design token', 'ROUTE_FAST_DEV'],
  ['javascript callback refactor is ordinary refactor', '重构 JavaScript callback', 'ROUTE_REFACTOR'],
  ['model token count is ordinary fast dev', '统计模型 token 数量', 'ROUTE_FAST_DEV'],
  ['pricing page style is ordinary frontend work', '修改 pricing 页面样式', 'ROUTE_FAST_DEV'],
  ['empty request needs clarification', '', 'ROUTE_NEEDS_CLARIFICATION'],
]

export function runDailyRouteTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    const result = classifyDailyRoute(input)
    if (result.finalStatus !== expected) failures.push(`daily-route ${name}: expected ${expected}, got ${result.finalStatus}`)
  }
  const ordinaryCrud = classifyDailyRoute('complete CRUD list query and mapper fields')
  if (ordinaryCrud.finalStatus !== 'ROUTE_FEATURE_DEV') failures.push(`ordinary CRUD should stay feature-dev, got ${ordinaryCrud.finalStatus}`)
  const migrationCrud = classifyDailyRoute('complete CRUD and migrate production data')
  if (migrationCrud.finalStatus !== 'ROUTE_FULL_WORKFLOW') failures.push(`migration CRUD should escalate, got ${migrationCrud.finalStatus}`)
  const noPush = classifyDailyRoute('do not push, just explain what push would do')
  if (noPush.stopBeforeGitWrites !== true) failures.push('do-not-push publish wording must stop before git writes')
  for (const input of [
    'no need to push after commit',
    "don't create a PR for this change",
    'do not open a PR',
    "commit only, don't push",
    '不用推送',
    '无需提交',
    '先别推送',
    '别创建 PR',
    '不要开 PR',
    '只检查，不要修改',
  ]) {
    const result = classifyDailyRoute(input)
    if (result.stopBeforeGitWrites !== true) failures.push(`no-git-write phrase must stop git writes: ${input}`)
  }
  const explicitPrePush = classifyDailyRoute('/pre-push-check before committing the error fix')
  if (explicitPrePush.route !== 'pre-push-check' || explicitPrePush.stopBeforeGitWrites !== true) failures.push('explicit pre-push command must be read-only even with commit/error wording')
  const readOnlyHighRisk = classifyDailyRoute('/analysis 分析一下支付回调')
  if (readOnlyHighRisk.route !== 'analysis' || !readOnlyHighRisk.highRiskMatches?.length || !readOnlyHighRisk.warnings?.length) failures.push('high-risk read-only route must preserve route and record warnings')
  return failures
}

if (process.argv[1] && process.argv[1].endsWith('daily-route.test.mjs')) {
  const failures = runDailyRouteTests()
  if (failures.length) {
    console.error('DAILY-ROUTE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('DAILY-ROUTE TESTS PASSED')
}
