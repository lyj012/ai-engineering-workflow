// Unit tests for core/mask-remote-url.mjs — credential redaction/detection for git remote URLs.
// Uses only fake token literals; never a real credential. Run: node scripts/mask-remote-url.test.mjs
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { maskRemoteUrl, hasEmbeddedCredentials, inspectRemoteUrl } from '../core/mask-remote-url.mjs'

// shared fixed vectors — also imported by self-check for the inline↔core parity diff
export const CASES = [
  // [name, url, expectedMasked, expectedHasCreds]
  ['https user:token@', 'https://u:ghp_FAKETOKEN@github.com/acme/app.git', 'https://***@github.com/acme/app.git', true],
  ['https token-as-user@', 'https://ghp_FAKETOKEN@github.com/acme/app.git', 'https://***@github.com/acme/app.git', true],
  ['http x-access-token@', 'http://x-access-token:FAKE@host:8080/a/b.git', 'http://***@host:8080/a/b.git', true],
  ['https no creds', 'https://github.com/acme/app.git', 'https://github.com/acme/app.git', false],
  ['ssh scp-form git@ (key auth)', 'git@github.com:acme/app.git', 'git@github.com:acme/app.git', false],
  ['ssh:// git@ (key auth, username only)', 'ssh://git@github.com/acme/app.git', 'ssh://git@github.com/acme/app.git', false],
  // R2-2: ssh:// with a password, and query tokens, are credentials and must be masked/flagged
  ['ssh:// user:password@', 'ssh://user:secretpw@host:22/o/r.git', 'ssh://user:***@host:22/o/r.git', true],
  ['https ?access_token=', 'https://github.com/o/r.git?access_token=SECRETTOK', 'https://github.com/o/r.git?access_token=***', true],
  ['https ?private_token= mid-query', 'https://h/o/r.git?ref=main&private_token=ABC&x=1', 'https://h/o/r.git?ref=main&private_token=***&x=1', true],
  ['local path', '/srv/git/acme/app.git', '/srv/git/acme/app.git', false],
  ['file url', 'file:///tmp/bare/app.git', 'file:///tmp/bare/app.git', false],
  ['empty', '', '', false],
]

export function runMaskRemoteUrlTests() {
  const failures = []
  try {
    for (const [name, url, expectMasked, expectCreds] of CASES) {
      const masked = maskRemoteUrl(url)
      if (masked !== expectMasked) failures.push(`maskRemoteUrl "${name}": got ${JSON.stringify(masked)} want ${JSON.stringify(expectMasked)}`)
      if (hasEmbeddedCredentials(url) !== expectCreds) failures.push(`hasEmbeddedCredentials "${name}": got ${hasEmbeddedCredentials(url)} want ${expectCreds}`)
      // a masked URL must never still contain a credential, and must not contain the fake token
      if (hasEmbeddedCredentials(masked) === true) failures.push(`masked URL still flagged as having creds: ${masked}`)
      if (/FAKETOKEN|x-access-token:FAKE/.test(masked)) failures.push(`masked URL still leaks token: ${masked}`)
    }
    // null/undefined pass through without throwing
    if (maskRemoteUrl(null) !== null) failures.push('maskRemoteUrl(null) should return null')
    if (hasEmbeddedCredentials(null) !== false) failures.push('hasEmbeddedCredentials(null) should be false')
    // inspectRemoteUrl: credential URL -> safeUrl empty (raw never exposed); credential-free -> safeUrl = url
    const ic = inspectRemoteUrl('ssh://user:secretpw@host/o/r.git')
    if (ic.hasCredentials !== true || ic.safeUrl !== '' || /secretpw/.test(ic.maskedUrl)) failures.push(`inspectRemoteUrl(cred) leaked or wrong: ${JSON.stringify(ic)}`)
    const ifree = inspectRemoteUrl('ssh://git@host/o/r.git')
    if (ifree.hasCredentials !== false || ifree.safeUrl !== 'ssh://git@host/o/r.git') failures.push(`inspectRemoteUrl(free) wrong: ${JSON.stringify(ifree)}`)
  } catch (e) {
    failures.push(`mask-remote-url test threw: ${e.message}`)
  }
  return failures
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = runMaskRemoteUrlTests()
  if (failures.length) {
    console.error('MASK-REMOTE-URL TESTS FAILED')
    for (const f of failures) console.error(`- ${f}`)
    process.exit(1)
  }
  console.log('MASK-REMOTE-URL TESTS PASSED')
}
