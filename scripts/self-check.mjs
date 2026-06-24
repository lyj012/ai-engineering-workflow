import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => fs.readFileSync(path.join(root, p), 'utf8')
const exists = p => fs.existsSync(path.join(root, p))
const errors = []
const warn = []
let tracked = ''
try {
  tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
} catch {
  warn.push('git executable is not available to Node; skipping tracked-file checks')
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
  'examples/artifacts/delivery-success/delivery-report.md',
  'vendor/zhuliming-templates/ATTRIBUTION.md',
]

for (const file of required) if (!exists(file)) errors.push(`missing required file: ${file}`)

const forbiddenPatterns = [
  '/data/workspace/',
  'liuyuanjian',
  '../liu/',
  '../CLAUDE.md',
]

for (const file of ['README.md', 'CLAUDE.md', 'docs/01-workflow-overview.md', 'docs/06-verification-and-retry.md', 'docs/09-existing-skill-integration.md', '.claude/workflows/plan-from-requirement.js', '.claude/workflows/deliver-from-plan.js', '.claude/workflows/wf-methodology-research.js', '.claude/workflows/wf-docs-generation.js', '.claude/skills/workflow-designer/SKILL.md', '.claude/skills/workflow-designer/references/script-patterns.md', 'vendor/zhuliming-templates/ATTRIBUTION.md', 'vendor/zhuliming-templates/build-prompt.md', 'vendor/zhuliming-templates/build-workflow-js.md']) {
  if (!exists(file)) continue
  const text = read(file)
  for (const pattern of forbiddenPatterns) {
    if (text.includes(pattern)) errors.push(`${file} still contains forbidden pattern: ${pattern}`)
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
}

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

const examples = [
  'examples/minimal-target/app.sh',
  'examples/minimal-target/test.sh',
  'examples/artifacts/plan-ready/final-plan.md',
  'examples/artifacts/delivery-success/delivery-report.md',
]
for (const file of examples) if (!exists(file)) errors.push(`missing example file: ${file}`)

const diffCheck = read('vendor/zhuliming-templates/ATTRIBUTION.md')
if (!diffCheck.includes('朱立明')) warn.push('attribution file does not mention author name')

const ciPath = '.github/workflows/ci.yml'
if (exists(ciPath)) {
  const ci = read(ciPath)
  if (!ci.includes('node scripts/self-check.mjs')) errors.push('CI workflow does not run self-check')
}

const text = tracked || ''
if (text.includes('AGENTS.md')) warn.push('git ls-files currently includes AGENTS.md')

if (errors.length) {
  console.error('SELF-CHECK FAILED')
  for (const e of errors) console.error(`- ${e}`)
  process.exit(1)
}

console.log('SELF-CHECK PASSED')
for (const w of warn) console.log(`WARN: ${w}`)
