#Requires -Version 7.0
<#
.SYNOPSIS
    Circuito determinista de extremo a extremo (tarea P9-001).

.DESCRIPTION
    Un único comando ejecuta, desde un checkout limpio, las cinco etapas del
    objetivo verificable inicial (docs/PROJECT.md):

      1. Carga del modelo de ejemplo (fixtures/models/valid-minimal.json).
      2. Validación del modelo contra el contrato domain-model v1.
      3. Generación del proyecto Spring Boot (dos ejecuciones; se verifica
         reproducibilidad byte a byte y que el fixture golden versionado no
         diverge de la salida del generador, es decir, no tiene ediciones
         manuales).
      4. Compilación Maven del proyecto generado.
      5. Validación del flutter-descriptor.json contra su contrato.

    Cualquier error en cualquier etapa detiene el circuito con código 1.
    La salida de trabajo se escribe en fixtures/generated-projects/.work/e2e
    (ruta ignorada por git); el fixture golden nunca se modifica.

.EXAMPLE
    pwsh -File scripts/validate-e2e.ps1
#>
param(
    [string]$Model = "fixtures/models/valid-minimal.json",
    [string]$Config = "fixtures/generator-config-minimal.json",
    [string]$GoldenDir = "fixtures/generated-projects/biblioteca",
    [string]$WorkRoot = "fixtures/generated-projects/.work/e2e"
)

