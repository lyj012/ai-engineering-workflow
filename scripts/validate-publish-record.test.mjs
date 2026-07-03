// Focused tests for publish record semantic validation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validatePublishRecord } from './validate-publish-record.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

function copyExample() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'publish-record-'))
  fs.cpSync(path.join(root, 'examples/artifacts/publish-record-example'), work, { recursive: true })
  return work
}

function readRecord(work) {
  return JSON.parse(fs.readFileSync(path.join(work, 'final-delivery.json'), 'utf8'))
}

function writeRecord(work, record) {
  fs.writeFileSync(path.join(work, 'final-delivery.json'), JSON.stringify(record, null, 2) + '\n', 'utf8')
}

export function runValidatePublishRecordTests() {
  const failures = []

  const cases = [
    {
      name: 'actual producer-shaped published record passes',
      mutate: record => record,
      expectError: null,
    },
    {
      name: 'dry-run record passes',
      mutate: record => {
        record.finalStatus = 'PUBLISH_DRYRUN'
        record.dryRun = true
        record.push = { performed: false }
        record.remoteVerify = null
        record.remoteVerifyRecomputed = null
        record.openItems = []
        record.deliverableStatus = 'DELIVERED'
        record.statusInput = {
          ...record.statusInput,
          deliverableStatus: 'DELIVERED',
          dryRun: true,
          pushPerformed: false,
          remoteVerified: null,
          deliverableOpenItems: [],
        }
        return record
      },
      expectError: null,
    },
    {
      name: 'explicit legacy publish revalidates',
      mutate: record => {
        record.finalStatus = 'PUBLISHED_WITH_OPEN_ITEMS'
        record.deliveryPersistFieldPresent = false
        record.deliveryPersistVerified = false
        record.allowLegacyUnverifiedDelivery = true
        record.statusInput = {
          ...record.statusInput,
          deliveryPersistVerified: undefined,
          allowLegacyUnverifiedDelivery: true,
        }
        return record
      },
      expectError: null,
    },
    {
      name: 'agent true but recomputed false records an error even when final status is unverified',
      mutate: record => {
        record.finalStatus = 'PUBLISH_UNVERIFIED'
        record.remoteVerifyRecomputed = { ...record.remoteVerifyRecomputed, committedFilesMatch: false }
        record.statusInput = { ...record.statusInput, remoteVerified: record.remoteVerifyRecomputed }
        return record
      },
      expectError: 'remoteVerify.committedFilesMatch: disagrees with remoteVerifyRecomputed',
    },
    {
      name: 'published record cannot ignore recomputed remote failure',
      mutate: record => {
        record.remoteVerifyRecomputed = { ...record.remoteVerifyRecomputed, committedFilesMatch: false }
        record.statusInput = { ...record.statusInput, remoteVerified: record.remoteVerifyRecomputed }
        return record
      },
      expectError: 'recomputed PUBLISH_UNVERIFIED',
    },
  ]

  for (const testCase of cases) {
    const work = copyExample()
    try {
      const record = testCase.mutate(readRecord(work))
      writeRecord(work, record)
      const errors = validatePublishRecord(work)
      if (testCase.expectError) {
        if (!errors.some(error => error.includes(testCase.expectError))) {
          failures.push(`${testCase.name}: expected error containing "${testCase.expectError}", got ${errors.join('; ') || 'none'}`)
        }
      } else if (errors.length) {
        failures.push(`${testCase.name}: expected pass, got ${errors.join('; ')}`)
      }
    } catch (e) {
      failures.push(`${testCase.name}: threw ${e.message}`)
    } finally {
      try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }

  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runValidatePublishRecordTests()
  if (failures.length) {
    console.error('VALIDATE-PUBLISH-RECORD TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('VALIDATE-PUBLISH-RECORD TESTS PASSED')
}
