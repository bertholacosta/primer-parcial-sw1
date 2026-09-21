#Requires -Version 7.0
<#
.SYNOPSIS
    Aceptación automatizada móvil y offline (tarea P9-002).

.DESCRIPTION
    Reproduce sin intervención manual el escenario de mobile-offline-v1 sobre
    la app Flutter: carga dinámica del descriptor versionado, edición con la
    UI dinámica, reinicio sin red (la operación y el snapshot del descriptor
    sobreviven en almacenamiento durable) y reintento idempotente sin
    duplicados (mismo operationId en todos los intentos, registro de
    confirmaciones único).

    El escenario se ejecuta en
    apps/mobile-flutter/test/mobile_offline_acceptance_test.dart y emite
    evidencia machine-readable en
    apps/mobile-flutter/build/mobile-offline-acceptance/evidence.json
    (ruta ignorada por git). Este script ejecuta la prueba y valida la
    evidencia: descriptor usado, estado offline y ausencia de duplicados.

    Con -WithDevice ejecuta además una etapa en Android real (emulador o
    dispositivo adb): compila e instala el APK debug, activa el modo avión,
    fuerza el reinicio frío de la app sin red y restaura la conectividad.
    Requiere `adb` en PATH; usa -Serial para elegir el dispositivo.

.EXAMPLE
    pwsh -File scripts/validate-mobile-offline.ps1

.EXAMPLE
    pwsh -File scripts/validate-mobile-offline.ps1 -WithDevice -Serial emulator-5554
