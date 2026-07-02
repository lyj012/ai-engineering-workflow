// Focused tests for delivery artifact semantic validation.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateDeliveryArtifactsDetailed } from './validate-delivery-artifacts.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

export function runValidateDeliveryArtifactsTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'delivery-validate-'))
    const src = path.join(root, 'examples/artifacts/delivery-success')
    fs.cpSync(src, work, { recursive: true })
    const manifestPath = path.join(work, 'delivery-manifest.json')
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    manifest.filesChanged = ['delete.txt']
    manifest.scope.scopeFiles = ['delete.txt']
    manifest.multiAgent.executionContext.changedFiles = ['delete.txt']
    manifest.statusInput.diff.filesChanged = ['delete.txt']
    manifest.statusInput.scopeViolations = []
    manifest.statusInput.filesReconcileIssues = []
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
    fs.writeFileSync(path.join(work, 'changes.diff'), [
      'diff --git a/delete.txt b/delete.txt',
      'deleted file mode 100644',
      'index 01310a4..0000000',
      '--- a/delete.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-remove me',
      '',
    ].join('\n'), 'utf8')

    const deletion = validateDeliveryArtifactsDetailed(work)
    if (deletion.errors.some(error => error.includes('filesChanged'))) {
      failures.push(`validator should parse deleted files from diff --git headers: ${deletion.errors.join('; ')}`)
    }

    const base = path.join(work, 'base')
    fs.mkdirSync(base)
    fs.writeFileSync(path.join(base, 'delete.txt'), 'remove me\n', 'utf8')
    const withBase = validateDeliveryArtifactsDetailed(work, { baseDir: base })
    if (withBase.errors.length) failures.push(`validator --base should accept applyable deletion diff: ${withBase.errors.join('; ')}`)

    fs.writeFileSync(path.join(work, 'changes.diff'), 'diff --git a/delete.txt b/delete.txt\nthis is not a patch\n', 'utf8')
    const bad = validateDeliveryArtifactsDetailed(work, { baseDir: base })
    if (!bad.errors.some(error => error.includes('git apply --check failed'))) {
      failures.push('validator --base should reject malformed diff via git apply --check')
    }
  } catch (e) {
    failures.push(`validate-delivery-artifacts test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runValidateDeliveryArtifactsTests()
  if (failures.length) {
    console.error('VALIDATE-DELIVERY-ARTIFACTS TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('VALIDATE-DELIVERY-ARTIFACTS TESTS PASSED')
}
