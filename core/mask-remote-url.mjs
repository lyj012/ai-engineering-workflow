// Canonical git-remote-URL credential handling — pure, deterministic, unit-tested.
//
// Why this lives in core/: the Claude Workflow script surface cannot import modules, so
// .claude/workflows/publish-delivery.js keeps an INLINE copy of these functions between the
// MASK-REMOTE-URL markers; scripts/self-check.mjs behaviour-diffs the inline copy against this
// canonical one over fixed vectors so the two cannot drift. The Codex adapter calls it via bin/core,
// and bin/inspect-remote.mjs uses inspectRemoteUrl so a raw URL read from a repo never leaves the CLI.
//
// Credential forms covered (R2-2):
//   - http(s) with ANY userinfo (PAT-as-username `https://TOKEN@` or `https://user:pass@`) -> credential
//   - any scheme `scheme://user:password@host` (incl. ssh://) -> the password is a credential
//   - query tokens `?access_token=` / `?private_token=` / `?oauth_token=` / `?token=` -> credential
// NOT credentials (key auth / no secret-in-URL): scp-form `git@host:path`, `ssh://git@host` (username only),
// plain `https://host`, local paths. maskRemoteUrl redacts the secret; hasEmbeddedCredentials flags it.

function maskRemoteUrl(u) {
  if (!u || typeof u !== 'string') return u
  let out = u.replace(/^([a-z][a-z0-9+.-]*:\/\/)([^/@]+)@/i, (m, scheme, userinfo) => {
    if (userinfo === '***') return m
    if (/^https?:\/\//i.test(scheme)) return scheme + '***@'   // any http(s) userinfo is a credential
    const ci = userinfo.indexOf(':')
    if (ci >= 0) return scheme + userinfo.slice(0, ci) + ':***@'   // user:pass -> user:*** (keeps username)
    return m   // username-only (e.g. ssh://git@) — key auth, no secret
  })
  out = out.replace(/([?&](?:access_token|private_token|oauth_token|token|x-oauth-basic)=)([^&#]+)/gi, '$1***')
  return out
}

function hasEmbeddedCredentials(u) {
  if (!u || typeof u !== 'string') return false
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/@]+)@/i.exec(u)
  if (m && m[2] !== '***') {
    if (/^https?:\/\//i.test(m[1])) return true
    const ci = m[2].indexOf(':')
    if (ci >= 0) { const pw = m[2].slice(ci + 1); if (pw && pw !== '***') return true }
  }
  const q = /[?&](?:access_token|private_token|oauth_token|token|x-oauth-basic)=([^&#]+)/i.exec(u)
  if (q && q[1] && q[1] !== '***') return true
  return false
}

// Inspect a raw remote URL without exposing it: returns the masked URL, whether it carries a credential,
// and a safeUrl that equals the raw URL ONLY when it is credential-free (empty when it has a credential —
// so a credentialed URL is never handed back to callers / logs / artifacts).
function inspectRemoteUrl(rawUrl) {
  const hasCredentials = hasEmbeddedCredentials(rawUrl)
  return { maskedUrl: maskRemoteUrl(rawUrl), hasCredentials, safeUrl: hasCredentials ? '' : (rawUrl || '') }
}

export { maskRemoteUrl, hasEmbeddedCredentials, inspectRemoteUrl }
