param(
  [ValidateSet('Link', 'Copy')]
  [string]$Mode = 'Link',

  [string]$CodexSkillsDir = (Join-Path $HOME '.agents\skills'),

  [string]$CodexAgentsDir = (Join-Path $HOME '.codex\agents'),

  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$skillName = 'ai-engineering-workflow'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceSkillDir = Join-Path $repoRoot '.agents\skills\ai-engineering-workflow'
$sourceSkillFile = Join-Path $sourceSkillDir 'SKILL.md'
$sourceAgentsDir = Join-Path $repoRoot 'codex\agents'
$destinationRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CodexSkillsDir)
$destination = Join-Path $destinationRoot $skillName
$agentsDestinationRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CodexAgentsDir)

function Assert-Exists([string]$path, [string]$label) {
  if (-not (Test-Path -LiteralPath $path)) {
    throw "$label not found: $path"
  }
}

function Assert-SafeDestination([string]$skillsRoot, [string]$target) {
  $fullRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($skillsRoot)
  $fullTarget = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($target)
  $expected = Join-Path $fullRoot 'ai-engineering-workflow'
  if ($fullTarget -ne $expected) {
    throw "Refusing to modify unexpected destination: $fullTarget"
  }
}

Assert-Exists $sourceSkillFile 'Codex skill entry'
foreach ($dir in @('bin', 'core', 'scripts', 'codex', 'codex\agents')) {
  Assert-Exists (Join-Path $repoRoot $dir) "Toolkit directory $dir"
}

& node (Join-Path $repoRoot 'scripts\generate-codex-agents.mjs') | Out-Host
& node (Join-Path $repoRoot 'scripts\check-agent-parity.mjs') | Out-Host

New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null
New-Item -ItemType Directory -Force -Path $agentsDestinationRoot | Out-Null

if (Test-Path -LiteralPath $destination) {
  if (-not $Force) {
    throw "Destination already exists: $destination. Re-run with -Force to replace it."
  }
  Assert-SafeDestination $destinationRoot $destination
  Remove-Item -LiteralPath $destination -Recurse -Force
}

if ($Mode -eq 'Link') {
  if ($IsWindows -or $env:OS -eq 'Windows_NT') {
    New-Item -ItemType Junction -Path $destination -Target $sourceSkillDir | Out-Null
  } else {
    New-Item -ItemType SymbolicLink -Path $destination -Target $sourceSkillDir | Out-Null
  }
} else {
  New-Item -ItemType Directory -Force -Path $destination | Out-Null
  Copy-Item -LiteralPath $sourceSkillFile -Destination (Join-Path $destination 'SKILL.md') -Force

  foreach ($dir in @('bin', 'core', 'scripts', 'codex', 'docs', 'examples', 'references', 'vendor')) {
    Copy-Item -Recurse -LiteralPath (Join-Path $repoRoot $dir) -Destination (Join-Path $destination $dir)
  }

  foreach ($file in @('README.md', 'CLAUDE.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $destination $file) -Force
  }

  $nestedSkillDir = Join-Path $destination '.agents\skills\ai-engineering-workflow'
  New-Item -ItemType Directory -Force -Path $nestedSkillDir | Out-Null
  Copy-Item -LiteralPath $sourceSkillFile -Destination (Join-Path $nestedSkillDir 'SKILL.md') -Force

}

$installedSkill = Join-Path $destination 'SKILL.md'
Assert-Exists $installedSkill 'Installed Codex skill'

if ($Force) {
  Get-ChildItem -LiteralPath $agentsDestinationRoot -Filter 'aiew_*.toml' -File -ErrorAction SilentlyContinue |
    Remove-Item -Force
}

$installedAgents = @()
foreach ($agentFile in Get-ChildItem -LiteralPath $sourceAgentsDir -Filter 'aiew_*.toml' -File) {
  $agentDest = Join-Path $agentsDestinationRoot $agentFile.Name
  if ((Test-Path -LiteralPath $agentDest) -and -not $Force) {
    throw "Codex agent already exists: $agentDest. Re-run with -Force to replace aiew_ namespace agents only."
  }
  Copy-Item -LiteralPath $agentFile.FullName -Destination $agentDest -Force
  Assert-Exists $agentDest "Installed Codex agent $($agentFile.Name)"
  $installedAgents += $agentFile.Name
}

Write-Host "Installed $skillName to $destination"
Write-Host "Installed Codex agents to $agentsDestinationRoot"
foreach ($agent in $installedAgents) { Write-Host " - $agent" }
Write-Host "Mode: $Mode"
Write-Host "Restart Codex or open a new thread, then use /skills -> $skillName or `$ai-engineering-workflow. Use /agent to inspect subagent activity when supported."
