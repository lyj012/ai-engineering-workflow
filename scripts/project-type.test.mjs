// Unit tests for the canonical project-type classifier (core/project-type.mjs).
// Run directly: node scripts/project-type.test.mjs
// Also imported by scripts/self-check.mjs via runProjectTypeTests().
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyProjectType } from '../core/project-type.mjs'

// [name, input, expectedType, expectedIsWeb]
export const CASES = [
  ['vite + react -> web', { hasPackageJson: true, deps: ['react', 'react-dom', 'vite'], scripts: { dev: 'vite' } }, 'web', true],
  ['CRA react-scripts -> web', { hasPackageJson: true, deps: ['react', 'react-dom', 'react-scripts'], scripts: { start: 'react-scripts start' } }, 'web', true],
  ['vue + vite -> web', { hasPackageJson: true, deps: ['vue', 'vite'], scripts: { dev: 'vite' } }, 'web', true],
  ['next -> fullstack', { hasPackageJson: true, deps: ['next', 'react', 'react-dom'], scripts: { dev: 'next dev' } }, 'fullstack', true],
  ['react frontend + express server -> fullstack', { hasPackageJson: true, deps: ['react', 'express'], scripts: { dev: 'concurrently ...' } }, 'fullstack', true],
  ['static index.html, no package.json -> web', { hasPackageJson: false, deps: [], scripts: {}, hasIndexHtml: true }, 'web', true],
  ['express-only API -> non-web', { hasPackageJson: true, deps: ['express'], scripts: { start: 'node server.js' } }, 'non-web', false],
  ['nest API -> non-web', { hasPackageJson: true, deps: ['@nestjs/core'], scripts: { start: 'nest start' } }, 'non-web', false],
  ['shell project (no package.json, no html) -> non-web', { hasPackageJson: false, deps: [], scripts: {} }, 'non-web', false],
  ['python project (no package.json) -> non-web', { hasPackageJson: false, deps: [], scripts: {}, hasServerEntry: true }, 'non-web', false],
  ['package.json but only a lib (no frontend/server) -> unknown', { hasPackageJson: true, deps: ['lodash'], scripts: { build: 'tsc' } }, 'unknown', false],
  ['empty input -> non-web', {}, 'non-web', false],
]

export function runProjectTypeTests() {
  const failures = []
  for (const [name, input, expectedType, expectedIsWeb] of CASES) {
    let r
    try { r = classifyProjectType(input) } catch (e) { failures.push(`project-type "${name}": threw ${e.message}`); continue }
    if (r.type !== expectedType) failures.push(`project-type "${name}": expected type ${expectedType}, got ${r.type}`)
    if (r.isWeb !== expectedIsWeb) failures.push(`project-type "${name}": expected isWeb ${expectedIsWeb}, got ${r.isWeb}`)
    // a web project must not silently lose its start command when scripts provide one
    if (r.isWeb && (input.scripts && (input.scripts.dev || input.scripts.start || input.scripts.serve)) && !r.startCommand) {
      failures.push(`project-type "${name}": web project lost startCommand`)
    }
    // non-web must never carry a startCommand/baseUrlGuess (browser verify does not apply)
    if (!r.isWeb && (r.startCommand || r.baseUrlGuess)) failures.push(`project-type "${name}": non-web should not carry startCommand/baseUrlGuess`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runProjectTypeTests()
  if (failures.length) {
    console.error('PROJECT-TYPE TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log(`PROJECT-TYPE TESTS PASSED (${CASES.length} cases)`)
}
