// Canonical git-remote-URL credential handling — pure, deterministic, unit-tested.
//
// Why this lives in core/: the Claude Workflow script surface cannot import modules, so
// .claude/workflows/publish-delivery.js keeps an INLINE copy of these functions between the
// MASK-REMOTE-URL markers; scripts/self-check.mjs behaviour-diffs the inline copy against this
// canonical one over fixed vectors so the two cannot drift. The Codex adapter calls it via bin/core.
//
// The publish engine's design rule is "the script body carries no credentials; push relies on the ambient
// SSH / credential helper" — so a remote URL with embedded userinfo (e.g. https://x-access-token:TOKEN@host)
// must never be transported into prompts / logs / final-delivery.json / reports. maskRemoteUrl redacts the
// userinfo for any http(s) URL; hasEmbeddedCredentials flags such a URL so the engine can refuse it outright.
// SSH (git@host:path scp-form, ssh://git@host) and local paths are not credential-in-URL forms and pass through.

export function maskRemoteUrl(u) {
  if (!u || typeof u !== 'string') return u
  return u.replace(/^(https?:\/\/)([^/@]+)@/i, '$1***@')
}

export function hasEmbeddedCredentials(u) {
  if (!u || typeof u !== 'string') return false
  const m = /^https?:\/\/([^/@]+)@/i.exec(u)
  return !!m && m[1] !== '***'   // '***' is the redaction sentinel, not a real credential (mask is idempotent)
}
