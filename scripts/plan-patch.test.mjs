// Unit tests for the canonical plan-patch merge (core/plan-patch.mjs).
// Run directly: node scripts/plan-patch.test.mjs
// Also imported by scripts/self-check.mjs via runPlanPatchTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPlanPatch } from '../core/plan-patch.mjs'

const basePlan = {
  approach: 'orig', reuse: [],
  modify: [{ path: 'a.js', change: 'x', why: 'y' }], add: [],
  steps: [{ order: 1, action: 's1', touches: ['a.js'] }],
  affected: { files: ['a.js'], modules: [] }, architectureFit: 'fit', assumptions: ['a1'], alternatives: [],
}

// [name, plan, patch] — inputs reused by self-check for inline-vs-core parity
export const CASES = [
  ['empty patch', basePlan, {}],
  ['add modify (new path)', basePlan, { addModify: [{ path: 'b.js', change: 'c', why: 'w' }] }],
  ['add modify (same path replaces)', basePlan, { addModify: [{ path: 'a.js', change: 'new', why: 'w2' }] }],
  ['add add', basePlan, { addAdd: [{ path: 'n.js', what: 'new file', why: 'w' }] }],
  ['add steps', basePlan, { addSteps: [{ order: 2, action: 's2', touches: ['b.js'] }] }],
  ['add affected files (union/unique)', basePlan, { addAffectedFiles: ['b.js', 'a.js'] }],
  ['revised approach', basePlan, { revisedApproach: 'new approach' }],
  ['empty revised approach keeps original', basePlan, { revisedApproach: '' }],
]

export function runPlanPatchTests() {
  const failures = []
  const assert = (cond, msg) => { if (!cond) failures.push(`plan-patch: ${msg}`) }

  const r0 = applyPlanPatch(basePlan, {})
  assert(r0.modify.length === 1 && r0.add.length === 0 && r0.steps.length === 1 && r0.affected.files.length === 1 && r0.approach === 'orig', 'empty patch should keep plan body')

  assert(applyPlanPatch(basePlan, { addModify: [{ path: 'b.js', change: 'c', why: 'w' }] }).modify.length === 2, 'new-path modify should append')

  const r2 = applyPlanPatch(basePlan, { addModify: [{ path: 'a.js', change: 'new', why: 'w2' }] })
  assert(r2.modify.length === 1 && r2.modify[0].change === 'new', 'same-path modify should replace, not duplicate')

  assert(applyPlanPatch(basePlan, { addAdd: [{ path: 'n.js', what: 'f', why: 'w' }] }).add.length === 1, 'addAdd should append')
  assert(applyPlanPatch(basePlan, { addSteps: [{ order: 2, action: 's2', touches: [] }] }).steps.length === 2, 'addSteps should append')

  const r4 = applyPlanPatch(basePlan, { addAffectedFiles: ['b.js', 'a.js'] })
  assert(r4.affected.files.length === 2 && r4.affected.files.includes('b.js'), 'affected files should union uniquely')

  assert(applyPlanPatch(basePlan, { revisedApproach: 'new approach' }).approach === 'new approach', 'revisedApproach should replace approach')
  assert(applyPlanPatch(basePlan, { revisedApproach: '' }).approach === 'orig', 'empty revisedApproach should keep approach')

  // input plan must not be mutated
  assert(basePlan.modify.length === 1 && basePlan.affected.files.length === 1 && basePlan.approach === 'orig', 'applyPlanPatch must not mutate the input plan')

  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runPlanPatchTests()
  if (failures.length) {
    console.error('PLAN-PATCH TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`PLAN-PATCH TESTS PASSED (${CASES.length} parity cases + assertions)`)
}
