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
  ['delivery summary with high-risk wording escalates', '/delivery-summary summarize payment callback changes', 'ROUTE_FULL_WORKFLOW'],
  ['do-not-push overrides publish route git writes', 'do not push, just explain what push would do', 'ROUTE_GIT_PUBLISH'],
  ['explicit dev-fast high-risk escalates', '/dev-fast adjust payment callback copy', 'ROUTE_FULL_WORKFLOW'],
  ['independent review alone stays review', 'independent review current diff only', 'ROUTE_REVIEW'],
  ['independent review plus verification escalates', 'independent review and independent verification before delivery', 'ROUTE_FULL_WORKFLOW'],
  ['explicit critical escalates', '/critical-check run strict audit', 'ROUTE_FULL_WORKFLOW'],
  ['high-risk auth escalates', 'change login session authorization rules', 'ROUTE_FULL_WORKFLOW'],
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
  const explicitPrePush = classifyDailyRoute('/pre-push-check before committing the error fix')
  if (explicitPrePush.route !== 'pre-push-check' || explicitPrePush.stopBeforeGitWrites !== true) failures.push('explicit pre-push command must be read-only even with commit/error wording')
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
