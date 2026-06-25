// Canonical, deterministic plan readiness — derived from finalStatus, never decided by a model.
//
// Why: plan-from-requirement previously let the report agent return readinessForDev, which allowed
// illegal pairs like FAILED_WITH_FINDINGS + ready. Readiness is now computed in code from the
// (already deterministic) finalStatus. The workflow keeps an inline copy between READINESS markers;
// scripts/self-check.mjs behaviour-diffs it against this canonical one. Unit tests: scripts/readiness.test.mjs.
//
//   PASS | PARTIAL       -> 'ready'                (a delivery workflow may consume the plan)
//   NEEDS_CLARIFICATION  -> 'needs-clarification' (requirement must be clarified before any delivery)
//   anything else        -> 'blocked'             (FAILED / FAILED_WITH_FINDINGS / CONDITIONAL / unknown)
export function computeReadiness(finalStatus) {
  if (finalStatus === 'PASS' || finalStatus === 'PARTIAL') return 'ready'
  if (finalStatus === 'NEEDS_CLARIFICATION') return 'needs-clarification'
  return 'blocked'
}

// True only when (finalStatus, readiness) is the deterministically-correct pair — used to catch
// any illegal combination (e.g. FAILED_WITH_FINDINGS + ready) before it reaches an artifact.
export function isValidStatusReadinessCombo(finalStatus, readiness) {
  return computeReadiness(finalStatus) === readiness
}
