// Canonical post-push remote-verification recompute — pure, deterministic, unit-tested.
//
// Why this lives in core/: the Claude Workflow script surface cannot import modules, so
// .claude/workflows/publish-delivery.js keeps an INLINE copy of these functions between the
// VERIFY-REMOTE-PUBLISH markers; scripts/self-check.mjs behaviour-diffs the inline copy against this
// canonical one over fixed vectors so the two cannot drift. The Codex adapter calls it via bin/core.
//
// The publish RemoteVerify subagent runs git (ls-remote / show) and returns BOTH raw materials (remoteSha,
// remoteFiles, workTreeStatus) AND its own pass/fail booleans. Trusting the agent booleans means one
// hallucination publishes unverified. These functions re-derive the hard-gate booleans deterministically
// from the raw materials, so the final gate is the JS recompute AND the agent's report (either says
// not-verified -> not verified). Pure string/array logic; no git, no IO.

// forbidden file patterns — must never be committed/pushed (substring-style, conservative over-block)
export const FORBIDDEN_FILE_PATTERNS = [
  /(^|\/)\.env(\.|$)/i, /\.(key|pem|p12|pfx|keystore|jks)$/i, /(^|\/)id_rsa/i, /(^|\/)id_ed25519/i,
  /credential/i, /secret/i, /(^|\/)\.npmrc$/i, /(^|\/)\.pypirc$/i,
  /\.claude\/settings\.local\.json$/, /(^|\/)AGENTS\.md$/,
]

export function findForbiddenFiles(files) {
  return (Array.isArray(files) ? files : []).map(String).filter(f => FORBIDDEN_FILE_PATTERNS.some(re => re.test(f)))
}

function setEqual(a, b) {
  const A = [...new Set((Array.isArray(a) ? a : []).map(String))].sort()
  const B = [...new Set((Array.isArray(b) ? b : []).map(String))].sort()
  return A.length === B.length && A.every((x, idx) => x === B[idx])
}

// input = { commitSha, manifestFilesChanged, remoteSha, remoteFiles, committedFiles, workTreeStatus? }
// returns the script-recomputed hard-gate booleans + which forbidden files were found.
export function verifyRemotePublish(input) {
  const i = input || {}
  const branchShaMatches = !!(i.commitSha && i.remoteSha && String(i.remoteSha).trim() === String(i.commitSha).trim())
  const committedFilesMatch = setEqual(i.remoteFiles, i.manifestFilesChanged)
  const forbiddenFound = findForbiddenFiles([...(Array.isArray(i.remoteFiles) ? i.remoteFiles : []), ...(Array.isArray(i.committedFiles) ? i.committedFiles : [])])
  const noForbiddenFiles = forbiddenFound.length === 0
  // workTreeClean: recompute from porcelain text when available (empty = clean); else undefined (caller ANDs agent)
  const workTreeClean = typeof i.workTreeStatus === 'string' ? i.workTreeStatus.trim() === '' : undefined
  return { branchShaMatches, committedFilesMatch, noForbiddenFiles, workTreeClean, forbiddenFound }
}
