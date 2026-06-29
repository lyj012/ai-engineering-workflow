#!/usr/bin/env node
// bin/verify-tests — run a test/DONE command in a target directory and report its REAL exit code as the
// pass/fail fact. Cross-platform (argv via spawnSync, shell:false — no single-shell dependency).
//
// Closes the test/impl boundary hole on its determinism side: the deliver engine's verify step used to let
// a subagent JUDGE "did the tests pass?" and report a boolean (a lazy/buggy agent could just say true).
// Now the pass/fail is computed from the process exit code by fixed, unit-tested code: `passed === (exit 0)`.
// The agent's job shrinks to invoking this and relaying its JSON; the Codex adapter (no agent) calls it
// directly for true determinism. Note (honest limit): on the Claude side a subagent still transports the
// result, so this hardens — not cryptographically seals — the gate; the residual trust is only "the agent
// actually ran this script and pasted its real output", a far smaller, auditable surface than before.
// READ-ONLY on the source tree (only runs the given command; writes nothing itself).
//
// Usage: node bin/verify-tests.mjs --cwd <dir> [--tail 4000] [--timeout-ms 0] -- <cmd> [args...]
//   Everything after `--` is the command argv, run verbatim (no shell). Example:
//     node bin/verify-tests.mjs --cwd /tmp/copy -- bash tests/run_verify.sh --red
// Prints a JSON report; exit code mirrors the command's (0 = passed), 2 on bad usage.
import path from 'node:path'
import { spawnSync } from 'node:child_process'

function parseArgs(argv) {
  const a = { cwd: null, tail: 4000, timeoutMs: 0, cmd: [] }
  let i = 0
  for (; i < argv.length; i++) {
    if (argv[i] === '--') { a.cmd = argv.slice(i + 1); break }
    else if (argv[i] === '--cwd') a.cwd = argv[++i]
    else if (argv[i] === '--tail') a.tail = Number(argv[++i]) || 4000
    else if (argv[i] === '--timeout-ms') a.timeoutMs = Number(argv[++i]) || 0
  }
  return a
}

function main() {
  const a = parseArgs(process.argv.slice(2))
  if (!a.cmd.length) { process.stderr.write('usage: node bin/verify-tests.mjs --cwd <dir> [--tail N] [--timeout-ms N] -- <cmd> [args...]\n'); process.exit(2) }
  const cwd = a.cwd ? path.resolve(a.cwd) : process.cwd()

  const r = spawnSync(a.cmd[0], a.cmd.slice(1), {
    cwd,
    encoding: 'utf8',
    shell: false,
    timeout: a.timeoutMs > 0 ? a.timeoutMs : undefined,
    maxBuffer: 64 * 1024 * 1024,
  })

  const combined = (r.stdout || '') + (r.stderr || '')
  const timedOut = r.error && r.error.code === 'ETIMEDOUT'
  const spawnFailed = !!r.error && !timedOut          // e.g. command not found
  // status is null when killed by a signal (incl. timeout) or when spawn failed: treat as non-zero (not passed)
  const exitCode = typeof r.status === 'number' ? r.status : (spawnFailed ? 127 : 1)
  const passed = exitCode === 0 && !r.error

  const report = {
    ok: true,
    cwd,
    command: a.cmd.join(' '),
    exitCode,
    passed,
    timedOut: !!timedOut,
    spawnFailed,
    spawnError: r.error ? String(r.error.message || r.error) : null,
    outputTail: combined.slice(-a.tail),
  }
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  process.exit(passed ? 0 : (exitCode || 1))
}

try { main() } catch (e) {
  process.stderr.write(`verify-tests failed: ${String((e && e.message) || e)}\n`)
  process.exit(2)
}
