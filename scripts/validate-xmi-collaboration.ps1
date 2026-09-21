#Requires -Version 7.0
<#
.SYNOPSIS
    Aceptación automatizada XMI y colaboración (tarea P9-003).

.DESCRIPTION
    Un único comando ejecuta, desde un checkout limpio, el objetivo verificable
    de la tarea: round-trip XMI del corpus soportado y convergencia de dos
    clientes sobre los fixtures versionados de fixtures/xmi/.

      1. Arranque: npm install + build de packages/xmi-adapter,
         packages/collaboration-protocol y packages/domain-validator.
      2. Escenario: scripts/xmi-collaboration-acceptance.mjs ejecuta la
         importación/exportación del corpus (xmi-profile-v1) y la traza de dos
         clientes del contrato collaboration-protocol-v1 §9 (comandos
         secuenciales, concurrencia con CONCURRENT_MODIFICATION, reconexión con
         catch-up y reintento idempotente) sobre un modelo canónico obtenido
         del fixture 02-associations.
      3. Evidencia: se valida el archivo machine-readable emitido en
         .validation/xmi-collaboration/evidence.json (ruta ignorada por git):
         equivalencia semántica del round-trip, modelos finales equivalentes
         (mismo SHA-256, seqNumber y versión) y ausencia de duplicados.

    Cualquier error en cualquier etapa detiene el circuito con código 1.

.EXAMPLE
    pwsh -File scripts/validate-xmi-collaboration.ps1
#>
param(
    [string]$EvidencePath = ".validation/xmi-collaboration/evidence.json",
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $RepoRoot
try {
    function Fail([string]$Stage, [string]$Message) {
        Write-Host "[xmi-collaboration] FAIL ${Stage}: $Message"
        exit 1
    }

    function Invoke-Native([string]$Stage, [scriptblock]$Command) {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            Fail $Stage "comando terminó con código $LASTEXITCODE."
        }
    }

    # --- Prerrequisitos -------------------------------------------------------
    Write-Host "[xmi-collaboration] Prerrequisitos: node, npm en PATH."
    foreach ($tool in @("node", "npm")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Fail "prerrequisitos" "herramienta '$tool' no disponible en PATH."
        }
    }

    # --- Etapa 1: arranque (toolchain desde checkout limpio) ------------------
    Write-Host "[xmi-collaboration] Etapa 1/3: npm install + build de los paquetes del escenario."
    foreach ($pkg in @("packages/xmi-adapter", "packages/collaboration-protocol", "packages/domain-validator")) {
        if (-not $SkipInstall) {
            Invoke-Native "arranque" { npm install --prefix $pkg }
        }
        Invoke-Native "arranque" { npm run build --prefix $pkg }
        if (-not (Test-Path (Join-Path $pkg "dist/index.js"))) {
            Fail "arranque" "artefacto esperado '$pkg/dist/index.js' no existe tras la compilación."
        }
    }

    # --- Etapa 2: escenario de aceptación -------------------------------------
    Write-Host "[xmi-collaboration] Etapa 2/3: round-trip del corpus XMI y convergencia de dos clientes."
    Invoke-Native "etapa-2" { node scripts/xmi-collaboration-acceptance.mjs --evidence $EvidencePath }

    # --- Etapa 3: validación de la evidencia ----------------------------------
    Write-Host "[xmi-collaboration] Etapa 3/3: validación de evidencia '$EvidencePath'."
    if (-not (Test-Path $EvidencePath)) {
        Fail "etapa-3" "el escenario no emitió el archivo de evidencia."
    }
    try {
        $evidence = Get-Content $EvidencePath -Raw | ConvertFrom-Json
    } catch {
        Fail "etapa-3" "la evidencia no es JSON válido: $($_.Exception.Message)"
    }

    if ($evidence.verdict -ne 'pass') {
        Fail "etapa-3" "verdict='$($evidence.verdict)' fallos=[$($evidence.failures -join '; ')]."
    }

    # Round-trip del corpus soportado: todos los fixtures versionados pasan.
    $corpus = @($evidence.xmi.corpus)
    if ($corpus.Count -lt 6) {
        Fail "etapa-3" "corpus incompleto: $($corpus.Count) fixtures (se esperaban al menos 6)."
    }
    $failedFixtures = @($corpus | Where-Object { -not $_.ok } | ForEach-Object { $_.fixture })
    if ($failedFixtures.Count -gt 0) {
        Fail "etapa-3" "fixtures con equivalencia rota: $($failedFixtures -join ', ')."
    }

    # Traza concurrente: rechazo determinista sin mutación ni consumo de seq.
    $concurrent = $evidence.collaboration.concurrentTrace
    if ($concurrent.rejectionCode -ne 'CONCURRENT_MODIFICATION' -or -not $concurrent.seqUnchangedAfterReject) {
        Fail "etapa-3" "la traza concurrente no rechazó con CONCURRENT_MODIFICATION sin efecto."
    }

    # Reconexión: catch-up incremental y convergencia.
    $reconnection = $evidence.collaboration.reconnection
    if ($reconnection.mode -ne 'catch-up' -or -not $reconnection.converged) {
        Fail "etapa-3" "la reconexión no convergió por catch-up incremental."
    }

    # Reintento idempotente: una sola mutación, sin duplicados.
    if (-not $evidence.collaboration.idempotentRetry.singleEffect) {
        Fail "etapa-3" "el reintento idempotente produjo efecto duplicado."
    }

    # Convergencia final: modelos equivalentes (mismo seq, versión y SHA-256).
    $final = $evidence.collaboration.final
    if (-not $final.equivalent -or
        $final.sha256A -ne $final.sha256Coordinator -or
        $final.sha256B -ne $final.sha256Coordinator -or
        $final.clientStates.a -ne 'IN_SYNC' -or
        $final.clientStates.b -ne 'IN_SYNC') {
        Fail "etapa-3" "los clientes no terminaron en modelos equivalentes."
    }
    if ($evidence.collaboration.duplicates.duplicatesDetected -ne $false -or
        $evidence.collaboration.duplicates.elementIds -ne $evidence.collaboration.duplicates.uniqueElementIds) {
        Fail "etapa-3" "se detectaron elementos duplicados en el modelo final."
    }

    Write-Host "[xmi-collaboration] Evidencia válida: $($corpus.Count) fixtures, seq=$($final.seqNumber), sha=$($final.sha256Coordinator.Substring(0,12))…, 0 duplicados."
    Write-Host "[xmi-collaboration] PASS: round-trip XMI equivalente y dos clientes convergen sin duplicados."
    exit 0
} finally {
    Pop-Location
}