$ErrorActionPreference = 'Stop'

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $RepoRoot
try {
    function Fail([string]$Stage, [string]$Message) {
        Write-Host "[e2e] FAIL ${Stage}: $Message"
        exit 1
    }

    function Invoke-Native([string]$Stage, [scriptblock]$Command) {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            Fail $Stage "comando terminó con código $LASTEXITCODE."
        }
    }

    function Get-TreeInventory([string]$Root, [string[]]$ExcludeDirs = @()) {
        $inventory = @{}
        $textExtensions = @(".java", ".json", ".xml", ".yml", ".yaml", ".md", ".txt", ".properties")
        Get-ChildItem -Path $Root -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring((Resolve-Path $Root).Path.Length + 1) -replace '\\', '/'
            $skip = $false
            foreach ($dir in $ExcludeDirs) {
                if ($relative.StartsWith("$dir/")) { $skip = $true; break }
            }
            if (-not $skip) {
                if ($textExtensions -contains $_.Extension.ToLowerInvariant()) {
                    $raw = [IO.File]::ReadAllText($_.FullName) -replace "\r\n", "`n"
                    $bytes = [Text.Encoding]::UTF8.GetBytes($raw)
                    $hasher = [Security.Cryptography.SHA256]::Create()
                    $hashBytes = $hasher.ComputeHash($bytes)
                    $inventory[$relative] = [BitConverter]::ToString($hashBytes).Replace('-', '').ToLowerInvariant()
                } else {
                    $inventory[$relative] = (Get-FileHash -Algorithm SHA256 -LiteralPath $_.FullName).Hash.ToLowerInvariant()
                }
            }
        }
        return $inventory
    }

    function Assert-TreeEqual([hashtable]$A, [hashtable]$B, [string]$Stage, [string]$NameA, [string]$NameB) {
        $missingInB = @($A.Keys | Where-Object { -not $B.ContainsKey($_) })
        $missingInA = @($B.Keys | Where-Object { -not $A.ContainsKey($_) })
        $different = @($A.Keys | Where-Object { $B.ContainsKey($_) -and $A[$_] -ne $B[$_] })
        if ($missingInB.Count -gt 0 -or $missingInA.Count -gt 0 -or $different.Count -gt 0) {
            $missingInB | ForEach-Object { Write-Host "[e2e]   solo en ${NameA}: $_" }
            $missingInA | ForEach-Object { Write-Host "[e2e]   solo en ${NameB}: $_" }
            $different  | ForEach-Object { Write-Host "[e2e]   contenido distinto: $_" }
            Fail $Stage "$NameA y $NameB no son equivalentes."
        }
    }

    # --- Prerrequisitos -------------------------------------------------------
    Write-Host "[e2e] Prerrequisitos: node, npm, mvn, pwsh en PATH."
    foreach ($tool in @("node", "npm", "mvn")) {
        if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
            Fail "prerrequisitos" "herramienta '$tool' no disponible en PATH."
        }
    }

    # --- Arranque: toolchain desde checkout limpio -----------------------------
    Write-Host "[e2e] Arranque: npm install + build de services/generator-cli (incluye domain-model y domain-validator)."
    Invoke-Native "arranque" { npm install --prefix services/generator-cli }
    Invoke-Native "arranque" { npm run build --prefix services/generator-cli }
    foreach ($artifact in @(
        "packages/domain-model/dist/index.js",
        "packages/domain-validator/dist/cli.js",
        "services/generator-cli/dist/index.js"
    )) {
        if (-not (Test-Path $artifact)) {
            Fail "arranque" "artefacto esperado '$artifact' no existe tras la compilación."
        }
    }

    # --- Etapa 1: modelo de ejemplo -------------------------------------------
    Write-Host "[e2e] Etapa 1/5: carga del modelo de ejemplo '$Model'."
    if (-not (Test-Path $Model)) {
        Fail "etapa-1" "el modelo '$Model' no existe."
    }
    try {
        $null = Get-Content $Model -Raw | ConvertFrom-Json
    } catch {
        Fail "etapa-1" "el modelo '$Model' no es JSON válido: $($_.Exception.Message)"
    }

    # --- Etapa 2: validación del modelo ---------------------------------------
    Write-Host "[e2e] Etapa 2/5: validación domain-model v1."
    Invoke-Native "etapa-2" { node packages/domain-validator/dist/cli.js $Model }

    # --- Etapa 3: generación (dos ejecuciones, reproducibilidad) ---------------
    Write-Host "[e2e] Etapa 3/5: generación del proyecto Spring Boot (dos ejecuciones)."
    if (Test-Path $WorkRoot) {
        Remove-Item -Recurse -Force $WorkRoot
    }
    $run1 = Join-Path $WorkRoot "run1"
    $run2 = Join-Path $WorkRoot "run2"
    Invoke-Native "etapa-3" { node services/generator-cli/dist/index.js --model $Model --config $Config --output $run1 }
    Invoke-Native "etapa-3" { node services/generator-cli/dist/index.js --model $Model --config $Config --output $run2 }

    Write-Host "[e2e] Etapa 3/5: comparación byte a byte entre ejecuciones."
    $inv1 = Get-TreeInventory $run1
    $inv2 = Get-TreeInventory $run2
    Assert-TreeEqual $inv1 $inv2 "etapa-3" "run1" "run2"

    Write-Host "[e2e] Etapa 3/5: comparación contra el fixture golden '$GoldenDir'."
    if (-not (Test-Path $GoldenDir)) {
        Fail "etapa-3" "el fixture golden '$GoldenDir' no existe."
    }
    $golden = Get-TreeInventory $GoldenDir -ExcludeDirs @("target")
    Assert-TreeEqual $inv1 $golden "etapa-3" "salida generada" "fixture golden (sin ediciones manuales)"

    # --- Etapa 4: compilación del proyecto generado ----------------------------
    Write-Host "[e2e] Etapa 4/5: compilación Maven del proyecto generado."
    Push-Location $run1
    try {
        Invoke-Native "etapa-4" { mvn -B clean package "-DskipTests" }
    } finally {
        Pop-Location
    }

    # --- Etapa 5: validación del descriptor Flutter ----------------------------
    Write-Host "[e2e] Etapa 5/5: validación de flutter-descriptor.json contra su contrato."
    $descriptor = Join-Path $run1 "flutter-descriptor.json"
    if (-not (Test-Path $descriptor)) {
        Fail "etapa-5" "el descriptor '$descriptor' no fue generado."
    }
    Invoke-Native "etapa-5" { node scripts/validate-flutter-descriptor.mjs $descriptor $Model }

    Write-Host "[e2e] PASS: las cinco etapas se ejecutaron; dos ejecuciones producen salida equivalente."
    exit 0
} finally {
    Pop-Location
}
