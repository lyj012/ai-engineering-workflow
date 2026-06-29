// Tests for bin/safe-rm.mjs + the rm-guards wired into bin/sandbox-prepare.mjs and bin/diff-from-sandbox.mjs.
// All destructive cases run inside mkdtemp sandboxes with sentinel dirs — never a real repo, never credentials.
// Run directly: node scripts/safe-rm.test.mjs ; also imported by scripts/self-check.mjs.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertSafeRemovable } from '../bin/safe-rm.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const sandboxPrepare = path.join(here, '..', 'bin', 'sandbox-prepare.mjs')
const diffFromSandbox = path.join(here, '..', 'bin', 'diff-from-sandbox.mjs')

export function runSafeRmTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'saferm-'))
    const src = path.join(work, 'src')
    fs.mkdirSync(path.join(src, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(src, 'SENTINEL.txt'), 'do not delete me\n')

    // ---- unit: assertSafeRemovable ----
    const expectUnsafe = (target, prot, name) => {
      const r = assertSafeRemovable(target, prot)
      if (r.ok !== false) failures.push(`assertSafeRemovable should REFUSE ${name}: ${JSON.stringify(r)}`)
    }
    const expectSafe = (target, prot, name) => {
      const r = assertSafeRemovable(target, prot)
      if (r.ok !== true) failures.push(`assertSafeRemovable should ALLOW ${name}: ${JSON.stringify(r)}`)
    }
    expectUnsafe(src, [src], 'target === protected (equal)')
    expectUnsafe(work, [src], 'target is ancestor of protected')           // work contains src
    expectUnsafe(path.join(src, 'nested'), [src], 'target inside protected')
    expectUnsafe(path.parse(src).root, [src], 'filesystem root')
    expectUnsafe(os.homedir(), [src], 'home directory')
    expectSafe(path.join(work, 'unrelated'), [src], 'unrelated sibling dir')
    // symlink overlap: a link whose realpath is src must be refused
    let linkMade = false
    try {
      const link = path.join(work, 'link-to-src')
      fs.symlinkSync(src, link)
      linkMade = true
      expectUnsafe(link, [src], 'symlink resolving onto protected')
    } catch { /* symlink may be unsupported; skip */ }

    // ---- integration: sandbox-prepare refuses dangerous --dest, leaves source intact ----
    const same = spawnSync('node', [sandboxPrepare, '--src', src, '--dest', src], { encoding: 'utf8' })
    if (same.status !== 2) failures.push(`sandbox-prepare --src X --dest X should exit 2, got ${same.status}`)
    if (!fs.existsSync(path.join(src, 'SENTINEL.txt'))) failures.push('sandbox-prepare deleted the source on --src===--dest (CATASTROPHIC)')

    const ancestor = spawnSync('node', [sandboxPrepare, '--src', src, '--dest', work], { encoding: 'utf8' })
    if (ancestor.status !== 2) failures.push(`sandbox-prepare --dest=ancestor should exit 2, got ${ancestor.status}`)
    if (!fs.existsSync(path.join(src, 'SENTINEL.txt'))) failures.push('sandbox-prepare deleted source via ancestor --dest (CATASTROPHIC)')

    // normal sandbox-prepare (unrelated dest) still works
    const ok = spawnSync('node', [sandboxPrepare, '--src', src, '--dest', path.join(work, 'good-sandbox')], { encoding: 'utf8' })
    if (ok.status !== 0) failures.push(`normal sandbox-prepare regressed: exit ${ok.status}: ${ok.stderr || ok.stdout}`)
    if (!fs.existsSync(path.join(work, 'good-sandbox', 'SENTINEL.txt'))) failures.push('normal sandbox-prepare did not copy source')

    // ---- integration: diff-from-sandbox refuses --work overlapping base, leaves base intact ----
    const base = path.join(work, 'base'); const sb = path.join(work, 'sb')
    fs.cpSync(src, base, { recursive: true }); fs.cpSync(src, sb, { recursive: true })
    const badWork = spawnSync('node', [diffFromSandbox, '--base', base, '--sandbox', sb, '--out', path.join(work, 'c.diff'), '--work', base], { encoding: 'utf8' })
    if (badWork.status === 0) failures.push('diff-from-sandbox --work=base should be refused (non-zero exit), got 0')
    if (!fs.existsSync(path.join(base, 'SENTINEL.txt'))) failures.push('diff-from-sandbox cleared base via --work=base (CATASTROPHIC)')
  } catch (e) {
    failures.push(`safe-rm test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runSafeRmTests()
  if (failures.length) {
    console.error('SAFE-RM TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('SAFE-RM TESTS PASSED')
}
