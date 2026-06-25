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
//   diff missing or not ok / git apply --check failed / no changed files   -> BLOCKED   (issues #1 / #2)
//   else                                                                   -> DELIVERED_WITH_OPEN_ITEMS if any
//                                                                             open item, else DELIVERED
//
// input = {
//   priorStatus,                       // current finalStatus before this gate ('BLOCKED' short-circuits)
//   implementPassed,                   // bool: implementer reported DONE all-green
//   verify,                            // { donePassedVerified, scopeCleanVerified, redGreenVerified } | null
//   reviews,                           // [{ verdict:'ok'|'needs-work', blocking:bool }]
//   reviewIncomplete,                  // bool: a review lens was missing
//   materializeOpenLoopItems,          // string[]
//   gateOpenQuestions, gateRemainingGaps,   // string[]
//   diff,                              // { ok, diffApplyCheckPassed, filesChanged } | null
// }
export function computeDeliverStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'BLOCKED') return { finalStatus: 'BLOCKED', reasons }

  const reviews = Array.isArray(i.reviews) ? i.reviews : []
  const verify = i.verify || null
  const verifiedGreen = !!(verify && verify.donePassedVerified === true && verify.scopeCleanVerified === true)
  const blockingReview = reviews.some(r => r && r.verdict === 'needs-work' && r.blocking)
  const redGreenUnconfirmed = !!(verify && verify.redGreenVerified === false)
  if (redGreenUnconfirmed) reasons.push('独立"先红后绿"未复现：DONE 可信度未被独立确认，降为带开环项交付。')

  const materializeOpenLoopItems = Array.isArray(i.materializeOpenLoopItems) ? i.materializeOpenLoopItems : []
  const gateOpenQuestions = Array.isArray(i.gateOpenQuestions) ? i.gateOpenQuestions : []
  const gateRemainingGaps = Array.isArray(i.gateRemainingGaps) ? i.gateRemainingGaps : []
  const hasOpenItems = materializeOpenLoopItems.length > 0 ||
    reviews.some(r => r && r.verdict === 'needs-work') ||
    redGreenUnconfirmed ||
    gateOpenQuestions.length > 0 || gateRemainingGaps.length > 0

  if (!i.implementPassed) { reasons.push('实现未达全绿，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verify) { reasons.push('缺独立验证（Verify 失败），不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!verifiedGreen) { reasons.push('独立验证未确认 DONE 真绿 / 只动 SCOPE，不交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (i.reviewIncomplete) { reasons.push('独立复审视角不齐，不乐观交付。'); return { finalStatus: 'BLOCKED', reasons } }
  if (blockingReview) { reasons.push('存在阻断性审查意见未关闭。'); return { finalStatus: 'BLOCKED', reasons } }

  // #1/#2: the delivered, apply-checked diff is the final fact — never settle on DELIVERED without it.
  const diff = i.diff || null
  if (!diff || diff.ok !== true) { reasons.push('交付 diff 生成/落盘失败，状态降级 BLOCKED（不以 DELIVERED 收尾）。'); return { finalStatus: 'BLOCKED', reasons } }
  if (diff.diffApplyCheckPassed !== true) { reasons.push('diff 未通过 git apply --check，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }
  if (!Array.isArray(diff.filesChanged) || diff.filesChanged.length === 0) { reasons.push('交付未产出任何变更文件，状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  // delivery write is the very last fact: if the manifest/report failed to persist, do not claim DELIVERED
  if (i.deliveryPersisted === false) { reasons.push('交付产物落盘失败（delivery-manifest/报告未成功写入），状态降级 BLOCKED。'); return { finalStatus: 'BLOCKED', reasons } }

  return { finalStatus: hasOpenItems ? 'DELIVERED_WITH_OPEN_ITEMS' : 'DELIVERED', reasons }
}
