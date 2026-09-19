[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)]
    [ValidateSet('preflight', 'run', 'adopt', 'status', 'logs', 'resume', 'stop', 'dry-run')]
    [string]$Command,

    [Parameter(Position = 1)]
    [string]$TaskId,

    [switch]$Autonomous
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
    if ($PSVersionTable.PSVersion.Major -lt 7) {
        throw 'orca.ps1 requires PowerShell 7 (pwsh).'
    }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT -or [Environment]::OSVersion.Version.Build -lt 22000) {
        throw 'orca.ps1 requires Windows 11.'
    }

    $modulePath = Join-Path $PSScriptRoot 'scripts/orca/OrcaPipeline.psm1'
    Import-Module $modulePath -Force -ErrorAction Stop
    $result = Invoke-OrcaPipelineCommand -Command $Command -TaskId $TaskId -Autonomous:$Autonomous -RepoRoot $PSScriptRoot
    $result | ConvertTo-Json -Depth 60
    if ($result.Contains('success') -and -not $result.success) { exit 1 }
}
catch {
    [ordered]@{
        success = $false
        command = $Command
        taskId = $TaskId
        error = $_.Exception.Message
        category = $_.CategoryInfo.Category.ToString()
    } | ConvertTo-Json -Depth 10
    exit 1
}
