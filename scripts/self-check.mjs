import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

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

function validate(value, schema, label) {
  const localErrors = []
  function fail(pathName, message) { localErrors.push(`${label}${pathName}: ${message}`) }
  function check(v, s, pathName) {
    if (s.enum && !s.enum.includes(v)) fail(pathName, `expected one of ${s.enum.join(', ')}`)
    if (s.type) {
      const typeOk =
        s.type === 'array' ? Array.isArray(v) :
        s.type === 'integer' ? Number.isInteger(v) :
        s.type === 'number' ? typeof v === 'number' && Number.isFinite(v) :
        s.type === 'object' ? !!v && typeof v === 'object' && !Array.isArray(v) :
        typeof v === s.type
      if (!typeOk) { fail(pathName, `expected ${s.type}`); return }
    }
    if (s.type === 'object') {
      const keys = Object.keys(v)
      for (const req of s.required || []) if (!keys.includes(req)) fail(`${pathName}.${req}`, 'missing required property')
      if (s.additionalProperties === false) {
        for (const key of keys) if (!s.properties || !Object.hasOwn(s.properties, key)) fail(`${pathName}.${key}`, 'unexpected property')
      }
      for (const [key, child] of Object.entries(s.properties || {})) if (Object.hasOwn(v, key)) check(v[key], child, `${pathName}.${key}`)
    }
    if (s.type === 'array') {
      v.forEach((item, index) => check(item, s.items || {}, `${pathName}[${index}]`))
    }
  }
  check(value, schema, '')
  return localErrors
}

const evidenceSchema = {
  type: 'object', additionalProperties: false,
  properties: { path: { type: 'string' }, symbol: { type: 'string' }, lineRange: { type: 'string' }, observation: { type: 'string' } },
  required: ['path', 'lineRange', 'observation'],
}
const riskItemSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    id: { type: 'string' }, area: { type: 'string' }, severity: { type: 'string', enum: ['high', 'medium', 'low'] },
    description: { type: 'string' }, impact: { type: 'string' }, mitigation: { type: 'string' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] }, evidence: { type: 'array', items: evidenceSchema },
  },
  required: ['id', 'area', 'severity', 'description', 'impact', 'mitigation', 'confidence', 'evidence'],
}
const requirementSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    goal: { type: 'string' }, actors: { type: 'array', items: { type: 'string' } },
    normalFlow: { type: 'array', items: { type: 'string' } }, exceptionFlow: { type: 'array', items: { type: 'string' } },
    coreOutcome: { type: 'string' }, nonGoals: { type: 'array', items: { type: 'string' } },
    ambiguities: { type: 'array', items: { type: 'string' } }, openQuestions: { type: 'array', items: { type: 'string' } },
    successCriteria: { type: 'array', items: { type: 'string' } }, searchHints: { type: 'array', items: { type: 'string' } },
  },
  required: ['goal', 'actors', 'normalFlow', 'exceptionFlow', 'coreOutcome', 'nonGoals', 'ambiguities', 'openQuestions', 'successCriteria', 'searchHints'],
}
const planSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    approach: { type: 'string' },
    reuse: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { target: { type: 'string' }, what: { type: 'string' } }, required: ['target', 'what'] } },
    modify: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, change: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'change', 'why'] } },
    add: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, what: { type: 'string' }, why: { type: 'string' } }, required: ['path', 'what', 'why'] } },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { order: { type: 'number' }, action: { type: 'string' }, touches: { type: 'array', items: { type: 'string' } } }, required: ['order', 'action', 'touches'] } },
    affected: { type: 'object', additionalProperties: false, properties: {
      modules: { type: 'array', items: { type: 'string' } }, files: { type: 'array', items: { type: 'string' } },
      interfaces: { type: 'array', items: { type: 'string' } }, data: { type: 'array', items: { type: 'string' } },
      state: { type: 'array', items: { type: 'string' } }, permissions: { type: 'array', items: { type: 'string' } },
      frontend: { type: 'array', items: { type: 'string' } }, backend: { type: 'array', items: { type: 'string' } },
    }, required: ['modules', 'files', 'interfaces', 'data', 'state', 'permissions', 'frontend', 'backend'] },
    architectureFit: { type: 'string' }, assumptions: { type: 'array', items: { type: 'string' } },
    alternatives: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { option: { type: 'string' }, whyNot: { type: 'string' } }, required: ['option', 'whyNot'] } },
  },
  required: ['approach', 'reuse', 'modify', 'add', 'steps', 'affected', 'architectureFit', 'assumptions', 'alternatives'],
}
const testPlanSchema = {
  type: 'object', additionalProperties: false,
  properties: {
    testStrategy: { type: 'string' },
    cases: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string' }, priority: { type: 'string', enum: ['P0', 'P1', 'P2'] }, riskIds: { type: 'array', items: { type: 'string' } },
      scenario: { type: 'string' }, steps: { type: 'array', items: { type: 'string' } }, expected: { type: 'string' }, verificationType: { type: 'string' },
    }, required: ['id', 'priority', 'riskIds', 'scenario', 'steps', 'expected', 'verificationType'] } },
    acceptanceCriteria: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { id: { type: 'string' }, criterion: { type: 'string' }, linkedTo: { type: 'string' } }, required: ['id', 'criterion', 'linkedTo'] } },
    coverageGaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['testStrategy', 'cases', 'acceptanceCriteria', 'coverageGaps'],
}
const risksSchema = {
  type: 'object', additionalProperties: false,
  properties: { risks: { type: 'array', items: riskItemSchema }, rollback: { type: 'array', items: { type: 'string' } }, openConcerns: { type: 'array', items: { type: 'string' } } },
  required: ['risks', 'rollback', 'openConcerns'],
}

for (const [file, schema] of [
  ['examples/artifacts/plan-ready/requirement.json', requirementSchema],
  ['examples/artifacts/plan-ready/plan.json', planSchema],
  ['examples/artifacts/plan-ready/test-plan.json', testPlanSchema],
  ['examples/artifacts/plan-ready/risks.json', risksSchema],
]) {
  errors.push(...validate(JSON.parse(read(file)), schema, file))
}

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
