import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { validatePlanArtifacts } from './validate-plan-artifacts.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const errors = []
const warn = []

const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const exists = p => fs.existsSync(path.join(root, p))
const rel = p => path.relative(root, p).replaceAll(path.sep, '/')

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: 'utf8',
    shell: false,
  })
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error,
  }
}

function git(args, options = {}) {
  let result = run('git', args, options)
  if (result.error && process.platform === 'win32') {
    result = run('cmd.exe', ['/c', 'git', ...args], options)
  }
  return result
}

function allRepoFiles(dir = root, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const r = rel(full)
    if (entry.isDirectory()) {
      if (entry.name === '.git') continue
      if (/^evidence\/(runs|plans|deliveries)\//.test(`${r}/`)) continue
      out.push(...allRepoFiles(full, []))
    } else {
      out.push(r)
    }
  }
  return out
}

let trackedFiles = []
const ls = git(['ls-files'])
if (ls.ok) {
  trackedFiles = ls.stdout.split(/\r?\n/).filter(Boolean)
} else {
  warn.push('git ls-files is unavailable; scanning repository files instead of tracked files')
  trackedFiles = allRepoFiles()
}

const required = [
  'README.md',
  'CLAUDE.md',
  'LICENSE',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  'scripts/self-check.mjs',
  'examples/minimal-target/app.sh',
  'examples/minimal-target/README.md',
  'examples/requirements/simple-greeting.md',
  'examples/artifacts/plan-ready/final-plan.md',
  'examples/artifacts/plan-ready/requirement.json',
  'examples/artifacts/plan-ready/risks.json',
  'examples/artifacts/delivery-success/delivery-report.md',
  'vendor/zhuliming-templates/ATTRIBUTION.md',
]

for (const file of required) if (!exists(file)) errors.push(`missing required file: ${file}`)

const forbiddenPathPatterns = [
  /(^|\/)AGENTS\.md$/,
  /settings\.local\.json$/,
  /(^|\/)\.env(\.|$)/,
  /\.(pem|key|p12|pfx)$/i,
]

const forbiddenContentPatterns = [
  /\/data\/workspace\//,
  /liuyuanjian/,
  /\.\.\/liu\//,
  /\.\.\/CLAUDE\.md/,
]

const secretContentPatterns = [
  /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk_live_[A-Za-z0-9]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
]

for (const file of trackedFiles) {
  for (const pattern of forbiddenPathPatterns) {
    if (pattern.test(file)) errors.push(`forbidden tracked path: ${file}`)
  }

  const full = path.join(root, file)
  if (!fs.existsSync(full) || fs.statSync(full).size > 1024 * 1024) continue
  let text = ''
  try { text = fs.readFileSync(full, 'utf8') } catch { continue }
  for (const pattern of forbiddenContentPatterns) {
    if (pattern.test(text) && file !== 'scripts/self-check.mjs') errors.push(`${file} contains forbidden local reference: ${pattern}`)
  }
  for (const pattern of secretContentPatterns) {
    if (pattern.test(text)) errors.push(`${file} appears to contain a secret: ${pattern}`)
  }
}

const workflowFiles = [
  '.claude/workflows/plan-from-requirement.js',
  '.claude/workflows/deliver-from-plan.js',
  '.claude/workflows/analyze-repo.js',
  '.claude/workflows/wf-methodology-research.js',
  '.claude/workflows/wf-docs-generation.js',
]

for (const file of workflowFiles) {
  if (!exists(file)) continue
  const text = read(file)
  if (!text.includes('export const meta')) errors.push(`${file} missing export const meta`)
  if (/Date\.now\(\)|Math\.random\(\)|new Date\(\)/.test(text)) errors.push(`${file} contains banned time/random API`)
  const transformed = text.replace('export const meta', 'const meta')
  try {
    new Function(`return (async function workflowSyntaxCheck(){\n${transformed}\n});`)
  } catch (error) {
    errors.push(`${file} has invalid Workflow JS syntax: ${error.message}`)
  }
}

errors.push(...validatePlanArtifacts(path.join(root, 'examples/artifacts/plan-ready')))

for (const file of ['app.sh', 'test.sh']) {
  const plan = JSON.parse(read('examples/artifacts/plan-ready/plan.json'))
  if (!plan.affected.files.includes(file)) errors.push(`plan.json affected.files missing ${file}`)
}

const deliveryManifest = JSON.parse(read('examples/artifacts/delivery-success/delivery-manifest.json'))
if (deliveryManifest.diffApplyCheckPassed !== true) errors.push('delivery manifest must record diffApplyCheckPassed=true')
for (const file of deliveryManifest.filesChanged || []) {
  if (file.startsWith('examples/') || path.isAbsolute(file)) errors.push(`delivery filesChanged must be target-root-relative: ${file}`)
}

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['D:/Git/bin/bash.exe', 'D:/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe', 'bash']
    : ['bash']
  for (const candidate of candidates) {
    const result = run(candidate, ['--version'])
    if (result.ok) return candidate
  }
  return null
}

const bash = findBash()
if (!bash) {
  errors.push('bash is required for example test execution')
} else {
  const test = run(bash, ['-lc', 'cd examples/minimal-target && bash ./test.sh'])
  if (!test.ok) errors.push(`example test failed: ${test.stderr || test.stdout}`)
}

const applyCheck = git(['apply', '--check', path.resolve(root, 'examples/artifacts/delivery-success/changes.diff')], {
  cwd: path.join(root, 'examples/minimal-target'),
})
if (!applyCheck.ok) errors.push(`example diff is not applicable from target root: ${applyCheck.stderr || applyCheck.stdout}`)

const readme = read('README.md')
const readmeMust = [
  'Claude Code Dynamic Workflows',
  'plan-from-requirement',
  'deliver-from-plan',
  'Workflow({ scriptPath:',
  'examples/minimal-target',
  'node scripts/self-check.mjs',
]
for (const needle of readmeMust) if (!readme.includes(needle)) errors.push(`README.md missing expected content: ${needle}`)

const ciPaths = ['.github/workflows/ci.yml', '.github/workflows/ci.yaml']
for (const ciPath of ciPaths) {
  if (!exists(ciPath)) continue
  const ci = read(ciPath)
  if (!ci.includes('node scripts/self-check.mjs')) errors.push(`${ciPath} does not run self-check`)
}

if (errors.length) {
  console.error('SELF-CHECK FAILED')
  for (const e of errors) console.error(`- ${e}`)
  process.exit(1)
}

console.log('SELF-CHECK PASSED')
console.log(`tracked files scanned: ${trackedFiles.length}`)
console.log('checks: paths/secrets, Workflow JS syntax, example schemas, example test, diff apply')
for (const w of warn) console.log(`WARN: ${w}`)
