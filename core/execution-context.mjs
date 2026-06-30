import path from 'node:path'

function abs(p, fallback) {
  return path.resolve(String(p || fallback || process.cwd()))
}

function norm(p) {
  return String(p || '').replaceAll(path.sep, '/')
}

export function buildExecutionContext(input) {
  const i = input || {}
  const workflowRoot = abs(i.workflowRoot)
  const projectRoot = abs(i.projectRoot || i.workspaceRoot)
  const workspaceRoot = abs(i.workspaceRoot || projectRoot)
  const taskArtifactRoot = i.taskArtifactRoot ? abs(i.taskArtifactRoot) : ''
  const baseline = i.workspaceBaseline || {}
  return {
    schemaVersion: '1.0',
    executionContext: {
      workflowRoot: norm(workflowRoot),
      projectRoot: norm(projectRoot),
      workspaceRoot: norm(workspaceRoot),
      taskArtifactRoot: norm(taskArtifactRoot),
      changedFiles: Array.isArray(i.changedFiles) ? i.changedFiles.map(String) : [],
      workspaceBaseline: {
        branch: baseline.branch || '',
        head: baseline.head || '',
        statusShort: baseline.statusShort || '',
        diffStat: baseline.diffStat || '',
        untrackedFiles: Array.isArray(baseline.untrackedFiles) ? baseline.untrackedFiles.map(String) : [],
      },
    },
  }
}

export function compareWorkspaceSnapshots(before, after) {
  const b = before || {}
  const a = after || {}
  const beforeUntracked = new Set(Array.isArray(b.untrackedFiles) ? b.untrackedFiles : [])
  const afterUntracked = new Set(Array.isArray(a.untrackedFiles) ? a.untrackedFiles : [])
  return {
    sameHead: !b.head || !a.head || b.head === a.head,
    preExistingUntracked: [...afterUntracked].filter(file => beforeUntracked.has(file)).sort(),
    newUntracked: [...afterUntracked].filter(file => !beforeUntracked.has(file)).sort(),
    removedUntracked: [...beforeUntracked].filter(file => !afterUntracked.has(file)).sort(),
    beforeStatusShort: b.statusShort || '',
    afterStatusShort: a.statusShort || '',
    beforeDiffStat: b.diffStat || '',
    afterDiffStat: a.diffStat || '',
  }
}
