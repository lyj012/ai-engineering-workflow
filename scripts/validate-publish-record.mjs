// Validate a publish-delivery record (final-delivery.json) against core/schemas/publish-record.schema.json.
// Run: node scripts/validate-publish-record.mjs <publish-dir>
// Reuses the JSON-schema engine from validate-plan-artifacts.mjs (the publish schema is flat / no $ref).
// Imported by scripts/self-check.mjs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validate } from './validate-plan-artifacts.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schema = JSON.parse(fs.readFileSync(path.join(root, 'core/schemas/publish-record.schema.json'), 'utf8'))

export function validatePublishRecord(publishDir) {
  const dir = path.resolve(publishDir)
  const record = JSON.parse(fs.readFileSync(path.join(dir, 'final-delivery.json'), 'utf8'))
  return validate(record, schema, dir)
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
