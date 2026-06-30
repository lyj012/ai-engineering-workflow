// Validate a deliver-from-plan delivery directory against core/schemas/delivery-artifacts.schema.json.
// Run: node scripts/validate-delivery-artifacts.mjs <delivery-dir>
// Reuses the JSON-schema engine from validate-plan-artifacts.mjs (the delivery schema is flat / no $ref),
// so the validation logic is shared, not duplicated. Imported by scripts/self-check.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './validate-plan-artifacts.mjs'
import { computeMultiAgentGate } from '../core/multi-agent-status.mjs'
import { computeDeliverStatus } from '../core/deliver-status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/delivery-artifacts.schema.json'), 'utf8'))

function sortedUnique(values) {
  return [...new Set((values || []).filter(Boolean))].sort()
}

function diffFiles(diffText) {
  const files = []
  for (const line of diffText.split(/\r?\n/)) {
    const match = line.match(/^\+\+\+ b\/(.+)$/)
    if (match && match[1] !== '/dev/null') files.push(match[1])
  }
  return sortedUnique(files)
}

function sameSet(a, b) {
  const left = sortedUnique(a)
  const right = sortedUnique(b)
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function deliverStatusInput(manifest) {
  const verify = manifest.independentVerify || null
  return {
    priorStatus: 'FAILED',
    multiAgent: manifest.multiAgent,
    implementPassed: manifest.implementPassed,
    verify,
    reviews: manifest.reviewVerdicts || [],
    reviewIncomplete: manifest.reviewComplete !== true,
    materializeOpenLoopItems: manifest.materializeOpenLoopItems || [],
    gateOpenQuestions: manifest.gateOpenQuestions || [],
    gateRemainingGaps: manifest.gateRemainingGaps || [],
    staleSeverity: manifest.staleSeverity,
    filesReconcileIssues: manifest.filesReconcileIssues || manifest.scopeViolations || [],
    browser: manifest.browserVerify || manifest.browser || null,
    codeQuality: manifest.codeQuality || null,
    diff: {
      ok: true,
      diffApplyCheckPassed: manifest.diffApplyCheckPassed,
      filesChanged: manifest.filesChanged || [],
    },
    deliveryPersisted: manifest.deliveryPersisted,
  }
}

export function validateDeliveryArtifacts(deliveryDir) {
  const dir = path.resolve(deliveryDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'delivery-manifest.json'), 'utf8'))
  const errors = validate(manifest, schema, dir)
  if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
    const gate = computeMultiAgentGate({ multiAgent: manifest.multiAgent, requireMultiAgent: true })
    if (!gate.ok) errors.push(`${dir}.multiAgent: ${gate.finalStatus} ${gate.reasonCode || ''}`.trim())
  }
  const recomputed = computeDeliverStatus(deliverStatusInput(manifest))
  if (recomputed.finalStatus !== manifest.finalStatus) {
    errors.push(`${dir}.finalStatus: recomputed ${recomputed.finalStatus}, manifest says ${manifest.finalStatus}`)
  }
  const openItems = Array.isArray(manifest.openItems) ? manifest.openItems : []
  if (manifest.finalStatus === 'DELIVERED' && openItems.length > 0) {
    errors.push(`${dir}.openItems: DELIVERED requires openItems to be empty`)
  }
  if (manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS' && openItems.length === 0) {
    errors.push(`${dir}.openItems: DELIVERED_WITH_OPEN_ITEMS requires at least one open item`)
  }
  const diffPath = path.join(dir, 'changes.diff')
  if (fs.existsSync(diffPath)) {
    const filesFromDiff = diffFiles(fs.readFileSync(diffPath, 'utf8'))
    if (!sameSet(filesFromDiff, manifest.filesChanged || [])) {
      errors.push(`${dir}.filesChanged: changes.diff files ${JSON.stringify(filesFromDiff)} do not match manifest filesChanged ${JSON.stringify(sortedUnique(manifest.filesChanged || []))}`)
    }
  } else if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
    errors.push(`${dir}/changes.diff: missing for delivered manifest`)
  }
  return errors
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deliveryDir = process.argv[2]
  if (!deliveryDir) {
    console.error('usage: node scripts/validate-delivery-artifacts.mjs <delivery-dir>')
    process.exit(2)
  }
  const errors = validateDeliveryArtifacts(deliveryDir)
  if (errors.length) {
    console.error('DELIVERY ARTIFACT VALIDATION FAILED')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log('DELIVERY ARTIFACT VALIDATION PASSED')
}
