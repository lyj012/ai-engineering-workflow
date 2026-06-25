// Canonical plan-patch merge — pure, deterministic, unit-tested.
//
// Rework used to only append narrative refinements to plan.assumptions; the implementation plan
// body (modify / add / steps / affected.files / approach) never actually changed, so a later review
// re-reviewed the same un-updated plan. applyPlanPatch merges a structured rework patch back into the
// plan. Inline copy lives in plan-from-requirement.js between PLAN-PATCH markers; self-check
// behaviour-diffs them. Unit tests: scripts/plan-patch.test.mjs.
//
// patch = { addModify[{path,change,why}], addAdd[{path,what,why}], addSteps[{order,action,touches}],
//           addAffectedFiles[string], revisedApproach } — same-path modify/add entries replace.
export function applyPlanPatch(plan, patch) {
  const p = plan || {}
  const pa = patch || {}
  const dedupByPath = (arr) => {
    const seen = new Map()
    for (const item of arr) if (item && item.path) seen.set(item.path, item)   // last wins: a patch entry refines the original
    return [...seen.values()]
  }
  const modify = dedupByPath([...(Array.isArray(p.modify) ? p.modify : []), ...(Array.isArray(pa.addModify) ? pa.addModify : [])])
  const add = dedupByPath([...(Array.isArray(p.add) ? p.add : []), ...(Array.isArray(pa.addAdd) ? pa.addAdd : [])])
  const steps = [...(Array.isArray(p.steps) ? p.steps : []), ...(Array.isArray(pa.addSteps) ? pa.addSteps : [])]
  const baseAffected = (p.affected && typeof p.affected === 'object') ? p.affected : {}
  const affectedFiles = [...new Set([...(Array.isArray(baseAffected.files) ? baseAffected.files : []), ...(Array.isArray(pa.addAffectedFiles) ? pa.addAffectedFiles : [])])]
  const approach = (typeof pa.revisedApproach === 'string' && pa.revisedApproach.trim()) ? pa.revisedApproach : p.approach
  return { ...p, approach, modify, add, steps, affected: { ...baseAffected, files: affectedFiles } }
}
