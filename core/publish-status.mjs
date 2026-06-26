// Canonical publish final-status decision — pure, deterministic, unit-tested.
//
// Why this lives in core/: the Claude Workflow script surface cannot import modules, so
// .claude/workflows/publish-delivery.js keeps an INLINE copy of this function between the
// PUBLISH-STATUS markers. scripts/self-check.mjs behaviour-diffs the inline copy against this
// canonical one over fixed vectors so the two cannot drift. Unit tests: scripts/publish-status.test.mjs.
//
// publish-delivery turns a verified deliver-from-plan delivery (changes.diff + delivery-manifest with
// finalStatus DELIVERED / DELIVERED_WITH_OPEN_ITEMS) into a real git branch/commit/push, then verifies
// the remote independently. The remote is the source of truth: never claim PUBLISHED without a passing
// post-push verification (branch SHA matches, committed files match the delivery, no forbidden files,
// clean tree).
//
// Decision order (PUBLISH_BLOCKED short-circuits; only a pushed-and-remote-verified run earns PUBLISHED):
//   priorStatus already PUBLISH_BLOCKED                                  -> PUBLISH_BLOCKED
//   high-risk domain and not explicitly allowed (human gate)             -> PUBLISH_BLOCKED
//   upstream delivery not DELIVERED / DELIVERED_WITH_OPEN_ITEMS          -> PUBLISH_BLOCKED
//   delivery diff did not pass git apply --check                         -> PUBLISH_BLOCKED
//   target branch not allowed by policy (main/master/release w/o opt-in) -> PUBLISH_BLOCKED
//   dryRun                                                               -> PUBLISH_DRYRUN
//   push not performed (no creds / rejected / network)                   -> PUBLISH_BLOCKED
//   remote verification not fully green                                  -> PUBLISH_UNVERIFIED
//   else                                                                 -> PUBLISHED_WITH_OPEN_ITEMS if any
//                                                                           carried open item, else PUBLISHED
//
// input = {
//   priorStatus,            // current status before this gate ('PUBLISH_BLOCKED' short-circuits)
//   highRiskBlocked,        // bool: high-risk domain present and auto-publish not allowed
//   deliverableStatus,      // delivery-manifest.finalStatus
//   diffApplyCheckPassed,   // bool: delivery diff passed git apply --check
//   branchAllowed,          // bool: target branch permitted by git policy (no main/master/release unless opted in)
//   dryRun,                 // bool: prepare everything but do not push
//   pushPerformed,          // bool: push actually executed and accepted
//   remoteVerified,         // { branchShaMatches, committedFilesMatch, noForbiddenFiles, workTreeClean } | null
//   deliverableOpenItems,   // string[]: open items carried from the delivery
// }
export function computePublishStatus(input) {
  const i = input || {}
  const reasons = []
  if (i.priorStatus === 'PUBLISH_BLOCKED') return { finalStatus: 'PUBLISH_BLOCKED', reasons }

  if (i.highRiskBlocked) { reasons.push('高风险域（支付/权限/密钥/认证/不可逆）默认人工闸门，不自动发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  const ok = ['DELIVERED', 'DELIVERED_WITH_OPEN_ITEMS']
  if (!ok.includes(i.deliverableStatus)) { reasons.push('上游交付未达可发布态（需 DELIVERED / DELIVERED_WITH_OPEN_ITEMS），拒绝发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }
  if (i.diffApplyCheckPassed !== true) { reasons.push('交付 diff 未通过 git apply --check，拒绝发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }
  if (i.branchAllowed === false) { reasons.push('目标分支不被策略允许（默认禁止直接 push main/master/release；需显式 allowMainPush）。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  if (i.dryRun === true) { reasons.push('dryRun：已准备分支/提交，但按要求未实际 push。'); return { finalStatus: 'PUBLISH_DRYRUN', reasons } }
  if (i.pushPerformed !== true) { reasons.push('push 未成功执行（凭据缺失/被拒/网络），未发布。'); return { finalStatus: 'PUBLISH_BLOCKED', reasons } }

  const rv = i.remoteVerified || null
  const remoteOk = !!(rv && rv.branchShaMatches === true && rv.committedFilesMatch === true && rv.noForbiddenFiles === true && rv.workTreeClean === true)
  if (!remoteOk) { reasons.push('发布后远程核验未全过（远程SHA/提交文件/禁入文件/工作树 之一不符），不宣称成功。'); return { finalStatus: 'PUBLISH_UNVERIFIED', reasons } }

  const open = Array.isArray(i.deliverableOpenItems) ? i.deliverableOpenItems : []
  return { finalStatus: open.length > 0 ? 'PUBLISHED_WITH_OPEN_ITEMS' : 'PUBLISHED', reasons }
}
