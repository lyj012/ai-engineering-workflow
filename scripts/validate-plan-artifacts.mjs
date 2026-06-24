import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = path.join(root, 'core/schemas/plan-artifacts.schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))

function resolveRef(ref) {
  if (!ref.startsWith('#/$defs/')) throw new Error(`unsupported schema ref: ${ref}`)
  const key = ref.slice('#/$defs/'.length)
  const def = schema.$defs && schema.$defs[key]
  if (!def) throw new Error(`missing schema definition: ${ref}`)
  return def
}

export function validate(value, schemaNode, label) {
  const errors = []
  function fail(pathName, message) {
    errors.push(`${label}${pathName}: ${message}`)
  }
  function check(v, s, pathName) {
    if (s.$ref) s = resolveRef(s.$ref)
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
  check(value, schemaNode, '')
  return errors
}

export function validatePlanArtifacts(planDir) {
  const artifactDir = path.resolve(planDir)
  const readJson = file => JSON.parse(fs.readFileSync(path.join(artifactDir, file), 'utf8'))
  const artifacts = {
    requirement: readJson('requirement.json'),
    plan: readJson('plan.json'),
    testPlan: readJson('test-plan.json'),
    risks: readJson('risks.json'),
  }
  return validate(artifacts, schema, artifactDir)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planDir = process.argv[2]
  if (!planDir) {
    console.error('usage: node scripts/validate-plan-artifacts.mjs <plan-artifact-dir>')
    process.exit(2)
  }
  const errors = validatePlanArtifacts(planDir)
  if (errors.length) {
    console.error('PLAN ARTIFACT VALIDATION FAILED')
    for (const error of errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log('PLAN ARTIFACT VALIDATION PASSED')
}
