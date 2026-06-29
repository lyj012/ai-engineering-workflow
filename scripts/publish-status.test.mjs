// Unit tests for the canonical publish final-status decision (core/publish-status.mjs).
// Run directly: node scripts/publish-status.test.mjs
// Also imported by scripts/self-check.mjs via runPublishStatusTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { computePublishStatus } from '../core/publish-status.mjs'

// A delivery that is fully publishable, pushed, and remote-verified.
const clean = {
  priorStatus: 'FAILED',
  highRiskBlocked: false,
  deliverableStatus: 'DELIVERED',
  diffApplyCheckPassed: true,
  branchAllowed: true,
  dryRun: false,
  pushPerformed: true,
  remoteVerified: { branchShaMatches: true, committedFilesMatch: true, noForbiddenFiles: true, workTreeClean: true },
  deliverableOpenItems: [],
  deliveryPersistVerified: true,   // new protocol: a publishable delivery must self-verify its persistence
}

export const CASES = [
  ['clean publish -> PUBLISHED', clean, 'PUBLISHED'],
  ['prior PUBLISH_BLOCKED short-circuits', { ...clean, priorStatus: 'PUBLISH_BLOCKED' }, 'PUBLISH_BLOCKED'],
  ['prior PUBLISH_NEEDS_CHOICE short-circuits', { ...clean, priorStatus: 'PUBLISH_NEEDS_CHOICE' }, 'PUBLISH_NEEDS_CHOICE'],
  ['high-risk gated -> PUBLISH_BLOCKED', { ...clean, highRiskBlocked: true }, 'PUBLISH_BLOCKED'],
  ['upstream not delivered -> PUBLISH_BLOCKED', { ...clean, deliverableStatus: 'BLOCKED' }, 'PUBLISH_BLOCKED'],
  ['upstream FAILED -> PUBLISH_BLOCKED', { ...clean, deliverableStatus: 'FAILED' }, 'PUBLISH_BLOCKED'],
  // --- R2-1: persistVerification must be explicitly TRUE; false or absent is BLOCKED (absent only bypassable via allowLegacyUnverifiedDelivery) ---
  ['persist verified true -> PUBLISHED', clean, 'PUBLISHED'],
  ['persist explicitly false -> PUBLISH_BLOCKED', { ...clean, deliveryPersistVerified: false }, 'PUBLISH_BLOCKED'],
  ['persist field ABSENT -> PUBLISH_BLOCKED (legacy not allowed)', { ...clean, deliveryPersistVerified: undefined }, 'PUBLISH_BLOCKED'],
  ['persist ABSENT + allowLegacy -> PUBLISHED', { ...clean, deliveryPersistVerified: undefined, allowLegacyUnverifiedDelivery: true }, 'PUBLISHED'],
  ['persist explicit false + allowLegacy STILL BLOCKED (legacy only bypasses absent)', { ...clean, deliveryPersistVerified: false, allowLegacyUnverifiedDelivery: true }, 'PUBLISH_BLOCKED'],
  ['diff apply-check failed -> PUBLISH_BLOCKED', { ...clean, diffApplyCheckPassed: false }, 'PUBLISH_BLOCKED'],
  ['branch not allowed -> PUBLISH_BLOCKED', { ...clean, branchAllowed: false }, 'PUBLISH_BLOCKED'],
  ['dryRun -> PUBLISH_DRYRUN', { ...clean, dryRun: true }, 'PUBLISH_DRYRUN'],
  ['push not performed -> PUBLISH_BLOCKED', { ...clean, pushPerformed: false }, 'PUBLISH_BLOCKED'],
  // --- remote verification is the final fact: never claim success without it ---
  ['no remote verify -> PUBLISH_UNVERIFIED', { ...clean, remoteVerified: null }, 'PUBLISH_UNVERIFIED'],
  ['remote sha mismatch -> PUBLISH_UNVERIFIED', { ...clean, remoteVerified: { ...clean.remoteVerified, branchShaMatches: false } }, 'PUBLISH_UNVERIFIED'],
  ['committed files mismatch -> PUBLISH_UNVERIFIED', { ...clean, remoteVerified: { ...clean.remoteVerified, committedFilesMatch: false } }, 'PUBLISH_UNVERIFIED'],
  ['forbidden file committed -> PUBLISH_UNVERIFIED', { ...clean, remoteVerified: { ...clean.remoteVerified, noForbiddenFiles: false } }, 'PUBLISH_UNVERIFIED'],
  ['dirty work tree -> PUBLISH_UNVERIFIED', { ...clean, remoteVerified: { ...clean.remoteVerified, workTreeClean: false } }, 'PUBLISH_UNVERIFIED'],
  // --- delivered-with-open-items carries through to PUBLISHED_WITH_OPEN_ITEMS ---
  ['delivered-with-open-items + open carried -> WITH_OPEN_ITEMS', { ...clean, deliverableStatus: 'DELIVERED_WITH_OPEN_ITEMS', deliverableOpenItems: ['no pwsh .ps1'] }, 'PUBLISHED_WITH_OPEN_ITEMS'],
  ['delivered-with-open-items but no carried item -> PUBLISHED', { ...clean, deliverableStatus: 'DELIVERED_WITH_OPEN_ITEMS', deliverableOpenItems: [] }, 'PUBLISHED'],
]

export function runPublishStatusTests() {
  const failures = []
  for (const [name, input, expected] of CASES) {
    let got
    try { got = computePublishStatus(input).finalStatus } catch (e) { got = `threw: ${e.message}` }
    if (got !== expected) failures.push(`publish-status "${name}": expected ${expected}, got ${got}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runPublishStatusTests()
  if (failures.length) {
    console.error('PUBLISH-STATUS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`PUBLISH-STATUS TESTS PASSED (${CASES.length} cases)`)
}
