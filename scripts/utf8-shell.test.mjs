// Guard shell materialization against UTF-8 BOM: shebang must start at byte 0 and Git Bash must run it.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

function findBash() {
  const candidates = process.platform === 'win32'
    ? ['D:/Git/bin/bash.exe', 'D:/Git/usr/bin/bash.exe', 'C:/Program Files/Git/bin/bash.exe', 'bash']
    : ['bash']
  for (const candidate of candidates) {
    const r = spawnSync(candidate, ['--version'], { encoding: 'utf8' })
    if (r.status === 0) return candidate
  }
  return null
}

export function runUtf8ShellTests() {
  const failures = []
  let work
  try {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'utf8sh-'))
    const script = path.join(work, 'generated.sh')
    fs.writeFileSync(script, '#!/usr/bin/env bash\nset -euo pipefail\necho UTF8_OK\n', 'utf8')
    const bytes = fs.readFileSync(script)
    if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) failures.push('generated shell script starts with UTF-8 BOM')
    if (bytes[0] !== 0x23 || bytes[1] !== 0x21) failures.push('shebang is not at byte 0')
    const bash = findBash()
    if (!bash) failures.push('bash is unavailable for generated shell script execution')
    else {
      const r = spawnSync(bash, [script], { encoding: 'utf8' })
      if (r.status !== 0 || !r.stdout.includes('UTF8_OK')) failures.push(`generated shell script did not run cleanly: ${r.stderr || r.stdout}`)
      if ((r.stderr || '').includes('/usr/bin/env: No such file or directory')) failures.push('generated shell script hit BOM-style env failure')
    }
  } catch (e) {
    failures.push(`utf8-shell test threw: ${e.message}`)
  } finally {
    if (work) try { fs.rmSync(work, { recursive: true, force: true }) } catch { /* ignore */ }
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runUtf8ShellTests()
  if (failures.length) {
    console.error('UTF8-SHELL TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('UTF8-SHELL TESTS PASSED')
}
