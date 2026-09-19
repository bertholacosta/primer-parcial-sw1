[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:Failures = [System.Collections.Generic.List[object]]::new()

function Assert-True {
    param([bool]$Condition, [string]$Message = 'Expected condition to be true.')
    if (-not $Condition) { throw $Message }
}

function Assert-False {
    param([bool]$Condition, [string]$Message = 'Expected condition to be false.')
    if ($Condition) { throw $Message }
}

function Assert-Equal {
    param($Expected, $Actual, [string]$Message = 'Values are not equal.')
    if ($Expected -ne $Actual) { throw "$Message Expected=[$Expected] Actual=[$Actual]" }
}

function It {
    param([string]$Name, [scriptblock]$Test)
    try {
        & $Test
        $script:Passed++
    }
    catch {
        $script:Failed++
        $script:Failures.Add([pscustomobject]@{ name = $Name; error = $_.Exception.Message })
    }
}

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
Import-Module (Join-Path $repoRoot 'scripts/orca/OrcaPipeline.psm1') -Force

Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*.Tests.ps1' -File |
    Sort-Object Name |
    ForEach-Object { . $_.FullName }

$result = [ordered]@{
    success = $script:Failed -eq 0
    passed = $script:Passed
    failed = $script:Failed
    failures = @($script:Failures)
}
$result | ConvertTo-Json -Depth 10
if ($script:Failed -gt 0) { exit 1 }
