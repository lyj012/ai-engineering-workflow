// Canonical deliver final-status decision — pure, deterministic, unit-tested.
//
// Why this lives in core/: the Claude Workflow script surface cannot import modules, so
// .claude/workflows/deliver-from-plan.js keeps an INLINE copy of this function between the
// DELIVER-STATUS markers. scripts/self-check.mjs behaviour-diffs the inline copy against this
// canonical one over fixed vectors so the two cannot drift. Unit tests: scripts/deliver-status.test.mjs.
//
// Decision order (BLOCKED short-circuits; only a fully clean run AND a delivered, apply-checked,
// non-empty diff earns an optimistic status):
//   priorStatus already BLOCKED                                            -> BLOCKED
//   implement not green / no independent Verify / Verify not green /
//   review incomplete / blocking review unresolved                        -> BLOCKED
//   code-quality compile/build failed (applicable + ran + !passed)         -> BLOCKED   (P0)
//   testsIntact missing/false, scope violations, or file reconcile issues  -> BLOCKED
//   diff missing or not ok / git apply --check failed / no changed files   -> BLOCKED   (issues #1 / #2)
//   else                                                                   -> DELIVERED_WITH_OPEN_ITEMS if any
//                                                                             open item, else DELIVERED
//
// input = {
//   priorStatus,                       // current finalStatus before this gate ('BLOCKED' short-circuits)
//   implementPassed,                   // bool: implementer reported DONE all-green
//   verify,                            // { donePassedVerified, scopeCleanVerified, redGreenVerified, testsIntact } | null
//                                      //   testsIntact!==true -> BLOCKED for new manifests; legacy bypass is explicit
//   reviews,                           // [{ verdict:'ok'|'needs-work', blocking:bool }]
//   reviewIncomplete,                  // bool: a review lens was missing
//   materializeOpenLoopItems,          // string[]
//   gateOpenQuestions, gateRemainingGaps,   // string[]
//   staleSeverity,                     // 'soft'|'none'|... : 'soft' (uncommitted dirty diff vs plan) -> open item
//   scopeViolations,                   // string[]: Implement changed files outside SCOPE -> BLOCKED
//   filesReconcileIssues,              // string[]: Verify/diff/SCOPE three-way reconcile issues -> BLOCKED
//   diff,                              // { ok, diffApplyCheckPassed, filesChanged } | null
//   browser,                           // { applicable, status:'passed'|'failed'|'skipped'|'error', openItems[] } | null
//                                      //   web only: applicable+failed -> BLOCKED; skipped/error or openItems
//                                      //   -> WITH_OPEN_ITEMS (honest skip, never faked); null/not-applicable -> no effect
//   codeQuality,                       // { applicable, compileRan, compilePassed, hasP0Failure, openItems[] } | null
//                                      //   applicable+compileRan+!compilePassed -> BLOCKED (P0 compile/build break);
//                                      //   applicable+hasP0Failure -> BLOCKED (a static check graded P0, e.g. critical
//                                      //   security/crash finding); openItems (non-compile P1/P2 failures / unverified
//                                      //   tools / new-tool warning) -> WITH_OPEN_ITEMS; null/not-applicable -> no effect.
// }
import { computeMultiAgentGate } from './multi-agent-status.mjs'

