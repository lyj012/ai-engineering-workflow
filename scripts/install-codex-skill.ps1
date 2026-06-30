param(
  [ValidateSet('Link', 'Copy')]
  [string]$Mode = 'Link',

  [string]$CodexSkillsDir = (Join-Path $HOME '.codex\skills'),

  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$skillName = 'ai-engineering-workflow'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceSkillDir = Join-Path $repoRoot '.agents\skills\ai-engineering-workflow'
$sourceSkillFile = Join-Path $sourceSkillDir 'SKILL.md'
$destinationRoot = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($CodexSkillsDir)
$destination = Join-Path $destinationRoot $skillName

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
foreach ($dir in @('bin', 'core', 'scripts', 'codex')) {
  Assert-Exists (Join-Path $repoRoot $dir) "Toolkit directory $dir"
}

New-Item -ItemType Directory -Force -Path $destinationRoot | Out-Null

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

  foreach ($dir in @('bin', 'core', 'scripts', 'codex', 'examples')) {
    Copy-Item -Recurse -LiteralPath (Join-Path $repoRoot $dir) -Destination (Join-Path $destination $dir)
  }

  foreach ($file in @('README.md', 'CLAUDE.md', 'LICENSE', 'CHANGELOG.md', 'CONTRIBUTING.md', 'SECURITY.md')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $file) -Destination (Join-Path $destination $file) -Force
  }

  $nestedSkillDir = Join-Path $destination '.agents\skills\ai-engineering-workflow'
  New-Item -ItemType Directory -Force -Path $nestedSkillDir | Out-Null
  Copy-Item -LiteralPath $sourceSkillFile -Destination (Join-Path $nestedSkillDir 'SKILL.md') -Force

  $vendorDir = Join-Path $destination 'vendor\zhuliming-templates'
  New-Item -ItemType Directory -Force -Path $vendorDir | Out-Null
  Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor\zhuliming-templates\ATTRIBUTION.md') -Destination (Join-Path $vendorDir 'ATTRIBUTION.md') -Force
}

$installedSkill = Join-Path $destination 'SKILL.md'
Assert-Exists $installedSkill 'Installed Codex skill'

Write-Host "Installed $skillName to $destination"
Write-Host "Mode: $Mode"
Write-Host "Restart Codex or open a new thread, then use /skills -> $skillName or `$ai-engineering-workflow."
