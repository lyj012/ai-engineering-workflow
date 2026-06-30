// Validate a publish-delivery record (final-delivery.json) against core/schemas/publish-record.schema.json.
// Run: node scripts/validate-publish-record.mjs <publish-dir>
// Reuses the JSON-schema engine from validate-plan-artifacts.mjs (the publish schema is flat / no $ref).
// Imported by scripts/self-check.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './validate-plan-artifacts.mjs'
import { computePublishStatus } from '../core/publish-status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/publish-record.schema.json'), 'utf8'))

function sortedUnique(values) {
  return [...new Set((values || []).filter(Boolean))].sort()
}

function sameSet(a, b) {
  const left = sortedUnique(a)
  const right = sortedUnique(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function isSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value)
}

function publishStatusInput(record) {
  return {
    priorStatus: record.priorStatus || 'FAILED',
    awaitingUserConfirmation: record.awaitingUserConfirmation,
    highRiskBlocked: record.highRiskBlocked,
    deliverableStatus: record.deliverableStatus,
    deliveryPersistVerified: record.deliveryPersistVerified,
    allowLegacyUnverifiedDelivery: record.allowLegacyUnverifiedDelivery,
    diffApplyCheckPassed: record.diffApplyCheckPassed,
    branchAllowed: record.branch && record.branch.allowed,
    dryRun: record.dryRun,
    pushPerformed: record.push && record.push.performed,
    remoteVerified: record.remoteVerify || null,
    deliverableOpenItems: record.openItems || [],
  }
}

export function validatePublishRecord(publishDir) {
  const dir = path.resolve(publishDir)
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'final-delivery.json'), 'utf8'))
  const errors = validate(record, schema, dir)
  const recomputed = computePublishStatus(publishStatusInput(record))
  if (recomputed.finalStatus !== record.finalStatus) {
    errors.push(`${dir}.finalStatus: recomputed ${recomputed.finalStatus}, record says ${record.finalStatus}`)
  }
  const openItems = Array.isArray(record.openItems) ? record.openItems : []
  if (record.finalStatus === 'PUBLISHED' && openItems.length > 0) {
    errors.push(`${dir}.openItems: PUBLISHED requires openItems to be empty`)
  }
  if (record.finalStatus === 'PUBLISHED_WITH_OPEN_ITEMS' && openItems.length === 0) {
    errors.push(`${dir}.openItems: PUBLISHED_WITH_OPEN_ITEMS requires at least one open item`)
  }
  if (record.finalStatus === 'PUBLISHED' || record.finalStatus === 'PUBLISHED_WITH_OPEN_ITEMS') {
    const commitSha = record.commit && record.commit.sha
    const remoteSha = record.remoteVerify && record.remoteVerify.remoteSha
    if (!isSha(commitSha)) errors.push(`${dir}.commit.sha: published records require a 40-hex commit sha`)
    if (!record.push || record.push.performed !== true) errors.push(`${dir}.push.performed: published records require push.performed=true`)
    if (!record.remoteVerify) {
      errors.push(`${dir}.remoteVerify: published records require remote verification evidence`)
    } else {
      for (const key of ['branchShaMatches', 'committedFilesMatch', 'noForbiddenFiles', 'workTreeClean']) {
        if (record.remoteVerify[key] !== true) errors.push(`${dir}.remoteVerify.${key}: published records require true`)
      }
      if (!isSha(remoteSha)) errors.push(`${dir}.remoteVerify.remoteSha: published records require a 40-hex remote sha`)
      if (isSha(commitSha) && isSha(remoteSha) && commitSha !== remoteSha) errors.push(`${dir}.remoteVerify.remoteSha: must match commit.sha`)
    }
    if (record.commit && Array.isArray(record.commit.files) && !sameSet(record.commit.files, record.filesChanged || [])) {
      errors.push(`${dir}.commit.files: must match filesChanged`)
    }
    if (record.remoteVerify && Array.isArray(record.remoteVerify.remoteFiles) && !sameSet(record.remoteVerify.remoteFiles, record.filesChanged || [])) {
      errors.push(`${dir}.remoteVerify.remoteFiles: must match filesChanged`)
    }
  }
  return errors
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const publishDir = process.argv[2]
  if (!publishDir) {
    console.error('usage: node scripts/validate-publish-record.mjs <publish-dir>')
    process.exit(2)
  }
  const errors = validatePublishRecord(publishDir)
  if (errors.length) {
    console.error('PUBLISH RECORD VALIDATION FAILED')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log('PUBLISH RECORD VALIDATION PASSED')
}