export function computeDeliverStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'BLOCKED') return { finalStatus: 'BLOCKED', reasons }
  const multiAgentGate = computeMultiAgentGate(i)
  if (!multiAgentGate.ok) return multiAgentGate

  const reviews = Array.isArray(i.reviews) ? i.reviews : []
  const verify = i.verify || null
  const verifiedGreen = !!(verify && verify.donePassedVerified === true && verify.scopeCleanVerified === true)
  const blockingReview = reviews.some(r => r && r.verdict === 'needs-work' && r.blocking)
  const redGreenUnconfirmed = !!(verify && verify.redGreenVerified === false)
  if (redGreenUnconfirmed) reasons.push('独立"先红后绿"未复现：DONE 可信度未被独立确认，降为带开环项交付。')

  const materializeOpenLoopItems = Array.isArray(i.materializeOpenLoopItems) ? i.materializeOpenLoopItems : []
  const gateOpenQuestions = Array.isArray(i.gateOpenQuestions) ? i.gateOpenQuestions : []
  const gateRemainingGaps = Array.isArray(i.gateRemainingGaps) ? i.gateRemainingGaps : []
  // browser verification (web projects only): applicable+failed BLOCKS below; skipped/error or carried open
  // items only downgrade to WITH_OPEN_ITEMS (honest skip, never faked); null / not-applicable = no effect.
  const browser = i.browser || null
  const browserOpenItems = (browser && Array.isArray(browser.openItems)) ? browser.openItems : []
  const browserDeferred = !!(browser && browser.applicable === true && (browser.status === 'skipped' || browser.status === 'error'))
  // code quality (all projects): applicable+compileRan+!compilePassed BLOCKS below (P0); non-compile static
  // failures / unverified tools / new-tool warning ride openItems -> WITH_OPEN_ITEMS; null/not-applicable = no effect.
  const codeQuality = i.codeQuality || null
  const codeQualityOpenItems = (codeQuality && Array.isArray(codeQuality.openItems)) ? codeQuality.openItems : []
  const codeQualityCompileFailed = !!(codeQuality && codeQuality.applicable === true && codeQuality.compileRan === true && codeQuality.compilePassed === false)
  const codeQualityP0 = !!(codeQuality && codeQuality.applicable === true && codeQuality.hasP0Failure === true)
  const testsTampered = !!(verify && verify.testsIntact === false)   // in-tree tests changed since materialize
  const testsIntactMissing = !!(verify && verify.testsIntact !== true && verify.testsIntact !== false)
  const softStale = i.staleSeverity === 'soft'                       // target had uncommitted dirty diff vs plan
  const scopeViolations = Array.isArray(i.scopeViolations) ? i.scopeViolations : []
  const filesReconcileIssues = Array.isArray(i.filesReconcileIssues) ? i.filesReconcileIssues : []   // Verify/diff/SCOPE 三方对账不一致
  const hasOpenItems = materializeOpenLoopItems.length > 0 ||
    reviews.some(r => r && r.verdict === 'needs-work') ||
    redGreenUnconfirmed ||
    gateOpenQuestions.length > 0 || gateRemainingGaps.length > 0 ||
    browserOpenItems.length > 0 || browserDeferred ||
    codeQualityOpenItems.length > 0 ||
    softStale

  if (!i.implementPassed) { reasons.push('实现未达全绿，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verify) { reasons.push('缺独立验证（Verify 失败），不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verifiedGreen) { reasons.push('独立验证未确认 DONE 真绿 / 只动 SCOPE，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (i.reviewIncomplete) { reasons.push('独立复审视角不齐，不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (blockingReview) { reasons.push('存在阻断性审查意见未关闭。'); return { finalStatus: 'BLOCKED', reasons } }
  if (browser && browser.applicable === true && browser.status === 'failed') { reasons.push('真实浏览器验证失败（web 项目：页面/交互/控制台/接口未通过），不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (codeQualityCompileFailed) { reasons.push('项目编译/构建失败（P0），不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (codeQualityP0) { reasons.push('代码质量检查存在 P0 级静态问题（必阻断），不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (testsIntactMissing && i.allowLegacyUnverifiedDelivery !== true) { reasons.push('新交付缺少 testsIntact=true 的测试基线完整性证据，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (testsTampered) { reasons.push('测试基线指纹与物化时不一致（testsIntact=false），疑似测试被实现/修复阶段改动，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (scopeViolations.length > 0) { reasons.push(`实现修改了 SCOPE 外文件：${scopeViolations.join(', ')}。`); return { finalStatus: 'BLOCKED', reasons } }
  if (filesReconcileIssues.length > 0) { reasons.push(`变更文件对账不一致：${filesReconcileIssues.join('; ')}。`); return { finalStatus: 'BLOCKED', reasons } }

  // #1/#2: the delivered, apply-checked diff is the final fact — never settle on DELIVERED without it.
  const diff = i.diff || null
  if (!diff || diff.ok !== true) { reasons.push('交付 diff 生成/落盘失败，状态降级 BLOCKED（不以 DELIVERED 收尾）。'); return { finalStatus: 'BLOCKED', reasons } }
  if (diff.diffApplyCheckPassed !== true) { reasons.push('diff 未通过 git apply --check，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!Array.isArray(diff.filesChanged) || diff.filesChanged.length === 0) { reasons.push('交付未产出任何变更文件，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  // delivery write is the very last fact: if the manifest/report failed to persist, do not claim DELIVERED
  if (i.deliveryPersisted === false) { reasons.push('交付产物落盘失败（delivery-manifest/报告未成功写入），状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  return { finalStatus: hasOpenItems ? 'DELIVERED_WITH_OPEN_ITEMS' : 'DELIVERED', reasons }
}
