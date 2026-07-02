#!/usr/bin/env node
// Verify delivery-manifest.json from disk and, optionally, atomically mark persistVerification.ok=true.
// This makes manifest persistence a filesystem fact instead of a model-judged boolean.
import fs from 'node:fs'
import path from 'node:path'

function parseArgs(argv) {
  const a = {
    dir: null,
    finalStatus: null,
    filesChangedJson: null,
    diffApplyCheckPassed: null,
    markOk: false,
  }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dir') a.dir = argv[++i]
    else if (argv[i] === '--final-status') a.finalStatus = argv[++i]
    else if (argv[i] === '--files-changed-json') a.filesChangedJson = argv[++i]
    else if (argv[i] === '--diff-apply-check-passed') a.diffApplyCheckPassed = argv[++i] === 'true'
    else if (argv[i] === '--mark-ok') a.markOk = true
  }
  return a
}

function sameArray(a, b) {
  return Array.isArray(a) && Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index])
}

function writeAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.dir || !a.finalStatus || !a.filesChangedJson || a.diffApplyCheckPassed === null) {
    process.stderr.write('usage: node bin/verify-delivery-persist.mjs --dir <delivery-dir> --final-status <status> --files-changed-json <json-array> --diff-apply-check-passed <true|false> [--mark-ok]\n')
    process.exit(2)
  }

  const dir = path.resolve(a.dir)
  const manifestPath = path.join(dir, 'delivery-manifest.json')
  let expectedFiles
  try { expectedFiles = JSON.parse(a.filesChangedJson) } catch (e) {
    process.stderr.write(`invalid --files-changed-json: ${e.message}\n`)
    process.exit(2)
  }

  const report = {
    ok: false,
    manifestPath,
    exists: false,
    parseOk: false,
    readbackOk: false,
    diskFinalStatus: null,
    contentConsistent: false,
    persistOkOnDisk: false,
    note: '',
  }

  if (!fs.existsSync(manifestPath) || fs.statSync(manifestPath).size === 0) {
    report.note = 'delivery-manifest.json missing or empty'
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exit(1)
  }
  report.exists = true

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    report.parseOk = true
  } catch (e) {
    report.note = `delivery-manifest.json is not parseable JSON: ${e.message}`
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    process.exit(1)
  }

  report.diskFinalStatus = manifest.finalStatus || null
  report.contentConsistent = manifest.finalStatus === a.finalStatus &&
    sameArray(manifest.filesChanged, expectedFiles) &&
    manifest.diffApplyCheckPassed === a.diffApplyCheckPassed
  report.readbackOk = report.parseOk && report.contentConsistent

  if (report.readbackOk && a.markOk) {
    manifest.persistVerification = {
      ...(manifest.persistVerification || {}),
      ok: true,
      readbackOk: true,
      diskFinalStatus: manifest.finalStatus,
      contentConsistent: true,
    }
    writeAtomic(manifestPath, manifest)
    const confirmed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    report.persistOkOnDisk = confirmed.persistVerification && confirmed.persistVerification.ok === true
  } else {
    report.persistOkOnDisk = manifest.persistVerification && manifest.persistVerification.ok === true
  }

  report.ok = report.readbackOk && (a.markOk ? report.persistOkOnDisk : true)
  report.note = report.ok ? 'delivery manifest readback verified' : 'delivery manifest readback did not match expected content'
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(report.ok ? 0 : 1)
}

try { main() } catch (e) {
  process.stderr.write(`verify-delivery-persist failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
