// Validate a deliver-from-plan delivery directory against core/schemas/delivery-artifacts.schema.json.
// Run: node scripts/validate-delivery-artifacts.mjs <delivery-dir>
// Reuses the JSON-schema engine from validate-plan-artifacts.mjs (the delivery schema is flat / no $ref),
// so the validation logic is shared, not duplicated. Imported by scripts/self-check.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './validate-plan-artifacts.mjs'
import { computeMultiAgentGate } from '../core/multi-agent-status.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/delivery-artifacts.schema.json'), 'utf8'))

export function validateDeliveryArtifacts(deliveryDir) {
  const dir = path.resolve(deliveryDir)
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'delivery-manifest.json'), 'utf8'))
  const errors = validate(manifest, schema, dir)
  if (manifest.finalStatus === 'DELIVERED' || manifest.finalStatus === 'DELIVERED_WITH_OPEN_ITEMS') {
    const gate = computeMultiAgentGate({ multiAgent: manifest.multiAgent, requireMultiAgent: true })
    if (!gate.ok) errors.push(`${dir}.multiAgent: ${gate.finalStatus} ${gate.reasonCode || ''}`.trim())
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
