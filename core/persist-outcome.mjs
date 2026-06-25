// Canonical persist-verification outcome — pure, deterministic, unit-tested.
//
// Decides whether a run's artifacts are reliably on disk (independent read-back evidence, NOT the
// writer's self-reported list), and downgrades an optimistic status when they are not — so a plan
// never reports PASS/PARTIAL while its artifacts are missing or corrupt. Inline copy lives in
// plan-from-requirement.js between PERSIST-OUTCOME markers; scripts/self-check.mjs behaviour-diffs them.
// Unit tests: scripts/persist-outcome.test.mjs.
//
// input = {
//   expectedFiles,   // string[] of bare artifact filenames that should exist
//   existing,        // string[] verified present + non-empty (abs or bare paths; compared by basename)
//   unparseable,     // string[] present but JSON.parse failed (.json only)
//   finalStatus,     // current finalStatus before this gate
// }
export function computePersistOutcome(input) {
  const i = input || {}
  const expected = Array.isArray(i.expectedFiles) ? i.expectedFiles : []
  const existing = new Set((Array.isArray(i.existing) ? i.existing : []).map(f => String(f).split('/').pop()))
  const unparseable = (Array.isArray(i.unparseable) ? i.unparseable : []).map(f => String(f).split('/').pop())
  const schemaInvalid = (Array.isArray(i.schemaInvalid) ? i.schemaInvalid : []).map(f => String(f).split('/').pop())
  const missing = expected.filter(f => !existing.has(f))
  const ok = missing.length === 0 && unparseable.length === 0 && schemaInvalid.length === 0
  let finalStatus = i.finalStatus
  // unverified persistence must not present as a usable plan
  if (!ok && (finalStatus === 'PASS' || finalStatus === 'PARTIAL')) finalStatus = 'FAILED'
  return { ok, missing, unparseable, schemaInvalid, finalStatus }
}
