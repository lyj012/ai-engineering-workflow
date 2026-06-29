// bin/safe-rm — guard a recursive-delete target against catastrophic paths before any rm -rf.
//
// Shared by bin/sandbox-prepare.mjs and bin/diff-from-sandbox.mjs: those scripts rm -rf a dest/work dir to
// start clean. Without this guard a misinvocation — `--src X --dest X`, `--dest` an ancestor of src, a
// `--work` overlapping base/sandbox, or a symlink resolving onto the source — would irreversibly delete the
// source / an ancestor / root BEFORE the copy, breaking the scripts' "READ-ONLY on the source" promise.
// assertSafeRemovable refuses such targets. Pure path logic + best-effort realpath; deletes nothing itself.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// resolve + realpath the longest existing prefix (then re-append the non-existing tail), so a symlink in the
// path cannot hide that the target actually resolves onto a protected location.
function canonical(p) {
  const resolved = path.resolve(String(p))
  let dir = resolved
  const tail = []
  while (!fs.existsSync(dir)) {
    const parent = path.dirname(dir)
    if (parent === dir) break
    tail.unshift(path.basename(dir))
    dir = parent
  }
  try { dir = fs.realpathSync.native(dir) } catch { /* keep resolved prefix */ }
  return tail.length ? path.join(dir, ...tail) : dir
}

function isRootish(p) {
  if (p === path.parse(p).root) return true        // filesystem / drive root
  if (p === os.homedir()) return true              // user home
  return false
}

// two canonical paths overlap if equal, or one contains the other (path-segment-wise)
function overlaps(a, b) {
  if (a === b) return true
  const aSep = a.endsWith(path.sep) ? a : a + path.sep
  const bSep = b.endsWith(path.sep) ? b : b + path.sep
  return b.startsWith(aSep) || a.startsWith(bSep)
}

export function assertSafeRemovable(target, protectedPaths = []) {
  const t = canonical(target)
  if (isRootish(t)) return { ok: false, reason: `refuse to recursively delete root/home path: ${t}` }
  for (const p of (Array.isArray(protectedPaths) ? protectedPaths : [protectedPaths])) {
    if (!p) continue
    const c = canonical(p)
    if (overlaps(t, c)) return { ok: false, reason: `delete target "${t}" overlaps protected path "${c}"` }
  }
  return { ok: true, reason: '' }
}

// CLI helper for the bin scripts: print to stderr and exit(2) if unsafe, else return.
export function guardOrExit(target, protectedPaths, label = 'delete') {
  const r = assertSafeRemovable(target, protectedPaths)
  if (!r.ok) { process.stderr.write(`${label} refused: ${r.reason}\n`); process.exit(2) }
}
