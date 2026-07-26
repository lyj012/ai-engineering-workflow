import { findForbiddenFiles } from './verify-remote-publish.mjs'
import { hasEmbeddedCredentials, maskRemoteUrl } from './mask-remote-url.mjs'

const GENERATED_OR_LOCAL_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)coverage\//,
  /(^|\/)\.cache\//,
  /(^|\/)\.pytest_cache\//,
  /(^|\/)__pycache__\//,
  /\.log$/i,
  /(^|\/)debug[-_]?output/i,
]

function arr(v) { return Array.isArray(v) ? v.map(String).filter(Boolean) : [] }
function uniq(v) { return [...new Set(v)] }
function intersect(a, b) { const B = new Set(b); return a.filter(x => B.has(x)) }
function generatedOrLocal(files) { return files.filter(f => GENERATED_OR_LOCAL_PATTERNS.some(re => re.test(f))) }

export function computePrePushStatus(input) {
  const i = input || {}
  const changedFiles = uniq(arr(i.changedFiles))
  const taskFiles = uniq(arr(i.taskFiles))
  const unrelatedFiles = uniq(arr(i.unrelatedFiles))
  const verificationCommands = arr(i.verificationCommands)
  const reasons = []
  const warnings = []

  const git = i.gitState || {}
  const remote = i.remote || {}
  const branchChoice = i.branchChoice || {}
  const protectedBranches = new Set(arr(i.protectedBranches).length ? arr(i.protectedBranches) : ['main', 'master'])
  const currentBranch = git.currentBranch || i.currentBranch || ''
  const targetBranch = i.targetBranch || branchChoice.targetBranch || currentBranch
  const selectedFiles = taskFiles.length ? taskFiles : changedFiles
  const unknownTaskFiles = changedFiles.length > 0 && taskFiles.length === 0 ? changedFiles : []
  const unsafeFiles = uniq([
    ...findForbiddenFiles(selectedFiles),
    ...generatedOrLocal(selectedFiles),
    ...arr(i.unsafeFiles),
  ])
  const selectedUnrelated = intersect(selectedFiles, unrelatedFiles)
  const remoteUrl = remote.url || i.remoteUrl || ''
  const remoteHasCredentials = remote.hasCredentials === true || hasEmbeddedCredentials(remoteUrl)

  if (git.isRepo === false) reasons.push('not a git repository')
  if (git.detachedHead) reasons.push('detached HEAD requires an explicit branch strategy')
  if (git.unbornBranch) warnings.push('unborn branch: first commit branch should be explicit')
  if (changedFiles.length === 0) reasons.push('no changed files detected')
  if (unknownTaskFiles.length > 0) warnings.push('task files were not provided; treating all changed files as candidate task files')
  if (selectedUnrelated.length > 0) reasons.push(`selected files include unrelated changes: ${selectedUnrelated.join(', ')}`)
  if (unrelatedFiles.length > 0 && taskFiles.length === 0) reasons.push('unrelated changes exist and task files were not isolated')
  if (unsafeFiles.length > 0) reasons.push(`unsafe or generated files selected: ${unsafeFiles.join(', ')}`)
  if (verificationCommands.length === 0 && i.verificationRequired !== false) reasons.push('no verification command/result recorded')
  if (i.verificationPassed === false) reasons.push('required verification failed')
  if (remote.required !== false && !remote.name && !remote.url && !i.remoteName) warnings.push('remote was not identified')
  if (remoteHasCredentials) reasons.push(`remote URL contains embedded credentials: ${maskRemoteUrl(remoteUrl)}`)
  if (!branchChoice.resolvedMode && i.publishIntent) reasons.push('publish intent requires explicit branch strategy')
  if (protectedBranches.has(String(targetBranch)) && !i.allowProtectedBranchPublish) reasons.push(`protected branch requires explicit opt-in: ${targetBranch}`)
  if (i.highRisk === true && !i.allowHighRiskPublish) reasons.push('high-risk publish requires explicit opt-in')
  if (i.userSaidNoCommit === true || i.userSaidNoPush === true) reasons.push('user explicitly disabled commit or push')

  const ok = reasons.length === 0
  const finalStatus = ok ? 'PREPUSH_READY' : 'PREPUSH_BLOCKED'
  return {
    finalStatus,
    ok,
    reasons,
    warnings,
    changedFiles,
    taskFiles: selectedFiles,
    unrelatedFiles,
    unsafeFiles,
    verificationCommands,
    branch: currentBranch,
    targetBranch,
    remote: {
      name: remote.name || i.remoteName || '',
      maskedUrl: maskRemoteUrl(remoteUrl),
      hasCredentials: remoteHasCredentials,
    },
    requiresConfirmation: ok,
    note: finalStatus === 'PREPUSH_READY'
      ? 'PREPUSH_READY means current changes look safe to commit/push after exact-file confirmation; it does not mean PUBLISHED.'
      : 'Blocked before git writes; no commit or push should be performed.',
  }
}
