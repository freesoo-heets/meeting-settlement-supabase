# Install design agent skills for Codex (project scope)
# Run from repository root in PowerShell: powershell -ExecutionPolicy Bypass -File scripts/install-design-skills.ps1
# Review upstream repositories and installer permissions before running.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path 'package.json')) { throw 'Run this from the repository root.' }
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required (Taste Skill needs Node 22+).' }
$version = [int]((node --version).TrimStart('v').Split('.')[0])
if ($version -lt 22) { throw 'Node.js 22+ is required for Taste Skill.' }

function Run-Npx([string[]]$NpxArgs) {
  & npx @NpxArgs
  if ($LASTEXITCODE -ne 0) { throw "npx failed: $($NpxArgs -join ' ')" }
}

Write-Host '1/5 Impeccable'
Run-Npx @('--yes','impeccable','install','--providers=codex','--scope=project')
Write-Host '2/5 Taste Skill'
Run-Npx @('--yes','skills','add','Leonxlnx/taste-skill','--skill','design-taste-frontend','--agent','codex','-y')
Write-Host '3/5 unslop'
Run-Npx @('--yes','skills','add','heydamir/unslop','--skill','unslop','--agent','codex','-y')
Write-Host '4/5 UI Skills registry'
Run-Npx @('--yes','ui-skills','--help')
Write-Host '5/5 Interface Design'
Run-Npx @('--yes','skills','add','dammyjay93/interface-design','--skill','interface-design','--agent','codex','-y')

Write-Host 'Done. UI Skills is a CLI registry: use npx ui-skills list / get <skill-name> as needed.'
Write-Host 'Restart Codex to discover project skills. For Impeccable, approve the hook in Codex /hooks.'
Write-Host 'Taste Skill browser QA additionally needs Chrome/Chromium. No application dependencies or UI source files were changed.'
