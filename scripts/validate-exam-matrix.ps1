#Requires -Version 7.0
<#
.SYNOPSIS
  Matriz de aceptación final del examen (P9-004).
  Ejecuta deterministamente las tres suites de aceptación del ecosistema CASE:
    1. P9-001: Circuito determinista e2e (modelo canónico -> validación -> generación -> compilación -> descriptor).
    2. P9-002: Aceptación móvil y offline (carga dinámica, edición, reinicio sin red y reintento idempotente).
    3. P9-003: Aceptación XMI y colaboración (round-trip XMI y convergencia concurrente de dos clientes).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $RepoRoot
try {
    function Fail([string]$Stage, [string]$Message) {
        Write-Host "[exam-matrix] FAIL ${Stage}: $Message"
        exit 1
    }

    function Write-ToolVersion([string]$Command, [string[]]$Arguments) {
        if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
            Fail "prerrequisitos" "herramienta '$Command' no disponible en PATH."
        }

        Write-Host "`n[exam-matrix] >>> $Command $($Arguments -join ' ')"
        & $Command @Arguments
        if ($LASTEXITCODE -ne 0) {
            Fail "prerrequisitos" "no se pudo obtener la versión de '$Command' (código $LASTEXITCODE)."
        }
    }

    Write-Host "================================================================"
    Write-Host "=== Matriz de Aceptación Final del Examen (P9-004)           ==="
    Write-Host "================================================================"

    Write-Host "`n[exam-matrix] Raíz: $RepoRoot"
    Write-Host "[exam-matrix] PowerShell: $($PSVersionTable.PSVersion)"
    Write-ToolVersion "git" @("--version")
    Write-ToolVersion "node" @("--version")
    Write-ToolVersion "npm" @("--version")
    Write-ToolVersion "mvn" @("--version")
    Write-ToolVersion "flutter" @("--version")

    Write-Host "`n[1/3] Ejecutando circuito determinista E2E (P9-001)..."
    & pwsh -NoProfile -File (Join-Path $RepoRoot "scripts/validate-e2e.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "P9-001 (validate-e2e.ps1) falló con código de salida $LASTEXITCODE"
    }

    Write-Host "`n[2/3] Ejecutando aceptación móvil y offline (P9-002)..."
    & pwsh -NoProfile -File (Join-Path $RepoRoot "scripts/validate-mobile-offline.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "P9-002 (validate-mobile-offline.ps1) falló con código de salida $LASTEXITCODE"
    }

    Write-Host "`n[3/3] Ejecutando aceptación XMI y colaboración (P9-003)..."
    & pwsh -NoProfile -File (Join-Path $RepoRoot "scripts/validate-xmi-collaboration.ps1")
    if ($LASTEXITCODE -ne 0) {
        throw "P9-003 (validate-xmi-collaboration.ps1) falló con código de salida $LASTEXITCODE"
    }

    Write-Host "`n================================================================"
    Write-Host "=== MATRIZ DE ACEPTACIÓN FINAL: 100% COMPLETADA EXITOSAMENTE ==="
    Write-Host "================================================================"
    exit 0
}
finally {
    Pop-Location
}