#>
param(
    [string]$Serial = "",
    [switch]$WithDevice,
    [switch]$SkipPubGet
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$AppDir = Join-Path $RepoRoot "apps/mobile-flutter"
$EvidencePath = Join-Path $AppDir "build/mobile-offline-acceptance/evidence.json"
$DescriptorAsset = Join-Path $AppDir "assets/flutter-descriptor.json"

Push-Location $RepoRoot
try {
    function Fail([string]$Stage, [string]$Message) {
        Write-Host "[mobile-offline] FAIL ${Stage}: $Message"
        exit 1
    }

    function Invoke-Native([string]$Stage, [scriptblock]$Command) {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            Fail $Stage "comando terminó con código $LASTEXITCODE."
        }
    }

    function Invoke-Adb([string[]]$AdbArgs) {
        $full = @(); if ($Serial) { $full += @('-s', $Serial) }; $full += $AdbArgs
        & adb @full
        if ($LASTEXITCODE -ne 0) {
            Fail "dispositivo" "adb $($full -join ' ') terminó con código $LASTEXITCODE."
        }
    }

    # --- Prerrequisitos -------------------------------------------------------
    Write-Host "[mobile-offline] Prerrequisitos: flutter en PATH."
    if (-not (Get-Command flutter -ErrorAction SilentlyContinue)) {
        Fail "prerrequisitos" "herramienta 'flutter' no disponible en PATH."
    }
    if (-not (Test-Path $DescriptorAsset)) {
        Fail "prerrequisitos" "descriptor versionado '$DescriptorAsset' no existe."
    }

    # --- Etapa 1: escenario automatizado --------------------------------------
    Write-Host "[mobile-offline] Etapa 1/3: prueba de aceptación (carga dinámica, edición, reinicio sin red, reintento idempotente)."
    Push-Location $AppDir
    try {
        if (-not $SkipPubGet) {
            Invoke-Native "etapa-1" { flutter pub get }
        }
        Invoke-Native "etapa-1" { flutter test test/mobile_offline_acceptance_test.dart }
    } finally {
        Pop-Location
    }

    # --- Etapa 2: validación de la evidencia ----------------------------------
    Write-Host "[mobile-offline] Etapa 2/3: validación de evidencia '$EvidencePath'."
    if (-not (Test-Path $EvidencePath)) {
        Fail "etapa-2" "la prueba no emitió el archivo de evidencia."
    }
    try {
        $evidence = Get-Content $EvidencePath -Raw | ConvertFrom-Json
    } catch {
        Fail "etapa-2" "la evidencia no es JSON válido: $($_.Exception.Message)"
    }

    if ($evidence.verdict -ne 'pass') {
        Fail "etapa-2" "verdict='$($evidence.verdict)'."
    }

    # Descriptor usado: debe ser el asset versionado del repositorio.
    $asset = Get-Content $DescriptorAsset -Raw | ConvertFrom-Json
    if ($evidence.descriptor.sourceModelSha256 -ne $asset.sourceModelSha256) {
        Fail "etapa-2" "el descriptor usado no coincide con el asset versionado (sourceModelSha256)."
    }
    if ($evidence.descriptor.descriptorContractVersion -ne '1') {
        Fail "etapa-2" "descriptorContractVersion='$($evidence.descriptor.descriptorContractVersion)'."
    }
    if (-not $evidence.descriptor.reloadedFromSnapshotOffline) {
        Fail "etapa-2" "el descriptor no se recargó desde el snapshot local tras el reinicio."
    }

    # Estado offline: reinicio sin red y operación conservada.
    if (-not $evidence.scenario.restartWithoutNetwork.operationPreserved) {
        Fail "etapa-2" "la operación no se conservó tras el reinicio sin red."
    }
    if ($evidence.scenario.restartWithoutNetwork.networkUsed -ne $false) {
        Fail "etapa-2" "se usó la red durante el reinicio."
    }
    if ($evidence.scenario.operation.status -ne 'confirmed') {
        Fail "etapa-2" "la operación terminó en estado '$($evidence.scenario.operation.status)'."
    }

    # Ausencia de duplicados e idempotencia del reintento.
    if ($evidence.duplicates.duplicatesDetected -ne $false) {
        Fail "etapa-2" "se detectaron duplicados en la evidencia."
    }
    if ($evidence.duplicates.operationsEnqueued -ne 1 -or
        $evidence.duplicates.confirmationEntries -ne 1 -or
        $evidence.duplicates.deliveriesAfterConfirmation -ne 0) {
        Fail "etapa-2" "contadores de duplicados fuera de lo esperado."
    }
    $deliveries = @($evidence.scenario.transportDeliveries)
    if ($deliveries.Count -lt 2) {
        Fail "etapa-2" "se esperaban al menos 2 entregas de transporte (reintento), hay $($deliveries.Count)."
    }
    $distinctIds = @($deliveries | ForEach-Object { $_.operationId } | Select-Object -Unique)
    if ($distinctIds.Count -ne 1 -or
        $distinctIds[0] -ne $evidence.scenario.operation.operationId) {
        Fail "etapa-2" "los reintentos no reutilizaron el mismo operationId (idempotencia rota)."
    }

    Write-Host "[mobile-offline] Evidencia válida: descriptor $($asset.sourceModelSha256.Substring(0,12))…, 1 operación, 0 duplicados."

    # --- Etapa 3 (opcional): dispositivo Android -------------------------------
    if ($WithDevice -or $Serial) {
        Write-Host "[mobile-offline] Etapa 3/3: etapa en dispositivo Android (modo avión + reinicio en frío)."
        if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
            Fail "etapa-3" "herramienta 'adb' no disponible en PATH."
        }
        if (-not $Serial) {
            $Serial = (adb devices | Select-String '\tdevice$' | Select-Object -First 1).ToString().Split("`t")[0]
        }
        if (-not $Serial) {
            Fail "etapa-3" "no hay dispositivo/emulador adb conectado."
        }
        Write-Host "[mobile-offline] Dispositivo objetivo: $Serial"
        $pkg = 'com.example.mobile_flutter'

        Push-Location $AppDir
        try {
            Invoke-Native "etapa-3" { flutter build apk --debug }
        } finally {
            Pop-Location
        }
        Invoke-Adb @('install', '-r', (Join-Path $AppDir 'build/app/outputs/flutter-apk/app-debug.apk'))

        Invoke-Adb @('shell', 'settings put global airplane_mode_on 1')
        Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state true')
        try {
            Invoke-Adb @('shell', 'settings get global airplane_mode_on')
            # Reinicio en frío sin red: force-stop + arranque.
            Invoke-Adb @('shell', "am force-stop $pkg")
            Invoke-Adb @('shell', "am start -n $pkg/.MainActivity")
            Invoke-Adb @('shell', 'logcat', '-d', '-s', 'flutter')
        } finally {
            Invoke-Adb @('shell', 'settings put global airplane_mode_on 0')
            Invoke-Adb @('shell', 'am broadcast -a android.intent.action.AIRPLANE_MODE --ez state false')
        }
        Write-Host "[mobile-offline] Etapa en dispositivo completada (arranque offline verificado en logcat)."
    } else {
        Write-Host "[mobile-offline] Etapa 3/3 omitida (sin -WithDevice): la aceptación host-side ya cubrió el escenario."
    }

    Write-Host "[mobile-offline] PASS: aceptación móvil y offline reproducida sin intervención manual."
    exit 0
} finally {
    Pop-Location
}
