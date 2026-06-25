// Canonical stale-plan detection — pure, deterministic, unit-tested.
//
// A repo fingerprint is captured against the target when a plan is made and re-captured at delivery
// time; if they differ, the plan may no longer match the code it was written against. Inline copy of
// the comparison lives in deliver-from-plan.js between FINGERPRINT markers; self-check behaviour-diffs
// them. Unit tests: scripts/repo-fingerprint.test.mjs.
//
// fingerprint = { commit, treeHash, dirty, dirtyDiffHash }  (any field '' / false when unavailable,
// e.g. a non-git target). Identity = commit, falling back to treeHash; uncommitted state = dirtyDiffHash.
//
// returns { comparable, severity: 'none'|'soft'|'hard'|'unknown', stale, changed[], reasons[] }
//   hard    = committed/tree identity changed -> block delivery by default
//   soft    = only uncommitted (dirty) changes differ -> warn / open item
//   none    = identical
//   unknown = neither side has a comparable commit/treeHash
export function compareRepoFingerprint(planFp, currentFp) {
  if (!planFp || !currentFp) {
    return { comparable: false, severity: 'unknown', stale: false, changed: [], reasons: ['缺少指纹，无法判定 stale（按可继续处理，但已标注）'] }
  }
  const changed = []
  const reasons = []
  let identityComparable = false
  if (planFp.commit && currentFp.commit) {
    identityComparable = true
    if (planFp.commit !== currentFp.commit) { changed.push('commit'); reasons.push(`commit 变更：方案基于 ${planFp.commit}，当前 ${currentFp.commit}`) }
  } else if (planFp.treeHash && currentFp.treeHash) {
    identityComparable = true
    if (planFp.treeHash !== currentFp.treeHash) { changed.push('treeHash'); reasons.push('文件树内容哈希变更') }
  }
  if ((planFp.dirtyDiffHash || '') !== (currentFp.dirtyDiffHash || '')) { changed.push('dirtyDiff'); reasons.push('未提交改动(dirty diff)与方案生成时不一致') }
  const hard = changed.includes('commit') || changed.includes('treeHash')
  const soft = !hard && changed.length > 0
  const severity = hard ? 'hard' : soft ? 'soft' : (identityComparable ? 'none' : 'unknown')
  if (!identityComparable) reasons.push('两侧均缺 commit/treeHash，身份不可比（仅比对了 dirty）')
  return { comparable: identityComparable, severity, stale: hard || soft, changed, reasons }
}
